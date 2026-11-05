import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Truck, ArrowRightLeft, Navigation, Clock } from 'lucide-react';
import { db, today } from '../core/db';
import { confirmPlan, suggestPlan, type PlanSuggestion } from '../core/pipeline';
import { getLang, inr } from '../core/i18n';
import type { Invoice, Trip, Van } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);

// Owner: the system suggests van + stop order for every pending bill; owner moves stops, confirms → trips.
export function Plan({ onDone }: { onDone: () => void }) {
  const [plan, setPlan] = useState<PlanSuggestion[] | null>(null);
  const [vans, setVans] = useState<Van[]>([]);
  useEffect(() => { suggestPlan().then(setPlan); db.vans.toArray().then(setVans); }, []);
  if (!plan) return <div className="muted">…</div>;
  const move = (vi: number, si: number, dir: -1 | 1) => {
    const p = plan.map(x => ({ ...x, shops: [...x.shops] }));
    const arr = p[vi].shops; const j = si + dir; if (j < 0 || j >= arr.length) return;
    [arr[si], arr[j]] = [arr[j], arr[si]]; setPlan(p);
  };
  const toVan = (vi: number, si: number) => {
    const p = plan.map(x => ({ ...x, shops: [...x.shops] }));
    const stop = p[vi].shops.splice(si, 1)[0];
    const others = vans.filter(v => v.id !== p[vi].van.id);
    if (!others.length) return;
    let target = p.find(x => x.van.id === others[0].id);
    if (!target) { target = { van: others[0], shops: [] }; p.push(target); }
    target.shops.push(stop); setPlan(p.filter(x => x.shops.length));
  };
  const total = plan.reduce((a, p) => a + p.shops.length, 0);
  return (
    <div className="stack">
      <div className="sechead"><h3>{L('Delivery plan', 'டெலிவரி திட்டம்')} · {total} {L('stops', 'நிறுத்தங்கள்')}</h3><span className="muted">{L('Suggested by RoX', 'RoX பரிந்துரை')}</span></div>
      {plan.map((p, vi) => (
        <div key={p.van.id} className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b style={{ fontSize: 17 }}><Truck size={18} style={{ verticalAlign: -3 }} /> {p.van.name} <span className="muted">{p.van.number}</span></b>
            <span className="badge navy">{p.shops.length} {L('stops', 'நிறுத்தம்')} · {inr(p.shops.reduce((a, s) => a + s.value, 0))}</span>
          </div>
          <div className="route">
            {p.shops.map((s, si) => (
              <div key={s.shop.id} className="stop row" style={{ flexWrap: 'nowrap', minHeight: 48 }}>
                <span className="badge">{si + 1}</span>
                <div className="grow"><div className="t">{s.shop.name}</div><div className="s">{s.shop.area} · {s.invoices.length} {L('bill', 'பில்')} · {inr(s.value)}</div></div>
                <button className="icon-btn" style={{ width: 40, height: 40 }} onClick={() => move(vi, si, -1)} aria-label="Up"><ChevronUp /></button>
                <button className="icon-btn" style={{ width: 40, height: 40 }} onClick={() => move(vi, si, 1)} aria-label="Down"><ChevronDown /></button>
                {vans.length > 1 && <button className="icon-btn" style={{ width: 40, height: 40 }} onClick={() => toVan(vi, si)} aria-label="Other van"><ArrowRightLeft /></button>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {!plan.length && <div className="card muted">{L('No bills waiting for delivery.', 'டெலிவரிக்கு பில் இல்லை.')}</div>}
      {plan.length > 0 && <button className="btn primary big block" onClick={async () => { await confirmPlan(plan); onDone(); }}><Check /> {L('Confirm plan → load sheets', 'உறுதி → லோடு ஷீட்')}</button>}
      <TodayTrips />
    </div>
  );
}

function TodayTrips() {
  const [trips, setTrips] = useState<(Trip & { van: string; n: number })[]>([]);
  useEffect(() => { (async () => { const vans = new Map((await db.vans.toArray()).map(v => [v.id, v.name])); const ts = await db.trips.where('date').equals(today()).toArray(); setTrips(ts.map(t => ({ ...t, van: vans.get(t.vanId) ?? '', n: t.stops.length }))); })(); }, []);
  if (!trips.length) return null;
  const st: Record<Trip['status'], string> = { planned: L('to load', 'ஏற்ற வேண்டும்'), loaded: L('loaded', 'ஏற்றப்பட்டது'), out: L('on the road', 'சாலையில்'), done: L('done', 'முடிந்தது') };
  return (
    <div className="card">
      <div className="sechead"><h3>{L("Today's trips", 'இன்றைய டிரிப்')}</h3></div>
      {trips.map(t => <div key={t.id} className="row" style={{ justifyContent: 'space-between', minHeight: 40 }}><b>{t.van}</b><span><span className="badge">{t.n} {L('stops', 'நிறுத்தம்')}</span> <span className={`badge ${t.status === 'out' ? 'ok' : t.status === 'done' ? '' : 'warn'}`}>{t.status === 'out' ? <Navigation size={12} /> : <Clock size={12} />} {st[t.status]}</span></span></div>)}
    </div>
  );
}

export type { Invoice };
