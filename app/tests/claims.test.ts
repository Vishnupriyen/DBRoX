// Step 3: distributor claims checked by the company line by line, decisions back with a credit note; travel & expenses.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';

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
const HO = '9100000001', DIVYA = '9100000003', ARUN = '9100000004', MEENA = '9100000005';

describe('distributor claims', () => {
  it('the distributor\'s bills already carry claim lines for the company\'s schemes; sending makes one claim', async () => {
    const { dist, co } = await sides();
    const kav = (await dist.companies.toArray()).find(c => c.link?.status === 'linked')!;
    const { thisMonth } = await import('../src/core/db');
    const lines = await asDb(async () => (await import('../src/core/claims')).openLines(kav.id, thisMonth()));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every(l => l.kind === 'scheme' && l.invoiceId)).toBe(true);
    await asDb(async () => (await import('../src/core/claims')).sendClaim(kav.id, thisMonth()));
    await expect(asDb(async () => (await import('../src/core/claims')).sendClaim(kav.id, thisMonth()))).rejects.toThrow(/Nothing new/);
    const got = await co.dbClaims.toArray();
    expect(got.length).toBe(1);
    expect(got[0].lines.length).toBe(lines.length);
  });

  it('TESRAX checks every line: genuine scheme lines pass; a padded one is flagged with the right amount', async () => {
    const { dist, co } = await sides();
    const kav = (await dist.companies.toArray()).find(c => c.link?.status === 'linked')!;
    const { thisMonth } = await import('../src/core/db');
    // a padded line: the same bill, ten times the scheme value; and a rate-difference line without papers
    const real = (await dist.claimEntries.toArray()).find(e => e.companyId === kav.id && e.kind === 'scheme' && e.month === thisMonth())!;
    await asDb(async () => {
      const { ChangeSet } = await import('../src/core/db');
      const cs = new ChangeSet(); cs.put('claimEntries', { ...real, id: undefined, amount: real.amount * 10, note: 'padded' }); await cs.commit('padded');
      await expect((await import('../src/core/claims')).addClaimLine({ companyId: kav.id, kind: 'rate_diff', amount: 500, note: 'Price drop Oct' })).rejects.toThrow(/bill number/);
      await (await import('../src/core/claims')).addClaimLine({ companyId: kav.id, kind: 'rate_diff', amount: 500, note: 'Price drop Oct', refNumber: 'KCP/26-27/4101' });
      await (await import('../src/core/claims')).sendClaim(kav.id, thisMonth());
    });
    const claim = (await co.dbClaims.toArray()).find(c => c.lines.length === 2)!;
    const chk = await asCo(HO, async () => (await import('../src/core/claims')).checkClaim(claim));
    const padded = chk.lines.find(l => l.kind === 'scheme')!;
    expect(padded.ok).toBe(false);
    expect(padded.expected).toBeCloseTo(real.amount, 0);
    const rd = chk.lines.find(l => l.kind === 'rate_diff')!;
    expect(rd.ok).toBe(false);
    expect(rd.why).toMatch(/papers/);
    const first = (await co.dbClaims.toArray()).find(c => c.id !== claim.id)!;
    const ok = await asCo(HO, async () => (await import('../src/core/claims')).checkClaim(first));
    expect(ok.flagged).toBe(0);
  });

  it('an SO recommends (the distributor sees nothing yet); head office approves part; the decision is final', async () => {
    const { co, dist } = await sides();
    const claim = (await co.dbClaims.toArray()).find(c => c.lines.length > 2)!;
    const chk = await asCo(HO, async () => (await import('../src/core/claims')).checkClaim(claim));
    const okIds = chk.lines.filter(l => l.ok).map(l => l.id);
    await expect(asCo(DIVYA, async () => (await import('../src/core/claims')).decideClaim(claim, 'approved', okIds, ''))).rejects.toThrow(/Only head office/);
    await asCo(DIVYA, async () => (await import('../src/core/claims')).decideClaim(claim, 'recommended', okIds, 'Looks fine'));
    expect((await dist.claimDecisions.toArray()).length).toBe(0); // a recommendation stays inside the company
    const half = okIds.slice(0, Math.ceil(okIds.length / 2));
    const r = await asCo(HO, async () => (await import('../src/core/claims')).decideClaim(claim, 'approved', half, ''));
    expect(r.creditNoteNo).toMatch(/-CN\//);
    const atDb = (await dist.claimDecisions.toArray())[0];
    expect(atDb).toMatchObject({ claimId: claim.id, status: 'approved', creditNoteNo: r.creditNoteNo });
    expect(atDb.amount).toBeCloseTo(chk.lines.filter(l => half.includes(l.id)).reduce((a, l) => a + l.amount, 0), 2);
    await expect(asCo(HO, async () => (await import('../src/core/claims')).decideClaim(claim, 'rejected', [], 'no'))).rejects.toThrow(/already decided/);
  });

  it('a scheme budget caps what can be approved', async () => {
    const { co } = await sides();
    await asCo(HO, async () => { const { db, ChangeSet } = await import('../src/core/db'); const cs = new ChangeSet(); for (const s of await db.schemes.toArray()) cs.put('schemes', { ...s, budget: 1 }); await cs.commit('tiny budgets'); });
    const claim = (await co.dbClaims.toArray()).find(c => c.lines.length === 2)!;
    const chk = await asCo(HO, async () => (await import('../src/core/claims')).checkClaim({ ...claim, lines: claim.lines.map(l => l.kind === 'scheme' ? { ...l, amount: 1.5 } : l) }));
    expect(chk.lines.find(l => l.kind === 'scheme')!.why).toMatch(/budget/);
  });
});

describe('travel and expenses', () => {
  it('the month\'s claim comes from the record: km × rate, daily allowance, expenses — and flags what is odd', async () => {
    await asCo(MEENA, async () => {
      const { addExpense, monthClaim, DEFAULT_POLICY } = await import('../src/core/travel');
      const { today, session } = await import('../src/core/db');
      await addExpense({ date: today(), category: 'Lodge', amount: 1500, photo: 'data:image/jpeg;base64,AAAA' });
      await addExpense({ date: today(), category: 'Food', amount: 120, photo: 'data:image/jpeg;base64,AAAA' }); // the same photo again
      await expect(addExpense({ date: today(), category: 'Food', amount: 0 })).rejects.toThrow(/more than 0/);
      const m = await monthClaim(session().userId);
      expect(m.km).toBeCloseTo(3.6, 0);
      expect(m.kmAmount).toBeCloseTo(m.km * DEFAULT_POLICY.bike, 1);
      expect(m.daDays).toBe(1);
      expect(m.expenses).toBe(1620);
      expect(m.flags.some(f => /over the ₹1200 limit/.test(f))).toBe(true);
      expect(m.flags.some(f => /same bill photo/.test(f))).toBe(true);
      expect(m.flags.some(f => /not ended/.test(f))).toBe(true);
    });
  });
  it('sent once a month; the manager approves (never their own); expenses are approved with it', async () => {
    await asCo(MEENA, async () => { const t = await import('../src/core/travel'); await t.submitMonth(); await expect(t.submitMonth()).rejects.toThrow(/already sent/); });
    const { co } = await sides();
    const c = (await co.travelClaims.toArray())[0];
    await expect(asCo(MEENA, async () => (await import('../src/core/travel')).decideTravel(c.id, true, ''))).rejects.toThrow(/own claim/);
    await asCo(DIVYA, async () => (await import('../src/core/travel')).decideTravel(c.id, true, ''));
    expect((await co.expenses.toArray()).filter(e => e.by === c.staffId).every(e => e.status === 'approved')).toBe(true);
  });
  it('TESRAX: "lunch 120, bus 45" becomes the rep\'s expenses, waiting for the month\'s claim', async () => {
    const r = await asCo(ARUN, async () => (await import('../src/core/engine')).handle('lunch 120, bus 45', []));
    const props = (r.parts ?? [r]).map(x => x.proposal!); // two things said → one table each (as everywhere in TESRAX)
    expect(props.every(p => p?.kind === 'expense')).toBe(true);
    expect(props.flatMap(p => p.rows.map(x => [x.category, x.amount]))).toEqual([['Food', 120], ['Bus', 45]]);
    for (const p of props) await asCo(ARUN, async () => (await import('../src/core/proposals')).commit(p));
    const { co } = await sides();
    const arun = (await co.staff.toArray()).find(s => s.phone === ARUN)!;
    expect((await co.expenses.toArray()).filter(e => e.by === arun.id).map(e => e.status)).toEqual(['waiting', 'waiting']);
  });
  it('a day after midnight in India is counted in the right month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T00:30:00+05:30'));
    const { thisMonth } = await import('../src/core/db');
    expect(thisMonth()).toBe(process.env.TZ === 'UTC' ? '2026-11' : '2026-12');
    vi.useRealTimers();
  });
});
