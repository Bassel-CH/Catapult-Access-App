"""
One upload's data: reads and checks the permissions CSV, then answers
everything the app asks about it (filters, review trees, exports).

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


# The only two PermissionSource values that represent real permissions.
# Everything else (header dividers like "----", the trailing
# "(N rows affected)" footer, or blanks) is export noise and gets dropped.
VALID_PERMISSION_SOURCES = ["Position-Based", "Direct Assignment"]

logger = logging.getLogger("audit.csv")


class UploadedDataset:
    """One uploaded permissions CSV, held in memory for its session."""

    def __init__(self):
        self.current_df: Optional[pd.DataFrame] = None
        self.filename: Optional[str] = None

    async def process_upload(self, file_content: bytes, filename: str) -> Dict[str, Any]:
        """
        Process uploaded CSV file

        Args:
            file_content: Raw bytes of the CSV file
            filename: Name of the uploaded file

        Returns:
            Dictionary with upload summary and preview data

        Raises:
            InvalidCSVError: If CSV is malformed or missing required columns
        """
        try:
            # Read the CSV. Reports come out cp1252-encoded (Windows), so try
            # that first, then fall back to UTF-8 if a different file shows up.
            df = self._read_csv_with_encoding(file_content)

            # Validate required columns
            missing_cols = set(REQUIRED_COLUMNS) - set(df.columns)
            if missing_cols:
                raise InvalidCSVError(
                    f"Missing required columns: {', '.join(missing_cols)}"
                )

            # Drop export noise: keep only rows with a real PermissionSource.
            # This removes the dashes-divider row and the "(N rows affected)"
            # footer automatically, every month, without hardcoding them.
            rows_before = len(df)
            df = df[df["PermissionSource"].isin(VALID_PERMISSION_SOURCES)].copy()
            rows_dropped = rows_before - len(df)

            # Nothing survived the drop. Previously this returned success with
            # row_count 0, which let the UI open an audit over an empty dataset
            # and produce a report attesting to nothing. For a compliance tool
            # that silent no-op is worse than a hard failure, so refuse it.
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

            # Clean the data
            df = self._clean_dataframe(df)

            # Store in memory
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
            # pandas' parser messages are about the file's shape (e.g.
            # "Expected 7 fields in line 12, saw 8") — safe and useful to show.
            raise InvalidCSVError(f"Error parsing CSV: {str(e)}")
        except Exception:
            # Anything else is unexpected: keep internals out of the response.
            ref = secrets.token_hex(3)
            logger.exception("Unexpected error processing CSV [ref %s]", ref)
            raise InvalidCSVError(
                "Could not process this CSV. Check that it's the usual report "
                f"export. Reference: {ref}"
            )

    def _read_csv_with_encoding(self, file_content: bytes) -> pd.DataFrame:
        """
        Read CSV bytes, trying the encodings our reports actually use.

        UTF-8 is tried FIRST, then cp1252 (Windows-1252, what the monthly
        export uses). The order matters: cp1252 accepts almost any byte, so
        trying it first "succeeds" on UTF-8 files and garbles accents
        ("Jené" -> "JenÃ©"). UTF-8 is strict, so a real cp1252 file with
        accents fails it cleanly and falls through to cp1252. Pure-ASCII
        files read identically either way.

        "utf-8-sig" is UTF-8 that also strips the invisible byte-order mark
        Excel adds when saving as "CSV UTF-8"; without that, the first column
        header reads as "\\ufeffStaffId" and the upload is rejected.

        dtype=str keeps every column as text, so an id like "00123" is never
        turned into the number 123. Text like "NULL" in empty PositionName
        cells is still read as blank (the default NA handling, which the
        direct-assignment rows rely on).
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
        """
        Clean and standardize the dataframe

        Args:
            df: Raw dataframe from CSV

        Returns:
            Cleaned dataframe
        """
        # Strip whitespace from string columns.
        # pandas 3.0: use .map (DataFrame.applymap was removed in 3.0).
        string_columns = df.select_dtypes(include=["object", "string"]).columns
        for col in string_columns:
            df[col] = df[col].map(lambda x: x.strip() if isinstance(x, str) else x)

        # Replace missing values with empty strings for cleaner display
        df = df.fillna("")

        # Ensure StaffId is treated as text (preserves leading zeros)
        df["StaffId"] = df["StaffId"].astype(str)

        return df

    def _get_source_breakdown(self, df: pd.DataFrame) -> Dict[str, int]:
        """
        Count rows by PermissionSource.

        This is the audit signal: how many permissions are inherited from a
        position vs. hand-granted directly to a user (the rows worth review).
        """
        counts = df["PermissionSource"].value_counts().to_dict()
        return {str(k): int(v) for k, v in counts.items()}

    def all_rows(self) -> List[Dict[str, Any]]:
        """Every row of the upload, one dict per row."""
        return self.current_df.to_dict("records")

    def get_data_by_staff_ids(self, staff_ids: List[str]) -> pd.DataFrame:
        """
        Get data for specific staff IDs

        Args:
            staff_ids: List of staff IDs to retrieve

        Returns:
            Filtered dataframe
        """
        return self.current_df[self.current_df["StaffId"].isin(staff_ids)].copy()

    # ------------------------------------------------------------------
    # Audit tree (Phase A): the reviewable structure with stable IDs
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
        Build a stable fingerprint for one permission.

        Deterministic: the same loaded data always yields the same id, so a
        decision made in the browser maps back to the exact same permission
        on the server. `occurrence` disambiguates genuine duplicate rows.
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
        """Build one group (direct, or a single position) with per-app leaves."""
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
        Build the reviewable access tree for the selected staff.

        Per person: a Direct-assignment group (first, the reviewable set) plus
        one group per Position they hold (reference). Each group -> apps ->
        permissions, and every permission carries a stable id.

        Grouped by StaffName so related profiles like
        "Amber Weiss" and "Amber WeissTL" stay separate.
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

            # Direct assignments first — the set the manager actually reviews.
            if len(direct_df):
                groups.append(self._audit_group(
                    name, "Direct Assignment", "Direct assignment", None, direct_df
                ))

            # One group per position, for reference context.
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
