# Network and Server Hardening Standard

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## The VPS (`deploy/harden.sh`, checked by `deploy/verify-harden.sh`)
- Firewall (ufw): 80 and 443 open; 22 only from the founder's IPs (`SSH_ALLOW_FROM`), else rate-limited; everything else closed.
- SSH: keys only, no passwords, root only with a key, 3 tries; fail2ban bans 5 wrong tries for an hour.
- Automatic security updates; Docker logs capped; `deploy/.env` readable by root only.
- Postgres is never published outside Docker (port 5432 closed).

## Docker (`deploy/docker-compose.yml`)
- No container gains privileges (`no-new-privileges`); the server and Caddy run read-only; Caddy drops all capabilities
  but binding ports; memory limits; health checks; the server runs as the `node` user.
- The server answers requests as the limited database role `hanubix_app` (no schema changes, activity log read-only).

## Caddy (`deploy/Caddyfile`)
- HTTPS only with HSTS; `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP;
  the `Server` header removed; request size capped at 13 MB.
- `/v1/admin/*` only from `ADMIN_ALLOW_IPS`; `/v1/cron/*` never from outside.
- **Trust proxy**: the server trusts exactly one hop (Caddy). If a CDN is ever added, change `trustProxy` first, or the
  per-place limits could be fooled by a made-up `X-Forwarded-For`.

## The server itself
Per-place and per-login request limits, small body limits on login and sign-up, wrong-key locks on admin and cron,
CORS limited to our web app and the Android app (`https://localhost`) in production.
