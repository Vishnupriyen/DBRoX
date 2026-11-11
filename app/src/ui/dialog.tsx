import { useEffect, useState } from 'react';

// In-app dialogs (big buttons, works everywhere). Replaces browser pop-ups, which look different on
// every phone and are blocked inside some app views.
interface Req {
  title: string;
  message?: string;
  input?: 'text' | 'number';
  value?: string;
  choices?: { label: string; value: string; tone?: 'primary' | 'danger' }[];
  resolve: (v: string | null) => void;
}

let push: ((r: Req) => void) | null = null;

export function ask(title: string, opts: Omit<Req, 'title' | 'resolve'> = {}): Promise<string | null> {
  return new Promise(resolve => {
    if (!push) { resolve(null); return; }
    push({ title, ...opts, resolve });
  });
}
export const confirmBox = async (title: string, message?: string, yes = 'Yes') =>
  (await ask(title, { message, choices: [{ label: 'Cancel', value: '' }, { label: yes, value: 'yes', tone: 'primary' }] })) === 'yes';
export const notify = async (title: string, message?: string) => { await ask(title, { message, choices: [{ label: 'OK', value: 'ok', tone: 'primary' }] }); };
export const askText = (title: string, value = '', input: 'text' | 'number' = 'text') => ask(title, { input, value });

export function DialogHost() {
  const [q, setQ] = useState<Req[]>([]);
  const [val, setVal] = useState('');
  useEffect(() => { push = r => { setQ(x => [...x, r]); setVal(r.value ?? ''); }; return () => { push = null; }; }, []);
  const cur = q[0];
  if (!cur) return null;
  const close = (v: string | null) => { cur.resolve(v); setQ(x => x.slice(1)); setVal(q[1]?.value ?? ''); };
  const choices = cur.choices ?? [{ label: 'Cancel', value: '' }, { label: 'OK', value: '__input', tone: 'primary' as const }];
  return (
    <div role="dialog" aria-modal="true" aria-label={cur.title} className="dialog-wrap"
      onClick={e => { if (e.target === e.currentTarget) close(null); }}>
      <div className="dialog">
        <h3>{cur.title}</h3>
        {cur.message && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{cur.message}</p>}
        {cur.input && (
          <input id="dialog-input" autoFocus style={{ width: '100%', padding: 12, fontSize: '1.25rem', marginBottom: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--paper)' }}
            inputMode={cur.input === 'number' ? 'decimal' : 'text'} value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') close(val); }} />
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {choices.map(c => (
            <button key={c.label} className={`btn ${c.tone === 'primary' ? 'primary' : c.tone === 'danger' ? 'danger' : ''}`}
              onClick={() => close(c.value === '__input' ? val : c.value === '' && !cur.input ? '' : c.value === '' ? null : c.value)}>{c.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
