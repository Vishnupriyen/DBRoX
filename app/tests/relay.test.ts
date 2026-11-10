// The privacy wall between a company and a distributor (independent review, 10 Nov 2026: "must be enforced and proven
// before any company feature"). A distributor carries several brands; a company must only ever see its own.
import { describe, it, expect } from 'vitest';
import { companyToDb, dbToCompany, type Doc, type Link, type Store } from '../../shared/relay';

class Mem implements Store {
  t = new Map<string, Map<string, Doc>>();
  put(tbl: string, d: Doc) { if (!this.t.has(tbl)) this.t.set(tbl, new Map()); this.t.get(tbl)!.set(d.id, d); return d; }
  async get(tbl: string, id: string) { return this.t.get(tbl)?.get(id); }
  async find(tbl: string, f: string, v: unknown) { return [...(this.t.get(tbl)?.values() ?? [])].filter(d => d[f] === v); }
}
const ctx = { today: '2026-11-10' };
// after the link is accepted, the distributor's own Kaveri product is tied to the company's product
const linked = (db: Mem) => db.put('products', { id: 'd1', companyId: 'cKAV', name: 'kaveri gold oil 500ml', code: 'KG500', rate: 95, companyProductId: 'P1' });

function world() {
  const db = new Mem(), co = new Mem();
  // the distributor sells two brands: KAV (linked company) and RIV (a rival)
  db.put('companies', { id: 'cKAV', name: 'Kaveri' }); db.put('companies', { id: 'cRIV', name: 'Rival' });
  co.put('products', { id: 'P1', name: 'Kaveri Gold Oil 500ml', code: 'KG500', rate: 90, mrp: 110 });
  db.put('products', { id: 'd1', companyId: 'cKAV', name: 'kaveri gold oil 500ml', code: 'KG500', rate: 95 });
  db.put('products', { id: 'd2', companyId: 'cRIV', name: 'Rival Oil 500ml', rate: 80 });
  db.put('shops', { id: 's1', name: 'Murugan Stores', area: 'Pennadam', beat: 'Monday', phone: '9443000001', owner: 'Murugan', gstin: '33AAA', creditLimit: 50000, creditDays: 15, cashOnly: false, approved: true, aliases: [] });
  const link: Link = { id: 'L1', companyTenant: 'CO', dbTenant: 'DB', companyIdInDb: 'cKAV', status: 'linked' };
  return { db, co, link };
}

describe('privacy wall: distributor → company', () => {
  it('a bill of the rival brand never reaches the company', async () => {
    const { db, co, link } = world();
    const inv = { id: 'i2', companyId: 'cRIV', number: 'B2', lines: [{ productId: 'd2', qty: 5, rate: 80, taxable: 400, total: 472 }] };
    expect(await dbToCompany(link, 'invoices', inv, db, co, ctx)).toEqual([]);
  });
  it('a rival line smuggled onto this company\'s bill is dropped', async () => {
    const { db, co, link } = world(); linked(db);
    const inv = { id: 'i1', companyId: 'cKAV', number: 'B1', date: '2026-11-10', shopId: 's1', lines: [
      { productId: 'd1', name: 'Kaveri', qty: 2, rate: 95, taxable: 190, total: 199.5 },
      { productId: 'd2', name: 'Rival', qty: 9, rate: 80, taxable: 720, total: 756 }] };
    const [w] = await dbToCompany(link, 'invoices', inv, db, co, ctx);
    expect(w.tbl).toBe('secondary');
    expect((w.doc.lines as Doc[]).map(l => l.productId)).toEqual(['P1']); // mapped to the company's own product id
    expect(w.doc.total).toBe(199.5);
    expect(JSON.stringify(w)).not.toContain('Rival');
  });
  it('a shop crosses as an outlet only: no phone, owner, GSTIN or credit terms', async () => {
    const { db, co, link } = world();
    const [w] = await dbToCompany(link, 'shops', (await db.get('shops', 's1'))!, db, co, ctx);
    expect(w.doc.name).toBe('Murugan Stores');
    for (const f of ['phone', 'owner', 'gstin']) expect(w.doc[f]).toBeUndefined();
    expect(w.doc.creditLimit).toBe(0);
  });
  it('stock of a rival product never crosses; own stock is summed without expired lots', async () => {
    const { db, co, link } = world(); linked(db);
    db.put('batches', { id: 'b1', productId: 'd1', qty: 30, expiry: '2027-06-01' });
    db.put('batches', { id: 'b2', productId: 'd1', qty: 4, expiry: '2026-12-01' });
    db.put('batches', { id: 'b3', productId: 'd1', qty: 7, expiry: '2026-10-01' });
    db.put('batches', { id: 'b9', productId: 'd2', qty: 99, expiry: '2027-06-01' });
    expect(await dbToCompany(link, 'batches', (await db.get('batches', 'b9'))!, db, co, ctx)).toEqual([]);
    const [w] = await dbToCompany(link, 'batches', (await db.get('batches', 'b1'))!, db, co, ctx);
    expect(w.doc).toMatchObject({ productId: 'P1', qty: 34, nearExpiry: 4, expired: 7 });
  });
  it('payments, staff, settings, expenses and bank lines never cross', async () => {
    const { db, co, link } = world();
    for (const t of ['payments', 'staff', 'settings', 'expenses', 'bankLines', 'purchases', 'audit', 'orders', 'checkIns'])
      expect(await dbToCompany(link, t, { id: 'x', companyId: 'cKAV', amount: 5 }, db, co, ctx)).toEqual([]);
  });
  it('a claim to the rival, or a draft claim, never crosses; claim lines of rival products are dropped', async () => {
    const { db, co, link } = world();
    db.put('claimEntries', { id: 'e1', companyId: 'cKAV', month: '2026-11', kind: 'scheme', productId: 'd1', qty: 2, amount: 20 });
    db.put('claimEntries', { id: 'e2', companyId: 'cKAV', month: '2026-11', kind: 'scheme', productId: 'd2', qty: 2, amount: 50 });
    expect(await dbToCompany(link, 'claims', { id: 'c0', companyId: 'cRIV', month: '2026-11', status: 'submitted', amount: 1 }, db, co, ctx)).toEqual([]);
    expect(await dbToCompany(link, 'claims', { id: 'c1', companyId: 'cKAV', month: '2026-11', status: 'draft', amount: 1 }, db, co, ctx)).toEqual([]);
    const [w] = await dbToCompany(link, 'claims', { id: 'c2', companyId: 'cKAV', month: '2026-11', status: 'submitted', amount: 20 }, db, co, ctx);
    expect((w.doc.lines as Doc[]).map(l => l.id)).toEqual(['e1']);
  });
  it('nothing crosses once the distributor has left', async () => {
    const { db, co, link } = world();
    const left = { ...link, status: 'left' as const };
    expect(await dbToCompany(left, 'shops', (await db.get('shops', 's1'))!, db, co, ctx)).toEqual([]);
    expect(await companyToDb(left, 'products', (await co.get('products', 'P1'))!, db, co, ctx)).toEqual([]);
  });
});

describe('company → distributor', () => {
  it('a company product links to the distributor\'s same product (by code) instead of making a duplicate', async () => {
    const { db, co, link } = world();
    const [w] = await companyToDb(link, 'products', (await co.get('products', 'P1'))!, db, co, ctx);
    expect(w.doc.id).toBe('d1');
    expect(w.doc).toMatchObject({ companyProductId: 'P1', companyId: 'cKAV', rate: 90 });
  });
  it('a new company product is added under the company, never under the rival', async () => {
    const { db, co, link } = world();
    co.put('products', { id: 'P2', name: 'Kaveri Sambar Powder 100g', rate: 40 });
    const [w] = await companyToDb(link, 'products', (await co.get('products', 'P2'))!, db, co, ctx);
    expect(w.doc).toMatchObject({ id: 'P2', companyId: 'cKAV', companyProductId: 'P2' });
  });
  it('an invoice for another distributor never arrives here', async () => {
    const { db, co, link } = world();
    expect(await companyToDb(link, 'primaryInvoices', { id: 'pi1', dbLinkId: 'L2', lines: [] }, db, co, ctx)).toEqual([]);
  });
  it('a received company bill is never overwritten by a later company edit', async () => {
    const { db, co, link } = world();
    db.put('inbound', { id: 'pi1', status: 'received' });
    expect(await companyToDb(link, 'primaryInvoices', { id: 'pi1', dbLinkId: 'L1', lines: [{ productId: 'P1', qty: 99 }] }, db, co, ctx)).toEqual([]);
  });
  it('a field order arrives as a new order once, priced at the distributor\'s rate, and is never overwritten', async () => {
    const { db, co, link } = world();
    db.put('products', { id: 'd1', companyId: 'cKAV', name: 'kaveri gold oil 500ml', code: 'KG500', rate: 95, companyProductId: 'P1' });
    const o = { id: 'o1', dbLinkId: 'L1', shopId: 's1', date: '2026-11-10', repName: 'Arun', lines: [{ productId: 'P1', qty: 12 }] };
    const [w] = await companyToDb(link, 'orders', o, db, co, ctx);
    expect(w.doc).toMatchObject({ status: 'new', source: 'company', shopId: 's1', lines: [{ productId: 'd1', qty: 12, rate: 95 }] });
    db.put('orders', w.doc);
    expect(await companyToDb(link, 'orders', { ...o, lines: [{ productId: 'P1', qty: 1 }] }, db, co, ctx)).toEqual([]);
  });
});
