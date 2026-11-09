import { useEffect, useState } from 'react';
import { ArrowLeft, Phone, MapPin, Receipt, IndianRupee, FileMinus, Printer } from 'lucide-react';
import { db, localDay } from '../core/db';
import { invoiceBalances, shopOutstanding } from '../core/ledger';
import { inr } from '../core/i18n';
import { PrintBill } from './PrintBill';
import type { CreditNote, Invoice, Payment, Shop } from '../core/types';

type Row = { at: string; kind: 'bill' | 'payment' | 'cn'; ref: string; debit: number; credit: number; note: string; inv?: Invoice };

// One page per shop, reachable from anywhere a shop name appears: dues, every bill, every payment, credit notes, running balance.
export function ShopStatement({ shopId, onBack }: { shopId: string; onBack: () => void }) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [due, setDue] = useState({ total: 0, overdue: 0, days: 0, advance: 0 });
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const [staff, setStaff] = useState<Map<string, string>>(new Map());
  useEffect(() => { (async () => {
    const s = await db.shops.get(shopId); setShop(s ?? null); if (!s) return;
    setStaff(new Map((await db.staff.toArray()).map(x => [x.id, x.name.split(' ')[0]])));
    const invs = (await db.invoices.where('shopId').equals(shopId).toArray()).filter(i => !i.cancelled);
    const pays = (await db.payments.where('shopId').equals(shopId).toArray()).filter(p => p.status === 'ok');
    const cns = await db.creditNotes.where('shopId').equals(shopId).toArray();
    const o = await shopOutstanding(shopId); const bal = (await invoiceBalances(shopId)).filter(b => b.balance > 0.5);
    setDue({ total: o.total, overdue: o.overdue, days: Math.max(0, ...bal.map(b => b.overdueDays)), advance: o.advance });
    const all: Row[] = [
      ...invs.map(i => ({ at: i.date + 'T' + (i.createdAt.slice(11) || '00:00:00'), kind: 'bill' as const, ref: i.number, debit: i.total, credit: 0, note: `${i.lines.length} ${'items'} · ${i.deliveryStatus}`, inv: i })),
      ...pays.map((p: Payment) => ({ at: p.date + 'T' + (p.createdAt.slice(11) || '00:00:00'), kind: 'payment' as const, ref: `${p.mode.toUpperCase()}${p.ref ? ' ' + p.ref : ''}`, debit: 0, credit: p.amount, note: `${'by'} ${p.collectedBy}` })),
      ...cns.map((c: CreditNote) => ({ at: c.date + 'T' + (c.createdAt.slice(11) || '00:00:00'), kind: 'cn' as const, ref: c.number, debit: 0, credit: c.total, note: c.reason })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    setRows(all);
  })(); }, [shopId]);
  if (!shop) return null;
  let running = due.total; // walk newest → oldest, showing the balance after each row
  return (
    <div className="stack">
      {printing && <PrintBill invoice={printing} onClose={() => setPrinting(null)} />}
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
      <div className="muted">{'Credit'}: {shop.creditLimit ? `${inr(shop.creditLimit)} / ${shop.creditDays}d` : 'cash only'}</div>
      <div className="list">
        {rows.map((r, i) => { const after = running; running = r.kind === 'bill' ? running - r.debit : running + r.credit; return (
          <button key={i} className="item tap" onClick={() => r.inv && setPrinting(r.inv)} disabled={!r.inv}>
            <div className={`avatar ${r.kind === 'payment' ? 'ok' : r.kind === 'cn' ? 'gold' : ''}`}>{r.kind === 'bill' ? <Receipt size={18} /> : r.kind === 'payment' ? <IndianRupee size={18} /> : <FileMinus size={18} />}</div>
            <div className="grow" style={{ textAlign: 'left' }}><div className="t">{r.ref}</div><div className="s">{localDay(r.at)} · {r.note.replace(/by (\w+)/, (_, id) => `${'by'} ${staff.get(id) ?? id}`)}</div></div>
            <div style={{ textAlign: 'right' }}><div className={`amt num`} style={{ color: r.kind === 'bill' ? undefined : 'var(--ok)' }}>{r.kind === 'bill' ? inr(r.debit) : `−${inr(r.credit)}`}</div><div className="s num">{'bal'} {inr(Math.max(0, after))}</div></div>
            {r.inv && <Printer size={16} style={{ color: 'var(--ink-3)' }} />}
          </button>); })}
        {!rows.length && <div className="card muted">{'No bills or payments yet.'}</div>}
      </div>
    </div>
  );
}
