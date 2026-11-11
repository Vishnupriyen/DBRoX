// Regression tests for bugs found in the Nov 2026 review. Each one failed before its fix.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { ChangeSet, db, setSession, undoBatch, today, daysFrom, monthEnd } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { bookOrder, approveOrder, suggestPick, pickOrder, approvePicked, settleDifference } from '../src/core/pipeline';
import { creditNoteNumbers, finYear } from '../src/core/billing';
import { shopOutstanding } from '../src/core/ledger';
import type { Product, Shop } from '../src/core/types';

let shops: Shop[]; let products: Product[];
beforeAll(async () => {
  await seedDemo();
  const owner = (await db.staff.where('role').equals('owner').first())!;
  setSession('demo', owner.id);
  shops = await db.shops.toArray(); products = (await db.products.toArray()).filter(p => p.active);
});
const stock = async (pid: string) => (await db.batches.where('productId').equals(pid).toArray()).reduce((a, b) => a + b.qty, 0);
async function pickedOrder(shop: Shop, p: Product, qty: number, extra = {}) {
  const cs = new ChangeSet(); const o = await bookOrder(cs, shop, [{ productId: p.id, qty, rate: p.rate }], 'test', extra); await cs.commit('booked');
  await approveOrder(o.id);
  const pick = await suggestPick((await db.orders.get(o.id))!);
  await pickOrder(o.id, pick.map(x => ({ productId: x.productId, qty: Math.min(qty, x.available) })));
  return o.id;
}

describe('review fixes', () => {
  it('a double tap on Done → bill makes one bill and takes stock once', async () => {
    const p = products[0]; const id = await pickedOrder(shops[0], p, 6);
    const s0 = await stock(p.id);
    const res = await Promise.allSettled([approvePicked(id), approvePicked(id)]);
    expect(res.filter(r => r.status === 'fulfilled').length).toBe(1);
    await expect(approvePicked(id)).rejects.toThrow(/already billed/);
    expect((await db.invoices.toArray()).filter(i => i.orderId === id && !i.cancelled).length).toBe(1);
    expect(await stock(p.id)).toBe(s0 - 6);
  });

  it('a bill is dated the day it is made, not the order day', async () => {
    const p = products[1]; const id = await pickedOrder(shops[1], p, 3, { date: daysFrom(-1) });
    const { invoices } = await approvePicked(id);
    expect(invoices[0].date).toBe(today());
  });

  it('undo is refused when a later action changed the same records, and never re-issues a bill number', async () => {
    const p = products[2];
    const a = await approvePicked(await pickedOrder(shops[0], p, 3));
    await approvePicked(await pickedOrder(shops[0], p, 3)); // same batch, later
    const before = await stock(p.id);
    expect(await undoBatch(a.batchId)).toBe(-1);
    expect(await stock(p.id)).toBe(before);
    const c = await approvePicked(await pickedOrder(shops[0], p, 1));
    const numbers = (await db.invoices.toArray()).map(i => i.number);
    expect(numbers.filter(n => n === c.invoices[0].number).length).toBe(1);
  });

  it('a paid bill credited below zero becomes shop advance', async () => {
    const shop = shops[2]; const p = products[0];
    const { invoices: [inv] } = await approvePicked(await pickedOrder(shop, p, 4));
    const before = await shopOutstanding(shop.id);
    const cs = new ChangeSet();
    cs.put('payments', { shopId: shop.id, amount: inv.total, mode: 'cash', date: today(), collectedBy: 'test', shopConfirmed: true, allocations: [{ invoiceId: inv.id, amount: inv.total }], advance: 0, settled: true, status: 'ok' });
    await cs.commit('paid');
    // one piece short at the door → credit note on an already-paid bill
    await db.invoices.put({ ...(await db.invoices.get(inv.id))!, deliveryStatus: 'partial', delivery: { at: '', by: '', shortages: [{ productId: p.id, qty: 1, reason: 'short' }], excess: [] } });
    await settleDifference(inv.id, 'credit_note');
    const cn = (await db.creditNotes.where('invoiceId').equals(inv.id).toArray())[0];
    const after = await shopOutstanding(shop.id);
    // paid in full, then credited: the credit is applied to the shop's other open bills (or kept as advance)
    expect(after.total).toBeCloseTo(before.total - inv.total - cn.total, 1);
  });

  it('credit-note numbers never repeat and use the financial year', async () => {
    const cs = new ChangeSet(); const a = await creditNoteNumbers(cs, 2); await cs.commit('cn');
    const cs2 = new ChangeSet(); const b = await creditNoteNumbers(cs2, 1); await cs2.commit('cn');
    expect(new Set([...a, ...b]).size).toBe(3);
    expect(a[0]).toMatch(new RegExp(`^CN/${finYear(today())}/\\d{5}$`));
  });

  it('guards refuse impossible saves and write nothing', async () => {
    const b = (await db.batches.toArray()).find(x => x.qty > 0)!;
    const cs = new ChangeSet(); cs.put('batches', { ...b, qty: -1 }); cs.put('expenses', { date: today(), category: 'test', amount: 5 });
    await expect(cs.commit('bad')).rejects.toThrow(/below zero/);
    expect((await db.batches.get(b.id))!.qty).toBe(b.qty);
    expect((await db.expenses.toArray()).some(e => e.category === 'test')).toBe(false); // whole save rolled back
    const inv = (await db.invoices.toArray())[0];
    const cs2 = new ChangeSet(); cs2.put('invoices', { ...inv, id: undefined });
    await expect(cs2.commit('dup')).rejects.toThrow(/already used/);
    const cs3 = new ChangeSet(); cs3.put('payments', { shopId: inv.shopId, amount: 100, mode: 'cash', date: today(), collectedBy: 't', shopConfirmed: true, allocations: [{ invoiceId: inv.id, amount: 150 }], advance: 0, settled: false, status: 'ok' });
    await expect(cs3.commit('over')).rejects.toThrow(/more than its amount/);
  });

  it('new guards (Nov 2026 money review): credit notes never beyond the bill, money is a number, a company bill once, short bill prefix', async () => {
    const inv = (await db.invoices.toArray()).find(i => !i.cancelled)!;
    const cn = new ChangeSet(); cn.put('creditNotes', { number: 'CN/G/1', invoiceId: inv.id, shopId: inv.shopId, companyId: inv.companyId, date: today(), reason: 'x', lines: [], total: inv.total + 5 });
    await expect(cn.commit('too big')).rejects.toThrow(/more than/);
    const nan = new ChangeSet(); nan.put('claimEntries', { companyId: inv.companyId, month: '2026-11', kind: 'damage', qty: 1, amount: NaN }); await expect(nan.commit('nan')).rejects.toThrow(/not a valid number/);
    const p1 = new ChangeSet(); p1.put('purchases', { companyId: inv.companyId, billNo: 'GRD-1', date: today(), lines: [], taxable: 1, tax: 0, total: 1, source: 'typed' }); await p1.commit('p1');
    const p2 = new ChangeSet(); p2.put('purchases', { companyId: inv.companyId, billNo: 'grd-1', date: today(), lines: [], taxable: 1, tax: 0, total: 1, source: 'typed' }); await expect(p2.commit('p2')).rejects.toThrow(/already entered/);
    const st = new ChangeSet(); st.put('settings', { ...(await db.settings.toArray())[0], billPrefix: 'TOOLONG' }); await expect(st.commit('prefix')).rejects.toThrow(/prefix/);
  });

  it('month end is the real last day of the month (no UTC shift)', () => {
    expect(monthEnd('2027-03')).toBe('2027-03-31');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
  });
});
