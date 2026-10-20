"""
Custom exceptions for better error handling
"""

class AppError(Exception):
    """Base for the errors this app raises on purpose."""
    pass


class InvalidCSVError(AppError):
    """Raised when CSV file is invalid or malformed"""
    pass


class NoDataLoadedError(AppError):
    """Raised when trying to filter/export without loaded data"""
    pass


class FilterError(AppError):
    """Raised when filter operation fails"""
    pass


class ExportError(AppError):
    """Raised when export generation fails"""
    pass