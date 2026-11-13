# Asset and Data Classification Policy

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## Classes
| Class | Examples | Rule |
|---|---|---|
| Public | website, Play listing, privacy notice | anyone |
| Internal | code, these policies, reports without customer data | Hanubix team |
| Confidential | firms' records, shops, staff names and phones, activity log | role-limited; encrypted in backups; never in chats or tickets |
| Owner-only | purchase rates, P&L, full exports | the firm's owner only |
| Secret | `.env` values, licence private key, backup private key, PIN hashes, tokens | never leave their place (policy 06) |

## Asset list
| Asset | Owner | Class |
|---|---|---|
| Hostinger VPS (server, Postgres, Caddy) | founder | confidential |
| GCS backup bucket (Mumbai) | founder | confidential (encrypted) |
| GitHub repository | founder | internal |
| `deploy/.env` | founder | secret |
| Licence private key, backup private key | founder (offline copy) | secret |
| Founder's laptop | founder | confidential |
| Play Console, Razorpay, Anthropic, Hostinger accounts | founder | secret credentials |

## Accepted phone risk
A rooted, unlocked phone can read its own role's data. This risk is accepted. Mitigations: no PINs on the phone (hashes
only), token in the Android Keystore, app lock after 5 minutes away, screenshots blocked, 14-day offline limit and data
removed after 30 days without contact, remote wipe on next contact, each role holds only its own data.
