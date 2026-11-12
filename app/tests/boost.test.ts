// Business Boost (founder, 12 Nov 2026): offers running now come from the real schemes; a service request is saved once
// (a second tap while it is open adds nothing) and carries the firm's details for the Hanubix team; owner and office only.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ChangeSet, db, daysFrom, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { BOOST_SERVICES, offersNow, openRequests, requestService } from '../src/core/boost';
import { handle } from '../src/core/engine';
import type { Role } from '../src/core/types';
import { code, loadNames } from './tesrax-code';
const ids: Partial<Record<Role, string>> = {};
beforeAll(async () => { await seedDemo(); await loadNames(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id; });
beforeEach(() => setSession('demo', ids.owner!));

describe('Business Boost', () => {
  it('offers running now: only schemes valid today, newest first, with the product name', async () => {
    const p = (await db.products.toArray())[0];
    const cs = new ChangeSet();
    cs.put('schemes', { companyId: p.companyId, productId: p.id, name: 'Old 10+1', type: 'free', value: 0, buyQty: 10, freeQty: 1, from: daysFrom(-60), to: daysFrom(-30), source: 'company', combine: 'add' } as never);
    cs.put('schemes', { companyId: p.companyId, productId: p.id, name: 'Fresh 5% off', type: 'pct', value: 5, from: daysFrom(-1), to: daysFrom(20), source: 'company', combine: 'add' } as never);
    await cs.commit('schemes');
    const o = await offersNow();
    expect(o.some(x => x.name === 'Old 10+1')).toBe(false);
    const fresh = o.find(x => x.name === 'Fresh 5% off')!;
    expect(fresh.product).toBe(p.name);
  });
  it('a request is saved once with the firm details; asking again while open adds nothing', async () => {
    const a = await requestService('gst', 'need help with GSTR-1');
    expect(a.already).toBe(false);
    expect(a.message).toMatch(/GST filing and CA help/); expect(a.message).toMatch(/Note: need help with GSTR-1/);
    const b = await requestService('gst');
    expect(b.already).toBe(true);
    expect((await db.boostRequests.toArray()).filter(r => r.kind === 'gst')).toHaveLength(1);
    expect((await openRequests()).get('gst')?.status).toBe('open');
  });
  it('every service has a title and a line; an unknown one is refused', async () => {
    for (const s of BOOST_SERVICES) { expect(s.title.length).toBeGreaterThan(3); expect(s.line.length).toBeGreaterThan(10); }
    await expect(requestService('lottery')).rejects.toThrow(/Unknown service/);
  });
  it('TESRAX opens it for the owner and office; a salesman is told whose screen it is', async () => {
    for (const t of ['open business boost', 'business boost', 'boost services', 'offers and services', 'gst filing', 'working capital'])
      expect(code(await handle(t, [], {})), t).toBe('go:boost');
    setSession('demo', ids.office!); expect(code(await handle('business boost', [], {}))).toBe('go:boost');
    setSession('demo', ids.salesman!); expect((await handle('business boost', [], {})).text).toMatch(/owner's screen/);
  });
});
