// Counting tries per key (a phone, a place) in Postgres: every server instance sees the same counts, a restart forgets nothing.
import type pg from 'pg';

/** is any of these keys locked right now? */
export async function isLocked(pool: pg.Pool, keys: string[]): Promise<boolean> {
  return !!(await pool.query('SELECT 1 FROM rate_hits WHERE key = ANY($1) AND until > now() LIMIT 1', [keys])).rowCount;
}

/** count one try against a key: `max` tries within `windowMin` minutes → locked for `lockMin` minutes. True when it locked. */
export async function hit(pool: pg.Pool, key: string, max: number, windowMin: number, lockMin: number): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO rate_hits(key, n, since) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       n = CASE WHEN rate_hits.since < now() - make_interval(mins => $2) THEN 1 ELSE rate_hits.n + 1 END,
       since = CASE WHEN rate_hits.since < now() - make_interval(mins => $2) THEN now() ELSE rate_hits.since END
     RETURNING n`, [key, windowMin]);
  if (Number(r.rows[0].n) < max) return false;
  await pool.query('UPDATE rate_hits SET n = 0, since = now(), until = now() + make_interval(mins => $2) WHERE key = $1', [key, lockMin]);
  return true;
}

export async function clearHits(pool: pg.Pool, keys: string[]) {
  await pool.query('DELETE FROM rate_hits WHERE key = ANY($1)', [keys]);
}

/**
 * Requests per minute, per key (a place, a login), counted in this server's memory: a sliding window of one minute.
 * The server is one machine (Hostinger plan), so memory is the right place for the per-request counter; wrong PINs and
 * wrong admin/cron keys are counted in Postgres above (they must survive a restart).
 */
const windows = new Map<string, number[]>();
export function tooMany(key: string, perMinute: number, now = Date.now()): boolean {
  const a = windows.get(key) ?? [];
  while (a.length && a[0] <= now - 60000) a.shift();
  if (a.length >= perMinute) { windows.set(key, a); return true; }
  a.push(now); windows.set(key, a);
  if (windows.size > 50000) for (const [k, v] of windows) if (!v.length || v[v.length - 1] <= now - 60000) windows.delete(k); // forget idle keys
  return false;
}
export function resetRateWindows() { windows.clear(); }
