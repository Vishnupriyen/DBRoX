import { useEffect, useState } from 'react';
import { Languages, Receipt, FileCheck2, Blocks, Users, Settings as SettingsIcon, Download, RefreshCw, LogOut, Trash2, Printer, X, Truck } from 'lucide-react';
import { ChangeSet, db, getSettings } from '../core/db';
import { getLang, inr, setLang, t } from '../core/i18n';
import { norm } from '../core/match';
import { downloadText } from '../core/readers';
import { ENV_SERVER, syncNow } from '../core/sync';
import { MODULES, type Claim, type Invoice, type ModuleKey, type Role, type Settings, type Staff, type Van } from '../core/types';
import { PrintBill } from './PrintBill';
import { ask, askText, confirmBox, notify } from './dialog';
import { editInvoice } from '../core/pipeline';

type Page = 'menu' | 'modules' | 'settings' | 'staff' | 'bills' | 'claims';

export function More({ role, onLogout, onLang, initial }: { role: Role; onLogout: () => void; onLang: () => void; initial?: 'bills' | 'claims' | 'staff' }) {
  const [page, setPage] = useState<Page>(initial ?? 'menu');
  const boss = role === 'owner' || role === 'office';
  const back = <button className="btn small" style={{ marginBottom: 10 }} onClick={() => setPage('menu')}>← {t('more')}</button>;
  if (page === 'bills' && initial === 'bills') return <Bills canCancel={boss} />;
  if (page === 'claims' && initial === 'claims') return <Claims />;
  if (page === 'staff' && initial === 'staff') return <StaffPage editable={role === 'owner'} />;
  if (page === 'modules') return <>{back}<Modules editable={role === 'owner'} /></>;
  if (page === 'settings') return <>{back}<SettingsPage editable={role === 'owner'} /></>;
  if (page === 'staff') return <>{back}<StaffPage editable={role === 'owner'} /></>;
  if (page === 'bills') return <>{back}<Bills canCancel={boss} /></>;
  if (page === 'claims') return <>{back}<Claims /></>;
  return (
    <div className="list">
      <button className="item" onClick={() => { setLang(getLang() === 'en' ? 'ta' : 'en'); onLang(); }}><Languages /> <span className="grow">தமிழ் / English</span><span className="badge">{getLang() === 'en' ? 'English' : 'தமிழ்'}</span></button>
      {boss && <button className="item" onClick={() => setPage('bills')}><Receipt /> <span className="grow">{t('bills')}</span></button>}
      {boss && <button className="item" onClick={() => setPage('claims')}><FileCheck2 /> <span className="grow">Claims tracker</span></button>}
      {boss && <button className="item" onClick={() => setPage('staff')}><Users /> <span className="grow">Staff & access</span></button>}
      {boss && <button className="item" onClick={() => setPage('settings')}><SettingsIcon /> <span className="grow">{t('settings')}</span></button>}
      {role === 'owner' && <button className="item" onClick={async () => {
        const dump: Record<string, unknown[]> = {};
        for (const tb of db.tables) dump[tb.name] = await tb.toArray();
        downloadText(`DBRoX-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(dump));
      }}><Download /> <span className="grow">Download full backup (all my data)</span></button>}
      <button className="item" onClick={async () => notify('Sync', await syncNow())}><RefreshCw /> <span className="grow">Sync now</span></button>
      <button className="item" onClick={onLogout}><LogOut /> <span className="grow">{t('logout')}</span></button>
      {role === 'owner' && <button className="item" style={{ color: 'var(--red)' }} onClick={async () => {
        if (!await confirmBox('Reset demo data?', 'This deletes all data on this phone and loads the demo again.', 'Reset')) return;
        await db.delete(); localStorage.removeItem('dbrox.session'); location.reload();
      }}><Trash2 /> <span className="grow">Reset demo data on this phone</span></button>}
      {!ENV_SERVER && role === 'owner' && <button className="item" style={{ color: 'var(--ink-3)' }} onClick={() => setPage('modules')}><Blocks /> <span className="grow">Demo only: switch plan (DBRoX side — never shown to a distributor)</span></button>}
      <div className="muted" style={{ textAlign: 'center', marginTop: 10 }}>DBRoX · RoX Proprietary Engine · v0.3</div>
    </div>
  );
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
      <div className="muted" style={{ marginBottom: 6 }}>{on} of {MODULES.length} on — demo switch, DBRoX side only</div>
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
      <input type={type} readOnly={!editable} value={String(s[k] ?? '')} onChange={e => { setSaved(false); setS({ ...s, [k]: type === 'number' ? Number(e.target.value) : e.target.value }); }} /></div>
  );
  return (
    <div className="card">
      <h3>{t('settings')}</h3>
      {f('firmName', 'Firm name')}{f('gstin', 'GSTIN')}{f('address', 'Address (with 6-digit PIN)')}{f('phone', 'Phone')}
      {f('returnApprovalLimit', 'Returns above ₹ need owner OK', 'number')}{f('discountAlertPct', 'Alert when rate is below standard by %', 'number')}
      <div className="field" style={{ marginBottom: 8 }}><label>Bill size</label>
        <select disabled={!editable} value={s.billFormat} onChange={e => setS({ ...s, billFormat: e.target.value as Settings['billFormat'] })}>
          <option value="A5">A5</option><option value="A4">A4</option><option value="dotmatrix">Dot-matrix</option></select></div>
      <h3 style={{ marginTop: 14 }}>Billing & collection</h3>
      {f('billPrefix', 'Bill number prefix (one series for the whole firm, e.g. SMD)')}
      {f('upiId', 'UPI ID shown as QR at collection (e.g. firm@okaxis)')}
      <div className="toggle"><span>Driver takes a second photo of the signed bill / GRN</span><button className={`switch ${s.grnPhoto !== false ? 'on' : ''}`} disabled={!editable} aria-label="GRN photo" onClick={() => setS({ ...s, grnPhoto: s.grnPhoto === false })} /></div>
      <h3 style={{ marginTop: 14 }}>Staff check-in</h3>
      {f('checkInBy', 'Check-in after this time is "late" (HH:MM)')}
      <div className="row" style={{ gap: 8 }}>{f('godownLat', 'Godown latitude', 'number')}{f('godownLng', 'Godown longitude', 'number')}</div>
      <button className="btn small" onClick={async () => { const { getPos } = await import('./Beat'); const p = await getPos(); if (p) setS({ ...s, godownLat: p.lat, godownLng: p.lng }); else void notify('Location', 'Could not read the phone location.'); }}>Use my location now</button>
      {f('serverUrl', 'DBRoX server address (for sync and photo reading)')}
      {editable && <button className="btn primary" onClick={async () => { const cs = new ChangeSet(); cs.put('settings', s, 'settings'); await cs.commit('Settings saved'); setSaved(true); }}>{t('save')}</button>}
      {saved && <span className="muted"> ✓ {t('done')}</span>}
    </div>
  );
}

function VansPage({ editable, staff }: { editable: boolean; staff: Staff[] }) {
  const [vans, setVans] = useState<Van[]>([]);
  const load = () => db.vans.toArray().then(setVans);
  useEffect(() => { load(); }, []);
  const drivers = staff.filter(s => s.role === 'delivery' && s.active);
  return (
    <div className="card">
      <h3>Vans</h3>
      <div className="list">
        {vans.map(v => (
          <div key={v.id} className="item">
            <div className="avatar"><Truck size={18} /></div>
            <div className="grow"><div className="t">{v.name} <span className="muted">{v.number}</span></div><div className="muted">{v.kind} · driver: {staff.find(s => s.id === v.driverId)?.name ?? '—'}</div></div>
            {editable && <select value={v.driverId ?? ''} onChange={async e => { const cs = new ChangeSet(); cs.put('vans', { ...v, driverId: e.target.value || undefined }, 'driver assigned'); const d = drivers.find(x => x.id === e.target.value); if (d) cs.put('staff', { ...d, vanId: v.id }, 'van assigned'); await cs.commit('Van driver'); load(); }}><option value="">no driver</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
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
            <div key={s.id} className="item">
              <div className="avatar">{s.name[0]}</div>
              <div className="grow"><div className="t">{s.name}</div><div className="muted">{s.role} · {s.phone}{s.role !== 'owner' ? ` · ₹${s.salary ?? 0}/mo + ₹${s.batta ?? 0}/day` : ''}</div></div>
              {s.role !== 'owner' && editable && <button className="btn small" onClick={async () => { const sal = await askText(`${s.name}: monthly salary ₹`, String(s.salary ?? ''), 'number'); if (sal === null) return; const bat = await askText('Batta per present day ₹', String(s.batta ?? ''), 'number'); if (bat === null) return; const cs = new ChangeSet(); cs.put('staff', { ...s, salary: Number(sal) || 0, batta: Number(bat) || 0 }, 'salary set'); await cs.commit('Salary set'); load(); }}>Salary</button>}
              {s.role !== 'owner' && editable && (s.active
                ? <button className="btn small danger" onClick={() => setActive(s, false)}>Remove access</button>
                : <button className="btn small" onClick={() => setActive(s, true)}>Restore</button>)}
            </div>
          ))}
        </div>
      </div>
      <VansPage editable={editable} staff={list} />
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
  const [qtys, setQtys] = useState<number[]>([]);
  const load = async () => {
    const shops = new Map((await db.shops.toArray()).map(s => [s.id, s.name]));
    setList((await db.invoices.orderBy('date').reverse().limit(300).toArray()).map(i => ({ ...i, shopName: shops.get(i.shopId) ?? '' })));
  };
  useEffect(() => { load(); }, []);
  const cancel = async (i: Invoice) => {
    const reason = await askText(`Cancel bill ${i.number}? Bills are never deleted — give a reason`);
    if (!reason) return;
    const cs = new ChangeSet();
    cs.put('invoices', { ...i, cancelled: { at: new Date().toISOString(), by: 'owner', reason } }, 'cancel bill');
    const batches = await db.batches.toArray();
    for (const l of i.lines) for (const b of l.batches) { const x = batches.find(y => y.id === b.batchId); if (x) { x.qty += b.qty; cs.put('batches', { ...x }, 'stock back (cancel)'); } }
    await cs.commit('Bill cancelled'); load();
  };
  const shown = list.filter(i => !q || norm(i.number).includes(norm(q)) || norm(i.shopName).includes(norm(q)));
  return (
    <div>
      <div className="field" style={{ marginBottom: 10 }}><input placeholder="Search bill or shop…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" /></div>
      <div className="list">
        {shown.map(i => (
          <div key={i.id} className="item">
            <div className="grow"><div className="t">{i.number} {i.cancelled && <span className="badge bad">Cancelled</span>}</div>
              <div className="s">{i.shopName} · {i.date} · {i.kind} · {i.deliveryStatus}</div></div>
            <span className="amt num">{inr(i.total)}</span>
            {canCancel && !i.cancelled && !i.printedAt && i.deliveryStatus === 'pending' && <button className="btn small" onClick={() => setEditing(i)}>{t('edit')}</button>}
            <button className="btn small" onClick={() => setPrinting(i)} aria-label="Print"><Printer /></button>
            {canCancel && !i.cancelled && <button className="btn small ghost danger" onClick={() => cancel(i)} aria-label="Cancel bill"><X /></button>}
          </div>
        ))}
      </div>
      {printing && <PrintBill invoice={printing} onClose={async () => { if (!printing.printedAt) { const cs = new ChangeSet(); cs.put('invoices', { ...printing, printedAt: new Date().toISOString() }, 'printed'); await cs.commit('Bill printed'); } setPrinting(null); load(); }} />}
      {editing && (
        <div className="sheet-wrap" onClick={() => setEditing(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()} style={{ height: 'auto', maxHeight: '86vh' }}>
            <div className="sheet-head"><b className="grow">{t('edit')} {editing.number}</b><button className="icon-btn" onClick={() => setEditing(null)} aria-label="Close"><X /></button></div>
            <div className="stack" style={{ padding: 14, overflowY: 'auto' }}>
              <div className="muted">Same bill number. Allowed until the bill is printed. Set a line to 0 to remove it.</div>
              {editing.lines.map((l, i) => <div key={i} className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}><span className="grow">{l.name}{l.mrp ? <span className="muted"> · MRP {l.mrp}</span> : null}</span><input type="number" style={{ width: 90 }} value={qtys[i] ?? l.qty} onChange={e => setQtys(q => { const n = [...editing.lines.map((x, k) => q[k] ?? x.qty)]; n[i] = Math.max(0, Number(e.target.value)); return n; })} aria-label={`Quantity ${l.name}`} /></div>)}
              <button className="btn primary big block" onClick={async () => { try { await editInvoice(editing.id, editing.lines.map((l, i) => qtys[i] ?? l.qty)); setEditing(null); setQtys([]); load(); } catch (e) { void notify('Edit', (e as Error).message); } }}>Save bill</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Claims() {
  const [list, setList] = useState<(Claim & { company: string })[]>([]);
  const load = async () => {
    const cos = new Map((await db.companies.toArray()).map(c => [c.id, c.name]));
    setList((await db.claims.toArray()).sort((a, b) => b.month.localeCompare(a.month)).map(c => ({ ...c, company: cos.get(c.companyId) ?? '' })));
  };
  useEffect(() => { load(); }, []);
  const set = async (c: Claim, status: Claim['status']) => {
    let received = c.received;
    if (status === 'received') received = Number((await askText('Amount received ₹', String(c.amount), 'number')) ?? c.amount);
    const cs = new ChangeSet(); cs.put('claims', { ...c, status, received }, `claim ${status}`); await cs.commit('Claim status'); load();
  };
  const pending = list.filter(c => c.status !== 'received' && c.status !== 'rejected').reduce((a, c) => a + c.amount, 0);
  return (
    <div className="card">
      <h3>Claims tracker</h3>
      <div className="muted" style={{ marginBottom: 8 }}>Companies owe you {inr(pending)}. Say "claim file" in chat to build this month's claim.</div>
      <div className="list">
        {list.map(c => (
          <div key={c.id} className="item">
            <div className="grow"><div className="t">{c.company} · {c.month}</div><div className="muted">{inr(c.amount)}{c.received != null ? ` · received ${inr(c.received)}` : ''}</div></div>
            <select value={c.status} onChange={e => set(c, e.target.value as Claim['status'])}>
              {['draft', 'submitted', 'approved', 'rejected', 'received'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        ))}
        {!list.length && <div className="muted">{t('noItems')}</div>}
      </div>
    </div>
  );
}
