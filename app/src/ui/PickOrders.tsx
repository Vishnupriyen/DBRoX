import { useEffect, useState } from 'react';
import { Check, ArrowLeft, AlertTriangle, PackageOpen } from 'lucide-react';
import { db } from '../core/db';
import { pickOrder, suggestPick } from '../core/pipeline';
import { getLang } from '../core/i18n';
import { Pack } from './Pack';
import type { Order, Product, Shop } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);
type Row = { product: Product; ordered: number; available: number; qty: number; picks: { batch: string; qty: number; expiry: string }[]; done: boolean };

// Godown: pick each new order. The app says which batch; short items are cut here, before the bill.
export function PickOrders() {
  const [orders, setOrders] = useState<(Order & { shop: Shop })[]>([]);
  const [open, setOpen] = useState<(Order & { shop: Shop }) | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => { const shops = new Map((await db.shops.toArray()).map(s => [s.id, s])); setOrders((await db.orders.where('status').equals('new').toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(o => ({ ...o, shop: shops.get(o.shopId)! }))); })(); }, [tick]);

  const start = async (o: Order & { shop: Shop }) => {
    const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
    const sug = await suggestPick(o);
    setRows(sug.map(s => ({ product: products.get(s.productId)!, ordered: s.ordered, available: s.available, qty: s.available, picks: s.picks, done: false })));
    setOpen(o);
  };

  if (open) {
    const allDone = rows.every(r => r.done || r.qty === 0);
    return (
      <div className="stack">
        <div className="row" style={{ flexWrap: 'nowrap' }}><button className="icon-btn" onClick={() => setOpen(null)} aria-label="Back"><ArrowLeft /></button><div className="grow"><div className="h">{open.shop.name}</div><div className="muted">{open.shop.area} · {rows.length} {L('items', 'பொருட்கள்')}</div></div></div>
        <div className="list">
          {rows.map((r, i) => (
            <button key={r.product.id} className="item tap" style={{ opacity: r.done ? .55 : 1, alignItems: 'flex-start' }} onClick={() => setRows(rs => rs.map((x, k) => k === i ? { ...x, done: !x.done } : x))}>
              <Pack product={r.product} size="lg" />
              <div className="grow">
                <div className="t" style={{ fontSize: 18 }}>{r.product.nameTa ?? r.product.name}</div>
                <div className="s">{r.product.name} · MRP {r.product.mrp}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  <span className="badge navy" style={{ fontSize: 15, padding: '5px 12px' }}>{Math.floor(r.qty / r.product.caseSize) ? `${Math.floor(r.qty / r.product.caseSize)} ${L('cs', 'கேஸ்')}` : ''}{Math.floor(r.qty / r.product.caseSize) && r.qty % r.product.caseSize ? ' + ' : ''}{r.qty % r.product.caseSize ? `${r.qty % r.product.caseSize} ${L('pcs', 'பீஸ்')}` : ''}{!r.qty ? '0' : ''}</span>
                  {r.available < r.ordered && <span className="badge bad"><AlertTriangle size={12} /> {L('short', 'குறைவு')} {r.ordered - r.available}</span>}
                  {r.picks.map(b => <span key={b.batch} className="badge">{L('batch', 'பேட்ச்')} <b>{b.batch}</b> · {b.qty}</span>)}
                </div>
              </div>
              <div className={`avatar ${r.done ? 'ok' : ''}`} style={{ width: 52, height: 52, borderRadius: 16 }}>{r.done ? <Check size={30} /> : <PackageOpen size={24} />}</div>
            </button>
          ))}
        </div>
        <div className="sticky-foot">
          {!allDone && <div className="muted grow">{L('Tick every line as you pack', 'ஒவ்வொரு வரியையும் டிக் செய்யவும்')}</div>}
          <button className="btn primary big grow" disabled={!allDone} onClick={async () => { await pickOrder(open.id, rows.map(r => ({ productId: r.product.id, qty: r.qty }))); setOpen(null); setTick(x => x + 1); }}><Check /> {L('Packed → owner', 'கட்டியது → உரிமையாளர்')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="sechead"><h3>{L('Orders to pick', 'எடுக்க வேண்டிய ஆர்டர்')} · {orders.length}</h3></div>
      <div className="list">
        {orders.map(o => (
          <button key={o.id} className="item tap" onClick={() => start(o)}>
            <div className="avatar"><PackageOpen size={22} /></div>
            <div className="grow"><div className="t">{o.shop.name}</div><div className="s">{o.shop.area} · {o.lines.length} {L('items', 'பொருட்கள்')} · {o.date}</div></div>
            <span className="badge gold">{L('pick', 'எடு')}</span>
          </button>
        ))}
        {!orders.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{L('Nothing to pick.', 'எடுக்க எதுவும் இல்லை.')}</div>}
      </div>
    </div>
  );
}
