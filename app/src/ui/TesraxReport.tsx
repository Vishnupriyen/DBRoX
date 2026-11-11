import { useEffect, useState } from 'react';
import { db, today } from '../core/db';
import { plural, showDate } from '../core/i18n';
import { downloadText } from '../core/readers';
import { tesraxReport, type Report } from '../core/tesraxReport';

const PERIODS = [{ label: 'Today', days: 1 }, { label: '7 days', days: 7 }, { label: '30 days', days: 30 }, { label: 'All', days: 0 }];
const since = (days: number) => { if (!days) return ''; const d = new Date(); d.setDate(d.getDate() - (days - 1)); return d.toLocaleDateString('en-CA'); };
const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const pct = (a: number, b: number) => (b ? `${Math.round((a * 100) / b)}%` : '—');

// The TESRAX report: how many messages, how many understood, how fast, and how many tables were approved as prepared.
export function TesraxReport() {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<Report | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => { void tesraxReport(since(days)).then(setR); }, [days]);
  useEffect(() => { void db.staff.toArray().then(s => setNames(new Map(s.map(x => [x.id, x.name])))); }, []);
  if (!r) return null;
  const who = (id: string) => names.get(id) ?? (id === 'owner' ? 'Owner' : id);

  const download = () => {
    const lines = [
      `TESRAX report,${since(days) || 'all days'} to ${today()}`,
      `Messages,${r.messages}`, `Understood,${r.understood}%`, `Average reply,${r.avgMs} ms`, `Slowest reply,${r.maxMs} ms`,
      `Tables prepared,${r.done}`, `Approved as prepared,${r.approved}`, `Approved after a change,${r.edited}`, `Cancelled,${r.cancelled}`,
      `Asked a question back,${r.asked}`, `Not understood,${r.missed}`, `Not allowed for the role,${r.refused}`,
      '', 'Day,Messages,Understood %', ...r.days.map(d => `${d.day},${d.messages},${d.understood}`),
      '', 'Staff,Role,Messages,Understood %,Average ms', ...r.staff.map(s => `"${who(s.staffId)}",${s.role},${s.messages},${s.understood},${s.avgMs}`),
    ];
    downloadText(`TESRAX-report-${today()}.csv`, lines.join('\n'));
  };

  return (
    <div className="list">
      <div className="chips">{PERIODS.map(p => <button key={p.label} className={`chip ${days === p.days ? 'on' : ''}`} onClick={() => setDays(p.days)}>{p.label}</button>)}</div>
      {!r.messages ? <div className="card muted">No messages to TESRAX yet in this period. Every message from every staff phone is counted here.</div> : <>
        <div className="kpis">
          <div className="kpi navy"><div className="v">{r.understood}%</div><div className="l">understood · {plural(r.messages, 'message')}</div></div>
          <div className="kpi"><div className="v">{secs(r.avgMs)}</div><div className="l">average reply · slowest {secs(r.maxMs)}</div></div>
          <div className="kpi"><div className="v">{pct(r.approved, r.tables)}</div><div className="l">tables approved as prepared · {r.approved} of {r.tables}</div></div>
          <div className="kpi"><div className="v">{r.edited}</div><div className="l">approved after a change · {r.cancelled} cancelled</div></div>
        </div>
        <div className="card">
          <h3>What TESRAX did</h3>
          <div className="muted">Prepared a table to approve: {r.done}</div>
          <div className="muted">Answered or opened a screen: {r.messages - r.done - r.asked - r.missed - r.refused}</div>
          <div className="muted">Asked a question back: {r.asked}</div>
          <div className="muted">Not allowed for that person's role: {r.refused}</div>
          <div className="muted">Did not understand: {r.missed}</div>
        </div>
        <div className="card">
          <h3>By staff</h3>
          {r.staff.map(s => <div key={s.staffId} className="muted">{who(s.staffId)} ({s.role}) — {plural(s.messages, 'message')}, {s.understood}% understood, {secs(s.avgMs)}</div>)}
        </div>
        <div className="card">
          <h3>By day</h3>
          {r.days.slice(0, 14).map(d => <div key={d.day} className="muted">{showDate(d.day)} — {plural(d.messages, 'message')}, {d.understood}% understood</div>)}
        </div>
        {r.misses.length > 0 && <div className="card">
          <h3>Not understood</h3>
          {r.misses.map((m, i) => <div key={i} className="muted">{showDate(m.day)} · {who(m.staffId)}: “{m.said}”</div>)}
        </div>}
        <button className="btn" onClick={download}>Download report</button>
      </>}
    </div>
  );
}
