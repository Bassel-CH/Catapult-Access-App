"""
Service for generating exports
"""
import re
import pandas as pd
from datetime import datetime
from typing import Optional, Tuple

FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


class ExportService:
    """Handles export generation with department assignments"""

    @staticmethod
    def create_export(
        df: pd.DataFrame,
        department: str,
        audit_date: Optional[str] = None
    ) -> Tuple[bytes, str]:
        """
        Build the export CSV in memory, with department and audit date columns.

        Nothing is written to disk: the bytes go straight back to the browser,
        so no staff data is left behind on the server.

        Args:
            df: DataFrame to export
            department: Department name to add
            audit_date: Audit date (defaults to today)

        Returns:
            (csv_bytes, filename)
        """
        export_df = df.copy()
        export_df['Department'] = department
        export_df['AuditDate'] = audit_date or datetime.now().strftime('%Y-%m-%d')

        # Excel runs a cell that starts with = + - @ (or a tab or carriage
        # return) as a formula when the file is opened. Values come from the
        # source system and the department box, so prefix those with ' to
        # make Excel show them as plain text.
        export_df = export_df.map(
            lambda v: "'" + v if isinstance(v, str) and v.startswith(FORMULA_STARTS) else v
        )

        # Filename goes into an HTTP header, so allow only safe characters.
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        safe_dept_name = re.sub(r'[^A-Za-z0-9_-]+', '_', department).strip('_') or 'audit'
        filename = f"Audit_{safe_dept_name}_{timestamp}.csv"

        # UTF-8 so the export opens cleanly everywhere
        csv_bytes = export_df.to_csv(index=False).encode('utf-8')

        return csv_bytes, filename
