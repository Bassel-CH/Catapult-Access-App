# syntax=docker/dockerfile:1
#
# Catapult Applications Audit — combined production image: nginx + FastAPI in one container.
# Build context is the repo root :  docker build -t audit-app .
#
# This is the PROD path only. Dev still uses docker-compose.yml + the override
# (backend/Dockerfile + a Vite dev server), untouched by this file.
#
# Three stages:
#   frontend-build  Node compiles the SPA; only dist/ leaves this stage.
#   backend-deps    pip installs into a venv; only the venv leaves this stage.
#   runtime         slim Python + Debian's nginx + supervisord running both.

# trixie pinned explicitly: the bare python:3.12-slim tag has moved between
# Debian releases before, and the glibc version moves with it.
ARG PYTHON_IMAGE=python:3.12-slim-trixie

# ---------- stage 1: frontend build ----------
FROM node:22-alpine AS frontend-build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# package.json runs `tsc -b && vite build` — a type error fails the build.
RUN npm run build

# ---------- stage 2: backend dependencies ----------
FROM ${PYTHON_IMAGE} AS backend-deps

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# A venv makes "everything pip installed" one directory we can copy whole.
RUN python -m venv /opt/venv

COPY backend/requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install -r /tmp/requirements.txt supervisor==4.3.0

# ---------- stage 3: runtime ----------
FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH

# Debian's own nginx package, so security fixes arrive with normal Debian
# updates on a rebuild.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend-deps /opt/venv /opt/venv
COPY backend/app /srv/backend/app
COPY --from=frontend-build /app/dist /srv/frontend

COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/supervisord.conf /etc/supervisord.conf
COPY deploy/stop_container_on_crash.py /srv/deploy/

# Everything runs as appuser — supervisord, nginx and uvicorn. It owns none of
# the code or config, so the running app can't modify them. The only writable
# place it needs is /tmp, for pid files and a socket. Upload data never goes
# there: nginx and the backend both keep it in memory.
RUN useradd --system --create-home --uid 10001 --shell /usr/sbin/nologin appuser

USER appuser

# 8080, not 80: a non-root process can't bind ports below 1024.
EXPOSE 8080

# Goes through nginx to uvicorn, so one check covers both processes.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health').status==200 else 1)"

# supervisord is PID 1. See deploy/supervisord.conf for what happens when a
# child process dies.
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
