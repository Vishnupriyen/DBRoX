// Company field team: travel allowance (km × rate), daily allowance (home town or outstation) and expenses, built into
// one monthly claim. Every flag the record raises is shown to the manager; nothing is hidden or "fixed" silently.
import { ChangeSet, db, getSettings, session, thisMonth } from './db';
import type { Expense, Settings, TravelClaim } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;
export const DEFAULT_POLICY: NonNullable<Settings['travel']> = { bike: 3.5, car: 9, daLocal: 200, daOut: 450, limits: { Lodge: 1200, Food: 300, Bus: 400 } };
export async function policy() { return { ...DEFAULT_POLICY, ...((await getSettings()).travel ?? {}) }; }

export interface MonthClaim { staffId: string; month: string; days: number; km: number; kmAmount: number; daDays: number; outDays: number; daAmount: number; expenses: number; total: number; flags: string[] }
const hash = (s?: string) => { if (!s) return ''; let h = 0; for (let i = 0; i < s.length; i += 7) h = (h * 31 + s.charCodeAt(i)) | 0; return `${s.length}:${h}`; };

/** what the month comes to, from the record (the rep cannot type km or days) */
export async function monthClaim(staffId: string, month = thisMonth()): Promise<MonthClaim> {
  const pol = await policy();
  const days = (await db.workDays.where('staffId').equals(staffId).toArray()).filter(d => d.date.slice(0, 7) === month);
  const visits = (await db.visits.where('staffId').equals(staffId).toArray()).filter(v => v.date.slice(0, 7) === month);
  const exps = (await db.expenses.toArray()).filter(e => e.by === staffId && e.date.slice(0, 7) === month && e.status !== 'rejected');
  const leaves = (await db.leaves.where('staffId').equals(staffId).toArray()).filter(l => l.status === 'approved');
  const onLeave = (d: string) => leaves.some(l => l.from <= d && l.to >= d);
  const flags: string[] = [];
  let km = 0, kmAmount = 0, daDays = 0, outDays = 0;
  for (const d of days.sort((a, b) => a.date.localeCompare(b.date))) {
    const v = visits.filter(x => x.date === d.date).length;
    const rate = d.mode === 'car' ? pol.car : d.mode === 'bike' ? pol.bike : 0;
    km += d.km; kmAmount += d.km * rate;
    if (!v) flags.push(`${d.date}: day started but no shop visited — no daily allowance`);
    else { daDays++; if (d.outstation) outDays++; }
    if (!d.endAt) flags.push(`${d.date}: day not ended`);
    for (const f of d.flags) if (f !== 'No shop visited') flags.push(`${d.date}: ${f}`);
  }
  const seen = new Map<string, string>();
  for (const e of exps) {
    const lim = pol.limits[e.category];
    if (lim && e.amount > lim) flags.push(`${e.date}: ${e.category} ₹${e.amount} is over the ₹${lim} limit`);
    if (onLeave(e.date)) flags.push(`${e.date}: ${e.category} ₹${e.amount} on a leave day`);
    if (!e.photo && e.amount > 100) flags.push(`${e.date}: ${e.category} ₹${e.amount} has no bill photo`);
    const h = hash(e.photo); if (h) { if (seen.has(h)) flags.push(`${e.date}: same bill photo as ${seen.get(h)}`); else seen.set(h, `${e.date} ${e.category}`); }
  }
  const daAmount = (daDays - outDays) * pol.daLocal + outDays * pol.daOut;
  const expenses = r2(exps.reduce((a, e) => a + e.amount, 0));
  return { staffId, month, days: days.length, km: r2(km), kmAmount: r2(kmAmount), daDays, outDays, daAmount, expenses, total: r2(kmAmount + daAmount + expenses), flags };
}

export async function addExpense(input: { date: string; category: string; amount: number; note?: string; photo?: string }) {
  if (!(input.amount > 0)) throw new Error('Amount must be more than 0.');
  if (!input.category.trim()) throw new Error('Pick what the expense was for.');
  const cs = new ChangeSet();
  cs.put<Expense>('expenses', { by: session().userId, date: input.date, category: input.category.trim(), amount: r2(input.amount), note: input.note?.trim(), photo: input.photo, status: 'waiting' } as Expense, 'expense');
  await cs.commit('Expense');
}

/** freeze the month's figures and send them to the manager (one claim a month; a rejected one can be sent again) */
export async function submitMonth(month = thisMonth()) {
  const me = session().userId;
  const prev = (await db.travelClaims.where('staffId').equals(me).toArray()).filter(c => c.month === month && c.status !== 'rejected');
  if (prev.length) throw new Error(prev[0].status === 'approved' ? 'This month is already approved.' : 'This month is already sent.');
  const m = await monthClaim(me, month);
  if (!m.days && !m.expenses) throw new Error('Nothing to claim for this month.');
  const cs = new ChangeSet();
  cs.put<TravelClaim>('travelClaims', { ...m, status: 'waiting' } as TravelClaim, 'travel claim');
  await cs.commit('Travel claim sent');
}
export async function decideTravel(id: string, ok: boolean, note: string) {
  const c = await db.travelClaims.get(id);
  if (!c || c.status !== 'waiting') throw new Error('Already decided.');
  if (c.staffId === session().userId) throw new Error('You cannot approve your own claim.');
  if (!ok && !note.trim()) throw new Error('Say why — the rep sees this.');
  const me = await db.staff.get(session().userId);
  const cs = new ChangeSet();
  cs.put<TravelClaim>('travelClaims', { ...c, status: ok ? 'approved' : 'rejected', decidedBy: me?.name, note: note.trim() || undefined }, ok ? 'travel approved' : 'travel rejected');
  // the expenses inside an approved claim are approved with it
  if (ok) for (const e of (await db.expenses.toArray()).filter(e => e.by === c.staffId && e.date.slice(0, 7) === c.month && e.status === 'waiting')) cs.put<Expense>('expenses', { ...e, status: 'approved' }, 'expense approved');
  await cs.commit('Travel claim');
}
