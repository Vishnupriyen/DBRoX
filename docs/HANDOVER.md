# Handover — where we are (12 Nov 2026, evening)

Start of a new chat: read this file, `CLAUDE.md`, `docs/HANUBIX_LOCKED_SIGNATURE.md` and `docs/HANUBIX_PLAN_LOCKED.md`, then carry on.
Branch `apk` (repo Vishnupriyen/Hanubix). The owner wants plain, simple words, one recommendation, and approval before building.

## First thing to do (a new chat)
- **GitHub repo is `Vishnupriyen/Hanubix`** (the old name DBRoX only redirects — attach and push to Hanubix). Branch `apk`.
- **Never take dates, commits or check results from this file — look them up:** `git log --oneline -15` and
  `gh api "repos/Vishnupriyen/Hanubix/actions/runs?branch=apk&per_page=6"` (via check-runner). As of 13 Nov morning: HEAD c95b8dd,
  every check green on GitHub (Quality gate + APK + phone checks on Android 9, 14 and 16 at ca94293).
- **Never draw the app from memory.** Before any picture of a screen, take a real screenshot of the current app (`cd app && npm run
  dev`, Playwright, 412 px) and change only what the picture is about. Facts a drawing must keep:
  - Bottom bar: dark jade–gold, **only two tabs — Home (left) and Menu (right) — with the TESRAX sphere in the middle**. There is
    no Search, Alerts or other tab.
  - The sphere is the animated **particle sphere** (`app/src/ui/TesraxCore.tsx`, glowing, gold particles on dark jade) — never a
    flat or plain circle. The owner: "it is our iconic".
  - Header: the reworked HANUBIX logo (complete B) with RETAIL INTELLIGENCE on Home; back arrow + screen title elsewhere.
  - Montserrat, white background, jade headings and quantities (see docs/HANUBIX_LOCKED_SIGNATURE.md).
- "next" from the owner means: tell him the next waiting item and ask — never start building or drawing without his word.
- **Never make the owner wait on a check.** Long waits (gate, GitHub builds, APK link) run in the background
  (`run_in_background: true`); answer him at once and report when it lands. Don't reinstall packages or browsers that already work.
- **The APK link is ready ~4 minutes after a push** (the "build" job). Send it then — don't wait for the phone check
  ("emulator" job, ~30–40 min); report that separately when it ends.
- **A failed check is never "a one-off".** Find the cause and fix it (regression test first) — a rerun alone hides it.

## 13 Nov 2026
- Open (tester, minor, not reproduced): a save landing just after a wipe commits could leave unsent rows with no token and no
  'access removed' marker (sync.ts ~202) — a later login of another firm could push them; and App.tsx:138 may show "Access removed."
  without the count in that race. Fix in the next part.
- **Security standard approved** (ISO 27001 / SOC 2 now, certificates later; DPDP Act in full): a round after the convenience
  round, before the server takes real data. Full list: docs/HANUBIX_SECURITY_STANDARD.md (top risks: unencrypted backups, no
  real activity log, staff PINs in plain text on phones, no DPDP, cron jobs not set up on Hostinger). Owner decisions in its section 10.
- Home header: HANUBIX logo with RETAIL INTELLIGENCE under it (edge to edge, clear gap); name + dot and firm name stacked
  on the right; long firm names never squeeze the logo. Module names stay generic (Bill, Delivery, …) — owner's decision.
- **Security standard BUILT** (developer, 13 Nov; waiting for the independent tester + security sign-off, not pushed).
  Status per item: section 0 of docs/HANUBIX_SECURITY_STANDARD.md. In short: encrypted backups (age) + restore drill;
  hash-chained activity log with nightly check and off-site anchor; limited DB role; Hostinger cron jobs, monitor, security
  watch, alerts, monthly access review; hardening script; Caddyfile; gate-tagged deploys (Cloud Run workflow gone);
  security checks on GitHub; phone: PIN hashes only, token in the Android Keystore, app lock, screenshot block, 14-day
  offline login / 30-day removal, Lock phone; owner PIN 6 digits (old owners asked at next login), owner tokens 14 days;
  DPDP: consent at sign-up and first login, Privacy & security screen (choices, export, requests, PIN, activity), public
  request form, erasure, breach register, retention job; 22 written policies in docs/security/ (founder signs each).
  Bug found and fixed: a new staff member's PIN was copied into the history log (phone and server).
- **Founder to do for security**: make the age key (deploy/README.md step 1, private key offline); set DB_APP_PASSWORD,
  ADMIN_ALLOW_IPS, an alert channel and GRIEVANCE_EMAIL in deploy/.env; GCS bucket (Mumbai, write-only account, 35 days);
  run harden.sh + install-cron.sh on the VPS; outside uptime check; first restore drill and breach drill; sign the 22
  policies; lawyer review of the privacy notice (later); delete the old GCP_SA_KEY GitHub secret. Open decision: Postgres
  row-level security (proposed as its own round).
- **Open for the GST & Accounts specialist** (found 13 Nov, not reproduced): `app/tests/regressions.test.ts` "a paid bill
  credited below zero becomes shop advance" failed once in a full gate (UTC step): outstanding showed ₹0 where the test
  expected ₹0.44. It then passed 13 full runs and 40 runs of the test on its own. Likely cause: `shopOutstanding`
  (`app/src/core/ledger.ts`) hides bill balances of ₹0.50 or less, so a 44-paise leftover after the credit is applied to the
  shop's other bills shows as ₹0. What decides whether a leftover appears is probably the random record ids (e.g. which
  stock lot a pick takes). To decide: is hiding ≤ ₹0.50 right for dues and statements? Then make the test deterministic.

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
- **Security agent + free scan (13 Nov)**: `.github/scripts/security-scan.sh` (npm audit, gitleaks over all history, mobsfscan,
  semgrep OWASP rules, Android settings) — GitHub "Security scan" every Monday, on push to main, and by hand; accepted findings with
  reasons and review dates in `.github/security-accepted.txt`. Fixed: login-signing secret must be ≥32 characters and the public dev
  secret only runs under NODE_ENV=development/test; security headers on every server reply. Next security round (owner's yes):
  replace xlsx 0.18.5 with SheetJS 0.20.3 (by 31 Dec), login token in Android secure storage, shrink/obfuscate the release APK (R8).
  Paid outside test (₹1.5–2.5 lakh, CERT-In approved, retest included) once, after the dashboards, before selling widely.
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
