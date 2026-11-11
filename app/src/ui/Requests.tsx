import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { db, session } from '../core/db';
import { inr, showDate } from '../core/i18n';
import { approveRequest, rejectRequest, waitingRequests } from '../core/requests';
import { askText, confirmBox, notify } from './dialog';
import type { StaffRequest } from '../core/types';

const KIND = { return: 'Return', damage: 'Damage write-off', count: 'Stock count' } as const;

// Day close: staff returns and stock write-offs that wait for the owner (or office). Approve makes the credit note or
// the stock change on this phone; reject keeps everything as it was, with the reason.
export function Requests({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<StaffRequest[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [role, setRole] = useState('');
  useEffect(() => { (async () => {
    setList(await waitingRequests());
    setNames(new Map([...(await db.shops.toArray()).map(s => [s.id, s.name] as [string, string]), ...(await db.staff.toArray()).map(s => [s.id, s.name] as [string, string]), ...(await db.products.toArray()).map(p => [p.id, p.name] as [string, string])]));
    setRole((await db.staff.get(session().userId))?.role ?? 'owner');
  })(); }, []);
  const done = (id: string) => setList(l => (l ?? []).filter(r => r.id !== id));
  const ok = async (r: StaffRequest) => {
    if (!await confirmBox(`Approve ${KIND[r.kind].toLowerCase()} · ${inr(r.value)}?`, r.kind === 'return' ? 'A credit note is made now and the shop\'s balance goes down.' : 'The pieces come off the stock now.', 'Approve')) return;
    try { const res = await approveRequest(r.id); await notify('Approved', res); done(r.id); } catch (e) { await notify('Not done', (e as Error).message); }
  };
  const no = async (r: StaffRequest) => {
    const why = await askText('Why reject it?'); if (!why) return;
    try { await rejectRequest(r.id, why); done(r.id); } catch (e) { await notify('Not done', (e as Error).message); }
  };
  if (!list) return <div className="muted">…</div>;
  return (
    <div className="stack">
      <div className="sechead"><h3>{'Returns and write-offs to approve'} · {list.length}</h3><button className="link" onClick={onBack}>{'← Day close'}</button></div>
      {list.map(r => (
        <div key={r.id} className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><b>{KIND[r.kind]}{r.shopId ? ` · ${names.get(r.shopId) ?? ''}` : ''}</b><div className="muted">{names.get(r.by) ?? r.role} · {showDate(r.date)} · {r.reason}</div></div>
            <b className="num">{inr(r.value)}</b>
          </div>
          <div className="list">
            {r.rows.map((x, i) => <div key={i} className="row"><span className="grow">{names.get(String(x.productId)) ?? ''}</span><span className="badge">{r.kind === 'count' ? `${x.system} → ${x.counted}` : `${x.qty} pcs${x.restock === 'no' || x.fromStock === 'no' ? '' : r.kind === 'return' ? ' · back to stock' : ' · out of stock'}`}</span></div>)}
          </div>
          {r.ownerOnly && role !== 'owner' && <div className="muted">{'Above the owner\'s limit: only the owner can decide this one.'}</div>}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="btn primary grow" disabled={!!r.ownerOnly && role !== 'owner'} onClick={() => ok(r)}><Check /> {'Approve'}</button>
            <button className="btn" disabled={!!r.ownerOnly && role !== 'owner'} onClick={() => no(r)} aria-label="Reject"><X /></button>
          </div>
        </div>
      ))}
      {!list.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{'Nothing waiting.'}<div><button className="btn primary" style={{ marginTop: 8 }} onClick={onBack}>{'Back to day close'}</button></div></div>}
    </div>
  );
}
