"""
One upload's data: reads and checks the permissions CSV, then answers what
the app asks about it (its rows, audit trees, rows to export).

Each session holds exactly one of these (see session_service.py).
"""
import pandas as pd
from typing import Dict, List, Any, Optional
import io
import hashlib
import logging
import secrets

from ..config import REQUIRED_COLUMNS
from ..utils.exceptions import InvalidCSVError


# The only PermissionSource values on real permission rows. Anything else is
# export noise (the "----" divider, the "(N rows affected)" footer).
VALID_PERMISSION_SOURCES = ["Position-Based", "Direct Assignment"]

logger = logging.getLogger("audit.csv")


class UploadedDataset:
    """One uploaded permissions CSV, held in memory for its session."""

    def __init__(self):
        self.current_df: Optional[pd.DataFrame] = None
        self.filename: Optional[str] = None

    async def process_upload(self, file_content: bytes, filename: str) -> Dict[str, Any]:
        """
        Read and check the upload and keep it. Returns its row counts.

        Raises InvalidCSVError, with a message fit to show, if the file can't
        be used.
        """
        try:
            df = self._read_csv_with_encoding(file_content)

            missing_cols = set(REQUIRED_COLUMNS) - set(df.columns)
            if missing_cols:
                raise InvalidCSVError(
                    f"Missing required columns: {', '.join(missing_cols)}"
                )

            rows_before = len(df)
            df = df[df["PermissionSource"].isin(VALID_PERMISSION_SOURCES)].copy()
            rows_dropped = rows_before - len(df)

            # An audit over nothing would produce a report attesting to nothing.
            if len(df) == 0:
                raise InvalidCSVError(
                    "No permission rows found in this file"
                    + (
                        f" — all {rows_dropped} row(s) were export noise "
                        "(divider or '(N rows affected)' footer). "
                        if rows_dropped
                        else " — it has the right columns but no data rows. "
                    )
                    + "Check that this is the full report export."
                )

            df = self._clean_dataframe(df)

            self.current_df = df
            self.filename = filename

            return {
                "row_count": len(df),
                "rows_dropped": rows_dropped,
                "source_breakdown": self._get_source_breakdown(df),
            }

        except InvalidCSVError:
            raise
        except pd.errors.EmptyDataError:
            raise InvalidCSVError("CSV file is empty")
        except pd.errors.ParserError as e:
            # pandas' parser messages describe the file's shape (e.g. "Expected
            # 7 fields in line 12, saw 8"): safe and useful to show.
            raise InvalidCSVError(f"Error parsing CSV: {str(e)}")
        except Exception:
            # Anything else is unexpected: keep the details out of the message.
            ref = secrets.token_hex(3)
            logger.exception("Unexpected error processing CSV [ref %s]", ref)
            raise InvalidCSVError(
                "Could not process this CSV. Check that it's the usual report "
                f"export. Reference: {ref}"
            )

    def _read_csv_with_encoding(self, file_content: bytes) -> pd.DataFrame:
        """
        Parse the CSV as UTF-8, or else as cp1252 (what the monthly export uses).

        UTF-8 must be tried first: cp1252 accepts almost any byte, so it would
        "succeed" on a UTF-8 file and garble its accents. "utf-8-sig" also
        strips the byte-order mark Excel adds to "CSV UTF-8" files.

        dtype=str keeps ids like "00123" as text. The text "NULL" still reads
        as blank, which direct assignments' PositionName relies on.
        """
        for encoding in ("utf-8-sig", "cp1252"):
            try:
                return pd.read_csv(
                    io.BytesIO(file_content), encoding=encoding, dtype=str
                )
            except UnicodeDecodeError:
                continue
        raise InvalidCSVError(
            "Could not read the file with cp1252 or UTF-8 encoding. "
            "Please check the file came from the usual report export."
        )

    def _clean_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """Trim whitespace and turn missing values into empty strings."""
        string_columns = df.select_dtypes(include=["object", "string"]).columns
        for col in string_columns:
            df[col] = df[col].map(lambda x: x.strip() if isinstance(x, str) else x)

        df = df.fillna("")

        df["StaffId"] = df["StaffId"].astype(str)

        return df

    def _get_source_breakdown(self, df: pd.DataFrame) -> Dict[str, int]:
        """Rows per PermissionSource: how many come from positions vs. direct grants."""
        counts = df["PermissionSource"].value_counts().to_dict()
        return {str(k): int(v) for k, v in counts.items()}

    def all_rows(self) -> List[Dict[str, Any]]:
        """Every row of the upload, one dict per row."""
        return self.current_df.to_dict("records")

    def get_data_by_staff_ids(self, staff_ids: List[str]) -> pd.DataFrame:
        """The rows for these StaffIds (the export selects by id, not name)."""
        return self.current_df[self.current_df["StaffId"].isin(staff_ids)].copy()

    # ------------------------------------------------------------------
    # Audit tree: each staff member's access, with a stable id per permission
    # ------------------------------------------------------------------

    @staticmethod
    def _leaf_id(
        staff_name: str,
        source: str,
        position: str,
        domain: str,
        permission: str,
        occurrence: int,
    ) -> str:
        """
        A stable fingerprint for one permission: the same row always gets the
        same id, which is what lets a re-upload restore an audit. `occurrence`
        tells exact duplicate rows apart. md5 is used as a fingerprint here,
        not for security.
        """
        raw = f"{staff_name}|{source}|{position}|{domain}|{permission}|{occurrence}"
        return hashlib.md5(raw.encode("utf-8")).hexdigest()[:12]

    def _audit_group(
        self,
        staff_name: str,
        source: str,
        label: str,
        position: Optional[str],
        df: pd.DataFrame,
    ) -> Dict[str, Any]:
        """One group (the direct grants, or one position), split into apps."""
        apps: List[Dict[str, Any]] = []
        for domain in sorted(df["DomainName"].unique()):
            dom_df = df[df["DomainName"] == domain]
            permissions: List[Dict[str, Any]] = []
            seen: Dict[str, int] = {}
            for perm in sorted(dom_df["PermissionName"].tolist()):
                occ = seen.get(perm, 0)
                seen[perm] = occ + 1
                permissions.append({
                    "id": self._leaf_id(
                        staff_name, source, position or "", domain, perm, occ
                    ),
                    "name": perm,
                    "domain": domain,
                    "source": source,
                    "position": position or "",
                })
            apps.append({"domain": domain, "permissions": permissions})

        return {
            "key": "direct" if source == "Direct Assignment" else "position",
            "label": label,
            "position": position,
            "source": source,
            "apps": apps,
        }

    def build_audit_tree(self, staff_names: List[str]) -> List[Dict[str, Any]]:
        """
        Each staff member's access: their direct grants first, then one group
        per position they hold; each group split into apps, then permissions.

        Grouped by StaffName, so related profiles like "Amber Weiss" and
        "Amber WeissTL" stay separate. A name not in the upload comes back
        with found=False.
        """
        people: List[Dict[str, Any]] = []

        for name in staff_names:
            person = self.current_df[self.current_df["StaffName"] == name]

            if len(person) == 0:
                people.append({
                    "staff_name": name,
                    "found": False,
                    "email": "",
                    "groups": [],
                    "direct_count": 0,
                    "inherited_count": 0,
                    "permission_count": 0,
                })
                continue

            email = person["StaffEmailAddress"].iloc[0]
            direct_df = person[person["PermissionSource"] == "Direct Assignment"]
            inherited_df = person[person["PermissionSource"] == "Position-Based"]

            groups: List[Dict[str, Any]] = []

            if len(direct_df):
                groups.append(self._audit_group(
                    name, "Direct Assignment", "Direct assignment", None, direct_df
                ))

            for position in sorted(inherited_df["PositionName"].unique()):
                pos_df = inherited_df[inherited_df["PositionName"] == position]
                groups.append(self._audit_group(
                    name, "Position-Based", position, position, pos_df
                ))

            people.append({
                "staff_name": name,
                "found": True,
                "email": email,
                "groups": groups,
                "direct_count": int(len(direct_df)),
                "inherited_count": int(len(inherited_df)),
                "permission_count": int(len(person)),
            })

        return people
