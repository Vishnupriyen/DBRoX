import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pgServer: EmbeddedPostgres;
let pool: pg.Pool;
let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
const port = 54329;

beforeAll(async () => {
  const dir = join(tmpdir(), 'dbrox-pg-' + Date.now()); void mkdtempSync; void chmodSync;
  pgServer = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false });
  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase('dbrox');
  pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox` });
  pool.on('error', () => {}); // the test database is stopped at the end while idle connections are still open
  const { migrate } = await import('../src/db.js');
  await migrate(pool);
  const { buildApp } = await import('../src/app.js');
  app = await buildApp(pool);
}, 120000);

afterAll(async () => { await app?.close(); await pool?.end(); await pgServer?.stop(); });

const post = async (url: string, body: unknown, token?: string) => {
  const r = await app.inject({ method: 'POST', url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, body: r.json() };
};

describe('DBRoX server', () => {
  let owner = { token: '', tenantId: '', userId: '' };
  it('signs up a distributor and logs in', async () => {
    const s = await post('/v1/signup', { firmName: 'Test Agencies', ownerName: 'Owner', phone: '9811111111', pin: '1234' });
    expect(s.status).toBe(200);
    owner = s.body;
    expect((await post('/v1/login', { phone: '9811111111', pin: '9999' })).status).toBe(401);
    const l = await post('/v1/login', { phone: '9811111111', pin: '1234' });
    expect(l.status).toBe(200);
    expect(l.body.tenantId).toBe(owner.tenantId);
  });

  it('pulls settings on first sync, pushes and pulls records', async () => {
    const first = await post('/v1/sync', { cursor: 0, changes: [] }, owner.token);
    expect(first.body.changes.map((c: { table: string }) => c.table).sort()).toEqual(['settings', 'staff']);
    const now = new Date().toISOString();
    const shop = { id: 'shop1', name: 'Murugan Stores', updatedAt: now };
    const push = await post('/v1/sync', { cursor: first.body.cursor, changes: [{ table: 'shops', id: 'shop1', updatedAt: now, data: shop }] }, owner.token);
    expect(push.body.accepted).toContain('shops|shop1');
    expect(push.body.changes.find((c: { id: string }) => c.id === 'shop1').data.tenantId).toBe(owner.tenantId);
    // an older copy never overwrites a newer one
    const old = new Date(Date.now() - 60000).toISOString();
    await post('/v1/sync', { cursor: 0, changes: [{ table: 'shops', id: 'shop1', updatedAt: old, data: { ...shop, name: 'OLD' } }] }, owner.token);
    const rows = (await pool.query(`SELECT data FROM docs WHERE id='shop1'`)).rows;
    expect(rows[0].data.name).toBe('Murugan Stores');
  });

  it('creates staff logins from synced staff, limits roles, and removes access instantly', async () => {
    const now = new Date().toISOString();
    const staff = { id: 'sm1', name: 'Ravi', phone: '9822222222', role: 'salesman', pin: '4321', active: true, updatedAt: now };
    await post('/v1/sync', { cursor: 0, changes: [{ table: 'staff', id: 'sm1', updatedAt: now, data: staff }] }, owner.token);
    const stored = (await pool.query(`SELECT data FROM docs WHERE id='sm1'`)).rows[0].data;
    expect(stored.pin).toBe(''); // PIN never stored in documents
    const sm = await post('/v1/login', { phone: '9822222222', pin: '4321' });
    expect(sm.status).toBe(200);
    // salesman cannot write settings and does not receive bank lines
    const bad = await post('/v1/sync', { cursor: 0, changes: [{ table: 'settings', id: 'x', updatedAt: now, data: {} }] }, sm.body.token);
    expect(bad.body.rejected).toContain('settings|x');
    await post('/v1/sync', { cursor: 0, changes: [{ table: 'bankLines', id: 'b1', updatedAt: now, data: { credit: 5 } }] }, owner.token);
    const smPull = await post('/v1/sync', { cursor: 0, changes: [] }, sm.body.token);
    expect(smPull.body.changes.some((c: { table: string }) => c.table === 'bankLines')).toBe(false);
    // other distributors cannot see this data
    const other = await post('/v1/signup', { firmName: 'Other', ownerName: 'X', phone: '9833333333', pin: '1111' });
    const otherPull = await post('/v1/sync', { cursor: 0, changes: [] }, other.body.token);
    expect(otherPull.body.changes.some((c: { id: string }) => c.id === 'shop1')).toBe(false);
    // owner removes access → salesman's token stops working at once
    const later = new Date(Date.now() + 1000).toISOString();
    await post('/v1/sync', { cursor: 0, changes: [{ table: 'staff', id: 'sm1', updatedAt: later, data: { ...staff, pin: '', active: false, updatedAt: later } }] }, owner.token);
    expect((await post('/v1/sync', { cursor: 0, changes: [] }, sm.body.token)).status).toBe(403);
  });

  it("two phones: driver's trip, check-in and day close reach the owner; purchase rate never reaches staff", async () => {
    const now = new Date().toISOString();
    const drv = { id: 'dr1', name: 'Karthik', phone: '9844444444', role: 'delivery', pin: '5555', active: true, updatedAt: now };
    await post('/v1/sync', { cursor: 0, changes: [{ table: 'staff', id: 'dr1', updatedAt: now, data: drv }, { table: 'products', id: 'p1', updatedAt: now, data: { id: 'p1', name: 'Surf', purchaseRate: 90, rate: 100, updatedAt: now } }] }, owner.token);
    const d = await post('/v1/login', { phone: '9844444444', pin: '5555' });
    expect(d.status).toBe(200);
    // Office assigns and loads a trip; a driver can start it, not create it.
    const assignedAt = new Date(Date.now() - 3000).toISOString();
    await post('/v1/sync', { cursor: 0, changes: [{
      table: 'trips', id: 't1', updatedAt: assignedAt,
      data: { id: 't1', vanId: 'v1', driverId: 'dr1', date: now.slice(0, 10), status: 'loaded', stops: [], track: [], updatedAt: assignedAt },
    }] }, owner.token);
    const push = await post('/v1/sync', { cursor: 0, changes: [
      { table: 'trips', id: 't1', updatedAt: now, data: { id: 't1', vanId: 'v1', driverId: 'dr1', date: now.slice(0, 10), status: 'out', startedAt: now, stops: [], track: [], updatedAt: now } },
      { table: 'checkIns', id: 'c1', updatedAt: now, data: { id: 'c1', staffId: 'dr1', date: now.slice(0, 10), at: now, late: false, updatedAt: now } },
      { table: 'leaves', id: 'l1', updatedAt: now, data: { id: 'l1', staffId: 'dr1', from: now.slice(0, 10), to: now.slice(0, 10), reason: 'x', status: 'waiting', updatedAt: now } },
    ] }, d.body.token);
    expect(push.body.rejected).toEqual([]);
    // driver's pull carries products without the purchase rate
    const dp = await post('/v1/sync', { cursor: 0, changes: [] }, d.body.token);
    const prod = dp.body.changes.find((c: { id: string }) => c.id === 'p1');
    expect(prod.data.rate).toBe(100); expect(prod.data.purchaseRate).toBeUndefined();
    // owner's phone sees the trip, the check-in and the leave request
    const op = await post('/v1/sync', { cursor: 0, changes: [] }, owner.token);
    const tables = op.body.changes.map((c: { table: string }) => c.table);
    expect(tables).toContain('trips'); expect(tables).toContain('checkIns'); expect(tables).toContain('leaves');
    // owner approves the leave; driver's phone receives the decision
    const later = new Date(Date.now() + 1000).toISOString();
    await post('/v1/sync', { cursor: 0, changes: [{ table: 'leaves', id: 'l1', updatedAt: later, data: { id: 'l1', staffId: 'dr1', from: now.slice(0, 10), to: now.slice(0, 10), reason: 'x', status: 'approved', updatedAt: later } }] }, owner.token);
    const dp2 = await post('/v1/sync', { cursor: dp.body.cursor, changes: [] }, d.body.token);
    expect(dp2.body.changes.find((c: { id: string }) => c.id === 'l1')?.data.status).toBe('approved');
  });

  it('lost-response staff payment retries reconcile with owner settlement', async () => {
    const d = await post('/v1/login', { phone: '9844444444', pin: '5555' });
    const oldAt = new Date(Date.now() - 10000).toISOString();
    const ownerAt = new Date(Date.now() - 5000).toISOString();
    const futureAt = new Date(Date.now() + 10000).toISOString();
    const pay = { id: 'retry-pay', shopId: 'shop1', amount: 450, mode: 'cash',
      collectedBy: 'dr1', allocations: [], advance: 450, date: oldAt.slice(0, 10),
      status: 'ok', settled: false, updatedAt: oldAt };
    const original = [{ table: 'payments', id: pay.id, updatedAt: oldAt, data: pay }];
    const initial = await post('/v1/sync', { cursor: 0, changes: original }, d.body.token);
    expect(initial.body.accepted).toContain('payments|retry-pay');
    const ownerWrite = await post('/v1/sync', { cursor: 0, changes: [{
      table: 'payments', id: pay.id, updatedAt: ownerAt,
      data: { ...pay, settled: true, updatedAt: ownerAt }
    }] }, owner.token);
    expect(ownerWrite.body.accepted).toContain('payments|retry-pay');
    const retry = await post('/v1/sync', { cursor: ownerWrite.body.cursor, changes: original }, d.body.token);
    expect(retry.body.accepted).toContain('payments|retry-pay');
    expect(retry.body.changes.find((x: { id: string }) => x.id === 'retry-pay')?.data.settled).toBe(true);
    const bad = await post('/v1/sync', { cursor: ownerWrite.body.cursor, changes: [{
      table: 'payments', id: pay.id, updatedAt: futureAt,
      data: { ...pay, amount: 999, updatedAt: futureAt }
    }] }, d.body.token);
    expect(bad.body.rejected).toContain('payments|retry-pay');
  });

  it('TESRAX report counts: each phone writes only its own, so the pilot numbers cannot be faked (11 Nov 2026)', async () => {
    const now = new Date().toISOString(), day = now.slice(0, 10);
    const d = await post('/v1/login', { phone: '9844444444', pin: '5555' }); // the driver from the test above
    const mine = { id: `dr1|${day}`, day, staffId: 'dr1', role: 'delivery', n: 3, missed: 0, updatedAt: now };
    const push = await post('/v1/sync', { cursor: 0, changes: [
      { table: 'tesraxDays', id: mine.id, updatedAt: now, data: mine },
      { table: 'tesraxDays', id: `sm1|${day}`, updatedAt: now, data: { ...mine, id: `sm1|${day}`, staffId: 'sm1' } }, // someone else's
      { table: 'tesraxDays', id: `x|${day}`, updatedAt: now, data: { ...mine, id: `x|${day}` } },                    // id does not match
    ] }, d.body.token);
    expect(push.body.rejected).toEqual([`tesraxDays|sm1|${day}`, `tesraxDays|x|${day}`]);
    // the owner reads every staff's counts
    const op = await post('/v1/sync', { cursor: 0, changes: [] }, owner.token);
    expect(op.body.changes.find((c: { id: string }) => c.id === mine.id)?.data.n).toBe(3);
  });

  it('many phones of one distributor syncing at the same moment never freeze the server (capacity test, 9 Nov 2026)', async () => {
    // the sync held its distributor lock while asking the pool for a second connection: with every pooled connection
    // waiting on that same lock, nothing could ever finish
    const s = await post('/v1/signup', { firmName: 'Busy Agencies', ownerName: 'Owner', phone: '9877700001', pin: '1111' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    const now = new Date().toISOString();
    const res = await Promise.race([
      Promise.all(Array.from({ length: 40 }, (_, k) => post('/v1/sync', { cursor: 0, changes: [{ table: 'orders', id: `busy-${k}`, updatedAt: now, data: { n: k } }] }, s.body.token))),
      new Promise<'frozen'>(r => setTimeout(() => r('frozen'), 20000)),
    ]);
    expect(res).not.toBe('frozen');
    expect((res as { status: number; body: unknown }[]).filter(r => r.status !== 200).map(r => `${r.status} ${JSON.stringify(r.body)}`)).toEqual([]);
  }, 30000);

  it('a new phone downloads only recent history-log rows; the full log stays on the server (working-app test, 9 Nov 2026)', async () => {
    // a month of a busy distributor = ~120,000 log rows (80% of all data): no phone needs them all
    const s = await post('/v1/signup', { firmName: 'Log Agencies', ownerName: 'Owner', phone: '9877700002', pin: '1111' });
    const old = new Date(Date.now() - 10 * 86400000).toISOString(), now = new Date().toISOString();
    await post('/v1/sync', { cursor: 0, changes: [
      { table: 'audit', id: 'a-old', updatedAt: old, data: { at: old, action: 'old' } },
      { table: 'audit', id: 'a-new', updatedAt: now, data: { at: now, action: 'new' } },
      { table: 'shops', id: 'sh-old', updatedAt: old, data: { name: 'Old shop' } },
    ] }, s.body.token);
    const pull = await post('/v1/sync', { cursor: 0, changes: [] }, s.body.token);
    const got = pull.body.changes.map((c: { id: string }) => c.id);
    expect(got).toContain('a-new');
    expect(got).toContain('sh-old'); // every other table: everything
    expect(got).not.toContain('a-old');
    const kept = await pool.query("SELECT count(*)::int n FROM docs WHERE tbl='audit' AND tenant_id=$1", [s.body.tenantId]);
    expect(kept.rows[0].n).toBe(2);
  });

  it('issues bill numbers on the server, never twice', async () => {
    const a = await post('/v1/number', { kind: 'bill', count: 2 }, owner.token);
    const b = await post('/v1/number', { kind: 'bill' }, owner.token);
    expect(a.body.first).toBe(1); expect(b.body.first).toBe(3);
    const d = await post('/v1/login', { phone: '9844444444', pin: '5555' });
    expect((await post('/v1/number', { kind: 'bill' }, d.body.token)).status).toBe(403);
  });

  it('one phone under two distributors picks the firm', async () => {
    const now = new Date().toISOString();
    const other = await post('/v1/login', { phone: '9833333333', pin: '1111' });
    await post('/v1/sync', { cursor: 0, changes: [{ table: 'staff', id: 'sm2', updatedAt: now, data: { id: 'sm2', name: 'Karthik', phone: '9844444444', role: 'salesman', pin: '5555', active: true, updatedAt: now } }] }, other.body.token);
    const l = await post('/v1/login', { phone: '9844444444', pin: '5555' });
    expect(l.body.choose?.length).toBe(2);
    const l2 = await post('/v1/login', { phone: '9844444444', pin: '5555', tenantId: other.body.tenantId });
    expect(l2.body.tenantId).toBe(other.body.tenantId);
  });

  it('locks a phone after 5 wrong PINs', async () => {
    for (let i = 0; i < 5; i++) await post('/v1/login', { phone: '9833333333', pin: '0000' });
    expect((await post('/v1/login', { phone: '9833333333', pin: '1111' })).status).toBe(429);
  });

  it('scan says clearly when AI is not configured', async () => {
    const r = await post('/v1/scan', { kind: 'purchase', file: 'data:image/jpeg;base64,AAAA' }, owner.token);
    expect(r.status).toBe(503);
  });
});
