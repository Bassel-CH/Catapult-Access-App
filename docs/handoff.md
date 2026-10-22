# Handoff: Catapult Applications Audit v1.0.0

For whoever deploys and runs the app. Everything a host needs is in this
note and the files it points to; the source repository will follow
separately.

## What it is

An internal tool for the monthly department access audit. IT uploads the
staff permissions export, a manager marks each permission Keep or Revoke, and
the app produces the completed audit report. It keeps nothing on disk: each
upload lives in memory for that user's session only.

## What you're getting

| File | What it is |
|---|---|
| `catapult-applications-audit-v1.0.0.tar.gz` | The production image, `audit-app:v1.0.0` |
| `catapult-applications-audit-v1.0.0.tar.gz.sha256` | Its checksum |
| `HANDOFF.md` | This note |
| `deploy-README.md` | Full host requirements, with ECS and VM detail |
| `host-nginx.conf.example` | Reference HTTPS proxy config for a VM |
| `decisions.md` | Why it's built the way it is |
| `phase-two.md` | What was deliberately left out |

The image is built for **linux/amd64** (Intel or AMD hosts). It won't run on
ARM hosts such as AWS Graviton.

## Load it

```bash
sha256sum -c catapult-applications-audit-v1.0.0.tar.gz.sha256
docker load -i catapult-applications-audit-v1.0.0.tar.gz     # loads audit-app:v1.0.0
```

## Run it

One container: nginx and the backend together, plain HTTP on port 8080.

```bash
docker run -d --name audit-app -p 127.0.0.1:8080:8080 \
  --memory 1g --memory-swap 1g \
  --restart unless-stopped --stop-timeout 15 \
  audit-app:v1.0.0
```

Then check it:

```bash
curl http://127.0.0.1:8080/api/health          # {"status":"healthy",...}
docker exec audit-app supervisorctl status     # nginx and uvicorn RUNNING
```

No environment variables, secrets or volumes are needed. It runs as a
non-root user (uid 10001) and logs to stdout and stderr. For ECS, the task
definition settings are in `deploy-README.md`.

## What the host must provide

These are enforced outside the container, so they're yours:

| Requirement | Why |
|---|---|
| **HTTPS in front.** A load balancer, or nginx on the VM (`host-nginx.conf.example`). | The container only speaks plain HTTP. |
| **Only that front proxy can reach port 8080.** Loopback bind on a VM (as above), security group on AWS. | The container trusts the scheme and host the front proxy reports. |
| **Restrict who can reach the app at all**, for example VPN only. | **There is no login yet** (phase two). Anyone who can reach it can use it. |
| **Exactly one running copy.** On ECS: desired count 1, maximum 100%, minimum healthy 0%. | Sessions live in one process's memory. |
| **1 GB memory, no swap.** | Uploads are held in memory; swap would write them to disk. |
| **Always restart it when it exits**, not only on failure. | It exits on purpose, sometimes with code 0, if nginx or the backend stops. |
| **Health check `GET /api/health` on 8080.** Allow about 15 seconds to stop. | One check covers both processes. |
| **If the VM proxy uses the reference config, keep its three upload settings.** | A stock nginx refuses uploads over 1 MB and writes larger ones to disk. |

Any restart or redeploy ends every open session. Users re-upload the same file
and their work comes back, if their browser tab is still open.

## Not yet verified

- Not yet run behind a real AWS load balancer or on a real VM; it was tested
  locally behind nginx with a self-signed certificate.
- The load balancer header behaviour it relies on is listed as unverified in
  `deploy-README.md`, with what to check.

## What's next

`phase-two.md` lists what was left out on purpose: sign-in, a record of who
finalized each audit, visitor addresses, the hosting choice, and the
single-instance limit. Questions about the app go to Bassel Kharwat.
