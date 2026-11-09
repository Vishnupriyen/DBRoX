// Working-app test, part 2: one month of business before "today", made by the app's own logic on a phone and synced
// to the live server: salesmen book orders on their beats, owner approves, godown picks, owner bills (server numbers),
// vans deliver, shops pay (cash/UPI/cheque), owner closes each day.
//   VITE_SERVER_URL=… VITE_LICENCE_PUBLIC_KEY=… npx vitest run -c vitest.live.config.ts tests/live/history.live.ts
import 'fake-indexeddb/auto';
import { it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

const store = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) } });
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true });
if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });

const W = JSON.parse(readFileSync(process.env.LIVE_DATA + '/world.json', 'utf8'));
const DAYS = Number(process.env.HISTORY_DAYS ?? 30);
const OUT = process.env.LIVE_OUT ?? '/tmp';

it('a month of business', async () => {
  const { db, setSession, ChangeSet } = await import('../../src/core/db');
  const { login, syncNow } = await import('../../src/core/sync');
  const pipe = await import('../../src/core/pipeline');
  const { allocateOldestFirst, invoiceBalances } = await import('../../src/core/ledger');
  const { commit } = await import('../../src/core/proposals');

  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const t0 = Date.now();
  const r = await login(W.firm.phone, W.firm.pin);
  if (!r || 'choose' in r) {
    let detail = '';
    try { const x = await fetch('http://localhost:8790/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: W.firm.phone, pin: W.firm.pin }) }); detail = `${x.status} ${(await x.text()).slice(0, 80)}`; } catch (e) { detail = String(e); }
    throw new Error('owner login failed: ' + detail + ' online=' + navigator.onLine);
  }
  setSession(r.tenantId, r.userId);
  let msg = await syncNow(); for (let i = 0; i < 10 && /received [1-9]/.test(msg); i++) msg = await syncNow();
  const staff = await db.staff.toArray();
  const id = (role: string, k = 0) => staff.filter(s => s.role === role).sort((a, b) => a.phone.localeCompare(b.phone))[k].id;
  const owner = r.userId, salesmen = [0, 1, 2, 3].map(k => id('salesman', k)), godown = id('godown'), drivers = [0, 1].map(k => id('delivery', k));
  const products = (await db.products.toArray()).sort((a, b) => a.code.localeCompare(b.code));
  const hot = products.slice(0, 500); // the everyday sellers
  console.log(`setup pulled: ${products.length} products, ${await db.shops.count()} shops in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const log: Record<string, number>[] = [];
  const start = new Date(); start.setHours(10, 0, 0, 0);
  for (let d = DAYS; d >= 1; d--) {
    const day = new Date(start.getTime() - d * 86400000);
    if (day.getDay() === 0) continue; // Sunday off
    vi.setSystemTime(day);
    const td = performance.now();
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day.getDay()];
    const shops = await db.shops.toArray();
    const orders: string[] = [];
    // 1. salesmen on their beats: ~85% of shops order 4–14 lines
    for (const sm of salesmen) {
      setSession(r.tenantId, sm);
      const beat = shops.filter(s => s.salesmanId === sm && s.beat === dayName);
      const cs = new ChangeSet();
      for (const shop of beat) {
        if (rnd() > 0.85) continue;
        const n = 4 + Math.floor(rnd() * 11); const lines = new Map<string, { productId: string; qty: number; rate: number }>();
        for (let k = 0; k < n; k++) { const p = rnd() < 0.8 ? hot[Math.floor(rnd() * hot.length)] : products[Math.floor(rnd() * products.length)]; const q = [6, 12, Math.max(1, Math.round(p.caseSize / 2)), p.caseSize][Math.floor(rnd() * 4)]; lines.set(p.id, { productId: p.id, qty: Math.min(q, p.caseSize * 2), rate: p.rate }); }
        orders.push((await pipe.bookOrder(cs, shop, [...lines.values()], sm)).id);
      }
      await cs.commit('Orders');
    }
    // 2. owner approves, godown picks what is in stock, owner bills
    setSession(r.tenantId, owner); for (const o of orders) await pipe.approveOrder(o);
    setSession(r.tenantId, godown);
    for (const oid of orders) { const o = (await db.orders.get(oid))!; const sug = await pipe.suggestPick(o); await pipe.pickOrder(oid, sug.flatMap(s => s.picks.length ? s.picks.map(p => ({ productId: s.productId, qty: p.qty, batchId: p.batchId })) : [{ productId: s.productId, qty: 0 }])); }
    setSession(r.tenantId, owner); for (const o of orders) await pipe.approvePicked(o);
    // 3. plan, load, deliver (a few shortages / refusals), end trips
    await pipe.confirmPlan(await pipe.suggestPlan());
    const trips = await db.trips.where('date').equals(day.toISOString().slice(0, 10)).toArray();
    for (const t of trips) {
      setSession(r.tenantId, godown); await pipe.tripLoaded(t.id);
      setSession(r.tenantId, t.driverId ?? drivers[0]); await pipe.startTrip(t.id);
      const invs = await db.invoices.where('tripId').equals(t.id).toArray();
      for (const inv of invs) {
        const x = rnd();
        if (x < 0.02) await pipe.recordDelivery([inv.id], { returnAll: true });
        else if (x < 0.07) { const l = inv.lines[0]; await pipe.recordDelivery([inv.id], { short: { [`${inv.id}|${l.productId}`]: { qty: Math.min(2, l.qty), reason: 'damaged' } } }); }
        else await pipe.recordDelivery([inv.id], {});
      }
      await pipe.endTrip(t.id, {});
    }
    setSession(r.tenantId, owner);
    for (const inv of (await db.invoices.toArray()).filter(i => i.delivery && !i.diffAction && ((i.delivery.shortages?.length ?? 0) > 0))) await pipe.settleDifference(inv.id, 'credit_note');
    // 4. collections: shops on today's beat pay what they owe (most in full, some part, some nothing)
    let paid = 0;
    for (const sm of salesmen) {
      setSession(r.tenantId, sm);
      for (const shop of shops.filter(s => s.salesmanId === sm && s.beat === dayName)) {
        const owed = (await invoiceBalances(shop.id)).filter(b => b.balance > 0.5 && b.invoice.date < day.toISOString().slice(0, 10)).reduce((a, b) => a + b.balance, 0);
        if (owed < 1) continue; const x = rnd(); if (x < 0.12) continue;
        const amount = Math.round(x < 0.3 ? owed / 2 : owed);
        const mode = x < 0.65 ? 'cash' : x < 0.95 ? 'upi' : 'cheque';
        const { allocations } = await allocateOldestFirst(shop.id, amount);
        await commit({ id: `pay-${shop.id}-${d}`, kind: 'payment', title: 'Payment', meta: { shopConfirmed: true }, columns: [],
          fields: [{ key: 'shopId', label: 'Shop', value: shop.id }, { key: 'amount', label: 'Amount', value: amount }, { key: 'mode', label: 'Mode', value: mode }, { key: 'ref', label: 'Ref', value: mode === 'cash' ? '' : String(400000000000 + Math.floor(rnd() * 99999999999)) }],
          rows: allocations.map(a => ({ invoiceId: a.invoiceId, balance: a.amount, pay: a.amount })) } as never);
        paid += amount;
      }
    }
    // 5. owner receives the cash and closes the day
    setSession(r.tenantId, owner);
    const cashBy: Record<string, number> = {};
    for (const p of (await db.payments.toArray()).filter(p => p.mode === 'cash' && !p.settled && p.status === 'ok')) cashBy[p.collectedBy] = (cashBy[p.collectedBy] ?? 0) + p.amount;
    await pipe.closeDay(day.toISOString().slice(0, 10), cashBy);
    const ts = performance.now(); msg = await syncNow(); const syncS = (performance.now() - ts) / 1000;
    const row = { day: d, orders: orders.length, bills: (await db.invoices.toArray()).filter(i => i.date === day.toISOString().slice(0, 10)).length, paid, seconds: (performance.now() - td) / 1000, syncSeconds: syncS };
    log.push(row); console.log(JSON.stringify(row), msg);
    if (log.length % 5 === 0) { db.close(); await db.open(); }
  }
  vi.useRealTimers();
  const totals = { orders: await db.orders.count(), invoices: await db.invoices.count(), payments: await db.payments.count(), creditNotes: await db.creditNotes.count(), trips: await db.trips.count(), dayCloses: await db.dayCloses.count(), audit: await db.audit.count() };
  writeFileSync(`${OUT}/history.json`, JSON.stringify({ totals, days: log, minutes: (Date.now() - t0) / 60000 }, null, 1));
  console.log('TOTALS', JSON.stringify(totals));
}, 4 * 3600_000);
