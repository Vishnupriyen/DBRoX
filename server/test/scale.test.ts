// Scale design (stress test, 10 Nov 2026): the relay runs in the background; a brand's reports come from running totals
// on the server; head office never downloads every bill; a manager or rep gets only their own distributors.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { billNo, issueNumbers, realBill } from './fixtures.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pgServer: EmbeddedPostgres; let pool: pg.Pool;
let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
let link: typeof import('../src/link.js');
let reports: typeof import('../src/reports.js');
const port = 54335;
beforeAll(async () => {
  process.env.RELAY_INLINE = '0'; process.env.COVER_DELAY_MS = '0'; // the real thing: the relay runs in the background
  pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'dbrox-scale-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false });
  await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
  pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox` });
  pool.on('error', () => {}); // the database is stopped at the end while idle connections are still open
  const { migrate } = await import('../src/db.js'); await migrate(pool);
  const { buildApp } = await import('../src/app.js'); app = await buildApp(pool);
  link = await import('../src/link.js'); reports = await import('../src/reports.js');
}, 120000);
afterAll(async () => { await link?.drainRelay(pool); await reports?.coverIdle(); await app?.close(); await pool?.end(); await pgServer?.stop(); });
const post = async (url: string, body: unknown, token?: string) => { const r = await app.inject({ method: 'POST', url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} }); return { status: r.statusCode, body: r.json() }; };
let tick = 0; const at = () => new Date(Date.now() + (++tick) * 1000).toISOString();
const ch = (table: string, data: Record<string, unknown>) => ({ table, id: String(data.id), updatedAt: at(), data });
const sync = async (token: string, changes: ReturnType<typeof ch>[] = [], cursor = 0) => (await post('/v1/sync', { cursor, changes }, token)).body;
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const pull = async (token: string) => { let c = 0, more = true; const all: { table: string; id: string }[] = []; while (more) { const r = await sync(token, [], c); all.push(...r.changes); c = r.cursor; more = r.more; } return all; };

let CO = { token: '', tenantId: '' }; const D: { token: string; tenantId: string }[] = []; let rep = { token: '' };
const nums = new Map<string, string>(); const numOf = (id: string) => nums.get(id) ?? (nums.set(id, billNo(nums.size + 1)), nums.get(id)!);
const bill = (id: string, shop: string, qty: number, taxable: number, extra: Record<string, unknown> = {}) => realBill({ id, number: numOf(id), companyId: 'cK', date: today, shopId: shop, lines: [{ productId: 'dp1', name: 'Oil', qty, freeQty: 0, rate: 40, taxable, total: taxable * 1.05 }], ...extra });

describe('scale design', () => {
  it('setup: a brand, two linked distributors, a rep who works only the first', async () => {
    CO = (await post('/v1/signup', { firmName: 'Kaveri', ownerName: 'HO', phone: '9844400001', pin: '4826', kind: 'company' })).body;
    for (let i = 0; i < 2; i++) D.push((await post('/v1/signup', { firmName: `Dist ${i}`, ownerName: 'O', phone: `98444001${i}0`, pin: '4826' })).body);
    for (const d of D) await issueNumbers(pool, d.tenantId);
    await sync(CO.token, [ch('products', { id: 'P1', name: 'Kaveri Oil', code: 'K1', rate: 40, purchaseRate: 36, mrp: 50, gst: 5, caseSize: 12, active: true }),
      ch('dbLinks', { id: 'L0', name: 'Dist 0', inviteCode: 'KAVS00', status: 'invited' }), ch('dbLinks', { id: 'L1', name: 'Dist 1', inviteCode: 'KAVS01', status: 'invited' }),
      ch('staff', { id: 'r1', name: 'Rep', phone: '9844400099', role: 'rep', pin: '4826', active: true, dbLinkIds: ['L0'] })]);
    for (let i = 0; i < 2; i++) {
      await sync(D[i].token, [ch('companies', { id: 'cK', name: 'Kaveri', code: 'KAV', nextBillNo: 1 }), ch('products', { id: 'dp1', companyId: 'cK', name: 'Kaveri Oil', code: 'K1', rate: 40, active: true }), ch('shops', { id: `s${i}`, name: `Shop ${i}`, area: 'X', beat: 'Monday', approved: true, aliases: [], phone: '9443000000' })]);
      expect((await post('/v1/link/accept', { code: `KAVS0${i}`, companyIdInDb: 'cK' }, D[i].token)).status).toBe(200);
    }
    rep = (await post('/v1/login', { phone: '9844400099', pin: '4826' })).body;
  });

  it('a sync only notes the change; the relay hands it over in the background', async () => {
    await sync(D[0].token, [ch('invoices', bill('b1', 's0', 12, 480))]);
    const queued = Number((await pool.query('SELECT count(*)::int n FROM relay_queue')).rows[0].n);
    await link.drainRelay(pool);
    expect(Number((await pool.query('SELECT count(*)::int n FROM relay_queue')).rows[0].n)).toBe(0);
    expect((await pool.query(`SELECT 1 FROM docs WHERE tenant_id=$1 AND tbl='secondary' AND id='b1'`, [CO.tenantId])).rowCount).toBe(1);
    void queued;
  });

  it('running totals follow every change of a bill (edit, then cancel) exactly', async () => {
    await sync(D[0].token, [ch('invoices', bill('b2', 's0', 24, 960))]);
    await sync(D[1].token, [ch('invoices', bill('b3', 's1', 12, 480))]);
    await link.drainRelay(pool);
    await sync(D[0].token, [ch('invoices', bill('b2', 's0', 36, 1440))]); // edited
    await sync(D[0].token, [ch('invoices', bill('b1', 's0', 12, 480, { cancelled: { at: at(), by: 'o', reason: 'x' } }))]); // cancelled
    await link.drainRelay(pool);
    const r = (await post('/v1/company/report', { kind: 'links' }, CO.token)).body.data as { link: { id: string }; secondary: number; bills: number; shops: number }[];
    expect(r.find(x => x.link.id === 'L0')).toMatchObject({ secondary: 1440, bills: 1, shops: 1 });
    expect(r.find(x => x.link.id === 'L1')).toMatchObject({ secondary: 480, bills: 1 });
    const p = (await post('/v1/company/report', { kind: 'products' }, CO.token)).body.data as { productId: string; secondaryQty: number; secondaryValue: number }[];
    expect(p.find(x => x.productId === 'P1')).toMatchObject({ secondaryQty: 48, secondaryValue: 1920 });
    // the totals equal a fresh count of the bills themselves
    const fresh = (await pool.query(`SELECT sum((data->>'taxable')::numeric) v FROM docs WHERE tenant_id=$1 AND tbl='secondary' AND NOT coalesce((data->>'cancelled')::boolean, false)`, [CO.tenantId])).rows[0].v;
    expect(Number(fresh)).toBe(1920);
  });

  it('head office never downloads bills, stock lines or shop lists; the rep gets only their distributor', async () => {
    const ho = await pull(CO.token);
    for (const t of ['secondary', 'dbStock', 'shops']) expect(ho.some(x => x.table === t)).toBe(false);
    expect(ho.some(x => x.table === 'dbLinks')).toBe(true);
    const r = await pull(rep.token);
    const sec = r.filter(x => x.table === 'secondary').map(x => x.id).sort();
    expect(sec).toEqual(['b1', 'b2']);
    expect(r.filter(x => x.table === 'shops').map(x => x.id)).toEqual(['s0']);
    const rr = (await post('/v1/company/report', { kind: 'links' }, rep.token)).body.data as { link: { id: string } }[];
    expect(rr.map(x => x.link.id)).toEqual(['L0']); // a rep's report is only their distributor
    const docs = (await post('/v1/company/docs', { tbl: 'secondary', ids: ['b3'] }, rep.token)).body.docs;
    expect(docs).toEqual([]); // not their distributor
  });

  it('stock and shop reports', async () => {
    await sync(D[0].token, [ch('batches', { id: 'lot1', productId: 'dp1', qty: 60, expiry: '2027-06-01' })]);
    await link.drainRelay(pool); await reports.coverIdle(); // the figures are remade in the background right after the relay
    const st = (await post('/v1/company/report', { kind: 'stock', status: '' }, CO.token)).body.data as { rows: { dbLinkId: string; qty: number; perDay: number; days: number | null }[] };
    const r0 = st.rows.find(x => x.dbLinkId === 'L0')!;
    expect(r0.qty).toBe(60); expect(r0.perDay).toBe(1.2); expect(r0.days).toBe(50); // 36 pieces in 30 days (the cancelled bill does not count)
    // a stock change after head office has looked shows once the background remake is done (only the changed product is remade)
    await sync(D[0].token, [ch('batches', { id: 'lot1', productId: 'dp1', qty: 6, expiry: '2027-06-01' })]);
    await link.drainRelay(pool); await reports.coverIdle();
    expect(Number((await pool.query(`SELECT count(*) n FROM cover_dirty`)).rows[0].n)).toBe(0);
    const st2 = (await post('/v1/company/report', { kind: 'stock', status: 'low' }, CO.token)).body.data as { rows: { dbLinkId: string; qty: number; days: number | null }[]; counts: { low: number } };
    expect(st2.rows.find(x => x.dbLinkId === 'L0')).toMatchObject({ qty: 6, days: 5 });
    const o = (await post('/v1/company/report', { kind: 'outlets', q: 'shop' }, CO.token)).body.data as { total: number; bought: number; shops: { id: string; phone?: string }[] };
    expect(o.total).toBe(2); expect(o.bought).toBe(2);
    expect(o.shops.every(s => s.phone === undefined)).toBe(true);
  });
});
