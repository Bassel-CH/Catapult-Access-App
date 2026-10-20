"""
Compares the live backend with the original prototype (prototype/option1-ui.html).

Not to be confused with parity/compare_backend_to_reference.py, which checks
the backend's audit rules against an independent rewrite instead.

Runs one identical set of selections + Keep/Revoke decisions through:

  * the LIVE backend  (/api/upload -> /api/audit-tree -> /api/report)
  * the PROTOTYPE     (its own parseCSV/groupUser, via tools/run_prototype_logic.js)

and asserts the five headline counts match. The recipe is expressed in terms
both sides can understand — person name, domain, permission name — because the
two systems assign different permission ids (backend md5 vs prototype
"L|uid|gi|ai|xi"), so decisions cannot be compared by id.

Usage:
    # terminal 1
    cd backend && python -m uvicorn app.main:app
    # terminal 2
    python tools/compare_backend_to_prototype.py [path/to/report.csv]

Requires: httpx (already in backend/requirements.txt) and node on PATH.
Exits non-zero if the counts diverge.
"""
import json
import subprocess
import sys
from pathlib import Path

import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
BASE = "http://127.0.0.1:8000"
KEYS = ["users_reviewed", "total_permissions", "kept", "revoked", "no_decision"]


def build_recipe(csv_path: Path) -> dict:
    """
    A deterministic decision recipe, stated in canonical terms:
      - revoke "Access" in every other domain the selection touches (this is
        what exercises the cascade — each revoke drags its siblings with it)
      - keep every permission whose name starts with "Read"
      - leave everything else undecided
    """
    df = pd.read_csv(csv_path, encoding="cp1252")
    df = df[df.PermissionSource.isin(["Position-Based", "Direct Assignment"])]

    # The prototype groups people by StaffId, the backend by StaffName. Parity
    # only holds while that mapping is 1:1 — check it rather than assume it.
    multi_id = df.groupby("StaffName").StaffId.nunique()
    multi_name = df.groupby("StaffId").StaffName.nunique()
    warnings = []
    if (multi_id > 1).any():
        warnings.append(f"StaffNames with >1 StaffId: {multi_id[multi_id > 1].to_dict()}")
    if (multi_name > 1).any():
        warnings.append(f"StaffIds with >1 StaffName: {multi_name[multi_name > 1].to_dict()}")

    # Prefer people who actually have Direct Assignments — the reviewable set.
    selected = sorted(df[df.PermissionSource == "Direct Assignment"].StaffName.unique())[:8]
    # Plus anyone whose name contains a non-ASCII character, which is where the
    # cp1252-vs-UTF-8 difference between the two implementations shows up.
    selected += [n for n in df.StaffName.unique() if any(ord(c) > 127 for c in str(n))][:1]
    selected = sorted(set(selected))

    domains = sorted(df[df.StaffName.isin(selected)].DomainName.unique())
    return {
        "selected": selected,
        "revoke_access_domains": domains[::2],
        "keep_prefix": "Read",
        "warnings": warnings,
    }


def backend_summary(c: httpx.Client, names: list[str], recipe: dict) -> dict:
    """Send the recipe as raw decisions and let /api/report be the authority."""
    tree = c.post("/api/audit-tree", json={"staff_names": names}).json()
    revoke_domains = set(recipe["revoke_access_domains"])
    decisions = {}
    for person in tree["people"]:
        for group in person["groups"]:
            for app in group["apps"]:
                for perm in app["permissions"]:
                    if perm["name"].strip().lower() == "access" and app["domain"] in revoke_domains:
                        decisions[perm["id"]] = {"decision": "revoke", "note": ""}
                    elif perm["name"].startswith(recipe["keep_prefix"]):
                        decisions[perm["id"]] = {"decision": "keep", "note": ""}
    # NOTE: no cascade applied here on purpose. The backend applies it in
    # report_service.py; that is the whole point of it being authoritative.
    r = c.post("/api/report", json={
        "staff_names": names,
        "department": "Parity Check",
        "period_label": "Parity",
        "manager_name": "compare_backend_to_prototype.py",
        "decisions": decisions,
        "highlights": {},
    })
    r.raise_for_status()
    return r.json()["summary"]


def main() -> int:
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "JulyPermissions.csv"
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}")
        return 2

    recipe = build_recipe(csv_path)
    for w in recipe["warnings"]:
        print(f"WARNING (parity precondition): {w}")

    recipe_path = ROOT / "tools" / ".parity-recipe.json"
    proto_out = ROOT / "tools" / ".parity-prototype.json"
    recipe_path.write_text(json.dumps(recipe, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"CSV      : {csv_path.name}")
    print(f"selection: {len(recipe['selected'])} people")

    # ── prototype side ──────────────────────────────────────────────────────
    subprocess.run(
        ["node", str(ROOT / "tools" / "run_prototype_logic.js"),
         str(csv_path), str(recipe_path), str(proto_out)],
        check=True,
    )
    proto = json.loads(proto_out.read_text(encoding="utf-8"))
    print(f"prototype ingest: {proto['ingest']['rows_parsed']} rows, "
          f"{proto['ingest']['users']} users, "
          f"phantom users {proto['ingest']['phantom_users'] or '(none)'}")

    # ── backend side ────────────────────────────────────────────────────────
    # trust_env=False: ignore any proxy env vars, which must not apply to loopback.
    with httpx.Client(trust_env=False, base_url=BASE, timeout=120) as c:
        try:
            c.get("/api/health").raise_for_status()
        except Exception as e:
            print(f"backend not reachable at {BASE} — start uvicorn first ({e})")
            return 2
        up = c.post("/api/upload", files={
            "file": (csv_path.name, csv_path.read_bytes(), "text/csv"),
        })
        up.raise_for_status()
        # Every later call must carry this upload's session id.
        c.headers["X-Session-Id"] = up.json()["session_id"]

        full = backend_summary(c, recipe["selected"], recipe)
        print("backend  (full selection):", json.dumps(full))

        # Compare only the people the prototype could actually match, so a
        # divergence in *counting* isn't masked by a divergence in *ingest*.
        comparable = proto["matched"]
        sub = backend_summary(c, comparable, recipe) if comparable != recipe["selected"] else full

    print("prototype (matched only) :", json.dumps(proto["summary"]))
    print("backend   (matched only) :", json.dumps(sub))

    ok = all(proto["summary"][k] == sub[k] for k in KEYS)
    for k in KEYS:
        if proto["summary"][k] != sub[k]:
            print(f"  MISMATCH {k}: prototype={proto['summary'][k]} backend={sub[k]}")
    if proto["missing"]:
        print(f"  NOTE: the prototype could not match {proto['missing']} — "
              f"those people are missing from its audit entirely. Backend delta: "
              f"{ {k: full[k] - sub[k] for k in KEYS} }")

    reconciles = full["kept"] + full["revoked"] + full["no_decision"] == full["total_permissions"]
    print(f"backend counts reconcile: {reconciles}")
    print("PARITY:", "PASS" if ok and reconciles else "FAIL")
    return 0 if (ok and reconciles) else 1


if __name__ == "__main__":
    sys.exit(main())
