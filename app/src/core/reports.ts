// The owner's reports (BA TRUST17) for any period: this month, last month, any month, the last 90 days, or any dates.
// Sales are NET of credit notes (a return takes its value back out of the shop, company, salesman and area it came from),
// and the month's net sales are the same number the GST screen and GSTR-1 show. Plain code: every figure adds up.
import { db, daysFrom, monthEnd, thisMonth, today } from './db';
import { inr, showDate, showMonth } from './i18n';
import { r2 } from './ledger';
import { cnTaxLines } from './gst';
import type { CreditNote, Invoice } from './types';

export type PeriodKind = 'month' | 'last' | 'pick' | '90';
export interface Period { from: string; to: string; label: string; month?: string }
export const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
export function period(kind: PeriodKind, picked?: string): Period {
  if (kind === '90') return { from: daysFrom(-90), to: today(), label: 'Last 90 days' };
  const m = kind === 'last' ? prevMonth(thisMonth()) : kind === 'pick' && picked && /^\d{4}-\d{2}$/.test(picked) ? picked : thisMonth();
  return { from: `${m}-01`, to: monthEnd(m), label: kind === 'month' ? 'This month' : showMonth(m), month: m };
}
const within = (d: string, p: Pick<Period, 'from' | 'to'>) => d >= p.from && d <= p.to;

/** a credit note's own taxable value and tax (from its tax lines; old notes read the old way) */
export function cnValue(c: CreditNote, inv?: Invoice) {
  const rows = cnTaxLines(c, inv);
  const taxable = r2(rows.reduce((a, r) => a + r.taxable, 0)), cgst = r2(rows.reduce((a, r) => a + r.cgst, 0)), sgst = r2(rows.reduce((a, r) => a + r.sgst, 0)), igst = r2(rows.reduce((a, r) => a + r.igst, 0));
  return { taxable, cgst, sgst, igst, total: c.total };
}

/** sales for the period: bills, less credit notes dated in it — the GST screen's month figure is this, for the month */
export async function salesSummary(p: Pick<Period, 'from' | 'to'>) {
  const all = await db.invoices.toArray();
  const byId = new Map(all.map(i => [i.id, i]));
  const bills = all.filter(i => !i.cancelled && within(i.date, p));
  const cns = (await db.creditNotes.toArray()).filter(c => within(c.date, p));
  const sum = (xs: { taxable: number; cgst: number; sgst: number; igst: number; total: number }[]) => ({
    taxable: r2(xs.reduce((a, x) => a + x.taxable, 0)), cgst: r2(xs.reduce((a, x) => a + x.cgst, 0)), sgst: r2(xs.reduce((a, x) => a + x.sgst, 0)),
    igst: r2(xs.reduce((a, x) => a + x.igst, 0)), total: r2(xs.reduce((a, x) => a + x.total, 0)),
  });
  const billed = sum(bills), credited = sum(cns.map(c => cnValue(c, byId.get(c.invoiceId))));
  const net = { taxable: r2(billed.taxable - credited.taxable), cgst: r2(billed.cgst - credited.cgst), sgst: r2(billed.sgst - credited.sgst), igst: r2(billed.igst - credited.igst), total: r2(billed.total - credited.total) };
  return { bills: bills.length, notes: cns.length, billed, credited, net, tax: r2(net.cgst + net.sgst + net.igst) };
}

/** the day book: every bill and credit note, bill-wise with GST, in date and number order (cancelled bills shown at ₹0) */
export async function dayBook(p: Pick<Period, 'from' | 'to'>) {
  const all = await db.invoices.toArray();
  const byId = new Map(all.map(i => [i.id, i]));
  const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
  type R = { date: string; kind: string; number: string; shop: string; gstin: string; taxable: number; cgst: number; sgst: number; igst: number; total: number; against: string };
  const rows: R[] = [];
  for (const i of all.filter(x => within(x.date, p))) {
    const s = shops.get(i.shopId);
    rows.push(i.cancelled
      ? { date: i.date, kind: 'Bill (cancelled)', number: i.number, shop: s?.name ?? '', gstin: s?.gstin ?? '', taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, against: i.cancelled.reason }
      : { date: i.date, kind: 'Bill', number: i.number, shop: s?.name ?? '', gstin: s?.gstin ?? '', taxable: i.taxable, cgst: i.cgst, sgst: i.sgst, igst: i.igst, total: i.total, against: '' });
  }
  for (const c of (await db.creditNotes.toArray()).filter(x => within(x.date, p))) {
    const v = cnValue(c, byId.get(c.invoiceId)); const s = shops.get(c.shopId);
    rows.push({ date: c.date, kind: 'Credit note', number: c.number, shop: s?.name ?? '', gstin: s?.gstin ?? '', taxable: -v.taxable, cgst: -v.cgst, sgst: -v.sgst, igst: -v.igst, total: -v.total, against: c.invoiceNumber ?? byId.get(c.invoiceId)?.number ?? '' });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.number.localeCompare(b.number));
  const total = { taxable: r2(rows.reduce((a, r) => a + r.taxable, 0)), cgst: r2(rows.reduce((a, r) => a + r.cgst, 0)), sgst: r2(rows.reduce((a, r) => a + r.sgst, 0)), igst: r2(rows.reduce((a, r) => a + r.igst, 0)), total: r2(rows.reduce((a, r) => a + r.total, 0)) };
  return { rows, total };
}

/** money collected, by person and by day, split by how it came (a bounced or cancelled one is not counted) */
export async function collectionsByPerson(p: Pick<Period, 'from' | 'to'>) {
  const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
  const pays = (await db.payments.toArray()).filter(x => within(x.date, p) && x.status !== 'cancelled' && x.status !== 'bounced');
  const by = new Map<string, { date: string; person: string; cash: number; upi: number; cheque: number; bank: number; total: number; n: number }>();
  for (const x of pays) {
    const person = x.collectedBy === 'bank' ? 'Bank statement' : staff.get(x.collectedBy) ?? x.collectedBy;
    const k = `${x.date}|${person}`;
    const v = by.get(k) ?? { date: x.date, person, cash: 0, upi: 0, cheque: 0, bank: 0, total: 0, n: 0 };
    v[x.mode] = r2(v[x.mode] + x.amount); v.total = r2(v.total + x.amount); v.n++;
    by.set(k, v);
  }
  const rows = [...by.values()].sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person));
  return { rows, total: r2(rows.reduce((a, r) => a + r.total, 0)) };
}

// ---------------------------------------------------------------- the report menu (tables the screen shows and exports)
export type ReportCol = { h: string; num?: boolean; money?: boolean };
export interface ReportData { key: string; en: string; cols: ReportCol[]; rows: (string | number)[][]; note?: string }

export async function buildReports(p: Pick<Period, 'from' | 'to'>): Promise<ReportData[]> {
  const since = p.from;
  const products = new Map((await db.products.toArray()).map(x => [x.id, x]));
  const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
  const cos = new Map((await db.companies.toArray()).map(c => [c.id, c.name]));
  const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
  const allInv = await db.invoices.toArray();
  const invById = new Map(allInv.map(i => [i.id, i]));
  const invs = allInv.filter(i => !i.cancelled && within(i.date, p));
  const cns = (await db.creditNotes.toArray()).filter(c => within(c.date, p));
  const batches = (await db.batches.toArray()).filter(b => b.qty > 0);
  const orders = (await db.orders.toArray()).filter(o => o.date >= since);
  const salesmanOf = new Map<string, string>(); for (const o of await db.orders.toArray()) if (o.salesmanId) salesmanOf.set(o.id, o.salesmanId);
  const cost = (pid: string) => { const r = products.get(pid)?.purchaseRate; return typeof r === 'number' && Number.isFinite(r) ? r : 0; };
  void orders;

  // product movement: pieces and sales net of returned pieces
  const prod = new Map<string, { qty: number; free: number; sales: number; cost: number; bills: Set<string> }>();
  const pv = (pid: string) => prod.get(pid) ?? (prod.set(pid, { qty: 0, free: 0, sales: 0, cost: 0, bills: new Set() }), prod.get(pid)!);
  for (const i of invs) for (const l of i.lines) { const v = pv(l.productId); v.qty += l.qty; v.free += l.freeQty; v.sales += l.taxable; v.cost += (l.qty + l.freeQty) * cost(l.productId); v.bills.add(i.id); }
  for (const c of cns) for (const cl of c.lines) {
    const v = pv(cl.productId); const pcs = cl.qty + (cl.freeQty ?? 0);
    const taxable = cl.taxable ?? r2(cl.amount / (1 + (cl.gst ?? products.get(cl.productId)?.gst ?? 0) / 100));
    v.qty -= cl.qty; v.free -= cl.freeQty ?? 0; v.sales -= taxable; v.cost -= pcs * cost(cl.productId);
  }
  const stockOf = (pid: string) => batches.filter(b => b.productId === pid).reduce((a, b) => a + b.qty, 0);
  const movers = [...products.values()].filter(x => x.active).map(x => { const v = prod.get(x.id); const stock = stockOf(x.id); const sales = r2(v?.sales ?? 0); const margin = v ? r2(v.sales - v.cost) : 0; return { p: x, qty: v?.qty ?? 0, sales, margin, pct: sales ? Math.round(margin / sales * 100) : 0, stock, bills: v?.bills.size ?? 0 }; });
  const lastSold = new Map<string, string>(); for (const i of allInv.filter(x => !x.cancelled)) for (const l of i.lines) if ((lastSold.get(l.productId) ?? '') < i.date) lastSold.set(l.productId, i.date);

  // shop / company / salesman / area: bills less their credit notes (the note goes where its bill went)
  const salesmanKey = (i: Invoice) => (i.orderId && salesmanOf.get(i.orderId)) || shops.get(i.shopId)?.salesmanId || '';
  const group = <K,>(key: (i: Invoice) => K) => {
    const m = new Map<K, { sales: number; bills: number; cost: number }>();
    const at = (k: K) => m.get(k) ?? (m.set(k, { sales: 0, bills: 0, cost: 0 }), m.get(k)!);
    for (const i of invs) { const v = at(key(i)); v.sales += i.taxable; v.bills++; v.cost += i.lines.reduce((a, l) => a + (l.qty + l.freeQty) * cost(l.productId), 0); }
    for (const c of cns) {
      const bill = invById.get(c.invoiceId) ?? ({ shopId: c.shopId, companyId: c.companyId } as Invoice);
      const v = at(key(bill)); v.sales -= cnValue(c, invById.get(c.invoiceId)).taxable;
      v.cost -= c.lines.reduce((a, l) => a + (l.qty + (l.freeQty ?? 0)) * cost(l.productId), 0);
    }
    return [...m.entries()].sort((a, b) => b[1].sales - a[1].sales);
  };
  const fmt = (name: string, v: { sales: number; bills: number; cost: number }) => [name, v.bills, r2(v.sales), r2(v.sales - v.cost), v.sales ? Math.round((v.sales - v.cost) / v.sales * 100) + '%' : '—'];
  const gcols: ReportCol[] = [{ h: '' }, { h: 'Bills', num: true }, { h: 'Net sales', num: true, money: true }, { h: 'Margin', num: true, money: true }, { h: '%', num: true }];

  const sch = new Map<string, { bills: number; amount: number; free: number }>();
  for (const i of invs) for (const l of i.lines) for (const n of l.schemeNames) { const v = sch.get(n) ?? { bills: 0, amount: 0, free: 0 }; v.bills++; v.amount += l.discount; v.free += l.freeQty * l.rate; sch.set(n, v); }

  const sum = await salesSummary(p);
  const book = await dayBook(p);
  const coll = await collectionsByPerson(p);
  return [
    { key: 'sales', en: 'Sales (net of credit notes)', cols: [{ h: '' }, { h: 'Taxable', num: true, money: true }, { h: 'GST', num: true, money: true }, { h: 'Total', num: true, money: true }],
      rows: [['Bills', sum.billed.taxable, r2(sum.billed.cgst + sum.billed.sgst + sum.billed.igst), sum.billed.total], ['Less credit notes', -sum.credited.taxable, -r2(sum.credited.cgst + sum.credited.sgst + sum.credited.igst), -sum.credited.total], ['Net sales', sum.net.taxable, sum.tax, sum.net.total]],
      note: `${sum.bills} bills, ${sum.notes} credit notes. For a month this is the same figure as the GST screen and GSTR-1.` },
    { key: 'daybook', en: 'Day book (bill-wise with GST)', cols: [{ h: 'Date' }, { h: 'Type' }, { h: 'Number' }, { h: 'Shop' }, { h: 'GSTIN' }, { h: 'Taxable', num: true, money: true }, { h: 'CGST', num: true, money: true }, { h: 'SGST', num: true, money: true }, { h: 'IGST', num: true, money: true }, { h: 'Total', num: true, money: true }, { h: 'Against / why' }],
      rows: book.rows.map(r => [showDate(r.date), r.kind, r.number, r.shop, r.gstin, r.taxable, r.cgst, r.sgst, r.igst, r.total, r.against]),
      note: `Total ${inr(book.total.total)} · taxable ${inr(book.total.taxable)} · GST ${inr(r2(book.total.cgst + book.total.sgst + book.total.igst))}` },
    { key: 'collections', en: 'Collections by person and day', cols: [{ h: 'Date' }, { h: 'Person' }, { h: 'Cash', num: true, money: true }, { h: 'UPI', num: true, money: true }, { h: 'Cheque', num: true, money: true }, { h: 'Bank', num: true, money: true }, { h: 'Total', num: true, money: true }],
      rows: coll.rows.map(r => [showDate(r.date), r.person, r.cash, r.upi, r.cheque, r.bank, r.total]), note: `Total ${inr(coll.total)} (bounced and cancelled not counted)` },
    { key: 'fast', en: 'Fast movers', cols: [{ h: 'Product' }, { h: 'Sold', num: true }, { h: 'Bills', num: true }, { h: 'Net sales', num: true, money: true }, { h: 'Stock', num: true }], rows: [...movers].sort((a, b) => b.qty - a.qty).slice(0, 30).map(m => [m.p.name, m.qty, m.bills, m.sales, m.stock]) },
    { key: 'slow', en: 'Slow movers', cols: [{ h: 'Product' }, { h: 'Sold', num: true }, { h: 'Stock', num: true }, { h: 'Last sold' }], rows: [...movers].filter(m => m.stock > 0).sort((a, b) => a.qty - b.qty).slice(0, 30).map(m => [m.p.name, m.qty, m.stock, lastSold.get(m.p.id) ?? '—']) },
    { key: 'himargin', en: 'High margin', cols: [{ h: 'Product' }, { h: '%', num: true }, { h: 'Margin ₹', num: true, money: true }, { h: 'Net sales', num: true, money: true }], rows: [...movers].filter(m => m.sales > 0).sort((a, b) => b.pct - a.pct).slice(0, 30).map(m => [m.p.name, m.pct + '%', m.margin, m.sales]) },
    { key: 'lomargin', en: 'Low margin', cols: [{ h: 'Product' }, { h: '%', num: true }, { h: 'Margin ₹', num: true, money: true }, { h: 'Net sales', num: true, money: true }], rows: [...movers].filter(m => m.sales > 0).sort((a, b) => a.pct - b.pct).slice(0, 30).map(m => [m.p.name, m.pct + '%', m.margin, m.sales]), note: 'Below 5% — check the rate or the scheme.' },
    { key: 'dead', en: 'Dead stock', cols: [{ h: 'Product' }, { h: 'Stock', num: true }, { h: 'Value', num: true, money: true }, { h: 'Last sold' }], rows: [...movers].filter(m => m.stock > 0 && m.qty === 0).sort((a, b) => b.stock * cost(b.p.id) - a.stock * cost(a.p.id)).map(m => [m.p.name, m.stock, r2(m.stock * cost(m.p.id)), lastSold.get(m.p.id) ?? 'never']), note: 'Stock with no sale in the period. Clear it from Ageing.' },
    { key: 'shop', en: 'Shop-wise', cols: [{ h: 'Shop' }, ...gcols.slice(1)], rows: group(i => i.shopId).map(([k, v]) => fmt(shops.get(k)?.name ?? k, v)) },
    { key: 'company', en: 'Company-wise', cols: [{ h: 'Company' }, ...gcols.slice(1)], rows: group(i => i.companyId).map(([k, v]) => fmt(cos.get(k) ?? k, v)) },
    { key: 'salesman', en: 'Salesman-wise', cols: [{ h: 'Salesman' }, ...gcols.slice(1)], rows: group(salesmanKey).map(([k, v]) => fmt(staff.get(k) ?? (k || 'Office'), v)) },
    { key: 'area', en: 'Area-wise', cols: [{ h: 'Area' }, ...gcols.slice(1)], rows: group(i => shops.get(i.shopId)?.area ?? '').map(([k, v]) => fmt(k || '—', v)) },
    { key: 'returns', en: 'Returns', cols: [{ h: 'Date' }, { h: 'Shop' }, { h: 'Reason' }, { h: '₹', num: true, money: true }], rows: [...cns].sort((a, b) => b.date.localeCompare(a.date)).map(c => [showDate(c.date), shops.get(c.shopId)?.name ?? '', c.reason, c.total]), note: cns.length ? `Total ${inr(sum.credited.total)} · ${Math.round(sum.credited.total / Math.max(1, sum.billed.total) * 1000) / 10}% of sales` : undefined },
    { key: 'scheme', en: 'Scheme cost', cols: [{ h: 'Scheme' }, { h: 'Lines', num: true }, { h: 'Discount', num: true, money: true }, { h: 'Free goods', num: true, money: true }], rows: [...sch.entries()].sort((a, b) => b[1].amount + b[1].free - a[1].amount - a[1].free).map(([k, v]) => [k, v.bills, r2(v.amount), r2(v.free)]), note: 'Company schemes come back as claims; own schemes are your cost.' },
  ];
}
