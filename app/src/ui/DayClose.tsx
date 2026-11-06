import { useEffect, useState } from 'react';
import { Check, Scale, Truck, Banknote, AlertTriangle, ChevronRight, FileText, Receipt } from 'lucide-react';
import { closeDay, dayChecklist, daySummary, settleDifference } from '../core/pipeline';
import { ChangeSet, db } from '../core/db';
import { getLang, inr } from '../core/i18n';
import { confirmBox } from './dialog';
import type { Page } from './Home';
import type { Invoice } from '../core/types';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);

// Owner: the day cannot close until every line is zero. Each line opens the screen that clears it.
export function DayClose({ go }: { go?: (p: Page) => void }) {
  const [s, setS] = useState<Awaited<ReturnType<typeof daySummary>> | null>(null);
  const [c, setC] = useState<Awaited<ReturnType<typeof dayChecklist>> | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const [diffOpen, setDiffOpen] = useState(false);
  useEffect(() => { daySummary().then(setS); dayChecklist().then(setC); }, [tick]);
  if (!s || !c) return <div className="muted">…</div>;

  const cashBy = new Map<string, { name: string; amount: number; older: number }>();
  const names = new Map(s.cash.map(x => [x.staffId, x.name]));
  for (const p of c.cashOpen) { const v = cashBy.get(p.collectedBy) ?? { name: names.get(p.collectedBy) ?? p.collectedBy, amount: 0, older: 0 }; v.amount += p.amount; if (p.date < s.date) v.older += p.amount; cashBy.set(p.collectedBy, v); }
  const cashRows = [...cashBy.entries()];
  const cashDone = cashRows.every(([id]) => received[id] !== undefined && received[id] !== '');
  const items: { n: number; en: string; ta: string; page?: Page; action?: () => void }[] = [
    { n: c.tripsOpen.length, en: 'Trips not ended', ta: 'முடியாத டிரிப்', page: 'live' },
    { n: c.noResult.length, en: 'Bills without a delivery result', ta: 'டெலிவரி முடிவு இல்லாத பில்', page: 'status' },
    { n: c.diffs.length, en: 'Bills with differences — choose modified bill or credit note', ta: 'வித்தியாசமுள்ள பில் — மாற்றிய பில் / கிரெடிட் நோட்', action: () => setDiffOpen(true) },
    { n: c.refs.length, en: 'UPI / cheque without reference', ta: 'குறிப்பு இல்லாத UPI / செக்', page: 'cheques' },
    { n: c.waitingOrders.length, en: 'Orders waiting for you', ta: 'உங்களுக்காக காத்திருக்கும் ஆர்டர்', page: 'orders-received' },
    { n: c.newShops.length, en: 'New shops to approve', ta: 'ஒப்புதலுக்கு புதிய கடைகள்', page: 'newshops' },
    { n: c.dupes.length, en: 'Possible duplicate collections', ta: 'இரட்டை வசூல் சாத்தியம்', page: 'cheques' },
    { n: c.unapprovedExpenses.length, en: 'Expenses to approve', ta: 'ஒப்புதலுக்கு செலவுகள்', page: 'expenses' },
  ];
  const open = items.filter(i => i.n > 0).length;
  const canClose = !s.closed && open === 0 && cashDone;

  if (diffOpen) return <Differences invoices={c.diffs} onBack={() => { setDiffOpen(false); setTick(x => x + 1); }} />;

  return (
    <div className="stack">
      <div className="sechead"><h3><Scale size={18} style={{ verticalAlign: -3 }} /> {L('Day close', 'நாள் முடிவு')} · {s.date}</h3>{s.closed && <span className="badge ok"><Check size={12} /> {L('closed', 'முடிந்தது')}</span>}</div>
      <div className="kpis">
        <div className="kpi navy"><div className="v">{inr(s.sales)}</div><div className="l">{L('billed today', 'இன்றைய பில்')}</div></div>
        <div className="kpi navy"><div className="v">{inr(s.collected)}</div><div className="l">{L('collected today', 'இன்றைய வசூல்')}</div></div>
      </div>

      <div className="sechead"><h3>{L('Checklist', 'சரிபார்ப்பு')} · {open ? `${open} ${L('open', 'திறந்த')}` : L('all clear', 'எல்லாம் சரி')}</h3></div>
      <div className="stack" style={{ gap: 8 }}>
        {items.map(i => (
          <button key={i.en} className={`check ${i.n ? 'tap' : ''}`} onClick={() => { if (!i.n) return; if (i.action) i.action(); else if (i.page && go) go(i.page); }} disabled={!i.n}>
            <span className={`n ${i.n ? '' : 'ok'}`}>{i.n ? i.n : <Check size={16} />}</span>
            <span className="grow" style={{ textAlign: 'left' }}>{L(i.en, i.ta)}</span>
            {i.n > 0 && <ChevronRight />}
          </button>
        ))}
      </div>

      <div className="sechead"><h3><Banknote size={18} style={{ verticalAlign: -3 }} /> {L('Cash — count and receive', 'பணம் — எண்ணி பெறுங்கள்')}</h3></div>
      <div className="card stack">
        {cashRows.map(([id, v]) => {
          const got = Number(received[id] ?? ''); const diff = received[id] !== undefined && received[id] !== '' ? v.amount - got : 0;
          return (
            <div key={id} className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
              <div className="avatar">{v.name[0]}</div>
              <div className="grow"><div className="t">{v.name}</div><div className="s">{L('app says', 'ஆப் படி')} <b>{inr(v.amount)}</b>{v.older > 0 && <span className="badge bad" style={{ marginLeft: 6 }}>{inr(v.older)} {L('from earlier days', 'முந்தைய நாட்கள்')}</span>}</div></div>
              <input type="number" inputMode="decimal" placeholder={L('received', 'பெற்றது')} value={received[id] ?? ''} onChange={e => setReceived(r => ({ ...r, [id]: e.target.value }))} style={{ width: 110, textAlign: 'right' }} aria-label={`Received from ${v.name}`} disabled={s.closed} />
              {diff > 0.5 && <span className="badge bad">−{inr(diff)}</span>}
            </div>
          );
        })}
        {!cashRows.length && <div className="muted">{L('No cash with staff.', 'ஊழியரிடம் பணம் இல்லை.')}</div>}
        {cashRows.some(([id, v]) => received[id] && v.amount - Number(received[id]) > 0.5) && <div className="alert"><AlertTriangle /><div>{L('Shortfall is recorded against the person and shown every day until cleared; you can deduct it from salary in Payroll.', 'குறைவு அந்த நபர் பெயரில் பதிவாகும்; சம்பளத்தில் கழிக்கலாம்.')}</div></div>}
      </div>

      <div className="card">
        <div className="sechead"><h3><Truck size={18} style={{ verticalAlign: -3 }} /> {L('Vans', 'வண்டிகள்')}</h3></div>
        {s.trips.map(t => (
          <div key={t.trip.id} className="row" style={{ justifyContent: 'space-between', minHeight: 40, borderBottom: '1px solid var(--line)' }}>
            <b>{t.van}</b>
            <span className="row" style={{ gap: 4 }}>
              {t.trip.status === 'planned' || t.trip.status === 'loaded' ? <span className="badge warn">{L('not started', 'கிளம்பவில்லை')}</span> : <span className="badge ok">{t.delivered} {L('delivered', 'டெலிவரி')}</span>}
              {t.partial > 0 && <span className="badge warn">{t.partial} {L('with differences', 'வித்தியாசம்')}</span>}
              {t.returned > 0 && <span className="badge bad">{t.returned} {L('refused', 'மறுத்தது')}</span>}
              {t.undelivered > 0 && t.trip.status !== 'planned' && t.trip.status !== 'loaded' && <span className="badge bad">{t.undelivered} {L('not delivered', 'டெலிவரி ஆகவில்லை')}</span>}
            </span>
          </div>
        ))}
        {!s.trips.length && <div className="muted">{L('No trips today.', 'இன்று டிரிப் இல்லை.')}</div>}
      </div>

      {!s.closed && <button className="btn primary big block" disabled={!canClose} onClick={async () => {
        if (!await confirmBox(L('Close the day?', 'நாளை முடிக்கவா?'), L('Cash you entered is marked received. Everything else is already decided above.', 'நீங்கள் உள்ளிட்ட பணம் பெறப்பட்டதாக குறிக்கப்படும்.'), L('Close day', 'முடி'))) return;
        await closeDay(s.date, Object.fromEntries(Object.entries(received).map(([k, v]) => [k, Number(v) || 0]))); setTick(x => x + 1);
      }}><Check /> {canClose ? L('Close day', 'நாளை முடி') : open ? L(`${open} item(s) to clear first`, `முதலில் ${open} சரி செய்யவும்`) : L('Enter cash received from everyone', 'எல்லோரிடமும் பெற்ற பணத்தை உள்ளிடவும்')}</button>}
      {s.closed && <div className="alert ok"><Check /><div>{L('Closed. Sleep peacefully.', 'முடிந்தது. நிம்மதியாக தூங்குங்கள்.')}</div></div>}
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
      <div className="sechead"><h3>{L('Bills with differences', 'வித்தியாசமுள்ள பில்கள்')} · {list.length}</h3><button className="link" onClick={onBack}>{L('← Day close', '← நாள் முடிவு')}</button></div>
      {list.map(inv => {
        const sh = shops.get(inv.shopId); const einv = !!(inv as unknown as { irn?: string }).irn;
        return (
          <div key={inv.id} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><div><b>{sh?.name}</b><div className="muted">{inv.number} · {inr(inv.total)}</div></div>{sh?.pref && <span className="badge">{L('usually', 'வழக்கமாக')}: {sh.pref === 'modified' ? L('modified bill', 'மாற்றிய பில்') : L('credit note', 'கிரெடிட் நோட்')}</span>}</div>
            <div className="list">
              {inv.delivery?.shortages.map(x => <div key={x.productId} className="row"><span className="grow">{products.get(x.productId)}</span><span className="badge bad">−{x.qty} · {x.reason}</span></div>)}
              {inv.delivery?.excess?.map(x => <div key={x.productId} className="row"><span className="grow">{products.get(x.productId)}</span><span className="badge warn">+{x.qty} {L('extra', 'கூடுதல்')}</span></div>)}
            </div>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <button className={`btn grow ${sh?.pref === 'modified' ? 'primary' : ''}`} disabled={einv} onClick={() => act(inv, 'modified')}><FileText /> {L('Modified bill', 'மாற்றிய பில்')} <span className="muted" style={{ fontSize: 11 }}>{L('same number', 'அதே எண்')}</span></button>
              <button className={`btn grow ${sh?.pref === 'credit_note' ? 'primary' : ''}`} onClick={() => act(inv, 'credit_note')}><Receipt /> {L('Credit note', 'கிரெடிட் நோட்')}</button>
            </div>
            {einv && <div className="muted">{L('E-invoiced bill — only a credit note is allowed.', 'E-invoice பில் — கிரெடிட் நோட் மட்டும்.')}</div>}
          </div>
        );
      })}
      {!list.length && <div className="card" style={{ textAlign: 'center' }}><div className="avatar ok" style={{ margin: '0 auto 8px' }}><Check /></div>{L('All differences settled.', 'எல்லா வித்தியாசங்களும் முடிந்தன.')}<div><button className="btn primary" style={{ marginTop: 8 }} onClick={onBack}>{L('Back to day close', 'நாள் முடிவுக்கு')}</button></div></div>}
    </div>
  );
}
