# Corrective Action Log and Document Control

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## Document control
Every policy has: a version, an owner, an approval line (signed and dated by the founder) and a next-review date (in its
header). Changes go through Git (the history is the change record). Superseded versions stay in Git history.

## Corrective action log
| # | Found (date, how) | Problem | Cause | Action | Owner | Due | Closed |
|---|---|---|---|---|---|---|---|
| 1 | 13 Nov 2026, security standard review | a new staff member's PIN was copied into the history log (phone and server) | the log copied whole records | PIN removed from history entries (app, server, old entries cleaned by the retention job); regression tests | developer | 13 Nov 2026 | 13 Nov 2026 |
