import { useEffect, useState } from 'react';
import { Check, X, Printer, Lock, Minus, Plus } from 'lucide-react';
import { db } from '../core/db';
import { approvePicked, billingLockedBy, rejectOrder } from '../core/pipeline';
import { getLang, inr } from '../core/i18n';
import { askText } from './dialog';
import { Pack } from './Pack';
import { PrintBill } from './PrintBill';
import type { Invoice, Order, Product, Shop } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);

// Bill → Picked, to verify. Owner checks the physical pack against the screen, may edit, taps Done → bill. No send-back.
export function Approve({ go }: { go?: (p: string) => void }) {
  const [orders, setOrders] = useState<(Order & { shop: Shop })[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [edit, setEdit] = useState<Record<string, Record<string, number>>>({}); // orderId → productId → qty
  const [tick, setTick] = useState(0);
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const [made, setMade] = useState<Invoice[]>([]);
  const [locked, setLocked] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
      setProducts(new Map((await db.products.toArray()).map(p => [p.id, p])));
      const os = (await db.orders.toArray()).filter(o => o.status === 'picked').sort((a, b) => (a.pickedAt ?? '').localeCompare(b.pickedAt ?? ''));
      setOrders(os.map(o => ({ ...o, shop: shops.get(o.shopId)! })));
      setLocked(await billingLockedBy());
    })();
  }, [tick]);

  const qtyOf = (o: Order, pid: string) => edit[o.id]?.[pid] ?? o.picked?.find(p => p.productId === pid)?.qty ?? o.lines.find(l => l.productId === pid)?.qty ?? 0;
  const value = (o: Order) => o.lines.reduce((a, l) => { const p = products.get(l.productId); return a + qtyOf(o, l.productId) * l.rate * (1 + (p?.gst ?? 0) / 100); }, 0);
  const done = async (o: Order) => {
    const picked = (o.picked ?? o.lines.map(l => ({ productId: l.productId, qty: l.qty }))).map(p => ({ ...p, qty: qtyOf(o, p.productId) }));
    const { ChangeSet } = await import('../core/db');
    const cs = new ChangeSet(); cs.put('orders', { ...o, picked }, 'verified'); await cs.commit('Verified');
    const r = await approvePicked(o.id); setMade(m => [...r.invoices, ...m]); setTick(x => x + 1);
  };

  return (
    <div className="stack">
      {printing && <PrintBill invoice={printing} onClose={() => setPrinting(null)} />}
      <div className="sechead"><h3>{L('Picked — to verify', 'எடுத்தது — சரிபார்க்க')} · {orders.length}</h3></div>
      {locked && <div className="alert bad"><Lock /><div><b>{L('Billing is locked', 'பில்லிங் பூட்டப்பட்டுள்ளது')}</b> — {L(`close ${locked} first.`, `${locked} நாளை முதலில் முடிக்கவும்.`)} {go && <button className="link" onClick={() => go('dayclose')}>{L('Day close →', 'நாள் முடிவு →')}</button>}</div></div>}
      {made.length > 0 && <div className="alert ok"><Check /><div><b>{made.length} {L('bill(s) made', 'பில் தயார்')}</b> <div className="row" style={{ marginTop: 4 }}>{made.slice(0, 6).map(i => <button key={i.id} className="btn small" onClick={() => setPrinting(i)}><Printer /> {i.number}</button>)}</div></div></div>}
      {orders.map(o => {
        const diffs = o.lines.filter(l => { const pk = o.picked?.find(p => p.productId === l.productId); return pk && (pk.qty !== l.qty || (pk.mrp && pk.mrp !== products.get(l.productId)?.mrp)); });
        return (
          <div key={o.id} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><div className="t" style={{ fontWeight: 700, fontSize: 17 }}>{o.shop.name}</div><div className="muted">{o.shop.area} · {L('packed by', 'கட்டியவர்')} {o.pickedBy === 'demo' ? 'Mani' : ''} {o.pickedAt?.slice(11, 16)}</div></div>
              <span className="amt num">{inr(value(o))}</span>
            </div>
            {diffs.length ? <div className="muted">{diffs.length} {L('line(s) changed by the picker — shown in red', 'வரிகள் மாற்றப்பட்டன — சிவப்பில்')}</div> : <div className="muted">{L('Packed exactly as ordered', 'ஆர்டர் படியே கட்டப்பட்டது')}</div>}
            <div className="list">
              {o.lines.map(l => {
                const p = products.get(l.productId); const pk = o.picked?.find(x => x.productId === l.productId); const q = qtyOf(o, l.productId);
                const changed = q !== l.qty || (pk?.mrp && pk.mrp !== p?.mrp);
                return (
                  <div key={l.productId} className="row" style={{ flexWrap: 'nowrap', color: changed ? 'var(--bad)' : undefined }}>
                    {p && <Pack product={p} />}
                    <span className="grow">{p?.name}{pk?.mrp && pk.mrp !== p?.mrp ? <span className="badge bad" style={{ marginLeft: 6 }}>MRP {pk.mrp}</span> : null}</span>
                    <div className="stepper small"><button aria-label="less" onClick={() => setEdit(e => ({ ...e, [o.id]: { ...e[o.id], [l.productId]: Math.max(0, q - 1) } }))}><Minus /></button><input type="number" value={q} onChange={ev => setEdit(e => ({ ...e, [o.id]: { ...e[o.id], [l.productId]: Math.max(0, Number(ev.target.value)) } }))} aria-label="Quantity" /><button aria-label="more" onClick={() => setEdit(e => ({ ...e, [o.id]: { ...e[o.id], [l.productId]: q + 1 } }))}><Plus /></button></div>
                    {q !== l.qty && <span className="badge bad">{L('of', '/')} {l.qty}</span>}
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <button className="btn primary big grow" disabled={!!locked} onClick={() => done(o)}><Check /> {L('Done → bill', 'முடிந்தது → பில்')}</button>
              <button className="btn" onClick={async () => { const r = await askText(L('Why cancel?', 'ஏன் ரத்து?')); if (!r) return; await rejectOrder(o.id, r); setTick(x => x + 1); }} aria-label="Cancel"><X /></button>
            </div>
          </div>
        );
      })}
      {!orders.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{L('Nothing to verify.', 'சரிபார்க்க எதுவும் இல்லை.')}</div>}
    </div>
  );
}
