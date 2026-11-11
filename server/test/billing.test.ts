// Plans, payments and licences: pure rules first (fast), then the real server with a real database.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac, createPublicKey, verify } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { billNo, issueNumbers, realBill } from './fixtures.js';
import { billingState, makeLicence, sealLicence, openLicence, publicKeySpki, isUpgrade, istToday } from '../src/licence.js';

describe('billing rules (dates → status)', () => {
  const b = { tier: 'medium', pack: 'complete', trialEnds: '2026-12-31', paidUntil: null };
  it('trial → grace for 7 days → locked at the START of day 8, never mid-day', () => {
    expect(billingState(b, '2026-12-31').status).toBe('trial');
    expect(billingState(b, '2027-01-01').status).toBe('grace');
    expect(billingState(b, '2027-01-07').status).toBe('grace');
    expect(billingState(b, '2027-01-08')).toMatchObject({ status: 'locked', lockOn: '2027-01-08' });
  });
  it('a payment makes it active and moves every date forward', () => {
    const paid = { ...b, paidUntil: '2027-01-31' };
    expect(billingState(paid, '2027-01-10').status).toBe('active');
    expect(billingState(paid, '2027-02-05').status).toBe('grace');
    expect(billingState(paid, '2027-02-08').status).toBe('locked');
  });
  it('the licence carries only the pack’s modules and must be refreshed within 14 days', () => {
    const l = makeLicence('t1', { ...b, pack: 'last_mile' }, '2026-12-01');
    expect(Object.entries(l.mods).filter(([, v]) => v).map(([k]) => k).sort()).toEqual(['collection', 'delivery']);
    expect(l.validUntil).toBe('2026-12-15');
    const g = makeLicence('t1', b, '2027-01-03');
    expect(g.validUntil).toBe('2027-01-08'); // in grace the phone locks itself on the lock day even offline
  });
  it('the seal: anyone can check it, nobody can change it', () => {
    const tok = sealLicence(makeLicence('t1', { ...b, pack: 'last_mile' }, '2026-12-01'));
    expect(openLicence(tok)?.pack).toBe('last_mile');
    // the phone checks with the public key only (same format WebCrypto uses)
    const [body, sig] = tok.split('.');
    const pub = createPublicKey({ key: Buffer.from(publicKeySpki(), 'base64'), format: 'der', type: 'spki' });
    expect(verify('sha256', Buffer.from(body, 'base64url'), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
    // turning a module on by editing the licence breaks the seal
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString()); forged.mods.bill = true;
    expect(openLicence(`${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`)).toBeNull();
  });
  it('upgrade vs downgrade', () => {
    expect(isUpgrade('last_mile', 'complete')).toBe(true);
    expect(isUpgrade('complete', 'office')).toBe(false);
  });
});

describe('billing on the real server', () => {
  let pgServer: EmbeddedPostgres; let pool: pg.Pool;
  let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
  const port = 54331;
  beforeAll(async () => {
    process.env.ADMIN_KEY = 'admin-test-key'; process.env.CRON_KEY = 'cron-test-key'; process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
    pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'hanubix-pg-billing-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false });
    await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
    pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox` });
    pool.on('error', () => {}); // the test database is stopped at the end while idle connections are still open
    const { migrate } = await import('../src/db.js'); await migrate(pool);
    const { buildApp } = await import('../src/app.js'); app = await buildApp(pool);
  }, 120000);
  afterAll(async () => { await app?.close(); await pool?.end(); await pgServer?.stop(); });

  const call = async (method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.inject({ method, url, payload: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
    return { status: r.statusCode, body: r.body ? r.json() : null };
  };
  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  const lic = (tok: string) => openLicence(tok)!;
  let o = { token: '', tenantId: '' };

  it('a new distributor starts a 60-day trial with every module, and the licence comes with login and sync', async () => {
    const s = await call('POST', '/v1/signup', { firmName: 'Lock Test Agencies', ownerName: 'Owner', phone: '9822222222', pin: '4826' });
    expect(s.status).toBe(200); o = s.body;
    expect(lic(s.body.licence)).toMatchObject({ status: 'trial', pack: 'complete' });
    const sy = await call('POST', '/v1/sync', { cursor: 0, changes: [] }, as(o.token));
    expect(lic(sy.body.licence).mods.bill).toBe(true);
  });

  it('locked: no new bill numbers, no new orders or bills — but money and existing records still sync', async () => {
    const now = new Date().toISOString();
    await issueNumbers(pool, o.tenantId);
    const old = realBill({ id: 'inv-old', number: billNo(1), lines: [{ taxable: 100, total: 105 }], deliveryStatus: 'out' });
    await call('POST', '/v1/sync', { cursor: 0, changes: [{ table: 'invoices', id: 'inv-old', updatedAt: now, data: old }] }, as(o.token));
    await pool.query(`UPDATE tenants SET trial_ends = current_date - 30 WHERE id=$1`, [o.tenantId]);
    expect((await call('POST', '/v1/number', { kind: 'bill' }, as(o.token))).status).toBe(402);
    const later = new Date(Date.now() + 1000).toISOString();
    const r = await call('POST', '/v1/sync', { cursor: 0, changes: [
      { table: 'orders', id: 'o-new', updatedAt: later, data: { id: 'o-new' } },
      { table: 'invoices', id: 'inv-new', updatedAt: later, data: { id: 'inv-new' } },
      { table: 'invoices', id: 'inv-old', updatedAt: later, data: { ...old, deliveryStatus: 'delivered' } },
      { table: 'payments', id: 'pay-1', updatedAt: later, data: { id: 'pay-1', amount: 100 } },
    ] }, as(o.token));
    expect(r.body.rejected.sort()).toEqual(['invoices|inv-new', 'orders|o-new']);
    expect(r.body.accepted.sort()).toEqual(['invoices|inv-old', 'payments|pay-1']);
    expect(lic(r.body.licence).status).toBe('locked');
  });

  it('Razorpay payment: wrong signature refused; real one unlocks at once; the same event twice counts once', async () => {
    const end = Math.floor(Date.parse(`${istToday()}T00:00:00+05:30`) / 1000) + 30 * 86400;
    const ev = { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1', current_end: end, notes: { tenantId: o.tenantId } } }, payment: { entity: { id: 'pay_rzp_1' } } } };
    const raw = JSON.stringify(ev);
    const bad = await app.inject({ method: 'POST', url: '/v1/razorpay/webhook', payload: raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'x'.repeat(64) } });
    expect(bad.statusCode).toBe(401);
    const sig = createHmac('sha256', 'whsec_test').update(raw).digest('hex');
    const ok = await app.inject({ method: 'POST', url: '/v1/razorpay/webhook', payload: raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_1' } });
    expect(ok.json()).toMatchObject({ ok: true });
    const again = await app.inject({ method: 'POST', url: '/v1/razorpay/webhook', payload: raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_1' } });
    expect(again.json()).toMatchObject({ duplicate: true });
    const l = lic((await call('GET', '/v1/licence', undefined, as(o.token))).body.licence);
    expect(l.status).toBe('active');
    expect((await call('POST', '/v1/number', { kind: 'bill' }, as(o.token))).status).toBe(200);
  });

  it('console: upgrade starts now, downgrade waits for the end of the paid month; admin key required', async () => {
    expect((await call('POST', `/v1/admin/tenants/${o.tenantId}/plan`, { pack: 'last_mile' })).status).toBe(401);
    const key = { 'x-admin-key': 'admin-test-key' };
    const down = await call('POST', `/v1/admin/tenants/${o.tenantId}/plan`, { pack: 'last_mile' }, key);
    expect(down.body.startsNow.pack).toBe(false);
    expect(lic((await call('GET', '/v1/licence', undefined, as(o.token))).body.licence).pack).toBe('complete');
    // month over → daily job applies the downgrade
    await pool.query(`UPDATE tenants SET paid_until = current_date - 1 WHERE id=$1`, [o.tenantId]);
    expect((await call('POST', '/v1/cron/daily', {}, { 'x-cron-key': 'cron-test-key' })).status).toBe(200);
    const l = lic((await call('GET', '/v1/licence', undefined, as(o.token))).body.licence);
    expect(l.pack).toBe('last_mile'); expect(l.mods.bill).toBe(false);
    expect((await call('POST', '/v1/number', { kind: 'bill' }, as(o.token))).status).toBe(403); // billing not in plan
    const up = await call('POST', `/v1/admin/tenants/${o.tenantId}/plan`, { pack: 'complete' }, key);
    expect(up.body.startsNow.pack).toBe(true);
    expect(lic((await call('GET', '/v1/licence', undefined, as(o.token))).body.licence).mods.bill).toBe(true);
  });

  it('a payment by bank transfer can be marked paid from the console', async () => {
    await pool.query(`UPDATE tenants SET paid_until = current_date - 20 WHERE id=$1`, [o.tenantId]);
    expect(lic((await call('GET', '/v1/licence', undefined, as(o.token))).body.licence).status).toBe('locked');
    const until = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
    expect((await call('POST', `/v1/admin/tenants/${o.tenantId}/paid`, { until }, { 'x-admin-key': 'admin-test-key' })).status).toBe(200);
    expect(lic((await call('GET', '/v1/licence', undefined, as(o.token))).body.licence).status).toBe('active');
  });
});
