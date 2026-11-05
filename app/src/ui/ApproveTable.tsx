import { useEffect, useState } from 'react';
import { Check, Download, Plus, X } from 'lucide-react';
import { commit, hasErrors, validate, type Proposal, type Row, type Validation } from '../core/proposals';
import { refreshOrderRow } from '../core/engine';
import { downloadSheet } from '../core/readers';
import { t } from '../core/i18n';
import type { Invoice } from '../core/types';
import { notify } from './dialog';

interface Props {
  proposal: Proposal;
  onDone: (result: { message: string; batchId: string; invoices?: Invoice[] } | null) => void;
}

// The one screen every action goes through: check the table, fix red cells, tap ✓.
export function ApproveTable({ proposal, onDone }: Props) {
  const [p, setP] = useState<Proposal>(proposal);
  const [v, setV] = useState<Validation | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<string | null>(null);

  useEffect(() => { let alive = true; validate(p).then(x => alive && setV(x)); return () => { alive = false; }; }, [p]);

  const setCell = async (ri: number, key: string, value: string) => {
    const col = p.columns.find(c => c.key === key)!;
    const val = col.type === 'number' ? (value === '' ? '' : Number(value)) : value;
    let row: Row = { ...p.rows[ri], [key]: val as never };
    if (p.kind === 'order' && (key === 'productId' || key === 'qty' || key === 'rate')) {
      if (key === 'productId') row.rate = 0;
      row = await refreshOrderRow(row);
    }
    if (p.kind === 'bank' && key === 'shopId' && value) row.action = 'match';
    const rows = p.rows.slice(); rows[ri] = row;
    setP({ ...p, rows });
  };
  const setField = (key: string, value: string) => {
    setP({ ...p, fields: p.fields.map(f => f.key === key ? { ...f, value: f.type === 'number' ? Number(value) : value } : f) });
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
      setClosed(res.message);
      onDone(res);
    } catch (e) {
      setClosed(null);
      void notify('Could not save', (e as Error).message);
    } finally { setBusy(false); }
  };

  if (closed) return <div className="muted">✓ {closed}</div>;

  const bad = v ? hasErrors(v) : true;
  const fixedRows = ['bank', 'payment'].includes(p.kind);
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
              <th>#</th>
              {p.columns.map(c => <th key={c.key} className={c.type === 'number' ? 'num' : ''} style={{ minWidth: c.width }}>{c.label}</th>)}
              {!fixedRows && <th></th>}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r, ri) => (
              <tr key={ri} className={p.kind === 'bank' && r.action === 'check' ? 'check' : ''}>
                <td className="ro">{ri + 1}</td>
                {p.columns.map(c => {
                  const e = v?.errors[ri]?.[c.key];
                  if (c.readonly) {
                    const shown = c.type === 'select' ? c.options?.find(o => o.value === r[c.key])?.label : r[c.key];
                    return <td key={c.key} className={`ro ${c.type === 'number' ? 'num' : ''} ${e ? 'bad' : ''}`} title={e}>{String(shown ?? '')}</td>;
                  }
                  return (
                    <td key={c.key} className={`${c.type === 'number' ? 'num' : ''} ${e ? 'bad' : ''}`} title={e}>
                      {c.type === 'select'
                        ? <select value={String(r[c.key] ?? '')} onChange={ev => setCell(ri, c.key, ev.target.value)} aria-label={c.label}>
                            {c.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
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
        <button className="btn primary" disabled={bad || busy || !p.rows.length} onClick={approve}><Check /> {busy ? '…' : t('approve').replace(' ✓', '')}</button>
        <button className="btn" onClick={() => { setClosed('Cancelled'); onDone(null); }}>{t('cancel')}</button>
        <span className="grow" />
        <button className="btn small" onClick={() => downloadSheet(p.title, p.columns.map(c => c.label), p.rows.map(r => p.columns.map(c => {
          const val = r[c.key];
          return c.type === 'select' ? (c.options?.find(o => o.value === val)?.label ?? String(val ?? '')) : (val ?? '');
        })))}><Download /> {t('download')}</button>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>{bad ? t('fixRed') : t('allGood')}</div>
    </div>
  );
}

export function ReadTable({ table }: { table: { columns: string[]; rows: (string | number)[][]; name: string } }) {
  return (
    <div>
      <div className="tablewrap">
        <table className="grid">
          <thead><tr>{table.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {table.rows.slice(0, 200).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`ro ${typeof c === 'number' ? 'num' : ''}`}>{typeof c === 'number' ? c.toLocaleString('en-IN') : c}</td>)}</tr>)}
            {!table.rows.length && <tr><td className="ro" colSpan={table.columns.length}>{t('noItems')}</td></tr>}
          </tbody>
        </table>
      </div>
      {table.rows.length > 0 && <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => downloadSheet(table.name, table.columns, table.rows)}><Download /> {t('download')}</button>}
    </div>
  );
}
