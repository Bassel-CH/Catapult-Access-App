"""
CSV export is built in memory and returned directly — nothing written to disk.

Run from the backend/ folder:  python -m tests.test_export
"""
import io

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

CSV = (
    "StaffId,StaffName,StaffEmailAddress,DomainName,PermissionName,PositionName,PermissionSource\n"
    "1,Amber Weiss,a@x.com,EHR,Access,,Direct Assignment\n"
    "2,Brian Wishard,b@x.com,EHR,Access,,Direct Assignment\n"
)


def test_export_returns_csv_for_selected_ids_only():
    r = client.post(
        "/api/upload",
        files={"file": ("synthetic.csv", io.BytesIO(CSV.encode("cp1252")), "text/csv")},
    )
    assert r.status_code == 200, r.text
    client.headers["X-Session-Id"] = r.json()["session_id"]

    r = client.post("/api/export", json={
        "staff_ids": ["1"],
        "department": 'Patient "Support"/Ops - July 2026',
        "audit_date": "2026-07-28",
    })
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    # Quotes and slashes from the department name never reach the header.
    assert 'filename="Audit_Patient_Support_Ops_-_July_2026_' in r.headers["content-disposition"]

    lines = r.text.strip().splitlines()
    assert lines[0].endswith(",Department,AuditDate")
    assert len(lines) == 2 and "Amber Weiss" in lines[1] and "Brian" not in r.text
    assert lines[1].endswith(',"Patient ""Support""/Ops - July 2026",2026-07-28')


if __name__ == "__main__":
    test_export_returns_csv_for_selected_ids_only()
    print("ALL CHECKS PASSED")
