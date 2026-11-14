# Part 2 — systems design decisions (systems-engineer, 14 Nov 2026) — binding for the developer with PART2_SPEC.md / PART2_UX.md
Verdict: fine to build with these changes. Risks: R1 old phones + duplicate lines; R2 no PDF library in the app yet.

## Sequence change
- **2a0 (new, before 2b):** line-number data shape — `OrderLine.line?`, `picked.line?`, shortage `line?`, helper
  `lineOf(l, i) = l.line ?? i+1`, server rule that keeps stored line numbers. 2d then adds only duplicate lines, Disc %, stock-once.
- Number-length check goes into 2e/2f; the add-only server migration into 2k.
- Feature flag: duplicate lines switch on only after phones update (R1).

## Data
- `line?: number` on OrderLine and picked rows = stable id 1,2,3… (never reused, not an array index; 2b can remove lines).
  Shortages: `line?` = index into Invoice.lines (same meaning as CreditNoteLine.line). InvoiceLine gets no new field; bill lines
  are never reordered. Old rows without `line`: the first unused line of that product. All matching through `lineOf` — no migration.
- Server (R1): an incoming order with no `line` values while the stored one has them, same product list → keep the stored numbers
  (same pattern as `linesNoLots` in server rules.ts). Duplicate-product lines allowed only on `invoices` and on `orders` whose
  source is not `company`; a guard refuses them elsewhere (purchases, GRN, company orders).
- Optional fields, no Dexie bump: Product.unit (UQC; missing = PCS via `uqcOf()`), Shop.deliveryAddress, Van.capacity (cases per
  trip), Van.active (missing = true), Invoice.billTo {name, address, gstin, stateCode}, per-line discountPct.
- billTo set at billing time, never backfilled; old bills fall back to the live shop; a guard: once set it never changes.
- dayPlans already syncs; id `plan:{date}:{staffId}`; writers owner + office; salesmen/drivers read only.
- **externalBills** (new): id, shopId, billNo, date (printed on the bill), amount, items[] {name, qty, rate, amount}, fileName,
  fileHash, status, vanId, tripId, stopNo, uploadedBy, delivery? {at, by, shortAmount}, editReason?.
  Deterministic id `eb:{shopId}:{billNo}:{date}` (two phones converge; duplicates refused for free). The PDF never syncs (stays on
  the phone; name + hash only). Dexie v13: `externalBills: ${common}, shopId, date, status, vanId`. Add to shared/tables.json,
  app/tests/tables.test.ts, the server tables test and role lists. Read: owner, office, godown, driver. Write: owner, office;
  driver may change only `delivery` and `status` (enforced on the server). Amount owner/office only; an edit needs editReason +
  an audit row. Server: `amount` in MONEY_REQUIRED (rules.ts), refuse amount ≤ 0. Migration `014_external_bills.sql`: partial index
  on (tenant_id, data->>'shopId') where tbl = 'externalBills' (add only). Old phones: the `knows` filter already hides the table.

## Stock (same product on two lines)
- Out once per product per bill: allocate lots first-expiry-first over the combined qty, then hand lots to the lines in order;
  each line's `batches[]` unchanged. stockMoves ids `mv:{invoiceId}:{batchId}` (double tap/retry = one movement). Cancel/return
  reverse per batch from the invoice lines, once.
- Extend: stock check sums qty per product across lines; picked qty per line ≤ ordered; credit-note/shortage qty per line ≤ line
  qty; line totals add to bill totals; stock conservation law in the chaos test with duplicate lines; the server applies the same
  per-product sum. D2 (free pieces on duplicate lines) — GST specialist confirms.

## Outside PDF bills (R2)
- readers.ts reads Excel/CSV only; scan.ts sends PDFs/photos to the server AI scan (online, paid per call).
- Plan: add pdfjs-dist, lazy-loaded, to read the text layer on the phone (offline, free), parsers in code for bill no, date, amount,
  items. No text layer (scanned) → saved "unread", queued for TESRAX Scan when online, or typed in. One file at a time with
  progress. AI only reads; code validates; a person approves. Developer checks pdfjs size and the Android WebView worker first.

## Scale (100k distributors)
- externalBills up to ~2–10 M rows/day worst case: fine with the index. Phones pull only open bills + last 60 days (date-window
  scope + retention). Never sync PDFs.
- Load sheets computed on the phone from that day's invoices + externalBills for the van; nothing stored or synced.
- Select shops: shops is a paged BIG_TABLE — query beat/search on the phone with an index, max 200 rows shown; "tick whole beat"
  ticks only the visible shops of that beat.

## Rule 46 number ≤ 16 characters
- Format PREFIX(1–4)/YY-YY/NNNNN = 16 only up to 99999; bill 100000 → 17. Server regex allows 9 digits.
- Enforce at issue in the server number endpoint (app.ts ~189): refuse over 16 or characters outside letters, digits, "/", "-".
  Phone: keep the prefix guard (db.ts ~240) + whole-number length/character check for NEW invoices, credit notes, receipts only.
  Server `numberIssued`: same check for new documents only. Existing numbers untouched.
- Open (GST specialist): what after 99999 bills — does the counter reset each financial year?
