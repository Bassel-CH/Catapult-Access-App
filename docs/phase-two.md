# Left for phase two

Phase one made the app a single, host-portable production container that keeps
no data on disk. These were left out on purpose. Each says where it plugs in.

## Sign-in and access control

The app has no login. Anyone who can reach the HTTPS front proxy can use it.

Access control belongs at the front proxy, where HTTPS ends, not in the
container:

- **VM:** the marked "Phase two" block in `deploy/host-nginx.conf.example`.
- **AWS:** load balancer listener rules, which can require sign-in. No file in
  this repo owns those; they live in the AWS account.

## A record of who finalized each audit

Nothing records who generated a report or when; the only copy is the HTML the
user downloads. A HITRUST review will likely expect one. It pulls against "no
data kept", so the lightest version is probably one log line per finalized
report: the signed-in user, the time and the headline counts, no staff data.
It needs sign-in first, to have a user to record.

## Visitor addresses

The container deliberately discards `X-Forwarded-For`, so the app never sees a
visitor's address (on a VM behind the VPN it would only be a VPN pool address
anyway). If phase two needs it next to the signed-in user, trust the front
proxy for it then: nginx's real-IP module in `deploy/nginx.conf`.

## Hosting: ECS or Proxmox

Still undecided. Both are written up in `deploy/README.md`. The AWS load
balancer behaviour we rely on is listed there as unverified, and neither host
has been tried for real.

## One backend instance

Sessions live in one process's memory, so production runs exactly one
container, a restart ends every open session, and uploads are processed one at
a time. Lifting that means a shared session store, which would then hold staff
data and need its own HITRUST review. See "Run exactly one backend instance" in
the root README.
