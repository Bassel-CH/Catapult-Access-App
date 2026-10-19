# Deploying the production image

The root `Dockerfile` builds one image that runs nginx and the FastAPI backend
together under supervisord. nginx serves the app and passes `/api/` to the
backend inside the container. This folder holds that image's config.

| File | What it does |
|---|---|
| `nginx.conf` | Serves the built app, forwards `/api/` to uvicorn on 127.0.0.1:8000 |
| `supervisord.conf` | Starts nginx and uvicorn; stops the container if either dies |
| `stop_container_on_crash.py` | The supervisord listener that does the stopping |

`docker-compose.prod.yml` already satisfies everything below. Read this if you
deploy the image any other way (plain `docker run`, ECS, another orchestrator).

## What the container needs from whatever runs it

| Requirement | Why |
|---|---|
| **Exactly one running copy.** | User sessions live only in the backend's memory. A second copy (or a load balancer across two) sends users to a copy that doesn't have their data. See "Run exactly one backend instance" in the root README. |
| **Restart it whenever it exits.** | If nginx or uvicorn dies, the container exits on purpose so the platform starts a fresh one. The exit code can be 0 even then, so don't use a policy that only restarts on non-zero exit (e.g. Docker's `on-failure`). |
| **Port 8080, plain HTTP.** | The only port. The backend (8000) is not reachable from outside the container. TLS must be terminated in front (e.g. a load balancer). |
| **Health check: `GET /api/health` on 8080.** | Goes through nginx to the backend, so one check covers both. |
| **Allow ~15 s to stop.** | Each process gets up to 5 s to finish in-flight requests. |
| **Memory: 512 MB.** | Uploads and sessions are held in memory. Measured: ~90 MB idle, ~3.5 MB per session with a real export, ~40 MB per session holding a file at the 10 MB limit, plus up to ~90 MB while such a file is being uploaded. 512 MB covers five people with limit-sized files, two uploading at once. |

No environment variables or secrets are needed. Leave `ENABLE_API_DOCS` unset:
it turns on the backend's interactive API docs, which are for development. The image runs as a non-root
user (uid 10001) and logs everything to stdout/stderr.

Every restart ends all open sessions; users re-upload the same file and their
decisions come back if their tab is still open.

## Plain docker run

```bash
docker run -d --name audit-app -p 8080:8080 \
  --memory 512m \
  --restart unless-stopped --stop-timeout 15 \
  audit-app
```

## ECS task definition

Only the parts that matter for this image, in the container definition:

```json
{
  "name": "app",
  "image": "<registry>/audit-app:<tag>",
  "essential": true,
  "portMappings": [{ "containerPort": 8080, "protocol": "tcp" }],
  "memory": 512,
  "healthCheck": {
    "command": ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health').status==200 else 1)"],
    "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 15
  },
  "stopTimeout": 15
}
```

And on the ECS service: `desiredCount: 1`, with deployment `maximumPercent: 100`
and `minimumHealthyPercent: 0`. Without those, a deploy briefly runs the old and
new task side by side, which splits sessions. The trade-off is a short outage
during each deploy. A load balancer target group should point at port 8080 with
health check path `/api/health`.

Checked against the AWS docs (October 2026), not yet tested on a real ECS
cluster:

- **ECS ignores the image's own `HEALTHCHECK`** ("Amazon ECS doesn't monitor
  Docker health checks that are embedded in a container image"), which is why
  the task definition repeats it.
- `memory` is in MiB.
- The image needs no special mounts, so ECS on EC2 and on Fargate should both
  work. Neither has been tried.

## Debugging a running container

```bash
docker exec <container> supervisorctl status     # are nginx and uvicorn up?
docker logs <container>                          # nginx, uvicorn and supervisord, interleaved
docker run --rm audit-app python -V              # one-off command instead of the app
```

supervisord logs one `CRIT ... without any HTTP authentication` line at
startup. That's expected: the control socket is only usable by the app's own
user, which already runs everything in the container.
