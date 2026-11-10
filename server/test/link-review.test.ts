// Regression tests for the independent code review of the company module (10 Nov 2026). Each failed before its fix.
process.env.RELAY_INLINE = '1'; // these tests check what crosses, so the relay runs inside each sync (production runs it in the background)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pgServer: EmbeddedPostgres;
let pool: pg.Pool;
let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
const port = 54333;
beforeAll(async () => {
  pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'dbrox-review-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false });
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
let tick = 0;
const at = () => new Date(Date.now() + (++tick) * 1000).toISOString();
const ch = (table: string, data: Record<string, unknown>, updatedAt = at()) => ({ table, id: String(data.id), updatedAt, data });
const sync = async (token: string, changes: ReturnType<typeof ch>[] = []) => (await post('/v1/sync', { cursor: 0, changes }, token)).body;
const doc = async (tenant: string, tbl: string, id: string) => (await pool.query('SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND id=$3', [tenant, tbl, id])).rows[0]?.data;
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const login = async (phone: string) => (await post('/v1/login', { phone, pin: '1234' })).body as { token: string; tenantId: string; userId: string };

let A = { token: '', tenantId: '' }, B = { token: '', tenantId: '' }, D = { token: '', tenantId: '' };
let mgr = { token: '', userId: '' }, rep = { token: '', userId: '' };
describe('setup', () => {
  it('two companies, one distributor, a manager and a rep', async () => {
    A = (await post('/v1/signup', { firmName: 'Alpha Foods', ownerName: 'HO', phone: '9833300001', pin: '1234', kind: 'company' })).body;
    B = (await post('/v1/signup', { firmName: 'Beta Snacks', ownerName: 'HO', phone: '9833300002', pin: '1234', kind: 'company' })).body;
    D = (await post('/v1/signup', { firmName: 'Durai Agencies', ownerName: 'D', phone: '9833300003', pin: '1234', gstin: '33DURAI0000A1Z5' })).body;
    await sync(A.token, [
      ch('staff', { id: 'm1', name: 'Mani (ASM)', phone: '9833300011', role: 'manager', level: 'ASM', pin: '1234', active: true }),
      ch('staff', { id: 'r1', name: 'Ravi (Rep)', phone: '9833300012', role: 'rep', managerId: 'm1', pin: '1234', active: true }),
      ch('products', { id: 'AP1', name: 'Alpha Oil 1L', code: 'AO1', rate: 100, purchaseRate: 90, mrp: 120, gst: 5, caseSize: 12, active: true }),
      ch('dbLinks', { id: 'LA', name: 'Durai Agencies', inviteCode: 'ALPHA1', status: 'invited' }),
    ]);
    mgr = await login('9833300011'); rep = await login('9833300012');
    await sync(D.token, [ch('companies', { id: 'cA', name: 'Alpha Foods', code: 'ALP', nextBillNo: 1 }), ch('companies', { id: 'cB', name: 'Beta Snacks', code: 'BET', nextBillNo: 1 })]);
    expect((await post('/v1/link/accept', { code: 'ALPHA1', companyIdInDb: 'cA' }, D.token)).status).toBe(200);
  });
});

describe('review 1: a link can never be tied to another company\'s record', () => {
  it('after leaving Alpha, Beta cannot be linked onto Alpha\'s record', async () => {
    await post('/v1/link/leave', { linkId: 'LA' }, D.token);
    await sync(B.token, [ch('dbLinks', { id: 'LB', name: 'Durai Agencies', inviteCode: 'BETA22', status: 'invited' })]);
    const r = await post('/v1/link/accept', { code: 'BETA22', companyIdInDb: 'cA' }, D.token);
    expect(r.status).toBe(409);
    expect((await post('/v1/link/accept', { code: 'BETA22', companyIdInDb: 'cB' }, D.token)).status).toBe(200);
    // Alpha comes back later: its own record again
    await sync(A.token, [ch('dbLinks', { id: 'LA2', name: 'Durai Agencies', inviteCode: 'ALPHA2', status: 'invited' })]);
    expect((await post('/v1/link/accept', { code: 'ALPHA2', companyIdInDb: 'cB' }, D.token)).status).toBe(409);
    expect((await post('/v1/link/accept', { code: 'ALPHA2', companyIdInDb: 'cA' }, D.token)).status).toBe(200);
  });
  it('the distributor\'s GSTIN is recorded on the company\'s side (invoices match on it)', async () => {
    expect((await doc(A.tenantId, 'dbLinks', 'LA2')).gstin).toBe('33DURAI0000A1Z5');
  });
  it('guessing invite codes is stopped after 10 wrong tries', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await post('/v1/link/preview', { code: `ZZZZ${String(i).padStart(2, '0')}` }, D.token)).status;
    expect(last).toBe(429);
  });
});

describe('review 3 & 6: the server decides who may approve', () => {
  it('a manager cannot send a final claim decision; head office can, once', async () => {
    const m = await sync(mgr.token, [ch('claimDecisions', { id: 'final:c9', dbLinkId: 'LA2', claimId: 'c9', status: 'approved', amount: 999, decidedBy: 'Mani' })]);
    expect(m.rejected).toContain('claimDecisions|final:c9');
    const okRec = await sync(mgr.token, [ch('claimDecisions', { id: 'rec:c9', dbLinkId: 'LA2', claimId: 'c9', status: 'recommended', amount: 100, decidedBy: 'Mani' })]);
    expect(okRec.accepted).toContain('claimDecisions|rec:c9');
    const first = await sync(A.token, [ch('claimDecisions', { id: 'final:c9', dbLinkId: 'LA2', claimId: 'c9', status: 'approved', amount: 100, decidedBy: 'HO' })]);
    expect(first.accepted).toContain('claimDecisions|final:c9');
    const second = await sync(A.token, [ch('claimDecisions', { id: 'final:c9', dbLinkId: 'LA2', claimId: 'c9', status: 'rejected', amount: 0, decidedBy: 'HO2' })]);
    expect(second.rejected).toContain('claimDecisions|final:c9');
    expect((await doc(A.tenantId, 'claimDecisions', 'final:c9')).status).toBe('approved');
  });
  it('head office gets credit-note numbers from the server (no two phones share one)', async () => {
    const a = await post('/v1/number', { kind: 'cn' }, A.token), b = await post('/v1/number', { kind: 'cn' }, A.token);
    expect(a.status).toBe(200); expect(b.body.first).toBe(a.body.first + 1);
    expect((await post('/v1/number', { kind: 'bill' }, A.token)).status).toBe(403);
  });
  it('a rep cannot approve their own travel claim or expense; a manager can approve others but not their own', async () => {
    const r = await sync(rep.token, [
      ch('travelClaims', { id: 't1', staffId: rep.userId, month: today.slice(0, 7), total: 99999, status: 'approved', flags: [] }),
      ch('expenses', { id: 'x1', by: rep.userId, date: today, category: 'Food', amount: 100, status: 'approved' }),
      ch('travelClaims', { id: 't2', staffId: rep.userId, month: today.slice(0, 7), total: 500, status: 'waiting', flags: [] }),
      ch('expenses', { id: 'x2', by: rep.userId, date: today, category: 'Food', amount: 100, status: 'waiting' }),
    ]);
    expect(r.rejected).toEqual(expect.arrayContaining(['travelClaims|t1', 'expenses|x1']));
    expect(r.accepted).toEqual(expect.arrayContaining(['travelClaims|t2', 'expenses|x2']));
    const m = await sync(mgr.token, [ch('travelClaims', { id: 't2', staffId: rep.userId, month: today.slice(0, 7), total: 500, status: 'approved', flags: [] }), ch('travelClaims', { id: 't3', staffId: mgr.userId, month: today.slice(0, 7), total: 1, status: 'approved', flags: [] })]);
    expect(m.accepted).toContain('travelClaims|t2');
    expect(m.rejected).toContain('travelClaims|t3');
    const back = await sync(rep.token, [ch('travelClaims', { id: 't2', staffId: rep.userId, month: today.slice(0, 7), total: 90000, status: 'waiting', flags: [] })]);
    expect(back.rejected).toContain('travelClaims|t2'); // a decided claim cannot be changed by its owner
  });
});

describe('review 4: the company never overwrites what the distributor owns', () => {
  it('the receipt is the distributor\'s own record: a later company edit of the bill never makes it "not received"', async () => {
    await sync(A.token, [ch('primaryInvoices', { id: 'pi1', dbLinkId: 'LA2', number: 'ALP/1', date: today, lines: [{ productId: 'AP1', name: 'Alpha Oil 1L', qty: 24, rate: 90, gst: 5, taxable: 2160, tax: 108 }], taxable: 2160, tax: 108, total: 2268, source: 'excel' })]);
    const d1 = await sync(D.token, [ch('inbound', { id: 'pi1', status: 'received' })]);
    expect(d1.rejected).toContain('inbound|pi1'); // the company's bill is not the distributor's to change
    await sync(D.token, [ch('receipts', { id: 'pi1', inboundId: 'pi1', companyId: 'cA', status: 'disputed', receivedAt: at(), short: [{ productId: 'AP1', qty: 2 }], damaged: [] })]);
    await sync(A.token, [ch('primaryInvoices', { id: 'pi1', dbLinkId: 'LA2', number: 'ALP/1', date: today, lines: [{ productId: 'AP1', name: 'Alpha Oil 1L', qty: 24, rate: 90, gst: 5, taxable: 2160, tax: 108 }], taxable: 2160, tax: 108, total: 2268, source: 'excel', cancelled: true })]);
    expect((await doc(D.tenantId, 'receipts', 'pi1')).status).toBe('disputed');
    expect((await doc(D.tenantId, 'inbound', 'pi1')).cancelled).toBe(true);
    expect((await doc(A.tenantId, 'grns', 'pi1'))).toMatchObject({ status: 'disputed', short: [{ productId: 'AP1', qty: 2 }] });
  });
  it('a distributor edit of a linked product keeps the company\'s prices and the distributor\'s own names', async () => {
    const p = await doc(D.tenantId, 'products', 'AP1');
    await sync(D.token, [ch('products', { ...p, rate: 1, mrp: 2, aliases: ['alpha', 'oil'] })]);
    expect(await doc(D.tenantId, 'products', 'AP1')).toMatchObject({ rate: 100, mrp: 120, aliases: ['alpha', 'oil'] });
  });
  it('a company price change does not wipe a distributor\'s unsynced alias (the time is kept, so the newer edit wins)', async () => {
    const before = await doc(D.tenantId, 'products', 'AP1');
    await sync(A.token, [ch('products', { id: 'AP1', name: 'Alpha Oil 1L', code: 'AO1', rate: 105, purchaseRate: 92, mrp: 125, gst: 5, caseSize: 12, active: true })]);
    const after = await doc(D.tenantId, 'products', 'AP1');
    expect(after.rate).toBe(105);
    expect(after.updatedAt).toBe(before.updatedAt);
  });
  it('a bill can be received on one phone only (two phones offline)', async () => {
    expect((await post('/v1/receipt/claim', { inboundId: 'pi1' }, D.token)).status).toBe(200);
    expect((await post('/v1/receipt/claim', { inboundId: 'pi1' }, D.token)).status).toBe(409);
  });
});

describe('review 7 and others', () => {
  it('the first exchange can be run again (re-sync) and fills what is missing', async () => {
    await pool.query(`DELETE FROM docs WHERE tenant_id=$1 AND tbl='products' AND id='AP1'`, [D.tenantId]);
    expect((await post('/v1/link/resync', { linkId: 'LA2' }, D.token)).status).toBe(200);
    expect(await doc(D.tenantId, 'products', 'AP1')).toBeTruthy();
  });
  it('an impossible company scheme (90% off, or ending before it starts) never reaches a distributor', async () => {
    await sync(A.token, [ch('schemes', { id: 'sx', productId: 'AP1', name: 'Crazy', type: 'pct', value: 90, from: today, to: today, source: 'company' }), ch('schemes', { id: 'sy', name: 'Backwards', type: 'pct', value: 5, from: '2026-12-31', to: '2026-01-01', source: 'company' })]);
    expect(await doc(D.tenantId, 'schemes', 'sx')).toBeUndefined();
    expect(await doc(D.tenantId, 'schemes', 'sy')).toBeUndefined();
  });
});
