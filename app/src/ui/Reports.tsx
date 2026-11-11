import { useEffect, useState } from 'react';
import { ArrowLeft, Download, TrendingUp, TrendingDown, Percent, PackageX, Store, Building2, Users, MapPin, Undo2, Gift, Zap, BookOpen, Wallet, IndianRupee } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { thisMonth } from '../core/db';
import { inr, plural } from '../core/i18n';
import { downloadWorkbook } from '../core/readers';
import { buildReports, period as periodOf, type PeriodKind, type ReportData } from '../core/reports';

type Report = ReportData & { icon: LucideIcon };
const ICONS: Record<string, LucideIcon> = { sales: IndianRupee, daybook: BookOpen, collections: Wallet, fast: TrendingUp, slow: TrendingDown, himargin: Percent, lomargin: Percent, dead: PackageX, shop: Store, company: Building2, salesman: Users, area: MapPin, returns: Undo2, scheme: Gift };

const month = () => thisMonth();

// One menu, every report the owner asked for; each is a table for the chosen period with Excel export (core/reports.ts).
export function Reports() {
  const [period, setPeriod] = useState<PeriodKind>('month');
  const [picked, setPicked] = useState(month());
  const [reports, setReports] = useState<Report[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const per = periodOf(period, picked);
  useEffect(() => { (async () => {
    setReports((await buildReports(per)).map(r => ({ ...r, icon: ICONS[r.key] ?? Zap })));
  })(); }, [period, picked]);

  const cur = reports.find(r => r.key === open);
  const exportAll = () => downloadWorkbook(`Hanubix-reports-${per.month ?? per.to}`, reports.map(r => ({ name: r.en, header: r.cols.map(c => c.h), rows: r.rows })));
  if (cur) return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'nowrap' }}><button className="icon-btn" onClick={() => setOpen(null)} aria-label="Back"><ArrowLeft /></button><div className="grow"><div className="h">{cur.en}</div><div className="muted">{per.label}</div></div><button className="btn small" onClick={() => downloadWorkbook(`Hanubix-${cur.key}-${per.month ?? per.to}`, [{ name: cur.en, header: cur.cols.map(c => c.h), rows: cur.rows }])}><Download size={16} /> Excel</button></div>
      {cur.note && <div className="muted">{cur.note}</div>}
      <table className="tbl"><thead><tr>{cur.cols.map((c, i) => <th key={i}>{c.h}</th>)}</tr></thead>
        <tbody>{cur.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j} className={cur.cols[j].num ? 'num' : ''}>{typeof v === 'number' && cur.cols[j].money ? inr(v) : v}</td>)}</tr>)}</tbody></table>
      {!cur.rows.length && <div className="card muted">{'Nothing in this period.'}</div>}
    </div>
  );
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="segmented" style={{ maxWidth: 320 }}><button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>{'This month'}</button><button className={period === 'last' ? 'on' : ''} onClick={() => setPeriod('last')}>{'Last month'}</button><button className={period === '90' ? 'on' : ''} onClick={() => setPeriod('90')}>{'90 days'}</button></div>
        <input type="month" aria-label="Pick a month" value={period === 'pick' ? picked : ''} max={month()} onChange={e => { if (e.target.value) { setPicked(e.target.value); setPeriod('pick'); } }} />
        <button className="btn small" onClick={exportAll}><Download size={16} /> {'All to Excel'}</button>
      </div>
      <div className="list">
        {reports.map(r => <button key={r.key} className="item tap" onClick={() => setOpen(r.key)}><div className="avatar"><r.icon size={18} /></div><div className="grow" style={{ textAlign: 'left' }}><div className="t">{r.en}</div><div className="s">{plural(r.rows.length, 'row')}</div></div></button>)}
      </div>
      <div className="muted"><Zap size={14} style={{ verticalAlign: -2 }} /> {'Or just ask TESRAX: "fast movers", "shop-wise sales", "dead stock".'}</div>
    </div>
  );
}
