// Company side screens (a brand's head office and managers). Logic lives in core/company.ts.
import { GST_RATES } from '../core/gst';
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Building2, BarChart3, Boxes, Package, BadgePercent, Store, FileUp, Users, Search, Copy, Pause, Play, ChevronRight, CalendarCheck, Route, ShoppingCart, UserPlus, Target, Activity, Inbox, FileCheck2, Wallet } from 'lucide-react';
import { Approvals, MyMonth, MyOrders, MyWorkDay, NewShopRequest, TeamToday, Targets, TodaysBeat } from './Field';
import { ClaimsInbox, MyExpenses } from './CompanyClaims';
import { myDay, todaysBeat } from '../core/field';
import { db, session, thisMonth, today } from '../core/db';
import { inr as inrExact, plural, showMonth } from '../core/i18n';
// company screens show whole rupees (they are summaries); exact paise stay on the bills themselves
const inr = (n: number) => inrExact(Math.round(n));
import {
  checkProduct, draftPrimary, inviteDistributor, myLinks, outletList, readPrimaryRows, saveProducts, saveScheme, saveStaff, salesByDistributor,
  salesByProduct, sendPrimary, setLinkStatus, setNorm, stockCover, type CoverRow, type DbRow, type PrimaryDraft, type ProductInput, type ProductRow, type StaffInput,
} from '../core/company';
import { readProductRows, readSheet } from '../core/readers';
import { askText, confirmBox, notify } from './dialog';
import type { DbLink, PrimaryInvoice, PrimaryOrder, Product, Role, Scheme, Staff } from '../core/types';
import { invoiceFromOrder } from '../core/grn';

export type CoPage = 'co-distributors' | 'co-sales' | 'co-stock' | 'co-products' | 'co-schemes' | 'co-outlets' | 'co-invoices' | 'co-team'
  | 'fd-day' | 'fd-beat' | 'fd-orders' | 'fd-newshop' | 'fd-month' | 'fd-team' | 'fd-approvals' | 'fd-targets' | 'fd-expenses' | 'cl-inbox';
export const CO_TITLE: Record<CoPage, string> = {
  'co-distributors': 'Distributors', 'co-sales': 'Sales', 'co-stock': 'Stock at distributors', 'co-products': 'Products & prices',
  'co-schemes': 'Schemes', 'co-outlets': 'Shops', 'co-invoices': 'Invoices to distributors', 'co-team': 'Team',
  'fd-day': 'My day', 'fd-beat': "Today's beat", 'fd-orders': 'My orders', 'fd-newshop': 'New shop', 'fd-month': 'My month',
  'fd-team': 'Team today', 'fd-approvals': 'Approvals', 'fd-targets': 'Targets', 'fd-expenses': 'Travel & expenses', 'cl-inbox': 'Distributor claims',
};

const act = async (fn: () => Promise<unknown>) => { try { await fn(); return true; } catch (e) { await notify('Not saved', (e as Error).message); return false; } };
const pct = (a: number, b: number) => (b ? Math.round(a / b * 100) : 0);
// the greeting card has room for short figures: ₹1.2 L, ₹45.6 k
const short = (n: number) => n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)} k` : inr(n);
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// ---------------------------------------------------------------- home
interface Tile { page: CoPage; icon: LucideIcon; en: string; count?: number; tone?: 'bad' | 'warn' | 'ok' }
export function CompanyHome({ role, go }: { role: Role; go: (p: CoPage) => void }) {
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [head, setHead] = useState<{ name: string; secondary: number; primary: number; low: number; waiting?: number; rep?: { started: boolean; ended: boolean; km: number; left: number; total: number } } | null>(null);
  useEffect(() => { (async () => {
    const me = session().userId;
    if (role === 'rep') {
      const d = await myDay(me);
      const beat = await todaysBeat(me);
      const name = (await db.staff.get(me))?.name.split(' ')[0] ?? '';
      setHead({ name, secondary: 0, primary: 0, low: 0, rep: { started: !!d, ended: !!d?.endAt, km: d?.km ?? 0, left: beat.filter(b => !b.visit).length, total: beat.length } });
      setTiles([
        { page: 'fd-day', icon: CalendarCheck, en: 'My day', count: d ? undefined : 1, tone: 'bad' },
        { page: 'fd-beat', icon: Route, en: "Today's beat", count: beat.filter(b => !b.visit).length || undefined, tone: 'ok' },
        { page: 'fd-orders', icon: ShoppingCart, en: 'My orders' },
        { page: 'fd-month', icon: Target, en: 'My month' },
        { page: 'fd-expenses', icon: Wallet, en: 'Travel & expenses' },
        { page: 'fd-newshop', icon: UserPlus, en: 'New shop' },
      ]);
      return;
    }
    const links = await myLinks(me);
    const ids = new Set(links.map(l => l.id));
    const rows = (await salesByDistributor()).filter(r => ids.has(r.link.id));
    const low = (await stockCover()).filter(c => ids.has(c.dbLinkId) && c.status === 'low').length;
    const invited = links.filter(l => l.status === 'invited').length;
    const name = (await db.staff.get(me))?.name.split(' ')[0] ?? '';
    setHead({ name, secondary: rows.reduce((a, r) => a + r.secondary, 0), primary: rows.reduce((a, r) => a + r.primary, 0), low });
    const all: Tile[] = [
      { page: 'co-sales', icon: BarChart3, en: 'Sales' },
      { page: 'co-stock', icon: Boxes, en: 'Stock at distributors', count: low || undefined, tone: 'bad' },
      { page: 'co-distributors', icon: Building2, en: 'Distributors', count: invited || undefined, tone: 'warn' },
      { page: 'co-outlets', icon: Store, en: 'Shops' },
    ];
    if (role === 'cadmin') all.push(
      { page: 'co-invoices', icon: FileUp, en: 'Invoices to distributors' },
      { page: 'co-products', icon: Package, en: 'Products & prices' },
      { page: 'co-schemes', icon: BadgePercent, en: 'Schemes' },
      { page: 'co-team', icon: Users, en: 'Team' },
    );
    else all.push({ page: 'co-team', icon: Users, en: 'Team' });
    const team = new Set((await (await import('../core/company')).myTeam(me)).filter(s => s.id !== me).map(s => s.id));
    const waiting = (await db.leaves.where('status').equals('waiting').toArray()).filter(l => team.has(l.staffId)).length
      + (await db.travelClaims.where('status').equals('waiting').toArray()).filter(c => team.has(c.staffId)).length;
    const decs = await db.claimDecisions.toArray();
    const claimsOpen = (await db.dbClaims.toArray()).filter(c => ids.has(c.dbLinkId) && !decs.some(d => d.claimId === c.id && (d.status === 'approved' || d.status === 'rejected' || (role === 'manager' && d.status === 'recommended')))).length;
    all.splice(0, 0, { page: 'fd-team', icon: Activity, en: 'Team today' });
    all.splice(3, 0, { page: 'cl-inbox', icon: FileCheck2, en: 'Distributor claims', count: claimsOpen || undefined, tone: 'warn' });
    all.push({ page: 'fd-approvals', icon: Inbox, en: 'Approvals', count: waiting || undefined, tone: 'warn' }, { page: 'fd-targets', icon: Target, en: 'Targets' });
    setHead(h => h && { ...h, waiting });
    setTiles(all);
  })(); }, [role]);
  if (!tiles || !head) return <div className="card muted">{'Loading…'}</div>;
  const hour = new Date().getHours();
  return (
    <div className={`home n${tiles.length}`}>
      {head.rep ? (
        <div className="morning"><div className="grow">
          <div className="t">{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}{head.name ? `, ${head.name}` : ''}.</div>
          <div className="s">{!head.rep.started ? 'Start your day to begin your beat.' : head.rep.ended ? 'Your day is ended.' : head.rep.left ? `${head.rep.left} of ${plural(head.rep.total, 'shop')} left on today's beat.` : 'All shops on today\'s beat visited.'}</div>
          <div className="kv"><div><b>{head.rep.total - head.rep.left}/{head.rep.total}</b><span>{'visited'}</span></div><div><b>{head.rep.km} km</b><span>{'today'}</span></div></div>
          <button className="pill" onClick={() => go(head.rep!.started ? 'fd-beat' : 'fd-day')}>{head.rep.started ? 'Open beat' : 'Start day'} →</button>
        </div></div>
      ) : (
      <div className="morning">
        <div className="grow">
          <div className="t">{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}{head.name ? `, ${head.name}` : ''}.</div>
          <div className="s">{head.waiting ? `${plural(head.waiting, 'approval')} waiting for you.` : head.low ? `${head.low} product${head.low > 1 ? 's are' : ' is'} running low at your distributors.` : 'Stock at your distributors is fine.'}</div>
          <div className="kv"><div><b>{short(head.secondary)}</b><span>{'shop sales'}</span></div><div><b>{short(head.primary)}</b><span>{'to distributors'}</span></div><div><b>{head.low}</b><span>{'low stock'}</span></div></div>
          {head.waiting ? <button className="pill" onClick={() => go('fd-approvals')}>{'Start here'} →</button> : head.low > 0 && <button className="pill" onClick={() => go('co-stock')}>{'See low stock'} →</button>}
        </div>
      </div>
      )}
      {tiles.map(t => (
        <button key={t.page} className="tile" onClick={() => go(t.page)}>
          <span className="tile-ic"><t.icon size={30} /></span>
          <span className="tile-l">{t.en}</span>
          {t.count ? <span className={`tile-n ${t.tone ?? ''}`}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- distributors
export function Distributors({ role }: { role: Role }) {
  const [links, setLinks] = useState<DbLink[] | null>(null);
  const [rows, setRows] = useState<DbRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; town: string; norm: string; kind: DbLink['kind'] } | null>(null);
  const load = async () => { setLinks(await myLinks(session().userId)); setRows(await salesByDistributor()); };
  useEffect(() => { void load(); }, []);
  if (!links) return <div className="card muted">{'Loading…'}</div>;
  if (open) return <DistributorDetail id={open} role={role} onBack={() => { setOpen(null); void load(); }} />;
  const label = { invited: 'Invite sent', linked: 'Linked', paused: 'Paused', left: 'Left' } as const;
  return (
    <div className="stack">
      {role === 'cadmin' && !form && <button className="btn primary block" onClick={() => setForm({ name: '', town: '', norm: '15', kind: 'distributor' })}>{'Invite a distributor'}</button>}
      {form && (
        <div className="card">
          <h3>{'Invite a distributor'}</h3>
          <div className="muted" style={{ marginBottom: 8 }}>{'You get a 6-letter code. The distributor types it in Hanubix (More → Company links) and sees exactly what you will see before saying yes.'}</div>
          <div className="field"><label>{'Firm name'}</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>{'Town'}</label><input value={form.town} onChange={e => setForm({ ...form, town: e.target.value })} /></div>
          <div className="field"><label>{'Type'}</label><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as DbLink['kind'] })}><option value="distributor">{'Distributor'}</option><option value="super_stockist">{'Super stockist'}</option><option value="sub_stockist">{'Sub-stockist'}</option></select></div>
          <div className="field"><label>{'Stock norm (days of stock to hold)'}</label><input inputMode="numeric" value={form.norm} onChange={e => setForm({ ...form, norm: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="row">
            <button className="btn primary" onClick={() => act(async () => { const l = await inviteDistributor(form.name, form.town, Number(form.norm), form.kind); setForm(null); await load(); await notify(`Code for ${l.name}: ${l.inviteCode}`, 'Send this code to the distributor. It works once.'); })}>{'Make the code'}</button>
            <button className="btn ghost" onClick={() => setForm(null)}>{'Cancel'}</button>
          </div>
        </div>
      )}
      {!links.length && <div className="card muted">{'No distributors yet.'}</div>}
      <div className="list">
        {links.map(l => {
          const r = rows.find(x => x.link.id === l.id);
          return (
            <button key={l.id} className="item tap" onClick={() => l.status === 'invited' ? undefined : setOpen(l.id)}>
              <div className="grow" style={{ textAlign: 'left' }}>
                <div className="t">{l.name}</div>
                <div className="s">{[l.town, label[l.status], l.kind && l.kind !== 'distributor' ? l.kind.replace('_', ' ') : '', l.status === 'invited' ? `code ${l.inviteCode}` : ''].filter(Boolean).join(' · ')}</div>
              </div>
              {r && l.status !== 'invited' ? <div className="num">{inr(r.secondary)}<div className="s">{'shop sales'}</div></div> : null}
              {l.status === 'invited' ? <span className="icon-btn" role="button" aria-label="Copy code" onClick={e => { e.stopPropagation(); void navigator.clipboard?.writeText(l.inviteCode).catch(() => {}); void notify('Code', l.inviteCode); }}><Copy size={18} /></span> : <ChevronRight size={18} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DistributorDetail({ id, role, onBack }: { id: string; role: Role; onBack: () => void }) {
  const [link, setLink] = useState<DbLink | null>(null);
  const [row, setRow] = useState<DbRow | null>(null);
  const [cover, setCover] = useState<CoverRow[]>([]);
  const [prod, setProd] = useState<ProductRow[]>([]);
  const load = async () => {
    setLink((await db.dbLinks.get(id)) ?? null);
    setRow((await salesByDistributor()).find(r => r.link.id === id) ?? null);
    setCover(await stockCover({ dbLinkId: id }));
    setProd(await salesByProduct(thisMonth(), id));
  };
  useEffect(() => { void load(); }, [id]);
  if (!link) return <div className="card muted">{'Loading…'}</div>;
  return (
    <div className="stack">
      <button className="btn small" onClick={onBack}>← {'Distributors'}</button>
      <div className="card">
        <h3>{link.name}</h3>
        <div className="muted">{[link.town, link.status === 'linked' ? 'Linked' : link.status === 'paused' ? 'Paused — nothing new comes in' : 'Left — nothing new comes in', `stock norm ${link.normDays ?? 15} days`].filter(Boolean).join(' · ')}</div>
      </div>
      {row && <div className="kpis">
        <div className="kpi"><div className="v">{inr(row.primary)}</div><div className="l">{'sales to them'}</div></div>
        <div className="kpi"><div className="v">{inr(row.secondary)}</div><div className="l">{'their shop sales'}</div></div>
        <div className="kpi"><div className="v">{row.shops}</div><div className="l">{'shops billed'}</div></div>
      </div>}
      <div className="card">
        <h3>{'Stock'}</h3>
        <div className="tablewrap"><table className="tbl"><thead><tr><th>{'Product'}</th><th>{'Stock'}</th><th>{'Per day'}</th><th>{'Days'}</th></tr></thead>
          <tbody>{cover.map(c => <tr key={c.productId}><td>{c.name}</td><td className="num">{c.qty}</td><td className="num">{c.perDay}</td><td className="num" style={{ color: c.status === 'low' ? 'var(--bad)' : c.status === 'high' ? 'var(--warn)' : undefined }}>{c.days ?? '—'}</td></tr>)}</tbody></table></div>
        {!cover.length && <div className="muted">{'No stock information yet.'}</div>}
      </div>
      <div className="card">
        <h3>{'This month by product'}</h3>
        <div className="tablewrap"><table className="tbl"><thead><tr><th>{'Product'}</th><th>{'Sold to them'}</th><th>{'They sold'}</th></tr></thead>
          <tbody>{prod.map(p => <tr key={p.productId}><td>{p.name}</td><td className="num">{p.primaryQty}</td><td className="num">{p.secondaryQty}</td></tr>)}</tbody></table></div>
        {!prod.length && <div className="muted">{'No sales this month yet.'}</div>}
      </div>
      {role === 'cadmin' && link.status !== 'left' && (
        <div className="row">
          <button className="btn" onClick={async () => { const v = await askText('Stock norm (days)', String(link.normDays ?? 15), 'number'); if (v && await act(() => setNorm(id, Number(v)))) void load(); }}>{'Change stock norm'}</button>
          {link.status === 'linked' && <button className="btn" onClick={async () => { if (await confirmBox('Pause this distributor?', 'Nothing new comes in until you resume. What you already have stays.', 'Pause') && await act(() => setLinkStatus(id, 'paused'))) void load(); }}><Pause size={16} /> {'Pause'}</button>}
          {link.status === 'paused' && <button className="btn" onClick={async () => { if (await act(() => setLinkStatus(id, 'linked'))) void load(); }}><Play size={16} /> {'Resume'}</button>}
          {link.status === 'linked' && <button className="btn" onClick={async () => { if (await act(async () => (await import('../core/link')).resyncLink(id))) { await notify('Re-synced', 'Everything is sent again, both ways.'); void load(); } }}>{'Re-sync'}</button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sales
export function Sales() {
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<DbRow[] | null>(null);
  const [prod, setProd] = useState<ProductRow[]>([]);
  useEffect(() => { (async () => {
    const ids = new Set((await myLinks(session().userId)).map(l => l.id));
    setRows((await salesByDistributor(month)).filter(r => ids.has(r.link.id)));
    setProd(await salesByProduct(month));
  })(); }, [month]);
  if (!rows) return <div className="card muted">{'Loading…'}</div>;
  const p = rows.reduce((a, r) => a + r.primary, 0), s = rows.reduce((a, r) => a + r.secondary, 0), ret = rows.reduce((a, r) => a + r.returns, 0);
  const months = [0, 1, 2, 3, 4, 5].map(i => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  return (
    <div className="stack">
      <div className="chips">{months.map(m => <button key={m} className={`chip ${m === month ? 'on' : ''}`} onClick={() => setMonth(m)}>{showMonth(m)}</button>)}</div>
      <div className="kpis">
        <div className="kpi"><div className="v">{inr(p)}</div><div className="l">{'sales to distributors'}</div></div>
        <div className="kpi"><div className="v">{inr(s - ret)}</div><div className="l">{'distributor sales to shops'}</div></div>
        <div className="kpi"><div className="v">{pct(s - ret, p)}%</div><div className="l">{'sold through'}</div></div>
      </div>
      <div className="muted">{'Values before GST. "Sold through" = what distributors sold to shops, as a share of what you sold to them.'}</div>
      <div className="card">
        <h3>{'By distributor'}</h3>
        <div className="tablewrap"><table className="tbl"><thead><tr><th>{'Distributor'}</th><th>{'To them'}</th><th>{'To shops'}</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.link.id}><td>{r.link.name}<div className="s">{`${plural(r.shops, 'shop')} · ${plural(r.bills, 'bill')}`}</div></td><td className="num">{inr(r.primary)}</td><td className="num">{inr(r.secondary - r.returns)}</td></tr>)}</tbody></table></div>
        {!rows.length && <div className="muted">{'No linked distributors yet.'}</div>}
      </div>
      <div className="card">
        <h3>{'By product (pieces)'}</h3>
        <div className="tablewrap"><table className="tbl"><thead><tr><th>{'Product'}</th><th>{'To dist.'}</th><th>{'To shops'}</th><th>{'Value'}</th></tr></thead>
          <tbody>{prod.map(r => <tr key={r.productId}><td>{r.name}</td><td className="num">{r.primaryQty}</td><td className="num">{r.secondaryQty}</td><td className="num">{inr(r.secondaryValue)}</td></tr>)}</tbody></table></div>
        {!prod.length && <div className="muted">{'No sales this month yet.'}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- stock at distributors
export function StockAtDistributors() {
  const [rows, setRows] = useState<CoverRow[] | null>(null);
  const [links, setLinks] = useState<Map<string, DbLink>>(new Map());
  const [only, setOnly] = useState<'low' | 'all' | 'high'>('low');
  useEffect(() => { (async () => {
    const mine = await myLinks(session().userId);
    setLinks(new Map(mine.map(l => [l.id, l])));
    const ids = new Set(mine.map(l => l.id));
    setRows((await stockCover()).filter(c => ids.has(c.dbLinkId)));
  })(); }, []);
  if (!rows) return <div className="card muted">{'Loading…'}</div>;
  const shown = rows.filter(r => only === 'all' || r.status === only);
  return (
    <div className="stack">
      <div className="segmented">{(['low', 'high', 'all'] as const).map(k => <button key={k} className={only === k ? 'on' : ''} onClick={() => setOnly(k)}>{k === 'low' ? `Running low (${rows.filter(r => r.status === 'low').length})` : k === 'high' ? `Too much (${rows.filter(r => r.status === 'high').length})` : 'All'}</button>)}</div>
      <div className="muted">{'Days = stock ÷ what the distributor sold per day in the last 30 days. Low = under half the stock norm; too much = over twice the norm.'}</div>
      {[...new Set(shown.map(r => r.dbLinkId))].map(id => (
        <div key={id} className="card">
          <h3>{links.get(id)?.name}<span className="muted">{` · norm ${links.get(id)?.normDays ?? 15} days`}</span></h3>
          <div className="tablewrap"><table className="tbl"><thead><tr><th>{'Product'}</th><th>{'Stock'}</th><th>{'Days'}</th></tr></thead>
            <tbody>{shown.filter(r => r.dbLinkId === id).map(r => <tr key={r.productId}><td>{r.name}{r.nearExpiry ? <div className="s" style={{ color: 'var(--warn)' }}>{r.nearExpiry} {'expire within 60 days'}</div> : null}</td><td className="num">{r.qty}</td><td className="num" style={{ color: r.status === 'low' ? 'var(--bad)' : r.status === 'high' ? 'var(--warn)' : undefined }}>{r.days ?? '—'}</td></tr>)}</tbody></table></div>
        </div>
      ))}
      {!shown.length && <div className="card muted">{only === 'low' ? 'Nothing is running low.' : 'Nothing to show.'}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- shops (outlet list from linked distributors)
export function Outlets() {
  const [d, setD] = useState<Awaited<ReturnType<typeof outletList>> | null>(null);
  const [links, setLinks] = useState<Map<string, DbLink>>(new Map());
  const [q, setQ] = useState('');
  useEffect(() => { void (async () => setLinks(new Map((await myLinks(session().userId)).map(l => [l.id, l]))))(); }, []);
  useEffect(() => { const t = setTimeout(() => { void outletList(q).then(setD).catch(e => notify('Shops', (e as Error).message)); }, q ? 300 : 0); return () => clearTimeout(t); }, [q]);
  if (!d) return <div className="card muted">{'Loading…'}</div>;
  return (
    <div className="stack">
      <div className="kpis"><div className="kpi"><div className="v">{d.total}</div><div className="l">{'shops'}</div></div><div className="kpi"><div className="v">{d.bought}</div><div className="l">{'bought this month'}</div></div><div className="kpi"><div className="v">{pct(d.bought, d.total)}%</div><div className="l">{'reached'}</div></div></div>
      <label className="home-search"><Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={'Search shop, town or beat…'} /></label>
      <div className="list">{d.shops.map(s => (
        <div key={s.id} className="item">
          <div className="grow"><div className="t">{s.name}</div><div className="s">{[s.area, s.beat, links.get(s.dbLinkId ?? '')?.name, s.approved ? '' : 'waiting for distributor OK'].filter(Boolean).join(' · ')}</div></div>
          {s.monthValue ? <div className="num">{inr(s.monthValue)}</div> : <span className="muted">{'—'}</span>}
        </div>
      ))}</div>
      {d.shops.length >= 300 && <div className="muted">{'Showing the first 300 — search to find a shop.'}</div>}
      <div className="muted">{'Shops come from your linked distributors. Phone numbers, owners and credit terms stay with the distributor.'}</div>
    </div>
  );
}

// ---------------------------------------------------------------- invoices to distributors (Excel from SAP / Tally)
export function Invoices() {
  const [list, setList] = useState<PrimaryInvoice[] | null>(null);
  const [asked, setAsked] = useState<PrimaryOrder[]>([]);
  const [drafts, setDrafts] = useState<PrimaryDraft[] | null>(null);
  const [links, setLinks] = useState<Map<string, DbLink>>(new Map());
  const [grn, setGrn] = useState<Map<string, string>>(new Map());
  const file = useRef<HTMLInputElement>(null);
  const load = async () => {
    setLinks(new Map((await db.dbLinks.toArray()).map(l => [l.id, l])));
    setGrn(new Map((await db.grns.toArray()).map(g => [g.primaryInvoiceId, g.status])));
    const inv = (await db.primaryInvoices.toArray()).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
    setList(inv);
    setAsked((await db.primaryOrders.toArray()).filter(o => o.status === 'sent' && !inv.some(i => i.primaryOrderId === o.id && !i.cancelled)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  };
  useEffect(() => { void load(); }, []);
  const pick = async (f: File) => act(async () => {
    const rows = readPrimaryRows(await readSheet(f));
    if (!rows?.length) throw new Error('Could not find invoice lines. The sheet needs columns for invoice number, distributor (customer), item and quantity.');
    setDrafts(await draftPrimary(rows));
  });
  if (!list) return <div className="card muted">{'Loading…'}</div>;
  if (drafts) {
    const ok = drafts.filter(d => !d.problems.length);
    return (
      <div className="stack">
        <div className="card"><h3>{`${drafts.length} invoice${drafts.length === 1 ? '' : 's'} in the file`}</h3><div className="muted">{`${ok.length} ready to send · ${drafts.length - ok.length} need fixing in the file`}</div></div>
        {drafts.map(d => (
          <div key={d.invoice.number} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}><b>{d.invoice.number}</b><span className="num">{inr(d.invoice.total)}</span></div>
            <div className="muted">{[day(d.invoice.date), links.get(d.invoice.dbLinkId)?.name, `${plural(d.invoice.lines.length, 'line')}`].filter(Boolean).join(' · ')}</div>
            {d.problems.map(p => <div key={p} style={{ color: 'var(--bad)' }}>{p}</div>)}
          </div>
        ))}
        <div className="row">
          <button className="btn primary" disabled={!ok.length} onClick={() => act(async () => { const n = await sendPrimary(drafts); setDrafts(null); await load(); await notify(`${n} sent`, 'Each distributor sees the invoice waiting to be received.'); })}>{`Send ${ok.length}`}</button>
          <button className="btn ghost" onClick={() => setDrafts(null)}>{'Cancel'}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="stack">
      {asked.length > 0 && <div className="card">
        <h3>{'Orders from distributors'}</h3>
        {asked.map(o => (
          <div key={o.id} className="item">
            <div className="grow"><div className="t">{links.get(o.dbLinkId ?? '')?.name}</div><div className="s">{`${day(o.date)} · ${o.lines.map(l => `${l.name} ${l.qty}`).join(', ')}`}</div></div>
            <button className="btn small primary" onClick={async () => { const n = await askText('Invoice number (as in your billing system)'); if (n && await act(() => invoiceFromOrder(o.id, n))) void load(); }}>{'Invoice'}</button>
          </div>
        ))}
      </div>}
      <div className="card">
        <h3>{'Upload your sales register'}</h3>
        <div className="muted" style={{ marginBottom: 8 }}>{'Export your invoices to distributors from SAP or Tally as Excel (one row per item). Hanubix sends each invoice to its distributor, who receives the goods against it.'}</div>
        <input ref={file} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
        <button className="btn primary" onClick={() => file.current?.click()}><FileUp size={16} /> {'Choose Excel file'}</button>
      </div>
      <div className="list">{list.map(i => (
        <div key={i.id} className="item">
          <div className="grow"><div className="t">{i.number}</div><div className="s">{[day(i.date), links.get(i.dbLinkId)?.name, grn.get(i.id) === 'received' ? 'Received' : grn.get(i.id) === 'disputed' ? 'Received with differences' : 'Waiting to be received'].filter(Boolean).join(' · ')}</div></div>
          <div className="num">{inr(i.total)}</div>
        </div>
      ))}</div>
      {!list.length && <div className="card muted">{'No invoices sent yet.'}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- products & prices
const blankP = (): ProductInput => ({ name: '', code: '', hsn: '', gst: 5, mrp: 0, rate: 0, purchaseRate: 0, caseSize: 1 });
export function Products() {
  const [list, setList] = useState<Product[] | null>(null);
  const [edit, setEdit] = useState<ProductInput | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = async () => setList((await db.products.toArray()).sort((a, b) => a.name.localeCompare(b.name)));
  useEffect(() => { void load(); }, []);
  if (!list) return <div className="card muted">{'Loading…'}</div>;
  if (edit) {
    const n = (k: keyof ProductInput, label: string) => <div className="field"><label>{label}</label><input inputMode="decimal" value={String(edit[k] ?? '')} onChange={e => setEdit({ ...edit, [k]: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} /></div>;
    const bad = checkProduct(edit);
    return (
      <div className="card">
        <h3>{edit.id ? 'Change product' : 'New product'}</h3>
        <div className="field"><label>{'Name'}</label><input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></div>
        <div className="field"><label>{'Code'}</label><input value={edit.code ?? ''} onChange={e => setEdit({ ...edit, code: e.target.value })} /></div>
        <div className="field"><label>{'HSN'}</label><input value={edit.hsn} onChange={e => setEdit({ ...edit, hsn: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="field"><label>{'GST %'}</label><select value={edit.gst} onChange={e => setEdit({ ...edit, gst: Number(e.target.value) })}>{GST_RATES.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
        {n('mrp', 'MRP')}{n('rate', 'Price to shop (PTR)')}{n('purchaseRate', 'Price to distributor (PTD)')}{n('caseSize', 'Pieces per case')}
        {bad && <div style={{ color: 'var(--bad)', marginBottom: 8 }}>{bad}</div>}
        <div className="muted" style={{ marginBottom: 8 }}>{'Saved prices reach every linked distributor at their next sync.'}</div>
        <div className="row"><button className="btn primary" disabled={!!bad} onClick={() => act(async () => { await saveProducts([edit]); setEdit(null); await load(); })}>{'Save'}</button><button className="btn ghost" onClick={() => setEdit(null)}>{'Cancel'}</button></div>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="row">
        <button className="btn primary" onClick={() => setEdit(blankP())}>{'Add product'}</button>
        <input ref={file} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void act(async () => {
          const rows = readProductRows(await readSheet(f));
          if (!rows?.length) throw new Error('Could not find products. The sheet needs a product name column.');
          const list = rows.map(r => ({ name: r.name, code: r.code, hsn: r.hsn, gst: r.gst, mrp: r.mrp, rate: r.rate, purchaseRate: r.purchase || Math.round(r.rate * 0.9 * 100) / 100, caseSize: Math.round(r.caseSize) || 1 }));
          if (!await confirmBox(`Save ${plural(list.length, 'product')}?`, 'Same code or name = the existing product is updated.', 'Save')) return;
          await saveProducts(list); await load();
        }); }} />
        <button className="btn" onClick={() => file.current?.click()}><FileUp size={16} /> {'From Excel'}</button>
      </div>
      <div className="list">{list.map(p => (
        <button key={p.id} className="item tap" onClick={() => setEdit({ id: p.id, name: p.name, code: p.code, hsn: p.hsn, gst: p.gst, mrp: p.mrp, rate: p.rate, purchaseRate: p.purchaseRate, caseSize: p.caseSize, aliases: p.aliases, active: p.active })}>
          <div className="grow" style={{ textAlign: 'left' }}><div className="t">{p.name}{p.active ? '' : ' (stopped)'}</div><div className="s">{[p.code, `MRP ${inr(p.mrp)}`, `PTR ${inr(p.rate)}`, `PTD ${inr(p.purchaseRate)}`, `${p.caseSize}/case`].filter(Boolean).join(' · ')}</div></div>
          <ChevronRight size={18} />
        </button>
      ))}</div>
    </div>
  );
}

// ---------------------------------------------------------------- schemes
export function Schemes() {
  const [list, setList] = useState<Scheme[] | null>(null);
  const [used, setUsed] = useState<Map<string, number>>(new Map());
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<{ name: string; productId: string; type: 'pct' | 'free'; value: string; buy: string; free: string; from: string; to: string; budget: string } | null>(null);
  const load = async () => {
    setProducts(await db.products.toArray()); setList((await db.schemes.toArray()).sort((a, b) => b.to.localeCompare(a.to)));
    const u = new Map<string, number>(); for (const d of await db.claimDecisions.toArray()) if (d.status === 'approved') for (const l of d.lines ?? []) if (l.schemeId) u.set(l.schemeId, (u.get(l.schemeId) ?? 0) + l.amount);
    setUsed(u);
  };
  useEffect(() => { void load(); }, []);
  if (!list) return <div className="card muted">{'Loading…'}</div>;
  const pn = (id?: string) => products.find(p => p.id === id)?.name ?? 'All products';
  return (
    <div className="stack">
      {!form && <button className="btn primary block" onClick={() => setForm({ name: '', productId: '', type: 'pct', value: '', buy: '', free: '', from: today(), to: today(), budget: '' })}>{'New scheme'}</button>}
      {form && (
        <div className="card">
          <h3>{'New scheme'}</h3>
          <div className="field"><label>{'Name'}</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>{'Product'}</label><select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })}><option value="">{'All products'}</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="field"><label>{'Type'}</label><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as 'pct' | 'free' })}><option value="pct">{'% off'}</option><option value="free">{'Buy some, get some free'}</option></select></div>
          {form.type === 'pct' ? <div className="field"><label>{'% off'}</label><input inputMode="decimal" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></div>
            : <div className="row"><div className="field grow"><label>{'Buy'}</label><input inputMode="numeric" value={form.buy} onChange={e => setForm({ ...form, buy: e.target.value })} /></div><div className="field grow"><label>{'Get free'}</label><input inputMode="numeric" value={form.free} onChange={e => setForm({ ...form, free: e.target.value })} /></div></div>}
          <div className="row"><div className="field grow"><label>{'From'}</label><input type="date" value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} /></div><div className="field grow"><label>{'To'}</label><input type="date" value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} /></div></div>
          <div className="field"><label>{'Budget ₹ (the most you will pay out)'}</label><input inputMode="numeric" value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="row">
            <button className="btn primary" onClick={() => act(async () => { await saveScheme({ name: form.name, productId: form.productId || undefined, type: form.type, value: Number(form.value), buyQty: Number(form.buy) || undefined, freeQty: Number(form.free) || undefined, from: form.from, to: form.to, budget: form.budget ? Number(form.budget) : undefined }); setForm(null); await load(); })}>{'Save and send to distributors'}</button>
            <button className="btn ghost" onClick={() => setForm(null)}>{'Cancel'}</button>
          </div>
        </div>
      )}
      <div className="list">{list.map(s => (
        <div key={s.id} className="item">
          <div className="grow"><div className="t">{s.name}</div><div className="s">{[pn(s.productId), s.type === 'pct' ? `${s.value}% off` : `buy ${s.buyQty} get ${s.freeQty}`, `${day(s.from)} → ${day(s.to)}`, s.budget ? `paid ${inr(used.get(s.id) ?? 0)} of ${inr(s.budget)} budget` : '', s.to < today() ? 'ended' : ''].filter(Boolean).join(' · ')}</div></div>
        </div>
      ))}</div>
      {!list.length && <div className="card muted">{'No schemes yet.'}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- team
export function Team({ role }: { role: Role }) {
  const [list, setList] = useState<Staff[] | null>(null);
  const [links, setLinks] = useState<DbLink[]>([]);
  const [edit, setEdit] = useState<StaffInput | null>(null);
  const load = async () => {
    const { myTeam } = await import('../core/company');
    setList(await myTeam(session().userId)); setLinks((await db.dbLinks.toArray()).filter(l => l.status !== 'invited'));
  };
  useEffect(() => { void load(); }, []);
  if (!list) return <div className="card muted">{'Loading…'}</div>;
  const name = (id?: string) => list.find(s => s.id === id)?.name ?? '';
  const roleName = (s: Staff) => s.role === 'cadmin' ? 'Head office' : s.role === 'manager' ? s.level ?? 'Manager' : 'Field rep';
  if (edit) {
    const managers = list.filter(s => s.role !== 'rep' && s.id !== edit.id);
    return (
      <div className="card">
        <h3>{edit.id ? 'Change team member' : 'Add team member'}</h3>
        <div className="field"><label>{'Name'}</label><input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></div>
        <div className="field"><label>{'Mobile'}</label><input inputMode="numeric" value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></div>
        <div className="field"><label>{'Role'}</label><select value={edit.role} onChange={e => setEdit({ ...edit, role: e.target.value as StaffInput['role'] })}><option value="rep">{'Field rep'}</option><option value="manager">{'Manager (RSM / ASM / SO)'}</option><option value="cadmin">{'Head office'}</option></select></div>
        {edit.role === 'manager' && <div className="field"><label>{'Level'}</label><select value={edit.level ?? ''} onChange={e => setEdit({ ...edit, level: (e.target.value || undefined) as Staff['level'] })}><option value="">{'Choose'}</option><option value="RSM">RSM</option><option value="ASM">ASM</option><option value="SO">SO</option></select></div>}
        {edit.role !== 'cadmin' && <div className="field"><label>{'Reports to'}</label><select value={edit.managerId ?? ''} onChange={e => setEdit({ ...edit, managerId: e.target.value || undefined })}><option value="">{'—'}</option>{managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>}
        {edit.role !== 'cadmin' && <div className="field"><label>{'Distributors'}</label><div className="chips">{links.map(l => <button key={l.id} className={`chip ${edit.dbLinkIds.includes(l.id) ? 'on' : ''}`} onClick={() => setEdit({ ...edit, dbLinkIds: edit.dbLinkIds.includes(l.id) ? edit.dbLinkIds.filter(x => x !== l.id) : [...edit.dbLinkIds, l.id] })}>{l.name}</button>)}</div></div>}
        <div className="field"><label>{'Home town (HQ)'}</label><input value={edit.hq ?? ''} onChange={e => setEdit({ ...edit, hq: e.target.value })} /></div>
        {!edit.id && <div className="field"><label>{'First-login PIN (4 digits)'}</label><input inputMode="numeric" value={edit.pin ?? ''} onChange={e => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></div>}
        <div className="row"><button className="btn primary" onClick={() => act(async () => { await saveStaff(edit); setEdit(null); await load(); })}>{'Save'}</button><button className="btn ghost" onClick={() => setEdit(null)}>{'Cancel'}</button>
          {edit.id && edit.id !== session().userId && <button className="btn ghost" style={{ color: 'var(--bad)' }} onClick={async () => { if (await confirmBox('Remove access?', 'Their phone is logged out at once. History stays.', 'Remove') && await act(() => saveStaff({ ...edit, active: false }))) { setEdit(null); await load(); } }}>{'Remove access'}</button>}</div>
      </div>
    );
  }
  return (
    <div className="stack">
      {role === 'cadmin' && <button className="btn primary block" onClick={() => setEdit({ name: '', phone: '', role: 'rep', dbLinkIds: [] })}>{'Add team member'}</button>}
      <div className="list">{list.map(s => (
        <button key={s.id} className="item tap" onClick={() => role === 'cadmin' ? setEdit({ id: s.id, name: s.name, phone: s.phone, role: s.role as StaffInput['role'], level: s.level, managerId: s.managerId, dbLinkIds: s.dbLinkIds ?? [], hq: s.hq, grade: s.grade }) : undefined}>
          <div className="grow" style={{ textAlign: 'left' }}><div className="t">{s.name}</div><div className="s">{[roleName(s), s.managerId ? `reports to ${name(s.managerId)}` : '', s.hq].filter(Boolean).join(' · ')}</div></div>
          {role === 'cadmin' && <ChevronRight size={18} />}
        </button>
      ))}</div>
    </div>
  );
}

export function CompanyPage({ page, role, go }: { page: CoPage; role: Role; go: (p: CoPage | 'home') => void }) {
  switch (page) {
    case 'fd-day': return <MyWorkDay />;
    case 'fd-beat': return <TodaysBeat onDay={() => go('fd-day')} />;
    case 'fd-orders': return <MyOrders />;
    case 'fd-newshop': return <NewShopRequest onDone={() => go('home')} />;
    case 'fd-month': return <MyMonth />;
    case 'fd-team': return <TeamToday />;
    case 'fd-approvals': return <Approvals />;
    case 'fd-targets': return <Targets />;
    case 'fd-expenses': return <MyExpenses />;
    case 'cl-inbox': return <ClaimsInbox role={role} />;
    case 'co-distributors': return <Distributors role={role} />;
    case 'co-sales': return <Sales />;
    case 'co-stock': return <StockAtDistributors />;
    case 'co-outlets': return <Outlets />;
    case 'co-invoices': return <Invoices />;
    case 'co-products': return <Products />;
    case 'co-schemes': return <Schemes />;
    case 'co-team': return <Team role={role} />;
  }
}
