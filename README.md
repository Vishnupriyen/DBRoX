# DBRoX

Distributor app for FMCG distributors in Tamil Nadu, powered by the **RoX Proprietary Engine**.

**Send. Say. Approve.** Send a photo, PDF, Excel or bank statement, say what you want (Tamil or English),
check the Excel-style table, fix any red cell, tap ✓. Nothing changes without ✓, every number is checked by
code, and every approval can be undone.

## Modules
RoX Orders · RoX Billing · RoX Godown · RoX Delivery · RoX Collection · RoX Bank · RoX Accounts ·
RoX Claim Prep · RoX Scan — each can be switched on or off per distributor.

## Layout
| Folder | What |
| --- | --- |
| `app/` | Installable phone app (PWA) + owner web dashboard. React + TypeScript, offline-first (IndexedDB). |
| `server/` | DBRoX server for Google Cloud Run: login, sync, RoX Scan (AI photo reading). PostgreSQL. |

## Run the app
```bash
cd app
npm install
npm run dev        # open the link, tap a demo login
npm test           # engine + reader tests
npm run build      # production build in app/dist
```

Demo logins (phone / PIN): owner 9000000001 / 1111 · office 9000000002 / 2222 · salesman 9000000003 / 3333 ·
godown 9000000004 / 4444 · delivery 9000000005 / 5555.

## Try in chat
- attach `app/tests/hul_purchase.xlsx` → "add this to inventory"
- attach `app/tests/sbi_statement.xlsx` → "match payments"
- "Murugan Stores 1 case surf, 24 good day" · "Murugan Stores paid 2000 cash" · "van 1 diesel 1500"
- "who owes more than 1000" · "load sheet" · "tally export" · "gstr1" · "e-invoice" · "claim file"
