// Round 5 (pre-pilot): STOCK NEVER LOSES A CHANGE WHEN TWO PHONES WORK AT ONCE.
// Stock travels as movements (stockMoves: lot, delta), never as an overwritten total: the server's lot qty is the sum
// of its movements, a movement that would take a lot below zero is refused (that record only), and every phone is
// sent the true qty. A driver's delivery result is never wiped by an older copy of the bill from the owner's phone.
// Written before the fix: (a)–(d) failed on the old newest-whole-record-wins sync.
import { CONSENT } from './fixtures.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { freePort, issueNumbers, billNo, realBill } from './fixtures.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pgServer: EmbeddedPostgres;
let pool: pg.Pool;
type App = Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
let app: App;
const port = await freePort();

beforeAll(async () => {
  pgServer = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'hanubix-pg-stock-' + Date.now()), user: 'postgres', password: 'pw', port, persistent: false });
  await pgServer.initialise(); await pgServer.start(); await pgServer.createDatabase('dbrox');
  pool = new pg.Pool({ connectionString: `postgres://postgres:pw@localhost:${port}/dbrox` });
  pool.on('error', () => {});
  const { migrate } = await import('../src/db.js'); await migrate(pool);
  const { buildApp } = await import('../src/app.js'); app = await buildApp(pool);
}, 120000);
afterAll(async () => { await app?.close(); await pool?.end(); await pgServer?.stop(); });

let ipNo = 0;
const freshIp = () => `10.5.${Math.floor(++ipNo / 250)}.${ipNo % 250 + 1}`;
const post = async (url: string, body: unknown, token?: string) => {
  const r = await app.inject({ method: 'POST', url, payload: body as object, headers: { 'x-forwarded-for': freshIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  let b; try { b = r.json(); } catch { b = r.body; }
  return { status: r.statusCode, body: b };
};
let clock = 0;
const iso = () => new Date(Date.now() - 600000 + (clock += 1000)).toISOString(); // every save a second after the last
type Ch = { table: string; id: string; updatedAt: string; data: Record<string, unknown> };
/** a phone's push, as the app sends it (moves: this phone sends stock as movements) */
const sync = (t: string, changes: Ch[], legacy = false) => post('/v1/sync', legacy ? { cursor: 0, changes } : { cursor: 0, changes, moves: 1 }, t);
const ch = (table: string, id: string, data: Record<string, unknown>, at = iso()): Ch => ({ table, id, updatedAt: at, data: { id, ...data } });
let mv = 0;
const move = (batchId: string, delta: number, reason = 'stock out') => ch('stockMoves', `mv${++mv}`, { batchId, productId: 'p1', delta, reason, at: iso() });
const lot = (id: string, qty: number) => ch('batches', id, { productId: 'p1', batch: 'B1', expiry: '2099-12-31', mrp: 50, qty, godown: 'Main' });
const doc = async (tbl: string, id: string) => (await pool.query('SELECT data FROM docs WHERE tbl=$1 AND id=$2', [tbl, id])).rows[0]?.data;
const qty = async (id: string) => Number((await doc('batches', id))?.qty);
const sumMoves = async (id: string) => Number((await pool.query(`SELECT COALESCE(sum((data->>'delta')::int),0) AS s FROM docs WHERE tbl='stockMoves' AND data->>'batchId'=$1`, [id])).rows[0].s);

const T = { owner: '', office: '', godown: '', delivery: '', tenant: '' };
beforeAll(async () => {
  const s = await post('/v1/signup', { consent: CONSENT, firmName: 'Stock Agencies', ownerName: 'Owner', phone: '9710000001', pin: '482613' });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  T.owner = s.body.token; T.tenant = s.body.tenantId;
  const pins: Record<string, string> = { office: '6831', godown: '7416', delivery: '5072' };
  const roles = ['office', 'godown', 'delivery'] as const;
  expect((await sync(T.owner, roles.map((role, i) => ch('staff', `st-${role}`, { name: role, phone: `971000001${i}`, role, pin: pins[role], active: true })))).body.rejected).toEqual([]);
  for (const [i, role] of roles.entries()) { const l = await post('/v1/login', { phone: `971000001${i}`, pin: pins[role] }); expect(l.status).toBe(200); T[role] = l.body.token; }
  await issueNumbers(pool, T.tenant);
}, 60000);

/** a lot made on the owner's phone: the lot record and its opening movement, in one push */
async function opening(id: string, n: number) {
  const r = await sync(T.owner, [lot(id, n), move(id, n, 'opening stock')]);
  expect(r.body.rejected).toEqual([]);
  expect(await qty(id)).toBe(n);
}

describe('stock travels as movements: two phones never lose a change', () => {
  it('(a) office bills 10 and the owner bills 20 from the same lot within one sync gap → 100 − 10 − 20 = 70', async () => {
    await opening('A', 100);
    // both phones last saw 100; each sends its own copy of the lot (90 / 80) and its movement
    const office = await sync(T.office, [lot('A', 90), move('A', -10)]);
    const owner = await sync(T.owner, [lot('A', 80), move('A', -20)]);
    expect(office.body.rejected).toEqual([]); expect(owner.body.rejected).toEqual([]);
    expect(await qty('A')).toBe(70);
    expect(await sumMoves('A')).toBe(70);
    // every phone is sent the true qty back, whatever copy it sent
    expect(owner.body.current.find((c: Ch) => c.table === 'batches' && c.id === 'A')?.data.qty).toBe(70);
  });

  it('(b) goods received on the godown phone while the owner bills → both counted', async () => {
    await opening('B', 100);
    await sync(T.godown, [lot('B', 150), move('B', +50, 'stock in')]);
    await sync(T.owner, [lot('B', 80), move('B', -20)]);
    expect(await qty('B')).toBe(130);
    expect(await sumMoves('B')).toBe(130);
  });

  it('(c) a movement that would take a lot below zero is refused (that record only); the phone gets the server qty', async () => {
    await opening('C', 100);
    await sync(T.office, [lot('C', 30), move('C', -70)]);
    const m = move('C', -40); const other = lot('C2', 5); const m2 = move('C2', 5, 'stock in');
    const r = await sync(T.owner, [lot('C', 60), m, other, m2]);
    expect(r.body.rejected).toEqual([`stockMoves|${m.id}`]);         // only the movement that does not fit
    expect(await qty('C')).toBe(30);
    expect(await qty('C2')).toBe(5);
    expect(await doc('stockMoves', m.id)).toBeUndefined();
    expect(r.body.current.find((c: Ch) => c.table === 'batches' && c.id === 'C')?.data.qty).toBe(30);
  });

  it('a movement sent twice (no reply the first time) is counted once; a movement is never changed', async () => {
    await opening('D', 10);
    const m = move('D', -3);
    await sync(T.office, [m]); await sync(T.office, [m]);
    expect(await qty('D')).toBe(7);
    const forged = await sync(T.office, [{ ...m, updatedAt: iso(), data: { ...m.data, delta: -9 } }]);
    expect(forged.body.rejected).toEqual([]); // the stored one stands
    expect(await qty('D')).toBe(7);
    expect((await doc('stockMoves', m.id)).delta).toBe(-3);
  });

  it('a lot record never sets the qty by itself (a new lot starts at 0 until its movement comes)', async () => {
    await sync(T.godown, [lot('E', 999)]);
    expect(await qty('E')).toBe(0);
    await sync(T.godown, [move('E', 12, 'stock in')]);
    expect(await qty('E')).toBe(12);
    // a movement for a lot the server does not have is refused, never invented
    const m = move('nowhere', 5, 'stock in');
    expect((await sync(T.godown, [m])).body.rejected).toEqual([`stockMoves|${m.id}`]);
  });

  it('a phone on the old app (no movements) still works: its whole lot wins as before, and the change is kept as a movement', async () => {
    await opening('F', 40);
    await sync(T.office, [lot('F', 35)], true);
    expect(await qty('F')).toBe(35);
    expect(await sumMoves('F')).toBe(35);
    // a phone that updated with unsent stock changes marks those lots legacyQty: the whole lot wins once
    await sync(T.office, [{ ...lot('F', 31), data: { ...lot('F', 31).data, legacyQty: true } }]);
    expect(await qty('F')).toBe(31);
    expect(await sumMoves('F')).toBe(31);
    expect((await doc('batches', 'F')).legacyQty).toBeUndefined();
  });

  it('existing lots migrate: one opening movement per lot equal to its qty', async () => {
    await pool.query(`INSERT INTO docs(tenant_id,tbl,id,data,updated_at) VALUES ($1,'batches','OLD',$2,now())`, [T.tenant, { id: 'OLD', productId: 'p1', qty: 44, expiry: '2099-12-31' }]);
    const sql = readFileSync(new URL('../db/012_stock_moves.sql', import.meta.url), 'utf8');
    await pool.query(sql); await pool.query(sql); // safe to run twice
    expect(await sumMoves('OLD')).toBe(44);
    for (const id of ['A', 'B', 'C']) expect(await sumMoves(id), id).toBe(await qty(id)); // lots that already had movements are left alone
  });

  it('every lot of the distributor: qty = sum of its movements', async () => {
    const lots = (await pool.query(`SELECT id, (data->>'qty')::int AS q FROM docs WHERE tenant_id=$1 AND tbl='batches'`, [T.tenant])).rows;
    for (const l of lots) expect(await sumMoves(l.id), l.id).toBe(l.q);
  });
});

describe('(d) a driver\'s delivery result is never wiped by an older copy of the bill', () => {
  it('the owner saves an older copy (made before the delivery) → the delivery result and its lots stay', async () => {
    const number = billNo(5001);
    const inv = realBill({ number, companyId: 'c1', shopId: 's1', date: '2026-11-11', kind: 'B2C', schemeSaving: 0, deliveryStatus: 'planned', tripId: 't1',
      lines: [{ productId: 'p1', name: 'Soap', hsn: '3401', qty: 10, freeQty: 0, rate: 10, mrp: 12, gross: 100, discount: 0, taxable: 100, total: 118, gst: 18, schemeNames: [], batches: [{ batchId: 'A', batch: 'B1', qty: 10, expiry: '2099-12-31' }] }] });
    const ownerCopy = ch('invoices', 'inv-d', inv);
    expect((await sync(T.owner, [ownerCopy])).body.rejected).toEqual([]);
    // the driver: 3 short, back to stock (its copy's keys are in the phone's order, not the server's: never a reason to refuse)
    const lines = (inv.lines as Record<string, unknown>[]).map(l => ({ ...l, batches: [{ batchId: 'A', batch: 'B1', qty: 7, expiry: '2099-12-31' }] }));
    const delivery = { at: iso(), by: 'st-delivery', shortages: [{ productId: 'p1', qty: 3, reason: 'Not loaded / short' }], excess: [] };
    const d = await sync(T.delivery, [ch('invoices', 'inv-d', { ...inv, lines, deliveryStatus: 'partial', delivery }), move('A', 3, 'back to stock')]);
    expect(d.body.rejected).toEqual([]);
    // the owner's phone had not synced: it prints its older copy (a later save of the bill, without the delivery)
    const older = await sync(T.owner, [ch('invoices', 'inv-d', { ...inv, printedAt: iso() })]);
    expect(older.body.rejected).toEqual([]);
    const now = await doc('invoices', 'inv-d');
    expect(now.deliveryStatus).toBe('partial');
    expect(now.delivery?.shortages?.[0]?.qty).toBe(3);
    expect(now.lines[0].batches[0].qty).toBe(7);       // the pieces the driver brought back are not on the bill again
    expect(now.printedAt).toBeTruthy();                // the owner's own change is kept
  });

  it('an owner who has seen the delivery result can still change it (re-plan): their copy wins', async () => {
    const now = await doc('invoices', 'inv-d');
    const r = await sync(T.owner, [ch('invoices', 'inv-d', { ...now, diffAction: 'credit_note' })]);
    expect(r.body.rejected).toEqual([]);
    expect((await doc('invoices', 'inv-d')).diffAction).toBe('credit_note');
    expect((await doc('invoices', 'inv-d')).deliveryStatus).toBe('partial');
  });
});
