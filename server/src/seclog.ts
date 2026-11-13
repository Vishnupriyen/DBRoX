// The activity log (security standard, 13 Nov 2026): who did what, when, from where — append-only and hash-chained in
// Postgres (seclog_add / seclog_verify in db/013_security.sql). Never any personal data in it: the actor is an opaque user
// id, a phone number only as a keyed hash, and no PIN, token, password or document body ever reaches `detail`.
import type pg from 'pg';
import { createHmac, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { config } from './config.js';

export interface SecEvent {
  tenant?: string | null; actor?: string | null; role?: string | null;
  event: string; target?: string | null; ip?: string | null; ok?: boolean; detail?: Record<string, unknown>;
}

/** keys that never go into the log, whatever a caller passes */
const SECRET_KEY = /pin|token|password|passwd|secret|otp|phone|mobile|email|authorization|cookie|key$|file|photo|data|body|lines/i;
/** keeps short plain facts only: no secrets, no long text (a document body), no nested records */
export function safeDetail(d: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d ?? {})) {
    if (SECRET_KEY.test(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (typeof v === 'string') { if (!/^\d{4,}$/.test(v) && !/^Bearer\s|\.[A-Za-z0-9_-]{20,}$/.test(v)) out[k] = v.slice(0, 80); }
    else if (Array.isArray(v) && v.every(x => typeof x === 'string' || typeof x === 'number')) out[k] = v.slice(0, 20).map(x => typeof x === 'string' ? x.slice(0, 40) : x);
  }
  return out;
}

/** a phone number as the log may hold it: a short keyed hash (the same phone always gives the same mark; it can't be read back) */
export const phoneMark = (phone: string) => 'ph:' + createHmac('sha256', config.jwtSecret).update('phone:' + phone).digest('base64url').slice(0, 12);

let failures = 0;
export const logFailures = () => failures;
/** writes one row. A log that cannot be written never blocks the person's work: it is counted and reported (monitor) */
export async function logEvent(pool: pg.Pool, e: SecEvent): Promise<void> {
  try {
    await pool.query('SELECT seclog_add($1, $2, $3, $4, $5, $6, $7, $8)', [e.tenant ?? null, e.actor ?? null, e.role ?? null, e.event,
      e.target ? String(e.target).slice(0, 120) : null, e.ip ?? null, e.ok ?? true, JSON.stringify(safeDetail(e.detail))]);
  } catch (err) {
    failures++;
    console.error(JSON.stringify({ msg: 'security log write failed', code: (err as { code?: string }).code ?? 'error', event: e.event }));
  }
}

/** first row whose hash does not fit, or null when the chain is whole */
export async function verifyChain(pool: pg.Pool): Promise<number | null> {
  const r = (await pool.query('SELECT seclog_verify() AS id')).rows[0].id;
  return r === null ? null : Number(r);
}

/**
 * Retention: months of the log older than `keepMonths` are exported to security_log_archive (gzip JSON lines + sha256),
 * the export is read back and checked (rows, ids, last hash), and only then is the month's partition dropped.
 * Archived months older than `archiveYears` are removed. Runs as the database OWNER (the app's role cannot drop anything).
 */
export async function rotateLog(owner: pg.Pool, now = new Date(), keepMonths = 12, archiveYears = 5, dry = false) {
  const cut = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - keepMonths, 1));
  const parts = (await owner.query(`SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'security_log'::regclass AND c.relname ~ '^security_log_[0-9]{6}$' ORDER BY 1`)).rows.map(r => String(r.name));
  const archived: string[] = [];
  for (const p of parts) {
    const ym = p.slice(-6), month = `${ym.slice(0, 4)}-${ym.slice(4)}`;
    if (new Date(`${month}-01T00:00:00Z`) >= cut) continue;
    if (dry) { archived.push(month); continue; }
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(727013)'); // nothing is added to the chain while a month leaves it
      const rows = (await client.query(`SELECT id, at, tenant_id, actor, actor_role, event, target, ip, ok, detail, encode(prev_hash, 'hex') AS prev_hash, encode(hash, 'hex') AS hash FROM ${p} ORDER BY id`)).rows;
      const text = rows.map(r => JSON.stringify(r)).join('\n');
      const gz = gzipSync(Buffer.from(text));
      const sha = createHash('sha256').update(gz).digest();
      const last = rows[rows.length - 1];
      await client.query(`INSERT INTO security_log_archive(month, rows, first_id, last_id, last_hash, sha256, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (month) DO NOTHING`, [month, rows.length, rows[0]?.id ?? null, last?.id ?? null, last ? Buffer.from(last.hash, 'hex') : null, sha, gz]);
      // read back what was written and check it before anything is dropped
      const back = (await client.query('SELECT rows, last_id, last_hash, sha256, data FROM security_log_archive WHERE month=$1', [month])).rows[0];
      const lines = gunzipSync(back.data).toString().split('\n').filter(Boolean);
      const okBack = back && Number(back.rows) === rows.length && lines.length === rows.length && createHash('sha256').update(back.data).digest().equals(back.sha256)
        && (!last || (Number(back.last_id) === Number(last.id) && Buffer.from(back.last_hash).toString('hex') === last.hash));
      if (!okBack) throw new Error(`log month ${month}: the export did not read back — kept`);
      await client.query(`ALTER TABLE security_log DETACH PARTITION ${p}`);
      await client.query(`DROP TABLE ${p}`);
      await client.query('COMMIT');
      archived.push(month);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  const oldest = new Date(Date.UTC(now.getUTCFullYear() - archiveYears, now.getUTCMonth(), 1)).toISOString().slice(0, 7);
  const expired = dry ? Number((await owner.query('SELECT count(*)::int n FROM security_log_archive WHERE month < $1', [oldest])).rows[0].n)
    : (await owner.query('DELETE FROM security_log_archive WHERE month < $1', [oldest])).rowCount ?? 0;
  return { archivedMonths: archived, archiveRemoved: expired };
}
