# Part 2 — Bill and Delivery: build spec (business analyst, 14 Nov 2026)

Source: docs/HANUBIX_CORRECTIONS_LOCKED.md Part 2 (items 16, 8, 9, 10, 34, 11, 11a, 11b, 12, 13).
The founder approved running Parts 2–5 through the team without a per-part yes (14 Nov 2026, 18:57); open questions take the
recommended answer below. Each step is pushed on its own; GitHub's Quality gate must be green before the next step.

## Build sequence
- **2a** Item 16 order + Item 12 vans (add/edit/delete + capacity)
- **2b** Item 8 Orders received = editable table + Excel + Bill reports button
- **2c** Item 9 "Verify picked", editable in the bill table
- **2d** Disc % per line + same product twice on a sales bill (item 34) — the core change
- **2e** Printed-bill data: unit per product, shop address rules, delivery address, bill-to snapshot
- **2f** Printed bill to GST Rule 46
- **2g** Bill summary card + "View full bill"
- **2h** Item 11 Settings → Shops (template + check) + TESRAX reads the shop file (builds the shared "upload with check" piece Part 3 reuses)
- **2i** Item 11a "Select shops" in Delivery → Plan route
- **2j** Item 13 Load sheet per van (view + print)
- **2k** Item 11b part 1: outside PDF bills — upload, read, match shops
- **2l** Item 11b part 2: split across vans by capacity, route per van, approve, load sheets + trips, amounts to Collection

Why this order: 2d/2e before 2f (the print needs them); 2a before 2j/2l (vans need capacity); 2j before 2l.

## Decisions (team follows these)
- **Q1 (owner-approved recommendation):** an outside bill delivered short lowers the shop's due directly, no Hanubix credit note
  (it is not our GST document; the issuer raises their own).
- **Q2 (owner-approved recommendation):** the driver views his load sheet only; office and godown print.
- **D1** Van capacity = one number, cases per trip; fallback max 25 stops per van; unset = no limit. Keep the one measure
  `suggestPlan` already uses.
- **D2** Free scheme pieces on duplicate product lines are worked out once on the combined paid quantity, shown on the first line
  (GST specialist to confirm).
- **D3** Shops ticked in 11a with no bill waiting are left out of the route.
- **D4** Print copies default: all three ticked.
- **D5** In Part 2 HSN digit length only warns (4 digits min, 6 when turnover > ₹5 crore). Blocking is item 36 (Part 4).

## Conflicts with current code (must be handled)
1. `UQC = 'PCS'` is fixed in gst.ts and PrintBill.tsx; Product has no unit → new `Product.unit`; GSTR-1, Tally, credit notes read it.
2. Discount is stored/edited in ₹ ("Disc ₹" in BillEditor). Keep ₹ as the tax truth; add optional `discountPct`.
3. BillEditor `addProduct` refuses a second line for the same product; OrderLine, `picked` and delivery shortages are keyed by
   productId only (credit notes already use a line index) → add a line number to order lines, picked rows and shortages.
4. Invoice stores no shop name/address/GSTIN snapshot → new `Invoice.billTo` + a guard/law that old bills never change.
5. PrintBill.tsx: hardcoded "ORIGINAL FOR RECIPIENT", one copy; no gross value column; no per-line CGST/SGST rate and amount; tax
   summary by rate not HSN+rate; shop address optional; no delivery address; nothing makes a GST shop's address mandatory.
6. Orders received (OrdersReceived.tsx) is a read-only card list — no editing, Excel or Bill reports button.
7. Van has no capacity field (needed from 2a; Part 5 adds the setting).
8. `dayPlans` / DayPlan ("select shops") exists only in standalone delivery mode; 11a needs it in the full app.
9. Outside bills = new table `externalBills` in shared/tables.json — never Invoices (would enter sales/GSTR-1); treated as dues like OpeningDue.
10. Item 16 partly done already (Home lists Sales before Bill since Part 1); check Menu groups, role order, "Sales reports" tile.
11. Rule 46 number rule (≤16 characters) only guarded as a 1–4 character prefix → whole-number length check.

## Items — what changes and "done when"
**16 (2a)** Sales above Bill on Home, Menu, TESRAX and the licence list; Sales gets a "Sales reports" tile; a role without the
Sales licence sees no gap.

**12 (2a)** Van fields: name, number, kind, driver, capacity. A van with an open trip or a waiting bill can't be deleted; a van with
history is hidden (`active = false`), never erased, so old trips/expenses keep its name; delete clears the driver link; van numbers
unique among active vans. Done when: a double tap makes one van; a deleted van still shows in last month's trip report.

**8 (2b)** Columns: No, Product, Unit, Qty, Rate, Disc %, GST %, Amount; footer = the bill's own taxable, tax, round-off, total;
shop history strip stays on top. Edit qty/rate/Disc %, add product, remove line — only while status is new or needs_ok. The
salesman's original lines are kept; every edit goes to the activity log. Removing every line is refused ("cancel the order
instead"). Excel: one row per line, totals match the screen to the paisa. Once approved to godown it is no longer editable here
(changes at Verify picked). Done when: double tap on Approve approves once; a second phone sees "already approved"; edits work
offline and sync later; Indian date after midnight.

**9 (2c)** "Picked – to verify" appears nowhere. The verify table = bill table + Ordered and Picked columns; Qty, rate, Disc %
editable; short picks red, extra picks amber. Billing once per order and the stock guard stay.

**10 / 34 (2d)** Disc % per line: 5% on gross ₹1,000 → discount ₹50.00, taxable ₹950.00; old ₹-only bills print unchanged.
A second line for the same product is allowed on SALES bills only, with an "already in bill" note; own rate and Disc % per line;
GST per line; stock goes out once for the total and cancel returns it once; credit notes and shortages point at the right line
(old data without a line number takes the first line first). The chaos law test runs with duplicate lines. Done when a double tap
adds one line, not two.

**10 (2e)** Unit per product from the GST unit (UQC) list, default PCS, a "unit" column in the product upload. The shop form
refuses a GSTIN shop with no address; billing a GST shop with no address is blocked (new guard). Optional
`Shop.deliveryAddress`, printed as "Ship to" only when different. An unregistered shop on a bill ≥ ₹50,000 needs address and
state. `Invoice.billTo` snapshot so an old bill never changes when the shop is edited (new guard).

**10 (2f) Rule 46 bill contents**
1. Supplier: name, address, GSTIN, state and code, phone.
2. Heading TAX INVOICE; CANCELLED band when cancelled. Credit notes keep the Rule 53 layout with the same copy labels, unit and HSN summary.
3. Invoice number unique, consecutive, ≤16 characters, letters/digits/"/"/"-" only; date dd-mm-yyyy.
4. Bill to: name, address, GSTIN or "Unregistered", state and code; Ship to when different; place of supply (state + code) always; reverse charge "No".
5. Line columns: No, Item, HSN, Qty, Unit, Free, MRP, Rate, Gross value (qty × rate), Disc % and Disc ₹, Taxable, CGST % and ₹, SGST % and ₹ (or IGST % and ₹ for another state), Line total; batch/expiry as a small second line.
6. HSN-wise summary, one row per HSN + rate: taxable, CGST, SGST (or IGST), total tax; totals row.
7. Totals box: gross, discount, taxable, CGST, SGST or IGST, round-off, grand total, amount in words, scheme savings, previous balance, total due.
8. Authorised signatory line; "Goods received in good condition".
9. Copies: ORIGINAL FOR RECIPIENT, DUPLICATE FOR TRANSPORTER, TRIPLICATE FOR SUPPLIER, one page each; printing any copy marks the bill printed once; a reprint never moves the printed time.
10. E-invoice IRN/QR out of scope for Part 2 (flagged to the GST specialist).
Done when: in-state shows CGST+SGST per line and in the summary, other-state IGST only, never both; line taxable + tax = line
total; summary rows add to bill totals to the paisa; two products with the same HSN and rate make one summary row; a
₹1,23,45,678.90 bill fits and words read "Crore …"; a ₹0 bill prints; a 40-line bill breaks across pages with the header repeated
and totals only on the last page; a cancelled bill shows the band on every copy; a bill made at 11:50 pm and printed after midnight
shows the bill date.

**2g** The bill opens as a card: bill no, date, shop, lines, taxable, tax, round-off, total, status. Buttons: View full bill
(read-only Rule 46 view, works offline), Edit (only when `billChangeBlock` allows; plain reason when not), Print, Cancel.

**11 (2h)** Settings → Shops: list, search, edit, add, deactivate; the old place keeps a shortcut for one release. Template:
header, one example row, notes. Upload checks first (bad GSTIN, missing address for a GSTIN shop, duplicate name+area, bad phone,
non-numeric values); bad rows listed with the reason, good rows saved. Matching by GSTIN, then phone, then name+area, so the same
file twice makes no duplicates. TESRAX reads a shop file; new shops saved `approved = false`, yellow, one-tap approve; not
billable until approved.

**11a (2i)** Delivery → "Select shops": search, beat filter, tick each shop or the whole beat (visible shops of that beat only) →
"Plan route". Plan covers only bills pending for the ticked shops. Ticks kept for today, empty tomorrow. Nothing ticked = today's
plan of all pending bills. A shop with a bill already on a trip shows "already on a trip".

**13 (2j)** Load sheet: van, driver, date, stops in order with bill numbers and values, product-wise total (unit, qty, free qty;
duplicate lines added together), total bills and value, signature lines. Cancelled bills excluded; a bill moved to another van
moves its goods between sheets. One A4 page up to 25 stops, then continues with the header repeated. The driver sees only his van
(view only — Q2).

**11b (2k, 2l)** New table `externalBills`: shop, bill no, date, amount, items, source file, status, van, trip, stop no, uploaded
by. Counts as a shop due (outstanding, ledger, Collection), never as sales, GSTR-1 or a Hanubix bill number. The same shop + bill
no + date twice is refused; amount ≤ ₹0 refused.
- 2k: Delivery → "Outside bills", or send PDFs to TESRAX. Table: file, shop (matched, or unknown in yellow), bill no, date,
  amount, items. Unknown shop: pick an existing shop or add a new one (goes to approval). Unreadable rows stay listed with "type it
  in". Read amount ≠ sum of items → warning.
- 2l: "Plan these" splits matched bills across vans by capacity with nearest-stop order; the owner can move a stop (earlier,
  later, other van, tomorrow). Approve makes load sheets and trips; one trip can hold Hanubix bills and outside bills. Overflow →
  "tomorrow". A double tap on Approve makes one trip set. Amounts go to Collection at approve. After approve the amount changes
  only by an owner edit with a reason. Sales and GSTR-1 totals never change. Short delivery lowers the due directly (Q1).
Done when: a file already read on the phone uploads offline and syncs later; a bill keeps the date printed on it, not the upload
date; 200 PDFs read one by one with progress and the screen stays usable.

## TESRAX (English first; answers in place, Download where there is a file)
"orders received", "download orders", "open order <shop>", "change qty of <product> to 12 in order <shop>", "verify picked",
"discount 5 percent on <product>", "show bill <no>", "print bill <no> copies 3", "bill reports", "select shops beat <name>",
"plan route", "add van …", "change driver of Van 1 to …", "delete Van 2", "load sheet van <name>", "print load sheet",
"upload shop file", "upload outside bills", "outside bills for today", "plan outside bills".

## Open for the systems engineer
- Reading PDFs offline: reuse the purchase-bill reader if there is one; scanned PDFs need that reader or typing.
- Adding `externalBills` to shared/tables.json (server + phone + tables test).
- Server-side line numbers for lots when the same product is on two lines.
