// A leaf module (no imports): the guard in db.ts and billing both use this rule.
// ---------- one rule for a bill line's stock lots (every path that makes or changes a bill line) ----------
type LotLine = { productId?: string; name?: string; qty: number; freeQty?: number; batches?: { batchId?: string; qty: number }[] };
const chargedKey = (lines: LotLine[]) => JSON.stringify(lines.map(l => [l.productId, l.qty, l.freeQty ?? 0]).sort());
/**
 * Why a bill's lines break the lot rule, or null. Every line carries its stock lots (each a real lot id, whole pieces 0 or
 * more). When the pieces a bill charges are set — a new bill, or an edit that changes what it charges — the lots hold
 * exactly the charged + free pieces: a bill never charges a piece that did not come out of a lot. After that (delivery,
 * returns) the lots follow the goods, so only the first part is checked. The server holds the same first part.
 */
export function billLotsProblem(lines: LotLine[], before?: LotLine[]): string | null {
  for (const l of lines) {
    if (!Array.isArray(l.batches)) return `A bill line (${l.name ?? 'an item'}) has no stock lots.`;
    if (l.batches.some(b => !b || typeof b.batchId !== 'string' || !b.batchId)) return `A bill line (${l.name ?? 'an item'}) has a stock lot without its batch.`;
    if (l.batches.some(b => !Number.isInteger(b.qty) || b.qty < 0)) return 'A bill line has an invalid batch quantity.';
  }
  const setNow = !before || chargedKey(lines) !== chargedKey(before);
  if (setNow) for (const l of lines) if (l.batches!.reduce((a, b) => a + b.qty, 0) !== l.qty + (l.freeQty ?? 0)) return `Not enough stock for ${l.name ?? 'an item'} on this bill. A bill can only charge for pieces that are in stock.`;
  return null;
}

