"""
Unexpected errors must not leak internals to the browser, but must be logged
under a reference code the user can report.

Synthetic data only. Run from backend/:  python -m tests.test_errors
"""
import io
import logging
import re

from fastapi.testclient import TestClient

from app.api import routes
from app.main import app
from app.services.report_service import ReportService

SECRET = "/srv/backend/secret_internal_path.py line 42"
CSV = (
    "StaffId,StaffName,StaffEmailAddress,DomainName,PermissionName,PositionName,PermissionSource\n"
    "1,Amber Weiss,a@x.com,EHR,Access,,Direct Assignment\n"
)


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


def _boom(*a, **k):
    raise RuntimeError(SECRET)


def _with_log_capture(fn):
    cap = _Capture()
    log = logging.getLogger("audit.api")
    log.addHandler(cap)
    try:
        return fn(), cap.records
    finally:
        log.removeHandler(cap)


def test_route_error_is_generic_with_reference_and_logged():
    c = TestClient(app)
    r = c.post("/api/upload", files={"file": ("t.csv", io.BytesIO(CSV.encode()), "text/csv")})
    c.headers["X-Session-Id"] = r.json()["session_id"]

    original = ReportService.render
    ReportService.render = staticmethod(_boom)
    try:
        r, records = _with_log_capture(
            lambda: c.post("/api/report", json={"staff_names": ["Amber Weiss"]})
        )
    finally:
        ReportService.render = original

    assert r.status_code == 500
    detail = r.json()["detail"]
    assert SECRET not in r.text
    m = re.fullmatch(r"Error generating report\. Reference: ([0-9a-f]{6})", detail)
    assert m, detail
    # The same reference is in the server log, with the real exception.
    logged = [rec for rec in records if m.group(1) in rec.getMessage()]
    assert logged and SECRET in str(logged[0].exc_info[1])


def test_uncaught_error_is_generic_with_reference_and_logged():
    c = TestClient(app, raise_server_exceptions=False)
    original = routes.sessions.get
    routes.sessions.get = _boom  # blows up inside the dependency, outside any try
    try:
        r, records = _with_log_capture(lambda: c.post("/api/filter", json={}))
    finally:
        routes.sessions.get = original

    assert r.status_code == 500
    assert SECRET not in r.text
    m = re.fullmatch(r"Internal server error\. Reference: ([0-9a-f]{6})", r.json()["detail"])
    assert m, r.json()
    assert any(m.group(1) in rec.getMessage() for rec in records)


def test_expected_errors_keep_their_helpful_message():
    c = TestClient(app)
    r = c.post("/api/filter", json={})
    assert r.status_code == 400
    assert r.json()["detail"] == "No data loaded. Please upload a CSV first."


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ALL CHECKS PASSED")
