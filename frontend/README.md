# Catapult Applications Audit — Frontend

React + TypeScript + Vite + Tailwind v4. Three steps: IT setup, manager
audit, report. It always talks to the real backend.

## Run

From the repo root, `docker compose up -d` starts the backend and this app's
Vite dev server together (see the root README). Open http://localhost:5173.

`npm run build` type-checks (`tsc -b`) and produces a production build in
`dist/`; the production image runs that build inside the root `Dockerfile`.

## How it's wired

Everything that talks to the backend goes through **`src/services/api.ts`**.
Calls are relative `/api/...` paths: the Vite dev proxy forwards them to the
backend in dev, nginx does in prod.

```
src/
  types/api.ts            mirror of the FastAPI Pydantic schemas
  services/api.ts         the one place that calls the backend
  state/AuditContext.tsx  workflow state (step, selection, highlights, decisions)
  lib/
    cascade.ts            the Access-cascade business rule
    apiErrors.ts          turning a failed response into a message
    download.ts           saving and opening files
    format.ts             month names
  components/
    it-setup/             the IT setup step, one file per piece:
      ItSetup.tsx           the step itself, plus Export CSV and the hand-off
      UploadPanel.tsx       upload, and the confirm before replacing an audit
      DefineAuditPanel.tsx  department, month, manager
      SelectStaffPanel.tsx  the staff list, search and position filter
      StaffCard.tsx         one staff member, with their highlight tree
      HighlightTree.tsx     highlighting permissions, with notes
      PermissionSearch.tsx  who holds a permission, and how
    ManagerAudit.tsx      Keep/Revoke tree, bulk actions, cascade lock, rollups
    Report.tsx            report summary, open/download the report and packet
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
- The frontend never generates permission ids; it only echoes back what
  `/api/audit-tree` gave it.
