# Part 2 — UX decisions (ux-designer, 14 Nov 2026) — the developer follows these with docs/PART2_SPEC.md

## Global
- No sideways scroll at 360 px: every editable bill table (2b, 2c, 2d) = stacked cards, one card per line.
  Line 1 "1. Product name" (14 semibold) + round Remove X (44 px). Line 2: boxed Qty, Rate, Disc % (11 px labels above, 44 px high,
  inputMode decimal, tap selects text). Line 3: "Unit · GST 12%" (12 grey) left, line Amount (jade 16) right.
- Sticky footer: Taxable, Tax, Round-off, Total (jade 20); primary button under it.
- One money-entry mode: Disc % with "= ₹50.00" small grey under the box; no ₹/% toggle. Old ₹-only lines show "₹50 off"
  read-only; tapping it switches the line to Disc %.
- Every save/approve/bill/cancel/print button disables on first tap and shows "Saving…" (double tap = one).
- Money/stock actions confirm in a bottom sheet with two big buttons ("Cancel bill" / "Keep bill"); Undo bar ~8 s where allowed.
- Offline: small grey "Saved on this phone. Will send when network returns" — never a red error.
- Errors: what happened + what to do ("Order already approved by Ravi. Pull down to refresh.").
- Words: Shop (not outlet/customer), Bill, Outside bill, Van, Due.

## 2a Order + vans
Sales before Bill; Sales has "Sales reports"; no gap without the Sales licence. Vans at Menu > Delivery > Vans. Add van: Name,
Number, Driver (picker), Capacity "Cases per trip" (help: "Leave empty for no limit"); Kind = 3 chips, default last used.
Delete: "Delete Van 2?"; with history the button is "Hide van" + "Old trips keep its name"; blocked: "Van 2 has a trip open.
Finish it first"; duplicate: "Number already used by Van 1"; empty: "No vans yet. Add your first van". Driver: no van edit.

## 2b Orders received
Entry: Home > Orders received or TESRAX. List: one card per shop (name, lines, ₹ total, chip New / Needs OK) → tap opens the
stacked editor with the shop history strip on top. Bottom: "Add product" (search + 1-tap last 5 products of this shop), sticky
"Approve", "Cancel order" in the overflow. Excel and "Bill reports" are small header-menu buttons on the list. Approve = one tap,
no confirm, "Approved. Sent to godown" + Undo (until Verify). Last line removal: "An order needs at least one item. Cancel the
order instead" + "Cancel order". Second phone: "Already approved by <name>", card read-only grey. Salesman's original qty as a
small "Ordered 10" note under the line.

## 2c Verify picked
Label "Verify picked" only. Card row "Ordered 10 · Picked [8]"; short = red "2 short", extra = amber "2 extra"; Picked box first
and biggest, defaults to Ordered; "Verify all" for a full match. Godown sees Ordered/Picked only (no rate/Disc %). One button
"Make bill"; disabled with the reason ("Stock short for X") when the stock guard blocks.

## 2d Disc % + same product twice
Adding a product already on the bill: yellow note "Already in bill (line 2)" with "Add to line 1" (primary, default) and "Keep as
new line". Cards numbered ("1. Parle-G", "2. Parle-G"). Purchase and non-sales screens keep merging silently. Free pieces once on
line 1; line 2 shows "Free: included in line 1". Disc % 0–100 ("Discount can't be more than 100%"). Shortage/credit-note pickers
show "Parle-G · line 2 · ₹10".

## 2e / 2f Printed bill
Unit: chip row PCS, BOX, KGS, LTR, PAC, DOZ, BAG, CTN + "More…" (full UQC list); default PCS; blanks accepted in upload.
GSTIN shop without address blocked at the shop form ("Add the shop address. It is needed on a GST bill"); billing such a shop:
"Shop address missing. Add it" + "Add address" (to the shop and back to the bill). "+ Different delivery address" collapsed link
on the shop form. Unregistered ≥ ₹50,000 asks address + state inline. Print: three copy tick-boxes (all ticked), button "Print 3
copies" (count follows). The Rule 46 view on the phone = fixed-width A4 preview scaled down with pinch zoom (never reflowed into
cards). Cancelled = red CANCELLED band.

## 2g Bill card
5 rows: bill no + date, shop, "N items", Total (jade 20), status chip; taxable/tax/round-off under "Details". Buttons: "View full
bill" (primary), "Print", "Edit", "Cancel bill" (overflow). Blocked Edit shows the reason on the button ("Can't edit. Already
delivered"). Cancel: sheet + reason chip + Undo.

## 2h Settings > Shops
Menu > Shops (old place keeps a shortcut one release). Search + "+ Add" on top. Upload in one screen: "Download template" →
"Choose file" → result "42 saved · 3 need fixing", bad rows "Row 7: GSTIN is wrong", "Download bad rows"; good rows saved without
asking again. New unapproved shops yellow with "Approve"; bulk "Approve all N" with confirm. TESRAX: drop the file in TESRAX → same
result in place. Empty: "No shops yet. Add one or upload a file".

## 2i Select shops
Plan route opens with a collapsed bar "All pending bills (12)" (optional; nothing ticked = whole plan). Tap → full-height list,
beat chips in a horizontal row, 56 px tick rows "Shop name · ₹ due bill", chip "Select all in <beat>". No bill = greyed "No bill
waiting" (not tickable); already on a trip = "Already on a trip". Sticky "Plan route (5 shops)" + note "Ticks clear tomorrow".

## 2j Load sheet
Delivery > Vans > van > "Load sheet". Office/godown: View + Print; driver: View only, big-type stops in order. View = stops, then
product totals with Qty and Free in separate columns. Empty: "No bills on this van today". Date always at the top.

## 2k / 2l Outside bills
Delivery > Outside bills; one primary "Upload PDF bills" (multi-select picker). Results as cards: file, shop, bill no, date, ₹.
Unknown shop yellow with "Pick shop" / "Add new shop" (fixed in place); unreadable: "Couldn't read. Type it in". Amount ≠ items:
amber "Amount differs from items by ₹X" (never blocks). Progress "Reading 37 of 200", screen usable, Cancel available. Duplicate:
"Already uploaded on <date>". Offline: "Saved. Will read when network returns". "Plan these": one card per van (stops, cases,
"n of 25"); each stop "Move" → sheet Earlier / Later / Other van / Tomorrow (no drag and drop); overflow in a "Tomorrow" card.
Approve sheet "Make N load sheets and M trips for Van 1…?" → "Done. Open load sheets". In Collection: "Outside bill", never
"Invoice". Short delivery: "Due lowered by ₹X", no credit note.

## TESRAX
Every reply says what it did + the next step ("Changed Parle-G to 12 in Sri Ram order. Say 'approve order Sri Ram'"). Close name
matches confirmed by a one-tap chip, never a typed "yes". Accept messy forms: "ordrs recvd", "show ordrs", "disc 5% parle g",
"5 per discount", "bill 123", "prnt bill 123 x3", "vans", "add van TN31 driver ravi", "load sheet van 1", "plan rout",
"shops beat main road". Can't tell: "I didn't get that. Try: 'open order Sri Ram'". File answers carry a Download button.
