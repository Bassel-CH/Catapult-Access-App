"""
The FastAPI app: settings applied at startup, the routes, and the last-resort
error handler.
"""
import logging
import os
import secrets

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.formparsers import MultiPartParser

from .config import (
    API_TITLE,
    API_VERSION,
    API_DESCRIPTION,
    MAX_UPLOAD_SIZE,
)
from .api.routes import router

logger = logging.getLogger("audit.api")


# Starlette moves uploads over spool_max_size (1 MB by default) to a temp file
# on disk; uploads hold permission data, so keep every accepted one in memory.
# It's an undocumented class attribute: if an upgrade removes it, setting it
# would silently do nothing, so refuse to start instead.
if not isinstance(getattr(MultiPartParser, "spool_max_size", None), int):
    raise RuntimeError(
        "starlette's MultiPartParser.spool_max_size is gone, so uploads would be "
        "written to disk. Find its replacement before upgrading; "
        "tests/test_upload_stays_in_memory.py checks the result."
    )
MultiPartParser.spool_max_size = MAX_UPLOAD_SIZE + 1024 * 1024


# The interactive API docs stay off unless enabled, so a deployment that
# forgets the setting doesn't publish them. The dev stack enables them.
DOCS_ENABLED = os.environ.get("ENABLE_API_DOCS", "").lower() == "true"

app = FastAPI(
    title=API_TITLE,
    version=API_VERSION,
    description=API_DESCRIPTION,
    docs_url="/docs" if DOCS_ENABLED else None,
    redoc_url="/redoc" if DOCS_ENABLED else None,
    openapi_url="/openapi.json" if DOCS_ENABLED else None,
)

app.include_router(router)


@app.get("/")
async def root():
    return {
        "message": API_TITLE,
        "version": API_VERSION,
        "docs": "/docs" if DOCS_ENABLED else None,
        "health": "/api/health",
    }


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Anything the routes didn't catch: a reference code to the browser, details to the log."""
    ref = secrets.token_hex(3)
    logger.error("Unhandled error [ref %s]", ref, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "Internal server error",
            "detail": f"Internal server error. Reference: {ref}",
        }
    )