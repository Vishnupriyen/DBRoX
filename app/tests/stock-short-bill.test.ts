// Two picked orders wanting the same stock: the second was billed for pieces no lot could cover (582 bill lines in a
// month of the working-app test, 9 Nov 2026). A bill never charges for stock that isn't there, and the pick list
// never offers stock already packed for another order.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { ChangeSet, db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { approveOrder, approvePicked, bookOrder, pickOrder, suggestPick } from '../src/core/pipeline';
import { stockOf } from '../src/core/billing';
import type { Order } from '../src/core/types';

let prodId = '', start = 0;
const orders: string[] = [];
beforeAll(async () => {
  await seedDemo();
  const owner = (await db.staff.toArray()).find(s => s.role === 'owner')!;
  setSession(owner.tenantId, owner.id);
  const p = (await db.products.toArray()).find(x => x.name.startsWith('Vim'))!; prodId = p.id;
  start = await stockOf(p.id);
  const [s1, s2] = await db.shops.toArray();
  const want = Math.ceil(start * 0.7); // each order wants 70% of all Vim: together more than there is
  const cs = new ChangeSet();
  orders.push((await bookOrder(cs, s1, [{ productId: p.id, qty: want, rate: p.rate }], owner.id)).id);
  orders.push((await bookOrder(cs, s2, [{ productId: p.id, qty: want, rate: p.rate }], owner.id)).id);
  await cs.commit('two orders');
  for (const o of orders) await approveOrder(o);
});

describe('stock wanted by two picked orders', () => {
  it('the second pick list only offers what the first did not take', async () => {
    const o1 = (await db.orders.get(orders[0])) as Order;
    const s1 = await suggestPick(o1);
    await pickOrder(o1.id, s1.flatMap(x => x.picks.map(pk => ({ productId: x.productId, qty: pk.qty, batchId: pk.batchId }))));
    const o2 = (await db.orders.get(orders[1])) as Order;
    const s2 = await suggestPick(o2);
    expect(s2[0].available).toBeLessThanOrEqual(start - s1[0].available);
    // the godown packs what the list says is there
    await pickOrder(o2.id, s2.flatMap(x => x.picks.length ? x.picks.map(pk => ({ productId: x.productId, qty: pk.qty, batchId: pk.batchId })) : [{ productId: x.productId, qty: 0 }]));
  });
  it('billing both never charges for pieces that are not in stock', async () => {
    for (const o of orders) await approvePicked(o);
    const lines = (await db.invoices.toArray()).flatMap(i => i.lines).filter(l => l.productId === prodId && !l.name.startsWith('x'));
    const billed = lines.reduce((a, l) => a + l.qty + l.freeQty, 0);
    expect(billed).toBeLessThanOrEqual(start);
    for (const l of lines) expect(l.batches.reduce((a, b) => a + b.qty, 0)).toBe(l.qty + l.freeQty);
    expect(await stockOf(prodId)).toBe(start - billed);
  });
});

describe('the law', () => {
  it('a new bill line not covered by stock lots is refused, whatever made it', async () => {
    const { commit } = { commit: async () => {
      const cs = new ChangeSet();
      const shop = (await db.shops.toArray())[0];
      cs.put('invoices', { number: 'TEST/26-27/99999', companyId: 'c', shopId: shop.id, orderId: 'o', date: '2026-11-09', kind: 'B2C', taxable: 100, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: 100, schemeSaving: 0, deliveryStatus: 'pending',
        lines: [{ productId: prodId, name: 'Vim', hsn: '1', qty: 5, freeQty: 0, rate: 20, mrp: 25, gross: 100, discount: 0, taxable: 100, gst: 0, cgst: 0, sgst: 0, igst: 0, total: 100, batches: [], schemeNames: [] }] });
      return cs.commit('phantom bill');
    } };
    await expect(commit()).rejects.toThrow(/stock/i);
  });
});
