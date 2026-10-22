"""
Sessions: each upload's data is private, and it goes away when ended or idle.

Synthetic data only. Run from backend/:  python -m tests.test_sessions
"""
import io

from fastapi.testclient import TestClient

from app.main import app
from app.services.uploaded_dataset import UploadedDataset
from app.services.session_service import SessionStore

HEADER = "StaffId,StaffName,StaffEmailAddress,DomainName,PermissionName,PositionName,PermissionSource\n"
CSV_A = HEADER + "1,Alice Only,a@x.com,EHR,Access,,Direct Assignment\n"
CSV_B = HEADER + "2,Bob Only,b@x.com,EHR,Access,,Direct Assignment\n"
NO_DATA = "No data loaded. Please upload a CSV first."


def _upload(client, text, name="t.csv"):
    r = client.post("/api/upload", files={"file": (name, io.BytesIO(text.encode()), "text/csv")})
    assert r.status_code == 200, r.text
    return r.json()["session_id"]


def _names(client, sid):
    r = client.get("/api/rows", headers={"X-Session-Id": sid} if sid else {})
    return r


def test_two_users_see_only_their_own_data():
    # Separate clients = separate browsers.
    a, b = TestClient(app), TestClient(app)
    sid_a = _upload(a, CSV_A)
    sid_b = _upload(b, CSV_B)
    assert sid_a != sid_b

    rows_a = _names(a, sid_a).json()["data"]
    rows_b = _names(b, sid_b).json()["data"]
    assert [r["StaffName"] for r in rows_a] == ["Alice Only"]
    assert [r["StaffName"] for r in rows_b] == ["Bob Only"]


def test_no_session_id_sees_nothing():
    c = TestClient(app)
    _upload(c, CSV_A)  # somebody uploaded...
    r = _names(TestClient(app), None)  # ...a different visitor with no id
    assert r.status_code == 400 and r.json()["detail"] == NO_DATA


def test_made_up_session_id_sees_nothing():
    c = TestClient(app)
    _upload(c, CSV_A)
    r = _names(c, "not-a-real-session")
    assert r.status_code == 400 and r.json()["detail"] == NO_DATA


def test_end_session_forgets_data():
    c = TestClient(app)
    sid = _upload(c, CSV_A)
    assert c.delete("/api/session", headers={"X-Session-Id": sid}).status_code == 200
    r = _names(c, sid)
    assert r.status_code == 400 and r.json()["detail"] == NO_DATA


def test_reupload_replaces_old_session():
    c = TestClient(app)
    old = _upload(c, CSV_A)
    r = c.post(
        "/api/upload",
        files={"file": ("t.csv", io.BytesIO(CSV_B.encode()), "text/csv")},
        headers={"X-Session-Id": old},
    )
    new = r.json()["session_id"]
    assert new != old
    assert _names(c, old).status_code == 400  # old one is gone
    assert [r["StaffName"] for r in _names(c, new).json()["data"]] == ["Bob Only"]


def test_failed_upload_keeps_existing_session():
    c = TestClient(app)
    sid = _upload(c, CSV_A)
    bad = c.post(
        "/api/upload",
        files={"file": ("t.csv", io.BytesIO(b"not,a,real,file\n"), "text/csv")},
        headers={"X-Session-Id": sid},
    )
    assert bad.status_code == 400
    assert _names(c, sid).status_code == 200  # still there


def test_idle_session_expires_and_activity_keeps_it_alive():
    now = [0.0]
    store = SessionStore(idle_seconds=60 * 60, clock=lambda: now[0])
    sid = store.create(UploadedDataset())

    now[0] = 59 * 60          # 59 min later: still alive, and this use resets the timer
    assert store.get(sid) is not None
    now[0] = 59 * 60 + 59 * 60  # another 59 min idle: still alive
    assert store.get(sid) is not None
    now[0] += 61 * 60         # 61 min idle: gone
    assert store.get(sid) is None
    assert store.count() == 0


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ALL CHECKS PASSED")
