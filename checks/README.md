# Comparison checks

Two checks that run the real `JulyPermissions.csv` through the backend and
through something else, and require the audit counts to match. They test
different things; passing one says nothing about the other.

Both need the backend's packages installed (`backend/requirements.txt`) and
`node` on PATH. Run them from the repo root.

## Backend vs. the original prototype

```bash
python checks/compare_backend_to_prototype.py      # the backend must be running
```

Runs one set of selections and Keep/Revoke decisions through the live backend
and through the original prototype's own logic, lifted unchanged from
`prototype/option1-ui.html` by `run_prototype_logic.js`. Proves the rebuild
counts the same way the prototype did, apart from the deliberate cascade
difference below.

## Backend vs. an independent reference implementation

```bash
python checks/compare_backend_to_reference.py
```

Runs four fixed decision scenarios (`keep_all`, `keep_access_revoke_rest`,
`revoke_all_access`, `revoke_all_direct`) through the backend's own code and
through `reference_runner.mjs`, a separate Node implementation of the agreed
audit rules that imports no backend code. Exits 0 when the kept / revoked /
no-decision / total counts match, 1 with a table when they don't.

Junk export rows (the dashes divider, the `(N rows affected)` footer) are
checked separately in `backend/tests/test_audit_workflow.py`, not here.

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
