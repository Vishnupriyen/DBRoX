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
  const [mode, setMode] = useState<'ask' | 'rox' | 'me'>((localStorage.getItem('dbrox.planMode') as 'rox' | 'me') ?? 'ask');
  const [pending, setPending] = useState(0);
  useEffect(() => { db.vans.toArray().then(setVans); db.invoices.where('deliveryStatus').equals('pending').count().then(setPending); }, []);
  useEffect(() => {
    if (mode === 'rox') suggestPlan().then(setPlan);
    if (mode === 'me') suggestPlan().then(p => setPlan(p.map(x => ({ ...x, shops: [] as PlanSuggestion['shops'] })).concat([{ van: { id: '', name: L('Not planned', 'திட்டமிடவில்லை'), number: '', kind: 'own' } as Van, shops: p.flatMap(x => x.shops) }])));
  }, [mode]);
  const pick = (m: 'rox' | 'me') => { localStorage.setItem('dbrox.planMode', m); setMode(m); };
  if (mode === 'ask') return (
    <div className="stack">
      <div className="kpi navy"><div className="v">{pending}</div><div className="l">{L('bills ready for delivery', 'டெலிவரிக்கு தயார் பில்கள்')}</div></div>
      <div className="card stack" style={{ textAlign: 'center' }}>
        <div className="h">{L('How do you want to plan today?', 'இன்று எப்படி திட்டமிடலாம்?')}</div>
        <button className="btn primary big block" onClick={() => pick('rox')}><Navigation /> {L('RoX, suggest', 'RoX பரிந்துரை')}</button>
        <div className="muted">{L('Groups by area, fills each van by capacity and time, orders stops nearest-first. You can still move anything.', 'பகுதி வாரியாக, வண்டி திறன் படி, அருகில் முதலில். எதையும் மாற்றலாம்.')}</div>
        <button className="btn big block" onClick={() => pick('me')}><Truck /> {L("I'll make the route", 'நானே வழி அமைக்கிறேன்')}</button>
        <div className="muted">{L('You put each stop on a van; RoX only orders the stops.', 'நீங்கள் வண்டிக்கு கடை ஒதுக்குங்கள்; RoX வரிசை மட்டும்.')}</div>
      </div>
      <TodayTrips />
    </div>
  );
  if (!plan) return <div className="muted">…</div>;
  const move = (vi: number, si: number, dir: -1 | 1) => {
    const p = plan.map(x => ({ ...x, shops: [...x.shops] }));
    const arr = p[vi].shops; const j = si + dir; if (j < 0 || j >= arr.length) return;
    [arr[si], arr[j]] = [arr[j], arr[si]]; setPlan(p);
  };
  const toVan = (vi: number, si: number) => {
    const p = plan.map(x => ({ ...x, shops: [...x.shops] }));
    const stop = p[vi].shops.splice(si, 1)[0];
    const order = [...vans.map(v => v.id), ''];
    const next = order[(order.indexOf(p[vi].van.id) + 1) % order.length];
    let target = p.find(x => x.van.id === next);
    if (!target) { const v = vans.find(x => x.id === next); if (!v) return; target = { van: v, shops: [] }; p.push(target); }
    target.shops.push(stop); setPlan(p);
  };
  const unplanned = plan.find(x => x.van.id === '')?.shops.length ?? 0;
  const total = plan.reduce((a, p) => a + p.shops.length, 0);
  return (
    <div className="stack">
      <div className="sechead"><h3>{L('Delivery plan', 'டெலிவரி திட்டம்')} · {total - unplanned} {L('stops', 'நிறுத்தங்கள்')}</h3><button className="link" onClick={() => setMode('ask')}>{mode === 'rox' ? L('Suggested by RoX', 'RoX பரிந்துரை') : L('Your route', 'உங்கள் வழி')} · {L('change', 'மாற்று')}</button></div>
      {unplanned > 0 && <div className="alert"><Clock /><div>{unplanned} {L('stop(s) not on any van yet — tap ⇄ to move them', 'நிறுத்தங்கள் வண்டியில் இல்லை — ⇄ தட்டி நகர்த்தவும்')}</div></div>}
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
                <button className="icon-btn" style={{ width: 40, height: 40 }} onClick={() => toVan(vi, si)} aria-label="Other van"><ArrowRightLeft /></button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {!plan.length && <div className="card muted">{L('No bills waiting for delivery.', 'டெலிவரிக்கு பில் இல்லை.')}</div>}
      {plan.length > 0 && <button className="btn primary big block" disabled={total - unplanned === 0} onClick={async () => { await confirmPlan(plan.filter(x => x.van.id)); onDone(); }}><Check /> {L('Confirm plan → load sheets', 'உறுதி → லோடு ஷீட்')}{unplanned ? ` (${unplanned} ${L('wait for tomorrow', 'நாளைக்கு')})` : ''}</button>}
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
