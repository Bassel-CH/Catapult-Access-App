"""
Service for generating and managing exports
"""
import pandas as pd
from pathlib import Path
from datetime import datetime

from ..config import EXPORT_DIR
from ..utils.exceptions import ExportError


class ExportService:
    """Handles export generation with department assignments"""

    @staticmethod
    def create_export(
        df: pd.DataFrame,
        department: str,
        audit_date: str = None
    ) -> Path:
        """
        Create export CSV with department and audit date columns

        Args:
            df: DataFrame to export
            department: Department name to add
            audit_date: Audit date (defaults to today)

        Returns:
            Path to the generated CSV file

        Raises:
            ExportError: If export generation fails
        """
        try:
            export_df = df.copy()
            export_df['Department'] = department

            if audit_date:
                export_df['AuditDate'] = audit_date
            else:
                export_df['AuditDate'] = datetime.now().strftime('%Y-%m-%d')

            # Generate a filesystem-safe filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            safe_dept_name = department.replace(' ', '_').replace('/', '-')
            filename = f"Audit_{safe_dept_name}_{timestamp}.csv"

            filepath = EXPORT_DIR / filename

            # Write UTF-8 so the export opens cleanly everywhere
            export_df.to_csv(filepath, index=False, encoding='utf-8')

            return filepath

        except Exception as e:
            raise ExportError(f"Error creating export: {str(e)}")

    @staticmethod
    def get_export_summary(filepath: Path) -> dict:
        """Get summary information about an export file"""
        return {
            "filename": filepath.name,
            "size_bytes": filepath.stat().st_size,
            "created": datetime.fromtimestamp(filepath.stat().st_ctime).isoformat()
        }