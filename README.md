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
| `Dockerfile`, `deploy/` | Production image: nginx + backend in one container. **Read `deploy/README.md` before deploying.** |
| `tools/parity_check.py` | Acceptance test: same decisions through backend and prototype, counts must match. |
| `PHASE-C-VALIDATION.md` | Validation results against the real export, plus the local runbook. |

## Run

```bash
# terminal 1
cd backend && pip install -r requirements.txt
ENABLE_API_DOCS=true python -m uvicorn app.main:app --reload   # http://localhost:8000  (docs at /docs)

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

## Run exactly one backend instance

Uploaded data lives only in the backend's memory: one private session per
upload, deleted after 60 idle minutes. This is deliberate. Nothing is written
to disk or to a database.

What follows from that:

- Restarting or redeploying the backend ends every open session. Users see
  "Session expired" and re-upload the same file; if their browser tab is still
  open, their selections and decisions come back.
- In production, nginx and the backend share one container, and the container
  exits if either one stops. So an nginx crash also ends every open session,
  not just a backend crash. (nginx holds no session data itself; it is the
  restart that loses them.)
- Don't run more than one backend instance (for example behind a load
  balancer). A user's requests could reach an instance that doesn't hold their
  session.
- One backend process also means uploads are processed one at a time: while
  one CSV is being parsed, other requests wait. A file near the 10 MB limit
  takes about a quarter of a second. That's a design consequence of this rule,
  not a tuning setting. More backend processes would remove it, but only once
  sessions no longer live in one process's memory.

To lift this, sessions would have to move to a shared store every instance can
reach (Redis, for example), keeping the same 60-minute expiry. The code change
is confined to `backend/app/services/session_service.py`. Staff data would then
sit in that store too, which needs its own HITRUST review.

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

One package isn't in that file: `supervisor`, which only the production image
uses to run nginx and the backend together. It's pinned in the root
`Dockerfile` (`supervisor==4.3.0`) and has no dependencies of its own, so that
one version is all there is. To upgrade it, change it there and rebuild.

## Real exports are never committed

`*.csv` is gitignored. `JulyPermissions.csv` at the repo root is the local test
file; it's cp1252-encoded and the backend decodes it — never re-encode it
client-side.
