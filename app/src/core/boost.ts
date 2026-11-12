// Business Boost (locked name, founder 12 Nov 2026): offers running now (from the real schemes) and services a distributor can
// ask for. A request is saved (synced like any record) and, when a Hanubix support WhatsApp number is set in the build, opens
// WhatsApp with the request written out — so it reaches the Hanubix team today, before the control panel exists.
// Credit and insurance requests only ever go to licensed banks / NBFCs / insurers; Hanubix never lends or sells insurance itself.
import { ChangeSet, db, getSettings, session, today } from './db';
import type { BoostRequest, Scheme } from './types';

export interface BoostService { key: string; title: string; line: string; icon: string }
export const BOOST_SERVICES: BoostService[] = [
  { key: 'gst', title: 'GST filing and CA help', line: 'Monthly returns, GSTR-1 and 3B, notices — a CA who knows distributors.', icon: 'FileCheck2' },
  { key: 'credit', title: 'Working capital', line: 'Stock and dues funding from licensed banks and NBFCs, based on your business.', icon: 'Landmark' },
  { key: 'insurance', title: 'Stock and godown insurance', line: 'Fire, theft and flood cover for your godown and stock, from licensed insurers.', icon: 'ShieldCheck' },
  { key: 'equipment', title: 'Printers and scanners', line: 'Bill printers, barcode scanners and phones for your team.', icon: 'Printer' },
  { key: 'data', title: 'Data plans for staff', line: 'Mobile data for salesmen and drivers, billed to the business.', icon: 'Smartphone' },
  { key: 'tally', title: 'Tally help', line: 'Set-up, ledgers and moving your Tally data into Hanubix.', icon: 'BookOpen' },
];

/** the schemes running today, newest first, with their product names — "Offers running now" */
export async function offersNow() {
  const t = today();
  const products = new Map((await db.products.toArray()).map(p => [p.id, p.name]));
  const cos = new Map((await db.companies.toArray()).map(c => [c.id, c.name]));
  return (await db.schemes.toArray())
    .filter((s: Scheme) => s.from <= t && s.to >= t)
    .sort((a, b) => b.from.localeCompare(a.from))
    .map(s => ({ id: s.id, name: s.name, product: s.productId ? products.get(s.productId) ?? '' : 'All products', company: cos.get(s.companyId) ?? '', to: s.to }));
}

/** the latest open request for each service */
export async function openRequests() {
  const all = (await db.boostRequests.toArray()).filter(r => r.status === 'open');
  return new Map(all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(r => [r.kind, r]));
}

/** ask for a service: saved once (a second tap while one is open does nothing new) and the WhatsApp text to send */
export async function requestService(kind: string, note = ''): Promise<{ request: BoostRequest; message: string; already: boolean }> {
  const svc = BOOST_SERVICES.find(s => s.key === kind);
  if (!svc) throw new Error('Unknown service.');
  const open = (await openRequests()).get(kind);
  const st = await getSettings();
  const me = await db.staff.get(session().userId);
  const message = `Hanubix Business Boost — request: ${svc.title}\nFirm: ${st.firmName}${st.gstin ? ` (GSTIN ${st.gstin})` : ''}\nFrom: ${me?.name ?? ''}${me?.phone ? `, ${me.phone}` : ''}${note.trim() ? `\nNote: ${note.trim()}` : ''}`;
  if (open) return { request: open, message, already: true };
  const cs = new ChangeSet();
  const request = cs.put<BoostRequest>('boostRequests', { kind, note: note.trim() || undefined, status: 'open', by: session().userId } as BoostRequest, 'Business Boost request');
  await cs.commit('Business Boost request');
  return { request, message, already: false };
}

/** the WhatsApp link to the Hanubix team (support number set in the build), or null when none is set */
export function boostWhatsApp(message: string) {
  const n = (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined)?.replace(/\D/g, '');
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : null;
}
