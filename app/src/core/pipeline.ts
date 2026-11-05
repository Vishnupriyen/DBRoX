// The order chain, one step hands to the next:
// salesman order → godown picks → owner approves → invoice from picked qty → delivery plan (trip per van)
// → load → trip out (live track) → delivered/photo → collect → day close (reconciliation)
import { ChangeSet, db, nowIso, session, today } from './db';
import { checkOrder, makeInvoices, pickBatches } from './billing';
import { r2 } from './ledger';
import type { Invoice, Order, OrderLine, Shop, Trip, Van } from './types';

// ---- 1. salesman books: always enters the chain as 'new' (checks recorded for the owner)
export async function bookOrder(cs: ChangeSet, shop: Shop, lines: OrderLine[], by: string, extra: Partial<Order> = {}) {
  const check = await checkOrder(shop, lines);
  return cs.put<Order>('orders', { shopId: shop.id, salesmanId: by, source: 'salesman', lines, date: today(), status: 'new', issues: check.issues, invoiceIds: [], ...extra }, 'order booked');
}

// ---- 2. godown picks what is actually available
export async function pickOrder(orderId: string, picked: { productId: string; qty: number }[]) {
  const o = (await db.orders.get(orderId))!;
  const cs = new ChangeSet();
  cs.put('orders', { ...o, status: 'picked', picked, pickedBy: session().userId, pickedAt: nowIso() }, 'picked');
  await cs.commit('Order picked');
}

export async function suggestPick(o: Order) {
  const batches = await db.batches.toArray();
  return o.lines.map(l => {
    const { picks, short } = pickBatches(batches, l.productId, l.qty);
    for (const p of picks) { const b = batches.find(x => x.id === p.batchId)!; b.qty -= p.qty; } // reserve within this order
    return { productId: l.productId, ordered: l.qty, available: l.qty - short, picks };
  });
}

// ---- 3. owner approves → invoice from picked quantities (short lines cut, pending saved)
export async function approvePicked(orderId: string) {
  const o = (await db.orders.get(orderId))!;
  const shop = (await db.shops.get(o.shopId))!;
  const cs = new ChangeSet();
  const lines = (o.picked ?? o.lines.map(l => ({ productId: l.productId, qty: l.qty })))
    .filter(p => p.qty > 0)
    .map(p => ({ productId: p.productId, qty: p.qty, rate: o.lines.find(l => l.productId === p.productId)?.rate ?? 0 }));
  const billed = cs.put<Order>('orders', { ...o, status: 'billed', lines: o.lines, invoiceIds: [] }, 'owner approved');
  const invs = lines.length ? await makeInvoices(cs, { ...billed, lines }, shop) : [];
  billed.invoiceIds = invs.map(i => i.id);
  const batchId = await cs.commit('Approved & billed');
  return { invoices: invs, batchId };
}

export async function rejectOrder(orderId: string, reason: string) {
  const o = (await db.orders.get(orderId))!;
  const cs = new ChangeSet();
  cs.put('orders', { ...o, status: 'cancelled', issues: [...o.issues, `Cancelled: ${reason}`] }, 'cancelled');
  await cs.commit('Order cancelled');
}

// ---- 4. delivery plan: the system suggests van + stop order; owner confirms → trips
export interface PlanSuggestion { van: Van; shops: { shop: Shop; invoices: Invoice[]; value: number }[] }

function near(a: Shop, b: Shop) {
  if (a.lat && a.lng && b.lat && b.lng) return Math.hypot(a.lat - b.lat, a.lng - b.lng);
  return a.area === b.area ? 0 : 1;
}
// nearest-neighbour ordering: by GPS when known, else keep areas together
export function orderStops<T extends { shop: Shop }>(stops: T[]): T[] {
  if (stops.length < 3) return stops;
  const left = [...stops]; const out: T[] = [left.shift()!];
  while (left.length) {
    const last = out[out.length - 1];
    let bi = 0, bd = Infinity;
    left.forEach((s, i) => { const d = near(last.shop, s.shop); if (d < bd) { bd = d; bi = i; } });
    out.push(left.splice(bi, 1)[0]);
  }
  return out;
}

export async function suggestPlan(): Promise<PlanSuggestion[]> {
  const vans = (await db.vans.toArray()).sort((a, b) => a.name.localeCompare(b.name));
  const pending = (await db.invoices.where('deliveryStatus').equals('pending').toArray()).filter(i => !i.cancelled);
  const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
  const byShop = new Map<string, Invoice[]>();
  for (const i of pending) byShop.set(i.shopId, [...(byShop.get(i.shopId) ?? []), i]);
  const stops = [...byShop.entries()].map(([sid, invoices]) => ({ shop: shops.get(sid)!, invoices, value: r2(invoices.reduce((a, i) => a + i.total, 0)) }));
  if (!vans.length || !stops.length) return [];
  // group by area, then deal areas to vans so each van stays in one part of town, balanced by value
  const areas = new Map<string, typeof stops>();
  for (const s of stops) areas.set(s.shop.area, [...(areas.get(s.shop.area) ?? []), s]);
  const plan: PlanSuggestion[] = vans.map(van => ({ van, shops: [] }));
  const load = (p: PlanSuggestion) => p.shops.reduce((a, s) => a + s.value, 0);
  for (const group of [...areas.values()].sort((a, b) => b.length - a.length)) {
    const target = plan.reduce((best, p) => load(p) < load(best) ? p : best, plan[0]);
    target.shops.push(...group);
  }
  for (const p of plan) p.shops = orderStops(p.shops);
  return plan.filter(p => p.shops.length);
}

export async function confirmPlan(plan: PlanSuggestion[]) {
  const cs = new ChangeSet();
  for (const p of plan) {
    if (!p.shops.length) continue;
    const trip = cs.put<Trip>('trips', { vanId: p.van.id, driverId: p.van.driverId, date: today(), status: 'planned', stops: p.shops.map(s => s.shop.id), track: [] }, 'trip planned');
    p.shops.forEach((s, k) => { for (const inv of s.invoices) cs.put('invoices', { ...inv, vanId: p.van.id, tripId: trip.id, stopNo: k + 1, deliveryStatus: 'planned' }, 'planned'); });
  }
  await cs.commit('Delivery plan confirmed');
}

export async function tripLoaded(tripId: string) {
  const t = (await db.trips.get(tripId))!;
  const cs = new ChangeSet(); cs.put('trips', { ...t, status: 'loaded' }, 'loaded'); await cs.commit('Van loaded');
}

export async function startTrip(tripId: string) {
  const t = (await db.trips.get(tripId))!;
  const cs = new ChangeSet();
  cs.put('trips', { ...t, status: 'out', startedAt: nowIso(), driverId: t.driverId ?? session().userId }, 'trip started');
  for (const inv of await db.invoices.where('tripId').equals(tripId).toArray()) if (inv.deliveryStatus === 'planned') cs.put('invoices', { ...inv, deliveryStatus: 'out' }, 'out for delivery');
  await cs.commit('Trip started');
}

export async function trackPoint(tripId: string, lat: number, lng: number) {
  const t = await db.trips.get(tripId); if (!t || t.status !== 'out') return;
  const track = [...t.track, { at: nowIso(), lat, lng }].slice(-500);
  await db.trips.put({ ...t, track, updatedAt: nowIso(), dirty: 1 });
}

export async function endTrip(tripId: string, undelivered: Record<string, 'godown' | 'van' | 'next'>) {
  const t = (await db.trips.get(tripId))!;
  const cs = new ChangeSet();
  const batches = await db.batches.toArray();
  for (const inv of await db.invoices.where('tripId').equals(tripId).toArray()) {
    if (inv.deliveryStatus !== 'out') continue;
    const what = undelivered[inv.id] ?? 'next';
    if (what === 'godown') for (const l of inv.lines) for (const b of l.batches) { const x = batches.find(y => y.id === b.batchId); if (x) { x.qty += b.qty; cs.put('batches', { ...x }, 'back to godown'); } }
    cs.put('invoices', { ...inv, deliveryStatus: what === 'next' ? 'pending' : 'undelivered', tripId: what === 'next' ? undefined : inv.tripId, stopNo: undefined }, `undelivered: ${what}`);
  }
  cs.put('trips', { ...t, status: 'done', endedAt: nowIso() }, 'trip ended');
  await cs.commit('Trip ended');
}

// ---- 5. day close: what went out, what came back, cash per person
export async function daySummary(date = today()) {
  const invs = (await db.invoices.toArray()).filter(i => !i.cancelled);
  const trips = (await db.trips.where('date').equals(date).toArray());
  const pays = (await db.payments.toArray()).filter(p => p.status !== 'cancelled');
  const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
  const vans = new Map((await db.vans.toArray()).map(v => [v.id, v.name]));
  const cns = (await db.creditNotes.toArray()).filter(c => c.date === date);
  const byTrip = trips.map(t => {
    const ti = invs.filter(i => i.tripId === t.id);
    const n = (s: Invoice['deliveryStatus'][]) => ti.filter(i => s.includes(i.deliveryStatus));
    return { trip: t, van: vans.get(t.vanId) ?? '', bills: ti.length, value: r2(ti.reduce((a, i) => a + i.total, 0)), delivered: n(['delivered']).length, partial: n(['partial']).length, returned: n(['returned']).length, undelivered: n(['undelivered', 'pending', 'out', 'planned']).length };
  });
  const cashBy = new Map<string, { collected: number; handed: number; n: number }>();
  for (const p of pays.filter(x => x.date === date && x.mode === 'cash')) { const v = cashBy.get(p.collectedBy) ?? { collected: 0, handed: 0, n: 0 }; v.collected = r2(v.collected + p.amount); if (p.settled) v.handed = r2(v.handed + p.amount); v.n++; cashBy.set(p.collectedBy, v); }
  const heldOlder = pays.filter(p => p.mode === 'cash' && !p.settled && p.status === 'ok' && p.date < date);
  const nonCash = pays.filter(p => p.date === date && p.mode !== 'cash');
  const waiting = pays.filter(p => p.status === 'waiting_shop');
  return {
    date, trips: byTrip,
    cash: [...cashBy.entries()].map(([id, v]) => ({ staffId: id, name: staff.get(id) ?? id, ...v, pending: r2(v.collected - v.handed) })),
    olderCash: r2(heldOlder.reduce((a, p) => a + p.amount, 0)),
    nonCash: nonCash.map(p => ({ id: p.id, mode: p.mode, amount: p.amount, ref: p.ref ?? '', by: staff.get(p.collectedBy) ?? p.collectedBy })),
    waiting: waiting.length,
    creditNotes: r2(cns.reduce((a, c) => a + c.total, 0)),
    sales: r2(invs.filter(i => i.date === date).reduce((a, i) => a + i.total, 0)),
    collected: r2(pays.filter(p => p.date === date && p.status === 'ok').reduce((a, p) => a + p.amount, 0)),
    closed: !!(await db.dayCloses.where('date').equals(date).first()),
  };
}

export async function closeDay(date = today()) {
  const s = await daySummary(date);
  const cs = new ChangeSet();
  const pays = (await db.payments.toArray()).filter(p => p.date <= date && p.mode === 'cash' && !p.settled && p.status === 'ok');
  for (const p of pays) cs.put('payments', { ...p, settled: true }, 'settled at day close');
  cs.put('dayCloses', { date, closedBy: session().userId, summary: s as unknown as Record<string, unknown> }, 'day closed');
  await cs.commit('Day closed');
}

// counts for the icon home screens
export async function counts() {
  const orders = await db.orders.toArray();
  const invs = (await db.invoices.toArray()).filter(i => !i.cancelled);
  const trips = await db.trips.where('date').equals(today()).toArray();
  const pays = await db.payments.toArray();
  const batches = await db.batches.toArray();
  const soon = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const products = await db.products.toArray();
  const outOfStock = products.filter(p => p.active && !batches.some(b => b.productId === p.id && b.qty > 0 && b.expiry >= today())).length;
  const claims = await db.claims.toArray();
  const me = await db.staff.get(session().userId);
  const myTrip = me?.role === 'delivery' ? trips.find(t => t.status !== 'done' && (t.driverId === me.id || (me.vanId && t.vanId === me.vanId))) : undefined;
  const myStops = myTrip ? new Set(invs.filter(i => i.tripId === myTrip.id && ['planned', 'out'].includes(i.deliveryStatus)).map(i => i.shopId)).size : 0;
  return {
    toPick: orders.filter(o => o.status === 'new').length,
    toApprove: orders.filter(o => o.status === 'picked' || o.status === 'needs_ok').length,
    toPlan: invs.filter(i => i.deliveryStatus === 'pending').length,
    toLoad: trips.filter(t => t.status === 'planned').length,
    out: trips.filter(t => t.status === 'out').length,
    tripsToday: trips.length,
    stopsLeft: myStops,
    cashStaff: new Set(pays.filter(p => p.mode === 'cash' && !p.settled && p.status === 'ok').map(p => p.collectedBy)).size,
    waitingShop: pays.filter(p => p.status === 'waiting_shop').length,
    stockAlerts: batches.filter(b => b.qty > 0 && b.expiry <= soon).length + outOfStock,
    claimsOpen: claims.filter(c => c.status === 'submitted' || c.status === 'draft').length,
    dayClosed: !!(await db.dayCloses.where('date').equals(today()).first()),
  };
}
