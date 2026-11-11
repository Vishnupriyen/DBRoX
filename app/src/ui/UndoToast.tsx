import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { db, sideNow, undoBatch, undoRefusal } from '../core/db';

// On the company side, these reach the distributors at once: taking them back on one side only would leave the two
// sides different, so no undo is offered (change or cancel them instead). Location readings and visits are records, not actions.
const CROSSES = new Set(['products', 'schemes', 'primaryInvoices', 'orders', 'shopRequests', 'claimDecisions', 'dbLinks', 'workDays']);
// distributor side: a goods receipt, a claim sent or an order to a linked company has already reached the company
const DB_CROSSES = new Set(['receipts', 'primaryOrders']);
import { inr, plural, t } from '../core/i18n';
import { notify } from './dialog';

type What = { verb: string; shopIds: string[]; amount?: number; count: number } | null;
// Every saved change shows a small "Saved · Undo" for a few seconds on the screen where it was saved. It says what
// will be undone ("Billed Annai Super Market ₹3,743") and goes away when the screen changes (`page`).
export function UndoToast({ page }: { page?: string }) {
  const [cur, setCur] = useState<{ label: string; batchId: string } | null>(null);
  useEffect(() => { setCur(null); }, [page]);
  // while the bubble is up the screen below it makes room, so it never covers a header or the first row
  useEffect(() => { document.body.toggleAttribute('data-toast', !!cur); return () => document.body.removeAttribute('data-toast'); }, [cur]);
  useEffect(() => {
    let timer = 0;
    const on = (e: Event) => { const d = (e as CustomEvent).detail as { label: string; batchId: string }; if ((e as CustomEvent).detail.quiet || /^(undo|sync|location|shop visit)/i.test(d.label)) return; /* a quiet save (a GPS reading) has nothing to undo */ const tables = ((e as CustomEvent).detail.tables as string[] | undefined) ?? [];
      if (sideNow() === 'company' ? tables.some(t => CROSSES.has(t)) : (tables.some(t => DB_CROSSES.has(t)) || /^Claim to /.test(d.label))) return; const what = (e as CustomEvent).detail.what as What; window.clearTimeout(timer); timer = window.setTimeout(() => setCur(null), 6000); setCur(d);
      if (what) void label(what).then(l => setCur(c => c && c.batchId === d.batchId ? { ...c, label: l } : c)); };
    window.addEventListener('dbrox:commit', on); return () => { window.removeEventListener('dbrox:commit', on); window.clearTimeout(timer); };
  }, []);
  if (!cur) return null;
  return <div className="toast" role="status"><span>{cur.label}</span><button onClick={async () => { const n = await undoBatch(cur.batchId); setCur(null); if (n < 0) { void notify("Can't undo", undoRefusal(n)); return; } window.dispatchEvent(new CustomEvent('dbrox:undone', { detail: n })); }}><Undo2 size={14} style={{ verticalAlign: -2 }} /> {t('undo')}</button></div>;
}

/** "Billed Annai Super Market ₹3,743", "Collected Kumar Mart ₹500", "Billed 3 shops ₹9,120" */
async function label(w: NonNullable<What>) {
  const names = (await Promise.all(w.shopIds.map(id => db.shops.get(id)))).map(x => x?.name).filter(Boolean) as string[];
  const who = names.length === 1 ? names[0] : names.length ? plural(names.length, 'shop') : '';
  return [w.verb, who, w.amount != null ? inr(w.amount) : ''].filter(Boolean).join(' ');
}
