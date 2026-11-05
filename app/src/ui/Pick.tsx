import { useEffect, useMemo, useState } from 'react';
import { Check, Truck, PackageOpen, AlertTriangle } from 'lucide-react';
import { db } from '../core/db';
import { getLang, inr } from '../core/i18n';
import type { Invoice, Product, Van } from '../core/types';
import { Pack } from './Pack';

interface Line { product: Product; qty: number; batches: { batch: string; expiry: string; qty: number }[]; shops: { name: string; qty: number }[] }
const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);

// Godown: one load sheet per van (4.6). Picture first, Tamil name, exact batch (oldest first),
// cases + pieces, tick every line before the van leaves.
export function Pick() {
  const [vans, setVans] = useState<Van[]>([]);
  const [vanId, setVanId] = useState<string>('');
  const [invs, setInvs] = useState<Invoice[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [shops, setShops] = useState<Map<string, string>>(new Map());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [bySh, setBySh] = useState(false);

  useEffect(() => {
    (async () => {
      const vs = (await db.vans.toArray()).sort((a, b) => a.name.localeCompare(b.name)); setVans(vs);
      const pend = (await db.invoices.where('deliveryStatus').equals('pending').toArray()).filter(i => !i.cancelled);
      setInvs(pend);
      if (!vanId && vs.length) { const busiest = vs.map(v => ({ v, n: pend.filter(i => i.vanId === v.id || !i.vanId).length })).sort((a, b) => b.n - a.n)[0]; setVanId(busiest.v.id); }
      setProducts(new Map((await db.products.toArray()).map(p => [p.id, p])));
      setShops(new Map((await db.shops.toArray()).map(s => [s.id, s.name])));
    })();
  }, [vanId]);

  const mine = useMemo(() => invs.filter(i => !i.vanId || i.vanId === vanId), [invs, vanId]);
  const lines = useMemo(() => {
    const m = new Map<string, Line>();
    for (const i of mine) for (const l of i.lines) {
      const p = products.get(l.productId); if (!p) continue;
      const v = m.get(p.id) ?? { product: p, qty: 0, batches: [], shops: [] };
      v.qty += l.qty + l.freeQty;
      for (const b of l.batches) { const e = v.batches.find(x => x.batch === b.batch); if (e) e.qty += b.qty; else v.batches.push({ ...b }); }
      v.shops.push({ name: shops.get(i.shopId) ?? '', qty: l.qty + l.freeQty });
      m.set(p.id, v);
    }
    return [...m.values()].sort((a, b) => a.product.companyId.localeCompare(b.product.companyId) || a.product.name.localeCompare(b.product.name));
  }, [mine, products, shops]);

  const total = mine.reduce((a, i) => a + i.total, 0);
  const allDone = lines.length > 0 && lines.every(l => ticked.has(l.product.id));
  const toggle = (id: string) => setTicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="stack">
      <div className="segmented">
        {vans.map(v => <button key={v.id} className={vanId === v.id ? 'on' : ''} onClick={() => { setVanId(v.id); setTicked(new Set()); }}><Truck size={16} style={{ verticalAlign: -3 }} /> {v.name}</button>)}
      </div>
      <div className="kpi navy">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><div className="v">{mine.length} <span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>{L('bills', 'பில்')}</span></div><div className="l">{[...new Set(mine.map(i => i.shopId))].length} {L('shops', 'கடைகள்')} · {inr(total)}</div></div>
          <div style={{ textAlign: 'right' }}><div className="v">{ticked.size}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{lines.length}</span></div><div className="l">{L('lines picked', 'எடுத்தது')}</div></div>
        </div>
      </div>
      <div className="segmented" style={{ maxWidth: 320 }}>
        <button className={!bySh ? 'on' : ''} onClick={() => setBySh(false)}>{L('Pick (by product)', 'எடு (பொருள் வாரியாக)')}</button>
        <button className={bySh ? 'on' : ''} onClick={() => setBySh(true)}>{L('Pack (by shop)', 'கட்டு (கடை வாரியாக)')}</button>
      </div>

      {!bySh ? (
        <div className="list">
          {lines.map(l => {
            const p = l.product; const done = ticked.has(p.id);
            const cs = Math.floor(l.qty / p.caseSize), pcs = l.qty % p.caseSize;
            return (
              <button key={p.id} className={`item tap ${done ? '' : ''}`} style={{ opacity: done ? .55 : 1, alignItems: 'flex-start' }} onClick={() => toggle(p.id)}>
                <Pack product={p} size="lg" />
                <div className="grow">
                  <div className="t" style={{ fontSize: 18 }}>{p.nameTa ?? p.name}</div>
                  <div className="s">{p.name} · MRP {p.mrp}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="badge navy" style={{ fontSize: 15, padding: '5px 12px' }}>{cs ? `${cs} ${L('cs', 'கேஸ்')}` : ''}{cs && pcs ? ' + ' : ''}{pcs ? `${pcs} ${L('pcs', 'பீஸ்')}` : ''}</span>
                    {l.batches.sort((a, b) => a.expiry.localeCompare(b.expiry)).map(b => <span key={b.batch} className="badge">{L('batch', 'பேட்ச்')} <b>{b.batch}</b> · {b.qty}</span>)}
                  </div>
                </div>
                <div className={`avatar ${done ? 'ok' : ''}`} style={{ width: 52, height: 52, borderRadius: 16 }}>{done ? <Check size={30} /> : <PackageOpen size={24} />}</div>
              </button>
            );
          })}
          {!lines.length && <div className="card muted">{L('Nothing to load for this van.', 'இந்த வண்டிக்கு ஏற்ற எதுவும் இல்லை.')}</div>}
        </div>
      ) : (
        <div className="stack">
          {[...new Set(mine.map(i => i.shopId))].map(sid => {
            const sInv = mine.filter(i => i.shopId === sid);
            return (
              <div key={sid} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 17 }}>{shops.get(sid)}</b><span className="muted">{sInv.map(i => i.number).join(', ')}</span></div>
                <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                  {sInv.flatMap(i => i.lines).map((l, k) => { const p = products.get(l.productId)!; return <div key={k} className="row" style={{ flexWrap: 'nowrap' }}><Pack product={p} /><span className="grow">{p.nameTa ?? p.name}</span><b className="num">{l.qty + l.freeQty} pcs</b></div>; })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lines.length > 0 && (
        <div className="sticky-foot">
          {!allDone && <div className="muted grow"><AlertTriangle size={16} style={{ verticalAlign: -3 }} /> {L('Tick every line before the van leaves', 'வண்டி கிளம்பும் முன் எல்லா வரிகளையும் டிக் செய்யவும்')}</div>}
          <button className="btn primary big grow" disabled={!allDone}><Truck /> {L('Van loaded', 'வண்டி ஏற்றப்பட்டது')}</button>
        </div>
      )}
    </div>
  );
}
