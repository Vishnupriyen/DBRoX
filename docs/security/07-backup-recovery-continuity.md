# Backup, Recovery and Business Continuity Policy

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## Numbers
- **RPO 24 hours** (the nightly backup). Add a midday backup once there are paying distributors.
- **RTO 4 hours** (a new VPS, restore, DNS).

## Backups
- Nightly at 02:30 IST (`deploy/backup.sh`) and before every update: `pg_dump` → encrypted with `age` in a pipe (no
  plain file ever on disk) → 14 days kept on the server → copied to the GCS bucket in Mumbai.
- Each backup has a manifest: rows per table, sha256, size.
- Bucket: versioning on, objects locked 35 days, deleted after 35 days; the server's account can only create objects.
- `.env` encrypted the same way every Sunday (`deploy/backup-env.sh`).
- Caddy's certificate volume is not backed up (it renews itself).
- A failed backup or copy alerts the founder; the monitor alerts if the last good backup is older than 26 hours.

## Restore drill (monthly, and before go-live)
On the founder's laptop: `deploy/restore-drill.sh <file>.dump.age <file>.manifest <private key>` — checks the file,
decrypts into a throw-away Postgres, compares every table's rows with the manifest, prints the time taken. File the
output in the evidence folder.

## Losing the Hostinger machine
1. Buy a new KVM 2 (same plan), run `deploy/harden.sh`, install Docker, clone the repo.
2. Restore `.env` from the latest `env/*.age` with the private key; restore the latest database backup.
3. `deploy/pin-images.sh`, `deploy/deploy.sh --now`, `deploy/install-cron.sh`; point the DNS to the new IP.
4. Phones keep working offline the whole time; they sync when the server is back.
Honest note: one machine is a single point of failure. A second machine is planned when paying firms grow.
