// Part 2 step 2d (docs/PART2_SPEC.md 10/34, PART2_SYSTEMS.md "Stock", PART2_GST.md rules 3, 4, 6 and the worked example):
// Disc % per line (₹ is the legal figure, both kept), the same product on two lines of a SALES bill: stock out once per
// product (one movement per lot, fixed id), free pieces once on line 1, credit notes and shortages per line, HSN summary
// from the lines.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ChangeSet, db, setSession, today } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { makeInvoices, sameProductTwiceOn } from '../src/core/billing';
import { hsnSummary } from '../src/core/gst';
import { cancelInvoice, recordDelivery, settleDifference, saveBillEdit } from '../src/core/pipeline';
import type { Batch, Order, Product, Scheme, Shop } from '../src/core/types';

let owner = '', shop: Shop, biscuit: Product;
beforeAll(async () => {
  await seedDemo();
  owner = (await db.staff.toArray()).find(s => s.role === 'owner')!.id;
  setSession('demo', owner);
  const st = await db.settings.toCollection().first();
  shop = (await db.shops.toArray()).find(s => s.approved && !s.gstin && (!s.stateCode || s.stateCode === st?.stateCode))!;
  const co = (await db.companies.toArray())[0];
  const cs = new ChangeSet();
  biscuit = cs.put<Product>('products', { companyId: co.id, name: 'Test Biscuit 1905', hsn: '1905', gst: 18, mrp: 120, rate: 100, purchaseRate: 80, caseSize: 10, aliases: [], active: true });
  cs.put<Batch>('batches', { productId: biscuit.id, batch: 'TB1', expiry: '2030-01-01', mrp: 120, qty: 12, purchaseRate: 80 } as Batch);
  cs.put<Batch>('batches', { productId: biscuit.id, batch: 'TB2', expiry: '2031-01-01', mrp: 120, qty: 100, purchaseRate: 80 } as Batch);
  await cs.commit('test stock');
});
beforeEach(() => setSession('demo', owner));
const order = (lines: Order['lines']): Order => ({ id: `o-${Math.random()}`, tenantId: 'demo', createdAt: '', updatedAt: '', dirty: 0, shopId: shop.id, source: 'office', lines, status: 'picked', issues: [], date: today(), invoiceIds: [] });
const bill = async (lines: Order['lines']) => { const cs = new ChangeSet(); const [inv] = await makeInvoices(cs, order(lines), shop); await cs.commit('Approved & billed'); return (await db.invoices.get(inv.id))!; };
const stockOf = async () => (await db.batches.where('productId').equals(biscuit.id).toArray()).reduce((a, b) => a + b.qty, 0);

describe('GST worked example (PART2_GST.md): HSN 1905 at 18%, two lines of one product', () => {
  it('₹1,652.00; HSN row qty 15, taxable 1,400.00, CGST 126.00, SGST 126.00 — line totals add to the bill to the paisa', async () => {
    const inv = await bill([{ productId: biscuit.id, qty: 10, rate: 100, discountPct: 5, line: 1 }, { productId: biscuit.id, qty: 5, rate: 90, line: 2 }]);
    expect(inv.lines.map(l => [l.qty, l.discount, l.discountPct, l.taxable, l.cgst, l.sgst, l.total])).toEqual([[10, 50, 5, 950, 85.5, 85.5, 1121], [5, 0, undefined, 450, 40.5, 40.5, 531]]);
    expect([inv.taxable, inv.cgst, inv.sgst, inv.roundOff, inv.total]).toEqual([1400, 126, 126, 0, 1652]);
    const h = hsnSummary(inv.lines);
    expect(h).toEqual([{ hsn: '1905', unit: 'PCS', gst: 18, qty: 15, taxable: 1400, cgst: 126, sgst: 126, igst: 0, tax: 252 }]);
    await cancelInvoice(inv.id, 'test');
  });
  it('a scheme of 2 free on the combined 15: line 1 shows Free 2 at value 0, line 2 none; HSN qty 17, taxable still 1,400.00', async () => {
    const cs = new ChangeSet();
    const sc = cs.put<Scheme>('schemes', { companyId: biscuit.companyId, productId: biscuit.id, name: 'Buy 15 get 2', type: 'free', value: 0, buyQty: 15, freeQty: 2, from: '2026-01-01', to: '2030-12-31', source: 'own', combine: 'add' } as Scheme);
    await cs.commit('scheme');
    const before = await stockOf();
    const inv = await bill([{ productId: biscuit.id, qty: 10, rate: 100, discountPct: 5, line: 1 }, { productId: biscuit.id, qty: 5, rate: 90, line: 2 }]);
    expect(inv.lines.map(l => l.freeQty)).toEqual([2, 0]);
    expect(inv.total).toBe(1652);
    expect(hsnSummary(inv.lines)[0]).toMatchObject({ qty: 17, taxable: 1400 });
    expect(before - await stockOf()).toBe(17);
    // stock out once per product: one movement per lot, with the bill's fixed id
    const moves = (await db.stockMoves.toArray()).filter(m => m.id.startsWith(`mv:${inv.id}:`));
    expect(moves.length).toBe(new Set(inv.lines.flatMap(l => l.batches.map(b => b.batchId))).size);
    expect(moves.reduce((a, m) => a + m.delta, 0)).toBe(-17);
    // cancel returns it once
    await cancelInvoice(inv.id, 'test');
    expect(await stockOf()).toBe(before);
    const c2 = new ChangeSet(); c2.put('schemes', { ...sc, to: '2020-01-01' }); await c2.commit('scheme off');
  });
});

describe('two lines of one product: credit notes, shortages and edits point at the right line', () => {
  it('a shortage on line 2 is credited on line 2 at line 2\'s own value', async () => {
    const inv = await bill([{ productId: biscuit.id, qty: 4, rate: 100, line: 1 }, { productId: biscuit.id, qty: 3, rate: 80, line: 2 }]);
    await recordDelivery([inv.id], { short: { [`${inv.id}|${biscuit.id}|1`]: { qty: 1, reason: 'short' } } });
    const d = (await db.invoices.get(inv.id))!;
    expect(d.delivery!.shortages.map(s => [s.line, s.qty])).toEqual([[1, 1]]);
    expect(d.lines.map(l => l.batches.reduce((a, b) => a + b.qty, 0))).toEqual([4, 2]);
    await settleDifference(inv.id, 'credit_note');
    const cn = (await db.creditNotes.where('invoiceId').equals(inv.id).toArray())[0];
    expect(cn.lines.map(l => [l.line, l.qty, l.taxable])).toEqual([[1, 1, 80]]);
  });
  it('a bill edit keeps two lines of one product, Disc % and ₹ both stored; free once on line 1', async () => {
    const inv = await bill([{ productId: biscuit.id, qty: 2, rate: 100, line: 1 }]);
    await saveBillEdit(inv.id, shop.id, [{ productId: biscuit.id, qty: 2, rate: 100, discountPct: 10 }, { productId: biscuit.id, qty: 3, rate: 95 }]);
    const e = (await db.invoices.get(inv.id))!;
    expect(e.lines.map(l => [l.qty, l.rate, l.discountPct, l.discount])).toEqual([[2, 100, 10, 20], [3, 95, undefined, 0]]);
    expect(Math.round(e.lines.reduce((a, l) => a + l.taxable, 0) * 100)).toBe(Math.round(e.taxable * 100));
    await cancelInvoice(inv.id, 'test');
  });
  it('an old ₹-only line keeps its ₹ (no Disc % invented) when the bill is edited', async () => {
    const inv = await bill([{ productId: biscuit.id, qty: 2, rate: 100, line: 1 }]);
    await saveBillEdit(inv.id, shop.id, [{ productId: biscuit.id, qty: 2, rate: 100, discount: 15 }]);
    const e = (await db.invoices.get(inv.id))!;
    expect([e.lines[0].discount, e.lines[0].discountPct]).toEqual([15, undefined]);
    await cancelInvoice(inv.id, 'test');
  });
});

describe('where two lines of one product are allowed', () => {
  it('sales bills and our own orders yes; a company order no (guard)', async () => {
    const cs = new ChangeSet();
    cs.put<Order>('orders', { ...order([{ productId: biscuit.id, qty: 1, rate: 1 }, { productId: biscuit.id, qty: 2, rate: 1 }]), id: undefined as never, source: 'company', status: 'new' });
    await expect(cs.commit('t')).rejects.toThrow('A company order has each product once.');
  });
  it('the feature flag is on unless the owner switched it off', () => {
    expect(sameProductTwiceOn(undefined)).toBe(true); expect(sameProductTwiceOn({ sameProductTwice: false })).toBe(false);
  });
});

