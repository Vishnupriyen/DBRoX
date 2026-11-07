// THE MONEY & STOCK LAWS — a chaos test.
// It plays a distributor's day thousands of times in random order: orders, picking, billing (with double taps),
// planning, delivery (short, damaged, refused, extra, double taps), trip end, day-close differences, payments,
// cancels (twice), and undo of random past actions. After EVERY step it checks the laws below.
// If any law breaks, the test prints the seed and the exact steps so the bug can be replayed.
//   CHAOS_STEPS=2000 CHAOS_SEEDS=5 npx vitest run tests/laws.test.ts   (the gate runs a lighter version)
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { ChangeSet, db, setSession, undoBatch, today } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import {
  bookOrder, approveOrder, suggestPick, pickOrder, approvePicked, suggestPlan, confirmPlan, tripLoaded, startTrip,
  recordDelivery, endTrip, settleDifference, cancelInvoice,
} from '../src/core/pipeline';
import { allocateOldestFirst, invoiceBalances, r2 } from '../src/core/ledger';

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
  }
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
        const lines = Array.from({ length: 1 + Math.floor(R() * 3) }, () => { const p = pick(prods); return { productId: p.id, qty: 1 + Math.floor(R() * 12), rate: p.rate }; });
        const cs = new ChangeSet(); const o = await bookOrder(cs, shop, lines, 'chaos'); await cs.commit('booked');
        await approveOrder(o.id); what = `order ${shop.name} ${lines.map(l => l.qty).join('+')}`;
      } else if (roll < 0.30) {
        const o = pick((await db.orders.toArray()).filter(x => x.status === 'approved')); if (!o) continue;
        const sug = await suggestPick(o);
        await pickOrder(o.id, sug.map(x => ({ productId: x.productId, qty: Math.max(0, Math.min(x.available, Math.floor(x.available * (R() < .3 ? R() : 1)))) })));
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
        const l = pick(inv.lines); const k = `${inv.id}|${l.productId}`;
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
