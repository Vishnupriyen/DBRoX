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

## 4. GitHub secrets (repo → Settings → Secrets → Actions)
| Name | Value |
| --- | --- |
| `GCP_PROJECT` | your project id |
| `GCP_SA_KEY` | JSON key of a service account with roles: Cloud Run Admin, Cloud Build Editor, Cloud SQL Client, Secret Manager Secret Accessor, Service Account User, Firebase Hosting Admin, Artifact Registry Writer |

## 5. Deploy
GitHub → Actions → **Deploy** → Run workflow. It deploys the server to Cloud Run (Mumbai) and the phone app to
Firebase Hosting. The server creates its own tables on first start.

## Growth steps (see the product definition doc, Part 13.6)
| Distributors | Change |
| --- | --- |
| 20+ | Cloud SQL: turn on High availability |
| 500+ | Bigger Cloud SQL machine; add a read replica for reports |
| 5,000+ | Split `docs` by distributor across database nodes (schema is already keyed by `tenant_id`) |
Run `npm run loadtest` in `server/` at each stage's size before switching.
