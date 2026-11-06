import { useEffect, useState } from 'react';
import { Check, ArrowLeft, AlertTriangle, PackageOpen, Minus, Plus } from 'lucide-react';
import { db, today } from '../core/db';
import { pickOrder } from '../core/pipeline';
import { getLang } from '../core/i18n';
import { Pack } from './Pack';
import type { Batch, Order, Product, Shop } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);
interface Row { product: Product; ordered: number; qty: number; batches: Batch[]; batchId?: string; mrp: number; done: boolean }

// Godown: pick each approved order. Qty up or down, batch (oldest first), MRP — never a new product.
export function PickOrders() {
  const [orders, setOrders] = useState<(Order & { shop: Shop })[]>([]);
  const [open, setOpen] = useState<(Order & { shop: Shop }) | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => { const shops = new Map((await db.shops.toArray()).map(s => [s.id, s])); setOrders((await db.orders.where('status').equals('approved').toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(o => ({ ...o, shop: shops.get(o.shopId)! }))); })(); }, [tick]);

  const start = async (o: Order & { shop: Shop }) => {
    const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
    const all = (await db.batches.toArray()).filter(b => b.qty > 0 && b.expiry >= today()).sort((a, b) => a.expiry.localeCompare(b.expiry));
    setRows(o.lines.map(l => {
      const p = products.get(l.productId)!; const bs = all.filter(b => b.productId === p.id);
      const stock = bs.reduce((a, b) => a + b.qty, 0);
      return { product: p, ordered: l.qty, qty: Math.min(l.qty, stock), batches: bs, batchId: bs[0]?.id, mrp: bs[0]?.mrp ?? p.mrp, done: false };
    }));
    setOpen(o);
  };
  const upd = (i: number, f: (r: Row) => Row) => setRows(rs => rs.map((x, k) => k === i ? f(x) : x));

  if (open) {
    const allDone = rows.every(r => r.done || r.qty === 0);
    return (
      <div className="stack">
        <div className="row" style={{ flexWrap: 'nowrap' }}><button className="icon-btn" onClick={() => setOpen(null)} aria-label="Back"><ArrowLeft /></button><div className="grow"><div className="h">{open.shop.name}</div><div className="muted">{open.shop.area} · {rows.length} {L('items', 'பொருட்கள்')}</div></div></div>
        <div className="list">
          {rows.map((r, i) => {
            const p = r.product; const stock = r.batches.reduce((a, b) => a + b.qty, 0);
            const cs = Math.floor(r.qty / p.caseSize), pcs = r.qty % p.caseSize;
            return (
              <div key={p.id} className="card stack" style={{ gap: 8, opacity: r.done ? .6 : 1 }}>
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <Pack product={p} size="lg" />
                  <div className="grow">
                    <div className="t" style={{ fontSize: 18 }}>{p.nameTa ?? p.name}</div>
                    <div className="s">{p.name} · {L('ordered', 'ஆர்டர்')} <b>{r.ordered}</b> · {L('stock', 'ஸ்டாக்')} {stock}</div>
                    {r.qty < r.ordered && <span className="badge bad"><AlertTriangle size={12} /> {L('short', 'குறைவு')} {r.ordered - r.qty}</span>}
                    {r.qty > r.ordered && <span className="badge warn">+{r.qty - r.ordered} {L('extra', 'கூடுதல்')}</span>}
                  </div>
                  <button className={`avatar ${r.done ? 'ok' : ''}`} style={{ width: 52, height: 52, borderRadius: 16, border: 0 }} onClick={() => upd(i, x => ({ ...x, done: !x.done }))} aria-label="Packed">{r.done ? <Check size={30} /> : <PackageOpen size={24} />}</button>
                </div>
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
                  <div className="stepper"><button aria-label="less" onClick={() => upd(i, x => ({ ...x, qty: Math.max(0, x.qty - 1), done: false }))}><Minus /></button><input type="number" value={r.qty} onChange={e => upd(i, x => ({ ...x, qty: Math.max(0, Number(e.target.value)), done: false }))} aria-label="Quantity" /><button aria-label="more" onClick={() => upd(i, x => ({ ...x, qty: x.qty + 1, done: false }))}><Plus /></button></div>
                  <span className="badge navy" style={{ fontSize: 14 }}>{cs ? `${cs} ${L('cs', 'கேஸ்')}` : ''}{cs && pcs ? ' + ' : ''}{pcs ? `${pcs} ${L('pcs', 'பீஸ்')}` : ''}{!r.qty ? '0' : ''}</span>
                </div>
                {r.batches.length > 0 && (
                  <div className="row" style={{ gap: 6 }}>
                    {r.batches.map(b => <button key={b.id} className={`chip ${r.batchId === b.id ? 'on' : ''}`} onClick={() => upd(i, x => ({ ...x, batchId: b.id, mrp: b.mrp }))}>{L('batch', 'பேட்ச்')} {b.batch} · {b.expiry.slice(0, 7)} · MRP {b.mrp} · {b.qty}</button>)}
                  </div>
                )}
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}><span className="muted">MRP</span><input type="number" value={r.mrp} onChange={e => upd(i, x => ({ ...x, mrp: Number(e.target.value) }))} style={{ width: 100 }} aria-label="MRP" />{r.mrp !== (r.batches.find(b => b.id === r.batchId)?.mrp ?? p.mrp) && <span className="badge warn">{L('MRP changed', 'MRP மாற்றம்')}</span>}</div>
              </div>
            );
          })}
        </div>
        <div className="sticky-foot">
          {!allDone && <div className="muted grow">{L('Tick every line as you pack', 'ஒவ்வொரு வரியையும் டிக் செய்யவும்')}</div>}
          <button className="btn primary big grow" disabled={!allDone} onClick={async () => { await pickOrder(open.id, rows.map(r => ({ productId: r.product.id, qty: r.qty, batchId: r.batchId, mrp: r.mrp }))); setOpen(null); setTick(x => x + 1); }}><Check /> {L('Packed → owner', 'கட்டியது → உரிமையாளர்')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="sechead"><h3>{L('Orders to pick', 'எடுக்க வேண்டிய ஆர்டர்கள்')} · {orders.length}</h3></div>
      <div className="list">
        {orders.map(o => (
          <button key={o.id} className="item tap" onClick={() => start(o)}>
            <div className="avatar"><PackageOpen size={20} /></div>
            <div className="grow"><div className="t">{o.shop.name}</div><div className="s">{o.shop.area} · {o.lines.length} {L('items', 'பொருட்கள்')} · {o.date}</div></div>
            <span className="badge warn">{L('pick', 'எடு')}</span>
          </button>
        ))}
        {!orders.length && <div className="card muted">{L('Nothing to pick. Orders appear here after the owner approves them.', 'எடுக்க எதுவும் இல்லை.')}</div>}
      </div>
    </div>
  );
}
