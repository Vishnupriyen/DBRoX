// Security standard round (13 Nov 2026, docs/HANUBIX_SECURITY_STANDARD.md): the activity log, the limited database role,
// 6-digit owner PINs, DPDP consent / export / erasure, support access, retention, rate limits and headers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { gunzipSync } from 'node:zlib';
import { CONSENT, freePort, issueNumbers, realBill, billNo } from './fixtures.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pgServer: EmbeddedPostgres;
let pool: pg.Pool;
type App = Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
let app: App;
const port = await freePort();

beforeAll(async () => {
  process.env.ADMIN_KEY = 'admin-sec-key'; process.env.CRON_KEY = 'cron-sec-key';
  pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'hanubix-pg-sec-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false });
  await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
  pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox` });
  pool.on('error', () => {});
  const { migrate } = await import('../src/db.js'); await migrate(pool);
  const { buildApp } = await import('../src/app.js'); app = await buildApp(pool);
}, 120000);
afterAll(async () => { await app?.close(); await pool?.end(); await pgServer?.stop(); });

let ipNo = 0;
const freshIp = () => `10.20.${Math.floor(++ipNo / 250)}.${ipNo % 250 + 1}`;
const req = async (method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}, a: App = app) => {
  const r = await a.inject({ method, url, payload: body as object, headers });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : {}, headers: r.headers };
};
const post = (url: string, body: unknown, token?: string, ip = '10.30.0.1') => req('POST', url, body, { 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) });
const admin = (method: 'GET' | 'POST', url: string, body?: unknown, ip = '10.40.0.1', key = 'admin-sec-key') => req(method, url, body, { 'x-forwarded-for': ip, 'x-admin-key': key });
const now = () => new Date().toISOString();
const ch = (table: string, id: string, data: Record<string, unknown>) => ({ table, id, updatedAt: now(), data: { id, ...data, updatedAt: now() } });
const log = async (where = 'true', params: unknown[] = []) => (await pool.query(`SELECT * FROM security_log WHERE ${where} ORDER BY id`, params)).rows;

const O = { token: '', tenantId: '', userId: '' };
const OWNER_PIN = '482613', OWNER_PHONE = '9600000001';
beforeAll(async () => {
  const s = await post('/v1/signup', { consent: CONSENT, firmName: 'Secure Agencies', ownerName: 'Owner', phone: OWNER_PHONE, pin: OWNER_PIN }, undefined, freshIp());
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  Object.assign(O, s.body);
});

describe('1. the activity log', () => {
  it('a wrong and a right login, a staff member added and the admin key used: one row each with actor, time and IP', async () => {
    const t0 = Date.now();
    expect((await post('/v1/login', { phone: OWNER_PHONE, pin: '739154' }, undefined, '10.50.0.7')).status).toBe(401);
    expect((await post('/v1/login', { phone: OWNER_PHONE, pin: OWNER_PIN }, undefined, '10.50.0.8')).status).toBe(200);
    await post('/v1/sync', { cursor: 0, changes: [ch('staff', 'sec-sm1', { name: 'Ravi', phone: '9600000011', role: 'salesman', pin: '7265', active: true })] }, O.token, '10.50.0.9');
    expect((await admin('GET', '/v1/admin/tenants', undefined, '10.50.0.10')).status).toBe(200);
    const rows = await log('at >= $1', [new Date(t0 - 1000)]);
    const one = (event: string) => { const r = rows.filter(x => x.event === event); expect(r.length, event).toBe(1); return r[0]; };
    const fail = one('login.fail'); expect([fail.ip, fail.ok, fail.actor, fail.tenant_id]).toEqual(['10.50.0.7', false, O.userId, O.tenantId]);
    const ok = one('login.ok'); expect([ok.ip, ok.actor, ok.actor_role, ok.tenant_id]).toEqual(['10.50.0.8', O.userId, 'owner', O.tenantId]);
    const add = one('staff.add'); expect([add.ip, add.actor, add.target, add.detail.role]).toEqual(['10.50.0.9', O.userId, 'sec-sm1', 'salesman']);
    const adm = one('admin.ok'); expect([adm.ip, adm.actor, adm.target]).toEqual(['10.50.0.10', 'admin', 'GET /v1/admin/tenants']);
    for (const r of [fail, ok, add, adm]) expect(Math.abs(new Date(r.at).getTime() - Date.now())).toBeLessThan(60000);
    // the last login is kept for the monthly access review
    expect((await pool.query('SELECT last_login FROM users WHERE id=$1', [O.userId])).rows[0].last_login).not.toBeNull();
  });

  it('the app\'s limited database role cannot change, remove or add log rows (or drop a table)', async () => {
    const c = await pool.connect();
    try {
      await c.query('SET ROLE hanubix_app');
      for (const sql of ['UPDATE security_log SET ok = false', 'DELETE FROM security_log', `INSERT INTO security_log(id, at, event, prev_hash, hash) VALUES (1, now(), 'x', '\\x00', '\\x00')`, 'DROP TABLE docs'])
        await expect(c.query(sql), sql).rejects.toThrow(/permission denied|must be owner/);
      // it can still read the log and add through the one way in
      expect((await c.query('SELECT count(*) FROM security_log')).rows[0].count).not.toBe('0');
      expect(Number((await c.query(`SELECT seclog_add(NULL, 'x', 'test', 'test.role', NULL, NULL, true, '{}')`)).rows[0].seclog_add)).toBeGreaterThan(0);
      // and do its normal work
      expect((await c.query(`SELECT count(*) FROM docs`)).rowCount).toBe(1);
    } finally { await c.query('RESET ROLE'); c.release(); }
  });

  it('nobody, not even the owner, can update or delete a row (the trigger wall)', async () => {
    await expect(pool.query(`UPDATE security_log SET ok = false WHERE event = 'login.ok'`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM security_log WHERE event = 'login.ok'`)).rejects.toThrow(/append-only/);
  });

  it('a row edited behind the walls (as the database owner) breaks the chain at that row', async () => {
    const { verifyChain } = await import('../src/seclog.js');
    expect(await verifyChain(pool)).toBeNull();
    const target = (await log(`event = 'login.fail'`))[0];
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL session_replication_role = replica'); // the owner switching the triggers off
      await c.query(`UPDATE security_log SET ip = '1.2.3.4' WHERE id = $1`, [target.id]);
      const { rows } = await c.query('SELECT seclog_verify() AS id');
      expect(Number(rows[0].id)).toBe(Number(target.id));
      await c.query('ROLLBACK');
    } finally { c.release(); }
    expect(await verifyChain(pool)).toBeNull();
  });

  it('no PIN, token, phone number or document body ever appears in the log', async () => {
    const tok = (await post('/v1/login', { phone: '9600000011', pin: '7265' }, undefined, freshIp())).body.token as string;
    await post('/v1/pin/change', { old: OWNER_PIN, pin: '739154' }, O.token, freshIp());
    const relog = await post('/v1/login', { phone: OWNER_PHONE, pin: '739154' }, undefined, freshIp());
    O.token = relog.body.token;
    await post('/v1/privacy/export', {}, tok, freshIp());
    const text = JSON.stringify(await log());
    for (const secret of [OWNER_PIN, '739154', '7265', OWNER_PHONE, '9600000011', tok.split('.')[1], O.token.split('.')[1], 'Ravi', 'Secure Agencies'])
      expect(text.includes(secret), secret).toBe(false);
    const { safeDetail } = await import('../src/seclog.js');
    expect(safeDetail({ pin: '1234', token: 'x', phone: '9876543210', data: { a: 1 }, lines: [], kind: 'scan', n: 4, code: '98765432' })).toEqual({ kind: 'scan', n: 4 });
  });

  it('the owner sees their own firm\'s activity (who logged in, who changed staff), never another firm\'s', async () => {
    const r = await post('/v1/security/activity', {}, O.token);
    expect(r.status).toBe(200);
    const events = r.body.rows.map((x: { event: string }) => x.event);
    expect(events).toContain('login.ok'); expect(events).toContain('staff.add');
    expect(r.body.rows.find((x: { event: string }) => x.event === 'staff.add').about).toBe('Ravi');
    const sm = (await post('/v1/login', { phone: '9600000011', pin: '7265' }, undefined, freshIp())).body.token;
    expect((await post('/v1/security/activity', {}, sm)).status).toBe(403);
  });
});

describe('2. PINs, tokens and phones', () => {
  it('a 4-digit owner from before is asked for 6 digits at login; staff stay 4; easy 6-digit PINs are refused', async () => {
    const s = await post('/v1/signup', { consent: CONSENT, firmName: 'Old Owner', ownerName: 'O', phone: '9600000101', pin: '391742' }, undefined, freshIp());
    const { hashPin } = await import('../src/auth.js');
    await pool.query('UPDATE users SET pin_hash=$2, pin_len=4 WHERE id=$1', [s.body.userId, hashPin('3917')]); // as an owner from before 13 Nov
    const l = await post('/v1/login', { phone: '9600000101', pin: '3917' }, undefined, freshIp());
    expect([l.status, l.body.mustChangePin, l.body.pinLength]).toEqual([200, true, 6]);
    expect((await post('/v1/pin/change', { old: '3917', pin: '4826' }, l.body.token)).status).toBe(400);
    expect((await post('/v1/pin/change', { old: '3917', pin: '123456' }, l.body.token)).status).toBe(400);
    expect((await post('/v1/pin/change', { old: '0000', pin: '615384' }, l.body.token)).status).toBe(401);
    const ok = await post('/v1/pin/change', { old: '3917', pin: '615384' }, l.body.token);
    expect(ok.status).toBe(200);
    expect((await post('/v1/sync', { cursor: 0 }, l.body.token)).status).toBe(401); // other phones log in again
    expect((await post('/v1/sync', { cursor: 0 }, ok.body.token)).status).toBe(200);
    const again = await post('/v1/login', { phone: '9600000101', pin: '615384' }, undefined, freshIp());
    expect([again.status, again.body.mustChangePin]).toEqual([200, undefined]);
    const staff = await post('/v1/login', { phone: '9600000011', pin: '7265' }, undefined, freshIp());
    expect(staff.body.mustChangePin).toBeUndefined();
  });

  it('owner tokens last 14 days, staff 30; "lock this phone" and "log out everywhere" end a token at once', async () => {
    const { readToken } = await import('../src/auth.js');
    const sm = (await post('/v1/login', { phone: '9600000011', pin: '7265' }, undefined, freshIp())).body.token;
    const days = (t: string) => (readToken(t)!.exp - Date.now() / 1000) / 86400;
    expect(Math.round(days(O.token))).toBe(14); expect(Math.round(days(sm))).toBe(30);
    expect((await post('/v1/staff/lock', { staffId: 'sec-sm1' }, sm)).status).toBe(403);
    expect((await post('/v1/staff/lock', { staffId: 'sec-sm1' }, O.token)).status).toBe(200);
    expect((await post('/v1/sync', { cursor: 0 }, sm)).status).toBe(401);
    expect((await log(`event = 'staff.lock' AND target = 'sec-sm1'`)).length).toBe(1);
    const second = (await post('/v1/login', { phone: OWNER_PHONE, pin: '739154' }, undefined, freshIp())).body.token;
    expect((await post('/v1/logout-all', {}, second)).status).toBe(200);
    expect((await post('/v1/sync', { cursor: 0 }, O.token)).status).toBe(401);
    O.token = (await post('/v1/login', { phone: OWNER_PHONE, pin: '739154' }, undefined, freshIp())).body.token;
  });

  it('a key change: tokens signed with the old secret still work while JWT_SECRET_OLD is set, then stop', async () => {
    const { config } = await import('../src/config.js');
    const before = config.jwtSecret;
    try {
      config.jwtSecretOld = before; config.jwtSecret = 'the-new-secret';
      expect((await post('/v1/sync', { cursor: 0 }, O.token)).status).toBe(200);
      config.jwtSecretOld = '';
      expect((await post('/v1/sync', { cursor: 0 }, O.token)).status).toBe(401);
    } finally { config.jwtSecret = before; config.jwtSecretOld = ''; }
  });
});

describe('3. admin and cron keys', () => {
  it('wrong admin keys are logged and locked out per place after 5; cron refusals are logged', async () => {
    const ip = '10.60.0.1';
    for (let i = 0; i < 5; i++) expect((await admin('GET', '/v1/admin/tenants', undefined, ip, 'wrong')).status).toBe(401);
    expect((await admin('GET', '/v1/admin/tenants', undefined, ip)).status).toBe(429); // even the right key, from that place, for 30 minutes
    expect((await admin('GET', '/v1/admin/tenants', undefined, '10.60.0.2')).status).toBe(200);
    expect((await log(`event = 'admin.denied' AND ip = $1`, [ip])).length).toBe(6);
    expect((await req('POST', '/v1/cron/retention', {}, { 'x-forwarded-for': '10.60.0.3', 'x-cron-key': 'nope' })).status).toBe(403);
    expect((await log(`event = 'cron.denied' AND ip = '10.60.0.3'`)).length).toBe(1);
  });

  it('support may read a firm only inside the owner\'s 24-hour window; every read and refusal is logged', async () => {
    const url = `/v1/admin/support/${O.tenantId}/docs`;
    expect((await admin('POST', url, { tbl: 'staff' })).status).toBe(403);
    expect((await post('/v1/support-access', {}, O.token)).status).toBe(200);
    const r = await admin('POST', url, { tbl: 'staff' });
    expect(r.status).toBe(200); expect(r.body.docs.length).toBeGreaterThan(0);
    await pool.query(`UPDATE support_access SET expires_at = now() - interval '1 minute' WHERE tenant_id=$1`, [O.tenantId]);
    expect((await admin('POST', url, { tbl: 'staff' })).status).toBe(403);
    expect((await log(`tenant_id = $1 AND event IN ('support.grant', 'support.read', 'support.denied')`, [O.tenantId])).map(x => x.event)).toEqual(['support.denied', 'support.grant', 'support.read', 'support.denied']);
  });
});

describe('4. DPDP', () => {
  it('sign-up cannot go ahead without the privacy box; the version and time are kept', async () => {
    const body = { firmName: 'No Consent', ownerName: 'N', phone: '9600000201', pin: '391742' };
    expect((await post('/v1/signup', body, undefined, freshIp())).status).toBe(400);
    expect((await post('/v1/signup', { ...body, consent: { version: '2020-01-01' } }, undefined, freshIp())).status).toBe(400);
    const ok = await post('/v1/signup', { ...body, consent: { version: CONSENT.version } }, undefined, freshIp());
    expect(ok.status).toBe(200);
    const st = await post('/v1/privacy/status', {}, ok.body.token);
    expect(st.body.consents.privacy.version).toBe(CONSENT.version);
    expect(st.body.consents.privacy.granted).toBe(true);
    expect(st.body.grievance.officer).toBe('R. Vishnupriyen');
    // optional choices are separate and off unless given: AI photo reading is refused until the owner turns it on
    expect(st.body.firm.ai_scan).toBe(false);
    expect((await post('/v1/scan', { kind: 'purchase', file: 'data:image/jpeg;base64,AAAA' }, ok.body.token)).status).toBe(403);
    await post('/v1/privacy/consent', { kind: 'ai_scan', granted: true }, ok.body.token);
    expect((await post('/v1/scan', { kind: 'purchase', file: 'data:image/jpeg;base64,AAAA' }, ok.body.token)).status).toBe(503); // on (no AI key in tests)
    await post('/v1/privacy/consent', { kind: 'ai_scan', granted: false }, ok.body.token); // withdrawn as easily
    expect((await post('/v1/scan', { kind: 'purchase', file: 'data:image/jpeg;base64,AAAA' }, ok.body.token)).status).toBe(403);
  });

  it('"export my data" gives the person their own records only — never another person\'s or another firm\'s', async () => {
    await post('/v1/sync', { cursor: 0, changes: [ch('staff', 'sec-dr1', { name: 'Kumar', phone: '9600000012', role: 'delivery', pin: '7416', active: true })] }, O.token);
    const kumar = (await post('/v1/login', { phone: '9600000012', pin: '7416' }, undefined, freshIp())).body.token;
    await post('/v1/sync', { cursor: 0, changes: [ch('checkIns', 'ci-k', { staffId: 'sec-dr1', date: '2026-11-13', at: now(), late: false, lat: 11.4, lng: 79.2 }),
      ch('checkIns', 'ci-r', { staffId: 'sec-sm1', date: '2026-11-13', at: now(), late: false })] }, O.token);
    const other = await post('/v1/signup', { consent: CONSENT, firmName: 'Other Firm', ownerName: 'X', phone: '9600000301', pin: '391742' }, undefined, freshIp());
    await post('/v1/sync', { cursor: 0, changes: [ch('checkIns', 'ci-x', { staffId: 'sec-dr1', date: '2026-11-13', at: now(), late: false })] }, other.body.token);
    const e = await post('/v1/privacy/export', {}, kumar);
    expect(e.status).toBe(200);
    expect(e.body.login.id).toBe('sec-dr1');
    expect(e.body.records.checkIns.map((x: { id: string }) => x.id)).toEqual(['ci-k']);
    expect(JSON.stringify(e.body)).not.toMatch(/Ravi|ci-r|ci-x|Other Firm/);
    expect(e.body.staffRecord.pin).toBeUndefined();
  });

  it('requests (access, correct, delete, nominee, grievance) get a due date; the public form works without a login; the control panel lists them', async () => {
    const kumar = (await post('/v1/login', { phone: '9600000012', pin: '7416' }, undefined, freshIp())).body.token;
    const r = await post('/v1/privacy/request', { kind: 'delete', note: 'I left the firm' }, kumar);
    expect(r.status).toBe(200);
    expect(r.body.due).toBe((await pool.query(`SELECT to_char(current_date + 30, 'YYYY-MM-DD') d`)).rows[0].d); // 30 days (our own target: 15)
    expect((await post('/v1/privacy/request', { kind: 'delete_account' }, kumar)).status).toBe(403); // only the owner closes the firm
    const pub = await post('/v1/privacy/public-request', { name: 'Shop owner', contact: '9600000999', firm: 'Secure Agencies', kind: 'delete' }, undefined, '10.70.0.1');
    expect(pub.status).toBe(200);
    for (let i = 0; i < 6; i++) await post('/v1/privacy/public-request', { name: 'Spam', contact: 'x', kind: 'delete' }, undefined, '10.70.0.2');
    expect((await post('/v1/privacy/public-request', { name: 'Spam', contact: 'x', kind: 'delete' }, undefined, '10.70.0.2')).status).toBe(429);
    const list = await admin('GET', '/v1/admin/privacy');
    expect(list.body.requests.some((x: { id: string }) => x.id === r.body.id)).toBe(true);
    expect(list.body.requests.some((x: { id: string; contact: string }) => x.id === pub.body.id && x.contact === '9600000999')).toBe(true);
  });

  it('erasure removes name and phone from live records, the archive bundle and the login row; bill numbers and amounts stay; the log chain still verifies', async () => {
    await issueNumbers(pool, O.tenantId, 'SEC');
    const old = '2024-05-10';
    const bill = realBill({ id: 'sec-bill1', number: billNo(100001, 'SEC'), date: old, shopId: 'sec-shop1', kind: 'tax', lines: [{ productId: 'p1', qty: 2, taxable: 100, total: 105 }],
      delivery: { shopPhoto: 'data:image/jpeg;base64,SHOPFACE', billPhoto: 'data:image/jpeg;base64,SIGNED' } });
    await post('/v1/sync', { cursor: 0, changes: [
      ch('shops', 'sec-shop1', { name: 'Murugan Stores', owner: 'Murugan', phone: '9600000777', address: '1 Main Road', gstin: '33ABCDE1234F1Z5', area: 'A', beat: 'B', creditLimit: 0, creditDays: 0, cashOnly: false, type: 'retail', approved: true, aliases: ['Murugan'] }),
      ch('checkIns', 'ci-old', { staffId: 'sec-dr1', date: old, at: `${old}T03:00:00Z`, late: false, lat: 11.5, lng: 79.3 })] }, O.token);
    // an old bill as it was saved two years ago (written straight in: today's sync rules are not what this test is about)
    await pool.query(`INSERT INTO docs(tenant_id, tbl, id, data, updated_at) VALUES ($1, 'invoices', 'sec-bill1', $2, $3)`, [O.tenantId, { ...bill, tenantId: O.tenantId }, `${old}T05:00:00Z`]);
    const { archiveTenant } = await import('../src/archive.js');
    await archiveTenant(pool, O.tenantId, 'distributor');
    expect((await pool.query(`SELECT 1 FROM docs WHERE id='sec-bill1'`)).rowCount).toBe(0); // in the archive bundle now
    const shopReq = await post('/v1/privacy/public-request', { name: 'Murugan', contact: '9600000777', firm: 'Secure Agencies', kind: 'delete' }, undefined, '10.70.0.9');
    const staffReq = await post('/v1/privacy/request', { kind: 'delete' }, (await post('/v1/login', { phone: '9600000012', pin: '7416' }, undefined, freshIp())).body.token);
    // a second confirmation: the request id typed again
    expect((await admin('POST', `/v1/admin/privacy/${shopReq.body.id}/erase`, { tenantId: O.tenantId, subjectKind: 'shop', subjectId: 'sec-shop1' })).status).toBe(400);
    const e1 = await admin('POST', `/v1/admin/privacy/${shopReq.body.id}/erase`, { confirm: shopReq.body.id, tenantId: O.tenantId, subjectKind: 'shop', subjectId: 'sec-shop1' });
    expect(e1.status, JSON.stringify(e1.body)).toBe(200);
    const e2 = await admin('POST', `/v1/admin/privacy/${staffReq.body.id}/erase`, { confirm: staffReq.body.id });
    expect(e2.status, JSON.stringify(e2.body)).toBe(200);
    expect(e2.body.login).toBe(1);
    const shop = (await pool.query(`SELECT data FROM docs WHERE id='sec-shop1'`)).rows[0].data;
    expect(JSON.stringify(shop)).not.toMatch(/Murugan|9600000777|Main Road/);
    expect(shop.gstin).toBe('33ABCDE1234F1Z5'); // on the tax invoices: kept
    const bundles = (await pool.query(`SELECT tbl, data FROM docs_archive WHERE tenant_id=$1`, [O.tenantId])).rows.map(r => ({ tbl: r.tbl, list: JSON.parse(gunzipSync(r.data).toString()) }));
    const archived = bundles.find(b => b.tbl === 'invoices')!.list.find((x: { id: string }) => x.id === 'sec-bill1').data;
    expect(archived.delivery.shopPhoto).toBeUndefined();
    expect(archived.delivery.billPhoto).toBe('data:image/jpeg;base64,SIGNED'); // the signed bill is proof: kept
    expect([archived.number, archived.total]).toEqual([bill.number, bill.total]);
    const ci = bundles.find(b => b.tbl === 'checkIns')!.list.find((x: { id: string }) => x.id === 'ci-old').data;
    expect([ci.lat, ci.lng, ci.date]).toEqual([undefined, undefined, old]);
    expect((await pool.query(`SELECT 1 FROM users WHERE tenant_id=$1 AND id='sec-dr1'`, [O.tenantId])).rowCount).toBe(0);
    expect(JSON.stringify((await pool.query(`SELECT data FROM docs WHERE tenant_id=$1 AND id='sec-dr1'`, [O.tenantId])).rows[0].data)).not.toMatch(/Kumar|9600000012/);
    const { verifyChain } = await import('../src/seclog.js');
    expect(await verifyChain(pool)).toBeNull();
    expect((await log(`event = 'privacy.erase'`)).length).toBe(2);
  });
});

describe('5. retention and the log months', () => {
  it('a dry run counts and changes nothing (bills untouched); the real run purges old rate_hits and logs its counts', async () => {
    await pool.query(`INSERT INTO rate_hits(key, n, since) VALUES ('old-key', 3, now() - interval '40 days') ON CONFLICT DO NOTHING`);
    const docsBefore = (await pool.query('SELECT count(*)::int n, sum(version)::text v FROM docs')).rows[0];
    const cron = (body: unknown) => req('POST', '/v1/cron/retention', body, { 'x-forwarded-for': '10.80.0.1', 'x-cron-key': 'cron-sec-key' });
    const dry = await cron({ dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.counts.rate_hits).toBeGreaterThanOrEqual(1);
    expect((await pool.query(`SELECT 1 FROM rate_hits WHERE key='old-key'`)).rowCount).toBe(1);
    const real = await cron({});
    expect(real.body.counts.rate_hits).toBeGreaterThanOrEqual(1);
    expect((await pool.query(`SELECT 1 FROM rate_hits WHERE key='old-key'`)).rowCount).toBe(0);
    expect((await pool.query('SELECT count(*)::int n, sum(version)::text v FROM docs')).rows[0]).toEqual(docsBefore);
    expect((await log(`event = 'cron.retention'`)).length).toBe(1);
    expect((await pool.query(`SELECT ok FROM job_runs WHERE job='retention'`)).rows[0].ok).toBe(true);
  });

  it('a log month past 12 months is exported, checked and dropped; the chain carries on from its last hash', async () => {
    const { rotateLog, verifyChain, logEvent } = await import('../src/seclog.js');
    const rowsBefore = Number((await pool.query('SELECT count(*) n FROM security_log')).rows[0].n);
    const future = new Date(Date.now() + 400 * 86400e3);
    const dry = await rotateLog(pool, future, 12, 5, true);
    expect(dry.archivedMonths.length).toBeGreaterThan(0);
    expect(Number((await pool.query('SELECT count(*) n FROM security_log')).rows[0].n)).toBe(rowsBefore);
    const r = await rotateLog(pool, future);
    expect(r.archivedMonths).toEqual(dry.archivedMonths);
    expect(Number((await pool.query('SELECT count(*) n FROM security_log')).rows[0].n)).toBe(0);
    const a = (await pool.query('SELECT sum(rows)::int n FROM security_log_archive')).rows[0];
    expect(a.n).toBe(rowsBefore);
    await logEvent(pool, { event: 'test.after', actor: 'x' });
    expect(await verifyChain(pool)).toBeNull(); // the first new row follows the archived month's last hash
  });
});

describe('6. requests per minute and headers', () => {
  it('one place over the per-minute limit is refused; every answer carries the security headers', async () => {
    const r = await req('GET', '/health', undefined, {});
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    process.env.RATE_PLACE_PER_MIN = '5';
    const { buildApp } = await import('../src/app.js'); const small = await buildApp(pool);
    delete process.env.RATE_PLACE_PER_MIN;
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await req('GET', '/v1/licence', undefined, { 'x-forwarded-for': '10.90.0.1' }, small)).status);
    expect(codes.slice(0, 5).every(c => c === 401)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
    expect((await req('GET', '/v1/licence', undefined, { 'x-forwarded-for': '10.90.0.2' }, small)).status).toBe(401); // another place is not affected
    const nc = (await req('POST', '/v1/sync', { cursor: 0 }, { 'x-forwarded-for': '10.90.0.3', authorization: `Bearer ${O.token}` }, small)).headers['cache-control'];
    expect(nc).toBe('no-store');
    await small.close();
  });

  it('login and sign-up refuse big bodies', async () => {
    const big = { phone: '9600000001', pin: '482613', pad: 'x'.repeat(40 * 1024) };
    expect((await post('/v1/login', big, undefined, freshIp())).status).toBe(413);
    expect((await post('/v1/signup', { ...big, consent: CONSENT }, undefined, freshIp())).status).toBe(413);
  });
});
