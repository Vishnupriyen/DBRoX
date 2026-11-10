// Step 4: digital goods receipt against the company's own bill, differences → GST-referenced claim lines, and the
// suggested order to the company (and back as an invoice).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';

const store = new Map<string, string>();
beforeAll(async () => {
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
  const { wireDemoRelay } = await import('../src/core/link'); await wireDemoRelay();
  const { seedCompanyDemo } = await import('../src/core/seedCompany'); await seedCompanyDemo();
}, 90000);

const sides = async () => { const { storeOf } = await import('../src/core/link'); return { co: storeOf('company'), dist: storeOf('distributor') }; };
const asDb = async <X,>(fn: () => Promise<X>) => {
  const { onSide, setSession } = await import('../src/core/db'); const { dist } = await sides();
  return onSide(dist, async () => { setSession('demo', (await dist.staff.toArray()).find(s => s.role === 'owner')!.id); return fn(); });
};
const asCo = async <X,>(fn: () => Promise<X>) => {
  const { onSide, setSession } = await import('../src/core/db'); const { co } = await sides();
  return onSide(co, async () => { setSession('demo-company', (await co.staff.toArray()).find(s => s.role === 'cadmin')!.id); return fn(); });
};
const jwt = (data: object) => { const b = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return `${b({ alg: 'RS256' })}.${b({ data: JSON.stringify(data), iss: 'NIC' })}.sig`; };

describe('the QR confirms the bill (it never supplies the lines)', () => {
  it('reads the signed QR header and spots a different bill', async () => {
    const { readEinvoiceQr, compareQr } = await import('../src/core/grn');
    const { dist } = await sides();
    const inb = (await dist.inbound.toArray()).find(i => i.status === 'pending')!;
    const same = readEinvoiceQr(jwt({ DocNo: inb.number, TotInvVal: inb.total, ItemCnt: inb.lines.length, BuyerGstin: '33X' }))!;
    expect(same.DocNo).toBe(inb.number);
    expect(compareQr(inb, same, '33X')).toEqual([]);
    const other = readEinvoiceQr(jwt({ DocNo: 'KCP/9999', TotInvVal: inb.total + 500, ItemCnt: 2, BuyerGstin: '33Y' }))!;
    expect(compareQr(inb, other, '33X').length).toBe(4);
    expect(readEinvoiceQr('not a qr')).toBeNull();
  });
});

describe('receiving a company bill', () => {
  it('typed differences are read against this bill\'s products only', async () => {
    const { dist } = await sides();
    const inb = (await dist.inbound.toArray()).find(i => i.status === 'pending')!;
    const r = await asDb(async () => (await import('../src/core/grn')).readDifferences('coconut oil 1 case short, 6 sambar damaged, surf 2 short', inb));
    const name = async (id: string) => (await dist.products.get(id))!.name;
    expect(await Promise.all(r.short.map(async d => [await name(d.productId), d.qty]))).toEqual([['Kaveri Coconut Oil 500ml', 24]]);
    expect(await Promise.all(r.damaged.map(async d => [await name(d.productId), d.qty]))).toEqual([['Kaveri Sambar Powder 100g', 6]]);
    expect(r.unclear).toEqual(['surf 2 short']); // not on this bill
  });
  it('refuses more short than billed, and part pieces', async () => {
    const { dist } = await sides();
    const inb = (await dist.inbound.toArray()).find(i => i.status === 'pending')!;
    const l = inb.lines[0];
    const { receiveInbound } = await import('../src/core/grn');
    await expect(asDb(() => receiveInbound(inb.id, [{ productId: l.productId, qty: l.qty + 1 }], []))).rejects.toThrow(/more short/);
    await expect(asDb(() => receiveInbound(inb.id, [{ productId: l.productId, qty: 1.5 }], []))).rejects.toThrow(/whole number/);
  });
  it('good stock goes in, the purchase is the bill, differences become claim lines with the bill number and IRN', async () => {
    const { dist, co } = await sides();
    const inb = (await dist.inbound.toArray()).find(i => i.status === 'pending')!;
    await dist.inbound.put({ ...inb, irn: 'IRN-TEST-0001' });
    const oil = inb.lines.find(l => l.name.includes('Coconut'))!;
    const before = (await dist.batches.where('productId').equals(oil.productId).toArray()).reduce((a, b) => a + b.qty, 0);
    const { receiveInbound } = await import('../src/core/grn');
    const r = await asDb(() => receiveInbound(inb.id, [{ productId: oil.productId, qty: 24 }], []));
    expect(r.diff).toBe(true);
    const after = (await dist.batches.where('productId').equals(oil.productId).toArray()).reduce((a, b) => a + b.qty, 0);
    expect(after - before).toBe(oil.qty - 24);
    const p = (await dist.purchases.toArray()).find(x => x.billNo === inb.number)!;
    expect(p.total).toBe(inb.total);
    const cl = (await dist.claimEntries.toArray()).filter(e => e.refNumber === inb.number);
    expect(cl).toHaveLength(1);
    expect(cl[0]).toMatchObject({ kind: 'shortage', qty: 24, irn: 'IRN-TEST-0001' });
    expect(cl[0].amount).toBeCloseTo(24 * oil.rate * (1 + oil.gst / 100), 2);
    await expect(asDb(() => receiveInbound(inb.id, [], []))).rejects.toThrow(/already received/);
    // the company sees the goods receipt (in its own product ids)
    const g = (await co.grns.toArray()).find(x => x.primaryInvoiceId === inb.id)!;
    expect(g.status).toBe('disputed');
    expect(g.short).toEqual([{ productId: oil.coProductId, qty: 24 }]);
  });
  it('the shortage claim, sent to the company, checks out against the goods receipt', async () => {
    const { dist, co } = await sides();
    const kav = (await dist.companies.toArray()).find(c => c.link?.status === 'linked')!;
    const { thisMonth } = await import('../src/core/db');
    await asDb(async () => (await import('../src/core/claims')).sendClaim(kav.id, thisMonth()));
    const claim = (await co.dbClaims.toArray()).find(c => c.lines.some(l => l.kind === 'shortage'))!;
    const chk = await asCo(async () => (await import('../src/core/claims')).checkClaim(claim));
    const line = chk.lines.find(l => l.kind === 'shortage')!;
    expect(line.ok).toBe(true);
    expect(line.why).toMatch(/goods receipt/);
  });
});

describe('the order to the company', () => {
  it('suggests cases from sales, stock and bills on the way; sends once; comes back as an invoice to receive', async () => {
    const { dist, co } = await sides();
    const kav = (await dist.companies.toArray()).find(c => c.link?.status === 'linked')!;
    const { suggestOrder, sendPrimaryOrder, invoiceFromOrder } = await import('../src/core/grn');
    const rows = await asDb(() => suggestOrder(kav.id, 15));
    for (const r of rows) expect(r.cases).toBe(Math.max(0, Math.ceil((r.perDay * 18 - r.stock - r.inTransit) / r.caseSize)));
    const lines = rows.filter(r => r.cases > 0).map(r => ({ productId: r.productId, qty: r.cases * r.caseSize }));
    expect(lines.length).toBeGreaterThan(0);
    const o1 = await asDb(() => sendPrimaryOrder(kav.id, lines));
    const o2 = await asDb(() => sendPrimaryOrder(kav.id, lines));
    expect(o2.id).toBe(o1.id);
    const atCo = (await co.primaryOrders.toArray()).find(o => o.id === o1.id)!;
    expect(atCo.lines.length).toBe(lines.length);
    await asCo(() => invoiceFromOrder(o1.id, 'KCP/26-27/5001'));
    await expect(asCo(() => invoiceFromOrder(o1.id, 'KCP/26-27/5002'))).rejects.toThrow(/already invoiced/);
    const arrived = (await dist.inbound.toArray()).find(i => i.primaryOrderId === o1.id)!;
    expect(arrived).toMatchObject({ number: 'KCP/26-27/5001', status: 'pending' });
    expect(arrived.lines.every(l => l.productId)).toBe(true);
  });
});
