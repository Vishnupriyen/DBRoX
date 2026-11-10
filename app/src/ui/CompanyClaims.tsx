// Company side: distributor claims (checked by TESRAX line by line) and the field team's travel & expenses.
import { useEffect, useState } from 'react';
import { Check, X, AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { db, session, thisMonth, today } from '../core/db';
import { inr as inrExact, plural } from '../core/i18n';
import { CLAIM_KINDS, checkClaim, decideClaim, type ClaimCheck } from '../core/claims';
import { addExpense, decideTravel, monthClaim, submitMonth, travelToDecide, type MonthClaim } from '../core/travel';
import { myTeam } from '../core/company';
import { PhotoButton } from './PhotoButton';
import { askText, confirmBox, notify } from './dialog';
import type { ClaimDecision, DbClaim, DbLink, Expense, Product, Role, TravelClaim } from '../core/types';
void myTeam;

const inr = (n: number) => inrExact(Math.round(n));
const act = async (fn: () => Promise<unknown>) => { try { await fn(); return true; } catch (e) { await notify('Not saved', (e as Error).message); return false; } };
const final = (d?: ClaimDecision) => d && (d.status === 'approved' || d.status === 'rejected');

// ---------------------------------------------------------------- claims inbox
export function ClaimsInbox({ role }: { role: Role }) {
  const [rows, setRows] = useState<{ c: DbClaim; link?: DbLink; d?: ClaimDecision }[] | null>(null);
  const [open, setOpen] = useState<DbClaim | null>(null);
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const load = async () => {
    const links = new Map((await db.dbLinks.toArray()).map(l => [l.id, l]));
    const ds = await db.claimDecisions.toArray();
    const latest = (id: string) => ds.filter(d => d.claimId === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    setRows((await db.dbClaims.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(c => ({ c, link: links.get(c.dbLinkId), d: latest(c.id) })));
  };
  useEffect(() => { void load(); }, []);
  if (open) return <ClaimDetail claim={open} role={role} onBack={() => { setOpen(null); void load(); }} />;
  if (!rows) return <div className="card muted">{'Loading…'}</div>;
  const shown = rows.filter(r => (tab === 'open') !== !!final(r.d));
  return (
    <div className="stack">
      <div className="segmented"><button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>{`To decide (${rows.filter(r => !final(r.d)).length})`}</button><button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>{'Decided'}</button></div>
      <div className="list">{shown.map(({ c, link, d }) => (
        <button key={c.id} className="item tap" onClick={() => setOpen(c)}>
          <div className="grow" style={{ textAlign: 'left' }}><div className="t">{link?.name ?? 'Distributor'}</div><div className="s">{[c.month, `${plural(c.lines.length, 'line')}`, d ? (d.status === 'recommended' ? `recommended by ${d.decidedBy}` : d.status === 'approved' ? `approved ${inr(d.amount)} · ${d.creditNoteNo}` : 'rejected') : 'new'].join(' · ')}</div></div>
          <div className="num">{inr(c.amount)}</div><ChevronRight size={18} />
        </button>
      ))}</div>
      {!shown.length && <div className="card muted">{tab === 'open' ? 'No claims waiting.' : 'Nothing decided yet.'}</div>}
    </div>
  );
}

function ClaimDetail({ claim, role, onBack }: { claim: DbClaim; role: Role; onBack: () => void }) {
  const [chk, setChk] = useState<ClaimCheck | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [dec, setDec] = useState<ClaimDecision | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => {
    setProducts(new Map((await db.products.toArray()).map(p => [p.id, p])));
    const c = await checkClaim(claim); setChk(c); setPick(new Set(c.lines.filter(l => l.ok).map(l => l.id)));
    setDec((await db.claimDecisions.toArray()).filter(d => d.claimId === claim.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]);
  })(); }, [claim.id]);
  if (!chk) return <div className="card muted">{'Checking every line…'}</div>;
  const amount = chk.lines.filter(l => pick.has(l.id)).reduce((a, l) => a + l.amount, 0);
  const done = final(dec);
  const run = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { if (await act(fn)) onBack(); } finally { setBusy(false); } };
  return (
    <div className="stack">
      <button className="btn small" onClick={onBack}>← {'Claims'}</button>
      <div className="kpis">
        <div className="kpi"><div className="v">{inr(claim.amount)}</div><div className="l">{'claimed'}</div></div>
        <div className="kpi"><div className="v">{inr(chk.okAmount)}</div><div className="l">{'checks out'}</div></div>
        <div className="kpi"><div className="v" style={{ color: chk.flagged ? 'var(--bad)' : undefined }}>{chk.flagged}</div><div className="l">{'lines to look at'}</div></div>
      </div>
      {chk.gstWarning && <div className="card" style={{ borderColor: 'var(--warn)' }}><AlertTriangle size={16} /> {chk.gstWarning}</div>}
      {chk.budget.map(b => <div key={b.scheme.id} className="muted">{`${b.scheme.name}: budget ${inr(b.scheme.budget!)} · used ${inr(b.used)} · this claim ${inr(b.adding)}`}</div>)}
      <div className="list">{chk.lines.map(l => (
        <div key={l.id} className="item">
          {!done && <input type="checkbox" aria-label="Approve this line" checked={pick.has(l.id)} onChange={e => { const n = new Set(pick); if (e.target.checked) n.add(l.id); else n.delete(l.id); setPick(n); }} />}
          <div className="grow"><div className="t">{CLAIM_KINDS[l.kind] ?? l.kind}{l.productId ? ` · ${products.get(l.productId)?.name ?? ''}` : ''}</div><div className="s" style={{ color: l.ok ? undefined : 'var(--warn)' }}>{l.ok ? '✓ ' : '⚠ '}{l.why}</div></div>
          <div className="num">{inr(l.amount)}</div>
        </div>
      ))}</div>
      {dec && <div className="card">{dec.status === 'recommended' ? `Recommended by ${dec.decidedBy}${dec.note ? `: ${dec.note}` : ''}` : dec.status === 'approved' ? `Approved ${inr(dec.amount)} by ${dec.decidedBy} · credit note ${dec.creditNoteNo}` : `Rejected by ${dec.decidedBy}: ${dec.note}`}</div>}
      {!done && (
        <div className="row">
          {role === 'cadmin' ? <>
            <button className="btn primary" disabled={busy || !pick.size} onClick={() => run(async () => { const r = await decideClaim(claim, 'approved', [...pick], ''); await notify(`Approved ${inr(r.amount)}`, `Credit note ${r.creditNoteNo} goes to the distributor.`); })}><Check size={16} /> {`Approve ${inr(amount)}`}</button>
            <button className="btn ghost" disabled={busy} onClick={async () => { const why = await askText('Why is it rejected? (the distributor sees this)'); if (why !== null) await run(() => decideClaim(claim, 'rejected', [], why)); }}><X size={16} /> {'Reject'}</button>
          </> : <button className="btn primary" disabled={busy || !pick.size} onClick={async () => { const note = await askText('Note for head office (optional)'); if (note !== null) await run(() => decideClaim(claim, 'recommended', [...pick], note)); }}>{`Recommend ${inr(amount)}`}</button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- rep: expenses and the month's claim
const CATS = ['Food', 'Bus', 'Auto', 'Lodge', 'Phone', 'Other'];
export function MyExpenses() {
  const [m, setM] = useState<MonthClaim | null>(null);
  const [list, setList] = useState<Expense[]>([]);
  const [sent, setSent] = useState<TravelClaim | undefined>();
  const [form, setForm] = useState<{ category: string; amount: string; note: string; photo?: string; date: string } | null>(null);
  const load = async () => {
    const me = session().userId;
    setM(await monthClaim(me)); setList((await db.expenses.toArray()).filter(e => e.by === me && e.date.slice(0, 7) === thisMonth()).sort((a, b) => b.date.localeCompare(a.date)));
    setSent((await db.travelClaims.where('staffId').equals(me).toArray()).filter(c => c.month === thisMonth()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]);
  };
  useEffect(() => { void load(); }, []);
  if (!m) return <div className="card muted">{'Loading…'}</div>;
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><div className="v">{inr(m.kmAmount)}</div><div className="l">{`${m.km} km`}</div></div>
        <div className="kpi"><div className="v">{inr(m.daAmount)}</div><div className="l">{`daily allowance · ${m.daDays} days${m.outDays ? ` (${m.outDays} outstation)` : ''}`}</div></div>
        <div className="kpi"><div className="v">{inr(m.expenses)}</div><div className="l">{'expenses'}</div></div>
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><b>{`This month: ${inr(m.total)}`}</b>{sent && <span className="muted">{sent.status === 'waiting' ? 'Sent — waiting' : sent.status === 'approved' ? `Approved by ${sent.decidedBy}` : `Rejected: ${sent.note}`}</span>}</div>
        {m.flags.length > 0 && <div style={{ marginTop: 6 }}>{m.flags.map(f => <div key={f} className="s" style={{ color: 'var(--warn)' }}>{f}</div>)}</div>}
        {(!sent || sent.status === 'rejected') && <button className="btn primary" style={{ marginTop: 8 }} onClick={async () => { if (await confirmBox('Send this month\'s claim?', `${inr(m.total)} goes to your manager with everything shown here.`, 'Send') && await act(() => submitMonth())) void load(); }}>{'Send to manager'}</button>}
      </div>
      {!form && <button className="btn block" onClick={() => setForm({ category: 'Food', amount: '', note: '', date: today() })}><Plus size={16} /> {'Add expense'}</button>}
      {form && (
        <div className="card">
          <div className="chips">{CATS.map(c => <button key={c} className={`chip ${form.category === c ? 'on' : ''}`} onClick={() => setForm({ ...form, category: c })}>{c}</button>)}</div>
          <div className="row"><div className="field grow"><label>{'Amount ₹'}</label><input inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, '') })} /></div><div className="field grow"><label>{'Date'}</label><input type="date" value={form.date} max={today()} onChange={e => setForm({ ...form, date: e.target.value })} /></div></div>
          <div className="field"><label>{'Note'}</label><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
          <PhotoButton label={'Bill photo'} onPhoto={url => setForm({ ...form, photo: url })} />
          <div className="row" style={{ marginTop: 8 }}><button className="btn primary" onClick={async () => { if (await act(() => addExpense({ date: form.date, category: form.category, amount: Number(form.amount), note: form.note, photo: form.photo }))) { setForm(null); void load(); } }}>{'Save'}</button><button className="btn ghost" onClick={() => setForm(null)}>{'Cancel'}</button></div>
        </div>
      )}
      <div className="list">{list.map(e => <div key={e.id} className="item"><div className="grow"><div className="t">{e.category}</div><div className="s">{[e.date, e.note, e.photo ? 'bill photo' : 'no photo', e.status ?? ''].filter(Boolean).join(' · ')}</div></div><div className="num">{inrExact(e.amount)}</div></div>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- manager: travel claims of the team
export function TravelApprovals() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof travelToDecide>> | null>(null);
  const load = async () => setRows(await travelToDecide());
  useEffect(() => { void load(); }, []);
  if (!rows) return null;
  return (
    <>
      {rows.map(({ claim: c, who, actual: a, mismatch }) => (
        <div key={c.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{`${who.name} · ${c.month}`}</b><span className="num">{inr(a.total)}</span></div>
          <div className="muted">{`${a.km} km ${inr(a.kmAmount)} · DA ${a.daDays} days ${inr(a.daAmount)} · expenses ${inr(a.expenses)}`}</div>
          {mismatch && <div className="s" style={{ color: 'var(--bad)' }}>{`The phone sent ${inr(c.total)}; the record says ${inr(a.total)}. Approving pays what the record says.`}</div>}
          {a.flags.length ? a.flags.map(f => <div key={f} className="s" style={{ color: 'var(--warn)' }}>{f}</div>) : <div className="s">{'Nothing odd in the record.'}</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small primary" onClick={async () => { if (await act(() => decideTravel(c.id, true, ''))) void load(); }}>{`Approve ${inr(a.total)}`}</button>
            <button className="btn small ghost" onClick={async () => { const why = await askText('Why? (the rep sees this)'); if (why !== null && await act(() => decideTravel(c.id, false, why))) void load(); }}>{'Reject'}</button>
          </div>
        </div>
      ))}
    </>
  );
}
