// Round 4 (ease of use, UX Designer's findings, 11 Nov 2026). Each case was a real miss found by using the app as
// the owner, the salesman, the godown and the driver. Logic only; the screen behaviour is checked in e2e/flow.cjs.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ChangeSet, daysFrom, db, setSession, today } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle, type Reply } from '../src/core/engine';
import { commit, validate, hasErrors, type Proposal } from '../src/core/proposals';
import { showDay } from '../src/core/i18n';
import { describeSave } from '../src/core/db';
import { differenceMoney } from '../src/core/pipeline';
import { countedVisit } from '../src/core/field';
import type { Invoice, Role, Visit } from '../src/core/types';

const ids: Partial<Record<Role, string>> = {};
let goodDay = '';
beforeAll(async () => {
  await seedDemo();
  for (const s of await db.staff.toArray()) ids[s.role] ??= s.id;
  goodDay = (await db.products.toArray()).find(p => /^Good Day/.test(p.name))!.id;
});
beforeEach(() => setSession('demo', ids.owner!));
const as = (r: Role) => setSession('demo', ids[r]!);
const say = (t: string, last?: Reply) => handle(t, [], { last });
const field = (p: Proposal, k: string) => p.fields.find(f => f.key === k);
const stock = async (pid: string) => (await db.batches.where('productId').equals(pid).toArray()).reduce((a, b) => a + b.qty, 0);

describe('leave by TESRAX (item 2)', () => {
  it('"Ravi leave approve" opens Payroll → Today; it never saves a new leave with reason "approve"', async () => {
    const before = await db.leaves.count();
    const r = await say('Ravi leave approve');
    expect(r.go).toBe('today');
    expect(await db.leaves.count()).toBe(before);
    expect((await say('ok Ravi leave')).go).toBe('today');
  });
  it('"nalaiku leave" is tomorrow, shown as a table with the date in words, saved only on ✓', async () => {
    as('salesman');
    const before = await db.leaves.count();
    const r = await say('nalaiku leave');
    expect(r.proposal?.kind).toBe('leave');
    expect(await db.leaves.count()).toBe(before); // nothing saved before ✓
    expect(r.proposal!.rows[0].from).toBe(daysFrom(1));
    expect(r.text).toContain(showDay(daysFrom(1)));
    expect(String(field(r.proposal!, 'reason')?.value)).not.toMatch(/nalaiku/i);
    expect(hasErrors(await validate(r.proposal!))).toBe(false);
    await commit(r.proposal!);
    const l = (await db.leaves.toArray()).find(x => x.staffId === ids.salesman && x.from === daysFrom(1))!;
    expect(l.status).toBe('waiting');
    await expect(commit(r.proposal!)).rejects.toThrow(/already/); // a second tap saves nothing more
  });
  it('"inniku leave" is today; a weekday is the next one', async () => {
    as('godown');
    expect((await say('inniku leave')).proposal?.rows[0].from).toBe(today());
    const r = await say('leave monday fever');
    expect(new Date(`${r.proposal!.rows[0].from}T12:00:00`).getDay()).toBe(1);
    expect(field(r.proposal!, 'reason')?.value).toBe('fever');
  });
  it('no day said: TESRAX asks "Which day?" and never takes today; the answer completes it', async () => {
    as('delivery');
    const before = await db.leaves.count();
    const r = await say('leave pls');
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/Which day/);
    expect(await db.leaves.count()).toBe(before);
    const r2 = await say('tomorrow', r);
    expect(r2.proposal?.kind).toBe('leave');
    expect(r2.proposal!.rows[0].from).toBe(daysFrom(1));
  });
  it('the owner gives leave to staff: approved, for that person', async () => {
    const r = await say('Karthik leave tomorrow');
    expect(r.proposal?.kind).toBe('leave');
    await commit(r.proposal!);
    const l = (await db.leaves.toArray()).find(x => x.staffId === ids.delivery && x.from === daysFrom(1))!;
    expect(l.status).toBe('approved');
  });
});

describe('a stock count only when a count is said (item 3)', () => {
  it('"good day 5 udanjiruchu" is damage for the claim, never a count that wipes the stock', async () => {
    as('godown');
    const before = await stock(goodDay);
    for (const w of ['udanjiruchu', 'udanju', 'odanju', 'kizhinjiruchu']) {
      const r = await say(`good day 5 ${w}`);
      expect(r.proposal?.kind, w).toBe('claim');
      expect(r.proposal!.rows[0].productId).toBe(goodDay);
      expect(r.proposal!.rows[0].qty).toBe(5);
    }
    expect(await stock(goodDay)).toBe(before);
  });
  it('a product and a number with no count word: "Did you mean 5 Good Day damaged?"', async () => {
    as('godown');
    const r = await say('good day 5');
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/^Did you mean 5 Good Day .*damaged\?/);
  });
  it('"irukku" is a count', async () => {
    as('godown');
    const r = await say('good day 990 irukku');
    expect(r.proposal?.kind).toBe('stockFix');
    expect(r.proposal!.meta.target).toBe(990);
  });
  it('a count more than 1 case off needs the number typed again before Approve, also at save time', async () => {
    as('godown');
    const r = await say('good day count 5');
    expect(r.proposal?.kind).toBe('stockFix');
    const p = r.proposal!;
    expect(field(p, 'again')).toBeTruthy();
    const v = await validate(p);
    expect(v.fieldErrors.again).toMatch(/again/);
    await expect(commit(p)).rejects.toThrow(/again/);
    const wrong = { ...p, fields: p.fields.map(f => f.key === 'again' ? { ...f, value: 50 } : f) };
    expect(hasErrors(await validate(wrong))).toBe(true);
    const ok = { ...p, fields: p.fields.map(f => f.key === 'again' ? { ...f, value: 5 } : f) };
    expect(hasErrors(await validate(ok))).toBe(false);
    const cs = new ChangeSet(); void cs; // the count itself is saved by the laws as before
    await commit(ok);
    expect(await stock(goodDay)).toBe(5);
  });
  it('a small difference (1 case or less) needs no second typing', async () => {
    as('godown');
    const sys = await stock(goodDay);
    const r = await say(`good day count ${sys - 3}`);
    expect(field(r.proposal!, 'again')).toBeUndefined();
    expect(hasErrors(await validate(r.proposal!))).toBe(false);
  });
});

describe('the Undo bubble names the shop and the amount (item 4)', () => {
  it('a bill, a payment and an order say what was saved', () => {
    const inv = { id: 'i1', number: 'SMD/1', shopId: 's1', total: 3743, deliveryStatus: 'pending' } as unknown as Invoice;
    expect(describeSave('Verified', [{ table: 'invoices', rec: inv }])).toEqual({ verb: 'Billed', shopIds: ['s1'], amount: 3743, count: 1 });
    expect(describeSave('Collection', [{ table: 'payments', rec: { id: 'p', shopId: 's2', amount: 500 } }])).toEqual({ verb: 'Collected', shopIds: ['s2'], amount: 500, count: 1 });
    expect(describeSave('Salesman order', [{ table: 'orders', rec: { id: 'o', shopId: 's3', lines: [] } }, { table: 'visits', rec: { id: 'v' } }]))
      .toEqual({ verb: 'Order', shopIds: ['s3'], amount: undefined, count: 1 });
    expect(describeSave('Trip started', [{ table: 'trips', rec: { id: 't' } }])).toBeNull();
    // a bill moving on (planned, out on a trip) is not a new bill: the bubble keeps the plain label ("Trip started")
    expect(describeSave('Trip started', [{ table: 'trips', rec: { id: 't' } }, { table: 'invoices', rec: { ...inv, deliveryStatus: 'out' } }])).toBeNull();
    expect(describeSave('Delivery plan confirmed', [{ table: 'invoices', rec: { ...inv, deliveryStatus: 'planned' } }])).toBeNull();
    expect(describeSave('Trip ended', [{ table: 'invoices', rec: { ...inv, createdAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-11T10:00:00.000Z' } }])).toBeNull(); // back to the pool
  });
});

describe('day close differences say what each choice does (item 16)', () => {
  it('the credit note gives back the short pieces; the bill stays', async () => {
    const inv = (await db.invoices.toArray()).find(i => !i.cancelled && i.lines.length)!;
    const l = inv.lines[0];
    const per = l.total / l.qty;
    const fake: Invoice = { ...inv, delivery: { at: '', by: '', shortages: [{ productId: l.productId, qty: 2, reason: 'Not loaded / short' }], excess: [] } };
    const m = await differenceMoney(fake);
    expect(m.back).toBeCloseTo(2 * per, 0);
    expect(m.becomes).toBeCloseTo(inv.total - m.back, 1);
  });
});

describe('a rep\'s visit counts only when something was done there (item 22)', () => {
  it('opening a shop is not a visit; an order, a no-order reason or a shelf photo is', () => {
    const base = { id: 'v', shopId: 's', staffId: 'r', date: today(), at: '' } as Visit;
    expect(countedVisit(base)).toBe(false);
    expect(countedVisit(undefined)).toBe(false);
    expect(countedVisit({ ...base, outcome: 'order' })).toBe(true);
    expect(countedVisit({ ...base, outcome: 'no_order', reason: 'Shop closed' } as Visit)).toBe(true);
    expect(countedVisit({ ...base, photo: 'data:x' } as Visit)).toBe(true);
  });
});
