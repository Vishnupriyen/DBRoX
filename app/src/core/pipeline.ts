import { inr } from './i18n';
// The order chain, one step hands to the next:
// salesman order → godown picks → owner approves → invoice from picked qty → delivery plan (trip per van)
// → load → trip out (live track) → delivered/photo → collect → day close (reconciliation)
import { ChangeSet, db, nowIso, session, today, daysFrom, ymd } from './db';
import { checkOrder, creditNoteNumbers, makeInvoices, pickBatches, type BillCut } from './billing';
import { r2 } from './ledger';
import { nextNumbers } from './sync';
import type { Invoice, Order, OrderLine, Role, Shop, Trip, Van } from './types';

// ---- 1. salesman books: always enters the chain as 'new' (checks recorded for the owner)
export async function bookOrder(cs: ChangeSet, shop: Shop, lines: OrderLine[], by: string, extra: Partial<Order> = {}) {
  const check = await checkOrder(shop, lines);
  return cs.put<Order>('orders', { shopId: shop.id, salesmanId: by, source: 'salesman', lines, date: today(), status: 'new', issues: check.issues, invoiceIds: [], ...extra }, 'order booked');
}

export async function cancelMyOrder(orderId: string) {
  const o = (await db.orders.get(orderId))!;
  if (o.status !== 'new') throw new Error('Already approved — ask the owner');
  const cs = new ChangeSet(); cs.put('orders', { ...o, status: 'cancelled', issues: [...o.issues, 'Cancelled by salesman'] }, 'salesman cancelled'); await cs.commit('Order cancelled');
}
/** why this person can't change this order now, or null if they can. Packed, billed and cancelled orders are never changed here. */
export function orderBlock(o: Order, role: Role, me: string): string | null {
  if (o.status === 'cancelled') return 'it is already cancelled.';
  if (o.status === 'billed') return 'it is already billed. Cancel the bill (Bill → Billed) or make a return instead.';
  if (o.status === 'picked') return 'the godown has already packed it. Change the quantities while verifying it (Bill → Picked).';
  if (role === 'owner' || role === 'office') return null;
  if (o.salesmanId !== me) return 'only the person who booked it or the owner can change it.';
  if (o.status !== 'new') return 'the owner has already approved it. Ask the owner to change it.';
  return null;
}
/** change the lines of an order, or cancel it (lines = null). Checked again at save time: the order may have moved on. */
export async function changeOrder(cs: ChangeSet, orderId: string, lines: OrderLine[] | null, reason = '') {
  const o = await db.orders.get(orderId);
  if (!o) throw new Error('Order not found.');
  const me = session().userId;
  const role = (await db.staff.get(me))?.role ?? 'owner';
  const block = orderBlock(o, role, me);
  if (block) throw new Error(`Can't change this order: ${block}`);
  if (!lines) return cs.put<Order>('orders', { ...o, status: 'cancelled', issues: [...o.issues, `Cancelled${reason ? `: ${reason}` : ''}`] }, 'order cancelled');
  const keep = lines.filter(l => l.qty > 0);
  if (!keep.length) throw new Error('Every line is 0. Cancel the order instead.');
  const shop = (await db.shops.get(o.shopId))!;
  const check = await checkOrder(shop, keep);
  return cs.put<Order>('orders', { ...o, lines: keep, issues: check.issues }, 'order changed');
}
export async function updateMyOrder(orderId: string, lines: OrderLine[]) {
  const o = (await db.orders.get(orderId))!;
  if (o.status !== 'new') throw new Error('Already approved — ask the owner');
  const cs = new ChangeSet(); cs.put('orders', { ...o, lines }, 'salesman edited'); await cs.commit('Order edited');
}

// ---- 1b. owner approves the order (credit/history seen) → goes to the godown
export async function approveOrder(orderId: string) {
  const o = (await db.orders.get(orderId))!;
  const cs = new ChangeSet();
  cs.put('orders', { ...o, status: 'approved', approvedBy: session().userId, approvedAt: nowIso() }, 'owner approved');
  // every rate decrease goes to Claims automatically; the owner keeps or rejects it there (spec 15.1 Sales)
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  for (const l of o.lines) { const p = products.get(l.productId); if (p && l.rate < p.rate) cs.put('claimEntries', { companyId: p.companyId, month: today().slice(0, 7), kind: 'scheme', productId: p.id, qty: l.qty, amount: r2((p.rate - l.rate) * l.qty), note: `Rate ${inr(l.rate)} vs ${inr(p.rate)} · ${o.rateRemark ?? ''}` }, 'rate decrease → claim'); }
  await cs.commit('Order approved');
}

// Shop history strip for the approval screen: bills pending, oldest days, rupees, limit.
export async function shopHistory(shopId: string) {
  const { invoiceBalances } = await import('./ledger');
  const bal = (await invoiceBalances(shopId)).filter(b => b.balance > 0.5);
  const shop = (await db.shops.get(shopId))!;
  return { bills: bal.length, amount: r2(bal.reduce((a, b) => a + b.balance, 0)), oldestDays: Math.max(0, ...bal.map(b => Math.floor((Date.now() - new Date(b.invoice.date).getTime()) / 86400000))), limit: shop.creditLimit, days: shop.creditDays };
}

// ---- 2. godown picks what is actually available (qty, batch, MRP may change; never adds a product)
export async function pickOrder(orderId: string, picked: { productId: string; qty: number; batchId?: string; mrp?: number }[]) {
  const o = (await db.orders.get(orderId))!;
  const cs = new ChangeSet();
  cs.put('orders', { ...o, status: 'picked', picked, pickedBy: session().userId, pickedAt: nowIso() }, 'picked');
  await cs.commit('Order picked');
}

export async function suggestPick(o: Order) {
  const batches = await db.batches.toArray();
  // stock already packed for another order (picked, not billed yet) is not on the shelf any more
  for (const other of await db.orders.where('status').equals('picked').toArray()) {
    if (other.id === o.id) continue;
    for (const pk of other.picked ?? []) { if (!pk.batchId || !pk.qty) continue; const b = batches.find(x => x.id === pk.batchId); if (b) b.qty -= pk.qty; }
  }
  return o.lines.map(l => {
    const { picks, short } = pickBatches(batches, l.productId, l.qty);
    for (const p of picks) { const b = batches.find(x => x.id === p.batchId)!; b.qty -= p.qty; } // reserve within this order
    return { productId: l.productId, ordered: l.qty, available: l.qty - short, picks };
  });
}

// ---- 3. owner approves → invoice from picked quantities (short lines cut, pending saved)
const billing = new Set<string>(); // orders being billed right now (a double tap must not make two bills)
export async function approvePicked(orderId: string) {
  if (billing.has(orderId)) throw new Error('This order is already being billed.');
  billing.add(orderId);
  try { return await approvePickedOnce(orderId); } finally { billing.delete(orderId); }
}
async function approvePickedOnce(orderId: string) {
  const o = (await db.orders.get(orderId))!;
  if (o.status !== 'picked') throw new Error(o.status === 'billed' ? 'This order is already billed.' : 'This order is not picked yet.');
  const shop = (await db.shops.get(o.shopId))!;
  const cs = new ChangeSet();
  // picker's quantities, batch and MRP go into the bill exactly as packed
  const picked: NonNullable<Order['picked']> = o.picked ?? o.lines.map(l => ({ productId: l.productId, qty: l.qty }));
  const lines = picked.filter(p => p.qty > 0)
    .map(p => ({ productId: p.productId, qty: p.qty, rate: o.lines.find(l => l.productId === p.productId)?.rate ?? 0, batchId: p.batchId, mrp: p.mrp }));
  // numbers from the server when there is one (never a duplicate across phones); needs internet
  const products = new Map((await db.products.toArray()).map(p => [p.id, p.companyId]));
  const companies = new Set(lines.map(l => products.get(l.productId)));
  const numbers = (await nextNumbers('bill', companies.size)) ?? undefined;
  const billed = cs.put<Order>('orders', { ...o, status: 'billed', lines: o.lines, invoiceIds: [] }, 'owner approved');
  const cuts: BillCut[] = [];
  const invs = lines.length ? await makeInvoices(cs, { ...billed, lines }, shop, numbers, undefined, cuts) : [];
  billed.invoiceIds = invs.map(i => i.id);
  if (cuts.length) billed.issues = [...billed.issues, ...cuts.map(c => `Billed ${c.billed} of ${c.wanted} ${c.name}: stock had no more`)];
  const batchId = await cs.commit('Approved & billed');
  return { invoices: invs, batchId };
}

// Day-close gate: billing stops until every earlier day with activity is closed (locked spec 15.2).
export async function billingLockedBy(): Promise<string | null> {
  const t = today();
  const days = new Set<string>();
  for (const i of await db.invoices.toArray()) if (i.date < t) days.add(i.date);
  for (const x of await db.trips.toArray()) if (x.date < t) days.add(x.date);
  for (const p of await db.payments.toArray()) if (p.date < t) days.add(p.date);
  const closed = new Set((await db.dayCloses.toArray()).map(d => d.date));
  // nothing before the app started counts — the local day it started (a UTC timestamp is the previous day before 5:30 AM in India)
  const firstAt = (await db.audit.orderBy('at').first())?.at;
  const first = firstAt ? ymd(new Date(firstAt)) : t;
  const open = [...days].filter(d => !closed.has(d) && d >= first).sort();
  return open[0] ?? null;
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
  const t = await db.trips.get(tripId);
  if (!t || t.driverId !== session().userId || t.status !== 'loaded') throw new Error('This trip must be loaded and assigned to you before starting.');
  const cs = new ChangeSet();
  cs.put('trips', { ...t, status: 'out', startedAt: nowIso() }, 'trip started');
  for (const inv of await db.invoices.where('tripId').equals(tripId).toArray()) if (inv.deliveryStatus === 'planned') cs.put('invoices', { ...inv, deliveryStatus: 'out' }, 'out for delivery');
  await cs.commit('Trip started');
}

export async function trackPoint(tripId: string, lat: number, lng: number) {
  const t = await db.trips.get(tripId); if (!t || t.status !== 'out') return;
  const track = [...t.track, { at: nowIso(), lat, lng }].slice(-500);
  await db.trips.put({ ...t, track, updatedAt: nowIso(), dirty: 1 });
}

// Owner can end a trip the driver forgot to end, or cancel one that never left (bills back to the pool).
export async function ownerEndTrip(tripId: string) {
  const t = (await db.trips.get(tripId))!;
  if (t.status === 'out') return endTrip(tripId, {});
  const cs = new ChangeSet();
  for (const inv of await db.invoices.where('tripId').equals(tripId).toArray()) cs.put('invoices', { ...inv, deliveryStatus: 'pending', tripId: undefined, stopNo: undefined }, 'trip cancelled');
  cs.put('trips', { ...t, status: 'done', endedAt: nowIso() }, 'trip cancelled by owner');
  await cs.commit('Trip cancelled');
}

export async function endTrip(tripId: string, undelivered: Record<string, 'godown' | 'van' | 'next'>) {
  const t = (await db.trips.get(tripId))!;
  const cs = new ChangeSet();
  for (const inv of await db.invoices.where('tripId').equals(tripId).toArray()) {
    if (inv.deliveryStatus !== 'out') continue;
    const what = undelivered[inv.id] ?? 'next';
    // stock is NOT added back: the goods are still reserved for this live bill. Stock returns only when the bill is
    // cancelled or a credit note is made, so the same pieces can never be sold twice.
    // every undelivered bill goes back to the pool and is planned again tomorrow; where the goods are is in the audit line
    cs.put('invoices', { ...inv, deliveryStatus: 'pending', tripId: undefined, stopNo: undefined, vanId: what === 'van' ? inv.vanId : undefined }, `undelivered: goods ${what === 'godown' ? 'back in godown' : what === 'van' ? 'kept in van' : 'for next visit'}`);
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

// ---- 5b. the checklist: everything the owner must decide before the day can close
export async function dayChecklist(date = today()) {
  const invs = (await db.invoices.toArray()).filter(i => !i.cancelled);
  const trips = (await db.trips.where('date').equals(date).toArray());
  const pays = (await db.payments.toArray());
  const orders = await db.orders.toArray();
  const shops = await db.shops.toArray();
  const expenses = (await db.expenses.where('date').equals(date).toArray());
  const tripsOpen = trips.filter(t => t.status === 'out' || t.status === 'loaded');
  const noResult = invs.filter(i => i.tripId && trips.some(t => t.id === i.tripId) && ['planned', 'out'].includes(i.deliveryStatus));
  const diffs = invs.filter(i => i.delivery && !i.diffAction && ((i.delivery.shortages?.length ?? 0) > 0 || (i.delivery.excess?.length ?? 0) > 0));
  const refs = pays.filter(p => p.date === date && p.mode !== 'cash' && !(p.ref && p.ref.length >= 4) && !p.confirmPhoto);
  const waitingOrders = orders.filter(o => o.date <= date && (o.status === 'new' || o.status === 'needs_ok' || o.status === 'picked'));
  const newShops = shops.filter(s => !s.approved);
  const dupes = pays.filter(p => p.status === 'ok' && p.date === date && !p.dupOk).filter((p, _, all) => all.some(q => q.id !== p.id && q.shopId === p.shopId && q.amount === p.amount));
  const cashOpen = pays.filter(p => p.mode === 'cash' && !p.settled && p.status === 'ok' && p.date <= date);
  const unapprovedExpenses = expenses.filter(e => !(e as { approved?: boolean }).approved && e.category !== 'advance');
  const shortfallsOpen = (await db.advances.toArray()).filter(a => a.kind === 'shortfall' && a.status === 'approved' && (a.recovered ?? 0) < a.amount);
  return { tripsOpen, noResult, diffs, refs, waitingOrders, newShops, dupes, cashOpen, unapprovedExpenses, shortfallsOpen };
}

// Owner's choice for a bill with delivery differences: re-issue the same number with delivered quantities, or a credit note.
// Re-issue a bill with new quantities under the SAME number (allowed until it is printed, and at day close for
// delivery differences). The original lines are kept inside the bill; stock is corrected for the change.
/** day close: the owner checked the same amount twice from one shop — both are real collections */
export async function confirmNotDuplicate(paymentIds: string[]) {
  const cs = new ChangeSet();
  for (const id of paymentIds) { const p = await db.payments.get(id); if (p && p.status === 'ok') cs.put('payments', { ...p, dupOk: true }, 'checked: not a duplicate'); }
  await cs.commit('Not a duplicate');
}

/** day close: one of two equal collections was entered twice — cancel it (kept for the audit, bills open again) */
export async function cancelPayment(paymentId: string, reason: string) {
  const p = await db.payments.get(paymentId);
  if (!p || p.status !== 'ok') throw new Error('That payment was already changed or cancelled.');
  if (p.bankLineId) throw new Error('This payment is matched to the bank statement. Unmatch it in Accounts → Bank first.');
  const cs = new ChangeSet();
  cs.put('payments', { ...p, status: 'cancelled', note: reason }, 'payment cancelled');
  await cs.commit('Payment cancelled');
}

export function reviseInvoice(inv: Invoice, qtyByLine: number[]): Invoice {
  const lines = inv.lines.map((l, i) => {
    const qty = Math.max(0, qtyByLine[i] ?? l.qty); if (qty === l.qty) return l;
    const f = qty / (l.qty || 1);
    const gross = r2(l.gross * f), discount = r2(l.discount * f), taxable = r2(gross - discount), tax = r2(taxable * l.gst / 100);
    const inter = l.igst > 0;
    return { ...l, qty, gross, discount, taxable, cgst: inter ? 0 : r2(tax / 2), sgst: inter ? 0 : r2(tax - r2(tax / 2)), igst: inter ? tax : 0, total: r2(taxable + tax) };
  }).filter(l => l.qty > 0);
  const taxable = r2(lines.reduce((a, l) => a + l.taxable, 0)), cgst = r2(lines.reduce((a, l) => a + l.cgst, 0)), sgst = r2(lines.reduce((a, l) => a + l.sgst, 0)), igst = r2(lines.reduce((a, l) => a + l.igst, 0));
  const exact = r2(taxable + cgst + sgst + igst); const total = Math.round(exact);
  return { ...inv, original: inv.original ?? { lines: inv.lines, total: inv.total, at: nowIso() }, lines, taxable, cgst, sgst, igst, roundOff: r2(total - exact), total };
}

export async function editInvoice(invoiceId: string, qtyByLine: number[]) {
  const inv = (await db.invoices.get(invoiceId))!;
  if (inv.printedAt) throw new Error('Printed bills cannot be edited — cancel with a remark or make a credit note.');
  const cs = new ChangeSet();
  const batches = await db.batches.toArray();
  inv.lines.forEach((l, i) => { const diff = l.qty - Math.max(0, qtyByLine[i] ?? l.qty); if (!diff) return; const b = batches.find(x => x.id === l.batches[0]?.batchId); if (b) { b.qty += diff; cs.put('batches', { ...b }, 'bill edited'); } });
  cs.put('invoices', reviseInvoice(inv, qtyByLine), 'bill edited before print');
  await cs.commit('Bill edited');
}

export async function settleDifference(invoiceId: string, action: 'modified' | 'credit_note') {
  const inv = (await db.invoices.get(invoiceId))!;
  const cs = new ChangeSet();
  const sh = inv.delivery?.shortages ?? []; const ex = inv.delivery?.excess ?? [];
  if (action === 'modified') {
    const qtys = inv.lines.map(l => { const minus = sh.find(x => x.productId === l.productId)?.qty ?? 0; const plus = ex.find(x => x.productId === l.productId)?.qty ?? 0; return Math.max(0, l.qty - minus + plus); });
    cs.put('invoices', { ...reviseInvoice(inv, qtys), diffAction: 'modified' }, 'bill revised to delivered qty');
  } else {
    const cnLines = sh.map(x => { const l = inv.lines.find(y => y.productId === x.productId)!; return { productId: x.productId, qty: x.qty, amount: r2(x.qty * l.total / (l.qty || 1)), restock: true }; });
    // extra pieces given from the van are billed: the bill is revised upward for excess; shortages get the credit note
    if (ex.length) { const qtys = inv.lines.map(l => l.qty + (ex.find(x => x.productId === l.productId)?.qty ?? 0)); Object.assign(inv, reviseInvoice(inv, qtys)); }
    if (cnLines.length) {
      const [cnNo] = await creditNoteNumbers(cs, 1);
      cs.put('creditNotes', { number: cnNo, invoiceId: inv.id, shopId: inv.shopId, companyId: inv.companyId, date: today(), reason: 'Short at delivery', lines: cnLines, total: r2(cnLines.reduce((a, l) => a + l.amount, 0)) }, 'credit note');
    }
    cs.put('invoices', { ...inv, diffAction: 'credit_note' }, ex.length ? 'credit note + extra billed' : 'credit note chosen');
  }
  await cs.commit('Delivery difference settled');
}

export async function closeDay(date = today(), received: Record<string, number> = {}) {
  const s = await daySummary(date);
  const cs = new ChangeSet();
  // cash: only what the owner counted and received is settled; the rest stays pending against that person
  const pays = (await db.payments.toArray()).filter(p => p.date <= date && p.mode === 'cash' && !p.settled && p.status === 'ok');
  const shortfalls: Record<string, number> = {};
  const byStaff = new Map<string, typeof pays>(); for (const p of pays) byStaff.set(p.collectedBy, [...(byStaff.get(p.collectedBy) ?? []), p]);
  for (const [staffId, list] of byStaff) {
    const have = r2(list.reduce((a, p) => a + p.amount, 0)); const got = received[staffId] ?? 0;
    // every payment is settled (the money is accounted for); the difference is recorded ONCE against the person
    for (const p of list) cs.put('payments', { ...p, settled: true }, got >= have ? 'cash received' : 'settled with shortfall');
    if (got < have - 0.5) { shortfalls[staffId] = r2(have - got); cs.put('advances', { staffId, amount: r2(have - got), reason: `Cash short at day close ${date}`, status: 'approved', kind: 'shortfall', date, instalments: 1, recovered: 0 }, 'cash shortfall'); }
  }
  cs.put('dayCloses', { date, closedBy: session().userId, summary: { ...(s as unknown as Record<string, unknown>), received, shortfalls } }, 'day closed');
  await cs.commit('Day closed');
}

// counts for the icon home screens
export async function counts() {
  const orders = await db.orders.toArray();
  const invs = (await db.invoices.toArray()).filter(i => !i.cancelled);
  const trips = await db.trips.where('date').equals(today()).toArray();
  const pays = await db.payments.toArray();
  const batches = await db.batches.toArray();
  const soon = daysFrom(45);
  const products = await db.products.toArray();
  const outOfStock = products.filter(p => p.active && !batches.some(b => b.productId === p.id && b.qty > 0 && b.expiry >= today())).length;
  const claims = await db.claims.toArray();
  const me = await db.staff.get(session().userId);
  const myTrip = me?.role === 'delivery' ? trips.find(t => t.status !== 'done' && t.driverId === me.id) : undefined;
  const myStops = myTrip ? new Set(invs.filter(i => i.tripId === myTrip.id && ['planned', 'out'].includes(i.deliveryStatus)).map(i => i.shopId)).size : 0;
  return {
    toApproveOrders: orders.filter(o => o.status === 'new' || o.status === 'needs_ok').length,
    toPick: orders.filter(o => o.status === 'approved').length,
    toApprove: orders.filter(o => o.status === 'picked').length,
    toPlan: invs.filter(i => i.deliveryStatus === 'pending').length,
    toLoad: trips.filter(t => t.status === 'planned').length,
    out: trips.filter(t => t.status === 'out').length,
    tripsToday: trips.length,
    stopsLeft: myStops,
    cashStaff: new Set(pays.filter(p => p.mode === 'cash' && !p.settled && p.status === 'ok').map(p => p.collectedBy)).size,
    cashWithStaff: r2(pays.filter(p => p.mode === 'cash' && !p.settled && p.status === 'ok').reduce((a, p) => a + p.amount, 0)),
    waitingShop: pays.filter(p => p.status === 'waiting_shop').length,
    stockAlerts: batches.filter(b => b.qty > 0 && b.expiry <= soon).length + outOfStock,
    claimsOpen: claims.filter(c => c.status === 'submitted' || c.status === 'draft').length,
    dayClosed: !!(await db.dayCloses.where('date').equals(today()).first()),
  };
}

// ---- Delivery and cancel live here (not in screens) so the money & stock laws can be tested ----
export const DELIVERY_REASONS = [
  { value: 'short', label: 'Not loaded / short', restock: true },
  { value: 'damaged', label: 'Damaged in van', restock: false },
  { value: 'refused', label: 'Shop refused', restock: true },
] as const;
export type DeliveryInput = {
  returnAll?: boolean;
  short?: Record<string, { qty: number; reason: string }>; // key `${invoiceId}|${productId}`
  extra?: Record<string, number>;
  shopPhoto?: string; billPhoto?: string; pos?: { lat: number; lng: number } | null; distanceM?: number;
};
/** Records what the shop accepted for a stop. A bill that already has a delivery result is skipped (double tap safe). */
export async function recordDelivery(invoiceIds: string[], input: DeliveryInput) {
  const cs = new ChangeSet();
  const batches = await db.batches.toArray();
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  let done = 0;
  for (const id of invoiceIds) {
    const inv = await db.invoices.get(id);
    if (!inv || inv.cancelled || ['delivered', 'partial', 'returned'].includes(inv.deliveryStatus)) continue;
    const lines = inv.lines.map(l => ({ ...l, batches: l.batches.map(b => ({ ...b })) }));
    const shortages: { productId: string; qty: number; reason: string }[] = [];
    const excess: { productId: string; qty: number }[] = [];
    for (const l of lines) {
      const k = `${inv.id}|${l.productId}`;
      const s = input.returnAll ? { qty: l.qty + l.freeQty, reason: 'refused' } : input.short?.[k];
      const e = input.extra?.[k];
      if (e && e > 0) {
        // extra pieces given from the van: taken from stock and recorded on the bill line, so a cancel puts them back
        const b = batches.filter(x => x.productId === l.productId && x.qty >= e).sort((a, c) => a.expiry.localeCompare(c.expiry))[0];
        if (b) { b.qty -= e; cs.put('batches', { ...b }, 'extra given from van'); l.batches.push({ batchId: b.id, batch: b.batch, qty: e, expiry: b.expiry }); excess.push({ productId: l.productId, qty: e }); }
      }
      if (!s?.qty) continue;
      const qty = Math.min(s.qty, l.batches.reduce((a, b) => a + b.qty, 0));
      if (qty <= 0) continue;
      const reason = DELIVERY_REASONS.find(r => r.value === s.reason) ?? DELIVERY_REASONS[0];
      shortages.push({ productId: l.productId, qty, reason: reason.label });
      // these pieces are no longer out on the bill: take them off its batches so a later cancel/edit can't put them back twice
      let left = qty;
      for (const lb of l.batches) { if (left <= 0) break; const take = Math.min(left, lb.qty); lb.qty -= take; left -= take; if (reason.restock) { const b = batches.find(x => x.id === lb.batchId); if (b) { b.qty += take; cs.put('batches', { ...b }, 'back to stock'); } } }
      if (!reason.restock) cs.put('claimEntries', { companyId: inv.companyId, month: today().slice(0, 7), kind: 'transit', productId: l.productId, qty, amount: r2(qty * (products.get(l.productId)?.purchaseRate ?? 0)), invoiceId: inv.id, note: 'Damaged in van', photo: input.shopPhoto }, 'transit damage');
    }
    const diff = shortages.length || excess.length;
    const pos = input.pos ?? undefined;
    cs.put('invoices', { ...inv, lines, deliveryStatus: input.returnAll ? 'returned' : diff ? 'partial' : 'delivered', delivery: { at: nowIso(), by: session().userId, photo: input.shopPhoto, shopPhoto: input.shopPhoto, billPhoto: input.billPhoto, lat: pos?.lat, lng: pos?.lng, distanceM: input.distanceM, shortages, excess } }, 'delivery');
    done++;
  }
  if (!done) return null;
  return cs.commit(input.returnAll ? 'Refused at door' : 'Delivered');
}

/** Cancels a bill with a reason. Pieces still out on the bill go back to stock; money paid becomes shop advance. */
export async function cancelInvoice(invoiceId: string, reason: string) {
  const inv = await db.invoices.get(invoiceId);
  if (!inv) throw new Error('Bill not found.');
  if (inv.cancelled) throw new Error('This bill is already cancelled.');
  if (!reason.trim()) throw new Error('A reason is needed to cancel a bill.');
  const cs = new ChangeSet();
  const batches = await db.batches.toArray();
  for (const l of inv.lines) for (const b of l.batches) { if (b.qty <= 0) continue; const x = batches.find(y => y.id === b.batchId); if (x) { x.qty += b.qty; cs.put('batches', { ...x }, 'stock back (cancel)'); } }
  const lines = inv.lines.map(l => ({ ...l, batches: l.batches.map(b => ({ ...b, qty: 0 })) }));
  cs.put('invoices', { ...inv, lines, cancelled: { at: nowIso(), by: session().userId, reason: reason.trim() } }, 'cancel bill');
  return cs.commit('Bill cancelled');
}
