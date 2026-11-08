import { useEffect, useState } from 'react';
import { Check, Scale, Truck, Banknote, AlertTriangle, ChevronRight, FileText, Receipt } from 'lucide-react';
import { billingLockedBy, closeDay, dayChecklist, daySummary, settleDifference } from '../core/pipeline';
import { ChangeSet, db, today } from '../core/db';
import { inr } from '../core/i18n';
import { confirmBox } from './dialog';
import type { Page } from './Home';
import type { Invoice } from '../core/types';


// Owner: the day cannot close until every line is zero. Each line opens the screen that clears it.
export function DayClose({ go }: { go?: (p: Page) => void }) {
  const [s, setS] = useState<Awaited<ReturnType<typeof daySummary>> | null>(null);
  const [c, setC] = useState<Awaited<ReturnType<typeof dayChecklist>> | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const [diffOpen, setDiffOpen] = useState(false);
  const [staffNames, setStaffNames] = useState<[string, string][]>([]);
  useEffect(() => { db.staff.toArray().then(ss => setStaffNames(ss.map(x => [x.id, x.name]))); }, []);
  const [date, setDate] = useState(today());
  // oldest open day first: yesterday must be closed before today (spec 15.2)
  useEffect(() => { (async () => { const d = (await billingLockedBy()) ?? today(); setDate(d); setS(await daySummary(d)); setC(await dayChecklist(d)); })(); }, [tick]);
  if (!s || !c) return <div className="muted">…</div>;

  const cashBy = new Map<string, { name: string; amount: number; older: number }>();
  const names = new Map([...s.cash.map(x => [x.staffId, x.name] as [string, string]), ...staffNames]);
  for (const p of c.cashOpen) { const v = cashBy.get(p.collectedBy) ?? { name: names.get(p.collectedBy) ?? p.collectedBy, amount: 0, older: 0 }; v.amount += p.amount; if (p.date < s.date) v.older += p.amount; cashBy.set(p.collectedBy, v); }
  const cashRows = [...cashBy.entries()];
  const cashDone = cashRows.every(([id]) => received[id] !== undefined && received[id] !== '');
  const items: { n: number; en: string; page?: Page; action?: () => void }[] = [
    { n: c.tripsOpen.length, en: 'Trips not ended (end them in Live)', page: 'live' },
    { n: c.noResult.length, en: 'Bills without a delivery result', page: 'status' },
    { n: c.diffs.length, en: 'Bills with differences — choose modified bill or credit note', action: () => setDiffOpen(true) },
    { n: c.refs.length, en: 'UPI / cheque without reference', page: 'cheques' },
    { n: c.waitingOrders.length, en: 'Orders waiting for you', page: 'orders-received' },
    { n: c.newShops.length, en: 'New shops to approve', page: 'newshops' },
    { n: c.dupes.length, en: 'Possible duplicate collections', page: 'cheques' },
    { n: c.unapprovedExpenses.length, en: 'Expenses to approve', page: 'expenses' },
  ];
  const open = items.filter(i => i.n > 0).length;
  const canClose = !s.closed && open === 0 && cashDone;

  if (diffOpen) return <Differences invoices={c.diffs} onBack={() => { setDiffOpen(false); setTick(x => x + 1); }} />;

  return (
    <div className="stack">
      <div className="sechead"><h3><Scale size={18} style={{ verticalAlign: -3 }} /> {'Day close'} · {s.date}</h3>{s.closed && <span className="badge ok"><Check size={12} /> {'closed'}</span>}</div>
      {date !== today() && !s.closed && <div className="alert"><AlertTriangle /><div>{`${date} is still open — close it first, then today.`}</div></div>}
      {c.shortfallsOpen.length > 0 && <div className="alert bad"><AlertTriangle /><div>{'Cash still pending from staff:'} {c.shortfallsOpen.map(a => `${names.get(a.staffId) ?? a.staffId} ${inr(a.amount - (a.recovered ?? 0))}`).join(' · ')}</div></div>}
      <div className="kpis">
        <div className="kpi navy"><div className="v">{inr(s.sales)}</div><div className="l">{'billed today'}</div></div>
        <div className="kpi navy"><div className="v">{inr(s.collected)}</div><div className="l">{'collected today'}</div></div>
      </div>

      <div className="sechead"><h3>{'Checklist'} · {open ? `${open} ${'open'}` : 'all clear'}</h3></div>
      <div className="stack" style={{ gap: 8 }}>
        {items.map(i => (
          <button key={i.en} className={`check ${i.n ? 'tap' : ''}`} onClick={() => { if (!i.n) return; if (i.action) i.action(); else if (i.page && go) go(i.page); }} disabled={!i.n}>
            <span className={`n ${i.n ? '' : 'ok'}`}>{i.n ? i.n : <Check size={16} />}</span>
            <span className="grow" style={{ textAlign: 'left' }}>{i.en}</span>
            {i.n > 0 && <ChevronRight />}
          </button>
        ))}
      </div>

      <div className="sechead"><h3><Banknote size={18} style={{ verticalAlign: -3 }} /> {'Cash — count and receive'}</h3></div>
      <div className="card stack">
        {cashRows.map(([id, v]) => {
          const got = Number(received[id] ?? ''); const diff = received[id] !== undefined && received[id] !== '' ? v.amount - got : 0;
          return (
            <div key={id} className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
              <div className="avatar">{v.name[0]}</div>
              <div className="grow"><div className="t">{v.name}</div><div className="s">{'app says'} <b>{inr(v.amount)}</b>{v.older > 0 && <span className="badge bad" style={{ marginLeft: 6 }}>{inr(v.older)} {'from earlier days'}</span>}</div></div>
              <input type="number" inputMode="decimal" placeholder={'received'} value={received[id] ?? ''} onChange={e => setReceived(r => ({ ...r, [id]: e.target.value }))} style={{ width: 110, textAlign: 'right' }} aria-label={`Received from ${v.name}`} disabled={s.closed} />
              {diff > 0.5 && <span className="badge bad">−{inr(diff)}</span>}
            </div>
          );
        })}
        {!cashRows.length && <div className="muted">{'No cash with staff.'}</div>}
        {cashRows.some(([id, v]) => received[id] && v.amount - Number(received[id]) > 0.5) && <div className="alert"><AlertTriangle /><div>{'Shortfall is recorded against the person and shown every day until cleared; you can deduct it from salary in Payroll.'}</div></div>}
      </div>

      <div className="card">
        <div className="sechead"><h3><Truck size={18} style={{ verticalAlign: -3 }} /> {'Vans'}</h3></div>
        {s.trips.map(t => (
          <div key={t.trip.id} className="row" style={{ justifyContent: 'space-between', minHeight: 40, borderBottom: '1px solid var(--line)' }}>
            <b>{t.van}</b>
            <span className="row" style={{ gap: 4 }}>
              {t.trip.status === 'planned' || t.trip.status === 'loaded' ? <span className="badge warn">{'not started'}</span> : <span className="badge ok">{t.delivered} {'delivered'}</span>}
              {t.partial > 0 && <span className="badge warn">{t.partial} {'with differences'}</span>}
              {t.returned > 0 && <span className="badge bad">{t.returned} {'refused'}</span>}
              {t.undelivered > 0 && t.trip.status !== 'planned' && t.trip.status !== 'loaded' && <span className="badge bad">{t.undelivered} {'not delivered'}</span>}
            </span>
          </div>
        ))}
        {!s.trips.length && <div className="muted">{'No trips today.'}</div>}
      </div>

      {!s.closed && <button className="btn primary big block" disabled={!canClose} onClick={async () => {
        if (!await confirmBox('Close the day?', 'Cash you entered is marked received. Everything else is already decided above.', 'Close day')) return;
        await closeDay(date, Object.fromEntries(Object.entries(received).map(([k, v]) => [k, Number(v) || 0]))); setTick(x => x + 1);
      }}><Check /> {canClose ? 'Close day' : open ? `${open} item(s) to clear first` : 'Enter cash received from everyone'}</button>}
      {s.closed && <div className="alert ok"><Check /><div>{'Closed. Sleep peacefully.'}</div></div>}
    </div>
  );
}

// Bills with delivery differences: owner picks modified bill (same number) or credit note, per bill. Shop's preference remembered.
function Differences({ invoices, onBack }: { invoices: Invoice[]; onBack: () => void }) {
  const [list, setList] = useState(invoices);
  const [shops, setShops] = useState<Map<string, { name: string; pref?: string }>>(new Map());
  const [products, setProducts] = useState<Map<string, string>>(new Map());
  useEffect(() => { (async () => {
    setShops(new Map((await db.shops.toArray()).map(s => [s.id, { name: s.name, pref: (s as unknown as { diffPref?: string }).diffPref }])));
    setProducts(new Map((await db.products.toArray()).map(p => [p.id, p.name])));
  })(); }, []);
  const act = async (inv: Invoice, a: 'modified' | 'credit_note') => {
    await settleDifference(inv.id, a);
    const shop = await db.shops.get(inv.shopId); if (shop) { const cs = new ChangeSet(); cs.put('shops', { ...shop, diffPref: a } as typeof shop, 'difference preference'); await cs.commit('Shop preference'); }
    setList(l => l.filter(x => x.id !== inv.id));
  };
  return (
    <div className="stack">
      <div className="sechead"><h3>{'Bills with differences'} · {list.length}</h3><button className="link" onClick={onBack}>{'← Day close'}</button></div>
      {list.map(inv => {
        const sh = shops.get(inv.shopId); const einv = !!(inv as unknown as { irn?: string }).irn;
        return (
          <div key={inv.id} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><div><b>{sh?.name}</b><div className="muted">{inv.number} · {inr(inv.total)}</div></div>{sh?.pref && <span className="badge">{'usually'}: {sh.pref === 'modified' ? 'modified bill' : 'credit note'}</span>}</div>
            <div className="list">
              {inv.delivery?.shortages.map(x => <div key={x.productId} className="row"><span className="grow">{products.get(x.productId)}</span><span className="badge bad">−{x.qty} · {x.reason}</span></div>)}
              {inv.delivery?.excess?.map(x => <div key={x.productId} className="row"><span className="grow">{products.get(x.productId)}</span><span className="badge warn">+{x.qty} {'extra'}</span></div>)}
            </div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <button className={`btn grow ${sh?.pref === 'modified' ? 'primary' : ''}`} disabled={einv} onClick={() => act(inv, 'modified')}><FileText /> {'Modified bill'} <span className="muted" style={{ fontSize: 11 }}>{'same number'}</span></button>
              <button className={`btn grow ${sh?.pref === 'credit_note' ? 'primary' : ''}`} onClick={() => act(inv, 'credit_note')}><Receipt /> {'Credit note'}</button>
            </div>
            {einv && <div className="muted">{'E-invoiced bill — only a credit note is allowed.'}</div>}
          </div>
        );
      })}
      {!list.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{'All differences settled.'}<div><button className="btn primary" style={{ marginTop: 8 }} onClick={onBack}>{'Back to day close'}</button></div></div>}
    </div>
  );
}
