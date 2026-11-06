import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, setSession, undoBatch } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { commit, validate, hasErrors } from '../src/core/proposals';
import { invoiceBalances, validGstin } from '../src/core/ledger';
import { pickOrder, approvePicked, suggestPick } from '../src/core/pipeline';

beforeAll(async () => {
  await seedDemo();
  const owner = (await db.staff.where('role').equals('owner').first())!;
  setSession('demo', owner.id);
});

describe('RoX Engine', () => {
  it('bills an order with correct GST, schemes and oldest batch first', async () => {
    const r = await handle('Murugan Stores 1 case surf, 24 good day', []);
    expect(r.proposal?.kind).toBe('order');
    expect(r.proposal!.rows.map(x => x.qty)).toEqual([12, 24]);
    const v = await validate(r.proposal!);
    expect(hasErrors(v)).toBe(false);
    const surfId = r.proposal!.rows[0].productId as string;
    const live = (await db.batches.where('productId').equals(surfId).toArray()).filter(b => b.qty > 0).sort((a, b) => a.expiry.localeCompare(b.expiry));
    const booked = await commit(r.proposal!);
    // pipeline: booked → godown packs what it has → owner approves → bills
    const o = (await db.orders.get(booked.orderId!))!;
    expect(o.status).toBe('new');
    const pick = await suggestPick(o);
    expect(pick.every(x => x.available === x.ordered)).toBe(true);
    await pickOrder(o.id, pick.map(x => ({ productId: x.productId, qty: x.available })));
    expect((await db.orders.get(o.id))!.status).toBe('picked');
    const res = await approvePicked(o.id);
    expect((await db.orders.get(o.id))!.status).toBe('billed');
    expect(res.invoices!.length).toBe(2); // one bill per company (HUL, Britannia)
    const codes = new Map((await db.companies.toArray()).map(c => [c.id, c.code]));
    const hul = res.invoices!.find(i => codes.get(i.companyId) === 'HUL')!;
    expect(hul.number).toMatch(/^DBX\/\d{2}-\d{2}\/\d{5}$/); // one running series for the distributor
    const line = hul.lines[0];
    expect(line.gross).toBe(12 * 112);
    expect(line.discount).toBe(67.2); // 5% company scheme
    expect(line.taxable).toBe(1276.8);
    expect(line.cgst + line.sgst).toBeCloseTo(229.82, 2); // 18%
    expect(hul.total).toBe(Math.round(1276.8 + 229.82));
    expect(line.batches[0].batch).toBe(live[0].batch); // oldest expiry with stock picked first
    const brt = res.invoices!.find(i => codes.get(i.companyId) === 'BRT')!;
    expect(brt.lines[0].freeQty).toBe(2); // buy 24 get 2
    const claims = await db.claimEntries.toArray();
    expect(claims.some(c => c.invoiceId === hul.id && c.amount === 67.2)).toBe(true);
  });

  it('payment goes to oldest bill first and can be undone', async () => {
    const r = await handle('Murugan Stores paid 1000 cash', []);
    const before = (await invoiceBalances((r.proposal!.fields[0].value) as string)).filter(b => b.balance > 0.5);
    const res = await commit(r.proposal!);
    const after = (await invoiceBalances((r.proposal!.fields[0].value) as string));
    const oldest = after.find(b => b.invoice.id === before[0].invoice.id)!;
    expect(oldest.balance).toBeCloseTo(Math.max(0, before[0].balance - 1000), 1);
    expect(await undoBatch(res.batchId)).toBeGreaterThan(0);
    const back = await invoiceBalances(r.proposal!.fields[0].value as string);
    expect(back.find(b => b.invoice.id === before[0].invoice.id)!.balance).toBeCloseTo(before[0].balance, 1);
  });

  it('flags credit-limit and cash-only issues for the owner', async () => {
    const r = await handle('Velan Provision 10 case dark fantasy', []);
    const v = await validate(r.proposal!);
    expect(v.warnings.join(' ')).toMatch(/Credit limit/);
  });

  it('understands Tamil quantities', async () => {
    const r = await handle('Murugan Stores 2 கேஸ் surf', []);
    expect(r.proposal!.rows[0].qty).toBe(24);
  });

  it('validates GSTIN checksum', () => {
    expect(validGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(validGstin('27AAPFU0939F1ZX')).toBe(false);
  });

  it('tally and claim exports run', async () => {
    const t = await handle('tally export', []);
    expect(t.actions?.length).toBe(1);
    const c = await handle('claim file', []);
    expect(c.table!.rows.length).toBeGreaterThan(0);
  });
});

describe('schemes', () => {
  it('understands a scheme sentence', async () => {
    const r = await handle('HUL Surf 5% off till 30 Nov', []);
    const row = r.proposal!.rows[0];
    expect(row.type).toBe('pct');
    expect(row.value).toBe(5);
    expect(String(row.to)).toMatch(/-11-30$/);
    const b = await handle('Britannia Good Day buy 24 get 2 scheme', []);
    expect(b.proposal!.rows[0]).toMatchObject({ type: 'free', buyQty: 24, freeQty: 2 });
    expect(hasErrors(await validate(b.proposal!))).toBe(false);
  });
});
