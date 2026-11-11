# Working on Hanubix (repo: DBRoX)

Hanubix™ — FMCG distributor app for Tamil Nadu, Powered by TESRAX (Turbo Engine for Smart Retail & Autonomous eXecution — locked 11 Nov 2026).
- `app/` React + TypeScript PWA (Dexie offline DB). Business logic in `app/src/core`, screens in `app/src/ui`.
- `server/` Fastify + Postgres sync/number server. `shared/tables.json` is the single list of synced tables.

## Non-negotiable: QUALITY.md
Read `QUALITY.md` before changing anything. Follow its Definition of done on every change.

Before saying any work is finished:
1. `cd app && npm run gate` must print `✔ GATE PASSED`.
2. For a demo or release, also `npm run test:chaos`.
3. Any bug found → a regression test first, then the fix.
Never report work as done while the gate is red. Never weaken a guard, a law or a sweep check to make it pass —
fix the cause, or explain to the owner why a check is wrong before changing it.

## Design (locked)
Gostamo look: pure black, #0E1016 cards with one hairline, one gradient (#4FE3D6 → #E6E9F4 → #F9B55B) only for the
TESRAX core, wordmark, primary actions and hero numbers; Geist font; no solid orange. Don't add design elements
the owner didn't ask for.
