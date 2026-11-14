import { useEffect, useState } from 'react';
import { Check, X, AlertTriangle, Phone, Store, MessageSquare } from 'lucide-react';
import { ChangeSet, db, getSettings } from '../core/db';
import { billValueOf } from '../core/billing';
import { isInterState } from '../core/gst';
import { approveOrder, flagArrivedOrders, rejectOrder, shopHistory } from '../core/pipeline';
import { allOutstanding } from '../core/ledger';
import { inr, plural } from '../core/i18n';
import { askText } from './dialog';
import { Pack } from './Pack';
import type { Order, Product, Scheme, Settings, Shop } from '../core/types';

type Hist = Awaited<ReturnType<typeof shopHistory>> & { late: number }; // late: days past the credit days

// Bill → Orders received. The owner sees the shop's history before saying yes; clean orders approve in one tap.
export function OrdersReceived() {
  const [list, setOrders] = useState<(Order & { shop: Shop; hist: Hist; salesman: string })[] | null>(null);
  const orders = list ?? [];
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [cfg, setCfg] = useState<Settings | undefined>(undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    (async () => {
      await flagArrivedOrders(); // a rep's order that just came in gets its stock / credit flags first
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
      const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
      const cos = new Map((await db.companies.toArray()).map(c => [c.id, c.name]));
      // a company rep's order (through the company link) names the company and the rep
      const who = (o: Order) => o.source === 'company' ? `${cos.get(o.companyId ?? '') ?? 'Company'} rep ${o.companyRep ?? ''}`.trim() : staff.get(o.salesmanId ?? '') ?? o.source;
      setProducts(new Map((await db.products.toArray()).map(p => [p.id, p])));
      setSchemes(await db.schemes.toArray()); setCfg(await getSettings());
      const os = (await db.orders.toArray()).filter(o => o.status === 'new' || o.status === 'needs_ok').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const dues = await allOutstanding(); // one pass over the bills for every shop, not one per order
      const hist = (s: Shop): Hist => { const d = dues.get(s.id); return { bills: d?.bills ?? 0, amount: d?.amount ?? 0, oldestDays: d?.oldestDays ?? 0, late: d?.maxOverdueDays ?? 0, limit: s.creditLimit, days: s.creditDays }; };
      // an order for a shop not here yet (a company rep's just-requested shop) waits until the shop arrives
      setOrders(os.filter(o => shops.has(o.shopId)).map(o => { const shop = shops.get(o.shopId)!; return { ...o, shop, hist: hist(shop), salesman: who(o) }; }));
    })();
  }, [tick]);

  // what the bill will be (schemes, tax, round-off as billing does it), not a rough qty × rate
  const value = (o: Order & { shop: Shop }) => billValueOf(o.lines, products, schemes, isInterState(o.shop, cfg ?? { stateCode: '' }));
  const bad = (o: typeof orders[0]) => (o.hist.limit > 0 && o.hist.amount + value(o) > o.hist.limit) || (o.hist.days > 0 && o.hist.oldestDays > o.hist.days);
  const clean = orders.filter(o => !o.issues.length && !bad(o) && !o.rateRemark);
  // approving takes the order off the list; no full reload after every tap
  const ok = async (id: string) => { await approveOrder(id); setOrders(l => (l ?? []).filter(o => o.id !== id)); };

  return (
    <div className="stack">
      <div className="sechead"><h3>{'Orders received'} · {orders.length}</h3>
        {clean.length > 1 && <button className="link" onClick={async () => { for (const o of clean) await approveOrder(o.id); setTick(x => x + 1); }}>{`Approve all ${clean.length} clean`}</button>}</div>
      {orders.map(o => {
        const warn = bad(o);
        return (
          <div key={o.id} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><div className="t" style={{ fontWeight: 700, fontSize: 'var(--f4)' }}>{o.shop.name}</div><div className="muted">{o.shop.area} · {o.salesman}{o.source === 'salesman' || o.source === 'company' ? '' : ` · ${o.source}`}</div></div>
              <span className="amt num">{inr(value(o))}</span>
            </div>
            {/* shop history strip — the one line that decides credit */}
            <div className={`hist ${warn ? 'bad' : ''}`}>
              {/* one line: what is unpaid and how late it is (it used to say "oldest 12 days" here and "Overdue 5 days" below) */}
              <Store size={14} /> {o.hist.bills
                ? <><b>{inr(o.hist.amount)}</b> {'unpaid'} · {o.hist.late > 0 ? <b>{plural(o.hist.late, 'day')} {'past credit'}</b> : 'within credit'}</>
                : <>{'No unpaid bills'}{o.hist.days > 0 && <> · {plural(o.hist.days, 'day')} {'credit'}</>}</>}
              {o.hist.limit > 0 && o.hist.amount + value(o) > o.hist.limit && <> · {'over limit'} {inr(o.hist.limit)}</>}
            </div>
            {o.rateRemark && <div className="alert"><MessageSquare /><div><b>{'Rate request'}:</b> {o.rateRemark}</div></div>}
            {o.source !== 'salesman' && o.source !== 'company' && <div className="row" style={{ alignItems: 'center', gap: 6 }}><span className="muted">{'How did this order come?'}</span><select value={o.source === 'office' ? '' : o.source} onChange={async e => { const cs = new ChangeSet(); cs.put('orders', { ...o, source: (e.target.value || 'office') as Order['source'] }, 'order source'); await cs.commit('Order source'); setTick(x => x + 1); }}><option value="">{'pick'}</option><option value="phone">{'Phone'}</option><option value="in_person">{'In person'}</option><option value="whatsapp">WhatsApp</option><option value="other">{'Other'}</option></select></div>}
            {o.issues.filter(x => !/^Overdue \d+ days/.test(x)).length > 0 && <div className="alert"><AlertTriangle /><div>{o.issues.filter(x => !/^Overdue \d+ days/.test(x)).map((x, i) => <div key={i}>{x}</div>)}</div></div>}
            <div className="list">
              {o.lines.map(l => { const p = products.get(l.productId); return <div key={l.productId} className="row" style={{ flexWrap: 'nowrap' }}>{p && <Pack product={p} />}<span className="grow">{p?.name}</span><span className="num" style={{ fontWeight: 700 }}>{l.qty}</span><span className="muted num">× {inr(l.rate)}</span></div>; })}
            </div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <button className="btn primary grow" disabled={o.source === 'office'} onClick={() => ok(o.id)}><Check /> {'Approve → godown'}</button>
              <a className="btn" href={`tel:${o.shop.phone ?? ''}`} aria-label="Call shop"><Phone /></a>
              <button className="btn" onClick={async () => { const r = await askText('Why cancel?'); if (!r) return; await rejectOrder(o.id, r); setTick(x => x + 1); }} aria-label="Cancel"><X /></button>
            </div>
          </div>
        );
      })}
      {!list && <div className="card muted">{'Loading orders…'}</div>}
      {list && !orders.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{'No orders waiting.'}</div>}
    </div>
  );
}
