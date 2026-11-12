// Updates without stopping the business (12 Nov 2026). For a day after an app update, old and new phones share one server:
// a phone is sent only the tables it says it knows, so an older phone never meets a table it can't store. And a server
// rolled back to its previous version must still run on the database the newer one left (migrations only ever add).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { freePort } from './fixtures.js';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pgServer: EmbeddedPostgres;
let pool: pg.Pool;
type App = Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
let app: App;
const port = await freePort();

beforeAll(async () => {
  pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'hanubix-pg-update-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false });
  await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
  pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox` });
  pool.on('error', () => {});
  const { migrate } = await import('../src/db.js'); await migrate(pool);
  const { buildApp } = await import('../src/app.js'); app = await buildApp(pool);
}, 120000);
afterAll(async () => { await app?.close(); await pool?.end(); await pgServer?.stop(); });

const post = async (url: string, body: unknown, token?: string) => {
  const r = await app.inject({ method: 'POST', url, payload: body as object, headers: { 'x-forwarded-for': '10.7.7.7', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  return { status: r.statusCode, body: r.json() };
};
const now = () => new Date().toISOString();

describe('old and new phones on one server', () => {
  let owner = '';
  beforeAll(async () => {
    const s = await post('/v1/signup', { firmName: 'Update Agencies', ownerName: 'Owner', phone: '9700000301', pin: '4826' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    owner = s.body.token;
    const w = await post('/v1/sync', { cursor: 0, changes: [
      { table: 'shops', id: 'sh1', updatedAt: now(), data: { id: 'sh1', name: 'Kumar Stores', area: 'A' } },
      { table: 'boostRequests', id: 'br1', updatedAt: now(), data: { id: 'br1', kind: 'gst', status: 'open', by: 'x' } },
    ] }, owner);
    expect(w.body.accepted.length).toBe(2);
  });

  it('a phone that lists its tables is sent only those', async () => {
    const r = await post('/v1/sync', { cursor: 0, changes: [], tables: ['shops', 'settings', 'staff'] }, owner);
    const got = new Set(r.body.changes.map((c: { table: string }) => c.table));
    expect(got.has('shops')).toBe(true);
    expect(got.has('boostRequests')).toBe(false);
  });

  it('a catch-up for one new table returns just that table, from the start', async () => {
    const r = await post('/v1/sync', { cursor: 0, changes: [], tables: ['boostRequests'] }, owner);
    expect(r.body.changes.map((c: { id: string }) => c.id)).toEqual(['br1']);
  });

  it('a phone that does not list its tables (today\'s app) still gets everything, and a list never widens what a role may read', async () => {
    const all = await post('/v1/sync', { cursor: 0, changes: [] }, owner);
    expect(new Set(all.body.changes.map((c: { table: string }) => c.table))).toEqual(new Set(['settings', 'staff', 'shops', 'boostRequests'].filter(t => all.body.changes.some((c: { table: string }) => c.table === t))));
    expect(all.body.changes.some((c: { table: string }) => c.table === 'boostRequests')).toBe(true);
    const junk = await post('/v1/sync', { cursor: 0, changes: [], tables: 'everything' }, owner);
    expect(junk.status).toBe(200);
    expect(junk.body.changes.length).toBe(all.body.changes.length);
  });
});

describe('a rolled-back server still runs on the newer database', () => {
  // migrations up to 012 were written before this rule; from 013 on they only add (tables, columns with defaults, indexes).
  // Dropping or renaming would break the previous server version during a rollback, and DELETE/TRUNCATE could lose records.
  it('every new migration only adds', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db');
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
      if (Number(f.slice(0, 3)) <= 12) continue;
      const sql = readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, '');
      for (const re of [/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i, /\bRENAME\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, /\bADD\s+COLUMN\b[^;]*\bNOT\s+NULL\b(?![^;]*\bDEFAULT\b)/i])
        if (re.test(sql)) bad.push(`${f}: ${re.source}`);
    }
    expect(bad).toEqual([]);
  });
});
