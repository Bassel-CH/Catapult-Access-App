# Decisions

The deliberate choices behind the app: what was decided, why, and where it's
enforced. Before changing any of these, read the reason. Several exist for
HITRUST, and some only hold because something else in the repo holds too.

## Data handling

### No staff data is ever written to disk
Uploads, sessions, reports and exports hold real permission data, so they stay
in memory from start to finish.
- **Uploads:** Starlette normally moves uploads over 1 MB to a temp file; its
  threshold is raised above the upload limit, and the app refuses to start if
  a Starlette upgrade removes that setting. `backend/app/main.py`, checked by
  `backend/tests/test_upload_stays_in_memory.py`.
- **nginx:** request bodies are buffered in memory and responses are never
  spilled to a temp file. `deploy/nginx.conf`, and the same three settings in
  `deploy/host-nginx.conf.example`.
- **Exports:** built in memory and sent straight back.
  `backend/app/services/export_service.py`.
- **Swap is off** for the container, so memory can't be paged to the host's
  disk. `docker-compose.prod.yml`.

### One private session per upload, in memory, 60 minutes idle
Each upload is visible only to the browser that sent it, and is forgotten on
"Start a new audit", on re-upload, or after 60 idle minutes. Chosen over a
database because nothing needs to outlive an audit.
`backend/app/services/session_service.py`.

**Consequence:** exactly one backend instance. A restart or redeploy ends every
open session, a second instance couldn't see the first one's sessions, and
uploads are processed one at a time. Lifting it means a shared session store,
which would then hold staff data and need its own review. See "Run exactly one
backend instance" in the root `README.md`.

### Exported cells can't run as spreadsheet formulas
Excel runs a cell starting with `= + - @` as a formula. Values come from the
source system and from the department box, so those cells are prefixed with
`'`. `export_service.py`, `backend/tests/test_export.py`.

## Audit rules

### The backend is the record
The screen applies the Access rule as you click, for instant feedback, but the
report's counts come only from the backend, which applies the rule again
itself. `backend/app/services/report_service.py`.

### Access cascade stays within one group ("Path A")
Revoking an app's Access revokes the rest of that app **within the same group**
only. A direct grant and access through a position are separate: they're
removed in different ways, and revoking one shouldn't mark the other as gone
while the person still has it. This differs on purpose from the original
prototype, which swept across both. `report_service.py` and
`frontend/src/lib/cascade.ts`, kept in step by the checks in `checks/`.

### Permission ids are worked out from the data
An id is a fingerprint of staff member, source, position, app, permission name
and a counter for exact duplicates, so the same file always produces the same
ids. That's what lets an audit be restored after a restart by re-uploading the
same file. `_leaf_id` in `backend/app/services/uploaded_dataset.py`.

### Staff are identified by name
The export can hold related profiles for one person (for example "Jordan Lee"
and "Jordan LeeTL"), which the audit treats as separate. Grouping is by
`StaffName`, except the CSV export, which selects by `StaffId`.

## Reading the export

- **UTF-8 first, then Windows-1252.** Windows-1252 accepts almost any byte, so
  trying it first would garble UTF-8 files. Excel's "CSV UTF-8" marker is
  handled too.
- **Every column is read as text**, so an id like `00123` stays `00123`.
- **The text `NULL` reads as blank.** The export writes it for direct
  assignments' position, and the app relies on it being empty.

All in `uploaded_dataset.py`, checked by `backend/tests/test_csv_reading.py`.

## Production

### One container: nginx and the backend together
Infra asked for a single deployable artifact, and in-memory sessions already
pin us to one backend instance, so separate containers bought nothing. nginx
serves the app and passes `/api/` to uvicorn inside the container. If either
stops, the whole container exits and the platform restarts it, which ends every
session. Root `Dockerfile`, `deploy/supervisord.conf`.

### HTTPS always ends in front of the container
The container serves plain HTTP on 8080 in every deployment. An AWS load
balancer, or nginx on the VM, terminates HTTPS in front of it, so the
container's config is the same everywhere. `deploy/README.md`,
`deploy/host-nginx.conf.example`.

**This rests on a control outside the repo:** only the front proxy may reach
port 8080 (the loopback bind on a VM, the security group on AWS). The container
trusts the scheme and host the front proxy reports, so anything else that could
reach 8080 could lie about them.

### Visitor addresses are discarded
The container replaces `X-Forwarded-For` with the address it sees, which is the
front proxy's. Nothing reads visitor addresses today, and on a VM behind the
VPN it would only be a pool address. Revisit with sign-in in phase two.
`deploy/nginx.conf`.

### Upload limits: 10 MB in the app, 11 MB in nginx
The app's limit gives a clear message; nginx's is just above it, allowing for
form overhead, so the app gives the answer for anything near the limit and
nginx only stops much larger files. `backend/app/config.py`, `deploy/nginx.conf`.

### 1 GB reserved, no swap
What a host must set aside, not what the app was seen using (about 300 MB at
the highest). Running out would end every session mid-audit, and a gigabyte
costs nothing. `docker-compose.prod.yml`, `deploy/README.md`.

### API docs off in production
`/docs` only appears when `ENABLE_API_DOCS=true`, which the dev stack sets.
`backend/app/main.py`.

## Code and dependencies

- **API calls are relative** (`/api/...`), with no backend address anywhere in
  the frontend, so one image works on any host and the backend needs no CORS
  settings. `frontend/src/services/api.ts`.
- **Errors never reach the browser in detail.** Unexpected errors return a
  message and a reference code; the details go to the server log.
  `internal_error` in `backend/app/api/routes.py`.
- **Every backend package is pinned** to an exact version, including the ones
  other packages pull in. `backend/requirements.txt`; `supervisor` is pinned in
  the root `Dockerfile`. The upgrade steps are in the root `README.md`.
- **The production image is tagged with the commit it was built from.**
  `docker-compose.prod.yml`, `.env.example`.
