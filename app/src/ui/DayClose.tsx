import { useEffect, useState } from 'react';
import { Check, Scale, Truck, Banknote, Smartphone, AlertTriangle } from 'lucide-react';
import { closeDay, daySummary } from '../core/pipeline';
import { getLang, inr } from '../core/i18n';
import { confirmBox } from './dialog';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);

// Owner: end-of-day reconciliation. What went out vs came back, cash per person vs handed over, UPI/cheque list.
export function DayClose() {
  const [s, setS] = useState<Awaited<ReturnType<typeof daySummary>> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { daySummary().then(setS); }, [tick]);
  if (!s) return <div className="muted">…</div>;
  const cashPending = s.cash.reduce((a, c) => a + c.pending, 0);
  return (
    <div className="stack">
      <div className="sechead"><h3><Scale size={18} style={{ verticalAlign: -3 }} /> {L('Day close', 'நாள் முடிவு')} · {s.date}</h3>{s.closed && <span className="badge ok"><Check size={12} /> {L('closed', 'முடிந்தது')}</span>}</div>
      <div className="kpis">
        <div className="kpi navy"><div className="v">{inr(s.sales)}</div><div className="l">{L('billed today', 'இன்றைய பில்')}</div></div>
        <div className="kpi navy"><div className="v">{inr(s.collected)}</div><div className="l">{L('collected today', 'இன்றைய வசூல்')}</div></div>
      </div>
      <div className="card">
        <div className="sechead"><h3><Truck size={18} style={{ verticalAlign: -3 }} /> {L('Vans', 'வண்டிகள்')}</h3></div>
        {s.trips.map(t => (
          <div key={t.trip.id} className="row" style={{ justifyContent: 'space-between', minHeight: 40, borderBottom: '1px solid var(--line)' }}>
            <b>{t.van}</b>
            <span className="row" style={{ gap: 4 }}>
              {t.trip.status === 'planned' || t.trip.status === 'loaded' ? <span className="badge warn">{L('not started', 'கிளம்பவில்லை')}</span> : <span className="badge ok">{t.delivered} {L('delivered', 'டெலிவரி')}</span>}
              {t.partial > 0 && <span className="badge warn">{t.partial} {L('partial', 'பகுதி')}</span>}
              {t.returned > 0 && <span className="badge bad">{t.returned} {L('returned', 'திரும்பியது')}</span>}
              {t.undelivered > 0 && t.trip.status !== 'planned' && t.trip.status !== 'loaded' && <span className="badge bad">{t.undelivered} {L('not delivered', 'டெலிவரி ஆகவில்லை')}</span>}
            </span>
          </div>
        ))}
        {!s.trips.length && <div className="muted">{L('No trips today.', 'இன்று டிரிப் இல்லை.')}</div>}
        {s.creditNotes > 0 && <div className="muted" style={{ marginTop: 6 }}>{L('Credit notes today', 'இன்றைய கிரெடிட் நோட்')}: {inr(s.creditNotes)}</div>}
      </div>
      <div className="card">
        <div className="sechead"><h3><Banknote size={18} style={{ verticalAlign: -3 }} /> {L('Cash', 'பணம்')}</h3><span className={`badge ${cashPending > 0 ? 'bad' : 'ok'}`}>{cashPending > 0 ? `${inr(cashPending)} ${L('not yet handed', 'இன்னும் ஒப்படைக்கவில்லை')}` : L('all handed over', 'எல்லாம் ஒப்படைக்கப்பட்டது')}</span></div>
        {s.cash.map(c => (
          <div key={c.staffId} className="row" style={{ justifyContent: 'space-between', minHeight: 40 }}>
            <span>{c.name} <span className="muted">· {c.n} {L('payments', 'வசூல்')}</span></span>
            <span className="num"><b>{inr(c.collected)}</b> <span className="muted">{L('collected', 'வசூல்')}</span> · <b style={{ color: c.pending > 0 ? 'var(--bad)' : 'var(--ok)' }}>{inr(c.handed)}</b> <span className="muted">{L('handed', 'ஒப்படைப்பு')}</span></span>
          </div>
        ))}
        {s.olderCash > 0 && <div className="alert bad"><AlertTriangle /><div>{inr(s.olderCash)} {L('cash from earlier days still with staff', 'முந்தைய நாட்களின் பணம் இன்னும் ஊழியரிடம்')}</div></div>}
        {s.waiting > 0 && <div className="alert"><AlertTriangle /><div>{s.waiting} {L('payment(s) still waiting for the shop\'s ✓', 'வசூல் கடையின் ✓ காத்திருக்கிறது')}</div></div>}
      </div>
      <div className="card">
        <div className="sechead"><h3><Smartphone size={18} style={{ verticalAlign: -3 }} /> {L('UPI & cheques today', 'இன்றைய UPI & காசோலை')}</h3></div>
        {s.nonCash.map(p => <div key={p.id} className="row" style={{ justifyContent: 'space-between', minHeight: 36 }}><span>{p.mode.toUpperCase()} {p.ref && <span className="muted">· {p.ref}</span>} <span className="muted">· {p.by}</span></span><b className="num">{inr(p.amount)}</b></div>)}
        {!s.nonCash.length && <div className="muted">—</div>}
        <div className="muted" style={{ marginTop: 6 }}>{L('These are matched when you upload the bank statement (RoX → "match payments").', 'வங்கி ஸ்டேட்மென்ட் பதிவேற்றும்போது இவை பொருத்தப்படும்.')}</div>
      </div>
      {!s.closed && <button className="btn primary big block" onClick={async () => { if (await confirmBox(L('Close the day?', 'நாளை முடிக்கவா?'), L('Cash shown as collected is marked handed over. Anything not delivered stays for tomorrow.', 'வசூல் பணம் ஒப்படைக்கப்பட்டதாக குறிக்கப்படும்.'), L('Close day', 'முடி'))) { await closeDay(); setTick(x => x + 1); } }}><Check /> {L('Close day', 'நாளை முடி')}</button>}
    </div>
  );
}
