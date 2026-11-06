import { useEffect, useState } from 'react';
import { PhotoButton } from './PhotoButton';
import { Upload, Check, Store, Download, ArrowLeft, DoorClosed, X, Route } from 'lucide-react';
import { ChangeSet, db, session, today, activeShops } from '../core/db';
import { orderStops } from '../core/pipeline';
import { getLang, inr, speak, t } from '../core/i18n';
import { downloadWorkbook, isSheet, readSheet, readShopRows } from '../core/readers';
import { norm } from '../core/match';
import type { DayPlan, LiteEntry, Shop } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);

// Standalone Delivery + Collection (no orders/billing bought): a shop list, today's picks,
// auto route, delivered/closed with photo, and plain payment entry. No balances, no memory.

export function LiteShops() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [msg, setMsg] = useState('');
  const load = () => db.shops.toArray().then(x => setShops(x.sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name))));
  useEffect(() => { load(); }, []);
  const upload = async (f: File) => {
    if (!isSheet(f)) { setMsg(L('Send an Excel or CSV file.', 'Excel அல்லது CSV அனுப்பவும்.')); return; }
    const rows = readShopRows(await readSheet(f));
    if (!rows) { setMsg(L('Could not find a shop name column.', 'கடை பெயர் நெடுவரிசை இல்லை.')); return; }
    const existing = new Set(shops.map(s => norm(s.name)));
    const cs = new ChangeSet(); let n = 0;
    for (const r of rows) { if (existing.has(norm(r.name))) continue; cs.put<Shop>('shops', { name: r.name, owner: r.owner, phone: r.phone, gstin: r.gstin || undefined, area: r.area, beat: r.beat, creditLimit: 0, creditDays: 0, cashOnly: false, type: 'retail', approved: true, aliases: [], address: r.address }, 'shop from list'); n++; }
    if (n) await cs.commit('Shop list uploaded');
    setMsg(`${n} ${L('shops added', 'கடைகள் சேர்க்கப்பட்டன')}`); load();
  };
  return (
    <div className="stack">
      <div className="sechead"><h3>{L('Shop list', 'கடை பட்டியல்')} · {shops.length}</h3></div>
      <label className="btn primary big block"><Upload /> {L('Upload shop list (Excel)', 'கடை பட்டியல் பதிவேற்று (Excel)')}<input type="file" hidden accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} /></label>
      <div className="muted">{L('Columns we look for: shop name, owner, mobile, area, address. Any order, any extra columns are fine.', 'நெடுவரிசைகள்: கடை பெயர், உரிமையாளர், மொபைல், பகுதி, முகவரி.')}</div>
      {msg && <div className="alert ok"><Check /><div>{msg}</div></div>}
      <div className="list">{shops.map(s => <div key={s.id} className="item"><div className="avatar"><Store size={20} /></div><div className="grow"><div className="t">{s.name}</div><div className="s">{s.area}{s.phone ? ` · ${s.phone}` : ''}</div></div></div>)}</div>
    </div>
  );
}

export function LitePlan({ onDone }: { onDone: () => void }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  useEffect(() => { (async () => { setShops((await activeShops()).sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name))); const p = await db.dayPlans.where('date').equals(today()).first(); if (p) setSel(new Set(p.shopIds)); })(); }, []);
  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    const chosen = orderStops(shops.filter(s => sel.has(s.id)).map(shop => ({ shop }))).map(x => x.shop.id);
    const existing = await db.dayPlans.where('date').equals(today()).first();
    const cs = new ChangeSet();
    cs.put<DayPlan>('dayPlans', { ...(existing ?? {}), date: today(), shopIds: chosen }, 'day plan');
    await cs.commit("Today's shops"); onDone();
  };
  const shown = shops.filter(s => !q || norm(s.name).includes(norm(q)) || norm(s.area).includes(norm(q)));
  const areas = [...new Set(shown.map(s => s.area))];
  return (
    <div className="stack">
      <div className="sechead"><h3>{L("Today's shops", 'இன்றைய கடைகள்')} · {sel.size}</h3><button className="link" onClick={() => setSel(new Set(shown.map(s => s.id)))}>{L('Select all shown', 'எல்லாம்')}</button></div>
      <div className="field"><input placeholder={L('Search shop or area…', 'கடை / பகுதி தேடு…')} value={q} onChange={e => setQ(e.target.value)} aria-label="Search" /></div>
      {areas.map(a => (
        <div key={a}>
          <div className="eyebrow" style={{ margin: '6px 0' }}>{a}</div>
          <div className="list">
            {shown.filter(s => s.area === a).map(s => (
              <button key={s.id} className="item tap" onClick={() => toggle(s.id)}>
                <div className={`avatar ${sel.has(s.id) ? 'ok' : ''}`}>{sel.has(s.id) ? <Check /> : <Store size={20} />}</div>
                <div className="grow"><div className="t">{s.name}</div><div className="s">{s.owner ?? ''}{s.phone ? ` · ${s.phone}` : ''}</div></div>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="sticky-foot"><div className="grow muted"><Route size={16} style={{ verticalAlign: -3 }} /> {L('Route order is set automatically by area/location', 'வழி தானாக வரிசைப்படுத்தப்படும்')}</div><button className="btn primary big" disabled={!sel.size} onClick={save}><Check /> {L('Set route', 'வழி அமை')}</button></div>
    </div>
  );
}

export function LiteDelivery() {
  const [stops, setStops] = useState<(Shop & { entry?: LiteEntry })[]>([]);
  const [open, setOpen] = useState<Shop | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => { const p = await db.dayPlans.where('date').equals(today()).first(); const shops = new Map((await activeShops()).map(s => [s.id, s])); const es = (await db.liteEntries.where('date').equals(today()).toArray()).filter(e => e.kind !== 'payment'); setStops((p?.shopIds ?? []).map(id => ({ ...shops.get(id)!, entry: es.find(e => e.shopId === id) }))); })(); }, [tick]);
  if (open) return <LiteStop shop={open} onClose={() => { setOpen(null); setTick(x => x + 1); }} />;
  const done = stops.filter(s => s.entry).length;
  return (
    <div className="stack">
      <div className="kpi navy"><div className="v">{done}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{stops.length}</span></div><div className="l">{L('shops done today', 'இன்று முடிந்த கடைகள்')}</div></div>
      <div className="route">
        {stops.map((s, k) => (
          <button key={s.id} className={`stop item tap ${s.entry ? 'done' : k === done ? 'now' : ''}`} style={{ opacity: s.entry ? .6 : 1 }} onClick={() => setOpen(s)}>
            <div className={`avatar ${s.entry ? (s.entry.kind === 'delivered' ? 'ok' : 'bad') : ''}`}>{s.entry ? (s.entry.kind === 'delivered' ? <Check /> : <DoorClosed />) : <span>{k + 1}</span>}</div>
            <div className="grow"><div className="t">{s.name}</div><div className="s">{s.area}{s.phone ? ` · ${s.phone}` : ''}{s.entry ? ` · ${s.entry.kind}` : ''}</div></div>
          </button>
        ))}
        {!stops.length && <div className="card muted">{L('No shops chosen for today. The owner picks them in "Today\'s shops".', 'இன்று கடைகள் தேர்வு செய்யப்படவில்லை.')}</div>}
      </div>
    </div>
  );
}

function LiteStop({ shop, onClose }: { shop: Shop; onClose: () => void }) {
  const [photo, setPhoto] = useState<string>();
  const save = async (kind: LiteEntry['kind']) => {
    const cs = new ChangeSet();
    cs.put<LiteEntry>('liteEntries', { date: today(), shopId: shop.id, kind, photo, by: session().userId }, kind);
    await cs.commit('Delivery'); onClose();
  };
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'nowrap' }}><button className="icon-btn" onClick={onClose} aria-label="Back"><ArrowLeft /></button><div className="grow"><div className="h">{shop.name}</div><div className="muted">{shop.area}</div></div></div>
      <div className="card stack" style={{ textAlign: 'center' }}>
        <PhotoButton facing="environment" onPhoto={setPhoto} />
        <button className="btn ok-huge" onClick={() => save('delivered')} aria-label="Delivered"><Check size={84} /></button>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <button className="btn grow" onClick={() => save('closed')}><DoorClosed /> {L('Shop closed', 'கடை மூடி')}</button>
          <button className="btn grow danger" onClick={() => save('refused')}><X /> {L('Refused', 'மறுத்தது')}</button>
        </div>
      </div>
    </div>
  );
}

export function LiteCollect() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [entries, setEntries] = useState<LiteEntry[]>([]);
  const [shopId, setShopId] = useState('');
  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<'cash' | 'upi' | 'cheque'>('cash');
  const [ref, setRef] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => { const p = await db.dayPlans.where('date').equals(today()).first(); const all = await activeShops(); const todays = p ? p.shopIds.map(id => all.find(s => s.id === id)!).filter(Boolean) : []; setShops([...todays, ...all.filter(s => !todays.includes(s))]); setEntries((await db.liteEntries.where('date').equals(today()).toArray()).filter(e => e.kind === 'payment')); })(); }, [tick]);
  const save = async () => {
    if (!shopId || amount <= 0) return;
    const cs = new ChangeSet();
    cs.put<LiteEntry>('liteEntries', { date: today(), shopId, kind: 'payment', amount, mode, ref, by: session().userId, shopConfirmed: true }, 'payment');
    await cs.commit('Collection'); speak(`${amount} ரூபாய் பெறப்பட்டது. நன்றி.`);
    setAmount(0); setRef(''); setTick(x => x + 1);
  };
  const names = new Map(shops.map(s => [s.id, s.name]));
  const total = entries.reduce((a, e) => a + (e.amount ?? 0), 0);
  return (
    <div className="stack">
      <div className="kpi navy"><div className="v">{inr(total)}</div><div className="l">{L('collected today', 'இன்றைய வசூல்')} · {entries.length}</div></div>
      <div className="card stack">
        <div className="field"><label>{t('shop')}</label><select value={shopId} onChange={e => setShopId(e.target.value)}><option value="">— {L('pick shop', 'கடை தேர்வு')} —</option>{shops.map(s => <option key={s.id} value={s.id}>{s.name} · {s.area}</option>)}</select></div>
        <div className="field"><label>{t('amount')}</label><input className="bigamount" type="number" inputMode="decimal" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} aria-label={t('amount')} /></div>
        <div className="segmented">{(['cash', 'upi', 'cheque'] as const).map(m => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{t(m)}</button>)}</div>
        {mode !== 'cash' && <div className="field"><label>UPI / cheque no</label><input value={ref} onChange={e => setRef(e.target.value)} /></div>}
        <p className="muted" style={{ margin: 0, textAlign: 'center' }}>{t('shopConfirm')}</p>
        <button className="btn ok-huge" disabled={!shopId || amount <= 0} onClick={save} aria-label="Shop confirms payment"><Check size={84} /></button>
      </div>
      <div className="list">{entries.map(e => <div key={e.id} className="item"><div className="grow"><div className="t">{names.get(e.shopId)}</div><div className="s">{e.mode?.toUpperCase()}{e.ref ? ` · ${e.ref}` : ''}</div></div><span className="amt num">{inr(e.amount ?? 0)}</span></div>)}</div>
    </div>
  );
}

export function LiteExport() {
  const [n, setN] = useState({ d: 0, p: 0 });
  useEffect(() => { db.liteEntries.where('date').equals(today()).toArray().then(es => setN({ d: es.filter(e => e.kind !== 'payment').length, p: es.filter(e => e.kind === 'payment').length })); }, []);
  const go = async () => {
    const es = await db.liteEntries.where('date').equals(today()).toArray();
    const names = new Map((await activeShops()).map(s => [s.id, s]));
    const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
    await downloadWorkbook(`DBRoX-day-${today()}`, [
      { name: 'Deliveries', header: ['Shop', 'Area', 'Result', 'Time', 'By'], rows: es.filter(e => e.kind !== 'payment').map(e => [names.get(e.shopId)?.name ?? '', names.get(e.shopId)?.area ?? '', e.kind, e.createdAt.slice(11, 16), staff.get(e.by) ?? e.by]) },
      { name: 'Collections', header: ['Shop', 'Amount', 'Mode', 'Ref', 'Time', 'By'], rows: es.filter(e => e.kind === 'payment').map(e => [names.get(e.shopId)?.name ?? '', e.amount ?? 0, e.mode ?? '', e.ref ?? '', e.createdAt.slice(11, 16), staff.get(e.by) ?? e.by]) },
    ]);
  };
  return (
    <div className="stack">
      <div className="kpis"><div className="kpi"><div className="v">{n.d}</div><div className="l">{L('deliveries today', 'இன்றைய டெலிவரி')}</div></div><div className="kpi"><div className="v">{n.p}</div><div className="l">{L('collections today', 'இன்றைய வசூல்')}</div></div></div>
      <button className="btn primary big block" onClick={go}><Download /> {L("Download today's Excel", 'இன்றைய Excel பதிவிறக்கு')}</button>
      <div className="muted">{L('Two sheets: Deliveries and Collections. Load it into Tally or your billing software.', 'இரண்டு தாள்கள்: டெலிவரி, வசூல்.')}</div>
    </div>
  );
}
