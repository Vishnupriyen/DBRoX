# Evidence Folder Index

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

What an auditor will ask for, and where it is kept (`evidence/` in the founder's encrypted drive, one folder per month):

| Evidence | Made by | How often |
|---|---|---|
| Signed access review | `deploy/access-review.sh` + founder | monthly |
| Restore drill output | `deploy/restore-drill.sh` | monthly |
| Activity-log anchors | `deploy/verify-log.sh` → bucket `seclog-anchors/` | nightly |
| Hardening check output | `deploy/verify-harden.sh` | after changes, and quarterly |
| Alert log | `deploy/alerts.log` | monthly copy |
| Security check runs, SBOMs | GitHub Actions (Security checks) | weekly / each release |
| Gate results | GitHub Actions (Quality gate) | each release |
| Breach drill notes | founder | yearly |
| Supplier review | founder | yearly |
| Training attendance | founder | yearly |
| Signed policies | this folder, signed copies | yearly |
| Management review minutes | founder | yearly |
