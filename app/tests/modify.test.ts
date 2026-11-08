// Changing things after they are saved, by typing: orders, bills, payments, expenses, stock counts, shops, products,
// and "undo". Every change is a table approved with ✓, saved through the laws, and checked again at save time.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ChangeSet, db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle, type Reply } from '../src/core/engine';
import { commit, validate, hasErrors, type Proposal } from '../src/core/proposals';
import { shopOutstanding } from '../src/core/ledger';
import type { Order, Role } from '../src/core/types';

const ids: Partial<Record<Role, string>> = {};
const shopId: Record<string, string> = {};
const prodId: Record<string, string> = {};
beforeAll(async () => {
  await seedDemo();
  for (const s of await db.staff.toArray()) ids[s.role] ??= s.id;
  for (const s of await db.shops.toArray()) shopId[s.name.split(' ')[0].toLowerCase()] = s.id;
  for (const p of await db.products.toArray()) prodId[p.name.split(' ')[0].toLowerCase()] = p.id;
});
beforeEach(() => setSession('demo', ids.owner!));
const as = (r: Role) => setSession('demo', ids[r]!);
const ask = async (said: string) => handle(said, []);
const approve = async (r: Reply) => {
  expect(r.proposal, r.text).toBeTruthy();
  const v = await validate(r.proposal!);
  expect(hasErrors(v), JSON.stringify(v)).toBe(false);
  return commit(r.proposal!);
};
const orderOf = async (shop: string) => (await db.orders.where('shopId').equals(shopId[shop]).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] as Order;
const qtyIn = (o: Order, p: string) => o.lines.find(l => l.productId === prodId[p])?.qty ?? 0;
const stock = async (p: string) => (await db.batches.where('productId').equals(prodId[p]).toArray()).reduce((a, b) => a + b.qty, 0);
const field = (p: Proposal, k: string) => p.fields.find(f => f.key === k);

describe('orders', () => {
  it('changes a quantity, removes an item and adds one, each approved', async () => {
    let r = await ask('change ganapathi order surf to 3 case');
    expect(r.proposal?.kind).toBe('orderEdit');
    await approve(r);
    expect(qtyIn(await orderOf('ganapathi'), 'surf')).toBe(36);
    await approve(await ask('remove classmate from ganapathi order'));
    expect(qtyIn(await orderOf('ganapathi'), 'classmate')).toBe(0);
    await approve(await ask('ganapathi order add 2 dozen good day'));
    const o = await orderOf('ganapathi');
    expect(qtyIn(o, 'good')).toBe(24);
    expect(qtyIn(o, 'surf')).toBe(36);
  });
  it('a salesman cannot change an order the owner already approved', async () => {
    as('salesman');
    const r = await ask('change annai order lifebuoy to 48');
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/can't change this order/i);
  });
  it('a packed or billed order is never changed here', async () => {
    expect((await ask('cancel lakshmi order')).text).toMatch(/already packed/);
    expect((await ask('change kumar mart order surf to 2 case')).text).toMatch(/already billed/);
  });
  it('if the godown packs it after the table was made, saving is refused', async () => {
    const r = await ask('change annai order lifebuoy to 48');
    expect(r.proposal?.kind).toBe('orderEdit');
    const o = await orderOf('annai');
    const cs = new ChangeSet(); cs.put('orders', { ...o, status: 'picked' }); await cs.commit('picked');
    await expect(commit(r.proposal!)).rejects.toThrow(/packed/);
    const cs2 = new ChangeSet(); cs2.put('orders', { ...(await orderOf('annai')), status: 'approved' }); await cs2.commit('back');
  });
  it('"add 2 vim" to a shop with no open order is just a new order', async () => {
    expect((await ask('murugan add 2 vim to order')).proposal?.kind).toBe('order');
  });
  it('cancels a whole order', async () => {
    const r = await ask('cancel ganapathi order');
    expect(r.proposal?.kind).toBe('orderCancel');
    await approve(r);
    expect((await orderOf('ganapathi')).status).toBe('cancelled');
  });
});

describe('bills and payments', () => {
  it('cancels a bill with a reason and puts the stock back', async () => {
    const before = await stock('surf') + await stock('bingo');
    const r = await ask('cancel kumar mart bill');
    expect(r.proposal?.kind).toBe('billCancel');
    expect(hasErrors(await validate(r.proposal!))).toBe(true); // reason is required
    field(r.proposal!, 'reason')!.value = 'Shop refused';
    await commit(r.proposal!);
    const inv = (await db.invoices.where('shopId').equals(shopId.kumar).toArray()).find(i => i.cancelled)!;
    expect(inv.cancelled?.reason).toBe('Shop refused');
    expect(await stock('surf') + await stock('bingo')).toBeGreaterThan(before);
  });
  it('cancels a payment; the shop owes it again', async () => {
    await approve(await ask('Selvam Kirana paid 500 cash'));
    const owed = (await shopOutstanding(shopId.selvam)).total;
    const r = await ask('cancel selvam payment 500');
    expect(r.proposal?.kind).toBe('paymentCancel');
    await approve(r);
    expect((await shopOutstanding(shopId.selvam)).total).toBeCloseTo(owed + 500, 1);
  });
  it('a bounced cheque/UPI is found and cancelled', async () => {
    const r = await ask('annai cheque bounced');
    expect(r.proposal?.kind).toBe('paymentCancel');
    expect(field(r.proposal!, 'reason')!.value).toBe('Cheque bounced');
  });
  it('a 10-digit UPI reference in a payment is not taken as a phone number', async () => {
    expect((await ask('murugan paid 500 gpay ref 9876543210')).proposal?.kind).toBe('payment');
  });
});

describe('expenses', () => {
  it('corrects and deletes an expense', async () => {
    await approve(await ask('van 1 diesel 1500'));
    const r = await ask('diesel was 1400 not 1500');
    expect(r.proposal?.kind).toBe('expenseFix');
    await approve(r);
    expect((await db.expenses.toArray()).some(e => e.amount === 1400 && e.category === 'Fuel')).toBe(true);
    await approve(await ask('delete diesel expense 1400'));
    expect((await db.expenses.toArray()).some(e => e.amount === 1400)).toBe(false);
  });
});

describe('stock counts', () => {
  it('sets a counted total, shortage off the oldest lot', async () => {
    const r = await ask('physical count bingo 500');
    expect(r.proposal?.kind).toBe('stockFix');
    await approve(r);
    expect(await stock('bingo')).toBe(500);
    await approve(await ask('6 bingo short'));
    expect(await stock('bingo')).toBe(494);
  });
  it('the count is refused if stock moved after the table was made', async () => {
    const r = await ask('physical count bingo 480');
    const b = (await db.batches.where('productId').equals(prodId.bingo).toArray()).find(x => x.qty > 0)!;
    const cs = new ChangeSet(); cs.put('batches', { ...b, qty: b.qty - 1 }); await cs.commit('sold');
    await expect(commit(r.proposal!)).rejects.toThrow(/stock moved/);
  });
  it('a delivery driver cannot change stock', async () => {
    as('delivery');
    expect((await ask('physical count bingo 400')).text).toMatch(/cannot/);
  });
  it('a stock question is still a question', async () => {
    expect((await ask('how much surf stock')).table?.name).toBe('Stock');
  });
});

describe('products and shops', () => {
  it('changes a rate and an MRP', async () => {
    await approve(await ask('surf rate 115'));
    expect((await db.products.get(prodId.surf))!.rate).toBe(115);
    await approve(await ask('change surf mrp from 140 to 150'));
    expect((await db.products.get(prodId.surf))!.mrp).toBe(150);
  });
  it('refuses a selling rate above MRP', async () => {
    const r = await ask('surf rate 200');
    expect(hasErrors(await validate(r.proposal!))).toBe(true);
  });
  it('changes a phone, a credit limit and cash only', async () => {
    await approve(await ask('selvam phone 9876501234'));
    await approve(await ask('murugan credit limit 30000'));
    await approve(await ask('kumar mart cash only'));
    expect((await db.shops.get(shopId.selvam))!.phone).toBe('9876501234');
    expect((await db.shops.get(shopId.murugan))!.creditLimit).toBe(30000);
    expect((await db.shops.get(shopId.kumar))!.cashOnly).toBe(true);
  });
  it('a salesman cannot change credit terms', async () => {
    as('salesman');
    expect((await ask('murugan credit limit 90000')).text).toMatch(/owner/);
  });
});

describe('undo', () => {
  it('says so when there is nothing of yours to undo', async () => {
    as('godown');
    const r = await ask('undo');
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/nothing of yours to undo/);
  });
  it('"undo" shows the last save and puts it back on ✓', async () => {
    await approve(await ask('velan credit limit 99000'));
    const r = await ask('undo');
    expect(r.proposal?.kind).toBe('undo');
    await approve(r);
    expect((await db.shops.get(shopId.velan))!.creditLimit).toBe(15000);
  });
});
