// Profit and loss for today or this month: the same numbers on the P&L screen and in TESRAX's answer.
import { db, localDay, today } from './db';
import { r2 } from './ledger';


export type PnlHead = { key: string; label: string; amount: number; items: { d: string; t: string; v: number }[] };
export interface Pnl { income: PnlHead[]; expense: PnlHead[]; cash: number; bank: number; staff: number }
const month = () => today().slice(0, 7);

export async function profitAndLoss(period: 'today' | 'month'): Promise<Pnl> {
  type Head = PnlHead;
    const from = period === 'today' ? today() : month();
    const inRange = (dt: string) => period === 'today' ? dt === from : dt.startsWith(from);
    const invs = (await db.invoices.toArray()).filter(i => !i.cancelled && inRange(i.date));
    const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
    const cos = new Map((await db.companies.toArray()).map(c => [c.id, c.name]));
    const shops = new Map((await db.shops.toArray()).map(s => [s.id, s.name]));
    const cns = (await db.creditNotes.toArray()).filter(c => inRange(c.date));
    const income: Head[] = [];
    // Sales by company (before tax)
    for (const [cid, name] of cos) { const ci = invs.filter(i => i.companyId === cid); if (!ci.length) continue; income.push({ key: 'sales-' + cid, label: `${'Sales'} · ${name}`, amount: r2(ci.reduce((a, i) => a + i.taxable, 0)), items: ci.map(i => ({ d: i.date, t: `${i.number} · ${shops.get(i.shopId) ?? ''}`, v: i.taxable })) }); }
    const other = invs.filter(i => !cos.has(i.companyId)); if (other.length) income.push({ key: 'sales-x', label: 'Sales · other', amount: r2(other.reduce((a, i) => a + i.taxable, 0)), items: other.map(i => ({ d: i.date, t: i.number, v: i.taxable })) });
    if (cns.length) income.push({ key: 'cn', label: 'Returns / credit notes', amount: -r2(cns.reduce((a, c) => a + c.total, 0)), items: cns.map(c => ({ d: c.date, t: `${c.number} · ${shops.get(c.shopId) ?? ''} · ${c.reason}`, v: -c.total })) });
    const claimsAll = (await db.claimEntries.toArray()).filter(c => inRange(localDay(c.createdAt)));
    const schemes = await db.schemes.toArray();
    const isOwn = (c: typeof claimsAll[0]) => c.kind === 'scheme' && schemes.some(s => s.source === 'own' && (s.productId === c.productId || !s.productId) && s.companyId === c.companyId);
    const coClaims = claimsAll.filter(c => c.kind === 'scheme' && !isOwn(c)); const ownDisc = claimsAll.filter(isOwn);
    if (coClaims.length) income.push({ key: 'claims', label: 'Company scheme claims', amount: r2(coClaims.reduce((a, c) => a + c.amount, 0)), items: coClaims.map(c => ({ d: localDay(c.createdAt), t: `${cos.get(c.companyId) ?? ''} · ${products.get(c.productId ?? '')?.name ?? c.kind}`, v: c.amount })) });
    const exps = (await db.expenses.toArray()).filter(e => inRange(e.date) && e.category !== 'advance');
    const incExp = exps.filter(e => e.category === 'income'); if (incExp.length) income.push({ key: 'other-income', label: 'Other income', amount: r2(incExp.reduce((a, e) => a + e.amount, 0)), items: incExp.map(e => ({ d: e.date, t: e.note ?? '', v: e.amount })) });
    const expense: Head[] = [];
    const cogsItems = invs.map(i => ({ d: i.date, t: i.number, v: r2(i.lines.reduce((b, l) => b + (l.qty + l.freeQty) * (products.get(l.productId)?.purchaseRate ?? 0), 0)) }));
    expense.push({ key: 'cogs', label: 'Cost of goods sold', amount: r2(cogsItems.reduce((a, x) => a + x.v, 0)), items: cogsItems });
    if (ownDisc.length) expense.push({ key: 'own', label: 'Own discounts given', amount: r2(ownDisc.reduce((a, c) => a + c.amount, 0)), items: ownDisc.map(c => ({ d: localDay(c.createdAt), t: products.get(c.productId ?? '')?.name ?? '', v: c.amount })) });
    const byCat = new Map<string, typeof exps>(); for (const e of exps) { if (e.category === 'income') continue; byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]); }
    for (const [k, list] of [...byCat.entries()].sort((a, b) => b[1].reduce((x, e) => x + e.amount, 0) - a[1].reduce((x, e) => x + e.amount, 0))) expense.push({ key: 'exp-' + k, label: k[0].toUpperCase() + k.slice(1), amount: r2(list.reduce((a, e) => a + e.amount, 0)), items: list.map(e => ({ d: e.date, t: e.note || k, v: e.amount })) });
    const pays = (await db.payments.toArray()).filter(p => p.status === 'ok');
    const bank = r2((await db.bankLines.toArray()).reduce((a, b) => a + b.credit - b.debit, 0));
    return { income, expense, cash: r2(pays.filter(p => p.mode === 'cash' && p.settled).reduce((a, p) => a + p.amount, 0) - exps.filter(e => e.approved).reduce((a, e) => a + e.amount, 0)), bank, staff: r2(pays.filter(p => p.mode === 'cash' && !p.settled).reduce((a, p) => a + p.amount, 0)) };
}

/** income − expenses, and profit as a share of income (whole percent) */
export function pnlTotals(d: Pnl) {
  const income = r2(d.income.reduce((a, h) => a + h.amount, 0)), expense = r2(d.expense.reduce((a, h) => a + h.amount, 0));
  const profit = r2(income - expense);
  return { income, expense, profit, pct: income ? Math.round(profit / income * 100) : 0 };
}
