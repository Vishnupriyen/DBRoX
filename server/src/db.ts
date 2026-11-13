import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.DB_POOL ?? 10) });

export async function migrate(p: pg.Pool = pool) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db');
  await p.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  await p.query('SELECT pg_advisory_lock(727001)'); // several Cloud Run instances may start at once: one migrates, others wait
  try {
  const done = new Set((await p.query('SELECT version FROM schema_migrations')).rows.map(r => r.version));
  for (const f of readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(dir, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [f]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  // the limited role's rights cover every table, including ones a migration just added (activity log stays read-only)
  if ((await p.query(`SELECT to_regproc('hanubix_grants') AS f`)).rows[0].f) await p.query('SELECT hanubix_grants()');
  } finally { await p.query('SELECT pg_advisory_unlock(727001)'); }
}

/**
 * The pool every request uses: the limited role hanubix_app (security standard, 13 Nov 2026). The owner pool (DATABASE_URL)
 * runs the migrations and then gives hanubix_app its password (DB_APP_PASSWORD, in deploy/.env). Without that setting
 * (development, tests) the owner pool is used; production refuses to start without it (index.ts).
 */
export async function appPool(owner: pg.Pool = pool): Promise<pg.Pool> {
  const pw = process.env.DB_APP_PASSWORD ?? '';
  if (!pw) return owner;
  const lit = (await owner.query('SELECT quote_literal($1) AS q', [pw])).rows[0].q as string;
  await owner.query(`ALTER ROLE hanubix_app WITH LOGIN PASSWORD ${lit}`);
  const u = new URL(config.databaseUrl);
  u.username = 'hanubix_app'; u.password = encodeURIComponent(pw);
  return new pg.Pool({ connectionString: u.toString(), max: Number(process.env.DB_POOL ?? 10) });
}
