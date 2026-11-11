// A real Hanubix server (Fastify + its own Postgres) for tests outside this folder: the app's chaos laws run several
// phones against it (app/tests/laws.test.ts), so "the server's qty" in a law is the real server's, never a model of it.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort } from './fixtures.js';

export async function startServer() {
  // the relay's one source is shared/relay.ts (normally copied by the server's own scripts)
  const gen = new URL('../src/gen/relay.ts', import.meta.url);
  if (!existsSync(gen)) { mkdirSync(new URL('../src/gen/', import.meta.url), { recursive: true }); copyFileSync(new URL('../../shared/relay.ts', import.meta.url), gen); }
  const port = await freePort();
  const pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'hanubix-pg-harness-' + Date.now() + '-' + port), user: 'postgres', password: 'pw', port, persistent: false });
  await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
  const pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox` });
  pool.on('error', () => {});
  const { migrate } = await import('../src/db.js'); await migrate(pool);
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp(pool);
  /** a phone's fetch, answered by this server (no network) */
  const fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const r = await app.inject({ method: (init?.method ?? 'GET') as 'POST', url: new URL(url).pathname, payload: init?.body, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } });
  };
  const query = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
  const stop = async () => { await app.close(); await pool.end(); await pgServer.stop(); };
  return { app, fetch, query, stop };
}
