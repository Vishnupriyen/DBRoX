import { useEffect, useMemo, useState } from 'react';
import { Camera, Check, ArrowLeft, PackageX, Navigation, Flag } from 'lucide-react';
import { endTrip, startTrip, trackPoint } from '../core/pipeline';
import { Pack } from './Pack';
import { ChangeSet, db, nowIso, session, today } from '../core/db';
import { allocateOldestFirst, r2, shopOutstanding } from '../core/ledger';
import { inr, speak, t } from '../core/i18n';
import { fileToDataUrl } from '../core/scan';
import type { CreditNote, Invoice, Payment, Product, Shop, Trip } from '../core/types';
import { ask, askText, confirmBox } from './dialog';

interface Stop { shop: Shop; invoices: Invoice[] }

// RoX Delivery: the driver's trip. Start trip → stops in order → Delivered ✓ / Short / Return → end trip.
// While the trip is out, the phone sends its location every 30 s so the owner sees the van live.
export function Delivery() {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [open, setOpen] = useState<Stop | null>(null);
  const [tick, setTick] = useState(0);
  const [ending, setEnding] = useState(false);
  useEffect(() => {
    (async () => {
      const me = await db.staff.get(session().userId);
      const trips = (await db.trips.where('date').equals(today()).toArray()).filter(x => x.status !== 'done');
      const mine = trips.find(x => me?.role !== 'delivery' || x.driverId === me.id || (me.vanId && x.vanId === me.vanId)) ?? trips[0] ?? null;
      setTrip(mine);
      if (!mine) { setStops([]); return; }
      const invs = (await db.invoices.where('tripId').equals(mine.id).toArray()).filter(i => !i.cancelled);
      const shops = new Map((await db.shops.toArray()).map(x => [x.id, x]));
      setStops(mine.stops.map(sid => ({ shop: shops.get(sid)!, invoices: invs.filter(i => i.shopId === sid) })).filter(x => x.invoices.length));
    })();
  }, [tick]);
  // live location while out
  useEffect(() => {
    if (!trip || trip.status !== 'out' || !navigator.geolocation) return;
    const send = () => navigator.geolocation.getCurrentPosition(p => { void trackPoint(trip.id, p.coords.latitude, p.coords.longitude); }, () => {}, { maximumAge: 20000, timeout: 8000 });
    send(); const id = setInterval(send, 30000);
    return () => clearInterval(id);
  }, [trip]);

  if (open) return <StopView stop={open} onClose={() => { setOpen(null); setTick(x => x + 1); }} />;
  const left = stops.filter(x => x.invoices.some(i => ['planned', 'out'].includes(i.deliveryStatus)));
  const done = stops.length - left.length;

  if (ending && trip) return <EndTrip trip={trip} stops={left} onDone={() => { setEnding(false); setTick(x => x + 1); }} />;
  return (
    <div className="stack">
      <div className="kpi navy">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><div className="v">{done}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{stops.length}</span></div><div className="l">{t('delivery')} · {trip ? (trip.status === 'out' ? 'on the road' : trip.status === 'loaded' ? 'loaded, ready to go' : 'being loaded') : 'no trip today'}</div></div>
          {trip && trip.status === 'out' && <span className="badge gold"><Navigation size={12} /> live</span>}
        </div>
      </div>
      {trip && trip.status !== 'out' && <button className="btn primary big block" disabled={trip.status === 'planned'} onClick={async () => { await startTrip(trip.id); setTick(x => x + 1); }}><Navigation /> {trip.status === 'planned' ? 'Waiting for godown to load' : 'Start trip'}</button>}
      <div className="route">
        {stops.map((s, k) => {
          const st = s.invoices[0].deliveryStatus;
          const fin = ['delivered', 'partial', 'returned'].includes(st);
          return (
            <button key={s.shop.id} className={`stop item tap ${fin ? 'done' : left[0]?.shop.id === s.shop.id && trip?.status === 'out' ? 'now' : ''}`} disabled={fin || trip?.status !== 'out'} style={{ opacity: fin ? .6 : 1 }} onClick={() => setOpen(s)}>
              <div className={`avatar ${fin ? 'ok' : ''}`}>{fin ? <Check size={22} /> : <span>{k + 1}</span>}</div>
              <div className="grow"><div className="t">{s.shop.name}</div><div className="s">{s.shop.area} · {s.invoices.length} {t('bills')}{s.shop.phone ? ` · ${s.shop.phone}` : ''}</div></div>
              <span className="amt num">{inr(s.invoices.reduce((a, i) => a + i.total, 0))}</span>
            </button>
          );
        })}
        {!stops.length && <div className="card muted">{t('noItems')}</div>}
      </div>
      {trip?.status === 'out' && <button className="btn big block" onClick={() => setEnding(true)}><Flag /> End trip{left.length ? ` (${left.length} not delivered)` : ''}</button>}
    </div>
  );
}

function EndTrip({ trip, stops, onDone }: { trip: Trip; stops: Stop[]; onDone: () => void }) {
  const [what, setWhat] = useState<Record<string, 'godown' | 'van' | 'next'>>({});
  return (
    <div className="stack">
      <div className="sechead"><h3>End trip</h3></div>
      {stops.map(s => (
        <div key={s.shop.id} className="card">
          <b>{s.shop.name}</b> <span className="muted">· not delivered. Goods are:</span>
          <div className="segmented" style={{ marginTop: 8 }}>
            {([['godown', 'Back in godown'], ['van', 'Kept in van'], ['next', 'Next visit']] as const).map(([k, l]) => <button key={k} className={(what[s.invoices[0].id] ?? 'next') === k ? 'on' : ''} onClick={() => setWhat(w => { const n = { ...w }; for (const i of s.invoices) n[i.id] = k; return n; })}>{l}</button>)}
          </div>
        </div>
      ))}
      {!stops.length && <div className="card ok" style={{ background: 'var(--ok-soft)' }}>Every stop done. 🎉</div>}
      <button className="btn primary big block" onClick={async () => { await endTrip(trip.id, what); onDone(); }}><Check /> Trip over — back at godown</button>
      <button className="btn ghost block" onClick={onDone}>Cancel</button>
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
    <div className="stack" style={{ textAlign: 'center', paddingTop: 30 }}>
      <div className="avatar ok" style={{ width: 96, height: 96, margin: '0 auto', borderRadius: 28 }}><Check size={56} /></div>
      <h2>{stop.shop.name}</h2>
      <button className="btn big primary block" onClick={onClose}>Next shop →</button>
    </div>
  );

  if (step === 'pay') return (
    <div>
      <div className="sechead"><h3>{t('collect')} · {stop.shop.name}</h3></div>
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Today's goods</span><b className="num">{inr(delivered)}</b></div>
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Old balance</span><b className="num">{inr(Math.max(0, oldBal))}</b></div>
        <div className="field"><label>{t('amount')}</label>
          <input className="bigamount" type="number" inputMode="decimal" value={pay.amount || ''} onChange={e => setPay({ ...pay, amount: Number(e.target.value) })} aria-label={t('amount')} /></div>
        <div className="segmented">
          {(['cash', 'upi', 'cheque'] as const).map(m => <button key={m} className={pay.mode === m ? 'on' : ''} onClick={() => setPay({ ...pay, mode: m })}>{t(m)}</button>)}
        </div>
        {pay.mode !== 'cash' && <div className="field"><label>UPI / cheque no</label><input value={pay.ref} onChange={e => setPay({ ...pay, ref: e.target.value })} /></div>}
        <p className="muted" style={{ textAlign: 'center', margin: 0 }}>{t('shopConfirm')}</p>
        <button className="btn ok-huge" onClick={() => savePayment(true)} aria-label="Shop confirms payment"><Check size={84} /></button>
        <button className="btn" onClick={() => savePayment(false)}>Owner not here — wait for shop ✓</button>
        <button className="btn ghost" onClick={() => { setPay({ ...pay, amount: 0 }); setStep('done'); }}>No payment today</button>
      </div>
    </div>
  );

  if (step === 'confirm') return (
    <div>
      <div className="sechead"><h3>{stop.shop.name}</h3></div>
      <div className="card stack" style={{ textAlign: 'center' }}>
        <div className="eyebrow">Goods delivered</div>
        <div className="num" style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}>{inr(delivered)}</div>
        {shortValue > 0 && <div><span className="badge warn">Short / return {inr(shortValue)} → credit note</span></div>}
        <p className="muted" style={{ margin: 0 }}>{t('shopConfirm')}</p>
        <label className="btn">
          <Camera /> {photo ? 'Photo taken ✓' : t('takePhoto')}
          <input type="file" accept="image/*" capture="user" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) setPhoto(await fileToDataUrl(f, 640, 0.6)); }} />
        </label>
        <button className="btn ok-huge" onClick={() => confirmDelivery(false)} aria-label="Shop confirms delivery"><Check size={84} /></button>
        <button className="btn ghost" onClick={() => setStep('items')}><ArrowLeft /> Back</button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: 8, flexWrap: 'nowrap' }}>
        <button className="icon-btn" onClick={onClose} aria-label="Back"><ArrowLeft /></button>
        <div className="grow"><div className="h">{stop.shop.name}</div><div className="muted">{stop.shop.area}</div></div>
        <span className="amt num">{inr(billTotal)}</span>
      </div>
      {stop.invoices.map(inv => (
        <div className="card" key={inv.id}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>{inv.number}</div>
          <div className="list">
            {inv.lines.map(l => {
              const p = products.get(l.productId);
              const s = short[key(inv, l.productId)];
              return (
                <div className="item" key={l.productId}>
                  {p ? <Pack product={p} /> : <div className="avatar">?</div>}
                  <div className="grow">
                    <div className="t">{p?.nameTa || l.name}</div>
                    <div className="s">{l.name} · MRP {l.mrp}</div>
                    <div className="row" style={{ marginTop: 4 }}>
                      <span className="badge navy">{l.qty + l.freeQty} pcs{l.freeQty ? ` (${l.freeQty} free)` : ''}</span>
                      {s?.qty ? <span className="badge bad">−{s.qty} {REASONS.find(r => r.value === s.reason)?.label}</span> : null}
                    </div>
                  </div>
                  <button className="btn small" onClick={async () => {
                    const raw = await askText(`${t('short')}: how many pieces of ${l.name}?`, String(s?.qty ?? ''), 'number');
                    if (raw == null) return;
                    const q = Number(raw);
                    if (!Number.isFinite(q)) return;
                    const reason = q ? (await ask('Why?', { choices: [{ label: 'Not loaded / short', value: 'short' }, { label: 'Shop refused', value: 'refused' }, { label: 'Damaged in van', value: 'damaged', tone: 'danger' }] })) || 'short' : 'short';
                    setShort({ ...short, [key(inv, l.productId)]: { qty: Math.max(0, Math.min(q, l.qty)), reason } });
                  }}>{t('short')}</button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <button className="btn big primary block" onClick={toConfirm}><Check /> {t('delivered')}</button>
      <button className="btn big block ghost" style={{ marginTop: 8 }} onClick={async () => { if (await confirmBox('Shop refused everything?', 'All goods go back to the godown and a credit note is made.', 'Return all')) void confirmDelivery(true); }}><PackageX /> {t('returnAll')}</button>
    </div>
  );
}

function getPos(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { timeout: 4000, maximumAge: 60000 });
  });
}
