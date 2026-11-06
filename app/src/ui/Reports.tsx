import { useEffect, useState } from 'react';
import { ArrowLeft, Download, TrendingUp, TrendingDown, Percent, PackageX, Store, Building2, Users, MapPin, Undo2, Gift, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { db } from '../core/db';
import { getLang, inr } from '../core/i18n';
import { r2 } from '../core/ledger';
import { downloadWorkbook } from '../core/readers';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);
type Col = { h: string; num?: boolean; money?: boolean };
type Report = { key: string; icon: LucideIcon; en: string; ta: string; cols: Col[]; rows: (string | number)[][]; note?: string };

const month = () => new Date().toISOString().slice(0, 7);

// One menu, every report the owner asked for; each is a table for the chosen period with Excel export.
export function Reports() {
  const [period, setPeriod] = useState<'month' | '90'>('month');
  const [reports, setReports] = useState<Report[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { (async () => {
    const since = period === 'month' ? month() + '-01' : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
    const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
    const cos = new Map((await db.companies.toArray()).map(c => [c.id, c.name]));
    const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
    const invs = (await db.invoices.toArray()).filter(i => !i.cancelled && i.date >= since);
    const cns = (await db.creditNotes.toArray()).filter(c => c.date >= since);
    const batches = (await db.batches.toArray()).filter(b => b.qty > 0);
    const orders = (await db.orders.toArray()).filter(o => o.date >= since);
    const bySalesmanOrder = new Map<string, string>(); for (const o of orders) if (o.salesmanId) bySalesmanOrder.set(o.id, o.salesmanId);

    // product movement
    const prod = new Map<string, { qty: number; free: number; sales: number; cost: number; bills: Set<string> }>();
    for (const i of invs) for (const l of i.lines) { const v = prod.get(l.productId) ?? { qty: 0, free: 0, sales: 0, cost: 0, bills: new Set() }; v.qty += l.qty; v.free += l.freeQty; v.sales += l.taxable; v.cost += (l.qty + l.freeQty) * (products.get(l.productId)?.purchaseRate ?? 0); v.bills.add(i.id); prod.set(l.productId, v); }
    const stockOf = (pid: string) => batches.filter(b => b.productId === pid).reduce((a, b) => a + b.qty, 0);
    const movers = [...products.values()].filter(p => p.active).map(p => { const v = prod.get(p.id); const stock = stockOf(p.id); return { p, qty: v?.qty ?? 0, sales: r2(v?.sales ?? 0), margin: v ? r2(v.sales - v.cost) : 0, pct: v && v.sales ? Math.round((v.sales - v.cost) / v.sales * 100) : 0, stock, bills: v?.bills.size ?? 0 }; });
    const lastSold = new Map<string, string>(); for (const i of (await db.invoices.toArray()).filter(i => !i.cancelled)) for (const l of i.lines) if ((lastSold.get(l.productId) ?? '') < i.date) lastSold.set(l.productId, i.date);

    // shop / company / salesman / area
    const group = <K,>(key: (i: typeof invs[0]) => K) => { const m = new Map<K, { sales: number; bills: number; cost: number }>(); for (const i of invs) { const k = key(i); const v = m.get(k) ?? { sales: 0, bills: 0, cost: 0 }; v.sales += i.taxable; v.bills++; v.cost += i.lines.reduce((a, l) => a + (l.qty + l.freeQty) * (products.get(l.productId)?.purchaseRate ?? 0), 0); m.set(k, v); } return [...m.entries()].sort((a, b) => b[1].sales - a[1].sales); };
    const fmt = (name: string, v: { sales: number; bills: number; cost: number }) => [name, v.bills, r2(v.sales), r2(v.sales - v.cost), v.sales ? Math.round((v.sales - v.cost) / v.sales * 100) + '%' : '—'];
    const gcols: Col[] = [{ h: '' }, { h: L('Bills', 'பில்'), num: true }, { h: L('Sales', 'விற்பனை'), num: true, money: true }, { h: L('Margin', 'லாபம்'), num: true, money: true }, { h: '%', num: true }];

    // scheme cost
    const sch = new Map<string, { bills: number; amount: number; free: number }>();
    for (const i of invs) for (const l of i.lines) for (const n of l.schemeNames) { const v = sch.get(n) ?? { bills: 0, amount: 0, free: 0 }; v.bills++; v.amount += l.discount; v.free += l.freeQty * l.rate; sch.set(n, v); }

    const r: Report[] = [
      { key: 'fast', icon: TrendingUp, en: 'Fast movers', ta: 'வேகமாக விற்பவை', cols: [{ h: L('Product', 'பொருள்') }, { h: L('Sold', 'விற்றது'), num: true }, { h: L('Bills', 'பில்'), num: true }, { h: L('Sales', 'விற்பனை'), num: true, money: true }, { h: L('Stock', 'ஸ்டாக்'), num: true }], rows: [...movers].sort((a, b) => b.qty - a.qty).slice(0, 30).map(m => [m.p.name, m.qty, m.bills, m.sales, m.stock]) },
      { key: 'slow', icon: TrendingDown, en: 'Slow movers', ta: 'மெதுவாக விற்பவை', cols: [{ h: L('Product', 'பொருள்') }, { h: L('Sold', 'விற்றது'), num: true }, { h: L('Stock', 'ஸ்டாக்'), num: true }, { h: L('Last sold', 'கடைசி விற்பனை') }], rows: [...movers].filter(m => m.stock > 0).sort((a, b) => a.qty - b.qty).slice(0, 30).map(m => [m.p.name, m.qty, m.stock, lastSold.get(m.p.id) ?? '—']) },
      { key: 'himargin', icon: Percent, en: 'High margin', ta: 'அதிக லாபம்', cols: [{ h: L('Product', 'பொருள்') }, { h: '%', num: true }, { h: L('Margin ₹', 'லாபம் ₹'), num: true, money: true }, { h: L('Sales', 'விற்பனை'), num: true, money: true }], rows: [...movers].filter(m => m.sales > 0).sort((a, b) => b.pct - a.pct).slice(0, 30).map(m => [m.p.name, m.pct + '%', m.margin, m.sales]) },
      { key: 'lomargin', icon: Percent, en: 'Low margin', ta: 'குறைந்த லாபம்', cols: [{ h: L('Product', 'பொருள்') }, { h: '%', num: true }, { h: L('Margin ₹', 'லாபம் ₹'), num: true, money: true }, { h: L('Sales', 'விற்பனை'), num: true, money: true }], rows: [...movers].filter(m => m.sales > 0).sort((a, b) => a.pct - b.pct).slice(0, 30).map(m => [m.p.name, m.pct + '%', m.margin, m.sales]), note: L('Below 5% — check the rate or the scheme.', '5%க்கு கீழ் — விலை / சலுகை சரிபார்க்க.') },
      { key: 'dead', icon: PackageX, en: 'Dead stock', ta: 'அசையாத ஸ்டாக்', cols: [{ h: L('Product', 'பொருள்') }, { h: L('Stock', 'ஸ்டாக்'), num: true }, { h: L('Value', 'மதிப்பு'), num: true, money: true }, { h: L('Last sold', 'கடைசி விற்பனை') }], rows: [...movers].filter(m => m.stock > 0 && m.qty === 0).sort((a, b) => b.stock * b.p.purchaseRate - a.stock * a.p.purchaseRate).map(m => [m.p.name, m.stock, r2(m.stock * m.p.purchaseRate), lastSold.get(m.p.id) ?? L('never', 'ஒருபோதும்')]), note: L('Stock with no sale in the period. Clear it from Ageing.', 'இந்த காலத்தில் விற்காத ஸ்டாக்.') },
      { key: 'shop', icon: Store, en: 'Shop-wise', ta: 'கடை வாரியாக', cols: [{ h: L('Shop', 'கடை') }, ...gcols.slice(1)], rows: group(i => i.shopId).map(([k, v]) => fmt(shops.get(k)?.name ?? k, v)) },
      { key: 'company', icon: Building2, en: 'Company-wise', ta: 'கம்பெனி வாரியாக', cols: [{ h: L('Company', 'கம்பெனி') }, ...gcols.slice(1)], rows: group(i => i.companyId).map(([k, v]) => fmt(cos.get(k) ?? k, v)) },
      { key: 'salesman', icon: Users, en: 'Salesman-wise', ta: 'சேல்ஸ்மேன் வாரியாக', cols: [{ h: L('Salesman', 'சேல்ஸ்மேன்') }, ...gcols.slice(1)], rows: group(i => (i.orderId && bySalesmanOrder.get(i.orderId)) || shops.get(i.shopId)?.salesmanId || '').map(([k, v]) => fmt(staff.get(k) ?? (k || L('Office', 'ஆபீஸ்')), v)) },
      { key: 'area', icon: MapPin, en: 'Area-wise', ta: 'ஏரியா வாரியாக', cols: [{ h: L('Area', 'ஏரியா') }, ...gcols.slice(1)], rows: group(i => shops.get(i.shopId)?.area ?? '').map(([k, v]) => fmt(k || '—', v)) },
      { key: 'returns', icon: Undo2, en: 'Returns', ta: 'திரும்பியவை', cols: [{ h: L('Date', 'தேதி') }, { h: L('Shop', 'கடை') }, { h: L('Reason', 'காரணம்') }, { h: '₹', num: true, money: true }], rows: cns.sort((a, b) => b.date.localeCompare(a.date)).map(c => [c.date.slice(5), shops.get(c.shopId)?.name ?? '', c.reason, c.total]), note: cns.length ? `${L('Total', 'மொத்தம்')} ${inr(r2(cns.reduce((a, c) => a + c.total, 0)))} · ${Math.round(cns.reduce((a, c) => a + c.total, 0) / Math.max(1, invs.reduce((a, i) => a + i.total, 0)) * 1000) / 10}% ${L('of sales', 'விற்பனையில்')}` : undefined },
      { key: 'scheme', icon: Gift, en: 'Scheme cost', ta: 'சலுகை செலவு', cols: [{ h: L('Scheme', 'சலுகை') }, { h: L('Lines', 'வரிகள்'), num: true }, { h: L('Discount', 'தள்ளுபடி'), num: true, money: true }, { h: L('Free goods', 'இலவசம்'), num: true, money: true }], rows: [...sch.entries()].sort((a, b) => b[1].amount + b[1].free - a[1].amount - a[1].free).map(([k, v]) => [k, v.bills, r2(v.amount), r2(v.free)]), note: L('Company schemes come back as claims; own schemes are your cost.', 'கம்பெனி சலுகை கிளைமில் திரும்பும்; சொந்த சலுகை உங்கள் செலவு.') },
    ];
    setReports(r);
  })(); }, [period]);

  const cur = reports.find(r => r.key === open);
  const exportAll = () => downloadWorkbook(`DBRoX-reports-${month()}`, reports.map(r => ({ name: r.en, header: r.cols.map(c => c.h), rows: r.rows })));
  if (cur) return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'nowrap' }}><button className="icon-btn" onClick={() => setOpen(null)} aria-label="Back"><ArrowLeft /></button><div className="grow"><div className="h">{L(cur.en, cur.ta)}</div><div className="muted">{period === 'month' ? L('This month', 'இந்த மாதம்') : L('Last 90 days', 'கடந்த 90 நாள்')}</div></div><button className="btn small" onClick={() => downloadWorkbook(`DBRoX-${cur.key}-${month()}`, [{ name: cur.en, header: cur.cols.map(c => c.h), rows: cur.rows }])}><Download size={16} /> Excel</button></div>
      {cur.note && <div className="muted">{cur.note}</div>}
      <table className="tbl"><thead><tr>{cur.cols.map((c, i) => <th key={i}>{c.h}</th>)}</tr></thead>
        <tbody>{cur.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j} className={cur.cols[j].num ? 'num' : ''}>{typeof v === 'number' && cur.cols[j].money ? inr(v) : v}</td>)}</tr>)}</tbody></table>
      {!cur.rows.length && <div className="card muted">{L('Nothing in this period.', 'இந்த காலத்தில் ஒன்றுமில்லை.')}</div>}
    </div>
  );
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="segmented" style={{ maxWidth: 260 }}><button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>{L('This month', 'இந்த மாதம்')}</button><button className={period === '90' ? 'on' : ''} onClick={() => setPeriod('90')}>{L('90 days', '90 நாள்')}</button></div>
        <button className="btn small" onClick={exportAll}><Download size={16} /> {L('All to Excel', 'எல்லாம் Excel')}</button>
      </div>
      <div className="list">
        {reports.map(r => <button key={r.key} className="item tap" onClick={() => setOpen(r.key)}><div className="avatar"><r.icon size={18} /></div><div className="grow" style={{ textAlign: 'left' }}><div className="t">{L(r.en, r.ta)}</div><div className="s">{r.rows.length} {L('rows', 'வரிகள்')}</div></div></button>)}
      </div>
      <div className="muted"><Zap size={14} style={{ verticalAlign: -2 }} /> {L('Or just ask RoX: "fast movers", "shop-wise sales", "dead stock".', 'RoX-இடம் கேளுங்கள்: "fast movers", "dead stock".')}</div>
    </div>
  );
}
