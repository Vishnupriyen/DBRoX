# Handover — where we are (12 Nov 2026, evening)

Start of a new chat: read this file, `CLAUDE.md`, `docs/HANUBIX_LOCKED_SIGNATURE.md` and `docs/HANUBIX_PLAN_LOCKED.md`, then carry on.
Branch `apk` (repo Vishnupriyen/Hanubix). The owner wants plain, simple words, one recommendation, and approval before building.

## First thing to do
- Nothing to rerun: the full gate passed on GitHub (Quality gate) on 397d6f9, 12 Nov evening — all tests, both business days,
  332 screens. (The run-failed emails that day were the screen check counting the Live vans map's hidden tiles; fixed.)

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
- **Business Boost** (name locked): Menu group for owner and office — offers running now + six services to request (see plan doc).
  Waiting: the owner's WhatsApp number for requests → set as the VITE_SUPPORT_WHATSAPP build value.
- **Updates without stopping the business**: phones tell the server which tables they know (old and new phones share it during a
  staged rollout; a phone fetches a new table's records once after updating); `deploy/` kit for Hostinger — night-only deploy,
  backup first, health check with automatic step-back, `rollback.sh`, nightly checked backup to Google Cloud; migrations only add.
- **Older phones**: built for Android System WebView 87+ (late 2020); older shows an "update needed" page (never a blank screen);
  no CSS :has(). Phone check before a release: Android 9 (WebView 69 → update page), 14 and 16; 16 KB check on every APK; a
  phone-check issue now fails the run (it always ended green before).
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
- **"Set up the departments"** (proposed 12 Nov, waiting): one Head-office chat for the owner (chief of staff turns his words into task
  cards); a shared task board = GitHub Issues in the repo, one label per department + status; each department a scheduled task that
  wakes (Product daily + "urgent", TESRAX quality/Security weekly, Customers daily, Growth 3×/week, Money weekly + 1st of month,
  Founder's office every morning; Reliability/cost as plain scripts on the server), works its cards and moves each to the next
  department; anything needing the owner goes to "Waiting for Vishnu" and his morning list. Build together with "Set up the team".
  **Plus a 9th department, Marketing** (owner, 12 Nov): Brand keeper (locked look and voice everywhere), Social media manager (weekly
  calendar for YouTube/Instagram/Facebook/LinkedIn; titles, descriptions, tags, real hashtags only, the owner's shock-style format),
  Video producer (HTML demo and comparison videos: script → style → low-res preview → 4K, each with his yes), Campaign planner
  (launch, festival/season, distributor meets, trade fairs), WhatsApp campaign writer, Ads manager (small Google/Meta tests, only the
  approved budget), Marketing analyst (what worked, cost per lead, in the Monday review). Nothing posted, sent or spent without his yes.
  **Timing (owner, 12 Nov): corrections and the convenience round FIRST; set up the departments when the app is ready for the first
  pilot distributor** (the video producer may start earlier on "Start the demo videos").
- **"Update both"** — the two decks (Company Deck https://claude.ai/artifact/7ToDDDs9dSb75NwMmhU8jH and Work and Hours
  https://claude.ai/artifact/7aFqUVaVQKVgnmk11uQZ2j): Montserrat + new logo, today's plan, new features; no price/market changes
  without showing the owner.
- **"Release"** — merge `apk` into `main` after the owner checks the latest APK on his phone (run chaos + sign-offs first).
- **"Make public link"** — optional: a public download page for test APKs (needs his yes; GitHub build files need a sign-in).
- Owner to do: buy Hostinger KVM 2 (24 months, India or Singapore data centre) and the domain; send the server IP and login;
  create the Google Maps key and add it as the MAPS_API_KEY secret.

## Latest APK
https://github.com/Vishnupriyen/Hanubix/actions/runs/43240572801/artifacts/13954407358 (sign in to GitHub first). Newer pushes build a
new one automatically.
