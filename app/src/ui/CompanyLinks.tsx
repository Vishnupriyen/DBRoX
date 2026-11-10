// Distributor side: link a company that uses Hanubix (its invite code), see exactly what it sees, or leave.
import { useEffect, useState } from 'react';
import { Link2, ShieldCheck } from 'lucide-react';
import { db } from '../core/db';
import { acceptInvite, leaveLink, NEVER_SHARED, previewInvite, resyncLink, SHARED_WITH_COMPANY } from '../core/link';
import { norm } from '../core/match';
import { confirmBox, notify } from './dialog';
import type { Company } from '../core/types';

export function CompanyLinks({ editable }: { editable: boolean }) {
  const [list, setList] = useState<Company[] | null>(null);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{ company: string; companyTenant?: string } | null>(null);
  const [mine, setMine] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => setList(await db.companies.toArray());
  useEffect(() => { void load(); }, []);
  if (!list) return <div className="card muted">{'Loading…'}</div>;
  const linked = list.filter(c => c.link);
  const run = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); try { await fn(); } catch (e) { await notify('Not done', (e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="stack">
      <div className="card">
        <h3>{'Company links'}</h3>
        <div className="muted">{'A company that uses Hanubix can see its own brand here: its bills, stock and claims. Nothing else.'}</div>
      </div>
      {linked.map(c => (
        <div key={c.id} className="item">
          <Link2 size={18} />
          <div className="grow"><div className="t">{c.name}</div><div className="s">{c.link!.status === 'linked' ? `Linked since ${new Date(c.link!.since).toLocaleDateString('en-IN')}` : 'You left — nothing is shared'}</div></div>
          {editable && c.link!.status === 'linked' && <button className="btn small" disabled={busy} onClick={() => run(async () => { await resyncLink(c.link!.linkId); await notify('Re-synced', `Everything ${c.name} should have is sent again.`); })}>{'Re-sync'}</button>}
          {editable && c.link!.status === 'linked' && <button className="btn small" disabled={busy} onClick={() => run(async () => {
            if (!await confirmBox(`Stop sharing with ${c.name}?`, 'Nothing new is shared from this moment. What they already have stays with them.', 'Stop sharing')) return;
            await leaveLink(c.link!.linkId); await load();
          })}>{'Leave'}</button>}
        </div>
      ))}
      {editable && !preview && (
        <div className="card">
          <h3>{'Link a company'}</h3>
          <div className="field"><label>{'Code from the company'}</label><input value={code} maxLength={8} autoCapitalize="characters" onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="KAV7Q2" /></div>
          <button className="btn primary" disabled={busy || code.length < 6} onClick={() => run(async () => setPreview(await previewInvite(code)))}>{'Check the code'}</button>
        </div>
      )}
      {editable && preview && (
        <div className="card">
          <h3><ShieldCheck size={18} /> {`${preview.company} will see`}</h3>
          <ul style={{ margin: '6px 0 8px 18px', padding: 0 }}>{SHARED_WITH_COMPANY.map(x => <li key={x}>{x}</li>)}</ul>
          <div className="muted" style={{ marginBottom: 10 }}>{NEVER_SHARED} {'You can leave at any time from this screen. Your data stays yours.'}</div>
          <div className="field"><label>{'This company in your product list'}</label>
            <select value={mine} onChange={e => setMine(e.target.value)}><option value="">{'New — not in my list yet'}</option>{list.filter(c => !c.link || (c.link.companyTenant === preview.companyTenant && c.link.status !== 'linked')).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          {mine && !norm(list.find(c => c.id === mine)?.name ?? '').split(' ').some(w => w.length > 3 && norm(preview.company).includes(w)) && <div style={{ color: 'var(--warn)', marginBottom: 8 }}>{`"${list.find(c => c.id === mine)?.name}" does not look like ${preview.company}. Its bills and stock will be shared with ${preview.company}. Check before linking.`}</div>}
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => run(async () => { const r = await acceptInvite(code, mine || undefined); setPreview(null); setCode(''); await load(); await notify(`Linked with ${r.company}`, 'Their products and prices are now in your list.'); })}>{'Agree and link'}</button>
            <button className="btn ghost" onClick={() => setPreview(null)}>{'Cancel'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
