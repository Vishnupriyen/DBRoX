// My files (founder, 14 Nov 2026 — item 6): one place for everything TESRAX answered and every Excel the app made.
// Each file downloads again as Excel, or opens as a print page for a PDF (Android: print → "Save as PDF").
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileSpreadsheet, FileText, Trash2, X, Printer } from 'lucide-react';
import { dropFile, myFiles, type MyFile, type SheetData } from '../core/myfiles';
import { downloadWorkbook } from '../core/readers';
import { printPage } from '../core/files';
import { getSettings } from '../core/db';
import { showDate } from '../core/i18n';
import { confirmBox } from './dialog';

const cell = (c: string | number) => typeof c === 'number' ? c.toLocaleString('en-IN') : c;

/** a table as a print page (white, black text): the browser's print, or Android's print screen → Save as PDF */
export function PrintTable({ title, sheets, onClose }: { title: string; sheets: SheetData[]; onClose: () => void }) {
  const [firm, setFirm] = useState('');
  useEffect(() => { void getSettings().then(s => setFirm(s.firmName ?? '')); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return createPortal(
    <div className="print-sheet" role="dialog" aria-label={`${title} — PDF`}>
      <div className="row noprint" style={{ justifyContent: 'flex-end', gap: 8, padding: 12 }}>
        <button className="btn primary small" onClick={() => printPage(title)}><Printer /> Save as PDF / Print</button>
        <button className="btn small" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <div className="bill">
        <div className="brand">{firm}</div>
        <div style={{ fontWeight: 700, margin: '4px 0 2px' }}>{title}</div>
        <div style={{ color: '#555', marginBottom: 10 }}>{new Date().toLocaleString('en-IN')}</div>
        {sheets.map(s => (
          <div key={s.name} style={{ marginBottom: 14 }}>
            {sheets.length > 1 && <div style={{ fontWeight: 700, margin: '6px 0' }}>{s.name}</div>}
            <table className="print-grid"><thead><tr>{s.header.map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{s.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'num' : ''}>{cell(c)}</td>)}</tr>)}</tbody></table>
          </div>
        ))}
      </div>
    </div>, document.body);
}

export function MyFilesPage() {
  const [files, setFiles] = useState<MyFile[] | null>(null);
  const [pdf, setPdf] = useState<MyFile | null>(null);
  const load = () => { void myFiles().then(setFiles); };
  useEffect(load, []);
  if (!files) return <div className="muted">…</div>;
  return (
    <div className="stack">
      <div className="muted">Everything TESRAX answered and every Excel you made on this phone. Only you see your files.</div>
      {!files.length && <div className="card muted">No files yet. Ask TESRAX for a report — it is kept here.</div>}
      <div className="list">
        {files.map(f => {
          const rows = f.sheets.reduce((a, s) => a + s.rows.length, 0);
          return (
            <div key={f.id} className="item">
              <div className="grow"><div className="t">{f.name}</div><div className="s">{showDate(f.at.slice(0, 10))} · {new Date(f.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {rows} row{rows === 1 ? '' : 's'}</div></div>
              <button className="btn small" onClick={() => downloadWorkbook(f.name, f.sheets, false)} aria-label={`${f.name} as Excel`}><FileSpreadsheet /> Excel</button>
              <button className="btn small" onClick={() => setPdf(f)} aria-label={`${f.name} as PDF`}><FileText /> PDF</button>
              <button className="btn small ghost" aria-label={`Delete ${f.name}`} onClick={async () => { if (await confirmBox('Delete this file?', f.name, 'Delete')) { await dropFile(f.id); load(); } }}><Trash2 /></button>
            </div>
          );
        })}
      </div>
      {pdf && <PrintTable title={pdf.name} sheets={pdf.sheets} onClose={() => setPdf(null)} />}
    </div>
  );
}
