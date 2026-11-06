import { useEffect, useState } from 'react';
import { Check, Truck, Navigation, Clock } from 'lucide-react';
import { ask } from './dialog';
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
  // one tap on a stop → a small menu: up, down, another van, tomorrow. No arrow clutter.
  const stopMenu = async (vi: number, si: number) => {
    const p = plan.map(x => ({ ...x, shops: [...x.shops] }));
    const here = p[vi]; const stop = here.shops[si];
    const choices: { label: string; value: string }[] = [];
    if (si > 0) choices.push({ label: L('↑ Earlier', '↑ முன்னே'), value: 'up' });
    if (si < here.shops.length - 1) choices.push({ label: L('↓ Later', '↓ பின்னே'), value: 'down' });
    for (const v of vans) if (v.id !== here.van.id) choices.push({ label: `→ ${v.name}`, value: `van:${v.id}` });
    if (here.van.id !== '') choices.push({ label: L('Tomorrow', 'நாளைக்கு'), value: 'van:' });
    const r = await ask(stop.shop.name, { message: `${stop.invoices.length} ${L('bill', 'பில்')} · ${inr(stop.value)}`, choices });
    if (!r) return;
    if (r === 'up' || r === 'down') { const j = si + (r === 'up' ? -1 : 1); [here.shops[si], here.shops[j]] = [here.shops[j], here.shops[si]]; setPlan(p); return; }
    const id = r.slice(4);
    here.shops.splice(si, 1);
    let target = p.find(x => x.van.id === id);
    if (!target) { const v = id ? vans.find(x => x.id === id) : ({ id: '', name: L('Tomorrow', 'நாளைக்கு'), number: '', kind: 'own' } as Van); if (!v) return; target = { van: v, shops: [] }; p.push(target); }
    target.shops.push(stop); setPlan(p);
  };
  const unplanned = plan.find(x => x.van.id === '')?.shops.length ?? 0;
  const total = plan.reduce((a, p) => a + p.shops.length, 0);
  const bills = plan.reduce((a, p) => a + p.shops.reduce((b, s) => b + s.invoices.length, 0), 0);
  const billsToday = plan.filter(x => x.van.id).reduce((a, p) => a + p.shops.reduce((b, s) => b + s.invoices.length, 0), 0);
  const km = (p: PlanSuggestion) => { let d = 0; for (let i = 1; i < p.shops.length; i++) { const a = p.shops[i - 1].shop, b = p.shops[i].shop; if (a.lat && a.lng && b.lat && b.lng) d += Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180)); } return d ? `${d.toFixed(1)} km` : ''; };
  return (
    <div className="stack">
      <div className="kpi navy">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><div className="v">{billsToday}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{bills} {L('bills', 'பில்')}</span></div><div className="l">{L('today', 'இன்று')} · {plan.filter(x => x.van.id && x.shops.length).length} {L('van(s)', 'வண்டி')} · {total - unplanned} {L('stops', 'நிறுத்தம்')}{unplanned ? ` · ${unplanned} ${L('tomorrow', 'நாளைக்கு')}` : ''}</div></div>
          <button className="btn small" style={{ background: 'transparent', color: 'var(--on-navy)', borderColor: 'var(--on-navy-2)' }} onClick={() => setMode('ask')}>{mode === 'rox' ? L('RoX plan', 'RoX திட்டம்') : L('My route', 'என் வழி')} · {L('change', 'மாற்று')}</button>
        </div>
      </div>
      <div className="muted">{L('Tap a stop to move it earlier, later, to another van, or to tomorrow.', 'நிறுத்தத்தை தட்டி முன்/பின்/வேறு வண்டி/நாளைக்கு மாற்றலாம்.')}</div>
      {plan.filter(x => x.van.id || x.shops.length).map(p => (
        <div key={p.van.id || 'tomorrow'} className="card stack" style={{ gap: 8, borderStyle: p.van.id ? 'solid' : 'dashed' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b style={{ fontSize: 17 }}>{p.van.id ? <Truck size={18} style={{ verticalAlign: -3 }} /> : <Clock size={18} style={{ verticalAlign: -3 }} />} {p.van.name} <span className="muted">{p.van.number}</span></b>
            <span className={`badge ${p.van.id ? 'navy' : 'warn'}`}>{p.shops.length} {L('stops', 'நிறுத்தம்')} · {inr(p.shops.reduce((a, s) => a + s.value, 0))}{p.van.id && km(p) ? ` · ${km(p)}` : ''}</span>
          </div>
          <div className="route">
            {p.shops.map((s, si) => (
              <button key={s.shop.id} className="stop item tap" style={{ minHeight: 52 }} onClick={() => stopMenu(plan.indexOf(p), si)}>
                <span className="badge">{p.van.id ? si + 1 : '—'}</span>
                <div className="grow" style={{ textAlign: 'left' }}><div className="t">{s.shop.name}</div><div className="s">{s.shop.area} · {s.invoices.length} {L('bill', 'பில்')} · {inr(s.value)}</div></div>
                <span className="muted">⋯</span>
              </button>
            ))}
            {!p.shops.length && <div className="muted" style={{ padding: '6px 0' }}>{L('No stops — tap a stop on another van and choose this one.', 'நிறுத்தம் இல்லை.')}</div>}
          </div>
        </div>
      ))}
      {!plan.length && <div className="card muted">{L('No bills waiting for delivery.', 'டெலிவரிக்கு பில் இல்லை.')}</div>}
      {plan.length > 0 && <button className="btn primary big block" disabled={total - unplanned === 0} onClick={async () => { await confirmPlan(plan.filter(x => x.van.id)); onDone(); }}><Check /> {L('Confirm plan → load sheets', 'உறுதி → லோடு ஷீட்')}{unplanned ? ` (${unplanned} ${L('tomorrow', 'நாளைக்கு')})` : ''}</button>}
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
