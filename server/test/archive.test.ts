// Archive (10 Nov 2026): old records move out of the live table into compressed month bundles. Nothing is lost:
// a new phone fetches them, a claim on an old bill still finds it, and an old bill edited later comes back to life.
import { CONSENT } from './fixtures.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { billNo, freePort, issueNumbers, realBill } from './fixtures.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pgServer: EmbeddedPostgres; let pool: pg.Pool;
let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
let link: typeof import('../src/link.js');
let ar: typeof import('../src/archive.js');
const port = await freePort();
beforeAll(async () => {
  process.env.RELAY_INLINE = '1'; process.env.COVER_DELAY_MS = '0';
  pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'dbrox-archive-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false });
  await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
  pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox` });
  pool.on('error', () => {});
  const { migrate } = await import('../src/db.js'); await migrate(pool);
  const { buildApp } = await import('../src/app.js'); app = await buildApp(pool);
  link = await import('../src/link.js'); ar = await import('../src/archive.js');
}, 120000);
afterAll(async () => { await link?.drainRelay(pool); const r = await import('../src/reports.js'); await r.coverIdle(); await app?.close(); await pool?.end(); await pgServer?.stop(); });
const post = async (url: string, body: unknown, token?: string) => { const r = await app.inject({ method: 'POST', url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} }); return { status: r.statusCode, body: r.json() }; };
let tick = 0; const at = () => new Date(Date.now() + (++tick) * 1000).toISOString();
const ch = (table: string, data: Record<string, unknown>) => ({ table, id: String(data.id), updatedAt: at(), data });
const sync = async (token: string, changes: ReturnType<typeof ch>[] = [], cursor = 0) => (await post('/v1/sync', { cursor, changes }, token)).body;
const pull = async (token: string) => { let c = 0, more = true; const all: { table: string; id: string; data: Record<string, unknown> }[] = []; while (more) { const r = await sync(token, [], c); all.push(...r.changes); c = r.cursor; more = r.more; } return all; };
const ist = (daysBack: number) => new Date(Date.now() + 5.5 * 3600e3 - daysBack * 86400e3).toISOString().slice(0, 10);
const today = ist(0);
const nums = new Map<string, string>(); const numOf = (id: string) => nums.get(id) ?? (nums.set(id, billNo(nums.size + 1)), nums.get(id)!);
const bill = (id: string, date: string, taxable: number, extra: Record<string, unknown> = {}) => realBill({ id, number: numOf(id), companyId: 'cK', date, shopId: 's1', kind: 'B2B', deliveryStatus: 'delivered',
  lines: [{ productId: 'dp1', name: 'Oil', qty: 10, freeQty: 0, rate: 40, taxable, total: taxable * 1.05 }], ...extra });
const live = async (tenant: string, tbl: string) => (await pool.query(`SELECT id FROM docs WHERE tenant_id=$1 AND tbl=$2 ORDER BY id`, [tenant, tbl])).rows.map(r => r.id);

let D = { token: '', tenantId: '' }, S = { token: '' }, CO = { token: '', tenantId: '' };
// last financial year starts at most 24 months back: bills 30 months old move, a bill 10 days old stays
const old1 = ist(30 * 30), old2 = old1.slice(0, 8) + (old1.slice(8) === '28' ? '27' : '28'), keep = ist(10);

describe('archive', () => {
  it('the cut-off is the start of last financial year', () => {
    expect(ar.lastFyStart('2026-11-10')).toBe('2025-04-01');
    expect(ar.lastFyStart('2027-03-31')).toBe('2025-04-01');
    expect(ar.lastFyStart('2027-04-01')).toBe('2026-04-01');
  });

  it('a distributor\'s old bills move to the archive; recent ones and master records stay live', async () => {
    D = (await post('/v1/signup', { consent: CONSENT, firmName: 'Sri Murugan', ownerName: 'O', phone: '9855500001', pin: '482613' })).body;
    await issueNumbers(pool, D.tenantId);
    await sync(D.token, [ch('companies', { id: 'cK', name: 'Kaveri', code: 'KAV', nextBillNo: 1 }), ch('products', { id: 'dp1', companyId: 'cK', name: 'Oil', rate: 40, purchaseRate: 36, active: true }),
      ch('shops', { id: 's1', name: 'Shop', area: 'X', beat: 'Mon', approved: true, aliases: [] }),
      ch('invoices', bill('i1', old1, 400)), ch('invoices', bill('i2', old2, 800)), ch('invoices', bill('i3', keep, 1200)),
      ch('payments', { id: 'p1', shopId: 's1', date: old1, amount: 420, mode: 'cash', status: 'ok' }),
      ch('purchases', { id: 'u1', companyId: 'cK', billNo: 'X1', date: old1, lines: [], total: 5000 }),
      ch('staff', { id: 'sm', name: 'Ravi', phone: '9855500002', role: 'salesman', pin: '7265', active: true })]);
    S = (await post('/v1/login', { phone: '9855500002', pin: '7265' })).body;
    const r = await ar.archiveTenant(pool, D.tenantId, 'distributor', today);
    expect(r).toBe(4); // i1, i2, p1, u1
    expect(await live(D.tenantId, 'invoices')).toEqual(['i3']);
    expect(await live(D.tenantId, 'products')).toEqual(['dp1']);
    expect(await ar.archiveTenant(pool, D.tenantId, 'distributor', today)).toBe(0); // running again moves nothing twice
    // stored compressed, never dropped
    const a = (await pool.query(`SELECT tbl, month, n, bytes FROM docs_archive WHERE tenant_id=$1 ORDER BY tbl`, [D.tenantId])).rows;
    expect(a.map(x => `${x.tbl}:${x.month}:${x.n}`)).toEqual([`invoices:${old1.slice(0, 7)}:2`, `payments:${old1.slice(0, 7)}:1`, `purchases:${old1.slice(0, 7)}:1`]);
  });

  it('a new phone gets the live records by sync, and the old ones from the archive (only the tables its role may read)', async () => {
    const got = await pull(D.token);
    expect(got.filter(x => x.table === 'invoices').map(x => x.id)).toEqual(['i3']);
    const m = (await post('/v1/archive/list', {}, D.token)).body.months as { tbl: string; month: string; n: number }[];
    expect(m.map(x => x.tbl).sort()).toEqual(['invoices', 'payments', 'purchases']);
    const inv = (await post('/v1/archive/month', { tbl: 'invoices', month: old1.slice(0, 7) }, D.token)).body.changes as { id: string; data: { total: number } }[];
    expect(inv.map(x => x.id).sort()).toEqual(['i1', 'i2']);
    expect(inv.find(x => x.id === 'i2')!.data.total).toBe(840);
    // the salesman cannot read purchases at all, so the archive does not offer them either
    const sm = (await post('/v1/archive/list', {}, S.token)).body.months as { tbl: string }[];
    expect(sm.map(x => x.tbl).sort()).toEqual(['invoices', 'payments']);
    expect((await post('/v1/archive/month', { tbl: 'purchases', month: old1.slice(0, 7) }, S.token)).status).toBe(403);
  });

  it('an old bill edited later comes back to life; the archive no longer hands out the stale copy', async () => {
    await sync(D.token, [ch('invoices', bill('i1', old1, 400, { cancelled: { at: at(), by: 'o', reason: 'wrong shop' } }))]);
    expect(await live(D.tenantId, 'invoices')).toEqual(['i1', 'i3']);
    const inv = (await post('/v1/archive/month', { tbl: 'invoices', month: old1.slice(0, 7) }, D.token)).body.changes as { id: string }[];
    expect(inv.map(x => x.id)).toEqual(['i2']);
    // moved again: the newest copy is the one kept, the old bundle's copy is never served
    await ar.archiveTenant(pool, D.tenantId, 'distributor', today);
    const again = (await post('/v1/archive/month', { tbl: 'invoices', month: old1.slice(0, 7) }, D.token)).body.changes as { id: string; data: { cancelled?: unknown } }[];
    expect(again.map(x => x.id).sort()).toEqual(['i1', 'i2']);
    expect(again.find(x => x.id === 'i1')!.data.cancelled).toBeTruthy();
  });

  it('a brand keeps distributor bills live 120 days; a claim on an older bill still finds it; a late cancel fixes the totals', async () => {
    CO = (await post('/v1/signup', { consent: CONSENT, firmName: 'Kaveri', ownerName: 'HO', phone: '9855500009', pin: '482613', kind: 'company' })).body;
    await sync(CO.token, [ch('products', { id: 'P1', name: 'Kaveri Oil', code: 'K1', rate: 40, purchaseRate: 36, mrp: 50, gst: 5, caseSize: 12, active: true }),
      ch('dbLinks', { id: 'L0', name: 'Sri Murugan', inviteCode: 'KAVA00', status: 'invited' })]);
    expect((await post('/v1/link/accept', { code: 'KAVA00', companyIdInDb: 'cK' }, D.token)).status).toBe(200);
    const oldDay = ist(130), month = oldDay.slice(0, 7);
    await sync(D.token, [ch('invoices', bill('k1', oldDay, 500)), ch('invoices', bill('k2', ist(5), 700))]);
    await link.drainRelay(pool);
    const before = Number((await pool.query(`SELECT coalesce(sum(value), 0) v FROM roll_link_month WHERE tenant_id=$1 AND month=$2`, [CO.tenantId, month])).rows[0].v);
    expect(before).toBe(500);
    expect(await ar.archiveTenant(pool, CO.tenantId, 'company', today)).toBe(1);
    expect(await live(CO.tenantId, 'secondary')).toEqual(['i3', 'k2']); // i3 came across when the link was made
    const docs = (await post('/v1/company/docs', { tbl: 'secondary', ids: ['k1', 'k2'] }, CO.token)).body.docs as { id: string }[];
    expect(docs.map(d => d.id).sort()).toEqual(['k1', 'k2']);
    // the distributor cancels that old bill now: the brand's totals lose it exactly once
    await sync(D.token, [ch('invoices', bill('k1', oldDay, 500, { cancelled: { at: at(), by: 'o', reason: 'x' } }))]);
    await link.drainRelay(pool);
    const after = Number((await pool.query(`SELECT coalesce(sum(value), 0) v FROM roll_link_month WHERE tenant_id=$1 AND month=$2`, [CO.tenantId, month])).rows[0].v);
    expect(after).toBe(0);
  });

  it('the daily job runs for every business and is guarded by the cron key', async () => {
    expect((await post('/v1/cron/archive', {})).status).toBe(403);
  });
});
