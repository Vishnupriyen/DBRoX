// The phone's side of licences. Our server decides what a distributor has paid for and seals it; the phone only
// checks the seal (public key built into the app) and obeys it. Editing settings or the stored licence on a phone
// cannot turn a module on: an edited licence fails the seal and the app falls back to "connect to renew".
import { db, setWriteBlock, today } from './db';
import type { ModuleKey, Settings } from './types';

export type LicenceStatus = 'trial' | 'active' | 'grace' | 'locked' | 'expired';
export type Licence = {
  v: 1; t: string; tier: string; pack: string; mods: Record<ModuleKey, boolean>;
  status: Exclude<LicenceStatus, 'expired'>; paidThrough: string; lockOn: string; validUntil: string; iat: string;
};
export type LicenceState = {
  status: LicenceStatus; mods: Record<ModuleKey, boolean>; demo: boolean;
  tier?: string; pack?: string; paidThrough?: string; lockOn?: string; validUntil?: string; message?: string;
};

let PUBLIC_KEY = (import.meta.env.VITE_LICENCE_PUBLIC_KEY as string | undefined) ?? '';
/** tests only: the key a test server sealed with */
export function setLicencePublicKey(k: string) { PUBLIC_KEY = k; }
const ALL_OFF: Record<ModuleKey, boolean> = { sales: false, bill: false, inventory: false, delivery: false, collection: false, accountant: false, gst: false, payroll: false };

const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

/** checks the server's seal; returns the licence only if nobody changed it */
export async function openLicence(token: string, publicKeyB64?: string): Promise<Licence | null> {
  publicKeyB64 ??= PUBLIC_KEY;
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig || !publicKeyB64) return null;
    const key = await crypto.subtle.importKey('spki', fromB64u(publicKeyB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const bytes = fromB64u(body);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64u(sig), bytes);
    return ok ? JSON.parse(new TextDecoder().decode(bytes)) as Licence : null;
  } catch { return null; }
}

export async function saveLicence(token: string | null | undefined) {
  if (!token) return;
  await db.meta.put({ key: 'licence', value: token });
  await refreshLicence();
}

const MSG = {
  locked: 'Hanubix is locked because the plan is not renewed. You can still collect money and download your data. Renew to take orders and make bills again.',
  expired: 'Connect to the internet once so Hanubix can renew your licence. Until then, new orders and bills are paused.',
};

let current: LicenceState | null = null;
/**
 * The licence in force right now. Demo (no server): every module the demo switch allows.
 * With a server: the sealed licence, checked against today's date even when offline.
 */
export async function licenceState(serverMode: boolean, settings?: Settings): Promise<LicenceState> {
  if (!serverMode) {
    const s = settings ?? await db.settings.toCollection().first();
    return { status: 'active', mods: s?.modules ?? { ...ALL_OFF, bill: true }, demo: true };
  }
  const tok = (await db.meta.get('licence'))?.value as string | undefined;
  const l = tok ? await openLicence(tok) : null;
  if (!l) return { status: 'expired', mods: ALL_OFF, demo: false, message: MSG.expired };
  const t = today();
  let status: LicenceStatus = l.status;
  if (t >= l.lockOn) status = 'locked';            // the lock day comes even if the phone stays offline
  else if (t > l.validUntil) status = 'expired';   // must sync at least every 14 days
  return { status, mods: l.mods, demo: false, tier: l.tier, pack: l.pack, paidThrough: l.paidThrough, lockOn: l.lockOn, validUntil: l.validUntil, message: status === 'locked' ? MSG.locked : status === 'expired' ? MSG.expired : undefined };
}

/** recompute and apply: locked/expired → the save guard refuses new orders and bills on this phone too */
export async function refreshLicence(serverMode = !!(import.meta.env.VITE_SERVER_URL as string | undefined)): Promise<LicenceState> {
  current = await licenceState(serverMode);
  setWriteBlock(current.status === 'locked' || current.status === 'expired' ? current.message! : null);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('hanubix:licence', { detail: current }));
  return current;
}
export const lastLicence = () => current;
