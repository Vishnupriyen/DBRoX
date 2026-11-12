// A shop's statement (ledger): every bill, payment, credit note and old due, with the balance after each.
// One source for the Shop statement screen and the file TESRAX sends ("send Murugan Stores statement").
import { db, getSettings, today } from './db';
import { inr, localStamp, showDate } from './i18n';
import { invoiceBalances, openingAsBill, paymentCounts, r2, shopOutstanding } from './ledger';
import { downloadWorkbook } from './readers';
import type { CreditNote, Invoice, Payment, Shop } from './types';

export type StatementRow = { at: string; kind: 'bill' | 'payment' | 'cn'; ref: string; debit: number; credit: number; note: string; inv?: Invoice; cn?: CreditNote };
export interface StatementData { shop: Shop; rows: StatementRow[]; due: { total: number; overdue: number; days: number; advance: number }; staff: Map<string, string> }

/** newest first, as the screen shows it */
export async function shopStatement(shopId: string): Promise<StatementData | null> {
  const shop = await db.shops.get(shopId); if (!shop) return null;
  const staff = new Map((await db.staff.toArray()).map(x => [x.id, x.name.split(' ')[0]]));
  const invs = (await db.invoices.where('shopId').equals(shopId).toArray()).filter(i => !i.cancelled);
  const pays = (await db.payments.where('shopId').equals(shopId).toArray()).filter(p => p.status === 'ok' && paymentCounts(p)); // a post-dated cheque counts from its date
  const old = await db.openingDues.where('shopId').equals(shopId).toArray();
  const cns = await db.creditNotes.where('shopId').equals(shopId).toArray();
  const o = await shopOutstanding(shopId); const bal = (await invoiceBalances(shopId)).filter(b => b.balance > 0.5);
  const due = { total: o.total, overdue: o.overdue, days: Math.max(0, ...bal.map(b => b.overdueDays)), advance: o.advance };
  const rows: StatementRow[] = [
    ...invs.map(i => ({ at: i.date + 'T' + (localStamp(i.createdAt).slice(11) || '00:00:00'), kind: 'bill' as const, ref: i.number, debit: i.total, credit: 0, note: `${i.lines.length} items · ${i.deliveryStatus}`, inv: i })),
    ...pays.map((p: Payment) => ({ at: p.date + 'T' + (localStamp(p.createdAt).slice(11) || '00:00:00'), kind: 'payment' as const, ref: `${p.mode.toUpperCase()}${p.ref ? ' ' + p.ref : ''}`, debit: 0, credit: p.amount, note: `by ${staff.get(p.collectedBy) ?? p.collectedBy}` })),
    ...old.map(x => ({ at: x.date + 'T00:00:00', kind: 'bill' as const, ref: openingAsBill(x).number, debit: x.amount, credit: 0, note: 'opening balance' })),
    ...cns.map((c: CreditNote) => ({ at: c.date + 'T' + (localStamp(c.createdAt).slice(11) || '00:00:00'), kind: 'cn' as const, ref: c.number, debit: 0, credit: c.total, note: c.reason, cn: c })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return { shop, rows, due, staff };
}

/** the balance after each row (newest first), walking back from today's balance — the same figures the screen shows */
export function withBalance(d: StatementData) {
  let running = d.due.total;
  return d.rows.map(r => { const after = running; running = r.kind === 'bill' ? running - r.debit : running + r.credit; return { ...r, balance: r2(after) }; });
}

/** the statement as an Excel file, oldest first, for a period (default: everything) — opens the share sheet on a phone */
export async function sendStatement(shopId: string, from?: string, to?: string) {
  const d = await shopStatement(shopId); if (!d) throw new Error('Shop not found.');
  const firm = (await getSettings()).firmName;
  const all = withBalance(d).reverse(); // oldest first
  const inPer = (r: { at: string }) => (!from || r.at.slice(0, 10) >= from) && (!to || r.at.slice(0, 10) <= to);
  const before = all.filter(r => from && r.at.slice(0, 10) < from);
  const opening = before.length ? before[before.length - 1].balance : 0;
  const rows: (string | number)[][] = [];
  if (from) rows.push([showDate(from), 'Opening balance', '', '', '', opening, '']);
  for (const r of all.filter(inPer)) rows.push([showDate(r.at.slice(0, 10)), r.kind === 'bill' ? 'Bill' : r.kind === 'payment' ? 'Payment' : 'Credit note', r.ref, r.debit || '', r.credit || '', r.balance, r.note]);
  const closing = rows.length ? Number(rows[rows.length - 1][5]) : 0;
  rows.push(['', 'Balance due', '', '', '', closing, d.due.overdue > 0 ? `overdue ${inr(d.due.overdue)}` : '']);
  const title = `${firm} — statement of ${d.shop.name}${d.shop.area ? `, ${d.shop.area}` : ''}${from ? ` (${showDate(from)} to ${showDate(to ?? today())})` : ''}`;
  await downloadWorkbook(`Statement-${d.shop.name.replace(/[^\w]+/g, '-')}-${to ?? today()}`, [{ name: 'Statement', header: [title, '', '', '', '', '', ''], rows: [['Date', 'Type', 'Number', 'Debit ₹', 'Credit ₹', 'Balance ₹', 'Note'], ...rows] }]);
  return { rows: rows.length, closing };
}
