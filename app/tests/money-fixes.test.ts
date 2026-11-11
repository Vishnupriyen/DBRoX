// Round 2 pre-pilot review — money and GST. Each test failed before its fix (GST A1–A10, B11–B19, C20–C25;
// BA BLOCK5–8, TRUST9/10/12/13/14/22). Hand-worked numbers in the comments.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { ChangeSet, db, setSession, today } from '../src/core/db';
import { seedDemo, gstinWithCheck } from '../src/core/seed';
import { checkOrder, makeInvoices } from '../src/core/billing';
import {
  approveOrder, bookOrder, cancelInvoice, pickOrder, recordDelivery, rejectOrder, saveBillEdit, settleDifference, suggestPick,
} from '../src/core/pipeline';
import { commit, validate, hasErrors, type Proposal } from '../src/core/proposals';
import { balanceBefore, collectionCheck, fillPendingValues, markPrinted } from '../src/core/credit';
import { companyPayables, recordCompanyPayment } from '../src/core/payables';
import { tallyXml } from '../src/core/exports';
import { profitAndLoss } from '../src/core/pnl';
import { dropClaimLine } from '../src/core/claims';
import { GST_RATES, shopStateCode, taxOn } from '../src/core/gst';
import { isB2B, r2 } from '../src/core/ledger';
import type { Invoice, Order, Product, Shop, Staff } from '../src/core/types';

let owner: Staff, driver: Staff, salesman: Staff;
let surf: Product, life: Product, other: Product;
let tn: Shop;
const asOwner = () => setSession(owner.tenantId, owner.id);
const stockOf = async (pid: string) => (await db.batches.where('productId').equals(pid).toArray()).reduce((a, b) => a + b.qty, 0);
async function bill(shop: Shop, lines: { productId: string; qty: number; rate: number }[], date?: string): Promise<Invoice> {
  const cs = new ChangeSet();
  const o = cs.put<Order>('orders', { shopId: shop.id, salesmanId: owner.id, source: 'salesman', lines, date: today(), status: 'billed', issues: [], invoiceIds: [] });
  const [inv] = await makeInvoices(cs, o, shop, undefined, date); await cs.commit('bill'); return inv;
}
const returnProposal = (shop: Shop, inv: Invoice, rows: { productId: string; qty: number; amount?: number; restock?: string }[]): Proposal => ({
  id: 'p', kind: 'return', title: 'Shop return → credit note',
  fields: [{ key: 'shopId', label: 'Shop', value: shop.id }, { key: 'reason', label: 'Reason', value: 'Return' }],
  columns: [], rows: rows.map(r => ({ said: '', productId: r.productId, qty: r.qty, invoiceId: inv.id, bill: inv.number, amount: r.amount ?? 0, restock: r.restock ?? 'yes' })), meta: {},
} as unknown as Proposal);

beforeAll(async () => {
  await seedDemo();
  const staff = await db.staff.toArray();
  owner = staff.find(s => s.role === 'owner')!; driver = staff.find(s => s.role === 'delivery')!; salesman = staff.find(s => s.role === 'salesman')!;
  asOwner();
  await db.schemes.clear(); await db.claimEntries.clear();
  const ps = await db.products.toArray();
  surf = ps.find(p => p.name.startsWith('Surf'))!; life = ps.find(p => p.name.startsWith('Lifebuoy'))!;
  other = ps.find(p => p.active && p.companyId === surf.companyId && p.id !== surf.id && p.id !== life.id)!;
  const cs = new ChangeSet();
  cs.put('schemes', { companyId: surf.companyId, productId: surf.id, name: 'Surf 6+1', type: 'free', value: 0, buyQty: 6, freeQty: 1, from: '2020-01-01', to: '2099-01-01', source: 'company', combine: 'add' });
  cs.put('schemes', { companyId: surf.companyId, productId: other.id, name: 'Our 12+1', type: 'free', value: 0, buyQty: 12, freeQty: 1, from: '2020-01-01', to: '2099-01-01', source: 'own', combine: 'add' });
  tn = cs.put<Shop>('shops', { name: 'Test TN Traders', area: 'Pennadam', beat: 'Monday', gstin: gstinWithCheck('33AAKFT1234M1Z'), creditLimit: 500000, creditDays: 15, cashOnly: false, type: 'retail', approved: true, aliases: [] });
  await cs.commit('setup');
}, 60_000);

describe('credit notes (GST A2/A3, BLOCK6, BLOCK8)', () => {
  it('a refused 24+2 bill: the credit note is exactly the bill, free pieces credited ₹0', async () => {
    const inv = await bill(tn, [{ productId: other.id, qty: 24, rate: other.rate }]);
    expect(inv.lines[0].freeQty).toBe(2);
    await recordDelivery([inv.id], { returnAll: true });
    await settleDifference(inv.id, 'credit_note');
    const [cn] = await db.creditNotes.where('invoiceId').equals(inv.id).toArray();
    expect(cn.total).toBe(inv.total);
    expect([cn.lines[0].qty, cn.lines[0].freeQty]).toEqual([24, 2]);
    await expect(settleDifference(inv.id, 'credit_note')).rejects.toThrow(/already settled/); // double tap
  });
  it('3 pieces short on 13 + 2 free: 2 paid + 1 free short; credit = 2 × ₹112 + 18% = ₹264.32', async () => {
    const inv = await bill(tn, [{ productId: surf.id, qty: 13, rate: 112 }]);
    await recordDelivery([inv.id], { short: { [`${inv.id}|${surf.id}`]: { qty: 3, reason: 'short' } } });
    const d = (await db.invoices.get(inv.id))!.delivery!;
    expect([d.shortages[0].paid, d.shortages[0].free]).toEqual([2, 1]);
    await settleDifference(inv.id, 'credit_note');
    const [cn] = await db.creditNotes.where('invoiceId').equals(inv.id).toArray();
    expect([cn.lines[0].qty, cn.lines[0].freeQty, cn.taxable, cn.cgst, cn.sgst, cn.total]).toEqual([2, 1, 224, 20.16, 20.16, 264.32]);
  });
  it('the guard refuses a credit note bigger than what the bill still charges', async () => {
    const inv = await bill(tn, [{ productId: life.id, qty: 4, rate: 31 }]);
    const cs = new ChangeSet();
    cs.put('creditNotes', { number: 'CN/T/1', invoiceId: inv.id, shopId: tn.id, companyId: inv.companyId, date: today(), reason: 'x', lines: [], total: inv.total + 1 });
    await expect(cs.commit('too big')).rejects.toThrow(/more than/);
    const ok = new ChangeSet(); ok.put('creditNotes', { number: 'CN/T/2', invoiceId: inv.id, shopId: tn.id, companyId: inv.companyId, date: today(), reason: 'x', lines: [], total: inv.total - 1 }); await ok.commit('fits');
    const two = new ChangeSet(); two.put('creditNotes', { number: 'CN/T/3', invoiceId: inv.id, shopId: tn.id, companyId: inv.companyId, date: today(), reason: 'x', lines: [], total: 2 });
    await expect(two.commit('earlier + this > bill')).rejects.toThrow(/more than/);
  });
  it('a shop return: credit computed from the bill line, qty never more than billed − returned, last pieces take exactly what is left', async () => {
    const inv = await bill(tn, [{ productId: life.id, qty: 7, rate: 31 }]); // taxable 217, CGST 5.43, SGST 5.43, total 228 (+0.14)
    expect(hasErrors(await validate(returnProposal(tn, inv, [{ productId: life.id, qty: 8 }])))).toBe(true);
    expect(hasErrors(await validate(returnProposal(tn, inv, [{ productId: life.id, qty: 2, amount: 500 }])))).toBe(true); // typed more than the pieces' value
    await commit(returnProposal(tn, inv, [{ productId: life.id, qty: 2 }]));
    let cns = await db.creditNotes.where('invoiceId').equals(inv.id).toArray();
    expect(cns[0].total).toBe(65.1); // 2 × ₹31 = 62.00 + CGST 1.55 + SGST 1.55
    await commit(returnProposal(tn, inv, [{ productId: life.id, qty: 5, restock: 'no' }]));
    cns = await db.creditNotes.where('invoiceId').equals(inv.id).toArray();
    expect(r2(cns.reduce((a, c) => a + c.total, 0))).toBe(inv.total); // never more than charged
    expect((await db.claimEntries.toArray()).some(e => e.kind === 'damage' && e.invoiceId === inv.id && e.qty === 5)).toBe(true); // damaged → claim register
    await expect(commit(returnProposal(tn, inv, [{ productId: life.id, qty: 1 }]))).rejects.toThrow(/left on bill/);
  });
  it('a product on two lines of one bill (found by the chaos test): extra at delivery, then a return, takes pieces from either line', async () => {
    const inv = await bill(tn, [{ productId: life.id, qty: 2, rate: 31 }, { productId: life.id, qty: 3, rate: 31 }]);
    expect(inv.lines.length).toBe(2);
    await recordDelivery([inv.id], { extra: { [`${inv.id}|${life.id}`]: 1 } });
    await settleDifference(inv.id, 'credit_note');
    await commit(returnProposal(tn, inv, [{ productId: life.id, qty: 2 }]));
    expect(await db.creditNotes.where('invoiceId').equals(inv.id).count()).toBe(1);
  });
  it('extra pieces on a product that sits on two lines (chaos seed 17): the new bill takes them from either line', async () => {
    const inv = await bill(tn, [{ productId: life.id, qty: 1, rate: 31 }, { productId: life.id, qty: 3, rate: 31 }]);
    await recordDelivery([inv.id], { extra: { [`${inv.id}|${life.id}`]: 2 } });
    await settleDifference(inv.id, 'credit_note');
    const extra = (await db.invoices.toArray()).filter(i => i.extraOf === inv.id);
    expect(extra.flatMap(i => i.lines).reduce((a, l) => a + l.qty, 0)).toBe(4); // 2 extra on each line
  });
  it('a return above the owner\'s limit from a staff phone is not saved — the owner must make it', async () => {
    const inv = await bill(tn, [{ productId: surf.id, qty: 30, rate: 112 }]);
    setSession(owner.tenantId, salesman.id);
    try {
      const p = returnProposal(tn, inv, [{ productId: surf.id, qty: 20 }]);
      expect(hasErrors(await validate(p))).toBe(true);
      await expect(commit(p)).rejects.toThrow(/owner/);
      expect(await db.creditNotes.where('invoiceId').equals(inv.id).count()).toBe(0);
    } finally { asOwner(); }
  });
});

describe('a bill after supply (GST A8–A10, TRUST12)', () => {
  it('extra pieces given at delivery go on a NEW bill; the delivered bill is never re-written', async () => {
    const inv = await bill(tn, [{ productId: life.id, qty: 4, rate: 31 }]);
    await recordDelivery([inv.id], { extra: { [`${inv.id}|${life.id}`]: 2 } });
    await settleDifference(inv.id, 'credit_note');
    const after = (await db.invoices.get(inv.id))!;
    expect([after.total, after.lines[0].qty, after.lines[0].batches.reduce((a, b) => a + b.qty, 0)]).toEqual([inv.total, 4, 4]);
    const extra = (await db.invoices.toArray()).find(i => i.extraOf === inv.id)!;
    expect([extra.lines[0].qty, extra.total, extra.number === inv.number]).toEqual([2, 65, false]); // 62 + 1.55 + 1.55 = 65.10 → 65
    await expect(settleDifference(inv.id, 'modified')).rejects.toThrow(/already/);
  });
  it('a delivered bill can\'t be cancelled; a bill whose GSTR-1 is due can\'t be cancelled', async () => {
    const inv = await bill(tn, [{ productId: life.id, qty: 2, rate: 31 }]);
    await recordDelivery([inv.id], {});
    await expect(cancelInvoice(inv.id, 'oops')).rejects.toThrow(/already delivered/);
    expect((await db.invoices.get(inv.id))!.cancelled).toBeUndefined();
    const [y, m] = today().split('-').map(Number);
    const old = `${m <= 2 ? y - 1 : y}-${String(m <= 2 ? m + 10 : m - 2).padStart(2, '0')}-05`;
    const inv2 = await bill(tn, [{ productId: life.id, qty: 2, rate: 31 }], old);
    await expect(cancelInvoice(inv2.id, 'late')).rejects.toThrow(/GST return/);
  });
  it('printing (one core function) locks the bill: edit refused, cancel still allowed before delivery', async () => {
    const inv = await bill(tn, [{ productId: life.id, qty: 2, rate: 31 }]);
    const p = await markPrinted(inv.id);
    expect(p?.printedAt).toBeTruthy();
    await expect(saveBillEdit(inv.id, tn.id, [{ productId: life.id, qty: 3, rate: 31 }])).rejects.toThrow(/already printed/);
    await cancelInvoice(inv.id, 'wrong shop');
    expect((await db.invoices.get(inv.id))!.cancelled).toBeTruthy();
  });
  it('the bill editor never charges more pieces than stock holds, and re-applies the free scheme', async () => {
    const inv = await bill(tn, [{ productId: surf.id, qty: 13, rate: 112 }]); // 13 + 2 free
    const s0 = await stockOf(surf.id);
    await expect(saveBillEdit(inv.id, tn.id, [{ productId: surf.id, qty: s0 + 50, rate: 112 }])).rejects.toThrow(/Not enough stock/);
    expect(await stockOf(surf.id)).toBe(s0);
    await saveBillEdit(inv.id, tn.id, [{ productId: surf.id, qty: 6, rate: 112 }]);
    const e = (await db.invoices.get(inv.id))!;
    expect([e.lines[0].qty, e.lines[0].freeQty, e.total]).toEqual([6, 1, 793]); // 672 + 60.48 + 60.48 = 792.96
    expect(await stockOf(surf.id)).toBe(s0 + 8);
  });
  it('printed "Previous balance" is as of the bill date, without this bill', async () => {
    const shop = (await db.shops.toArray()).find(s => s.name === 'Test TN Traders')!;
    const invs = (await db.invoices.where('shopId').equals(shop.id).toArray()).filter(i => !i.cancelled).sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
    const last = invs[invs.length - 1];
    const before = invs.filter(i => i.id !== last.id && (i.date < last.date || i.number < last.number));
    const cns = (await db.creditNotes.where('shopId').equals(shop.id).toArray()).filter(c => before.some(b => b.id === c.invoiceId));
    expect(await balanceBefore(last)).toBe(r2(before.reduce((a, b) => a + b.total, 0) - cns.reduce((a, c) => a + c.total, 0)));
  });
});

describe('orders: double taps and stale screens (BLOCK7)', () => {
  const book = async (rate?: number) => { const cs = new ChangeSet(); const o = await bookOrder(cs, tn, [{ productId: life.id, qty: 3, rate: rate ?? life.rate }], salesman.id); await cs.commit('booked'); return o; };
  it('approve twice → one approval, and a salesman\'s rate cut is not a company claim', async () => {
    const o = await book(life.rate - 2);
    const n0 = await db.claimEntries.count();
    const r = await Promise.allSettled([approveOrder(o.id), approveOrder(o.id)]);
    expect(r.filter(x => x.status === 'fulfilled').length).toBe(1);
    await expect(approveOrder(o.id)).rejects.toThrow(/already/);
    expect(await db.claimEntries.count()).toBe(n0);
  });
  it('cancelled on another phone: approve and pick are refused, the order stays cancelled', async () => {
    const o = await book();
    await rejectOrder(o.id, 'shop closed');
    await expect(approveOrder(o.id)).rejects.toThrow(/cancelled/);
    const o2 = await book(); await approveOrder(o2.id);
    const pick = await suggestPick((await db.orders.get(o2.id))!);
    await rejectOrder(o2.id, 'owner cancelled');
    await expect(pickOrder(o2.id, pick.map(x => ({ productId: x.productId, qty: x.available })))).rejects.toThrow(/cancelled/);
    expect((await db.orders.get(o2.id))!.status).toBe('cancelled');
  });
});

describe('claims follow their bill (GST B18, TRUST9)', () => {
  it('own schemes are never claimed; a cancelled bill drops its claim lines; the owner can drop a line', async () => {
    const own = await bill(tn, [{ productId: other.id, qty: 12, rate: other.rate }]); // our own 12+1
    expect(own.lines[0].freeQty).toBe(1);
    expect((await db.claimEntries.toArray()).some(e => e.invoiceId === own.id)).toBe(false);
    const co = await bill(tn, [{ productId: surf.id, qty: 6, rate: 112 }]);
    const line = (await db.claimEntries.toArray()).find(e => e.invoiceId === co.id)!;
    expect(line.amount).toBe(112); // 1 free piece at ₹112
    await cancelInvoice(co.id, 'wrong');
    expect((await db.claimEntries.get(line.id))!.dropped).toMatch(/cancelled/);
    const co2 = await bill(tn, [{ productId: surf.id, qty: 6, rate: 112 }]);
    const l2 = (await db.claimEntries.toArray()).find(e => e.invoiceId === co2.id)!;
    await dropClaimLine(l2.id, 'company does not pay this one');
    expect((await db.claimEntries.get(l2.id))!.dropped).toBe('company does not pay this one');
  });
});

describe('staff phones have no buying rate (BLOCK5) and money is always a number', () => {
  it('van damage saved on the driver\'s phone is valued later by the owner\'s phone', async () => {
    const inv = await bill(tn, [{ productId: life.id, qty: 5, rate: 31 }]);
    const rate = life.purchaseRate;
    await db.products.put({ ...life, purchaseRate: undefined as unknown as number }); // stripped on staff phones
    setSession(owner.tenantId, driver.id);
    try { await recordDelivery([inv.id], { short: { [`${inv.id}|${life.id}`]: { qty: 2, reason: 'damaged' } } }); } finally { asOwner(); }
    const c = (await db.claimEntries.toArray()).find(e => e.invoiceId === inv.id && e.kind === 'transit')!;
    expect([c.amount, c.valuePending]).toEqual([0, true]);
    await db.products.put({ ...life, purchaseRate: rate });
    await fillPendingValues();
    expect((await db.claimEntries.get(c.id))!.amount).toBe(r2(2 * rate));
  });
  it('the guard refuses a money amount that is not a number, in any table', async () => {
    const bad: [string, object][] = [
      ['claimEntries', { companyId: surf.companyId, month: '2026-11', kind: 'damage', qty: 1, amount: NaN }],
      ['purchases', { companyId: surf.companyId, billNo: 'X1', date: today(), lines: [], taxable: 0, tax: 0, total: 'abc', source: 'typed' }],
      ['payments', { shopId: tn.id, amount: 10, mode: 'cash', date: today(), collectedBy: 'x', shopConfirmed: true, allocations: [], advance: NaN, settled: false, status: 'ok' }],
      ['advances', { staffId: driver.id, amount: undefined, reason: 'x', status: 'waiting' }],
    ];
    for (const [table, rec] of bad) { const cs = new ChangeSet(); cs.put(table as never, rec); await expect(cs.commit('bad'), table).rejects.toThrow(/not a valid number/); }
  });
});

describe('Tally and P&L (GST B16, TRUST10)', () => {
  it('Tally: staff advance → Loans & Advances, other income → income, purchases with input GST, bounced cheque reversed; every voucher balances', async () => {
    const cs = new ChangeSet();
    cs.put('expenses', { date: today(), category: 'advance', amount: 500, note: 'advance' });
    cs.put('expenses', { date: today(), category: 'income', amount: 200, note: 'display rent', approved: true });
    cs.put('expenses', { date: today(), category: 'diesel', amount: 0, approved: true });
    cs.put('expenses', { date: today(), category: 'tea', amount: 40 }); // not approved: left out
    cs.put('purchases', { companyId: surf.companyId, billNo: 'TLY-1', date: today(), lines: [{ productId: surf.id, batch: 'X', expiry: '2030-01-31', mrp: 140, qty: 10, freeQty: 0, rate: 100, discount: 0, gst: 18, amount: 1000 }], taxable: 1000, tax: 180, total: 1180, source: 'typed' });
    cs.put('payments', { shopId: tn.id, amount: 300, mode: 'cheque', ref: '123456', date: today(), collectedBy: owner.id, shopConfirmed: true, allocations: [], advance: 300, settled: false, status: 'bounced' });
    await cs.commit('tally data');
    const { xml } = await tallyXml(today().slice(0, 7));
    const vchs = xml.split('<TALLYMESSAGE').filter(x => x.includes('<VOUCHER'));
    for (const v of vchs) { const sum = r2([...v.matchAll(/<AMOUNT>([-\d.]+)<\/AMOUNT>/g)].reduce((a, m) => a + Number(m[1]), 0)); expect(Math.abs(sum), v.slice(0, 200)).toBe(0); }
    expect(xml).toContain('<LEDGERNAME>Staff Advances</LEDGERNAME>'); expect(xml).toContain('Loans &amp; Advances (Asset)');
    expect(xml).toContain('<LEDGERNAME>Other Income</LEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Input CGST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-90</AMOUNT>');
    expect(xml).toContain('VCHTYPE="Journal"');
    expect(xml).not.toContain('<LEDGERNAME>tea</LEDGERNAME>'); expect(xml).not.toContain('<LEDGERNAME>diesel</LEDGERNAME>');
  });
  it('changing a product\'s buying rate after a sale does not change that month\'s profit (cost fixed at billing)', async () => {
    await bill(tn, [{ productId: other.id, qty: 5, rate: other.rate }]);
    const cogs = async () => (await profitAndLoss('month')).expense.find(h => h.key === 'cogs')!.amount;
    const before = await cogs();
    const p = (await db.products.get(other.id))!;
    const cs = new ChangeSet(); cs.put('products', { ...p, purchaseRate: r2(p.purchaseRate * 3) }); await cs.commit('new buying rate');
    expect(await cogs()).toBe(before);
    const back = new ChangeSet(); back.put('products', { ...p }); await back.commit('rate back');
  });
  it('P&L counts the full salary (advance recoveries are still salary cost)', async () => {
    const cs = new ChangeSet(); cs.put('expenses', { date: today(), category: 'salary', amount: 9000, gross: 10000, note: 'Salary test', approved: true }); await cs.commit('salary');
    const p = await profitAndLoss('month');
    expect(p.expense.find(h => h.key === 'exp-salary')!.amount).toBe(10000);
  });
});

describe('company payables (TRUST13)', () => {
  it('payables = company bills − payments − credit notes; the same company bill number is refused', async () => {
    const put = async (billNo: string, total: number) => { const cs = new ChangeSet(); cs.put('purchases', { companyId: surf.companyId, billNo, date: today(), lines: [], taxable: total, tax: 0, total, source: 'typed' }); await cs.commit('purchase'); };
    const before = (await companyPayables()).get(surf.companyId)?.due ?? 0;
    await put('HUL-9001', 1000); await put('HUL-9002', 500);
    await expect(put('hul-9001 ', 10)).rejects.toThrow(/already entered/);
    await recordCompanyPayment({ companyId: surf.companyId, amount: 700, kind: 'payment', ref: 'NEFT 1' });
    await recordCompanyPayment({ companyId: surf.companyId, amount: 100, kind: 'credit_note', ref: 'HUL CN 7' });
    expect(r2((await companyPayables()).get(surf.companyId)!.due - before)).toBe(700);
    await expect(recordCompanyPayment({ companyId: surf.companyId, amount: 1e9, kind: 'payment' })).rejects.toThrow(/more than/);
  });
});

describe('small rules', () => {
  it('CGST and SGST are each half the rate on the taxable value (never 1 paisa apart)', () => {
    expect(taxOn(10.1, 5, false)).toEqual({ cgst: 0.25, sgst: 0.25, igst: 0 });
    expect(taxOn(10.1, 5, true).igst).toBe(0.51);
  });
  it('a shop is B2B only with a valid GSTIN; state from GSTIN, else the form, else Tamil Nadu', () => {
    expect(isB2B({ gstin: '33AAAAA0000A1ZZ' } as Shop)).toBe(false);
    expect(isB2B({ gstin: gstinWithCheck('33AAKFT1234M1Z') } as Shop)).toBe(true);
    expect([shopStateCode({ gstin: gstinWithCheck('29AAKFK1234M1Z') }), shopStateCode({ stateCode: '32' }), shopStateCode({})]).toEqual(['29', '32', '33']);
  });
  it('GST rates in force: 0, 0.25, 3, 5, 18, 40', () => { expect(GST_RATES).toEqual([0, 0.25, 3, 5, 18, 40]); });
  it('credit limit 0 means cash only: a shop with dues gets the cash-only flag', async () => {
    const shop = { ...tn, id: tn.id, creditLimit: 0, cashOnly: false };
    expect((await checkOrder(shop, [{ productId: life.id, qty: 1, rate: life.rate }])).issues.some(i => /Cash-only/.test(i))).toBe(true);
  });
  it('bill prefix: at most 4 letters or digits', async () => {
    const s = (await db.settings.toArray())[0];
    const cs = new ChangeSet(); cs.put('settings', { ...s, billPrefix: 'SMD/2026' }); await expect(cs.commit('prefix')).rejects.toThrow(/prefix/i);
  });
  it('a collection bigger than all the shop owes asks "Is ₹X right?"', async () => {
    expect(await collectionCheck(tn.id, 10_000_000)).toMatch(/^Is ₹/);
    expect(await collectionCheck(tn.id, 1)).toBeNull();
  });
});
