# Handover — where we are (12 Nov 2026, evening)

Start of a new chat: read this file, `CLAUDE.md`, `docs/HANUBIX_LOCKED_SIGNATURE.md` and `docs/HANUBIX_PLAN_LOCKED.md`, then carry on.
Branch `apk` (repo Vishnupriyen/Hanubix). The owner wants plain, simple words, one recommendation, and approval before building.

## First thing to do
- Run `cd app && npm run gate` once on the latest commit. The last full gate passed on 234f622 (map + smaller text + lowered header);
  later commits (outstanding by age 5bd0578, plan docs 51843f7) passed all tests and both business-day runs, but the screen sweep
  step was interrupted by other jobs using the machine — rerun it alone.

## Done today
- Midnight rep fix; credit note after a return + short delivery fix; phone check (Android emulator) runs to the end with time limits.
- TESRAX: every screen by name, every report by name and period (sent as Excel), shop statement file (accounts-reviewed), salary
  sheet, any bill by voice, P&L / GST summary / day close / attendance / trips files (accounts-reviewed labels), company-side reports,
  outstanding by age bucket. Training: 5,364 sentences 95% → 100%; blind check 97% distributor / 92% company, misses fixed.
- Faster gate: tests ~4 min (TESRAX sets once, two halves, both processors). Full gate ~16 min (the 332-screen sweep is the rest).
- Design locked 12 Nov: new HANUBIX logo (complete B), Montserrat, dark jade–gold bottom bar with the glowing sphere (iconic — keep it),
  TESRAX opens on double tap, Powered by TESRAX only on the animated opening screen, Menu (grouped), text one step smaller,
  header below Android's status bar.
- Live vans map: Google's native map on Android when the GitHub secret MAPS_API_KEY is set (free in India); OpenStreetMap until then.
- Plan locked: Hostinger KVM 2 → website → our control panel → distributor dashboard → company dashboard; ERP integrations later.

## Waiting for the owner
- **"Build it"** — the convenience round (see the plan doc): "Do this next" Home for every role (picture: /tmp files are gone in a new
  session — redraw from the description; sphere stays in the bottom bar), WhatsApp/Collect on shops, search everywhere, next job opens
  after save, Bill all approved, TESRAX "bill <shop>" + typo help ("biscut", "box"), repeat last order, route-ordered collect,
  tappable day close, today's sales on owner Home, driver no-trip page, offline note, short New shop, reports in one place, company
  rows tappable, Team today call/remind, reject reason + approve undo, owner alerts, signed-bill photo, beat on a map.
- **"Set up the team"** — ~30 new agents in 8 departments (Product, TESRAX quality, Security, Reliability and cost, Growth, Customers,
  Money and compliance, Founder's office); rule: nothing goes out without the founder's yes; watchers as plain scripts on the server;
  cheap models for routine work; chief of staff daily list + Monday review as scheduled tasks.
- **"Update both"** — the two decks (Company Deck https://claude.ai/artifact/7ToDDDs9dSb75NwMmhU8jH and Work and Hours
  https://claude.ai/artifact/7aFqUVaVQKVgnmk11uQZ2j): Montserrat + new logo, today's plan, new features; no price/market changes
  without showing the owner.
- **"Release"** — merge `apk` into `main` after the owner checks the latest APK on his phone (run chaos + sign-offs first).
- **"Make public link"** — optional: a public download page for test APKs (needs his yes; GitHub build files need a sign-in).
- Owner to do: buy Hostinger KVM 2 (24 months, India or Singapore data centre) and the domain; send the server IP and login;
  create the Google Maps key and add it as the MAPS_API_KEY secret.

## Latest APK
https://github.com/Vishnupriyen/Hanubix/actions/runs/43169494723/artifacts/13921223430 (sign in to GitHub first). Newer pushes build a
new one automatically.
