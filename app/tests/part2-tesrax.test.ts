// Part 2 TESRAX phrases (docs/PART2_SPEC.md "TESRAX", PART2_UX.md): English first, the messy forms people type; every reply
// says what it did and the next step; answers in place, with a Download where there is a file.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import type { Role } from '../src/core/types';

const ids: Partial<Record<Role, string>> = {};
let shopName = '';
beforeAll(async () => {
  await seedDemo(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id;
  const o = (await db.orders.toArray()).find(x => x.status === 'new')!; shopName = (await db.shops.get(o.shopId))!.name;
});
beforeEach(() => setSession('demo', ids.owner!));
const say = (t: string) => handle(t, [], {});

describe('2b Orders received', () => {
  for (const t of ['orders received', 'ordrs recvd', 'show ordrs', 'open orders received']) it(`"${t}" opens Orders received`, async () => {
    expect((await say(t)).go).toBe('orders-received');
  });
  for (const t of ['download orders', 'orders excel', 'download ordrs']) it(`"${t}" gives the orders file with a Download button`, async () => {
    const r = await say(t);
    expect(r.go).toBeUndefined(); expect(r.actions?.[0]?.label).toMatch(/Download/);
  });
  it('"open order <shop>" opens that order', async () => {
    const r = await say(`open order ${shopName}`);
    expect(r.go).toBe('orders-received'); expect(r.text).toContain(shopName);
  });
  it('"approve order <shop>" offers one Approve tap (nothing saved before the tap); the tap approves', async () => {
    const r = await say(`approve order ${shopName}`);
    expect(r.text).toMatch(/Tap Approve to send it to the godown/);
    const shop = (await db.shops.toArray()).find(s => s.name === shopName)!;
    expect((await db.orders.toArray()).find(o => o.shopId === shop.id && o.status === 'new')).toBeTruthy();
    await r.actions![0].run();
    expect((await db.orders.toArray()).some(o => o.shopId === shop.id && o.status === 'approved')).toBe(true);
  });
});
