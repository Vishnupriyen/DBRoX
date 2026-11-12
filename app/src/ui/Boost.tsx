import { useEffect, useState } from 'react';
import { BookOpen, FileCheck2, Landmark, Printer, ShieldCheck, Smartphone, Sparkles, Tag, type LucideIcon } from 'lucide-react';
import { BOOST_SERVICES, boostWhatsApp, offersNow, openRequests, requestService } from '../core/boost';
import { showDate } from '../core/i18n';
import { ask, notify } from './dialog';
import type { BoostRequest } from '../core/types';

const ICONS: Record<string, LucideIcon> = { FileCheck2, Landmark, ShieldCheck, Printer, Smartphone, BookOpen };

// Business Boost (locked name, founder 12 Nov 2026): offers running now, and services the distributor can ask for.
export function Boost() {
  const [offers, setOffers] = useState<Awaited<ReturnType<typeof offersNow>>>([]);
  const [open, setOpen] = useState<Map<string, BoostRequest>>(new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => { void offersNow().then(setOffers); void openRequests().then(setOpen); }, [tick]);
  const request = async (key: string, title: string) => {
    const note = await ask(title, { message: 'Anything we should know? (optional)', input: 'text', value: '', choices: [{ label: 'Cancel', value: '' }, { label: 'Send request', value: '__input', tone: 'primary' }] });
    if (note === null) return; // Cancel; an empty note still sends
    const r = await requestService(key, note);
    setTick(t => t + 1);
    const wa = boostWhatsApp(r.message);
    if (wa) window.open(wa, '_blank');
    await notify(r.already ? 'Already requested' : 'Request sent', r.already ? 'Your earlier request is still open — the Hanubix team will call you.' : 'The Hanubix team will call you within one working day.');
  };
  return (
    <div className="stack boost">
      <div className="card boost-hero"><Sparkles /><div><div className="h">Business Boost</div><div className="s">Offers and services to grow your business.</div></div></div>
      <div className="sechead"><h3><Tag size={18} style={{ verticalAlign: -3 }} /> {'Offers running now'}</h3><span className="muted">{offers.length || ''}</span></div>
      <div className="list">
        {offers.slice(0, 30).map(o => (
          <div key={o.id} className="item"><div className="grow"><div className="t">{o.name}</div><div className="s">{o.product}{o.company ? ` · ${o.company}` : ''} · till {showDate(o.to)}</div></div></div>
        ))}
        {!offers.length && <div className="card muted">{'No scheme is running today.'}</div>}
      </div>
      <div className="sechead"><h3>{'Services'}</h3></div>
      <div className="boost-grid">
        {BOOST_SERVICES.map(s => { const Ic = ICONS[s.icon] ?? Sparkles; const r = open.get(s.key); return (
          <div key={s.key} className="card boost-card">
            <div className="tile-ic"><Ic /></div>
            <div className="t">{s.title}</div>
            <div className="s">{s.line}</div>
            {r ? <span className="badge ok">{'Requested'} · {showDate(r.createdAt.slice(0, 10))}</span>
              : <button className="btn primary small" onClick={() => void request(s.key, s.title)}>{'Request'}</button>}
          </div>); })}
      </div>
      <div className="muted" style={{ fontSize: '.8125rem' }}>{'Credit and insurance come only from licensed banks, NBFCs and insurers. Hanubix connects you; it does not lend or sell insurance.'}</div>
    </div>
  );
}
