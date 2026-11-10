// Company field team (step 2): working day and km, beat, visits, orders to the distributor, new-shop requests, leave.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { WorkDay } from '../src/core/types';

const store = new Map<string, string>();
beforeAll(async () => {
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
  const { wireDemoRelay } = await import('../src/core/link'); await wireDemoRelay();
  const { seedCompanyDemo } = await import('../src/core/seedCompany'); await seedCompanyDemo();
}, 90000);

const T = (min: number) => new Date(Date.UTC(2026, 10, 10, 4, 0) + min * 60000).toISOString();
const sides = async () => { const { storeOf } = await import('../src/core/link'); return { co: storeOf('company'), dist: storeOf('distributor') }; };
/** run as a company person (the company store is this "phone") */
const asCo = async <X,>(phone: string, fn: () => Promise<X>) => {
  const { onSide, setSession } = await import('../src/core/db'); const { co } = await sides();
  return onSide(co, async () => { const s = (await co.staff.toArray()).find(x => x.phone === phone)!; setSession('demo-company', s.id); return fn(); });
};
const ARUN = '9100000004', DIVYA = '9100000003', SENTHIL = '9100000002';

describe('km from the recorded path', () => {
  it('counts the path, leaves out a GPS jump and a poor reading, and flags a long gap', async () => {
    const { measure } = await import('../src/core/field');
    const track: WorkDay['track'] = [
      { at: T(0), lat: 11.4000, lng: 79.2500, acc: 10 },
      { at: T(10), lat: 11.4090, lng: 79.2500, acc: 10 },   // ~1.0 km
      { at: T(11), lat: 12.4090, lng: 79.2500, acc: 10 },   // 111 km in a minute: jump
      { at: T(12), lat: 11.4100, lng: 79.2500, acc: 900 },  // poor reading
      { at: T(80), lat: 11.4180, lng: 79.2500, acc: 10 },   // 68 min later: gap, straight line counted
    ];
    const r = measure(track);
    expect(r.km).toBeGreaterThan(1.9); expect(r.km).toBeLessThan(2.1);
    expect(r.flags.some(f => /GPS jump/.test(f))).toBe(true);
    expect(r.flags.some(f => /poor GPS/.test(f))).toBe(true);
    expect(r.flags.some(f => /No location/.test(f))).toBe(true);
  });
});

describe('a field rep\'s day', () => {
  it('starts once; a second start is refused', async () => {
    await asCo(ARUN, async () => {
      const { startDay } = await import('../src/core/field');
      await startDay({ lat: 11.4066, lng: 79.2577, acc: 10 });
      await expect(startDay(null)).rejects.toThrow(/already started/);
    });
  });
  it('today\'s beat has the distributor\'s shops; visiting twice keeps one visit', async () => {
    await asCo(ARUN, async () => {
      const { todaysBeat, visitShop } = await import('../src/core/field');
      const beat = await todaysBeat();
      expect(beat.length).toBeGreaterThan(0);
      await visitShop(beat[0].shop, { lat: 11.4066, lng: 79.2577 });
      await visitShop(beat[0].shop, null, { photo: 'data:image/png;base64,x' });
      const { db, today, session } = await import('../src/core/db');
      const mine = (await db.visits.where('date').equals(today()).toArray()).filter(v => v.staffId === session().userId && v.shopId === beat[0].shop.id);
      expect(mine.length).toBe(1);
      expect(mine[0].photo).toBeTruthy();
    });
  });
  it('an order reaches the distributor once (double tap), and comes back as billed', async () => {
    const { co, dist } = await sides();
    const shop = (await co.shops.toArray()).find(s => s.name === 'Kumar Mart')!;
    const p = (await co.products.toArray()).find(x => x.code === 'KV203')!;
    const o1 = await asCo(ARUN, async () => (await import('../src/core/field')).placeFieldOrder(shop.id, [{ productId: p.id, qty: 30 }, { productId: p.id, qty: 30 }]));
    const o2 = await asCo(ARUN, async () => (await import('../src/core/field')).placeFieldOrder(shop.id, [{ productId: p.id, qty: 60 }]));
    expect(o2.id).toBe(o1.id); // same order tapped twice within a minute: not sent again
    const atDb = (await dist.orders.toArray()).filter(o => o.source === 'company' && o.shopId === shop.id && o.date === o1.date && o.companyRep === 'Arun'); // the demo's own orders (Meena) may be for the same shop
    expect(atDb.length).toBe(1);
    expect(atDb[0].lines).toEqual([{ productId: (await dist.products.toArray()).find(x => x.companyProductId === p.id)!.id, qty: 60, rate: p.rate }]);
    // the distributor approves and bills it → the company sees it billed and counted for Arun
    const { onSide, setSession, ChangeSet } = await import('../src/core/db');
    const { makeInvoices } = await import('../src/core/billing');
    await onSide(dist, async () => {
      setSession('demo', (await dist.staff.toArray()).find(s => s.role === 'owner')!.id);
      const cs = new ChangeSet(); const ord = cs.put('orders', { ...atDb[0], status: 'billed' }) as typeof atDb[0];
      ord.invoiceIds = (await makeInvoices(cs, ord, (await dist.shops.get(shop.id))!)).map(b => b.id); await cs.commit('bill');
    });
    await asCo(ARUN, async () => {
      const { fieldOrderStatus, repSales } = await import('../src/core/field');
      expect((await fieldOrderStatus([o1])).get(o1.id)!.status).toBe('billed');
      expect((await repSales()).get(o1.repId!)).toBeGreaterThan(0);
    });
  });
  it('an order for a shop without a linked distributor is refused', async () => {
    await asCo(ARUN, async () => {
      const { checkFieldOrder } = await import('../src/core/field');
      const { db } = await import('../src/core/db');
      const p = (await db.products.toArray())[0];
      expect(checkFieldOrder({ id: 'x', name: 'Loose', dbLinkId: undefined } as never, [{ productId: p.id, qty: 1 }], new Map([[p.id, p]]))).toMatch(/not with a linked distributor/);
      expect(checkFieldOrder({ id: 'x', name: 'S', dbLinkId: 'L' } as never, [{ productId: p.id, qty: 1.5 }], new Map([[p.id, p]]))).toMatch(/whole number/);
    });
  });
  it('TESRAX: a typed order becomes a table for the shop\'s distributor', async () => {
    const r = await asCo(ARUN, async () => (await import('../src/core/engine')).handle('Murugan Stores 2 case coconut oil, 1 case sambar', []));
    expect(r.proposal?.kind).toBe('fieldOrder');
    expect(r.proposal!.rows.map(x => x.qty)).toEqual([48, 60]);
    const done = await asCo(ARUN, async () => (await import('../src/core/proposals')).commit(r.proposal!));
    const { dist } = await sides();
    expect(await dist.orders.get(done.orderId!)).toBeTruthy();
  });
  it('a new shop request waits for the distributor\'s OK, then shows as approved', async () => {
    const { co, dist } = await sides();
    const link = (await co.dbLinks.toArray()).find(l => l.status === 'linked')!;
    await asCo(ARUN, async () => {
      const { requestShop } = await import('../src/core/field');
      await expect(requestShop({ name: 'Sri Devi Stores', area: 'Tittakudi', beat: 'Monday', dbLinkId: link.id })).rejects.toThrow(/photo/);
      await requestShop({ name: 'Sri Devi Stores', area: 'Tittakudi', beat: 'Monday', dbLinkId: link.id, photo: 'data:x' });
    });
    const asked = (await dist.shops.toArray()).find(s => s.name === 'Sri Devi Stores')!;
    expect(asked.approved).toBe(false);
    const { onSide, setSession, ChangeSet } = await import('../src/core/db');
    await onSide(dist, async () => { setSession('demo', 'owner'); const cs = new ChangeSet(); cs.put('shops', { ...asked, approved: true }); await cs.commit('approve'); });
    expect((await co.shops.get(asked.id))?.approved).toBe(true);
  });
  it('ends the day with km; a second end is refused', async () => {
    await asCo(ARUN, async () => {
      const { addPoint, endDay } = await import('../src/core/field');
      // readings minutes apart, as on the road (two readings 1 km apart in the same second would be a GPS jump)
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 20 * 60000);
      await addPoint({ lat: 11.4166, lng: 79.2577, acc: 10 });
      vi.setSystemTime(Date.now() + 20 * 60000);
      const r = await endDay({ lat: 11.4266, lng: 79.2577, acc: 10 });
      vi.useRealTimers();
      expect(r.km).toBeGreaterThan(0);
      expect(r.flags).not.toContain('No shop visited');
      await expect(endDay(null)).rejects.toThrow(/already ended/);
    });
  });
});

describe('managers', () => {
  it('a leave goes to the rep\'s line: the SO and the ASM above see it; the decision is final', async () => {
    await asCo(ARUN, async () => (await import('../src/core/field')).applyLeave('2026-12-01', '2026-12-02', 'Wedding'));
    const seen = async (phone: string) => asCo(phone, async () => {
      const { myTeam } = await import('../src/core/company'); const { db, session } = await import('../src/core/db');
      const team = new Set((await myTeam(session().userId)).map(s => s.id));
      return (await db.leaves.where('status').equals('waiting').toArray()).filter(l => team.has(l.staffId) && l.reason === 'Wedding');
    });
    expect((await seen(DIVYA)).length).toBe(1);
    expect((await seen(SENTHIL)).length).toBe(1);
    const id = (await seen(DIVYA))[0].id;
    await asCo(DIVYA, async () => (await import('../src/core/field')).decideLeave(id, true));
    await expect(asCo(SENTHIL, async () => (await import('../src/core/field')).decideLeave(id, false))).rejects.toThrow(/Already decided/);
  });
  it('team today shows who started, km, visits and orders', async () => {
    const rows = await asCo(DIVYA, async () => { const { teamToday } = await import('../src/core/field'); const { myTeam } = await import('../src/core/company'); const { session } = await import('../src/core/db'); return teamToday(await myTeam(session().userId)); });
    const meena = rows.find(r => r.staff.phone === '9100000005')!;
    expect(meena.started).toBeTruthy(); expect(meena.visits).toBe(2); expect(meena.productive).toBe(1);
  });
});
