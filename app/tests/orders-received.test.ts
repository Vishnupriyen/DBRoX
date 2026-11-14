// Part 2 step 2b, item 8 (docs/PART2_SPEC.md, PART2_UX.md): Orders received = an editable order. Qty, rate and Disc % change,
// products are added or removed only while the order is new / needs OK; the salesman's original lines are kept; every edit is
// in the activity log; removing every line is refused; Approve is one tap with Undo until the godown packs it; the Excel and
// the screen show the same totals to the paisa.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ChangeSet, db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { approveOrder, approvePicked, bookOrder, pickOrder } from '../src/core/pipeline';
import { editOrder, orderActivity, orderView, ordersSheet, undoApprove } from '../src/core/orderEdit';
import { billLine } from '../src/core/billing';
import type { Order, Product, Shop } from '../src/core/types';

let owner = '', office = '', shop: Shop, ps: Product[] = [];
beforeAll(async () => {
  await seedDemo();
  const st = await db.staff.toArray(); owner = st.find(s => s.role === 'owner')!.id; office = st.find(s => s.role === 'office')!.id;
  shop = (await db.shops.toArray()).find(s => s.approved)!;
  const stock = new Map<string, number>(); for (const b of await db.batches.toArray()) if (b.qty > 0) stock.set(b.productId, (stock.get(b.productId) ?? 0) + b.qty);
  const cos = new Set<string>();
  ps = (await db.products.toArray()).filter(p => (stock.get(p.id) ?? 0) > 50 && !cos.has(p.companyId) && cos.add(p.companyId)).slice(0, 3);
});
beforeEach(() => setSession('demo', owner));
const book = async (qty = [10, 4]) => { const cs = new ChangeSet(); const o = await bookOrder(cs, shop, qty.map((q, i) => ({ productId: ps[i].id, qty: q, rate: ps[i].rate })), owner); await cs.commit('t'); return o.id; };

describe('Disc % on a line', () => {
  it('5% on a gross of ₹1,000 = discount ₹50.00, taxable ₹950.00', () => {
    const p = { ...ps[0], gst: 18 } as Product;
    const l = billLine(p, 10, 100, [], false, { discountPct: 5 });
    expect([l.gross, l.discount, l.taxable]).toEqual([1000, 50, 950]);
  });
  it('Disc % above 100 is refused', async () => {
    const id = await book();
    const o = (await db.orders.get(id))!;
    await expect(editOrder(id, o.lines.map(l => ({ ...l, discountPct: 120 })))).rejects.toThrow("Discount can't be more than 100%");
  });
});

describe('editing an order received', () => {
  it('qty, rate and Disc % change; the original lines are kept; each edit is in the activity log', async () => {
    const id = await book();
    const o = (await db.orders.get(id))!;
    await editOrder(id, [{ ...o.lines[0], qty: 12 }, { ...o.lines[1], rate: o.lines[1].rate - 1, discountPct: 5 }]);
    const after = (await db.orders.get(id))!;
    expect(after.lines.map(l => l.qty)).toEqual([12, 4]);
    expect(after.original!.map(l => l.qty)).toEqual([10, 4]);
    await editOrder(id, after.lines.map(l => ({ ...l, qty: l.qty + 1 })));
    expect((await db.orders.get(id))!.original!.map(l => l.qty)).toEqual([10, 4]); // the salesman's, never the last edit
    const log = await orderActivity(id);
    expect(log.some(x => /qty .*10 → 12/.test(x.what))).toBe(true);
    expect(log.some(x => /Disc % .*0 → 5/.test(x.what))).toBe(true);
  });
  it('adding a product gives it the next line number; removing a line keeps the others\' numbers', async () => {
    const id = await book();
    const o = (await db.orders.get(id))!;
    await editOrder(id, [...o.lines, { productId: ps[2].id, qty: 3, rate: ps[2].rate }]);
    const a = (await db.orders.get(id))!; expect(a.lines.map(l => l.line)).toEqual([1, 2, 3]);
    await editOrder(id, [a.lines[0], a.lines[2]]);
    expect((await db.orders.get(id))!.lines.map(l => l.line)).toEqual([1, 3]);
    await editOrder(id, [...(await db.orders.get(id))!.lines, { productId: ps[1].id, qty: 1, rate: ps[1].rate }]);
    expect((await db.orders.get(id))!.lines.map(l => l.line)).toEqual([1, 3, 4]); // 2 is never reused
  });
  it('removing every line is refused: cancel the order instead', async () => {
    const id = await book();
    await expect(editOrder(id, [])).rejects.toThrow('An order needs at least one item. Cancel the order instead');
  });
  it('once approved it is no longer editable here', async () => {
    const id = await book(); await approveOrder(id);
    const o = (await db.orders.get(id))!;
    await expect(editOrder(id, o.lines)).rejects.toThrow(/already approved/);
  });
  it('the edited rate and Disc % reach the bill', async () => {
    const id = await book([10, 4]);
    const o = (await db.orders.get(id))!;
    await editOrder(id, [{ ...o.lines[0], rate: 50, discountPct: 10 }, o.lines[1]]);
    await approveOrder(id);
    await pickOrder(id, (await db.orders.get(id))!.lines.map(l => ({ productId: l.productId, qty: l.qty, line: l.line })));
    const { invoices } = await approvePicked(id);
    const l = invoices.flatMap(i => i.lines).find(x => x.productId === ps[0].id)!;
    expect([l.rate, l.gross, l.discount, l.taxable]).toEqual([50, 500, 50, 450]);
  });
});

describe('approve: one tap, Undo until packed, a second phone sees who approved', () => {
  it('a double tap approves once', async () => {
    const id = await book();
    const r = await Promise.allSettled([approveOrder(id), approveOrder(id)]);
    expect(r.filter(x => x.status === 'fulfilled').length).toBe(1);
    expect((await db.orders.get(id))!.status).toBe('approved');
  });
  it('a second approve names who did it', async () => {
    const id = await book(); setSession('demo', office); await approveOrder(id); setSession('demo', owner);
    const name = (await db.staff.get(office))!.name;
    await expect(approveOrder(id)).rejects.toThrow(`Order already approved by ${name}. Pull down to refresh.`);
  });
  it('Undo puts it back to the owner while the godown has not packed it; after packing it is refused', async () => {
    const id = await book(); await approveOrder(id);
    await undoApprove(id);
    expect((await db.orders.get(id))!.status).toBe('new');
    await approveOrder(id);
    await pickOrder(id, (await db.orders.get(id))!.lines.map(l => ({ productId: l.productId, qty: l.qty, line: l.line })));
    await expect(undoApprove(id)).rejects.toThrow(/already packed/);
  });
});

describe('screen totals and the Excel agree to the paisa', () => {
  it('footer = the bill\'s taxable, tax, round-off, total; Excel has one row per line and the same totals', async () => {
    const id = await book([7, 3]);
    const o = (await db.orders.get(id))! as Order;
    await editOrder(id, [{ ...o.lines[0], discountPct: 3.5 }, o.lines[1]]);
    const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
    const view = orderView((await db.orders.get(id))!.lines, products, await db.schemes.toArray(), false);
    expect(view.rows.length).toBe(2);
    expect(Math.round((view.taxable + view.tax + view.roundOff) * 100)).toBe(Math.round(view.total * 100));
    const sheet = await ordersSheet([id]);
    const mine = sheet.rows.filter(r => r[0] === shop.name);
    expect(mine.filter(r => r[1] !== 'Total').length).toBe(2);
    const tot = mine.find(r => r[1] === 'Total')!;
    expect(tot[tot.length - 1]).toBe(view.total);
  });
});

describe('guard: Disc % 0–100 on any order or bill save', () => {
  it('a Disc % of 150 saved by any path is refused', async () => {
    const id = await book();
    const o = (await db.orders.get(id))!;
    const cs = new ChangeSet(); cs.put('orders', { ...o, lines: o.lines.map(l => ({ ...l, discountPct: 150 })) });
    await expect(cs.commit('t')).rejects.toThrow("Discount can't be more than 100%");
  });
});
