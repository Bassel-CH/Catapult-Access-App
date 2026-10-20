# Phase C — wiring + real-world validation

All numbers below came from the **live FastAPI server over real HTTP** (uvicorn
on loopback, real multipart uploads of `JulyPermissions.csv`), not from the mock
and not from `TestClient`.

## 1. Networking is on

| Change | File |
|---|---|
| Dev proxy `/api` → `http://localhost:8000` enabled | `frontend/vite.config.ts` |
| `VITE_USE_MOCKS=false`, `VITE_API_BASE_URL=` (empty) | `frontend/.env.local` (new, gitignored) |
| `BASE` defaults to `''` so calls are same-origin `/api/...` | `frontend/src/services/api.ts` |

Empty base URL is the load-bearing part: the browser only ever makes same-origin
requests, so the backend's `CORS_ORIGINS` (`:3000/:3001`, not `:5173`) never
comes into play and there is no preflight. Setting `VITE_API_BASE_URL` to an
absolute URL bypasses the proxy and *would* need `:5173` added to `CORS_ORIGINS`
— documented in both `.env.local` and `vite.config.ts` so it can't surprise you
later. Proxy option names verified against the installed Vite (8.2.0) type
definitions, not from memory.

## 2. Real CSV — first time the uploaded bytes have mattered

```
POST /api/upload             200      26 ms   response     9,292 B
   row_count 4961 · rows_dropped 2 · {'Position-Based': 4163, 'Direct Assignment': 798}
   188 staff · 22 domains · 105 permissions · 12 positions
POST /api/filter {}          200      21 ms   response 1,238,897 B   4961/4961 rows
POST /api/audit-tree (188)   200     397 ms   response   781,076 B
   4961 leaves · 4961 unique ids · 0 collisions · leaves == kept rows ✓
   sources in tree: ['Direct Assignment', 'Position-Based'] (exactly the two expected)
POST /api/report (9 people)  200      38 ms   report html 136,211 B
```

**cp1252 confirmed, with evidence.** The file has exactly 83 non-ASCII bytes and
every one is `0xE9` — the `é` in `Jené Butler`. Decoded as cp1252 (what the
backend does) that name is correct; decoded as UTF-8 it becomes
`Jen� Butler`. This turns out to matter — see §5.

**Junk-row drop confirmed.** The 2 dropped rows are the `-------` divider and the
`(4961 rows affected)` footer, removed by the `PermissionSource` whitelist rather
than by hardcoding.

**Performance verdict: leave it alone.** `uploadFile` fetches the whole dataset
*and* an audit tree for all 188 staff before you've selected anyone — worth
checking, but measured it's ~450 ms and ~2 MB total on loopback. Lazy-loading
trees per selected person would add real complexity (Phase 1 highlighting needs
the tree on card expand) for no felt gain. Revisit only if the export grows
several-fold or this ever runs over a WAN.

## 3. Error paths — fired for real, not just written

| Case | Result |
|---|---|
| `notes.txt` (not a CSV) | 400 `File must be a CSV (.csv extension)` |
| `photo.csv` (JPEG bytes, .csv name) | 400 `Missing required columns: …` (all 7) |
| CSV missing 4 required columns | 400 `Missing required columns: StaffEmailAddress, PermissionSource, PermissionName, PositionName` |
| 0-byte file | 400 `CSV file is empty` |
| Header row only | 400 `No permission rows found in this file — it has the right columns but no data rows.` |
| Only junk rows | 400 `No permission rows found in this file — all 2 row(s) were export noise…` |
| Any call before upload | 400 `No data loaded. Please upload a CSV first.` |
| UTF-8 CSV with accents | 200 — **correction (Oct 2026):** the 200 hid garbled names (`Jené` → `JenÃ©`) because cp1252 was tried first and never fails. Fixed by trying UTF-8 first; see `backend/tests/test_csv_reading.py`. |

No stack traces in any response body (asserted, not eyeballed).

**One gap found and closed.** The last two rows above used to return **200 with
`row_count: 0`** — the app would happily open an audit over an empty dataset and
produce a report attesting to nothing. For a compliance tool a silent no-op is
worse than a hard failure, so `csv_service.process_upload` now rejects a file
that yields zero usable rows. It's a single guard clause, easy to revert if you
disagree. A failed upload also leaves any previously loaded dataset intact —
`current_df` is only assigned after validation passes.

## 4. Lost-session recovery (new)

`isSessionLost()` in `services/api.ts` matches the specific pair — HTTP 400 plus
`"no data loaded"` — rather than string-matching a generic `Error.message`.
Failures now flow through one place (`fail()` in `AuditContext`), which routes
that one case to `SESSION_LOST` and everything else to a plain error message.

It **parks the manager's work** instead of discarding it. On session loss the
store keeps the decisions, highlights and selection, sends the user to Phase 1
with a re-upload prompt, and restores them when the *same* file (same name +
same row count) is uploaded again. That's only sound because permission ids are
a deterministic md5 of the row's own fields, so the same file regenerates
identical ids — **verified**: re-uploading the same bytes produced a byte-identical
set of 4,961 ids.

Proven end-to-end against a real restart:

```
upload 4961 rows -> audit-tree 279 leaves -> manager makes 25 decisions
  [uvicorn killed and restarted]
POST /api/report  -> 400 "No data loaded. Please upload a CSV first."
                     isSessionLost() fires: True
re-upload same file -> ids identical: True
POST /api/report  -> 200  kept=25  (all 25 parked decisions survived)
```

If the *wrong* file is uploaded, `sameFile` is false and the parked work is
dropped rather than mis-applied. Any stale id that did survive would simply be
absent from the new tree and ignored by `/api/report`.

## 5. Parity check — PASS, with one finding that matters

Re-runnable: `python tools/compare_backend_to_prototype.py` (new). It lifts `parseCSV` and
`groupUser` **verbatim** out of `prototype/option1-ui.html` and runs them in
Node, so it tests the prototype's real logic rather than a re-implementation of
it. Both sides get the same recipe stated in canonical terms (person, domain,
permission name) because the two systems assign different ids. The prototype
side replays its click-time Access cascade; the backend side sends **raw**
decisions and lets `/api/report` apply the cascade — as designed.

9 people, 533 permissions, 148 raw decisions (the cascade turns those into 229
effective ones, so it's genuinely exercised):

```
prototype (8 matched people): users 8 · total 450 · kept 53 · revoked 176 · none 221
backend   (8 matched people): users 8 · total 450 · kept 53 · revoked 176 · none 221
IDENTICAL on all five counts ✓   backend counts reconcile ✓
```

Three divergences in **ingest**, none in counting:

1. **The prototype silently drops `Jené Butler` from the audit.** It reads the
   file with `FileReader.readAsText()`, i.e. as UTF-8, so the cp1252 `é` becomes
   `�` and the name no longer matches. 83 permissions and one whole person
   vanish from a compliance audit with no warning. The backend gets it right.
   This is the single strongest argument for the backend owning ingest.
2. **The prototype invents two users** — `-------` and `(4961 rows affected)` —
   because it only filters fully-blank rows, not by `PermissionSource`. It reports
   4963 rows / 190 users where the backend reports 4961 / 188.
3. Cosmetic ordering: the backend puts Direct assignment **first** and sorts
   permissions alphabetically; the prototype puts it last and keeps CSV order.

The parity precondition — `StaffName` ↔ `StaffId` being 1:1, since the prototype
groups by id and the backend by name — holds in this export (188 ↔ 188, checked
both directions). `compare_backend_to_prototype.py` re-checks it every run and warns if a future
month breaks it. That's the assumption most likely to bite you later.

## 6. What I could not verify here, and why

My sandbox is a separate Linux box from your machine, so `frontend/node_modules`
(installed on Windows: only `@rolldown/binding-win32-x64-msvc` is present) can't
run `vite build` or `vite dev` here. `tsc -b --force` passes clean. Everything
browser-side — the proxy actually forwarding, the banners rendering, the restore
path through the UI — is the runbook below.

---

# Runbook — confirm on your machine

Two terminals, from the repo root.

```powershell
# terminal 1 — backend
cd backend
python -m uvicorn app.main:app --reload      # http://localhost:8000

# terminal 2 — frontend
cd frontend
npm run dev                                  # http://localhost:5173
```

Footer should read **"Connected to the live API"**. If it says "Running on mock
data", `.env.local` didn't load — restart `npm run dev` (Vite only reads env at
startup).

1. **Happy path.** Upload `JulyPermissions.csv`. Expect `4961 rows · 188 users
   loaded · 2 junk rows dropped` and pills `Position-Based: 4163` /
   `Direct Assignment: 798`. Search `Jené` — the accent must render correctly;
   if you see `Jen?` or `Jen<?>`, the bytes got re-encoded somewhere client-side.
   First load takes ~0.5 s and moves ~2 MB; anything much slower means the proxy
   isn't being used.
2. **Full flow.** Type a department, select ~5 people, highlight a couple of
   permissions, lock, Keep/Revoke some, revoke an app's `Access` (siblings should
   grey out and lock), finalize. The Phase 3 cards come from `/api/report` and
   are authoritative — check the browser Network tab shows `/api/report` returning
   200 and that kept + revoked + no-decision equals the total.
3. **Error paths.** Drag in a `.txt`, then a CSV with a column deleted, then an
   empty file. Each should show a red banner with the backend's own sentence and
   no stack trace. The "Load sample data" button should be **absent** in live mode.
4. **Lost session — the one to actually try.** Mid-audit (Phase 2, some decisions
   made), Ctrl-C the backend and restart it. Click **Finalize**. You should land
   back on Phase 1 with an amber "Session expired" banner and a note that your
   decisions are being held. Re-upload the same file: a blue "Audit restored"
   banner appears, your selection is back, and Phase 2 still shows your decisions.
   Re-uploading a *different* file must clear them instead.
5. **Parity, on your data.** With the backend running:
   `python tools/compare_backend_to_prototype.py` → expect `PARITY: PASS`. Run it against next
   month's export too; it warns if the StaffName↔StaffId assumption breaks.
6. **Production build.** `cd frontend && npm run build` (couldn't run here — see
   §6).
