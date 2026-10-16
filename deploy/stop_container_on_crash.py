"""
supervisord event listener: if nginx or uvicorn exits or fails to start, stop
supervisord so the whole container exits and Docker restarts it.

supervisord talks to listeners over stdin/stdout: we print READY, it sends one
event (a header line, then a payload of `len` bytes), we answer RESULT.
Anything meant for humans goes to stderr.
"""
import os
import signal
import sys


def parse(line):
    return dict(token.split(":", 1) for token in line.split())


while True:
    sys.stdout.write("READY\n")
    sys.stdout.flush()

    header = parse(sys.stdin.readline())
    event = parse(sys.stdin.read(int(header["len"])))

    sys.stdout.write("RESULT 2\nOK")
    sys.stdout.flush()

    sys.stderr.write(
        f"stop-container-on-crash: {event.get('processname')} -> "
        f"{header['eventname']}; stopping container\n"
    )
    sys.stderr.flush()
    os.kill(os.getppid(), signal.SIGTERM)
