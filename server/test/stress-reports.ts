// A giant brand's reports at full size: 5,000 distributors, 2,000 products, a month of sales. The rows are made directly
// in the database (making them through phones would take hours here); the reports are then timed as head office sees them.
// Usage: LINKS=5000 PRODUCTS=2000 SOLD_PER_DAY=100 npx tsx test/stress-reports.ts
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

const LINKS = Number(process.env.LINKS ?? 5000), PRODUCTS = Number(process.env.PRODUCTS ?? 2000), SOLD = Number(process.env.SOLD_PER_DAY ?? 100);
const OUT = process.env.OUT ?? '/tmp/stress-reports.json';
const port = 55100 + Math.floor(Math.random() * 90);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'rep-pg-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false, onLog: () => {} });
await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
const pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox`, max: 8 });
pool.on('error', () => {});
const { migrate } = await import('../src/db.js'); await migrate(pool);
const T = 'giant';
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
let t = performance.now();
await pool.query(`INSERT INTO tenants(id, name, kind) VALUES ('giant', 'Giant Brand', 'company')`);
await pool.query(`INSERT INTO docs(tenant_id, tbl, id, data, updated_at) SELECT $1, 'dbLinks', 'L' || g, jsonb_build_object('id', 'L' || g, 'name', 'Distributor ' || g, 'status', 'linked', 'normDays', 15), now() FROM generate_series(1, $2) g`, [T, LINKS]);
await pool.query(`INSERT INTO docs(tenant_id, tbl, id, data, updated_at) SELECT $1, 'products', 'P' || g, jsonb_build_object('id', 'P' || g, 'name', 'Product ' || g, 'purchaseRate', 30 + g % 50), now() FROM generate_series(1, $2) g`, [T, PRODUCTS]);
await pool.query(`INSERT INTO docs(tenant_id, tbl, id, data, updated_at) SELECT $1, 'staff', 'ho', '{"id":"ho","role":"cadmin"}'::jsonb, now()`, [T]);
log(`links and products in ${((performance.now() - t) / 1000).toFixed(0)} s`);
t = performance.now();
for (let l = 1; l <= LINKS; l += 500) await pool.query(`INSERT INTO link_stock(tenant_id, link_id, product_id, name, qty, near_expiry, expired, as_of)
  SELECT $1, 'L' || l, 'P' || p, 'Product ' || p, (l * 7 + p * 13) % 400, 0, 0, $4::date FROM generate_series($2::int, $3::int) l, generate_series(1, $5::int) p`, [T, l, Math.min(LINKS, l + 499), today, PRODUCTS]);
log(`link_stock ${LINKS * PRODUCTS} rows in ${((performance.now() - t) / 1000).toFixed(0)} s`);
t = performance.now();
for (let d = 0; d < 30; d++) {
  const day = new Date(Date.now() + 5.5 * 3600e3 - d * 86400e3).toISOString().slice(0, 10);
  await pool.query(`INSERT INTO roll_daily(tenant_id, link_id, day, product_id, qty, value)
    SELECT $1, 'L' || l, $2::date, 'P' || (1 + (l * 31 + k * 17 + $4::int) % $5::int), 6 + (l + k) % 30, 200 + (l * k) % 900 FROM generate_series(1, $3::int) l, generate_series(1, $6::int) k
    ON CONFLICT DO NOTHING`, [T, day, LINKS, d, PRODUCTS, SOLD]);
}
log(`roll_daily ${LINKS * 30 * SOLD} rows in ${((performance.now() - t) / 1000).toFixed(0)} s`);
const month = today.slice(0, 7);
await pool.query(`INSERT INTO roll_link_month(tenant_id, link_id, month, value, returns, bills) SELECT $1, 'L' || g, $2, 500000 + g, 0, 900 FROM generate_series(1, $3) g`, [T, month, LINKS]);
await pool.query(`INSERT INTO roll_shop_month(tenant_id, link_id, month, shop_id, value) SELECT $1, 'L' || l, $2, 'S' || l || '-' || s, 1000 FROM generate_series(1, $3::int) l, generate_series(1, 200) s`, [T, month, LINKS]);
await pool.query(`INSERT INTO roll_product_month(tenant_id, month, product_id, qty, value) SELECT $1, to_char(day, 'YYYY-MM'), product_id, sum(qty), sum(value) FROM roll_daily WHERE tenant_id=$1 GROUP BY 2, 3`, [T]);
await pool.query('ANALYZE');
const { companyReport, refreshCover, refreshChanged } = await import('../src/reports.js');
t = performance.now(); await refreshCover(pool, T); const full = Math.round(performance.now() - t); log('daily remake, every stock row', full, 'ms');
// a busy few minutes: 2,000 distributors billed, 10 products each changed → 20,000 product figures to remake
await pool.query(`INSERT INTO cover_dirty(tenant_id, link_id, product_id) SELECT $1, 'L' || l, 'P' || (1 + (l * 7 + k * 101) % $2::int) FROM generate_series(1, 2000) l, generate_series(1, 10) k`, [T, PRODUCTS]);
t = performance.now(); const n = await refreshChanged(pool, T); const changedMs = Math.round(performance.now() - t); log(`remake ${n} changed products`, changedMs, 'ms');
const R: Record<string, unknown> = { links: LINKS, products: PRODUCTS, stockRows: LINKS * PRODUCTS, dailyRows: LINKS * 30 * SOLD, dailyRemakeMs: full, changed20kMs: changedMs };
for (const [kind, args] of [['links', {}], ['products', {}], ['stock', { status: 'low' }], ['outlets', { q: 'S1' }], ['stock', { dbLinkId: 'L42' }], ['products', { dbLinkId: 'L42' }]] as [string, Record<string, unknown>][]) {
  const s = performance.now(); await companyReport(pool, T, null, kind, { ...args, month }); const ms = Math.round(performance.now() - s);
  R[`${kind}${args.dbLinkId ? ' (one distributor)' : ''}`] = ms; log(kind, args, ms, 'ms');
}
R.mbHeap = Math.round(process.memoryUsage().heapUsed / 1e6);
R.dbMB = Math.round(Number((await pool.query(`SELECT pg_database_size('dbrox') s`)).rows[0].s) / 1e6);
writeFileSync(OUT, JSON.stringify(R, null, 1));
await pool.end(); await pgServer.stop(); process.exit(0);
