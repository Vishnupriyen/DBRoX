import { useEffect, useState } from 'react';
import { Check, Scale, Truck, Banknote, AlertTriangle, ChevronRight, FileText, Receipt } from 'lucide-react';
import { dupeGroups, billingLockedBy, cancelPayment, closeDay, confirmNotDuplicate, dayChecklist, daySummary, differenceMoney, settleAllAsCreditNotes, settleDifference } from '../core/pipeline';
import { ChangeSet, db, today } from '../core/db';
import { inr, showDate, plural, showTime } from '../core/i18n';
import { confirmBox, notify } from './dialog';
import { useBack } from './useBack';
import { billChangeBlock } from '../core/gst';
import type { Page } from './Home';
import type { Invoice, Payment } from '../core/types';
import { Requests } from './Requests';


// Owner: the day cannot close until every line is zero. Each line opens the screen that clears it.
export function DayClose({ go }: { go?: (p: Page) => void }) {
  const [s, setS] = useState<Awaited<ReturnType<typeof daySummary>> | null>(null);
  const [c, setC] = useState<Awaited<ReturnType<typeof dayChecklist>> | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const [diffOpen, setDiffOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [staffNames, setStaffNames] = useState<[string, string][]>([]);
  useEffect(() => { db.staff.toArray().then(ss => setStaffNames(ss.map(x => [x.id, x.name]))); }, []);
  const [date, setDate] = useState(today());
  useBack(() => { if (!diffOpen && !dupOpen) return false; setDiffOpen(false); setDupOpen(false); setTick(x => x + 1); return true; });
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
    { n: c.waitingOrders.filter(o => o.status !== 'picked').length, en: 'Orders to approve', page: 'orders-received' },
    { n: c.waitingOrders.filter(o => o.status === 'picked').length, en: 'Packed orders to verify and bill', page: 'verify' },
    { n: c.newShops.length, en: 'New shops to approve', page: 'newshops' },
    { n: dupeGroups(c.dupes).length, en: 'Possible duplicate collections', action: () => setDupOpen(true) },
    { n: c.unapprovedExpenses.length, en: 'Expenses to approve', page: 'expenses' },
    { n: c.requests.length, en: 'Staff returns / write-offs to approve', action: () => setReqOpen(true) },
  ];
  const open = items.filter(i => i.n > 0).length;
  const canClose = !s.closed && open === 0 && cashDone;

  if (diffOpen) return <Differences invoices={c.diffs} onBack={() => { setDiffOpen(false); setTick(x => x + 1); }} />;
  if (reqOpen) return <Requests onBack={() => { setReqOpen(false); setTick(x => x + 1); }} />;
  if (dupOpen) return <Duplicates payments={c.dupes} onBack={() => { setDupOpen(false); setTick(x => x + 1); }} />;

  return (
    <div className="stack">
      <div className="sechead"><h3><Scale size={18} style={{ verticalAlign: -3 }} /> {'Day close'} · {showDate(s.date)}</h3>{s.closed && <span className="badge ok"><Check size={12} /> {'closed'}</span>}</div>
      {date !== today() && !s.closed && <div className="alert"><AlertTriangle /><div>{`${showDate(date)} is still open — close it first, then today.`}</div></div>}
      {c.shortfallsOpen.length > 0 && <div className="alert bad"><AlertTriangle /><div>{'Cash still pending from staff:'} {c.shortfallsOpen.map(a => `${names.get(a.staffId) ?? a.staffId} ${inr(a.amount - (a.recovered ?? 0))}`).join(' · ')}</div></div>}
      <div className="kpis">
        <div className="kpi navy"><div className="v">{inr(s.sales)}</div><div className="l">{'billed today'}</div></div>
        <div className="kpi navy"><div className="v">{inr(s.collected)}</div><div className="l">{'collected today'}</div></div>
      </div>
      {s.chequesToClear > 0 && <div className="muted">{'Cheques to clear (dated later, not in collected):'} {inr(s.chequesToClear)}</div>}

      <div className="sechead"><h3>{'Checklist'} · {open ? `${open} ${'open'}` : 'all clear'}</h3></div>
      <div className="stack" style={{ gap: 8 }}>
        {[...items].sort((a, b) => (b.n > 0 ? 1 : 0) - (a.n > 0 ? 1 : 0)).map(i => (
          <button key={i.en} className={`check ${i.n ? 'tap' : ''}`} onClick={() => { if (!i.n) return; if (i.action) i.action(); else if (i.page && go) go(i.page); }} disabled={!i.n}>
            <span className={`n ${i.n ? '' : 'ok'}`}>{i.n ? i.n : <Check size={16} />}</span>
            <span className="grow" style={{ textAlign: 'left', color: i.n ? undefined : 'var(--dim)' }}>{i.n ? i.en : `${i.en.replace(/ \(.*\)$/, '')} — none`}</span>
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
      }}><Check /> {canClose ? 'Close day' : open ? `${plural(open, 'item')} to clear first` : 'Enter cash received from everyone'}</button>}
      {s.closed && <div className="alert ok"><Check /><div>{'Closed. Sleep peacefully.'}</div></div>}
    </div>
  );
}

// Bills with delivery differences: owner picks modified bill (same number) or credit note, per bill. Shop's preference remembered.
function Differences({ invoices, onBack }: { invoices: Invoice[]; onBack: () => void }) {
  const [list, setList] = useState(invoices);
  const [shops, setShops] = useState<Map<string, { name: string; pref?: string }>>(new Map());
  const [products, setProducts] = useState<Map<string, string>>(new Map());
  const [money, setMoney] = useState<Record<string, Awaited<ReturnType<typeof differenceMoney>>>>({});
  useEffect(() => { (async () => { const m: typeof money = {}; for (const i of invoices) m[i.id] = await differenceMoney(i); setMoney(m); })(); }, [invoices]);
  useEffect(() => { (async () => {
    setShops(new Map((await db.shops.toArray()).map(s => [s.id, { name: s.name, pref: (s as unknown as { diffPref?: string }).diffPref }])));
    setProducts(new Map((await db.products.toArray()).map(p => [p.id, p.name])));
  })(); }, []);
  const reasonOf = (inv: Invoice) => [...new Set((inv.delivery?.shortages ?? []).map(x => x.reason).filter(Boolean))].join(', ') || 'short at delivery';
  const settleAll = async () => {
    const total = list.reduce((a, i) => a + (money[i.id]?.back ?? 0), 0);
    if (!await confirmBox(`Credit notes for ${list.length} bills?`, `${inr(Math.round(total * 100) / 100)} with GST goes back to the shops, taken off their bills. Extras are billed on new bills.`, 'Make credit notes')) return;
    const r = await settleAllAsCreditNotes(list.map(i => i.id));
    setList(l => l.filter(x => !r.done.includes(x.id)));
    if (r.failed.length) await notify('Some were not done', r.failed.map(f => f.message).join('\n'));
  };
  const act = async (inv: Invoice, a: 'modified' | 'credit_note') => {
    // a credit note moves money: the owner sees the amount (with GST) and the reason before it is made
    if (a === 'credit_note' && !await confirmBox(`Credit note for ${shops.get(inv.shopId)?.name ?? 'this shop'}?`, `${inr(money[inv.id]?.back ?? 0)} with GST, taken off bill ${inv.number}. Reason: ${reasonOf(inv)}.`, 'Make credit note')) return;
    try { await settleDifference(inv.id, a); } catch (e) { await notify('Not done', (e as Error).message); return; }
    const shop = await db.shops.get(inv.shopId); if (shop) { const cs = new ChangeSet(); cs.put('shops', { ...shop, diffPref: a } as typeof shop, 'difference preference'); await cs.commit('Shop preference'); }
    setList(l => l.filter(x => x.id !== inv.id));
  };
  return (
    <div className="stack">
      <div className="sechead"><h3>{'Bills with differences'} · {list.length}</h3><button className="link" onClick={onBack}>{'← Day close'}</button></div>
      {list.length > 1 && <button className="btn primary block" onClick={settleAll}><Receipt /> {'Settle all as credit notes'}</button>}
      {list.map(inv => {
        const sh = shops.get(inv.shopId); const einv = !!(inv as unknown as { irn?: string }).irn;
        // a delivered (or printed) bill is never re-written: only a credit note for less and a new bill for extra
        const fixed = einv || !!billChangeBlock(inv, 'edit', today());
        const m = money[inv.id];
        return (
          <div key={inv.id} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><div><b>{sh?.name}</b><div className="muted"><span className="billno">{inv.number}</span> · {inr(inv.total)}</div></div>{sh?.pref && <span className="badge">{'usually'}: {sh.pref === 'modified' ? 'modified bill' : 'credit note'}</span>}</div>
            <div className="list">
              {inv.delivery?.shortages.map(x => <div key={x.productId} className="row"><span className="grow">{products.get(x.productId)}</span><span className="badge bad">−{x.qty} · {x.reason}</span></div>)}
              {inv.delivery?.excess?.map(x => <div key={x.productId} className="row"><span className="grow">{products.get(x.productId)}</span><span className="badge warn">+{x.qty} {'extra'}</span></div>)}
            </div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              {!fixed && <div className="grow stack" style={{ gap: 4 }}><button className={`btn ${sh?.pref === 'modified' ? 'primary' : ''}`} onClick={() => act(inv, 'modified')}><FileText /> {'Modified bill'} <span className="muted" style={{ fontSize: '0.6875rem' }}>{'same number'}</span></button>{m && <span className="muted" style={{ fontSize: '0.75rem' }}>{`Bill becomes ${inr(m.becomes)}`}</span>}</div>}
              <div className="grow stack" style={{ gap: 4 }}><button className={`btn ${fixed || sh?.pref === 'credit_note' ? 'primary' : ''}`} onClick={() => act(inv, 'credit_note')}><Receipt /> {'Credit note'}{inv.delivery?.excess?.length ? <span className="muted" style={{ fontSize: '0.6875rem' }}>{' + new bill for extra'}</span> : null}</button>{m && <span className="muted" style={{ fontSize: '0.75rem' }}>{[m.back ? `Bill stays; shop gets ${inr(m.back)} back` : 'Bill stays', m.extra ? `new bill about ${inr(m.extra)} for the extra` : ''].filter(Boolean).join(' · ')}</span>}</div>
            </div>
            {fixed && <div className="muted">{einv ? 'E-invoiced bill — only a credit note is allowed.' : 'Delivered bill — less goes on a credit note, extra on a new bill.'}</div>}
          </div>
        );
      })}
      {!list.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{'All differences settled.'}<div><button className="btn primary" style={{ marginTop: 8 }} onClick={onBack}>{'Back to day close'}</button></div></div>}
    </div>
  );
}

// The same amount twice from one shop today: the owner says both are real, or cancels the one entered twice.
function Duplicates({ payments, onBack }: { payments: Payment[]; onBack: () => void }) {
  const [list, setList] = useState(payments);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => { (async () => { setNames(new Map([...(await db.shops.toArray()).map(s => [s.id, s.name] as [string, string]), ...(await db.staff.toArray()).map(s => [s.id, s.name] as [string, string])])); })(); }, []);
  const groups = dupeGroups(list);
  const real = async (g: Payment[]) => { await confirmNotDuplicate(g.map(p => p.id)); setList(l => l.filter(p => !g.some(x => x.id === p.id))); };
  const cancel = async (g: Payment[], p: Payment) => {
    if (!await confirmBox(`Cancel ${inr(p.amount)} by ${names.get(p.collectedBy) ?? ''}?`, 'It was entered twice. It stays in the history; the bills it paid are open again.', 'Cancel it')) return;
    await cancelPayment(p.id, 'Entered twice (day close)');
    const rest = g.filter(x => x.id !== p.id);
    setList(l => l.filter(x => x.id !== p.id && !(rest.length < 2 && rest.some(r => r.id === x.id))));
  };
  return (
    <div className="stack">
      <div className="sechead"><h3>{'Possible duplicate collections'} · {groups.length}</h3><button className="link" onClick={onBack}>{'← Day close'}</button></div>
      {groups.map(g => (
        <div key={g[0].id} className="card stack" style={{ gap: 8 }}>
          <div><b>{names.get(g[0].shopId)}</b><div className="muted">{inr(g[0].amount)} × {g.length} {'today'}</div></div>
          <div className="list">
            {g.map(p => <div key={p.id} className="row"><span className="grow">{showTime(p.createdAt)} · {p.mode} · {names.get(p.collectedBy) ?? ''}</span><button className="btn small" onClick={() => cancel(g, p)}>{'Cancel this one'}</button></div>)}
          </div>
          <button className="btn primary" onClick={() => real(g)}><Check /> {'Both are real'}</button>
        </div>
      ))}
      {!groups.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{'All checked.'}</div>}
    </div>
  );
}
