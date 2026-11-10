// Company reports, answered on the server from the running totals (roll_* tables), so a brand with thousands of
// distributors never downloads every bill to a phone. Each person sees only their own distributors (head office: all).
import type pg from 'pg';

type Doc = Record<string, unknown> & { id: string };
const r2 = (n: number) => Math.round(n * 100) / 100;
export const BIG_TABLES = ['secondary', 'secondaryReturns', 'dbStock', 'shops']; // dbStock: on the server it is the link_stock table

/** the distributors (dbLinks ids) a person may see: head office → null (all); others → their own and their team's */
export async function scopeFor(pool: pg.Pool, tenant: string, userId: string): Promise<string[] | null> {
  const staff = (await pool.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl='staff'`, [tenant])).rows.map(r => r.data as Doc);
  const me = staff.find(s => s.id === userId);
  if (!me || me.role === 'cadmin') return null;
  const team = new Set([userId]); let grew = true;
  while (grew) { grew = false; for (const s of staff) if (s.managerId && team.has(String(s.managerId)) && !team.has(s.id)) { team.add(s.id); grew = true; } }
  return [...new Set(staff.filter(s => team.has(s.id)).flatMap(s => (s.dbLinkIds as string[] | undefined) ?? []))];
}

const daysAgo = (n: number) => new Date(Date.now() + 5.5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);

export async function companyReport(pool: pg.Pool, tenant: string, scope: string[] | null, kind: string, args: Record<string, unknown>) {
  const month = /^\d{4}-\d{2}$/.test(String(args.month ?? '')) ? String(args.month) : daysAgo(0).slice(0, 7);
  const links = (await pool.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl='dbLinks'`, [tenant])).rows.map(r => r.data as Doc)
    .filter(l => !scope || scope.includes(l.id));
  const ids = links.map(l => l.id);
  if (kind === 'links') {
    const roll = new Map((await pool.query(`SELECT link_id, value, returns, bills FROM roll_link_month WHERE tenant_id=$1 AND month=$2 AND link_id = ANY($3)`, [tenant, month, ids])).rows.map(r => [r.link_id, r]));
    const shops = new Map((await pool.query(`SELECT link_id, count(*)::int n FROM roll_shop_month WHERE tenant_id=$1 AND month=$2 AND value > 0 AND link_id = ANY($3) GROUP BY link_id`, [tenant, month, ids])).rows.map(r => [r.link_id, r.n]));
    const prim = new Map((await pool.query(`SELECT data->>'dbLinkId' l, sum((data->>'taxable')::numeric) v FROM docs WHERE tenant_id=$1 AND tbl='primaryInvoices' AND left(data->>'date', 7)=$2 AND NOT coalesce((data->>'cancelled')::boolean, false) GROUP BY 1`, [tenant, month])).rows.map(r => [r.l, Number(r.v)]));
    const cover = await stockCover(pool, tenant, ids, 0);
    return links.filter(l => l.status !== 'invited').map(link => {
      const r = roll.get(link.id);
      return { link, primary: r2(prim.get(link.id) ?? 0), secondary: r2(Number(r?.value ?? 0)), returns: r2(-Number(r?.returns ?? 0)), shops: shops.get(link.id) ?? 0, bills: Number(r?.bills ?? 0),
        stockValue: r2(cover.value.get(link.id) ?? 0), lowCover: cover.low.get(link.id) ?? 0 };
    });
  }
  if (kind === 'products') {
    const only = typeof args.dbLinkId === 'string' && ids.includes(args.dbLinkId) ? [args.dbLinkId] : ids;
    const sec = only.length === 1 || scope
      ? (await pool.query(`SELECT product_id, sum(qty) q, sum(value) v FROM roll_daily WHERE tenant_id=$1 AND day >= $2::date AND day <= ($2::date + interval '1 month' - interval '1 day') AND link_id = ANY($3) GROUP BY 1`, [tenant, `${month}-01`, only])).rows
      : (await pool.query(`SELECT product_id, qty q, value v FROM roll_product_month WHERE tenant_id=$1 AND month=$2`, [tenant, month])).rows; // head office: all distributors
    const prim = (await pool.query(`SELECT l->>'productId' p, sum((l->>'qty')::numeric) q FROM docs, jsonb_array_elements(data->'lines') l WHERE tenant_id=$1 AND tbl='primaryInvoices' AND left(data->>'date', 7)=$2 AND data->>'dbLinkId' = ANY($3) GROUP BY 1`, [tenant, month, only])).rows;
    const names = new Map((await pool.query(`SELECT id, data->>'name' n FROM docs WHERE tenant_id=$1 AND tbl='products'`, [tenant])).rows.map(r => [r.id, r.n]));
    const rows = new Map<string, { productId: string; name: string; primaryQty: number; secondaryQty: number; secondaryValue: number }>();
    const row = (id: string) => { let x = rows.get(id); if (!x) { x = { productId: id, name: names.get(id) ?? id, primaryQty: 0, secondaryQty: 0, secondaryValue: 0 }; rows.set(id, x); } return x; };
    for (const r of sec) { const x = row(r.product_id); x.secondaryQty = Number(r.q); x.secondaryValue = r2(Number(r.v)); }
    for (const r of prim) row(r.p).primaryQty = Number(r.q);
    return [...rows.values()].sort((a, b) => b.secondaryValue - a.secondaryValue);
  }
  if (kind === 'stock') {
    const only = typeof args.dbLinkId === 'string' && ids.includes(args.dbLinkId) ? [args.dbLinkId] : ids;
    const c = await stockCover(pool, tenant, only, Number(args.limit ?? 500), String(args.status ?? ''));
    return { rows: c.rows, counts: c.counts };
  }
  if (kind === 'outlets') {
    const q = String(args.q ?? '').trim();
    const shops = (await pool.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl='shops' AND data->>'dbLinkId' = ANY($2) AND coalesce(data->>'active','true') <> 'false'
      AND ($3 = '' OR data->>'name' ILIKE '%' || $3 || '%' OR data->>'area' ILIKE '%' || $3 || '%' OR data->>'beat' ILIKE '%' || $3 || '%') ORDER BY data->>'name' LIMIT 300`, [tenant, ids, q])).rows.map(r => r.data as Doc);
    const total = Number((await pool.query(`SELECT count(*)::int n FROM docs WHERE tenant_id=$1 AND tbl='shops' AND data->>'dbLinkId' = ANY($2)`, [tenant, ids])).rows[0].n);
    const bought = Number((await pool.query(`SELECT count(*)::int n FROM roll_shop_month WHERE tenant_id=$1 AND month=$2 AND value > 0 AND link_id = ANY($3)`, [tenant, month, ids])).rows[0].n);
    const val = new Map((await pool.query(`SELECT shop_id, value FROM roll_shop_month WHERE tenant_id=$1 AND month=$2 AND shop_id = ANY($3)`, [tenant, month, shops.map(s => s.id)])).rows.map(r => [r.shop_id, Number(r.value)]));
    return { total, bought, shops: shops.map(s => ({ ...s, monthValue: r2(val.get(s.id) ?? 0) })) };
  }
  throw Object.assign(new Error('Unknown report'), { statusCode: 400 });
}

// the stock-cover figures, worked out inside the database (never millions of rows into the server).
// $1 tenant, $2 since (30 days back), then either $3 distributors (all their products) or $3/$4 distributor and product pairs.
const coverSql = (pairs: boolean) => `
  WITH ${pairs ? `p AS (SELECT DISTINCT l, pr FROM unnest($3::text[], $4::text[]) AS x(l, pr)),
  sold AS (SELECT r.link_id, r.product_id, sum(r.qty) q FROM p JOIN roll_daily r ON r.tenant_id=$1 AND r.link_id = p.l AND r.product_id = p.pr AND r.day >= $2::date GROUP BY 1, 2),`
    : `sold AS (SELECT link_id, product_id, sum(qty) q FROM roll_daily WHERE tenant_id=$1 AND link_id = ANY($3) AND day >= $2::date GROUP BY 1, 2),`}
  norms AS (SELECT id link_id, coalesce((data->>'normDays')::numeric, 15) norm FROM docs WHERE tenant_id=$1 AND tbl='dbLinks'),
  rates AS (SELECT id product_id, coalesce((data->>'purchaseRate')::numeric, 0) rate, data->>'name' pname FROM docs WHERE tenant_id=$1 AND tbl='products'),
  c AS (SELECT s.link_id, s.product_id, coalesce(s.name, r.pname) name, s.qty, s.near_expiry near, coalesce(sold.q, 0) / 30.0 per, coalesce(r.rate, 0) rate, coalesce(n.norm, 15) norm
        FROM ${pairs ? 'p JOIN link_stock s ON s.tenant_id=$1 AND s.link_id = p.l AND s.product_id = p.pr' : 'link_stock s'}
        LEFT JOIN sold ON sold.link_id = s.link_id AND sold.product_id = s.product_id
        LEFT JOIN rates r ON r.product_id = s.product_id LEFT JOIN norms n ON n.link_id = s.link_id
        ${pairs ? '' : 'WHERE s.tenant_id=$1 AND s.link_id = ANY($3)'}),
  d AS (SELECT *, CASE WHEN per > 0 THEN round(qty / per)::int END days FROM c),
  x AS (SELECT *, round(qty * rate, 2) value, CASE WHEN qty = 0 AND per = 0 THEN 'none' WHEN days IS NULL THEN (CASE WHEN qty > 0 THEN 'high' ELSE 'none' END)
                       WHEN days < norm * 0.5 THEN 'low' WHEN days > norm * 2 THEN 'high' ELSE 'ok' END status FROM d)`;
const SET_FIGURES = `UPDATE link_stock s SET per = round(x.per, 3), days = x.days, norm = x.norm, status = x.status, value = x.value
  FROM x WHERE s.tenant_id=$1 AND s.link_id = x.link_id AND s.product_id = x.product_id`;
// a distributor's totals from its own stock rows (2,000 at most, read by key)
const SUM_LINKS = `INSERT INTO cover_link(tenant_id, link_id, value, low, high, ok, none)
  SELECT $1, link_id, coalesce(round(sum(value), 2), 0), count(*) FILTER (WHERE status='low'), count(*) FILTER (WHERE status='high'), count(*) FILTER (WHERE status='ok'),
         count(*) FILTER (WHERE status='none') FROM link_stock WHERE tenant_id=$1 AND link_id = ANY($2) GROUP BY link_id
  ON CONFLICT (tenant_id, link_id) DO UPDATE SET value=EXCLUDED.value, low=EXCLUDED.low, high=EXCLUDED.high, ok=EXCLUDED.ok, none=EXCLUDED.none`;
const lockCover = (c: pg.PoolClient, tenant: string) => c.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':cover'))`, [tenant]);

/** remake the figures of products that changed (a sale or a stock change marked them); returns how many were remade */
export async function refreshChanged(pool: pg.Pool, tenant: string, max = 20000) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await lockCover(client, tenant);
    // the marks go first: a sale landing while this runs marks its product again and is picked up next time
    const got = (await client.query(`DELETE FROM cover_dirty WHERE ctid IN (SELECT ctid FROM cover_dirty WHERE tenant_id=$1 LIMIT $2)
      RETURNING link_id, product_id`, [tenant, max])).rows as { link_id: string; product_id: string }[];
    if (got.length) {
      await client.query(`${coverSql(true)} ${SET_FIGURES}`, [tenant, daysAgo(30), got.map(r => r.link_id), got.map(r => r.product_id)]);
      await client.query(SUM_LINKS, [tenant, [...new Set(got.map(r => r.link_id))]]);
    }
    await client.query('COMMIT');
    return got.length;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

/** remake every figure of a brand, 200 distributors at a time (daily, and the first time head office looks) */
export async function refreshCover(pool: pg.Pool, tenant: string) {
  const started = new Date();
  const ids = (await pool.query(`SELECT id FROM docs WHERE tenant_id=$1 AND tbl='dbLinks'`, [tenant])).rows.map(r => r.id as string);
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await lockCover(client, tenant);
      await client.query(`${coverSql(false)} ${SET_FIGURES}`, [tenant, daysAgo(30), part]);
      await client.query(SUM_LINKS, [tenant, part]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  await pool.query(`INSERT INTO cover_state(tenant_id, at) VALUES ($1, $2) ON CONFLICT (tenant_id) DO UPDATE SET at = $2`, [tenant, started]);
}

const busy = new Set<string>(), again = new Set<string>();
/** remake in the background, one job per brand at a time; a change during a job runs it once more */
function background(pool: pg.Pool, tenant: string, full: boolean) {
  if (busy.has(tenant)) { again.add(tenant); return; }
  busy.add(tenant);
  void (async () => {
    // wait a moment so a burst of bills is remade together (fewer, bigger passes; the relay keeps its speed)
    const wait = Number(process.env.COVER_DELAY_MS ?? 5000); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (full) await refreshCover(pool, tenant);
    do { again.delete(tenant); while (await refreshChanged(pool, tenant) > 0) { /* until none left */ } } while (again.has(tenant));
  })().catch(() => {}).finally(() => busy.delete(tenant));
}
/** resolves when no figure remake is running (tests, and a clean shutdown) */
export async function coverIdle() { while (busy.size) await new Promise(r => setTimeout(r, 20)); }
/** the relay calls this after a brand's stock or sales change: figures follow within seconds (tests wait for them) */
export async function kickCover(pool: pg.Pool, tenant: string) {
  if (process.env.RELAY_INLINE === '1') { while (await refreshChanged(pool, tenant) > 0) { /* until none left */ } return; }
  background(pool, tenant, false);
}
/** head office never waits for figures: it reads what is ready; missing or day-old figures are remade in the background */
async function readyCover(pool: pg.Pool, tenant: string) {
  const st = (await pool.query(`SELECT at FROM cover_state WHERE tenant_id=$1`, [tenant])).rows[0];
  if (!st || Date.now() - new Date(st.at).getTime() > 20 * 3600e3) background(pool, tenant, true);
}
/** the background job for all brands (a cron calls it every few minutes) */
export async function refreshAllCover(pool: pg.Pool) {
  const cos = (await pool.query(`SELECT t.id, s.at FROM tenants t LEFT JOIN cover_state s ON s.tenant_id = t.id WHERE t.kind='company'`)).rows;
  for (const c of cos) {
    if (!c.at || Date.now() - new Date(c.at).getTime() > 20 * 3600e3) await refreshCover(pool, c.id);
    while (await refreshChanged(pool, c.id) > 0) { /* until none left */ }
  }
  return cos.length;
}

/** days of stock: each distributor's stock of each product ÷ what it sold per day over the last 30 days */
async function stockCover(pool: pg.Pool, tenant: string, ids: string[], limit: number, status = '') {
  const value = new Map<string, number>(), low = new Map<string, number>(); const counts = { low: 0, high: 0, ok: 0, none: 0 };
  const map = (r: Record<string, unknown>) => ({ dbLinkId: String(r.link_id), productId: String(r.product_id), name: String(r.name ?? ''), qty: Number(r.qty), perDay: r2(Number(r.per)), days: r.days == null ? null : Number(r.days), norm: Number(r.norm), status: String(r.status), nearExpiry: Number(r.near ?? 0), value: r2(Number(r.value ?? 0)) });
  if (ids.length === 1) { // one distributor: every product, live
    const rows = (await pool.query(`${coverSql(false)} SELECT link_id, product_id, name, qty, per, days, norm, status, near, value FROM x ORDER BY days NULLS LAST`, [tenant, daysAgo(30), ids])).rows;
    for (const r of rows) { counts[r.status as keyof typeof counts]++; value.set(r.link_id, (value.get(r.link_id) ?? 0) + Number(r.value)); if (r.status === 'low') low.set(r.link_id, (low.get(r.link_id) ?? 0) + 1); }
    return { rows: (limit ? rows.filter(r => !status || r.status === status).slice(0, limit) : []).map(map), counts, value, low };
  }
  await readyCover(pool, tenant);
  for (const r of (await pool.query(`SELECT link_id, value, low, high, ok, none FROM cover_link WHERE tenant_id=$1 AND link_id = ANY($2)`, [tenant, ids])).rows) {
    value.set(r.link_id, Number(r.value)); low.set(r.link_id, Number(r.low));
    counts.low += Number(r.low); counts.high += Number(r.high); counts.ok += Number(r.ok); counts.none += Number(r.none);
  }
  // the list head office acts on: the low and too-much rows (or one status), worst first
  const want = status ? [status] : ['low', 'high'];
  const rows = limit ? (await pool.query(`SELECT link_id, product_id, name, qty, per, days, norm, status, near_expiry near, value FROM link_stock
    WHERE tenant_id=$1 AND status = ANY($2) AND link_id = ANY($3) ORDER BY days NULLS LAST LIMIT $4`, [tenant, want, ids, limit])).rows.map(map) : [];
  return { rows, counts, value, low };
}

/** a few records of the company's own data on demand (the bills behind one claim, one distributor's stock) */
export async function companyDocs(pool: pg.Pool, tenant: string, scope: string[] | null, tbl: string, args: { ids?: string[]; dbLinkId?: string }) {
  if (!BIG_TABLES.includes(tbl)) throw Object.assign(new Error('Not available'), { statusCode: 400 });
  if (tbl === 'dbStock') {
    const rows = (await pool.query(`SELECT link_id, product_id, name, qty, near_expiry, expired, as_of FROM link_stock WHERE tenant_id=$1 AND link_id=$2`, [tenant, args.dbLinkId ?? ''])).rows;
    return rows.filter(r => !scope || scope.includes(r.link_id)).map(r => ({ id: `${r.link_id}:${r.product_id}`, dbLinkId: r.link_id, productId: r.product_id, name: r.name, qty: Number(r.qty), nearExpiry: Number(r.near_expiry), expired: Number(r.expired), asOf: r.as_of }));
  }
  const rows = args.ids?.length
    ? (await pool.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND id = ANY($3)`, [tenant, tbl, args.ids.slice(0, 5000)])).rows
    : (await pool.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND data->>'dbLinkId' = $3 AND ($2 NOT IN ('secondary','secondaryReturns') OR data->>'date' >= $4) LIMIT 20000`, [tenant, tbl, args.dbLinkId ?? '', daysAgo(60)])).rows;
  const docs = rows.map(r => r.data as Doc);
  if (args.ids?.length) { // old bills (a claim on a bill from last year) come from the archive
    const have = new Set(docs.map(d => String(d.id)));
    const { archivedByIds } = await import('./archive.js');
    for (const d of (await archivedByIds(pool, tenant, tbl, args.ids.slice(0, 5000).filter(i => !have.has(i)))).values()) docs.push(d);
  }
  return docs.filter(d => !scope || scope.includes(String(d.dbLinkId)));
}
