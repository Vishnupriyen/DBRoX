import { useEffect, useMemo, useState } from 'react';
import { Check, Truck, AlertTriangle } from 'lucide-react';
import { db, today } from '../core/db';
import { tripLoaded } from '../core/pipeline';
import { inr, plural } from '../core/i18n';
import type { Invoice, Product, Trip, Van } from '../core/types';
import { Pack } from './Pack';

interface Line { product: Product; qty: number; batches: { batch: string; expiry: string; qty: number }[]; shops: { name: string; qty: number }[] }

// Godown: one load sheet per van (4.6). Picture first, product name, exact batch (oldest first),
// cases + pieces, tick every line before the van leaves.
export function Pick() {
  const [vans, setVans] = useState<Van[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vanId, setVanId] = useState<string>('');
  const [tick, setTick] = useState(0);
  const [invs, setInvs0] = useState<Invoice[]>([]);
  const [loaded, setLoaded] = useState(false); // until the first load ends, say so — never "nothing here"
  const setInvs: typeof setInvs0 = v => { setLoaded(true); setInvs0(v); };
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [shops, setShops] = useState<Map<string, string>>(new Map());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [bySh, setBySh] = useState(false);

  useEffect(() => {
    (async () => {
      const ts = (await db.trips.where('date').equals(today()).toArray()).filter(t => t.status === 'planned' || t.status === 'loaded');
      setTrips(ts);
      const all = await db.vans.toArray();
      const vs = all.filter(v => ts.some(t => t.vanId === v.id)).sort((a, b) => a.name.localeCompare(b.name)); setVans(vs);
      const pend = (await db.invoices.where('deliveryStatus').equals('planned').toArray()).filter(i => !i.cancelled);
      setInvs(pend);
      if (!vanId && vs.length) { const busiest = vs.map(v => ({ v, n: pend.filter(i => i.vanId === v.id).length })).sort((a, b) => b.n - a.n)[0]; setVanId(busiest.v.id); }
      setProducts(new Map((await db.products.toArray()).map(p => [p.id, p])));
      setShops(new Map((await db.shops.toArray()).map(s => [s.id, s.name])));
    })();
  }, [vanId, tick]);

  const trip = trips.find(t => t.vanId === vanId);
  const mine = useMemo(() => invs.filter(i => i.tripId === trip?.id).sort((a, b) => (a.stopNo ?? 0) - (b.stopNo ?? 0)), [invs, trip]);
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

  // nothing to load yet: say so plainly instead of empty counters (0 bills · 0/0 lines)
  if (loaded && !vans.length) return <div className="card"><div className="t">{'No van to load yet'}</div><div className="muted" style={{ marginTop: 4 }}>{'When the owner confirms today\'s delivery plan, each van\'s bills appear here to pick and pack.'}</div></div>;
  return (
    <div className="stack">
      <div className="segmented">
        {vans.map(v => <button key={v.id} className={vanId === v.id ? 'on' : ''} onClick={() => { setVanId(v.id); setTicked(new Set()); }}><Truck size={16} style={{ verticalAlign: -3 }} /> {v.name}</button>)}
      </div>
      <div className="kpi navy">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><div className="v">{mine.length} <span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>{'bills'}</span></div><div className="l">{plural([...new Set(mine.map(i => i.shopId))].length, 'shop')} · {inr(total)}</div></div>
          <div style={{ textAlign: 'right' }}><div className="v">{ticked.size}<span style={{ fontSize: 16, color: 'var(--on-navy-2)' }}>/{lines.length}</span></div><div className="l">{'lines picked'}</div></div>
        </div>
      </div>
      <div className="segmented" style={{ maxWidth: 320 }}>
        <button className={!bySh ? 'on' : ''} onClick={() => setBySh(false)}>{'Pick (by product)'}</button>
        <button className={bySh ? 'on' : ''} onClick={() => setBySh(true)}>{'Pack (by shop)'}</button>
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
                  <div className="t" style={{ fontSize: 18 }}>{p.name}</div>
                  <div className="s">MRP {p.mrp}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="badge navy" style={{ fontSize: 15, padding: '5px 12px' }}>{cs ? `${cs} ${'cs'}` : ''}{cs && pcs ? ' + ' : ''}{pcs ? `${pcs} ${'pcs'}` : ''}</span>
                    {l.batches.sort((a, b) => a.expiry.localeCompare(b.expiry)).map(b => <span key={b.batch} className="badge">{'batch'} <b>{b.batch}</b> · {b.qty}</span>)}
                  </div>
                </div>
                <div className={`avatar ${done ? 'ok' : ''}`} style={{ width: 52, height: 52, borderRadius: 16 }}>{done ? <Check size={30} /> : <Check size={24} style={{ opacity: .35 }} />}</div>
              </button>
            );
          })}
          {!loaded && <div className="card muted">{'Loading…'}</div>}
      {loaded && !lines.length && <div className="card muted">{'No trip planned for this van yet. The owner confirms the delivery plan first.'}</div>}
        </div>
      ) : (
        <div className="stack">
          {[...new Set(mine.map(i => i.shopId))].map((sid, k) => {
            const sInv = mine.filter(i => i.shopId === sid);
            return (
              <div key={sid} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 17 }}><span className="badge navy">{k + 1}</span> {shops.get(sid)}</b><span className="muted">{sInv.map(i => i.number).join(', ')}</span></div>
                <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                  {sInv.flatMap(i => i.lines).map((l, k) => { const p = products.get(l.productId)!; return <div key={k} className="row" style={{ flexWrap: 'nowrap' }}><Pack product={p} /><span className="grow">{p.name}</span><b className="num">{l.qty + l.freeQty} pcs</b></div>; })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lines.length > 0 && (
        <div className="sticky-foot">
          {!allDone && <div className="muted grow"><AlertTriangle size={16} style={{ verticalAlign: -3 }} /> {'Tick every line before the van leaves'}</div>}
          {trip?.status === 'loaded'
            ? <span className="badge ok" style={{ fontSize: 15, padding: '8px 14px' }}><Check size={16} /> {'Loaded — waiting for driver'}</span>
            : <button className="btn primary big grow" disabled={!allDone} onClick={async () => { if (trip) { await tripLoaded(trip.id); setTick(x => x + 1); } }}><Truck /> {'Van loaded'}</button>}
        </div>
      )}
    </div>
  );
}
