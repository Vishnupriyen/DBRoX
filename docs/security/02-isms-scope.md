# ISMS Scope and Context

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## Inside the boundary
| What | Where | Holds |
|---|---|---|
| Hanubix server, Postgres, Caddy | Hostinger KVM 2 VPS | all firms' records, logins (PIN hashes), activity log |
| Encrypted backups | Google Cloud Storage, Mumbai (asia-south1) | nightly database copies (age-encrypted), weekly `.env` copy |
| Code | GitHub `Vishnupriyen/Hanubix` | source, workflows; no secrets |
| Android app | Google Play | the app; each phone holds its own role's records |
| Payments | Razorpay | subscription payments (card/UPI details stay with Razorpay) |
| AI photo reading | Anthropic API | bill photos, only when the firm's owner turned it on |
| Founder's laptop | office | the backup private key (offline copy), restore drills |

## Outside the boundary
Distributors' own phones and networks (their responsibility; the app limits what a phone holds), the shops' own systems.

## Context
- Customers: FMCG distributors and brand companies in Tamil Nadu, India.
- Law: India's Digital Personal Data Protection Act 2023 (policy 18), GST record keeping (8 years).
- Targets: ISO 27001:2022 and SOC 2 (Security, Availability, Confidentiality, Privacy) — certificates later.
