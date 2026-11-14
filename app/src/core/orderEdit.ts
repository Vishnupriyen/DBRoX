// Orders received as an editable order (Part 2 item 8 — docs/PART2_SPEC.md, PART2_UX.md 2b). The owner or office changes
// qty, rate and Disc %, adds or removes products while the order is new or needs OK. The salesman's lines are kept
// (Order.original); every edit goes to the activity log (the audit, one plain line per change). Once approved it changes
// only at Verify picked. The screen and the Excel use the same figures as the bill (billing.ts), to the paisa.
import { ChangeSet, db, nowIso, session, today } from './db';
import { billTotals, checkOrder, priceLines } from './billing';
import { isInterState } from './gst';
import { r2 } from './ledger';
import { lineOf } from './lines';
import type { InvoiceLine, Order, OrderLine, Product, Scheme } from './types';

export const uqcOf = (p: Pick<Product, 'unit'> | undefined) => (p?.unit || 'PCS').toUpperCase();

/** an order's lines priced as the bill will be (schemes, Disc %, tax per line), with the bill footer: taxable, tax,
 *  round-off, total. Several companies = several bills: the footer adds their own totals (each bill rounds itself). */
export function orderView(lines: OrderLine[], products: Map<string, Product>, schemes: Scheme[], inter: boolean, date?: string) {
  const rows: { line: number; product?: Product; unit: string; qty: number; rate: number; discountPct: number; discount: number; gst: number; amount: number; bill?: InvoiceLine }[] = [];
  const byCo = new Map<string, InvoiceLine[]>();
  const priced = priceLines(lines, products, schemes, inter, date ?? today());
  lines.forEach((l, i) => {
    const p = products.get(l.productId); const b = priced[i];
    if (!p || !b) { rows.push({ line: lineOf(l, i), product: p, unit: uqcOf(p), qty: l.qty, rate: l.rate, discountPct: l.discountPct ?? 0, discount: 0, gst: p?.gst ?? 0, amount: 0 }); return; }
    byCo.set(p.companyId, [...(byCo.get(p.companyId) ?? []), b]);
    const pct = l.discountPct ?? (b.gross ? r2(b.discount / b.gross * 100) : 0);
    rows.push({ line: lineOf(l, i), product: p, unit: uqcOf(p), qty: l.qty, rate: l.rate, discountPct: pct, discount: b.discount, gst: p.gst, amount: b.total, bill: b });
  });
  const parts = [...byCo.values()].map(billTotals);
  const sum = (k: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'roundOff' | 'total') => r2(parts.reduce((a, t) => a + t[k], 0));
  return { rows, taxable: sum('taxable'), tax: r2(sum('cgst') + sum('sgst') + sum('igst')), roundOff: sum('roundOff'), total: sum('total') };
}

const fmt = (n: number) => String(Number.isInteger(n) ? n : r2(n));
/** one plain line per change, for the activity log: "qty Parle-G 10 → 12", "added Surf", "removed Vim" */
function changes(before: OrderLine[], after: OrderLine[], name: (id: string) => string): string[] {
  const out: string[] = [];
  const old = new Map(before.map((l, i) => [lineOf(l, i), l]));
  const now = new Map(after.map((l, i) => [lineOf(l, i), l]));
  for (const [n, l] of now) {
    const was = old.get(n);
    if (!was) { out.push(`added ${name(l.productId)} ${l.qty}`); continue; }
    if (was.qty !== l.qty) out.push(`qty ${name(l.productId)} ${fmt(was.qty)} → ${fmt(l.qty)}`);
    if (was.rate !== l.rate) out.push(`rate ${name(l.productId)} ${fmt(was.rate)} → ${fmt(l.rate)}`);
    if ((was.discountPct ?? 0) !== (l.discountPct ?? 0)) out.push(`Disc % ${name(l.productId)} ${fmt(was.discountPct ?? 0)} → ${fmt(l.discountPct ?? 0)}`);
  }
  for (const [n, l] of old) if (!now.has(n)) out.push(`removed ${name(l.productId)}`);
  return out;
}

const editing = new Set<string>();
/** save the owner's or office's changes to an order still waiting for approval. Read again at save time (another phone may
 *  have approved or cancelled it). Lines without a number get the next one (never reused). */
export async function editOrder(orderId: string, lines: OrderLine[]): Promise<Order> {
  if (editing.has(orderId)) throw new Error('This order is already being saved.');
  editing.add(orderId);
  try {
    const o = await db.orders.get(orderId);
    if (!o) throw new Error('Order not found.');
    if (o.status === 'cancelled') throw new Error('This order was already cancelled.');
    if (o.status !== 'new' && o.status !== 'needs_ok') {
      const who = o.approvedBy ? (await db.staff.get(o.approvedBy))?.name : undefined;
      throw new Error(`Order already approved${who ? ` by ${who}` : ''}. Change it at Verify picked.`);
    }
    const keep = lines.filter(l => l.qty !== 0);
    if (!keep.length) throw new Error('An order needs at least one item. Cancel the order instead');
    for (const l of keep) {
      if (!Number.isInteger(l.qty) || l.qty < 0) throw new Error('Qty must be whole pieces.');
      if (!(l.rate > 0)) throw new Error('Rate must be more than ₹0.');
      if (l.discountPct != null && (!Number.isFinite(l.discountPct) || l.discountPct < 0)) throw new Error('Disc % must be 0 or more.');
      if (l.discountPct != null && l.discountPct > 100) throw new Error("Discount can't be more than 100%");
    }
    // a new line (no number) gets the next number above every number this order ever had, so a removed number is never reused
    const used = Math.max(0, ...[...o.lines, ...(o.original ?? [])].map((l, i) => lineOf(l, i)));
    let next = used;
    const numbered = keep.map(l => (l.line != null ? l : { ...l, line: ++next }));
    const names = new Map((await db.products.toArray()).map(p => [p.id, p.name]));
    const what = changes(o.lines, numbered, id => names.get(id) ?? 'item');
    if (!what.length) return o;
    const shop = await db.shops.get(o.shopId);
    const issues = shop ? (await checkOrder(shop, numbered)).issues : o.issues;
    const cs = new ChangeSet();
    const at = nowIso(), by = session().userId;
    const saved = cs.put<Order>('orders', { ...o, lines: numbered, original: o.original ?? o.lines, issues, editedAt: at, editedBy: by, activity: [...(o.activity ?? []), ...what.map(w => ({ at, by, what: w }))].slice(-200) }, what.join('; '));
    await cs.commit('Order changed');
    return saved;
  } finally { editing.delete(orderId); }
}

/** what happened to this order, newest first: who changed what, when (kept on the order, so every phone sees it) */
export async function orderActivity(orderId: string): Promise<{ at: string; by: string; what: string }[]> {
  const o = await db.orders.get(orderId);
  const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
  return [...(o?.activity ?? [])].reverse().map(a => ({ ...a, by: staff.get(a.by) ?? a.by }));
}

const undoing = new Set<string>();
/** Undo an approval while the godown has not packed it yet: the order goes back to the owner */
export async function undoApprove(orderId: string): Promise<void> {
  if (undoing.has(orderId)) return;
  undoing.add(orderId);
  try {
    const o = await db.orders.get(orderId);
    if (!o) throw new Error('Order not found.');
    if (o.status === 'new' || o.status === 'needs_ok') return;
    if (o.status !== 'approved') throw new Error(o.status === 'cancelled' ? 'This order was already cancelled.' : 'The godown has already packed it. Change it at Verify picked.');
    const cs = new ChangeSet();
    cs.put<Order>('orders', { ...o, status: 'new', approvedBy: undefined, approvedAt: undefined, activity: [...(o.activity ?? []), { at: nowIso(), by: session().userId, what: 'approval undone' }] }, 'approval undone');
    await cs.commit('Approval undone');
  } finally { undoing.delete(orderId); }
}

/** Orders received as one Excel sheet: one row per line, then each order's total row (the same figures as the screen) */
export async function ordersSheet(orderIds: string[]): Promise<{ name: string; header: string[]; rows: (string | number)[][] }> {
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  const schemes = await db.schemes.toArray();
  const settings = await db.settings.toCollection().first();
  const header = ['Shop', 'No', 'Product', 'Unit', 'Qty', 'Rate', 'Disc %', 'GST %', 'Amount'];
  const rows: (string | number)[][] = [];
  for (const id of orderIds) {
    const o = await db.orders.get(id); if (!o) continue;
    const shop = await db.shops.get(o.shopId);
    const v = orderView(o.lines, products, schemes, shop && settings ? isInterState(shop, settings) : false);
    for (const r of v.rows) rows.push([shop?.name ?? '', r.line, r.product?.name ?? '', r.unit, r.qty, r.rate, r.discountPct, r.gst, r.amount]);
    rows.push([shop?.name ?? '', 'Total', `Taxable ${v.taxable.toFixed(2)}`, '', '', '', `Tax ${v.tax.toFixed(2)}`, `Round-off ${v.roundOff.toFixed(2)}`, v.total]);
  }
  return { name: 'Orders received', header, rows };
}
