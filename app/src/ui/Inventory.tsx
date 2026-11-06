import { useEffect, useMemo, useState } from 'react';
import { Check, ArrowLeft, AlertTriangle, Boxes, Camera, FileSpreadsheet, MessageSquareText, Split, Tag } from 'lucide-react';
import { ChangeSet, db, session, today } from '../core/db';
import { getLang, inr } from '../core/i18n';
import { r2 } from '../core/ledger';
import { PhotoButton } from './PhotoButton';
import { Pack } from './Pack';
import { askText, confirmBox } from './dialog';
import type { Batch, Company, Product } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);
const monthEnd = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).toISOString().slice(0, 10); };
const months = () => { const out: string[] = []; const d = new Date(); for (let i = 0; i < 36; i++) { const x = new Date(d.getFullYear(), d.getMonth() + i, 1); out.push(x.toISOString().slice(0, 7)); } return out; };
const isOwner = async () => { const me = await db.staff.get(session().userId); return me?.role === 'owner' || me?.role === 'office'; };

// ---------- Purchases / Stock in: photo or Excel go through RoX; manual entry here. Expiry month is mandatory. ----------
export function StockIn({ onRox }: { onRox?: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [rows, setRows] = useState<{ productId: string; qty: number; expiry: string; mrp: number; rate: number; batch: string }[]>([]);
  const [q, setQ] = useState('');
  const [billNo, setBillNo] = useState('');
  const [msg, setMsg] = useState('');
  const [all, setAll] = useState('');
  useEffect(() => { db.products.toArray().then(setProducts); db.companies.toArray().then(setCompanies); }, []);
  const pmap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const add = (p: Product) => { if (rows.some(r => r.productId === p.id)) return; setRows(r => [...r, { productId: p.id, qty: p.caseSize, expiry: '', mrp: p.mrp, rate: p.purchaseRate, batch: '' }]); setQ(''); };
  const bad = rows.filter(r => !r.expiry || r.qty <= 0);
  const save = async () => {
    if (bad.length) return;
    const cs = new ChangeSet();
    const existing = await db.batches.toArray();
    for (const r of rows) {
      const exp = monthEnd(r.expiry);
      const same = existing.find(b => b.productId === r.productId && b.expiry === exp && b.mrp === r.mrp && (!r.batch || b.batch === r.batch));
      if (same) cs.put('batches', { ...same, qty: same.qty + r.qty }, 'stock in (merged lot)');
      else cs.put<Batch>('batches', { productId: r.productId, batch: r.batch || `L${today().replace(/-/g, '').slice(2)}`, expiry: exp, mrp: r.mrp, qty: r.qty, godown: 'Main' }, 'stock in');
      const p = pmap.get(r.productId)!; if (r.rate !== p.purchaseRate) cs.put('products', { ...p, purchaseRate: r.rate }, 'purchase rate');
    }
    const companyId = pmap.get(rows[0].productId)?.companyId ?? companies[0]?.id ?? '';
    cs.put('purchases', { companyId, billNo: billNo || `MANUAL-${Date.now().toString().slice(-5)}`, date: today(), lines: rows.map(r => ({ productId: r.productId, batch: r.batch, expiry: monthEnd(r.expiry), mrp: r.mrp, qty: r.qty, freeQty: 0, rate: r.rate, discount: 0, gst: pmap.get(r.productId)?.gst ?? 0, amount: r2(r.qty * r.rate) })), taxable: r2(rows.reduce((a, r) => a + r.qty * r.rate, 0)), total: r2(rows.reduce((a, r) => a + r.qty * r.rate * (1 + (pmap.get(r.productId)?.gst ?? 0) / 100), 0)), paid: 0 }, 'purchase');
    await cs.commit('Stock in');
    setMsg(`${rows.length} ${L('items added to stock', 'பொருட்கள் ஸ்டாக்கில் சேர்ந்தன')}`); setRows([]); setBillNo('');
  };
  return (
    <div className="stack">
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={onRox}><Camera /> {L('Photo of company bill', 'கம்பெனி பில் போட்டோ')}</button>
        <button className="btn grow" onClick={onRox}><FileSpreadsheet /> {L('Excel from company', 'கம்பெனி Excel')}</button>
      </div>
      <div className="muted"><MessageSquareText size={14} style={{ verticalAlign: -2 }} /> {L('Both go through RoX: send the file, say "add this to inventory", approve the table. Or add by hand below.', 'இரண்டும் RoX வழியாக: ஃபைல் அனுப்பி "add this to inventory" என்று சொல்லுங்கள்.')}</div>
      <div className="card stack">
        <div className="field"><label>{L('Company bill no (optional)', 'கம்பெனி பில் எண்')}</label><input value={billNo} onChange={e => setBillNo(e.target.value)} /></div>
        <div className="field"><input placeholder={L('Search product to add…', 'பொருள் தேடு…')} value={q} onChange={e => setQ(e.target.value)} aria-label="Search product" /></div>
        {q && <div className="list">{products.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6).map(p => <button key={p.id} className="item tap" onClick={() => add(p)}><Pack product={p} /><span className="grow">{p.name}</span><span className="muted">MRP {p.mrp}</span></button>)}</div>}
        {rows.length > 1 && <div className="row" style={{ alignItems: 'center' }}><span className="muted">{L('Same expiry for all', 'எல்லாவற்றுக்கும் ஒரே காலாவதி')}</span><select value={all} onChange={e => { setAll(e.target.value); setRows(r => r.map(x => ({ ...x, expiry: e.target.value }))); }}><option value="">—</option>{months().map(m => <option key={m} value={m}>{m.slice(5)}/{m.slice(2, 4)}</option>)}</select></div>}
        {rows.map((r, i) => { const p = pmap.get(r.productId)!; return (
          <div key={r.productId} className="card stack" style={{ gap: 6, borderColor: !r.expiry ? 'var(--bad)' : undefined }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}><Pack product={p} /><span className="grow"><b>{p.name}</b></span><button className="link" onClick={() => setRows(rs => rs.filter((_, k) => k !== i))}>{L('remove', 'நீக்கு')}</button></div>
            <div className="row" style={{ gap: 8 }}>
              <div className="field"><label>{L('Pieces', 'பீஸ்')}</label><input type="number" value={r.qty || ''} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, qty: Number(e.target.value) } : x))} style={{ width: 90 }} /></div>
              <div className="field"><label style={{ color: !r.expiry ? 'var(--bad)' : undefined }}>{L('Expiry month *', 'காலாவதி மாதம் *')}</label><select value={r.expiry} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, expiry: e.target.value } : x))}><option value="">{L('pick', 'தேர்வு')}</option>{months().map(m => <option key={m} value={m}>{m.slice(5)}/{m.slice(2, 4)}</option>)}</select></div>
              <div className="field"><label>MRP</label><input type="number" value={r.mrp} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, mrp: Number(e.target.value) } : x))} style={{ width: 80 }} /></div>
              <div className="field"><label>{L('Rate', 'விலை')}</label><input type="number" value={r.rate} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, rate: Number(e.target.value) } : x))} style={{ width: 80 }} /></div>
              <div className="field"><label>{L('Batch (optional)', 'பேட்ச்')}</label><input value={r.batch} onChange={e => setRows(rs => rs.map((x, k) => k === i ? { ...x, batch: e.target.value } : x))} style={{ width: 100 }} /></div>
            </div>
          </div>); })}
        {rows.length > 0 && <button className="btn primary big block" disabled={bad.length > 0} onClick={save}><Check /> {bad.length ? L(`Fill expiry on ${bad.length} line(s)`, `${bad.length} வரிகளில் காலாவதி தேவை`) : L('Add to stock', 'ஸ்டாக்கில் சேர்')}</button>}
      </div>
      {msg && <div className="alert ok"><Check /><div>{msg}</div></div>}
      <RecentPurchases />
    </div>
  );
}

function RecentPurchases() {
  const [rows, setRows] = useState<{ billNo: string; date: string; company: string; total: number; paid: number }[]>([]);
  useEffect(() => { (async () => { const c = new Map((await db.companies.toArray()).map(x => [x.id, x.name])); setRows((await db.purchases.toArray()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(p => ({ billNo: p.billNo, date: p.date, company: c.get(p.companyId) ?? '', total: p.total, paid: p.paid ?? 0 }))); })(); }, []);
  if (!rows.length) return null;
  return <div className="card"><div className="sechead"><h3>{L('Company bills & dues', 'கம்பெனி பில்கள்')}</h3></div><div className="list">{rows.map(r => <div key={r.billNo} className="item"><div className="grow"><div className="t">{r.company} · {r.billNo}</div><div className="s">{r.date}</div></div><span className="amt num">{inr(r.total)}</span>{r.total - r.paid > 0.5 && <span className="badge warn">{L('due', 'நிலுவை')}</span>}</div>)}</div></div>;
}

// ---------- Stock position: company → product → lots. Godown sees counts; owner also sees value. ----------
export function StockPosition() {
  const [products, setProducts] = useState<Product[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [owner, setOwner] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => { setProducts(await db.products.toArray()); setCompanies(await db.companies.toArray()); setBatches((await db.batches.toArray()).filter(b => b.qty > 0)); setOwner(await isOwner()); })(); }, [tick]);
  const qty = (pid: string) => batches.filter(b => b.productId === pid).reduce((a, b) => a + b.qty, 0);
  const value = (pid: string) => qty(pid) * (products.find(p => p.id === pid)?.purchaseRate ?? 0);
  const lotsOf = (pid: string) => batches.filter(b => b.productId === pid).sort((a, b) => a.expiry.localeCompare(b.expiry));

  if (product) {
    const lots = lotsOf(product.id);
    return (
      <div className="stack">
        <div className="row" style={{ flexWrap: 'nowrap' }}><button className="icon-btn" onClick={() => setProduct(null)} aria-label="Back"><ArrowLeft /></button><Pack product={product} size="lg" /><div className="grow"><div className="h">{product.nameTa ?? product.name}</div><div className="muted">{product.name} · {qty(product.id)} pcs · {Math.floor(qty(product.id) / product.caseSize)} cs{owner ? ` · ${inr(value(product.id))}` : ''}</div></div></div>
        <div className="muted">{L('Oldest expiry on top — that lot goes out first.', 'பழைய காலாவதி மேலே — அது முதலில் போகும்.')}</div>
        <div className="list">
          {lots.map((b, k) => {
            const days = Math.round((new Date(b.expiry).getTime() - Date.now()) / 86400000);
            return (
              <div key={b.id} className="card stack" style={{ gap: 6 }}>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <span className="badge navy">{k + 1}</span>
                  <div className="grow"><b>{L('Expiry', 'காலாவதி')} {b.expiry.slice(5, 7)}/{b.expiry.slice(2, 4)}</b> <span className={`badge ${days <= 45 ? 'bad' : days <= 90 ? 'warn' : ''}`}>{days}d</span><div className="s">{L('batch', 'பேட்ச்')} {b.batch} · MRP {b.mrp} · {L('in', 'வந்தது')} {b.createdAt.slice(0, 10)}</div></div>
                  <b className="num">{b.qty} pcs</b>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn small" onClick={async () => { const n = await askText(L('How many pieces in the second lot?', 'இரண்டாம் லாட்டில் எத்தனை?')); const q = Number(n); if (!q || q >= b.qty) return; const cs = new ChangeSet(); cs.put('batches', { ...b, qty: b.qty - q }, 'split'); cs.put<Batch>('batches', { productId: b.productId, batch: b.batch + 'B', expiry: b.expiry, mrp: b.mrp, qty: q, godown: b.godown }, 'split lot'); await cs.commit('Lot split'); setTick(x => x + 1); }}><Split size={14} /> {L('Split', 'பிரி')}</button>
                  <button className="btn small" onClick={async () => { const m = await askText(L('New expiry month (MM/YY)', 'புதிய காலாவதி (MM/YY)')); if (!m || !/^\d{2}\/\d{2}$/.test(m)) return; const exp = monthEnd(`20${m.slice(3)}-${m.slice(0, 2)}`); const cs = new ChangeSet(); cs.put('batches', { ...b, expiry: exp }, `expiry changed ${b.expiry} → ${exp}`); await cs.commit('Expiry changed'); setTick(x => x + 1); }}><Tag size={14} /> {L('Change expiry', 'காலாவதி மாற்று')}</button>
                  <button className="btn small" onClick={async () => { const n = await askText(L('Counted pieces on the shelf?', 'எண்ணிய பீஸ்?')); const q = Number(n); if (Number.isNaN(q) || n === null) return; if (q === b.qty) return; const why = await askText(L('Remark for the difference', 'வித்தியாசத்திற்கு குறிப்பு')); if (!why) return; const cs = new ChangeSet(); cs.put('batches', { ...b, qty: q }, `count adjust ${b.qty} → ${q}: ${why}`); await cs.commit('Stock count'); setTick(x => x + 1); }}><Boxes size={14} /> {L('Count', 'எண்ணு')}</button>
                  <button className="btn small" onClick={async () => { const m = await askText(L('New MRP for this lot', 'இந்த லாட்டின் புதிய MRP'), String(b.mrp)); const v = Number(m); if (!m || !v) return; const cs = new ChangeSet(); cs.put('batches', { ...b, mrp: v }, `mrp ${b.mrp} → ${v}`); await cs.commit('MRP changed'); setTick(x => x + 1); }}><Tag size={14} /> MRP</button>
                  <button className="btn small" onClick={async () => { const m = await askText(L('Batch number', 'பேட்ச் எண்'), b.batch); if (m === null) return; const cs = new ChangeSet(); cs.put('batches', { ...b, batch: m }, `batch ${b.batch} → ${m}`); await cs.commit('Batch changed'); setTick(x => x + 1); }}><Tag size={14} /> {L('Batch', 'பேட்ச்')}</button>
                </div>
              </div>
            );
          })}
          {!lots.length && <div className="card muted">{L('No stock.', 'ஸ்டாக் இல்லை.')}</div>}
        </div>
      </div>
    );
  }
  if (company) {
    const ps = products.filter(p => p.companyId === company.id && p.active).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div className="stack">
        <div className="row" style={{ flexWrap: 'nowrap' }}><button className="icon-btn" onClick={() => setCompany(null)} aria-label="Back"><ArrowLeft /></button><div className="grow"><div className="h">{company.name}</div><div className="muted">{ps.length} {L('products', 'பொருட்கள்')}{owner ? ` · ${inr(ps.reduce((a, p) => a + value(p.id), 0))}` : ''}</div></div></div>
        <div className="list">
          {ps.map(p => { const q = qty(p.id); const lots = lotsOf(p.id); const soon = lots[0] && (new Date(lots[0].expiry).getTime() - Date.now()) / 86400000 <= 45; return (
            <button key={p.id} className="item tap" onClick={() => setProduct(p)}>
              <Pack product={p} />
              <div className="grow"><div className="t">{p.nameTa ?? p.name}</div><div className="s">{p.name} · {lots.length} {L('lot(s)', 'லாட்')}{soon ? ' · ' : ''}{soon && <span className="badge bad">{L('expiring', 'காலாவதி')}</span>}</div></div>
              <div style={{ textAlign: 'right' }}><b className={`num ${q === 0 ? 'bad' : ''}`} style={{ color: q === 0 ? 'var(--bad)' : undefined }}>{q} pcs</b><div className="s">{Math.floor(q / p.caseSize)} cs{owner ? ` · ${inr(value(p.id))}` : ''}</div></div>
            </button>); })}
        </div>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="list">
        {companies.map(c => { const ps = products.filter(p => p.companyId === c.id); const q = ps.reduce((a, p) => a + qty(p.id), 0); const out = ps.filter(p => p.active && qty(p.id) === 0).length; return (
          <button key={c.id} className="item tap" onClick={() => setCompany(c)}>
            <div className="avatar">{c.code.slice(0, 2)}</div>
            <div className="grow"><div className="t">{c.name}</div><div className="s">{ps.length} {L('products', 'பொருட்கள்')}{out ? ' · ' : ''}{out > 0 && <span className="badge bad">{out} {L('out of stock', 'ஸ்டாக் இல்லை')}</span>}</div></div>
            <div style={{ textAlign: 'right' }}><b className="num">{q} pcs</b>{owner && <div className="s">{inr(ps.reduce((a, p) => a + value(p.id), 0))}</div>}</div>
          </button>); })}
      </div>
    </div>
  );
}

// ---------- Ageing: stock by age, near-expiry list, one tap → clearance offer ----------
export function Ageing() {
  const [rows, setRows] = useState<{ p: Product; b: Batch; age: number; days: number; sold: number }[]>([]);
  const [msg, setMsg] = useState('');
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { (async () => {
    const pm = new Map((await db.products.toArray()).map(p => [p.id, p]));
    const sold = new Map<string, number>();
    for (const i of await db.invoices.toArray()) { if (i.cancelled) continue; for (const l of i.lines) for (const bb of l.batches) sold.set(bb.batchId, (sold.get(bb.batchId) ?? 0) + bb.qty); }
    setRows((await db.batches.toArray()).filter(b => b.qty > 0 || (sold.get(b.id) ?? 0) > 0).map(b => ({ p: pm.get(b.productId)!, b, sold: sold.get(b.id) ?? 0, age: Math.floor((Date.now() - new Date(b.createdAt).getTime()) / 86400000), days: Math.round((new Date(b.expiry).getTime() - Date.now()) / 86400000) })).filter(x => x.p));
  })(); }, [msg]);
  const buckets = [['0–30', 0, 30], ['31–60', 31, 60], ['61–90', 61, 90], ['90+', 91, 9999]] as const;
  const near = rows.filter(r => r.b.qty > 0 && r.days <= 60).sort((a, b) => a.days - b.days);
  const offer = async (r: typeof rows[0]) => {
    if (!await confirmBox(L(`Clearance offer on ${r.p.name}?`, `${r.p.name} மீது கிளியரன்ஸ் சலுகை?`), L('10% off till month end. Applies at billing and goes to Claims for you to keep or reject.', 'மாத இறுதி வரை 10% தள்ளுபடி.'), L('Make offer', 'சலுகை'))) return;
    const cs = new ChangeSet();
    cs.put('schemes', { companyId: r.p.companyId, productId: r.p.id, name: `Clearance ${r.p.name}`, type: 'pct', value: 10, from: today(), to: monthEnd(today().slice(0, 7)), source: 'own', combine: 'replace' }, 'clearance offer');
    await cs.commit('Clearance offer'); setMsg(`${L('Offer made on', 'சலுகை')} ${r.p.name}`);
  };
  return (
    <div className="stack">
      <div className="kpis">{buckets.map(([l, a, b]) => { const n = rows.filter(r => r.b.qty > 0 && r.age >= a && r.age <= b).reduce((s, r) => s + r.b.qty, 0); return <div key={l} className={`kpi ${b > 90 ? '' : ''}`}><div className="v" style={{ color: b > 90 && n ? 'var(--bad)' : undefined }}>{n}</div><div className="l">{l} {L('days', 'நாட்கள்')} · pcs</div></div>; })}</div>
      {msg && <div className="alert ok"><Check /><div>{msg}</div></div>}
      <div className="sechead"><h3>{L('Expiring within 60 days', '60 நாளில் காலாவதி')} · {near.length}</h3></div>
      <div className="list">
        {near.map(r => <div key={r.b.id} className="item"><Pack product={r.p} /><div className="grow"><div className="t">{r.p.name}</div><div className="s">{r.b.qty} pcs · {L('batch', 'பேட்ச்')} {r.b.batch} · <span className={`badge ${r.days <= 30 ? 'bad' : 'warn'}`}>{r.days}d</span></div></div><button className="btn small primary" onClick={() => offer(r)}>{L('Clear it', 'சலுகை')}</button></div>)}
        {!near.length && <div className="card muted">{L('Nothing near expiry. 🎉', 'காலாவதி நெருங்கும் ஸ்டாக் இல்லை.')}</div>}
      </div>
      <div className="sechead"><h3>{L('Every lot', 'ஒவ்வொரு லாட்')} · {rows.filter(r => r.b.qty > 0).length}</h3><button className="btn small" onClick={() => setShowAll(v => !v)}>{showAll ? L('Hide', 'மறை') : L('Show', 'காட்டு')}</button></div>
      {showAll && <table className="tbl"><thead><tr><th>{L('Product', 'பொருள்')}</th><th>{L('Lot', 'லாட்')}</th><th>{L('In', 'வந்தது')}</th><th>{L('Sold', 'விற்றது')}</th><th>{L('Left', 'மீதம்')}</th><th>{L('Age', 'வயது')}</th><th>{L('Expiry', 'காலாவதி')}</th></tr></thead>
        <tbody>{[...rows].sort((a, b) => b.age - a.age).map(r => <tr key={r.b.id} style={{ opacity: r.b.qty ? 1 : .5 }}><td>{r.p.name}</td><td>{r.b.batch || '—'}<br /><span className="muted">MRP {r.b.mrp}</span></td><td className="num">{r.b.qty + r.sold}</td><td className="num">{r.sold}</td><td className="num"><b>{r.b.qty}</b></td><td className="num">{r.age}d</td><td className={`num ${r.days <= 30 ? 'bad' : ''}`} style={{ color: r.days <= 60 && r.b.qty ? 'var(--bad)' : undefined }}>{r.b.expiry.slice(0, 7)}</td></tr>)}</tbody></table>}
    </div>
  );
}

// ---------- Damages: godown enters damaged / expired / leaked with photo → claim automatically ----------
export function Damages() {
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Product | null>(null);
  const [qty, setQty] = useState(0);
  const [kind, setKind] = useState<'damage' | 'expiry' | 'transit'>('damage');
  const [photo, setPhoto] = useState<string>();
  const [list, setList] = useState<{ id: string; name: string; qty: number; kind: string; amount: number; date: string }[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => { const ps = await db.products.toArray(); setProducts(ps); const pm = new Map(ps.map(p => [p.id, p.name])); setList((await db.claimEntries.toArray()).filter(c => c.kind !== 'scheme').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map(c => ({ id: c.id, name: pm.get(c.productId ?? '') ?? '', qty: c.qty, kind: c.kind, amount: c.amount, date: c.createdAt.slice(0, 10) }))); })(); }, [tick]);
  const save = async () => {
    if (!sel || qty <= 0) return;
    const cs = new ChangeSet();
    cs.put('claimEntries', { companyId: sel.companyId, month: today().slice(0, 7), kind, productId: sel.id, qty, amount: r2(qty * sel.purchaseRate), note: kind, photo }, 'damage');
    // reduce stock from the oldest lot
    const lots = (await db.batches.toArray()).filter(b => b.productId === sel.id && b.qty > 0).sort((a, b) => a.expiry.localeCompare(b.expiry));
    let left = qty; for (const b of lots) { if (left <= 0) break; const take = Math.min(b.qty, left); cs.put('batches', { ...b, qty: b.qty - take }, 'damaged out'); left -= take; }
    await cs.commit('Damage entry'); setSel(null); setQty(0); setPhoto(undefined); setQ(''); setTick(x => x + 1);
  };
  return (
    <div className="stack">
      <div className="card stack">
        {!sel ? <>
          <div className="eyebrow">{L('Add a damage — pick the product', 'சேதம் சேர் — பொருளை தேர்வு செய்')}</div>
          <div className="field"><input placeholder={L('Search product…', 'பொருள் தேடு…')} value={q} onChange={e => setQ(e.target.value)} aria-label="Product" /></div>
          <div className="list">{products.filter(p => p.active && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.nameTa ?? '').includes(q))).slice(0, q ? 8 : 12).map(p => <button key={p.id} className="item tap" onClick={() => setSel(p)}><Pack product={p} /><span className="grow">{p.name}</span><span className="muted">{p.nameTa}</span></button>)}</div>
        </> : <>
          <div className="row" style={{ flexWrap: 'nowrap' }}><Pack product={sel} size="lg" /><div className="grow"><b>{sel.name}</b></div><button className="link" onClick={() => setSel(null)}>{L('change', 'மாற்று')}</button></div>
          <div className="segmented">{(['damage', 'expiry', 'transit'] as const).map(k => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'damage' ? L('Damaged / leak', 'சேதம்') : k === 'expiry' ? L('Expired', 'காலாவதி') : L('In van', 'வண்டியில்')}</button>)}</div>
          <div className="field"><label>{L('Pieces', 'பீஸ்')}</label><input className="bigamount" type="number" value={qty || ''} onChange={e => setQty(Number(e.target.value))} /></div>
          <PhotoButton facing="environment" onPhoto={setPhoto} />
          <button className="btn primary big block" disabled={qty <= 0} onClick={save}><Check /> {L('Save → claim', 'சேமி → கிளைம்')}</button>
        </>}
      </div>
      <div className="list">{list.map(x => <div key={x.id} className="item"><div className="avatar bad"><AlertTriangle size={18} /></div><div className="grow"><div className="t">{x.name}</div><div className="s">{x.qty} pcs · {x.kind} · {x.date}</div></div><span className="amt num">{inr(x.amount)}</span></div>)}</div>
    </div>
  );
}

// ---------- Other reports: value by company, fast/slow movers, days of cover ----------
export function StockReports() {
  const [rows, setRows] = useState<{ name: string; qty: number; value: number; sold30: number; cover: number }[]>([]);
  useEffect(() => { (async () => {
    const ps = await db.products.toArray(); const bs = (await db.batches.toArray()).filter(b => b.qty > 0);
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const sold = new Map<string, number>(); for (const i of (await db.invoices.toArray()).filter(i => !i.cancelled && i.date >= since)) for (const l of i.lines) sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.qty);
    setRows(ps.map(p => { const q = bs.filter(b => b.productId === p.id).reduce((a, b) => a + b.qty, 0); const s = sold.get(p.id) ?? 0; return { name: p.name, qty: q, value: q * p.purchaseRate, sold30: s, cover: s ? Math.round(q / (s / 30)) : 999 }; }).sort((a, b) => b.sold30 - a.sold30));
  })(); }, []);
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="stack">
      <div className="kpi navy"><div className="v">{inr(total)}</div><div className="l">{L('stock at cost', 'ஸ்டாக் மதிப்பு')}</div></div>
      <div className="sechead"><h3>{L('Fast → slow (last 30 days)', 'வேகம் → மெது (30 நாள்)')}</h3></div>
      <table className="tbl"><thead><tr><th>{L('Product', 'பொருள்')}</th><th>{L('Sold', 'விற்றது')}</th><th>{L('Stock', 'ஸ்டாக்')}</th><th>{L('Days cover', 'நாள்')}</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.name}><td>{r.name}</td><td className="num">{r.sold30}</td><td className="num">{r.qty}</td><td className="num" style={{ color: r.cover < 5 ? 'var(--bad)' : r.cover > 60 ? 'var(--warn)' : undefined }}>{r.cover === 999 ? '—' : r.cover}</td></tr>)}</tbody></table>
    </div>
  );
}
