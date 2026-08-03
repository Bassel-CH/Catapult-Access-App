"""
Main FastAPI application
Entry point for the Audit Filter API
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import (
    API_TITLE,
    API_VERSION,
    API_DESCRIPTION,
    CORS_ORIGINS,
)
from .api.routes import router


# Create FastAPI application
app = FastAPI(
    title=API_TITLE,
    version=API_VERSION,
    description=API_DESCRIPTION,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Add CORS middleware (allows frontend to connect)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router)


@app.get("/")
async def root():
    """Root endpoint - API welcome message."""
    return {
        "message": "Audit Filter API",
        "version": API_VERSION,
        "docs": "/docs",
        "health": "/api/health",
    }


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Catch any uncaught exceptions and return a clean error response."""
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "Internal server error",
            "detail": str(exc),
        }
    )