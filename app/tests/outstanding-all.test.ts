// The beat screen works out every shop's dues in one pass (it went through all bills once per shop: 7.8 s on a cheap
// phone with a month of bills, found by the working-app test 9 Nov 2026). One pass must give exactly the same numbers.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { allOutstanding, shopOutstanding } from '../src/core/ledger';
import { shopHistory } from '../src/core/pipeline';

beforeAll(async () => { await seedDemo(); });
describe('dues for every shop at once', () => {
  it('match the one-shop calculation for every shop', async () => {
    const all = await allOutstanding();
    for (const s of await db.shops.toArray()) {
      const one = await shopOutstanding(s.id);
      expect(all.get(s.id)?.total ?? 0, s.name).toBeCloseTo(one.total, 2);
      expect(all.get(s.id)?.maxOverdueDays ?? 0, s.name).toBe(one.maxOverdueDays);
      expect(all.get(s.id)?.overdue ?? 0, s.name).toBeCloseTo(one.overdue, 2);
      expect(all.get(s.id)?.bills ?? 0, s.name).toBe(one.bills.length);
      const h = await shopHistory(s.id);
      expect(all.get(s.id)?.oldestDays ?? 0, s.name).toBe(h.oldestDays);
      expect(all.get(s.id)?.amount ?? 0, s.name).toBeCloseTo(h.amount, 2);
    }
  });
});

describe('stock for every product at once', () => {
  it('matches the one-product count for every product', async () => {
    const { allStock, stockOf } = await import('../src/core/billing');
    const all = await allStock();
    for (const p of await db.products.toArray()) expect(all.get(p.id) ?? 0, p.name).toBe(await stockOf(p.id));
  });
});
