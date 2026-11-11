# Hanubix quality framework

No software can promise zero bugs. This framework makes sure a bug is **caught before it reaches a distributor**,
and that if one ever slips through, **it can't corrupt money, stock or bill numbers** and the person sees a plain message.

There are six layers. Every change goes through all of them.

## 1. Guards — impossible data is never saved
Every save in the app goes through `ChangeSet.commit` (`app/src/core/db.ts`). Before anything is written, `guard()`
checks the final state of every record. If one rule breaks, **nothing** in that save is written (one transaction).

| Rule | Message the person sees |
|---|---|
| Stock is a whole number and never below zero | "Not enough stock for this…" |
| A bill number is never used twice | "Bill number … is already used" |
| A credit-note number is never used twice | "Credit note number … is already used" |
| Bill amounts are real numbers, total never negative | "Bill amount … is not a valid number" |
| Pieces on a bill line are never negative | "A bill line has an invalid … quantity" |
| A payment is more than zero and never split for more than it is | "Payment amount must be more than zero" |
| Expense amounts are valid, order quantities are valid | — |
| A bill's credit notes together never come to more than the bill charged | "Credit notes on bill … would come to ₹… — more than the ₹… it charged" |
| Every money amount, in every table (and inside lines), is a real number | "Money amount … is not a valid number" |
| The same company bill number is never entered twice for one company | "Company bill … of this company is already entered" |
| The bill number prefix is 1–4 letters or digits | "Bill number prefix: 1 to 4 letters or digits only" |

**New rule = add it to `guard()` + add a test in `tests/regressions.test.ts`.**

## 2. Crash safety
`app/src/ui/Safety.tsx`
- A screen that crashes shows "This screen hit a problem — your data is safe" with **Try again / Go home**. The rest of the app keeps working.
- A button whose action fails shows the reason ("Not saved: …"). It never fails silently.
- Every error is kept in a log on the phone (last 50) and included in **More → Download full backup** for support.

## 3. The money & stock laws (chaos test)
`app/tests/laws.test.ts` plays random business days: orders, picking, billing with double taps, planning, deliveries
(short, damaged, refused, extra, double taps), trip ends, day-close differences, payments, shop returns (credit notes), cancels (twice) and undo of
random past actions. **After every single action** it checks:

1. **Stock is conserved.** Every piece is in exactly one place: on the shelf, out on a live bill, or written off as van damage.
2. No stock count is negative or fractional.
3. No bill number and no credit-note number repeats.
4. Every bill adds up: tax parts + round-off = total; line taxables = bill taxable.
5. An order is billed at most once.
6. No bill shows a negative balance, and no money is lost: billed − credited − received = still owed (− shop advance).
7. A bill's credit notes never come to more than it charged, and never credit more paid pieces than a line billed.
8. Claim lines follow their bill: a cancelled bill keeps no live scheme claim line.

If a law breaks, the test prints the seed and the last 15 actions so the exact bug can be replayed.
Proven to work: a deliberately planted stock bug was caught within 36 actions.

- Quick (inside the gate): 6 random days × 400 actions.
- Deep: `npm run test:chaos` (20 days × 1,000 actions). Run before every demo or release.

## 4. The release gate — `cd app && npm run gate`
| Step | What it proves |
|---|---|
| 1 Type check | No broken code paths |
| 2 Tests in UTC | Logic is right on a server clock |
| 3 Tests in Indian time + chaos laws | Logic is right on a phone in India, including 00:00–05:30 |
| 4 Build | It ships |
| 5 Business day end to end (`e2e/flow.cjs`) | Every role can do the full day: order → approve → pick → bill → plan → deliver (short, photos) → collect (QR) → day close → reports. Any page error or console error fails it. |
| 6 Every screen, every role at 360 px (`e2e/sweep.cjs`) | 111 screens: no crash, no sideways scroll, no cut-off text, nothing off screen, no leftover light backgrounds, all text readable (contrast ≥ 3:1) |

Screens and the sweep report are saved in `app/e2e/out/` so anyone can look.

## 5. Automatic checks on GitHub
- `.github/workflows/quality.yml` runs the full gate (and the server tests) on **every push and pull request**.
- `.github/workflows/deploy.yml` runs the gate first; **if it fails, nothing deploys**.
- On failure the screenshots are attached to the run.

## 6. Definition of done (for every change, by anyone — including Claude)
A change is done only when **all** of these are true:
- [ ] Business logic lives in `src/core`, never inside a screen (so tests can reach it).
- [ ] Every save goes through `ChangeSet` (so guards and undo always apply).
- [ ] Dates use `today()` / `daysFrom()` / `ymd()` / `monthEnd()` from `core/db.ts` — never `toISOString()` for a date.
- [ ] Any number kept in two places has one owner and a law in the chaos test.
- [ ] Every action is safe to tap twice (lock while saving, re-read the record, refuse if already done).
- [ ] New logic has tests for the awkward cases: double tap, undo afterwards, cancel after delivery, after midnight IST.
- [ ] Any bug found gets a test that fails before the fix and passes after (`tests/regressions.test.ts`).
- [ ] `npm run gate` passes locally.
- [ ] For a release or demo: `npm run test:chaos` passes, and a reviewer who did not write the code has checked it.
