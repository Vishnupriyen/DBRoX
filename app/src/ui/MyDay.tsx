import { useEffect, useState } from 'react';
import { db, session, today } from '../core/db';
import { getLang, inr } from '../core/i18n';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);

// Salesman's own day: shops visited, orders booked and their value, money collected. Read-only.
export function MyDay() {
  const [d, setD] = useState<{ visits: number; shops: number; orders: number; value: number; collected: number; byStatus: Record<string, number>; lines: { shop: string; value: number; status: string }[] } | null>(null);
  useEffect(() => {
    (async () => {
      const me = session().userId; const t = today();
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
      const mine = [...shops.values()].filter(s => s.salesmanId === me && s.beat === new Date().toLocaleDateString('en-US', { weekday: 'long' }));
      const visits = (await db.visits.where('date').equals(t).toArray()).filter(v => v.staffId === me);
      const orders = (await db.orders.where('date').equals(t).toArray()).filter(o => o.salesmanId === me && o.status !== 'cancelled');
      const prices = new Map((await db.products.toArray()).map(p => [p.id, p.rate]));
      const value = orders.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty * (l.rate || (prices.get(l.productId) ?? 0)), 0), 0);
      const pays = (await db.payments.where('date').equals(t).toArray()).filter(p => p.collectedBy === me && p.status === 'ok');
      const byStatus: Record<string, number> = {};
      for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      setD({ visits: visits.length, shops: mine.length, orders: orders.length, value, collected: pays.reduce((a, p) => a + p.amount, 0), byStatus,
        lines: orders.map(o => ({ shop: shops.get(o.shopId)?.name ?? '', value: o.lines.reduce((b, l) => b + l.qty * (l.rate || (prices.get(l.productId) ?? 0)), 0), status: o.status })) });
    })();
  }, []);
  if (!d) return null;
  const st: Record<string, [string, string]> = { new: ['at godown', 'கிடங்கில்'], picked: ['packed, owner approval', 'ஒப்புதலுக்கு'], needs_ok: ['owner approval', 'ஒப்புதலுக்கு'], billed: ['billed', 'பில் ஆனது'] };
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi navy"><div className="v">{d.visits}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{d.shops}</span></div><div className="l">{L('shops visited', 'கடைகள் சென்றது')}</div></div>
        <div className="kpi navy"><div className="v">{d.orders}</div><div className="l">{L('orders', 'ஆர்டர்')} · {inr(d.value)}</div></div>
        <div className="kpi"><div className="v">{inr(d.collected)}</div><div className="l">{L('collected', 'வசூல்')}</div></div>
        <div className="kpi"><div className="v">{d.byStatus.billed ?? 0}</div><div className="l">{L('orders billed', 'பில் ஆனது')}</div></div>
      </div>
      <div className="list">
        {d.lines.map((l, k) => <div key={k} className="item"><div className="grow"><div className="t">{l.shop}</div><div className="s">{st[l.status]?.[getLang() === 'ta' ? 1 : 0] ?? l.status}</div></div><span className="amt num">{inr(l.value)}</span></div>)}
        {!d.lines.length && <div className="card muted">{L('No orders yet today.', 'இன்று ஆர்டர் இல்லை.')}</div>}
      </div>
    </div>
  );
}
