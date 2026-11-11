import { useEffect, useMemo, useState } from 'react';
import { Check, X, Plus, Trash2, Printer } from 'lucide-react';
import { db, getSettings, today } from '../core/db';
import { activeSchemes, billLine, billTotals } from '../core/billing';
import { billChangeBlock, isInterState } from '../core/gst';
import { saveBillEdit } from '../core/pipeline';
import { inr } from '../core/i18n';
import { norm } from '../core/match';
import { notify } from './dialog';
import type { Invoice, InvoiceLine, Product, Scheme, Settings, Shop } from '../core/types';

type Edit = { productId: string; qty: number; rate: number; mrp: number; discount?: number }; // discount set only when typed by hand

// Full bill editor, laid out like the bill itself: shop, every line (qty, rate, discount, MRP), add or remove lines.
// Allowed until the bill is printed or delivered (and before the month's GST return); the number never changes; the
// original is kept inside the bill. Prices, free pieces and stock are worked out by the same core code as a new bill.
export function BillEditor({ invoice, onClose }: { invoice: Invoice; onClose: (saved: boolean) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [shopId, setShopId] = useState(invoice.shopId);
  const [edits, setEdits] = useState<Edit[]>(invoice.lines.map(l => ({ productId: l.productId, qty: l.qty, rate: l.rate, mrp: l.mrp })));
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { getSettings().then(setS); db.shops.toArray().then(x => setShops(x.filter(y => y.active !== false))); db.products.toArray().then(ps => setProducts(ps.filter(p => p.companyId === invoice.companyId))); db.schemes.toArray().then(setSchemes); }, [invoice]);
  const shop = shops.find(x => x.id === shopId);
  const inter = !!s && !!shop && isInterState(shop, s);
  const pmap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const lines: InvoiceLine[] = useMemo(() => edits.flatMap(e => { const p = pmap.get(e.productId); return p ? [billLine(p, Math.max(0, Math.floor(e.qty)), e.rate, activeSchemes(schemes, p, invoice.date), inter, { mrp: e.mrp, discount: e.discount })] : []; }), [edits, pmap, schemes, inter, invoice.date]);
  const set = (i: number, patch: Partial<Edit>) => setEdits(es => es.map((e, k) => k === i ? { ...e, ...patch } : e));
  const totals = useMemo(() => { const t = billTotals(lines); return { ...t, saving: t.schemeSaving }; }, [lines]);
  const addProduct = (p: Product) => {
    if (edits.some(l => l.productId === p.id)) return;
    setEdits(es => [...es, { productId: p.id, qty: p.caseSize, rate: p.rate, mrp: p.mrp }]);
    setQ('');
  };
  const block = billChangeBlock(invoice, 'edit', today());
  const save = async () => {
    if (!shop || saving) return;
    if (block) { void notify('Bill can\'t be changed', block); return; }
    setSaving(true);
    try { await saveBillEdit(invoice.id, shop.id, edits.map(e => ({ ...e, qty: Math.floor(e.qty) }))); onClose(true); }
    catch (e) { await notify('Not saved', (e as Error).message); }
    finally { setSaving(false); }
  };
  if (!s) return null;
  const found = q ? products.filter(p => p.active && norm(p.name).includes(norm(q))).slice(0, 6) : [];
  return (
    <div className="sheet-wrap" onClick={() => onClose(false)}>
      <div className="sheet" onClick={e => e.stopPropagation()} style={{ height: 'min(92vh, 900px)' }}>
        <div className="sheet-head"><b className="grow">{'Edit bill'} {invoice.number}</b><button className="icon-btn" onClick={() => onClose(false)} aria-label="Close"><X /></button></div>
        <div className="stack" style={{ padding: 14, overflowY: 'auto', gap: 10 }}>
          {/* bill head, laid out as on paper */}
          <div className="bill-head">
            <div><b>{s.firmName}</b><div className="muted">{s.address}</div><div className="muted">GSTIN {s.gstin}</div></div>
            <div style={{ textAlign: 'right' }}><b>{'TAX INVOICE'}</b><div>{invoice.number}</div><div className="muted">{invoice.date.split('-').reverse().join('-')}</div></div>
          </div>
          <div className="field"><label>{'Bill to'}</label>
            <select value={shopId} onChange={e => setShopId(e.target.value)}>{shops.map(x => <option key={x.id} value={x.id}>{x.name} · {x.area}</option>)}</select>
            {shop && <div className="muted">{shop.address ?? shop.area}{shop.gstin ? ` · GSTIN ${shop.gstin}` : ` · B2C`}</div>}
          </div>
          <table className="tbl bill-tbl">
            <thead><tr><th>{'Item'}</th><th>{'Qty'}</th><th>{'Rate'}</th><th>{'Disc ₹'}</th><th>GST</th><th className="num">{'Amount'}</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><b>{l.name}</b><div className="muted">MRP <input type="number" value={l.mrp} onChange={e => set(i, { mrp: Number(e.target.value) })} style={{ width: 64 }} aria-label="MRP" />{l.freeQty ? ` · +${l.freeQty} free` : ''}</div></td>
                  <td><input type="number" value={l.qty} onChange={e => set(i, { qty: Math.max(0, Number(e.target.value)) })} style={{ width: 64 }} aria-label="Quantity" /></td>
                  <td><input type="number" value={l.rate} onChange={e => set(i, { rate: Number(e.target.value) })} style={{ width: 76 }} aria-label="Rate" /></td>
                  <td><input type="number" value={l.discount} onChange={e => set(i, { discount: Number(e.target.value) })} style={{ width: 70 }} aria-label="Discount" /></td>
                  <td className="muted">{l.gst}%</td>
                  <td className="num">{inr(l.total)}</td>
                  <td><button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => setEdits(es => es.filter((_, k) => k !== i))} aria-label="Remove line"><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="field"><input placeholder={'Add a product…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Add product" />
            {found.length > 0 && <div className="list">{found.map(p => <button key={p.id} className="item tap" onClick={() => addProduct(p)}><Plus size={16} /><span className="grow">{p.name}</span><span className="muted">{inr(p.rate)} · MRP {p.mrp}</span></button>)}</div>}
          </div>
          <div className="bill-totals">
            <div><span>{'Taxable'}</span><b className="num">{inr(totals.taxable)}</b></div>
            {inter ? <div><span>IGST</span><b className="num">{inr(totals.igst)}</b></div> : <><div><span>CGST</span><b className="num">{inr(totals.cgst)}</b></div><div><span>SGST</span><b className="num">{inr(totals.sgst)}</b></div></>}
            <div><span>{'Round off'}</span><b className="num">{totals.roundOff}</b></div>
            <div className="grand"><span>{'Total'}</span><b className="num">{inr(totals.total)}</b></div>
            {totals.saving > 0 && <div className="muted"><span>{'You saved'}</span><b className="num">{inr(totals.saving)}</b></div>}
          </div>
          {block ? <div className="alert"><Printer /><div>{block}</div></div>
            : <button className="btn primary big block" disabled={saving} onClick={save}><Check /> {'Save bill (same number)'}</button>}
        </div>
      </div>
    </div>
  );
}
