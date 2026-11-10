import { useEffect, useState } from 'react';
import { db, session, today } from '../core/db';
import { cancelMyOrder } from '../core/pipeline';
import { confirmBox, notify } from './dialog';
import { OrderBook } from './OrderBook';
import type { Order, Shop } from '../core/types';
import { Check, Clock, X, Pencil } from 'lucide-react';
import { inr } from '../core/i18n';


// Salesman's own day: shops visited, orders booked and their value, money collected. Read-only.
export function MyDay() {
  const [d, setD] = useState<{ visits: number; shops: number; orders: number; value: number; collected: number; byStatus: Record<string, number>; lines: { id: string; shop: string; value: number; status: string; o: Order; delivered?: string }[] } | null>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<{ shop: Shop; o: Order } | null>(null);
  useEffect(() => {
    (async () => {
      const me = session().userId; const t = today();
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
      const mine = [...shops.values()].filter(s => s.salesmanId === me && s.beat === new Date().toLocaleDateString('en-US', { weekday: 'long' }));
      const visits = (await db.visits.where('date').equals(t).toArray()).filter(v => v.staffId === me);
      const orders = (await db.orders.toArray()).filter(o => o.salesmanId === me && (o.date === t || !['billed', 'cancelled'].includes(o.status))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const invs = await db.invoices.toArray();
      const prices = new Map((await db.products.toArray()).map(p => [p.id, p.rate]));
      const value = orders.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty * (l.rate || (prices.get(l.productId) ?? 0)), 0), 0);
      const pays = (await db.payments.where('date').equals(t).toArray()).filter(p => p.collectedBy === me && p.status === 'ok');
      const byStatus: Record<string, number> = {};
      for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      // the same count as Today's beat: a shop is done once visited or ordered today
      const doneShops = mine.filter(s => visits.some(v => v.shopId === s.id) || orders.some(o => o.shopId === s.id && o.date === t)).length;
      setD({ visits: doneShops, shops: mine.length, orders: orders.length, value, collected: pays.reduce((a, p) => a + p.amount, 0), byStatus,
        lines: orders.map(o => ({ id: o.id, o, shop: shops.get(o.shopId)?.name ?? '', value: o.lines.reduce((b, l) => b + l.qty * (l.rate || (prices.get(l.productId) ?? 0)), 0), status: o.status, delivered: invs.filter(i => o.invoiceIds.includes(i.id)).find(i => i.delivery)?.delivery?.at })) });
    })();
  }, [tick]);
  if (editing) return <OrderBook shop={editing.shop} existing={editing.o} onClose={() => { setEditing(null); setTick(x => x + 1); }} />;
  if (!d) return null;
  // status timeline: sent → approved → picked → billed → delivered, with the time of each step
  const steps = (o: Order, delivered?: string) => {
    const at = (iso?: string) => iso ? iso.slice(11, 16) : '';
    const list: [string, string, string | undefined, boolean][] = [
      ['Sent', '', o.createdAt, true],
      ['Approved', '', o.approvedAt, ['approved', 'picked', 'billed'].includes(o.status)],
      ['Picked', '', o.pickedAt, ['picked', 'billed'].includes(o.status)],
      ['Billed', '', undefined, o.status === 'billed'],
      ['Delivered', '', delivered, !!delivered],
    ];
    return list.map(([l, , iso, done]) => ({ l, time: done ? at(iso) : '', done }));
  };
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi navy"><div className="v">{d.visits}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{d.shops}</span></div><div className="l">{'shops done'}</div></div>
        <div className="kpi navy"><div className="v">{d.orders}</div><div className="l">{'orders'} · {inr(d.value)}</div></div>
        <div className="kpi"><div className="v">{inr(d.collected)}</div><div className="l">{'collected'}</div></div>
        <div className="kpi"><div className="v">{d.byStatus.billed ?? 0}</div><div className="l">{'orders billed'}</div></div>
      </div>
      <div className="stack">
        {d.lines.map(l => (
          <div key={l.id} className="card stack" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><b>{l.shop}</b><span className="amt num">{inr(l.value)}</span></div>
            {l.status === 'cancelled' ? <span className="badge bad">{'cancelled'}</span> : (
              <div className="row" style={{ gap: 4 }}>
                {steps(l.o, l.delivered).map((st, k) => <span key={k} className={`badge ${st.done ? 'ok' : ''}`} style={{ whiteSpace: 'nowrap' }}>{st.done ? <Check size={11} /> : <Clock size={11} />} {st.l}{st.time ? ` ${st.time}` : ''}</span>)}
              </div>
            )}
            {l.status === 'new' && (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn small" onClick={async () => { const shop = await db.shops.get(l.o.shopId); if (shop) setEditing({ shop, o: l.o }); }}><Pencil size={14} /> {'Edit'}</button>
                <button className="btn small" onClick={async () => { if (!await confirmBox('Cancel this order?', 'Allowed until the owner approves it.', 'Cancel order')) return; try { await cancelMyOrder(l.id); } catch (e) { void notify('', (e as Error).message); } setTick(x => x + 1); }}><X size={14} /> {'Cancel'}</button>
              </div>
            )}
          </div>
        ))}
        {!d.lines.length && <div className="card muted">{'No orders yet today.'}</div>}
      </div>
    </div>
  );
}
