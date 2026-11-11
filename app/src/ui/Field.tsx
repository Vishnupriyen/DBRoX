// Company field team screens: the rep's day (start/end, beat, visits, orders, new shop, leave) and the manager's team view.
import { useEffect, useState } from 'react';
import { Play, Square, MapPin, ShoppingCart, Camera, Ban, Check, Minus, Plus, ChevronRight, AlertTriangle } from 'lucide-react';
import { db, session, thisMonth, today } from '../core/db';
import { inr as inrExact, plural, showDate } from '../core/i18n';
import {
  applyLeave, countedVisit, dayName, decideLeave, endDay, fieldOrderStatus, myDay, myShops, NO_ORDER_REASONS, orderValue, placeFieldOrder,
  repSales, requestShop, setTarget, startDay, teamToday, todaysBeat, visitShop, DAY_NAMES, type RepRow,
} from '../core/field';
import { myTeam } from '../core/company';
import { TravelApprovals } from './CompanyClaims';
import { getPos } from './Beat';
import { PhotoButton } from './PhotoButton';
import { askText, confirmBox, notify } from './dialog';
import { useBack } from './useBack';
import type { DbLink, LeaveRequest, Order, Product, Shop, Staff, Visit, WorkDay } from '../core/types';

const inr = (n: number) => inrExact(Math.round(n));
const act = async (fn: () => Promise<unknown>) => { try { await fn(); return true; } catch (e) { await notify('Not saved', (e as Error).message); return false; } };
const time = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—';

// ---------------------------------------------------------------- my day (start / end, km)
export function MyWorkDay() {
  const [d, setD] = useState<WorkDay | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const load = async () => setD((await myDay()) ?? null);
  useEffect(() => { void load(); const id = setInterval(() => void load(), 30000); return () => clearInterval(id); }, []);
  if (d === undefined) return <div className="card muted">{'Loading…'}</div>;
  const run = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await act(fn); await load(); } finally { setBusy(false); } };
  return (
    <div className="stack">
      {!d && (
        <div className="card">
          <h3>{'Start your day'}</h3>
          <div className="muted" style={{ marginBottom: 10 }}>{'Your location is recorded while Hanubix is open, to count km for travel allowance. Keep the app open on the road.'}</div>
          <button className="btn primary big block" disabled={busy} onClick={() => run(async () => startDay(await getPos()))}><Play size={18} /> {'Start day'}</button>
        </div>
      )}
      {d && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="v">{time(d.startAt)}</div><div className="l">{'started'}</div></div>
            <div className="kpi"><div className="v">{d.km} km</div><div className="l">{d.endAt ? 'travelled' : 'so far'}</div></div>
            <div className="kpi"><div className="v">{d.endAt ? time(d.endAt) : '—'}</div><div className="l">{'ended'}</div></div>
          </div>
          {d.flags.length > 0 && <div className="card"><h3><AlertTriangle size={16} /> {'Your manager will see'}</h3>{d.flags.map(f => <div key={f} className="muted">{f}</div>)}</div>}
          {!d.endAt && <button className="btn big block" disabled={busy} onClick={() => run(async () => { if (!await confirmBox('End your day?', 'Km are counted till now. You can\'t restart today.', 'End day')) return; const r = await endDay(await getPos()); await notify(`Day ended · ${r.km} km`, r.flags.length ? r.flags.join('\n') : 'Nothing odd in today\'s record.'); })}><Square size={18} /> {'End day'}</button>}
        </>
      )}
      <div className="muted">{'km are measured along your path while the app is open. Jumps in GPS are not counted; long gaps are shown to your manager.'}</div>
    </div>
  );
}

// ---------------------------------------------------------------- today's beat → visit
export function TodaysBeat({ onDay }: { onDay?: () => void }) {
  const [rows, setRows] = useState<{ shop: Shop; visit?: Visit }[] | null>(null);
  const [open, setOpen] = useState<Shop | null>(null);
  const [all, setAll] = useState(false);
  const [started, setStarted] = useState(true);
  const load = async () => {
    setStarted(!!(await myDay()));
    if (all) { const vs = (await db.visits.where('date').equals(today()).toArray()).filter(v => v.staffId === session().userId && countedVisit(v)); setRows((await myShops()).sort((a, b) => a.name.localeCompare(b.name)).map(shop => ({ shop, visit: vs.find(v => v.shopId === shop.id) }))); }
    else setRows(await todaysBeat());
  };
  useEffect(() => { void load(); }, [all]);
  useBack(() => { if (!open) return false; setOpen(null); void load(); return true; });
  if (open) return <ShopVisit shop={open} onBack={() => { setOpen(null); void load(); }} />;
  if (!rows) return <div className="card muted">{'Loading…'}</div>;
  const done = rows.filter(r => r.visit).length;
  return (
    <div className="stack">
      {!started && <div className="card" style={{ borderColor: 'var(--warn)' }}><div>{'Start your day first, so your km count.'}</div>{onDay && <button className="btn primary block" style={{ marginTop: 8 }} onClick={onDay}>{'Open My day'} →</button>}</div>}
      <div className="segmented"><button className={!all ? 'on' : ''} onClick={() => setAll(false)}>{`${dayName()}'s beat`}</button><button className={all ? 'on' : ''} onClick={() => setAll(true)}>{'All my shops'}</button></div>
      <div className="muted">{`${done} of ${rows.length} visited`}</div>
      <div className="list">{rows.map(({ shop, visit }) => (
        <button key={shop.id} className="item tap" onClick={() => setOpen(shop)}>
          <MapPin size={18} />
          <div className="grow" style={{ textAlign: 'left' }}><div className="t">{shop.name}</div><div className="s">{[shop.area, visit ? (visit.outcome === 'order' ? 'Order taken' : visit.reason ? `No order: ${visit.reason}` : 'Visited') : '', visit?.farFromShop ? 'far from shop' : ''].filter(Boolean).join(' · ')}</div></div>
          {visit ? <Check size={18} /> : <ChevronRight size={18} />}
        </button>
      ))}</div>
      {!rows.length && <div className="card muted">{all ? 'No shops yet: your distributors\' shops appear once they are linked.' : `No shops on ${dayName()}'s beat.`}</div>}
    </div>
  );
}

function ShopVisit({ shop, onBack }: { shop: Shop; onBack: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [unit, setUnit] = useState<'case' | 'pcs'>('case');
  const [visit, setVisit] = useState<Visit | null>(null);
  const [dist, setDist] = useState<number | undefined>();
  const [mode, setMode] = useState<'menu' | 'order' | 'none'>('menu');
  const [busy, setBusy] = useState(false);
  // back goes one level: order or no-order → the visit menu (an order with products asks first) → the beat
  useBack(() => {
    if (mode === 'menu') return false;
    void (async () => { if (mode === 'order' && Object.values(qty).some(Boolean) && !(await confirmBox('Leave this order?', `${plural(Object.values(qty).filter(Boolean).length, 'line')} will be lost.`, 'Leave'))) return; setMode('menu'); setQty({}); })();
    return true;
  });
  useEffect(() => { (async () => {
    setProducts((await db.products.toArray()).filter(p => p.active).sort((a, b) => Number(!!b.focus) - Number(!!a.focus) || a.name.localeCompare(b.name)));
    const r = await visitShop(shop, await getPos()); setVisit(r.visit); setDist(r.distanceM);
  })(); }, [shop.id]);
  const pcs = (p: Product) => (qty[p.id] ?? 0) * (unit === 'case' ? p.caseSize : 1);
  const lines = products.filter(p => pcs(p) > 0).map(p => ({ productId: p.id, qty: pcs(p) }));
  const total = products.reduce((a, p) => a + pcs(p) * p.rate, 0);
  const run = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { if (await act(fn)) onBack(); } finally { setBusy(false); } };
  return (
    <div className="stack">
      <button className="btn small" onClick={onBack}>← {'Beat'}</button>
      <div className="card"><h3>{shop.name}</h3><div className="muted">{[shop.area, dist != null ? (dist > 300 ? `You are ${dist} m from the shop's saved location — your manager sees this` : `At the shop (${dist} m)`) : shop.lat == null ? 'Shop location not saved by the distributor yet' : 'Your location is off — turn it on'].join(' · ')}</div></div>
      {mode === 'menu' && (
        <div className="list">
          <button className="item tap" onClick={() => setMode('order')}><ShoppingCart size={18} /><span className="grow">{'Take order'}</span><ChevronRight size={18} /></button>
          <button className="item tap" onClick={() => setMode('none')}><Ban size={18} /><span className="grow">{'No order'}</span><ChevronRight size={18} /></button>
          <div className="item"><Camera size={18} /><div className="grow"><PhotoButton label={visit?.photo ? 'Shelf photo saved' : 'Shelf photo (our products on display)'} onPhoto={async url => { if (visit) { const r = await visitShop(shop, null, { photo: url }); setVisit(r.visit); } }} /></div></div>
        </div>
      )}
      {mode === 'none' && (
        <div className="card">
          <h3>{'Why no order?'}</h3>
          <div className="chips">{NO_ORDER_REASONS.map(r => <button key={r} className="chip" disabled={busy} onClick={() => run(() => visitShop(shop, null, { outcome: 'no_order', reason: r }))}>{r}</button>)}</div>
        </div>
      )}
      {mode === 'order' && (
        <>
          <div className="segmented"><button className={unit === 'case' ? 'on' : ''} onClick={() => setUnit('case')}>{'Cases'}</button><button className={unit === 'pcs' ? 'on' : ''} onClick={() => setUnit('pcs')}>{'Pieces'}</button></div>
          <div className="list">{products.map(p => (
            <div key={p.id} className="item">
              <div className="grow"><div className="t">{p.name}{p.focus ? ' ★' : ''}</div><div className="s">{`PTR ${inrExact(p.rate)} · ${p.caseSize}/case`}</div></div>
              <div className="stepper">
                <button aria-label={`Less ${p.name}`} onClick={() => setQty({ ...qty, [p.id]: Math.max(0, (qty[p.id] ?? 0) - 1) })}><Minus size={16} /></button>
                <span>{qty[p.id] ?? 0}</span>
                <button aria-label={`More ${p.name}`} onClick={() => setQty({ ...qty, [p.id]: (qty[p.id] ?? 0) + 1 })}><Plus size={16} /></button>
              </div>
            </div>
          ))}</div>
          <div className="sticky-foot">
            <button className="btn primary big block" disabled={busy || !lines.length} onClick={() => run(async () => { await placeFieldOrder(shop.id, lines, visit?.id); await notify('Order sent', `Sent to the distributor for billing · about ${inr(total)} before GST.`); })}>{lines.length ? `Send order · ${inr(total)}` : 'Add products'}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- my orders
export function MyOrders() {
  const [rows, setRows] = useState<{ o: Order; shop?: Shop; st: { status: 'sent' | 'billed'; value: number } }[] | null>(null);
  useEffect(() => { (async () => {
    const me = session().userId;
    const orders = (await db.orders.toArray()).filter(o => o.repId === me && o.date.slice(0, 7) === thisMonth()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const st = await fieldOrderStatus(orders);
    const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
    setRows(orders.map(o => ({ o, shop: shops.get(o.shopId), st: st.get(o.id)! })));
  })(); }, []);
  if (!rows) return <div className="card muted">{'Loading…'}</div>;
  return (
    <div className="stack">
      <div className="list">{rows.map(({ o, shop, st }) => (
        <div key={o.id} className="item"><div className="grow"><div className="t">{shop?.name ?? 'Shop'}</div><div className="s">{[showDate(o.date), `${plural(o.lines.length, 'item')}`, st.status === 'billed' ? 'Billed by distributor' : 'Sent to distributor'].join(' · ')}</div></div><div className="num">{inr(st.value)}</div></div>
      ))}</div>
      {!rows.length && <div className="card muted">{'No orders this month yet.'}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- new shop request
export function NewShopRequest({ onDone }: { onDone: () => void }) {
  const [links, setLinks] = useState<DbLink[]>([]);
  const [f, setF] = useState({ name: '', area: '', beat: dayName(), dbLinkId: '', photo: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => { const me = await db.staff.get(session().userId); const ids = new Set(me?.dbLinkIds ?? []); const l = (await db.dbLinks.toArray()).filter(x => ids.has(x.id) && x.status === 'linked'); setLinks(l); if (l.length === 1) setF(x => ({ ...x, dbLinkId: l[0].id })); })(); }, []);
  return (
    <div className="card">
      <h3>{'New shop'}</h3>
      <div className="muted" style={{ marginBottom: 8 }}>{'The distributor approves the shop before it can be billed.'}</div>
      <div className="field"><label>{'Shop name'}</label><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
      <div className="field"><label>{'Town / area'}</label><input value={f.area} onChange={e => setF({ ...f, area: e.target.value })} /></div>
      <div className="field"><label>{'Beat day'}</label><select value={f.beat} onChange={e => setF({ ...f, beat: e.target.value })}>{DAY_NAMES.map(d => <option key={d}>{d}</option>)}</select></div>
      <div className="field"><label>{'Distributor'}</label><select value={f.dbLinkId} onChange={e => setF({ ...f, dbLinkId: e.target.value })}><option value="">{'Choose'}</option>{links.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
      <PhotoButton label={'Photo of the shop'} onPhoto={url => setF({ ...f, photo: url })} />
      <button className="btn primary block" style={{ marginTop: 10 }} disabled={busy} onClick={async () => { setBusy(true); try { if (await act(async () => requestShop({ ...f, pos: await getPos() }))) { await notify('Sent', 'The distributor will approve the shop.'); onDone(); } } finally { setBusy(false); } }}>{'Send for approval'}</button>
    </div>
  );
}

// ---------------------------------------------------------------- my month (sales vs target, leave)
export function MyMonth() {
  const [d, setD] = useState<{ sales: number; target: number; visits: number; productive: number; leaves: LeaveRequest[] } | null>(null);
  const load = async () => {
    const me = session().userId, m = thisMonth();
    const sales = (await repSales(m)).get(me) ?? 0;
    const target = (await db.targets.where('month').equals(m).toArray()).find(t => t.staffId === me)?.value ?? 0;
    const vs = (await db.visits.toArray()).filter(v => v.staffId === me && v.date.slice(0, 7) === m && countedVisit(v));
    setD({ sales, target, visits: vs.length, productive: vs.filter(v => v.outcome === 'order').length, leaves: (await db.leaves.where('staffId').equals(me).toArray()).sort((a, b) => b.from.localeCompare(a.from)) });
  };
  useEffect(() => { void load(); }, []);
  if (!d) return <div className="card muted">{'Loading…'}</div>;
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><div className="v">{inr(d.sales)}</div><div className="l">{'billed from my orders'}</div></div>
        <div className="kpi"><div className="v">{d.target ? `${Math.round(d.sales / d.target * 100)}%` : '—'}</div><div className="l">{d.target ? `of ${inr(d.target)} target` : 'no target set'}</div></div>
        <div className="kpi"><div className="v">{d.visits ? `${Math.round(d.productive / d.visits * 100)}%` : '—'}</div><div className="l">{`visits with an order (${d.productive}/${d.visits})`}</div></div>
      </div>
      <div className="card">
        <h3>{'Leave'}</h3>
        <button className="btn" onClick={async () => {
          const from = await askText('First day of leave (YYYY-MM-DD)', today()); if (!from) return;
          const to = await askText('Last day of leave (YYYY-MM-DD)', from); if (!to) return;
          const why = await askText('Reason'); if (!why) return;
          if (await act(() => applyLeave(from, to, why))) void load();
        }}>{'Apply for leave'}</button>
        {d.leaves.map(l => <div key={l.id} className="muted" style={{ marginTop: 6 }}>{`${showDate(l.from)} → ${showDate(l.to)} · ${l.reason} · ${l.status === 'waiting' ? 'waiting for OK' : l.status}`}</div>)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- manager: team today
export function TeamToday() {
  const [rows, setRows] = useState<RepRow[] | null>(null);
  const load = async () => setRows(await teamToday(await myTeam(session().userId)));
  useEffect(() => { void load(); const id = setInterval(() => void load(), 30000); return () => clearInterval(id); }, []);
  if (!rows) return <div className="card muted">{'Loading…'}</div>;
  const notStarted = rows.filter(r => !r.started).length, noVisit = rows.filter(r => r.started && !r.visits).length;
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><div className="v">{rows.filter(r => r.started).length}/{rows.length}</div><div className="l">{'started'}</div></div>
        <div className="kpi"><div className="v" style={{ color: noVisit ? 'var(--bad)' : undefined }}>{noVisit}</div><div className="l">{'started, no visit yet'}</div></div>
        <div className="kpi"><div className="v">{inr(rows.reduce((a, r) => a + r.orderValue, 0))}</div><div className="l">{'orders today'}</div></div>
      </div>
      {notStarted > 0 && <div className="muted">{`${notStarted} not started yet`}</div>}
      <div className="list">{rows.map(r => (
        <div key={r.staff.id} className="item">
          <div className="grow">
            <div className="t">{r.staff.name}</div>
            <div className="s">{r.started ? [`started ${time(r.started)}`, r.ended ? `ended ${time(r.ended)}` : `last seen ${time(r.lastSeen)}`, `${r.km} km`, `${plural(r.visits, 'visit')} (${r.productive} with order)`, r.far ? `${r.far} far from shop` : ''].filter(Boolean).join(' · ') : 'Not started'}</div>
            {r.flags.map(f => <div key={f} className="s" style={{ color: 'var(--warn)' }}>{f}</div>)}
          </div>
          <div className="num">{inr(r.orderValue)}</div>
        </div>
      ))}</div>
      {!rows.length && <div className="card muted">{'No field reps in your team yet.'}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- manager: approvals (leave) and targets
export function Approvals() {
  const [leaves, setLeaves] = useState<(LeaveRequest & { who: string })[] | null>(null);
  const load = async () => {
    const team = await myTeam(session().userId); const ids = new Map(team.filter(s => s.id !== session().userId).map(s => [s.id, s.name]));
    setLeaves((await db.leaves.where('status').equals('waiting').toArray()).filter(l => ids.has(l.staffId)).map(l => ({ ...l, who: ids.get(l.staffId)! })));
  };
  useEffect(() => { void load(); }, []);
  if (!leaves) return <div className="card muted">{'Loading…'}</div>;
  return (
    <div className="stack">
      <TravelApprovals />
      <div className="list">{leaves.map(l => (
        <div key={l.id} className="item"><div className="grow"><div className="t">{l.who}</div><div className="s">{`Leave ${showDate(l.from)} → ${showDate(l.to)} · ${l.reason}`}</div></div>
          <button className="btn small" onClick={async () => { if (await act(() => decideLeave(l.id, true))) void load(); }}>{'Approve'}</button>
          <button className="btn small ghost" onClick={async () => { if (await act(() => decideLeave(l.id, false))) void load(); }}>{'Reject'}</button></div>
      ))}</div>
      {!leaves.length && <div className="card muted">{'No leave waiting for you.'}</div>}
    </div>
  );
}
export function Targets() {
  const [rows, setRows] = useState<{ s: Staff; target: number; sales: number }[] | null>(null);
  const load = async () => {
    const m = thisMonth(); const team = (await myTeam(session().userId)).filter(s => s.role === 'rep');
    const t = await db.targets.where('month').equals(m).toArray(); const sales = await repSales(m);
    setRows(team.map(s => ({ s, target: t.find(x => x.staffId === s.id)?.value ?? 0, sales: sales.get(s.id) ?? 0 })).sort((a, b) => (b.target ? b.sales / b.target : 0) - (a.target ? a.sales / a.target : 0)));
  };
  useEffect(() => { void load(); }, []);
  if (!rows) return <div className="card muted">{'Loading…'}</div>;
  return (
    <div className="stack">
      <div className="muted">{'This month: sales billed by the distributor from each rep\'s orders, against the rep\'s target. Tap to set a target.'}</div>
      <div className="list">{rows.map(r => (
        <button key={r.s.id} className="item tap" onClick={async () => { const v = await askText(`${r.s.name}: target for this month (₹)`, r.target ? String(r.target) : '', 'number'); if (v && await act(() => setTarget(r.s.id, thisMonth(), Number(v)))) void load(); }}>
          <div className="grow" style={{ textAlign: 'left' }}><div className="t">{r.s.name}</div><div className="s">{r.target ? `${inr(r.sales)} of ${inr(r.target)}` : `${inr(r.sales)} · no target`}</div></div>
          <div className="num">{r.target ? `${Math.round(r.sales / r.target * 100)}%` : '—'}</div>
        </button>
      ))}</div>
      {!rows.length && <div className="card muted">{'No field reps in your team yet.'}</div>}
    </div>
  );
}
void orderValue;
