// Part 2 step 2a0 (docs/PART2_SYSTEMS.md): order lines, picked rows and delivery shortages carry a line number, so the same
// product can sit on two lines later (2d). Old records without numbers work without a migration (lineOf / first line).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ChangeSet, db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { lineOf, numberLines, pickedLines, shortageLines } from '../src/core/lines';
import { approveOrder, approvePicked, bookOrder, pickOrder, recordDelivery } from '../src/core/pipeline';
import type { Invoice, Order } from '../src/core/types';

let owner = '';
beforeAll(async () => { await seedDemo(); owner = (await db.staff.toArray()).find(s => s.role === 'owner')!.id; });
beforeEach(() => setSession('demo', owner));

describe('line numbers: helpers', () => {
  it('lineOf: the stored number, else the position + 1', () => {
    expect(lineOf({ line: 4 }, 0)).toBe(4); expect(lineOf({}, 2)).toBe(3);
  });
  it('numberLines: unnumbered lines get 1, 2, 3…; a new line after numbered ones gets the next number (never reused)', () => {
    expect(numberLines([{ p: 'a' }, { p: 'b' }]).map(l => l.line)).toEqual([1, 2]);
    expect(numberLines([{ p: 'a', line: 1 }, { p: 'c', line: 3 }, { p: 'd' }]).map(l => l.line)).toEqual([1, 3, 4]);
  });
  it('old picked rows (no line): each goes to its product\'s line; two MRP rows of one product stay on that one line', () => {
    const o = { lines: [{ productId: 'a', qty: 5, rate: 1 }, { productId: 'b', qty: 3, rate: 2 }], picked: [{ productId: 'b', qty: 3 }, { productId: 'a', qty: 2, mrp: 10 }, { productId: 'a', qty: 3, mrp: 12 }] } as unknown as Order;
    expect(pickedLines(o).map(r => r.line)).toEqual([2, 1, 1]);
  });
  it('picked rows with numbers keep them; an order never picked = its own lines as packed', () => {
    const o = { lines: [{ productId: 'a', qty: 5, rate: 1, line: 1 }, { productId: 'a', qty: 2, rate: 3, line: 2 }], picked: [{ productId: 'a', qty: 2, line: 2 }] } as unknown as Order;
    expect(pickedLines(o).map(r => r.line)).toEqual([2]);
    expect(pickedLines({ ...o, picked: undefined }).map(r => [r.line, r.qty])).toEqual([[1, 5], [2, 2]]);
  });
  it('old shortages (no line): the first unused line of that product', () => {
    const inv = { lines: [{ productId: 'a' }, { productId: 'b' }, { productId: 'a' }], delivery: { shortages: [{ productId: 'a', qty: 1, reason: 'x' }, { productId: 'a', qty: 1, reason: 'x' }, { productId: 'b', qty: 1, reason: 'x', line: 1 }] } } as unknown as Invoice;
    expect(shortageLines(inv)).toEqual([0, 2, 1]);
  });
});

describe('line numbers: the order chain', () => {
  it('a booked order is saved with line numbers 1..n', async () => {
    const shop = (await db.shops.toArray())[0]; const ps = (await db.products.toArray()).slice(0, 2);
    const cs = new ChangeSet(); const o = await bookOrder(cs, shop, ps.map(p => ({ productId: p.id, qty: 1, rate: p.rate })), owner); await cs.commit('t');
    expect((await db.orders.get(o.id))!.lines.map(l => l.line)).toEqual([1, 2]);
  });
  it('an old order without numbers (saved before this version) still picks, bills at each line\'s rate, and delivers short against the right line', async () => {
    const shop = (await db.shops.toArray()).find(s => s.approved)!;
    const stock = new Map<string, number>(); for (const b of await db.batches.toArray()) if (b.qty > 0) stock.set(b.productId, (stock.get(b.productId) ?? 0) + b.qty);
    const ps = (await db.products.toArray()).filter(p => (stock.get(p.id) ?? 0) > 20).slice(0, 2);
    const id = 'old-order-1';
    await db.orders.put({ id, tenantId: 'demo', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', dirty: 0, shopId: shop.id, source: 'office', status: 'new', issues: [], date: '2026-11-14', invoiceIds: [], lines: ps.map((p, i) => ({ productId: p.id, qty: 2, rate: p.rate + i })) } as Order);
    await approveOrder(id);
    await pickOrder(id, ps.map(p => ({ productId: p.id, qty: 2 })));
    const picked = (await db.orders.get(id))!.picked!;
    expect(picked.map(r => r.line)).toEqual([1, 2]);
    const { invoices } = await approvePicked(id);
    const billed = invoices.flatMap(i => i.lines);
    expect(ps.map(p => billed.find(l => l.productId === p.id)?.rate)).toEqual(ps.map((p, i) => p.rate + i));
    const inv = invoices.find(i => i.lines.some(l => l.productId === ps[1].id))!;
    await recordDelivery([inv.id], { short: { [`${inv.id}|${ps[1].id}|${inv.lines.findIndex(l => l.productId === ps[1].id)}`]: { qty: 1, reason: 'short' } } });
    const after = (await db.invoices.get(inv.id))!;
    expect(after.delivery!.shortages.map(s => s.line)).toEqual([inv.lines.findIndex(l => l.productId === ps[1].id)]);
  });
});
