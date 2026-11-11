// Staff returns and stock write-offs become REQUESTS (manager decision after round 1; manager default for write-offs).
// A salesman, godown or delivery person never makes a credit note on their own phone, and a godown damage or count that
// writes off more than the owner's limit (₹500 unless set) never changes stock by itself. The request syncs; the owner
// (or office, within the owner's limit) approves it on their own phone — the credit note then gets a server number the
// usual way — or rejects it with a reason. Nothing is changed until then.
import { inr, plural } from './i18n';
import { ChangeSet, db, getSettings, localDay, nowIso, session, today } from './db';
import { r2 } from './ledger';
import { countLot, creditNoteNumbers, pickBatches } from './billing';
import { buildCreditNote, costValue, makeCreditNote } from './credit';
import type { ClaimEntry, Product, Role, StaffRequest } from './types';

export const DEFAULT_WRITE_OFF_LIMIT = 500;
const s = (v: unknown) => String(v ?? '').trim();
const n = (v: unknown) => Number(v) || 0;

async function me(): Promise<{ id: string; role: Role }> {
  const id = session().userId;
  return { id, role: (await db.staff.get(id))?.role ?? 'owner' };
}
export const decides = (role: Role) => role === 'owner' || role === 'office';

/** the value of pieces written off, for the ₹ limit: the buying rate when this phone has it, else the selling rate
 *  (staff phones never see buying rates — the selling rate is higher, so nothing over the limit slips through) */
export function writeOffRate(p: Pick<Product, 'purchaseRate' | 'rate'> | undefined) {
  const b = p?.purchaseRate;
  return typeof b === 'number' && Number.isFinite(b) && b > 0 ? b : (p?.rate ?? 0);
}
export async function writeOffLimit() { const st = await getSettings(); return st.writeOffLimit ?? DEFAULT_WRITE_OFF_LIMIT; }

// ---------------------------------------------------------------- the actual changes (used directly, or on approval)
export type ReturnRow = { invoiceId: string; productId: string; qty: number; restock: boolean };
/** credit notes for a shop return, one per bill, numbered the usual way (server number when there is a server) */
export async function applyReturn(cs: ChangeSet, rows: ReturnRow[], reason: string) {
  const byInvoice = new Map<string, ReturnRow[]>();
  for (const r of rows) byInvoice.set(r.invoiceId, [...(byInvoice.get(r.invoiceId) ?? []), r]);
  const cnNos = await creditNoteNumbers(cs, byInvoice.size);
  let i = 0; const made: string[] = []; let total = 0;
  for (const [invoiceId, list] of byInvoice) {
    const inv = await db.invoices.get(invoiceId);
    if (!inv) throw new Error('Bill not found.');
    // returned pieces come off the bill's lots; good ones go back to stock; the credit is the bill line's own value
    const cn = await makeCreditNote(cs, inv, list.map(r => ({ productId: r.productId, paid: r.qty, free: 0, restock: r.restock })), { reason: reason || 'Return', source: 'return', takeOffBill: true, number: cnNos[i++] });
    made.push(cn.number); total = r2(total + cn.total);
  }
  return { numbers: made, total };
}

export type DamageRow = { productId: string; qty: number; kind: string; fromStock: boolean; note: string; amount?: number };
/** damage / expiry into the claim register, the pieces out of stock when they were on the shelf */
export async function applyDamage(cs: ChangeSet, rows: DamageRow[], photo?: string) {
  const month = today().slice(0, 7);
  const products = new Map((await db.products.toArray()).map(x => [x.id, x]));
  const batches = await db.batches.toArray();
  for (const r of rows) {
    const prod = products.get(r.productId); if (!prod) throw new Error('Product not found.');
    // a staff phone has no buying rate: the value is filled in by the owner's phone (never NaN, never shown to them)
    const val = (r.amount ?? 0) > 0 ? { amount: r2(r.amount!), pending: false } : costValue(prod, r.qty);
    cs.put<ClaimEntry>('claimEntries', { companyId: prod.companyId, month, kind: (r.kind || 'damage') as ClaimEntry['kind'], productId: prod.id, qty: r.qty, amount: val.amount, valuePending: val.pending || undefined, note: r.note, photo } as ClaimEntry, 'damage entry');
    if (r.fromStock) {
      const { picks, short } = pickBatches(batches, prod.id, r.qty, '0000-00-00');
      if (short > 0) throw new Error(`Only ${r.qty - short} pcs of ${prod.name} are in stock.`);
      for (const pk of picks) { const b = batches.find(x => x.id === pk.batchId)!; b.qty -= pk.qty; cs.put('batches', { ...b }, 'damaged out of stock'); }
    }
  }
}

export type CountRow = { batchId: string; productId?: string; system: number; counted: number };
/** a physical count. Approved later, the difference is applied to the lot as it is NOW (a bill since then still counts). */
export async function applyCount(cs: ChangeSet, rows: CountRow[], why: string, later = false) {
  let sys = 0, cnt = 0;
  for (const r of rows) {
    const b = await db.batches.get(r.batchId); if (!b) continue;
    if (!later && b.qty !== r.system) throw new Error('The stock moved while you were counting (a bill or delivery). Ask again for a fresh count table.');
    const target = later ? b.qty + (r.counted - r.system) : r.counted;
    if (target < 0) throw new Error(`The stock of lot ${b.batch} moved since the count: only ${b.qty} pcs left now. Ask for a fresh count.`);
    countLot(cs, b, target, why);
    sys += b.qty; cnt += target;
  }
  return { sys, cnt };
}

// ---------------------------------------------------------------- making a request
/** what a damage write-off takes off the shelf, in ₹ (only pieces removed from stock count) */
export async function damageValue(rows: DamageRow[]) {
  const products = new Map((await db.products.toArray()).map(x => [x.id, x]));
  return r2(rows.filter(r => r.fromStock).reduce((a, r) => a + r.qty * writeOffRate(products.get(r.productId)), 0));
}
/** what a count writes off, in ₹ (pieces found missing; pieces found extra write nothing off) */
export async function countValue(rows: CountRow[]) {
  const batches = new Map((await db.batches.toArray()).map(b => [b.id, b]));
  const products = new Map((await db.products.toArray()).map(x => [x.id, x]));
  return r2(rows.reduce((a, r) => a + Math.max(0, r.system - r.counted) * writeOffRate(products.get(r.productId ?? batches.get(r.batchId)?.productId ?? '')), 0));
}

/** what this person has already written off today, in ₹ (damage and count together): their saved write-offs (stock moves
 *  out of the shelf for damage or a count) and their requests still waiting or approved. The limit is a running total, so
 *  three small entries cannot slip under it one by one. */
export async function writtenOffToday(userId: string, day = today()) {
  const products = new Map((await db.products.toArray()).map(x => [x.id, x]));
  const batches = new Map((await db.batches.toArray()).map(b => [b.id, b]));
  let total = 0;
  for (const m of await db.stockMoves.toArray()) {
    if (m.by !== userId || m.delta >= 0 || localDay(m.at) !== day) continue;
    if (!/damaged out of stock|count adjust/.test(m.reason)) continue;
    total += -m.delta * writeOffRate(products.get(m.productId ?? batches.get(m.batchId)?.productId ?? ''));
  }
  for (const r of (await db.requests.toArray()).filter(x => x.date === day)) if (r.by === userId && r.kind !== 'return' && r.status !== 'rejected') total += r.value;
  return r2(total);
}

/** does this return / write-off go to the owner as a request? (and does only the owner decide it?) */
export async function needsRequest(kind: StaffRequest['kind'], value: number) {
  const { role } = await me();
  const st = await getSettings();
  if (kind === 'return') {
    const over = value > (st.returnApprovalLimit || 0);
    if (role === 'owner') return { request: false, ownerOnly: false };
    if (role === 'office') return { request: over, ownerOnly: over };
    return { request: true, ownerOnly: over };
  }
  // a write-off: the owner's own is saved; anyone else's above the limit waits for the owner
  const { id } = await me();
  const over = role !== 'owner' && value + (value > 0 ? await writtenOffToday(id) : 0) > (st.writeOffLimit ?? DEFAULT_WRITE_OFF_LIMIT);
  return { request: over, ownerOnly: true };
}

export async function makeRequest(cs: ChangeSet, r: Pick<StaffRequest, 'kind' | 'reason' | 'value' | 'rows'> & Partial<Pick<StaffRequest, 'shopId' | 'photo' | 'ownerOnly'>>) {
  const who = await me();
  return cs.put<StaffRequest>('requests', { ...r, by: who.id, role: who.role, date: today(), status: 'waiting' }, `${r.kind} request`);
}

/** a damage / expiry entry (TESRAX table or the Damages screen): saved now, or — a write-off above the owner's limit by
 *  anyone but the owner — a request, with nothing out of stock until the owner approves */
export async function damageOrRequest(cs: ChangeSet, rows: DamageRow[], photo?: string) {
  const value = await damageValue(rows);
  if ((await needsRequest('damage', value)).request) {
    await makeRequest(cs, { kind: 'damage', reason: rows.map(r => r.note).filter(Boolean).join('; ') || 'Damage / expiry', value, rows: rows.map(r => ({ productId: r.productId, qty: r.qty, kind: r.kind || 'damage', fromStock: r.fromStock ? 'yes' : 'no', note: r.note })), photo, ownerOnly: true });
    return { requested: true, value };
  }
  await applyDamage(cs, rows, photo);
  return { requested: false, value };
}
/** a physical count (TESRAX table or the lot's Count button): saved now, or a request when it writes off more than the limit */
export async function countOrRequest(cs: ChangeSet, rows: CountRow[], why: string) {
  if (!why.trim()) throw new Error('Give a reason for the difference.');
  if (rows.some(r => !Number.isInteger(r.counted) || r.counted < 0)) throw new Error('A count must be a whole number, 0 or more.');
  if (rows.every(r => r.counted === r.system)) throw new Error('Nothing changed: the count is the same as the system.');
  const value = await countValue(rows);
  if ((await needsRequest('count', value)).request) {
    for (const r of rows) { const b = await db.batches.get(r.batchId); if (b && b.qty !== r.system) throw new Error('The stock moved while you were counting (a bill or delivery). Ask again for a fresh count table.'); }
    await makeRequest(cs, { kind: 'count', reason: why.trim(), value, rows: rows.map(r => ({ batchId: r.batchId, productId: r.productId ?? '', system: r.system, counted: r.counted })), ownerOnly: true });
    return { requested: true, value, sys: 0, cnt: 0 };
  }
  const c = await applyCount(cs, rows, why.trim());
  return { requested: false, value, ...c };
}

// ---------------------------------------------------------------- the owner / office decides
export async function waitingRequests() {
  return (await db.requests.where('status').equals('waiting').toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const deciding = new Set<string>();
/** approve: the change is made now, on this phone (a return's credit note gets its number here). Safe to tap twice. */
export async function approveRequest(id: string) {
  if (deciding.has(id)) throw new Error('This request is already being decided.');
  deciding.add(id);
  try {
    const who = await me();
    if (!decides(who.role)) throw new Error('Only the owner or office approves requests.');
    const r = await db.requests.get(id);
    if (!r) throw new Error('Request not found.');
    if (r.status !== 'waiting') throw new Error(`This request was already ${r.status}.`);
    if (r.ownerOnly && who.role !== 'owner') throw new Error(`Above the owner's limit (${inr(r.value)}): only the owner can approve this.`);
    const cs = new ChangeSet();
    let result = '';
    if (r.kind === 'return') {
      const rows = r.rows.map(x => ({ invoiceId: s(x.invoiceId), productId: s(x.productId), qty: n(x.qty), restock: s(x.restock) !== 'no' }));
      const done = await applyReturn(cs, rows, r.reason);
      result = `Credit note ${done.numbers.join(', ')} · ${inr(done.total)}`;
    } else if (r.kind === 'damage') {
      await applyDamage(cs, r.rows.map(x => ({ productId: s(x.productId), qty: n(x.qty), kind: s(x.kind) || 'damage', fromStock: s(x.fromStock) !== 'no', note: s(x.note) })), r.photo);
      result = `${plural(r.rows.length, 'line')} written off`;
    } else {
      const c = await applyCount(cs, r.rows.map(x => ({ batchId: s(x.batchId), system: n(x.system), counted: n(x.counted) })), r.reason, true);
      result = `Count applied: ${c.sys} → ${c.cnt} pcs`;
    }
    cs.put<StaffRequest>('requests', { ...r, status: 'approved', decidedBy: who.id, decidedAt: nowIso(), result }, 'request approved');
    await cs.commit(r.kind === 'return' ? 'Return approved' : 'Write-off approved');
    return result;
  } finally { deciding.delete(id); }
}

export async function rejectRequest(id: string, reason: string) {
  const who = await me();
  if (!decides(who.role)) throw new Error('Only the owner or office decides requests.');
  if (!reason.trim()) throw new Error('Say why it is rejected.');
  const r = await db.requests.get(id);
  if (!r || r.status !== 'waiting') throw new Error('This request was already decided.');
  if (r.ownerOnly && who.role !== 'owner') throw new Error('Only the owner decides this one.');
  const cs = new ChangeSet();
  cs.put<StaffRequest>('requests', { ...r, status: 'rejected', decidedBy: who.id, decidedAt: nowIso(), rejectReason: reason.trim() }, 'request rejected');
  await cs.commit('Request rejected');
}

/** the credit a return request would give now (shown to the person deciding) */
export async function returnValue(rows: ReturnRow[]) {
  let total = 0;
  const byInvoice = new Map<string, ReturnRow[]>(); for (const r of rows) byInvoice.set(r.invoiceId, [...(byInvoice.get(r.invoiceId) ?? []), r]);
  for (const [id, list] of byInvoice) {
    const inv = await db.invoices.get(id); if (!inv) continue;
    total = r2(total + buildCreditNote(inv, await db.creditNotes.where('invoiceId').equals(id).toArray(), list.map(r => ({ productId: r.productId, paid: r.qty, free: 0, restock: r.restock }))).total);
  }
  return total;
}
