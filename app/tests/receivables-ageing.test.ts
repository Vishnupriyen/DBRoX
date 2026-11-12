// Outstanding by age bucket (12 Nov 2026, owner: "outstanding report bucket wise — TESRAX didn't respond"). Each open bill's
// balance goes into 0–30 / 31–60 / 61–90 / 90+ days by its bill date; a shop's unused advance is shown and taken off, so a
// shop's total is exactly the balance due the rest of the app shows.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { ChangeSet, db, daysFrom, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { allOutstanding, allocateOldestFirst, receivablesAgeing } from '../src/core/ledger';
import { handle } from '../src/core/engine';
import type { Role } from '../src/core/types';
import { code, loadNames } from './tesrax-code';
const ids: Partial<Record<Role, string>> = {};
let shopId = '';
beforeAll(async () => {
  await seedDemo(); await loadNames(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id; setSession('demo', ids.owner!);
  const cs = new ChangeSet();
  const s = cs.put('shops', { name: 'Bucket Stores', area: 'Pennadam', beat: 'Monday', creditLimit: 100000, creditDays: 15, cashOnly: false, type: 'retail', approved: true, aliases: [] } as never) as unknown as { id: string };
  shopId = s.id; const co = (await db.companies.toArray())[0];
  [[5, 100], [45, 200], [75, 300], [120, 400]].forEach(([age, amt], k) => cs.put('invoices', { number: `BK/${k}`, shopId, companyId: co.id, date: daysFrom(-age), kind: 'B2C', lines: [], taxable: amt, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: amt, deliveryStatus: 'delivered', cancelled: false } as never));
  await cs.commit('bills');
});
describe('outstanding by age bucket', () => {
  it('each bill lands in its bucket by bill date', async () => {
    const a = await receivablesAgeing();
    const row = a.rows.find(r => r.shopId === shopId)!;
    expect([row.b0_30, row.b31_60, row.b61_90, row.b90]).toEqual([100, 200, 300, 400]);
    expect(row.total).toBe(1000);
  });
  it('a payment clears the oldest first; every shop total equals the balance due everywhere else', async () => {
    const { allocations, advance } = await allocateOldestFirst(shopId, 450);
    const cs = new ChangeSet(); cs.put('payments', { shopId, amount: 450, mode: 'cash', date: daysFrom(0), collectedBy: ids.owner, shopConfirmed: true, allocations, advance, settled: false, status: 'ok' } as never); await cs.commit('pay');
    const a = await receivablesAgeing(); const row = a.rows.find(r => r.shopId === shopId)!;
    expect([row.b0_30, row.b31_60, row.b61_90, row.b90]).toEqual([100, 200, 250, 0]);
    const due = await allOutstanding();
    for (const r of a.rows) expect(r.total).toBeCloseTo(due.get(r.shopId)!.total, 2);
    expect(a.totals.total).toBeCloseTo(a.rows.reduce((s, r) => s + r.total, 0), 2);
  });
  it('TESRAX: "outstanding bucket wise", "ageing of outstanding", "receivable ageing" give the bucket table', async () => {
    for (const t of ['outstanding report bucket wise', 'outstanding bucket wise', 'ageing of outstanding', 'receivable ageing', 'outstanding 30 60 90 days', 'dues ageing', 'debtors ageing']) {
      const r = await handle(t, [], {});
      expect(r.table?.columns, t).toEqual(['Shop', 'Area', '0–30 days', '31–60 days', '61–90 days', '90+ days', 'Advance', 'Total']);
    }
    expect(code(await handle('ageing', [], {}))).toBe('go:ageing'); // stock ageing screen stays
    expect((await handle('outstanding', [], {})).table?.columns).not.toContain('0–30 days'); // the plain list stays
  });
});
