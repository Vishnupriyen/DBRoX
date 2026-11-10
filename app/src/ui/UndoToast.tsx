import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { sideNow, undoBatch } from '../core/db';

// On the company side, these reach the distributors at once: taking them back on one side only would leave the two
// sides different, so no undo is offered (change or cancel them instead). Location readings and visits are records, not actions.
const CROSSES = new Set(['products', 'schemes', 'primaryInvoices', 'orders', 'shopRequests', 'claimDecisions', 'dbLinks', 'workDays']);
// distributor side: a goods receipt, a claim sent or an order to a linked company has already reached the company
const DB_CROSSES = new Set(['receipts', 'primaryOrders']);
import { t } from '../core/i18n';
import { notify } from './dialog';

// Every saved change shows a small "Saved · Undo" for a few seconds, on every screen.
export function UndoToast() {
  const [cur, setCur] = useState<{ label: string; batchId: string } | null>(null);
  useEffect(() => {
    let timer = 0;
    const on = (e: Event) => { const d = (e as CustomEvent).detail as { label: string; batchId: string }; if ((e as CustomEvent).detail.quiet || /^(undo|sync|location|shop visit)/i.test(d.label)) return; /* a quiet save (a GPS reading) has nothing to undo */ const tables = ((e as CustomEvent).detail.tables as string[] | undefined) ?? [];
      if (sideNow() === 'company' ? tables.some(t => CROSSES.has(t)) : (tables.some(t => DB_CROSSES.has(t)) || /^Claim to /.test(d.label))) return; setCur(d); window.clearTimeout(timer); timer = window.setTimeout(() => setCur(null), 6000); };
    window.addEventListener('dbrox:commit', on); return () => { window.removeEventListener('dbrox:commit', on); window.clearTimeout(timer); };
  }, []);
  if (!cur) return null;
  return <div className="toast" role="status"><span>{cur.label}</span><button onClick={async () => { const n = await undoBatch(cur.batchId); setCur(null); if (n < 0) { void notify("Can't undo", "Can't undo this: something changed after it (for example a later bill used the same stock). Edit or cancel the bill instead."); return; } window.dispatchEvent(new CustomEvent('dbrox:undone', { detail: n })); }}><Undo2 size={14} style={{ verticalAlign: -2 }} /> {t('undo')}</button></div>;
}
