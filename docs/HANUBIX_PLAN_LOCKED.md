# Hanubix plan — locked by the founder, 12 November 2026

## Hosting (locked)
- **Hostinger VPS KVM 2** (2 vCPU, 8 GB RAM, 100 GB NVMe) — ₹799/month on the 24-month term (≈ ₹19,200 upfront), ₹1,199/month after.
  India data centre if offered at checkout, else Singapore.
- One server runs: the Hanubix sync server (Fastify + Postgres), the three web dashboards and the website.
- Safety: HTTPS, firewall, key-only SSH (no password logins), automatic security updates; Hostinger daily backups **and** a nightly
  encrypted copy of the database to the founder's Google Cloud Storage (off-site).
- Move to AWS Lightsail Mumbai when there are many paying distributors — no change to the app.
- Domain: **hanubix.com** (or the founder's choice) — bought by the founder.

## What gets built, in this order (locked)
0. **Server online + domain** — everything below needs it. Phones keep working offline and sync to it.
1. **Website — hanubix.com**: opening TESRAX sphere animation, what Hanubix does for distributors and for brands, features,
   pricing, demo video, "Book a demo" (WhatsApp), privacy policy and terms (required for Google Play), app download.
2. **Our control panel — admin.hanubix.com** (founder only): every customer, plans and modules, licences (start / renew / upgrade /
   pause / stop), payments due, health (sync errors, crashes, server cost per customer, daily activity), support view, TESRAX
   "didn't understand" list across all customers, onboarding with Excel import, two-step login and a log of every change.
3. **Distributor dashboard — app.hanubix.com** (owner and office): the same Hanubix on a wide screen; Home with today's sales and
   collection, "Do this next", 30-day sales, outstanding by age, top shops/products, live van map; big searchable tables with Excel;
   bulk work (bill all approved, print many bills, Excel imports, prices and schemes); staff and access.
4. **Company dashboard — company.hanubix.com** (brand head office and managers): all distributors at a glance (primary, secondary,
   stock in days, running low, health), field team live map, visits, targets and leaderboard, leave and expense approvals,
   schemes and prices to all distributors, claims inbox, invoice upload, reports. SAP connects here later.

## Before the plan: the phone app convenience round (waiting for the founder's "Build it")
"Do this next" Home for every role (picture approved for review: owner and salesman; TESRAX sphere stays in the bottom bar),
WhatsApp/Collect on every shop, search everywhere, next job opens after each save, "Bill all approved", TESRAX "bill <shop>" and
typo help, repeat last order first, route-ordered collection, tappable day-close checklist, today's sales on owner Home, driver
no-trip page, offline "will send" note, short New shop form, reports in one place, company rows tappable, Team today call/remind,
reject reason and approve undo; plus owner alerts, signed-bill photo, beat on a map.

## Business Boost (name locked by the founder, 12 Nov 2026 — built)
Menu → Business Boost → "Offers and services" (owner and office): offers running now (the real schemes), and six services to
request — GST filing and CA help, working capital, stock and godown insurance, printers and scanners, staff data plans, Tally help.
A request is saved once, synced, and opens WhatsApp to the Hanubix team when the support number is set in the build
(VITE_SUPPORT_WHATSAPP). Credit and insurance only through licensed banks, NBFCs and insurers — Hanubix never lends or sells
insurance. Later, with the control panel: requests land there, and a "New brands for your area" section. A 10th department,
"Opportunities and partnerships" (opportunity scout, partnerships manager, catalogue keeper, lead router), runs it.

## Updates without stopping the business (12 Nov 2026 — built)
Server updates at night with a backup first and automatic step-back if the check fails (`deploy/`); one-step rollback; database
changes only ever add (a test enforces it); app updates to 1–2 pilots first; old and new phones share the server safely.

## Later (parked by the founder)
- ERP integrations: Tally (two-way, connector on the office PC) → Busy → Marg; then with the server: Zoho Books, SAP Business One,
  SAP S/4HANA / ECC for brands (OData, nightly file as fallback); a standard Excel/CSV template and an open API for any other.
- Google Maps key (MAPS_API_KEY secret) for the Live vans map on Android; OpenStreetMap until then.
