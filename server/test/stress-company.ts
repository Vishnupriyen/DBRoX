// Company-module stress test: real server + real Postgres on this machine. A slice of the target world (500 brands,
// 100,000 distributors) with the same shape: each distributor carries several linked brands, one giant brand is linked
// to most distributors. Measures every path that grows with scale, then the report scales the numbers up.
// Usage: COMPANIES=20 DBS=600 PER_DB=3 GIANT=400 PRODUCTS=300 npx tsx test/stress-company.ts
import { CONSENT } from './fixtures.js';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

const COMPANIES = Number(process.env.COMPANIES ?? 20), DBS = Number(process.env.DBS ?? 600), PER_DB = Number(process.env.PER_DB ?? 3);
const GIANT = Number(process.env.GIANT ?? 400), PRODUCTS = Number(process.env.PRODUCTS ?? 300), BILLS = Number(process.env.BILLS ?? 120);
const OUT = process.env.OUT ?? '/tmp/stress-company.json';
const port = 54900 + Math.floor(Math.random() * 90);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

const pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'stress-pg-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false, onLog: () => {} });
await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
process.env.DATABASE_URL = `postgres://postgres:pw@localhost:${port}/dbrox`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const { migrate } = await import('../src/db.js'); await migrate(pool);
const { buildApp } = await import('../src/app.js');
const app = await buildApp(pool);
await app.listen({ host: '127.0.0.1', port: 0 });
const SERVER = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

const post = async (path: string, body: unknown, token?: string) => {
  const r = await fetch(SERVER + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<any>;
};
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]) : 0; };
const run = async <T,>(list: (() => Promise<T>)[], conc: number) => { let i = 0; const out: T[] = []; await Promise.all(Array.from({ length: conc }, async () => { while (i < list.length) { const k = i++; out[k] = await list[k](); } })); return out; };
const now = () => new Date().toISOString();
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const ch = (table: string, data: Record<string, unknown>) => ({ table, id: String(data.id), updatedAt: now(), data });
// the relay runs in the background: wait for it to finish handing everything over, and time it
// finished = nothing waiting AND nothing being written, and (when given) the other side really has it all
const { relayBacklog } = await import('../src/link.js');
const drained = async (arrived?: () => Promise<boolean>) => { const s = performance.now(); for (;;) { if (!(await relayBacklog(pool)) && (!arrived || await arrived())) break; await new Promise(r => setTimeout(r, 200)); } return +((performance.now() - s) / 1000).toFixed(1); };
const countQ = async (sql: string, args: unknown[] = []) => Number((await pool.query(sql, args)).rows[0].n);
const R: Record<string, unknown> = { companies: COMPANIES, distributors: DBS, brandsPerDistributor: PER_DB, giantLinkedTo: GIANT, productsPerBrand: PRODUCTS, billsPerDistributor: BILLS };

// ---- 1. sign up brands and distributors
let t = performance.now();
const base = 6000000000 + Math.floor(Math.random() * 300000000);
const cos = await run(Array.from({ length: COMPANIES }, (_, i) => () => post('/v1/signup', { consent: CONSENT, firmName: `Brand ${i}`, ownerName: 'HO', phone: String(base + i), pin: '391742', kind: 'company' })), 10);
const dbs = await run(Array.from({ length: DBS }, (_, i) => () => post('/v1/signup', { consent: CONSENT, firmName: `Distributor ${i}`, ownerName: 'O', phone: String(base + 100000 + i), pin: '391742', gstin: `33D${String(i).padStart(7, '0')}A1Z5` })), 20);
log(`signed up ${COMPANIES} brands + ${DBS} distributors in ${((performance.now() - t) / 1000).toFixed(1)} s`);

// which brands each distributor carries: brand 0 is the giant (GIANT distributors); the rest spread evenly
const carries: number[][] = Array.from({ length: DBS }, (_, d) => {
  const set = new Set<number>(); if (d < GIANT) set.add(0);
  let k = d; while (set.size < PER_DB) { set.add(1 + (k % (COMPANIES - 1))); k += 7; }
  return [...set];
});
const linksOf = (c: number) => carries.map((b, d) => b.includes(c) ? d : -1).filter(d => d >= 0);

// ---- 2. catalogues: each brand pushes its products; each distributor has its own copy of its brands' products
t = performance.now();
const prod = (c: number, p: number) => ({ id: `B${c}P${p}`, name: `Brand ${c} Product ${p} 500g`, code: `B${c}-${p}`, hsn: '19053100', gst: 5, mrp: 50, rate: 40, purchaseRate: 36, caseSize: 24, active: true, aliases: [] });
await run(cos.map((c, i) => () => post('/v1/sync', { cursor: 0, changes: Array.from({ length: PRODUCTS }, (_, p) => ch('products', prod(i, p))) }, c.token)), 4);
await run(dbs.map((d, i) => async () => {
  const changes = carries[i].flatMap(c => [ch('companies', { id: `c${c}`, name: `Brand ${c}`, code: `B${c}`, nextBillNo: 1 }),
    ...Array.from({ length: PRODUCTS }, (_, p) => ch('products', { ...prod(c, p), id: `d${i}c${c}p${p}`, companyId: `c${c}`, rate: 41 }))]);
  for (let k = 0; k < changes.length; k += 500) await post('/v1/sync', { cursor: 0, changes: changes.slice(k, k + 500) }, d.token);
}), 8);
log(`catalogues loaded in ${((performance.now() - t) / 1000).toFixed(1)} s`);

// ---- 3. linking: every brand invites its distributors; each accepts (the first exchange runs inside)
const invites: { c: number; d: number; code: string; id: string }[] = [];
for (let c = 0; c < COMPANIES; c++) for (const d of linksOf(c)) invites.push({ c, d, code: `S${String(c).padStart(2, '0')}${String(d).padStart(4, '0')}`.slice(0, 8), id: `L${c}x${d}` });
await run(cos.map((co, c) => async () => { const mine = invites.filter(x => x.c === c).map(x => ch('dbLinks', { id: x.id, name: `Distributor ${x.d}`, inviteCode: x.code, status: 'invited' })); for (let k = 0; k < mine.length; k += 500) await post('/v1/sync', { cursor: 0, changes: mine.slice(k, k + 500) }, co.token); }), 4);
const linkTimes: number[] = [];
t = performance.now();
await run(invites.map(x => async () => { const s = performance.now(); await post('/v1/link/accept', { code: x.code, companyIdInDb: `c${x.c}` }, dbs[x.d].token); linkTimes.push(performance.now() - s); }), 8);
const linkSecs = (performance.now() - t) / 1000;
R.link = { links: invites.length, seconds: +linkSecs.toFixed(1), perSecond: +(invites.length / linkSecs).toFixed(1), p50ms: pct(linkTimes, .5), p95ms: pct(linkTimes, .95), maxMs: pct(linkTimes, 1) };
log('LINK', R.link);

// ---- 4. a business day: each distributor's bills (one bill = one brand, as the app makes them) through sync + relay
const bill = (d: number, k: number) => { const c = carries[d][k % carries[d].length]; return { id: `inv-${d}-${k}`, number: `D${d}/${k}`, date: today, shopId: `shop-${d}-${k % 300}`, companyId: `c${c}`, lines: Array.from({ length: 6 }, (_, l) => ({ productId: `d${d}c${c}p${(k + l) % PRODUCTS}`, name: 'x', qty: 12, freeQty: 0, rate: 41, taxable: 492, total: 516.6 })), taxable: 2952, total: 3100, deliveryStatus: 'planned' }; };
const dayJobs: (() => Promise<void>)[] = []; const dayTimes: number[] = []; let dayFails = 0;
for (let d = 0; d < DBS; d++) for (let k = 0; k < BILLS; k += 20) { const changes = Array.from({ length: Math.min(20, BILLS - k) }, (_, j) => ch('invoices', bill(d, k + j))); dayJobs.push(async () => { const s = performance.now(); try { await post('/v1/sync', { cursor: 0, changes }, dbs[d].token); } catch { dayFails++; } dayTimes.push(performance.now() - s); }); }
t = performance.now();
await run(dayJobs, 40);
const daySecs = (performance.now() - t) / 1000;
const bills = DBS * BILLS;
const dayRelay = await drained(async () => (await countQ(`SELECT count(*)::int n FROM docs WHERE tbl='secondary'`)) >= bills);
R.day = { bills, syncs: dayJobs.length, seconds: +daySecs.toFixed(1), billsPerSecond: Math.round(bills / daySecs), p50ms: pct(dayTimes, .5), p95ms: pct(dayTimes, .95), p99ms: pct(dayTimes, .99), failures: dayFails, relayFinishedAfterSeconds: dayRelay, relayBillsPerSecond: Math.round(bills / (daySecs + dayRelay)) };
log('DAY', R.day);

// ---- 5. the giant brand changes prices: one product, then its whole price list (one sync from head office)
const giant = cos[0];
t = performance.now(); await post('/v1/sync', { cursor: 0, changes: [ch('products', { ...prod(0, 0), rate: 42 })] }, giant.token);
R.priceOne = { distributors: GIANT, syncMs: Math.round(performance.now() - t), reachedAllAfterSeconds: +((performance.now() - t) / 1000 + await drained(async () => (await countQ(`SELECT count(*)::int n FROM docs WHERE tbl='products' AND data->>'companyProductId' = 'B0P0' AND (data->>'rate')::numeric = 42`)) >= GIANT)).toFixed(1) };
log('PRICE ONE', R.priceOne);
t = performance.now();
let priceAllErr = '';
try { await post('/v1/sync', { cursor: 0, changes: Array.from({ length: PRODUCTS }, (_, p) => ch('products', { ...prod(0, p), rate: 43 })) }, giant.token); } catch (e) { priceAllErr = (e as Error).message; }
const priceSync = +((performance.now() - t) / 1000).toFixed(1);
R.priceAll = { products: PRODUCTS, distributors: GIANT, writes: PRODUCTS * GIANT, syncSeconds: priceSync, reachedAllAfterSeconds: +(priceSync + await drained(async () => (await countQ(`SELECT count(*)::int n FROM docs WHERE tbl='products' AND data->>'companyProductId' LIKE 'B0P%' AND (data->>'rate')::numeric = 43`)) >= PRODUCTS * GIANT)).toFixed(1), error: priceAllErr || undefined };
log('PRICE ALL', R.priceAll);

// ---- 6. what a head-office phone of the giant brand downloads on first login
t = performance.now();
let cursor = 0, more = true, docs = 0, bytes = 0, rounds = 0;
while (more && rounds < 5000) { const r = await fetch(SERVER + '/v1/sync', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${giant.token}` }, body: JSON.stringify({ cursor, changes: [] }) }); const txt = await r.text(); bytes += txt.length; const j = JSON.parse(txt); docs += j.changes.length; cursor = j.cursor; more = j.more; rounds++; }
R.hoFirstLogin = { docs, megabytes: +(bytes / 1048576).toFixed(1), seconds: +((performance.now() - t) / 1000).toFixed(1), rounds };
log('HO FIRST LOGIN', R.hoFirstLogin);
// head office's reports for the giant brand (answered on the server)
const rep: Record<string, number> = {};
for (const kind of ['links', 'products', 'stock', 'outlets']) { const s0 = performance.now(); await post('/v1/company/report', { kind, status: 'low' }, giant.token); rep[kind] = Math.round(performance.now() - s0); }
R.hoReportsMs = rep; log('HO REPORTS ms', rep);
const byTbl = (await pool.query(`SELECT tbl, count(*)::int n FROM docs WHERE tenant_id=$1 GROUP BY tbl ORDER BY n DESC`, [giant.tenantId])).rows;
R.giantDocs = Object.fromEntries(byTbl.map(r => [r.tbl, r.n]));

// ---- 7. storage
await pool.query('VACUUM ANALYZE docs');
const per = (await pool.query(`SELECT tbl, count(*)::int n, avg(pg_column_size(data))::int col FROM docs GROUP BY tbl ORDER BY n DESC`)).rows;
const total = Number((await pool.query(`SELECT sum(pg_total_relation_size(c.oid))::bigint s FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid WHERE i.inhparent = 'docs'::regclass`)).rows[0].s);
R.storage = { totalMB: +(total / 1048576).toFixed(0), docs: per.reduce((a, r) => a + r.n, 0), byTable: Object.fromEntries(per.map(r => [r.tbl, { n: r.n, avgBytes: r.col }])) };
log('STORAGE', R.storage);
writeFileSync(OUT, JSON.stringify(R, null, 1));
await app.close(); await pool.end(); await pgServer.stop();
process.exit(0);
