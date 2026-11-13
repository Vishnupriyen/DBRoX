# Logging and Monitoring Policy

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## What is logged (security_log)
Logins (right, wrong, locked), sign-ups, PIN changes, log-out-everywhere, staff added/changed/removed/locked, every
control-panel call and wrong admin key, every cron run and wrong cron key, support access granted/used/refused, archive
downloads, refused cross-firm requests, company links, Razorpay webhooks, AI scans, privacy choices, exports, requests,
erasures, breaches, deploys. Each row: time, firm, actor (an opaque id), role, event, target, IP, ok, short facts.
**Never** PINs, tokens, phone numbers, passwords or document bodies (a test checks this).

## Protection
Rows are added only through one database function, in a hash chain. The app's database role cannot change or delete
them; a trigger refuses it for everyone. `deploy/verify-log.sh` walks the chain every night and copies the last hash off
the machine.

## Retention
12 months online, then each month is exported, checked and kept 5 years in the archive. Caddy access logs and job logs:
90 days. Docker logs: 20 MB × 10 files per container.

## Who reviews, how often
| What | Who | When |
|---|---|---|
| Alerts (monitor, security watch) | founder | as they arrive |
| Access review (logins, admin and support use) | founder | monthly, signed |
| Chain check result | automatic; founder on failure | nightly |
| Dependency and secret scans | Security & Operations | weekly |
