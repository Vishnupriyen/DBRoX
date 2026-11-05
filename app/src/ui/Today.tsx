import { useEffect, useState } from 'react';
import { ChangeSet, db, session, today, undoBatch } from '../core/db';
import { invoiceBalances, r2, shopOutstanding } from '../core/ledger';
import { approveOrder } from '../core/proposals';
import { inr, t } from '../core/i18n';
import { loadSheet } from '../core/engine';
import { ReadTable } from './ApproveTable';
import type { AuditEntry, Order, Role } from '../core/types';

interface Data {
  sales: number; bills: number; collected: number; outstanding: number; cashWithStaff: number;
  needsOk: (Order & { shopName: string })[];
  alerts: { text: string; level: 'red' | 'yellow' }[];
  cash: { staffId: string; name: string; amount: number; since: string }[];
  recent: AuditEntry[];
  beat: { name: string; due: number; overdue: number }[];
}

// Owner's one-screen view of the day. Staff see only their part.
export function Today({ role }: { role: Role }) {
  const [d, setD] = useState<Data | null>(null);
  const [tick, setTick] = useState(0);
  const [load, setLoad] = useState<Awaited<ReturnType<typeof loadSheet>> | null>(null);

  useEffect(() => {
    (async () => {
      const day = today();
      const me = session().userId;
      const invs = (await db.invoices.where('date').equals(day).toArray()).filter(i => !i.cancelled);
      const orders = new Map((await db.orders.toArray()).map(o => [o.id, o]));
      const mine = role === 'salesman' ? invs.filter(i => orders.get(i.orderId ?? '')?.salesmanId === me) : invs;
      const pays = (await db.payments.where('date').equals(day).toArray()).filter(p => p.status === 'ok' && (role !== 'salesman' && role !== 'delivery' || p.collectedBy === me));
      const bal = await invoiceBalances();
      const shops = await db.shops.toArray();
      const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
      const unsettled = (await db.payments.toArray()).filter(p => p.mode === 'cash' && !p.settled && p.status === 'ok');
      const cashBy = new Map<string, { amount: number; since: string }>();
      for (const p of unsettled) { const v = cashBy.get(p.collectedBy) ?? { amount: 0, since: p.date }; v.amount = r2(v.amount + p.amount); if (p.date < v.since) v.since = p.date; cashBy.set(p.collectedBy, v); }

      const alerts: Data['alerts'] = [];
      const overdueShops = new Map<string, number>();
      for (const b of bal) if (b.overdueDays > 0 && b.balance > 0.5) overdueShops.set(b.invoice.shopId, Math.max(overdueShops.get(b.invoice.shopId) ?? 0, b.overdueDays));
      for (const [sid, days] of [...overdueShops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) alerts.push({ text: `${shops.find(s => s.id === sid)?.name}: payment ${days} days late`, level: days > 15 ? 'red' : 'yellow' });
      for (const [sid, v] of cashBy) if (v.since < day) alerts.push({ text: `${staff.get(sid) ?? sid} holds ${inr(v.amount)} cash since ${v.since}`, level: 'red' });
      const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const expiring = (await db.batches.toArray()).filter(b => b.qty > 0 && b.expiry <= soon);
      if (expiring.length) alerts.push({ text: `${expiring.length} batch(es) expire within 30 days — push or return`, level: 'yellow' });
      const recentAudit = (await db.audit.orderBy('at').reverse().limit(400).toArray()).filter(a => !a.undone);
      const edits = recentAudit.filter(a => a.at.startsWith(day) && /cancel|undo/i.test(a.action));
      if (edits.length > 5) alerts.push({ text: `${edits.length} cancels/undos today — check History`, level: 'yellow' });
      const lowRate = [...orders.values()].filter(o => o.date === day && o.issues.some(i => i.startsWith('Low rate')));
      if (lowRate.length) alerts.push({ text: `${lowRate.length} order(s) with unusual discount`, level: 'yellow' });

      const seen = new Set<string>();
      const recent: AuditEntry[] = [];
      for (const a of recentAudit) { if (seen.has(a.batchId) || a.action.startsWith('Demo')) continue; seen.add(a.batchId); recent.push(a); if (recent.length >= 8) break; }

      const myShops = role === 'salesman' ? shops.filter(s => s.salesmanId === me) : [];
      const beat = (await Promise.all(myShops.map(async s => { const o = await shopOutstanding(s.id); return { name: s.name, due: o.total, overdue: o.maxOverdueDays }; })))
        .sort((a, b) => b.overdue - a.overdue || b.due - a.due);

      setD({
        sales: r2(mine.reduce((a, i) => a + i.total, 0)), bills: mine.length,
        collected: r2(pays.reduce((a, p) => a + p.amount, 0)),
        outstanding: r2(bal.reduce((a, b) => a + Math.max(0, b.balance), 0)),
        cashWithStaff: r2([...cashBy.values()].reduce((a, v) => a + v.amount, 0)),
        needsOk: (await db.orders.where('status').equals('needs_ok').toArray()).map(o => ({ ...o, shopName: shops.find(s => s.id === o.shopId)?.name ?? '' })),
        alerts,
        cash: [...cashBy.entries()].map(([staffId, v]) => ({ staffId, name: staff.get(staffId) ?? staffId, ...v })),
        recent, beat,
      });
      if (role === 'godown') setLoad(await loadSheet());
    })();
  }, [tick, role]);

  if (!d) return <div className="muted">…</div>;
  const isBoss = role === 'owner' || role === 'office';

  const settle = async (staffId: string) => {
    const pays = (await db.payments.toArray()).filter(p => p.collectedBy === staffId && p.mode === 'cash' && !p.settled && p.status === 'ok');
    const cs = new ChangeSet();
    for (const p of pays) cs.put('payments', { ...p, settled: true }, 'cash received in office');
    await cs.commit('Evening cash settlement');
    setTick(x => x + 1);
  };
  const okOrder = async (id: string) => { await approveOrder(id); setTick(x => x + 1); };
  const rejectOrder = async (o: Order) => {
    const reason = prompt('Why cancel this order?');
    if (!reason) return;
    const cs = new ChangeSet(); cs.put('orders', { ...o, status: 'cancelled', issues: [...o.issues, `Cancelled: ${reason}`] }, 'cancel order');
    await cs.commit('Order cancelled'); setTick(x => x + 1);
  };

  return (
    <div>
      <div className="kpis">
        <div className="kpi"><div className="v">{inr(d.sales)}</div><div className="l">{t('sales')} · {d.bills} {t('bills')}</div></div>
        <div className="kpi"><div className="v">{inr(d.collected)}</div><div className="l">{t('collected')}</div></div>
        {isBoss && <div className="kpi"><div className="v">{inr(d.outstanding)}</div><div className="l">{t('outstanding')}</div></div>}
        {isBoss && <div className="kpi"><div className="v">{inr(d.cashWithStaff)}</div><div className="l">{t('cashInHand')} (staff)</div></div>}
      </div>

      {isBoss && d.needsOk.length > 0 && (
        <div className="card">
          <h3>{t('needsOk')} ({d.needsOk.length})</h3>
          <div className="list">
            {d.needsOk.map(o => (
              <div key={o.id} className="item" style={{ alignItems: 'flex-start' }}>
                <div className="grow"><div className="t">{o.shopName}</div><div className="muted">{o.lines.length} items · {o.date}</div>
                  {o.issues.map((x, i) => <div key={i} className="badge yellow" style={{ display: 'inline-block', margin: '4px 4px 0 0' }}>{x}</div>)}</div>
                <div className="row" style={{ flexDirection: 'column' }}>
                  <button className="btn small primary" onClick={() => okOrder(o.id)}>OK → bill</button>
                  <button className="btn small danger" onClick={() => rejectOrder(o)}>Cancel</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isBoss && d.alerts.length > 0 && (
        <div className="card">
          <h3>{t('alerts')}</h3>
          <div className="list">{d.alerts.map((a, i) => <div key={i} className="row"><span className={`badge ${a.level}`}>{a.level === 'red' ? '!' : '•'}</span><span>{a.text}</span></div>)}</div>
        </div>
      )}

      {isBoss && d.cash.length > 0 && (
        <div className="card">
          <h3>{t('cashInHand')}</h3>
          {d.cash.map(c => (
            <div key={c.staffId} className="row" style={{ padding: '6px 0' }}>
              <span className="grow">{c.name} · since {c.since}</span><b>{inr(c.amount)}</b>
              <button className="btn small primary" onClick={() => settle(c.staffId)}>{t('settle')}</button>
            </div>
          ))}
        </div>
      )}

      {role === 'salesman' && (
        <div className="card">
          <h3>My shops — late payers first</h3>
          <ReadTable table={{ name: 'My shops', columns: ['Shop', 'Pending ₹', 'Days late'], rows: d.beat.map(b => [b.name, b.due, b.overdue]) }} />
        </div>
      )}

      {role === 'godown' && load?.table && (
        <div className="card"><h3>Load sheet</h3><div className="muted" style={{ marginBottom: 8 }}>{load.text}</div><ReadTable table={load.table} /></div>
      )}

      {isBoss && (
        <div className="card">
          <h3>{t('history')}</h3>
          <div className="list">
            {d.recent.map(a => (
              <div key={a.id} className="row">
                <span className="grow"><b>{a.action.split(':')[0]}</b> <span className="muted">· {new Date(a.at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span></span>
                <button className="btn small" onClick={async () => { if (confirm('Undo this whole action?')) { await undoBatch(a.batchId); setTick(x => x + 1); } }}>↶ {t('undo')}</button>
              </div>
            ))}
            {!d.recent.length && <div className="muted">{t('noItems')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
