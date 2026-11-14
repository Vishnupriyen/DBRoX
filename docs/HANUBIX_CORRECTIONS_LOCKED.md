# Hanubix — Correction round, LOCKED (founder, 14 Nov 2026)

Source: founder's handwritten review of the DB app (4 pages) + chat answers, 14 Nov 2026. 48 items in 5 parts.
Each part: build → tester → one full gate → real phone screenshots → founder's yes → next part.
This replaces the earlier 4-part "convenience round" plan in HANDOVER.md.

## Part 1 — Look and TESRAX (small)
1. Remove the Search screen (ask TESRAX instead).
2. Menu aesthetic: grid of large icon cards in 6 groups (Sales, Bill & Delivery, Purchase & Stock, Accountant, People, Reports & Settings); white cards, jade icons, one gold accent, short names. Show a real-screenshot mock for approval before building.
3. Word "TESRAX" in small wide letters under the sphere in the bottom bar.
4. Opening screen uses exactly the same particle sphere as the bottom bar (bigger), "Powered by TESRAX" under it.
5. Bottom bar with the sphere on every screen (inside modules too).
6. TESRAX never redirects: it answers in place with a Download button (Excel/PDF); everything asked is kept in "My files" (one-stop place).
7. Owner dashboard: only "Sales this month so far" and "Outstanding"; fix overlapping text.
33. Business Boost: its own card in the Menu.
43. Font sizes: one fixed type scale on every screen, one step smaller; screenshot every screen, show the oversized ones, fix together.
44. TESRAX chat history: last conversation stays on reopen; history by day kept 30 days; files kept in My files; each person sees only their own chats; Clear chat button.

## Part 2 — Bill and Delivery (medium)
16. Sales comes before Bill everywhere (Menu, Home, module order); sales reports inside Sales.
8. Orders received: open as a full PO-like table, editable before billing; Excel download of orders; Bill reports button.
9. Rename "Picked – to verify" → "Verify picked"; editable in the same table as the bill.
10. Bill: summary card + "View full bill" (not full screen); Discount % per line. Printed bill to GST standard (Rule 46): gross value column, CGST/SGST rate and amount per line, HSN-wise tax summary, unit per product (not PCS for all), shop address required for GST shops, delivery address when different, Original/Duplicate/Triplicate copies.
34. Same product twice on one SALES bill: two lines with own rate/discount; GST per line; stock out once; "already in bill" note.
11. Shop master moves to Settings → Shops (template + check); TESRAX can also read the shop file (new shops yellow for approval).
11a. "Select shops" card in Delivery: all shops, search, beat filter, tick (or whole beat) → Plan route.
11b. Bills made outside Hanubix: PDF bills, one or many, uploaded in Delivery or to TESRAX → read (shop, bill no, date, amount, items) → matched to shop master (unknown shop yellow) → split across vans by capacity → best route per van → approve → load sheets + driver trips; amounts carry to Collection.
12. Vans: add, edit, delete.
13. Load sheet per van: view and print.

## Part 3 — Sales, Purchase, templates (medium)
17. Every upload in the app has "Download template" (columns, example row, notes) and a check before saving (bad rows listed, good rows kept): shops, beats, targets, products/margins, opening stock, opening balances, staff, vans, delivery shops.
18. Targets by Excel upload by shop and SKU (also salesman, month); achieved vs target.
19. Beat: full customer list first, then Mon/Tue/Wed tabs; edit beats (move shops, rename, delete); beat upload.
20. "Add purchase" renamed "Purchase entry".
21. Remove stock position from Purchase.
22. Add damage: remarks box.
23. New "Samples & Free" module (samples given, free goods received/passed, report).
24. Ageing moved out of Purchase into Reports.
35. Same product at different margins / purchase reading: company bill shows only landing rate + free qty. TESRAX reads every line (never merges). Margin set once per product by one typed line ("All 8%, Horlicks 500g 2.5% …"); new products take the default; changes by one line. Margin from selling price (FMCG standard): rate = landing ÷ (1 − margin), e.g. ₹100 at 8% = ₹108.70; per-company switch to mark-up if a company uses it. Free goods: each product uses ONE of three — Pass free (scheme to shops, free line ₹0) / Net rate (free lowers cost, e.g. ₹1,000 ÷ 11) / Keep profit (sold at normal rate) — all three always available, choice remembered per product, new free lines start on Keep profit. Only changed rates / new products show yellow; one-tap approve.

## Part 4 — Accountant, GST, Payroll, Day close (medium)
14, 15, 25. Accountant = the owner's accounts employee for all cash and collection dealings: collections, cash in hand, cheques, UPI, bank statement upload with auto-matching, receivables, outstanding; Collection module moves under Accountant; cheques/UPI list shows shop, bill no, amount, collected by, date; collection/receivables/outstanding reports downloadable here.
26. GST & Accounts specialist checks every GST screen and file (sales tax, purchase ITC, GST summary, GSTR-1) against the rules; shows errors with proof before fixing.
36. GST error check before any GST export: GSTIN format/state code, HSN missing or wrong digits for turnover, rate mismatch vs product, CGST/SGST vs IGST, bill number gaps/duplicates, tax totals, credit note not linked, unregistered sale ≥ ₹50,000 without full address. Errors block; warnings allow "Export anyway".
27, 29. Payroll: Back from Staff returns where you were (never Menu); delete staff (history kept).
28. Payroll Today: Present / Absent / Permission / Half day, one tap.
30. Salary sheet: detailed breakup (days, half days, permissions, absents, basic, allowances, advances, net), downloadable.
31, 32. Day close = money only: remove orders to approve, packed, new shops, duplicate collection, vans and the "bills without …" check; cash count & receive — tap Approve or edit.
39. Owner's evening summary at day close (sales, collected, cash pending, outstanding > 30 days, low stock, near expiry) as PDF via TESRAX.

## Part 5 — Settings and safeguards (medium)
37. Complete Settings: Business (logo, FSSAI, financial year, turnover band, bank details on bill), Bill (terms/footer, copies, round-off, discount limit), Shops & credit (credit days, limit, block when over), Purchase & margin (default margin, selling-price/cost per company, free-goods default), Stock (low stock, near-expiry days, units), People & payroll (working days, weekly off, late and half-day rules, salary parts, paid leave), Delivery (van capacity, start point, photo rules), Day close (close time, allowed cash difference), Staff access per role, Data (download all data, backup status).
38. Migration: upload Tally/Vyapar export (or templates) for products, shops, opening stock, opening outstanding — live on day one.
40. Near-expiry and slow-stock alerts.
41. Shop credit guard: salesman sees over-limit/overdue before ordering; billing asks owner approval.
42. Owner Undo for approvals and day-close steps (with reason, in the activity log).
45. Company rules: a company can get its own setup (scheme/claim format, ASM order approval, target upload, own report layout, fixed margin…) for only the distributors it chooses, applied only to that company's products and bills there. One app, built as switches (never copies); company sees only its own data; no rule can change GST, security or the distributor's own accounts; small switches free, a new feature for one company is paid custom work.
48. Plan lock = current pricing, fully automatic. Today the lock still uses the old 6 Nov packs (last_mile, office, complete) and tiers
    (starter…enterprise) in server/src/licence.ts — replace with: DB DMS ₹999 (all modules), DB LMD + Collection + Payroll ₹399; company SFA
    ₹999 per active sales user, company DMS ₹999. Remove the demo module switch from the distributor's Menu. Automatic end to end: plan chosen
    on the website or in the app → Razorpay UPI Autopay → webhook updates the sealed licence → modules on within a minute; monthly renewals
    automatic; failed payment → reminders → 7-day grace banner → lock (collect money + download data still allowed) → unlock the moment they
    pay; self-service upgrade (now, pay the difference) / downgrade (month end); company SFA billed by active sales-user count; free trial
    starts at sign-up and moves on by itself. Only manual case: bank transfer/cash marked paid in our control panel.

## Added to Part 4 (locked 14 Nov 2026)
46. One "Reports" card in the Menu = the single home of every report; each module's Reports button opens it filtered to that module; TESRAX can send any report. One standard for every report: date range + filters (salesman, beat, shop, company, product) → 3 summary numbers → detail table with totals row, tap a line to open the bill/shop/product → Excel/PDF with firm name, period, filters and totals; numbers match bills and ledger to the paisa (GST & Accounts specialist checks). Groups: Sales, Bill & Delivery, Accountant, Purchase & Stock, GST, People, Owner only.
47. Margin leakage (owner only): real profit per shop = bill margin − credit cost (late payment × money cost, setting default 1% a month; e.g. ₹1,00,000 at 8% paid after 60 days → 6% real) − extra discounts − returns/damage − delivery cost; shops ranked, loss-making shops red. Also catches extra discounts above limit, cost of Pass free / Net rate, returns and damage per shop and salesman, small far deliveries, unclaimed company schemes/claims, money stuck in slow/near-expiry stock, landing-rate rises not passed on. One-line leak total in the evening summary.
