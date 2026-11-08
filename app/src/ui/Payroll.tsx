import { useEffect, useState } from 'react';
import { Check, X, MapPin, Clock, LogIn, UserX, IndianRupee, Download } from 'lucide-react';
import { ChangeSet, db, nowIso, today } from '../core/db';
import { inr } from '../core/i18n';
import { getPos } from './Beat';
import { downloadSheet } from '../core/readers';
import { askText, confirmBox } from './dialog';
import type { Advance, CheckIn, LeaveRequest, Settings, Staff } from '../core/types';

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
      <div className="eyebrow">{new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}</div>
      <div className="h" style={{ fontSize: 26 }}>{me.name.split(' ')[0]}</div>
      <div className="muted"><Clock size={16} style={{ verticalAlign: -3 }} /> {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {today()}{late && <span className="badge warn" style={{ marginLeft: 8 }}>{'after'} {threshold}</span>}</div>
      <button className="big-btn" disabled={busy} onClick={go}><span><LogIn /><br />{'Check in'}</span></button>
      <div className="muted"><MapPin size={14} style={{ verticalAlign: -2 }} /> {'Your location and time are recorded.'}</div>
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
    const why = await askText(`Mark ${s.name.split(' ')[0]} present — remark`); if (!why) return;
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
        <div className="kpi navy"><div className="v">{rows.filter(r => r.c).length}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{rows.length}</span></div><div className="l">{'checked in'}</div></div>
        <div className="kpi"><div className="v" style={{ color: rows.some(r => r.c && late(r.c)) ? 'var(--warn)' : undefined }}>{rows.filter(r => r.c && late(r.c)).length}</div><div className="l">{'late'}</div></div>
      </div>
      <div className="list">
        {rows.map(({ s, c }) => (
          <div key={s.id} className="item">
            <div className={`avatar ${c ? (late(c) ? 'gold' : 'ok') : onLeave(s.id) ? '' : 'bad'}`}>{c ? <Check /> : onLeave(s.id) ? <Clock /> : <UserX />}</div>
            <div className="grow"><div className="t">{s.name}</div><div className="s">{c ? `${hm(c.at)}${c.distanceM != null ? ` · ${c.distanceM < 300 ? 'at godown' : `${(c.distanceM / 1000).toFixed(1)} km ${'from godown'}`}` : ''}${late(c) ? ` · ${'late'}` : ''}` : onLeave(s.id) ? 'on leave' : absentNow ? 'absent (no check-in by 11:00)' : 'not checked in yet'}</div></div>
            {!c && !onLeave(s.id) && <button className="btn small" onClick={() => mark(s)}>{'Mark present'}</button>}
          </div>
        ))}
      </div>
      {(leaves.filter(l => l.status === 'waiting').length > 0 || advances.length > 0) && <div className="sechead"><h3>{'Requests'}</h3></div>}
      {leaves.filter(l => l.status === 'waiting').map(l => <div key={l.id} className="item"><div className="grow"><div className="t">{l.name} · {'leave'}</div><div className="s">{l.from}{l.to !== l.from ? ` → ${l.to}` : ''} · {l.reason}</div></div><button className="btn small primary" onClick={() => decide('leaves', l, true)}><Check /></button><button className="btn small" onClick={() => decide('leaves', l, false)}><X /></button></div>)}
      {advances.map(a => <div key={a.id} className="item"><div className="grow"><div className="t">{a.name} · {'advance'} {inr(a.amount)}</div><div className="s">{a.reason}</div></div><button className="btn small primary" onClick={() => decide('advances', a, true)}><Check /></button><button className="btn small" onClick={() => decide('advances', a, false)}><X /></button></div>)}
      <div className="muted">{'Staff type "leave Monday" or "advance 1000" to TESRAX; you approve here.'}</div>
    </div>
  );
}

// ---------- Salary sheet: fixed + batta × present − unpaid leave − advance instalment − cash shortfall. "Paid" posts the expense. ----------
export function Salary() {
  const [rows, setRows] = useState<{ s: Staff; present: number; unpaidLeave: number; batta: number; fixed: number; advance: number; shortfall: number; net: number; carry: number; paid: boolean; takes: { id: string; take: number }[] }[]>([]);
  const [tick, setTick] = useState(0);
  // salary is usually paid in the first days of the next month, so last month is offered too
  const cur = today().slice(0, 7);
  const prev = (() => { const [y, m] = cur.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
  const [month, setMonth] = useState(Number(today().slice(8)) <= 10 ? prev : cur);
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
      const gross = Math.max(0, Math.round(fixed - fixed * unpaidLeave / dim + batta));
      // recoveries never take more than the salary: advance instalments first, then cash shortfalls; the rest carries to next month
      let room = gross; let advance = 0, shortfall = 0, due = 0; const takes: { id: string; take: number }[] = [];
      const mine = adv.filter(a => a.staffId === s.id).sort((a, b) => (a.kind === 'shortfall' ? 1 : 0) - (b.kind === 'shortfall' ? 1 : 0));
      for (const a of mine) {
        const owe = a.kind === 'shortfall' ? a.amount - (a.recovered ?? 0) : Math.min(a.amount - (a.recovered ?? 0), Math.ceil(a.amount / (a.instalments || 1)));
        const take = Math.max(0, Math.min(owe, room)); room -= take; due += owe;
        if (a.kind === 'shortfall') shortfall += take; else advance += take;
        if (take > 0) takes.push({ id: a.id, take });
      }
      const net = gross - advance - shortfall;
      return { s, present, unpaidLeave, batta, fixed, advance, shortfall, net, carry: due - advance - shortfall, takes, paid: paidExp.some(e => e.note === `Salary ${month} ${s.name}`) };
    }));
  })(); }, [tick, month]);
  const pay = async (r: typeof rows[0]) => {
    if (!await confirmBox(`Pay ${r.s.name} ${inr(r.net)}?`, 'Posts the salary as an expense and marks advances/shortfalls as recovered.', 'Paid')) return;
    const cs = new ChangeSet();
    cs.put('expenses', { date: today(), category: 'salary', amount: r.net, note: `Salary ${month} ${r.s.name}`, approved: true }, 'salary paid');
    for (const { id, take } of r.takes) {
      const a = await db.advances.get(id); if (!a) continue;
      cs.put('advances', { ...a, recovered: (a.recovered ?? 0) + take }, 'recovered from salary');
    }
    await cs.commit('Salary paid'); setTick(x => x + 1);
  };
  return (
    <div className="stack">
      <div className="sechead"><h3><IndianRupee size={18} style={{ verticalAlign: -3 }} /> {'Salary sheet'}</h3><div className="segmented" style={{ maxWidth: 220 }}>{[prev, cur].map(m => <button key={m} className={month === m ? 'on' : ''} onClick={() => setMonth(m)}>{m}</button>)}</div><button className="link" onClick={() => downloadSheet(`salary-${month}`, ['Name', 'Role', 'Present days', 'Unpaid leave', 'Fixed', 'Batta', 'Advance', 'Shortfall', 'Net'], rows.map(r => [r.s.name, r.s.role, r.present, r.unpaidLeave, r.fixed, r.batta, r.advance, r.shortfall, r.net]))}><Download size={14} /> Excel</button></div>
      <table className="tbl"><thead><tr><th>{'Name'}</th><th>{'Days'}</th><th>{'Fixed'}</th><th>{'Batta'}</th><th>{'Adv'}</th><th>{'Short'}</th><th>{'Net'}</th><th></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.s.id}><td>{r.s.name.split(' ')[0]}</td><td className="num">{r.present}{r.unpaidLeave ? <span className="muted"> −{r.unpaidLeave}</span> : null}</td><td className="num">{r.fixed || <span className="muted">{'set'}</span>}</td><td className="num">{r.batta}</td><td className="num" style={{ color: r.advance ? 'var(--bad)' : undefined }}>{r.advance || '—'}</td><td className="num" style={{ color: r.shortfall ? 'var(--bad)' : undefined }}>{r.shortfall || '—'}</td><td className="num"><b>{inr(r.net)}</b>{r.carry > 0 ? <div className="muted" style={{ fontSize: 11 }}>{inr(r.carry)} {'next month'}</div> : null}</td><td>{r.paid ? <span className="badge ok">{'paid'}</span> : <button className="btn small primary" disabled={!r.fixed} onClick={() => pay(r)}>{'Paid'}</button>}</td></tr>)}</tbody></table>
      <div className="muted">{'Set each person\'s salary and batta in Staff. 2 paid leave days a month; beyond that is deducted. Advances come back in the instalments set, then cash shortfalls — never more than the salary; anything left carries to next month.'}</div>
    </div>
  );
}
