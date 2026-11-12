# Running the Hanubix server (Hostinger KVM 2)

How updates happen without stopping any distributor. Phones work offline the whole time; the server is only where they meet.

## Once, when the server is bought
1. Install Docker on the machine, clone the repo, and create `deploy/.env`:
   ```
   DOMAIN=api.<our domain>
   DB_PASSWORD=<long random>
   JWT_SECRET=<long random>
   CORS_ORIGIN=https://<our domain>
   BACKUP_BUCKET=gs://<bucket>        # nightly copy off the machine
   # licence keys, Razorpay, ADMIN_KEY, CRON_KEY: as in server/src/config.ts
   ```
2. `docker compose up -d db caddy`, then `deploy/deploy.sh --now` for the first version.
3. Nightly backup: `crontab -e` → `30 21 * * * /path/to/repo/deploy/backup.sh >> /var/log/hanubix-backup.log 2>&1`
   (21:00 UTC = 2:30 am IST).

## Every server update
- `git pull`, then `deploy/deploy.sh`. It only runs between 11 pm and 5 am IST (`--now` for an urgent fix, founder's yes).
- It backs up first, starts the new version, checks it, and **goes straight back by itself** if the check fails.
- Something wrong found later: `deploy/rollback.sh` — one step back, in about a minute. Data stays as it is.

## Why going back is always safe
- Database changes only ever **add** (new tables, new columns with a default, indexes). A server test refuses any new change that
  drops, renames, empties or retypes anything, so the previous version always runs on the newer database.
- Saved bills, payments and credit notes are never rewritten by an update.

## Every app update (Play Store)
- Release to 1–2 pilot distributors first (Play Console → staged rollout), watch a day, then everyone.
- During that day old and new phones share the server: each phone tells the server which tables it knows and is sent only those.
  When a phone updates to a version with a new table, it fetches that table's earlier records once by itself.
