// Line numbers (Part 2, step 2a0 — docs/PART2_SYSTEMS.md). An order line's `line` is a stable id 1, 2, 3… (never reused, never
// an array index): a picked row points at the order line it packs, so the same product can sit on two lines. A delivery
// shortage's `line` is the index of the bill line (the same meaning as CreditNoteLine.line). Records saved before this
// version carry no numbers: every match goes through these helpers, so they work without a migration.
import type { Invoice, Order, OrderLine } from './types';

/** an order line's number: the stored one, else its position + 1 (an old order) */
export const lineOf = (l: { line?: number }, i: number) => l.line ?? i + 1;

/** gives every line without a number one: 1..n when none has one, else the next number above the highest (never reused) */
export function numberLines<T extends { line?: number }>(lines: T[]): (T & { line: number })[] {
  if (lines.every(l => l.line != null)) return lines as (T & { line: number })[];
  if (lines.every(l => l.line == null)) return lines.map((l, i) => ({ ...l, line: i + 1 }));
  let next = Math.max(lines.length, ...lines.map(l => l.line ?? 0));
  return lines.map(l => (l.line != null ? l : { ...l, line: ++next })) as (T & { line: number })[];
}

/** the order line a picked row packs: by its number, else (an old row) the first line of that product */
export function orderLineFor(o: Pick<Order, 'lines'>, row: { productId: string; line?: number }): (OrderLine & { line: number }) | undefined {
  const at = row.line != null ? o.lines.findIndex((l, i) => lineOf(l, i) === row.line) : -1;
  const i = at >= 0 ? at : o.lines.findIndex(l => l.productId === row.productId);
  return i >= 0 ? { ...o.lines[i], line: lineOf(o.lines[i], i) } : undefined;
}

/** what was packed, each row with the order line it belongs to. Old rows without a number: when a product has as many
 *  rows as order lines they pair up in order; otherwise (two MRP rows of one line) they all belong to its first line.
 *  An order never packed = its own lines as ordered. */
export function pickedLines(o: Pick<Order, 'lines' | 'picked'>): (NonNullable<Order['picked']>[number] & { line: number })[] {
  if (!o.picked) return o.lines.map((l, i) => ({ productId: l.productId, qty: l.qty, line: lineOf(l, i), ...(l.batchId ? { batchId: l.batchId } : {}), ...(l.mrp != null ? { mrp: l.mrp } : {}) }));
  const seen = new Map<string, number>();
  return o.picked.map(r => {
    if (r.line != null) return { ...r, line: r.line };
    const mine = o.lines.map((l, i) => ({ l, n: lineOf(l, i) })).filter(x => x.l.productId === r.productId);
    const rows = o.picked!.filter(x => x.productId === r.productId && x.line == null).length;
    const k = seen.get(r.productId) ?? 0; seen.set(r.productId, k + 1);
    const hit = mine.length === rows ? mine[k] : mine[0];
    return { ...r, line: hit?.n ?? 0 };
  });
}

/** the bill line (index) each delivery shortage is on: its own `line`, else the first line of that product not used yet */
export function shortageLines(inv: Pick<Invoice, 'lines' | 'delivery'>): number[] {
  const used = new Set<number>();
  const sh = inv.delivery?.shortages ?? [];
  for (const x of sh) if (x.line != null) used.add(x.line);
  return sh.map(x => {
    if (x.line != null) return x.line;
    const i = inv.lines.findIndex((l, k) => l.productId === x.productId && !used.has(k));
    const at = i >= 0 ? i : inv.lines.findIndex(l => l.productId === x.productId);
    used.add(at);
    return at;
  });
}
