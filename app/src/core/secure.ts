// Phone data at rest (security standard, 13 Nov 2026, item 2 — the chosen plan "D"):
//  - no PIN is ever kept on the phone: only a salted PBKDF2 hash ("verifier") of each PIN that logged in here, for the
//    offline login and the app lock (PINs typed for a NEW staff member wait in that record only until the server has them)
//  - the login token is kept in the Android Keystore (HanubixSecure plugin), never in localStorage; the web app keeps it
//    in its own database
//  - 5 wrong PINs on the phone lock it for 15 minutes (the server limits its own tries)
//  - a phone that has not reached the server for 14 days must log in online; after 30 days its copy of the firm's data is
//    removed (a lost phone can't be used offline for ever)
// These are the sync layer's own records (meta), never business records: they are not saved through ChangeSet and never
// leave the phone.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { db } from './db';

const TOKEN_KEY = 'auth.token';
export const OFFLINE_LOGIN_DAYS = 14;   // owner decision 13 Nov 2026
export const OFFLINE_WIPE_DAYS = 30;    // a further 16 days' warning before the phone's copy is removed
export const WARN_FROM_DAYS = 10;
export const LOCK_TRIES = 5;
export const LOCK_MINUTES = 15;
export const AWAY_LOCK_MINUTES = 5;     // the app asks for the PIN again after this long in the background
const ITER = 100_000;

// ---------------------------------------------------------------- the login token
const Native = registerPlugin<{ get(o: { key: string }): Promise<{ value?: string | null }>; set(o: { key: string; value: string }): Promise<void>; remove(o: { key: string }): Promise<void> }>('HanubixSecure');
const native = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } };
let cache: string | null | undefined;

/** the token for the server (an older app version kept it in localStorage: moved once, then removed from there) */
export async function getToken(): Promise<string> {
  let old: string | null = null;
  try { old = localStorage.getItem('dbrox.token'); } catch { /* no localStorage */ }
  if (old) { await setToken(old); try { localStorage.removeItem('dbrox.token'); } catch { /* ignore */ } return old; }
  if (native()) {
    if (cache === undefined) { try { cache = (await Native.get({ key: TOKEN_KEY })).value ?? null; } catch { cache = null; } }
    return cache ?? '';
  }
  return String((await db.meta.get(TOKEN_KEY))?.value ?? '');
}
export async function setToken(t: string) {
  if (native()) { cache = t; try { await Native.set({ key: TOKEN_KEY, value: t }); return; } catch { /* falls back below */ } }
  await db.meta.put({ key: TOKEN_KEY, value: t });
}
export async function clearToken() {
  cache = null;
  try { localStorage.removeItem('dbrox.token'); } catch { /* ignore */ }
  if (native()) { try { await Native.remove({ key: TOKEN_KEY }); } catch { /* ignore */ } }
  await db.meta.delete(TOKEN_KEY).catch(() => {});
}
export const authHeader = async () => ({ authorization: `Bearer ${await getToken()}` });

// ---------------------------------------------------------------- PIN verifiers (hashes only)
type Verifier = { phone: string; tenantId: string; userId: string; salt: string; hash: string; iter: number; len: number };
const b64 = (a: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(a)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function derive(pin: string, salt: Uint8Array, iter: number) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, k, 256));
}
const vKey = (tenantId: string, userId: string) => `pinv:${tenantId}|${userId}`;

/** remember a PIN that just worked (online login, or a new staff record made on this phone) — as a salted hash only */
export async function rememberPin(tenantId: string, userId: string, phone: string, pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const v: Verifier = { phone, tenantId, userId, salt: b64(salt), hash: await derive(pin, salt, ITER), iter: ITER, len: pin.length };
  await db.meta.put({ key: vKey(tenantId, userId), value: v });
}
async function verifiers(): Promise<Verifier[]> {
  return (await db.meta.where('key').startsWith('pinv:').toArray()).map(r => r.value as Verifier);
}
async function matches(v: Verifier, pin: string) { return v.len === pin.length && await derive(pin, unb64(v.salt), v.iter) === v.hash; }
/** how many digits this phone number's PIN has, when this phone knows it (the login pad then fills that many dots) */
export async function pinLengthFor(phone: string): Promise<number | null> {
  const v = (await verifiers()).find(x => x.phone === phone);
  return v ? v.len : null;
}
export async function hasVerifier(tenantId: string, userId: string) { return !!(await db.meta.get(vKey(tenantId, userId))); }

/**
 * Old phones kept staff PINs in plain text, and a PIN typed for a new staff member sits in its record until it is sent.
 * Each one becomes a verifier here; then the plain PIN is removed — once the server has it (not waiting to be sent), or
 * at once when there is no server (the demo). Runs at start, after every sync and before an offline login.
 */
export async function securePins(hasServer: boolean) {
  for (const s of await db.staff.toArray()) {
    const pin = (s as { pin?: string }).pin;
    if (!pin) continue;
    const cur = (await db.meta.get(vKey(s.tenantId, s.id)))?.value as Verifier | undefined;
    if (!cur || cur.phone !== s.phone || !(await matches(cur, pin))) await rememberPin(s.tenantId, s.id, s.phone, pin);
    if (!hasServer || !s.dirty) await db.staff.where('id').equals(s.id).modify(x => { if ((x as { pin?: string }).pin === pin) delete (x as { pin?: string }).pin; });
  }
}

// ---------------------------------------------------------------- wrong PINs on this phone
type Fails = { n: number; until: number };
export async function pinLockedUntil(now = Date.now()): Promise<number> {
  const f = (await db.meta.get('pinFails'))?.value as Fails | undefined;
  return f && f.until > now ? f.until : 0;
}
async function failed(now = Date.now()) {
  const f = ((await db.meta.get('pinFails'))?.value as Fails | undefined) ?? { n: 0, until: 0 };
  const n = f.until && f.until <= now ? 1 : f.n + 1;
  await db.meta.put({ key: 'pinFails', value: n >= LOCK_TRIES ? { n: 0, until: now + LOCK_MINUTES * 60000 } : { n, until: 0 } });
}
const passed = () => db.meta.delete('pinFails');

export type PinCheck = { ok: true; tenantId: string; userId: string } | { ok: false; why: 'wrong' | 'locked' | 'unknown'; until?: number };
/** a PIN checked on this phone only (offline login, app lock): 5 wrong → 15 minutes' lock */
export async function checkPinOffline(phone: string, pin: string, tenantId?: string, userId?: string): Promise<PinCheck> {
  const until = await pinLockedUntil();
  if (until) return { ok: false, why: 'locked', until };
  const vs = (await verifiers()).filter(v => (!phone || v.phone === phone) && (!tenantId || v.tenantId === tenantId) && (!userId || v.userId === userId));
  if (!vs.length) return { ok: false, why: 'unknown' };
  for (const v of vs) if (await matches(v, pin)) { await passed(); return { ok: true, tenantId: v.tenantId, userId: v.userId }; }
  await failed();
  const u = await pinLockedUntil();
  return u ? { ok: false, why: 'locked', until: u } : { ok: false, why: 'wrong' };
}

// ---------------------------------------------------------------- last contact with the server
export async function touchServer(now = Date.now()) { await db.meta.put({ key: 'lastServer', value: now }); }
/** days since this phone last reached the server (0 for a phone that never kept the date: it starts counting now) */
export async function daysOffline(now = Date.now()): Promise<number> {
  const v = Number((await db.meta.get('lastServer'))?.value ?? 0);
  if (!v) { await touchServer(now); return 0; }
  return Math.floor((now - v) / 86400000);
}
export type OfflineState = { days: number; mustLogin: boolean; wipe: boolean; warnDaysLeft: number | null };
export async function offlineState(hasServer: boolean, now = Date.now()): Promise<OfflineState> {
  if (!hasServer) return { days: 0, mustLogin: false, wipe: false, warnDaysLeft: null };
  const days = await daysOffline(now);
  return { days, mustLogin: days >= OFFLINE_LOGIN_DAYS, wipe: days >= OFFLINE_WIPE_DAYS, warnDaysLeft: days >= WARN_FROM_DAYS && days < OFFLINE_LOGIN_DAYS ? OFFLINE_LOGIN_DAYS - days : null };
}
