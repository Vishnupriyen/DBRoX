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

/** was this bill / credit-note number issued by this server? (bills: PREFIX/FY/n, credit notes: CN/FY/n, n below the counter) */
export async function numberIssued(q: pg.PoolClient, tenant: string, table: 'invoices' | 'creditNotes', number: string): Promise<boolean> {
  const m = number.match(/^(.+)\/(\d{2}-\d{2})\/(\d{1,9})$/);
  if (!m) return false;
  const t = (await q.query('SELECT prefix, next_bill_no, next_cn_no FROM tenants WHERE id=$1', [tenant])).rows[0];
  if (!t) return false;
  const k = Number(m[3]);
  if (table === 'invoices') return m[1] === (t.prefix ?? 'DBX') && k >= 1 && k < Number(t.next_bill_no);
  return m[1] === 'CN' && k >= 1 && k < Number(t.next_cn_no);
}
