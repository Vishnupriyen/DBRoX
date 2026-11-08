import { useEffect, useState } from 'react';
import { Check, QrCode, AlertTriangle } from 'lucide-react';
import QRCode from 'qrcode';
import { ChangeSet, getSettings, session, today } from '../core/db';
import { invoiceBalances, r2 } from '../core/ledger';
import { inr, t } from '../core/i18n';
import { PhotoButton } from './PhotoButton';
import type { Payment, Shop } from '../core/types';


// One collection box for driver and salesman: bill(s) first, then amount, then mode (UPI shows the QR → photo), shop ✓.
// Excess over the chosen bills is carried to the shop's next bill; a short payment alerts the owner (status in the ledger).
export function PayBox({ shop, preferInvoiceIds = [], onDone, onSkip }: { shop: Shop; preferInvoiceIds?: string[]; onDone: () => void; onSkip?: () => void }) {
  const [bills, setBills] = useState<{ id: string; number: string; date: string; balance: number }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set(preferInvoiceIds));
  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<Payment['mode']>('cash');
  const [ref, setRef] = useState('');
  const [photo, setPhoto] = useState<string>();
  const [qr, setQr] = useState<string>();
  const [showQr, setShowQr] = useState(false);
  useEffect(() => { invoiceBalances(shop.id).then(bs => { const list = bs.filter(b => b.balance > 0.5).sort((a, b) => a.invoice.date.localeCompare(b.invoice.date)).map(b => ({ id: b.invoice.id, number: b.invoice.number, date: b.invoice.date, balance: b.balance })); setBills(list); if (!preferInvoiceIds.length && list.length) setSel(new Set([list[0].id])); }); }, [shop.id]);
  useEffect(() => { (async () => { const s = await getSettings(); if (!s.upiId) { setQr(undefined); return; } setQr(await QRCode.toDataURL(`upi://pay?pa=${s.upiId}&pn=${encodeURIComponent(s.firmName)}&am=${amount || ''}&cu=INR`, { width: 480, margin: 1 })); })(); }, [amount]);

  const chosen = bills.filter(b => sel.has(b.id));
  const due = r2(chosen.reduce((a, b) => a + b.balance, 0));
  const excess = r2(Math.max(0, amount - due));
  const shortBy = r2(Math.max(0, due - amount));
  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); if (!amount) setAmount(0); return n; });
  const canSave = chosen.length > 0 && amount > 0 && (mode === 'cash' || ref.length >= 4 || !!photo);

  const save = async () => {
    // allocate to the chosen bills oldest first; anything left is advance (carried to the next bill automatically)
    let left = amount; const allocations: { invoiceId: string; amount: number }[] = [];
    for (const b of chosen) { if (left <= 0) break; const a = Math.min(b.balance, left); allocations.push({ invoiceId: b.id, amount: r2(a) }); left = r2(left - a); }
    const cs = new ChangeSet();
    cs.put<Payment>('payments', { shopId: shop.id, amount, mode, ref, date: today(), collectedBy: session().userId, shopConfirmed: true, confirmPhoto: photo, allocations, advance: r2(left), settled: false, status: 'ok' }, shortBy > 0 ? `collection (short by ${shortBy})` : 'collection');
    await cs.commit('Collection'); onDone();
  };

  return (
    <div className="card stack">
      <div className="eyebrow">{'1. Which bill(s)?'}</div>
      <div className="list">
        {bills.map(b => <button key={b.id} className="item tap" onClick={() => toggle(b.id)}><div className={`avatar ${sel.has(b.id) ? 'ok' : ''}`}>{sel.has(b.id) ? <Check /> : <span style={{ fontSize: 13 }}>{b.date.slice(8)}/{b.date.slice(5, 7)}</span>}</div><div className="grow"><div className="t">{b.number}</div><div className="s">{b.date}</div></div><span className="amt num">{inr(b.balance)}</span></button>)}
        {!bills.length && <div className="muted">{'No bills pending for this shop.'}</div>}
      </div>
      {chosen.length > 0 && <>
        <div className="eyebrow">{'2. Amount'} · {'due'} {inr(due)}</div>
        <div className="row" style={{ gap: 6 }}><button className="btn small" onClick={() => setAmount(due)}>{'Full'} {inr(due)}</button></div>
        <input className="bigamount" type="number" inputMode="decimal" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} aria-label={t('amount')} />
        {excess > 0 && <div className="alert ok"><Check /><div>{inr(excess)} {'extra — carried to the next bill automatically'}</div></div>}
        {shortBy > 0 && amount > 0 && <div className="alert"><AlertTriangle /><div>{'Short by'} {inr(shortBy)} — {'bill stays open; owner is told'}</div></div>}
        <div className="eyebrow">{'3. How'}</div>
        <div className="segmented">{(['cash', 'upi', 'cheque'] as const).map(m => <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setShowQr(m === 'upi'); }}>{t(m)}</button>)}</div>
        {mode === 'upi' && <>
          {showQr && qr && <div className="qr"><img src={qr} alt="UPI QR" /><div className="muted" style={{ marginTop: 6 }}>{'Shop scans this'}{amount ? ` · ${inr(amount)}` : ''}</div></div>}
          {!showQr && qr && <button className="btn" onClick={() => setShowQr(true)}><QrCode /> {'Show QR'}</button>}
          {!qr && <div className="alert"><AlertTriangle /><div>{'Owner has not set the UPI ID yet (More → Settings). Shop can pay to the usual number.'}</div></div>}
          <div className="field"><label>{'UPI ref (last 4 digits)'}</label><input value={ref} onChange={e => setRef(e.target.value)} /></div>
          <PhotoButton facing="environment" onPhoto={setPhoto} label={'Photo of payment screen'} />
        </>}
        {mode === 'cheque' && <div className="field"><label>{'Cheque no · bank · date'}</label><input value={ref} onChange={e => setRef(e.target.value)} placeholder="123456 SBI 12/11" /></div>}
        <p className="muted" style={{ margin: 0, textAlign: 'center' }}>{t('shopConfirm')}</p>
        <button className="btn ok-huge" disabled={!canSave} onClick={save} aria-label="Shop confirms payment"><Check size={84} /></button>
      </>}
      {onSkip && <button className="btn ghost" onClick={onSkip}>{'No payment today'}</button>}
    </div>
  );
}
