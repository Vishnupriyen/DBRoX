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

describe('security headers (free scan, 13 Nov 2026)', () => {
  it('every reply tells browsers: no sniffing, no framing, HTTPS only, no referrer', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(String(r.headers['strict-transport-security'])).toMatch(/max-age=\d{7,}/);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('a rolled-back server still runs on the newer database', () => {
  // migrations up to 012 were written before this rule; from 013 on they only add (tables, columns with defaults, indexes).
  // Dropping or renaming would break the previous server version during a rollback, and DELETE/TRUNCATE could lose records.
  // anything that removes, renames, rewrites or tightens: an older server's reads or inserts could fail on it
  const RISKY = [/\bDROP\s+(TABLE|COLUMN|SCHEMA|CONSTRAINT|DEFAULT|NOT\s+NULL|FUNCTION|VIEW|TYPE|TRIGGER)\b/i, /\bRENAME\b/i, /\bTRUNCATE\b/i,
    /\bDELETE\s+FROM\b/i, /\bUPDATE\s+\w+(\.\w+)?\s+SET\b/i, /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, /\bSET\s+NOT\s+NULL\b/i,
    /\bADD\s+(CONSTRAINT|UNIQUE|CHECK|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i, /\bADD\s+COLUMN\b[^;]*\bNOT\s+NULL\b(?![^;]*\bDEFAULT\b)/i];
  const risky = (sql: string) => RISKY.filter(re => re.test(sql.replace(/--.*$/gm, ''))).map(re => re.source);
  it('the check itself catches each risky change, and lets additions through', () => {
    for (const bad of ['DROP TABLE x;', 'ALTER TABLE x DROP COLUMN y;', 'ALTER TABLE x RENAME TO z;', 'TRUNCATE x;', 'DELETE FROM x;',
      'UPDATE docs SET data = 1;', 'ALTER TABLE x ALTER COLUMN y TYPE int;', 'ALTER TABLE x ALTER COLUMN y SET NOT NULL;',
      'ALTER TABLE x ADD CONSTRAINT c UNIQUE (y);', 'ALTER TABLE x ADD CHECK (y > 0);', 'ALTER TABLE x DROP CONSTRAINT c;',
      'ALTER TABLE x ALTER COLUMN y DROP DEFAULT;', 'ALTER TABLE x ADD COLUMN y int NOT NULL;', 'DROP VIEW v;'])
      expect(risky(bad), bad).not.toEqual([]);
    for (const ok of ['CREATE TABLE IF NOT EXISTS x (id text PRIMARY KEY);', 'ALTER TABLE x ADD COLUMN IF NOT EXISTS y int NOT NULL DEFAULT 0;',
      'ALTER TABLE x ADD COLUMN y text;', 'CREATE INDEX IF NOT EXISTS i ON x (y);', '-- DROP TABLE x (a comment)'])
      expect(risky(ok), ok).toEqual([]);
  });
  it('every new migration only adds', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db');
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
      if (Number(f.slice(0, 3)) <= 12) continue;
      for (const r of risky(readFileSync(join(dir, f), 'utf8'))) bad.push(`${f}: ${r}`);
    }
    expect(bad).toEqual([]);
  });
});
