// Round 3 pre-pilot (11 Nov 2026): day-one features and leftovers. Each block failed before its change.
// BA BLOCK1 (opening balances), manager decision (staff returns → requests), TRUST20 (cheques), receipts, TRUST18
// (salary), TRUST17 (reports), TRUST19 (rep orders), TRUST15 (order reply), TRUST16 (Indian time), write-offs,
// BLOCK3 (undo after sync), and the external review's one rule for bill-line stock lots.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { ChangeSet, db, daysFrom, GuardError, monthEnd, setSession, today, undoBatch, UNDO_SYNCED } from '../src/core/db';
import { seedDemo, gstinWithCheck } from '../src/core/seed';
import { checkOrder, makeInvoices } from '../src/core/billing';
import { bounceCheque, flagArrivedOrders, saveBillEdit } from '../src/core/pipeline';
import { commit, validate, hasErrors, type Proposal } from '../src/core/proposals';
import { allOutstanding, invoiceBalances, shopOutstanding, r2 } from '../src/core/ledger';
import { companyPayables } from '../src/core/payables';
import { openingDuesProposal, openingStockProposal, openingDueTotals } from '../src/core/opening';
import { approveRequest, rejectRequest, waitingRequests } from '../src/core/requests';
import { receiptText } from '../src/core/receipts';
import { salarySheet } from '../src/core/payroll';
import { collectionsByPerson, dayBook, period, prevMonth, salesSummary } from '../src/core/reports';
import { exportGstr1 } from '../src/core/exports';
import { localStamp, showTime } from '../src/core/i18n';
import type { Invoice, Order, Payment, Product, Shop, Staff } from '../src/core/types';

let owner: Staff, office: Staff, salesman: Staff, godown: Staff;
let surf: Product, life: Product;
let shopA: Shop, shopB: Shop;
const as = (s: Staff) => setSession(s.tenantId, s.id);
const asOwner = () => as(owner);
const stockOf = async (pid: string) => (await db.batches.where('productId').equals(pid).toArray()).reduce((a, b) => a + b.qty, 0);
async function bill(shop: Shop, lines: { productId: string; qty: number; rate: number }[]): Promise<Invoice> {
  const cs = new ChangeSet();
  const o = cs.put<Order>('orders', { shopId: shop.id, salesmanId: owner.id, source: 'salesman', lines, date: today(), status: 'billed', issues: [], invoiceIds: [] });
  const [inv] = await makeInvoices(cs, o, shop); await cs.commit('bill'); return inv;
}
const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' });
const payProposal = (shop: Shop, amount: number, pay: { invoiceId: string; pay: number }[], mode = 'cash', ref = ''): Proposal => ({
  id: 'pay', kind: 'payment', title: 'Record payment',
  fields: [{ key: 'shopId', label: 'Shop', value: shop.id }, { key: 'amount', label: 'Amount', value: amount }, { key: 'mode', label: 'Mode', value: mode }, { key: 'ref', label: 'Ref', value: ref }],
  columns: [], rows: pay.map(p => ({ ...p, balance: 1e9 })), meta: {},
} as unknown as Proposal);

beforeAll(async () => {
  await seedDemo();
  const staff = await db.staff.toArray();
  owner = staff.find(s => s.role === 'owner')!; salesman = staff.find(s => s.role === 'salesman')!; godown = staff.find(s => s.role === 'godown')!;
  asOwner();
  const ps = await db.products.toArray();
  surf = ps.find(p => p.name.startsWith('Surf'))!; life = ps.find(p => p.name.startsWith('Lifebuoy'))!;
  const cs = new ChangeSet();
  shopA = cs.put<Shop>('shops', { name: 'Old Dues Stores', area: 'Pennadam', beat: 'Monday', gstin: gstinWithCheck('33AAKFO1234M1Z'), creditLimit: 5000, creditDays: 15, cashOnly: false, type: 'retail', approved: true, aliases: [] });
  shopB = cs.put<Shop>('shops', { name: 'Kumar Agencies', area: 'Tittakudi', beat: 'Tuesday', creditLimit: 0, creditDays: 7, cashOnly: true, type: 'retail', approved: true, aliases: [] });
  office = cs.put<Staff>('staff', { name: 'Office Priya', phone: '9000000077', role: 'office', pin: '6831', active: true });
  await cs.commit('setup');
}, 60_000);

describe('1. opening balances (BA BLOCK1)', () => {
  it('old dues from Excel: bill-wise or one amount with a date; the loaded total matches the sheet to the rupee', async () => {
    const r = await openingDuesProposal(csv('dues.csv', 'Shop Name,Bill No,Bill Date,Balance\nOld Dues Stores,A-101,05/09/2026,"3,450.50"\nOld Dues Stores,A-117,20/10/2026,1200\nKumar Agencies,,,"8,000"\nTotal,,,"12,650.50"\n'));
    const p = (r as { proposal: Proposal }).proposal;
    expect(p.kind).toBe('openingDues');
    expect(p.meta.sheetTotal).toBe(12650.5);
    expect(p.rows.map(x => [x.shopId, x.ref, x.amount])).toEqual([[shopA.id, 'A-101', 3450.5], [shopA.id, 'A-117', 1200], [shopB.id, '', 8000]]);
    p.fields[0].value = '2026-11-01'; // "as on" for the row with no date
    const v = await validate(p);
    expect(hasErrors(v)).toBe(false);
    expect(v.summary).toContain('₹12,650.50');
    const res = await commit(p);
    expect(res.message).toContain('total ₹12,650.50 — the sheet\'s total is ₹12,650.50');
    expect(await openingDueTotals()).toEqual({ rows: 3, shops: 2, total: 12650.5 });
    // a second ✓ on the same sheet loads nothing again
    await expect(commit(p)).rejects.toThrow(/Already loaded/);
    expect((await openingDueTotals()).total).toBe(12650.5);
  });

  it('old dues show in outstanding, ageing and the credit check — and never in sales or GST', async () => {
    const o = await shopOutstanding(shopA.id);
    expect(o.total).toBe(4650.5);
    expect(o.maxOverdueDays).toBeGreaterThan(30); // 5 Sep + 15 credit days
    expect((await allOutstanding()).get(shopB.id)?.total).toBe(8000);
    const bal = (await invoiceBalances(shopA.id)).map(b => [b.invoice.number, b.invoice.date, b.balance]);
    expect(bal).toEqual([['Old bill A-101', '2026-09-05', 3450.5], ['Old bill A-117', '2026-10-20', 1200]]);
    const chk = await checkOrder(shopA, [{ productId: surf.id, qty: 12, rate: surf.rate }]);
    expect(chk.issues.some(x => /Credit limit ₹5,000 crossed/.test(x))).toBe(true);
    expect(chk.issues.some(x => /Overdue/.test(x))).toBe(true);
    expect((await checkOrder(shopB, [{ productId: surf.id, qty: 1, rate: surf.rate }])).issues).toContain('Cash-only shop has ₹8,000 pending');
    expect(await db.invoices.where('shopId').equals(shopA.id).count()).toBe(0);
    expect((await salesSummary(period('month'))).bills).toBe((await db.invoices.toArray()).filter(i => !i.cancelled && i.date >= `${today().slice(0, 7)}-01`).length);
    // an old due is never saved as a bill
    const cs = new ChangeSet(); cs.put('invoices', { ...(await invoiceBalances(shopA.id))[0].invoice });
    await expect(cs.commit('x')).rejects.toThrow(GuardError);
  });

  it('an old due is collected without any app bill, like a bill (oldest first), and the receipt names it', async () => {
    const [first] = await invoiceBalances(shopA.id);
    as(salesman);
    try {
      const res = await commit(payProposal(shopA, 4000, [{ invoiceId: first.invoice.id, pay: 3450.5 }, { invoiceId: (await invoiceBalances(shopA.id))[1].invoice.id, pay: 549.5 }]));
      expect(res.message).toMatch(/Receipt R\/\d{2}-\d{2}\/\d{5}/);
    } finally { asOwner(); }
    const after = await invoiceBalances(shopA.id);
    expect(after.map(b => b.balance)).toEqual([0, 650.5]);
    expect((await shopOutstanding(shopA.id)).total).toBe(650.5);
    const p = (await db.payments.where('shopId').equals(shopA.id).toArray())[0];
    expect(await receiptText(p)).toContain('Against: A-101, A-117');
  });

  it('opening stock loads lots with NO purchase bill and nothing owed to the company; a double tap loads once', async () => {
    const payBefore = JSON.stringify([...(await companyPayables()).entries()]);
    const purchasesBefore = await db.purchases.count();
    const s0 = await stockOf(life.id);
    const r = await openingStockProposal(csv('stock.csv', `Item Name,Batch,Expiry,MRP,Qty,Rate\n${life.name},OP1,12/2027,32,120,24.5\n${life.name},OP2,,32,30,24.5\n`));
    const p = (r as { proposal: Proposal }).proposal;
    expect(p.rows.map(x => [x.productId, x.batch, x.qty])).toEqual([[life.id, 'OP1', 120], [life.id, 'OP2', 30]]);
    const v = await validate(p);
    expect(hasErrors(v)).toBe(false);
    expect(v.summary).toContain('150 pcs');
    expect(v.summary).toContain('₹3,675'); // 150 × 24.50
    const res = await commit(p);
    expect(res.message).toContain('₹3,675 at buying rate — the sheet\'s total is ₹3,675');
    await expect(commit(p)).rejects.toThrow(/already loaded/);
    expect(await stockOf(life.id)).toBe(s0 + 150);
    expect(await db.purchases.count()).toBe(purchasesBefore);
    expect(JSON.stringify([...(await companyPayables()).entries()])).toBe(payBefore);
    expect((await db.batches.where('productId').equals(life.id).toArray()).find(b => b.batch === 'OP2')?.expiry).toBe('9999-12-31');
  });
});

describe('2/12. staff returns and godown write-offs are requests the owner decides', () => {
  const returnProposal = (shop: Shop, inv: Invoice, rows: { productId: string; qty: number; restock?: string }[]): Proposal => ({
    id: 'r', kind: 'return', title: 'Shop return → credit note',
    fields: [{ key: 'shopId', label: 'Shop', value: shop.id }, { key: 'reason', label: 'Reason', value: 'Expired' }],
    columns: [], rows: rows.map(r => ({ said: '', productId: r.productId, qty: r.qty, invoiceId: inv.id, bill: inv.number, amount: 0, restock: r.restock ?? 'yes' })), meta: {},
  } as unknown as Proposal);

  it('a delivery / salesman return makes no credit note on their phone: a waiting request; the owner approves → credit note with a number', async () => {
    const inv = await bill(shopB, [{ productId: surf.id, qty: 6, rate: surf.rate }]);
    as(salesman);
    try { await commit(returnProposal(shopB, inv, [{ productId: surf.id, qty: 1 }])); } finally { asOwner(); }
    expect(await db.creditNotes.where('invoiceId').equals(inv.id).count()).toBe(0);
    const req = (await waitingRequests()).find(r => r.rows.some(x => x.invoiceId === inv.id))!;
    expect(req).toMatchObject({ kind: 'return', by: salesman.id, status: 'waiting', ownerOnly: false });
    const s0 = await stockOf(surf.id);
    // a double tap approves once
    const both = await Promise.allSettled([approveRequest(req.id), approveRequest(req.id)]);
    expect(both.filter(x => x.status === 'fulfilled').length).toBe(1);
    const cns = await db.creditNotes.where('invoiceId').equals(inv.id).toArray();
    expect(cns.length).toBe(1);
    expect(cns[0].number).toMatch(/^CN\/\d{2}-\d{2}\/\d{5}$/);
    expect(await stockOf(surf.id)).toBe(s0 + 1);
    expect((await db.requests.get(req.id))).toMatchObject({ status: 'approved', decidedBy: owner.id });
    expect((await db.requests.get(req.id))!.result).toContain(cns[0].number);
  });

  it('office decides returns within the limit; above it only the owner; a reject keeps everything with the reason', async () => {
    const inv = await bill(shopB, [{ productId: surf.id, qty: 30, rate: surf.rate }]);
    as(office);
    try {
      await commit(returnProposal(shopB, inv, [{ productId: surf.id, qty: 20 }])); // above ₹2,000: a request for the owner
      const req = (await waitingRequests()).find(r => r.rows.some(x => x.invoiceId === inv.id))!;
      expect(req.ownerOnly).toBe(true);
      await expect(approveRequest(req.id)).rejects.toThrow(/only the owner/);
      await expect(rejectRequest(req.id, 'x')).rejects.toThrow(/owner/);
    } finally { asOwner(); }
    const req = (await waitingRequests()).find(r => r.rows.some(x => x.invoiceId === inv.id))!;
    await expect(rejectRequest(req.id, ' ')).rejects.toThrow(/why/);
    await rejectRequest(req.id, 'Shop never returned them');
    expect(await db.requests.get(req.id)).toMatchObject({ status: 'rejected', rejectReason: 'Shop never returned them' });
    expect(await db.creditNotes.where('invoiceId').equals(inv.id).count()).toBe(0);
    await expect(approveRequest(req.id)).rejects.toThrow(/already rejected/);
  });

  it('a godown damage write-off above ₹500 waits for the owner; stock leaves only when approved; small ones go straight in', async () => {
    const claim = (qty: number): Proposal => ({ id: 'c', kind: 'claim', title: 'Damage', fields: [], columns: [], rows: [{ said: '', productId: surf.id, qty, kind: 'damage', amount: 0, fromStock: 'yes', note: 'rat bite' }], meta: {} } as unknown as Proposal);
    const s0 = await stockOf(surf.id);
    as(godown);
    try {
      await commit(claim(1)); // about ₹112: under the limit, saved at once
      expect(await stockOf(surf.id)).toBe(s0 - 1);
      const big = await commit({ ...claim(10), id: 'c2' }); // 10 × selling rate > ₹500 (the day's running total counts too)
      expect(big.message).toMatch(/sent to the owner/);
      expect(await stockOf(surf.id)).toBe(s0 - 1);
    } finally { asOwner(); }
    const req = (await waitingRequests()).find(r => r.kind === 'damage')!;
    expect(req).toMatchObject({ by: godown.id, ownerOnly: true });
    await approveRequest(req.id);
    expect(await stockOf(surf.id)).toBe(s0 - 11);
  });

  it('a stock count that writes off more than ₹500 waits; approved later it applies the counted difference to stock as it is then', async () => {
    const lot = (await db.batches.where('productId').equals(surf.id).toArray()).filter(b => b.qty >= 20).sort((a, b) => b.qty - a.qty)[0];
    const fix: Proposal = { id: 'f', kind: 'stockFix', title: 'Count', fields: [{ key: 'productId', label: 'Product', value: surf.id }, { key: 'reason', label: 'Reason', value: 'counted' }], columns: [], rows: [{ batchId: lot.id, batch: lot.batch, expiry: lot.expiry, system: lot.qty, counted: lot.qty - 10 }], meta: {} } as unknown as Proposal;
    as(godown);
    try { expect((await commit(fix)).message).toMatch(/sent to the owner/); } finally { asOwner(); }
    expect((await db.batches.get(lot.id))!.qty).toBe(lot.qty);
    // a bill takes 2 from the lot before the owner approves: the count's −10 still applies on top
    const cs = new ChangeSet(); cs.put('batches', { ...(await db.batches.get(lot.id))!, qty: lot.qty - 2 }); await cs.commit('sold');
    await approveRequest((await waitingRequests()).find(r => r.kind === 'count')!.id);
    expect((await db.batches.get(lot.id))!.qty).toBe(lot.qty - 12);
  });
});

describe('5. cheques (BA TRUST20)', () => {
  it('a post-dated cheque clears no dues before its date; a bounce asks a reason and opens the bills again', async () => {
    const inv = await bill(shopB, [{ productId: life.id, qty: 10, rate: life.rate }]);
    const before = (await shopOutstanding(shopB.id)).total;
    const cs = new ChangeSet();
    const p = cs.put<Payment>('payments', { shopId: shopB.id, amount: inv.total, mode: 'cheque', ref: '445566 SBI', chequeDate: daysFrom(5), date: today(), collectedBy: owner.id, shopConfirmed: true, allocations: [{ invoiceId: inv.id, amount: inv.total }], advance: 0, settled: false, status: 'ok' });
    await cs.commit('cheque');
    expect((await shopOutstanding(shopB.id)).total).toBe(before); // not cleared before its date
    const cs2 = new ChangeSet(); cs2.put('payments', { ...p, chequeDate: today() }); await cs2.commit('dated today');
    expect((await shopOutstanding(shopB.id)).total).toBe(r2(before - inv.total));
    await expect(bounceCheque(p.id, '')).rejects.toThrow(/why/);
    await bounceCheque(p.id, 'Funds insufficient');
    expect(await db.payments.get(p.id)).toMatchObject({ status: 'bounced', bounce: { reason: 'Funds insufficient', by: owner.id } });
    expect((await shopOutstanding(shopB.id)).total).toBe(before);
    await expect(bounceCheque(p.id, 'again')).rejects.toThrow(/already/);
  });
});

describe('6. receipts', () => {
  it('every collection gets the next running receipt number', async () => {
    const take = async (amount: number) => { await commit(payProposal(shopB, amount, [])); return (await db.payments.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).pop()!; };
    const a = await take(100), b = await take(200);
    const n = (p: Payment) => Number(p.receiptNo!.split('/').pop());
    expect(n(b)).toBe(n(a) + 1);
    const text = await receiptText(b);
    expect(text).toContain(`Receipt ${b.receiptNo}`);
    expect(text).toContain('Kumar Agencies: ₹200 by CASH');
  });
});

describe('7. salary (BA TRUST18)', () => {
  it('unexplained absence and leave beyond the paid days are cut at salary ÷ days in month; the sheet shows the days counted', async () => {
    const m = prevMonth(today().slice(0, 7));
    const [y, mo] = m.split('-').map(Number);
    const dim = new Date(y, mo, 0).getDate();
    const days = Array.from({ length: dim }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`);
    const work = days.filter(d => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8))).getDay() !== 0);
    const cs = new ChangeSet();
    const p = cs.put<Staff>('staff', { name: 'Ravi Test', phone: '9000000088', role: 'salesman', pin: '2958', active: true, salary: 15000, batta: 100, createdAt: `${prevMonth(m)}-01T04:00:00.000Z` });
    const leaveDays = work.slice(2, 5); // 3 days approved leave
    const absentDays = work.slice(5, 7); // 2 days: no check-in, no leave
    for (const d of work.filter(d => !leaveDays.includes(d) && !absentDays.includes(d))) cs.put('checkIns', { staffId: p.id, date: d, at: `${d}T03:30:00.000Z`, late: false });
    cs.put('leaves', { staffId: p.id, from: leaveDays[0], to: leaveDays[2], reason: 'family', status: 'approved' });
    await cs.commit('month');
    const row = (await salarySheet(m)).find(r => r.s.id === p.id)!;
    expect([row.daysInMonth, row.workDays, row.present, row.leave, row.paidLeave, row.unpaidLeave, row.absent, row.cutDays]).toEqual([dim, work.length, work.length - 5, 3, 2, 1, 2, 3]);
    expect(row.cut).toBe(Math.round(15000 * 3 / dim));
    expect(row.gross).toBe(Math.round(15000 - Math.round(15000 * 3 / dim) + (work.length - 5) * 100));
    // the owner sets 3 paid leave days: only the 2 absences are cut
    const st = (await db.settings.toArray())[0]; const cs2 = new ChangeSet(); cs2.put('settings', { ...st, paidLeaves: 3 }); await cs2.commit('paid leaves');
    expect((await salarySheet(m)).find(r => r.s.id === p.id)!.cutDays).toBe(2);
  });
});

describe('8. reports (BA TRUST17)', () => {
  it('sales net of credit notes; the month matches the GST screen and GSTR-1; day book and collections add up', async () => {
    const m = today().slice(0, 7);
    const p = period('month');
    expect(period('last')).toMatchObject({ from: `${prevMonth(m)}-01`, to: monthEnd(prevMonth(m)) });
    expect(period('pick', '2026-07')).toMatchObject({ from: '2026-07-01', to: '2026-07-31', label: 'Jul 2026' });
    const sum = await salesSummary(p);
    const bills = (await db.invoices.toArray()).filter(i => !i.cancelled && i.date.startsWith(m));
    expect(sum.billed.taxable).toBe(r2(bills.reduce((a, i) => a + i.taxable, 0)));
    expect(sum.credited.taxable).toBeGreaterThan(0); // the approved return above
    expect(sum.net.taxable).toBe(r2(sum.billed.taxable - sum.credited.taxable));
    const g = await exportGstr1(m);
    expect(g.text).toContain(`taxable ${(await import('../src/core/i18n')).inr(sum.net.taxable)} after credit notes`);
    const book = await dayBook(p);
    expect(book.total.taxable).toBe(sum.net.taxable);
    expect(book.rows.some(r => r.kind === 'Credit note' && r.taxable < 0)).toBe(true);
    const col = await collectionsByPerson(p);
    const pays = (await db.payments.toArray()).filter(x => x.date.startsWith(m) && x.status !== 'cancelled' && x.status !== 'bounced');
    expect(col.total).toBe(r2(pays.reduce((a, x) => a + x.amount, 0)));
  });
});

describe('9/10. rep orders get the same flags; the owner\'s own order goes straight to the godown', () => {
  it('a rep order that arrived through the link is checked like a salesman order (stock short, cash-only dues)', async () => {
    const cs = new ChangeSet();
    const o = cs.put<Order>('orders', { shopId: shopB.id, source: 'company', companyRep: 'Arun', lines: [{ productId: surf.id, qty: 99999, rate: surf.rate }], status: 'new', issues: [], flagsPending: true, date: today(), invoiceIds: [] });
    await cs.commit('arrived');
    expect(await flagArrivedOrders()).toBe(1);
    const got = (await db.orders.get(o.id))!;
    expect(got.flagsPending).toBe(false);
    expect(got.issues.some(x => x.startsWith('Stock short'))).toBe(true);
    expect(got.issues.some(x => x.startsWith('Cash-only shop has'))).toBe(true);
    expect(await flagArrivedOrders()).toBe(0);
  });
  it('a salesman\'s order is told it waits for the owner', async () => {
    const p: Proposal = { id: 'o', kind: 'order', title: 'Order', fields: [{ key: 'shopId', label: 'Shop', value: shopA.id }], columns: [], rows: [{ productId: life.id, qty: 2, rate: life.rate }], meta: {} } as unknown as Proposal;
    as(salesman);
    try {
      expect((await validate(p)).summary).toMatch(/goes to the owner to approve/);
      const r = await commit(p);
      expect(r.message).toMatch(/sent to the owner to approve/);
      expect((await db.orders.get(r.orderId!))!.status).toBe('new');
    } finally { asOwner(); }
  });
});

describe('11. Indian time', () => {
  it('a time saved between 00:00 and 05:30 IST shows as the Indian clock time, not UTC', () => {
    const iso = '2026-11-10T19:05:00.000Z'; // 00:35 on 11 Nov in India
    const d = new Date(iso);
    expect(showTime(iso)).toBe(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    expect(localStamp(iso).slice(0, 10)).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Kolkata') {
      expect(showTime(iso)).toBe('00:35');
      expect(localStamp(iso)).toBe('2026-11-11T00:35:00');
    }
  });
});

describe('13. undo after sync (BA BLOCK3 / systems 5)', () => {
  it('an action that has reached the office is never undone on one phone: "cancel it instead"', async () => {
    const cs = new ChangeSet(); const e = cs.put('expenses', { date: today(), category: 'tea', amount: 40 }); const batch = await cs.commit('tea');
    // the sync marks the record and its history entry as sent
    await db.expenses.update(e.id, { dirty: 0 });
    for (const a of await db.audit.where('batchId').equals(batch).toArray()) await db.audit.update(a.id, { dirty: 0 });
    expect(await undoBatch(batch)).toBe(UNDO_SYNCED);
    expect(await db.expenses.get(e.id)).toBeTruthy();
  });
  it('undoing a bill never deletes its number: the bill stays, cancelled, and its stock is back', async () => {
    const s0 = await stockOf(life.id);
    const cs = new ChangeSet();
    const o = cs.put<Order>('orders', { shopId: shopA.id, salesmanId: owner.id, source: 'salesman', lines: [{ productId: life.id, qty: 3, rate: life.rate }], date: today(), status: 'billed', issues: [], invoiceIds: [] });
    const [inv] = await makeInvoices(cs, o, shopA); const batch = await cs.commit('bill');
    expect(await stockOf(life.id)).toBe(s0 - 3);
    expect(await undoBatch(batch)).toBeGreaterThan(0);
    const kept = (await db.invoices.get(inv.id))!;
    expect(kept.number).toBe(inv.number);
    expect(kept.cancelled?.reason).toBe('Undone');
    expect(kept.lines.every(l => l.batches.every(b => b.qty === 0))).toBe(true);
    expect(await stockOf(life.id)).toBe(s0);
  });
});

describe('14. one rule for a bill line\'s stock lots (external review)', () => {
  it('a line with no lots, a lot with no batch, or an edit that charges pieces no lot gave: refused the same way', async () => {
    const inv = await bill(shopA, [{ productId: life.id, qty: 2, rate: life.rate }]);
    const put = async (lines: unknown) => { const cs = new ChangeSet(); cs.put('invoices', { ...(await db.invoices.get(inv.id))!, lines }); return cs.commit('x'); };
    await expect(put([{ ...inv.lines[0], batches: undefined }])).rejects.toThrow(/no stock lots/);
    await expect(put([{ ...inv.lines[0], batches: [{ batch: 'X', qty: 2, expiry: '2099-01-01' }] }])).rejects.toThrow(/without its batch/);
    await expect(put([{ ...inv.lines[0], qty: 5 }])).rejects.toThrow(/Not enough stock/);
    // a delivery taking pieces off the lots (charged pieces unchanged) is fine
    await put([{ ...inv.lines[0], batches: inv.lines[0].batches.map(b => ({ ...b, qty: 0 })) }]);
    // the bill editor follows the same rule (and takes the pieces from stock)
    await saveBillEdit(inv.id, shopA.id, [{ productId: life.id, qty: 3, rate: life.rate }]);
    const after = (await db.invoices.get(inv.id))!;
    expect(after.lines[0].batches.reduce((a, b) => a + b.qty, 0)).toBe(3);
  });
  it('a lot the picker chose that has expired is never sold: the bill takes good lots', async () => {
    const cs = new ChangeSet();
    const old = cs.put('batches', { productId: life.id, batch: 'EXP1', expiry: daysFrom(-3), mrp: 32, qty: 50, godown: 'Main' });
    const o = cs.put<Order>('orders', { shopId: shopA.id, salesmanId: owner.id, source: 'salesman', lines: [{ productId: life.id, qty: 4, rate: life.rate, batchId: old.id }], date: today(), status: 'billed', issues: [], invoiceIds: [] });
    const [inv] = await makeInvoices(cs, o, shopA); await cs.commit('bill');
    expect(inv.lines[0].batches.some(b => b.batchId === old.id)).toBe(false);
    expect(inv.lines[0].batches.reduce((a, b) => a + b.qty, 0)).toBe(4);
  });
});
