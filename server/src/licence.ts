// Licences: what a distributor has paid for, decided ONLY here on the server, sealed with our private key.
// The phone can read a licence but cannot change it (the seal breaks). Status is worked out from dates,
// so it is always right even if a daily job never ran.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

export const MODULES = ['sales', 'bill', 'inventory', 'delivery', 'collection', 'accountant', 'gst', 'payroll'] as const;
export type ModuleKey = typeof MODULES[number];
export const PACKS: Record<string, ModuleKey[]> = {
  last_mile: ['delivery', 'collection'],
  office: ['accountant', 'payroll'],
  complete: [...MODULES],
};
export const TIERS = ['starter', 'small', 'medium', 'big', 'enterprise'];
export const GRACE_DAYS = 7;      // after the paid month ends, everything still works for 7 days (with a banner)
export const OFFLINE_DAYS = 14;   // a phone must sync at least this often to keep billing

export type Billing = { tier: string; pack: string; trialEnds: string | null; paidUntil: string | null };
export type State = { status: 'trial' | 'active' | 'grace' | 'locked'; paidThrough: string; lockOn: string; daysLeft: number };

const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
/** today's date in India */
export const istToday = (now = Date.now()) => new Date(now + 330 * 60000).toISOString().slice(0, 10);

/** trial → active → grace (7 days) → locked. A lock always starts at the beginning of a day, never mid-day. */
export function billingState(b: Billing, today: string): State {
  const paidThrough = [b.paidUntil, b.trialEnds].filter(Boolean).sort().pop() ?? today;
  const lockOn = addDays(paidThrough, GRACE_DAYS + 1);
  const covered = today <= paidThrough;
  const status = covered ? (b.paidUntil && b.paidUntil >= today ? 'active' : 'trial') : today < lockOn ? 'grace' : 'locked';
  return { status, paidThrough, lockOn, daysLeft: covered ? days(today, paidThrough) : days(today, lockOn) };
}

export type Licence = {
  v: 1; t: string; tier: string; pack: string; mods: Record<ModuleKey, boolean>;
  status: State['status']; paidThrough: string; lockOn: string; validUntil: string; iat: string;
};
export function makeLicence(tenantId: string, b: Billing, today: string): Licence {
  const s = billingState(b, today);
  const allowed = new Set(PACKS[b.pack] ?? PACKS.complete);
  const mods = Object.fromEntries(MODULES.map(m => [m, allowed.has(m)])) as Record<ModuleKey, boolean>;
  // the phone works offline until the lock day or 14 days, whichever is first; then it must sync
  const validUntil = [s.lockOn, addDays(today, OFFLINE_DAYS)].sort()[0];
  return { v: 1, t: tenantId, tier: b.tier, pack: b.pack, mods, status: s.status, paidThrough: s.paidThrough, lockOn: s.lockOn, validUntil, iat: new Date().toISOString() };
}

// ---------------------------------------------------------------- the seal (ECDSA P-256, readable by any phone browser)
let keys: { priv: KeyObject; pub: KeyObject } | null = null;
function loadKeys() {
  if (keys) return keys;
  const pem = process.env.LICENCE_PRIVATE_KEY;
  if (pem) { const priv = createPrivateKey(pem.replace(/\\n/g, '\n')); keys = { priv, pub: createPublicKey(priv) }; return keys; }
  if (process.env.NODE_ENV === 'production') throw new Error('LICENCE_PRIVATE_KEY must be set in production');
  const k = generateKeyPairSync('ec', { namedCurve: 'P-256' }); // development only: a fresh key per run
  keys = { priv: k.privateKey, pub: k.publicKey };
  return keys;
}
const b64u = (b: Buffer) => b.toString('base64url');
export function sealLicence(l: Licence): string {
  const body = Buffer.from(JSON.stringify(l));
  const sig = sign('sha256', body, { key: loadKeys().priv, dsaEncoding: 'ieee-p1363' });
  return `${b64u(body)}.${b64u(sig)}`;
}
export function openLicence(token: string): Licence | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const ok = verify('sha256', Buffer.from(body, 'base64url'), { key: loadKeys().pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  return ok ? JSON.parse(Buffer.from(body, 'base64url').toString()) as Licence : null;
}
/** the public key the app is built with (VITE_LICENCE_PUBLIC_KEY) */
export const publicKeySpki = () => loadKeys().pub.export({ type: 'spki', format: 'der' }).toString('base64');

/** a bigger pack is an upgrade (immediate); a smaller one waits for the end of the paid month */
export const isUpgrade = (from: string, to: string) => (PACKS[to]?.length ?? 0) > (PACKS[from]?.length ?? 0) || (from !== 'complete' && to === 'complete');
