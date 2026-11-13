# Risk Assessment Method, Risk Register and Statement of Applicability

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## Method
Each risk is scored **likelihood (1–5) × impact (1–5)**. 15 and above: fix before real data; 8–14: fix this quarter;
under 8: accept or fix when convenient. The founder approves every accepted risk. The register is reviewed every quarter
and after every incident.

## Register (seeded 13 Nov 2026 from docs/HANUBIX_SECURITY_STANDARD.md)
| # | Risk | L | I | Score | Treatment | Status |
|---|---|---|---|---|---|---|
| 1 | Backups readable by whoever gets the bucket | 3 | 5 | 15 | age encryption, write-only account, private key offline | done 13 Nov |
| 2 | No trace of logins, admin use, staff changes | 4 | 4 | 16 | hash-chained activity log, nightly check, off-site anchor | done 13 Nov |
| 3 | Lost/rooted phone gives up PINs or token | 3 | 4 | 12 | PIN hashes only, Keystore token, app lock, 14-day offline limit, screenshot block | done 13 Nov |
| 4 | DPDP duties not met | 4 | 4 | 16 | consent, requests, erasure, retention, breach procedure | done 13 Nov (legal review pending) |
| 5 | Scheduled jobs never run on Hostinger | 4 | 3 | 12 | install-cron.sh, job_runs, monitor | done 13 Nov |
| 6 | Admin console open to the internet with one key | 3 | 5 | 15 | Caddy IP allow-list, wrong-key lock, every use logged | done 13 Nov |
| 7 | Request floods, weak PINs | 3 | 3 | 9 | rate limits, 6-digit owner PIN, weak-PIN list | done 13 Nov |
| 8 | No alerts, no dependency scanning | 4 | 3 | 12 | monitor, security watch, npm audit, gitleaks, Trivy, Dependabot | done 13 Nov |
| 9 | One server: losing the machine stops the service | 2 | 5 | 10 | backups + restore drill (RTO 4 h); second machine when paying firms grow | accepted for pilot |
| 10 | A rooted, unlocked phone can read its own role's data | 2 | 3 | 6 | accepted (policy 5); mitigations above | accepted |
| 11 | Shared office NAT hits per-place limits | 2 | 2 | 4 | limit set high (1,200/min); watch | accepted |

## Statement of Applicability (ISO 27001:2022 Annex A, summary)
| Theme | Applies | How |
|---|---|---|
| 5 Organisational (policies, roles, suppliers, incidents, continuity, privacy) | yes | policies 01–22 |
| 6 People (screening, awareness, leavers) | yes | policy 15 |
| 7 Physical (secure areas, equipment) | partly | data centre is Hostinger's (supplier, policy 13); office/laptop: policy 16 |
| 8 Technological (access, crypto, logging, backups, secure dev, network) | yes | policies 04, 06, 07, 08, 10, 11, 12 |
| 7.1–7.4 physical perimeter, entry controls | no (own premises hold no servers) | covered by the supplier's certificates |
