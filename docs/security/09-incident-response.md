# Incident Response and Breach Notification Procedure

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## Severity
| Level | Example | First answer |
|---|---|---|
| Critical | data of several firms exposed; activity-log chain broken; server taken over | within 1 hour |
| High | one firm's data exposed; admin key leaked | within 4 hours |
| Medium | a lost staff phone; repeated attack attempts | same day |
| Low | a single wrong-PIN burst | next working day |

## Steps
1. **Detect** — an alert (monitor, security watch, verify-log), a customer, or a team member. Note the time.
2. **Contain** — lock phones (`/v1/staff/lock`), rotate keys, block IPs (ufw), stop the server if needed.
3. **Keep evidence** — copy the activity log and Caddy logs off the machine before changing anything; never edit them.
   Open a breach record: `POST /v1/admin/breach`.
4. **Assess within 24 hours** — what data, which firms (`POST /v1/admin/breach/affected` with the time window), how many people.
5. **Notify** (personal data breach, DPDP Act 2023):
   - the **Data Protection Board of India**: an intimation without delay, and the detailed report within **72 hours**
     (confirm the final timelines in the DPDP Rules with a lawyer);
   - **each affected person** in plain language: what happened, what data, what we did, what they can do, our contact;
   - **the distributor owners** of the affected firms the same day (they are responsible for their shops' data).
   Record each notice in the breach record (`board_notified`, `people_notified`).
6. **Recover** — fix the cause (a regression test first), restore from backup if needed.
7. **Review within 2 weeks** — what failed, what changes; add to the corrective action log (policy 21).

## Message template (English; Tamil if the owner decides)
> Subject: Important: a security incident at Hanubix
> On [date] we found that [what happened]. The information involved: [data]. We have [what we did]. You can [what they
> can do]. We are sorry. For questions, contact our grievance officer, R. Vishnupriyen, at [contact].

## Contacts
Founder / grievance officer: R. Vishnupriyen — contact details set in `deploy/.env` (`GRIEVANCE_EMAIL`, `GRIEVANCE_PHONE`).
Hostinger, Google Cloud, Razorpay, Anthropic support: in the supplier list (policy 13).

## Drill
A table-top breach drill once before go-live and once a year, timed; the notes go into the evidence folder.
