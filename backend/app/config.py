"""
Backend settings.
"""

# The columns every upload must have.
REQUIRED_COLUMNS = [
    'StaffId',
    'StaffName',
    'StaffEmailAddress',
    'DomainName',
    'PermissionName',
    'PositionName',
    'PermissionSource'
]

API_TITLE = "Catapult Applications Audit API"
API_VERSION = "1.0.0"
API_DESCRIPTION = """
Backend for the Catapult Applications Audit: upload the monthly permissions
export, review the selected staff's access, and produce the completed audit
report.
"""

# The real monthly export is about 0.65 MB; this leaves room to grow 15-fold.
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB