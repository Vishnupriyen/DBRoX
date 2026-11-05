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

  it('locks a phone after 5 wrong PINs', async () => {
    for (let i = 0; i < 5; i++) await post('/v1/login', { phone: '9833333333', pin: '0000' });
    expect((await post('/v1/login', { phone: '9833333333', pin: '1111' })).status).toBe(429);
  });

  it('scan says clearly when AI is not configured', async () => {
    const r = await post('/v1/scan', { kind: 'purchase', file: 'data:image/jpeg;base64,AAAA' }, owner.token);
    expect(r.status).toBe(503);
  });
});
