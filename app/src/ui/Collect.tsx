import { useEffect, useState } from 'react';
import { PhotoButton } from './PhotoButton';
import { ArrowLeft, Check, Store } from 'lucide-react';
import { ChangeSet, db, session, today } from '../core/db';
import { allocateOldestFirst, shopOutstanding } from '../core/ledger';
import { norm } from '../core/match';
import { inr, speak, t } from '../core/i18n';
import type { Payment, Shop } from '../core/types';

// RoX Collection: overdue shops first; shop confirms every payment with one ✓ + Tamil voice + photo.
export function Collect() {
  const [shops, setShops] = useState<(Shop & { due: number; overdue: number })[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<(Shop & { due: number }) | null>(null);
  const [tick, setTick] = useState(0);
  const [waiting, setWaiting] = useState<Payment[]>([]);
  useEffect(() => {
    (async () => {
      const ss = await db.shops.toArray();
      const withDue = await Promise.all(ss.map(async s => { const o = await shopOutstanding(s.id); return { ...s, due: o.total, overdue: o.maxOverdueDays }; }));
      setShops(withDue.filter(s => s.due > 0.5).sort((a, b) => b.overdue - a.overdue || b.due - a.due));
      setWaiting((await db.payments.toArray()).filter(p => p.status === 'waiting_shop'));
    })();
  }, [tick]);

  if (sel) return <CollectShop shop={sel} onClose={() => { setSel(null); setTick(x => x + 1); }} />;
  const list = shops.filter(s => !q || norm(s.name).includes(norm(q)) || norm(s.area).includes(norm(q)));
  return (
    <div>
      <div className="sechead"><h3>{t('collect')}</h3></div>
      {waiting.length > 0 && (
        <div className="card">
          <h3>Waiting for shop ✓ ({waiting.length})</h3>
          {waiting.map(p => <WaitingRow key={p.id} p={p} onDone={() => setTick(x => x + 1)} />)}
        </div>
      )}
      <div className="field" style={{ margin: '10px 0' }}><input placeholder="Search shop…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search shop" /></div>
      <div className="list">
        {list.map(s => (
          <button key={s.id} className="item tap" onClick={() => setSel(s)}>
            <div className={`avatar ${s.overdue > 0 ? 'bad' : ''}`}><Store size={22} /></div>
            <div className="grow"><div className="t">{s.name}</div><div className="s">{s.area}</div></div>
            <div style={{ textAlign: 'right' }}><div className="amt num">{inr(s.due)}</div>{s.overdue > 0 && <span className="badge bad">{s.overdue} days late</span>}</div>
          </button>
        ))}
        {!list.length && <div className="card muted">{t('noItems')}</div>}
      </div>
    </div>
  );
}

function WaitingRow({ p, onDone }: { p: Payment; onDone: () => void }) {
  const [name, setName] = useState('');
  useEffect(() => { db.shops.get(p.shopId).then(s => setName(s?.name ?? '')); }, [p]);
  return (
    <div className="row" style={{ padding: '6px 0' }}>
      <span className="grow">{name} · {inr(p.amount)} {p.mode}</span>
      <button className="btn small primary" onClick={async () => {
        const cs = new ChangeSet(); cs.put('payments', { ...p, shopConfirmed: true, status: 'ok' }, 'shop confirmed later');
        await cs.commit('Shop ✓'); speak(`${p.amount} ரூபாய் பெறப்பட்டது. நன்றி.`); onDone();
      }}>Shop ✓</button>
    </div>
  );
}

export function CollectShop({ shop, onClose }: { shop: Shop & { due: number }; onClose: () => void }) {
  const [amount, setAmount] = useState(Math.round(shop.due));
  const [mode, setMode] = useState<Payment['mode']>('cash');
  const [ref, setRef] = useState('');
  const [photo, setPhoto] = useState<string>();
  const [done, setDone] = useState(false);

  const save = async (shopConfirmed: boolean) => {
    if (amount <= 0) return;
    const { allocations, advance } = await allocateOldestFirst(shop.id, amount);
    const me = await db.staff.get(session().userId);
    const inOffice = me?.role === 'owner' || me?.role === 'office';
    const cs = new ChangeSet();
    cs.put<Payment>('payments', { shopId: shop.id, amount, mode, ref, date: today(), collectedBy: session().userId, shopConfirmed, confirmPhoto: photo, allocations, advance, settled: inOffice && mode === 'cash', status: shopConfirmed ? 'ok' : 'waiting_shop' }, 'collection');
    await cs.commit('Collection');
    if (shopConfirmed) speak(`${amount} ரூபாய் பெறப்பட்டது. நன்றி.`);
    setDone(true);
  };

  if (done) return (
    <div className="stack" style={{ textAlign: 'center', paddingTop: 30 }}>
      <div className="avatar ok" style={{ width: 96, height: 96, margin: '0 auto', borderRadius: 28 }}><Check size={56} /></div>
      <h2>{inr(amount)}</h2><div className="muted">{shop.name} · {t('received')}</div>
      <button className="btn big primary block" onClick={onClose}>OK</button>
    </div>
  );
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'nowrap' }}><button className="icon-btn" onClick={onClose} aria-label="Back"><ArrowLeft /></button><div className="grow"><div className="h">{shop.name}</div><div className="muted">{t('outstanding')} {inr(shop.due)}</div></div></div>
      <div className="card stack">
        <div className="field"><label>{t('amount')}</label>
          <input className="bigamount" type="number" inputMode="decimal" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} aria-label={t('amount')} /></div>
        <div className="segmented">
          {(['cash', 'upi', 'cheque'] as const).map(m => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{t(m)}</button>)}
        </div>
        {mode !== 'cash' && <div className="field"><label>UPI / cheque no</label><input value={ref} onChange={e => setRef(e.target.value)} /></div>}
        <p className="muted" style={{ margin: 0, textAlign: 'center' }}>Oldest bills are cleared first. {t('shopConfirm')}</p>
        <PhotoButton facing="user" onPhoto={setPhoto} />
        <button className="btn ok-huge" onClick={() => { speak(`${amount} ரூபாய் கொடுக்கிறீர்களா? சரி என்றால் அழுத்துங்கள்.`); void save(true); }} aria-label="Shop confirms payment"><Check size={84} /></button>
        <button className="btn" onClick={() => save(false)}>Owner not here — wait for shop ✓</button>
      </div>
    </div>
  );
}
