// Privacy & security screens (security standard, 13 Nov 2026): the privacy notice and consent (first login, sign-up),
// the person's choices and requests, PIN change (the owner: 6 digits), the app lock, and the owner's activity list.
// Locked design: white, Montserrat, jade headings, gradient primary buttons, plain English, fewest taps.
import { useEffect, useState } from 'react';
import { Delete, ArrowRight } from 'lucide-react';
import { Brand } from './Brand';
import { notify, askText, confirmBox } from './dialog';
import { api, changePin, ENV_SERVER, server, weakPin, WEAK_PIN_MSG } from '../core/sync';
import { checkPinOffline, clearToken } from '../core/secure';
import { DEFAULT_GRIEVANCE, giveConsent, isFieldRole, NOTICE, NOTICE_STATUS, NOTICE_TITLE, OPTIONAL, type PrivacyStatus } from '../core/privacy';
import { db, session, today } from '../core/db';
import { showDate } from '../core/i18n';
import { purgePersonal } from '../core/myfiles';
import type { Staff } from '../core/types';

/** the notice itself: short sections, readable on a small phone */
export function Notice() {
  return (
    <div className="stack">
      <div className="muted">{NOTICE_STATUS}</div>
      {NOTICE.map(n => <div key={n.h}><h3>{n.h}</h3><div>{n.p}</div></div>)}
    </div>
  );
}

/** first login of a staff member (added by the owner, never signed up themselves): the notice and their own tick */
export function ConsentScreen({ me, onDone }: { me: Staff; onDone: () => void }) {
  const [tick, setTick] = useState(false);
  const [loc, setLoc] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return; setBusy(true);
    try {
      await giveConsent('privacy', true);
      if (isFieldRole(me.role)) await giveConsent('location', loc);
      onDone();
    } catch (e) { await notify('Not saved', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <div className="mark" style={{ marginBottom: 12 }}><Brand /></div>
      <h2>{NOTICE_TITLE}</h2>
      <div className="card"><Notice /></div>
      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={tick} onChange={e => setTick(e.target.checked)} /><span>I have read this and agree</span></label>
      {isFieldRole(me.role) && <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={loc} onChange={e => setLoc(e.target.checked)} /><span>Use my location while my day is open (optional)</span></label>}
      <button className="btn primary big block" style={{ marginTop: 12 }} disabled={!tick || busy} onClick={go}>Continue</button>
    </div>
  );
}

/** a PIN pad (4 or 6 digits) used by the PIN change and the app lock */
function Pad({ length, onFull, label }: { length: number; onFull: (pin: string) => void; label: string }) {
  const [pin, setPin] = useState('');
  const press = (d: string) => { const n = (pin + d).slice(0, length); setPin(n); if (n.length === length) { setPin(''); onFull(n); } };
  return (
    <>
      <div className="eyebrow" style={{ marginTop: 8 }}>{label}</div>
      <div className="pins" aria-label={label}>{Array.from({ length }, (_, i) => <span key={i} className={pin.length > i ? 'on' : ''} />)}</div>
      <div className="pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button onClick={() => setPin(p => p.slice(0, -1))} aria-label="Delete"><Delete size={24} /></button>
        <button onClick={() => press('0')}>0</button>
        <button className="go" onClick={() => pin.length === length && onFull(pin)} aria-label="Next"><ArrowRight size={26} /></button>
      </div>
    </>
  );
}

/** change my PIN: the current one, then the new one twice. The owner and head office choose 6 digits. */
export function PinChange({ me, length, forced, onDone }: { me: Staff; length: number; forced?: boolean; onDone: () => void }) {
  const [step, setStep] = useState<'old' | 'new' | 'again'>('old');
  const [old, setOld] = useState(''); const [first, setFirst] = useState('');
  const [err, setErr] = useState('');
  const full = async (p: string) => {
    setErr('');
    if (step === 'old') { setOld(p); setStep('new'); return; }
    if (step === 'new') { if (weakPin(p)) { setErr(WEAK_PIN_MSG); return; } setFirst(p); setStep('again'); return; }
    if (p !== first) { setErr('The two PINs are not the same. Choose the new PIN again.'); setStep('new'); return; }
    try { await changePin(me.tenantId, me.id, me.phone, old, p); await notify('PIN changed', 'Your other phones will ask you to log in again.'); onDone(); }
    catch (e) { setErr((e as Error).message); setStep('old'); }
  };
  return (
    <div className="login">
      <div className="mark" style={{ marginBottom: 12 }}><Brand /></div>
      <h2>{forced ? `Choose a ${length}-digit PIN` : 'Change my PIN'}</h2>
      {forced && <div className="muted">The owner's PIN is now 6 digits: it protects your firm's money and records.</div>}
      {step === 'old' && <Pad key="old" length={forced ? 4 : length} onFull={full} label="Your PIN now" />}
      {step === 'new' && <Pad key="new" length={length} onFull={full} label={`New ${length}-digit PIN`} />}
      {step === 'again' && <Pad key="again" length={length} onFull={full} label="New PIN again" />}
      {err && <div style={{ color: 'var(--bad)', marginTop: 10, fontWeight: 600 }}>{err}</div>}
      {!forced && <button className="btn ghost block" style={{ marginTop: 12 }} onClick={onDone}>Cancel</button>}
    </div>
  );
}

/** the app lock after some minutes in the background: the person's own PIN, checked on this phone (5 wrong → 15 min) */
export function LockScreen({ me, length, onOpen, onLogout }: { me: Staff; length: number; onOpen: () => void; onLogout: () => void }) {
  const [err, setErr] = useState('');
  const full = async (p: string) => {
    const r = await checkPinOffline('', p, me.tenantId, me.id);
    if (r.ok) { onOpen(); return; }
    setErr(r.why === 'locked' ? `Too many wrong PINs. Try again after ${new Date(r.until!).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.` : r.why === 'unknown' ? 'Log in again.' : 'Wrong PIN');
    if (r.why === 'unknown') onLogout();
  };
  return (
    <div className="login">
      <div className="mark" style={{ marginBottom: 12 }}><Brand /></div>
      <h2>{`Hello ${me.name.split(' ')[0]}`}</h2>
      <Pad length={length} onFull={full} label="Your PIN" />
      {err && <div style={{ color: 'var(--bad)', marginTop: 10, fontWeight: 600 }}>{err}</div>}
      <button className="btn ghost block" style={{ marginTop: 12 }} onClick={onLogout}>Log out</button>
    </div>
  );
}

const KIND: Record<string, string> = { access: 'See my data', correct: 'Correct my data', delete: 'Erase my data', delete_account: 'Close the firm\'s account', nominate: 'Nominee', grievance: 'Complaint' };
const EVENT: Record<string, string> = {
  signup: 'Signed up', 'login.ok': 'Logged in', 'login.fail': 'Wrong PIN', 'pin.change': 'PIN changed', 'logout.all': 'Logged out on all phones',
  'staff.add': 'Staff added', 'staff.change': 'Staff changed', 'staff.remove': 'Access removed', 'staff.lock': 'Phone locked', 'staff.refused': 'Staff change refused',
  'support.grant': 'Support allowed (24 h)', 'support.read': 'Support looked', consent: 'Privacy choice', 'privacy.export': 'Data downloaded',
  'privacy.request': 'Privacy request', 'privacy.erase': 'Data erased', 'link.accept': 'Company linked', 'link.leave': 'Company link left', 'admin.ok': 'Hanubix changed the plan',
};

/** Menu → Privacy & security: my choices, my data, my PIN; the owner also sees the firm's activity */
export function PrivacyPage({ me, onLogout }: { me: Staff; onLogout: () => void }) {
  const [st, setSt] = useState<PrivacyStatus | null>(null);
  const [live, setLive] = useState(false);
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [pin, setPin] = useState(false);
  const [act, setAct] = useState<{ at: string; event: string; who: string; about: string; ok: boolean }[] | null>(null);
  const owner = me.role === 'owner' || me.role === 'cadmin';
  const load = async () => {
    const has = !!(await server()); setLive(has);
    const vals: Record<string, boolean> = {};
    for (const o of OPTIONAL) vals[o.kind] = (await db.meta.get(`consent:${session().userId}:${o.kind}`))?.value === true;
    setLocal(vals);
    if (has) { try { setSt(await api<PrivacyStatus>('/v1/privacy/status')); } catch { /* offline: the phone's own copy shows */ } }
  };
  useEffect(() => { void load(); }, []);
  const choose = async (kind: string, v: boolean) => {
    try { const s = await giveConsent(kind, v); if (s) setSt(s); setLocal(l => ({ ...l, [kind]: v })); }
    catch (e) { await notify('Not saved', (e as Error).message); }
  };
  const ask = async (kind: string) => {
    const note = kind === 'grievance' || kind === 'correct' ? await askText(kind === 'grievance' ? 'What is the complaint?' : 'What should be corrected?') : '';
    if (note === null) return;
    if (kind === 'delete' && !await confirmBox('Erase my data?', 'Your name, phone and location records are erased. Bills and payments stay for 8 years as GST law requires, without your contact details.', 'Ask to erase')) return;
    if (kind === 'delete_account' && !await confirmBox('Close the firm\'s account?', 'You get 30 days to download everything. Then the firm\'s data is erased, except the tax records the law asks us to keep. Backups are gone within 35 days.', 'Ask to close')) return;
    // erasing my data starts on this phone: my TESRAX chats and My files go at once (security, 14 Nov 2026)
    if (kind === 'delete') await purgePersonal(me.id).catch(() => {});
    try { const r = await api<{ id: string; due: string }>('/v1/privacy/request', { kind, note }); await notify('Request sent', `We answer by ${showDate(r.due)}.`); void load(); }
    catch (e) { await notify('Not sent', (e as Error).message); }
  };
  const download = async () => {
    try {
      const j = await api('/v1/privacy/export');
      const { downloadText } = await import('../core/readers');
      downloadText(`Hanubix-my-data-${today()}.json`, JSON.stringify(j, null, 2));
    } catch (e) { await notify('Not downloaded', (e as Error).message); }
  };
  const clearMine = async () => {
    if (!await confirmBox('Delete my chats and files?', 'Your TESRAX chats and My files are deleted from this phone. Bills, payments and reports stay.', 'Delete')) return;
    await purgePersonal(me.id); await notify('Deleted', 'Your chats and files are gone from this phone.');
  };
  const nominee = async () => {
    const name = await askText('Nominee: the person who can act for you', st?.nominee?.name ?? ''); if (!name) return;
    const contact = await askText('Their phone or email', st?.nominee?.contact ?? ''); if (!contact) return;
    try { setSt(await api<PrivacyStatus>('/v1/privacy/nominee', { name, contact })); } catch (e) { await notify('Not saved', (e as Error).message); }
  };
  const everywhere = async () => {
    if (!await confirmBox('Log out on all phones?', 'Every phone with your login, this one too, must log in again.', 'Log out all')) return;
    try { await api('/v1/logout-all'); await clearToken(); onLogout(); } catch (e) { await notify('Not done', (e as Error).message); }
  };
  if (pin) return <PinChange me={me} length={owner ? 6 : 4} onDone={() => setPin(false)} />;
  const g = st?.grievance ?? DEFAULT_GRIEVANCE;
  const options = OPTIONAL.filter(o => (!o.owner || owner) && (!o.field || ['salesman', 'delivery', 'rep'].includes(me.role)));
  return (
    <div className="stack">
      <div className="card">
        <h3>My choices</h3>
        {options.map(o => {
          const on = o.kind === 'ai_scan' && st ? st.firm.ai_scan : st?.consents[o.kind]?.granted ?? local[o.kind] ?? false;
          return <div key={o.kind} className="toggle"><div className="grow"><div className="t">{o.label}</div><div className="muted">{o.why}</div></div>
            <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={o.label} onClick={() => choose(o.kind, !on)} /></div>;
        })}
      </div>
      <div className="card">
        <h3>My data</h3>
        <div className="list">
          <button className="item" onClick={download}><span className="grow">Download my data</span></button>
          <button className="item" onClick={() => ask('correct')}><span className="grow">Ask to correct my data</span></button>
          <button className="item" onClick={() => ask('delete')}><span className="grow">Ask to erase my data</span></button>
          <button className="item" onClick={clearMine}><span className="grow">Delete my chats and files from this phone</span></button>
          <button className="item" onClick={nominee}><span className="grow">{st?.nominee ? `Nominee: ${st.nominee.name}` : 'Name a nominee'}</span></button>
          <button className="item" onClick={() => ask('grievance')}><span className="grow">Make a complaint</span></button>
          {me.role === 'owner' && <button className="item" style={{ color: 'var(--bad)' }} onClick={() => ask('delete_account')}><span className="grow">Close the firm's account</span></button>}
        </div>
        {!!st?.requests.length && <div className="muted" style={{ marginTop: 8 }}>{st.requests.map(r => `${KIND[r.kind] ?? r.kind}: ${r.status === 'open' ? `answer by ${showDate(r.due)}` : r.status}`).join(' · ')}</div>}
        {!live && <div className="muted" style={{ marginTop: 8 }}>{ENV_SERVER ? 'No internet: try again with signal.' : 'Demo: nothing on this phone is sent anywhere.'}</div>}
      </div>
      <div className="card">
        <h3>My PIN and phones</h3>
        <div className="list">
          <button className="item" onClick={() => setPin(true)}><span className="grow">Change my PIN</span></button>
          <button className="item" onClick={everywhere}><span className="grow">Log out on all phones</span></button>
        </div>
      </div>
      {owner && <div className="card">
        <h3>Activity</h3>
        {act === null ? <button className="btn small" onClick={async () => { try { setAct((await api<{ rows: NonNullable<typeof act> }>('/v1/security/activity')).rows); } catch (e) { await notify('Not loaded', (e as Error).message); } }}>Who logged in, who changed staff</button>
          : <div className="list">{act.length ? act.slice(0, 60).map((r, i) => <div key={i} className="item"><div className="grow"><div className="t">{EVENT[r.event] ?? r.event}{r.about ? ` — ${r.about}` : ''}</div><div className="s">{r.who || '—'} · {new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div></div>{!r.ok && <span className="badge bad">refused</span>}</div>) : <div className="muted">Nothing yet</div>}</div>}
      </div>}
      <details className="card"><summary><b>{NOTICE_TITLE}</b></summary><Notice /></details>
      <div className="card">
        <h3>Questions or complaints</h3>
        <div>{`Grievance officer: ${g.officer}`}</div>
        <div className="muted">{g.email || g.phone ? [g.email, g.phone].filter(Boolean).join(' · ') : 'Contact details: to be set by Hanubix'}</div>
      </div>
    </div>
  );
}
