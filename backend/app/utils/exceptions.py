"""
Custom exceptions for better error handling
"""

class AuditFilterException(Exception):
    """Base exception for audit filter application"""
    pass


class InvalidCSVError(AuditFilterException):
    """Raised when CSV file is invalid or malformed"""
    pass


class NoDataLoadedError(AuditFilterException):
    """Raised when trying to filter/export without loaded data"""
    pass


class FilterError(AuditFilterException):
    """Raised when filter operation fails"""
    pass


class ExportError(AuditFilterException):
    """Raised when export generation fails"""
    pass