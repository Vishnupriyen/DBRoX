import { useEffect, useState } from 'react';
import { Check, Download, Plus, X } from 'lucide-react';
import { commit, hasErrors, validate, type Proposal, type Row, type Validation } from '../core/proposals';
import { CHEQUE_FIELDS, refreshOrderRow } from '../core/engine';
import { downloadSheet } from '../core/readers';
import { showDate, t } from '../core/i18n';
import { db, session, today } from '../core/db';
import type { Invoice, Role } from '../core/types';
import { notify } from './dialog';

interface Props {
  proposal: Proposal;
  /** edited: the table was changed before ✓ (counted in the TESRAX report) */
  onDone: (result: { message: string; batchId: string; invoices?: Invoice[]; edited?: boolean } | null) => void;
}

// field staff send things to the owner; only the owner's side downloads Excel
const BILLNO = /^[A-Za-z0-9]{1,6}\/\d{2}-\d{2}\/\d{3,}$/; // a bill number is never broken across two lines
const FIELD: Role[] = ['salesman', 'godown', 'delivery', 'rep'];
function useRole() {
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => { let alive = true; db.staff.get(session().userId).then(s => alive && setRole(s?.role ?? null)).catch(() => {}); return () => { alive = false; }; }, []);
  return role;
}
// a narrow phone (360 px): the "#" and "You said" columns are left out and the amount sits next to the product
function useNarrow() {
  const mq = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 430px)') : null);
  const [narrow, setNarrow] = useState(() => !!mq()?.matches);
  useEffect(() => { const q = mq(); if (!q) return; const on = () => setNarrow(q.matches); q.addEventListener('change', on); return () => q.removeEventListener('change', on); }, []);
  return narrow;
}
const isoDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// The one screen every action goes through: check the table, fix red cells, tap ✓.
export function ApproveTable({ proposal, onDone }: Props) {
  const role = useRole();
  const narrow = useNarrow();
  const [p, setP] = useState<Proposal>(proposal);
  const [v, setV] = useState<Validation | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<string | null>(null);

  useEffect(() => { let alive = true; validate(p).then(x => alive && setV(x)); return () => { alive = false; }; }, [p]);

  const setCell = async (ri: number, key: string, value: string) => {
    const col = p.columns.find(c => c.key === key)!;
    const val = col.type === 'number' ? (value === '' ? '' : Number(value)) : value;
    let row: Row = { ...p.rows[ri], [key]: val as never };
    if ((p.kind === 'order' || p.kind === 'orderEdit') && (key === 'productId' || key === 'qty' || key === 'rate')) {
      if (key === 'productId') row.rate = 0;
      row = await refreshOrderRow(row);
    }
    if (p.kind === 'bank' && key === 'shopId' && value) row.action = 'match';
    const rows = p.rows.slice(); rows[ri] = row;
    setP({ ...p, rows });
  };
  const setField = (key: string, value: string) => {
    let fields = p.fields.map(f => f.key === key ? { ...f, value: f.type === 'number' ? Number(value) : value } : f);
    // a payment turned into a cheque asks for the date written on it and the bank
    if (p.kind === 'payment' && key === 'mode' && value === 'cheque' && !fields.some(f => f.key === 'chequeDate')) fields = [...fields, ...CHEQUE_FIELDS(today(), '')];
    setP({ ...p, fields });
  };
  const addRow = () => {
    const blank: Row = {};
    for (const c of p.columns) blank[c.key] = c.type === 'number' ? 0 : '';
    if (p.kind === 'claim') { blank.kind = 'damage'; blank.fromStock = 'yes'; }
    setP({ ...p, rows: [...p.rows, blank] });
  };
  const removeRow = (ri: number) => setP({ ...p, rows: p.rows.filter((_, i) => i !== ri) });

  const approve = async () => {
    setBusy(true);
    try {
      const res = await commit(p);
      setClosed(role && FIELD.includes(role) && (p.kind === 'order' || p.kind === 'leave') ? 'Sent to owner' : role && FIELD.includes(role) && p.kind === 'fieldOrder' ? 'Sent to distributor' : 'Approved'); // the result itself follows as TESRAX's next message (said once, with Undo)
      const edited = JSON.stringify([p.rows, p.fields]) !== JSON.stringify([proposal.rows, proposal.fields]);
      onDone({ ...res, edited });
    } catch (e) {
      setClosed(null);
      void notify('Could not save', (e as Error).message);
    } finally { setBusy(false); }
  };

  if (closed) return <div className="muted">✓ {closed}</div>;

  const bad = v ? hasErrors(v) : true;
  const field = !!role && FIELD.includes(role);
  const cols = !narrow ? p.columns : (() => {
    // the payment table keeps Bill · Balance · Pay now on a 360 px screen: date and overdue days are left out
    const cs = p.columns.filter(c => c.key !== 'said' && !((p.kind === 'payment' || p.kind === 'paymentFix') && (c.key === 'date' || c.key === 'overdue')));
    const amt = cs.find(c => c.key === 'amount'); const at = cs.findIndex(c => c.key === 'productId');
    return amt && at >= 0 ? [...cs.slice(0, at + 1).filter(c => c !== amt), amt, ...cs.slice(at + 1).filter(c => c !== amt)] : cs;
  })();
  const sendWord = field && (p.kind === 'order' || p.kind === 'leave') ? 'Send to owner' : field && p.kind === 'fieldOrder' ? 'Send to distributor' : t('approve').replace(' ✓', '');
  const fixedRows = ['bank', 'payment', 'paymentFix', 'orderCancel', 'billCancel', 'paymentCancel', 'expenseFix', 'stockFix', 'productEdit', 'shopEdit', 'undo', 'leave', 'advance', 'visit'].includes(p.kind);
  return (
    <div className="prop">
      <h4>{p.title}</h4>
      {p.note && <div className="note">{p.note}</div>}
      {p.fields.length > 0 && (
        <div className="fields">
          {p.fields.map(f => (
            <div key={f.key} className={`field ${v?.fieldErrors[f.key] ? 'bad' : ''}`}>
              <label>{f.label}</label>
              {f.type === 'select'
                ? <select value={String(f.value)} disabled={f.readonly} onChange={e => setField(f.key, e.target.value)}>
                    {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                : <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined}
                    value={String(f.value ?? '')} readOnly={f.readonly} onChange={e => setField(f.key, e.target.value)} />}
              {v?.fieldErrors[f.key] && <div className="em">{v.fieldErrors[f.key]}</div>}
            </div>
          ))}
        </div>
      )}
      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              {!narrow && <th>#</th>}
              {cols.map(c => <th key={c.key} className={c.type === 'number' ? 'num' : ''} style={{ minWidth: narrow && (p.kind === 'payment' || p.kind === 'paymentFix') && c.width ? Math.min(c.width, c.key === 'number' ? 135 : 78) : c.width }}>{c.label}</th>)}
              {!fixedRows && <th></th>}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r, ri) => (
              <tr key={ri} className={p.kind === 'bank' && r.action === 'check' ? 'check' : ''}>
                {!narrow && <td className="ro">{ri + 1}</td>}
                {cols.map(c => {
                  const e = v?.errors[ri]?.[c.key];
                  if (c.readonly) {
                    const raw = c.type === 'select' ? c.options?.find(o => o.value === r[c.key])?.label : r[c.key];
                    const shown = isoDay(raw) ? showDate(raw as string) : raw;
                    // read-only amounts the Indian way (1,506.62), never 1506.62
                    const txt = c.type === 'number' && typeof shown === 'number' ? shown.toLocaleString('en-IN', { minimumFractionDigits: shown % 1 ? 2 : 0, maximumFractionDigits: 2 }) : String(shown ?? '');
                    return <td key={c.key} className={`ro ${c.type === 'number' ? 'num' : ''} ${c.key === 'number' || BILLNO.test(txt) ? 'billno' : ''} ${e ? 'bad' : ''}`} title={e}>{txt}</td>;
                  }
                  return (
                    <td key={c.key} className={`${c.type === 'number' ? 'num' : ''} ${e ? 'bad' : ''}`} title={e}>
                      {c.type === 'select'
                        ? <SelectCell value={String(r[c.key] ?? '')} options={c.options ?? []} label={c.label} onChange={val => setCell(ri, c.key, val)} />
                        : <input value={String(r[c.key] ?? '')} aria-label={c.label}
                            type={c.type === 'date' ? 'date' : 'text'} inputMode={c.type === 'number' ? 'decimal' : undefined}
                            style={c.type === 'number' ? { textAlign: 'right' } : undefined}
                            onChange={ev => setCell(ri, c.key, ev.target.value)} />}
                    </td>
                  );
                })}
                {!fixedRows && <td><button className="btn small ghost danger" onClick={() => removeRow(ri)} aria-label="Remove row"><X /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!fixedRows && <button className="btn small ghost" style={{ marginTop: 8 }} onClick={addRow}><Plus /> Row</button>}
      {v && Object.keys(v.errors).length > 0 && (
        <ul className="errs">
          {Object.entries(v.errors).slice(0, 6).flatMap(([ri, cols]) => Object.values(cols).map((m, k) => <li key={`${ri}-${k}`}>Row {Number(ri) + 1}: {m}</li>))}
        </ul>
      )}
      {v && v.warnings.length > 0 && <ul className="warns">{v.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {v?.summary && <div className="summary">{v.summary}</div>}
      <div className="row">
        <button className="btn primary" disabled={bad || busy || !p.rows.length} onClick={approve}><Check /> {busy ? '…' : sendWord}</button>
        <button className="btn" onClick={() => { setClosed('Cancelled'); onDone(null); }}>{t('cancel')}</button>
        <span className="grow" />
        {!field && <button className="btn small" onClick={() => downloadSheet(p.title, p.columns.map(c => c.label), p.rows.map(r => p.columns.map(c => {
          const val = r[c.key];
          return c.type === 'select' ? (c.options?.find(o => o.value === val)?.label ?? String(val ?? '')) : (val ?? '');
        })))}><Download /> {t('download')}</button>}
      </div>
      <div className="muted" style={{ marginTop: 6 }}>{bad ? t('fixRed') : t('allGood')}</div>
    </div>
  );
}

export function ReadTable({ table }: { table: { columns: string[]; rows: (string | number)[][]; name: string } }) {
  const role = useRole();
  return (
    <div>
      <div className="tablewrap">
        <table className="grid">
          <thead><tr>{table.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {table.rows.slice(0, 200).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`ro ${typeof c === 'number' ? 'num' : ''}`}>{typeof c === 'number' ? c.toLocaleString('en-IN') : isoDay(c) ? showDate(c) : c}</td>)}</tr>)}
            {!table.rows.length && <tr><td className="ro" colSpan={table.columns.length}>{t('noItems')}</td></tr>}
          </tbody>
        </table>
      </div>
      {table.rows.length > 0 && !(role && FIELD.includes(role)) && <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => downloadSheet(table.name, table.columns, table.rows)}><Download /> {t('download')}</button>}
    </div>
  );
}

// A long list (2,000 products) is built only when this cell is opened: one full list per row made a 500-line bill
// about a million screen elements and crashed the phone. Until then the cell holds just its chosen option.
function SelectCell({ value, options, label, onChange }: { value: string; options: { value: string; label: string }[]; label: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const long = options.length > 50;
  const shown = !long || open ? options : [{ value: '', label: '' }, ...options.filter(o => o.value === value && o.value !== '')];
  return (
    <select value={value} onChange={ev => onChange(ev.target.value)} aria-label={label}
      onPointerDown={() => setOpen(true)} onFocus={() => setOpen(true)} onKeyDown={() => setOpen(true)}>
      {shown.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
