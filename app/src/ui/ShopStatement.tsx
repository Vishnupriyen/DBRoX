import { useEffect, useState } from 'react';
import { ArrowLeft, Phone, MapPin, Receipt, IndianRupee, FileMinus, Printer, Share2 } from 'lucide-react';
import { localDay } from '../core/db';
import { sendStatement, shopStatement, type StatementRow } from '../core/statement';
import { inr } from '../core/i18n';
import { PrintBill } from './PrintBill';
import type { CreditNote, Invoice, Shop } from '../core/types';

type Row = StatementRow;

// One page per shop, reachable from anywhere a shop name appears: dues, every bill, every payment, credit notes, running balance.
export function ShopStatement({ shopId, onBack }: { shopId: string; onBack: () => void }) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [due, setDue] = useState({ total: 0, overdue: 0, days: 0, advance: 0 });
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const [printingCn, setPrintingCn] = useState<CreditNote | null>(null);
  const [staff, setStaff] = useState<Map<string, string>>(new Map());
  useEffect(() => { (async () => {
    const d = await shopStatement(shopId); setShop(d?.shop ?? null); if (!d) return;
    setStaff(d.staff); setDue(d.due); setRows(d.rows);
  })(); }, [shopId]);
  if (!shop) return null;
  let running = due.total; // walk newest → oldest, showing the balance after each row
  return (
    <div className="stack">
      {printing && <PrintBill invoice={printing} onClose={() => setPrinting(null)} />}
      {printingCn && <PrintBill creditNote={printingCn} onClose={() => setPrintingCn(null)} />}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft /></button>
        {shop.photo ? <img src={shop.photo} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover' }} /> : <div className="avatar" style={{ width: 56, height: 56 }}>{shop.name[0]}</div>}
        <div className="grow"><div className="h">{shop.name}</div><div className="muted">{shop.owner ? shop.owner + ' · ' : ''}{shop.area}{shop.gstin ? ` · ${shop.gstin}` : ''}</div></div>
        {shop.phone && <a className="icon-btn" href={`tel:${shop.phone}`} aria-label="Call"><Phone /></a>}
        {shop.lat && <a className="icon-btn" href={`https://maps.google.com/?q=${shop.lat},${shop.lng}`} target="_blank" rel="noreferrer" aria-label="Map"><MapPin /></a>}
      </div>
      <div className="kpis">
        <div className="kpi navy"><div className="v" style={{ color: due.total > 0 ? undefined : '#7fe0ad' }}>{inr(Math.max(0, due.total))}</div><div className="l">{'balance due'}{due.advance > 0 ? ` · ${'advance'} ${inr(due.advance)}` : ''}</div></div>
        <div className="kpi"><div className="v" style={{ color: due.overdue > 0 ? 'var(--bad)' : undefined }}>{inr(due.overdue)}</div><div className="l">{'overdue'}{due.days ? ` · ${due.days}d` : ''}</div></div>
      </div>
      <div className="row"><div className="muted grow">{'Credit'}: {shop.creditLimit ? `${inr(shop.creditLimit)} / ${shop.creditDays}d` : 'cash only'}</div>{rows.length > 0 && <button className="btn small" onClick={() => sendStatement(shopId)}><Share2 size={16} /> Send statement</button>}</div>
      <div className="list">
        {rows.map((r, i) => { const after = running; running = r.kind === 'bill' ? running - r.debit : running + r.credit; return (
          <button key={i} className="item tap" onClick={() => r.inv ? setPrinting(r.inv) : r.cn && setPrintingCn(r.cn)} disabled={!r.inv && !r.cn}>
            <div className={`avatar ${r.kind === 'payment' ? 'ok' : r.kind === 'cn' ? 'gold' : ''}`}>{r.kind === 'bill' ? <Receipt size={18} /> : r.kind === 'payment' ? <IndianRupee size={18} /> : <FileMinus size={18} />}</div>
            <div className="grow" style={{ textAlign: 'left' }}><div className="t">{r.ref}</div><div className="s">{localDay(r.at)} · {r.note.replace(/by (\w+)/, (_, id) => `${'by'} ${staff.get(id) ?? id}`)}</div></div>
            <div style={{ textAlign: 'right' }}><div className={`amt num`} style={{ color: r.kind === 'bill' ? undefined : 'var(--ok)' }}>{r.kind === 'bill' ? inr(r.debit) : `−${inr(r.credit)}`}</div><div className="s num">{'bal'} {inr(Math.max(0, after))}</div></div>
            {(r.inv || r.cn) && <Printer size={16} style={{ color: 'var(--ink-3)' }} />}
          </button>); })}
        {!rows.length && <div className="card muted">{'No bills or payments yet.'}</div>}
      </div>
    </div>
  );
}
