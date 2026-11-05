import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.DB_POOL ?? 10) });

export async function migrate(p: pg.Pool = pool) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db');
  await p.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
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
}
