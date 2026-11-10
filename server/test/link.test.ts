// Company ⇄ distributor link on a real database: the privacy wall holds end to end (independent review, 10 Nov 2026).
process.env.RELAY_INLINE = '1'; // these tests check what crosses, so the relay runs inside each sync (production runs it in the background)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pgServer: EmbeddedPostgres;
let pool: pg.Pool;
let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
const port = 54331;

beforeAll(async () => {
  pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'dbrox-link-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false });
  await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
  pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox` });
  const { migrate } = await import('../src/db.js'); await migrate(pool);
  const { buildApp } = await import('../src/app.js'); app = await buildApp(pool);
}, 120000);
afterAll(async () => { await app?.close(); await pool?.end(); await pgServer?.stop(); });

const post = async (url: string, body: unknown, token?: string) => {
  const r = await app.inject({ method: 'POST', url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, body: r.json() };
};
const at = () => new Date(Date.now() + Math.floor(Math.random() * 1000)).toISOString();
const ch = (table: string, data: Record<string, unknown>) => ({ table, id: String(data.id), updatedAt: at(), data: { ...data, updatedAt: undefined } });
const sync = async (token: string, changes: ReturnType<typeof ch>[] = []) => (await post('/v1/sync', { cursor: 0, changes }, token)).body;
const docsOf = async (tenant: string) => (await pool.query('SELECT tbl, data FROM docs WHERE tenant_id=$1', [tenant])).rows as { tbl: string; data: Record<string, unknown> }[];
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

describe('company link', () => {
  let co = { token: '', tenantId: '' }, dist = { token: '', tenantId: '' };
  it('a company signs up as a company, with a head-office login', async () => {
    const s = await post('/v1/signup', { firmName: 'Kaveri Consumer', ownerName: 'HO', phone: '9822200001', pin: '1234', kind: 'company' });
    expect(s.status).toBe(200); co = s.body;
    expect((await pool.query('SELECT kind FROM tenants WHERE id=$1', [co.tenantId])).rows[0].kind).toBe('company');
    expect((await pool.query('SELECT role FROM users WHERE tenant_id=$1', [co.tenantId])).rows[0].role).toBe('cadmin');
    const d = await post('/v1/signup', { firmName: 'Velan Agencies', ownerName: 'Velan', phone: '9822200002', pin: '1234' });
    dist = d.body;
  });

  it('the distributor accepts the invite; only the company\'s own brand crosses', async () => {
    // distributor: two brands, a shop with private details, bills and stock of both brands
    await sync(dist.token, [
      ch('companies', { id: 'cKAV', name: 'Kaveri', code: 'KAV', nextBillNo: 1 }), ch('companies', { id: 'cRIV', name: 'Rival Foods', code: 'RIV', nextBillNo: 1 }),
      ch('products', { id: 'd1', companyId: 'cKAV', name: 'Kaveri Gold Oil 500ml', code: 'KG500', rate: 95, active: true }),
      ch('products', { id: 'd2', companyId: 'cRIV', name: 'Rival Oil 500ml', code: 'RV500', rate: 80, active: true }),
      ch('shops', { id: 's1', name: 'Murugan Stores', area: 'Pennadam', beat: 'Monday', phone: '9443000001', owner: 'Murugan', gstin: '33AAAAA0000A1Z5', creditLimit: 50000, approved: true, aliases: [] }),
      ch('batches', { id: 'b1', productId: 'd1', qty: 40, expiry: '2027-06-01' }), ch('batches', { id: 'b2', productId: 'd2', qty: 77, expiry: '2027-06-01' }),
      ch('invoices', { id: 'i1', companyId: 'cKAV', number: 'VA/1', date: today, shopId: 's1', lines: [{ productId: 'd1', name: 'Kaveri Gold Oil 500ml', qty: 2, rate: 95, taxable: 190, total: 199.5 }], total: 200 }),
      ch('invoices', { id: 'i2', companyId: 'cRIV', number: 'VA/2', date: today, shopId: 's1', lines: [{ productId: 'd2', name: 'Rival Oil 500ml', qty: 9, rate: 80, taxable: 720, total: 756 }], total: 756 }),
      ch('payments', { id: 'p1', shopId: 's1', amount: 500, mode: 'cash', allocations: [] }),
    ]);
    // company: its catalogue and an invite
    await sync(co.token, [
      ch('products', { id: 'P1', name: 'Kaveri Gold Oil 500ml', code: 'KG500', rate: 90, mrp: 110, purchaseRate: 80, active: true }),
      ch('products', { id: 'P2', name: 'Kaveri Sambar Powder 100g', code: 'KS100', rate: 40, mrp: 50, purchaseRate: 34, active: true }),
      ch('dbLinks', { id: 'L1', name: 'Velan Agencies', inviteCode: 'KAV7Q2', status: 'invited' }),
    ]);
    expect((await post('/v1/link/preview', { code: 'kav7q2' }, dist.token)).body.company).toBe('Kaveri Consumer');
    const a = await post('/v1/link/accept', { code: 'KAV7Q2', companyIdInDb: 'cKAV' }, dist.token);
    expect(a.status).toBe(200);

    const cdocs = await docsOf(co.tenantId);
    const text = JSON.stringify(cdocs);
    expect(text).not.toContain('Rival');      // no rival product, bill, stock or line
    expect(text).not.toContain('9443000001'); // no shop phone
    expect(text).not.toContain('33AAAAA0000A1Z5');
    expect(text).not.toContain('50000');      // no credit limit
    expect(cdocs.some(d => d.tbl === 'payments')).toBe(false);
    expect(cdocs.filter(d => d.tbl === 'secondary').map(d => d.data.number)).toEqual(['VA/1']);
    expect(cdocs.find(d => d.tbl === 'dbStock')?.data).toMatchObject({ productId: 'P1', qty: 40 });
    expect(cdocs.find(d => d.tbl === 'dbLinks')?.data.status).toBe('linked');
    // the distributor's own Kaveri product was tied to the company's (by code), the new one added
    const ddocs = await docsOf(dist.tenantId);
    expect(ddocs.find(d => d.tbl === 'products' && d.data.id === 'd1')?.data.companyProductId).toBe('P1');
    expect(ddocs.find(d => d.tbl === 'products' && d.data.id === 'P2')?.data.companyId).toBe('cKAV');
    // a second accept with the same code fails
    expect((await post('/v1/link/accept', { code: 'KAV7Q2' }, dist.token)).status).toBe(404);
  });

  it('new bills cross on sync; a rival bill does not; relay-only tables cannot be written by a phone', async () => {
    const r = await sync(dist.token, [
      ch('invoices', { id: 'i3', companyId: 'cKAV', number: 'VA/3', date: today, shopId: 's1', lines: [{ productId: 'd1', qty: 1, rate: 95, taxable: 95, total: 99.75 }], total: 100 }),
      ch('invoices', { id: 'i4', companyId: 'cRIV', number: 'VA/4', date: today, shopId: 's1', lines: [{ productId: 'd2', qty: 1, rate: 80, taxable: 80, total: 84 }], total: 84 }),
      ch('claimDecisions', { id: 'fake', claimId: 'x', status: 'approved', amount: 99999 }),
    ]);
    expect(r.rejected).toContain('claimDecisions|fake'); // a distributor cannot approve its own claim
    const sec = (await docsOf(co.tenantId)).filter(d => d.tbl === 'secondary').map(d => d.data.number).sort();
    expect(sec).toEqual(['VA/1', 'VA/3']);
    const forged = await sync(co.token, [ch('secondary', { id: 'forged', dbLinkId: 'L1', number: 'X', lines: [] })]);
    expect(forged.rejected).toContain('secondary|forged'); // a company cannot invent distributor sales
  });

  it('a company rep\'s order arrives at the distributor as a new order', async () => {
    await sync(co.token, [ch('orders', { id: 'fo1', dbLinkId: 'L1', shopId: 's1', date: today, repName: 'Arun', source: 'company', lines: [{ productId: 'P1', qty: 12, rate: 90 }], status: 'new', issues: [], invoiceIds: [] })]);
    const o = (await docsOf(dist.tenantId)).find(d => d.tbl === 'orders' && d.data.id === 'fo1')?.data;
    expect(o).toMatchObject({ status: 'new', source: 'company', shopId: 's1', lines: [{ productId: 'd1', qty: 12, rate: 90 }] }); // the company's price list (90) is the distributor's selling rate once linked
  });

  it('a company role can never be created inside a distributor', async () => {
    await sync(dist.token, [ch('staff', { id: 'u9', name: 'Fake HO', phone: '9822200009', role: 'cadmin', pin: '1111', active: true })]);
    expect((await pool.query('SELECT 1 FROM users WHERE phone=$1', ['9822200009'])).rowCount).toBe(0);
  });

  it('a claim reaches the company with its lines; an SO recommendation stays inside; the final decision comes back', async () => {
    await sync(dist.token, [
      ch('claimEntries', { id: 'e1', companyId: 'cKAV', month: today.slice(0, 7), kind: 'shortage', productId: 'd1', qty: 2, amount: 199.5, refNumber: 'KCP/1', irn: 'IRN1' }),
      ch('claimEntries', { id: 'e2', companyId: 'cRIV', month: today.slice(0, 7), kind: 'damage', productId: 'd2', qty: 9, amount: 999 }),
      ch('claims', { id: 'c1', companyId: 'cKAV', month: today.slice(0, 7), amount: 199.5, status: 'submitted', lineIds: ['e1'] }),
    ]);
    const dc = (await docsOf(co.tenantId)).find(d => d.tbl === 'dbClaims')!.data;
    expect(dc.lines).toEqual([expect.objectContaining({ id: 'e1', productId: 'P1', refNumber: 'KCP/1', irn: 'IRN1' })]);
    await sync(co.token, [ch('claimDecisions', { id: 'k1', dbLinkId: 'L1', claimId: 'c1', status: 'recommended', amount: 199.5, decidedBy: 'SO' })]);
    expect((await docsOf(dist.tenantId)).some(d => d.tbl === 'claimDecisions')).toBe(false);
    await sync(co.token, [ch('claimDecisions', { id: 'final:c1', dbLinkId: 'L1', claimId: 'c1', status: 'approved', amount: 199.5, creditNoteNo: 'KAV-CN/26/0001', decidedBy: 'HO' })]);
    expect((await docsOf(dist.tenantId)).find(d => d.tbl === 'claimDecisions')?.data).toMatchObject({ claimId: 'c1', status: 'approved', creditNoteNo: 'KAV-CN/26/0001' });
  });

  it('after the distributor leaves, nothing new crosses', async () => {
    expect((await post('/v1/link/leave', { linkId: 'L1' }, dist.token)).status).toBe(200);
    await sync(dist.token, [ch('invoices', { id: 'i5', companyId: 'cKAV', number: 'VA/5', date: today, shopId: 's1', lines: [{ productId: 'd1', qty: 1, rate: 95, taxable: 95, total: 99.75 }], total: 100 })]);
    const cdocs = await docsOf(co.tenantId);
    expect(cdocs.some(d => d.tbl === 'secondary' && d.data.number === 'VA/5')).toBe(false);
    expect(cdocs.find(d => d.tbl === 'dbLinks')?.data.status).toBe('left');
    await sync(co.token, [ch('products', { id: 'P3', name: 'Kaveri Rasam Powder', rate: 30, active: true })]);
    expect((await docsOf(dist.tenantId)).some(d => d.tbl === 'products' && d.data.id === 'P3')).toBe(false);
  });
});
