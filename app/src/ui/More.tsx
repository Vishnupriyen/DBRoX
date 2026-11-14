import { useEffect, useState } from 'react';
import { Blocks, Download, RefreshCw, LogOut, Trash2, Printer, X, Truck, Link2, Repeat, ShieldCheck, ShoppingBag, Store, Target, Route, ReceiptText, ClipboardList, PackageCheck, Map as MapIcon, CircleCheck, History, FileText, CarFront, Calculator, HandCoins, Wallet, QrCode, Landmark, ReceiptIndianRupee, TrendingUp, ArrowLeftRight, Percent, ChartColumn, Moon, Boxes, ShoppingCart, PackageX, Hourglass, BadgePercent, ChartBar, Users, CalendarCheck, IndianRupee, Settings2, Settings as SettingsIcon, Sparkles, CreditCard, Rocket, ChevronRight, FolderOpen } from 'lucide-react';
import { MyFilesPage } from './MyFiles';
import type { LucideIcon } from 'lucide-react';
import { TesraxReport } from './TesraxReport';
import { CompanyLinks } from './CompanyLinks';
import { SIDE_KEY } from '../core/db';
import { ChangeSet, db, getSettings, today, thisMonth } from '../core/db';
import { inr, t, showDate } from '../core/i18n';
import { norm } from '../core/match';
import { downloadText } from '../core/readers';
import { api, ENV_SERVER, syncNow, weakPin, WEAK_PIN_MSG } from '../core/sync';
import { addClaimLine, claimable, decisionsFor, dropClaimLine, openLines, sendClaim } from '../core/claims';
import { billChangeBlock } from '../core/gst';
import { MODULES, type Claim, type ClaimDecision, type ClaimEntry, type Invoice, type ModuleKey, type Role, type Settings, type Staff, type Van } from '../core/types';
import { PrintBill } from './PrintBill';
import { ask, askText, confirmBox, notify } from './dialog';
import { BillEditor } from './BillEditor';
import { cancelInvoice } from '../core/pipeline';
import { errorLog } from './Safety';

type Page = 'menu' | 'modules' | 'settings' | 'staff' | 'bills' | 'claims' | 'links' | 'tesrax' | 'myfiles';

// The Menu (was "More", 12 Nov 2026; cards 14 Nov 2026): every screen for this role, in the same six groups as Home (Sales, Bill,
// Delivery, Accountant, Stock, Payroll) + Settings; Business Boost is its own gold card on top. Each item may need its own module.
type MenuItem = { page: string; label: string; icon: LucideIcon; owner?: boolean; mod?: ModuleKey };
const MENU: { group: string; icon: LucideIcon; mod?: ModuleKey; items: MenuItem[] }[] = [
  { group: 'Sales', icon: ShoppingBag, mod: 'sales', items: [{ page: 'newshops', label: 'New shops', icon: Store }, { page: 'targets', label: 'Targets', icon: Target }, { page: 'beat', label: 'Beats', icon: Route }] },
  { group: 'Bill', icon: ReceiptText, mod: 'bill', items: [{ page: 'orders-received', label: 'Orders', icon: ClipboardList }, { page: 'verify', label: 'Verify picked', icon: PackageCheck }, { page: 'billed', label: 'Bills', icon: ReceiptText }] },
  { group: 'Delivery', icon: Truck, mod: 'delivery', items: [{ page: 'plan', label: 'Plan route', icon: MapIcon }, { page: 'live', label: 'Live vans', icon: Truck, owner: true }, { page: 'status', label: 'Status', icon: CircleCheck }, { page: 'trips', label: 'Trips', icon: History }, { page: 'print', label: 'Load sheet', icon: FileText }, { page: 'vans', label: 'Vans', icon: CarFront, owner: true }] },
  { group: 'Accountant', icon: Calculator, items: [
    { page: 'outstanding', label: 'Outstanding', icon: HandCoins, mod: 'collection' }, { page: 'cash', label: 'Staff cash', icon: Wallet, owner: true, mod: 'collection' }, { page: 'cheques', label: 'Cheques & UPI', icon: QrCode, mod: 'collection' },
    { page: 'bank', label: 'Bank', icon: Landmark, mod: 'accountant' }, { page: 'expenses', label: 'Expenses', icon: ReceiptIndianRupee, mod: 'accountant' }, { page: 'pnl', label: 'P&L', icon: TrendingUp, owner: true, mod: 'accountant' },
    { page: 'cashflow', label: 'Cash flow', icon: ArrowLeftRight, owner: true, mod: 'accountant' }, { page: 'gst', label: 'GST', icon: Percent, mod: 'gst' }, { page: 'reports', label: 'Reports', icon: ChartColumn, mod: 'accountant' },
    { page: 'export', label: 'Export', icon: Download, mod: 'accountant' }, { page: 'dayclose', label: 'Day close', icon: Moon, owner: true, mod: 'bill' }] },
  { group: 'Stock', icon: Boxes, mod: 'inventory', items: [{ page: 'stock', label: 'Stock', icon: Boxes }, { page: 'stockin', label: 'Purchases', icon: ShoppingCart }, { page: 'damages', label: 'Damages', icon: PackageX }, { page: 'ageing', label: 'Ageing', icon: Hourglass }, { page: 'claims', label: 'Claims', icon: BadgePercent }, { page: 'stock-reports', label: 'Reports', icon: ChartBar }] },
  { group: 'Payroll', icon: Users, mod: 'payroll', items: [{ page: 'today', label: 'Today', icon: CalendarCheck }, { page: 'salary', label: 'Salary', icon: IndianRupee, owner: true }, { page: 'staff', label: 'Staff', icon: Users }] },
  { group: 'Settings', icon: Settings2, items: [{ page: 'settings', label: 'Settings', icon: SettingsIcon }, { page: 'links', label: 'Company links', icon: Link2 }, { page: 'tesrax', label: 'TESRAX report', icon: Sparkles, owner: true }, { page: 'billing', label: 'Plan & billing', icon: CreditCard, owner: true }] },
];

export function More({ role, onLogout, initial, onPlan, go }: { role: Role; onLogout: () => void; initial?: 'bills' | 'claims' | 'staff' | 'settings' | 'links' | 'tesrax'; onPlan?: () => void; go?: (p: string) => void }) {
  const [mods, setMods] = useState<Settings['modules'] | null>(null);
  useEffect(() => { void getSettings().then(s => setMods(s.modules)); }, []);
  const [page, setPage] = useState<Page>(initial ?? 'menu');
  const boss = role === 'owner' || role === 'office';
  // the app's one back (header arrow or the phone's back button) steps from a More page to the More menu
  useEffect(() => {
    const onBack = (e: Event) => { if (page !== 'menu') { e.preventDefault(); setPage('menu'); } };
    window.addEventListener('hanubix:back', onBack);
    return () => window.removeEventListener('hanubix:back', onBack);
  }, [page]);
  const back = null;
  if (page === 'bills' && initial === 'bills') return <Bills canCancel={boss} />;
  if (page === 'claims' && initial === 'claims') return <Claims />;
  if (page === 'staff' && initial === 'staff') return <StaffPage editable={role === 'owner'} />;
  if (page === 'modules') return <>{back}<Modules editable={role === 'owner'} /></>;
  if (page === 'settings') return <>{back}<SettingsPage editable={role === 'owner'} /></>;
  if (page === 'staff') return <>{back}<StaffPage editable={role === 'owner'} /></>;
  if (page === 'bills') return <>{back}<Bills canCancel={boss} /></>;
  if (page === 'claims') return <>{back}<Claims /></>;
  if (page === 'links') return <>{back}<CompanyLinks editable={role === 'owner'} /></>;
  if (page === 'tesrax') return <>{back}<TesraxReport /></>;
  if (page === 'myfiles') return <MyFilesPage />;
  const open = (p: string) => { if (p === 'billing') onPlan?.(); else if (go) go(p); else if (['bills', 'claims', 'staff', 'settings', 'links', 'tesrax'].includes(p)) setPage(p as Page); };
  return (
    <div className="stack menu">
      {boss && <button className="menu-boost" onClick={() => open('boost')}><span className="menu-boost-ic"><Rocket /></span><span className="grow"><b>Business Boost</b><small>Offers and services for your business</small></span><ChevronRight className="menu-boost-go" /></button>}
      {boss && MENU.filter(g => !g.mod || !mods || mods[g.mod] !== false).map(g => {
        const items = g.items.filter(i => (!i.owner || role === 'owner') && (!i.mod || !mods || mods[i.mod] !== false));
        return items.length ? <section key={g.group} className="menu-card"><h3 className="menu-head"><span className="menu-head-ic"><g.icon /></span>{g.group}</h3>
          <div className="menu-grid">{items.map(i => <button key={i.page} className="menu-chip" onClick={() => open(i.page)}><span className="menu-ic"><i.icon /></span><span className="menu-l">{i.label}</span></button>)}</div></section> : null;
      })}
      <section><h3 className="menu-grp">{'App'}</h3>
    <div className="list">
      {role === 'owner' && <button className="item" onClick={async () => {
        const dump: Record<string, unknown[]> = {};
        // the phone's own security records (login token, PIN hashes) never go into a file
        for (const tb of db.tables) dump[tb.name] = tb.name === 'meta' ? (await tb.toArray()).filter(r => !/^(auth\.|pinv:|pinFails)/.test(String((r as { key: string }).key))) : await tb.toArray();
        dump.errorLog = errorLog(); // what went wrong on this phone, for support
        downloadText(`Hanubix-backup-${today()}.json`, JSON.stringify(dump));
      }}><Download /> <span className="grow">Download full backup (all my data)</span></button>}
      <button className="item" onClick={() => setPage('myfiles')}><FolderOpen /> <span className="grow">My files</span></button>
      <button className="item" onClick={async () => notify('Sync', await syncNow())}><RefreshCw /> <span className="grow">Sync now</span></button>
      {go && <button className="item" onClick={() => go('privacy')}><ShieldCheck /> <span className="grow">Privacy & security</span></button>}
      <button className="item" onClick={onLogout}><LogOut /> <span className="grow">{t('logout')}</span></button>
      {role === 'owner' && <button className="item" style={{ color: 'var(--red)' }} onClick={async () => {
        if (!await confirmBox('Reset demo data?', 'This deletes all data on this phone and loads the demo again.', 'Reset')) return;
        await db.delete(); localStorage.removeItem('dbrox.session'); location.reload();
      }}><Trash2 /> <span className="grow">Reset demo data on this phone</span></button>}
      {!ENV_SERVER && <button className="item" onClick={() => switchDemoSide('company')}><Repeat /> <span className="grow">Demo: open the company side</span></button>}
      {!ENV_SERVER && role === 'owner' && <button className="item" style={{ color: 'var(--ink-3)' }} onClick={() => setPage('modules')}><Blocks /> <span className="grow">Demo only: switch plan (Hanubix side — never shown to a distributor)</span></button>}
    </div></section>
      <div className="muted" style={{ textAlign: 'center', marginTop: 4 }}>Hanubix v0.8</div>
    </div>
  );
}

/** demo only: the same phone opens the other side (company ⇄ distributor); each side keeps its own data */
export function switchDemoSide(side: 'company' | 'distributor') {
  try { localStorage.setItem(SIDE_KEY, side); localStorage.removeItem('dbrox.session'); } catch { /* private window */ }
  location.reload();
}

function Modules({ editable }: { editable: boolean }) {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { getSettings().then(setS); }, []);
  if (!s) return null;
  const toggle = async (k: ModuleKey) => {
    const next = { ...s, modules: { ...s.modules, [k]: !s.modules[k] } };
    const cs = new ChangeSet(); cs.put('settings', next, `module ${k}`); await cs.commit('Modules changed'); setS(next);
  };
  const on = Object.values(s.modules).filter(Boolean).length;
  return (
    <div className="card">
      <h3>{t('modules')}</h3>
      <div className="muted" style={{ marginBottom: 6 }}>{on} of {MODULES.length} on — demo switch, Hanubix side only</div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn small" onClick={async () => { const next = { ...s, modules: Object.fromEntries(MODULES.map(m => [m.key, true])) as Settings['modules'] }; const cs = new ChangeSet(); cs.put('settings', next, 'all modules'); await cs.commit('Plan'); setS(next); }}>All modules</button>
        <button className="btn small" onClick={async () => { const next = { ...s, modules: Object.fromEntries(MODULES.map(m => [m.key, m.key === 'delivery' || m.key === 'collection'])) as Settings['modules'] }; const cs = new ChangeSet(); cs.put('settings', next, 'delivery+collection'); await cs.commit('Plan'); setS(next); }}>Delivery + Collection only</button>
      </div>
      {MODULES.map(m => (
        <div key={m.key} className="toggle">
          <span>{m.name}</span>
          <button className={`switch ${s.modules[m.key] ? 'on' : ''}`} disabled={!editable} aria-label={m.name} onClick={() => toggle(m.key)} />
        </div>
      ))}
    </div>
  );
}

function SettingsPage({ editable }: { editable: boolean }) {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { getSettings().then(setS); }, []);
  if (!s) return null;
  const f = (k: keyof Settings, label: string, type = 'text') => (
    <div className="field" style={{ marginBottom: 8 }}><label>{label}</label>
      <input type={type} readOnly={!editable} value={String(s[k] ?? '')} onChange={e => { setSaved(false); setS({ ...s, [k]: type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value }); }} /></div>
  );
  return (
    <div className="card">
      <h3>{t('settings')}</h3>
      {f('firmName', 'Firm name')}{f('gstin', 'GSTIN')}{f('address', 'Address (with 6-digit PIN)')}{f('phone', 'Phone')}
      {f('returnApprovalLimit', 'Returns above ₹ need owner OK', 'number')}{f('discountAlertPct', 'Alert when rate is below standard by %', 'number')}
      {f('writeOffLimit', 'Damage / stock count write-offs above ₹ need owner OK (500 if empty)', 'number')}
      <div className="field" style={{ marginBottom: 8 }}><label>Bill size</label>
        <select disabled={!editable} value={s.billFormat} onChange={e => setS({ ...s, billFormat: e.target.value as Settings['billFormat'] })}>
          <option value="A5">A5</option><option value="A4">A4</option><option value="dotmatrix">Dot-matrix</option></select></div>
      <h3 style={{ marginTop: 14 }}>Billing & collection</h3>
      {f('billPrefix', 'Bill number prefix (one series for the whole firm, e.g. SMD)')}
      {f('upiId', 'UPI ID shown as QR at collection (e.g. firm@okaxis)')}
      <div className="toggle"><span>Driver takes a second photo of the signed bill / GRN</span><button className={`switch ${s.grnPhoto !== false ? 'on' : ''}`} disabled={!editable} aria-label="GRN photo" onClick={() => setS({ ...s, grnPhoto: s.grnPhoto === false })} /></div>
      <h3 style={{ marginTop: 14 }}>Staff check-in</h3>
      {f('checkInBy', 'Check-in after this time is "late" (HH:MM)')}
      {f('paidLeaves', 'Paid leave days a month (2 if empty)', 'number')}
      <div className="row" style={{ gap: 8 }}>{f('godownLat', 'Godown latitude', 'number')}{f('godownLng', 'Godown longitude', 'number')}</div>
      <button className="btn small" onClick={async () => { const { getPos } = await import('./Beat'); const p = await getPos(); if (p) setS({ ...s, godownLat: p.lat, godownLng: p.lng }); else void notify('Location', 'Could not read the phone location.'); }}>Use my location now</button>
      {f('serverUrl', 'Hanubix server address (for sync and photo reading)')}
      {editable && <button className="btn primary" onClick={async () => { const cs = new ChangeSet(); cs.put('settings', s, 'settings'); await cs.commit('Settings saved'); setSaved(true); }}>{t('save')}</button>}
      {saved && <span className="muted"> ✓ {t('done')}</span>}
    </div>
  );
}

export function VansPage({ editable, staff: staffIn }: { editable: boolean; staff?: Staff[] }) {
  const [vans, setVans] = useState<Van[]>([]);
  const [staffLoaded, setStaffLoaded] = useState<Staff[]>([]);
  const staff = staffIn ?? staffLoaded;
  const load = () => { db.vans.toArray().then(setVans); if (!staffIn) db.staff.toArray().then(setStaffLoaded); };
  useEffect(() => { load(); }, []);
  const drivers = staff.filter(s => s.role === 'delivery' && s.active);
  return (
    <div className="card">
      <h3>Vans</h3>
      <div className="list">
        {vans.map(v => (
          <div key={v.id} className="item stacked">
            <div className="row" style={{ flexWrap: 'nowrap', width: '100%' }}>
            <div className="avatar"><Truck size={18} /></div>
            <div className="grow"><div className="t">{v.name} <span className="muted">{v.number}</span></div><div className="muted">{v.kind === 'own' ? 'Own' : 'Hired'} · driver: {staff.find(s => s.id === v.driverId)?.name ?? '—'}</div></div>
            </div>
            {editable && <select className="full" value={v.driverId ?? ''} onChange={async e => { const cs = new ChangeSet(); cs.put('vans', { ...v, driverId: e.target.value || undefined }, 'driver assigned'); const d = drivers.find(x => x.id === e.target.value); if (d) cs.put('staff', { ...d, vanId: v.id }, 'van assigned'); await cs.commit('Van driver'); load(); }}><option value="">no driver</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
          </div>
        ))}
      </div>
      {editable && <button className="btn small" style={{ marginTop: 8 }} onClick={async () => { const name = await askText('Van name (e.g. Van 2)'); if (!name) return; const number = await askText('Registration number', 'TN 31 '); if (number === null) return; const kind = (await ask('Own or hired?', { choices: [{ label: 'Own', value: 'own' }, { label: 'Hired', value: 'hired' }] })) as Van['kind'] || 'own'; const cs = new ChangeSet(); cs.put<Van>('vans', { name, number, kind }, 'van added'); await cs.commit('Van added'); load(); }}>+ Add van</button>}
    </div>
  );
}

function StaffPage({ editable }: { editable: boolean }) {
  const [list, setList] = useState<Staff[]>([]);
  const [form, setForm] = useState({ name: '', phone: '', role: 'salesman' as Role, pin: '' });
  const load = () => db.staff.toArray().then(setList);
  useEffect(() => { load(); }, []);
  const add = async () => {
    if (!form.name || !/^\d{10}$/.test(form.phone) || !/^\d{4}$/.test(form.pin)) { void notify('Name, 10-digit phone and 4-digit PIN needed'); return; }
    if (list.some(s => s.phone === form.phone)) { void notify('This phone number is already used'); return; }
    if (weakPin(form.pin)) { void notify(WEAK_PIN_MSG); return; }
    const cs = new ChangeSet(); cs.put<Staff>('staff', { ...form, active: true }, 'add staff'); await cs.commit('Staff added');
    setForm({ name: '', phone: '', role: 'salesman', pin: '' }); load();
  };
  const setActive = async (s: Staff, active: boolean) => {
    if (!active && !await confirmBox(`Remove ${s.name}'s access?`, 'Their phone is locked out at the next sync. Their shops, orders and cash stay in the app.', 'Remove access')) return;
    const cs = new ChangeSet(); cs.put('staff', { ...s, active }, active ? 'restore access' : 'remove access'); await cs.commit(active ? 'Access restored' : 'Access removed'); load();
  };
  return (
    <div>
      <div className="card">
        <h3>Staff & access</h3>
        <div className="list">
          {list.map(s => (
            <div key={s.id} className="item stacked">
              <div className="row" style={{ flexWrap: 'nowrap', width: '100%' }}>
              <div className="avatar">{s.name[0]}</div>
              <div className="grow"><div className="t">{s.name}</div><div className="muted">{s.role[0].toUpperCase() + s.role.slice(1)} · {s.phone}{s.role !== 'owner' ? ` · ${s.salary ? `${inr(s.salary)} a month` : 'salary not set'}${s.batta ? ` + ${inr(s.batta)} a day` : ''}` : ''}</div></div>
              </div>
              {s.role !== 'owner' && editable && <div className="row actions">
              <button className="btn small" onClick={async () => { const sal = await askText(`${s.name}: monthly salary ₹`, String(s.salary ?? ''), 'number'); if (sal === null) return; const bat = await askText('Batta per present day ₹', String(s.batta ?? ''), 'number'); if (bat === null) return; const cs = new ChangeSet(); cs.put('staff', { ...s, salary: Number(sal) || 0, batta: Number(bat) || 0 }, 'salary set'); await cs.commit('Salary set'); load(); }}>Salary</button>
              {s.active && <button className="btn small" onClick={async () => {
                if (!await confirmBox(`Lock ${s.name}'s phone?`, 'Their phone logs out at once and asks for the PIN online. Use it when a phone is lost.', 'Lock phone')) return;
                try { await api('/v1/staff/lock', { staffId: s.id }); await notify('Phone locked', `${s.name} must log in again.`); } catch (e) { await notify('Not done', (e as Error).message); }
              }}>Lock phone</button>}
              {(s.active
                ? <button className="btn small danger" onClick={() => setActive(s, false)}>Remove access</button>
                : <button className="btn small" onClick={() => setActive(s, true)}>Restore</button>)}
              </div>}
            </div>
          ))}
        </div>
      </div>
      {editable && (
        <div className="card">
          <h3>Add staff</h3>
          <div className="fields">
            <div className="field"><label>Name</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>{t('phone')}</label><input inputMode="numeric" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></div>
            <div className="field"><label>Role</label><select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>
              {(['office', 'salesman', 'godown', 'delivery'] as Role[]).map(r => <option key={r} value={r}>{r}</option>)}</select></div>
            <div className="field"><label>{t('pin')}</label><input inputMode="numeric" value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></div>
          </div>
          <button className="btn primary" onClick={add}>{t('save')}</button>
        </div>
      )}
    </div>
  );
}

function Bills({ canCancel }: { canCancel: boolean }) {
  const [list, setList] = useState<(Invoice & { shopName: string })[]>([]);
  const [q, setQ] = useState('');
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const load = async () => {
    const shops = new Map((await db.shops.toArray()).map(s => [s.id, s.name]));
    setList((await db.invoices.orderBy('date').reverse().limit(300).toArray()).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)).map(i => ({ ...i, shopName: shops.get(i.shopId) ?? '' }))); // newest first, then by bill number
  };
  useEffect(() => { load(); }, []);
  const cancel = async (i: Invoice) => {
    const reason = await askText(`Cancel bill ${i.number}? Bills are never deleted — give a reason`);
    if (!reason) return;
    try { await cancelInvoice(i.id, reason); } catch (e) { await notify('Could not cancel', (e as Error).message); }
    load();
  };
  const shown = list.filter(i => !q || norm(i.number).includes(norm(q)) || norm(i.shopName).includes(norm(q)));
  return (
    <div>
      <div className="field" style={{ marginBottom: 10 }}><input placeholder="Search bill or shop…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" /></div>
      <div className="list">
        {shown.map(i => (
          <div key={i.id} className="item stacked">
            <div className="row" style={{ flexWrap: 'nowrap', width: '100%' }}>
              <div className="grow"><div className="t" style={{ whiteSpace: 'nowrap' }}>{i.number} {i.cancelled && <span className="badge bad">Cancelled</span>}</div>
                <div className="s">{i.shopName} · {showDate(i.date)} · {i.kind} · {i.deliveryStatus}</div></div>
              <span className="amt num">{inr(i.total)}</span>
            </div>
            <div className="row actions">
            {canCancel && !billChangeBlock(i, 'edit', today()) && <button className="btn small" onClick={() => setEditing(i)}>{t('edit')}</button>}
            <button className="btn small" onClick={() => setPrinting(i)} aria-label="Print"><Printer /></button>
            {canCancel && !billChangeBlock(i, 'cancel', today()) && <button className="btn small ghost danger" onClick={() => cancel(i)} aria-label="Cancel bill"><X /> Cancel</button>}
            </div>
          </div>
        ))}
      </div>
      {printing && <PrintBill invoice={printing} onClose={() => { setPrinting(null); load(); }} />}
      {editing && <BillEditor invoice={editing} onClose={saved => { setEditing(null); if (saved) load(); }} />}
    </div>
  );
}

function Claims() {
  const [list, setList] = useState<(Claim & { company: string; decision?: ClaimDecision })[]>([]);
  const [linked, setLinked] = useState<{ id: string; name: string; open: number; amount: number }[]>([]);
  const [lines, setLines] = useState<(ClaimEntry & { company: string })[]>([]);
  const load = async () => {
    const all = await db.companies.toArray();
    // this month's claim lines that are not sent yet: the owner sees each one and can drop it before sending
    const cn = new Map(all.map(c => [c.id, c.name]));
    const open: (ClaimEntry & { company: string })[] = [];
    for (const c of all) for (const e of await openLines(c.id, thisMonth())) open.push({ ...e, company: cn.get(c.id) ?? '' });
    setLines(open);
    const cos = new Map(all.map(c => [c.id, c.name]));
    const claims = (await db.claims.toArray()).sort((a, b) => b.month.localeCompare(a.month));
    const dec = await decisionsFor(claims.map(c => c.id));
    setList(claims.map(c => ({ ...c, company: cos.get(c.companyId) ?? '', decision: dec.get(c.id) })));
    const ls = [];
    for (const c of all.filter(x => x.link?.status === 'linked')) { const o = await openLines(c.id, thisMonth()); ls.push({ id: c.id, name: c.name, open: o.length, amount: o.reduce((a, e) => a + e.amount, 0) }); }
    setLinked(ls);
  };
  useEffect(() => { load(); }, []);
  const set = async (c: Claim, status: Claim['status']) => {
    let received = c.received;
    if (status === 'received') received = Number((await askText('Amount received ₹', String(c.amount), 'number')) ?? c.amount);
    const cs = new ChangeSet(); cs.put('claims', { ...c, status, received }, `claim ${status}`); await cs.commit('Claim status'); load();
  };
  const pending = list.filter(c => c.status !== 'received' && c.status !== 'rejected' && c.decision?.status !== 'rejected').reduce((a, c) => a + (c.decision?.status === 'approved' ? c.decision.amount : c.amount), 0);
  const tryIt = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { await notify('Not done', (e as Error).message); } };
  return (
    <div className="card">
      <h3>Claims tracker</h3>
      <div className="muted" style={{ marginBottom: 8 }}>Companies owe you {inr(pending)}. Say "claim file" in chat to build this month's claim file.</div>
      {linked.map(l => (
        <div key={l.id} className="item">
          <Link2 /><div className="grow"><div className="t">{l.name}</div><div className="s">{l.open ? `${l.open} new claim lines this month · ${inr(l.amount)}` : 'Nothing new to claim this month'}</div></div>
          {l.open > 0 && <button className="btn small primary" onClick={() => tryIt(async () => { if (await confirmBox(`Send ${inr(l.amount)} to ${l.name}?`, 'They check every line and send back a credit note.', 'Send')) { await sendClaim(l.id, thisMonth()); } })}>Send</button>}
          <button className="btn small" onClick={() => tryIt(async () => {
            const kind = (await ask('What kind of claim?', { choices: [{ label: 'Rate difference', value: 'rate_diff' }, { label: 'Salesman salary (DSR)', value: 'dsr' }, { label: 'Other', value: 'damage' }] })) as ClaimEntry['kind'] | null; if (!kind) return;
            const amount = Number(await askText('Amount ₹', '', 'number')); if (!amount) return;
            const note = await askText('What is it for?'); if (!note) return;
            const ref = kind === 'rate_diff' ? await askText('Company bill number it is about') : undefined; if (ref === null) return;
            await addClaimLine({ companyId: l.id, kind, amount, note, refNumber: ref || undefined });
          })}>+ Line</button>
        </div>
      ))}
      {lines.length > 0 && <div className="sechead"><h3>{'Claim lines this month'} · {inr(lines.reduce((a, e) => a + e.amount, 0))}</h3></div>}
      {lines.length > 0 && <div className="list">
        {lines.slice(0, 50).map(e => (
          <div key={e.id} className="item">
            <div className="grow"><div className="t">{e.company} · {e.kind}</div><div className="s">{e.note || ''} · {e.qty} pcs</div></div>
            <span className="amt num">{inr(e.amount)}</span>
            <button className="btn small ghost danger" aria-label="Drop claim line" onClick={() => tryIt(async () => { const why = await askText('Drop this line from the claim? Say why', 'Company does not pay this'); if (why) await dropClaimLine(e.id, why); })}><X /></button>
          </div>
        ))}
      </div>}
      <button className="btn small" style={{ margin: '8px 0' }} onClick={async () => {
        const cos = await db.companies.toArray(); if (!cos.length) return;
        const companyId = (await ask('Which company?', { choices: cos.map(c => ({ label: c.name, value: c.id })) })) as string; if (!companyId) return;
        const month = await askText('Month (YYYY-MM)', thisMonth()); if (!month) return;
        const open = (await db.claimEntries.toArray()).filter(e => e.companyId === companyId && e.month === month && claimable(e));
        const auto = open.reduce((a, e) => a + e.amount, 0);
        const amt = Number(await askText(`Claim amount ₹ (${open.length} entries this month total ${inr(auto)})`, String(auto || ''), 'number')); if (!amt) return;
        const note = await askText('Note (scheme / damage / display / other)'); if (note === null) return;
        const cs = new ChangeSet(); cs.put<Claim>('claims', { companyId, month, amount: amt, status: 'draft', note }, 'claim created'); await cs.commit('Claim created'); load();
      }}>+ Record a claim made outside Hanubix</button>
      <div className="list">
        {list.map(c => (
          <div key={c.id} className="item">
            <div className="grow"><div className="t">{c.company} · {c.month}</div><div className="muted">{inr(c.amount)}{c.received != null ? ` · received ${inr(c.received)}` : ''}{c.decision ? (c.decision.status === 'approved' ? ` · approved ${inr(c.decision.amount)} · credit note ${c.decision.creditNoteNo}` : ` · rejected: ${c.decision.note}`) : c.lineIds ? ' · sent, waiting for the company' : ''}</div></div>
            {!c.lineIds && <select value={c.status} onChange={e => set(c, e.target.value as Claim['status'])}>
              {['draft', 'submitted', 'approved', 'rejected', 'received'].map(s => <option key={s}>{s}</option>)}
            </select>}
          </div>
        ))}
        {!list.length && <div className="muted">{t('noItems')}</div>}
      </div>
    </div>
  );
}
