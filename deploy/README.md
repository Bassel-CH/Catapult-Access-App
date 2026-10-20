# Deploying the production image

The root `Dockerfile` builds one image that runs nginx and the FastAPI backend
together under supervisord. nginx serves the app and passes `/api/` to the
backend inside the container. This folder holds that image's config.

| File | What it does |
|---|---|
| `nginx.conf` | Serves the built app, forwards `/api/` to uvicorn on 127.0.0.1:8000 |
| `supervisord.conf` | Starts nginx and uvicorn; stops the container if either dies |
| `stop_container_on_crash.py` | The supervisord listener that does the stopping |
| `host-nginx.conf.example` | Reference config for the HTTPS proxy on a VM host. Runs outside the container. |

`docker-compose.prod.yml` already satisfies everything below. Read this if you
deploy the image any other way (plain `docker run`, ECS, another orchestrator).

## What the container needs from whatever runs it

| Requirement | Why |
|---|---|
| **Exactly one running copy.** | User sessions live only in the backend's memory. A second copy (or a load balancer across two) sends users to a copy that doesn't have their data. See "Run exactly one backend instance" in the root README. |
| **Restart it whenever it exits.** | If nginx or uvicorn dies, the container exits on purpose so the platform starts a fresh one. The exit code can be 0 even then, so don't use a policy that only restarts on non-zero exit (e.g. Docker's `on-failure`). |
| **Port 8080, plain HTTP, reachable only by the front proxy.** | The only port; the backend (8000) is not reachable from outside the container. The container never handles HTTPS. See "HTTPS is always the host's job" below — this is a hard requirement with a specific control for each host. |
| **Health check: `GET /api/health` on 8080.** | Goes through nginx to the backend, so one check covers both. |
| **Allow ~15 s to stop.** | Each process gets up to 5 s to finish in-flight requests. |
| **Reserve 1 GB of memory for the container, and no swap.** | This is what the host must set aside, not what the app was seen using. Uploads and sessions live only in memory, and running out of it kills the container mid-audit and loses every open session, while a gigabyte costs nothing on any host we'd use. So headroom is cheaper than precision here. The highest use seen was about 300 MB (one local test, with synthetic data; real-shaped data likely uses more). No swap, because swap would write that memory, including permission data, to the host's disk. `docker-compose.prod.yml` sets both. The host's nginx needs its own ~20 MB plus ~11 MB per upload in progress. |

No environment variables or secrets are needed. Leave `ENABLE_API_DOCS` unset:
it turns on the backend's interactive API docs, which are for development. The image runs as a non-root
user (uid 10001) and logs everything to stdout/stderr.

Every restart ends all open sessions; users re-upload the same file and their
decisions come back if their tab is still open.

## HTTPS is always the host's job

The container serves plain HTTP on 8080 and never terminates TLS, in any
deployment. Something in front of it always does: an AWS Application Load
Balancer, or nginx on the VM. The container's own config is the same either way.

### Required control: only the front proxy can reach port 8080

The container trusts the `X-Forwarded-Proto` and `X-Forwarded-Host` headers it
receives, because the front proxy sets them. Anyone who could reach 8080
directly could set them to anything. So this is a hard requirement, and it is
enforced outside this repo:

| Host | What enforces it | How to check |
|---|---|---|
| **VM** | The container's port is published on the host's loopback address only: `127.0.0.1:8080:8080` in `docker-compose.prod.yml`. Only processes on the VM, i.e. the host nginx, can connect. | On the VM: `ss -ltn \| grep 8080` shows `127.0.0.1:8080`, not `0.0.0.0:8080`. From another machine, `curl http://<vm>:8080/api/health` must fail to connect. |
| **AWS** | The security group on the task (or its EC2 instance) allows inbound 8080 only from the load balancer's security group. | In the security group's inbound rules, the only source for port 8080 is the ALB's security group, not a CIDR range. |

If the front proxy on a VM ever runs as a container instead of on the host, it
can't reach the host's `127.0.0.1`. Put it on the same compose network and
point it at `app:8080` instead; don't widen the published port.

### On a VM: nginx on the host

Use `host-nginx.conf.example`. It redirects port 80 to HTTPS, terminates TLS on
443 (certificate paths are placeholders), and sets the forwarded headers the
container expects, replacing anything the browser sent.

It also repeats three settings from the container's nginx. Without them, a
stock nginx refuses uploads over 1 MB, and writes upload bodies over about 16
KB to a temp file on the VM's disk:

| Setting | Direction | What it does |
|---|---|---|
| `client_max_body_size 11m` | Upload going in | Accepts uploads up to the app's 10 MB limit plus form overhead. |
| `client_body_buffer_size 11m` | Upload going in | Keeps the whole upload in memory instead of a temp file. |
| `proxy_max_temp_file_size 0` | Export coming back | nginx may not spill the response to a temp file. It keeps what fits in its small memory buffers and otherwise makes the container wait until the browser reads more. Fine at our export sizes; if this config is reused for much larger responses, a slow download holds the connection to the container open. |

Uploads and exports are both real permissions data, so both directions matter.

Checked locally (October 2026) with the official `nginx:stable` image standing
in for the host and a self-signed certificate: port 80 redirects to HTTPS; the
app receives `X-Forwarded-Proto: https` and the right host even when the
browser sends forged values; a 9.5 MB upload succeeds without touching disk. A
stock config refused the same upload, and one with only the size limit wrote it
to a temp file.

### On AWS: an Application Load Balancer

The ALB terminates HTTPS on 443 and redirects 80 to 443 (a listener rule). Its
target group points at the container's port 8080, with health check path
`/api/health`.

These are **assumptions, not verified** — check them against AWS's
documentation on HTTP headers for Application Load Balancers before relying
on them:

- The ALB sets `X-Forwarded-Proto` to the scheme the client used, replacing
  any value the client sent.
- The ALB does not send `X-Forwarded-Host`, so the container falls back to the
  `Host` header. If the ALB instead passes a client-sent `X-Forwarded-Host`
  through untouched, the app would receive it. Nothing reads it today.
- The ALB does not limit request body size in a way that blocks a 10 MB
  upload.

How the ALB builds `X-Forwarded-For` doesn't matter here: the container
discards it either way (below).

### Client addresses are not passed to the app

The container replaces `X-Forwarded-For` with the address it sees, which is
always the front proxy's. So the app never learns a visitor's address, on any
host. That's deliberate: nothing reads it today, and on a VM behind the VPN it
would only be a VPN pool address. If phase two needs it, trust the front proxy
for it then. nginx's real-IP module is not used.

### Phase two: where the access layer goes

Allowlists and sign-in go where HTTPS ends, not in the container:

- **VM:** the marked block in `host-nginx.conf.example`.
- **AWS:** ALB listener rules (which can require sign-in). No file in this repo
  owns those; they live in the AWS account. Phase two should start from that.

## Plain docker run

On a VM, behind the host nginx:

```bash
docker run -d --name audit-app -p 127.0.0.1:8080:8080 \
  --memory 1g --memory-swap 1g \
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
  "memory": 1024,
  "linuxParameters": { "maxSwap": 0 },
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
during each deploy. The load balancer setup, including the security group that
limits who can reach 8080, is under "On AWS" above.

Checked against the AWS docs (October 2026), not yet tested on a real ECS
cluster:

- **ECS ignores the image's own `HEALTHCHECK`** ("Amazon ECS doesn't monitor
  Docker health checks that are embedded in a container image"), which is why
  the task definition repeats it.
- `memory` is in MiB and is a hard limit.
- `maxSwap: 0` turns swap off for the container. Our understanding (not
  verified) is that leaving it out on EC2 makes the container follow the
  instance's own swap setting, so set it explicitly. Fargate has no swap.
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
