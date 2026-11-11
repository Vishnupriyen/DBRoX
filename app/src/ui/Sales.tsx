import { DEFAULT_STATE, shopStateCode, STATES } from '../core/gst';
import { useEffect, useState } from 'react';
import { Check, X, MapPin, Phone, Store, AlertTriangle, Target as TargetIcon } from 'lucide-react';
import { ChangeSet, db, session, today } from '../core/db';
import { inr, showMonth, inrR } from '../core/i18n';
import { norm } from '../core/match';
import { validGstin, r2 } from '../core/ledger';
import { PhotoButton } from './PhotoButton';
import { getPos } from './Beat';
import { askText } from './dialog';
import type { Company, Shop, Target } from '../core/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---------- Shop onboarding at the counter: six fields, photo captures the location ----------
export function NewShop({ onDone }: { onDone: () => void }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [f, setF] = useState({ name: '', owner: '', phone: '', area: '', beat: DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1], gstin: '', stateCode: DEFAULT_STATE });
  const [photo, setPhoto] = useState<string>();
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [role, setRole] = useState('salesman');
  const [saved, setSaved] = useState(false);
  useEffect(() => { db.shops.toArray().then(setShops); db.staff.get(session().userId).then(s => setRole(s?.role ?? 'salesman')); }, []);
  const areas = [...new Set(shops.map(s => s.area))].sort();
  const dupPhone = f.phone.length === 10 && shops.find(s => s.phone === f.phone);
  const dupName = f.name.length > 3 && shops.find(s => norm(s.name) === norm(f.name) && s.area === f.area);
  const gstBad = f.gstin.length > 0 && !validGstin(f.gstin);
  const ok = f.name.trim().length > 1 && f.phone.length === 10 && f.area.trim() && !gstBad;
  const takePhoto = async (p: string) => { setPhoto(p); setPos(await getPos()); };
  const save = async () => {
    const owner = role === 'owner' || role === 'office';
    const cs = new ChangeSet();
    cs.put<Shop>('shops', { name: f.name.trim(), owner: f.owner, phone: f.phone, area: f.area.trim(), beat: f.beat, gstin: f.gstin || undefined, stateCode: shopStateCode({ gstin: f.gstin || undefined, stateCode: f.stateCode }), creditLimit: 0, creditDays: 0, cashOnly: true, type: 'retail', approved: owner, aliases: [], photo, lat: pos?.lat, lng: pos?.lng, salesmanId: owner ? undefined : session().userId }, 'new shop');
    await cs.commit('New shop'); setSaved(true);
  };
  if (saved) return <div className="card stack" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto' }}><Check /></div><b>{f.name}</b><div className="muted">{role === 'salesman' ? 'Sent to the owner for approval. You can book orders; they wait for his OK.' : 'Shop added.'}</div><button className="btn primary" onClick={onDone}>{'Done'}</button></div>;
  return (
    <div className="stack">
      <div className="card stack">
        <div className="field"><label>{'Shop name *'}</label><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus />{dupName && <div className="alert"><AlertTriangle /><div>{'A shop with this name exists in'} {dupName.area}. {'Same shop?'}</div></div>}</div>
        <div className="field"><label>{'Owner name'}</label><input value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })} /></div>
        <div className="field"><label>{'Mobile *'}</label><input inputMode="numeric" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />{dupPhone && <div className="alert bad"><AlertTriangle /><div>{'This number is'} <b>{dupPhone.name}</b>, {dupPhone.area}. {'Same shop — do not add twice.'}</div></div>}</div>
        <div className="field"><label>{'Shop photo (sets the location)'}</label><PhotoButton facing="environment" onPhoto={takePhoto} />{photo && <div className="muted"><MapPin size={14} style={{ verticalAlign: -2 }} /> {pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : 'location not available — will be set at first delivery'}</div>}</div>
        <div className="row" style={{ gap: 8 }}>
          <div className="field grow"><label>{'Area *'}</label><input list="areas" value={f.area} onChange={e => setF({ ...f, area: e.target.value })} /><datalist id="areas">{areas.map(a => <option key={a} value={a} />)}</datalist></div>
          <div className="field"><label>{'Beat day'}</label><select value={f.beat} onChange={e => setF({ ...f, beat: e.target.value })}>{DAYS.map(d => <option key={d}>{d}</option>)}</select></div>
        </div>
        <div className="field"><label>GSTIN ({'optional'})</label><input value={f.gstin} onChange={e => setF({ ...f, gstin: e.target.value.toUpperCase().slice(0, 15) })} />{gstBad && <div style={{ color: 'var(--bad)' }}>{'GSTIN check failed — verify the number'}</div>}{f.gstin.length === 15 && !gstBad && <span className="badge ok">{'B2B billing on'}</span>}</div>
        {!f.gstin && <div className="field"><label>{'State (for GST)'}</label><select value={f.stateCode} onChange={e => setF({ ...f, stateCode: e.target.value })}>{Object.entries(STATES).map(([c, n]) => <option key={c} value={c}>{c} {n}</option>)}</select></div>}
        <button className="btn primary big block" disabled={!ok || !!dupPhone} onClick={save}><Check /> {'Add shop'}</button>
        <div className="muted">{'Credit: cash-only until the owner sets a limit.'}</div>
      </div>
    </div>
  );
}

// ---------- Owner: approve new shops, set credit in the same tap ----------
export function NewShops() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [staff, setStaff] = useState<Map<string, string>>(new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => { setShops((await db.shops.toArray()).filter(s => !s.approved && !s.aliases.includes('rejected'))); setStaff(new Map((await db.staff.toArray()).map(s => [s.id, s.name]))); })(); }, [tick]);
  const approve = async (s: Shop) => {
    const lim = await askText('Credit limit ₹ (0 = cash only)', '0'); if (lim === null) return;
    const days = Number(lim) > 0 ? Number(await askText('Credit days', '7') ?? 7) : 0;
    const cs = new ChangeSet(); cs.put('shops', { ...s, approved: true, creditLimit: Number(lim) || 0, creditDays: days, cashOnly: !(Number(lim) > 0) }, 'shop approved'); await cs.commit('Shop approved'); setTick(x => x + 1);
  };
  return (
    <div className="stack">
      <div className="sechead"><h3>{'New shops to approve'} · {shops.length}</h3></div>
      {shops.map(s => (
        <div key={s.id} className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {s.photo ? <img src={s.photo} alt="" style={{ width: 72, height: 72, borderRadius: 14, objectFit: 'cover' }} /> : <div className="avatar" style={{ width: 72, height: 72 }}><Store /></div>}
            <div className="grow"><div className="t" style={{ fontSize: '1.0625rem', fontWeight: 700 }}>{s.name}</div><div className="s">{s.owner} · {s.area} · {s.beat}</div><div className="s">{'added by'} {staff.get(s.salesmanId ?? '') ?? '—'}{s.lat ? ` · ${s.lat.toFixed(4)}, ${s.lng?.toFixed(4)}` : ` · ${'no location yet'}`}</div></div>
          </div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="btn primary grow" onClick={() => approve(s)}><Check /> {'Approve & set credit'}</button>
            <a className="btn" href={`tel:${s.phone}`} aria-label="Call"><Phone /></a>
            <button className="btn" onClick={async () => { const cs = new ChangeSet(); cs.put('shops', { ...s, approved: false, active: false, aliases: [...s.aliases, 'rejected'] } as Shop, 'shop rejected'); await cs.commit('Shop rejected'); setTick(x => x + 1); }} aria-label="Reject"><X /></button>
          </div>
        </div>
      ))}
      {!shops.length && <div className="card muted" style={{ textAlign: 'center' }}>{'No new shops waiting.'}</div>}
    </div>
  );
}

// ---------- Targets per company per month, with the per-day pace ----------
export function Targets() {
  const [rows, setRows] = useState<{ t: Target; company: string; done: number; perDay: number }[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tick, setTick] = useState(0);
  const month = today().slice(0, 7);
  useEffect(() => { (async () => {
    const cs = await db.companies.toArray(); setCompanies(cs);
    const invs = (await db.invoices.toArray()).filter(i => !i.cancelled && i.date.startsWith(month));
    const dim = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate(); const left = Math.max(1, dim - Number(today().slice(8)));
    setRows((await db.targets.where('month').equals(month).toArray()).map(t => { const done = r2(invs.filter(i => i.companyId === t.companyId).reduce((a, i) => a + i.taxable, 0)); return { t, company: cs.find(c => c.id === t.companyId)?.name ?? '', done, perDay: r2(Math.max(0, t.value - done) / left) }; }));
  })(); }, [tick]);
  const add = async () => {
    const name = await askText('Company (name)', companies[0]?.name); const c = companies.find(x => norm(x.name) === norm(name ?? '')); if (!c) return;
    const v = Number(await askText('Sales target this month ₹', '500000')); if (!v) return;
    const cs = new ChangeSet(); const old = rows.find(r => r.t.companyId === c.id)?.t;
    cs.put<Target>('targets', { ...(old ?? {}), companyId: c.id, month, kind: 'sales', value: v }, 'target'); await cs.commit('Target set'); setTick(x => x + 1);
  };
  return (
    <div className="stack">
      <div className="sechead"><h3><TargetIcon size={18} style={{ verticalAlign: -3 }} /> {'Targets'} · {showMonth(month)}</h3><button className="link" onClick={add}>{'+ set target'}</button></div>
      {rows.map(r => { const pct = Math.min(100, Math.round(r.done / r.t.value * 100)); return (
        <div key={r.t.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{r.company}</b><span className="num">{inr(r.done)} / {inr(r.t.value)}</span></div>
          <div style={{ height: 10, background: 'var(--paper-2)', borderRadius: 999, overflow: 'hidden', margin: '6px 0' }}><div style={{ width: `${pct}%`, height: '100%', background: pct < 70 ? 'var(--bad)' : 'var(--ok)' }} /></div>
          <div className="muted">{pct}% · {'needed per day'} {inrR(r.perDay)}</div>
        </div>); })}
      {!rows.length && <div className="card muted">{'No targets set for this month.'}</div>}
    </div>
  );
}
