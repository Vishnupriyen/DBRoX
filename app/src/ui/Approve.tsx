import { useEffect, useMemo, useState } from 'react';
import { Check, X, Printer, Lock, CheckCheck } from 'lucide-react';
import { db, getSettings } from '../core/db';
import { isInterState } from '../core/gst';
import { orderView } from '../core/orderEdit';
import { billingLockedBy, rejectOrder } from '../core/pipeline';
import { makeBillBlock, setPicked, verifyAll, verifyAndBill, verifyRows, type VerifyRow } from '../core/verify';
import { inr, plural, showTime } from '../core/i18n';
import { askText, notify } from './dialog';
import { NumBox } from './OrdersReceived';
import { PrintBill } from './PrintBill';
import type { Invoice, Order, Product, Role, Scheme, Settings, Shop } from '../core/types';

// Bill → Verify picked (Part 2 item 9, docs/PART2_UX.md 2c): the bill table with Ordered and Picked per line. Picked defaults
// to Ordered, "Verify all" for a full match; short in red, extra in amber; one button "Make bill", blocked with the reason.
// The godown sees Ordered/Picked only (no rate, no Disc %). The logic is core/verify.ts.
export function Approve({ go, role = 'owner' }: { go?: (p: string) => void; role?: Role }) {
  const [orders, setOrders0] = useState<(Order & { shop: Shop })[]>([]);
  const [loaded, setLoaded] = useState(false); // until the first load ends, say so — never "nothing here"
  const setOrders: typeof setOrders0 = v => { setLoaded(true); setOrders0(v); };
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [cfg, setCfg] = useState<Settings | undefined>(undefined);
  const [staff, setStaff] = useState<Map<string, string>>(new Map());
  const [shopName, setShopName] = useState<Map<string, string>>(new Map());
  const [rows, setRows] = useState<Record<string, VerifyRow[]>>({}); // orderId → the rows as verified on screen
  const [tick, setTick] = useState(0);
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const [made, setMade] = useState<Invoice[]>([]);
  const [locked, setLocked] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const showRates = role !== 'godown';
  useEffect(() => {
    (async () => {
      const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
      setShopName(new Map([...shops.values()].map(s => [s.id, s.name])));
      setProducts(new Map((await db.products.toArray()).map(p => [p.id, p])));
      setSchemes(await db.schemes.toArray()); setCfg(await getSettings());
      setStaff(new Map((await db.staff.toArray()).map(s => [s.id, s.name.split(' ')[0]])));
      const os = (await db.orders.toArray()).filter(o => o.status === 'picked').sort((a, b) => (a.pickedAt ?? '').localeCompare(b.pickedAt ?? ''));
      setOrders(os.map(o => ({ ...o, shop: shops.get(o.shopId)! })));
      setRows(Object.fromEntries(os.map(o => [o.id, verifyRows(o)])));
      setLocked(await billingLockedBy());
    })();
  }, [tick]);
  // the reason "Make bill" can't go ahead, worked out again whenever a Picked number changes
  const key = JSON.stringify(rows);
  useEffect(() => { (async () => {
    const out: Record<string, string | null> = {};
    for (const o of orders) out[o.id] = rows[o.id] ? await makeBillBlock(o, rows[o.id]) : null;
    setBlocks(out);
  })(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRow = (oid: string, i: number, r: VerifyRow) => setRows(m => ({ ...m, [oid]: m[oid].map((x, k) => (k === i ? r : x)) }));
  const bill = async (o: Order) => {
    if (saving) return; setSaving(o.id);
    try {
      const r = await verifyAndBill(o.id, rows[o.id]);
      setMade(m => [...r.invoices, ...m].sort((a, b) => a.number.localeCompare(b.number))); setTick(x => x + 1);
    } catch (e) { await notify('Could not bill', (e as Error).message); setTick(x => x + 1); } finally { setSaving(null); }
  };

  return (
    <div className="stack">
      {printing && <PrintBill invoice={printing} onClose={() => setPrinting(null)} />}
      <div className="sechead"><h3>{'Verify picked'} · {orders.length}</h3></div>
      {locked && showRates && <div className="alert bad"><Lock /><div><b>{'Billing is locked'}</b> — {`close ${locked} first.`} {go && <button className="link" onClick={() => go('dayclose')}>{'Day close →'}</button>}</div></div>}
      {made.length > 0 && <div className="alert ok"><Check /><div><b>{plural(made.length, 'bill')} {'made'}</b> <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>{made.map(i => <button key={i.id} className="btn small" onClick={() => setPrinting(i)}><Printer /> <span className="billno">{i.number}</span> · {shopName.get(i.shopId) ?? ''}</button>)}</div></div></div>}
      {orders.map(o => (
        <VerifyCard key={o.id} o={o} rows={rows[o.id] ?? []} products={products} schemes={schemes} inter={isInterState(o.shop, cfg ?? { stateCode: '' })}
          packer={staff.get(o.pickedBy ?? '') ?? 'godown'} showRates={showRates} block={locked ? `Billing is locked: close ${locked} first` : blocks[o.id] ?? null} busy={saving === o.id}
          onRow={(i, r) => setRow(o.id, i, r)} onAll={() => setRows(m => ({ ...m, [o.id]: verifyAll(m[o.id]) }))} onBill={() => void bill(o)}
          onCancel={async () => { const r = await askText('Why cancel?'); if (!r) return; await rejectOrder(o.id, r); setTick(x => x + 1); }} />
      ))}
      {!loaded && <div className="card muted">{'Loading…'}</div>}
      {loaded && !orders.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{'Nothing to verify.'}</div>}
    </div>
  );
}

function VerifyCard({ o, rows, products, schemes, inter, packer, showRates, block, busy, onRow, onAll, onBill, onCancel }: {
  o: Order & { shop: Shop }; rows: VerifyRow[]; products: Map<string, Product>; schemes: Scheme[]; inter: boolean; packer: string; showRates: boolean;
  block: string | null; busy: boolean; onRow: (i: number, r: VerifyRow) => void; onAll: () => void; onBill: () => void; onCancel: () => void;
}) {
  // what the bill will be: the same schemes, Disc %, tax and round-off as billing
  const view = useMemo(() => orderView(rows.map(r => ({ productId: r.productId, qty: r.picked, rate: r.rate, discountPct: r.discountPct, line: r.line })), products, schemes, inter), [rows, products, schemes, inter]);
  const diffs = rows.filter(r => r.state !== 'ok').length;
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div className="grow" style={{ minWidth: 0 }}><div className="t" style={{ fontWeight: 700, fontSize: 'var(--f4)' }}>{o.shop.name}</div><div className="muted">{o.shop.area} · {'packed by'} {packer}{o.pickedAt ? ` at ${showTime(o.pickedAt)}` : ''}</div></div>
        {showRates && <span className="amt num">{inr(view.total)}</span>}
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{diffs ? `${plural(diffs, 'line')} not as ordered` : 'Packed exactly as ordered'}</span>
        {diffs > 0 && <button className="btn small" onClick={onAll}><CheckCheck size={14} /> {'Verify all'}</button>}
      </div>
      {rows.map((r, i) => {
        const p = products.get(r.productId); const v = view.rows[i];
        const mrps = r.parts.filter(x => x.mrp && x.mrp !== p?.mrp).map(x => x.mrp);
        return (
          <div key={`${r.line}-${i}`} className={`linecard ${r.state === 'ok' ? '' : r.state}`}>
            <div className="lc-head"><div className="lc-name">{i + 1}. {p?.name ?? 'Unknown item'}{mrps.length ? <span className="badge bad" style={{ marginLeft: 6 }}>MRP {mrps.join(', ')}</span> : null}</div></div>
            <div className="lc-boxes pick-first">
              <div className="lc-box"><label>{'Picked'}</label><NumBox whole value={r.picked} onChange={n => onRow(i, setPicked(r, n))} label={`Picked ${p?.name ?? ''}`} /></div>
              {showRates && <div className="lc-box"><label>{'Rate'}</label><NumBox value={r.rate} onChange={n => onRow(i, { ...r, rate: n })} label="Rate" /></div>}
              {showRates && <div className="lc-box"><label>{'Disc %'}</label><NumBox value={r.discountPct ?? v?.discountPct ?? 0} onChange={n => onRow(i, { ...r, discountPct: n })} label="Disc %" />{v && v.discount > 0 && <div className="lc-note">= {inr(v.discount)}</div>}</div>}
            </div>
            <div className="lc-foot"><span>{'Ordered'} {r.ordered}{r.note && <> · <span className={r.state === 'short' ? 'lc-short' : 'lc-extra'}>{r.note}</span></>}{showRates ? ` · ${v?.unit ?? 'PCS'} · GST ${p?.gst ?? 0}%` : ''}</span>{showRates && <span className="lc-amt num">{inr(v?.amount ?? 0)}</span>}</div>
          </div>
        );
      })}
      {showRates && <div className="bill-totals">
        <div><span>{'Taxable'}</span><b className="num">{inr(view.taxable)}</b></div>
        <div><span>{'Tax'}</span><b className="num">{inr(view.tax)}</b></div>
        <div><span>{'Round-off'}</span><b className="num">{view.roundOff.toFixed(2)}</b></div>
        <div className="grand"><span>{'Total'}</span><b className="num" style={{ color: 'var(--jade)' }}>{inr(view.total)}</b></div>
      </div>}
      {showRates && <div className="row" style={{ flexWrap: 'nowrap' }}>
        <button className="btn primary big grow" disabled={!!block || busy} onClick={onBill}><Check /> {busy ? 'Saving…' : block ?? 'Make bill'}</button>
        <button className="btn" onClick={onCancel} aria-label="Cancel order"><X /></button>
      </div>}
    </div>
  );
}
