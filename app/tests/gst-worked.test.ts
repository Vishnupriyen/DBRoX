// GST & accounts worked examples (GST review, Nov 2026), worked by hand to the paisa. Each number here was wrong before
// the fix: Kerala shop billed CGST+SGST, refused-bill credit note ₹2,204.55 on a ₹1,940 bill, CDNR at one rate,
// Tally credit note without GST, P&L −₹1,986.85 instead of +₹84.91.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeAll } from 'vitest';
const captured: Record<string, unknown> = {};
vi.mock('../src/core/readers', async (orig) => ({ ...(await orig() as object),
  downloadWorkbook: async (name: string, sheets: unknown) => { captured[name] = sheets; },
  downloadText: (name: string, text: string) => { captured[name] = text; } }));
import { ChangeSet, db, setSession, today } from '../src/core/db';
import { seedDemo, gstinWithCheck } from '../src/core/seed';
import { makeInvoices } from '../src/core/billing';
import { recordDelivery, settleDifference } from '../src/core/pipeline';
import { exportGstr1, tallyXml } from '../src/core/exports';
import { profitAndLoss, pnlTotals } from '../src/core/pnl';
import { shopOutstanding, r2 } from '../src/core/ledger';
import type { Invoice, Shop } from '../src/core/types';

type Sheet = { name: string; header: string[]; rows: (string | number)[][] };
let inv1: Invoice, inv2: Invoice, inv3: Invoice, tn: Shop;
const M = today().slice(0, 7);

beforeAll(async () => {
  await seedDemo();
  const owner = (await db.staff.toArray()).find(s => s.role === 'owner')!;
  setSession(owner.tenantId, owner.id);
  await db.invoices.clear(); await db.creditNotes.clear(); await db.payments.clear(); await db.claimEntries.clear(); await db.schemes.clear(); await db.expenses.clear();
  const ps = await db.products.toArray();
  const surf = ps.find(p => p.name.startsWith('Surf'))!, life = ps.find(p => p.name.startsWith('Lifebuoy'))!;
  const cs0 = new ChangeSet();
  cs0.put('schemes', { companyId: surf.companyId, productId: surf.id, name: 'Surf 6+1', type: 'free', value: 0, buyQty: 6, freeQty: 1, from: '2020-01-01', to: '2099-01-01', source: 'company', combine: 'add' });
  cs0.put('schemes', { companyId: surf.companyId, productId: life.id, name: 'Lifebuoy 2.5% off', type: 'pct', value: 2.5, from: '2020-01-01', to: '2099-01-01', source: 'company', combine: 'add' });
  tn = cs0.put<Shop>('shops', { name: 'Test TN Traders', area: 'Pennadam', beat: 'Monday', gstin: gstinWithCheck('33AAKFT1234M1Z'), creditLimit: 50000, creditDays: 15, cashOnly: false, type: 'retail', approved: true, aliases: [], address: 'Main Road, Pennadam 606105' });
  const ka = cs0.put<Shop>('shops', { name: 'Hosur Border Mart', area: 'Attibele', beat: 'Monday', gstin: gstinWithCheck('29AAKFK1234M1Z'), creditLimit: 50000, creditDays: 15, cashOnly: false, type: 'retail', approved: true, aliases: [], address: 'NH44, Attibele 562107' });
  const kl = cs0.put<Shop>('shops', { name: 'Kerala Unreg Store', area: 'Palakkad', beat: 'Monday', stateCode: '32', creditLimit: 50000, creditDays: 15, cashOnly: false, type: 'retail', approved: true, aliases: [], address: 'Palakkad 678001' });
  await cs0.commit('setup');
  const bill = async (shop: Shop, lines: { productId: string; qty: number; rate: number }[]) => {
    const cs = new ChangeSet();
    const o = cs.put<never>('orders', { shopId: shop.id, salesmanId: owner.id, source: 'salesman', lines, date: today(), status: 'billed', issues: [], invoiceIds: [] });
    const [inv] = await makeInvoices(cs, o, shop); await cs.commit('bill'); return inv;
  };
  inv1 = await bill(tn, [{ productId: surf.id, qty: 13, rate: 112 }, { productId: life.id, qty: 7, rate: 31 }]);
  inv2 = await bill(ka, [{ productId: surf.id, qty: 5, rate: 112 }, { productId: life.id, qty: 3, rate: 31 }]);
  inv3 = await bill(kl, [{ productId: surf.id, qty: 5, rate: 112 }]);
  // Ex3: bill 1 refused at the door, owner chooses a credit note
  await recordDelivery([inv1.id], { returnAll: true });
  await settleDifference(inv1.id, 'credit_note');
}, 60_000);

describe('GST worked examples (to the paisa)', () => {
  it('Ex1 intra-state: 13 Surf (6+1 → 2 free) + 7 Lifebuoy (2.5% off)', () => {
    expect(inv1.lines.map(l => [l.qty, l.freeQty, l.taxable, l.cgst, l.sgst, l.igst, l.total])).toEqual([[13, 2, 1456, 131.04, 131.04, 0, 1718.08], [7, 0, 211.57, 5.29, 5.29, 0, 222.15]]);
    expect([inv1.taxable, inv1.cgst, inv1.sgst, inv1.igst, inv1.roundOff, inv1.total]).toEqual([1667.57, 136.33, 136.33, 0, -0.23, 1940]);
  });
  it('Ex2 inter-state B2B to Karnataka: IGST', () => {
    expect([inv2.kind, inv2.taxable, inv2.cgst, inv2.sgst, inv2.igst, inv2.total]).toEqual(['B2B', 650.67, 0, 0, 105.33, 756]);
  });
  it('Ex2b unregistered shop in Kerala: IGST ₹100.80, not CGST+SGST (shop state code)', () => {
    expect([inv3.kind, inv3.cgst, inv3.sgst, inv3.igst, inv3.total]).toEqual(['B2C', 0, 0, 100.8, 661]);
  });
  it('Ex3 refused bill: credit note is exactly the bill (₹1,940), free pieces ₹0, tax lines + original bill stored', async () => {
    const cn = (await db.creditNotes.toArray())[0];
    expect(cn.total).toBe(1940);
    expect([cn.taxable, cn.cgst, cn.sgst, cn.igst, cn.roundOff]).toEqual([1667.57, 136.33, 136.33, 0, -0.23]);
    expect(cn.invoiceNumber).toBe(inv1.number); expect(cn.invoiceDate).toBe(inv1.date);
    expect(cn.lines.map(l => [l.qty, l.freeQty, l.amount, l.gst, l.hsn, l.taxable])).toEqual([[13, 2, 1718.08, 18, '34022090', 1456], [7, 0, 222.15, 5, '34011190', 211.57]]);
    const out = await shopOutstanding(tn.id);
    expect([out.total, out.advance]).toEqual([0, 0]); // not ₹264.55 "advance" the shop never paid
  });
  it('Ex3 claim lines follow the bill: the refused bill claims nothing', async () => {
    const live = (await db.claimEntries.toArray()).filter(e => !e.dropped);
    expect(live.map(e => [e.invoiceId, e.amount])).toEqual([[inv2.id, 2.33]]);
  });
  it('GSTR-1: place of supply by shop state, CDNR one row per rate, B2C in B2CS, HSN B2B/B2C net of credit notes, documents issued', async () => {
    await (await exportGstr1(M)).actions![0].run();
    const sheets = captured[`Hanubix-GSTR1-${M}`] as Sheet[];
    const sh = (n: string) => sheets.find(s => s.name === n)!;
    expect(sh('b2b').rows.map(r => [r[2], r[5], r[10], r[11]])).toEqual([[inv1.number, '33-Tamil Nadu', 18, 1456], [inv1.number, '33-Tamil Nadu', 5, 211.57], [inv2.number, '29-Karnataka', 18, 560], [inv2.number, '29-Karnataka', 5, 90.67]]);
    expect(sh('b2cs').rows).toEqual([['OE', '32-Kerala', '', 18, 560, 0, '']]);
    expect(sh('b2cl').rows).toEqual([]);
    expect(sh('cdnr').rows.map(r => [r[2], r[5], r[8], r[10], r[11]])).toEqual([[(await db.creditNotes.toArray())[0].number, '33-Tamil Nadu', 1940, 18, 1456], [(await db.creditNotes.toArray())[0].number, '33-Tamil Nadu', 1940, 5, 211.57]]);
    expect(sh('hsn(b2b)').rows.map(r => [r[0], r[3], r[4], r[5], r[6], r[7], r[8], r[9]])).toEqual([['34022090', 5, 660.8, 18, 560, 100.8, 0, 0], ['34011190', 3, 95.2, 5, 90.67, 4.53, 0, 0]]);
    expect(sh('hsn(b2c)').rows.map(r => [r[0], r[3], r[4], r[5], r[6], r[7]])).toEqual([['34022090', 5, 660.8, 18, 560, 100.8]]);
    expect(sh('docs').rows.map(r => [r[0], r[3], r[4]])).toEqual([['Invoices for outward supply', 3, 0], ['Credit Note', 1, 0]]);
  });
  it('Tally: the credit note reverses sales AND GST per rate, and balances', async () => {
    const t = await tallyXml(M);
    const v = t.xml.split('<TALLYMESSAGE').find(x => x.includes('VCHTYPE="Credit Note"'))!;
    const amts = [...v.matchAll(/<LEDGERNAME>([^<]*)<\/LEDGERNAME><ISDEEMEDPOSITIVE>(\w+)<\/ISDEEMEDPOSITIVE><AMOUNT>([-\d.]+)/g)].map(m => [m[1], Number(m[3])]);
    expect(amts).toEqual([['Sales @18%', -1456], ['Sales @5%', -211.57], ['Output CGST', -136.33], ['Output SGST', -136.33], ['Round Off', 0.23], ['Test TN Traders', 1940]]);
    expect(r2(amts.reduce((a, x) => a + (x[1] as number), 0))).toBe(0);
  });
  it('P&L: sales ex-GST − credit notes ex-GST + company scheme claims − cost of pieces kept = +₹84.91', async () => {
    const p = await profitAndLoss('month'); const t = pnlTotals(p);
    expect(p.income.map(h => [h.key.startsWith('sales') ? 'sales' : h.key, h.amount])).toEqual([['sales', 2878.24], ['cn', -1667.57], ['claims', 2.33]]);
    expect(p.expense.map(h => [h.key, h.amount])).toEqual([['cogs', 1128.09]]);
    expect(t.profit).toBe(84.91);
  });
});
