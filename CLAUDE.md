# Working on Hanubix (repo: DBRoX)

Hanubix™ — FMCG distributor app for Tamil Nadu (TESRAX is ENGLISH FIRST — no Tanglish work unless the owner asks), Powered by TESRAX (Turbo Engine for Smart Retail & Autonomous eXecution — locked 11 Nov 2026).
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
White Hanubix look (owner, 11 Nov 2026 — locked from the owner's screenshots): white screens and white cards with one thin grey
hairline; deep green #17694C headings and TESRAX letters; primary buttons and the one hero card in a green-to-gold fade
(#0B4A35 → #2B6B43 → #7C6A2B); the TESRAX ball in green-to-gold dots; grey outline icons with a pale mint #E6F2EC chip when
selected; HANUBIX in wide black capitals with RETAIL INTELLIGENCE under it; Geist font. Don't add design elements
the owner didn't ask for.

## The AI team (`.claude/agents/`)
Every change runs through the team, in this order. The main session is the manager: hands out the work, keeps the order,
and brings the owner only the finished result and the decisions that are theirs.
1. **business-analyst** — flows, requirements, reports, "done when" rules.
2. **systems-engineer** — data, offline sync, scale; approves the design before building.
3. **ux-designer** — the flow for each role: fewest taps, clear words, no dead ends (screens and TESRAX).
4. **developer** — builds it, test first for any bug, gate green.
5. **independent-tester** — checks it without the developer's story; cannot edit code; bugs go back to step 4.
5b. **end-user-panel** — the real people (owner, office, salesman, godown, driver, company side) run a made-up business
   for several days and report where they got stuck or didn't trust a number; before every release or demo.
6. **ui-designer** — real phone screenshots against the locked design.
7. **security-operations** — data safety, backups, cost; signs off every release.
Specialists, whenever their area is touched: **gst-accounts-specialist** (bills, tax, credit notes, payments, ledgers,
P&L, e-invoice, GSTR-1, Tally — after step 4, before release) and **tesrax-language-specialist** (any TESRAX change, and
every week on the TESRAX report's misses).
Small fixes may skip 1–3, never 5. The owner is told about a step only when it changes what they get.
