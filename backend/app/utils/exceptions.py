"""
Errors the app raises on purpose.
"""


class InvalidCSVError(Exception):
    """The uploaded file can't be used: wrong columns, no rows, unreadable."""
