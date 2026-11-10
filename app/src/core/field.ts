// Company field team: the working day (start / end, km), today's beat, shop visits, orders to the distributor,
// new-shop requests, leave, targets and the manager's view of the team. Logic only; screens are in ui/Field.tsx.
//
// GPS honesty (independent review, 10 Nov 2026): a web app records location only while it is open, and cannot detect
// fake-location apps. So km here is "measured while the app was open", gaps and jumps are FLAGGED for the manager,
// never silently filled or "blocked". The native Android app (planned) adds background tracking and mock-location checks.
import { ChangeSet, db, nowIso, session, thisMonth, today } from './db';
import type { LeaveRequest, Order, Product, Shop, ShopRequest, Staff, Target, Visit, WorkDay } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayName = (iso = today()) => { const [y, m, d] = iso.split('-').map(Number); return DAY_NAMES[new Date(y, m - 1, d).getDay()]; };
export interface Pos { lat: number; lng: number; acc?: number }

// ---------------------------------------------------------------- distance
export function metres(a: Pos, b: Pos) {
  const R = 6371000, rad = (x: number) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
export const MAX_KMPH = 120;     // faster than this between two points = a GPS jump, not travel
export const GAP_MIN = 45;       // no point for this long while the day is open = flagged (app closed / no signal)
export const POOR_ACC = 150;     // a reading less accurate than this (metres) is not used

/** km travelled along the recorded path: jumps and poor readings are left out and flagged; long gaps are flagged */
export function measure(track: WorkDay['track']): { km: number; flags: string[] } {
  const flags: string[] = [];
  const pts = track.filter(p => (p.acc ?? 0) <= POOR_ACC);
  if (track.length - pts.length > 0) flags.push(`${track.length - pts.length} poor GPS reading${track.length - pts.length > 1 ? 's' : ''} not counted`);
  let m = 0;
  let a = pts[0]; // the last point we trust: a jumped point is never used as the start of the next stretch
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    const d = metres(a, b), hrs = (Date.parse(b.at) - Date.parse(a.at)) / 3600e3;
    if (d / 1000 / Math.max(hrs, 1 / 3600) > MAX_KMPH && d > 500) { flags.push(`GPS jump of ${r2(d / 1000)} km at ${hhmm(b.at)} — not counted`); continue; }
    if (hrs * 60 > GAP_MIN) flags.push(`No location ${hhmm(a.at)}–${hhmm(b.at)} (app closed or no signal): straight line counted, ${r2(d / 1000)} km`);
    m += d; a = b;
  }
  return { km: r2(m / 1000), flags };
}

// ---------------------------------------------------------------- the working day
export async function myDay(staffId = session().userId) { return (await db.workDays.where('staffId').equals(staffId).toArray()).find(w => w.date === today()); }
export async function startDay(pos: Pos | null, mode: WorkDay['mode'] = 'bike') {
  const me = session().userId;
  const cur = await myDay(me);
  if (cur) throw new Error(cur.endAt ? 'Today\'s day is already ended.' : 'Your day has already started.');
  const at = nowIso();
  const cs = new ChangeSet();
  cs.put<WorkDay>('workDays', { staffId: me, date: today(), startAt: at, track: pos ? [{ at, lat: pos.lat, lng: pos.lng, acc: pos.acc }] : [], km: 0, flags: pos ? [] : ['Started without location'], outstation: false, mode }, 'start day');
  await cs.commit('Start day');
}
/** a location reading while the day is open: kept if it moved 50 m or 2 minutes passed (keeps the record small) */
export async function addPoint(pos: Pos) {
  const d = await myDay();
  if (!d || d.endAt) return false;
  const last = d.track[d.track.length - 1];
  const at = nowIso();
  if (last && metres(last, pos) < 50 && Date.parse(at) - Date.parse(last.at) < 120000) return false;
  const track = [...d.track, { at, lat: pos.lat, lng: pos.lng, acc: pos.acc }];
  const { km } = measure(track);
  const cs = new ChangeSet(); cs.put<WorkDay>('workDays', { ...d, track, km }, 'location'); await cs.commit('Location');
  return true;
}
export async function endDay(pos: Pos | null) {
  const me = await db.staff.get(session().userId);
  const d = await myDay();
  if (!d) throw new Error('Start your day first.');
  if (d.endAt) throw new Error('Today\'s day is already ended.');
  const at = nowIso();
  const track = pos ? [...d.track, { at, lat: pos.lat, lng: pos.lng, acc: pos.acc }] : d.track;
  const { km, flags } = measure(track);
  const visits = (await db.visits.where('date').equals(d.date).toArray()).filter(v => v.staffId === d.staffId);
  const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
  const towns = new Set(visits.map(v => (shops.get(v.shopId)?.area ?? '').toLowerCase()).filter(Boolean));
  const hq = (me?.hq ?? '').toLowerCase();
  const outstation = !!hq && [...towns].some(t => t !== hq);
  if (!visits.length) flags.push('No shop visited');
  if (track.length < 2) flags.push('Too few location readings to measure km');
  const cs = new ChangeSet(); cs.put<WorkDay>('workDays', { ...d, track, km, flags: [...new Set([...d.flags.filter(f => f === 'Started without location'), ...flags])], outstation, endAt: at }, 'end day'); await cs.commit('End day');
  return { km, flags, outstation };
}

// ---------------------------------------------------------------- beat & visits
export async function myShops(staffId = session().userId): Promise<Shop[]> {
  const me = await db.staff.get(staffId);
  const ids = new Set(me?.dbLinkIds ?? []);
  return (await db.shops.toArray()).filter(s => s.active !== false && s.dbLinkId && ids.has(s.dbLinkId));
}
export async function todaysBeat(staffId = session().userId) {
  const d = dayName();
  const shops = (await myShops(staffId)).filter(s => s.beat === d || s.aliases?.includes(`beat:${d}`));
  const visits = (await db.visits.where('date').equals(today()).toArray()).filter(v => v.staffId === staffId);
  return shops.map(s => ({ shop: s, visit: visits.find(v => v.shopId === s.id) })).sort((a, b) => Number(!!a.visit) - Number(!!b.visit) || a.shop.name.localeCompare(b.shop.name));
}
export const FAR_M = 300;
export const NO_ORDER_REASONS = ['Shop closed', 'Stock is enough', 'Owner not there', 'No money now', 'Buys from elsewhere', 'Other'];
/** one visit per shop per day per person: a second tap updates it (safe to tap twice) */
export async function visitShop(shop: Shop, pos: Pos | null, patch: Partial<Visit> & { reason?: string; photo?: string } = {}) {
  const me = session().userId;
  const cur = (await db.visits.where('date').equals(today()).toArray()).find(v => v.staffId === me && v.shopId === shop.id);
  const dist = pos && shop.lat != null && shop.lng != null ? Math.round(metres(pos, { lat: shop.lat, lng: shop.lng })) : undefined;
  const cs = new ChangeSet();
  const v = cs.put<Visit>('visits', {
    ...(cur ?? { shopId: shop.id, staffId: me, date: today(), at: nowIso() }),
    ...(pos && !cur?.lat ? { lat: pos.lat, lng: pos.lng, farFromShop: dist != null ? dist > FAR_M : undefined } : {}),
    ...patch,
  } as Visit, cur ? 'visit updated' : 'visit');
  await cs.commit('Shop visit');
  return { visit: v, distanceM: dist };
}

// ---------------------------------------------------------------- orders to the distributor
export interface FieldLine { productId: string; qty: number }
export function checkFieldOrder(shop: Shop | undefined, lines: FieldLine[], products: Map<string, Product>): string | null {
  if (!shop) return 'Pick the shop.';
  if (!shop.dbLinkId) return 'This shop is not with a linked distributor.';
  if (!lines.length) return 'Add at least one product.';
  for (const l of lines) {
    const p = products.get(l.productId);
    if (!p || !p.active) return 'A product is not in the list (or is stopped).';
    if (!Number.isInteger(l.qty) || l.qty <= 0) return `${p.name}: quantity must be a whole number more than 0.`;
  }
  return null;
}
/** the order goes to the shop's distributor (through the link) — it is billed there, never here */
export async function placeFieldOrder(shopId: string, lines: FieldLine[], visitId?: string) {
  const shop = await db.shops.get(shopId);
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.qty);
  const clean = [...merged].map(([productId, qty]) => ({ productId, qty }));
  const bad = checkFieldOrder(shop, clean, products); if (bad) throw new Error(bad);
  const link = await db.dbLinks.get(shop!.dbLinkId!);
  if (!link || link.status !== 'linked') throw new Error(`${link?.name ?? 'This distributor'} is not linked now, so the order cannot be sent.`);
  const me = (await db.staff.get(session().userId))!;
  // a double tap: the same order for the same shop within a minute is not sent twice
  const sig = JSON.stringify(clean.slice().sort((a, b) => a.productId.localeCompare(b.productId)));
  const recent = (await db.orders.where('shopId').equals(shopId).toArray()).find(o => o.repId === me.id && Date.now() - Date.parse(o.createdAt) < 60000 && JSON.stringify(o.lines.map(l => ({ productId: l.productId, qty: l.qty })).sort((a, b) => a.productId.localeCompare(b.productId))) === sig);
  if (recent) return recent;
  const cs = new ChangeSet();
  const o = cs.put<Order>('orders', { shopId, dbLinkId: shop!.dbLinkId, repId: me.id, repName: me.name.replace(/\s*\(.*\)$/, ''), source: 'company', lines: clean.map(l => ({ ...l, rate: products.get(l.productId)!.rate })), status: 'new', issues: [], date: today(), invoiceIds: [], visitId } as unknown as Order, 'order to distributor');
  const v = (await db.visits.where('date').equals(today()).toArray()).find(x => x.staffId === me.id && x.shopId === shopId);
  if (v) cs.put<Visit>('visits', { ...v, outcome: 'order' }, 'productive visit');
  else cs.put<Visit>('visits', { shopId, staffId: me.id, date: today(), at: nowIso(), outcome: 'order' }, 'visit');
  await cs.commit(`Order for ${shop!.name}`);
  return o;
}
export const orderValue = (o: Order) => r2(o.lines.reduce((a, l) => a + l.qty * l.rate, 0));
/** sent → billed by the distributor (its bill reached us through the link) */
export async function fieldOrderStatus(orders: Order[]) {
  const billed = new Map<string, number>();
  for (const s of await db.secondary.toArray()) if (s.orderId && !s.cancelled) billed.set(s.orderId, (billed.get(s.orderId) ?? 0) + s.taxable);
  return new Map(orders.map(o => [o.id, billed.has(o.id) ? { status: 'billed' as const, value: r2(billed.get(o.id)!) } : { status: 'sent' as const, value: orderValue(o) }]));
}

// ---------------------------------------------------------------- new shop request (the distributor approves it)
export async function requestShop(input: { name: string; area: string; beat: string; dbLinkId: string; photo?: string; pos?: Pos | null }) {
  if (!input.name.trim()) throw new Error('Shop name is needed.');
  if (!input.dbLinkId) throw new Error('Choose the distributor who will serve this shop.');
  if (!input.photo) throw new Error('Take a photo of the shop.');
  const me = (await db.staff.get(session().userId))!;
  const cs = new ChangeSet();
  cs.put<ShopRequest>('shopRequests', { dbLinkId: input.dbLinkId, name: input.name.trim(), area: input.area.trim(), beat: input.beat, photo: input.photo, lat: input.pos?.lat, lng: input.pos?.lng, repId: me.id, repName: me.name.replace(/\s*\(.*\)$/, '') }, 'new shop request');
  await cs.commit('New shop request');
}

// ---------------------------------------------------------------- leave & targets
export async function applyLeave(from: string, to: string, reason: string) {
  if (!from || !to || to < from) throw new Error('The last day must be on or after the first day.');
  if (!reason.trim()) throw new Error('Give a reason.');
  const cs = new ChangeSet(); cs.put<LeaveRequest>('leaves', { staffId: session().userId, from, to, reason: reason.trim(), status: 'waiting' }, 'leave'); await cs.commit('Leave request');
}
export async function decideLeave(id: string, ok: boolean) {
  const l = await db.leaves.get(id); if (!l || l.status !== 'waiting') throw new Error('Already decided.');
  const cs = new ChangeSet(); cs.put<LeaveRequest>('leaves', { ...l, status: ok ? 'approved' : 'rejected' }, ok ? 'leave approved' : 'leave rejected'); await cs.commit('Leave');
}
export async function setTarget(staffId: string, month: string, value: number) {
  if (!(value > 0)) throw new Error('Target must be more than 0.');
  const cur = (await db.targets.where('month').equals(month).toArray()).find(t => t.staffId === staffId);
  const cs = new ChangeSet(); cs.put<Target>('targets', { ...(cur ?? {}), companyId: 'own', month, kind: 'sales', value, staffId } as Target, 'target'); await cs.commit('Target');
}

// ---------------------------------------------------------------- the numbers for a person and a team
export interface RepRow { staff: Staff; started?: string; ended?: string; km: number; flags: string[]; visits: number; productive: number; far: number; orders: number; orderValue: number; monthSales: number; target: number; lastSeen?: string }
export async function repSales(month = thisMonth()) {
  const orders = new Map((await db.orders.toArray()).filter(o => o.source === 'company').map(o => [o.id, o]));
  const by = new Map<string, number>();
  for (const s of await db.secondary.toArray()) {
    if (s.cancelled || s.date.slice(0, 7) !== month || !s.orderId) continue;
    const o = orders.get(s.orderId); if (o?.repId) by.set(o.repId, r2((by.get(o.repId) ?? 0) + s.taxable));
  }
  return by;
}
export async function teamToday(team: Staff[], day = today()): Promise<RepRow[]> {
  const wd = await db.workDays.where('date').equals(day).toArray();
  const vs = await db.visits.where('date').equals(day).toArray();
  const os = (await db.orders.where('date').equals(day).toArray()).filter(o => o.source === 'company');
  const sales = await repSales(day.slice(0, 7));
  const targets = (await db.targets.where('month').equals(day.slice(0, 7)).toArray());
  return team.filter(s => s.role === 'rep').map(s => {
    const w = wd.find(x => x.staffId === s.id);
    const v = vs.filter(x => x.staffId === s.id), o = os.filter(x => x.repId === s.id);
    return {
      staff: s, started: w?.startAt, ended: w?.endAt, km: w?.km ?? 0, flags: w?.flags ?? [], visits: v.length,
      productive: v.filter(x => x.outcome === 'order').length, far: v.filter(x => x.farFromShop).length,
      orders: o.length, orderValue: r2(o.reduce((a, x) => a + orderValue(x), 0)), monthSales: sales.get(s.id) ?? 0,
      target: targets.find(t => t.staffId === s.id)?.value ?? 0, lastSeen: w?.track[w.track.length - 1]?.at,
    };
  });
}
