// Chaos seed 15 (12 Nov 2026): a shop returned charged pieces of a bill before it was delivered, then the delivery came
// up short. The short was split into charged/free as if nothing had been returned, so day close asked to credit charged
// pieces that were already credited ("Only 1 charged pcs … left to credit (asked 2)") and the difference could never be settled.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { ChangeSet, db, setSession, today } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { makeInvoices } from '../src/core/billing';
import { recordDelivery, settleDifference } from '../src/core/pipeline';
import { makeCreditNote } from '../src/core/credit';
import type { Invoice, Order, Product, Shop } from '../src/core/types';

let surf: Product, shop: Shop;
beforeAll(async () => {
  await seedDemo();
  const owner = (await db.staff.toArray()).find(s => s.role === 'owner')!;
  setSession(owner.tenantId, owner.id);
  await db.schemes.clear();
  surf = (await db.products.toArray()).find(p => p.name.startsWith('Surf'))!;
  shop = (await db.shops.toArray()).find(s => s.active !== false)!;
  const cs = new ChangeSet();
  cs.put('schemes', { companyId: surf.companyId, productId: surf.id, name: 'Surf 6+1', type: 'free', value: 0, buyQty: 6, freeQty: 1, from: '2020-01-01', to: '2099-01-01', source: 'company', combine: 'add' });
  await cs.commit('setup');
}, 60_000);

async function bill(qty: number): Promise<Invoice> {
  const cs = new ChangeSet();
  const o = cs.put<Order>('orders', { shopId: shop.id, salesmanId: 'x', source: 'salesman', lines: [{ productId: surf.id, qty, rate: 112 }], date: today(), status: 'billed', issues: [], invoiceIds: [] });
  const [inv] = await makeInvoices(cs, o, shop); await cs.commit('bill'); return inv;
}
async function giveBack(inv: Invoice, paid: number) {
  const cs = new ChangeSet();
  await makeCreditNote(cs, inv, [{ productId: surf.id, paid, free: 0, restock: true }], { reason: 'return', source: 'return', takeOffBill: true });
  await cs.commit('Return');
}

describe('a return before delivery, then the delivery is short', () => {
  it('13 + 2 free, 12 charged returned, the last 3 pieces short: 1 charged + 2 free short, and day close settles', async () => {
    const inv = await bill(13);
    expect(inv.lines[0].freeQty).toBe(2);
    await giveBack(inv, 12);
    await recordDelivery([inv.id], { short: { [`${inv.id}|${surf.id}`]: { qty: 3, reason: 'short' } } });
    const d = (await db.invoices.get(inv.id))!.delivery!;
    expect([d.shortages[0].paid, d.shortages[0].free]).toEqual([1, 2]);
    await settleDifference(inv.id, 'credit_note');
    const cns = await db.creditNotes.where('invoiceId').equals(inv.id).toArray();
    expect(cns.reduce((a, c) => a + c.total, 0)).toBe(inv.total); // everything charged is credited once, no more
  });
  it('all charged pieces returned, the 2 free pieces short: only free pieces are credited (₹0)', async () => {
    const inv = await bill(13);
    await giveBack(inv, 13);
    await recordDelivery([inv.id], { short: { [`${inv.id}|${surf.id}`]: { qty: 2, reason: 'short' } } });
    const d = (await db.invoices.get(inv.id))!.delivery!;
    expect([d.shortages[0].paid, d.shortages[0].free]).toEqual([0, 2]);
    await settleDifference(inv.id, 'credit_note');
    const cns = await db.creditNotes.where('invoiceId').equals(inv.id).toArray();
    expect(cns.reduce((a, c) => a + c.total, 0)).toBe(inv.total);
  });
});
