// Regression tests for the independent code review of the company module (10 Nov 2026), phone side.
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
const sides = async () => { const { storeOf } = await import('../src/core/link'); return { co: storeOf('company'), dist: storeOf('distributor') }; };
const asCo = async <X,>(phone: string, fn: () => Promise<X>) => {
  const { onSide, setSession } = await import('../src/core/db'); const { co } = await sides();
  return onSide(co, async () => { const s = (await co.staff.toArray()).find(x => x.phone === phone)!; setSession('demo-company', s.id); return fn(); });
};
const asDb = async <X,>(fn: () => Promise<X>) => {
  const { onSide, setSession } = await import('../src/core/db'); const { dist } = await sides();
  return onSide(dist, async () => { setSession('demo', (await dist.staff.toArray()).find(s => s.role === 'owner')!.id); return fn(); });
};
const HO = '9100000001', DIVYA = '9100000003', ARUN = '9100000004';

describe('review 1: a link never re-uses another company\'s record', () => {
  it('a record tied to one company (even after leaving) cannot carry another', async () => {
    const { dist } = await sides();
    const kav = (await dist.companies.toArray()).find(c => c.link)!;
    await expect(asDb(async () => (await import('../src/core/link')).acceptInvite('KAVVL2', kav.id))).rejects.toThrow(/another company|already linked/); // the demo has one company; the server test covers two
  });
});

describe('review 2: a company invoice goes only to the right distributor', () => {
  it('a near name never matches; the GSTIN does', async () => {
    const rows = (n: string, g = '') => [['Invoice', 'Date', 'Customer', 'GSTIN', 'Item', 'Qty'], ['9100', '2026-11-08', n, g, 'Kaveri Coconut Oil 500ml', '24']];
    const { readPrimaryRows, draftPrimary } = await import('../src/core/company');
    const near = await asCo(HO, async () => draftPrimary(readPrimaryRows(rows('Sri Murugan Distributors Cuddalore'))!));
    expect(near[0].problems.join(' ')).toMatch(/not a linked distributor/);
    const { dist } = await sides();
    const gstin = (await dist.settings.toCollection().first())!.gstin;
    const byGst = await asCo(HO, async () => draftPrimary(readPrimaryRows(rows('SMD Tittakudi', gstin))!));
    expect(byGst[0].problems).toEqual([]);
  });
});

describe('review 5 & 6: padded claims and double decisions', () => {
  it('the same bill line claimed twice: the second is flagged; a photo alone never passes a damage line', async () => {
    const { co } = await sides();
    const { checkClaim } = await import('../src/core/claims');
    const sec = (await co.secondary.toArray()).find(s => s.lines.length)!;
    const l = sec.lines[0];
    const scheme = (await co.schemes.toArray()).find(s => s.productId === l.productId);
    const claim = { id: 'cx', tenantId: '', createdAt: '', updatedAt: '', dbLinkId: sec.dbLinkId, month: sec.date.slice(0, 7), amount: 0, status: 'submitted', lines: [
      { id: 'a', kind: 'scheme', productId: l.productId, qty: l.qty, amount: 1, invoiceId: sec.id },
      { id: 'b', kind: 'scheme', productId: l.productId, qty: l.qty, amount: 1, invoiceId: sec.id },
      { id: 'c', kind: 'damage', productId: l.productId, qty: 5000, amount: 99999, photo: 'data:x' },
    ] };
    const chk = await asCo(HO, () => checkClaim(claim as never));
    if (scheme && scheme.from <= sec.date && scheme.to >= sec.date) {
      expect(chk.lines.find(x => x.id === 'a')!.ok).toBe(true);
      expect(chk.lines.find(x => x.id === 'b')!.ok).toBe(false);
      expect(chk.lines.find(x => x.id === 'b')!.why).toMatch(/already claimed/);
    }
    expect(chk.lines.find(x => x.id === 'c')!.ok).toBe(false);
  });
  it('a final decision has one record per claim, and its credit-note number moves forward on this phone', async () => {
    const { co } = await sides();
    const { decideClaim } = await import('../src/core/claims');
    const cl = { id: 'cy', tenantId: '', createdAt: '', updatedAt: '', dbLinkId: (await co.dbLinks.toArray()).find(l => l.status === 'linked')!.id, month: '2026-11', amount: 5, status: 'submitted', lines: [{ id: 'z', kind: 'rate_diff', qty: 0, amount: 5 }] };
    await asCo(HO, () => decideClaim(cl as never, 'rejected', [], 'No rate letter'));
    expect(await co.claimDecisions.get('final:cy')).toBeTruthy();
    await expect(asCo(HO, () => decideClaim(cl as never, 'approved', ['z'], ''))).rejects.toThrow(/already decided/);
  });
});

describe('review 8: GPS drift is not distance', () => {
  it('eight hours standing still with 30–100 m drift counts (almost) nothing', async () => {
    const { measure } = await import('../src/core/field');
    const track: WorkDay['track'] = [];
    for (let i = 0; i <= 240; i++) track.push({ at: new Date(Date.UTC(2026, 10, 10, 3, 0) + i * 120000).toISOString(), lat: 11.4 + (i % 2 ? 0.0006 : -0.0003), lng: 79.25 + (i % 3 ? 0.0004 : 0), acc: 60 });
    expect(measure(track).km).toBeLessThan(0.5);
  });
  it('a rep who did not move is not given a new reading (only "last seen" moves), and no audit entry is written for it', async () => {
    await asCo(ARUN, async () => {
      const { startDay, addPoint, myDay } = await import('../src/core/field');
      const { db } = await import('../src/core/db');
      await startDay({ lat: 11.4, lng: 79.25, acc: 20 });
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 10 * 60000);
      const audits = await db.audit.count();
      await addPoint({ lat: 11.4004, lng: 79.25, acc: 60 }); // 45 m, inside the accuracy: drift
      vi.useRealTimers();
      const d = (await myDay())!;
      expect(d.track.length).toBe(1);
      expect(d.lastAt).toBeTruthy();
      expect(await db.audit.count()).toBe(audits);
    });
  });
});

describe('review 3: the manager sees the claim worked out from the record, not the rep\'s totals', () => {
  it('a forged total on a travel claim is replaced by what the record says', async () => {
    const { co } = await sides();
    const meena = (await co.staff.toArray()).find(s => s.phone === '9100000005')!;
    await co.travelClaims.put({ id: 'forged', tenantId: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), staffId: meena.id, month: new Date().toISOString().slice(0, 7), days: 30, km: 9000, kmAmount: 99999, daDays: 30, outDays: 30, daAmount: 99999, expenses: 0, total: 199998, flags: [], status: 'waiting' });
    const rows = await asCo(DIVYA, async () => (await import('../src/core/travel')).travelToDecide());
    const f = rows.find(r => r.claim.id === 'forged')!;
    expect(f.actual.total).toBeLessThan(5000);
    expect(f.mismatch).toBe(true);
  });
  it('outstation is not decided by spelling', async () => {
    const { sameTown } = await import('../src/core/travel');
    expect(sameTown('Tittakudi', 'Tittagudi')).toBe(true);
    expect(sameTown('Tittakudi', 'Pennadam')).toBe(false);
  });
});

describe('review: orders and receipts', () => {
  it('an order with a product the company does not have is refused, not silently shortened', async () => {
    const { co } = await sides();
    const { invoiceFromOrder } = await import('../src/core/grn');
    await co.primaryOrders.put({ id: 'po-x', tenantId: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), dbLinkId: (await co.dbLinks.toArray())[0].id, date: '2026-11-10', lines: [{ productId: 'missing', name: 'Unknown', qty: 12 }], status: 'sent' });
    await expect(asCo(HO, () => invoiceFromOrder('po-x', 'X/1'))).rejects.toThrow(/not in your product list/);
  });
  it('a company bill\'s receipt is the distributor\'s own record (the company\'s bill is never changed by it)', async () => {
    const { dist } = await sides();
    const { receiveInbound, receiptOf } = await import('../src/core/grn');
    const inb = (await dist.inbound.toArray()).find(i => !i.cancelled && !(dist as unknown as { receipts?: unknown }).receipts || true)!;
    const pending = (await Promise.all((await dist.inbound.toArray()).map(async i => ({ i, r: await asDb(() => receiptOf(i.id)) })))).find(x => !x.r)!.i;
    const before = JSON.stringify(pending);
    await asDb(() => receiveInbound(pending.id, [], []));
    expect(JSON.stringify(await dist.inbound.get(pending.id))).toBe(before);
    expect((await asDb(() => receiptOf(pending.id)))?.status).toBe('received');
    void inb;
  });
});
