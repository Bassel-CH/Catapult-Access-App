"""
Review packet highlights: the UI sends permission IDS, the packet must flag
exactly those rows — for that person only.

Uses a tiny synthetic CSV, so it runs without the real export.

Run from the backend/ folder:  python -m tests.test_review_document
"""
import io

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

CSV = (
    "StaffId,StaffName,StaffEmailAddress,DomainName,PermissionName,PositionName,PermissionSource\n"
    "1,Amber Weiss,a@x.com,EHR,Access,,Direct Assignment\n"
    "1,Amber Weiss,a@x.com,EHR,Open Charts,,Direct Assignment\n"
    "1,Amber Weiss,a@x.com,Billing,Access,Team Lead,Position-Based\n"
    "2,Brian Wishard,b@x.com,EHR,Access,,Direct Assignment\n"
)
NAMES = ["Amber Weiss", "Brian Wishard"]


def _upload():
    r = client.post(
        "/api/upload",
        files={"file": ("synthetic.csv", io.BytesIO(CSV.encode("cp1252")), "text/csv")},
    )
    assert r.status_code == 200, r.text
    client.headers["X-Session-Id"] = r.json()["session_id"]


def _perm_id(people, person, domain, name, group_key="direct"):
    p = next(p for p in people if p["staff_name"] == person)
    for g in p["groups"]:
        if g["key"] != group_key:
            continue
        for a in g["apps"]:
            for perm in a["permissions"]:
                if a["domain"] == domain and perm["name"] == name:
                    return perm["id"]
    raise AssertionError(f"no {group_key} {domain}/{name} for {person}")


def _packet(flagged):
    r = client.post("/api/review-document", json={"staff_names": NAMES, "flagged": flagged})
    assert r.status_code == 200, r.text
    # Split into one chunk per person so we can check who got flagged.
    sections = r.text.split('<section class="person">')[1:]
    return dict(zip(NAMES, sections))


def test_flag_by_id_marks_only_that_persons_row():
    _upload()
    people = client.post("/api/audit-tree", json={"staff_names": NAMES}).json()["people"]
    amber_access = _perm_id(people, "Amber Weiss", "EHR", "Access")

    packet = _packet([amber_access])

    # Amber's EHR Access row is flagged...
    assert packet["Amber Weiss"].count("row flagged") == 1
    # ...but Brian, who ALSO has EHR Access directly, is not.
    assert "row flagged" not in packet["Brian Wishard"]


def test_no_highlights_means_no_flags():
    _upload()
    packet = _packet([])
    assert all("row flagged" not in s for s in packet.values())


def test_position_highlight_does_not_misflag_a_direct_row():
    _upload()
    people = client.post("/api/audit-tree", json={"staff_names": NAMES}).json()["people"]
    pos_access = _perm_id(people, "Amber Weiss", "Billing", "Access", group_key="position")

    packet = _packet([pos_access])
    # The packet only has tick-boxes for direct grants; a position-based
    # highlight must not light up some other row by accident.
    assert all("row flagged" not in s for s in packet.values())


if __name__ == "__main__":
    test_flag_by_id_marks_only_that_persons_row()
    test_no_highlights_means_no_flags()
    test_position_highlight_does_not_misflag_a_direct_row()
    print("ALL CHECKS PASSED")
