# syntax=docker/dockerfile:1
#
# Backend-only image for the dev stack. Build context is backend/. Production
# uses the root Dockerfile instead.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/backend

# Packages before code, so editing code doesn't rerun the slow install.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# appuser doesn't own the code, so the running app can't change it.
RUN useradd --system --create-home --uid 10001 --shell /usr/sbin/nologin appuser

USER appuser

EXPOSE 8000

# The slim image has no curl, and adding it only for this would enlarge it.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"

# The dev stack runs this with --reload added.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
