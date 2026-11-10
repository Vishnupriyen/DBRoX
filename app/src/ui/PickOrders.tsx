import { plural, showDate } from '../core/i18n';
import { useEffect, useState } from 'react';
import { Check, ArrowLeft, AlertTriangle, PackageOpen, Minus, Plus, Copy } from 'lucide-react';
import { db, today } from '../core/db';
import { pickOrder } from '../core/pipeline';
import { Pack } from './Pack';
import type { Batch, Order, Product, Shop } from '../core/types';

interface Row { product: Product; ordered: number; qty: number; batches: Batch[]; batchId?: string; mrp: number; done: boolean; extra?: boolean }

// Godown: pick each approved order. Qty up or down, batch (oldest first), MRP — never a new product.
export function PickOrders() {
  const [orders, setOrders0] = useState<(Order & { shop: Shop })[]>([]);
  const [loaded, setLoaded] = useState(false); // until the first load ends, say so — never "nothing here"
  const setOrders: typeof setOrders0 = v => { setLoaded(true); setOrders0(v); };
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
    // same product can be packed from two MRPs: each line goes to the bill as its own line
    return (
      <div className="stack">
        <div className="row" style={{ flexWrap: 'nowrap' }}><button className="icon-btn" onClick={() => setOpen(null)} aria-label="Back"><ArrowLeft /></button><div className="grow"><div className="h">{open.shop.name}</div><div className="muted">{open.shop.area} · {plural(rows.length, 'item')}</div></div></div>
        <div className="list">
          {rows.map((r, i) => {
            const p = r.product; const stock = r.batches.reduce((a, b) => a + b.qty, 0);
            const cs = Math.floor(r.qty / p.caseSize), pcs = r.qty % p.caseSize;
            return (
              <div key={i} className="card stack" style={{ gap: 8, opacity: r.done ? .6 : 1 }}>
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <Pack product={p} size="lg" />
                  <div className="grow">
                    <div className="t" style={{ fontSize: 18 }}>{p.name}</div>
                    <div className="s">{p.name} · {r.extra ? 'second MRP line' : <>{'ordered'} <b>{r.ordered}</b></>} · {'stock'} {stock}</div>
                    {(() => { const tot = rows.filter(x => x.product.id === p.id).reduce((a, x) => a + x.qty, 0); if (r.extra) return null; return tot < r.ordered ? <span className="badge bad"><AlertTriangle size={12} /> {'short'} {r.ordered - tot}</span> : tot > r.ordered ? <span className="badge warn">+{tot - r.ordered} {'extra'}</span> : null; })()}
                  </div>
                  <button className={`avatar ${r.done ? 'ok' : ''}`} style={{ width: 52, height: 52, borderRadius: 16, border: 0 }} onClick={() => upd(i, x => ({ ...x, done: !x.done }))} aria-label="Packed">{r.done ? <Check size={30} /> : <PackageOpen size={24} />}</button>
                </div>
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
                  <div className="stepper"><button aria-label="less" onClick={() => upd(i, x => ({ ...x, qty: Math.max(0, x.qty - 1), done: false }))}><Minus /></button><input type="number" value={r.qty} onChange={e => upd(i, x => ({ ...x, qty: Math.max(0, Number(e.target.value)), done: false }))} aria-label="Quantity" /><button aria-label="more" onClick={() => upd(i, x => ({ ...x, qty: x.qty + 1, done: false }))}><Plus /></button></div>
                  <span className="badge navy" style={{ fontSize: 14 }}>{cs ? `${cs} ${'cs'}` : ''}{cs && pcs ? ' + ' : ''}{pcs ? `${pcs} ${'pcs'}` : ''}{!r.qty ? '0' : ''}</span>
                </div>
                {r.batches.length > 0 && (
                  <div className="row" style={{ gap: 6 }}>
                    {r.batches.map(b => <button key={b.id} className={`chip ${r.batchId === b.id ? 'on' : ''}`} onClick={() => upd(i, x => ({ ...x, batchId: b.id, mrp: b.mrp }))}>{'batch'} {b.batch} · {b.expiry.slice(0, 7)} · MRP {b.mrp} · {b.qty}</button>)}
                  </div>
                )}
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}><span className="muted">MRP</span><input type="number" value={r.mrp} onChange={e => upd(i, x => ({ ...x, mrp: Number(e.target.value) }))} style={{ width: 100 }} aria-label="MRP" />{r.mrp !== (r.batches.find(b => b.id === r.batchId)?.mrp ?? p.mrp) && <span className="badge warn">{'MRP changed'}</span>}
                  <span className="grow" />
                  {!r.extra && r.batches.length > 1 && <button className="btn small" onClick={() => setRows(rs => { const other = r.batches.find(b => b.id !== r.batchId) ?? r.batches[0]; const copy: Row = { ...r, qty: 0, batchId: other.id, mrp: other.mrp, done: false, extra: true }; return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)]; })}><Copy size={14} /> {'Same product, other MRP'}</button>}
                  {r.extra && <button className="link" onClick={() => setRows(rs => rs.filter((_, k) => k !== i))}>{'remove'}</button>}</div>
              </div>
            );
          })}
        </div>
        <div className="sticky-foot">
          {!allDone && <div className="muted grow">{'Tick every line as you pack'}</div>}
          <button className="btn primary big grow" disabled={!allDone} onClick={async () => { await pickOrder(open.id, rows.filter(r => r.qty > 0 || !r.extra).map(r => ({ productId: r.product.id, qty: r.qty, batchId: r.batchId, mrp: r.mrp }))); setOpen(null); setTick(x => x + 1); }}><Check /> {'Packed → owner'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="sechead"><h3>{'Orders to pick'} · {orders.length}</h3></div>
      <div className="list">
        {orders.map(o => (
          <button key={o.id} className="item tap" onClick={() => start(o)}>
            <div className="avatar"><PackageOpen size={20} /></div>
            <div className="grow"><div className="t">{o.shop.name}</div><div className="s">{o.shop.area} · {plural(o.lines.length, 'item')} · {showDate(o.date)}</div></div>
            <span className="badge warn">{'pick'}</span>
          </button>
        ))}
        {!loaded && <div className="card muted">{'Loading…'}</div>}
      {loaded && !orders.length && <div className="card muted">{'Nothing to pick. Orders appear here after the owner approves them.'}</div>}
      </div>
    </div>
  );
}
