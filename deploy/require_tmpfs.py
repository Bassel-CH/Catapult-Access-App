"""
Container entrypoint: refuse to start unless /tmp is an in-memory (tmpfs)
mount, then hand over to the real command (supervisord).

Why: uploads over 1 MB are spooled by Starlette to a temp file, and that file
holds real permissions data. On tmpfs it lives in RAM; on the container's
normal filesystem it would be written to disk. Nothing inside the image can
prevent that, so the mount is a hard requirement — see deploy/README.md.
"""
import os
import sys
import tempfile


def mount_type(path):
    """Filesystem type of the mount that contains `path`."""
    path = os.path.realpath(path)
    best_mount, best_type = "", None
    with open("/proc/mounts") as mounts:
        for line in mounts:
            _, mount_point, fs_type = line.split()[:3]
            inside = path == mount_point or path.startswith(mount_point.rstrip("/") + "/")
            if inside and len(mount_point) > len(best_mount):
                best_mount, best_type = mount_point, fs_type
    return best_type


# /tmp is where nginx and supervisord write; gettempdir() is where Python's
# temp files go (normally also /tmp, unless TMPDIR points elsewhere).
for path in sorted({"/tmp", tempfile.gettempdir()}):
    if mount_type(path) != "tmpfs":
        sys.stderr.write(
            f"Refusing to start: {path} is not a tmpfs (in-memory) mount.\n"
            "Uploaded audit data is written to temp files there and must not reach disk.\n"
            "Mount a tmpfs at /tmp (e.g. `docker run --tmpfs /tmp:size=64m ...`)\n"
            "and leave TMPDIR unset.\n"
            "See deploy/README.md for docker compose and ECS.\n"
        )
        sys.exit(1)

# exec, not a subprocess: supervisord replaces this script and stays PID 1.
os.execvp(sys.argv[1], sys.argv[1:])
