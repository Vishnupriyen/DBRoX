import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';

beforeAll(async () => { await seedDemo(); });
const as = async (role: string) => { const s = (await db.staff.where('role').equals(role).first())!; setSession('demo', s.id); };

describe('RoX opens screens by name', () => {
  it('owner: delivery plan, approve, live, day close', async () => {
    await as('owner');
    expect((await handle('delivery plan', [])).go).toBe('plan');
    expect((await handle('Delivery Plan', [])).go).toBe('plan');
    expect((await handle('approve', [])).go).toBe('orders-received');
    expect((await handle('live vans', [])).go).toBe('live');
    expect((await handle('close day', [])).go).toBe('dayclose');
  });
  it('driver asking for the owner screen is told so; own screens open', async () => {
    await as('delivery');
    const r = await handle('delivery plan', []);
    expect(r.go).toBeUndefined(); expect(r.text).toMatch(/owner/);
    expect((await handle('my trip', [])).go).toBe('trip');
  });
  it('godown: pick, load sheet', async () => {
    await as('godown');
    expect((await handle('pick orders', [])).go).toBe('pick');
    const ls = await handle('load sheet', []); expect(ls.go).toBeUndefined(); expect(ls.link?.page).toBe('load'); // answered in place (founder rule)
    expect((await handle('load vans', [])).go).toBe('load');
  });
  it('data questions still answer, not navigate', async () => {
    await as('owner');
    expect((await handle('today sales', [])).go).toBeUndefined();
    expect((await handle('Murugan Stores paid 500 cash', [])).proposal?.kind).toBe('payment');
  });
});
