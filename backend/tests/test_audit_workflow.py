"""
End-to-end verification of the Phase A audit workflow against the REAL CSV.

Run from the backend/ folder:  python -m tests.test_audit_workflow
(also works under pytest: it exposes test_* functions)

Drives the actual FastAPI app via TestClient: upload -> audit-tree -> report,
and checks the numbers are correct and internally consistent, including the
Access-cascade rule.
"""
import io
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# The real report lives at the project root (one level above backend/).
CSV_PATH = Path(__file__).resolve().parents[2] / "JulyPermissions.csv"


def _upload():
    data = CSV_PATH.read_bytes()
    r = client.post(
        "/api/upload",
        files={"file": ("JulyPermissions.csv", io.BytesIO(data), "text/csv")},
    )
    assert r.status_code == 200, r.text
    # Every later call must carry this upload's session id.
    client.headers["X-Session-Id"] = r.json()["session_id"]
    return r.json()


def test_upload_reads_real_file():
    up = _upload()
    assert up["success"] is True
    # 4163 + 798 = 4961 valid permission rows; junk (dashes divider,
    # null-source footer, etc.) is dropped.
    assert up["row_count"] == 4961, up["row_count"]
    assert up["rows_dropped"] >= 1
    assert up["source_breakdown"] == {"Position-Based": 4163, "Direct Assignment": 798}
    # breakdown must reconcile with the kept row count.
    assert sum(up["source_breakdown"].values()) == up["row_count"]
    print(f"[upload] rows={up['row_count']} dropped={up['rows_dropped']} "
          f"breakdown={up['source_breakdown']}")


def _staff_names():
    """Every staff name in the upload, sorted."""
    rows = client.get("/api/rows").json()["data"]
    return sorted({r["StaffName"] for r in rows if r["StaffName"]})


def _pick_names(up, n=3):
    """Pick the first few staff names."""
    return _staff_names()[:n]


def test_audit_tree_is_stable_and_shaped():
    up = _upload()
    names = _pick_names(up, 3)

    r1 = client.post("/api/audit-tree", json={"staff_names": names})
    r2 = client.post("/api/audit-tree", json={"staff_names": names})
    assert r1.status_code == 200, r1.text
    p1, p2 = r1.json()["people"], r2.json()["people"]

    # IDs must be identical across identical requests (stable fingerprints).
    ids1 = [perm["id"] for person in p1 for g in person["groups"]
            for a in g["apps"] for perm in a["permissions"]]
    ids2 = [perm["id"] for person in p2 for g in person["groups"]
            for a in g["apps"] for perm in a["permissions"]]
    assert ids1 == ids2 and len(ids1) > 0
    # IDs are unique within a build.
    assert len(ids1) == len(set(ids1)), "leaf ids collided!"

    # permission_count matches the leaves actually emitted for each person.
    for person in p1:
        leaves = sum(len(a["permissions"]) for g in person["groups"] for a in g["apps"])
        assert leaves == person["permission_count"], person["staff_name"]
    print(f"[tree] {len(p1)} people, {len(ids1)} leaves, ids stable & unique")


def test_report_counts_and_access_cascade():
    up = _upload()
    # Find a person + direct app that has an "Access" leaf AND siblings,
    # so the cascade has something to cascade onto.
    names = _staff_names()
    tree = client.post("/api/audit-tree", json={"staff_names": names[:50]}).json()["people"]

    target = None
    for person in tree:
        for g in person["groups"]:
            for a in g["apps"]:
                names_lower = [p["name"].strip().lower() for p in a["permissions"]]
                if "access" in names_lower and len(a["permissions"]) >= 2:
                    target = (person, g, a)
                    break
            if target: break
        if target: break
    assert target, "no app with Access + siblings found to test cascade"
    person, group, app_ = target

    access_leaf = next(p for p in app_["permissions"]
                       if p["name"].strip().lower() == "access")
    sibling_count = len(app_["permissions"]) - 1

    # Manager revokes ONLY the app's Access. Everything else left undecided.
    decisions = {access_leaf["id"]: {"decision": "revoke", "note": "app removed"}}
    highlights = {access_leaf["id"]: "confirm this app is no longer needed"}

    r = client.post("/api/report", json={
        "staff_names": [person["staff_name"]],
        "department": "Verification Dept",
        "period_label": "July 2026",
        "manager_name": "Test Manager",
        "decisions": decisions,
        "highlights": highlights,
    })
    assert r.status_code == 200, r.text
    out = r.json()
    summary = out["summary"]

    # Cascade: revoking Access should force the siblings in that app to revoke.
    # So revoked >= 1 (Access) + sibling_count.
    assert summary["revoked"] >= 1 + sibling_count, (summary, sibling_count)
    # Totals must reconcile exactly.
    assert (summary["kept"] + summary["revoked"] + summary["no_decision"]
            == summary["total_permissions"])
    # HTML report actually rendered.
    assert "<html" in out["html"] and "Verification Dept" in out["html"]

    print(f"[report] cascade OK: revoked={summary['revoked']} "
          f"(Access + {sibling_count} siblings), totals reconcile "
          f"({summary['kept']}+{summary['revoked']}+{summary['no_decision']}"
          f"={summary['total_permissions']})")

    # Save a sample report to eyeball.
    sample = Path(__file__).resolve().parent / "sample_report.html"
    sample.write_text(out["html"], encoding="utf-8")
    print(f"[report] sample written -> {sample}")


if __name__ == "__main__":
    test_upload_reads_real_file()
    test_audit_tree_is_stable_and_shaped()
    test_report_counts_and_access_cascade()
    print("\nALL CHECKS PASSED")
