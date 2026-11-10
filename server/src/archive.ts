// Old records move out of the live table into compressed month bundles (docs_archive). The live table stays small, so
// sync, reports and a new phone's first download stay fast however many years a business runs; nothing is deleted.
//  - a distributor's records: kept live for this financial year and the last one (GST annual return, audits), then moved
//  - a brand's copies of distributor bills: kept live 120 days (its totals live on in the monthly figures), then moved
// A record edited after it was moved simply becomes live again; the live copy always wins over the bundle.
import type pg from 'pg';
import { gzipSync, gunzipSync } from 'node:zlib';

type Doc = Record<string, unknown> & { id: string };
/** record tables that only ever grow (settings, products, shops … are never moved) */
export const DB_ARCHIVE = ['invoices', 'creditNotes', 'payments', 'purchases', 'expenses', 'bankLines', 'orders', 'audit', 'visits', 'checkIns',
  'trips', 'dayCloses', 'dayPlans', 'liteEntries', 'claimEntries', 'receipts'];
export const CO_ARCHIVE = ['secondary', 'secondaryReturns'];
const PART = 5000;

/** first day of the last financial year (India: April to March), as YYYY-MM-DD */
export function lastFyStart(today: string) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return `${(m >= 4 ? y : y - 1) - 1}-04-01`;
}
const ist = (t = Date.now()) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);

/** the date a record moves by: its own date if it has one, otherwise when it was last changed */
const DATE = `coalesce(nullif(data->>'date', ''), to_char(updated_at + interval '5 hours 30 minutes', 'YYYY-MM-DD'))`;

/** move one tenant's old records; returns how many moved */
export async function archiveTenant(pool: pg.Pool, tenant: string, kind: 'company' | 'distributor', today = ist()) {
  const tables = kind === 'company' ? CO_ARCHIVE : DB_ARCHIVE;
  const cutoff = kind === 'company' ? ist(Date.parse(today) - 120 * 86400e3) : lastFyStart(today);
  let moved = 0;
  for (const tbl of tables) {
    for (;;) {
      const client = await pool.connect();
      let n = 0;
      try {
        await client.query('BEGIN');
        // the same lock every sync and relay write takes: nothing changes these records while they move
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenant]);
        const rows = (await client.query(`SELECT id, data, updated_at, left(${DATE}, 7) m FROM docs WHERE tenant_id=$1 AND tbl=$2 AND ${DATE} < $3 LIMIT ${PART}`,
          [tenant, tbl, cutoff])).rows as { id: string; data: Doc; updated_at: Date; m: string }[];
        n = rows.length;
        if (n) {
          const byMonth = new Map<string, typeof rows>();
          for (const r of rows) { const l = byMonth.get(r.m) ?? []; l.push(r); byMonth.set(r.m, l); }
          for (const [m, list] of byMonth) {
            const part = Number((await client.query(`SELECT coalesce(max(part), 0) + 1 p FROM docs_archive WHERE tenant_id=$1 AND tbl=$2 AND month=$3`, [tenant, tbl, m])).rows[0].p);
            const zip = gzipSync(Buffer.from(JSON.stringify(list.map(r => ({ id: r.id, updatedAt: new Date(r.updated_at).toISOString(), data: r.data })))));
            await client.query(`INSERT INTO docs_archive(tenant_id, tbl, month, part, n, bytes, data) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [tenant, tbl, m, part, list.length, zip.length, zip]);
            await client.query(`INSERT INTO docs_archive_ids(tenant_id, tbl, id, month, part) SELECT $1, $2, unnest($3::text[]), $4, $5
              ON CONFLICT (tenant_id, tbl, id) DO UPDATE SET month = EXCLUDED.month, part = EXCLUDED.part`, [tenant, tbl, list.map(r => r.id), m, part]);
          }
          await client.query(`DELETE FROM docs WHERE tenant_id=$1 AND tbl=$2 AND id = ANY($3)`, [tenant, tbl, rows.map(r => r.id)]);
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      moved += n;
      if (n < PART) break;
    }
  }
  return moved;
}

/** the daily job: every tenant */
export async function archiveAll(pool: pg.Pool, today = ist()) {
  const ts = (await pool.query(`SELECT id, coalesce(kind, 'distributor') kind FROM tenants`)).rows as { id: string; kind: 'company' | 'distributor' }[];
  let moved = 0;
  for (const t of ts) moved += await archiveTenant(pool, t.id, t.kind, today);
  return { tenants: ts.length, moved };
}

type Bundle = { id: string; updatedAt: string; data: Doc }[];
const open = (b: Buffer) => JSON.parse(gunzipSync(b).toString()) as Bundle;

/** what is in the archive: months and counts per table */
export async function archiveMonths(pool: pg.Pool, tenant: string, tables: string[]) {
  return (await pool.query(`SELECT tbl, month, sum(n)::int n FROM docs_archive WHERE tenant_id=$1 AND tbl = ANY($2) GROUP BY 1, 2 ORDER BY 2 DESC, 1`, [tenant, tables])).rows as { tbl: string; month: string; n: number }[];
}

/** one month of one table; a record that came back to life (edited later) is left out — the phone already has the live copy */
export async function archiveMonth(pool: pg.Pool, tenant: string, tbl: string, month: string) {
  const parts = (await pool.query(`SELECT part, data FROM docs_archive WHERE tenant_id=$1 AND tbl=$2 AND month=$3 ORDER BY part`, [tenant, tbl, month])).rows;
  const out = new Map<string, Bundle[number]>();
  for (const p of parts) for (const r of open(p.data)) {
    const was = out.get(r.id);
    if (!was || was.updatedAt <= r.updatedAt) out.set(r.id, r);
  }
  // only what the index still points here (an older copy left in an earlier bundle is not returned)
  const here = new Set((await pool.query(`SELECT id FROM docs_archive_ids WHERE tenant_id=$1 AND tbl=$2 AND month=$3`, [tenant, tbl, month])).rows.map(r => r.id as string));
  const live = new Set((await pool.query(`SELECT id FROM docs WHERE tenant_id=$1 AND tbl=$2 AND id = ANY($3)`, [tenant, tbl, [...out.keys()]])).rows.map(r => r.id as string));
  return [...out.values()].filter(r => here.has(r.id) && !live.has(r.id));
}

/** a few old records by id (a claim check on an old bill, or the last version of a bill edited after it was moved) */
export async function archivedByIds(q: pg.Pool | pg.PoolClient, tenant: string, tbl: string, ids: string[]) {
  if (!ids.length) return new Map<string, Doc>();
  const where = (await q.query(`SELECT id, month, part FROM docs_archive_ids WHERE tenant_id=$1 AND tbl=$2 AND id = ANY($3)`, [tenant, tbl, ids])).rows as { id: string; month: string; part: number }[];
  const want = new Set(where.map(w => w.id)), found = new Map<string, Doc>();
  const bundles = [...new Set(where.map(w => `${w.month}|${w.part}`))];
  for (const b of bundles) {
    const [month, part] = b.split('|');
    const row = (await q.query(`SELECT data FROM docs_archive WHERE tenant_id=$1 AND tbl=$2 AND month=$3 AND part=$4`, [tenant, tbl, month, Number(part)])).rows[0];
    if (row) for (const r of open(row.data)) if (want.has(r.id)) found.set(r.id, r.data);
  }
  return found;
}
