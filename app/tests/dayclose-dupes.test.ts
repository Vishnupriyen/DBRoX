// Two equal cash payments from one shop on one day (salesman in the morning, driver at delivery) were flagged as a
// "possible duplicate" with no way to clear it: the day could never close, and billing stops until it does.
// Found by the full working-app test, 9 Nov 2026. The owner must be able to say "both are real" or cancel one.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { ChangeSet, db, setSession, today } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { dayChecklist, confirmNotDuplicate, cancelPayment } from '../src/core/pipeline';
import type { Payment } from '../src/core/types';

let a = '', b = '', c = '', d = '';
beforeAll(async () => {
  await seedDemo();
  const owner = (await db.staff.toArray()).find(s => s.role === 'owner')!;
  setSession(owner.tenantId, owner.id);
  const [s1, s2] = await db.shops.toArray();
  const pay = (shopId: string): Partial<Payment> => ({ shopId, amount: 1500, mode: 'cash', date: today(), collectedBy: owner.id, shopConfirmed: true, allocations: [], advance: 1500, settled: false, status: 'ok' });
  const cs = new ChangeSet();
  a = cs.put('payments', pay(s1.id)).id; b = cs.put('payments', pay(s1.id)).id;
  c = cs.put('payments', pay(s2.id)).id; d = cs.put('payments', pay(s2.id)).id;
  await cs.commit('two shops, each paid 1500 twice');
});

describe('possible duplicate collections at day close', () => {
  it('are listed, cash included', async () => {
    expect((await dayChecklist()).dupes.map(p => p.id).sort()).toEqual([a, b, c, d].sort());
  });
  it('"both are real" clears the pair', async () => {
    await confirmNotDuplicate([a, b]);
    expect((await dayChecklist()).dupes.map(p => p.id).sort()).toEqual([c, d].sort());
  });
  it('cancelling one clears the pair and the money is open again', async () => {
    await cancelPayment(d, 'Entered twice');
    expect((await dayChecklist()).dupes).toEqual([]);
    expect((await db.payments.get(d))?.status).toBe('cancelled');
  });
});
