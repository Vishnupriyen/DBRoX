import { useEffect, useState } from 'react';
import { MapPin, ChevronRight, Phone, IndianRupee, PackageCheck, Store, AlertTriangle } from 'lucide-react';
import { ChangeSet, db, nowIso, session, today } from '../core/db';
import { shopOutstanding } from '../core/ledger';
import { inr, t } from '../core/i18n';
import type { Shop, Visit } from '../core/types';
import { OrderBook } from './OrderBook';
import { CollectShop } from './Collect';

interface Stop { shop: Shop; due: number; overdue: number; lastOrder?: string; visit?: Visit; billedToday: boolean }
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_TA = ['ஞாயிறு', 'திங்கள்', 'செவ்வாய்', 'புதன்', 'வியாழன்', 'வெள்ளி', 'சனி'];

// Salesman: today's beat. Overdue shops first (Q101); check-in by location (4.11); order or collect.
export function Beat({ lang }: { lang: 'en' | 'ta' }) {
  const [stops, setStops] = useState<Stop[]>([]);
  const [open, setOpen] = useState<{ stop: Stop; mode: 'order' | 'collect' } | null>(null);
  const [tick, setTick] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const dayIdx = new Date().getDay();

  useEffect(() => {
    (async () => {
      const me = session().userId;
      const shops = (await db.shops.toArray()).filter(s => s.salesmanId === me || !s.salesmanId);
      const visits = (await db.visits.where('date').equals(today()).toArray()).filter(v => v.staffId === me);
      const orders = await db.orders.toArray();
      const list: Stop[] = [];
      for (const shop of shops) {
        if (!showAll && shop.beat !== DAYS[dayIdx]) continue;
        const o = await shopOutstanding(shop.id);
        const mine = orders.filter(x => x.shopId === shop.id && x.status !== 'cancelled').sort((a, b) => b.date.localeCompare(a.date));
        list.push({ shop, due: o.total, overdue: o.maxOverdueDays, lastOrder: mine[0]?.date, visit: visits.find(v => v.shopId === shop.id), billedToday: mine[0]?.date === today() });
      }
      list.sort((a, b) => (b.overdue > 0 ? 1 : 0) - (a.overdue > 0 ? 1 : 0) || b.overdue - a.overdue || a.shop.name.localeCompare(b.shop.name));
      setStops(list);
    })();
  }, [tick, showAll, dayIdx]);

  const checkIn = async (stop: Stop) => {
    const pos = await getPos();
    const far = !!(pos && stop.shop.lat && stop.shop.lng) && dist(pos.lat, pos.lng, stop.shop.lat!, stop.shop.lng!) > 300;
    const cs = new ChangeSet();
    cs.put<Visit>('visits', { shopId: stop.shop.id, staffId: session().userId, date: today(), at: nowIso(), lat: pos?.lat, lng: pos?.lng, farFromShop: far } as Visit, 'check-in');
    await cs.commit('Shop visit');
    setTick(x => x + 1);
  };

  if (open?.mode === 'order') return <OrderBook shop={open.stop.shop} visit={open.stop.visit} onClose={() => { setOpen(null); setTick(x => x + 1); }} />;
  if (open?.mode === 'collect') return <CollectShop shop={{ ...open.stop.shop, due: open.stop.due }} onClose={() => { setOpen(null); setTick(x => x + 1); }} />;

  const done = stops.filter(s => s.billedToday || s.visit?.outcome).length;
  const totalDue = stops.reduce((a, s) => a + s.due, 0);
  return (
    <div className="stack">
      <div className="kpi navy">
        <div className="eyebrow" style={{ color: 'var(--on-navy-2)' }}>{lang === 'ta' ? DAYS_TA[dayIdx] : DAYS[dayIdx]} · {lang === 'ta' ? 'இன்றைய பீட்' : "Today's beat"}</div>
        <div className="row" style={{ marginTop: 6, gap: 18 }}>
          <div><div className="v">{done}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{stops.length}</span></div><div className="l">{lang === 'ta' ? 'கடைகள் முடிந்தது' : 'shops done'}</div></div>
          <div><div className="v">{inr(totalDue)}</div><div className="l">{lang === 'ta' ? 'வசூல் செய்ய' : 'to collect on this beat'}</div></div>
        </div>
      </div>
      <div className="sechead">
        <h3>{lang === 'ta' ? 'கடைகள் — பாக்கி உள்ளவை முதலில்' : 'Shops · late payers first'}</h3>
        <button className="link" onClick={() => setShowAll(x => !x)}>{showAll ? (lang === 'ta' ? 'இன்று மட்டும்' : 'Today only') : (lang === 'ta' ? 'எல்லா கடைகளும்' : 'All shops')}</button>
      </div>
      <div className="route">
        {stops.map(s => (
          <div key={s.shop.id} className={`stop card ${s.billedToday ? 'done' : s.visit ? 'now' : ''}`} style={{ padding: 12 }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div className={`avatar ${s.overdue > 0 ? 'bad' : s.billedToday ? 'ok' : ''}`}><Store size={22} /></div>
              <div className="grow">
                <div className="t">{s.shop.name}</div>
                <div className="s">{s.shop.area}{s.shop.owner ? ` · ${s.shop.owner}` : ''}{s.lastOrder ? ` · last order ${s.lastOrder.slice(5).replace('-', '/')}` : ''}</div>
                <div className="row" style={{ marginTop: 4 }}>
                  {s.due > 0.5 && <span className={`badge ${s.overdue > 0 ? 'bad' : ''}`}>{inr(s.due)} {s.overdue > 0 ? `· ${s.overdue}d late` : 'due'}</span>}
                  {s.shop.cashOnly && <span className="badge warn">Cash only</span>}
                  {s.billedToday && <span className="badge ok"><PackageCheck size={14} /> billed</span>}
                  {s.visit?.farFromShop && <span className="badge warn"><AlertTriangle size={14} /> far from shop</span>}
                </div>
              </div>
              {s.shop.phone && <a className="icon-btn" href={`tel:${s.shop.phone}`} aria-label="Call"><Phone /></a>}
            </div>
            <div className="row" style={{ marginTop: 10, flexWrap: 'nowrap' }}>
              {!s.visit
                ? <button className="btn block" onClick={() => checkIn(s)}><MapPin /> {lang === 'ta' ? 'கடையில் இருக்கிறேன்' : 'I\'m at the shop'}</button>
                : <>
                  <button className="btn primary grow" onClick={() => setOpen({ stop: s, mode: 'order' })}><ChevronRight /> {lang === 'ta' ? 'ஆர்டர்' : 'Order'}</button>
                  <button className="btn grow" onClick={() => setOpen({ stop: s, mode: 'collect' })}><IndianRupee /> {t('collect')}</button>
                </>}
            </div>
          </div>
        ))}
        {!stops.length && <div className="card muted">{lang === 'ta' ? 'இன்று இந்த பீட்டில் கடைகள் இல்லை.' : 'No shops on today\'s beat. Tap "All shops".'}</div>}
      </div>
    </div>
  );
}

export function getPos(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { timeout: 5000, maximumAge: 60000 });
  });
}
function dist(a: number, b: number, c: number, d: number) {
  const R = 6371000, toR = (x: number) => x * Math.PI / 180;
  const dLat = toR(c - a), dLng = toR(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
