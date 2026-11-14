import { useEffect, useState } from 'react';
import { Navigation, Check, Clock, Truck, AlertTriangle, Flag } from 'lucide-react';
import { ownerEndTrip } from '../core/pipeline';
import { confirmBox } from './dialog';
import { LiveMap, VAN_COLORS, type MapVan } from './LiveMap';
import { getSettings } from '../core/db';
import { db, today } from '../core/db';
import { inr } from '../core/i18n';
import type { Invoice, Shop, Trip } from '../core/types';

interface Row { trip: Trip; van: string; driver: string; stops: { name: string; status: Invoice['deliveryStatus']; value: number; shop?: Shop }[]; lastSeen?: string; alerts: string[] }

// Fixed rules, no settings (spec 15.1 Delivery): off route > 800 m from the line between last and next stop for 5 min;
// idle > 20 min away from any planned stop; phone off = no point for 10 min. One 45-minute break between 12:00 and 15:00 is not flagged.
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) { return Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180)); }
function alertsFor(t: Trip, stops: { status: Invoice['deliveryStatus']; shop?: Shop }[]): string[] {
  if (t.status !== 'out') return [];
  const out: string[] = []; const tr = t.track; const now = Date.now();
  if (!tr.length) return ['no location yet'];
  const last = tr[tr.length - 1]; const silent = (now - new Date(last.at).getTime()) / 60000;
  if (silent > 10) out.push(`phone off / no signal for ${Math.round(silent)} min`);
  // idle: all points in the last 20 min within 100 m, and not near a planned stop
  const recent = tr.filter(p => now - new Date(p.at).getTime() <= 20 * 60000);
  if (recent.length >= 2 && (new Date(recent[recent.length - 1].at).getTime() - new Date(recent[0].at).getTime()) >= 19 * 60000) {
    const spread = Math.max(...recent.map(p => km(p, recent[0])));
    const nearStop = stops.some(s => s.shop?.lat && s.shop.lng && km(last, { lat: s.shop.lat, lng: s.shop.lng }) < 0.15);
    const h = new Date(last.at).getHours(); const lunch = h >= 12 && h < 15 && (now - new Date(recent[0].at).getTime()) <= 45 * 60000;
    if (spread < 0.1 && !nearStop && !lunch) out.push('stopped 20+ min at an unplanned place');
  }
  // off route: distance from the segment between the last done stop and the next stop
  const done = stops.filter(s => ['delivered', 'partial', 'returned'].includes(s.status)); const next = stops.find(s => !['delivered', 'partial', 'returned'].includes(s.status));
  const a = done[done.length - 1]?.shop; const b = next?.shop;
  if (a?.lat && a.lng && b?.lat && b.lng) {
    const seg = km({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    const d = Math.min(km(last, { lat: a.lat, lng: a.lng }), km(last, { lat: b.lat, lng: b.lng }));
    const off = d - seg * 0.5 > 0.8 && km(last, { lat: a.lat, lng: a.lng }) + km(last, { lat: b.lat, lng: b.lng }) - seg > 0.8;
    const offFor = tr.filter(p => now - new Date(p.at).getTime() <= 5 * 60000).every(p => km(p, { lat: a.lat!, lng: a.lng! }) + km(p, { lat: b.lat!, lng: b.lng! }) - seg > 0.8);
    if (off && offFor) out.push(`off route between ${a.name} and ${b.name}`);
  }
  return out;
}

// Owner: where every van is right now, which stop it is on, last location time. Refreshes itself.
export function Live() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tick, setTick] = useState(0);
  const [godown, setGodown] = useState<[number, number] | undefined>();
  useEffect(() => { void getSettings().then(st => { if (st.godownLat != null && st.godownLng != null) setGodown([st.godownLat, st.godownLng]); }); }, []);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const trips = (await db.trips.where('date').equals(today()).toArray()).filter(t => t.status !== 'planned');
      const vans = new Map((await db.vans.toArray()).map(v => [v.id, v.name]));
      const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
      const invs = await db.invoices.toArray();
      const out: Row[] = trips.map(t => {
        const stops = t.stops.map(sid => { const si = invs.filter(i => i.tripId === t.id && i.shopId === sid); return { name: shops.get(sid)?.name ?? '', shop: shops.get(sid), status: si[0]?.deliveryStatus ?? 'planned', value: si.reduce((a, i) => a + i.total, 0) }; });
        return { trip: t, van: vans.get(t.vanId) ?? '', driver: staff.get(t.driverId ?? '') ?? '—', stops, lastSeen: t.track[t.track.length - 1]?.at, alerts: alertsFor(t, stops) };
      });
      if (alive) setRows(out);
    };
    load(); const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, [tick]);
  const vans: MapVan[] = rows.map((r, i) => ({ id: r.trip.id, label: r.van || r.driver, color: VAN_COLORS[i % VAN_COLORS.length], track: r.trip.track,
    stops: r.stops.filter(s => s.shop?.lat != null && s.shop?.lng != null).map(s => ({ lat: s.shop!.lat!, lng: s.shop!.lng!, done: ['delivered', 'partial', 'returned'].includes(s.status), name: s.name })) }));
  return (
    <div className="stack live-page">
      <div className="sechead"><h3>{'Live vans'}</h3><span className="muted">{'updates every 10 s'}</span></div>
      <LiveMap vans={vans} godown={godown} />
      {rows.map((r, ri) => {
        const done = r.stops.filter(s => ['delivered', 'partial', 'returned'].includes(s.status)).length;
        const cur = r.stops.find(s => s.status === 'out');
        const mins = r.lastSeen ? Math.round((Date.now() - new Date(r.lastSeen).getTime()) / 60000) : null;
        return (
          <div key={r.trip.id} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b style={{ fontSize: 'var(--f4)' }}><Truck size={18} style={{ verticalAlign: -3, color: VAN_COLORS[ri % VAN_COLORS.length] }} /> {r.van} <span className="muted">· {r.driver}</span></b>
              <span className={`badge ${r.trip.status === 'out' ? 'ok' : r.trip.status === 'done' ? '' : 'warn'}`}>{r.trip.status === 'out' ? <><Navigation size={12} /> {'on the road'}</> : r.trip.status === 'done' ? 'back' : 'loading'}</span>
            </div>
            <div className="row" style={{ gap: 14 }}>
              <div><div className="eyebrow">{'Stops'}</div><div className="num" style={{ fontSize: 'var(--f5)', fontWeight: 800 }}>{done}<span className="muted" style={{ fontSize: 'var(--f2)' }}>/{r.stops.length}</span></div></div>
              <div><div className="eyebrow">{'Now at'}</div><div style={{ fontWeight: 700 }}>{cur?.name ?? (r.trip.status === 'done' ? 'Godown' : '—')}</div></div>
              <div><div className="eyebrow">{'Last location'}</div><div style={{ fontWeight: 700 }}>{mins == null ? '—' : mins < 1 ? 'just now' : `${mins} ${'min ago'}`}</div></div>
            </div>
            {r.alerts.map((a, i) => <div key={i} className="alert bad"><AlertTriangle /><div>{a}</div></div>)}
            <Track trip={r.trip} />
            <div className="route">
              {r.stops.map((s, k) => (
                <div key={k} className={`stop row ${['delivered', 'partial', 'returned'].includes(s.status) ? 'done' : s.status === 'out' && k === done ? 'now' : ''}`} style={{ minHeight: 36, flexWrap: 'nowrap' }}>
                  <span className="grow">{s.name}</span><span className="muted">{inr(s.value)}</span>
                  {['delivered', 'partial', 'returned'].includes(s.status) ? <Check size={16} style={{ color: 'var(--ok)' }} /> : <Clock size={16} style={{ color: 'var(--ink-3)' }} />}
                </div>
              ))}
            </div>
            {r.trip.status !== 'done' && <button className="btn small" onClick={async () => { if (await confirmBox(r.trip.status === 'out' ? 'End this trip now?' : 'Cancel this trip?', 'Undelivered bills go back to the pool for tomorrow.', 'Yes')) { await ownerEndTrip(r.trip.id); setTick(x => x + 1); } }}><Flag size={14} /> {r.trip.status === 'out' ? 'End trip (driver forgot)' : 'Cancel trip'}</button>}
          </div>
        );
      })}
      {!rows.length && <div className="card muted">{'No van has left yet today.'}</div>}
    </div>
  );
}

// Simple trace of the van's path from the driver's phone (no map tiles needed; works offline).
function Track({ trip }: { trip: Trip }) {
  const pts = trip.track;
  if (pts.length < 2) return null;
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  const minLa = Math.min(...lats), maxLa = Math.max(...lats), minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
  const W = 320, H = 110, pad = 10;
  const sx = (lo: number) => pad + (maxLo === minLo ? W / 2 : (lo - minLo) / (maxLo - minLo) * (W - 2 * pad));
  const sy = (la: number) => H - pad - (maxLa === minLa ? H / 2 : (la - minLa) / (maxLa - minLa) * (H - 2 * pad));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.lng).toFixed(1)} ${sy(p.lat).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 420, background: 'var(--paper-2)', borderRadius: 12 }} aria-label="Van path">
      <path d={d} fill="none" stroke="var(--navy)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".6" />
      <circle cx={sx(pts[0].lng)} cy={sy(pts[0].lat)} r="5" fill="var(--ink-3)" />
      <circle cx={sx(last.lng)} cy={sy(last.lat)} r="7" fill="var(--marigold)" stroke="var(--navy)" strokeWidth="2" />
    </svg>
  );
}
