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

# File upload limits
# The real monthly export is ~0.65 MB; 10 MB leaves ~15x room to grow.
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB