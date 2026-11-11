// Pre-pilot round 3 (11 Nov 2026): the server's own word on the round-2 money rules, staff requests, collection
// receipts and staff privacy. Each block failed before its server change (regression tests written first).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { freePort } from './fixtures.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pgServer: EmbeddedPostgres;
let pool: pg.Pool;
type App = Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
let app: App;
const port = await freePort();

beforeAll(async () => {
  pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'hanubix-pg-r3-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false });
  await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
  pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox` });
  pool.on('error', () => {});
  const { migrate } = await import('../src/db.js'); await migrate(pool);
  const { buildApp } = await import('../src/app.js'); app = await buildApp(pool);
}, 120000);
afterAll(async () => { await app?.close(); await pool?.end(); await pgServer?.stop(); });

let ipNo = 0;
const freshIp = () => `10.3.${Math.floor(++ipNo / 250)}.${ipNo % 250 + 1}`;
const post = async (url: string, body: unknown, token?: string, ip = '10.8.8.8') => {
  const r = await app.inject({ method: 'POST', url, payload: body as object, headers: { 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  let b; try { b = r.json(); } catch { b = r.body; }
  return { status: r.statusCode, body: b };
};
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
type Ch = { table: string; id: string; updatedAt: string; data: Record<string, unknown> };
const sync = (t: string, changes: Ch[] = [], cursor = 0) => post('/v1/sync', { cursor, changes }, t);
const ch = (table: string, id: string, data: Record<string, unknown>, ms = 0): Ch => ({ table, id, updatedAt: iso(ms), data: { id, ...data } });
const doc = async (tbl: string, id: string) => (await pool.query('SELECT data FROM docs WHERE tbl=$1 AND id=$2', [tbl, id])).rows[0]?.data;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fy = () => { const d = new Date(Date.now() + 330 * 60000); const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; };
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const line = (taxable: number, lots: unknown = [{ batchId: 'b1', batch: 'B1', qty: 1, expiry: '2027-12-31' }]) => { const tax = r2(taxable * 0.18); return { productId: 'p1', name: 'Soap', hsn: '3401', qty: 1, freeQty: 0, rate: taxable, mrp: taxable, gross: taxable, discount: 0, taxable, gst: 18, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), igst: 0, total: r2(taxable + tax), batches: lots, schemeNames: [] }; };
const bill = (number: string, taxables: number[], extra: Record<string, unknown> = {}, lots?: unknown) => {
  const lines = taxables.map(t => line(t, lots));
  const taxable = r2(lines.reduce((a, l) => a + l.taxable, 0)), cgst = r2(lines.reduce((a, l) => a + l.cgst, 0)), sgst = r2(lines.reduce((a, l) => a + l.sgst, 0));
  const exact = r2(taxable + cgst + sgst), total = Math.round(exact);
  return { number, companyId: 'c1', shopId: 's1', date: today(), kind: 'B2C', lines, taxable, cgst, sgst, igst: 0, roundOff: r2(total - exact), total, schemeSaving: 0, deliveryStatus: 'pending', ...extra };
};
const num = async (token: string, kind: 'bill' | 'cn' | 'receipt', prefix?: string) => {
  const r = await post('/v1/number', { kind }, token); expect(r.status, JSON.stringify(r.body)).toBe(200);
  return `${prefix ?? (kind === 'bill' ? r.body.prefix : kind === 'cn' ? 'CN' : 'R')}/${fy()}/${String(r.body.first).padStart(5, '0')}`;
};
const cn = (number: string, invoiceId: string, total: number) => ({ number, invoiceId, shopId: 's1', companyId: 'c1', date: today(), reason: 'Return', lines: [{ productId: 'p1', line: 0, qty: 1, amount: total, restock: true }], total });

const T = { owner: '', office: '', salesman: '', salesman2: '', godown: '', delivery: '', delivery2: '' };
const ID = { salesman: 'st-salesman', salesman2: 'st-salesman2', delivery: 'st-delivery', delivery2: 'st-delivery2', godown: 'st-godown' };
const pins: Record<string, string> = { office: '6831', salesman: '2958', salesman2: '3069', godown: '7416', delivery: '5072', delivery2: '5183' };
beforeAll(async () => {
  const s = await post('/v1/signup', { firmName: 'Round Three Agencies', ownerName: 'Owner', phone: '9710000001', pin: '4826' });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  T.owner = s.body.token;
  const people = [['office', 'office'], ['salesman', 'salesman'], ['salesman2', 'salesman'], ['godown', 'godown'], ['delivery', 'delivery'], ['delivery2', 'delivery']] as const;
  const r = await sync(T.owner, people.map(([k, role], i) => ch('staff', `st-${k}`, { name: k, phone: `971000002${i}`, role, pin: pins[k], active: true })));
  expect(r.body.rejected).toEqual([]);
  for (const [i, [k]] of people.entries()) {
    const l = await post('/v1/login', { phone: `971000002${i}`, pin: pins[k] }, undefined, freshIp());
    expect(l.status, k).toBe(200); T[k] = l.body.token;
  }
}, 60000);

describe('3. round-2 money rules, held by the server too', () => {
  it('a credit note is never more than its bill charged minus earlier notes — owner and office included', async () => {
    const b = bill(await num(T.owner, 'bill'), [100, 200]); // 354
    expect((await sync(T.owner, [ch('invoices', 'r3-i1', b)])).body.rejected).toEqual([]);
    const over = await sync(T.office, [ch('creditNotes', 'r3-cn-over', cn(await num(T.office, 'cn'), 'r3-i1', 355))]);
    expect(over.body.rejected).toEqual(['creditNotes|r3-cn-over']);
    expect((await sync(T.owner, [ch('creditNotes', 'r3-cn1', cn(await num(T.owner, 'cn'), 'r3-i1', 200))])).body.rejected).toEqual([]);
    // the second note would take the bill past what it charged (200 + 155 > 354)
    expect((await sync(T.owner, [ch('creditNotes', 'r3-cn2', cn(await num(T.owner, 'cn'), 'r3-i1', 155))])).body.rejected).toEqual(['creditNotes|r3-cn2']);
    // two notes in one push are added together
    const a = ch('creditNotes', 'r3-cn3', cn(await num(T.owner, 'cn'), 'r3-i1', 100)), c = ch('creditNotes', 'r3-cn4', cn(await num(T.owner, 'cn'), 'r3-i1', 100));
    expect((await sync(T.owner, [a, c])).body.rejected).toEqual(['creditNotes|r3-cn4']);
    // exactly what is left is fine; a note for a bill that is not there is refused
    expect((await sync(T.owner, [ch('creditNotes', 'r3-cn5', cn(await num(T.owner, 'cn'), 'r3-i1', 54))])).body.rejected).toEqual([]);
    expect((await sync(T.owner, [ch('creditNotes', 'r3-cn6', cn(await num(T.owner, 'cn'), 'no-such-bill', 1))])).body.rejected).toEqual(['creditNotes|r3-cn6']);
  });

  it('money fields must be real numbers — text or a missing amount is refused, for the owner too', async () => {
    const r = await sync(T.owner, [
      ch('payments', 'r3-p-text', { shopId: 's1', amount: '500', mode: 'cash', date: today(), collectedBy: 'x', allocations: [], advance: 0, settled: true, status: 'ok' }),
      ch('purchases', 'r3-pu-nan', { companyId: 'c1', billNo: 'NAN1', date: today(), lines: [], taxable: 0, tax: 0, total: null }),
      ch('claimEntries', 'r3-ce-text', { companyId: 'c1', month: '2026-11', kind: 'damage', qty: 1, amount: 'NaN' }),
      ch('expenses', 'r3-ex-line', { date: today(), category: 'fuel', amount: 100, lines: [{ amount: 'abc' }] }),
      ch('payments', 'r3-p-ok', { shopId: 's1', amount: 500, mode: 'cash', date: today(), collectedBy: 'x', allocations: [], advance: 500, settled: true, status: 'ok' }),
    ]);
    expect(r.body.rejected.sort()).toEqual(['claimEntries|r3-ce-text', 'expenses|r3-ex-line', 'payments|r3-p-text', 'purchases|r3-pu-nan']);
    expect(await doc('payments', 'r3-p-ok')).toBeTruthy();
  });

  it('the same company bill number is never entered twice for one company (another company may use it)', async () => {
    const pu = (companyId: string, billNo: string) => ({ companyId, billNo, date: today(), lines: [], taxable: 100, tax: 18, total: 118, source: 'typed' });
    expect((await sync(T.owner, [ch('purchases', 'r3-pu1', pu('c1', 'HUL/123'))])).body.rejected).toEqual([]);
    expect((await sync(T.godown, [ch('purchases', 'r3-pu2', pu('c1', ' hul/123 '))])).body.rejected).toEqual(['purchases|r3-pu2']);
    expect((await sync(T.owner, [ch('purchases', 'r3-pu3', pu('c2', 'HUL/123'))])).body.rejected).toEqual([]);
    // twice in one push
    expect((await sync(T.owner, [ch('purchases', 'r3-pu4', pu('c1', 'X9')), ch('purchases', 'r3-pu5', pu('c1', 'X9'))])).body.rejected).toEqual(['purchases|r3-pu5']);
    // the same bill saved again (an edit) is fine
    expect((await sync(T.owner, [ch('purchases', 'r3-pu1', { ...pu('c1', 'HUL/123'), paid: 50 }, 1000)])).body.rejected).toEqual([]);
  });

  it('every bill line carries its stock lots (one rule with the app): a line without lots is refused', async () => {
    const r = await sync(T.owner, [ch('invoices', 'r3-i-nolots', bill(await num(T.owner, 'bill'), [100], {}, undefined as never))]);
    expect(r.body.rejected).toEqual([]);
    const bad = await sync(T.owner, [ch('invoices', 'r3-i-nolots2', { ...bill(await num(T.owner, 'bill'), [100]), lines: [{ ...line(100), batches: undefined }] })]);
    expect(bad.body.rejected).toEqual(['invoices|r3-i-nolots2']);
    const half = await sync(T.owner, [ch('invoices', 'r3-i-nolots3', { ...bill(await num(T.owner, 'bill'), [100]), lines: [{ ...line(100), batches: [{ batch: 'B1', qty: 1 }] }] })]);
    expect(half.body.rejected).toEqual(['invoices|r3-i-nolots3']);
  });
});

describe('2/12. staff returns and write-offs are requests: only the owner or office decides them', () => {
  const req = (by: string, extra: Record<string, unknown> = {}) => ({ kind: 'return', by, role: 'salesman', date: today(), status: 'waiting', reason: 'Expired', value: 120, shopId: 's1', rows: [{ invoiceId: 'r3-i1', productId: 'p1', qty: 1, restock: 'yes' }], ...extra });
  it('a salesman saves a waiting request in their own name; not approved, not in another name', async () => {
    expect((await sync(T.salesman, [ch('requests', 'rq1', req(ID.salesman))])).body.rejected).toEqual([]);
    const r = await sync(T.salesman, [ch('requests', 'rq2', req(ID.salesman, { status: 'approved' })), ch('requests', 'rq3', req(ID.salesman2))]);
    expect(r.body.rejected.sort()).toEqual(['requests|rq2', 'requests|rq3']);
    // credit notes stay the owner's and office's
    expect((await sync(T.salesman, [ch('creditNotes', 'r3-cn-sm', cn(await num(T.owner, 'cn'), 'r3-i1', 1))])).body.rejected).toEqual(['creditNotes|r3-cn-sm']);
  });
  it('the owner approves; the salesman can never change a decided request', async () => {
    expect((await sync(T.owner, [ch('requests', 'rq1', { ...req(ID.salesman), status: 'approved', decidedBy: 'owner', result: 'CN/1' }, 1000)])).body.rejected).toEqual([]);
    expect((await sync(T.salesman, [ch('requests', 'rq1', { ...req(ID.salesman), status: 'waiting' }, 2000)])).body.rejected).toEqual(['requests|rq1']);
    expect((await doc('requests', 'rq1')).status).toBe('approved');
  });
  it('requests are read by the owner and office only', async () => {
    const pulled = async (t: string) => (await sync(t)).body.changes.filter((c: Ch) => c.table === 'requests').map((c: Ch) => c.id);
    expect(await pulled(T.office)).toContain('rq1');
    expect(await pulled(T.salesman2)).toEqual([]);
    expect(await pulled(T.godown)).toEqual([]);
  });
});

describe('6. collection receipts: numbered by the server, each number used once', () => {
  const pay = (id: string, receiptNo: string, collectedBy: string) => ch('payments', id, { shopId: 's1', amount: 100, mode: 'cash', date: today(), collectedBy, allocations: [], advance: 100, settled: false, status: 'ok', receiptNo });
  it('collectors get receipt numbers; an issued one is accepted once; a made-up or reused one is refused; a pending one waits', async () => {
    const r1 = await num(T.salesman, 'receipt');
    const r2n = await num(T.delivery, 'receipt');
    expect(r2n).not.toBe(r1);
    expect((await post('/v1/number', { kind: 'receipt' }, T.godown)).status).toBe(403);
    expect((await sync(T.salesman, [pay('rc1', r1, ID.salesman)])).body.rejected).toEqual([]);
    expect((await sync(T.delivery, [pay('rc2', r1, ID.delivery)])).body.rejected).toEqual(['payments|rc2']);
    expect((await sync(T.delivery, [pay('rc3', `R/${fy()}/99999`, ID.delivery)])).body.rejected).toEqual(['payments|rc3']);
    expect((await sync(T.delivery, [pay('rc4', `R/${fy()}/PENDING-ABC123`, ID.delivery)])).body.rejected).toEqual([]);
    expect((await sync(T.delivery, [pay('rc4', r2n, ID.delivery)].map(c => ({ ...c, updatedAt: iso(1000) })))).body.rejected).toEqual([]);
  });
});

describe('16. staff privacy: each person downloads only their own advances, leaves and expenses', () => {
  it('a salesman sees only his own advances and leaves; delivery sees only its own expenses', async () => {
    await sync(T.salesman, [ch('advances', 'adv-s1', { staffId: ID.salesman, amount: 1000, reason: 'x', status: 'waiting' }), ch('leaves', 'lv-s1', { staffId: ID.salesman, from: today(), to: today(), reason: 'x', status: 'waiting' })]);
    await sync(T.salesman2, [ch('advances', 'adv-s2', { staffId: ID.salesman2, amount: 2000, reason: 'y', status: 'waiting' }), ch('leaves', 'lv-s2', { staffId: ID.salesman2, from: today(), to: today(), reason: 'y', status: 'waiting' })]);
    await sync(T.delivery, [ch('expenses', 'ex-d1', { by: ID.delivery, date: today(), category: 'fuel', amount: 300 })]);
    await sync(T.delivery2, [ch('expenses', 'ex-d2', { by: ID.delivery2, date: today(), category: 'fuel', amount: 400 })]);
    const ids = async (t: string, tbl: string) => (await sync(t)).body.changes.filter((c: Ch) => c.table === tbl).map((c: Ch) => c.id).sort();
    expect(await ids(T.salesman, 'advances')).toEqual(['adv-s1']);
    expect(await ids(T.salesman, 'leaves')).toEqual(['lv-s1']);
    expect(await ids(T.salesman2, 'advances')).toEqual(['adv-s2']);
    expect(await ids(T.delivery, 'expenses')).toEqual(['ex-d1']);
    expect(await ids(T.delivery2, 'expenses')).toEqual(['ex-d2']);
    expect(await ids(T.owner, 'advances')).toEqual(expect.arrayContaining(['adv-s1', 'adv-s2']));
    // a refused write never hands back someone else's record either
    const r = await sync(T.salesman, [ch('advances', 'adv-s2', { staffId: ID.salesman2, amount: 1, reason: 'z', status: 'approved' }, 1000)]);
    expect(r.body.rejected).toEqual(['advances|adv-s2']);
    expect(r.body.current.map((c: Ch) => c.id)).not.toContain('adv-s2');
  });

  it('a company rep downloads only his own orders, expenses and travel claims', async () => {
    const s = await post('/v1/signup', { firmName: 'Brand Co', ownerName: 'HO', phone: '9710000091', pin: '4826', kind: 'company' }, undefined, freshIp());
    expect(s.status).toBe(200);
    const ho = s.body.token;
    expect((await sync(ho, [ch('staff', 'rep-a', { name: 'Rep A', phone: '9710000092', role: 'rep', pin: '3846', active: true }), ch('staff', 'rep-b', { name: 'Rep B', phone: '9710000093', role: 'rep', pin: '3957', active: true })])).body.rejected).toEqual([]);
    const a = (await post('/v1/login', { phone: '9710000092', pin: '3846' }, undefined, freshIp())).body.token;
    const b = (await post('/v1/login', { phone: '9710000093', pin: '3957' }, undefined, freshIp())).body.token;
    const order = (repId: string) => ({ shopId: 'x', repId, repName: repId, source: 'company', lines: [], status: 'new', issues: [], date: today(), invoiceIds: [] });
    expect((await sync(a, [ch('orders', 'o-a', order('rep-a')), ch('expenses', 'e-a', { by: 'rep-a', date: today(), category: 'food', amount: 50, status: 'waiting' }), ch('travelClaims', 't-a', { staffId: 'rep-a', month: '2026-11', days: 1, km: 1, kmAmount: 1, daDays: 1, outDays: 0, daAmount: 1, expenses: 0, total: 2, flags: [], status: 'waiting' })])).body.rejected).toEqual([]);
    expect((await sync(b, [ch('orders', 'o-b', order('rep-b')), ch('expenses', 'e-b', { by: 'rep-b', date: today(), category: 'food', amount: 60, status: 'waiting' }), ch('travelClaims', 't-b', { staffId: 'rep-b', month: '2026-11', days: 1, km: 1, kmAmount: 1, daDays: 1, outDays: 0, daAmount: 1, expenses: 0, total: 2, flags: [], status: 'waiting' })])).body.rejected).toEqual([]);
    const got = (await sync(a)).body.changes.filter((c: Ch) => ['orders', 'expenses', 'travelClaims'].includes(c.table)).map((c: Ch) => c.id).sort();
    expect(got).toEqual(['e-a', 'o-a', 't-a']);
    const hoGot = (await sync(ho)).body.changes.filter((c: Ch) => c.table === 'orders').map((c: Ch) => c.id).sort();
    expect(hoGot).toEqual(['o-a', 'o-b']);
  });
});
