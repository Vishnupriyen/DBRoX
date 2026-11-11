import { useEffect, useState } from 'react';
import { Check, QrCode, AlertTriangle, Send } from 'lucide-react';
import QRCode from 'qrcode';
import { ChangeSet, getSettings, session, today } from '../core/db';
import { r2 } from '../core/ledger';
import { collectableBills } from '../core/pipeline';
import { inr, showDate, t } from '../core/i18n';
import { PhotoButton } from './PhotoButton';
import { collectionCheck } from '../core/credit';
import { receiptNumber, receiptText } from '../core/receipts';
import { shareText } from '../core/files';
import { confirmBox, notify } from './dialog';
import type { Payment, Shop } from '../core/types';


// One collection box for driver and salesman: bill(s) first, then amount, then mode (UPI shows the QR → photo), shop ✓.
// Excess over the chosen bills is carried to the shop's next bill; a short payment alerts the owner (status in the ledger).
export function PayBox({ shop, preferInvoiceIds = [], onDone, onSkip }: { shop: Shop; preferInvoiceIds?: string[]; onDone: (paid?: { amount: number; mode: Payment['mode'] }) => void; onSkip?: () => void }) {
  const [bills, setBills] = useState<{ id: string; number: string; date: string; balance: number }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set(preferInvoiceIds));
  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<Payment['mode']>('cash');
  const [ref, setRef] = useState('');
  const [photo, setPhoto] = useState<string>();
  const [qr, setQr] = useState<string>();
  const [showQr, setShowQr] = useState(false);
  const [chequeDate, setChequeDate] = useState(today());
  const [receipt, setReceipt] = useState<{ p: Payment; text: string } | null>(null);
  // from Collect (no bill named) every open bill is ticked; the person unticks what the shop is not paying
  const [shortCredit, setShortCredit] = useState(0);
  // the amount asked is the delivered value (after shorts and damage) plus old dues: a short will be credited at day close
  useEffect(() => { collectableBills(shop.id).then(bs => { setShortCredit(r2(bs.reduce((a, b) => a + b.short, 0))); const list = bs.sort((a, b) => a.invoice.date.localeCompare(b.invoice.date)).map(b => ({ id: b.invoice.id, number: b.invoice.number, date: b.invoice.date, balance: b.due })); setBills(list); if (!preferInvoiceIds.length && list.length) setSel(new Set(list.map(b => b.id))); }); }, [shop.id]);
  useEffect(() => { (async () => { const s = await getSettings(); if (!s.upiId) { setQr(undefined); return; } setQr(await QRCode.toDataURL(`upi://pay?pa=${s.upiId}&pn=${encodeURIComponent(s.firmName)}&am=${amount || ''}&cu=INR`, { width: 480, margin: 1 })); })(); }, [amount]);

  const chosen = bills.filter(b => sel.has(b.id));
  const due = r2(chosen.reduce((a, b) => a + b.balance, 0));
  const excess = r2(Math.max(0, amount - due));
  const shortBy = r2(Math.max(0, due - amount));
  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); if (!amount) setAmount(0); return n; });
  const canSave = chosen.length > 0 && amount > 0 && (mode === 'cash' || ref.length >= 4 || !!photo);

  // why "Money paid" is not tappable yet, in the person's words
  const missing = canSave ? '' : !chosen.length ? 'Tick the bill the shop is paying.' : !amount ? 'Type the amount.' : mode === 'upi' ? (ref.length < 4 ? 'Type the UPI ref (last 4 digits) or take the photo of the payment screen.' : '') : 'Type the cheque number and bank.';
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return; // locked while saving: one tap = one payment
    setSaving(true);
    try {
      // more than everything the shop owes is usually a typing mistake: ask first
      const big = await collectionCheck(shop.id, amount);
      if (big && !(await confirmBox(big, 'Check the amount with the shop before saving.', 'Yes, save'))) return;
      await saveOnce();
    } catch (e) { await notify('Not saved', (e as Error).message); } finally { setSaving(false); }
  };
  const saveOnce = async () => {
    // allocate to the chosen bills oldest first; anything left is advance (carried to the next bill automatically)
    let left = amount; const allocations: { invoiceId: string; amount: number }[] = [];
    for (const b of chosen) { if (left <= 0) break; const a = Math.min(b.balance, left); allocations.push({ invoiceId: b.id, amount: r2(a) }); left = r2(left - a); }
    const cs = new ChangeSet();
    // every collection gets a running receipt number the shop is shown (and can be sent on WhatsApp)
    const receiptNo = await receiptNumber(cs);
    const p = cs.put<Payment>('payments', { shopId: shop.id, amount, mode, ref, ...(mode === 'cheque' ? { chequeDate } : {}), date: today(), collectedBy: session().userId, shopConfirmed: true, confirmPhoto: photo, allocations, advance: r2(left), settled: false, status: 'ok', receiptNo }, shortBy > 0 ? `collection (short by ${shortBy})` : 'collection');
    await cs.commit('Collection');
    setReceipt({ p, text: await receiptText(p) });
  };

  if (receipt) return (
    <div className="card stack">
      <div className="alert ok"><Check /><div><b>{'Receipt'} {receipt.p.receiptNo?.includes('/PENDING-') ? '' : receipt.p.receiptNo}</b> · {inr(receipt.p.amount)}</div></div>
      <div className="muted" style={{ whiteSpace: 'pre-line' }}>{receipt.text}</div>
      <button className="btn" onClick={() => void shareText(receipt.text, shop.phone)}><Send /> {'Send on WhatsApp'}</button>
      <button className="btn primary" onClick={() => onDone({ amount: receipt.p.amount, mode: receipt.p.mode })}><Check /> {t('done')}</button>
    </div>
  );

  return (
    <div className="card stack">
      <div className="eyebrow">{'1. Which bills?'}</div>
      <div className="list">
        {bills.map(b => <button key={b.id} className="item tap" onClick={() => toggle(b.id)}><div className={`avatar ${sel.has(b.id) ? 'ok' : ''}`}>{sel.has(b.id) ? <Check /> : null}</div><div className="grow" style={{ minWidth: 0 }}><div className="t"><span className="billno">{b.number}</span></div><div className="s">{showDate(b.date)}</div><div className="amt num">{inr(b.balance)}</div></div></button>)}
        {!bills.length && <div className="muted">{'No bills pending for this shop.'}</div>}
      </div>
      {shortCredit > 0 && <div className="muted">{'Short'} {inr(shortCredit)} — {'credit note at day close'}</div>}
      {chosen.length > 0 && <>
        <div className="eyebrow">{'2. Amount'} · {'due'} {inr(due)}</div>
        <div className="row" style={{ gap: 6 }}><button className="btn small" onClick={() => setAmount(due)}>{'Full'} {inr(due)}</button></div>
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center', gap: 6 }}><span className="amt num" style={{ fontSize: '1.75rem' }}>₹</span><input className="bigamount grow" type="text" inputMode="decimal" placeholder={String(due)} value={amount || ''} onChange={e => { const v = e.target.value.replace(/[^\d.]/g, ''); setAmount(Number(v) || 0); }} aria-label={t('amount')} /></div>
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
        {mode === 'cheque' && <>
          <div className="field"><label>{'Cheque no · bank'}</label><input value={ref} onChange={e => setRef(e.target.value)} placeholder="123456 SBI" /></div>
          <div className="field"><label>{'Cheque date'}</label><input type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value || today())} /></div>
          {chequeDate > today() && <div className="alert"><AlertTriangle /><div>{'Post-dated: the bills stay open until'} {showDate(chequeDate)}</div></div>}
        </>}
        <p className="muted" style={{ margin: 0, textAlign: 'center' }}>{t('shopConfirm')}</p>
        <button className="btn ok-huge" disabled={!canSave || saving} onClick={save} aria-label="Shop confirms payment">{'Money paid'} <Check size={40} /></button>
        {missing && <p className="muted" data-testid="paybox-missing" style={{ margin: 0, textAlign: 'center' }}>{missing}</p>}
      </>}
      {onSkip && <button className="btn ghost" onClick={onSkip}>{'No payment today'}</button>}
    </div>
  );
}
