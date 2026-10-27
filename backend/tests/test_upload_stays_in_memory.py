"""
An upload at the size limit must never be written to a temp file on disk.

Synthetic data only. Run from backend/:  python -m tests.test_upload_stays_in_memory
"""
import io
import tempfile

from fastapi.testclient import TestClient

from app.config import MAX_UPLOAD_SIZE
from app.main import app

HEADER = "StaffId,StaffName,StaffEmailAddress,DomainName,PermissionName,PositionName,PermissionSource\n"
ROW = "1,Jordan Lee,a@x.com,EHR,Access,,Direct Assignment\n"


def test_upload_near_the_limit_stays_in_memory():
    body = (HEADER + ROW * ((MAX_UPLOAD_SIZE - 64 * 1024) // len(ROW))).encode()

    # rollover() is the moment a SpooledTemporaryFile moves to a real file.
    went_to_disk = []
    original = tempfile.SpooledTemporaryFile.rollover

    def spy(self):
        went_to_disk.append(True)
        return original(self)

    tempfile.SpooledTemporaryFile.rollover = spy
    try:
        r = TestClient(app).post(
            "/api/upload", files={"file": ("t.csv", io.BytesIO(body), "text/csv")}
        )
    finally:
        tempfile.SpooledTemporaryFile.rollover = original

    assert r.status_code == 200, r.text
    assert not went_to_disk, f"a {len(body) // 1024} KB upload was written to disk"


if __name__ == "__main__":
    test_upload_near_the_limit_stays_in_memory()
    print("ALL CHECKS PASSED")
