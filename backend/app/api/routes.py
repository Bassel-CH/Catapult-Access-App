"""
The HTTP API, all under /api. Every route except upload, session and health
works on the caller's session, looked up by current_session().
"""
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, Response

from ..config import API_TITLE, API_VERSION, MAX_UPLOAD_SIZE
from ..models.schemas import (
    UploadResponse,
    RowsResponse,
    ReviewDocumentRequest,
    ExportRequest,
    AuditTreeRequest,
    AuditTreeResponse,
    GenerateReportRequest,
    ReportResponse,
    ReportSummary,
)
from ..services.uploaded_dataset import UploadedDataset
from ..services.document_service import DocumentService
from ..services.export_service import ExportService
from ..services.report_service import ReportService
from ..services.session_service import SessionStore
from ..utils.exceptions import InvalidCSVError

router = APIRouter(prefix="/api", tags=["audit"])

logger = logging.getLogger("audit.api")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def internal_error(what: str) -> HTTPException:
    """
    A 500 carrying only `what` and a reference code; the full exception, which
    can include data values, goes to the log under that code.

    Call it inside an `except` block: logger.exception() logs the exception
    currently being handled.
    """
    ref = secrets.token_hex(3)
    logger.exception("%s [ref %s]", what, ref)
    return HTTPException(status_code=500, detail=f"{what}. Reference: {ref}")

sessions = SessionStore()


def current_session(
    x_session_id: Optional[str] = Header(None),
) -> UploadedDataset:
    """
    The caller's dataset, from the X-Session-Id header.

    Missing, unknown and expired ids all get the same 400 "No data loaded". The
    frontend's isSessionLost() matches that phrase to offer re-upload recovery,
    so keep the wording.
    """
    dataset = sessions.get(x_session_id)
    if dataset is None:
        raise HTTPException(
            status_code=400, detail="No data loaded. Please upload a CSV first."
        )
    return dataset


# ---------------------------------------------------------------------------
# Loading the export
# ---------------------------------------------------------------------------


@router.post("/upload", response_model=UploadResponse)
async def upload_csv(
    file: UploadFile = File(...),
    x_session_id: Optional[str] = Header(None),
):
    """Load the monthly export and start a new session for it."""
    try:
        if not (file.filename or "").lower().endswith('.csv'):
            raise HTTPException(
                status_code=400,
                detail="File must be a CSV (.csv extension)"
            )

        # One byte past the limit is enough to know it's too big.
        content = await file.read(MAX_UPLOAD_SIZE + 1)
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"File is too large (limit {MAX_UPLOAD_SIZE // (1024 * 1024)} MB). "
                    "The monthly export is normally well under 1 MB — check "
                    "this is the right file."
                ),
            )

        dataset = UploadedDataset()
        result = await dataset.process_upload(content, file.filename)

        # Only now, after a successful parse: a failed upload keeps the old session.
        sessions.end(x_session_id)
        session_id = sessions.create(dataset)

        return UploadResponse(
            success=True,
            session_id=session_id,
            filename=file.filename,
            row_count=result["row_count"],
            rows_dropped=result["rows_dropped"],
            source_breakdown=result["source_breakdown"],
        )

    except InvalidCSVError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception:
        raise internal_error("Error processing file")


@router.get("/rows", response_model=RowsResponse)
async def list_rows(dataset: UploadedDataset = Depends(current_session)):
    """Every row of the upload; the app builds its staff list from them."""
    try:
        return RowsResponse(success=True, data=dataset.all_rows())
    except Exception:
        raise internal_error("Error reading rows")


# ---------------------------------------------------------------------------
# The audit
# ---------------------------------------------------------------------------


@router.post("/audit-tree", response_model=AuditTreeResponse)
async def audit_tree(
    request: AuditTreeRequest,
    dataset: UploadedDataset = Depends(current_session),
):
    """Each selected staff member's access, with the permission ids decisions use."""
    try:
        people = dataset.build_audit_tree(request.staff_names)
        return AuditTreeResponse(success=True, people=people)
    except Exception:
        raise internal_error("Error building audit tree")


@router.post("/report", response_model=ReportResponse)
async def generate_report(
    request: GenerateReportRequest,
    dataset: UploadedDataset = Depends(current_session),
):
    """The completed report. The Access rule is applied here, so this is the record."""
    try:
        people = dataset.build_audit_tree(request.staff_names)
        decisions = {k: v.model_dump() for k, v in request.decisions.items()}
        html, summary = ReportService.render(
            people=people,
            decisions=decisions,
            highlights=request.highlights,
            department=request.department,
            period_label=request.period_label,
            manager_name=request.manager_name,
        )
        return ReportResponse(
            success=True,
            summary=ReportSummary(**summary),
            html=html,
        )
    except Exception:
        raise internal_error("Error generating report")


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


@router.post("/review-document", response_class=HTMLResponse)
async def review_document(
    request: ReviewDocumentRequest,
    dataset: UploadedDataset = Depends(current_session),
):
    """The printable review packet for the selected staff, as HTML."""
    try:
        html = DocumentService.build_document(
            people=dataset.build_audit_tree(request.staff_names),
            audit_label=request.audit_label,
            manager_name=request.manager_name,
            highlighted=set(request.flagged),
        )
        return HTMLResponse(content=html)
    except Exception:
        raise internal_error("Error building document")


@router.post("/export")
async def export_filtered_data(
    request: ExportRequest,
    dataset: UploadedDataset = Depends(current_session),
):
    """The selected staff's rows as CSV, with department and audit date added."""
    try:
        df = dataset.get_data_by_staff_ids(request.staff_ids)

        if len(df) == 0:
            raise HTTPException(
                status_code=400,
                detail="No data found for the provided staff IDs"
            )

        csv_bytes, filename = ExportService.create_export(
            df=df,
            department=request.department,
            audit_date=request.audit_date,
        )

        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )

    except HTTPException:
        raise
    except Exception:
        raise internal_error("Error creating export")


# ---------------------------------------------------------------------------
# Session and health
# ---------------------------------------------------------------------------


@router.delete("/session")
async def end_session(x_session_id: Optional[str] = Header(None)):
    """Forget the caller's session now ("Start a new audit")."""
    sessions.end(x_session_id)
    return {"success": True}


@router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": API_TITLE,
        "version": API_VERSION,
    }
