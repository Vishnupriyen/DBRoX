// Company ⇄ distributor links on the server. The relay (src/gen/relay.ts, copied from shared/relay.ts) decides what
// may cross; this file only reads and writes the two tenants' documents and keeps the links table.
import type pg from 'pg';
import { COMPANY_PRODUCT_FIELDS, companyToDb, dbToCompany, linkInitial, RELAY_ONLY, type Doc, type Link, type Store, type Write } from './gen/relay.js';
import { istToday } from './licence.js';
import { kickCover } from './reports.js';
import { archivedByIds } from './archive.js';

type Q = pg.Pool | pg.PoolClient;

export function storeFor(q: Q, tenant: string): Store & { all(tbl: string): Promise<Doc[]> } {
  return {
    async get(tbl, id) { return (await q.query('SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND id=$3', [tenant, tbl, id])).rows[0]?.data; },
    async find(tbl, field, value) {
      return (await q.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND data->>$3 = $4`, [tenant, tbl, field, String(value)])).rows.map(r => r.data);
    },
    async all(tbl) { return (await q.query('SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2', [tenant, tbl])).rows.map(r => r.data); },
  };
}

type Line = { productId?: string; qty?: number; freeQty?: number; taxable?: number; amount?: number };
type Acc = { daily: Map<string, { q: number; v: number }>; month: Map<string, { v: number; r: number; b: number }>; shop: Map<string, number> };
/** a bill's contribution to the company's totals (+1 to add it, -1 to take an old version out), summed for a batch */
function roll(acc: Acc, tbl: string, d: Doc | undefined, sign: 1 | -1) {
  if (!d || (tbl !== 'secondary' && tbl !== 'secondaryReturns')) return;
  if (tbl === 'secondary' && d.cancelled) return;
  const day = String(d.date ?? '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const link = String(d.dbLinkId ?? ''), month = day.slice(0, 7), ret = tbl === 'secondaryReturns';
  for (const l of (d.lines as Line[] | undefined) ?? []) {
    const k = `${link}|${day}|${String(l.productId ?? '')}`; const x = acc.daily.get(k) ?? { q: 0, v: 0 };
    x.q += sign * ((ret ? -1 : 1) * Number(l.qty ?? 0) + (ret ? 0 : Number(l.freeQty ?? 0)));
    x.v += sign * (ret ? -Number(l.amount ?? 0) : Number(l.taxable ?? 0)); acc.daily.set(k, x);
  }
  const total = ret ? Number(d.total ?? 0) : Number(d.taxable ?? 0);
  const mk = `${link}|${month}`; const m = acc.month.get(mk) ?? { v: 0, r: 0, b: 0 };
  if (ret) m.r += sign * total; else { m.v += sign * total; m.b += sign; } acc.month.set(mk, m);
  if (!ret && d.shopId) { const sk = `${link}|${month}|${String(d.shopId)}`; acc.shop.set(sk, (acc.shop.get(sk) ?? 0) + sign * total); }
}

/** write relay output into a tenant, under that tenant's writer lock so its phones never skip a version. One query per
 *  kind per batch (not several per bill): the stress test showed the per-bill version was the slowest step. */
export async function writeInto(pool: pg.Pool, tenant: string, writes: Write[]) {
  if (!writes.length) return;
  const changed = new Set<string>(); // distributor|product whose stock figures move
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenant]);
    const now = new Date().toISOString();
    // stock at distributors lives in its own compact table (never a stored record per product)
    const stock = new Map<string, Doc>(); for (const w of writes) if (w.tbl === 'dbStock') stock.set(`${w.doc.dbLinkId}|${w.doc.productId}`, w.doc);
    if (stock.size) {
      const v = [...stock.values()];
      await client.query(`INSERT INTO link_stock(tenant_id, link_id, product_id, name, qty, near_expiry, expired, as_of)
        SELECT $1, l, p, n, q, ne, ex, a::date FROM unnest($2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::text[]) AS x(l, p, n, q, ne, ex, a)
        ON CONFLICT (tenant_id, link_id, product_id) DO UPDATE SET name=EXCLUDED.name, qty=EXCLUDED.qty, near_expiry=EXCLUDED.near_expiry, expired=EXCLUDED.expired, as_of=EXCLUDED.as_of`,
        [tenant, v.map(d => String(d.dbLinkId)), v.map(d => String(d.productId)), v.map(d => (d.name as string) ?? null), v.map(d => Number(d.qty ?? 0)), v.map(d => Number(d.nearExpiry ?? 0)), v.map(d => Number(d.expired ?? 0)), v.map(d => (d.asOf as string) ?? null)]);
    }
    for (const d of stock.values()) changed.add(`${d.dbLinkId}|${d.productId}`);
    // records: the last version of each in this batch
    const last = new Map<string, { tbl: string; data: Doc; t: string }>();
    for (const w of writes) {
      if (w.tbl === 'dbStock') continue;
      // keepTime: the record keeps its own time, so a newer edit on the distributor's phone still wins (version still moves)
      const t = w.keepTime && typeof w.doc.updatedAt === 'string' ? w.doc.updatedAt : now;
      const data = { ...w.doc, tenantId: tenant, updatedAt: t, createdAt: w.doc.createdAt ?? now } as Doc;
      delete (data as Record<string, unknown>).dirty;
      last.set(`${w.tbl}|${w.doc.id}`, { tbl: w.tbl, data, t });
    }
    const recs = [...last.values()];
    // the company's report totals: old versions out, new in (same transaction, same lock as the records)
    const bills = recs.filter(r => r.tbl === 'secondary' || r.tbl === 'secondaryReturns');
    if (bills.length) {
      const olds = new Map((await client.query(`SELECT tbl, id, data FROM docs WHERE tenant_id=$1 AND tbl = ANY($2) AND id = ANY($3)`,
        [tenant, [...new Set(bills.map(b => b.tbl))], bills.map(b => b.data.id)])).rows.map(r => [`${r.tbl}|${r.id}`, r.data as Doc]));
      // a bill edited after it moved to the archive: its old version is taken out of the totals from the archive copy
      for (const t of new Set(bills.map(b => b.tbl))) {
        const gone = bills.filter(b => b.tbl === t && !olds.has(`${t}|${b.data.id}`)).map(b => String(b.data.id));
        for (const [id, d] of await archivedByIds(client, tenant, t, gone)) olds.set(`${t}|${id}`, d);
      }
      const acc: Acc = { daily: new Map(), month: new Map(), shop: new Map() };
      for (const b of bills) { roll(acc, b.tbl, olds.get(`${b.tbl}|${b.data.id}`), -1); roll(acc, b.tbl, b.data, 1); }
      const sp = (k: string) => k.split('|');
      const D = [...acc.daily].filter(([, x]) => x.q || x.v), M = [...acc.month].filter(([, x]) => x.v || x.r || x.b), S = [...acc.shop].filter(([, v]) => v);
      for (const [k] of D) { const [l, , p] = sp(k); changed.add(`${l}|${p}`); }
      if (D.length) await client.query(`INSERT INTO roll_daily(tenant_id, link_id, day, product_id, qty, value)
        SELECT $1, l, d::date, p, q, v FROM unnest($2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[]) AS x(l, d, p, q, v)
        ON CONFLICT (tenant_id, link_id, day, product_id) DO UPDATE SET qty = roll_daily.qty + EXCLUDED.qty, value = roll_daily.value + EXCLUDED.value`,
        [tenant, D.map(([k]) => sp(k)[0]), D.map(([k]) => sp(k)[1]), D.map(([k]) => sp(k)[2]), D.map(([, x]) => x.q), D.map(([, x]) => x.v)]);
      if (M.length) await client.query(`INSERT INTO roll_link_month(tenant_id, link_id, month, value, returns, bills)
        SELECT $1, l, m, v, r, b FROM unnest($2::text[], $3::text[], $4::numeric[], $5::numeric[], $6::int[]) AS x(l, m, v, r, b)
        ON CONFLICT (tenant_id, link_id, month) DO UPDATE SET value = roll_link_month.value + EXCLUDED.value, returns = roll_link_month.returns + EXCLUDED.returns, bills = roll_link_month.bills + EXCLUDED.bills`,
        [tenant, M.map(([k]) => sp(k)[0]), M.map(([k]) => sp(k)[1]), M.map(([, x]) => x.v), M.map(([, x]) => x.r), M.map(([, x]) => x.b)]);
      // per product and month, all distributors together (the products report never adds up daily rows)
      const PM = new Map<string, { q: number; v: number }>();
      for (const [k, x] of D) { const [, day, p] = sp(k); const pk = `${day.slice(0, 7)}|${p}`; const y = PM.get(pk) ?? { q: 0, v: 0 }; y.q += x.q; y.v += x.v; PM.set(pk, y); }
      const P = [...PM];
      if (P.length) await client.query(`INSERT INTO roll_product_month(tenant_id, month, product_id, qty, value)
        SELECT $1, m, p, q, v FROM unnest($2::text[], $3::text[], $4::numeric[], $5::numeric[]) AS x(m, p, q, v)
        ON CONFLICT (tenant_id, month, product_id) DO UPDATE SET qty = roll_product_month.qty + EXCLUDED.qty, value = roll_product_month.value + EXCLUDED.value`,
        [tenant, P.map(([k]) => sp(k)[0]), P.map(([k]) => sp(k)[1]), P.map(([, x]) => x.q), P.map(([, x]) => x.v)]);
      if (S.length) await client.query(`INSERT INTO roll_shop_month(tenant_id, link_id, month, shop_id, value)
        SELECT $1, l, m, s, v FROM unnest($2::text[], $3::text[], $4::text[], $5::numeric[]) AS x(l, m, s, v)
        ON CONFLICT (tenant_id, link_id, month, shop_id) DO UPDATE SET value = roll_shop_month.value + EXCLUDED.value`,
        [tenant, S.map(([k]) => sp(k)[0]), S.map(([k]) => sp(k)[1]), S.map(([k]) => sp(k).slice(2).join('|')), S.map(([, v]) => v)]);
    }
    if (recs.length) await client.query(
      `INSERT INTO docs(tenant_id,tbl,id,data,updated_at)
       SELECT $1, t, i, d::jsonb, u::timestamptz FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS x(t, i, d, u)
       ON CONFLICT (tenant_id,tbl,id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at, version=nextval('docs_version_seq')`,
      [tenant, recs.map(r => r.tbl), recs.map(r => r.data.id), recs.map(r => JSON.stringify(r.data)), recs.map(r => r.t)]);
    if (changed.size) await client.query(`INSERT INTO cover_dirty(tenant_id, link_id, product_id) SELECT $1, l, p FROM unnest($2::text[], $3::text[]) AS x(l, p)`,
      [tenant, [...changed].map(k => k.split('|')[0]), [...changed].map(k => k.split('|')[1])]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  if (changed.size) await kickCover(pool, tenant);
}

const rowToLink = (r: { id: string; company_tenant: string; db_tenant: string; company_id_in_db: string; status: Link['status'] }): Link =>
  ({ id: r.id, companyTenant: r.company_tenant, dbTenant: r.db_tenant, companyIdInDb: r.company_id_in_db, status: r.status });

export async function tenantKind(pool: pg.Pool, tenant: string): Promise<'company' | 'distributor'> {
  return (await pool.query('SELECT kind FROM tenants WHERE id=$1', [tenant])).rows[0]?.kind === 'company' ? 'company' : 'distributor';
}

/** may a phone of this tenant write this table? (relay-only tables are written by the relay alone) */
export function relayOnly(kind: 'company' | 'distributor', tbl: string) { return (RELAY_ONLY[kind] as readonly string[]).includes(tbl); }

/** One relay run's view of a tenant: a table is read once and indexed in memory, so mapping 2,000 products for 5,000
 *  distributors is 5,000 table reads, not 10 million single lookups. Lives for one batch only (never stale for long). */
export function cachedStore(q: Q, tenant: string) {
  const base = storeFor(q, tenant);
  const tables = new Map<string, Map<string, Doc>>();
  const idx = new Map<string, Map<string, Doc[]>>();
  const gets = new Map<string, Doc | undefined>();
  const load = async (tbl: string) => { let t = tables.get(tbl); if (!t) { t = new Map((await base.all(tbl)).map(d => [d.id, d])); tables.set(tbl, t); } return t; };
  const index = async (tbl: string, f: string) => {
    const k = `${tbl}|${f}`; let m = idx.get(k);
    if (!m) { m = new Map(); for (const d of (await load(tbl)).values()) { const v = String(d[f]); m.set(v, [...(m.get(v) ?? []), d]); } idx.set(k, m); }
    return m;
  };
  return {
    async get(tbl: string, id: string) { const t = tables.get(tbl); if (t) return t.get(id); const k = `${tbl}|${id}`; if (!gets.has(k)) gets.set(k, await base.get(tbl, id)); return gets.get(k); },
    async find(tbl: string, f: string, v: unknown) { return [...((await index(tbl, f)).get(String(v)) ?? [])]; },
    async all(tbl: string) { return [...(await load(tbl)).values()]; },
    /** a doc this run just wrote: later lookups in the same run see it */
    note(tbl: string, d: Doc) {
      const t = tables.get(tbl); const old = t?.get(d.id); t?.set(d.id, d); gets.set(`${tbl}|${d.id}`, d);
      for (const [k, m] of idx) { if (!k.startsWith(`${tbl}|`)) continue; const f = k.slice(tbl.length + 1);
        if (old) { const ov = String(old[f]); m.set(ov, (m.get(ov) ?? []).filter(x => x.id !== d.id)); }
        const nv = String(d[f]); m.set(nv, [...(m.get(nv) ?? []), d]); }
    },
  };
}
type Cached = ReturnType<typeof cachedStore>;

/** inside the sync's own transaction: note the saved changes for the relay (a crash after the save can't lose them) */
export async function queueRelay(client: pg.PoolClient, tenant: string, kind: 'company' | 'distributor', changed: { table: string; id: string }[]) {
  if (!changed.length) return false;
  // only tenants with a live link have anything to relay
  const has = (await client.query(`SELECT 1 FROM links WHERE ${kind === 'company' ? 'company_tenant' : 'db_tenant'}=$1 AND status='linked' LIMIT 1`, [tenant])).rowCount;
  if (!has) return false;
  await client.query(`INSERT INTO relay_queue(tenant_id, kind, tbl, doc_id) SELECT $1, $2, t, i FROM unnest($3::text[], $4::text[]) AS x(t, i)`,
    [tenant, kind, changed.map(c => c.table), changed.map(c => c.id)]);
  return true;
}

/** after the save: a company pausing / resuming a distributor, then start the relay workers */
export async function afterSave(pool: pg.Pool, tenant: string, kind: 'company' | 'distributor', changed: { table: string; id: string }[], queued: boolean) {
  // the company may pause a distributor from its own list; on resume, what changed meanwhile is caught up
  if (kind === 'company') for (const ch of changed.filter(c => c.table === 'dbLinks')) {
    const d = await storeFor(pool, tenant).get('dbLinks', ch.id);
    if (!d || (d.status !== 'paused' && d.status !== 'linked')) continue;
    const r = (await pool.query(`UPDATE links l SET status=$3, updated_at=now() FROM (SELECT status AS was FROM links WHERE id=$1) o WHERE l.id=$1 AND l.company_tenant=$2 AND l.status <> 'left' RETURNING o.was`, [ch.id, tenant, d.status])).rows[0];
    if (r?.was === 'paused' && d.status === 'linked') await resyncLink(pool, ch.id);
  }
  if (!queued) return;
  if (process.env.RELAY_INLINE === '1') await drainRelay(pool); else kickRelay(pool);
}

/** note changes for the relay outside a sync (one transaction of its own) */
export async function relayChanges(pool: pg.Pool, tenant: string, kind: 'company' | 'distributor', changed: { table: string; id: string }[]) {
  if (!changed.length) return;
  const client = await pool.connect();
  let queued = false;
  try { await client.query('BEGIN'); queued = await queueRelay(client, tenant, kind, changed); await client.query('COMMIT'); }
  catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await afterSave(pool, tenant, kind, changed, queued);
}

let draining: Promise<number> | null = null;
let inFlight = 0;
/** start the background workers if they are not running (they stop when the queue is empty). Several workers (and
 *  several server instances) can run at once: each takes its own rows; a target's lock keeps the totals exact. */
export function kickRelay(pool: pg.Pool) {
  if (draining) return;
  const workers = Math.max(1, Number(process.env.RELAY_WORKERS ?? 2));
  const one = async () => { let n = 0; for (;;) { const k = await drainOnce(pool); n += k; if (!k) break; } return n; };
  draining = (async () => { try { return (await Promise.all(Array.from({ length: workers }, one))).reduce((a, b) => a + b, 0); } finally { draining = null; } })();
  draining.catch(() => {});
}
/** changes noted but not yet handed over (waiting in the queue, or being written right now) */
export async function relayBacklog(pool: pg.Pool) { return Number((await pool.query('SELECT count(*)::int n FROM relay_queue')).rows[0].n); } // rows being relayed stay in the queue until done
/** wait for a running background relay to finish (server shutdown) */
export async function relayIdle() { if (draining) await draining.catch(() => 0); }
/** empty the queue now (tests, the every-minute safety call, and RELAY_INLINE) */
export async function drainRelay(pool: pg.Pool) { if (draining) await draining.catch(() => 0); let n = 0; for (;;) { const k = await drainOnce(pool); n += k; if (!k) break; } return n; }

type QRow = { id: string; tenant_id: string; kind: 'company' | 'distributor'; tbl: string; doc_id: string; tries: number };
const STALE_CLAIM_MIN = 10; // a worker that stopped mid-way (instance shut down): its rows are taken again after this
const MAX_TRIES = 5;
/** take up to `size` noted changes (oldest first, never two workers on the same rows). They stay in the queue until relayed. */
export async function claimRelay(pool: pg.Pool, size = 2000): Promise<QRow[]> {
  return (await pool.query(`UPDATE relay_queue SET taken_at = now() WHERE id IN (
      SELECT id FROM relay_queue WHERE taken_at IS NULL OR taken_at < now() - make_interval(mins => $2) ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING *`, [size, STALE_CLAIM_MIN])).rows;
}
/** relayed: now they can go */
export async function relayDone(pool: pg.Pool, rows: QRow[]) {
  if (rows.length) await pool.query('DELETE FROM relay_queue WHERE id = ANY($1::bigint[])', [rows.map(r => r.id)]);
}
/** failed: tried again later; after 5 tries kept in relay_failed (never dropped) */
export async function relayFailed(pool: pg.Pool, rows: QRow[], error: string) {
  if (!rows.length) return;
  const ids = rows.map(r => r.id);
  await pool.query(`WITH gone AS (DELETE FROM relay_queue WHERE id = ANY($1::bigint[]) AND tries + 1 >= $2 RETURNING *)
    INSERT INTO relay_failed(id, tenant_id, kind, tbl, doc_id, at, tries, error) SELECT id, tenant_id, kind, tbl, doc_id, at, tries + 1, $3 FROM gone ON CONFLICT (id) DO NOTHING`, [ids, MAX_TRIES, error]);
  await pool.query('UPDATE relay_queue SET tries = tries + 1, taken_at = NULL WHERE id = ANY($1::bigint[])', [ids]);
}

async function drainOnce(pool: pg.Pool, size = 2000): Promise<number> {
  const rows = await claimRelay(pool, size);
  if (!rows.length) return 0;
  inFlight += rows.length;
  try { await relayRows(pool, rows); } finally { inFlight -= rows.length; }
  return rows.length;
}
async function relayRows(pool: pg.Pool, rows: QRow[]) {
  rows.sort((a, b) => Number(a.id) - Number(b.id));
  const byTenant = new Map<string, typeof rows>();
  for (const r of rows) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r]);
  const ctx = { today: istToday() };
  for (const [tenant, list] of byTenant) {
    try {
      const kind = list[0].kind;
      const seen = new Set<string>(); const changed = list.filter(r => { const k = `${r.tbl}|${r.doc_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
      const links = (await pool.query(`SELECT * FROM links WHERE ${kind === 'company' ? 'company_tenant' : 'db_tenant'}=$1 AND status='linked'`, [tenant])).rows.map(rowToLink);
      const src = cachedStore(pool, tenant);
      for (const link of links) {
        const db: Cached = kind === 'company' ? cachedStore(pool, link.dbTenant) : src, co: Cached = kind === 'company' ? src : cachedStore(pool, link.companyTenant);
        const writes: Write[] = [];
        for (const ch of changed) {
          const doc = await src.get(ch.tbl, ch.doc_id);
          if (!doc) continue;
          const out = kind === 'company' ? await companyToDb(link, ch.tbl, doc, db, co, ctx) : await dbToCompany(link, ch.tbl, doc, db, co, ctx);
          for (const w of out) (kind === 'company' ? db : co).note(w.tbl, w.doc); // e.g. a scheme right after its product
          writes.push(...out);
        }
        const target = kind === 'company' ? link.dbTenant : link.companyTenant;
        for (let i = 0; i < writes.length; i += 500) await writeInto(pool, target, writes.slice(i, i + 500));
      }
      await relayDone(pool, list); // removed only once handed over
    } catch (e) {
      // kept for the next run (a few tries), then kept in relay_failed: never a lost change
      const code = String((e as { code?: string }).code ?? (e as Error).name ?? 'error');
      await relayFailed(pool, list, code).catch(() => {});
      console.error('relay failed', code);
    }
  }
}

const genCode = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };
export { genCode };

/** find an open invite by its code */
export async function findInvite(pool: pg.Pool, code: string) {
  const r = (await pool.query(`SELECT d.tenant_id, d.data, t.name FROM docs d JOIN tenants t ON t.id=d.tenant_id
    WHERE d.tbl='dbLinks' AND d.data->>'inviteCode'=$1 AND d.data->>'status'='invited' AND t.kind='company'`, [code.trim().toUpperCase()])).rows[0];
  return r ? { companyTenant: r.tenant_id as string, invite: r.data as Doc, companyName: r.name as string } : null;
}

/** run the first exchange again (after a time-out, after a pause, or to repair): every write is an upsert, so it is safe */
export async function resyncLink(pool: pg.Pool, linkId: string) {
  const r = (await pool.query(`SELECT * FROM links WHERE id=$1 AND status='linked'`, [linkId])).rows[0];
  if (!r) throw Object.assign(new Error('This link is not active.'), { statusCode: 404 });
  const link = rowToLink(r);
  const db = cachedStore(pool, link.dbTenant), co = cachedStore(pool, link.companyTenant);
  await linkInitial(link, db, co, async (side, ws) => {
    for (const w of ws) (side === 'db' ? db : co).note(w.tbl, w.doc);
    for (let i = 0; i < ws.length; i += 500) await writeInto(pool, side === 'db' ? link.dbTenant : link.companyTenant, ws.slice(i, i + 500));
  }, { today: istToday() });
  return link;
}

/** the server's word on who may write what in a company (phones are not trusted with approvals or money) */
export function companyRule(role: string, userId: string, table: string, data: Doc, existing: Doc | undefined, updatedAt: string): string | null {
  const boss = role === 'cadmin' || role === 'manager';
  if (table === 'claimDecisions') {
    const final = data.status === 'approved' || data.status === 'rejected';
    if (final && role !== 'cadmin') return 'only head office decides a claim';
    if (final && data.id !== `final:${String(data.claimId)}`) return 'a final decision has one record per claim';
    if (!final && !boss) return 'only a manager recommends';
    if (existing && (existing.status === 'approved' || existing.status === 'rejected') && existing.updatedAt !== updatedAt) return 'this claim is already decided';
    return null;
  }
  if (table === 'travelClaims' || table === 'expenses' || table === 'leaves') {
    const owner = String(table === 'expenses' ? data.by : data.staffId) === userId;
    const decided = (d?: Doc) => !!d && (d.status === 'approved' || d.status === 'rejected');
    if (owner) {
      if (decided(data)) return 'nobody approves their own';
      if (decided(existing)) return 'already decided';
      return null;
    }
    return boss ? null : 'only a manager decides for someone else';
  }
  if (table === 'workDays' && String(data.staffId) !== userId) return 'a working day is recorded by its owner only';
  return null;
}

/** a distributor's push of a linked product: the company's price fields stay the company's */
export function keepCompanyFields(data: Doc, existing: Doc | undefined) {
  if (!existing?.companyProductId) return data;
  const out: Doc = { ...data, companyProductId: existing.companyProductId };
  for (const f of COMPANY_PRODUCT_FIELDS) if (existing[f] !== undefined) out[f] = existing[f];
  return out;
}

/** the distributor accepts: tie (or create) its own company record, record the link, and run the first exchange */
export async function acceptInvite(pool: pg.Pool, dbTenant: string, code: string, companyIdInDb?: string) {
  const inv = await findInvite(pool, code);
  if (!inv) throw Object.assign(new Error('This code is not valid or was already used. Ask the company for a new one.'), { statusCode: 404 });
  const already = (await pool.query(`SELECT id FROM links WHERE company_tenant=$1 AND db_tenant=$2 AND status <> 'left'`, [inv.companyTenant, dbTenant])).rows[0];
  if (already) throw Object.assign(new Error(`You are already linked with ${inv.companyName}.`), { statusCode: 409 });
  const dbStore = storeFor(pool, dbTenant);
  const now = new Date().toISOString();
  let company = companyIdInDb ? await dbStore.get('companies', companyIdInDb) : undefined;
  if (companyIdInDb && !company) throw Object.assign(new Error('That company is not in your list.'), { statusCode: 400 });
  // a record that was ever tied to another company (even after leaving it) can never carry this one: its history is that brand's
  if (company) {
    const other = (await pool.query(`SELECT 1 FROM links WHERE db_tenant=$1 AND company_id_in_db=$2 AND company_tenant <> $3`, [dbTenant, company.id, inv.companyTenant])).rowCount;
    const tied = (company.link as { companyTenant?: string } | undefined)?.companyTenant;
    if (other || (tied && tied !== inv.companyTenant)) throw Object.assign(new Error('That company in your list belongs to another company\'s link. Choose "New" instead.'), { statusCode: 409 });
  }
  const linkId = inv.invite.id;
  const linkInfo = { companyTenant: inv.companyTenant, linkId, since: now, status: 'linked' };
  if (!company) company = { id: `co-${linkId}`, name: inv.companyName, code: inv.companyName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'CO', nextBillNo: 1, createdAt: now };
  await writeInto(pool, dbTenant, [{ tbl: 'companies', doc: { ...company, link: linkInfo } }]);
  const firm = (await pool.query('SELECT name FROM tenants WHERE id=$1', [dbTenant])).rows[0]?.name as string;
  await pool.query(`INSERT INTO links(id, company_tenant, db_tenant, company_id_in_db, status) VALUES ($1,$2,$3,$4,'linked')
    ON CONFLICT (company_tenant, db_tenant) DO UPDATE SET id=EXCLUDED.id, company_id_in_db=EXCLUDED.company_id_in_db, status='linked', updated_at=now()`,
    [linkId, inv.companyTenant, dbTenant, company.id]);
  const gstin = String((await dbStore.all('settings'))[0]?.gstin ?? '') || undefined; // invoices to this distributor match on it
  await writeInto(pool, inv.companyTenant, [{ tbl: 'dbLinks', doc: { ...inv.invite, status: 'linked', dbTenantId: dbTenant, linkedAt: now, name: inv.invite.name || firm, gstin } }]);
  // the first exchange: if it is cut off (a very large distributor), "Re-sync" finishes it (POST /v1/link/resync)
  await resyncLink(pool, linkId);
  return { linkId, company: inv.companyName, companyIdInDb: company.id };
}

/** the distributor leaves: nothing new crosses from this moment; the company keeps what it already had */
export async function leaveLink(pool: pg.Pool, dbTenant: string, linkId: string) {
  const r = (await pool.query(`UPDATE links SET status='left', updated_at=now() WHERE id=$1 AND db_tenant=$2 AND status <> 'left' RETURNING *`, [linkId, dbTenant])).rows[0];
  if (!r) throw Object.assign(new Error('No such link.'), { statusCode: 404 });
  const co = storeFor(pool, r.company_tenant), db = storeFor(pool, dbTenant);
  const inv = await co.get('dbLinks', linkId); if (inv) await writeInto(pool, r.company_tenant, [{ tbl: 'dbLinks', doc: { ...inv, status: 'left' } }]);
  const c = await db.get('companies', r.company_id_in_db); if (c) await writeInto(pool, dbTenant, [{ tbl: 'companies', doc: { ...c, link: { ...(c.link as object), status: 'left' } } }]);
  return { ok: true };
}
