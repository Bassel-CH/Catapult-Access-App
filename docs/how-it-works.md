# How the app works

The Catapult Applications Audit, end to end, in the order a real audit happens.
Each section ends with where that part lives in the code.

## The three steps

1. **IT setup.** IT uploads the monthly permissions export, names the
   department and month, picks the staff to review, and can highlight
   permissions the manager should look at closely.
2. **Manager audit.** The manager goes through each selected staff member's
   access and marks every permission Keep or Revoke.
3. **Report.** The app produces the completed, read-only audit report, plus a
   printable review packet.

The step bar at the top of the page shows where you are. Decisions live only in
the browser tab until the report is generated.

*Code:* `frontend/src/components/it-setup/`, `ManagerAudit.tsx`, `Report.tsx`;
the step bar is `Stepper.tsx`; all the on-screen state is in
`frontend/src/state/AuditContext.tsx`.

## 1. Uploading the export

The export is a CSV with one row per permission a staff member holds: their
name, email, the app the permission belongs to, the permission's name, the
position it comes from (if any), and whether it was assigned directly or comes
from a position.

When it arrives, the backend:

- **Reads it as text.** It tries UTF-8 first and then Windows-1252, the
  encoding the monthly export uses. The order matters: Windows-1252 accepts
  almost anything, so trying it first would quietly garble UTF-8 files.
- **Drops junk rows.** The export ends with a `-----` divider and an
  `(N rows affected)` footer. Only rows whose source is exactly
  "Position-Based" or "Direct Assignment" are kept.
- **Rejects files it can't use**: the wrong columns, no real rows, over 10 MB,
  or not a `.csv`.
- **Starts a session** for this upload (next section).

The browser then asks for every row and builds the staff list from them, and
asks for every staff member's audit tree, so highlighting works straight away.

*Code:* `backend/app/services/uploaded_dataset.py` (`process_upload`), the
`/api/upload` and `/api/rows` routes in `backend/app/api/routes.py`, and
`uploadFile` in `AuditContext.tsx`.

## 2. Sessions: whose data is whose

Each upload gets its own private session: a long random id, and that upload's
data held in the backend's memory. The browser sends the id with every request,
and only ever sees its own data. Two people auditing at once can't see or
overwrite each other's work.

A session ends when the user clicks "Start a new audit", uploads another file,
or leaves it idle for 60 minutes. Nothing is ever written to disk.

If the backend restarts mid-audit, the session is gone and the next request
answers "No data loaded". The page recognises that, keeps the selection and
decisions it already has, and asks for the same file again. Re-uploading it
restores the audit, because permission ids are worked out from the data itself
(section 3), so the same file produces the same ids.

*Code:* `backend/app/services/session_service.py`, `current_session` in
`routes.py`, and `isSessionLost` in `frontend/src/services/api.ts`.

## 3. The audit tree

For each selected staff member the backend builds an **audit tree**: their
access grouped first by where it comes from, then by app.

```
Staff member
├── Direct assignment          ← reviewed one by one
│   ├── App A: permission, permission, …
│   └── App B: …
└── Position: Team Lead        ← one group per position held, for reference
    └── App A: …
```

Every permission in the tree has an **id**: a short fingerprint of the staff
member, source, position, app and permission name. The same row always gets
the same id. Every highlight and decision is stored against that id, which is
how the screen, the report and the review packet all agree about exactly which
permission is meant.

*Code:* `build_audit_tree` and `_leaf_id` in `uploaded_dataset.py`.

## 4. Highlights

In IT setup, IT can highlight any permission and add a note. Highlights follow
the permission into the manager audit, the report and the review packet. The
Permission search tab finds everyone who holds a permission, and shows whether
they have it directly or through a position.

*Code:* `HighlightTree.tsx` and `PermissionSearch.tsx` in
`frontend/src/components/it-setup/`.

## 5. Decisions and the Access rule

In the manager audit, each permission gets Keep or Revoke, and bulk buttons set
a whole app, group or person at once.

One rule applies automatically: **every app has an "Access" permission, and
revoking it revokes everything else in that app** for that staff member, within
the same group. A direct grant and a position-based grant to the same app are
separate groups, so revoking one doesn't touch the other. The screen locks the
other permissions so the manager can see the effect.

*Code:* `frontend/src/lib/cascade.ts` (instant feedback on screen) and
`report_service.py` (the authoritative version, below).

## 6. The report

"Finalize" sends the selected staff and every decision to the backend, which
applies the Access rule again itself and produces the completed report: counts
of kept, revoked and undecided permissions, then every staff member's access
with each decision, highlight and note.

The backend's version is the record. The screen's copy of the Access rule only
exists so clicks feel instant; the two checks in `checks/` confirm the backend
counts the way it should.

*Code:* `backend/app/services/report_service.py`, the `/api/report` route.

## 7. The review packet and the CSV export

- **Review packet:** a printable page per staff member, with Keep and Revoke
  tick-boxes for each direct assignment, highlights marked, and their
  position-based access listed for reference. It's built from the same audit
  tree. *Code:* `document_service.py`, `/api/review-document`.
- **CSV export:** the selected staff's rows from the original export, with the
  department and audit date added. Cells that would run as a spreadsheet
  formula are prefixed so Excel shows them as text. *Code:*
  `export_service.py`, `/api/export`.

## 8. When something goes wrong

Errors the app expects, like a wrong file or an expired session, come back with
a plain message. Anything unexpected comes back as a short message with a
reference code, such as `Reference: 7f3a9c`, and the full details go to the
server log under that code:

```bash
docker compose logs backend | grep 7f3a9c
```

*Code:* `internal_error` in `routes.py`, `frontend/src/lib/apiErrors.ts`.

## Where each part lives

| Part | Backend | Frontend |
|---|---|---|
| Upload, reading the CSV | `services/uploaded_dataset.py` | `it-setup/UploadPanel.tsx` |
| Sessions | `services/session_service.py` | `services/api.ts` |
| Audit tree and ids | `services/uploaded_dataset.py` | `state/AuditContext.tsx` |
| Highlights | — | `it-setup/HighlightTree.tsx`, `PermissionSearch.tsx` |
| Decisions, Access rule | `services/report_service.py` | `ManagerAudit.tsx`, `lib/cascade.ts` |
| Report | `services/report_service.py` | `Report.tsx` |
| Review packet | `services/document_service.py` | `Report.tsx` |
| CSV export | `services/export_service.py` | `it-setup/ItSetup.tsx` |
| All the API routes | `api/routes.py` | `services/api.ts` |

Backend paths are under `backend/app/`, frontend paths under
`frontend/src/components/` unless they start with `services/`, `state/` or
`lib/`, which are under `frontend/src/`.
