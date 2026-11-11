// The server's own word on what a phone may save. Phones are not trusted with money, approvals, numbers or other
// people's records: these rules hold whatever a phone (or someone with its token) sends.
import type pg from 'pg';

type Doc = Record<string, unknown>;

/** PINs anyone would try first: 0000, 1111 … 9999, 1234, 4321, 1212 and years 1950–2030 */
export function weakPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin)) return false;
  if (/^(\d)\1{3}$/.test(pin) || ['1234', '4321', '1212'].includes(pin)) return true;
  const y = Number(pin);
  return y >= 1950 && y <= 2030;
}

// ---------------------------------------------------------------- bad text
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** strings Postgres can't store (a lone half of an emoji, \u0000) are cleaned, so one bad character never blocks a sync */
export function cleanText(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(LONE, '�').replace(/\u0000/g, '');
  if (Array.isArray(v)) return v.map(cleanText);
  if (v && typeof v === 'object') {
    const out: Doc = {};
    for (const [k, x] of Object.entries(v as Doc)) out[cleanText(k) as string] = cleanText(x);
    return out;
  }
  return v;
}

// ---------------------------------------------------------------- money and approvals (distributor side)
const META = new Set(['id', 'tenantId', 'updatedAt', 'createdAt', 'dirty']);
/** what a delivery phone writes on a bill: the delivery result (and the stock lots on its lines) */
const DELIVERY_FIELDS = new Set(['deliveryStatus', 'delivery', 'tripId', 'stopNo', 'vanId', 'printedAt']);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const linesNoLots = (l: unknown) => (Array.isArray(l) ? l : []).map(x => { const { batches: _b, ...rest } = (x ?? {}) as Doc; void _b; return rest; });
const ORDER_RANK: Record<string, number> = { new: 0, needs_ok: 0, approved: 1, picked: 2, billed: 3, cancelled: 3 };
const decided = (s: unknown) => s === 'approved' || s === 'rejected';

/** distributor records written by a role other than owner/office: a reason to refuse, or null */
export function distributorRule(role: string, userId: string, table: string, data: Doc, existing: Doc | undefined): string | null {
  if (role === 'owner' || role === 'office') return null;
  if (table === 'invoices') {
    if (!existing) return 'only the owner or office makes bills';
    for (const k of new Set([...Object.keys(data), ...Object.keys(existing)])) {
      if (META.has(k) || DELIVERY_FIELDS.has(k)) continue;
      if (k === 'lines') { if (!same(linesNoLots(data.lines), linesNoLots(existing.lines))) return 'bill lines are the owner\'s'; continue; }
      if (!same(data[k], existing[k])) return `bill field ${k} is the owner's`;
    }
    return null;
  }
  if (table === 'orders' && existing) {
    const a = ORDER_RANK[String(existing.status)] ?? 0, b = ORDER_RANK[String(data.status)] ?? 0;
    if (b < a) return 'an order never goes back';
    if (a === 3 && data.status !== existing.status) return 'a billed or cancelled order is final';
    return null;
  }
  if (table === 'payments') {
    if (!existing) return data.settled ? 'only the owner or office settles a payment' : !['ok', 'waiting_shop', undefined].includes(data.status as string) ? 'only the owner or office sets a payment status' : null;
    if (String(existing.collectedBy) !== userId) return 'a payment is changed only by the person who took it';
    if (!!data.settled !== !!existing.settled) return 'only the owner or office settles a payment';
    // the one status change a collector makes: cancelling their own collection before it reaches the office
    // (the app's "cancel / correct my payment"; the correction is a new payment)
    if (data.status !== existing.status && !(existing.status === 'ok' && data.status === 'cancelled' && !existing.settled)) return 'only the owner or office sets a payment status';
    return null;
  }
  // a staff return or write-off is a request: saved waiting, by its own person; only the owner or office decides it
  if (table === 'requests') {
    if (!existing) return data.by !== userId ? 'a request is made in your own name' : data.status !== 'waiting' ? 'nobody approves their own' : null;
    if (String(existing.by) !== userId) return 'a request is changed only by the person who made it';
    if (!same(data.status, existing.status) || !same(data.by, existing.by) || !same(data.result, existing.result)) return 'only the owner or office decides';
    return null;
  }
  if (table === 'advances' || table === 'leaves' || table === 'expenses') {
    const keys = table === 'expenses' ? ['status', 'approved'] : ['status'];
    for (const k of keys) {
      if (!existing) { if (k === 'approved' ? !!data.approved : (data[k] !== undefined && data[k] !== 'waiting')) return 'nobody approves their own'; }
      else if (!same(data[k], existing[k])) return 'only the owner or office decides';
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------- money fields (every role, owner too)
const fin = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
/** the app's own list (app/src/core/db.ts guard): every money field, when present, is a real number */
const MONEY_KEYS = ['amount', 'total', 'taxable', 'tax', 'cgst', 'sgst', 'igst', 'roundOff', 'rate', 'mrp', 'purchaseRate', 'discount', 'gross',
  'advance', 'paid', 'credited', 'received', 'recovered', 'credit', 'debit', 'schemeSaving', 'budget', 'salary', 'batta', 'kmAmount', 'daAmount', 'expenses'];
const MONEY_REQUIRED: Record<string, string[]> = {
  claimEntries: ['amount'], claims: ['amount'], purchases: ['total'], advances: ['amount'], creditNotes: ['total'], payments: ['amount'], openingDues: ['amount'], invoices: ['total', 'taxable', 'cgst', 'sgst', 'igst'],
};
/** the first money field that is not a real number (text, or a required one missing / NaN — NaN arrives as null), or null.
 *  An optional field left empty (null) is allowed, as on the phone. */
export function badMoney(table: string, d: Doc): string | null {
  if (table === 'audit' || table === 'settings' || table === 'staff') return null;
  for (const k of MONEY_REQUIRED[table] ?? []) if (!fin(d[k])) return k;
  const check = (o: Doc) => { for (const k of MONEY_KEYS) if (k in o && o[k] !== undefined && o[k] !== null && !fin(o[k])) return k; return null; };
  const top = check(d); if (top) return top;
  for (const list of ['lines', 'allocations', 'settlements']) {
    const arr = d[list]; if (!Array.isArray(arr)) continue;
    for (const x of arr) if (x && typeof x === 'object') { const k = check(x as Doc); if (k) return `${list}.${k}`; }
  }
  return null;
}

/** a credit note never takes a bill below zero: with the bill's other notes it comes to at most what the bill charged */
export function creditNoteRoom(cn: Doc, bill: Doc | undefined, otherNotesTotal: number): string | null {
  if (!bill) return 'a credit note needs its bill';
  if (bill.shopId !== cn.shopId) return 'a credit note is for its own bill\'s shop';
  const total = Number(cn.total), charged = Number(bill.total);
  if (!fin(total) || total < 0) return 'credit note amount is not valid';
  if (Math.round((otherNotesTotal + total) * 100) > Math.round(charged * 100) + 1) return 'credit notes would come to more than the bill charged';
  return null;
}

/** a bill line's pieces come from stock lots: every line carries its lots (batch id, whole pieces 0 or more) — the
 *  same rule the app's guard holds (one rule for every path that makes or changes a bill line) */
export function billLotsOk(d: Doc): boolean {
  const lines = Array.isArray(d.lines) ? d.lines as Doc[] : [];
  for (const l of lines) {
    if (!Array.isArray(l.batches)) return false;
    for (const b of l.batches as Doc[]) if (!b || typeof b.batchId !== 'string' || !b.batchId || !Number.isInteger(b.qty) || (b.qty as number) < 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------- staff privacy (what a person downloads)
/** records only their own person may download: role → table → the field naming that person */
export const OWN_ROWS: Record<string, Record<string, string>> = {
  salesman: { advances: 'staffId', leaves: 'staffId' },
  godown: { advances: 'staffId', leaves: 'staffId' },
  delivery: { advances: 'staffId', leaves: 'staffId', expenses: 'by' },
  rep: { orders: 'repId', expenses: 'by', travelClaims: 'staffId', advances: 'staffId', leaves: 'staffId' },
};
/** may this person download this record? (another salesman's advance, another rep's orders: no) */
export function mayDownload(role: string, userId: string, tbl: string, data: Doc): boolean {
  const f = OWN_ROWS[role]?.[tbl];
  return !f || String(data[f] ?? '') === userId;
}

/** shops.creditLimit is the owner's: a staff save keeps the stored limit (a new shop starts cash-only, limit 0) */
export function keepCreditLimit(role: string, data: Doc, existing: Doc | undefined): Doc {
  if (role === 'owner' || role === 'office') return data;
  return { ...data, creditLimit: existing ? existing.creditLimit ?? 0 : 0 };
}

/** owner-only fields (purchase rate): anyone else's save keeps the stored value and can never set it */
export function keepOwnerOnly(role: string, fields: string[] | undefined, data: Doc, existing: Doc | undefined): Doc {
  if (role === 'owner' || role === 'cadmin' || !fields?.length) return data; // cadmin: the company's own price to distributors
  const out = { ...data };
  for (const f of fields) { if (existing && existing[f] !== undefined) out[f] = existing[f]; else delete out[f]; }
  return out;
}

/** a bill adds up: tax parts + round-off = total, and its lines' taxable = the bill's taxable */
export function billAddsUp(d: Doc): boolean {
  const n = (k: unknown) => Number(k ?? 0);
  if (![d.total, d.taxable, d.cgst, d.sgst, d.igst].every(x => typeof x === 'number' && Number.isFinite(x))) return false;
  const lines = Array.isArray(d.lines) ? d.lines as Doc[] : [];
  if (!lines.length && n(d.total) !== 0) return false;
  if (Math.abs(n(d.taxable) + n(d.cgst) + n(d.sgst) + n(d.igst) + n(d.roundOff) - n(d.total)) > 0.011) return false;
  if (Math.abs(lines.reduce((a, l) => a + n(l.taxable), 0) - n(d.taxable)) > 0.011 * Math.max(1, lines.length)) return false;
  if (Math.abs(lines.reduce((a, l) => a + n(l.total), 0) + n(d.roundOff) - n(d.total)) > 0.011 * Math.max(1, lines.length)) return false;
  return true;
}

/** was this bill / credit-note / receipt number issued by this server? (bills: PREFIX/FY/n, credit notes: CN/FY/n,
 *  collection receipts: R/FY/n; n below the counter) */
export async function numberIssued(q: pg.PoolClient, tenant: string, table: 'invoices' | 'creditNotes' | 'receipts', number: string): Promise<boolean> {
  const m = number.match(/^(.+)\/(\d{2}-\d{2})\/(\d{1,9})$/);
  if (!m) return false;
  const t = (await q.query('SELECT prefix, next_bill_no, next_cn_no, next_receipt_no FROM tenants WHERE id=$1', [tenant])).rows[0];
  if (!t) return false;
  const k = Number(m[3]);
  if (table === 'invoices') return m[1] === (t.prefix ?? 'DBX') && k >= 1 && k < Number(t.next_bill_no);
  if (table === 'receipts') return m[1] === 'R' && k >= 1 && k < Number(t.next_receipt_no);
  return m[1] === 'CN' && k >= 1 && k < Number(t.next_cn_no);
}
