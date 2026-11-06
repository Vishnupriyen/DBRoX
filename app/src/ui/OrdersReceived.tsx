import { useEffect, useState } from 'react';
import { Check, X, AlertTriangle, Phone, Store, MessageSquare } from 'lucide-react';
import { db } from '../core/db';
import { approveOrder, rejectOrder, shopHistory } from '../core/pipeline';
import { getLang, inr } from '../core/i18n';
import { askText } from './dialog';
import { Pack } from './Pack';
import type { Order, Product, Shop } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);
type Hist = Awaited<ReturnType<typeof shopHistory>>;

// Bill → Orders received. The owner sees the shop's history before saying yes; clean orders approve in one tap.
export function OrdersReceived() {
  const [orders, setOrders] = useState<(Order & { shop: Shop; hist: Hist; salesman: string })[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    (async () => {
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
      const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
      setProducts(new Map((await db.products.toArray()).map(p => [p.id, p])));
      const os = (await db.orders.toArray()).filter(o => o.status === 'new' || o.status === 'needs_ok').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setOrders(await Promise.all(os.map(async o => ({ ...o, shop: shops.get(o.shopId)!, hist: await shopHistory(o.shopId), salesman: staff.get(o.salesmanId ?? '') ?? o.source }))));
    })();
  }, [tick]);

  const value = (o: Order) => o.lines.reduce((a, l) => { const p = products.get(l.productId); return a + l.qty * l.rate * (1 + (p?.gst ?? 0) / 100); }, 0);
  const bad = (o: typeof orders[0]) => (o.hist.limit > 0 && o.hist.amount + value(o) > o.hist.limit) || (o.hist.days > 0 && o.hist.oldestDays > o.hist.days);
  const clean = orders.filter(o => !o.issues.length && !bad(o) && !o.rateRemark);
  const ok = async (id: string) => { await approveOrder(id); setTick(x => x + 1); };

  return (
    <div className="stack">
      <div className="sechead"><h3>{L('Orders received', 'வந்த ஆர்டர்கள்')} · {orders.length}</h3>
        {clean.length > 1 && <button className="link" onClick={async () => { for (const o of clean) await approveOrder(o.id); setTick(x => x + 1); }}>{L(`Approve all ${clean.length} clean`, `${clean.length} சரியானவை எல்லாம்`)}</button>}</div>
      {orders.map(o => {
        const warn = bad(o);
        return (
          <div key={o.id} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><div className="t" style={{ fontWeight: 700, fontSize: 17 }}>{o.shop.name}</div><div className="muted">{o.shop.area} · {o.salesman} · {o.source === 'salesman' ? '' : o.source}</div></div>
              <span className="amt num">{inr(value(o))}</span>
            </div>
            {/* shop history strip — the one line that decides credit */}
            <div className={`hist ${warn ? 'bad' : ''}`}>
              <Store size={14} /> <b>{o.hist.bills}</b> {L('bills pending', 'பில் நிலுவை')} · <b>{inr(o.hist.amount)}</b> · {L('oldest', 'பழைய')} <b>{o.hist.oldestDays}d</b>
              {o.hist.limit > 0 && <> · {L('limit', 'வரம்பு')} {inr(o.hist.limit)}</>}{o.hist.days > 0 && <> / {o.hist.days}d</>}
            </div>
            {o.rateRemark && <div className="alert"><MessageSquare /><div><b>{L('Rate request', 'விலை கோரிக்கை')}:</b> {o.rateRemark}</div></div>}
            {o.issues.length > 0 && <div className="alert"><AlertTriangle /><div>{o.issues.map((x, i) => <div key={i}>{x}</div>)}</div></div>}
            <div className="list">
              {o.lines.map(l => { const p = products.get(l.productId); return <div key={l.productId} className="row" style={{ flexWrap: 'nowrap' }}>{p && <Pack product={p} />}<span className="grow">{p?.name}</span><span className="num" style={{ fontWeight: 700 }}>{l.qty}</span><span className="muted num">@{l.rate}</span></div>; })}
            </div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <button className="btn primary grow" onClick={() => ok(o.id)}><Check /> {L('Approve → godown', 'ஒப்புதல் → கிடங்கு')}</button>
              <a className="btn" href={`tel:${o.shop.phone ?? ''}`} aria-label="Call shop"><Phone /></a>
              <button className="btn" onClick={async () => { const r = await askText(L('Why cancel?', 'ஏன் ரத்து?')); if (!r) return; await rejectOrder(o.id, r); setTick(x => x + 1); }} aria-label="Cancel"><X /></button>
            </div>
          </div>
        );
      })}
      {!orders.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{L('No orders waiting.', 'ஆர்டர் எதுவும் காத்திருக்கவில்லை.')}</div>}
    </div>
  );
}
