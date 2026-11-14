// THE MONEY & STOCK LAWS — a chaos test.
// It plays a distributor's day thousands of times in random order: orders, picking, billing (with double taps),
// planning, delivery (short, damaged, refused, extra, double taps), trip end, day-close differences, payments,
// cancels (twice), and undo of random past actions. After EVERY step it checks the laws below.
// If any law breaks, the test prints the seed and the exact steps so the bug can be replayed.
//   CHAOS_STEPS=2000 CHAOS_SEEDS=5 npx vitest run tests/laws.test.ts   (the gate runs a lighter version)
import { CONSENT } from '../../server/test/fixtures';
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ChangeSet, db, newId, onSide, RoxDB, setSession, undoBatch, today } from '../src/core/db';
import { countLot, makeInvoices } from '../src/core/billing';
import { nextNumbers, syncNow } from '../src/core/sync';
import type { Batch, Order, Product, Shop } from '../src/core/types';
import { seedDemo } from '../src/core/seed';
import {
  bookOrder, approveOrder, suggestPick, pickOrder, approvePicked, suggestPlan, confirmPlan, tripLoaded, startTrip,
  recordDelivery, endTrip, settleDifference, cancelInvoice,
} from '../src/core/pipeline';
import { allocateOldestFirst, invoiceBalances, r2 } from '../src/core/ledger';
import { lineCredits } from '../src/core/gst';
import { makeCreditNote, openPaid } from '../src/core/credit';

const STEPS = Number(process.env.CHAOS_STEPS ?? 160);
const SEEDS = (process.env.CHAOS_SEEDS ?? '1,2,3').split(',').map(Number).flatMap(n => (process.env.CHAOS_SEEDS && !process.env.CHAOS_SEEDS.includes(',') ? Array.from({ length: n }, (_, i) => i + 1) : [n]));

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; }; }

// ---------------------------------------------------------------- the laws
async function stockLedger() {
  // every piece is in exactly one place: on the shelf, out on a live bill, or written off as van damage
  const t = new Map<string, number>();
  const add = (pid: string, q: number) => t.set(pid, (t.get(pid) ?? 0) + q);
  for (const b of await db.batches.toArray()) add(b.productId, b.qty);
  for (const i of await db.invoices.toArray()) if (!i.cancelled) for (const l of i.lines) for (const b of l.batches) add(l.productId, b.qty);
  for (const c of await db.claimEntries.toArray()) if (c.kind === 'transit' && c.productId) add(c.productId, c.qty);
  return t;
}
async function checkLaws(start: Map<string, number>): Promise<string[]> {
  const broken: string[] = [];
  const now = await stockLedger();
  for (const [pid, q] of start) if ((now.get(pid) ?? 0) !== q) broken.push(`STOCK NOT CONSERVED for ${pid}: started ${q}, now ${now.get(pid) ?? 0}`);
  for (const b of await db.batches.toArray()) if (b.qty < 0 || !Number.isInteger(b.qty)) broken.push(`BAD STOCK COUNT ${b.id}: ${b.qty}`);
  // every change of a lot's qty is a stock movement (the server adds these up): lot qty = the sum of its movements
  const moved = new Map<string, number>(); for (const m of await db.stockMoves.toArray()) moved.set(m.batchId, (moved.get(m.batchId) ?? 0) + m.delta);
  for (const b of await db.batches.toArray()) if ((moved.get(b.id) ?? 0) !== b.qty) broken.push(`STOCK CHANGED WITHOUT A MOVEMENT ${b.batch}: qty ${b.qty}, movements add up to ${moved.get(b.id) ?? 0}`);
  const invs = await db.invoices.toArray();
  const nums = new Map<string, number>(); for (const i of invs) nums.set(i.number, (nums.get(i.number) ?? 0) + 1);
  for (const [n, c] of nums) if (c > 1) broken.push(`BILL NUMBER REPEATED ${n} ×${c}`);
  const cns = await db.creditNotes.toArray();
  const cn = new Map<string, number>(); for (const c of cns) cn.set(c.number, (cn.get(c.number) ?? 0) + 1);
  for (const [n, c] of cn) if (c > 1) broken.push(`CREDIT NOTE NUMBER REPEATED ${n} ×${c}`);
  for (const i of invs) {
    if (!Number.isFinite(i.total) || i.total < 0) broken.push(`BAD BILL TOTAL ${i.number}: ${i.total}`);
    const exact = r2(i.taxable + i.cgst + i.sgst + i.igst);
    if (Math.abs(r2(exact + i.roundOff) - i.total) > 0.011) broken.push(`BILL DOES NOT ADD UP ${i.number}: tax parts ${exact} + round ${i.roundOff} ≠ ${i.total}`);
    const lineSum = r2(i.lines.reduce((a, l) => a + l.taxable, 0));
    if (Math.abs(lineSum - i.taxable) > 0.02) broken.push(`BILL LINES ≠ TAXABLE ${i.number}: ${lineSum} vs ${i.taxable}`);
    if (i.lines.some(l => l.batches.some(b => b.qty < 0))) broken.push(`NEGATIVE PIECES ON BILL ${i.number}`);
    // the same product on two lines: scheme-free pieces only ever on its first line (worked out once, GST rule 3)
    i.lines.forEach((l, k) => { if (l.freeQty > 0 && i.lines.findIndex(x => x.productId === l.productId) !== k) broken.push(`FREE PIECES TWICE ${i.number}: line ${k + 1} of ${l.productId}`); });
  }
  // a bill's credit notes never come to more than it charged, and never credit more paid pieces than a line billed
  for (const i of invs) {
    const mine = cns.filter(c => c.invoiceId === i.id); if (!mine.length) continue;
    const sum = r2(mine.reduce((a, c) => a + c.total, 0));
    if (sum > i.total + 0.01) broken.push(`CREDITED MORE THAN BILLED ${i.number}: credit notes ${sum} > bill ${i.total}`);
    lineCredits(i, mine).forEach((c, k) => { if (c.paid > i.lines[k].qty) broken.push(`CREDITED MORE PIECES THAN BILLED ${i.number} line ${k + 1}: ${c.paid} > ${i.lines[k].qty}`); });
  }
  // claim lines follow their bill: a cancelled bill keeps no live scheme claim line
  const cancelledIds = new Set(invs.filter(i => i.cancelled).map(i => i.id));
  for (const c of await db.claimEntries.toArray()) if (c.kind === 'scheme' && c.invoiceId && cancelledIds.has(c.invoiceId) && !c.dropped) broken.push(`CLAIM LINE KEPT FOR CANCELLED BILL ${c.invoiceId}`);
  // an order is billed at most once
  const byOrder = new Map<string, number>(); for (const i of invs) if (i.orderId && !i.cancelled) byOrder.set(`${i.orderId}|${i.companyId}`, (byOrder.get(`${i.orderId}|${i.companyId}`) ?? 0) + 1);
  for (const [k, c] of byOrder) if (c > 1) broken.push(`ORDER BILLED TWICE ${k} ×${c}`);
  // money: what shops owe = live bills − credit notes on them − money received (never lost, never doubled)
  const bal = await invoiceBalances();
  const owed = r2(bal.reduce((a, b) => a + b.balance, 0));
  const live = invs.filter(i => !i.cancelled);
  const liveIds = new Set(live.map(i => i.id));
  const billed = r2(live.reduce((a, i) => a + i.total, 0));
  const credited = r2(cns.filter(c => liveIds.has(c.invoiceId)).reduce((a, c) => a + c.total, 0));
  const received = r2((await db.payments.toArray()).filter(p => p.status !== 'cancelled' && p.status !== 'bounced').reduce((a, p) => a + p.amount, 0));
  // balances never go below zero; money beyond what is owed is shop advance
  if (bal.some(b => b.balance < -0.01)) broken.push('A BILL SHOWS A NEGATIVE BALANCE');
  const advance = r2(received + credited - (billed - owed));
  if (advance < -0.05) broken.push(`MONEY LOST: billed ${billed}, credited ${credited}, received ${received}, still owed ${owed}`);
  return broken;
}

// ---------------------------------------------------------------- the random day
async function play(seed: number) {
  // fresh database per seed
  db.close(); await db.delete(); await db.open();
  try { localStorage.clear(); } catch { /* node */ }
  await seedDemo();
  const owner = (await db.staff.where('role').equals('owner').first())!;
  setSession('demo', owner.id);
  const R = rng(seed); const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const start = await stockLedger();
  const log: string[] = []; const batchIds: string[] = [];
  const first = await checkLaws(start);
  expect(first, 'laws must hold on the demo data itself').toEqual([]);

  for (let step = 0; step < STEPS; step++) {
    const roll = R(); let what = '';
    try {
      if (roll < 0.16) {
        const shop = pick((await db.shops.toArray()).filter(s => s.active !== false));
        const prods = (await db.products.toArray()).filter(p => p.active);
        const lines: { productId: string; qty: number; rate: number; discountPct?: number }[] = Array.from({ length: 1 + Math.floor(R() * 3) }, () => { const p = pick(prods); return { productId: p.id, qty: 1 + Math.floor(R() * 12), rate: p.rate }; });
        // Part 2 item 34: the same product on a second line, its own rate and Disc % (stock, free pieces, credits per line)
        if (R() < 0.35) lines.push({ productId: lines[0].productId, qty: 1 + Math.floor(R() * 8), rate: r2(lines[0].rate * (0.85 + R() * 0.2)), discountPct: pick([0, 2.5, 5, 10]) });
        const cs = new ChangeSet(); const o = await bookOrder(cs, shop, lines, 'chaos'); await cs.commit('booked');
        await approveOrder(o.id); what = `order ${shop.name} ${lines.map(l => l.qty).join('+')}`;
      } else if (roll < 0.30) {
        const o = pick((await db.orders.toArray()).filter(x => x.status === 'approved')); if (!o) continue;
        const sug = await suggestPick(o);
        await pickOrder(o.id, sug.map(x => ({ productId: x.productId, line: x.line, qty: Math.max(0, Math.min(x.available, Math.floor(x.available * (R() < .3 ? R() : 1)))) })));
        what = `pick ${o.id.slice(0, 6)}`;
      } else if (roll < 0.44) {
        const o = pick((await db.orders.toArray()).filter(x => x.status === 'picked')); if (!o) continue;
        if (R() < 0.3) { const r = await Promise.allSettled([approvePicked(o.id), approvePicked(o.id)]); what = `bill DOUBLE TAP ${o.id.slice(0, 6)} → ${r.map(x => x.status).join('/')}`; const ok = r.find(x => x.status === 'fulfilled') as PromiseFulfilledResult<{ batchId: string }> | undefined; if (ok) batchIds.push(ok.value.batchId); }
        else { const r = await approvePicked(o.id); batchIds.push(r.batchId); what = `bill ${o.id.slice(0, 6)}`; }
      } else if (roll < 0.52) {
        const plan = await suggestPlan(); if (!plan.length) continue;
        await confirmPlan(plan);
        for (const t of (await db.trips.toArray()).filter(t => t.status === 'planned')) { await tripLoaded(t.id); await startTrip(t.id); }
        what = `plan + start ${plan.length} van(s)`;
      } else if (roll < 0.66) {
        const inv = pick((await db.invoices.toArray()).filter(i => i.deliveryStatus === 'out' && !i.cancelled)); if (!inv) continue;
        const kind = pick(['full', 'short', 'damaged', 'refused', 'extra', 'double']);
        const l = pick(inv.lines); const k = R() < 0.5 ? `${inv.id}|${l.productId}|${inv.lines.indexOf(l)}` : `${inv.id}|${l.productId}`; // per line, or the older per-product key
        const input = kind === 'refused' ? { returnAll: true }
          : kind === 'short' ? { short: { [k]: { qty: 1 + Math.floor(R() * l.qty), reason: 'short' } } }
          : kind === 'damaged' ? { short: { [k]: { qty: 1 + Math.floor(R() * l.qty), reason: 'damaged' } } }
          : kind === 'extra' ? { extra: { [k]: 1 + Math.floor(R() * 3) } } : {};
        if (kind === 'double') await Promise.allSettled([recordDelivery([inv.id], {}), recordDelivery([inv.id], {})]);
        else await recordDelivery([inv.id], input);
        what = `deliver ${inv.number} ${kind}`;
      } else if (roll < 0.70) {
        const t = pick((await db.trips.toArray()).filter(t => t.status === 'out')); if (!t) continue;
        const left = (await db.invoices.where('tripId').equals(t.id).toArray()).filter(i => i.deliveryStatus === 'out');
        await endTrip(t.id, Object.fromEntries(left.map(i => [i.id, pick(['godown', 'van', 'next'] as const)])));
        what = `end trip (${left.length} undelivered)`;
      } else if (roll < 0.76) {
        const inv = pick((await db.invoices.toArray()).filter(i => !i.cancelled && i.delivery && !i.diffAction && ((i.delivery.shortages?.length ?? 0) + (i.delivery.excess?.length ?? 0)) > 0)); if (!inv) continue;
        const a = pick(['modified', 'credit_note'] as const); await settleDifference(inv.id, a); what = `settle ${inv.number} ${a}`;
      } else if (roll < 0.86) {
        const shop = pick(await db.shops.toArray());
        const amount = r2(50 + R() * 3000);
        const { allocations, advance } = await allocateOldestFirst(shop.id, amount);
        const cs = new ChangeSet();
        cs.put('payments', { shopId: shop.id, amount, mode: pick(['cash', 'upi', 'cheque']), date: today(), collectedBy: 'chaos', shopConfirmed: true, allocations, advance, settled: false, status: 'ok' }, 'payment');
        batchIds.push(await cs.commit('Collected')); what = `pay ${shop.name} ${amount}`;
      } else if (roll < 0.92) {
        const inv = pick((await db.invoices.toArray()).filter(i => !i.cancelled)); if (!inv) continue;
        if (R() < 0.3) await Promise.allSettled([cancelInvoice(inv.id, 'chaos'), cancelInvoice(inv.id, 'chaos')]);
        else await cancelInvoice(inv.id, 'chaos');
        what = `cancel ${inv.number}`;
      } else if (roll < 0.95) {
        // a shop returns good pieces from a live bill → credit note (pieces back to stock)
        const inv = pick((await db.invoices.toArray()).filter(i => !i.cancelled && !(i.delivery && !i.diffAction && ((i.delivery.shortages?.length ?? 0) + (i.delivery.excess?.length ?? 0)) > 0) && i.lines.some(l => l.batches.some(b => b.qty > 0)))); if (!inv) continue;
        const cnsOf = await db.creditNotes.where('invoiceId').equals(inv.id).toArray();
        const l = pick(inv.lines.filter(x => x.batches.some(b => b.qty > 0)));
        const room = Math.min(openPaid(inv, cnsOf, l.productId), inv.lines.filter(x => x.productId === l.productId).reduce((a, x) => a + x.batches.reduce((y, b) => y + b.qty, 0), 0));
        if (room <= 0) continue;
        const qty = 1 + Math.floor(R() * room);
        const cs = new ChangeSet(); await makeCreditNote(cs, inv, [{ productId: l.productId, paid: qty, free: 0, restock: true }], { reason: 'chaos return', source: 'return', takeOffBill: true });
        batchIds.push(await cs.commit('Return')); what = `return ${qty} on ${inv.number}`;
      } else {
        const b = pick(batchIds); if (!b) continue;
        const n = await undoBatch(b); what = `undo → ${n}`;
      }
    } catch (e) {
      const name = (e as Error).name, msg = (e as Error).message;
      // refusals are fine (a guard, an "already billed", nothing to do); anything else is a crash = a bug
      if (name !== 'GuardError' && !/already|not picked|not found|reason is needed|Not enough stock/i.test(msg)) { log.push(`${step}: ${what} CRASH ${name}: ${msg}`); throw new Error(`seed ${seed}: crash at step ${step}\n${log.slice(-15).join('\n')}`); }
      what += ` (refused: ${msg.slice(0, 60)})`;
    }
    log.push(`${step}: ${what}`);
    const broken = await checkLaws(start);
    if (broken.length) throw new Error(`seed ${seed}: LAW BROKEN after step ${step}\n${broken.join('\n')}\n--- last steps ---\n${log.slice(-15).join('\n')}`);
  }
  return true;
}

describe('money & stock laws hold under chaos', () => {
  for (const seed of SEEDS) it(`random day #${seed} (${STEPS} actions)`, async () => { expect(await play(seed)).toBe(true); }, 600_000);
});

// ---------------------------------------------------------------- several phones, one real server
// The owner and office phones bill (and cancel, count, take returns), the godown phone takes stock in, the driver's phone
// records deliveries (short, refused, extra) — each phone offline for a while, then synced in random order against the
// real Hanubix server (Fastify + Postgres). THE LAW, after all phones sync: every lot's qty on every phone = opening + in
// − out = the server's qty; the server's qty = the sum of its movements; no movement made on any phone is ever lost
// (it is on the server, or still held on its phone) or counted twice.
type Server = Awaited<ReturnType<typeof import('../../server/test/harness').startServer>>;
let srv: Server;
const store = new Map<string, string>();
let ip = 0;
type Phone = { role: 'owner' | 'office' | 'godown' | 'delivery'; db: RoxDB; token: string; userId: string; batches: string[] };

async function playPhones(seed: number, steps: number) {
  const R = rng(seed * 7919); const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const call = async (path: string, body: object, token?: string) => (await srv.fetch(`http://srv.test${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': `10.77.${++ip % 250}.${seed % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) } })).json();
  const ownerPhone = `9${String(seed).padStart(4, '0')}00009`;
  const up = await call('/v1/signup', { consent: CONSENT, firmName: `Chaos ${seed}`, ownerName: 'Owner', phone: ownerPhone, pin: '482613' });
  expect(up.token, JSON.stringify(up)).toBeTruthy();
  const tenant = up.tenantId as string;
  const sid = (await srv.query(`SELECT id FROM docs WHERE tenant_id=$1 AND tbl='settings'`, [tenant]))[0].id as string;
  const phones: Phone[] = [{ role: 'owner', db: new RoxDB(`phones-${seed}-owner-${Date.now()}`), token: up.token, userId: up.userId, batches: [] }];
  const as = <T,>(p: Phone, fn: () => Promise<T>) => onSide(p.db, async () => { setSession(tenant, p.userId); store.set('dbrox.token', p.token); return fn(); });
  const owner = phones[0];
  const settings = { id: sid, firmName: `Chaos ${seed}`, gstin: '', address: '', stateCode: '33', phone: ownerPhone, serverUrl: 'http://srv.test', modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true }, billFormat: 'A5', returnApprovalLimit: 2000, discountAlertPct: 5 };
  const pins = { office: '6831', godown: '7416', delivery: '5072' } as const;
  const staffPhone = (i: number) => `9${String(seed).padStart(4, '0')}0000${i}`;
  await as(owner, async () => {
    await db.open();
    const cs = new ChangeSet();
    cs.put('settings', settings);
    (['office', 'godown', 'delivery'] as const).forEach((role, i) => cs.put('staff', { id: `st-${role}-${seed}`, name: role, phone: staffPhone(i), role, pin: pins[role], active: true }));
    const co = cs.put('companies', { name: 'HUL', code: 'HUL', gstin: '', nextBillNo: 1 });
    for (let i = 0; i < 3; i++) {
      const p = cs.put<Product>('products', { companyId: co.id, name: `Item ${i}`, code: `I${i}`, hsn: '3401', gst: 18, mrp: 50, rate: 40, purchaseRate: 30, caseSize: 12, aliases: [], active: true } as unknown as Product);
      for (let k = 0; k < 2; k++) cs.put('batches', { productId: p.id, batch: `L${i}${k}`, expiry: '2099-12-31', mrp: 50, qty: 20 + Math.floor(R() * 40), godown: 'Main' });
    }
    for (let i = 0; i < 3; i++) cs.put('shops', { name: `Shop ${i}`, area: 'A', beat: 'B', creditLimit: 1e9, creditDays: 7, cashOnly: false, type: 'retail', approved: true, aliases: [] });
    await cs.commit('setup');
    expect(await syncNow()).toMatch(/^Synced/);
  });
  for (const [i, role] of (['office', 'godown', 'delivery'] as const).entries()) {
    const l = await call('/v1/login', { phone: staffPhone(i), pin: pins[role] });
    expect(l.token, `${role} login ${JSON.stringify(l)}`).toBeTruthy();
    const p: Phone = { role, db: new RoxDB(`phones-${seed}-${role}-${Date.now()}`), token: l.token, userId: l.userId, batches: [] };
    phones.push(p);
    await as(p, async () => { await db.open(); await db.settings.put({ ...settings, tenantId: tenant, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', dirty: 0 } as never); expect(await syncNow()).toMatch(/^Synced/); });
  }
  const log: string[] = []; let bills = 0, syncs = 0;
  const fail = (why: string) => { throw new Error(`phones seed ${seed}: ${why}\n--- last steps ---\n${log.slice(-20).join('\n')}`); };
  /** the server's lots and the sum of each lot's movements */
  const serverStock = async () => {
    const lots = new Map((await srv.query(`SELECT id, (data->>'qty')::int AS q FROM docs WHERE tenant_id=$1 AND tbl='batches'`, [tenant])).map(r => [r.id as string, Number(r.q)]));
    const sums = new Map((await srv.query(`SELECT data->>'batchId' AS id, sum((data->>'delta')::int)::int AS s FROM docs WHERE tenant_id=$1 AND tbl='stockMoves' GROUP BY 1`, [tenant])).map(r => [r.id as string, Number(r.s)]));
    const ids = (await srv.query(`SELECT id FROM docs WHERE tenant_id=$1 AND tbl='stockMoves'`, [tenant])).map(r => r.id as string);
    return { lots, sums, ids: new Set(ids) };
  };
  const checkServer = async () => {
    const { lots, sums } = await serverStock();
    for (const [id, q] of lots) {
      if (q < 0 || !Number.isInteger(q)) fail(`SERVER STOCK BELOW ZERO ${id}: ${q}`);
      if ((sums.get(id) ?? 0) !== q) fail(`SERVER QTY ≠ SUM OF MOVEMENTS ${id}: qty ${q}, movements ${sums.get(id) ?? 0}`);
    }
  };

  for (let step = 0; step < steps; step++) {
    const roll = R(); let what = '';
    const p = roll < 0.42 ? pick(phones.filter(x => x.role === 'owner' || x.role === 'office')) : roll < 0.54 ? phones[2] : roll < 0.70 ? phones[3] : pick(phones);
    try {
      await as(p, async () => {
        if (roll < 0.28) {
          // a bill from the lots this phone sees (it may be stale: the other phone billed the same lot meanwhile)
          const prods = await db.products.toArray(); const shops = await db.shops.toArray(); if (!prods.length || !shops.length) return;
          const lines = Array.from({ length: 1 + Math.floor(R() * 2) }, () => ({ productId: pick(prods).id, qty: 1 + Math.floor(R() * 15), rate: 40 }));
          const numbers = (await nextNumbers('bill', 1)) ?? undefined;
          const cs = new ChangeSet();
          const invs = await makeInvoices(cs, { id: newId(), shopId: '', lines, status: 'picked', date: today(), issues: [], invoiceIds: [] } as unknown as Order, pick(shops) as Shop, numbers);
          if (!invs.length) { what = `${p.role} bill: nothing in stock`; return; }
          p.batches.push(await cs.commit('Billed')); bills++; what = `${p.role} bill ${invs[0].number} ${lines.map(l => l.qty).join('+')}`;
        } else if (roll < 0.34) {
          const inv = pick((await db.invoices.toArray()).filter(i => !i.cancelled)); if (!inv) return;
          await cancelInvoice(inv.id, 'chaos'); what = `${p.role} cancel ${inv.number}`;
        } else if (roll < 0.38) {
          const b = pick(await db.batches.toArray()); if (!b) return;
          const cs = new ChangeSet(); const n = Math.max(0, b.qty + Math.floor(R() * 7) - 3);
          if (!countLot(cs, b, n, 'chaos count')) return;
          p.batches.push(await cs.commit('Count')); what = `${p.role} count ${b.batch} ${b.qty} → ${n}`;
        } else if (roll < 0.42) {
          const inv = pick((await db.invoices.toArray()).filter(i => !i.cancelled && !i.delivery && i.lines.some(l => l.batches.some(b => b.qty > 0)))); if (!inv) return;
          const l = pick(inv.lines.filter(x => x.batches.some(b => b.qty > 0)));
          const room = Math.min(openPaid(inv, await db.creditNotes.where('invoiceId').equals(inv.id).toArray(), l.productId), l.batches.reduce((a, b) => a + b.qty, 0));
          if (room <= 0) return;
          const cs = new ChangeSet(); await makeCreditNote(cs, inv, [{ productId: l.productId, paid: 1 + Math.floor(R() * room), free: 0, restock: true }], { reason: 'chaos return', source: 'return', takeOffBill: true });
          p.batches.push(await cs.commit('Return')); what = `${p.role} return on ${inv.number}`;
        } else if (roll < 0.54) {
          // goods received at the godown: more pieces into a lot, or a new lot
          const lots = await db.batches.toArray(); const prods = await db.products.toArray(); if (!prods.length) return;
          const n = 1 + Math.floor(R() * 30); const cs = new ChangeSet();
          const b = R() < 0.8 ? pick(lots) : undefined;
          if (b) cs.put('batches', { ...b, qty: b.qty + n }, 'stock in');
          else cs.put<Batch>('batches', { productId: pick(prods).id, batch: `N${step}`, expiry: '2099-12-31', mrp: 50, qty: n, godown: 'Main' } as Batch, 'stock in');
          p.batches.push(await cs.commit('Stock in')); what = `${p.role} stock in +${n} ${b?.batch ?? 'new lot'}`;
        } else if (roll < 0.70) {
          const inv = pick((await db.invoices.toArray()).filter(i => !i.cancelled && !i.delivery)); if (!inv) return;
          const kind = pick(['full', 'short', 'refused', 'extra', 'damaged']); const l = pick(inv.lines); const k = R() < 0.5 ? `${inv.id}|${l.productId}|${inv.lines.indexOf(l)}` : `${inv.id}|${l.productId}`; // per line, or the older per-product key
          const input = kind === 'refused' ? { returnAll: true } : kind === 'short' ? { short: { [k]: { qty: 1 + Math.floor(R() * l.qty), reason: 'short' } } }
            : kind === 'damaged' ? { short: { [k]: { qty: 1 + Math.floor(R() * l.qty), reason: 'damaged' } } } : kind === 'extra' ? { extra: { [k]: 1 + Math.floor(R() * 3) } } : {};
          const b = await recordDelivery([inv.id], input); if (b) p.batches.push(b); what = `${p.role} deliver ${inv.number} ${kind}`;
        } else if (roll < 0.94) {
          const msg = await syncNow(); syncs++; what = `${p.role} sync: ${msg}`;
          if (!/^Synced/.test(msg)) fail(`SYNC FAILED on ${p.role}: ${msg}`);
          await checkServer();
        } else {
          const b = p.batches.pop(); if (!b) return;
          what = `${p.role} undo → ${await undoBatch(b)}`;
        }
      });
    } catch (e) {
      const name = (e as Error).name, msg = (e as Error).message;
      if (msg.startsWith(`phones seed ${seed}`)) throw e;
      if (name !== 'GuardError' && !/already|not picked|not found|reason is needed|Not enough stock|can't be cancelled|never cancelled|delivered|GSTR|credit note|difference/i.test(msg)) { log.push(`${step}: ${what} CRASH ${name}: ${msg}`); fail(`crash at step ${step}`); }
      what += ` (refused: ${msg.slice(0, 60)})`;
    }
    log.push(`${step}: ${what}`);
    for (const ph of phones) await as(ph, async () => { for (const b of await db.batches.toArray()) if (!Number.isInteger(b.qty)) fail(`BAD STOCK COUNT on ${ph.role} ${b.batch}: ${b.qty}`); });
  }

  if (steps >= 50 && (bills < 3 || syncs < 3)) fail(`the day did too little to prove anything: ${bills} bills, ${syncs} syncs`);
  // everybody comes online: every phone syncs, in random order, until nothing moves
  for (let round = 0; round < 3; round++) for (const ph of [...phones].sort(() => R() - 0.5)) await as(ph, async () => { const m = await syncNow(); if (!/^Synced/.test(m)) fail(`SYNC FAILED on ${ph.role}: ${m}`); log.push(`final sync ${ph.role}: ${m}`); });
  await checkServer();
  const { lots, ids } = await serverStock();
  // THE LAW: every lot's qty on every phone = the server's qty
  for (const ph of phones) await as(ph, async () => {
    for (const b of await db.batches.toArray()) if (b.qty !== lots.get(b.id)) fail(`PHONES DISAGREE: ${ph.role} has ${b.batch} = ${b.qty}, the server ${lots.get(b.id)}`);
  });
  // … = opening + in − out: every movement made on any phone, counted once — and none lost (on the server, or held)
  const made = new Map<string, { batchId: string; delta: number }>(); const held = new Set<string>();
  for (const ph of phones) await as(ph, async () => {
    for (const m of await db.stockMoves.toArray()) { made.set(m.id, m); if (m.dirty === 1) { if (ids.has(m.id)) fail(`MOVEMENT SENT BUT STILL UNSENT on ${ph.role}: ${m.id}`); held.add(m.id); } else if (!ids.has(m.id) && !m.id.startsWith('open:')) fail(`MOVEMENT LOST: ${ph.role} ${m.id} ${m.delta} is marked sent but not on the server`); }
  });
  const expected = new Map<string, number>();
  for (const [id, m] of made) if (!held.has(id)) expected.set(m.batchId, (expected.get(m.batchId) ?? 0) + m.delta);
  for (const id of ids) if (!made.has(id)) {
    // a movement the phones no longer download (older than 3 days) — not in this test; anything else is unexplained
    fail(`MOVEMENT ON THE SERVER THAT NO PHONE MADE: ${id}`);
  }
  for (const [id, q] of lots) if ((expected.get(id) ?? 0) !== q) fail(`OPENING + IN − OUT ≠ SERVER QTY for ${id}: movements ${expected.get(id) ?? 0}, server ${q}`);
  return true;
}

describe('stock law with several phones and the real server: no change is ever lost', () => {
  beforeAll(async () => {
    Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() } });
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
    if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
    const { startServer } = await import('../../server/test/harness');
    srv = await startServer();
    vi.stubGlobal('fetch', srv.fetch);
  }, 180_000);
  afterAll(async () => { vi.unstubAllGlobals(); await srv?.stop(); });
  for (const seed of SEEDS) it(`phones day #${seed} (${Math.ceil(STEPS / 2)} actions, 4 phones)`, async () => { expect(await playPhones(seed, Math.ceil(STEPS / 2))).toBe(true); }, 900_000);
});
