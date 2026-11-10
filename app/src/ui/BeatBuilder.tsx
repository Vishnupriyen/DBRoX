import { plural } from '../core/i18n';
import { useEffect, useState } from 'react';
import { Check, Copy, Store } from 'lucide-react';
import { ChangeSet, activeShops } from '../core/db';
import { norm } from '../core/match';
import { ask } from './dialog';
import type { Shop, Staff } from '../core/types';
import { db } from '../core/db';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Owner: make a beat by ticking shops for a day and a salesman; copy a day to another. A shop can also just be sold to without any beat.
export function BeatBuilder() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [day, setDay] = useState(DAYS[Math.max(0, new Date().getDay() - 1)]);
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => { setShops((await activeShops()).sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name))); const st = (await db.staff.toArray()).filter(s => s.active && s.role === 'salesman'); setStaff(st); if (!who && st[0]) setWho(st[0].id); })(); }, [tick]);
  const inBeat = (s: Shop) => s.beat === day && (!who || s.salesmanId === who);
  const toggle = async (s: Shop) => {
    const cs = new ChangeSet();
    if (inBeat(s)) cs.put('shops', { ...s, beat: '' }, 'removed from beat');
    else cs.put('shops', { ...s, beat: day, salesmanId: who || s.salesmanId }, `beat ${day}`);
    await cs.commit('Beat'); setTick(x => x + 1);
  };
  const copyDay = async () => {
    const to = await ask('Copy this beat to which day?', { choices: DAYS.filter(d => d !== day).map(d => ({ label: d, value: d })) });
    if (!to) return;
    // shops in today's beat get a second beat day via an alias "beat:<day>"; the beat screen honours both
    const cs = new ChangeSet();
    for (const s of shops.filter(inBeat)) cs.put('shops', { ...s, aliases: [...new Set([...s.aliases, `beat:${to}`])] }, `also ${to}`);
    await cs.commit('Beat copied'); setTick(x => x + 1);
  };
  const shown = shops.filter(s => !q || norm(s.name).includes(norm(q)) || norm(s.area).includes(norm(q)));
  const areas = [...new Set(shown.map(s => s.area))];
  const count = shops.filter(inBeat).length;
  return (
    <div className="stack">
      <div className="row" style={{ gap: 6, overflowX: 'auto', flexWrap: 'nowrap' }}>{DAYS.map(d => <button key={d} className={`chip ${day === d ? 'on' : ''}`} onClick={() => setDay(d)}>{d.slice(0, 3)}</button>)}</div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <select value={who} onChange={e => setWho(e.target.value)}>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="">{'any salesman'}</option></select>
        <span className="badge navy">{plural(count, 'shop')}</span>
        <button className="btn small" onClick={copyDay}><Copy size={14} /> {'Copy to another day'}</button>
      </div>
      <div className="field"><input placeholder={'Search shop or area…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Search" /></div>
      {areas.map(a => (
        <div key={a}>
          <div className="eyebrow" style={{ margin: '6px 0' }}>{a} <button className="link" onClick={async () => { const cs = new ChangeSet(); for (const s of shown.filter(x => x.area === a && !inBeat(x))) cs.put('shops', { ...s, beat: day, salesmanId: who || s.salesmanId }, `beat ${day}`); await cs.commit('Beat'); setTick(x => x + 1); }}>{'all'}</button></div>
          <div className="list">
            {shown.filter(s => s.area === a).map(s => (
              <button key={s.id} className="item tap" onClick={() => toggle(s)}>
                <div className={`avatar ${inBeat(s) ? 'ok' : ''}`}>{inBeat(s) ? <Check /> : <Store size={20} />}</div>
                <div className="grow"><div className="t">{s.name}</div><div className="s">{s.beat && s.beat !== day ? `${'also'} ${s.beat}` : ''}{s.salesmanId && s.salesmanId !== who ? ` · ${staff.find(x => x.id === s.salesmanId)?.name.split(' ')[0] ?? ''}` : ''}</div></div>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="muted">{'No beat needed to sell: a salesman can always search any shop and enter an order.'}</div>
    </div>
  );
}
