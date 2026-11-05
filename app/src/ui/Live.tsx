import { useEffect, useState } from 'react';
import { Navigation, Check, Clock, Truck } from 'lucide-react';
import { db, today } from '../core/db';
import { getLang, inr } from '../core/i18n';
import type { Invoice, Trip } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);
interface Row { trip: Trip; van: string; driver: string; stops: { name: string; status: Invoice['deliveryStatus']; value: number }[]; lastSeen?: string }

// Owner: where every van is right now, which stop it is on, last location time. Refreshes itself.
export function Live() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const trips = (await db.trips.where('date').equals(today()).toArray()).filter(t => t.status !== 'planned');
      const vans = new Map((await db.vans.toArray()).map(v => [v.id, v.name]));
      const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s.name]));
      const invs = await db.invoices.toArray();
      const out: Row[] = trips.map(t => ({
        trip: t, van: vans.get(t.vanId) ?? '', driver: staff.get(t.driverId ?? '') ?? '—',
        stops: t.stops.map(sid => { const si = invs.filter(i => i.tripId === t.id && i.shopId === sid); return { name: shops.get(sid) ?? '', status: si[0]?.deliveryStatus ?? 'planned', value: si.reduce((a, i) => a + i.total, 0) }; }),
        lastSeen: t.track[t.track.length - 1]?.at,
      }));
      if (alive) setRows(out);
    };
    load(); const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return (
    <div className="stack">
      <div className="sechead"><h3>{L('Live vans', 'வண்டிகள் இப்போது')}</h3><span className="muted">{L('updates every 10 s', '10 வினாடிக்கு ஒருமுறை')}</span></div>
      {rows.map(r => {
        const done = r.stops.filter(s => ['delivered', 'partial', 'returned'].includes(s.status)).length;
        const cur = r.stops.find(s => s.status === 'out');
        const mins = r.lastSeen ? Math.round((Date.now() - new Date(r.lastSeen).getTime()) / 60000) : null;
        return (
          <div key={r.trip.id} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b style={{ fontSize: 17 }}><Truck size={18} style={{ verticalAlign: -3 }} /> {r.van} <span className="muted">· {r.driver}</span></b>
              <span className={`badge ${r.trip.status === 'out' ? 'ok' : r.trip.status === 'done' ? '' : 'warn'}`}>{r.trip.status === 'out' ? <><Navigation size={12} /> {L('on the road', 'சாலையில்')}</> : r.trip.status === 'done' ? L('back', 'திரும்பியது') : L('loading', 'ஏற்றுகிறது')}</span>
            </div>
            <div className="row" style={{ gap: 14 }}>
              <div><div className="eyebrow">{L('Stops', 'நிறுத்தம்')}</div><div className="num" style={{ fontSize: 22, fontWeight: 800 }}>{done}<span className="muted" style={{ fontSize: 14 }}>/{r.stops.length}</span></div></div>
              <div><div className="eyebrow">{L('Now at', 'இப்போது')}</div><div style={{ fontWeight: 700 }}>{cur?.name ?? (r.trip.status === 'done' ? L('Godown', 'கிடங்கு') : '—')}</div></div>
              <div><div className="eyebrow">{L('Last location', 'கடைசி இடம்')}</div><div style={{ fontWeight: 700 }}>{mins == null ? '—' : mins < 1 ? L('just now', 'இப்போது') : `${mins} ${L('min ago', 'நிமிடம் முன்')}`}</div></div>
            </div>
            <Track trip={r.trip} />
            <div className="route">
              {r.stops.map((s, k) => (
                <div key={k} className={`stop row ${['delivered', 'partial', 'returned'].includes(s.status) ? 'done' : s.status === 'out' && k === done ? 'now' : ''}`} style={{ minHeight: 36, flexWrap: 'nowrap' }}>
                  <span className="grow">{s.name}</span><span className="muted">{inr(s.value)}</span>
                  {['delivered', 'partial', 'returned'].includes(s.status) ? <Check size={16} style={{ color: 'var(--ok)' }} /> : <Clock size={16} style={{ color: 'var(--ink-3)' }} />}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {!rows.length && <div className="card muted">{L('No van has left yet today.', 'இன்று எந்த வண்டியும் இன்னும் கிளம்பவில்லை.')}</div>}
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
