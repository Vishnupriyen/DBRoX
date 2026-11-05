import { useEffect, useState } from 'react';
import { ChangeSet, db, session, today } from '../core/db';
import { allocateOldestFirst, shopOutstanding } from '../core/ledger';
import { norm } from '../core/match';
import { inr, speak, t } from '../core/i18n';
import { fileToDataUrl } from '../core/scan';
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
      <h3 style={{ margin: '4px 0 12px' }}>{t('collect')}</h3>
      {waiting.length > 0 && (
        <div className="card">
          <h3>Waiting for shop ✓ ({waiting.length})</h3>
          {waiting.map(p => <WaitingRow key={p.id} p={p} onDone={() => setTick(x => x + 1)} />)}
        </div>
      )}
      <input className="pill" style={{ width: '100%', padding: 10, marginBottom: 10 }} placeholder="Search shop…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="list">
        {list.map(s => (
          <button key={s.id} className="item" style={{ textAlign: 'left', width: '100%' }} onClick={() => setSel(s)}>
            <div className="avatar">{s.name[0]}</div>
            <div className="grow"><div className="t">{s.name}</div><div className="muted">{s.area}</div></div>
            <div style={{ textAlign: 'right' }}><b>{inr(s.due)}</b>{s.overdue > 0 && <div><span className="badge red">{s.overdue} days late</span></div>}</div>
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

function CollectShop({ shop, onClose }: { shop: Shop & { due: number }; onClose: () => void }) {
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

  if (done) return <div className="card" style={{ textAlign: 'center' }}><div style={{ fontSize: 64 }}>✅</div><h3>{inr(amount)} · {shop.name}</h3><button className="btn big primary" onClick={onClose}>OK</button></div>;
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}><button className="btn small" onClick={onClose}>←</button><h3 className="grow" style={{ margin: 0 }}>{shop.name}</h3></div>
      <div className="card">
        <div className="muted">{t('outstanding')} {inr(shop.due)}</div>
        <div className="field" style={{ margin: '10px 0' }}><label>{t('amount')} ₹</label>
          <input type="number" inputMode="decimal" style={{ fontSize: 28, padding: 10 }} value={amount || ''} onChange={e => setAmount(Number(e.target.value))} /></div>
        <div className="row" style={{ marginBottom: 10 }}>
          {(['cash', 'upi', 'cheque'] as const).map(m => <button key={m} className={`btn ${mode === m ? 'primary' : ''}`} onClick={() => setMode(m)}>{t(m)}</button>)}
        </div>
        {mode !== 'cash' && <div className="field" style={{ marginBottom: 10 }}><label>UPI / cheque no</label><input value={ref} onChange={e => setRef(e.target.value)} /></div>}
        <p className="muted">Oldest bills are cleared first. {t('shopConfirm')}</p>
        <label className="btn" style={{ display: 'inline-block', marginBottom: 10 }}>
          📷 {photo ? 'Photo taken ✓' : t('takePhoto')}
          <input type="file" accept="image/*" capture="user" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) setPhoto(await fileToDataUrl(f, 640, 0.6)); }} />
        </label>
        <button className="btn huge-ok" onClick={() => { speak(`${amount} ரூபாய் கொடுக்கிறீர்களா? சரி என்றால் அழுத்துங்கள்.`); void save(true); }} aria-label="Shop confirms payment">✓</button>
        <button className="btn" style={{ marginTop: 10 }} onClick={() => save(false)}>Owner not here — wait for shop ✓</button>
      </div>
    </div>
  );
}
