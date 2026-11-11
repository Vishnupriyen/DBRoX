import { useEffect, useState } from 'react';
import { Check, X, Printer, Lock, Minus, Plus } from 'lucide-react';
import { db, getSettings } from '../core/db';
import { billValueOf } from '../core/billing';
import { isInterState } from '../core/gst';
import { approvePicked, billingLockedBy, rejectOrder } from '../core/pipeline';
import { inr, plural, showTime } from '../core/i18n';
import { askText } from './dialog';
import { Pack } from './Pack';
import { PrintBill } from './PrintBill';
import type { Invoice, Order, Product, Scheme, Settings, Shop } from '../core/types';


// Bill → Picked, to verify. Owner checks the physical pack against the screen, may edit, taps Done → bill. No send-back.
export function Approve({ go }: { go?: (p: string) => void }) {
  const [orders, setOrders0] = useState<(Order & { shop: Shop })[]>([]);
  const [loaded, setLoaded] = useState(false); // until the first load ends, say so — never "nothing here"
  const setOrders: typeof setOrders0 = v => { setLoaded(true); setOrders0(v); };
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [cfg, setCfg] = useState<Settings | undefined>(undefined);
  const [staff, setStaff] = useState<Map<string, string>>(new Map());
  const [shopName, setShopName] = useState<Map<string, string>>(new Map());
  const [edit, setEdit] = useState<Record<string, Record<number, number>>>({}); // orderId → picked line index → qty
  const [tick, setTick] = useState(0);
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const [made, setMade] = useState<Invoice[]>([]);
  const [locked, setLocked] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
      setShopName(new Map([...shops.values()].map(s => [s.id, s.name])));
      setProducts(new Map((await db.products.toArray()).map(p => [p.id, p])));
      setSchemes(await db.schemes.toArray()); setCfg(await getSettings());
      setStaff(new Map((await db.staff.toArray()).map(s => [s.id, s.name.split(' ')[0]])));
      const os = (await db.orders.toArray()).filter(o => o.status === 'picked').sort((a, b) => (a.pickedAt ?? '').localeCompare(b.pickedAt ?? ''));
      setOrders(os.map(o => ({ ...o, shop: shops.get(o.shopId)! })));
      setLocked(await billingLockedBy());
    })();
  }, [tick]);

  const pickedOf = (o: Order): NonNullable<Order['picked']> => o.picked ?? o.lines.map(l => ({ productId: l.productId, qty: l.qty }));
  const qtyAt = (o: Order, i: number) => edit[o.id]?.[i] ?? pickedOf(o)[i].qty;
  // the amount shown is what the bill will be: the same schemes, tax and round-off as billing (core/billing.ts)
  const value = (o: Order & { shop: Shop }) => billValueOf(pickedOf(o).map((pk, i) => ({ productId: pk.productId, qty: qtyAt(o, i), rate: o.lines.find(x => x.productId === pk.productId)?.rate ?? 0 })), products, schemes, isInterState(o.shop, cfg ?? { stateCode: '' }));
  const [saving, setSaving] = useState<string | null>(null);
  const done = async (o: Order) => {
    if (saving) return; setSaving(o.id);
    try { await doneOnce(o); } catch (e) { const { notify } = await import('./dialog'); await notify('Could not bill', (e as Error).message); } finally { setSaving(null); }
  };
  const doneOnce = async (o: Order) => {
    const picked = pickedOf(o).map((p, i) => ({ ...p, qty: qtyAt(o, i) }));
    const { ChangeSet } = await import('../core/db');
    const cs = new ChangeSet(); cs.put('orders', { ...o, picked }, 'verified'); await cs.commit('Verified');
    const r = await approvePicked(o.id); setMade(m => [...r.invoices, ...m].sort((a, b) => a.number.localeCompare(b.number))); setTick(x => x + 1);
  };

  return (
    <div className="stack">
      {printing && <PrintBill invoice={printing} onClose={() => setPrinting(null)} />}
      <div className="sechead"><h3>{'Picked — to verify'} · {orders.length}</h3></div>
      {locked && <div className="alert bad"><Lock /><div><b>{'Billing is locked'}</b> — {`close ${locked} first.`} {go && <button className="link" onClick={() => go('dayclose')}>{'Day close →'}</button>}</div></div>}
      {made.length > 0 && <div className="alert ok"><Check /><div><b>{plural(made.length, 'bill')} {'made'}</b> <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>{made.map(i => <button key={i.id} className="btn small" onClick={() => setPrinting(i)}><Printer /> {i.number} · {shopName.get(i.shopId) ?? ''}</button>)}</div></div></div>}
      {orders.map(o => {
        const pk = pickedOf(o);
        const orderedQty = (pid: string) => o.lines.find(l => l.productId === pid)?.qty ?? 0;
        const diffs = pk.filter((x, i) => qtyAt(o, i) !== orderedQty(x.productId) || (x.mrp && x.mrp !== products.get(x.productId)?.mrp) || pk.filter(y => y.productId === x.productId).length > 1).length;
        return (
          <div key={o.id} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><div className="t" style={{ fontWeight: 700, fontSize: '1.0625rem' }}>{o.shop.name}</div><div className="muted">{o.shop.area} · {'packed by'} {staff.get(o.pickedBy ?? '') ?? 'godown'}{o.pickedAt ? ` at ${showTime(o.pickedAt)}` : ''}</div></div>
              <span className="amt num">{inr(value(o))}</span>
            </div>
            {diffs ? <div className="muted">{plural(diffs, 'line')} {'changed by the picker — shown in red'}</div> : <div className="muted">{'Packed exactly as ordered'}</div>}
            <div className="list">
              {pk.map((x, i) => {
                const p = products.get(x.productId); const q = qtyAt(o, i); const ord = orderedQty(x.productId);
                const twin = pk.filter(y => y.productId === x.productId).length > 1;
                const changed = (!twin && q !== ord) || (x.mrp && x.mrp !== p?.mrp) || twin;
                return (
                  <div key={i} className="row" style={{ flexWrap: 'nowrap', color: changed ? 'var(--bad)' : undefined }}>
                    {p && <Pack product={p} />}
                    <span className="grow">{p?.name}{x.mrp && x.mrp !== p?.mrp ? <span className="badge bad" style={{ marginLeft: 6 }}>MRP {x.mrp}</span> : null}{twin ? <span className="badge warn" style={{ marginLeft: 6 }}>{'2 MRPs'}</span> : null}</span>
                    <div className="stepper small"><button aria-label="less" onClick={() => setEdit(e => ({ ...e, [o.id]: { ...e[o.id], [i]: Math.max(0, q - 1) } }))}><Minus /></button><input type="number" value={q} onChange={ev => setEdit(e => ({ ...e, [o.id]: { ...e[o.id], [i]: Math.max(0, Number(ev.target.value)) } }))} aria-label="Quantity" /><button aria-label="more" onClick={() => setEdit(e => ({ ...e, [o.id]: { ...e[o.id], [i]: q + 1 } }))}><Plus /></button></div>
                    {!twin && q !== ord && <span className="badge bad">{'of'} {ord}</span>}
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <button className="btn primary big grow" disabled={!!locked || saving === o.id} onClick={() => done(o)}><Check /> {'Done → bill'}</button>
              <button className="btn" onClick={async () => { const r = await askText('Why cancel?'); if (!r) return; await rejectOrder(o.id, r); setTick(x => x + 1); }} aria-label="Cancel"><X /></button>
            </div>
          </div>
        );
      })}
      {!loaded && <div className="card muted">{'Loading…'}</div>}
      {loaded && !orders.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{'Nothing to verify.'}</div>}
    </div>
  );
}
