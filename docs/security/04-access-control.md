# Access Control Policy

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## Least privilege
Each role sees and changes only what its work needs. The single list is `shared/tables.json` (read/write per role),
enforced by the server on every sync; owner-only fields (purchase rates) never leave the server for other roles.

| Role | Can |
|---|---|
| owner / cadmin | everything of their firm; staff, plan, exports, support access |
| office | bills, orders, money, stock (no purchase rates, no P&L) |
| salesman, delivery, godown, manager, rep | their own work only |
| Hanubix admin (control panel) | plans, payments, privacy requests; a firm's records only inside the owner's 24-hour support window |

## PINs
- Owner and head office: **6 digits**; staff: 4 digits. Easy PINs (runs, repeats, years, dates) are refused.
- 5 wrong PINs → 15 minutes' lock (server, and on the phone for the offline login and app lock).
- The app asks for the PIN again after 5 minutes in the background; a phone offline 14 days must log in online.
- Owner tokens last 14 days, staff 30; "Log out on all phones" and "Lock phone" end them at once.

## Joiners, movers, leavers
- **Joiner**: the owner adds the person in Staff & access with a role and a first PIN; the person accepts the privacy notice at first login.
- **Mover**: the owner changes the role; the person logs in again.
- **Leaver**: the owner taps Remove access (the phone is wiped at its next contact) or Lock phone (lost phone) the same day.
- **Hanubix staff leaver**: same day — GitHub, Hostinger, Google Cloud, Razorpay, Play Console access removed; `ADMIN_KEY` and `CRON_KEY` rotated.

## Admin and cron keys
- Kept only in `deploy/.env` (root-only). The control panel is reachable only from `ADMIN_ALLOW_IPS`; cron only from inside the machine.
- Rotated every quarter (monthly access review reminds); every use and every wrong try is in the activity log.

## Reviews
The monthly access review (`deploy/access-review.sh`) lists every login, staff not seen in 90 days, owners, admin-key and
support use; the founder reads, ticks and signs it (evidence folder).
