import { useEffect, useState } from 'react';
import { PayBox } from './PayBox';
import { ArrowLeft, Store } from 'lucide-react';
import { db } from '../core/db';
import { shopOutstanding } from '../core/ledger';
import { norm } from '../core/match';
import { inr, t } from '../core/i18n';
import type { Shop } from '../core/types';

// RoX Collection: overdue shops first; bill number first, then amount, mode, shop ✓.
export function Collect() {
  const [shops, setShops] = useState<(Shop & { due: number; overdue: number })[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<(Shop & { due: number }) | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    (async () => {
      const ss = await db.shops.toArray();
      const withDue = await Promise.all(ss.map(async s => { const o = await shopOutstanding(s.id); return { ...s, due: o.total, overdue: o.maxOverdueDays }; }));
      setShops(withDue.filter(s => s.due > 0.5).sort((a, b) => b.overdue - a.overdue || b.due - a.due));
    })();
  }, [tick]);

  if (sel) return <CollectShop shop={sel} onClose={() => { setSel(null); setTick(x => x + 1); }} />;
  const list = shops.filter(s => !q || norm(s.name).includes(norm(q)) || norm(s.area).includes(norm(q)));
  return (
    <div>
      <div className="sechead"><h3>{t('collect')}</h3></div>
      <div className="field" style={{ margin: '10px 0' }}><input placeholder="Search shop…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search shop" /></div>
      <div className="list">
        {list.map(s => (
          <button key={s.id} className="item tap" onClick={() => setSel(s)}>
            <div className={`avatar ${s.overdue > 0 ? 'bad' : ''}`}><Store size={22} /></div>
            <div className="grow"><div className="t">{s.name}</div><div className="s">{s.area}</div></div>
            <div style={{ textAlign: 'right' }}><div className="amt num">{inr(s.due)}</div>{s.overdue > 0 && <span className="badge bad">{s.overdue} days late</span>}</div>
          </button>
        ))}
        {!list.length && <div className="card muted">{t('noItems')}</div>}
      </div>
    </div>
  );
}

export function CollectShop({ shop, onClose }: { shop: Shop & { due: number }; onClose: () => void }) {
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'nowrap' }}><button className="icon-btn" onClick={onClose} aria-label="Back"><ArrowLeft /></button><div className="grow"><div className="h">{shop.name}</div><div className="muted">{shop.area} · {t('outstanding')} {inr(shop.due)}</div></div></div>
      <PayBox shop={shop} onDone={onClose} />
    </div>
  );
}
