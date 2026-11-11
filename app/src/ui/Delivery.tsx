import { useEffect, useMemo, useState } from 'react';
import { PhotoButton } from './PhotoButton';
import { Check, ArrowLeft, PackageX, Navigation, Flag } from 'lucide-react';
import { endTrip, startTrip, trackPoint, recordDelivery, DELIVERY_REASONS } from '../core/pipeline';
import { Pack } from './Pack';
import { ChangeSet, db, getSettings, session, today } from '../core/db';
import { PayBox } from './PayBox';
import { r2 } from '../core/ledger';
import { inr, t } from '../core/i18n';
import type { Invoice, Product, Shop, Trip } from '../core/types';
import { ask, askText, confirmBox } from './dialog';
import { useBack } from './useBack';

interface Stop { shop: Shop; invoices: Invoice[] }

// TESRAX Delivery: the driver's trip. Start trip → stops in order → Delivered ✓ / Short / Return → end trip.
// While the trip is out, the phone sends its location every 30 s so the owner sees the van live.
export function Delivery() {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [stops, setStops0] = useState<Stop[]>([]);
  const [loaded, setLoaded] = useState(false); // until the first load ends, say so — never "nothing here"
  const setStops: typeof setStops0 = v => { setLoaded(true); setStops0(v); };
  const [open, setOpen] = useState<Stop | null>(null);
  const [tick, setTick] = useState(0);
  const [ending, setEnding] = useState(false);
  useBack(() => { if (open) { setOpen(null); setTick(x => x + 1); return true; } if (ending) { setEnding(false); return true; } return false; });
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
          <div><div className="v">{stops.length ? <>{done}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{stops.length}</span></> : '—'}</div><div className="l">{t('delivery')} · {trip ? (trip.status === 'out' ? 'on the road' : trip.status === 'loaded' ? 'loaded, ready to go' : 'being loaded') : 'no trip today'}</div></div>
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
        {!loaded && <div className="card muted">{'Loading…'}</div>}
      {loaded && !stops.length && <div className="card"><div className="t">{'No deliveries for you yet'}</div><div className="muted" style={{ marginTop: 4 }}>{'When the office plans today\'s trip and puts you on a van, your shops appear here in route order. Collections you take are under Collect.'}</div></div>}
      </div>
      {trip?.status === 'out' && <button className="btn big block" onClick={() => setEnding(true)}><Flag /> {'End trip'}{left.length ? ` (${left.length} ${'not delivered'})` : ''}</button>}
    </div>
  );
}

function EndTrip({ trip, stops, onDone }: { trip: Trip; stops: Stop[]; onDone: () => void }) {
  const [what, setWhat] = useState<Record<string, 'godown' | 'van' | 'next'>>({});
  return (
    <div className="stack">
      <div className="sechead"><h3>{'End trip'}</h3></div>
      {stops.map(s => (
        <div key={s.shop.id} className="card">
          <b>{s.shop.name}</b> <span className="muted">· {'not delivered. Goods are:'}</span>
          <div className="segmented" style={{ marginTop: 8 }}>
            {([['godown', 'Back in godown'], ['van', 'Kept in van'], ['next', 'Next visit']] as const).map(([k, l]) => <button key={k} className={(what[s.invoices[0].id] ?? 'next') === k ? 'on' : ''} onClick={() => setWhat(w => { const n = { ...w }; for (const i of s.invoices) n[i.id] = k; return n; })}>{l}</button>)}
          </div>
        </div>
      ))}
      {!stops.length && <div className="card ok" style={{ background: 'var(--ok-soft)' }}>{'Every stop done.'} 🎉</div>}
      <button className="btn primary big block" onClick={async () => { await endTrip(trip.id, what); onDone(); }}><Check /> {'Trip over — back at godown'}</button>
      <button className="btn ghost block" onClick={onDone}>{t('cancel')}</button>
    </div>
  );
}

const REASONS = DELIVERY_REASONS;

function StopView({ stop, onClose }: { stop: Stop; onClose: () => void }) {
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [short, setShort] = useState<Record<string, { qty: number; reason: string }>>({});
  const [extra, setExtra] = useState<Record<string, number>>({});
  const [step, setStep] = useState<'items' | 'confirm' | 'pay' | 'done'>('items');
  const [paid, setPaid] = useState<{ amount: number; mode: string } | null>(null);
  const [shopPhoto, setShopPhoto] = useState<string>();
  const [billPhoto, setBillPhoto] = useState<string>();
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [grn, setGrn] = useState(true);
  useBack(() => { if (step === 'confirm') { setStep('items'); return true; } return false; });
  useEffect(() => { db.products.toArray().then(ps => setProducts(new Map(ps.map(p => [p.id, p])))); getSettings().then(s => setGrn(s.grnPhoto !== false)); }, [stop]);

  const key = (inv: Invoice, pid: string) => `${inv.id}|${pid}`;
  const shortValue = useMemo(() => {
    let v = 0;
    for (const inv of stop.invoices) for (const l of inv.lines) { const s = short[key(inv, l.productId)]; if (s?.qty) v += Math.min(s.qty, l.qty) * (l.total / (l.qty || 1)); }
    return r2(v);
  }, [short, stop]);
  const extraValue = useMemo(() => { let v = 0; for (const inv of stop.invoices) for (const l of inv.lines) { const e = extra[key(inv, l.productId)]; if (e) v += e * (l.total / (l.qty || 1)); } return r2(v); }, [extra, stop]);
  const billTotal = r2(stop.invoices.reduce((a, i) => a + i.total, 0));
  const delivered = r2(billTotal - shortValue + extraValue);
  const distanceM = pos && stop.shop.lat && stop.shop.lng ? Math.round(Math.hypot((pos.lat - stop.shop.lat) * 111000, (pos.lng - stop.shop.lng) * 111000 * Math.cos(pos.lat * Math.PI / 180))) : undefined;

  const takeShopPhoto = async (p: string) => { setShopPhoto(p); setPos(await getPos()); };

  // Delivered: record what the shop accepted. No credit note here — the owner chooses modified bill / credit note at day close.
  const confirmDelivery = async (returnAll = false) => {
    // shop location fills itself from the first delivery
    if (pos && !stop.shop.lat) { const cs = new ChangeSet(); cs.put('shops', { ...stop.shop, lat: pos.lat, lng: pos.lng }, 'location from delivery'); await cs.commit('Shop location'); }
    await recordDelivery(stop.invoices.map(i => i.id), { returnAll, short, extra, shopPhoto, billPhoto, pos, distanceM });
    if (returnAll) { setStep('done'); return; }
    setStep('pay');
  };

  if (step === 'done') return (
    <div className="stack" style={{ textAlign: 'center', paddingTop: 30 }}>
      <div className="avatar ok" style={{ width: 96, height: 96, margin: '0 auto', borderRadius: 28 }}><Check size={56} /></div>
      <h2>{stop.shop.name}</h2>
      {paid && <div className="amt num" style={{ fontSize: 22 }}>{inr(paid.amount)} {'by'} {paid.mode === 'upi' ? 'UPI' : paid.mode === 'cheque' ? 'cheque' : 'cash'}</div>}
      <button className="btn big primary block" onClick={onClose}>{'Next shop →'}</button>
    </div>
  );

  if (step === 'pay') return (
    <div className="stack">
      <div className="sechead"><h3>{t('collect')} · {stop.shop.name}</h3></div>
      <PayBox shop={stop.shop} preferInvoiceIds={stop.invoices.map(i => i.id)} onDone={p => { setPaid(p ?? null); setStep('done'); }} onSkip={() => setStep('done')} />
    </div>
  );

  if (step === 'confirm') {
    const ready = !!shopPhoto && (!grn || !!billPhoto);
    return (
      <div>
        <div className="sechead"><h3>{stop.shop.name}</h3></div>
        <div className="card stack" style={{ textAlign: 'center' }}>
          <div className="eyebrow">{'Goods delivered'}</div>
          <div className="num" style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}>{inr(delivered)}</div>
          {shortValue > 0 && <div><span className="badge warn">{'Short'} {inr(shortValue)}</span></div>}
          {extraValue > 0 && <div><span className="badge warn">{'Extra'} {inr(extraValue)}</span></div>}
          <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <div className="stack" style={{ gap: 4 }}><PhotoButton facing="environment" onPhoto={takeShopPhoto} label={'1. Shop photo'} />{shopPhoto && <span className="muted" style={{ fontSize: 12 }}>{pos ? (distanceM != null ? `${distanceM} m ${'from shop'}` : 'location saved') : 'no GPS — marked'}</span>}</div>
            {grn && <PhotoButton facing="environment" onPhoto={setBillPhoto} label={'2. Signed bill / GRN'} />}
          </div>
          <p className="muted" style={{ margin: 0 }}>{t('shopConfirm')}</p>
          <button className="btn ok-huge" disabled={!ready} onClick={() => confirmDelivery(false)} aria-label="Shop confirms delivery">{'Goods received'} <Check size={40} /></button>
          {!ready && <div className="muted" style={{ fontSize: 12 }}>{grn ? 'Both photos are needed' : 'Shop photo is needed'}</div>}
          <button className="btn ghost" onClick={() => setStep('items')}><ArrowLeft /> {'Back'}</button>
        </div>
      </div>
    );
  }

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
              const s = short[key(inv, l.productId)]; const e = extra[key(inv, l.productId)];
              return (
                <div className="item" key={l.productId}>
                  {p ? <Pack product={p} /> : <div className="avatar">?</div>}
                  <div className="grow">
                    <div className="t">{l.name}</div>
                    <div className="s">MRP {l.mrp}</div>
                    <div className="row" style={{ marginTop: 4 }}>
                      <span className="badge navy">{l.qty + l.freeQty} pcs{l.freeQty ? ` (${l.freeQty} free)` : ''}</span>
                      {s?.qty ? <span className="badge bad">−{s.qty} {REASONS.find(r => r.value === s.reason)?.label}</span> : null}
                      {e ? <span className="badge warn">+{e} extra</span> : null}
                    </div>
                  </div>
                  <div className="stack" style={{ gap: 4 }}>
                    <button className="btn small" onClick={async () => {
                      const raw = await askText(`${t('short')}: ${l.name} — ${'how many pieces?'}`, String(s?.qty ?? ''), 'number');
                      if (raw == null) return; const q = Number(raw); if (!Number.isFinite(q)) return;
                      const reason = q ? (await ask('Why?', { choices: [{ label: 'Not loaded / short', value: 'short' }, { label: 'Shop refused', value: 'refused' }, { label: 'Damaged in van', value: 'damaged', tone: 'danger' }] })) || 'short' : 'short';
                      setShort({ ...short, [key(inv, l.productId)]: { qty: Math.max(0, Math.min(q, l.qty)), reason } });
                    }}>{t('short')}</button>
                    <button className="btn small" onClick={async () => { const raw = await askText(`${'Extra pieces of'} ${l.name} ${'given from the van?'}`, String(e ?? ''), 'number'); if (raw == null) return; setExtra({ ...extra, [key(inv, l.productId)]: Math.max(0, Number(raw) || 0) }); }}>{'Extra'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <button className="btn big primary block" onClick={() => setStep('confirm')}><Check /> {t('delivered')}</button>
      <button className="btn big block ghost" style={{ marginTop: 8 }} onClick={async () => { if (await confirmBox('Shop refused everything?', 'All goods go back to the godown. The owner decides the bill at day close.', 'Refused')) void confirmDelivery(true); }}><PackageX /> {t('returnAll')}</button>
    </div>
  );
}

function getPos(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { timeout: 4000, maximumAge: 60000 });
  });
}
