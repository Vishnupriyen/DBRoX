import { useEffect, useState } from 'react';
import { db, setSession } from './core/db';
import { seedDemo } from './core/seed';
import { ENV_SERVER, login, signup, startAutoSync, syncNow } from './core/sync';
import { getLang, setLang, t } from './core/i18n';
import { Chat } from './ui/Chat';
import { Today } from './ui/Today';
import { Delivery } from './ui/Delivery';
import { Collect } from './ui/Collect';
import { More } from './ui/More';
import type { Role, Staff } from './core/types';

type Tab = 'chat' | 'today' | 'delivery' | 'collect' | 'more';
const TABS: Record<Role, Tab[]> = {
  owner: ['chat', 'today', 'delivery', 'collect', 'more'],
  office: ['chat', 'today', 'delivery', 'collect', 'more'],
  salesman: ['chat', 'today', 'collect', 'more'],
  godown: ['chat', 'today', 'more'],
  delivery: ['delivery', 'collect', 'chat', 'more'],
};
const ICON: Record<Tab, string> = { chat: '💬', today: '📊', delivery: '🚚', collect: '₹', more: '☰' };

export default function App() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Staff | null>(null);
  const [firm, setFirm] = useState('');
  const [tab, setTab] = useState<Tab>('chat');
  const [online, setOnline] = useState(navigator.onLine);
  const [, setLangTick] = useState(0);

  useEffect(() => {
    (async () => {
      if (!ENV_SERVER) await seedDemo(); // demo mode only; real distributors load their data from the server
      setFirm((await db.settings.toCollection().first())?.firmName ?? '');
      const saved = localStorage.getItem('dbrox.session');
      if (saved) {
        const { tenantId, userId } = JSON.parse(saved);
        const s = await db.staff.get(userId);
        if (s?.active) { setSession(tenantId, userId); setMe(s); setTab(TABS[s.role][0]); }
      }
      setReady(true);
      startAutoSync();
    })();
    const kicked = () => { localStorage.removeItem('dbrox.token'); setMe(null); };
    window.addEventListener('dbrox:logout', kicked);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  if (!ready) return <div className="login muted">DBRoX…</div>;
  if (!me) return <Login onIn={async (tenantId, userId) => {
    setSession(tenantId, userId);
    if (ENV_SERVER) await syncNow(); // first login on this phone: bring down this distributor's data
    const s = await db.staff.get(userId);
    if (!s) { alert('Could not load your data. Check the internet and try again.'); return; }
    setFirm((await db.settings.toCollection().first())?.firmName ?? '');
    setSession(tenantId, userId);
    localStorage.setItem('dbrox.session', JSON.stringify({ tenantId, userId }));
    setMe(s); setTab(TABS[s.role][0]);
  }} />;

  const logout = () => { localStorage.removeItem('dbrox.session'); localStorage.removeItem('dbrox.token'); setMe(null); };
  const label: Record<Tab, string> = { chat: t('chat'), today: t('today'), delivery: t('delivery'), collect: t('collect'), more: t('more') };
  return (
    <div className="app">
      <header className="top">
        <div className="logo">DB<span>RoX</span></div>
        <div className="firm">{firm} · {me.name}</div>
        <span className={`dot ${online ? '' : 'off'}`} title={online ? 'Online' : t('offline')} />
        <button className="pill" onClick={() => { setLang(getLang() === 'en' ? 'ta' : 'en'); setLangTick(x => x + 1); }}>{getLang() === 'en' ? 'தமிழ்' : 'EN'}</button>
      </header>
      {!online && <div className="note" style={{ margin: 0, borderRadius: 0 }}>{t('offline')}</div>}
      <main className="main" style={tab === 'chat' ? { padding: 0, display: 'flex', flexDirection: 'column' } : undefined}>
        {tab === 'chat' && <Chat role={me.role} />}
        {tab === 'today' && <Today role={me.role} />}
        {tab === 'delivery' && <Delivery />}
        {tab === 'collect' && <Collect />}
        {tab === 'more' && <More role={me.role} onLogout={logout} onLang={() => setLangTick(x => x + 1)} />}
      </main>
      <nav className="tabs">
        {TABS[me.role].map(k => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <span className="ic">{ICON[k]}</span>{label[k]}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Login({ onIn }: { onIn: (tenantId: string, userId: string) => void }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [demo, setDemo] = useState<Staff[]>([]);
  const [newFirm, setNewFirm] = useState<{ firmName: string; ownerName: string; gstin: string } | null>(null);
  useEffect(() => { if (!ENV_SERVER) db.staff.toArray().then(setDemo); }, []);
  if (newFirm) return (
    <div className="login">
      <h1>DB<span style={{ color: 'var(--ink)' }}>RoX</span></h1>
      <div className="muted" style={{ marginBottom: 16 }}>Start your 60-day free trial</div>
      <label className="muted">Firm name</label><input value={newFirm.firmName} onChange={e => setNewFirm({ ...newFirm, firmName: e.target.value })} />
      <label className="muted">Your name</label><input value={newFirm.ownerName} onChange={e => setNewFirm({ ...newFirm, ownerName: e.target.value })} />
      <label className="muted">GSTIN</label><input value={newFirm.gstin} onChange={e => setNewFirm({ ...newFirm, gstin: e.target.value.toUpperCase() })} />
      <label className="muted">{t('phone')}</label><input inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
      <label className="muted">Choose a {t('pin')}</label><input inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      {err && <div style={{ color: 'var(--red)', marginBottom: 8 }}>{err}</div>}
      <button className="btn primary big" onClick={async () => {
        try { setErr(''); const r = await signup({ ...newFirm, phone, pin }); onIn(r.tenantId, r.userId); } catch (e) { setErr((e as Error).message); }
      }}>Start free trial</button>
      <button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={() => setNewFirm(null)}>← Log in instead</button>
    </div>
  );
  const go = async (p = phone, n = pin) => {
    setErr('');
    const r = await login(p, n);
    if (!r) { setErr(t('wrongPin')); setPin(''); return; }
    onIn(r.tenantId, r.userId);
  };
  const press = (d: string) => { const n = (pin + d).slice(0, 4); setPin(n); if (n.length === 4 && phone.length === 10) void go(phone, n); };
  return (
    <div className="login">
      <h1>DB<span style={{ color: 'var(--ink)' }}>RoX</span></h1>
      <div className="muted" style={{ marginBottom: 20 }}>{t('appTagline')}</div>
      <label className="muted">{t('phone')}</label>
      <input inputMode="numeric" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
      <label className="muted">{t('pin')}</label>
      <input value={'●'.repeat(pin.length)} readOnly aria-label={t('pin')} />
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button onClick={() => setPin('')}>C</button>
        <button onClick={() => press('0')}>0</button>
        <button onClick={() => go()}>→</button>
      </div>
      {err && <div className="em" style={{ color: 'var(--red)' }}>{err}</div>}
      {ENV_SERVER && <button className="btn" style={{ width: '100%', marginTop: 12 }} onClick={() => setNewFirm({ firmName: '', ownerName: '', gstin: '' })}>New distributor? Start free trial</button>}
      {demo.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="muted" style={{ marginBottom: 6 }}>Demo logins (tap one):</div>
          {demo.map(s => <button key={s.id} className="btn small" style={{ margin: 3 }} onClick={() => { setPhone(s.phone); setPin(s.pin); void go(s.phone, s.pin); }}>{s.name} · PIN {s.pin}</button>)}
        </div>
      )}
    </div>
  );
}
