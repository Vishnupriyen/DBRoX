import { useEffect, useMemo, useState } from 'react';
import { Check, X, Plus, Trash2, Printer } from 'lucide-react';
import { ChangeSet, db, getSettings } from '../core/db';
import { pickBatches } from '../core/billing';
import { r2 } from '../core/ledger';
import { inr } from '../core/i18n';
import { norm } from '../core/match';
import { notify } from './dialog';
import type { Invoice, InvoiceLine, Product, Settings, Shop } from '../core/types';


// Full bill editor, laid out like the bill itself: shop, every line (qty, rate, discount, MRP), add or remove lines.
// Allowed until the bill is printed; the number never changes; the original is kept inside the bill; stock is corrected.
export function BillEditor({ invoice, onClose }: { invoice: Invoice; onClose: (saved: boolean) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [shopId, setShopId] = useState(invoice.shopId);
  const [lines, setLines] = useState<InvoiceLine[]>(invoice.lines.map(l => ({ ...l })));
  const [q, setQ] = useState('');
  useEffect(() => { getSettings().then(setS); db.shops.toArray().then(x => setShops(x.filter(y => y.active !== false))); db.products.toArray().then(ps => setProducts(ps.filter(p => p.active && p.companyId === invoice.companyId))); }, [invoice]);
  const shop = shops.find(x => x.id === shopId);
  const inter = !!s && !!shop && (shop.gstin?.slice(0, 2) || s.stateCode) !== s.stateCode;

  const recalc = (l: InvoiceLine): InvoiceLine => {
    const gross = r2(l.qty * l.rate); const discount = r2(Math.min(gross, l.discount)); const taxable = r2(gross - discount); const tax = r2(taxable * l.gst / 100);
    return { ...l, gross, discount, taxable, cgst: inter ? 0 : r2(tax / 2), sgst: inter ? 0 : r2(tax - r2(tax / 2)), igst: inter ? tax : 0, total: r2(taxable + tax) };
  };
  const set = (i: number, patch: Partial<InvoiceLine>) => setLines(ls => ls.map((l, k) => k === i ? recalc({ ...l, ...patch }) : l));
  const totals = useMemo(() => {
    const taxable = r2(lines.reduce((a, l) => a + l.taxable, 0)), cgst = r2(lines.reduce((a, l) => a + l.cgst, 0)), sgst = r2(lines.reduce((a, l) => a + l.sgst, 0)), igst = r2(lines.reduce((a, l) => a + l.igst, 0));
    const exact = r2(taxable + cgst + sgst + igst); const total = Math.round(exact);
    return { taxable, cgst, sgst, igst, roundOff: r2(total - exact), total, saving: r2(lines.reduce((a, l) => a + l.discount + l.freeQty * l.rate, 0)) };
  }, [lines]);
  const addProduct = (p: Product) => {
    if (lines.some(l => l.productId === p.id)) return;
    setLines(ls => [...ls, recalc({ productId: p.id, name: p.name, hsn: p.hsn, qty: p.caseSize, freeQty: 0, rate: p.rate, mrp: p.mrp, gross: 0, discount: 0, taxable: 0, gst: p.gst, cgst: 0, sgst: 0, igst: 0, total: 0, batches: [], schemeNames: [] })]);
    setQ('');
  };
  const save = async () => {
    if (!shop) return;
    if (invoice.printedAt) { void notify('Printed bill', 'A printed bill cannot be edited — cancel with a remark or make a credit note.'); return; }
    const live = lines.filter(l => l.qty > 0);
    if (!live.length) { void notify('', 'A bill needs at least one line.'); return; }
    const cs = new ChangeSet();
    // stock: put the old picks back, take the new quantities out (oldest expiry first; keep the old batch where it still fits)
    const batches = await db.batches.toArray();
    for (const l of invoice.lines) for (const b of l.batches) { const x = batches.find(y => y.id === b.batchId); if (x) x.qty += b.qty; }
    const finalLines = live.map(l => {
      const need = l.qty + l.freeQty;
      const { picks } = pickBatches(batches, l.productId, need);
      for (const pk of picks) { const x = batches.find(y => y.id === pk.batchId)!; x.qty -= pk.qty; }
      return { ...l, batches: picks };
    });
    const touched = new Set([...invoice.lines.flatMap(l => l.batches.map(b => b.batchId)), ...finalLines.flatMap(l => l.batches.map(b => b.batchId))]);
    for (const id of touched) { const x = batches.find(y => y.id === id); if (x) cs.put('batches', { ...x }, 'bill edited'); }
    cs.put('invoices', { ...invoice, shopId: shop.id, kind: shop.gstin && shop.gstin.length === 15 ? 'B2B' : 'B2C', lines: finalLines, ...totals, schemeSaving: totals.saving, original: invoice.original ?? { lines: invoice.lines, total: invoice.total, at: new Date().toISOString() } }, 'bill edited before print');
    await cs.commit('Bill edited'); onClose(true);
  };
  if (!s) return null;
  const found = q ? products.filter(p => norm(p.name).includes(norm(q))).slice(0, 6) : [];
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
                  <td><button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => setLines(ls => ls.filter((_, k) => k !== i))} aria-label="Remove line"><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="field"><input placeholder={'Add a product…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Add product" />
            {found.length > 0 && <div className="list">{found.map(p => <button key={p.id} className="item tap" onClick={() => addProduct(p)}><Plus size={16} /><span className="grow">{p.name}</span><span className="muted">₹{p.rate} · MRP {p.mrp}</span></button>)}</div>}
          </div>
          <div className="bill-totals">
            <div><span>{'Taxable'}</span><b className="num">{inr(totals.taxable)}</b></div>
            {inter ? <div><span>IGST</span><b className="num">{inr(totals.igst)}</b></div> : <><div><span>CGST</span><b className="num">{inr(totals.cgst)}</b></div><div><span>SGST</span><b className="num">{inr(totals.sgst)}</b></div></>}
            <div><span>{'Round off'}</span><b className="num">{totals.roundOff}</b></div>
            <div className="grand"><span>{'Total'}</span><b className="num">{inr(totals.total)}</b></div>
            {totals.saving > 0 && <div className="muted"><span>{'You saved'}</span><b className="num">{inr(totals.saving)}</b></div>}
          </div>
          {invoice.printedAt ? <div className="alert"><Printer /><div>{'This bill is printed — editing is closed. Cancel with a remark, or make a credit note.'}</div></div>
            : <button className="btn primary big block" onClick={save}><Check /> {'Save bill (same number)'}</button>}
        </div>
      </div>
    </div>
  );
}
