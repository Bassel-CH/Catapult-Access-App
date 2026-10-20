# Catapult Access App — Frontend

React + TypeScript + Vite + Tailwind v4. Three-phase audit UI (IT setup →
manager audit → report), **wired to the live FastAPI backend** as of Phase C.

## Run

The backend must be running first — the app has no local data source in live mode.

```bash
# terminal 1
cd backend && python -m uvicorn app.main:app --reload   # http://localhost:8000

# terminal 2
cd frontend
npm install
npm run dev        # http://localhost:5173
```

`npm run build` type-checks (`tsc -b`) and produces a production build in `dist/`.

To go back to mock data (no backend needed), set `VITE_USE_MOCKS=true` in
`frontend/.env.local` and restart the dev server.

## How it's wired

The whole app talks to one seam: **`src/services/api.ts`**, which resolves to
either the real fetch client or the in-browser mock (`src/mocks/`) based on
`VITE_USE_MOCKS`. Live calls are relative `/api/...` paths: the Vite dev proxy
forwards them to the backend in dev, nginx does in prod.

```
src/
  types/api.ts          exact mirror of the FastAPI Pydantic schemas
  services/api.ts        the seam: mock now, real fetch client ready for later
  mocks/
    fixtures.ts          deterministic synthetic dataset (14 staff)
    mockApi.ts           upload / filter / audit-tree / report / review-document / export
  state/AuditContext.tsx workflow state (phase, selection, highlights, decisions)
  lib/
    cascade.ts           selectors + the Access-cascade business rule
    format.ts, download.ts
  components/
    ItSetup.tsx          upload, define audit, select users + highlight
    ManagerAudit.tsx     Keep/Revoke tree, bulk actions, cascade lock, rollups
    Report.tsx           report summary + open/download HTML
```

## Networking (Phase C)

1. **One address, no CORS.** The browser only ever talks to the address the
   page came from, and the proxy in front (Vite in dev, nginx in prod) forwards
   `/api` to the backend. The backend has no CORS settings, so a page served
   from any other address can't call it.

2. **`staff_ids` vs `staff_names`.** `/api/export` identifies people by
   **StaffId**; every other endpoint uses **StaffName**. The UI already tracks
   both per selected person (`UserSummary.staffIds`), so this is handled — just
   be aware of it when reading the code.

3. **Lost-session recovery.** The backend keeps the uploaded CSV in memory, so
   restarting uvicorn mid-audit makes every call fail with
   `400 "No data loaded"`. `isSessionLost()` in `services/api.ts` detects exactly
   that case; the store then parks the manager's decisions, returns to the IT setup step
   with a re-upload prompt, and restores the parked work when the *same* file
   (same name + same row count) is uploaded again. This is only safe because
   permission ids are a deterministic md5 of the row's own fields — the same
   file always regenerates the same ids. Verified against a real restart.

## Notes on fidelity to the real contract

- `PermissionSource` uses the backend's exact values `"Position-Based"` /
  `"Direct Assignment"` (the old standalone prototype used different strings).
- The mock's permission `id`s are stable within a session but are **not** the
  same hash the backend produces (djb2 vs md5). Decisions/highlights map
  correctly regardless, since both phases read the same tree. In live mode the
  frontend never *generates* an id — it only echoes back what `/api/audit-tree`
  gave it.
- **Never compare counts against the mock.** The mock has its own report
  renderer that can drift from `report_service.py`. Truth is the backend.
- The "Load sample data" button is mock-only: it posts a zero-byte file, which
  the real backend correctly rejects. It's hidden when `VITE_USE_MOCKS=false`.
- `/api/review` (untyped in the docs) is superseded by the fully-typed
  `/api/audit-tree`, so the UI uses audit-tree and skips `/review`.
