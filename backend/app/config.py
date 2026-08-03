"""
Configuration settings for the Audit Filter API
"""
from pathlib import Path

# Base directory - the root of the backend folder
BASE_DIR = Path(__file__).resolve().parent.parent

# Directory for temporary file uploads
UPLOAD_DIR = BASE_DIR / "temp_uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Directory for exported CSV files
EXPORT_DIR = BASE_DIR.parent / "exports"
EXPORT_DIR.mkdir(exist_ok=True)

# Expected CSV columns (7 columns - no PermissionDescription)
REQUIRED_COLUMNS = [
    'StaffId',
    'StaffName',
    'StaffEmailAddress',
    'DomainName',
    'PermissionName',
    'PositionName',
    'PermissionSource'
]

# API Settings
API_TITLE = "Audit Filter API"
API_VERSION = "1.0.0"
API_DESCRIPTION = """
Professional audit report filtering and export system.

## Features
* Upload CSV audit reports
* Filter by staff, permissions, domains, positions, and permission source
* Export filtered data with department assignments
"""

# CORS Settings - allows frontend to connect from different port
CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
]

# File upload limits
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_EXTENSIONS = {'.csv'}