import { useEffect, useState } from 'react';
import { ChangeSet, db, getSettings } from '../core/db';
import { getLang, inr, setLang, t } from '../core/i18n';
import { norm } from '../core/match';
import { downloadText } from '../core/readers';
import { syncNow } from '../core/sync';
import { MODULES, type Claim, type Invoice, type ModuleKey, type Role, type Settings, type Staff } from '../core/types';
import { PrintBill } from './PrintBill';

type Page = 'menu' | 'modules' | 'settings' | 'staff' | 'bills' | 'claims';

export function More({ role, onLogout, onLang }: { role: Role; onLogout: () => void; onLang: () => void }) {
  const [page, setPage] = useState<Page>('menu');
  const boss = role === 'owner' || role === 'office';
  const back = <button className="btn small" style={{ marginBottom: 10 }} onClick={() => setPage('menu')}>← {t('more')}</button>;
  if (page === 'modules') return <>{back}<Modules editable={role === 'owner'} /></>;
  if (page === 'settings') return <>{back}<SettingsPage editable={role === 'owner'} /></>;
  if (page === 'staff') return <>{back}<StaffPage editable={role === 'owner'} /></>;
  if (page === 'bills') return <>{back}<Bills canCancel={boss} /></>;
  if (page === 'claims') return <>{back}<Claims /></>;
  return (
    <div className="list">
      <button className="item" onClick={() => { setLang(getLang() === 'en' ? 'ta' : 'en'); onLang(); }}>🌐 <span className="grow">தமிழ் / English</span><span className="badge">{getLang() === 'en' ? 'English' : 'தமிழ்'}</span></button>
      {boss && <button className="item" onClick={() => setPage('bills')}>🧾 <span className="grow">{t('bills')}</span></button>}
      {boss && <button className="item" onClick={() => setPage('claims')}>📑 <span className="grow">Claims tracker</span></button>}
      {boss && <button className="item" onClick={() => setPage('modules')}>🧩 <span className="grow">{t('modules')}</span></button>}
      {boss && <button className="item" onClick={() => setPage('staff')}>👥 <span className="grow">Staff & access</span></button>}
      {boss && <button className="item" onClick={() => setPage('settings')}>⚙️ <span className="grow">{t('settings')}</span></button>}
      {role === 'owner' && <button className="item" onClick={async () => {
        const dump: Record<string, unknown[]> = {};
        for (const tb of db.tables) dump[tb.name] = await tb.toArray();
        downloadText(`DBRoX-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(dump));
      }}>💾 <span className="grow">Download full backup (all my data)</span></button>}
      <button className="item" onClick={async () => alert(await syncNow())}>🔄 <span className="grow">Sync now</span></button>
      <button className="item" onClick={onLogout}>🚪 <span className="grow">{t('logout')}</span></button>
      {role === 'owner' && <button className="item" style={{ color: 'var(--red)' }} onClick={async () => {
        if (!confirm('Delete ALL data on this phone and load the demo again?')) return;
        await db.delete(); localStorage.removeItem('dbrox.session'); location.reload();
      }}>🗑 <span className="grow">Reset demo data on this phone</span></button>}
      <div className="muted" style={{ textAlign: 'center', marginTop: 10 }}>DBRoX · RoX Proprietary Engine · v0.1</div>
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
  const price = on <= 1 ? 249 : on <= 3 ? 599 : 999;
  return (
    <div className="card">
      <h3>{t('modules')}</h3>
      <div className="muted" style={{ marginBottom: 6 }}>{on} on · plan ₹{price}/month (proposed pricing)</div>
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
      {f('serverUrl', 'DBRoX server address (for sync and photo reading)')}
      {editable && <button className="btn primary" onClick={async () => { const cs = new ChangeSet(); cs.put('settings', s, 'settings'); await cs.commit('Settings saved'); setSaved(true); }}>{t('save')}</button>}
      {saved && <span className="muted"> ✓ {t('done')}</span>}
    </div>
  );
}

function StaffPage({ editable }: { editable: boolean }) {
  const [list, setList] = useState<Staff[]>([]);
  const [form, setForm] = useState({ name: '', phone: '', role: 'salesman' as Role, pin: '' });
  const load = () => db.staff.toArray().then(setList);
  useEffect(() => { load(); }, []);
  const add = async () => {
    if (!form.name || !/^\d{10}$/.test(form.phone) || !/^\d{4}$/.test(form.pin)) { alert('Name, 10-digit phone and 4-digit PIN needed'); return; }
    if (list.some(s => s.phone === form.phone)) { alert('This phone is already used'); return; }
    const cs = new ChangeSet(); cs.put<Staff>('staff', { ...form, active: true }, 'add staff'); await cs.commit('Staff added');
    setForm({ name: '', phone: '', role: 'salesman', pin: '' }); load();
  };
  const setActive = async (s: Staff, active: boolean) => {
    if (!active && !confirm(`Remove ${s.name}'s access now? Their phone is locked out at the next sync. Their shops, orders and cash stay in the app.`)) return;
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
              <div className="grow"><div className="t">{s.name}</div><div className="muted">{s.role} · {s.phone}</div></div>
              {s.role !== 'owner' && editable && (s.active
                ? <button className="btn small danger" onClick={() => setActive(s, false)}>Remove access</button>
                : <button className="btn small" onClick={() => setActive(s, true)}>Restore</button>)}
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
  const load = async () => {
    const shops = new Map((await db.shops.toArray()).map(s => [s.id, s.name]));
    setList((await db.invoices.orderBy('date').reverse().limit(300).toArray()).map(i => ({ ...i, shopName: shops.get(i.shopId) ?? '' })));
  };
  useEffect(() => { load(); }, []);
  const cancel = async (i: Invoice) => {
    const reason = prompt(`Cancel bill ${i.number}? Bills are never deleted — give a reason:`);
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
      <input className="pill" style={{ width: '100%', padding: 10, marginBottom: 10 }} placeholder="Search bill or shop…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="list">
        {shown.map(i => (
          <div key={i.id} className="item">
            <div className="grow"><div className="t">{i.number} {i.cancelled && <span className="badge red">Cancelled</span>}</div>
              <div className="muted">{i.shopName} · {i.date} · {i.kind} · {i.deliveryStatus}</div></div>
            <b>{inr(i.total)}</b>
            <button className="btn small" onClick={() => setPrinting(i)}>🖨</button>
            {canCancel && !i.cancelled && <button className="btn small danger" onClick={() => cancel(i)}>✕</button>}
          </div>
        ))}
      </div>
      {printing && <PrintBill invoice={printing} onClose={() => setPrinting(null)} />}
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
    if (status === 'received') received = Number(prompt('Amount received ₹', String(c.amount)) ?? c.amount);
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
