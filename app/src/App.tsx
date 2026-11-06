import { useEffect, useState } from 'react';
import { Home as HomeIcon, Menu, Delete, ArrowRight, ArrowLeft, X } from 'lucide-react';
import { db, setSession } from './core/db';
import { seedDemo } from './core/seed';
import { ENV_SERVER, login, signup, startAutoSync, syncNow } from './core/sync';
import { getLang, setLang, t } from './core/i18n';
import { Chat } from './ui/Chat';
import { Home, type Page } from './ui/Home';
import { Morning } from './ui/Morning';
import { Beat } from './ui/Beat';
import { Pick } from './ui/Pick';
import { PickOrders } from './ui/PickOrders';
import { Approve } from './ui/Approve';
import { Plan } from './ui/Plan';
import { Live } from './ui/Live';
import { DayClose } from './ui/DayClose';
import { Delivery } from './ui/Delivery';
import { Collect } from './ui/Collect';
import { MyDay } from './ui/MyDay';
import { LiteShops, LitePlan, LiteDelivery, LiteCollect, LiteExport } from './ui/Lite';
import { More } from './ui/More';
import { DialogHost, notify } from './ui/dialog';
import type { Staff } from './core/types';

// Page titles shown in the header when inside a page (Home shows the firm name instead).
const TITLE: Partial<Record<Page, [string, string]>> = {
  approve: ['Approve orders', 'ஆர்டர் ஒப்புதல்'], plan: ['Delivery plan', 'டெலிவரி திட்டம்'], live: ['Live vans', 'வண்டிகள் இப்போது'], collect: ['Collect', 'வசூல்'],
  cash: ['Cash with staff', 'ஊழியர்களிடம் பணம்'], stock: ['Stock alerts', 'ஸ்டாக் எச்சரிக்கை'], claims: ['Claims', 'கிளைம்'], dayclose: ['Day close', 'நாள் முடிவு'],
  reports: ['Reports', 'அறிக்கை'], bills: ['Bills', 'பில்கள்'], pick: ['Pick orders', 'ஆர்டர் எடு'], load: ['Load vans', 'வண்டி ஏற்று'], trip: ['My trip', 'என் டிரிப்'],
  beat: ["Today's beat", 'இன்றைய பீட்'], myday: ['My day', 'என் நாள்'], 'lite-shops': ['Shop list', 'கடை பட்டியல்'], 'lite-plan': ["Today's shops", 'இன்றைய கடைகள்'],
  'lite-delivery': ['Delivery', 'டெலிவரி'], 'lite-collect': ['Collection', 'வசூல்'], 'lite-export': ["Day's Excel", 'இன்றைய Excel'], more: ['More', 'மேலும்'],
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Staff | null>(null);
  const [firm, setFirm] = useState('');
  const [page, setPage] = useState<Page>('home');
  const [rox, setRox] = useState(false);
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
        if (s?.active) { setSession(tenantId, userId); setMe(s); }
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
    setMe(s); setPage('home');
  }} lang={lang} onLang={toggleLang} /></>;

  const logout = () => { localStorage.removeItem('dbrox.session'); localStorage.removeItem('dbrox.token'); setMe(null); };
  const home = () => setPage('home');
  const title = TITLE[page]?.[lang === 'ta' ? 1 : 0];

  const body = () => {
    switch (page) {
      case 'home': return <Home role={me.role} go={setPage} />;
      case 'approve': return <Approve />;
      case 'plan': return <Plan onDone={home} />;
      case 'live': return <Live />;
      case 'collect': return <Collect />;
      case 'cash': return <Morning only="cash" />;
      case 'stock': return <Morning only="stock" />;
      case 'claims': return <More role={me.role} onLogout={logout} onLang={toggleLang} initial="claims" />;
      case 'dayclose': return <DayClose />;
      case 'reports': return <Morning />;
      case 'bills': return <More role={me.role} onLogout={logout} onLang={toggleLang} initial="bills" />;
      case 'pick': return <PickOrders />;
      case 'load': return <Pick />;
      case 'trip': return <Delivery />;
      case 'beat': return <Beat lang={lang} />;
      case 'myday': return <MyDay />;
      case 'lite-shops': return <LiteShops />;
      case 'lite-plan': return <LitePlan onDone={home} />;
      case 'lite-delivery': return <LiteDelivery />;
      case 'lite-collect': return <LiteCollect />;
      case 'lite-export': return <LiteExport />;
      case 'more': return <More role={me.role} onLogout={logout} onLang={toggleLang} />;
    }
  };

  return (
    <div className="app" key={langTick}>
      <header className="top">
        {page === 'home' ? <div className="wordmark">DB<em>RoX</em></div> : <button className="icon-btn" onClick={home} aria-label="Home"><ArrowLeft /></button>}
        <div className="firm">{page === 'home' ? firm : title}</div>
        <div className="who">{me.name.split(' ')[0]}</div>
        <span className={`sync ${online ? '' : 'off'}`} title={online ? 'Online' : t('offline')} />
        <button className="lang" onClick={toggleLang}>{lang === 'en' ? 'தமிழ்' : 'EN'}</button>
      </header>
      {!online && <div className="offline-bar">{t('offline')}</div>}
      <main className="main" key={page}>{body()}</main>
      <DialogHost />

      {/* RoX Engine: one floating button on every screen, for every role. Type or speak; it proposes, you approve. */}
      <button className="fab" onClick={() => setRox(true)} aria-label="RoX Engine"><span className="fab-mark">RoX</span></button>
      {rox && (
        <div className="sheet-wrap" onClick={() => setRox(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-head"><span className="fab-mark small">RoX</span><b className="grow">RoX Engine</b><button className="icon-btn" onClick={() => setRox(false)} aria-label="Close"><X /></button></div>
            <div className="sheet-body"><Chat role={me.role} onGo={p => { setPage(p as Page); setRox(false); }} /></div>
          </div>
        </div>
      )}

      <nav className="tabs">
        <button className={page === 'home' ? 'on' : ''} onClick={home}><span className="ic"><HomeIcon /></span>{lang === 'ta' ? 'முகப்பு' : 'Home'}</button>
        <button className={page === 'more' ? 'on' : ''} onClick={() => setPage('more')}><span className="ic"><Menu /></span>{lang === 'ta' ? 'மேலும்' : 'More'}</button>
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
