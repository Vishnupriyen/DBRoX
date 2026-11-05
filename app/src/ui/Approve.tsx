import { useEffect, useState } from 'react';
import { Check, X, AlertTriangle, Printer } from 'lucide-react';
import { db } from '../core/db';
import { approvePicked, rejectOrder } from '../core/pipeline';
import { getLang, inr } from '../core/i18n';
import { askText } from './dialog';
import { Pack } from './Pack';
import { PrintBill } from './PrintBill';
import type { Invoice, Order, Product, Shop } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);

// Owner: approve picked orders → invoices. Clean ones can be approved in one go.
export function Approve() {
  const [orders, setOrders] = useState<(Order & { shop: Shop })[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [tick, setTick] = useState(0);
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const [made, setMade] = useState<Invoice[]>([]);
  useEffect(() => {
    (async () => {
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
      setProducts(new Map((await db.products.toArray()).map(p => [p.id, p])));
      const os = (await db.orders.toArray()).filter(o => o.status === 'picked' || o.status === 'needs_ok').sort((a, b) => a.date.localeCompare(b.date));
      setOrders(os.map(o => ({ ...o, shop: shops.get(o.shopId)! })));
    })();
  }, [tick]);
  const value = (o: Order) => o.lines.reduce((a, l) => { const q = o.picked?.find(p => p.productId === l.productId)?.qty ?? l.qty; const p = products.get(l.productId); return a + q * l.rate * (1 + (p?.gst ?? 0) / 100); }, 0);
  const clean = orders.filter(o => !o.issues.length);
  const ok = async (o: Order) => { const r = await approvePicked(o.id); setMade(m => [...r.invoices, ...m]); setTick(x => x + 1); };

  return (
    <div className="stack">
      <div className="sechead"><h3>{L('Approve & invoice', 'ஒப்புதல் & பில்')} · {orders.length}</h3>
        {clean.length > 1 && <button className="link" onClick={async () => { for (const o of clean) await ok(o); }}>{L(`Approve all ${clean.length} clean`, `${clean.length} சரியானவை எல்லாம்`)}</button>}</div>
      {made.length > 0 && <div className="alert ok"><Check /><div><b>{made.length} {L('bill(s) made', 'பில் தயார்')}</b> <div className="row" style={{ marginTop: 4 }}>{made.slice(0, 6).map(i => <button key={i.id} className="btn small" onClick={() => setPrinting(i)}><Printer /> {i.number}</button>)}</div></div></div>}
      {orders.map(o => (
        <div key={o.id} className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><div className="t" style={{ fontWeight: 700, fontSize: 17 }}>{o.shop.name}</div><div className="muted">{o.shop.area} · {o.date}{o.pickedBy ? ` · ${L('picked', 'எடுக்கப்பட்டது')}` : ''}</div></div>
            <span className="amt num">{inr(value(o))}</span>
          </div>
          {o.issues.length > 0 && <div className="alert"><AlertTriangle /><div>{o.issues.map((x, i) => <div key={i}>{x}</div>)}</div></div>}
          <div className="list">
            {o.lines.map(l => {
              const p = products.get(l.productId); const q = o.picked?.find(x => x.productId === l.productId)?.qty ?? l.qty;
              return <div key={l.productId} className="row" style={{ flexWrap: 'nowrap' }}>{p && <Pack product={p} />}<span className="grow">{p?.name}</span><span className="num" style={{ fontWeight: 700 }}>{q}{q !== l.qty && <span className="badge bad" style={{ marginLeft: 6 }}>{L('of', '/')} {l.qty}</span>}</span></div>;
            })}
          </div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="btn primary grow" onClick={() => ok(o)}><Check /> {L('Approve → bill', 'ஒப்புதல் → பில்')}</button>
            <button className="btn" onClick={async () => { const r = await askText(L('Why cancel?', 'ஏன் ரத்து?')); if (!r) return; await rejectOrder(o.id, r); setTick(x => x + 1); }}><X /></button>
          </div>
        </div>
      ))}
      {!orders.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{L('Nothing waiting for you.', 'உங்கள் ஒப்புதலுக்கு எதுவும் இல்லை.')}</div>}
      {printing && <PrintBill invoice={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
