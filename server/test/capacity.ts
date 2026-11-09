// Capacity test: real server + real Postgres on this machine, realistic distributor day, then measures
//   1) write syncs (bills/orders/payments the size the app makes), 2) "anything new?" syncs, 3) bytes stored per record.
// Usage: TENANTS=100 PHONES=10 SECONDS=60 npx tsx test/capacity.ts
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TENANTS = Number(process.env.TENANTS ?? 100);
const PHONES = Number(process.env.PHONES ?? 10);
const SECONDS = Number(process.env.SECONDS ?? 60);
const DAY = { invoices: 200, orders: 200, payments: 150 }; // one distributor's day
const port = 54400 + Math.floor(Math.random() * 500);

const pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'cap-pg-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false });
await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
process.env.DATABASE_URL = `postgres://postgres:pw@localhost:${port}/dbrox`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const { migrate } = await import('../src/db.js');
await migrate(pool);
const { buildApp } = await import('../src/app.js');
const app = await buildApp(pool);
await app.listen({ host: '127.0.0.1', port: 0 });
const addr = app.server.address() as { port: number };
const SERVER = `http://127.0.0.1:${addr.port}`;

const post = async (path: string, body: unknown, token?: string) => {
  const r = await fetch(SERVER + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json() as Promise<any>;
};
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]) : 0; };

// records the size the app makes (12-line bill, 12-line order, payment)
const now = () => new Date().toISOString();
const line = (l: number) => ({ productId: `prod-${l}-xxxxxxxxxxxx`, batchId: `bat-${l}-xxxxxxxxxxxx`, qty: 12, freeQty: 0, rate: 31.5, mrp: 38, discount: 0, schemeId: null, gst: 5, taxable: 360, cgst: 9, sgst: 9, igst: 0, total: 378, name: 'Lifebuoy Soap 125g', hsn: '34011190' });
const invoice = (i: number) => ({ number: `SMD/${i}`, date: now().slice(0, 10), shopId: 'shop-xxxxxxxxxxxxxxxx', orderId: 'ord-xxxxxxxxxxxxxxxx', companyId: 'co-xxxxxxxx', salesmanId: 'stf-xxxxxxxx', lines: Array.from({ length: 12 }, (_, l) => line(l)), taxable: 4320, cgst: 108, sgst: 108, igst: 0, roundOff: 0.0, total: 4536, deliveryStatus: 'planned', paid: 0, createdAt: now(), createdBy: 'stf-xxxxxxxx' });
const order = (i: number) => ({ shopId: 'shop-xxxxxxxxxxxxxxxx', salesmanId: 'stf-xxxxxxxx', date: now().slice(0, 10), status: 'approved', lines: Array.from({ length: 12 }, (_, l) => ({ productId: `prod-${l}-xxxxxxxxxxxx`, qty: 12, rate: 31.5 })), note: '', createdAt: now(), createdBy: 'stf-xxxxxxxx', n: i });
const payment = (i: number) => ({ shopId: 'shop-xxxxxxxxxxxxxxxx', amount: 1500 + i, mode: 'upi', ref: '412345678901', date: now().slice(0, 10), allocations: [{ invoiceId: 'inv-xxxxxxxxxxxx', amount: 1500 }], collectedBy: 'stf-xxxxxxxx', createdAt: now() });
const sizes = { invoices: JSON.stringify(invoice(1)).length, orders: JSON.stringify(order(1)).length, payments: JSON.stringify(payment(1)).length };

// 1) sign up distributors
const t0 = performance.now();
const base = 7000000000 + Math.floor(Math.random() * 900000000);
const tokens: string[] = [];
for (let i = 0; i < TENANTS; i += 20) tokens.push(...await Promise.all(Array.from({ length: Math.min(20, TENANTS - i) }, (_, k) => post('/v1/signup', { firmName: `Load ${i + k}`, ownerName: 'Owner', phone: String(base + (i + k) * 10), pin: '1111' }).then(s => s.token as string))));
console.log(`signed up ${TENANTS} distributors in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// 2) one full business day per distributor, sent by its phones in syncs of 20 records
const writeTimes: number[] = []; let writeFails = 0, records = 0;
const jobs: (() => Promise<void>)[] = [];
for (let t = 0; t < TENANTS; t++) {
  const recs: { table: string; id: string; updatedAt: string; data: unknown }[] = [];
  for (const [tbl, n] of Object.entries(DAY)) for (let k = 0; k < n; k++) recs.push({ table: tbl, id: `${tbl}-${t}-${k}`, updatedAt: now(), data: tbl === 'invoices' ? invoice(k) : tbl === 'orders' ? order(k) : payment(k) });
  for (let k = 0; k < recs.length; k += 20) { const chunk = recs.slice(k, k + 20); jobs.push(async () => { const s = performance.now(); try { await post('/v1/sync', { cursor: 0, changes: chunk }, tokens[t]); records += chunk.length; } catch { writeFails++; } writeTimes.push(performance.now() - s); }); }
}
const run = async (list: (() => Promise<void>)[], conc: number) => { let i = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < list.length) await list[i++](); })); };
const w0 = performance.now();
await run(jobs, 50);
const wSecs = (performance.now() - w0) / 1000;
console.log(`WRITE: ${records} records in ${jobs.length} syncs, ${wSecs.toFixed(1)} s → ${Math.round(records / wSecs)} records/s, ${Math.round(jobs.length / wSecs)} syncs/s · p50 ${pct(writeTimes, .5)} ms p95 ${pct(writeTimes, .95)} ms p99 ${pct(writeTimes, .99)} ms · failures ${writeFails}`);

// 3) "anything new?" syncs: every phone with its cursor at the latest, for SECONDS
const cursors = new Map<number, number>();
for (let t = 0; t < TENANTS; t++) { let c = 0, more = true; while (more) { const r = await post('/v1/sync', { cursor: c, changes: [] }, tokens[t]); c = r.cursor; more = r.more; } cursors.set(t, c); }
const pollTimes: number[] = []; let pollFails = 0; const end = performance.now() + SECONDS * 1000;
const p0 = performance.now();
await Promise.all(Array.from({ length: Math.min(200, TENANTS * PHONES) }, async (_, k) => {
  const t = k % TENANTS;
  while (performance.now() < end) { const s = performance.now(); try { await post('/v1/sync', { cursor: cursors.get(t), changes: [] }, tokens[t]); } catch { pollFails++; } pollTimes.push(performance.now() - s); }
}));
const pSecs = (performance.now() - p0) / 1000;
console.log(`POLL: ${pollTimes.length} syncs in ${pSecs.toFixed(1)} s → ${Math.round(pollTimes.length / pSecs)} syncs/s · p50 ${pct(pollTimes, .5)} ms p95 ${pct(pollTimes, .95)} ms p99 ${pct(pollTimes, .99)} ms · failures ${pollFails}`);

// 4) bytes stored
await pool.query('VACUUM ANALYZE docs');
const per = (await pool.query(`SELECT tbl, count(*)::int n, avg(pg_column_size(data))::int col FROM docs GROUP BY tbl ORDER BY tbl`)).rows;
const total = Number((await pool.query(`SELECT sum(pg_total_relation_size(c.oid))::bigint s FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid WHERE i.inhparent = 'docs'::regclass`)).rows[0].s);
const n = per.reduce((s, r) => s + r.n, 0);
console.log(`JSON sizes sent (B): ${JSON.stringify(sizes)}`);
console.log(`STORED: ${n} docs, ${(total / 1048576).toFixed(1)} MB with indexes → ${Math.round(total / n)} B per record · column size by table ${JSON.stringify(per)}`);
console.log(`PER DISTRIBUTOR-DAY: ${(total / TENANTS / 1048576).toFixed(2)} MB`);

await app.close(); await pool.end(); await pgServer.stop();
