// Company reports, answered on the server from the running totals (roll_* tables), so a brand with thousands of
// distributors never downloads every bill to a phone. Each person sees only their own distributors (head office: all).
import type pg from 'pg';

type Doc = Record<string, unknown> & { id: string };
const r2 = (n: number) => Math.round(n * 100) / 100;
export const BIG_TABLES = ['secondary', 'secondaryReturns', 'dbStock', 'shops'];

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
    const sec = (await pool.query(`SELECT product_id, sum(qty) q, sum(value) v FROM roll_daily WHERE tenant_id=$1 AND day >= $2::date AND day <= ($2::date + interval '1 month' - interval '1 day') AND link_id = ANY($3) GROUP BY 1`, [tenant, `${month}-01`, only])).rows;
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

/** days of stock: each distributor's stock of each product ÷ what it sold per day over the last 30 days */
async function stockCover(pool: pg.Pool, tenant: string, ids: string[], limit: number, status = '') {
  const norms = new Map((await pool.query(`SELECT id, coalesce((data->>'normDays')::numeric, 15) n FROM docs WHERE tenant_id=$1 AND tbl='dbLinks' AND id = ANY($2)`, [tenant, ids])).rows.map(r => [r.id, Number(r.n)]));
  const rows = (await pool.query(`
    WITH sold AS (SELECT link_id, product_id, sum(qty) q FROM roll_daily WHERE tenant_id=$1 AND day >= $2::date AND link_id = ANY($3) GROUP BY 1, 2)
    SELECT s.data->>'dbLinkId' link, s.data->>'productId' pid, s.data->>'name' name, (s.data->>'qty')::numeric qty, coalesce((s.data->>'nearExpiry')::numeric, 0) near,
      coalesce(sold.q, 0) / 30.0 per, coalesce((p.data->>'purchaseRate')::numeric, 0) rate
    FROM docs s LEFT JOIN sold ON sold.link_id = s.data->>'dbLinkId' AND sold.product_id = s.data->>'productId'
      LEFT JOIN docs p ON p.tenant_id = $1 AND p.tbl = 'products' AND p.id = s.data->>'productId'
    WHERE s.tenant_id=$1 AND s.tbl='dbStock' AND s.data->>'dbLinkId' = ANY($3)`, [tenant, daysAgo(30), ids])).rows;
  const value = new Map<string, number>(), low = new Map<string, number>(); const counts = { low: 0, high: 0, ok: 0, none: 0 };
  const out = [];
  for (const r of rows) {
    const qty = Number(r.qty), per = Number(r.per), norm = norms.get(r.link) ?? 15;
    const days = per > 0 ? Math.round(qty / per) : null;
    const st = qty === 0 && per === 0 ? 'none' : days === null ? (qty > 0 ? 'high' : 'none') : days < norm * 0.5 ? 'low' : days > norm * 2 ? 'high' : 'ok';
    counts[st as keyof typeof counts]++;
    value.set(r.link, (value.get(r.link) ?? 0) + qty * Number(r.rate));
    if (st === 'low') low.set(r.link, (low.get(r.link) ?? 0) + 1);
    if (limit && (!status || status === st)) out.push({ dbLinkId: r.link, productId: r.pid, name: r.name, qty, perDay: r2(per), days, norm, status: st, nearExpiry: Number(r.near), value: r2(qty * Number(r.rate)) });
  }
  out.sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
  return { rows: limit ? out.slice(0, limit) : [], counts, value, low };
}

/** a few records of the company's own data on demand (the bills behind one claim, one distributor's stock) */
export async function companyDocs(pool: pg.Pool, tenant: string, scope: string[] | null, tbl: string, args: { ids?: string[]; dbLinkId?: string }) {
  if (!BIG_TABLES.includes(tbl)) throw Object.assign(new Error('Not available'), { statusCode: 400 });
  const rows = args.ids?.length
    ? (await pool.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND id = ANY($3)`, [tenant, tbl, args.ids.slice(0, 5000)])).rows
    : (await pool.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND data->>'dbLinkId' = $3 AND ($2 NOT IN ('secondary','secondaryReturns') OR data->>'date' >= $4) LIMIT 20000`, [tenant, tbl, args.dbLinkId ?? '', daysAgo(60)])).rows;
  return rows.map(r => r.data as Doc).filter(d => !scope || scope.includes(String(d.dbLinkId)));
}
