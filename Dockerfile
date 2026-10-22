# syntax=docker/dockerfile:1
#
# Production image: the built frontend, served by nginx, and the backend, run
# together under supervisord. Build context is the repo root. The three stages
# are explained in docs/docker.md.

# Names the Debian release: the bare python:3.12-slim tag has moved between
# releases before, taking system libraries with it.
ARG PYTHON_IMAGE=python:3.12-slim-trixie

# ---------- stage 1: frontend build ----------
FROM node:22-alpine AS frontend-build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---------- stage 2: backend dependencies ----------
FROM ${PYTHON_IMAGE} AS backend-deps

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN python -m venv /opt/venv

COPY backend/requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install -r /tmp/requirements.txt supervisor==4.3.0

# ---------- stage 3: runtime ----------
FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH

# Debian's own nginx, so security fixes arrive with any rebuild.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend-deps /opt/venv /opt/venv
COPY backend/app /srv/backend/app
COPY --from=frontend-build /app/dist /srv/frontend

COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/supervisord.conf /etc/supervisord.conf
COPY deploy/stop_container_on_crash.py /srv/deploy/

# appuser runs everything but owns none of the code or config, so the running
# app can't change them. It writes only to /tmp: pid files and a socket, never
# upload data.
RUN useradd --system --create-home --uid 10001 --shell /usr/sbin/nologin appuser

USER appuser

# Not 80: a non-root process can't listen below 1024.
EXPOSE 8080

# Goes through nginx to the backend, so one check covers both.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health').status==200 else 1)"

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
