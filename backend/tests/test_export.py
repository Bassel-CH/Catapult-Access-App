"""
CSV export is built in memory and returned directly — nothing written to disk.

Run from the backend/ folder:  python -m tests.test_export
"""
import io

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

HEADER_ROW = "StaffId,StaffName,StaffEmailAddress,DomainName,PermissionName,PositionName,PermissionSource\n"
CSV = (
    HEADER_ROW +
    "1,Jordan Lee,a@x.com,EHR,Access,,Direct Assignment\n"
    "2,Sam Ortiz,b@x.com,EHR,Access,,Direct Assignment\n"
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
    assert len(lines) == 2 and "Jordan Lee" in lines[1] and "Sam Ortiz" not in r.text
    assert lines[1].endswith(',"Patient ""Support""/Ops - July 2026",2026-07-28')


def test_export_cells_cannot_run_as_spreadsheet_formulas():
    # A value from the source system, and one typed into the department box.
    risky = HEADER_ROW + '3,Cara Lane,c@x.com,EHR,"=HYPERLINK(""http://x"")",,Direct Assignment\n'
    r = client.post(
        "/api/upload",
        files={"file": ("synthetic.csv", io.BytesIO(risky.encode("cp1252")), "text/csv")},
    )
    client.headers["X-Session-Id"] = r.json()["session_id"]
    r = client.post("/api/export", json={"staff_ids": ["3"], "department": "@SUM(1)"})
    assert r.status_code == 200, r.text

    row = r.text.strip().splitlines()[1]
    assert ''''=HYPERLINK''' in row and ",'@SUM(1)," in row, row


if __name__ == "__main__":
    test_export_returns_csv_for_selected_ids_only()
    test_export_cells_cannot_run_as_spreadsheet_formulas()
    print("ALL CHECKS PASSED")
