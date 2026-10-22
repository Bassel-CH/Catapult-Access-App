"""
Compares the backend's audit rules with an independent reference implementation.

Not to be confused with checks/compare_backend_to_prototype.py, which checks the
live backend against the original prototype instead.

Runs identical decision scenarios through BOTH:
  - an independent reference implementation of the agreed audit rules
    (checks/reference_runner.mjs, via node), and
  - the real backend (app.services), the same code the React app calls,
over the real JulyPermissions.csv, and asserts the kept/revoked/no-decision
totals match.

The Access rule is checked as decided ("Path A" in docs/decisions.md), which
differs on purpose from the original prototype.

Run from the repo root:  python checks/compare_backend_to_reference.py
Exit code 0 = parity holds; 1 = mismatch (details printed).
"""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CSV = REPO / "JulyPermissions.csv"
BACKEND = REPO / "backend"

sys.path.insert(0, str(BACKEND))
from app.services.uploaded_dataset import UploadedDataset  # noqa: E402
from app.services.report_service import ReportService      # noqa: E402


def is_access(name: str) -> bool:
    return name.strip().lower() == "access"


# Same four scenarios as reference_runner.mjs, same logic.
SCENARIOS = {
    "keep_all": lambda leaf: "keep",
    "keep_access_revoke_rest": lambda leaf: "keep" if is_access(leaf["name"]) else "revoke",
    "revoke_all_access": lambda leaf: "revoke" if is_access(leaf["name"]) else None,
    "revoke_all_direct": lambda leaf: "revoke" if leaf["source"] == "Direct Assignment" else None,
}


def backend_results() -> dict:
    import asyncio
    svc = UploadedDataset()
    asyncio.run(svc.process_upload(CSV.read_bytes(), CSV.name))
    names = sorted(svc.current_df["StaffName"].unique().tolist())
    people = svc.build_audit_tree(names)

    # flat list of leaves for building decision maps
    leaves = [
        perm
        for p in people
        for g in p["groups"]
        for a in g["apps"]
        for perm in a["permissions"]
    ]

    out = {}
    for name, rule in SCENARIOS.items():
        decisions = {}
        for leaf in leaves:
            d = rule(leaf)
            if d is not None:
                decisions[leaf["id"]] = {"decision": d, "note": ""}
        s = ReportService.summarize(people, decisions)
        out[name] = {
            "kept": s["kept"],
            "revoked": s["revoked"],
            "no_decision": s["no_decision"],
            "total": s["total_permissions"],
        }
    return out


def reference_results() -> dict:
    proc = subprocess.run(
        ["node", str(REPO / "checks" / "reference_runner.mjs"), str(CSV)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print("reference runner failed:\n", proc.stderr)
        sys.exit(2)
    return json.loads(proc.stdout)


def main() -> int:
    ref = reference_results()
    back = backend_results()

    cols = ["kept", "revoked", "no_decision", "total"]
    ok = True
    print(f"{'scenario':<26} {'metric':<12} {'reference':>10} {'backend':>10}  match")
    print("-" * 74)
    for scen in SCENARIOS:
        for c in cols:
            pv, bv = ref[scen][c], back[scen][c]
            match = pv == bv
            ok = ok and match
            flag = "ok" if match else "MISMATCH"
            print(f"{scen:<26} {c:<12} {pv:>10} {bv:>10}  {flag}")
        print("-" * 74)

    print("\nPARITY HOLDS ✓" if ok else "\nPARITY FAILED ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
