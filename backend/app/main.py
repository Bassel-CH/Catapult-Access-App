"""
Main FastAPI application
Entry point for the Audit Filter API
"""
import logging
import os
import secrets

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .config import (
    API_TITLE,
    API_VERSION,
    API_DESCRIPTION,
)
from .api.routes import router

logger = logging.getLogger("audit.api")


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