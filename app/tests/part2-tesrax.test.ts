// Part 2 TESRAX phrases (docs/PART2_SPEC.md "TESRAX", PART2_UX.md): English first, the messy forms people type; every reply
// says what it did and the next step; answers in place, with a Download where there is a file.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ChangeSet, db, setSession } from '../src/core/db';
import { bookOrder } from '../src/core/pipeline';
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

describe('2c Verify picked', () => {
  for (const t of ['verify picked', 'open verify picked', 'picked orders']) it(`"${t}" opens Verify picked`, async () => {
    const r = await say(t); expect(r.go).toBe('verify'); expect(r.text).toBe('Opening Verify picked.');
  });
});

describe('2d Disc % by voice', () => {
  it('"discount 5 percent on <product>" / "disc 5% <product>" / "5 per discount <product>": one tap sets Disc % on that order line', async () => {
    const shop = (await db.shops.toArray()).find(s => s.approved)!;
    const p = (await db.products.toArray()).find(x => x.active && x.name.includes('Surf'))!;
    const cs = new ChangeSet(); const o = await bookOrder(cs, shop, [{ productId: p.id, qty: 2, rate: p.rate }], ids.owner!); await cs.commit('t');
    for (const t of [`discount 5 percent on ${p.name} in order ${shop.name}`, `disc 5% ${p.name} in order ${shop.name}`, `5 per discount ${p.name} in order ${shop.name}`]) {
      const r = await say(t);
      expect(r.text, t).toMatch(new RegExp(`Disc 5% on ${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} in`));
      expect(r.actions?.[0].label).toBe(`Set 5% on ${p.name}`);
    }
    const r = await say(`discount 5 percent on ${p.name} in order ${shop.name}`);
    await r.actions![0].run();
    expect((await db.orders.get(o.id))!.lines.find(l => l.productId === p.id)!.discountPct).toBe(5);
  });
  it('more than 100% is refused in words', async () => {
    expect((await say('discount 150 percent on surf')).text).toMatch("Discount can't be more than 100%");
  });
});
