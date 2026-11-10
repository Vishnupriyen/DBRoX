// Company side end to end on one phone (the demo): link, privacy wall, sales and stock numbers, invoice upload.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';

const store = new Map<string, string>();
beforeAll(async () => {
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
  const { wireDemoRelay } = await import('../src/core/link');
  await wireDemoRelay();
  const { seedCompanyDemo } = await import('../src/core/seedCompany');
  await seedCompanyDemo();
}, 60000);

const sides = async () => { const { storeOf } = await import('../src/core/link'); return { co: storeOf('company'), dist: storeOf('distributor') }; };

describe('company demo', () => {
  it('links the demo distributor and receives only its own brand', async () => {
    const { co } = await sides();
    expect((await co.dbLinks.toArray()).filter(l => l.status === 'linked').map(l => l.name)).toEqual(['Sri Murugan Distributors']);
    const all = JSON.stringify(await Promise.all(['secondary', 'secondaryReturns', 'dbStock', 'shops', 'grns', 'dbClaims', 'primaryOrders'].map(t => co.table(t).toArray())));
    for (const rival of ['Surf', 'Lifebuoy', 'Aashirvaad', 'Good Day', 'Marie', 'Bingo', '9443000001', 'Murugan']) {
      if (rival === 'Murugan') continue; // shop names are shared (the outlet list) — phones are not
      expect(all).not.toContain(rival);
    }
    expect(all).not.toContain('9443000001');
    expect((await co.secondary.count())).toBeGreaterThan(5);
  });

  it('distributor sales to shops on the company side equal the distributor\'s own Kaveri bills', async () => {
    const { co, dist } = await sides();
    const kavCo = (await dist.companies.toArray()).find(c => c.link?.status === 'linked')!;
    const own = (await dist.invoices.toArray()).filter(i => i.companyId === kavCo.id && !i.cancelled).reduce((a, i) => a + i.taxable, 0);
    const seen = (await co.secondary.toArray()).reduce((a, i) => a + i.taxable, 0);
    expect(Math.round(seen * 100)).toBe(Math.round(own * 100));
  });

  it('stock at the distributor matches its lots, and the latest company bill waits to be received', async () => {
    const { co, dist } = await sides();
    const kav = (await dist.products.toArray()).filter(p => p.companyProductId);
    for (const p of kav) {
      const lots = (await dist.batches.where('productId').equals(p.id).toArray()).reduce((a, b) => a + b.qty, 0);
      const s = (await co.dbStock.toArray()).find(x => x.productId === p.companyProductId)!;
      expect(s.qty + s.expired).toBe(lots);
    }
    expect((await dist.inbound.toArray()).filter(i => i.status === 'pending').length).toBe(1);
    expect((await co.grns.count())).toBe(3);
  });

  it('the numbers: sales to distributors vs distributor sales, and days of stock', async () => {
    const { db, onSide } = await import('../src/core/db');
    const { co } = await sides();
    const { salesByDistributor, stockCover, salesByProduct } = await import('../src/core/company');
    await onSide(co, async () => {
      const rows = await salesByDistributor();
      expect(rows.find(r => r.link.name === 'Sri Murugan Distributors')!.secondary).toBeGreaterThan(0);
      const cover = await stockCover();
      expect(cover.length).toBe(7);
      for (const c of cover) if (c.days !== null) expect(c.days).toBe(Math.round(c.qty / c.perDay));
      expect((await salesByProduct()).length).toBeGreaterThan(0);
      void db;
    });
  });

  it('invoice upload from a SAP/Tally sales register: grouped, matched, problems shown, sent to the distributor', async () => {
    const { onSide, setSession } = await import('../src/core/db');
    const { co, dist } = await sides();
    const { readPrimaryRows, draftPrimary, sendPrimary } = await import('../src/core/company');
    const rows = [
      ['Sales Register', '', '', '', '', ''],
      ['Billing Document', 'Billing Date', 'Customer Name', 'Material', 'Material Description', 'Billed Qty', 'Rate', 'GST %', 'Taxable Value'],
      ['90001', '08/11/2026', 'Sri Murugan Distributors', 'KV101', 'Coconut Oil 500ml', '48', '91.8', '5', '4406.4'],
      ['90001', '08/11/2026', 'Sri Murugan Distributors', 'KV201', 'Sambar Powder 100g', '120', '34.2', '5', '4104'],
      ['90002', '08/11/2026', 'Nobody Traders', 'KV101', 'Coconut Oil', '24', '91.8', '5', '2203.2'],
      ['90003', '08/11/2026', 'Sri Murugan Distributors', 'ZZ9', 'Unknown Soap', '24', '10', '18', '240'],
    ];
    const parsed = readPrimaryRows(rows)!;
    expect(parsed.length).toBe(4);
    await onSide(co, async () => {
      setSession('demo-company', 'x');
      const d = await draftPrimary(parsed);
      expect(d.map(x => [x.invoice.number, x.problems.length])).toEqual([['90001', 0], ['90002', 1], ['90003', 1]]);
      expect(d[0].invoice.lines.map(l => l.qty)).toEqual([48, 120]);
      expect(await sendPrimary(d)).toBe(1);
      await expect(sendPrimary(await draftPrimary(parsed.slice(0, 2)))).rejects.toThrow(/fix the problems/);
    });
    const arrived = (await dist.inbound.toArray()).find(i => i.number === '90001')!;
    expect(arrived.status).toBe('pending');
    expect(arrived.lines.every(l => l.productId)).toBe(true);
  });

  it('a company product change reaches the distributor; the distributor\'s own aliases stay', async () => {
    const { onSide, setSession } = await import('../src/core/db');
    const { co, dist } = await sides();
    const { saveProducts } = await import('../src/core/company');
    const p = (await co.products.toArray()).find(x => x.code === 'KV202')!;
    const before = (await dist.products.toArray()).find(x => x.companyProductId === p.id)!;
    await dist.products.put({ ...before, aliases: ['rasam', 'rsm'] });
    await onSide(co, async () => { setSession('demo-company', 'x'); await saveProducts([{ ...p, rate: 35, mrp: 42 }]); });
    const after = (await dist.products.get(before.id))!;
    expect(after.rate).toBe(35);
    expect(after.aliases).toEqual(['rasam', 'rsm']);
  });

  it('invite: a code that is wrong or used is refused; leaving stops new data', async () => {
    const { previewInvite, acceptInvite, leaveLink } = await import('../src/core/link');
    await expect(previewInvite('KAVDM1')).rejects.toThrow(/not valid or was already used/);
    await expect(previewInvite('12')).rejects.toThrow(/6 letters/);
    expect((await previewInvite('kavvl2')).company).toMatch(/Kaveri/);
    void acceptInvite;
    const { co, dist } = await sides();
    const link = (await co.dbLinks.toArray()).find(l => l.status === 'linked')!;
    const n = await co.secondary.count();
    await leaveLink(link.id);
    const { onSide, ChangeSet, setSession } = await import('../src/core/db');
    await onSide(dist, async () => {
      setSession('demo', 'x');
      const inv = (await dist.invoices.toArray()).find(i => (dist as unknown) && i.lines.length)!;
      const cs = new ChangeSet(); cs.put('invoices', { ...inv, id: undefined, number: 'NEW/1' }); await cs.commit('after leaving');
    });
    expect(await co.secondary.count()).toBe(n);
  });
});
