"""
The shapes of every API request and response. frontend/src/types/api.ts
mirrors them; change both together.
"""
from pydantic import BaseModel, Field
from typing import List, Literal, Optional, Dict, Any


class UploadResponse(BaseModel):
    """POST /api/upload"""
    success: bool
    session_id: str = Field(
        ..., description="Send back as the X-Session-Id header on every later call"
    )
    filename: str
    row_count: int
    rows_dropped: int
    source_breakdown: Dict[str, int]

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "filename": "JulyPermissions.csv",
                "row_count": 4961,
                "rows_dropped": 2,
                "source_breakdown": {
                    "Position-Based": 4163,
                    "Direct Assignment": 798
                }
            }
        }


class RowsResponse(BaseModel):
    """GET /api/rows: every row of the session's upload."""
    success: bool
    data: List[Dict[str, Any]]


class ReviewDocumentRequest(BaseModel):
    """POST /api/review-document"""
    staff_names: List[str] = Field(..., description="Selected staff names")
    audit_label: str = Field("", description="e.g. 'July - Operations'")
    manager_name: str = Field("", description="Manager the packet is for")
    flagged: List[str] = Field(
        default_factory=list,
        description="AuditPermission ids to highlight (same ids as /audit-tree)",
    )


class ExportRequest(BaseModel):
    """POST /api/export"""
    staff_ids: List[str] = Field(..., description="List of StaffIds to export")
    department: str = Field(..., description="Department name to add to export")
    audit_date: Optional[str] = Field(None, description="Audit date (defaults to today)")

    class Config:
        json_schema_extra = {
            "example": {
                "staff_ids": ["12345", "67890"],
                "department": "Operations - July 2026",
                "audit_date": "2026-07-28"
            }
        }


# ---------------------------------------------------------------------------
# The audit tree, decisions and the report. Highlights and decisions are keyed
# by AuditPermission.id.
# ---------------------------------------------------------------------------


class AuditPermission(BaseModel):
    """One permission, with its stable id."""
    id: str = Field(..., description="Stable fingerprint for this permission")
    name: str
    domain: str
    source: str  # "Direct Assignment" | "Position-Based"
    position: str = ""


class AuditApp(BaseModel):
    """One app's permissions (the CSV's DomainName)."""
    domain: str
    permissions: List[AuditPermission]


class AuditGroup(BaseModel):
    """
    One bucket of a person's access: either their Direct Assignments, or
    the access inherited from one Position they hold.
    """
    key: str  # "direct" | "position"
    label: str
    position: Optional[str] = None
    source: str
    apps: List[AuditApp]


class AuditPerson(BaseModel):
    """One staff member's audit tree. found=False if the name isn't in the upload."""
    staff_name: str
    found: bool
    email: str = ""
    groups: List[AuditGroup] = Field(default_factory=list)
    direct_count: int = 0
    inherited_count: int = 0
    permission_count: int = 0


class AuditTreeRequest(BaseModel):
    """POST /api/audit-tree"""
    staff_names: List[str] = Field(..., description="Selected staff names")


class AuditTreeResponse(BaseModel):
    """One audit tree per requested name, in the same order."""
    success: bool
    people: List[AuditPerson]


class AuditDecision(BaseModel):
    """A manager's decision on one permission, keyed by AuditPermission.id."""
    # Anything else is rejected with a 422, rather than silently counted as
    # "No decision".
    decision: Optional[Literal["keep", "revoke"]] = Field(
        None, description="'keep', 'revoke', or null for undecided"
    )
    note: str = ""


class GenerateReportRequest(BaseModel):
    """POST /api/report. decisions and highlights are keyed by AuditPermission.id."""
    staff_names: List[str] = Field(..., description="Selected staff names")
    department: str = ""
    period_label: str = Field("", description="e.g. 'July 2026'")
    manager_name: str = ""
    audit_label: str = Field("", description="e.g. 'July - Operations'")
    decisions: Dict[str, AuditDecision] = Field(default_factory=dict)
    highlights: Dict[str, str] = Field(
        default_factory=dict, description="permission id -> IT note"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "staff_names": ["Amber Weiss"],
                "department": "Operations",
                "period_label": "July 2026",
                "manager_name": "Jane Doe",
                "decisions": {
                    "a1b2c3d4e5f6": {"decision": "revoke", "note": "left team"}
                },
                "highlights": {"a1b2c3d4e5f6": "elevated access - confirm"},
            }
        }


class ReportSummary(BaseModel):
    """Headline counts for the completed audit."""
    users_reviewed: int
    total_permissions: int
    kept: int
    revoked: int
    no_decision: int


class ReportResponse(BaseModel):
    """The completed audit: headline counts plus the rendered HTML report."""
    success: bool
    summary: ReportSummary
    html: str