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
