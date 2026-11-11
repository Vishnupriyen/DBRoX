// Final round B (11 Nov 2026): one count / one wording for each thing the end-user panel saw twice.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { billsToPlan, dupeGroups, counts } from '../src/core/pipeline';
import { salaryDaysLine } from '../src/core/payroll';
import { pcsCs } from '../src/ui/PickOrders';

beforeAll(async () => { await seedDemo(); const o = (await db.staff.toArray()).find(s => s.role === 'owner')!; setSession('demo', o.id); });

describe('P15 one count, one wording', () => {
  it('a pair of possible duplicate collections is ONE thing to check, not two', () => {
    const ps = [{ id: 'a', shopId: 's1', amount: 500 }, { id: 'b', shopId: 's1', amount: 500 }, { id: 'c', shopId: 's2', amount: 100 }, { id: 'd', shopId: 's2', amount: 100 }, { id: 'e', shopId: 's2', amount: 100 }];
    expect(dupeGroups(ps).map(g => g.length)).toEqual([2, 3]);
  });
  it('bills to plan: the Delivery tile and the Plan page are the same number, cancelled bills never count', async () => {
    const inv = (await db.invoices.toArray())[0];
    await db.invoices.put({ ...inv, id: 'cancelled-pending', deliveryStatus: 'pending', cancelled: true } as typeof inv);
    const c = await counts();
    expect(await billsToPlan()).toBe(c.toPlan);
    expect((await db.invoices.where('deliveryStatus').equals('pending').toArray()).length).toBeGreaterThan(c.toPlan);
  });
  it('salary line never says "1 day present of 0 counted"', () => {
    expect(salaryDaysLine({ present: 1, workDays: 0 })).toBe('1 day present · 0 working days counted before today');
    expect(salaryDaysLine({ present: 20, workDays: 21 })).toBe('20 days present · 21 working days counted before today');
  });
});
describe('P12 stock with its unit', () => {
  it('shows pieces, and the cases in them', () => {
    expect(pcsCs(96, 12)).toBe('96 pcs (8 cs)');
    expect(pcsCs(100, 12)).toBe('100 pcs (8 cs + 4)');
    expect(pcsCs(5, 12)).toBe('5 pcs');
    expect(pcsCs(7, 1)).toBe('7 pcs');
  });
});
