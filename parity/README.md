# Backend vs. an independent reference implementation

Proves the rebuilt app produces the **same audit numbers** as an independent
reference implementation, on the real `JulyPermissions.csv`.

There's a second, separate check: `tools/compare_backend_to_prototype.py`
compares the live backend with the original prototype instead. Passing one
says nothing about the other.

## Run

```bash
# from the repo root, with backend deps installed (backend/requirements.txt)
python parity/compare_backend_to_reference.py
```

Exit `0` = parity holds; `1` = a mismatch (printed as a table). Node must be on
PATH (the reference runner is JS).

## What it does

Runs four deterministic decision scenarios (`keep_all`,
`keep_access_revoke_rest`, `revoke_all_access`, `revoke_all_direct`) through
two independent implementations and compares kept / revoked / no-decision /
total:

- **`reference_runner.mjs`** — an independent Node implementation of the agreed
  audit rules. Same grouping as the original prototype, no backend code
  imported, so agreement is real cross-validation rather than a tautology.
- **`compare_backend_to_reference.py`** — drives the actual backend (`app.services`), the same
  code path the React app calls in production.

Both are fed the same valid rows (the two real `PermissionSource` values). The
backend additionally drops junk export rows (the dashes divider, the
`(N rows affected)` footer); that cleanup is verified separately in
`backend/tests/test_audit_workflow.py`, not here.

## Decision on record: cascade scope ("Path A")

An "Access" revocation cascades **only within its own `(person, group, app)`** —
i.e. revoking a *direct* grant to an app does NOT revoke access the person also
holds to that app through a *position*.

This is a **deliberate divergence** from `prototype/option1-ui.html`, whose
cascade swept the whole `(person, app)` across all sources. We chose the
narrower scope because it is more accurate for a compliance audit: direct grants
and position-inherited access are remediated differently, and a direct-grant
revocation should not silently mark inherited access as revoked when the person
still holds it via their role.

The rule is implemented in `backend/app/services/report_service.py`
(authoritative) and `frontend/src/lib/cascade.ts` (live UI feedback); this check
guards that both stay consistent with the agreed behavior.
