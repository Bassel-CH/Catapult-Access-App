"""
Main FastAPI application
Entry point for the Audit Filter API
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


# Starlette moves an uploaded file from memory to a temp file on disk once it
# passes spool_max_size (1 MB by default), and uploads hold real permissions
# data. Raising it above the upload limit keeps every accepted upload in memory.
# This is a class attribute, not a documented setting: if an upgrade removed
# it, setting it would silently do nothing, so refuse to start instead.
if not isinstance(getattr(MultiPartParser, "spool_max_size", None), int):
    raise RuntimeError(
        "starlette's MultiPartParser.spool_max_size is gone, so uploads would be "
        "written to disk. Find its replacement before upgrading; "
        "tests/test_upload_stays_in_memory.py checks the result."
    )
MultiPartParser.spool_max_size = MAX_UPLOAD_SIZE + 1024 * 1024


# The interactive API docs (/docs, /redoc, /openapi.json) are for development.
# Off unless ENABLE_API_DOCS=true, so a deployment that forgets the setting
# doesn't publish them. The dev compose override turns them on.
DOCS_ENABLED = os.environ.get("ENABLE_API_DOCS", "").lower() == "true"

# Create FastAPI application
app = FastAPI(
    title=API_TITLE,
    version=API_VERSION,
    description=API_DESCRIPTION,
    docs_url="/docs" if DOCS_ENABLED else None,
    redoc_url="/redoc" if DOCS_ENABLED else None,
    openapi_url="/openapi.json" if DOCS_ENABLED else None,
)

# Include API routes
app.include_router(router)


@app.get("/")
async def root():
    """Root endpoint - API welcome message."""
    return {
        "message": "Audit Filter API",
        "version": API_VERSION,
        "docs": "/docs" if DOCS_ENABLED else None,
        "health": "/api/health",
    }


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    Last resort for anything the routes didn't catch. The browser gets a
    generic message and a reference code; the details go to the server log.
    """
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