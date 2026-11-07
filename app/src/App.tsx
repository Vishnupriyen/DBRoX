import { useEffect, useState } from 'react';
import { Home as HomeIcon, Menu, Delete, ArrowRight, ArrowLeft, X } from 'lucide-react';
import { db, setSession, today } from './core/db';
import { seedDemo } from './core/seed';
import { ENV_SERVER, login, signup, startAutoSync, syncNow } from './core/sync';
import { getLang, setLang, t } from './core/i18n';
import { Chat } from './ui/Chat';
import { Home, type Page } from './ui/Home';
import { TesraxCore } from './ui/TesraxCore';
import { ErrorBoundary } from './ui/Safety';
import { sound } from './core/sound';
import { Volume2, VolumeX } from 'lucide-react';
import { UndoToast } from './ui/UndoToast';
import { OrdersReceived } from './ui/OrdersReceived';
import { NewShop, NewShops, Targets } from './ui/Sales';
import { StockIn, StockPosition, Damages, Ageing, StockReports } from './ui/Inventory';
import { DeliveryStatus, TripReports, PrintLoad } from './ui/DeliveryReports';
import { Outstanding, Cheques, Bank, Expenses, PnL, CashFlow, ExportPage, Gst } from './ui/Money';
import { Reports } from './ui/Reports';
import { VansPage } from './ui/More';
import { CheckInGate, Today, Salary } from './ui/Payroll';
import { CashWithStaff } from './ui/CashWithStaff';
import { Beat } from './ui/Beat';
import { BeatBuilder } from './ui/BeatBuilder';
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
import type { Settings, Staff } from './core/types';

// Page titles shown in the header when inside a page (Home shows the firm name instead).
const TITLE: Partial<Record<Page, [string, string]>> = {
  'orders-received': ['Orders received', 'வந்த ஆர்டர்கள்'], verify: ['Picked — to verify', 'சரிபார்க்க'], billed: ['Billed', 'பில் ஆனது'],
  newshops: ['New shops', 'புதிய கடைகள்'], targets: ['Targets', 'இலக்கு'], beat: ["Today's beat", 'இன்றைய பீட்'], myday: ['My day', 'என் நாள்'], newshop: ['New shop', 'புதிய கடை'], 'orders-excel': ['Orders Excel', 'ஆர்டர் Excel'],
  stockin: ['Purchases / stock in', 'கொள்முதல்'], stock: ['Stock position', 'ஸ்டாக் நிலை'], damages: ['Damages', 'சேதம்'], ageing: ['Ageing', 'பழைய ஸ்டாக்'], 'stock-reports': ['Stock reports', 'ஸ்டாக் அறிக்கை'],
  plan: ['Delivery plan', 'டெலிவரி திட்டம்'], live: ['Live vans', 'வண்டிகள் இப்போது'], status: ['Delivery status', 'டெலிவரி நிலை'], trips: ['Trip reports', 'டிரிப் அறிக்கை'], load: ['Load vans', 'வண்டி ஏற்று'], print: ['Load sheet', 'லோடு ஷீட்'], trip: ['My trip', 'என் டிரிப்'], pick: ['Pick orders', 'ஆர்டர் எடு'],
  collect: ['Collect', 'வசூல்'], outstanding: ['Outstanding', 'நிலுவை'], cash: ['Cash with staff', 'ஊழியர்களிடம் பணம்'], cheques: ['Cheques & UPI', 'செக் & UPI'],
  bank: ['Bank', 'வங்கி'], expenses: ['Expenses', 'செலவு'], pnl: ['P&L', 'லாப நஷ்டம்'], cashflow: ['Cash flow', 'பண ஓட்டம்'], vans: ['Vans & drivers', 'வண்டிகள்'], export: ['Export', 'ஏற்றுமதி'], reports: ['Reports', 'அறிக்கை'],
  gst: ['GST', 'GST'], today: ['Today', 'இன்று'], salary: ['Salary', 'சம்பளம்'], staff: ['Staff', 'ஊழியர்கள்'], claims: ['Claims', 'கிளைம்'], dayclose: ['Day close', 'நாள் முடிவு'], bills: ['Bills', 'பில்கள்'],
  'lite-shops': ['Shop list', 'கடை பட்டியல்'], 'lite-plan': ["Today's shops", 'இன்றைய கடைகள்'], 'lite-delivery': ['Delivery', 'டெலிவரி'], 'lite-collect': ['Collection', 'வசூல்'], 'lite-export': ["Day's Excel", 'இன்றைய Excel'], more: ['More', 'மேலும்'],
};
// TESRAX "open a screen" names → pages (keeps old names working)
const ALIAS: Record<string, Page> = { approve: 'orders-received', position: 'cashflow', cash: 'cash', claims: 'claims', bills: 'billed' };

export default function App() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Staff | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [firm, setFirm] = useState('');
  const [page, setPage] = useState<Page>('home');
  const [module, setModule] = useState<string | null>(null);
  const [rox, setRox] = useState(false);
  const [soundOn, setSoundOn] = useState(sound.isOn());
  const [checkedIn, setCheckedIn] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [langTick, setLangTick] = useState(0);
  const lang = getLang();

  const loadMe = async (userId: string) => {
    const s = await db.staff.get(userId);
    const st = await db.settings.toCollection().first();
    setSettings(st ?? null); setFirm(st?.firmName ?? '');
    if (s) { setMe(s); setCheckedIn(s.role === 'owner' || !!(await db.checkIns.where('date').equals(today()).toArray()).find(c => c.staffId === s.id)); }
    return s;
  };

  useEffect(() => {
    (async () => {
      if (!ENV_SERVER) await seedDemo();
      setFirm((await db.settings.toCollection().first())?.firmName ?? '');
      const saved = localStorage.getItem('dbrox.session');
      if (saved) {
        const { tenantId, userId } = JSON.parse(saved);
        const s = await db.staff.get(userId);
        if (s?.active) { setSession(tenantId, userId); await loadMe(userId); }
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

  if (!ready) return <div className="login"><div className="mark">Hanubix<sup>™</sup></div></div>;
  if (!me) return <><DialogHost /><Login onIn={async (tenantId, userId) => {
    setSession(tenantId, userId);
    if (ENV_SERVER) await syncNow();
    const s = await loadMe(userId);
    if (!s) { void notify('Could not load your data', 'Check the internet and try again.'); return; }
    localStorage.setItem('dbrox.session', JSON.stringify({ tenantId, userId }));
    setPage('home'); setModule(null);
  }} lang={lang} onLang={toggleLang} /></>;

  const logout = () => { localStorage.removeItem('dbrox.session'); localStorage.removeItem('dbrox.token'); setMe(null); };
  const home = () => { setPage('home'); };
  const go = (p: string) => { setPage((ALIAS[p] ?? p) as Page); setRox(false); };
  const title = TITLE[page]?.[lang === 'ta' ? 1 : 0];
  const openRox = () => { sound.wake(); setRox(true); };

  // Check-in gate: nothing opens until the person checks in (owner exempt).
  if (!checkedIn && settings) return <div className="app"><header className="top"><div className="wordmark">Hanubix<sup>™</sup></div><div className="firm">{firm}</div><button className="lang" onClick={toggleLang}>{lang === 'en' ? 'தமிழ்' : 'EN'}</button></header><main className="main"><CheckInGate me={me} settings={settings} onDone={() => setCheckedIn(true)} /></main><DialogHost /></div>;

  const body = () => {
    switch (page) {
      case 'home': return <Home role={me.role} go={p => setPage(p)} open={module} onOpen={setModule} />;
      case 'orders-received': return <OrdersReceived />;
      case 'verify': return <Approve go={go} />;
      case 'billed': case 'bills': return <More role={me.role} onLogout={logout} onLang={toggleLang} initial="bills" />;
      case 'newshops': return <NewShops />;
      case 'targets': return <Targets />;
      case 'newshop': return <NewShop onDone={home} />;
      case 'beat': return me.role === 'salesman' ? <Beat lang={lang} /> : <BeatBuilder />;
      case 'myday': return <MyDay />;
      case 'stockin': return <StockIn onRox={openRox} />;
      case 'stock': return <StockPosition />;
      case 'damages': return <Damages />;
      case 'ageing': return <Ageing />;
      case 'stock-reports': return <StockReports />;
      case 'claims': return <More role={me.role} onLogout={logout} onLang={toggleLang} initial="claims" />;
      case 'plan': return <Plan onDone={home} />;
      case 'live': return <Live />;
      case 'status': return <DeliveryStatus />;
      case 'trips': return <TripReports />;
      case 'load': return <Pick />;
      case 'print': return <PrintLoad />;
      case 'trip': return <Delivery />;
      case 'pick': return <PickOrders />;
      case 'collect': return <Collect />;
      case 'outstanding': return <Outstanding />;
      case 'cash': return <CashWithStaff />;
      case 'cheques': return <Cheques />;
      case 'bank': return <Bank onRox={openRox} />;
      case 'expenses': return <Expenses onRox={openRox} />;
      case 'pnl': return <PnL />;
      case 'reports': return <Reports />;
      case 'cashflow': return <CashFlow go={go} />;
      case 'vans': return <VansPage editable={me.role === 'owner'} />;
      case 'export': return <ExportPage />;
      case 'gst': return <Gst go={go} />;
      case 'today': return <Today />;
      case 'salary': return <Salary />;
      case 'staff': return <More role={me.role} onLogout={logout} onLang={toggleLang} initial="staff" />;
      case 'dayclose': return <DayClose go={p => setPage(p)} />;
      case 'lite-shops': return <LiteShops />;
      case 'lite-plan': return <LitePlan onDone={home} />;
      case 'lite-delivery': return <LiteDelivery />;
      case 'lite-collect': return <LiteCollect />;
      case 'lite-export': return <LiteExport />;
      case 'orders-excel': return <MyDay />;
      case 'more': return <More role={me.role} onLogout={logout} onLang={toggleLang} />;
    }
  };

  return (
    <div className="app" key={langTick}>
      <GradDefs />
      <header className="top">
        {page === 'home' ? <div className="wordmark">Hanubix<sup>™</sup></div> : <button className="icon-btn" onClick={home} aria-label="Home"><ArrowLeft /></button>}
        <div className="firm">{page === 'home' ? firm : title}</div>
        <div className="who">{me.name.split(' ')[0]}</div>
        <span className={`sync ${online ? '' : 'off'}`} title={online ? 'Online' : t('offline')} />
        <button className="lang" onClick={toggleLang}>{lang === 'en' ? 'தமிழ்' : 'EN'}</button>
      </header>
      {!online && <div className="offline-bar">{t('offline')}</div>}
      <main className="main" key={page}><ErrorBoundary resetKey={page} onHome={home}>{body()}</ErrorBoundary></main>
      <DialogHost />
      <UndoToast />

      {rox && (
        <div className="engine" role="dialog" aria-label="TESRAX">
          <div className="engine-col">
            <div className="engine-head" onPointerDown={e => { (e.currentTarget as HTMLElement).dataset.y = String(e.clientY); }} onPointerUp={e => { const y0 = Number((e.currentTarget as HTMLElement).dataset.y ?? e.clientY); if (e.clientY - y0 > 70) setRox(false); }}>
              <span className="engine-mark">Hanubix<sup>™</sup></span>
              <span className="engine-pw">Powered by <b>TESRAX</b></span>
              <button className="engine-x" onClick={() => { const v = !soundOn; sound.set(v); setSoundOn(v); }} aria-label={soundOn ? 'Sound off' : 'Sound on'}>{soundOn ? <Volume2 /> : <VolumeX />}</button>
              <button className="engine-x" onClick={() => setRox(false)} aria-label="Close"><X /></button>
            </div>
            <Chat role={me.role} onGo={go} />
          </div>
        </div>
      )}

      <nav className="tabs">
        <button className={page === 'home' ? 'on' : ''} onClick={() => { home(); setModule(null); }}><span className="ic"><HomeIcon /></span>{lang === 'ta' ? 'முகப்பு' : 'Home'}</button>
        {/* TESRAX: the core sits in the centre of the tab bar on every screen, for every role. It proposes, you approve. */}
        <button className="fab" onClick={openRox} aria-label="TESRAX"><TesraxCore size={64} interactive={false} /></button>
        <button className={page === 'more' ? 'on' : ''} onClick={() => setPage('more')}><span className="ic"><Menu /></span>{lang === 'ta' ? 'மேலும்' : 'More'}</button>
      </nav>
    </div>
  );
}

// The signature gradient as an SVG paint server, so icon accents can use fill="url(#hg)".
function GradDefs() {
  return <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs><linearGradient id="hg" gradientUnits="userSpaceOnUse" x1="4" y1="0" x2="44" y2="0"><stop offset="0" stopColor="#4FE3D6" /><stop offset=".5" stopColor="#E6E9F4" /><stop offset="1" stopColor="#F9B55B" /></linearGradient></defs></svg>;
}

function Login({ onIn, lang, onLang }: { onIn: (tenantId: string, userId: string) => void; lang: 'en' | 'ta'; onLang: () => void }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [demo, setDemo] = useState<Staff[]>([]);
  const [firms, setFirms] = useState<{ tenantId: string; firm: string }[] | null>(null);
  const [tenant, setTenant] = useState<string | undefined>();
  const [newFirm, setNewFirm] = useState<{ firmName: string; ownerName: string; gstin: string } | null>(null);
  useEffect(() => { if (!ENV_SERVER) db.staff.toArray().then(setDemo); }, []);
  const go = async (p = phone, n = pin) => {
    setErr('');
    const r = await login(p, n, tenant);
    if (!r) { setErr(t('wrongPin')); setPin(''); return; }
    if ('choose' in r) { setFirms(r.choose); return; }
    onIn(r.tenantId, r.userId);
  };
  const press = (d: string) => { const n = (pin + d).slice(0, 4); setPin(n); if (n.length === 4 && phone.length === 10) void go(phone, n); };

  if (newFirm) return (
    <div className="login">
      <div className="login-hero"><div className="mark">Hanubix<sup>™</sup></div><div className="tag" style={{ color: 'var(--on-navy-2)', margin: '6px 0 0' }}>{lang === 'ta' ? '60 நாள் இலவச சோதனை' : 'Start your 60-day free trial'}</div></div>
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

  if (firms) return (
    <div className="login">
      <div className="login-hero"><div className="mark">Hanubix<sup>™</sup></div><div className="tag" style={{ color: 'var(--on-navy-2)', margin: '6px 0 0' }}>{lang === 'ta' ? 'எந்த நிறுவனம்?' : 'Which firm?'}</div></div>
      <div className="stack">{firms.map(f => <button key={f.tenantId} className="btn big block" onClick={() => { setTenant(f.tenantId); setFirms(null); void (async () => { const r = await login(phone, pin, f.tenantId); if (r && !('choose' in r)) onIn(r.tenantId, r.userId); })(); }}>{f.firm}</button>)}</div>
    </div>
  );

  return (
    <div className="login">
      <div className="login-hero">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="mark">Hanubix<sup>™</sup></div>
          <button className="lang" onClick={onLang}>{lang === 'en' ? 'தமிழ்' : 'EN'}</button>
        </div>
        <div className="powered">Powered by <b>TESRAX</b></div>
        <div className="tag" style={{ margin: '10px 0 0' }}>{t('appTagline')}</div>
      </div>
      <label className="eyebrow" htmlFor="login-phone">{t('phone')}</label>
      <input id="login-phone" className="phone" inputMode="numeric" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
      <div className="eyebrow" style={{ marginTop: 16 }}>{t('pin')}</div>
      <div className="pins" aria-label={t('pin')}>{[0, 1, 2, 3].map(i => <span key={i} className={pin.length > i ? 'on' : ''} />)}</div>
      <div className="pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button onClick={() => setPin(p => p.slice(0, -1))} aria-label="Delete"><Delete size={24} /></button>
        <button onClick={() => press('0')}>0</button>
        <button className="go" onClick={() => go()} aria-label={t('login')}><ArrowRight size={26} /></button>
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
