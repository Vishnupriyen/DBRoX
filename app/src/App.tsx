import { useEffect, useRef, useState } from 'react';
import { Home as HomeIcon, Menu, Delete, ArrowRight, ArrowLeft, X } from 'lucide-react';
import { dayBefore, db, setSession, sideNow, today } from './core/db';
import { wireDemoRelay } from './core/link';
import { seedCompanyDemo } from './core/seedCompany';
import { CompanyHome, CompanyPage, CO_TITLE, type CoPage } from './ui/Company';
import { switchDemoSide } from './ui/More';
import { CompanyBills, OrderToCompany } from './ui/CompanyBills';
import { isCompanyRole } from './core/types';
import { addPoint } from './core/field';
import { seedDemo } from './core/seed';
import { demoLogin, ENV_SERVER, login, offlineCheck, pinChangeDue, PRIVACY_VERSION, server, signup, startAutoSync, syncNow } from './core/sync';
import { AWAY_LOCK_MINUTES, clearToken, hasVerifier, pinLengthFor, securePins } from './core/secure';
import { noticeAccepted } from './core/privacy';
import { ConsentScreen, LockScreen, Notice, PinChange, PrivacyPage } from './ui/Privacy';
import { t } from './core/i18n';
import { Chat } from './ui/Chat';
import { Home, type Page } from './ui/Home';
import { TesraxCore } from './ui/TesraxCore';
import { Brand } from './ui/Brand';
import { ErrorBoundary } from './ui/Safety';
import { Billing } from './ui/Billing';
import { refreshLicence, type LicenceState } from './core/licence';
import { sound } from './core/sound';
import { Volume2, VolumeX, RefreshCw, LogOut, Repeat, ShieldCheck } from 'lucide-react';
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
import type { Invoice, Settings, Staff } from './core/types';
import { PrintBill } from './ui/PrintBill';
import { Boost } from './ui/Boost';

// Page titles shown in the header when inside a page (Home shows the firm name instead).
const TITLE: Partial<Record<Page, string>> = {
  'orders-received': 'Orders received', verify: 'Picked — to verify', billed: 'Billed',
  newshops: 'New shops', targets: 'Targets', beat: "Today's beat", myday: 'My day', newshop: 'New shop', 'orders-excel': 'Orders Excel',
  stockin: 'Purchases / stock in', stock: 'Stock position', damages: 'Damages', ageing: 'Ageing', 'stock-reports': 'Stock reports',
  plan: 'Delivery plan', live: 'Live vans', status: 'Delivery status', trips: 'Trip reports', load: 'Load vans', print: 'Load sheet', trip: 'My trip', pick: 'Pick orders',
  collect: 'Collect', outstanding: 'Outstanding', cash: 'Cash with staff', cheques: 'Cheques & UPI',
  bank: 'Bank', expenses: 'Expenses', pnl: 'P&L', cashflow: 'Cash flow', vans: 'Vans & drivers', export: 'Export', reports: 'Reports',
  gst: 'GST', today: 'Today', salary: 'Salary', staff: 'Staff', claims: 'Claims', dayclose: 'Day close', bills: 'Bills', privacy: 'Privacy & security',
  'inbound': 'Company bills', 'reorder': 'Order to company', 'lite-shops': 'Shop list', 'lite-plan': "Today's shops", 'lite-delivery': 'Delivery', 'lite-collect': 'Collection', 'lite-export': "Day's Excel", more: 'Menu', billing: 'Plan & billing', settings: 'Settings', links: 'Company links', tesrax: 'TESRAX report', boost: 'Business Boost',
};
// TESRAX "open a screen" names → pages (keeps old names working)
const ALIAS: Record<string, Page> = { approve: 'orders-received', position: 'cashflow', cash: 'cash', claims: 'claims', bills: 'billed' };

export default function App() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Staff | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [firm, setFirm] = useState('');
  const [page, setPage] = useState<Page | CoPage>('home');
  const [module, setModule] = useState<string | null>(null);
  const [rox, setRox] = useState(false);
  // TESRAX "send bill SMD/26-27/00005": the bill opens over any screen, ready to print or save as PDF
  const [printInv, setPrintInv] = useState<Invoice | null>(null);
  useEffect(() => {
    const on = async (e: Event) => { const id = (e as CustomEvent<{ invoiceId: string }>).detail?.invoiceId; const inv = id ? await db.invoices.get(id) : undefined; if (inv) { setRox(false); setPrintInv(inv); } };
    window.addEventListener('hanubix:print-bill', on);
    return () => window.removeEventListener('hanubix:print-bill', on);
  }, []);
  const [moreKey, setMoreKey] = useState(0);
  const [soundOn, setSoundOn] = useState(sound.isOn());
  const [checkedIn, setCheckedIn] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [lic, setLic] = useState<LicenceState | null>(null);
  // security standard (13 Nov 2026): first-login notice, the owner's 6-digit PIN, the app lock, the 14-day offline limit
  const [gate, setGate] = useState<{ step: 'consent' | 'pin'; length?: number } | null>(null);
  const [locked, setLocked] = useState<number | null>(null); // the PIN length while the app is locked
  const [offWarn, setOffWarn] = useState<number | null>(null);
  const [loginMsg, setLoginMsg] = useState('');
  const awayAt = useRef(0);
  useEffect(() => {
    if (!me) return;
    const on = () => {
      if (document.hidden) { awayAt.current = Date.now(); return; }
      if (!awayAt.current || Date.now() - awayAt.current < AWAY_LOCK_MINUTES * 60000) return;
      awayAt.current = 0;
      void (async () => { if (await hasVerifier(me.tenantId, me.id)) setLocked((await pinLengthFor(me.phone)) ?? 4); })();
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [me]);
  useEffect(() => {
    const on = (e: Event) => setLic((e as CustomEvent).detail);
    window.addEventListener('hanubix:licence', on);
    void refreshLicence(); const id = setInterval(() => void refreshLicence(), 60000); // dates are re-checked every minute, even offline
    return () => { window.removeEventListener('hanubix:licence', on); clearInterval(id); };
  }, [me]);

  // company field rep: while the day is open and the app is on screen, location readings build the km record
  useEffect(() => {
    if (me?.role !== 'rep' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(p => { void addPoint({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }).catch(() => {}); }, () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 60000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [me]);

  const loadMe = async (userId: string) => {
    const s = await db.staff.get(userId);
    const st = await db.settings.toCollection().first();
    setSettings(st ?? null); setFirm(st?.firmName ?? '');
    if (s) { setMe(s); setCheckedIn(s.role === 'owner' || isCompanyRole(s.role) || !!(await db.checkIns.where('date').equals(today()).toArray()).find(c => c.staffId === s.id)); }
    return s;
  };

  useEffect(() => {
    (async () => {
      if (!ENV_SERVER) { await wireDemoRelay(); if (sideNow() === 'company') await seedCompanyDemo(); else await seedDemo(); }
      const hasServer = !!(await server());
      // a phone away from the server too long: 14 days → log in online; 30 days → its copy of the firm's data is removed,
      // never while it holds unsent work (core/sync.ts offlineCheck)
      const off = await offlineCheck();
      if (off.wiped) setLoginMsg(`This phone had not reached the server for ${off.days} days, so its copy of the firm's data was removed. Log in to get it back.`);
      else if (off.mustLogin) { localStorage.removeItem('dbrox.session'); setLoginMsg(off.kept ? 'Connect to the internet and log in — your unsent work is kept.' : `This phone has not reached the server for ${off.days} days. Connect to the internet and log in.`); }
      setOffWarn(off.warnDaysLeft);
      void securePins(hasServer).catch(() => {}); // plain PINs from an older version become hashes
      setFirm((await db.settings.toCollection().first())?.firmName ?? '');
      const saved = localStorage.getItem('dbrox.session');
      if (saved) {
        const { tenantId, userId } = JSON.parse(saved);
        const s = await db.staff.get(userId);
        if (s?.active) {
          setSession(tenantId, userId); await loadMe(userId);
          const due = await pinChangeDue(tenantId, userId); // the forced 6-digit PIN can't be skipped by closing the app
          if (due) setGate({ step: 'pin', length: due }); else if (!(await noticeAccepted())) setGate({ step: 'consent' });
        }
      }
      setReady(true);
      startAutoSync();
    })();
    const kicked = () => { void clearToken(); setMe(null); };
    window.addEventListener('dbrox:logout', kicked);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('dbrox:logout', kicked); };
  }, []);

  // a screen with its own levels (More → Settings) handles "back" first; returns true if it did
  const stepBack = () => { const e = new Event('hanubix:back', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
  // Android app: the phone's back button closes RoX, then the open module, then goes home; on home it puts the app away.
  // One listener for the app's whole life, reading the current screen (a listener per screen change used to pile up,
  // and an old one could put the app away from any screen).
  const nav = useRef({ rox, module, page });
  nav.current = { rox, module, page };
  useEffect(() => {
    let off: (() => void) | undefined, gone = false;
    void (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { App: Native } = await import('@capacitor/app');
      const h = await Native.addListener('backButton', () => {
        const n = nav.current;
        if (n.rox) setRox(false);
        else if (stepBack()) { /* a screen went back one level itself */ }
        else if (n.page !== 'home') setPage('home'); // a screen first: home shows the module it came from
        else if (n.module) setModule(null);
        else void Native.minimizeApp();
      });
      if (gone) void h.remove(); else off = () => { void h.remove(); };
    })();
    return () => { gone = true; off?.(); };
  }, []);


  if (!ready) return <div className="login"><div className="mark"><Brand /></div></div>;
  if (!me) return <><DialogHost /><Login msg={loginMsg} onIn={async (tenantId, userId, mustPin) => {
    setSession(tenantId, userId);
    if (await server()) await syncNow(); // unsent work kept through a long time offline goes to the server right away
    const s = await loadMe(userId);
    if (!s) { void notify('Could not load your data', 'Check the internet and try again.'); return; }
    localStorage.setItem('dbrox.session', JSON.stringify({ tenantId, userId }));
    setLoginMsg(''); setOffWarn(null);
    setPage('home'); setModule(null);
    if (mustPin) setGate({ step: 'pin', length: mustPin });
    else if (!(await noticeAccepted())) setGate({ step: 'consent' });
  }} /></>;

  const logout = () => { localStorage.removeItem('dbrox.session'); void clearToken(); setGate(null); setLocked(null); setMe(null); };
  // before anything else: the owner's new 6-digit PIN, the privacy notice on a first login, the app lock
  if (gate?.step === 'pin') return <><PinChange me={me} length={gate.length ?? 6} forced onDone={async () => setGate((await noticeAccepted()) ? null : { step: 'consent' })} /><DialogHost /></>;
  if (gate?.step === 'consent') return <><ConsentScreen me={me} onDone={() => setGate(null)} /><DialogHost /></>;
  if (locked) return <><LockScreen me={me} length={locked} onOpen={() => setLocked(null)} onLogout={logout} /><DialogHost /></>;
  const home = () => { setPage('home'); };
  const go = (p: string) => { if (p.startsWith('module:')) { setPage('home'); setModule(p.slice(7)); } else setPage((ALIAS[p] ?? p) as Page); setRox(false); }; // a module (Bill, Inventory…) opens its tiles on Home
  const company = settings?.kind === 'company';
  const title = page in CO_TITLE ? CO_TITLE[page as CoPage] : TITLE[page as Page];
  const openRox = () => { sound.wake(); setRox(true); };

  // Check-in gate: nothing opens until the person checks in (owner exempt).
  if (!checkedIn && settings) return <div className="app"><header className="top"><div className="wordmark"><Brand /></div><div className="firm">{firm}</div></header><main className="main"><CheckInGate me={me} settings={settings} onDone={() => setCheckedIn(true)} /></main><DialogHost /></div>;

  const body = () => {
    if (page === 'privacy') return <PrivacyPage me={me} onLogout={logout} />;
    if (company) {
      if (page === 'home') return <CompanyHome role={me.role} go={p => setPage(p)} />;
      if (page in CO_TITLE) return <CompanyPage page={page as CoPage} role={me.role} go={p => setPage(p)} />;
      if (page === 'more') return <CompanyMore onLogout={logout} onPrivacy={() => setPage('privacy')} />;
      return <CompanyHome role={me.role} go={p => setPage(p)} />;
    }
    switch (page as Page) {
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
      case 'pnl': return me.role === 'owner' ? <PnL /> : <Home role={me.role} go={p => setPage(p)} open={module} onOpen={setModule} />; // profit: owner only
      case 'reports': return <Reports />;
      case 'cashflow': return <CashFlow go={go} />;
      case 'vans': return <VansPage editable={me.role === 'owner'} />;
      case 'export': return <ExportPage />;
      case 'gst': return <Gst go={go} />;
      case 'today': return <Today />;
      case 'salary': return <Salary />;
      case 'staff': return <More role={me.role} onLogout={logout} initial="staff" />;
      case 'boost': return me.role === 'owner' || me.role === 'office' ? <Boost /> : <Home role={me.role} go={p => setPage(p)} open={module} onOpen={setModule} />;
      case 'settings': case 'links': case 'tesrax': return <More role={me.role} onLogout={logout} initial={page as 'settings' | 'links' | 'tesrax'} />;
      case 'dayclose': return <DayClose go={p => setPage(p)} />;
      case 'lite-shops': return <LiteShops />;
      case 'lite-plan': return <LitePlan onDone={home} />;
      case 'lite-delivery': return <LiteDelivery />;
      case 'lite-collect': return <LiteCollect />;
      case 'lite-export': return <LiteExport />;
      case 'orders-excel': return <MyDay />;
      case 'billing': return <Billing role={me.role} />;
      case 'inbound': return <CompanyBills />;
      case 'reorder': return <OrderToCompany />;
      case 'more': return <More key={moreKey} role={me.role} onLogout={logout} onPlan={() => setPage('billing')} go={go} />; // tapping More always shows the More menu
      case 'privacy': return <PrivacyPage me={me} onLogout={logout} />;
    }
  };

  return (
    <div className="app">
      <GradDefs />
      {page === 'home' ? (
        // Home: the logo with RETAIL INTELLIGENCE on the left; the person and the firm stacked on the right
        <header className="top home-top">
          <div className="wordmark"><Brand stroke={4} tagSize={22} gap={12} /></div>
          <div className="top-id">
            <div className="who">{me.name.split(' ')[0]}<span className={`sync ${online ? '' : 'off'}`} title={online ? 'Online' : t('offline')} /></div>
            <div className="firm">{firm}</div>
          </div>
        </header>
      ) : (
        <header className="top">
          <button className="icon-btn" onClick={() => { if (!stepBack()) home(); }} aria-label="Back"><ArrowLeft /></button>
          <div className="firm">{title}</div>
          <div className="who">{me.name.split(' ')[0]}</div>
          <span className={`sync ${online ? '' : 'off'}`} title={online ? 'Online' : t('offline')} />
        </header>
      )}
      {!online && <div className="offline-bar">{t('offline')}</div>}
      {offWarn !== null && <div className="offline-bar">{`Connect to the internet within ${offWarn} day${offWarn === 1 ? '' : 's'} to keep using this phone`}</div>}
      <PlanBanner lic={lic} onOpen={() => setPage('billing')} />
      <main className="main" key={page}><ErrorBoundary resetKey={page} onHome={home}>{body()}</ErrorBoundary></main>
      {printInv && <PrintBill invoice={printInv} onClose={() => setPrintInv(null)} />}
      <DialogHost />
      <UndoToast page={`${page}|${module ?? ""}`} />

      {rox && (
        <div className="engine" role="dialog" aria-label="TESRAX">
          <div className="engine-col">
            <div className="engine-head" onPointerDown={e => { (e.currentTarget as HTMLElement).dataset.y = String(e.clientY); }} onPointerUp={e => { const y0 = Number((e.currentTarget as HTMLElement).dataset.y ?? e.clientY); if (e.clientY - y0 > 70) setRox(false); }}>
              <Brand width={120} tagline={false} />
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
        <div className="fab"><TesraxCore size={62} n={420} onDark onActivate={openRox} label="TESRAX — double tap to open" /></div>
        <button className={page === 'more' ? 'on' : ''} onClick={() => { setPage('more'); setMoreKey(k => k + 1); }}><span className="ic"><Menu /></span>{'Menu'}</button>
      </nav>
    </div>
  );
}

// Company side "More": a short menu (sync, log out; in the demo, back to the distributor side)
function CompanyMore({ onLogout, onPrivacy }: { onLogout: () => void; onPrivacy: () => void }) {
  return (
    <div className="list">
      <button className="item" onClick={async () => notify('Sync', await syncNow())}><RefreshCw /> <span className="grow">Sync now</span></button>
      <button className="item" onClick={onPrivacy}><ShieldCheck /> <span className="grow">Privacy & security</span></button>
      <button className="item" onClick={onLogout}><LogOut /> <span className="grow">Log out</span></button>
      {!ENV_SERVER && <button className="item" onClick={() => switchDemoSide('distributor')}><Repeat /> <span className="grow">Demo: open the distributor side</span></button>}
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

// The signature colour (solid teal, no gradient) as an SVG paint server, so icon accents can use fill="url(#hg)".
function GradDefs() {
  return <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs><linearGradient id="hg" gradientUnits="userSpaceOnUse" x1="4" y1="0" x2="44" y2="0"><stop offset="0" stopColor="#4FE3D6" /><stop offset="1" stopColor="#4FE3D6" /></linearGradient></defs></svg>;
}

function Login({ onIn, msg }: { onIn: (tenantId: string, userId: string, mustPin?: number) => void; msg?: string }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(msg ?? '');
  // how many digits: known on a phone that logged in before (owner 6, staff 4); otherwise up to 6 and the arrow
  const [known, setKnown] = useState<number | null>(null);
  useEffect(() => { if (phone.length === 10) void pinLengthFor(phone).then(setKnown); else setKnown(null); }, [phone]);
  const [agree, setAgree] = useState(false);
  const [aiScan, setAiScan] = useState(false);
  const [demo, setDemo] = useState<Staff[]>([]);
  const [firms, setFirms] = useState<{ tenantId: string; firm: string }[] | null>(null);
  const [tenant, setTenant] = useState<string | undefined>();
  const [newFirm, setNewFirm] = useState<{ firmName: string; ownerName: string; gstin: string; kind?: 'company' } | null>(null);
  useEffect(() => { void server().then(url => { if (!url) void db.staff.toArray().then(setDemo); }); }, []); // the demo only: no server set
  const go = async (p = phone, n = pin) => {
    setErr('');
    if (n.length !== 4 && n.length !== 6) { setErr('Type your 4-digit PIN (owner: 6 digits)'); return; }
    const r = await login(p, n, tenant);
    if (!r) { setErr(t('wrongPin')); setPin(''); return; }
    if ('error' in r) { setErr(r.error); setPin(''); return; }
    if ('choose' in r) { setFirms(r.choose); return; }
    onIn(r.tenantId, r.userId, r.mustChangePin ? r.pinLength ?? 6 : undefined);
  };
  const press = (d: string) => { const n = (pin + d).slice(0, known ?? 6); setPin(n); if (known && n.length === known && phone.length === 10) void go(phone, n); };
  const dots = known ?? Math.min(6, Math.max(4, pin.length));

  if (newFirm) return (
    <div className="login">
      <div className="login-hero"><div className="mark"><Brand /></div><div className="tag" style={{ color: 'var(--on-navy-2)', margin: '6px 0 0' }}>{newFirm.kind === 'company' ? 'Company sign-up' : 'Start your 60-day free trial'}</div></div>
      <div className="stack">
        <div className="field"><label>{newFirm.kind === 'company' ? 'Company name' : 'Firm name'}</label><input value={newFirm.firmName} onChange={e => setNewFirm({ ...newFirm, firmName: e.target.value })} /></div>
        <div className="field"><label>Your name</label><input value={newFirm.ownerName} onChange={e => setNewFirm({ ...newFirm, ownerName: e.target.value })} /></div>
        <div className="field"><label>GSTIN</label><input value={newFirm.gstin} onChange={e => setNewFirm({ ...newFirm, gstin: e.target.value.toUpperCase() })} /></div>
        <div className="field"><label>{t('phone')}</label><input inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} /></div>
        <div className="field"><label>Choose a 6-digit PIN</label><input inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /></div>
        {/* DPDP: the notice before any data is taken; the box is never ticked for the person; AI photo reading is a separate choice */}
        <details className="card"><summary><b>Read the privacy notice</b></summary><Notice /></details>
        <label className="check"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>I have read the privacy notice and agree</span></label>
        <label className="check"><input type="checkbox" checked={aiScan} onChange={e => setAiScan(e.target.checked)} /><span>Turn on AI photo reading of bills (optional, can be changed later)</span></label>
        {err && <div style={{ color: 'var(--bad)' }}>{err}</div>}
        <button className="btn primary big block" disabled={!agree} onClick={async () => { try { setErr(''); const r = await signup({ ...newFirm, phone, pin, consent: { version: PRIVACY_VERSION, optional: { ai_scan: aiScan } } }); onIn(r.tenantId, r.userId); } catch (e) { setErr((e as Error).message); } }}>Start free trial</button>
        <button className="btn ghost block" onClick={() => setNewFirm(null)}>← Log in instead</button>
      </div>
    </div>
  );

  if (firms) return (
    <div className="login">
      <div className="login-hero"><div className="mark"><Brand /></div><div className="tag" style={{ color: 'var(--on-navy-2)', margin: '6px 0 0' }}>{'Which firm?'}</div></div>
      <div className="stack">{firms.map(f => <button key={f.tenantId} className="btn big block" onClick={() => { setTenant(f.tenantId); setFirms(null); void (async () => { const r = await login(phone, pin, f.tenantId); if (r && 'error' in r) setErr(r.error); else if (r && !('choose' in r)) onIn(r.tenantId, r.userId, r.mustChangePin ? r.pinLength ?? 6 : undefined); })(); }}>{f.firm}</button>)}</div>
    </div>
  );

  return (
    <div className="login">
      <div className="login-hero">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="mark"><Brand /></div>
        </div>
        
        <div className="tag" style={{ margin: '10px 0 0' }}>{t('appTagline')}</div>
      </div>
      <label className="eyebrow" htmlFor="login-phone">{t('phone')}</label>
      <input id="login-phone" className="phone" inputMode="numeric" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
      <div className="eyebrow" style={{ marginTop: 16 }}>{t('pin')}</div>
      <div className="pins" aria-label={t('pin')}>{Array.from({ length: dots }, (_, i) => <span key={i} className={pin.length > i ? 'on' : ''} />)}</div>
      <div className="pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button onClick={() => setPin(p => p.slice(0, -1))} aria-label="Delete"><Delete size={24} /></button>
        <button onClick={() => press('0')}>0</button>
        <button className="go" onClick={() => go()} aria-label={t('login')}><ArrowRight size={26} /></button>
      </div>
      {err && <div style={{ color: 'var(--bad)', marginTop: 10, fontWeight: 600 }}>{err}</div>}
      {ENV_SERVER && <button className="btn block" style={{ marginTop: 16 }} onClick={() => setNewFirm({ firmName: '', ownerName: '', gstin: '' })}>New distributor? Start free trial</button>}
      {ENV_SERVER && <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => setNewFirm({ firmName: '', ownerName: '', gstin: '', kind: 'company' })}>A company (brand)? Sign up</button>}
      {demo.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Demo logins — tap one</div>
          <div className="row">{demo.filter(s => s.active).map(s => <button key={s.id} className="btn small" onClick={async () => { const r = await demoLogin(s.id); if (r) onIn(r.tenantId, r.userId); }}>{s.name}</button>)}</div>
          <div className="segmented" style={{ marginTop: 12 }}>
            <button className={sideNow() === 'distributor' ? 'on' : ''} onClick={() => sideNow() !== 'distributor' && switchDemoSide('distributor')}>{'Distributor demo'}</button>
            <button className={sideNow() === 'company' ? 'on' : ''} onClick={() => sideNow() !== 'company' && switchDemoSide('company')}>{'Company demo'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
