import { useEffect, useState } from 'react';
import { Home as HomeIcon, Menu, Delete, ArrowRight, ArrowLeft, X } from 'lucide-react';
import { dayBefore, db, setSession, today } from './core/db';
import { seedDemo } from './core/seed';
import { ENV_SERVER, login, signup, startAutoSync, syncNow } from './core/sync';
import { t } from './core/i18n';
import { Chat } from './ui/Chat';
import { Home, type Page } from './ui/Home';
import { TesraxCore } from './ui/TesraxCore';
import { ErrorBoundary } from './ui/Safety';
import { Billing } from './ui/Billing';
import { refreshLicence, type LicenceState } from './core/licence';
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
const TITLE: Partial<Record<Page, string>> = {
  'orders-received': 'Orders received', verify: 'Picked — to verify', billed: 'Billed',
  newshops: 'New shops', targets: 'Targets', beat: "Today's beat", myday: 'My day', newshop: 'New shop', 'orders-excel': 'Orders Excel',
  stockin: 'Purchases / stock in', stock: 'Stock position', damages: 'Damages', ageing: 'Ageing', 'stock-reports': 'Stock reports',
  plan: 'Delivery plan', live: 'Live vans', status: 'Delivery status', trips: 'Trip reports', load: 'Load vans', print: 'Load sheet', trip: 'My trip', pick: 'Pick orders',
  collect: 'Collect', outstanding: 'Outstanding', cash: 'Cash with staff', cheques: 'Cheques & UPI',
  bank: 'Bank', expenses: 'Expenses', pnl: 'P&L', cashflow: 'Cash flow', vans: 'Vans & drivers', export: 'Export', reports: 'Reports',
  gst: 'GST', today: 'Today', salary: 'Salary', staff: 'Staff', claims: 'Claims', dayclose: 'Day close', bills: 'Bills',
  'lite-shops': 'Shop list', 'lite-plan': "Today's shops", 'lite-delivery': 'Delivery', 'lite-collect': 'Collection', 'lite-export': "Day's Excel", more: 'More', billing: 'Plan & billing',
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
  const [lic, setLic] = useState<LicenceState | null>(null);
  useEffect(() => {
    const on = (e: Event) => setLic((e as CustomEvent).detail);
    window.addEventListener('hanubix:licence', on);
    void refreshLicence(); const id = setInterval(() => void refreshLicence(), 60000); // dates are re-checked every minute, even offline
    return () => { window.removeEventListener('hanubix:licence', on); clearInterval(id); };
  }, [me]);

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


  if (!ready) return <div className="login"><div className="mark">Hanubix<sup>™</sup></div></div>;
  if (!me) return <><DialogHost /><Login onIn={async (tenantId, userId) => {
    setSession(tenantId, userId);
    if (ENV_SERVER) await syncNow();
    const s = await loadMe(userId);
    if (!s) { void notify('Could not load your data', 'Check the internet and try again.'); return; }
    localStorage.setItem('dbrox.session', JSON.stringify({ tenantId, userId }));
    setPage('home'); setModule(null);
  }} /></>;

  const logout = () => { localStorage.removeItem('dbrox.session'); localStorage.removeItem('dbrox.token'); setMe(null); };
  const home = () => { setPage('home'); };
  const go = (p: string) => { setPage((ALIAS[p] ?? p) as Page); setRox(false); };
  const title = TITLE[page];
  const openRox = () => { sound.wake(); setRox(true); };

  // Check-in gate: nothing opens until the person checks in (owner exempt).
  if (!checkedIn && settings) return <div className="app"><header className="top"><div className="wordmark">Hanubix<sup>™</sup></div><div className="firm">{firm}</div></header><main className="main"><CheckInGate me={me} settings={settings} onDone={() => setCheckedIn(true)} /></main><DialogHost /></div>;

  const body = () => {
    switch (page) {
      case 'home': return <Home role={me.role} go={p => setPage(p)} open={module} onOpen={setModule} />;
      case 'orders-received': return <OrdersReceived />;
      case 'verify': return <Approve go={go} />;
      case 'billed': case 'bills': return <More role={me.role} onLogout={logout} initial="bills" />;
      case 'newshops': return <NewShops />;
      case 'targets': return <Targets />;
      case 'newshop': return <NewShop onDone={home} />;
      case 'beat': return me.role === 'salesman' ? <Beat /> : <BeatBuilder />;
      case 'myday': return <MyDay />;
      case 'stockin': return <StockIn onRox={openRox} />;
      case 'stock': return <StockPosition />;
      case 'damages': return <Damages />;
      case 'ageing': return <Ageing />;
      case 'stock-reports': return <StockReports />;
      case 'claims': return <More role={me.role} onLogout={logout} initial="claims" />;
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
      case 'staff': return <More role={me.role} onLogout={logout} initial="staff" />;
      case 'dayclose': return <DayClose go={p => setPage(p)} />;
      case 'lite-shops': return <LiteShops />;
      case 'lite-plan': return <LitePlan onDone={home} />;
      case 'lite-delivery': return <LiteDelivery />;
      case 'lite-collect': return <LiteCollect />;
      case 'lite-export': return <LiteExport />;
      case 'orders-excel': return <MyDay />;
      case 'billing': return <Billing role={me.role} />;
      case 'more': return <More role={me.role} onLogout={logout} onPlan={() => setPage('billing')} />;
    }
  };

  return (
    <div className="app">
      <GradDefs />
      <header className="top">
        {page === 'home' ? <div className="wordmark">Hanubix<sup>™</sup></div> : <button className="icon-btn" onClick={home} aria-label="Home"><ArrowLeft /></button>}
        <div className="firm">{page === 'home' ? firm : title}</div>
        <div className="who">{me.name.split(' ')[0]}</div>
        <span className={`sync ${online ? '' : 'off'}`} title={online ? 'Online' : t('offline')} />
      </header>
      {!online && <div className="offline-bar">{t('offline')}</div>}
      <PlanBanner lic={lic} onOpen={() => setPage('billing')} />
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
        <button className={page === 'home' ? 'on' : ''} onClick={() => { home(); setModule(null); }}><span className="ic"><HomeIcon /></span>{'Home'}</button>
        {/* TESRAX: the core sits in the centre of the tab bar on every screen, for every role. It proposes, you approve. */}
        <button className="fab" onClick={openRox} aria-label="TESRAX"><TesraxCore size={64} interactive={false} /></button>
        <button className={page === 'more' ? 'on' : ''} onClick={() => setPage('more')}><span className="ic"><Menu /></span>{'More'}</button>
      </nav>
    </div>
  );
}

// Plan banner: trial ending (10 days), payment pending (grace), locked, or licence needs internet.
function PlanBanner({ lic, onOpen }: { lic: LicenceState | null; onOpen: () => void }) {
  if (!lic || lic.demo) return null;
  const left = lic.paidThrough ? Math.round((Date.parse(`${lic.paidThrough}T00:00:00`) - Date.parse(`${new Date().toDateString()}`)) / 86400000) : 99;
  const fmt = (d?: string) => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
  const lockDay = lic.lockOn ? dayBefore(lic.lockOn) : undefined;
  const text = lic.status === 'locked' ? 'Plan not renewed — new orders and bills are paused. Tap to renew.'
    : lic.status === 'expired' ? 'Connect to the internet to renew your licence.'
    : lic.status === 'grace' ? `Payment pending — renew by ${fmt(lockDay)} to keep billing.`
    : lic.status === 'trial' && left <= 10 ? `Free trial ends in ${Math.max(0, left)} day${left === 1 ? '' : 's'} — set up Autopay.` : '';
  if (!text) return null;
  return <button className={`plan-bar ${lic.status === 'locked' ? 'bad' : ''}`} onClick={onOpen}>{text}</button>;
}

// The signature gradient as an SVG paint server, so icon accents can use fill="url(#hg)".
function GradDefs() {
  return <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs><linearGradient id="hg" gradientUnits="userSpaceOnUse" x1="4" y1="0" x2="44" y2="0"><stop offset="0" stopColor="#4FE3D6" /><stop offset=".5" stopColor="#E6E9F4" /><stop offset="1" stopColor="#F9B55B" /></linearGradient></defs></svg>;
}

function Login({ onIn }: { onIn: (tenantId: string, userId: string) => void }) {
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
      <div className="login-hero"><div className="mark">Hanubix<sup>™</sup></div><div className="tag" style={{ color: 'var(--on-navy-2)', margin: '6px 0 0' }}>{'Start your 60-day free trial'}</div></div>
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
      <div className="login-hero"><div className="mark">Hanubix<sup>™</sup></div><div className="tag" style={{ color: 'var(--on-navy-2)', margin: '6px 0 0' }}>{'Which firm?'}</div></div>
      <div className="stack">{firms.map(f => <button key={f.tenantId} className="btn big block" onClick={() => { setTenant(f.tenantId); setFirms(null); void (async () => { const r = await login(phone, pin, f.tenantId); if (r && !('choose' in r)) onIn(r.tenantId, r.userId); })(); }}>{f.firm}</button>)}</div>
    </div>
  );

  return (
    <div className="login">
      <div className="login-hero">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="mark">Hanubix<sup>™</sup></div>
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
