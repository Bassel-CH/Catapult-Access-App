"""
Upload checks: size limit, and the .csv name check.

Synthetic data only. Run from backend/:  python -m tests.test_upload_limits
"""
import io

from fastapi.testclient import TestClient

from app.api import routes
from app.main import app

client = TestClient(app)

CSV = (
    "StaffId,StaffName,StaffEmailAddress,DomainName,PermissionName,PositionName,PermissionSource\n"
    "1,Amber Weiss,a@x.com,EHR,Access,,Direct Assignment\n"
)


def _upload(name, data):
    return client.post("/api/upload", files={"file": (name, io.BytesIO(data), "text/csv")})


def test_file_over_limit_is_rejected_and_keeps_existing_session():
    ok = _upload("t.csv", CSV.encode())
    sid = ok.json()["session_id"]

    original = routes.MAX_UPLOAD_SIZE
    routes.MAX_UPLOAD_SIZE = len(CSV) - 1  # make the same file one byte too big
    try:
        r = client.post(
            "/api/upload",
            files={"file": ("t.csv", io.BytesIO(CSV.encode()), "text/csv")},
            headers={"X-Session-Id": sid},
        )
    finally:
        routes.MAX_UPLOAD_SIZE = original

    assert r.status_code == 413
    assert "too large" in r.json()["detail"]
    # The earlier upload is untouched.
    still = client.get("/api/rows", headers={"X-Session-Id": sid})
    assert still.status_code == 200


def test_file_exactly_at_limit_is_accepted():
    original = routes.MAX_UPLOAD_SIZE
    routes.MAX_UPLOAD_SIZE = len(CSV.encode())
    try:
        assert _upload("t.csv", CSV.encode()).status_code == 200
    finally:
        routes.MAX_UPLOAD_SIZE = original


def test_uppercase_extension_is_accepted():
    assert _upload("JulyPermissions.CSV", CSV.encode()).status_code == 200


def test_non_csv_name_is_rejected():
    r = _upload("notes.txt", CSV.encode())
    assert r.status_code == 400 and "must be a CSV" in r.json()["detail"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ALL CHECKS PASSED")
