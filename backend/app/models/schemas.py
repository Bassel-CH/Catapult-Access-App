"""
Pydantic models for request/response validation
These ensure data coming in and going out is properly formatted
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


class UploadResponse(BaseModel):
    """Response after successful CSV upload"""
    success: bool
    filename: str
    row_count: int
    rows_dropped: int
    columns: List[str]
    preview: List[Dict[str, Any]]
    unique_values: Dict[str, List[str]]
    source_breakdown: Dict[str, int]

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "filename": "JulyPermissions.csv",
                "row_count": 4961,
                "rows_dropped": 2,
                "columns": ["StaffId", "StaffName", "..."],
                "preview": [{"StaffId": "12345", "StaffName": "John Smith"}],
                "unique_values": {
                    "staff_names": ["John Smith", "Jane Doe"],
                    "permissions": ["Access", "Read Only"]
                },
                "source_breakdown": {
                    "Position-Based": 4163,
                    "Direct Assignment": 798
                }
            }
        }


class FilterRequest(BaseModel):
    """Request body for filtering data"""
    staff_names: Optional[List[str]] = Field(None, description="Filter by staff names")
    permissions: Optional[List[str]] = Field(None, description="Filter by permission names")
    domains: Optional[List[str]] = Field(None, description="Filter by domain names")
    positions: Optional[List[str]] = Field(None, description="Filter by position names")
    permission_sources: Optional[List[str]] = Field(
        None,
        description="Filter by permission source (Position-Based / Direct Assignment)"
    )
    search_text: Optional[str] = Field(None, description="Search across all text fields")

    class Config:
        json_schema_extra = {
            "example": {
                "staff_names": ["John Smith", "Jane Doe"],
                "permissions": ["Access"],
                "domains": ["Catapult EHR"],
                "permission_sources": ["Direct Assignment"],
                "search_text": "scheduler"
            }
        }


class FilterResponse(BaseModel):
    """Response after applying filters"""
    success: bool
    data: List[Dict[str, Any]]
    total_rows: int
    filtered_rows: int


class ReviewRequest(BaseModel):
    """Request body for building a per-person access review"""
    staff_names: List[str] = Field(..., description="Selected staff names to review")

    class Config:
        json_schema_extra = {
            "example": {
                "staff_names": ["Amber Weiss", "Amber WeissTL", "Brian Wishard"]
            }
        }


class ReviewDocumentRequest(BaseModel):
    """Request body for generating the printable review document"""
    staff_names: List[str] = Field(..., description="Selected staff names")
    audit_label: str = Field("", description="e.g. 'July - Operations'")
    manager_name: str = Field("", description="Manager the packet is for")
    flagged: List[str] = Field(default_factory=list, description="Permissions to highlight")


class ExportRequest(BaseModel):
    """Request body for exporting filtered data"""
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


class ExportResponse(BaseModel):
    """Response after successful export"""
    success: bool
    filename: str
    row_count: int
    download_url: str


class ErrorResponse(BaseModel):
    """Standard error response"""
    success: bool = False
    error: str
    detail: Optional[str] = None


# ---------------------------------------------------------------------------
# Audit workflow contract (Phase A)
#
# These models are the shared "menu format" between the backend and the
# React app. The linchpin is `AuditPermission.id`: a stable fingerprint the
# backend assigns to every single permission, so a manager's Keep/Revoke
# decision can be pinned to exactly one permission and sent back reliably.
# ---------------------------------------------------------------------------


class AuditPermission(BaseModel):
    """A single reviewable permission, with its stable id."""
    id: str = Field(..., description="Stable fingerprint for this permission")
    name: str
    domain: str
    source: str  # "Direct Assignment" | "Position-Based"
    position: str = ""


class AuditApp(BaseModel):
    """A domain/app grouping a set of permissions."""
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
    """One person's full reviewable access tree."""
    staff_name: str
    found: bool
    email: str = ""
    groups: List[AuditGroup] = Field(default_factory=list)
    direct_count: int = 0
    inherited_count: int = 0
    permission_count: int = 0


class AuditTreeRequest(BaseModel):
    """Request the reviewable access tree for the selected staff."""
    staff_names: List[str] = Field(..., description="Selected staff names")


class AuditTreeResponse(BaseModel):
    """The reviewable access tree, one entry per selected name."""
    success: bool
    people: List[AuditPerson]


class AuditDecision(BaseModel):
    """A manager's decision on one permission, keyed by AuditPermission.id."""
    decision: Optional[str] = Field(
        None, description="'keep', 'revoke', or null for undecided"
    )
    note: str = ""


class GenerateReportRequest(BaseModel):
    """
    Everything needed to produce the completed audit report.

    decisions and highlights are keyed by AuditPermission.id.
    """
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