"""
/api/report accepts only "keep", "revoke" or null as a decision.

Synthetic data only. Run from backend/:  python -m tests.test_decision_validation
"""
import io

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

CSV = (
    "StaffId,StaffName,StaffEmailAddress,DomainName,PermissionName,PositionName,PermissionSource\n"
    "1,Amber Weiss,a@x.com,EHR,Access,,Direct Assignment\n"
)


def _report(decision):
    r = client.post("/api/upload", files={"file": ("t.csv", io.BytesIO(CSV.encode()), "text/csv")})
    client.headers["X-Session-Id"] = r.json()["session_id"]
    tree = client.post("/api/audit-tree", json={"staff_names": ["Amber Weiss"]}).json()["people"]
    pid = tree[0]["groups"][0]["apps"][0]["permissions"][0]["id"]
    return client.post("/api/report", json={
        "staff_names": ["Amber Weiss"],
        "decisions": {pid: {"decision": decision, "note": ""}},
    })


def test_valid_values_are_counted():
    assert _report("keep").json()["summary"]["kept"] == 1
    assert _report("revoke").json()["summary"]["revoked"] == 1
    assert _report(None).json()["summary"]["no_decision"] == 1


def test_invalid_values_are_rejected_not_counted_as_no_decision():
    for bad in ["Keep", "REVOKE", "yes", "", "revoked"]:
        r = _report(bad)
        assert r.status_code == 422, (bad, r.status_code)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ALL CHECKS PASSED")
