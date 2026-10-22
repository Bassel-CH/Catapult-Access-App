# Docker in this repo

How the app is built and run in containers, for development and production,
and the Docker ideas the setup relies on. Deployment requirements for a real
host are in `deploy/README.md`.

## Two setups

| | Development | Production |
|---|---|---|
| Start it | `docker compose up -d` | `docker compose -f docker-compose.prod.yml up -d --build` |
| Files | `docker-compose.yml` + `docker-compose.override.yml` | `docker-compose.prod.yml` only |
| Containers | two: backend, and a Vite dev server | one: nginx and the backend together |
| Built from | `backend/Dockerfile`, plus a stock Node image | the root `Dockerfile` |
| Code | your working copy, mounted in; edits apply live | copied into the image at build time |
| Address | http://localhost:5173 (API on :8000) | http://127.0.0.1:8080, behind an HTTPS proxy |

`docker compose up` with no `-f` reads `docker-compose.yml` and then
`docker-compose.override.yml` automatically. That's why the dev setup is two
files: the first says which services exist, the second adds the live-editing
details. Production deliberately doesn't build on them: `docker-compose.prod.yml`
stands alone and has its own project name (`audit-prod`), so starting or
cleaning up production never touches the dev containers.

## Development, in detail

**Backend.** Built from `backend/Dockerfile`, then changed by the override:
- Only `backend/app/` is mounted over the copy in the image. Mounting all of
  `backend/` would hide the packages installed in the image.
- It runs as user `1000:1000`, your WSL user, so files it touches stay yours.
- `uvicorn --reload` restarts the backend whenever you save a file. Because
  sessions live in memory, that also ends any audit in progress; re-upload the
  same file to restore it.
- `ENABLE_API_DOCS=true` turns on the interactive API docs at
  http://localhost:8000/docs.

**Frontend.** A plain `node:22-alpine` container that installs packages and
starts Vite, the dev server with live reload:
- The repo's `frontend/` folder is mounted at `/app`.
- A second, unnamed volume at `/app/node_modules` stops that mount from hiding
  the packages installed inside the container (and keeps your Windows-side
  folder free of Linux-built packages).
- It runs as root, unlike the backend. Docker creates that `node_modules`
  volume owned by root, so npm running as 1000 couldn't write to it. This is
  only the dev server; production runs as a non-root user.
- `VITE_PROXY_TARGET=http://backend:8000` tells Vite's proxy (in
  `frontend/vite.config.ts`) where to send `/api` calls. Inside compose,
  `backend` is the backend container's name on the shared network. If you run
  `npm run dev` outside Docker, it's unset and the proxy uses
  `http://localhost:8000`.

**The network.** Both containers join one network named `audit-net`, where each
can reach the other by its service name.

## Production, in detail

The root `Dockerfile` builds one image in three stages. Each stage starts
fresh, and only what's explicitly copied out of one reaches the next, so the
final image has none of the build tools.

1. **`frontend-build`** (Node): installs packages and runs `npm run build`,
   which type-checks and then compiles the app. A type error fails the build.
   Only the compiled `dist/` folder leaves this stage.
2. **`backend-deps`** (Python): installs the pinned packages, plus
   `supervisor`, into a self-contained folder (a virtual environment). Only
   that folder leaves this stage.
3. **`runtime`** (Python): adds Debian's nginx package, the backend code, the
   compiled frontend and the configs in `deploy/`.

At run time `supervisord` starts nginx and uvicorn and watches both. nginx
serves the app on 8080 and passes `/api/` to uvicorn on 127.0.0.1:8000 inside
the container. If either process stops, a small listener
(`deploy/stop_container_on_crash.py`) stops supervisord, the container exits,
and the restart policy brings up a fresh one.

Everything runs as `appuser` (uid 10001), which owns none of the code or
config, so the running app can't change them. It can only write to `/tmp`, for
pid files and a socket. That's also why it listens on 8080: a non-root process
can't use ports below 1024.

The health check asks nginx for `/api/health`, which nginx passes to uvicorn,
so one check covers both processes.

## Ideas this setup relies on

**Build context and `.dockerignore`.** `docker build` sends a folder (the build
context) to Docker, and the Dockerfile can only copy from it. `.dockerignore`
filters that folder first. Two rules here:
- Patterns are measured from the context folder: `temp/` means a `temp` folder
  at the top only; `**/temp/` means one at any depth. (`.gitignore` treats
  `temp/` as any depth, which is why the two are easy to confuse.)
- The root `.dockerignore` is an allowlist: it excludes everything, then lets
  back in only what the image needs, so a stray file (a real CSV, an `.env`)
  never reaches an image. Files inside an image can be read by anyone who can
  pull it, and deleting a file in a later step doesn't remove it from the
  earlier one.

**Layer caching.** Each Dockerfile step is saved as a layer, and a step is
reused (`CACHED` in the build output) when nothing it depends on has changed.
That's why the package list is copied and installed before the code: editing
code then reruns only the later steps, not the slow package install.

**Pinned base image.** `python:3.12-slim-trixie` names the Debian release
explicitly; the plain `python:3.12-slim` tag has moved between releases before,
and system libraries move with it.

**Users and numbers.** Linux identifies users by number, and a container shares
the host's numbering. `1000` is your WSL user; `10001` is `appuser`, created
inside the image. A process can only write where its number has write
permission, which is what the `ls -l` permission letters show: owner, group,
everyone else.

## Commands you'll use

```bash
docker compose up -d                      # start dev
docker compose down                       # stop dev
docker compose logs backend               # backend log (find error reference codes here)
docker compose restart backend            # restart the backend (ends sessions)
docker compose build backend              # rebuild the dev backend image

docker compose -f docker-compose.prod.yml up -d --build   # build and start prod
docker compose -f docker-compose.prod.yml down            # stop prod
docker exec audit-prod-app-1 supervisorctl status         # are nginx and uvicorn up?
docker run --rm audit-app:local id                        # run one command in the image
```
