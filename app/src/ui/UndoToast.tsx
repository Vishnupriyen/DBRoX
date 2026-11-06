import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { undoBatch } from '../core/db';
import { t } from '../core/i18n';
import { notify } from './dialog';

// Every saved change shows a small "Saved · Undo" for a few seconds, on every screen.
export function UndoToast() {
  const [cur, setCur] = useState<{ label: string; batchId: string } | null>(null);
  useEffect(() => {
    let timer = 0;
    const on = (e: Event) => { const d = (e as CustomEvent).detail as { label: string; batchId: string }; if (/^(undo|sync)/i.test(d.label)) return; setCur(d); window.clearTimeout(timer); timer = window.setTimeout(() => setCur(null), 6000); };
    window.addEventListener('dbrox:commit', on); return () => { window.removeEventListener('dbrox:commit', on); window.clearTimeout(timer); };
  }, []);
  if (!cur) return null;
  return <div className="toast" role="status"><span>{cur.label}</span><button onClick={async () => { const n = await undoBatch(cur.batchId); setCur(null); if (n < 0) { void notify("Can't undo", "Can't undo this: something changed after it (for example a later bill used the same stock). Edit or cancel the bill instead."); return; } window.dispatchEvent(new CustomEvent('dbrox:undone', { detail: n })); }}><Undo2 size={14} style={{ verticalAlign: -2 }} /> {t('undo')}</button></div>;
}
