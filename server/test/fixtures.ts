// Test bills shaped like the app's real ones: tax parts + round-off = total, and a number the server issued.
import type pg from 'pg';
const r2 = (n: number) => Math.round(n * 100) / 100;
export const fyNow = () => { const d = new Date(Date.now() + 330 * 60000); const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; };
/** a bill number as the server issues it (PREFIX/FY/00001) */
export const billNo = (n: number, prefix = 'DBX') => `${prefix}/${fyNow()}/${String(n).padStart(5, '0')}`;
/** the tests number their own bills: as if the server had issued this many already */
export const issueNumbers = (pool: pg.Pool, tenantId: string, prefix?: string) =>
  pool.query(`UPDATE tenants SET next_bill_no = GREATEST(next_bill_no, 100000), next_cn_no = GREATEST(next_cn_no, 100000), prefix = COALESCE($2, prefix) WHERE id=$1`, [tenantId, prefix ?? null]);
/** fill in a bill's tax parts from its lines (each line: taxable and total) so it adds up like a real one */
export function realBill<T extends Record<string, unknown>>(inv: T): T {
  const lines = ((inv.lines as Record<string, number>[] | undefined) ?? []).map(l => {
    const taxable = Number(l.taxable ?? 0), tax = r2(Number(l.total ?? taxable) - taxable);
    // a real bill line carries the stock lots its pieces came from (the server refuses a line without them)
    const lots = Array.isArray((l as Record<string, unknown>).batches) ? {} : { batches: [{ batchId: `lot-${String(l.productId ?? 'x')}`, batch: 'T1', qty: Number(l.qty ?? 0) + Number(l.freeQty ?? 0), expiry: '2099-12-31' }] };
    return { ...l, ...lots, taxable, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), igst: 0, total: r2(taxable + tax) };
  });
  const taxable = r2(lines.reduce((a, l) => a + l.taxable, 0)), cgst = r2(lines.reduce((a, l) => a + l.cgst, 0)), sgst = r2(lines.reduce((a, l) => a + l.sgst, 0));
  const exact = r2(taxable + cgst + sgst), total = Math.round(exact);
  return { ...inv, lines, taxable, cgst, sgst, igst: 0, roundOff: r2(total - exact), total };
}

/** a free local port for this test file's own Postgres (test files run side by side, and other working copies too) */
export async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref(); s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const a = s.address(); const p = typeof a === 'object' && a ? a.port : 0; s.close(() => resolve(p)); });
  });
}
