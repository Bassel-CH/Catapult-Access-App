"""
Configuration settings for the Catapult Applications Audit backend
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
API_TITLE = "Catapult Applications Audit API"
API_VERSION = "1.0.0"
API_DESCRIPTION = """
Backend for the Catapult Applications Audit: upload the monthly permissions
export, review the selected staff's access, and produce the completed audit
report.
"""

# File upload limits
# The real monthly export is ~0.65 MB; 10 MB leaves ~15x room to grow.
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB