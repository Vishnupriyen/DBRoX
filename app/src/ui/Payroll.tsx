import { useEffect, useState } from 'react';
import { Check, X, MapPin, Clock, LogIn, UserX, IndianRupee, Download } from 'lucide-react';
import { ChangeSet, db, nowIso, today } from '../core/db';
import { getLang, inr } from '../core/i18n';
import { getPos } from './Beat';
import { downloadSheet } from '../core/readers';
import { askText, confirmBox } from './dialog';
import type { Advance, CheckIn, LeaveRequest, Settings, Staff } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);
const hm = (iso: string) => iso.slice(11, 16);

// ---------- The gate: the app opens on this until the person checks in (owner exempt) ----------
export function CheckInGate({ me, settings, onDone }: { me: Staff; settings: Settings; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const threshold = settings.checkInBy ?? '09:30';
  const late = now.toTimeString().slice(0, 5) > threshold;
  const go = async () => {
    setBusy(true);
    const pos = await getPos();
    const d = pos && settings.godownLat && settings.godownLng ? Math.round(dist(pos.lat, pos.lng, settings.godownLat, settings.godownLng)) : undefined;
    const cs = new ChangeSet();
    cs.put<CheckIn>('checkIns', { staffId: me.id, date: today(), at: nowIso(), lat: pos?.lat, lng: pos?.lng, distanceM: d, late }, 'check-in');
    await cs.commit('Check-in'); onDone();
  };
  return (
    <div className="gate">
      <div className="eyebrow">{L('Good morning', 'காலை வணக்கம்')}</div>
      <div className="h" style={{ fontSize: 26 }}>{me.name.split(' ')[0]}</div>
      <div className="muted"><Clock size={16} style={{ verticalAlign: -3 }} /> {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {today()}{late && <span className="badge warn" style={{ marginLeft: 8 }}>{L('after', 'பிறகு')} {threshold}</span>}</div>
      <button className="big-btn" disabled={busy} onClick={go}><span><LogIn /><br />{L('Check in', 'செக் இன்')}</span></button>
      <div className="muted"><MapPin size={14} style={{ verticalAlign: -2 }} /> {L('Your location and time are recorded.', 'உங்கள் இடமும் நேரமும் பதிவாகும்.')}</div>
    </div>
  );
}
function dist(a: number, b: number, c: number, d: number) { const R = 6371000, toR = (x: number) => x * Math.PI / 180; const dLat = toR(c - a), dLng = toR(d - b); const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }

// ---------- Owner: Today — who's in, late, absent; leave & advance requests ----------
export function Today() {
  const [rows, setRows] = useState<{ s: Staff; c?: CheckIn }[]>([]);
  const [leaves, setLeaves] = useState<(LeaveRequest & { name: string })[]>([]);
  const [advances, setAdvances] = useState<(Advance & { name: string })[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => {
    const staff = (await db.staff.toArray()).filter(s => s.active && s.role !== 'owner');
    const cis = await db.checkIns.where('date').equals(today()).toArray();
    setRows(staff.map(s => ({ s, c: cis.find(c => c.staffId === s.id) })));
    const names = new Map(staff.map(s => [s.id, s.name]));
    setLeaves((await db.leaves.toArray()).filter(l => l.status === 'waiting' || l.to >= today()).map(l => ({ ...l, name: names.get(l.staffId) ?? '' })));
    setAdvances((await db.advances.toArray()).filter(a => a.status === 'waiting').map(a => ({ ...a, name: names.get(a.staffId) ?? '' })));
  })(); }, [tick]);
  const onLeave = (id: string) => leaves.some(l => l.staffId === id && l.status === 'approved' && l.from <= today() && l.to >= today());
  const absentNow = new Date().toTimeString().slice(0, 5) >= '11:00';
  const mark = async (s: Staff) => {
    const why = await askText(L(`Mark ${s.name.split(' ')[0]} present — remark`, 'வருகை குறி — குறிப்பு')); if (!why) return;
    const cs = new ChangeSet(); cs.put<CheckIn>('checkIns', { staffId: s.id, date: today(), at: nowIso(), late: false }, `owner marked present: ${why}`); await cs.commit('Attendance'); setTick(x => x + 1);
  };
  const decide = async (kind: 'leaves' | 'advances', r: LeaveRequest | Advance, ok: boolean) => {
    const cs = new ChangeSet(); cs.put(kind, { ...r, status: ok ? 'approved' : 'rejected' }, ok ? 'approved' : 'rejected');
    if (kind === 'advances' && ok) cs.put('expenses', { date: today(), category: 'advance', amount: (r as Advance).amount, note: `Advance to ${(r as Advance & { name: string }).name}` }, 'advance paid');
    await cs.commit(kind); setTick(x => x + 1);
  };
  const late = (c: CheckIn) => c.late;
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi navy"><div className="v">{rows.filter(r => r.c).length}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{rows.length}</span></div><div className="l">{L('checked in', 'செக் இன்')}</div></div>
        <div className="kpi"><div className="v" style={{ color: rows.some(r => r.c && late(r.c)) ? 'var(--warn)' : undefined }}>{rows.filter(r => r.c && late(r.c)).length}</div><div className="l">{L('late', 'தாமதம்')}</div></div>
      </div>
      <div className="list">
        {rows.map(({ s, c }) => (
          <div key={s.id} className="item">
            <div className={`avatar ${c ? (late(c) ? 'gold' : 'ok') : onLeave(s.id) ? '' : 'bad'}`}>{c ? <Check /> : onLeave(s.id) ? <Clock /> : <UserX />}</div>
            <div className="grow"><div className="t">{s.name}</div><div className="s">{c ? `${hm(c.at)}${c.distanceM != null ? ` · ${c.distanceM < 300 ? L('at godown', 'கிடங்கில்') : `${(c.distanceM / 1000).toFixed(1)} km ${L('from godown', 'கிடங்கிலிருந்து')}`}` : ''}${late(c) ? ` · ${L('late', 'தாமதம்')}` : ''}` : onLeave(s.id) ? L('on leave', 'விடுமுறை') : absentNow ? L('absent (no check-in by 11:00)', 'வரவில்லை (11:00 வரை செக் இன் இல்லை)') : L('not checked in yet', 'இன்னும் செக் இன் இல்லை')}</div></div>
            {!c && !onLeave(s.id) && <button className="btn small" onClick={() => mark(s)}>{L('Mark present', 'வருகை')}</button>}
          </div>
        ))}
      </div>
      {(leaves.filter(l => l.status === 'waiting').length > 0 || advances.length > 0) && <div className="sechead"><h3>{L('Requests', 'கோரிக்கைகள்')}</h3></div>}
      {leaves.filter(l => l.status === 'waiting').map(l => <div key={l.id} className="item"><div className="grow"><div className="t">{l.name} · {L('leave', 'விடுமுறை')}</div><div className="s">{l.from}{l.to !== l.from ? ` → ${l.to}` : ''} · {l.reason}</div></div><button className="btn small primary" onClick={() => decide('leaves', l, true)}><Check /></button><button className="btn small" onClick={() => decide('leaves', l, false)}><X /></button></div>)}
      {advances.map(a => <div key={a.id} className="item"><div className="grow"><div className="t">{a.name} · {L('advance', 'அட்வான்ஸ்')} {inr(a.amount)}</div><div className="s">{a.reason}</div></div><button className="btn small primary" onClick={() => decide('advances', a, true)}><Check /></button><button className="btn small" onClick={() => decide('advances', a, false)}><X /></button></div>)}
      <div className="muted">{L('Staff type "leave Monday" or "advance 1000" to RoX; you approve here.', 'ஊழியர்கள் RoX-ல் "leave Monday" / "advance 1000" என்று சொல்வார்கள்; இங்கே ஒப்புதல்.')}</div>
    </div>
  );
}

// ---------- Salary sheet: fixed + batta × present − unpaid leave − advance instalment − cash shortfall. "Paid" posts the expense. ----------
export function Salary() {
  const [rows, setRows] = useState<{ s: Staff; present: number; unpaidLeave: number; batta: number; fixed: number; advance: number; shortfall: number; net: number; paid: boolean }[]>([]);
  const [tick, setTick] = useState(0);
  const month = today().slice(0, 7);
  useEffect(() => { (async () => {
    const staff = (await db.staff.toArray()).filter(s => s.active && s.role !== 'owner');
    const cis = (await db.checkIns.toArray()).filter(c => c.date.startsWith(month));
    const adv = (await db.advances.toArray()).filter(a => a.status === 'approved' && (a.recovered ?? 0) < a.amount);
    const leaves = (await db.leaves.toArray()).filter(l => l.status === 'approved' && l.from.startsWith(month));
    const paidExp = (await db.expenses.toArray()).filter(e => e.category === 'salary' && e.date.startsWith(month));
    const dim = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    setRows(staff.map(s => {
      const present = cis.filter(c => c.staffId === s.id).length;
      const leaveDays = leaves.filter(l => l.staffId === s.id).reduce((a, l) => a + Math.max(1, Math.round((new Date(l.to).getTime() - new Date(l.from).getTime()) / 86400000) + 1), 0);
      const unpaidLeave = Math.max(0, leaveDays - 2); // 2 paid leave days a month
      const fixed = s.salary ?? 0; const batta = present * (s.batta ?? 0);
      const mine = adv.filter(a => a.staffId === s.id);
      const advance = mine.filter(a => a.kind !== 'shortfall').reduce((x, a) => x + Math.min(a.amount - (a.recovered ?? 0), Math.ceil(a.amount / (a.instalments || 1))), 0);
      const shortfall = mine.filter(a => a.kind === 'shortfall').reduce((x, a) => x + a.amount - (a.recovered ?? 0), 0);
      const net = Math.round(fixed - fixed * unpaidLeave / dim + batta - advance - shortfall);
      return { s, present, unpaidLeave, batta, fixed, advance, shortfall, net, paid: paidExp.some(e => e.note === `Salary ${month} ${s.name}`) };
    }));
  })(); }, [tick]);
  const pay = async (r: typeof rows[0]) => {
    if (!await confirmBox(L(`Pay ${r.s.name} ${inr(r.net)}?`, `${r.s.name}க்கு ${inr(r.net)} கொடுக்கவா?`), L('Posts the salary as an expense and marks advances/shortfalls as recovered.', 'சம்பளம் செலவாக பதிவாகும்.'), L('Paid', 'கொடுத்தேன்'))) return;
    const cs = new ChangeSet();
    cs.put('expenses', { date: today(), category: 'salary', amount: r.net, note: `Salary ${month} ${r.s.name}`, approved: true }, 'salary paid');
    for (const a of (await db.advances.toArray()).filter(a => a.staffId === r.s.id && a.status === 'approved' && (a.recovered ?? 0) < a.amount)) {
      const take = a.kind === 'shortfall' ? a.amount - (a.recovered ?? 0) : Math.min(a.amount - (a.recovered ?? 0), Math.ceil(a.amount / (a.instalments || 1)));
      cs.put('advances', { ...a, recovered: (a.recovered ?? 0) + take }, 'recovered from salary');
    }
    await cs.commit('Salary paid'); setTick(x => x + 1);
  };
  return (
    <div className="stack">
      <div className="sechead"><h3><IndianRupee size={18} style={{ verticalAlign: -3 }} /> {L('Salary sheet', 'சம்பள பட்டியல்')} · {month}</h3><button className="link" onClick={() => downloadSheet(`salary-${month}`, ['Name', 'Role', 'Present days', 'Unpaid leave', 'Fixed', 'Batta', 'Advance', 'Shortfall', 'Net'], rows.map(r => [r.s.name, r.s.role, r.present, r.unpaidLeave, r.fixed, r.batta, r.advance, r.shortfall, r.net]))}><Download size={14} /> Excel</button></div>
      <table className="tbl"><thead><tr><th>{L('Name', 'பெயர்')}</th><th>{L('Days', 'நாள்')}</th><th>{L('Fixed', 'நிலை')}</th><th>{L('Batta', 'பட்டா')}</th><th>{L('Adv', 'அட்வா')}</th><th>{L('Short', 'குறை')}</th><th>{L('Net', 'நிகர')}</th><th></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.s.id}><td>{r.s.name.split(' ')[0]}</td><td className="num">{r.present}{r.unpaidLeave ? <span className="muted"> −{r.unpaidLeave}</span> : null}</td><td className="num">{r.fixed || <span className="muted">{L('set', 'அமை')}</span>}</td><td className="num">{r.batta}</td><td className="num" style={{ color: r.advance ? 'var(--bad)' : undefined }}>{r.advance || '—'}</td><td className="num" style={{ color: r.shortfall ? 'var(--bad)' : undefined }}>{r.shortfall || '—'}</td><td className="num"><b>{inr(r.net)}</b></td><td>{r.paid ? <span className="badge ok">{L('paid', 'கொடுத்தது')}</span> : <button className="btn small primary" disabled={!r.fixed} onClick={() => pay(r)}>{L('Paid', 'கொடுத்தேன்')}</button>}</td></tr>)}</tbody></table>
      <div className="muted">{L('Set each person\'s salary and batta in Staff. 2 paid leave days a month; beyond that is deducted. Advances come back in the instalments set; cash shortfalls in full.', 'சம்பளம், பட்டா Staff-ல் அமைக்கவும்.')}</div>
    </div>
  );
}
