# Putting DBRoX live on Google Cloud (Mumbai)

One-time setup, about 30 minutes. After this, every deploy is one click in GitHub → Actions → Deploy.

## 1. Google Cloud project
1. Open console.cloud.google.com, create a project (e.g. `dbrox-prod`). Billing is already enabled on your account.
2. Turn on these APIs: Cloud Run, Cloud SQL Admin, Cloud Build, Artifact Registry, Secret Manager, Firebase Hosting.

## 2. Database (PostgreSQL, Mumbai)
1. Cloud SQL → Create instance → PostgreSQL 16 → name `dbrox-db` → region `asia-south1` (Mumbai).
2. Pilot: Enterprise edition, smallest shared-core machine, **single zone** (no standby copy) to keep cost low.
   Before real customers depend on it: switch on **High availability** (one setting, no downtime).
3. Create database `dbrox` and a user `dbrox` with a strong password.
4. **Backups (before any real distributor's data goes in)** — Cloud SQL → `dbrox-db` → Edit → Data protection:
   - **Automated daily backups: ON**, window 01:00–05:00 Asia/Kolkata, keep **14** backups.
   - **Point-in-time recovery: ON**, keep **7 days** of logs (lets you go back to any minute of the last week).
   - **Deletion protection: ON** (the instance can't be deleted by a mis-click).
5. **Practice a restore once before the pilot, and again every 3 months** (a backup nobody has restored is a hope, not a backup):
   1. Cloud SQL → `dbrox-db` → Backups → pick last night's backup → **Restore** → **to a new instance** `dbrox-restore-test` (never over the live one).
   2. Also try point-in-time: Overview → **Clone** → "Clone from an earlier point in time" → 1 hour ago → `dbrox-pitr-test`.
   3. Connect to each copy (Cloud SQL Studio) and check: `SELECT count(*) FROM tenants; SELECT tbl, count(*) FROM docs GROUP BY tbl;`
      — the numbers match the live database as of that time.
   4. Write the date and how long the restore took in the ops log, then **delete both test instances** (they cost money).

## 3. Secrets (Secret Manager)
| Name | Value |
| --- | --- |
| `dbrox-database-url` | `postgres://dbrox:PASSWORD@/dbrox?host=/cloudsql/PROJECT:asia-south1:dbrox-db` |
| `dbrox-jwt-secret` | a long random string (64+ characters) |
| `dbrox-anthropic-key` | your Claude API key (console.anthropic.com) |
| `hanubix-licence-key` | the PRIVATE licence key — run `cd server && npx tsx src/licence-keys.ts` once and copy the private part |
| `hanubix-admin-key` | a long random string — the key for the Hanubix console (keep it to yourself) |
| `hanubix-cron-key` | a long random string — used by the daily job |
| `hanubix-razorpay-key-id` / `hanubix-razorpay-key-secret` | Razorpay → Settings → API Keys |
| `hanubix-razorpay-webhook-secret` | the secret you type when adding the webhook (step 6) |
| `hanubix-razorpay-plans` | the Razorpay plan ids, e.g. `{"medium:complete":"plan_Nx…","starter:last_mile":"plan_Ab…"}` (one plan per tier × pack, amount + 18% GST) |

## 4. GitHub secrets (repo → Settings → Secrets → Actions)
| Name | Value |
| --- | --- |
| `GCP_PROJECT` | your project id |
| `LICENCE_PUBLIC_KEY` | the PUBLIC licence key printed by the same command (built into the app; safe to share) |
| `GCP_SA_KEY` | JSON key of a service account with roles: Cloud Run Admin, Cloud Build Editor, Cloud SQL Client, Secret Manager Secret Accessor, Service Account User, Firebase Hosting Admin, Artifact Registry Writer |

## 5. Deploy
GitHub → Actions → **Deploy** → Run workflow. It deploys the server to Cloud Run (Mumbai) and the phone app to
Firebase Hosting. The server creates its own tables on first start.

## 6. Payments and automatic lock/unlock (Razorpay)
1. Razorpay → **Subscriptions → Plans**: one plan per tier × pack (monthly, price + GST). Put their ids in `hanubix-razorpay-plans`.
2. Razorpay → **Settings → Webhooks** → add `https://SERVER_URL/v1/razorpay/webhook`, a secret, and the events
   `subscription.activated`, `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `payment.failed`.
3. Google Cloud → **Cloud Scheduler** → daily at 00:05 Asia/Kolkata: `POST https://SERVER_URL/v1/cron/daily` with header `x-cron-key: <hanubix-cron-key>`.

## 7. Scheduled jobs (Cloud Scheduler, time zone Asia/Kolkata, all `POST` with header `x-cron-key: <hanubix-cron-key>`)
| Job | Schedule | URL | Why |
| --- | --- | --- | --- |
| relay | every minute (`* * * * *`) | `/v1/cron/relay` | hands company ⇄ distributor changes over if a server instance stopped mid-way (rows are kept until relayed; 5 failures → `relay_failed`, never dropped) |
| cover | daily 01:30 (`30 1 * * *`) | `/v1/cron/cover` | head office stock figures for every brand |
| archive | daily 02:00 (`0 2 * * *`) | `/v1/cron/archive` | old records to the compressed archive (nothing deleted) |
| daily | daily 00:05 (`5 0 * * *`) | `/v1/cron/daily` | plan status, downgrades, reminders |
Check once a week: `SELECT count(*) FROM relay_failed;` should be 0. If not, the `error` column says why; after fixing, move the rows back:
`INSERT INTO relay_queue(tenant_id, kind, tbl, doc_id) SELECT tenant_id, kind, tbl, doc_id FROM relay_failed; DELETE FROM relay_failed;`

## 8. Server settings that matter (already in `.github/workflows/deploy.yml`)
- `--min-instances=1 --no-cpu-throttling`: the relay runs in the background after a sync replies; a throttled or sleeping instance would leave it half done.
- `--max-instances=3` with `DB_POOL=5`: at most 15 database connections, inside the smallest Cloud SQL machine's limit. Raise both together with the machine size.
- `CORS_ORIGIN`: only the web app (`PROJECT.web.app`, `PROJECT.firebaseapp.com`) and the Android app (`https://localhost`). The server refuses to start in production without it. Add a custom domain here if you use one.
- `SCAN_DAILY_CAP`: AI photo reads for all distributors together per day (cost cap; default 2,000). A trial gets 100 reads a month; only owner, office and godown can scan.
- Logs carry only error codes, never full database errors (they can contain customer data).
- Wrong PINs are counted in the database: 5 from one place → 15 min; 10 for one phone from anywhere → 10 min; 20 from one place → 30 min. Sign-ups: 5 per place per hour.

## 9. Android app (GitHub → Actions → APK)
- Repo → Settings → Secrets: `LICENCE_PUBLIC_KEY` (same as above) — the APK is built with it. Repo → Variables: `SERVER_URL`.
- The artifact holds `app-debug.apk` (installs as is, for testing) and `app-release-unsigned.apk` (sign it with the Hanubix key outside GitHub before giving it to anyone; unsigned it will not install).
- Android backup of app data is off (`allowBackup="false"`): a firm's data never goes into a staff member's personal Google backup.

How it then runs by itself: new distributor → 60-day trial → owner taps **Plan & billing → Set up UPI Autopay** →
each month Razorpay charges and calls the webhook → "paid until" moves forward → every phone gets a new sealed licence on
its next sync. Payment fails → 7 days with a banner → billing pauses at the start of day 8 (view, collect and export still
work) → pays → unlocked within seconds. Bank transfer instead? `POST /v1/admin/tenants/ID/paid {"until":"YYYY-MM-DD"}`
with header `x-admin-key` (the Hanubix console will have a button for this).

## Growth steps (see the product definition doc, Part 13.6)
| Distributors | Change |
| --- | --- |
| 20+ | Cloud SQL: turn on High availability |
| 500+ | Bigger Cloud SQL machine; add a read replica for reports |
| 5,000+ | Split `docs` by distributor across database nodes (schema is already keyed by `tenant_id`) |
Run `npm run loadtest` in `server/` at each stage's size before switching.
