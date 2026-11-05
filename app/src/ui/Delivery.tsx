import { useEffect, useMemo, useState } from 'react';
import { ChangeSet, db, nowIso, session, today } from '../core/db';
import { allocateOldestFirst, r2, shopOutstanding } from '../core/ledger';
import { inr, speak, t } from '../core/i18n';
import { fileToDataUrl } from '../core/scan';
import type { CreditNote, Invoice, Payment, Product, Shop } from '../core/types';

interface Stop { shop: Shop; invoices: Invoice[] }

// RoX Delivery: big buttons only. Delivered ✓ · Short · Return. Shop confirms with one tap + Tamil voice.
export function Delivery() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [open, setOpen] = useState<Stop | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    (async () => {
      const me = await db.staff.get(session().userId);
      const invs = (await db.invoices.where('deliveryStatus').equals('pending').toArray())
        .filter(i => !i.cancelled && (me?.role !== 'delivery' || !me.vanId || !i.vanId || i.vanId === me.vanId));
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
      const by = new Map<string, Invoice[]>();
      for (const i of invs) by.set(i.shopId, [...(by.get(i.shopId) ?? []), i]);
      setStops([...by.entries()].map(([id, invoices]) => ({ shop: shops.get(id)!, invoices })));
    })();
  }, [tick]);

  if (open) return <StopView stop={open} onClose={() => { setOpen(null); setTick(x => x + 1); }} />;
  return (
    <div>
      <h3 style={{ margin: '4px 0 12px' }}>{t('delivery')} · {stops.length} {t('shop')}</h3>
      <div className="list">
        {stops.map(s => (
          <button key={s.shop.id} className="item" style={{ textAlign: 'left', width: '100%' }} onClick={() => setOpen(s)}>
            <div className="avatar">{s.shop.name[0]}</div>
            <div className="grow"><div className="t">{s.shop.name}</div><div className="muted">{s.shop.area} · {s.invoices.length} {t('bills')}</div></div>
            <b>{inr(s.invoices.reduce((a, i) => a + i.total, 0))}</b>
          </button>
        ))}
        {!stops.length && <div className="card muted">{t('noItems')}</div>}
      </div>
    </div>
  );
}

const REASONS = [
  { value: 'short', label: 'Not loaded / short', restock: true },
  { value: 'damaged', label: 'Damaged in van', restock: false },
  { value: 'refused', label: 'Shop refused', restock: true },
];

function StopView({ stop, onClose }: { stop: Stop; onClose: () => void }) {
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [short, setShort] = useState<Record<string, { qty: number; reason: string }>>({});
  const [step, setStep] = useState<'items' | 'confirm' | 'pay' | 'done'>('items');
  const [photo, setPhoto] = useState<string | undefined>();
  const [pay, setPay] = useState({ amount: 0, mode: 'cash' as Payment['mode'], ref: '' });
  const [oldBal, setOldBal] = useState(0);
  useEffect(() => { db.products.toArray().then(ps => setProducts(new Map(ps.map(p => [p.id, p])))); shopOutstanding(stop.shop.id).then(o => setOldBal(o.total)); }, [stop]);

  const key = (inv: Invoice, pid: string) => `${inv.id}|${pid}`;
  const shortValue = useMemo(() => {
    let v = 0;
    for (const inv of stop.invoices) for (const l of inv.lines) {
      const s = short[key(inv, l.productId)];
      if (s?.qty) v += Math.min(s.qty, l.qty) * (l.total / (l.qty || 1));
    }
    return r2(v);
  }, [short, stop]);
  const billTotal = r2(stop.invoices.reduce((a, i) => a + i.total, 0));
  const delivered = r2(billTotal - shortValue);

  const toConfirm = () => {
    setStep('confirm');
    speak(`${stop.shop.name}. ${Math.round(delivered)} ரூபாய் பொருட்கள் வந்து சேர்ந்தன. சரி என்றால் பச்சை பொத்தானை அழுத்துங்கள்.`);
  };

  const confirmDelivery = async (returnAll = false) => {
    const pos = await getPos();
    const cs = new ChangeSet();
    const batches = await db.batches.toArray();
    const cnCount = await db.creditNotes.count();
    let cnNo = 0;
    for (const inv of stop.invoices) {
      const shortages: { productId: string; qty: number; reason: string }[] = [];
      const cnLines: CreditNote['lines'] = [];
      for (const l of inv.lines) {
        const s = returnAll ? { qty: l.qty, reason: 'refused' } : short[key(inv, l.productId)];
        if (!s?.qty) continue;
        const qty = Math.min(s.qty, l.qty);
        const reason = REASONS.find(r => r.value === s.reason) ?? REASONS[0];
        shortages.push({ productId: l.productId, qty, reason: reason.label });
        cnLines.push({ productId: l.productId, qty, amount: r2(qty * l.total / (l.qty || 1)), restock: reason.restock });
        if (reason.restock) {
          const b = batches.find(x => x.id === l.batches[0]?.batchId);
          if (b) { b.qty += qty; cs.put('batches', { ...b }, 'back to godown'); }
        } else {
          cs.put('claimEntries', { companyId: inv.companyId, month: today().slice(0, 7), kind: 'transit', productId: l.productId, qty, amount: r2(qty * (products.get(l.productId)?.purchaseRate ?? 0)), invoiceId: inv.id, note: 'Damaged in van', photo }, 'transit damage');
        }
      }
      if (cnLines.length) {
        cs.put<CreditNote>('creditNotes', { number: `CN/${today().slice(2, 4)}/${String(cnCount + ++cnNo).padStart(5, '0')}`, invoiceId: inv.id, shopId: inv.shopId, companyId: inv.companyId, date: today(), reason: returnAll ? 'Returned at door' : 'Short at delivery', lines: cnLines, total: r2(cnLines.reduce((a, l) => a + l.amount, 0)) }, 'credit note at door');
      }
      cs.put('invoices', { ...inv, deliveryStatus: returnAll ? 'returned' : shortages.length ? 'partial' : 'delivered', delivery: { at: nowIso(), by: session().userId, photo, lat: pos?.lat, lng: pos?.lng, shortages } }, 'delivery');
    }
    await cs.commit(returnAll ? 'Returned at door' : 'Delivered');
    if (returnAll) { setStep('done'); return; }
    setPay({ amount: Math.max(0, Math.round(delivered)), mode: 'cash', ref: '' });
    setStep('pay');
  };

  const savePayment = async (shopConfirmed: boolean) => {
    if (pay.amount > 0) {
      const { allocations, advance } = await allocateOldestFirst(stop.shop.id, pay.amount);
      const cs = new ChangeSet();
      cs.put<Payment>('payments', { shopId: stop.shop.id, amount: pay.amount, mode: pay.mode, ref: pay.ref, date: today(), collectedBy: session().userId, shopConfirmed, confirmPhoto: photo, allocations, advance, settled: false, status: shopConfirmed ? 'ok' : 'waiting_shop' }, 'collected at door');
      await cs.commit('Payment at delivery');
      if (shopConfirmed) speak(`${pay.amount} ரூபாய் பெறப்பட்டது. நன்றி.`);
    }
    setStep('done');
  };

  if (step === 'done') return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 64 }}>✅</div>
      <h3>{stop.shop.name}</h3>
      <button className="btn big primary" onClick={onClose}>Next shop →</button>
    </div>
  );

  if (step === 'pay') return (
    <div>
      <h3>{t('collect')} · {stop.shop.name}</h3>
      <div className="card">
        <div className="muted">Today's goods {inr(delivered)} · Old balance {inr(Math.max(0, oldBal))}</div>
        <div className="field" style={{ margin: '10px 0' }}><label>{t('amount')} ₹</label>
          <input type="number" inputMode="decimal" style={{ fontSize: 28, padding: 10 }} value={pay.amount || ''} onChange={e => setPay({ ...pay, amount: Number(e.target.value) })} /></div>
        <div className="row" style={{ marginBottom: 10 }}>
          {(['cash', 'upi', 'cheque'] as const).map(m => <button key={m} className={`btn ${pay.mode === m ? 'primary' : ''}`} onClick={() => setPay({ ...pay, mode: m })}>{t(m)}</button>)}
        </div>
        {pay.mode !== 'cash' && <div className="field" style={{ marginBottom: 10 }}><label>UPI / cheque no</label><input value={pay.ref} onChange={e => setPay({ ...pay, ref: e.target.value })} /></div>}
        <p className="muted">{t('shopConfirm')}</p>
        <button className="btn huge-ok" onClick={() => savePayment(true)} aria-label="Shop confirms payment">✓</button>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => savePayment(false)}>Owner not here — wait for shop ✓</button>
          <button className="btn" onClick={() => { setPay({ ...pay, amount: 0 }); setStep('done'); }}>No payment today</button>
        </div>
      </div>
    </div>
  );

  if (step === 'confirm') return (
    <div>
      <h3>{stop.shop.name}</h3>
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="muted">Goods delivered</div>
        <div style={{ fontSize: 40, fontWeight: 800 }}>{inr(delivered)}</div>
        {shortValue > 0 && <div className="badge yellow">Short / return {inr(shortValue)} → credit note</div>}
        <p>{t('shopConfirm')}</p>
        <label className="btn" style={{ display: 'inline-block', marginBottom: 12 }}>
          📷 {photo ? 'Photo taken ✓' : t('takePhoto')}
          <input type="file" accept="image/*" capture="user" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) setPhoto(await fileToDataUrl(f, 640, 0.6)); }} />
        </label>
        <button className="btn huge-ok" onClick={() => confirmDelivery(false)} aria-label="Shop confirms delivery">✓</button>
        <button className="btn" style={{ marginTop: 10 }} onClick={() => setStep('items')}>← Back</button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn small" onClick={onClose}>←</button>
        <h3 style={{ margin: 0 }} className="grow">{stop.shop.name}</h3>
        <b>{inr(billTotal)}</b>
      </div>
      {stop.invoices.map(inv => (
        <div className="card" key={inv.id}>
          <div className="muted" style={{ marginBottom: 6 }}>{inv.number}</div>
          <div className="list">
            {inv.lines.map(l => {
              const p = products.get(l.productId);
              const s = short[key(inv, l.productId)];
              return (
                <div className="item" key={l.productId}>
                  <div className="avatar">{(p?.name ?? '?')[0]}</div>
                  <div className="grow">
                    <div className="t">{p?.nameTa || l.name}</div>
                    <div className="muted">{l.name} · MRP {l.mrp}</div>
                    <div className="row" style={{ marginTop: 4 }}>
                      <span className="badge green">{l.qty + l.freeQty} pcs{l.freeQty ? ` (${l.freeQty} free)` : ''}</span>
                      {s?.qty ? <span className="badge red">−{s.qty} {REASONS.find(r => r.value === s.reason)?.label}</span> : null}
                    </div>
                  </div>
                  <button className="btn small" onClick={() => {
                    const q = Number(prompt(`${t('short')}: how many pieces of ${l.name}?`, String(s?.qty ?? '')) ?? '');
                    if (!Number.isFinite(q)) return;
                    const reason = q ? (confirm('Damaged in van? (OK = damaged, Cancel = not loaded / refused)') ? 'damaged' : 'short') : 'short';
                    setShort({ ...short, [key(inv, l.productId)]: { qty: Math.max(0, Math.min(q, l.qty)), reason } });
                  }}>{t('short')}</button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <button className="btn big primary" onClick={toConfirm}>{t('delivered')}</button>
      <button className="btn big" style={{ marginTop: 8 }} onClick={() => { if (confirm('Shop refused everything? All goods go back to godown and a credit note is made.')) void confirmDelivery(true); }}>{t('returnAll')}</button>
    </div>
  );
}

function getPos(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { timeout: 4000, maximumAge: 60000 });
  });
}
