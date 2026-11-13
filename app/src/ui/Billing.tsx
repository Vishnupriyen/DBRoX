// Plan & billing: what this distributor has, until when, and one button to set up UPI Autopay.
// Nothing here can change the plan on the phone — the server decides; this page only shows it and starts payment.
import { useEffect, useState } from 'react';
import { CreditCard, RefreshCw, Check, X } from 'lucide-react';
import { licenceState, refreshLicence, type LicenceState } from '../core/licence';
import { ENV_SERVER, server, syncNow } from '../core/sync';
import { authHeader } from '../core/secure';
import { MODULES, type Role } from '../core/types';
import { inr } from '../core/i18n';
import { notify } from './dialog';

const TIER: Record<string, string> = { starter: 'Starter', small: 'Small', medium: 'Medium', big: 'Big', enterprise: 'Enterprise' };
const PACK: Record<string, string> = { last_mile: 'Last Mile', office: 'Office', complete: 'Complete' };
const PRICE: Record<string, Record<string, number>> = {
  starter: { last_mile: 399, office: 399, complete: 499 }, small: { last_mile: 799, office: 799, complete: 999 },
  medium: { last_mile: 1599, office: 1599, complete: 1999 }, big: { last_mile: 3199, office: 3199, complete: 3999 },
};
const STATUS: Record<LicenceState['status'], [string, string]> = {
  trial: ['Free trial', 'ok'], active: ['Active', 'ok'], grace: ['Payment pending', 'warn'], locked: ['Locked', 'bad'], expired: ['Needs internet to renew', 'warn'],
};
const fmt = (d?: string) => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function Billing({ role }: { role: Role }) {
  const [l, setL] = useState<LicenceState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { licenceState(!!ENV_SERVER).then(setL); const on = (e: Event) => setL((e as CustomEvent).detail); window.addEventListener('hanubix:licence', on); return () => window.removeEventListener('hanubix:licence', on); }, []);
  if (!l) return null;
  const [label, tone] = STATUS[l.status];
  const price = l.tier && l.pack ? PRICE[l.tier]?.[l.pack] : undefined;
  const pay = async () => {
    setBusy(true);
    try {
      const url = await server();
      const r = await fetch(`${url}/v1/billing/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeader()) }, body: '{}' });
      const j = await r.json() as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error ?? 'Could not start the payment.');
      window.location.href = j.url; // Razorpay's page: UPI Autopay set up once, paid every month automatically
    } catch (e) { await notify('Payment', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className="kpi navy">
        <div className="v">{l.demo ? 'Demo' : `${TIER[l.tier ?? ''] ?? ''} · ${PACK[l.pack ?? ''] ?? ''}`}</div>
        <div className="l"><span className={`badge ${tone}`}>{label}</span>{price ? ` · ${inr(price)}/month + GST` : ''}</div>
      </div>
      {l.message && <div className={`alert ${l.status === 'locked' ? 'bad' : ''}`}><div>{l.message}</div></div>}
      {!l.demo && <div className="card stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">{l.status === 'trial' ? 'Trial ends' : 'Paid until'}</span><b>{fmt(l.paidThrough)}</b></div>
        {(l.status === 'grace' || l.status === 'trial' || l.status === 'active') && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">If not renewed, billing pauses on</span><b>{fmt(l.lockOn)}</b></div>}
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Licence checked until</span><b>{fmt(l.validUntil)}</b></div>
      </div>}
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Modules in your plan</div>
        <div className="list">{MODULES.map(m => <div key={m.key} className="item" style={{ minHeight: 40 }}>{l.mods[m.key] ? <Check size={18} style={{ color: 'var(--ok)' }} /> : <X size={18} style={{ color: 'var(--dim)' }} />}<span className="grow" style={{ color: l.mods[m.key] ? undefined : 'var(--dim)' }}>{m.name.replace(/^TESRAX |^RoX /, '')}</span></div>)}</div>
      </div>
      {!l.demo && role === 'owner' && <button className="btn primary big block" disabled={busy} onClick={pay}><CreditCard /> {l.status === 'trial' ? 'Set up UPI Autopay' : 'Renew now'}</button>}
      {!l.demo && <button className="btn block" onClick={async () => { await syncNow(); await refreshLicence(); }}><RefreshCw /> Check again</button>}
      <div className="muted">{l.demo ? 'This is the demo. In the real app your plan is set by Hanubix and paid by UPI Autopay.' : 'Autopay collects the same amount every month. If a payment fails, everything keeps working for 7 days with a reminder. After that, new orders and bills pause until you renew — your data stays, and you can still collect money and download everything.'}</div>
    </div>
  );
}
