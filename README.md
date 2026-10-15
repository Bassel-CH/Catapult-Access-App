# Catapult-Access-App

Monthly department access-audit tool. IT uploads the org-wide permissions export,
selects staff and highlights permissions of interest; a manager reviews each
person's access and marks every permission Keep or Revoke; the app produces a
completed, read-only audit report.

The **backend is the single source of truth** for audit results. The React app
keeps a local copy of the Access-cascade rule only for instant click feedback —
the authoritative counts and report always come from `/api/report`.

## Layout

| Path | What it is |
|---|---|
| `backend/` | FastAPI + pandas. Owns ingest, permission ids, decisions and the report. |
| `frontend/` | React + TS + Vite + Tailwind v4. Wired to the live backend. |
| `prototype/option1-ui.html` | Original single-file prototype. Visual/UX reference and parity target — **do not** copy its data logic. |
| `tools/parity_check.py` | Acceptance test: same decisions through backend and prototype, counts must match. |
| `PHASE-C-VALIDATION.md` | Validation results against the real export, plus the local runbook. |

## Run

```bash
# terminal 1
cd backend && pip install -r requirements.txt
python -m uvicorn app.main:app --reload        # http://localhost:8000  (docs at /docs)

# terminal 2
cd frontend && npm install
npm run dev                                    # http://localhost:5173
```

Backend tests: each file in `backend/tests/` runs on its own, e.g.
`cd backend && python -m tests.test_sessions`. All use small made-up data
except `test_audit_workflow`, which needs the real `JulyPermissions.csv`.
Parity check (backend must be running): `python tools/parity_check.py`

See `frontend/README.md` for how the app is wired (the `services/api.ts` seam,
the dev proxy, mock mode) and `PHASE-C-VALIDATION.md` for what's been verified.

## Backend package versions

`backend/requirements.txt` lists the exact version of every package the backend
uses, including the ones other packages pull in, so every build installs the
same thing. Don't hand-edit it to loosen versions.

To upgrade on purpose:

1. Change the version you want in `backend/requirements.txt`.
2. `docker compose build backend`, then run the backend tests.
3. Save the full resulting set back to the file:
   `docker run --rm audit-backend pip freeze > backend/requirements.txt`
4. Confirm the image matches the file (prints nothing but the message):
   `docker run --rm audit-backend pip freeze | diff - backend/requirements.txt && echo "IMAGE MATCHES PINS"`

## Real exports are never committed

`*.csv` is gitignored. `JulyPermissions.csv` at the repo root is the local test
file; it's cp1252-encoded and the backend decodes it — never re-encode it
client-side.
