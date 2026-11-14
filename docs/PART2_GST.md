# Part 2 — GST & accounts rules (gst-accounts-specialist, 14 Nov 2026) — binding with PART2_SPEC / _UX / _SYSTEMS
Basis: CGST Rules 46/53, Sec 15(3), 31, 34, Rule 46A, Notification 78/2020 (HSN digits), e-invoice limit. Rule texts from the
specialist's knowledge (web search gave links only): confirm the HSN-digit and e-invoice lines on cbic-gst.gov.in before release.

## 1. Printed bill (2f) — changes to the spec list
- Supplier state name + code; phone optional.
- Unregistered shop: print "Unregistered" (URP). State + code required only for bills ≥ ₹50,000 (Rule 46) or another state; for
  smaller B2C bills fill the state from the shop anyway.
- Place of supply: state name + code (Tamil Nadu – 33). Never CGST/SGST and IGST on one bill.
- Reverse charge "No" as a line, not a column.
- Round-off: its own line; tax parts + round-off = grand total to the paisa; round-off never enters taxable value or the HSN summary.
- MRP: an extra column only; never replaces rate or taxable value.
- "Authorised signatory" required; "Goods received in good condition" optional (must not contradict short delivery).
- UQC code beside the quantity; the same code in GSTR-1 and the HSN summary.
- Free goods: free qty with value 0; no zero-tax scheme line.
- Grand total in words: keep.
- Cancelled bills keep number + date with the CANCELLED band (Sec 34, Rule 46A); never deleted.
- Copies: Original for recipient / Duplicate for transporter / Triplicate for supplier — D4 correct; "printed once" fine.
- HSN digits: 4 up to ₹5 crore turnover, 6 above (the distributor's turnover decides). D5 warn-only OK for Part 2.
- E-invoice: out of scope only while aggregate turnover in any year since 2017-18 ≤ ₹5 crore. Add a setting/warning
  "Turnover above ₹5 crore: IRN and QR are mandatory"; a distributor over the limit without IRN never gets a bill printed as final.

## 2. Invoice numbering — REAL BUG (checked in code)
- The counter does NOT restart each financial year: server app.ts ~188–191 uses one `tenants.next_bill_no`; billing.ts ~77–78 only
  puts finYear(date) in the text; credit notes (`next_cn_no`) and receipts the same. 17 characters at 100,000 total bills.
- Rule: serial unique per financial year, ≤ 16 characters, letters/digits/"/"/"-" only. Restarting each FY is allowed and standard.
- Decision: restart on 1 April (Indian date, per tenant) per series (bill, credit note, receipt); counter stored per tenant + FY +
  kind, issued atomically (add-only migration; old numbers untouched).
- Format: `P/YY-YY/NNNNNN` with prefix 1–3 characters and the counter padded to 6 digits: 3+1+5+1+6 = 16 → 999,999 bills a year.
  A 4-character prefix pads to 5 digits and the server refuses beyond 99,999 (refuse, never truncate). The server issue endpoint
  rejects any number over 16 characters. YY-YY in the text keeps a new FY from repeating an old number.

## 3. D2 free pieces on duplicate lines — acceptable
- Free goods under a scheme with no separate consideration: shown on the invoice with qty and zero value (Sec 15(3)(b)) → no tax.
- Free qty worked out once on the combined paid qty and shown on line 1 is fine, provided each line's taxable value covers only its
  own paid qty. HSN summary: qty includes free pieces, taxable value does not. Free pieces carry the paid product's HSN and rate.
- A free item that is a different product = its own line with its own HSN and rate.
- Short delivery of a free piece: credit note reduces free qty only, taxable 0.

## 4. Discount % per line
- Sec 15(3)(a): a discount before/at supply is excluded from value only if recorded on the invoice — print Disc % AND Disc ₹ per line.
- Tax on (gross − discount), rounded per line to the paisa; ₹ is the legal figure; store both so an old bill prints the same.
- A discount after supply needs a credit note (Sec 34(1)); a % edit after billing never changes a printed bill — after printing:
  cancel and re-issue, or a credit note.

## 5. Outside bills (11b)
- Fine in principle: the issuer's own invoice is their GST document; our sales and GSTR-1 exclude it.
- Short delivery: our due goes down, but keep reason, short amount, who delivered, original bill no; export a "Short delivery
  report" for the issuer (never call it a credit note).
- Money collected on outside bills is "collected on behalf of": never our turnover, P&L, own-bill outstanding or receivables
  ageing; separate ledger head "Dues collected for other suppliers" so the owner sees what he must hand over.
- Say clearly in the app: outside bills are not Hanubix sales.
- Owner edits with a reason → audit row.
- Duplicate check = shop + bill no + date + issuer name/GSTIN (two suppliers can share a bill number). The deterministic id in
  PART2_SYSTEMS.md must include the issuer.

## 6. Item 34 — same product, two lines, different rates
- Allowed. GSTR-1: rate-wise per invoice; same rate merges into one rate row; different tax rates stay separate.
- HSN summary: one row per HSN + UQC + rate, built from invoice lines (never a map keyed by productId — check the code); qty and
  taxable add across lines. Test: two lines, same product, different rates → HSN totals = bill totals to the paisa.
- Round tax per line, then sum; compare to the bill total. Different unit or tax rate on the same product → separate HSN rows.

## Worked example (intra-state TN, HSN 1905 at 18%, two lines of one product)
Line 1: 10 pcs × ₹100, Disc 5% = ₹50.00, taxable ₹950.00, CGST 9% ₹85.50, SGST 9% ₹85.50, line total ₹1,121.00.
Line 2: 5 pcs × ₹90, no discount, taxable ₹450.00, CGST ₹40.50, SGST ₹40.50, line total ₹531.00.
Bill: taxable ₹1,400.00, CGST ₹126.00, SGST ₹126.00 = ₹1,652.00, round-off 0.00, total ₹1,652.00.
HSN row: 1905, 18%, qty 15, taxable 1,400.00, CGST 126.00, SGST 126.00, tax 252.00. With a scheme of 2 free on the combined 15:
line 1 prints Free 2 at value 0; HSN qty 17, taxable still 1,400.00.
