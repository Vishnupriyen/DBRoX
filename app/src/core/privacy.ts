// DPDP Act 2023 on the phone (security standard, 13 Nov 2026): the privacy notice, the person's choices and requests.
// NOTICE STATUS: draft — legal review pending (owner decision, 13 Nov 2026: a lawyer reviews it later). A change to the
// notice text means a new version in shared/privacy.json: everyone is asked again.
import { db, session } from './db';
import { api, PRIVACY_VERSION, server } from './sync';
import type { Role } from './types';

export const NOTICE_STATUS = 'Draft — legal review pending';
export const NOTICE_TITLE = 'How Hanubix uses your information';
/** plain English, short: what, why, who sees it, how long, your rights, who to contact */
export const NOTICE: { h: string; p: string }[] = [
  { h: 'What we keep', p: 'Your name, mobile number and role; your firm\'s name, GSTIN and address; the business records you and your team enter (bills, orders, payments, stock, shops); attendance and, only if you allow it, your location while on duty.' },
  { h: 'Why', p: 'To run your firm\'s billing, delivery, collection, stock and staff work; to let you log in safely; to keep tax records the law asks for. We never sell your information or use it for advertising.' },
  { h: 'Who sees it', p: 'Your firm\'s owner and the people the owner gives access to, each seeing only what their role needs. Hanubix support only when the owner allows it, for 24 hours, and every look is recorded. Our service providers (our server company, encrypted backups in Mumbai, payments by Razorpay) only to run the service.' },
  { h: 'How long', p: 'While your firm uses Hanubix. Bills, payments and credit notes are kept 8 years as GST law requires. Login records 12 months, then archived up to 5 years. Backups are removed within 35 days.' },
  { h: 'Your rights', p: 'See and download your information, ask us to correct it, ask us to erase it (tax records keep only what the law needs), name someone to act for you, and complain. We answer within 30 days. Withdraw any optional choice at any time in Menu → Privacy & security.' },
  { h: 'Children', p: 'Hanubix is for businesses. We do not knowingly collect information about anyone under 18.' },
];
/** the optional choices, each separate and off until the person turns it on */
export const OPTIONAL: { kind: 'ai_scan' | 'location' | 'analytics' | 'whatsapp'; label: string; why: string; owner?: boolean; field?: boolean }[] = [
  { kind: 'ai_scan', label: 'AI photo reading', why: 'Photos of bills you choose to read are sent to an AI service outside India (Anthropic) to read them. For the whole firm.', owner: true },
  { kind: 'location', label: 'Location while on duty', why: 'Live van tracking and the travel record while your day is open. Never after you close the day.', field: true },
  { kind: 'analytics', label: 'Help improve TESRAX', why: 'Counts of what TESRAX understood or missed, to make it better. No business figures.' },
  { kind: 'whatsapp', label: 'WhatsApp support', why: 'Support and offers on WhatsApp to your mobile number.' },
];
export const isFieldRole = (r: Role) => r === 'salesman' || r === 'delivery' || r === 'rep';

/** the grievance officer (server setting; the owner by default until the founder sets the contact) */
export type Grievance = { officer: string; email: string; phone: string };
export const DEFAULT_GRIEVANCE: Grievance = { officer: 'R. Vishnupriyen', email: '', phone: '' };

export type PrivacyStatus = {
  version: string; consents: Record<string, { granted: boolean; version: string; at: string }>; firm: { ai_scan: boolean };
  grievance: Grievance; nominee: { name: string; contact: string } | null; requests: { id: string; kind: string; status: string; due: string; at: string }[];
};

const localKey = (k: string) => `consent:${session().userId}:${k}`;
/** has this person ticked the current notice? (kept on the phone too, so an offline start never asks again) */
export async function noticeAccepted(): Promise<boolean> {
  if (!(await server())) return true; // the demo: nothing leaves the phone
  if ((await db.meta.get(localKey('privacy')))?.value === PRIVACY_VERSION) return true;
  try {
    const st = await api<PrivacyStatus>('/v1/privacy/status');
    const ok = st.consents.privacy?.granted && st.consents.privacy.version === PRIVACY_VERSION;
    if (ok) await db.meta.put({ key: localKey('privacy'), value: PRIVACY_VERSION });
    for (const [k, v] of Object.entries(st.consents)) if (k !== 'privacy') await db.meta.put({ key: localKey(k), value: v.granted });
    return !!ok;
  } catch { return true; } // offline: asked at the next start with signal (nothing new is sent meanwhile)
}
/** record a choice (the notice itself, or an optional one) on the server, and on this phone */
export async function giveConsent(kind: string, granted: boolean): Promise<PrivacyStatus | null> {
  if (!(await server())) { await db.meta.put({ key: localKey(kind), value: kind === 'privacy' ? PRIVACY_VERSION : granted }); return null; }
  const st = await api<PrivacyStatus>('/v1/privacy/consent', { kind, granted, version: PRIVACY_VERSION });
  await db.meta.put({ key: localKey(kind), value: kind === 'privacy' ? PRIVACY_VERSION : granted });
  return st;
}
/** location is read only after the person allowed it (the demo: allowed, nothing leaves the phone) */
export async function locationAllowed(): Promise<boolean> {
  if (!(await server())) return true;
  return (await db.meta.get(localKey('location')))?.value === true;
}
