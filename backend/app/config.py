"""
Configuration settings for the Audit Filter API
"""

# No upload or export directories: uploads are parsed in memory and exports
# are built in memory and sent straight back. Nothing touches the disk.

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