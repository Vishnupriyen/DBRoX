// Final pre-pilot round A (money + TESRAX logic). Each test failed before its fix.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { ChangeSet, db, setSession, today, daysFrom } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle, type Reply } from '../src/core/engine';
import { commit, validate, hasErrors, type Proposal } from '../src/core/proposals';
import { shopOutstanding } from '../src/core/ledger';
import { approveRequest, waitingRequests } from '../src/core/requests';
import { bounceCheque, cancelPayment } from '../src/core/pipeline';
import { makeInvoices } from '../src/core/billing';
import type { Invoice, Order, Shop } from '../src/core/types';

const ids: Record<string, string> = {};
const as = (r: string) => setSession('demo', ids[r]);
const say = (t: string, last?: Reply) => handle(t, [], { last });
const stock = async (pid: string) => (await db.batches.where('productId').equals(pid).toArray()).reduce((a, b) => a + b.qty, 0);
const shopNamed = async (n: string) => (await db.shops.toArray()).find(s => s.name.startsWith(n))!;
const prod = async (n: string) => (await db.products.toArray()).find(p => p.name.startsWith(n))!;
const fv = (p: Proposal, k: string) => p.fields.find(f => f.key === k)?.value;
async function bill(shop: Shop, lines: { productId: string; qty: number; rate: number }[]): Promise<Invoice> {
  const cs = new ChangeSet();
  const o = cs.put<Order>('orders', { shopId: shop.id, salesmanId: ids.owner, source: 'salesman', lines, date: today(), status: 'billed', issues: [], invoiceIds: [] } as never);
  const [inv] = await makeInvoices(cs, o, shop); await cs.commit('bill'); return inv;
}
beforeAll(async () => { await seedDemo(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id; as('owner'); }, 60000);

describe('1 cheque date / number / bank from TESRAX', () => {
  it('post-dated cheque keeps its date, number and bank and does not clear dues today', async () => {
    as('owner');
    const shop = await shopNamed('Murugan');
    const before = (await shopOutstanding(shop.id)).total;
    const r = await say('Murugan Stores 500 cheque 30 nov SBI 123456');
    const p = r.proposal!;
    expect(p.kind).toBe('payment');
    expect(fv(p, 'amount')).toBe(500);
    expect(fv(p, 'mode')).toBe('cheque');
    expect(fv(p, 'chequeDate')).toBe(`${today().slice(0, 4)}-11-30`);
    expect(fv(p, 'ref')).toBe('123456');
    expect(String(fv(p, 'chequeBank')).toLowerCase()).toContain('sbi');
    await commit(p);
    const pay = (await db.payments.where('shopId').equals(shop.id).toArray()).find(x => x.mode === 'cheque')!;
    expect(pay.chequeDate).toBe(`${today().slice(0, 4)}-11-30`);
    expect(pay.chequeBank?.toLowerCase()).toContain('sbi');
    expect((await shopOutstanding(shop.id)).total).toBe(before);
  });
  it('a cheque without a date asks nothing odd: dated today', async () => {
    const r = await say('Kumar Mart 300 cheque');
    expect(fv(r.proposal!, 'chequeDate')).toBe(today());
  });
});

describe('2 damaged return', () => {
  it('"return 2 surf damaged" finds the product, is not restocked, and the pieces go to the claim register', async () => {
    as('owner');
    const shop = await shopNamed('Murugan'); const surf = await prod('Surf');
    await bill(shop, [{ productId: surf.id, qty: 6, rate: surf.rate }]);
    const s0 = await stock(surf.id); const c0 = await db.claimEntries.count();
    const r = await say('murugan return 2 surf damaged');
    const p = r.proposal!;
    expect(p.kind).toBe('return');
    expect(p.rows[0].productId).toBe(surf.id);
    expect(p.rows[0].restock).toBe('no');
    expect(String(fv(p, 'reason'))).toMatch(/damag/i);
    await commit(p);
    expect(await stock(surf.id)).toBe(s0);
    expect(await db.claimEntries.count()).toBe(c0 + 1);
    const ce = (await db.claimEntries.toArray()).at(-1)!;
    expect(ce.productId).toBe(surf.id); expect(ce.qty).toBe(2); expect(ce.kind).toBe('damage');
  });
});

describe('3 write-off limit is a running total per person per day', () => {
  it('three small damages from one godown person add up to a request', async () => {
    as('godown');
    const surf = await prod('Surf');
    const reqs0 = (await waitingRequests()).length;
    for (let i = 0; i < 3; i++) { const r = await say('4 surf damage'); await commit(r.proposal!); }
    expect((await waitingRequests()).length).toBeGreaterThan(reqs0);
  });
});

describe('4 cancelPayment / bounceCheque roles', () => {
  it('salesman cannot cancel or bounce; the collector cancels own unsettled; owner can', async () => {
    as('owner');
    const shop = await shopNamed('Velan');
    const mk = async (collector: string, mode: 'cash' | 'cheque', settled: boolean) => {
      const cs = new ChangeSet();
      const p = cs.put('payments', { shopId: shop.id, amount: 100, mode, ref: '', date: today(), collectedBy: collector, shopConfirmed: true, allocations: [], advance: 100, settled, status: 'ok' } as never) as { id: string };
      await cs.commit('p'); return p.id;
    };
    const a = await mk(ids.owner, 'cash', false);
    as('salesman');
    await expect(cancelPayment(a, 'x')).rejects.toThrow(/owner|office|only/i);
    const b = await mk(ids.owner, 'cheque', false);
    await expect(bounceCheque(b, 'x')).rejects.toThrow(/owner|office|only/i);
    const own = await mk(ids.salesman, 'cash', false);
    await cancelPayment(own, 'mine');
    const settled = await mk(ids.salesman, 'cash', true);
    await expect(cancelPayment(settled, 'late')).rejects.toThrow(/owner|office|only/i);
    as('owner');
    await cancelPayment(a, 'ok'); await bounceCheque(b, 'funds');
  });
});

describe('5 cancel of a delivered bill is refused up front', () => {
  it('TESRAX billCancel table shows the delivered block and the tick is disabled (errors)', async () => {
    as('owner');
    const shop = await shopNamed('Kumar'); const vim = await prod('Vim');
    const inv = await bill(shop, [{ productId: vim.id, qty: 2, rate: vim.rate }]);
    const { recordDelivery } = await import('../src/core/pipeline');
    await recordDelivery([inv.id], {});
    const r = await say('cancel kumar mart bill');
    const p = r.proposal!;
    expect(p.kind).toBe('billCancel');
    p.fields = p.fields.map(f => f.key === 'reason' ? { ...f, value: 'wrong' } : f);
    const v = await validate(p);
    expect(hasErrors(v)).toBe(true);
    expect(Object.values(v.fieldErrors).join(' ')).toMatch(/delivered.*credit note/i);
  });
});

describe('6 order validation', () => {
  it('whole qty > 0 and rate > 0', async () => {
    as('owner');
    for (const [q, rate] of [[2.5, 112], [3, -5], [3, 0]] as const) {
      const r = await say('murugan 1 pc surf'); const p = r.proposal!;
      p.rows = p.rows.map(x => ({ ...x, qty: q, rate }));
      expect(hasErrors(await validate(p)), `qty ${q} rate ${rate}`).toBe(true);
    }
  });
});

describe('7 period words and report routes', () => {
  it('"last month sales" is not today\'s numbers', async () => {
    as('owner');
    const r = await say('last month sales');
    expect(r.text).not.toMatch(/^Today/);
    expect(r.text).toMatch(/last month|October/i);
    expect(r.link?.page ?? r.go).toBe('reports');
  });
  // since 12 Nov 2026 (owner: "every report it should send") TESRAX answers with the report itself, Reports one tap away
  it('"day book" and "collections by person this month" give the report, with Reports one tap away', async () => {
    as('owner');
    const a = await say('day book'), b = await say('collections by person this month');
    expect(a.text).toMatch(/^Day book/); expect(a.link?.page).toBe('reports');
    expect(b.text).toMatch(/^Collections by person/); expect(b.link?.page).toBe('reports');
  });
});

describe('8 salary from the joining date', () => {
  it('a person who joined 3 days ago is not paid the whole month', async () => {
    as('owner');
    const { salarySheet } = await import('../src/core/payroll');
    const sm = (await db.staff.get(ids.salesman))!;
    const cs = new ChangeSet(); cs.put('staff', { ...sm, createdAt: daysFrom(-3) + 'T05:00:00.000Z', salary: 30000, batta: 0 } as never); await cs.commit('x');
    const month = today().slice(0, 7);
    const row = (await salarySheet(month)).find(r => r.s.id === ids.salesman)!;
    const daysIn = row.daysInMonth;
    const joinedDay = Number(daysFrom(-3).slice(8, 10));
    if (daysFrom(-3).slice(0, 7) === month) {
      expect(row.gross).toBeLessThan(30000);
      expect(row.cut).toBeGreaterThanOrEqual(Math.round(30000 * (joinedDay - 1) / daysIn));
      expect(row.beforeJoining).toBe(joinedDay - 1);
    }
  });
});

describe('9 minus signs and extra decimals are asked, never flipped', () => {
  it('negative amounts and quantities ask', async () => {
    as('owner');
    for (const t of ['Murugan Stores paid -500', 'Murugan Stores paid 1,500.555']) {
      const r = await say(t);
      expect(r.proposal, t).toBeUndefined();
      expect(r.tone, t).toBe('warn');
    }
    as('godown');
    const r = await say('surf -5 damage');
    expect(r.proposal).toBeUndefined(); expect(r.tone).toBe('warn');
    as('owner');
  });
});

describe('10 claim checks stock first', () => {
  it('"600 surf damage" with less in stock is an error, not an owner request', async () => {
    as('godown');
    const r = await say('99999 surf damage');
    const v = await validate(r.proposal!);
    expect(hasErrors(v)).toBe(true);
    expect(JSON.stringify(v.errors)).toMatch(/Only \d+ pcs in stock/);
    as('owner');
  });
});

describe('11 bill editor', () => {
  it('rate and discount that make a ₹0 bill are refused', async () => {
    as('owner');
    const { saveBillEdit } = await import('../src/core/pipeline');
    const shop = await shopNamed('Selvam'); const vim = await prod('Vim');
    const inv = await bill(shop, [{ productId: vim.id, qty: 4, rate: vim.rate }]);
    await expect(saveBillEdit(inv.id, shop.id, [{ productId: vim.id, qty: 2, rate: 0 }])).rejects.toThrow();
    await expect(saveBillEdit(inv.id, shop.id, [{ productId: vim.id, qty: 2, rate: 0.01 }])).rejects.toThrow();
    await expect(saveBillEdit(inv.id, shop.id, [{ productId: vim.id, qty: 2, rate: vim.rate, discount: 1e9 }])).rejects.toThrow();
    const ok = await saveBillEdit(inv.id, shop.id, [{ productId: vim.id, qty: 2, rate: vim.rate }]);
    expect(ok).toBeTruthy();
  });
});

describe('12 commit is idempotent per proposal id', () => {
  it('the same payment proposal committed twice makes one payment', async () => {
    as('owner');
    const shop = await shopNamed('Ganapathi');
    const r = await say('Ganapathi paid 120');
    const n0 = (await db.payments.where('shopId').equals(shop.id).toArray()).length;
    const two = await Promise.allSettled([commit(r.proposal!), commit(r.proposal!)]); expect(two.filter(x => x.status === 'rejected').length).toBe(1);
    await commit(r.proposal!).catch(() => undefined);
    expect((await db.payments.where('shopId').equals(shop.id).toArray()).length).toBe(n0 + 1);
  });
});

describe('P9 advance always comes as a check-and-tick table', () => {
  it('"advance 2000" to a staff member saves nothing until the tick', async () => {
    as('owner');
    const sm = (await db.staff.get(ids.salesman))!;
    const a0 = await db.advances.count();
    const r = await say(`${sm.name.split(' ')[0]} ku advance 2000 kudu`);
    expect(r.proposal?.kind).toBe('advance');
    expect(await db.advances.count()).toBe(a0);
    await commit(r.proposal!);
    expect(await db.advances.count()).toBe(a0 + 1);
    const r2 = await say('advance 1000');
    expect(r2.proposal?.kind).toBe('advance');
  });
});

describe('P10 billed today is net of cancelled / fully credited, collected leaves out post-dated cheques', () => {
  it('daySummary', async () => {
    as('owner');
    const { daySummary, cancelInvoice } = await import('../src/core/pipeline');
    const s0 = await daySummary();
    const shop = await shopNamed('Velan'); const vim = await prod('Vim');
    const inv = await bill(shop, [{ productId: vim.id, qty: 3, rate: vim.rate }]);
    const s1 = await daySummary();
    expect(s1.sales).toBeCloseTo(s0.sales + inv.total, 1);
    // fully credited: its value leaves "billed today"
    const rr = await say('velan return 3 vim'); await commit(rr.proposal!);
    const s2 = await daySummary();
    expect(s2.sales).toBeCloseTo(s0.sales, 1);
    // post-dated cheque is not "collected" but shown as cheques to clear
    const cp = await say('Velan Stores 700 cheque 30 nov'); await commit(cp.proposal!);
    const s3 = await daySummary();
    expect(s3.collected).toBeCloseTo(s2.collected, 1);
    expect(s3.chequesToClear).toBeCloseTo((s2.chequesToClear ?? 0) + 700, 1);
    void cancelInvoice;
  });
});

describe('P14 credit notes for bills with differences', () => {
  it('"Settle all as credit notes" makes one note per bill and is safe twice', async () => {
    as('owner');
    const { recordDelivery, settleAllAsCreditNotes } = await import('../src/core/pipeline');
    const surf = await prod('Surf'); const shop = await shopNamed('Pennadam');
    const a = await bill(shop, [{ productId: surf.id, qty: 4, rate: surf.rate }]);
    const b = await bill(shop, [{ productId: surf.id, qty: 5, rate: surf.rate }]);
    for (const inv of [a, b]) await recordDelivery([inv.id], { short: { [`${inv.id}|${surf.id}`]: { qty: 1, reason: 'short' } } });
    const r = await settleAllAsCreditNotes([a.id, b.id]);
    expect(r.done.length).toBe(2); expect(r.failed.length).toBe(0);
    expect((await db.creditNotes.where('invoiceId').equals(a.id).toArray()).length).toBe(1);
    const again = await settleAllAsCreditNotes([a.id, b.id]);
    expect(again.done.length).toBe(0); expect(again.failed.length).toBe(2);
    expect((await db.creditNotes.where('invoiceId').equals(b.id).toArray()).length).toBe(1);
  });
});

describe('P4 driver collects the delivered value, not the full bill', () => {
  it('after a short the bill to collect is less by the short, old dues stay', async () => {
    as('owner');
    const { recordDelivery, collectableBills } = await import('../src/core/pipeline');
    const surf = await prod('Surf'); const shop = await shopNamed('Sri Lakshmi');
    const old = (await collectableBills(shop.id)).reduce((a, b) => a + b.due, 0);
    const inv = await bill(shop, [{ productId: surf.id, qty: 5, rate: surf.rate }]);
    await recordDelivery([inv.id], { short: { [`${inv.id}|${surf.id}`]: { qty: 2, reason: 'short' } } });
    const after = await collectableBills(shop.id);
    const mine = after.find(b => b.invoice.id === inv.id)!;
    expect(mine.short).toBeGreaterThan(0);
    expect(mine.due).toBeCloseTo(inv.total - mine.short, 2);
    expect(mine.due).toBeLessThan(inv.total);
    expect(after.reduce((a, b) => a + b.due, 0)).toBeCloseTo(old + mine.due, 2);
    // paid the delivered value, then the credit note at day close: nothing is left owing on that bill
    const { settleDifference } = await import('../src/core/pipeline');
    const cs = new ChangeSet();
    cs.put('payments', { shopId: shop.id, amount: mine.due, mode: 'cash', ref: '', date: today(), collectedBy: ids.owner, shopConfirmed: true, allocations: [{ invoiceId: inv.id, amount: mine.due }], advance: 0, settled: false, status: 'ok' } as never);
    await cs.commit('pay');
    await settleDifference(inv.id, 'credit_note');
    const left = (await collectableBills(shop.id)).find(b => b.invoice.id === inv.id);
    expect(left).toBeUndefined();
  });
});

describe('P7 the order total is the bill total', () => {
  it('billValueOf equals the bill made from the same lines (schemes, GST, round-off)', async () => {
    as('owner');
    const { billValueOf, checkOrder } = await import('../src/core/billing');
    const { isInterState } = await import('../src/core/gst');
    const { getSettings } = await import('../src/core/db');
    const shop = await shopNamed('Kumar'); const ps = (await db.products.toArray()).filter(p => p.active).slice(0, 4);
    const lines = ps.map((p, i) => ({ productId: p.id, qty: 3 + i, rate: p.rate }));
    const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
    const est = billValueOf(lines, products, await db.schemes.toArray(), isInterState(shop, await getSettings()));
    const chk = await checkOrder(shop, lines);
    expect(chk.total).toBe(est);
    const cs = new ChangeSet();
    const o = cs.put<Order>('orders', { shopId: shop.id, salesmanId: ids.owner, source: 'office', lines, date: today(), status: 'approved', issues: [], invoiceIds: [] } as never);
    const invs = await makeInvoices(cs, o, shop); await cs.commit('b');
    expect(Math.round(invs.reduce((a, i) => a + i.total, 0) * 100) / 100).toBe(est);
  });
});

describe('P6 one net-sales definition and one cash number', () => {
  it('P&L sales = Reports/GST net sales; P&L cash/bank/staff = the money position Cash flow uses', async () => {
    as('owner');
    const { profitAndLoss, moneyPosition } = await import('../src/core/pnl');
    const { salesSummary, period } = await import('../src/core/reports');
    const pnl = await profitAndLoss('month');
    const net = await salesSummary(period('month'));
    const sales = pnl.income.filter(h => h.key.startsWith('sales-') || h.key === 'cn').reduce((a, h) => a + h.amount, 0);
    expect(Math.round(sales * 100) / 100).toBe(net.net.taxable);
    const pos = await moneyPosition();
    expect([pnl.cash, pnl.bank, pnl.staff]).toEqual([pos.cash, pos.bank, pos.staff]);
    expect((await profitAndLoss('today')).cash).toBe(pos.cash);
  });
});
