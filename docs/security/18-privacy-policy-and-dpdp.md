# Privacy Policy (public) and Internal Data Protection Policy (DPDP Act 2023)

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

> **Draft — legal review pending.** The founder decided (13 Nov 2026) that a lawyer reviews this later. The in-app
> notice (`app/src/core/privacy.ts`) carries the same draft mark and version (`shared/privacy.json`).

## Part A — Public privacy policy (website and app)
**Who we are.** Hanubix (R. Vishnupriyen), Pennadam, Cuddalore District, Tamil Nadu.

**Our two roles.** For the people who log in (owners, staff) and for billing, Hanubix is the *data fiduciary*. For the
shops a distributor serves, the distributor is the data fiduciary and Hanubix processes that data for them.

**What we collect.** Names, mobile numbers and roles of people who log in; the firm's name, GSTIN and address; the
business records the firm enters (bills, orders, payments, stock, shops); attendance; location while on duty only with
the person's consent; bill photos for AI reading only with the owner's consent.

**Why.** To run billing, delivery, collection, stock and staff work; secure logins; tax records required by law. Never sold, never used for advertising.

**Who sees it.** The firm's owner and the people the owner allows, by role. Hanubix support only within an owner-granted
24-hour window, every look recorded. Suppliers that run the service (policy 13). AI photo reading sends photos to
Anthropic, outside India, only when the owner turned it on.

**How long.** Policy 17 (bills and payments 8 years by GST law; backups gone within 35 days).

**Your rights.** Access (download your data in the app), correction, erasure (tax records keep only what the law needs),
nominate someone, withdraw any optional consent as easily as you gave it, and complain. We answer within 30 days (our
target is 15). In the app: **Menu → Privacy & security**. Without a login: the request form on our website.

**Grievance officer.** R. Vishnupriyen — contact set in the server settings (`GRIEVANCE_EMAIL`, `GRIEVANCE_PHONE`);
until then, through the firm's owner. You may also complain to the Data Protection Board of India.

**Children.** We do not knowingly collect data of anyone under 18.

**Changes.** A new version is shown in the app and must be accepted again.

## Part B — Internal data protection rules
- **Consent records**: `consents` table (person, kind, version, time, IP); never overwritten. The notice is ticked by the
  person, never pre-ticked. Optional consents (AI photo reading, location, analytics, WhatsApp) are separate and off by default.
- **Requests**: `privacy_requests` (due in 30 days, target 15). The control panel lists them (`GET /v1/admin/privacy`).
  Erasure (`POST /v1/admin/privacy/:id/erase`) needs the request id typed again and is logged.
- **Erasure rule**: names, phones, addresses, photos and locations are removed from live records, the archive and the
  login row; bill numbers, lines, amounts, taxes and the signed-bill proof stay for the legal period.
- **Data localisation**: the primary database stays in India; backups in Mumbai; the Anthropic transfer is opt-in and disclosed.
- **Record of processing**: this document + policy 13 + policy 17.
- **Impact check**: location tracking — consent per person, only while the day is open, viewable by the owner only.
- **Significant data fiduciary**: check yearly as the user base grows (annual audit duty if notified).
