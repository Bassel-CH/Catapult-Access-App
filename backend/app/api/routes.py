"""
API routes/endpoints for the audit filter application
"""
from fastapi import APIRouter, UploadFile, File, HTTPException 
from fastapi.responses import FileResponse, HTMLResponse

from ..models.schemas import (
    UploadResponse,
    FilterRequest,
    FilterResponse,
    ReviewRequest,
    ReviewDocumentRequest,
    ExportRequest,
    AuditTreeRequest,
    AuditTreeResponse,
    GenerateReportRequest,
    ReportResponse,
    ReportSummary,
)
from ..services.csv_service import CSVService
from ..services.document_service import DocumentService
from ..services.export_service import ExportService
from ..services.report_service import ReportService
from ..utils.exceptions import (
    InvalidCSVError,
    NoDataLoadedError,
    FilterError,
    ExportError,
)

# Create router
router = APIRouter(prefix="/api", tags=["audit"])

# Create service instance (stores data in memory)
csv_service = CSVService()


@router.post("/upload", response_model=UploadResponse)
async def upload_csv(file: UploadFile = File(...)):
    """
    Upload audit CSV file for processing.

    Expected columns: StaffId, StaffName, StaffEmailAddress, DomainName,
    PermissionName, PositionName, PermissionSource.

    Junk rows (export dividers, "(N rows affected)" footers, blanks) are
    dropped automatically; rows_dropped reports how many were removed.
    """
    try:
        if not file.filename.endswith('.csv'):
            raise HTTPException(
                status_code=400,
                detail="File must be a CSV (.csv extension)"
            )

        content = await file.read()
        result = await csv_service.process_upload(content, file.filename)

        return UploadResponse(
            success=True,
            filename=file.filename,
            row_count=result["row_count"],
            rows_dropped=result["rows_dropped"],
            columns=result["columns"],
            preview=result["preview"],
            unique_values=result["unique_values"],
            source_breakdown=result["source_breakdown"],
        )

    except InvalidCSVError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing file: {str(e)}"
        )


@router.post("/filter", response_model=FilterResponse)
async def apply_filters(filters: FilterRequest):
    """
    Apply filters to the loaded dataset.

    Filter by staff_names, permissions, domains, positions,
    permission_sources, and/or search_text.
    """
    try:
        filter_dict = filters.model_dump(exclude_none=True)
        result = csv_service.apply_filters(filter_dict)

        return FilterResponse(
            success=True,
            data=result["data"],
            total_rows=result["total_rows"],
            filtered_rows=result["filtered_rows"],
        )

    except NoDataLoadedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FilterError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error applying filters: {str(e)}"
        )


@router.post("/review")
async def build_review(request: ReviewRequest):
    """
    Build a per-profile access review for the selected staff.

    For each selected name, returns their access split into Direct
    Assignment (reviewable, shown first) and Position-Based (reference).
    This is the data the printable review document is rendered from.
    """
    try:
        reviews = csv_service.build_review(request.staff_names)
        return {
            "success": True,
            "reviews": reviews,
        }
    except NoDataLoadedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error building review: {str(e)}"
        )


@router.post("/review-document", response_class=HTMLResponse)
async def review_document(request: ReviewDocumentRequest):
    """
    Generate the printable HTML access-review document for the selected
    staff. Returns HTML; open in a browser and Save as PDF.
    """
    try:
        reviews = csv_service.build_review(request.staff_names)
        html = DocumentService.build_document(
            reviews=reviews,
            audit_label=request.audit_label,
            manager_name=request.manager_name,
            flagged_by_person=csv_service.flagged_by_person(
                request.staff_names, request.flagged
            ),
        )
        return HTMLResponse(content=html)
    except NoDataLoadedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error building document: {str(e)}")

@router.post("/audit-tree", response_model=AuditTreeResponse)
async def audit_tree(request: AuditTreeRequest):
    """
    Build the reviewable access tree for the selected staff.

    Each person is split into a Direct-assignment group (reviewable) plus one
    group per Position they hold (reference). Every permission carries a stable
    `id` so the manager's Keep/Revoke decisions can be sent back reliably via
    /report.
    """
    try:
        people = csv_service.build_audit_tree(request.staff_names)
        return AuditTreeResponse(success=True, people=people)
    except NoDataLoadedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error building audit tree: {str(e)}"
        )


@router.post("/report", response_model=ReportResponse)
async def generate_report(request: GenerateReportRequest):
    """
    Generate the COMPLETED audit report from captured Keep/Revoke decisions.

    The Access-cascade rule is applied on the server, so the returned counts
    and HTML are the authoritative record of the review.
    """
    try:
        people = csv_service.build_audit_tree(request.staff_names)
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
    except NoDataLoadedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error generating report: {str(e)}"
        )


@router.post("/export")
async def export_filtered_data(request: ExportRequest):
    """
    Export data for selected staff with a department assignment.

    Requires staff_ids and a department name; audit_date defaults to today.
    Returns a CSV file for download.
    """
    try:
        df = csv_service.get_data_by_staff_ids(request.staff_ids)

        if len(df) == 0:
            raise HTTPException(
                status_code=400,
                detail="No data found for the provided staff IDs"
            )

        filepath = ExportService.create_export(
            df=df,
            department=request.department,
            audit_date=request.audit_date,
        )

        return FileResponse(
            path=filepath,
            media_type="text/csv",
            filename=filepath.name,
            headers={
                "Content-Disposition": f"attachment; filename={filepath.name}"
            }
        )

    except NoDataLoadedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ExportError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error creating export: {str(e)}"
        )


@router.get("/status")
async def get_status():
    """Get current data status."""
    summary = csv_service.get_current_data_summary()

    if summary is None:
        return {
            "has_data": False,
            "message": "No data loaded. Upload a CSV to begin."
        }

    return summary


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "Audit Filter API",
        "version": "1.0.0"
    }