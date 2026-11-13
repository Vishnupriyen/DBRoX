# Running the Hanubix server (Hostinger KVM 2)

How updates happen without stopping any distributor, and how the server is kept safe (security standard, 13 Nov 2026 —
the written rules are in `docs/security/`). Phones work offline the whole time; the server is only where they meet.

## Once, when the server is bought
1. **The founder's backup key (on the founder's laptop, never on the server).** Install `age`, then
   `age-keygen -o hanubix-backup.key`. It prints the **public key** (`age1…`) — that one goes in `.env` below.
   The file `hanubix-backup.key` is the **private key**: print it and keep the paper in a safe; put a copy in a password
   manager with 2-factor login; then delete the file from the laptop. Without it no backup can be opened — keep both copies.
2. **Lock the machine down** (as root, Ubuntu): put your SSH key on it first (`ssh-copy-id`), then
   `SSH_ALLOW_FROM="<your home IP> <office IP>" deploy/harden.sh` and `deploy/verify-harden.sh` (all ✔).
3. Install Docker, clone the repo, and create `deploy/.env` (`chmod 600`, owned by root):
   ```
   DOMAIN=api.<our domain>
   DB_PASSWORD=<long random>                 # the database owner (migrations only)
   DB_APP_PASSWORD=<another long random>     # the limited role every request uses (required in production)
   JWT_SECRET=<long random>
   CORS_ORIGIN=https://<our domain>,https://localhost   # the web app and the Android app (Capacitor's origin)
   ADMIN_KEY=<long random>
   ADMIN_ALLOW_IPS=<founder's IPs, spaces between>      # only these reach the control panel
   CRON_KEY=<long random>
   LICENCE_PRIVATE_KEY=<from server/src/licence-keys.ts>
   BACKUP_AGE_RECIPIENT=age1…                # the founder's PUBLIC backup key (step 1)
   BACKUP_BUCKET=gs://<bucket>               # Mumbai (asia-south1), see "Backup bucket" below
   GRIEVANCE_OFFICER=R. Vishnupriyen         # DPDP grievance officer (shown in the app)
   GRIEVANCE_EMAIL=                          # set the real contact address (not invented here)
   GRIEVANCE_PHONE=
   # alerts — at least one channel (deploy/alert.sh); one setting per line:
   ALERT_TELEGRAM_BOT_TOKEN=
   ALERT_TELEGRAM_CHAT_ID=
   ALERT_WHATSAPP_TOKEN=
   ALERT_WHATSAPP_PHONE_ID=
   ALERT_WHATSAPP_TO=
   ALERT_WHATSAPP_TEMPLATE=hanubix_alert
   ALERT_EMAIL_TO=
   ALERT_SMTP_URL=                           # smtps://user:password@host:465
   ALERT_EMAIL_FROM=
   # Razorpay: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RAZORPAY_PLANS; AI: ANTHROPIC_API_KEY
   ```
4. `deploy/pin-images.sh` (exact image digests), `docker compose up -d db caddy`, then on GitHub run the **Deploy**
   workflow on the commit (it runs the gate and tags it `gate-<commit>`), then `git pull && deploy/deploy.sh --now`.
5. `deploy/install-cron.sh` — every scheduled job (see below). Check with `crontab -l`.
6. An outside uptime check (free tier, e.g. UptimeRobot) on `https://api.<domain>/health` every 5 minutes, alerting the
   founder: a script on this machine cannot tell you the machine itself is dead.
7. Before the first real distributor: run the restore drill once, the breach drill once (docs/security/09), and
   `deploy/verify-harden.sh`.

## Backup bucket (Google Cloud, once)
- Bucket in `asia-south1` (Mumbai), uniform access, **versioning on**, **retention lock 35 days**, lifecycle: delete
  objects older than 35 days (the privacy notice promises backups are gone within 35 days).
- A service account for the server with **Storage Object Creator only** (it can add, not read or delete); its key file
  on the server, `gcloud auth activate-service-account --key-file …` as root. Test: `gsutil rm` of a backup must fail.

## The scheduled jobs (deploy/install-cron.sh; times IST)
| Job | When | What |
|---|---|---|
| `cron-call.sh relay` | every minute | company-link relay safety net |
| `cron-call.sh cover` | every 5 minutes | head office stock figures |
| `cron-call.sh daily` | 00:05 | plans, trial and grace status |
| `cron-call.sh archive` | 02:00 | old records to the archive |
| `backup.sh` | 02:30 | encrypted backup, copied off the machine |
| `verify-log.sh` | 03:00 | activity-log chain check + anchor off the machine |
| `cron-call.sh retention` | 03:30 on the 1st | purges, log months over 12 archived (5 years) |
| `backup-env.sh` | Sundays 03:45 | encrypted copy of `.env` |
| `monitor.sh` | every 5 minutes | health, disk, memory, backup age, jobs, certificate |
| `security-watch.sh` | every 10 minutes | wrong logins, admin key, cross-firm requests, bulk downloads |
| `access-review.sh` | 08:30 on the 1st | the monthly access review report to sign |
The jobs call the server from inside the machine; Caddy refuses `/v1/cron/*` from outside.

## Every server update
- On GitHub: run the **Deploy** workflow on the commit (gate + server tests → tag `gate-<commit>`).
- On the server: `git pull`, then `deploy/deploy.sh`. It refuses a commit without the tag, only runs between 11 pm and
  5 am IST (`--now` for an urgent fix, founder's yes), backs up first, starts the new version, checks it, **goes straight
  back by itself** if the check fails, and writes the deploy into the activity log.
- Something wrong found later: `deploy/rollback.sh` — one step back, in about a minute. Data stays as it is.

## Monthly
- Restore drill on the founder's laptop: copy the newest `*.dump.age` and `*.manifest` from the bucket, then
  `deploy/restore-drill.sh <file>.dump.age <file>.manifest <private key file>` → ✔ RESTORE DRILL PASSED; file the output.
- Read, tick and sign `deploy/reviews/access-review-<month>.md`; file it.

## Why going back is always safe
- Database changes only ever **add** (new tables, new columns with a default, indexes). A server test refuses any new change that
  drops, renames, empties or retypes anything, so the previous version always runs on the newer database.
- Saved bills, payments and credit notes are never rewritten by an update.

## Every app update (Play Store)
- Release to 1–2 pilot distributors first (Play Console → staged rollout), watch a day, then everyone.
- During that day old and new phones share the server: each phone (from the 12 Nov 2026 version on — give the pilots this version
  before the first distributors go live) tells the server which tables it knows and is sent only those.
  When a phone updates to a version with a new table, it fetches that table's earlier records once by itself.
