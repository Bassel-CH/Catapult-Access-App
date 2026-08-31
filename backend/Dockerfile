# syntax=docker/dockerfile:1
#
# Audit Filter API — production image.
# Build context is backend/ :  docker build -t audit-backend ./backend

FROM python:3.12-slim

# PYTHONDONTWRITEBYTECODE: don't litter .pyc files in the image layer.
# PYTHONUNBUFFERED:        send logs straight to stdout so `docker logs` is live,
#                          not held in a buffer until the process exits.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# /srv/backend mirrors the repo's backend/ directory. That is deliberate —
# see the note on EXPORT_DIR below.
WORKDIR /srv/backend

# Dependencies get their own layer, copied BEFORE the app code.
# requirements.txt changes rarely; app/ changes constantly. Docker caches layers
# in order, so this ordering means editing a service file re-runs only the
# COPY app step, not a two-minute pandas rebuild.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# --- Paths, and why the WORKDIR above is not arbitrary --------------------
# config.py does:
#     BASE_DIR   = Path(__file__).resolve().parent.parent
#     UPLOAD_DIR = BASE_DIR / "temp_uploads"
#     EXPORT_DIR = BASE_DIR.parent / "exports"     <-- note: .parent
#
# With app/ at /srv/backend/app, BASE_DIR resolves to /srv/backend, so:
#     UPLOAD_DIR = /srv/backend/temp_uploads
#     EXPORT_DIR = /srv/exports
# Same shape as the repo. Move WORKDIR to /srv and exports would land at /exports
# instead — filesystem root — and your volume mount would silently miss it.
#
# Both mkdir() calls run at IMPORT time, so these paths must exist and be
# writable by the runtime user before uvicorn ever starts.
RUN useradd --system --create-home --uid 10001 --shell /usr/sbin/nologin appuser \
 && mkdir -p /srv/exports /srv/backend/temp_uploads \
 && chown -R appuser:appuser /srv

USER appuser

EXPOSE 8000

# python -c instead of curl: the slim base has no curl, and adding one just for
# a healthcheck grows the image and the CVE surface.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"

# No --reload: it runs a file-watching supervisor and reloads on change. Correct
# in dev, wrong in prod (extra process, extra memory, restarts on a stray write).
# --proxy-headers makes uvicorn trust X-Forwarded-Proto/For from the reverse
# proxy we add next phase, so request.url reflects https:// rather than the
# container's own http://. --forwarded-allow-ips is scoped to the Docker bridge
# subnet, not "*", so only an in-network proxy can set those headers.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "172.16.0.0/12"]
