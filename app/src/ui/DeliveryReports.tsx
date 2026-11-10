import { printPage } from '../core/files';
import { useEffect, useState } from 'react';
import { Check, Printer, MapPin, AlertTriangle, Truck } from 'lucide-react';
import { db, today } from '../core/db';
import { inr, plural } from '../core/i18n';
import { r2 } from '../core/ledger';
import type { Invoice, Product, Trip, Van } from '../core/types';


// ---------- Delivery status: today's bills with result, photos, distance ----------
export function DeliveryStatus() {
  const [rows, setRows] = useState<(Invoice & { shop: string })[]>([]);
  const [open, setOpen] = useState<Invoice | null>(null);
  useEffect(() => { (async () => { const shops = new Map((await db.shops.toArray()).map(s => [s.id, s.name])); setRows((await db.invoices.toArray()).filter(i => !i.cancelled && (i.date === today() || i.deliveryStatus !== 'delivered')).sort((a, b) => (b.delivery?.at ?? '').localeCompare(a.delivery?.at ?? '')).map(i => ({ ...i, shop: shops.get(i.shopId) ?? '' }))); })(); }, []);
  const st: Record<Invoice['deliveryStatus'], [string, string]> = { pending: ['Not planned yet', ''], planned: ['Planned', 'warn'], out: ['On the road', 'warn'], delivered: ['Delivered', 'ok'], partial: ['With differences', 'bad'], returned: ['Refused', 'bad'], undelivered: ['Not delivered', 'bad'] };
  if (open) return (
    <div className="stack">
      <button className="link" onClick={() => setOpen(null)}>← {'back'}</button>
      <div className="card stack">
        <div><b>{rows.find(r => r.id === open.id)?.shop}</b><div className="muted">{open.number} · {inr(open.total)} · {open.delivery?.at.slice(11, 16)}</div></div>
        <div className="row" style={{ gap: 8 }}>
          {open.delivery?.shopPhoto && <img src={open.delivery.shopPhoto} alt="Shop" style={{ width: 150, height: 110, objectFit: 'cover', borderRadius: 12 }} />}
          {open.delivery?.billPhoto && <img src={open.delivery.billPhoto} alt="Bill" style={{ width: 150, height: 110, objectFit: 'cover', borderRadius: 12 }} />}
        </div>
        <div className="muted"><MapPin size={14} style={{ verticalAlign: -2 }} /> {open.delivery?.lat ? `${open.delivery.lat.toFixed(5)}, ${open.delivery.lng?.toFixed(5)}` : 'no location'}{open.delivery?.distanceM != null && <span className={`badge ${open.delivery.distanceM > 150 ? 'bad' : 'ok'}`} style={{ marginLeft: 6 }}>{open.delivery.distanceM} m {'from shop'}</span>}</div>
        {open.delivery?.shortages.map(x => <div key={x.productId} className="row"><span className="grow">{x.productId}</span><span className="badge bad">−{x.qty} {x.reason}</span></div>)}
        {open.diffAction && <span className="badge">{open.diffAction === 'modified' ? 'bill revised' : 'credit note made'}</span>}
      </div>
    </div>
  );
  return (
    <div className="stack">
      <div className="list">
        {rows.map(r => <button key={r.id} className="item tap" onClick={() => r.delivery && setOpen(r)}>
          <div className={`avatar ${st[r.deliveryStatus][1]}`}>{r.deliveryStatus === 'delivered' ? <Check /> : r.deliveryStatus === 'partial' || r.deliveryStatus === 'returned' ? <AlertTriangle /> : <Truck size={20} />}</div>
          <div className="grow"><div className="t">{r.shop}</div><div className="s">{r.number} · {inr(r.total)}{r.delivery?.distanceM != null && r.delivery.distanceM > 150 ? ` · ${r.delivery.distanceM} m ${'away'}` : ''}</div></div>
          <span className={`badge ${st[r.deliveryStatus][1]}`}>{st[r.deliveryStatus][0]}</span>
        </button>)}
        {!rows.length && <div className="card muted">{'No bills today.'}</div>}
      </div>
    </div>
  );
}

// ---------- Trip reports: km planned vs actual, stops, idle, per van ----------
export function TripReports() {
  const [rows, setRows] = useState<{ t: Trip; van: string; stops: number; done: number; km: number; idleMin: number; fuel: number }[]>([]);
  useEffect(() => { (async () => {
    const vans = new Map((await db.vans.toArray()).map(v => [v.id, v.name]));
    const invs = await db.invoices.toArray();
    const exp = await db.expenses.toArray();
    const ts = (await db.trips.toArray()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
    setRows(ts.map(t => {
      let km = 0, idle = 0;
      for (let i = 1; i < t.track.length; i++) { const a = t.track[i - 1], b = t.track[i]; const d = Math.hypot((b.lat - a.lat) * 111, (b.lng - a.lng) * 111 * Math.cos(a.lat * Math.PI / 180)); km += d; if (d < 0.1) idle += (new Date(b.at).getTime() - new Date(a.at).getTime()) / 60000; }
      const ti = invs.filter(i => i.tripId === t.id);
      return { t, van: vans.get(t.vanId) ?? '', stops: t.stops.length, done: ti.filter(i => ['delivered', 'partial'].includes(i.deliveryStatus)).length, km: r2(km), idleMin: Math.round(idle), fuel: exp.filter(e => e.vanId === t.vanId && e.date === t.date && e.category === 'diesel').reduce((a, e) => a + e.amount, 0) };
    }));
  })(); }, []);
  return (
    <div className="stack">
      <table className="tbl"><thead><tr><th>{'Date'}</th><th>{'Van'}</th><th>{'Stops'}</th><th>km</th><th>{'Idle'}</th><th>{'Fuel'}</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.t.id}><td>{r.t.date.slice(5)}</td><td>{r.van}</td><td className="num">{r.done}/{r.stops}</td><td className="num">{r.km || '—'}</td><td className="num">{r.idleMin ? `${r.idleMin} min` : '—'}</td><td className="num">{r.fuel ? inr(r.fuel) : '—'}</td></tr>)}</tbody></table>
      {!rows.length && <div className="card muted">{'No trips yet.'}</div>}
      {rows.length > 0 && rows.every(r => r.t.track.length < 2) && <div className="alert warn"><AlertTriangle /><div>{'No GPS track recorded on these trips — km and idle time show "—". The driver\'s phone must keep location on during the trip.'}</div></div>}
      <div className="muted">{'km from the GPS track; fuel from expenses entered as "diesel" for that van and day.'}</div>
    </div>
  );
}

// ---------- Printable load sheet per van (A4): by product with tick boxes, then by stop ----------
export function PrintLoad() {
  const [trips, setTrips] = useState<(Trip & { van: Van; invs: Invoice[]; driver: string })[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [shops, setShops] = useState<Map<string, string>>(new Map());
  const [sel, setSel] = useState(0);
  useEffect(() => { (async () => {
    const vans = new Map((await db.vans.toArray()).map(v => [v.id, v])); const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
    const invs = await db.invoices.toArray();
    setTrips((await db.trips.where('date').equals(today()).toArray()).filter(t => t.status !== 'done').map(t => ({ ...t, van: vans.get(t.vanId)!, invs: invs.filter(i => i.tripId === t.id && !i.cancelled).sort((a, b) => (a.stopNo ?? 0) - (b.stopNo ?? 0)), driver: staff.get(t.driverId ?? '') ?? '' })));
    setProducts(new Map((await db.products.toArray()).map(p => [p.id, p]))); setShops(new Map((await db.shops.toArray()).map(s => [s.id, s.name])));
  })(); }, []);
  const t = trips[sel];
  if (!t) return <div className="card muted">{'No trip planned today. Confirm the delivery plan first.'}</div>;
  const byProduct = new Map<string, { p: Product; qty: number; batches: Map<string, number> }>();
  for (const i of t.invs) for (const l of i.lines) { const p = products.get(l.productId); if (!p) continue; const v = byProduct.get(p.id) ?? { p, qty: 0, batches: new Map() }; v.qty += l.qty + l.freeQty; for (const b of l.batches) v.batches.set(`${b.batch} · ${b.expiry.slice(0, 7)}`, (v.batches.get(`${b.batch} · ${b.expiry.slice(0, 7)}`) ?? 0) + b.qty); byProduct.set(p.id, v); }
  const stops = [...new Set(t.invs.map(i => i.shopId))];
  return (
    <div className="stack">
      <div className="row no-print" style={{ gap: 8 }}>
        {trips.length > 1 && <div className="segmented">{trips.map((x, k) => <button key={x.id} className={sel === k ? 'on' : ''} onClick={() => setSel(k)}>{x.van.name}</button>)}</div>}
        <button className="btn primary" onClick={() => void printPage()}><Printer /> {'Print'}</button>
      </div>
      <div className="card" style={{ background: '#fff', color: '#000' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 18 }}>LOAD SHEET · {t.van.name} {t.van.number}</b><span>{t.date} · {'Driver'}: {t.driver || '—'}</span></div>
        <div className="muted">{plural(t.invs.length, 'bill')} · {plural(stops.length, 'stop')} · {inr(t.invs.reduce((a, i) => a + i.total, 0))}</div>
        <h4 style={{ margin: '12px 0 4px' }}>A. {'By product'}</h4>
        <table className="tbl" style={{ background: '#fff' }}><thead><tr><th>☐</th><th>{'Product'}</th><th>{'Batch · expiry'}</th><th>{'Cases'}</th><th>{'Pcs'}</th></tr></thead>
          <tbody>{[...byProduct.values()].sort((a, b) => a.p.companyId.localeCompare(b.p.companyId) || a.p.name.localeCompare(b.p.name)).map(v => <tr key={v.p.id}><td style={{ fontSize: 18 }}>☐</td><td>{v.p.name}</td><td>{[...v.batches.entries()].map(([k, q]) => <div key={k}>{k} × {q}</div>)}</td><td className="num">{Math.floor(v.qty / v.p.caseSize) || ''}</td><td className="num">{v.qty % v.p.caseSize || (Math.floor(v.qty / v.p.caseSize) ? '' : v.qty)}</td></tr>)}</tbody></table>
        <h4 style={{ margin: '14px 0 4px' }}>B. {'By stop'}</h4>
        <table className="tbl" style={{ background: '#fff' }}><thead><tr><th>#</th><th>{'Shop'}</th><th>{'Bills'}</th><th>{'Pcs'}</th><th>₹</th><th>{'Sign'}</th></tr></thead>
          <tbody>{stops.map((sid, k) => { const si = t.invs.filter(i => i.shopId === sid); return <tr key={sid}><td>{k + 1}</td><td>{shops.get(sid)}</td><td>{si.map(i => i.number).join(', ')}</td><td className="num">{si.flatMap(i => i.lines).reduce((a, l) => a + l.qty + l.freeQty, 0)}</td><td className="num">{inr(si.reduce((a, i) => a + i.total, 0))}</td><td style={{ width: 90 }}></td></tr>; })}</tbody></table>
        <div className="muted" style={{ marginTop: 10 }}>{'Loaded by ________  Checked by ________  Van left at ______'}</div>
      </div>
    </div>
  );
}
