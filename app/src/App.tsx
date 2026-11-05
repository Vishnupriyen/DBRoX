import { useEffect, useState } from 'react';
import { MessageSquareText, Sunrise, Route, Truck, IndianRupee, Menu, PackageOpen, Delete, ArrowRight } from 'lucide-react';
import { db, setSession } from './core/db';
import { seedDemo } from './core/seed';
import { ENV_SERVER, login, signup, startAutoSync, syncNow } from './core/sync';
import { getLang, setLang, t } from './core/i18n';
import { Chat } from './ui/Chat';
import { Morning } from './ui/Morning';
import { Beat } from './ui/Beat';
import { Pick } from './ui/Pick';
import { Delivery } from './ui/Delivery';
import { Collect } from './ui/Collect';
import { More } from './ui/More';
import { DialogHost, notify } from './ui/dialog';
import type { Role, Staff } from './core/types';

type Tab = 'chat' | 'morning' | 'beat' | 'pick' | 'delivery' | 'collect' | 'more';
const TABS: Record<Role, Tab[]> = {
  owner: ['morning', 'chat', 'delivery', 'collect', 'more'],
  office: ['chat', 'morning', 'pick', 'delivery', 'more'],
  salesman: ['beat', 'chat', 'collect', 'more'],
  godown: ['pick', 'chat', 'more'],
  delivery: ['delivery', 'collect', 'chat', 'more'],
};
const ICON: Record<Tab, React.ReactNode> = {
  chat: <MessageSquareText />, morning: <Sunrise />, beat: <Route />, pick: <PackageOpen />, delivery: <Truck />, collect: <IndianRupee />, more: <Menu />,
};
const LABEL: Record<Tab, [string, string]> = {
  chat: ['Chat', 'அரட்டை'], morning: ['Morning', 'காலை'], beat: ['Beat', 'பீட்'], pick: ['Load', 'லோடு'], delivery: ['Delivery', 'டெலிவரி'], collect: ['Collect', 'வசூல்'], more: ['More', 'மேலும்'],
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Staff | null>(null);
  const [firm, setFirm] = useState('');
  const [tab, setTab] = useState<Tab>('chat');
  const [online, setOnline] = useState(navigator.onLine);
  const [langTick, setLangTick] = useState(0);
  const lang = getLang();

  useEffect(() => {
    (async () => {
      if (!ENV_SERVER) await seedDemo();
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
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('dbrox:logout', kicked); };
  }, []);

  const toggleLang = () => { setLang(getLang() === 'en' ? 'ta' : 'en'); setLangTick(x => x + 1); };

  if (!ready) return <div className="login"><div className="mark">DB<em>RoX</em></div></div>;
  if (!me) return <><DialogHost /><Login onIn={async (tenantId, userId) => {
    setSession(tenantId, userId);
    if (ENV_SERVER) await syncNow();
    const s = await db.staff.get(userId);
    if (!s) { void notify('Could not load your data', 'Check the internet and try again.'); return; }
    setFirm((await db.settings.toCollection().first())?.firmName ?? '');
    localStorage.setItem('dbrox.session', JSON.stringify({ tenantId, userId }));
    setMe(s); setTab(TABS[s.role][0]);
  }} lang={lang} onLang={toggleLang} /></>;

  const logout = () => { localStorage.removeItem('dbrox.session'); localStorage.removeItem('dbrox.token'); setMe(null); };
  return (
    <div className="app" key={langTick}>
      <header className="top">
        <div className="wordmark">DB<em>RoX</em></div>
        <div className="firm">{firm}</div>
        <div className="who">{me.name.split(' ')[0]}</div>
        <span className={`sync ${online ? '' : 'off'}`} title={online ? 'Online' : t('offline')} />
        <button className="lang" onClick={toggleLang}>{lang === 'en' ? 'தமிழ்' : 'EN'}</button>
      </header>
      {!online && <div className="offline-bar">{t('offline')}</div>}
      <main className={`main ${tab === 'chat' ? 'flush' : ''}`}>
        {tab === 'chat' && <Chat role={me.role} />}
        {tab === 'morning' && <Morning />}
        {tab === 'beat' && <Beat lang={lang} />}
        {tab === 'pick' && <Pick />}
        {tab === 'delivery' && <Delivery />}
        {tab === 'collect' && <Collect />}
        {tab === 'more' && <More role={me.role} onLogout={logout} onLang={toggleLang} />}
      </main>
      <DialogHost />
      <nav className="tabs">
        {TABS[me.role].map(k => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <span className="ic">{ICON[k]}</span>{LABEL[k][lang === 'ta' ? 1 : 0]}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Login({ onIn, lang, onLang }: { onIn: (tenantId: string, userId: string) => void; lang: 'en' | 'ta'; onLang: () => void }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [demo, setDemo] = useState<Staff[]>([]);
  const [newFirm, setNewFirm] = useState<{ firmName: string; ownerName: string; gstin: string } | null>(null);
  useEffect(() => { if (!ENV_SERVER) db.staff.toArray().then(setDemo); }, []);
  const go = async (p = phone, n = pin) => {
    setErr('');
    const r = await login(p, n);
    if (!r) { setErr(t('wrongPin')); setPin(''); return; }
    onIn(r.tenantId, r.userId);
  };
  const press = (d: string) => { const n = (pin + d).slice(0, 4); setPin(n); if (n.length === 4 && phone.length === 10) void go(phone, n); };

  if (newFirm) return (
    <div className="login">
      <div className="login-hero"><div className="mark">DB<em>RoX</em></div><div className="tag" style={{ color: 'var(--on-navy-2)', margin: '6px 0 0' }}>{lang === 'ta' ? '60 நாள் இலவச சோதனை' : 'Start your 60-day free trial'}</div></div>
      <div className="stack">
        <div className="field"><label>Firm name</label><input value={newFirm.firmName} onChange={e => setNewFirm({ ...newFirm, firmName: e.target.value })} /></div>
        <div className="field"><label>Your name</label><input value={newFirm.ownerName} onChange={e => setNewFirm({ ...newFirm, ownerName: e.target.value })} /></div>
        <div className="field"><label>GSTIN</label><input value={newFirm.gstin} onChange={e => setNewFirm({ ...newFirm, gstin: e.target.value.toUpperCase() })} /></div>
        <div className="field"><label>{t('phone')}</label><input inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} /></div>
        <div className="field"><label>Choose a {t('pin')}</label><input inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} /></div>
        {err && <div style={{ color: 'var(--bad)' }}>{err}</div>}
        <button className="btn primary big block" onClick={async () => { try { setErr(''); const r = await signup({ ...newFirm, phone, pin }); onIn(r.tenantId, r.userId); } catch (e) { setErr((e as Error).message); } }}>Start free trial</button>
        <button className="btn ghost block" onClick={() => setNewFirm(null)}>← Log in instead</button>
      </div>
    </div>
  );

  return (
    <div className="login">
      <div className="login-hero">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="mark">DB<em>RoX</em></div>
          <button className="lang" onClick={onLang}>{lang === 'en' ? 'தமிழ்' : 'EN'}</button>
        </div>
        <div className="tag" style={{ color: 'var(--on-navy-2)', margin: '8px 0 0' }}>{t('appTagline')}</div>
      </div>
      <label className="eyebrow" htmlFor="login-phone">{t('phone')}</label>
      <input id="login-phone" className="phone" inputMode="numeric" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
      <div className="eyebrow" style={{ marginTop: 16 }}>{t('pin')}</div>
      <div className="pins" aria-label={t('pin')}>{[0, 1, 2, 3].map(i => <span key={i} className={pin.length > i ? 'on' : ''} />)}</div>
      <div className="pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button onClick={() => setPin(p => p.slice(0, -1))} aria-label="Delete"><Delete size={24} /></button>
        <button onClick={() => press('0')}>0</button>
        <button onClick={() => go()} style={{ background: 'var(--marigold)', borderColor: 'var(--marigold)', color: 'var(--on-marigold)' }} aria-label={t('login')}><ArrowRight size={26} /></button>
      </div>
      {err && <div style={{ color: 'var(--bad)', marginTop: 10, fontWeight: 600 }}>{err}</div>}
      {ENV_SERVER && <button className="btn block" style={{ marginTop: 16 }} onClick={() => setNewFirm({ firmName: '', ownerName: '', gstin: '' })}>New distributor? Start free trial</button>}
      {demo.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Demo logins — tap one</div>
          <div className="row">{demo.map(s => <button key={s.id} className="btn small" onClick={() => { setPhone(s.phone); setPin(s.pin); void go(s.phone, s.pin); }}>{s.name}</button>)}</div>
        </div>
      )}
    </div>
  );
}
