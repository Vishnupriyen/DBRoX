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
| 2 | 13 Nov 2026, independent tester | a phone 30 days offline was wiped with unsent work | the wipe did not check for unsent records | never wipe with unsent work; sync first; online login sends it | developer | 13 Nov 2026 | 13 Nov 2026 |
| 3 | 13 Nov 2026, independent tester | the forced 6-digit owner PIN could be skipped by closing the app | the flag lived only in memory | kept on the phone until done; checked on every start | developer | 13 Nov 2026 | 13 Nov 2026 |
| 4 | 13 Nov 2026, security review | harden.sh: empty authorized_keys passed; firewall reset before SSH allowed | weak checks, wrong order | real key line required; SSH allowed first | developer | 13 Nov 2026 | 13 Nov 2026 |
| 5 | 13 Nov 2026, security review | the server container gets the DB owner password via .env | one env file for all | migrations + log maintenance in a one-shot container | developer | next round | |
| 6 | 13 Nov 2026, independent tester | "Access removed" wiped a phone with unsent bills, payments and stock moves | the wipe did not check for unsent records | never wiped with unsent work: the login ends, the owner or office logs in to send it, then the phone is wiped | developer | 13 Nov 2026 | 13 Nov 2026 |
