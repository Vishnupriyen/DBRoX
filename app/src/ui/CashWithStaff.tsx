import { useEffect, useState } from 'react';
import { Banknote, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { db, today } from '../core/db';
import { getLang, inr } from '../core/i18n';
import { r2 } from '../core/ledger';
import { ShopStatement } from './ShopStatement';
import type { Advance, Payment } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);

// Owner: every rupee of cash that is not yet on his table — who holds it, from which shop, which bill, when. Receiving happens at day close.
export function CashWithStaff() {
  const [groups, setGroups] = useState<{ staffId: string; name: string; total: number; older: number; pays: (Payment & { shop: string; bills: string })[] }[]>([]);
  const [shortfalls, setShortfalls] = useState<(Advance & { name: string })[]>([]);
  const [openStaff, setOpenStaff] = useState<string | null>(null);
  const [openShop, setOpenShop] = useState<string | null>(null);
  useEffect(() => { (async () => {
    const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
    const shops = new Map((await db.shops.toArray()).map(s => [s.id, s.name]));
    const inv = new Map((await db.invoices.toArray()).map(i => [i.id, i.number]));
    const pays = (await db.payments.toArray()).filter(p => p.mode === 'cash' && !p.settled && p.status === 'ok').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const by = new Map<string, typeof pays>(); for (const p of pays) by.set(p.collectedBy, [...(by.get(p.collectedBy) ?? []), p]);
    const t = today();
    setGroups([...by.entries()].map(([id, list]) => ({ staffId: id, name: staff.get(id) ?? id, total: r2(list.reduce((a, p) => a + p.amount, 0)), older: r2(list.filter(p => p.date < t).reduce((a, p) => a + p.amount, 0)), pays: list.map(p => ({ ...p, shop: shops.get(p.shopId) ?? '', bills: p.allocations.map(a => inv.get(a.invoiceId) ?? '').filter(Boolean).join(', ') })) })).sort((a, b) => b.total - a.total));
    setShortfalls((await db.advances.toArray()).filter(a => a.kind === 'shortfall' && a.status === 'approved' && (a.recovered ?? 0) < a.amount).map(a => ({ ...a, name: staff.get(a.staffId) ?? a.staffId })));
  })(); }, []);
  if (openShop) return <ShopStatement shopId={openShop} onBack={() => setOpenShop(null)} />;
  const total = groups.reduce((a, g) => a + g.total, 0);
  return (
    <div className="stack">
      <div className="kpi navy"><div className="v">{inr(total)}</div><div className="l">{L('cash with staff right now', 'இப்போது ஊழியரிடம் பணம்')} · {groups.length} {L('people', 'பேர்')}</div></div>
      {shortfalls.length > 0 && <div className="alert bad"><AlertTriangle /><div><b>{L('Pending from earlier day closes', 'முந்தைய நாள் முடிவில் குறைவு')}:</b> {shortfalls.map(a => `${a.name.split(' ')[0]} ${inr(a.amount - (a.recovered ?? 0))} (${a.date})`).join(' · ')} — {L('recovered from salary', 'சம்பளத்தில் கழிவு')}</div></div>}
      {groups.map(g => (
        <div key={g.staffId} className="card stack" style={{ gap: 6 }}>
          <button className="row" style={{ flexWrap: 'nowrap', background: 'none', border: 0, padding: 0, textAlign: 'left', width: '100%' }} onClick={() => setOpenStaff(openStaff === g.staffId ? null : g.staffId)}>
            <div className="avatar"><Banknote size={18} /></div>
            <div className="grow"><div className="t">{g.name}</div><div className="s">{g.pays.length} {L('collections', 'வசூல்')}{g.older > 0 ? ' · ' : ''}{g.older > 0 && <span className="badge bad">{inr(g.older)} {L('from earlier days', 'முந்தைய நாட்கள்')}</span>}</div></div>
            <span className="amt num">{inr(g.total)}</span>{openStaff === g.staffId ? <ChevronUp /> : <ChevronDown />}
          </button>
          {openStaff === g.staffId && <div className="list">
            {g.pays.map(p => <button key={p.id} className="item tap" onClick={() => setOpenShop(p.shopId)}><div className="grow" style={{ textAlign: 'left' }}><div className="t">{p.shop}</div><div className="s">{p.date} {p.createdAt.slice(11, 16)} · {L('bills', 'பில்')} {p.bills || '—'}</div></div><span className="amt num">{inr(p.amount)}</span></button>)}
          </div>}
        </div>
      ))}
      {!groups.length && <div className="card muted">{L('All cash is on your table.', 'எல்லா பணமும் உங்களிடம்.')}</div>}
      <div className="muted">{L('You receive and count cash at Day close; the difference is recorded against the person.', 'நாள் முடிவில் பணம் எண்ணி பெறுங்கள்.')}</div>
    </div>
  );
}
