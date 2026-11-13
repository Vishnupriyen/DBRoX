# Data Retention and Disposal Policy

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

| Data | Kept | Then |
|---|---|---|
| Bills, credit notes, payments, purchases (GST records) | 8 years (live this FY + last, then the archive) | erased with the firm's account after the legal period |
| Activity log | 12 months online + archive to 5 years in total | monthly job exports then drops a month; archive months over 5 years removed |
| Login rows of removed staff | until erased on request | erasure removes the row |
| `rate_hits`, `scan_daily`, `relay_failed` | 30 days | monthly retention job deletes |
| `receipt_claims` | 90 days | monthly retention job deletes |
| `access_log` (older log) | 12 months | monthly retention job deletes |
| Razorpay events | 8 years | monthly retention job deletes |
| Closed privacy requests | 3 years | monthly retention job deletes |
| Free trials never paid | 90 days after the trial ends | the owner is told, offered the export; then erased from the control panel |
| A closed firm's account | 30 days to download | then erased except tax records; backups gone within 35 days |
| Backups | 14 days on the server, 35 days in the bucket | deleted automatically |
| Caddy access logs, job logs | 90 days | rotated |

The retention job (`/v1/cron/retention`, monthly) logs its counts in the activity log; `{"dryRun": true}` shows what it
would remove without removing anything. Bills and payments are never touched by it.
