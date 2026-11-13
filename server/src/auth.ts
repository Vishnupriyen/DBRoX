import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

// PINs are never stored in plain text: scrypt hash with a per-user salt.
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `s1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [v, s, h] = stored.split('$');
  if (v !== 's1' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = scryptSync(pin, Buffer.from(s, 'base64'), want.length);
  return timingSafeEqual(want, got);
}

export interface Claims { t: string; u: string; r: string; e: number; exp: number; k?: number }

/** the owner and a brand's head office hold the money and can export everything: shorter tokens (14 days) */
export const tokenDays = (role: string) => (role === 'owner' || role === 'cadmin' ? 14 : 30);
/** PIN length by role (owner decision 13 Nov 2026): owner and head office 6 digits, everyone else 4 */
export const pinLength = (role: string) => (role === 'owner' || role === 'cadmin' ? 6 : 4);
export const pinFits = (role: string, pin: unknown) => typeof pin === 'string' && new RegExp(`^\\d{${pinLength(role)}}$`).test(pin);

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

// Small signed token (HMAC-SHA256). "e" = token epoch: bumping it in the users table logs the phone out.
// "k" = key id: 1 for JWT_SECRET. During a key change JWT_SECRET_OLD still opens tokens until they are renewed.
export function signToken(c: Omit<Claims, 'exp' | 'k'>, days = tokenDays(c.r)): string {
  const body = b64(JSON.stringify({ ...c, k: 1, exp: Math.floor(Date.now() / 1000) + days * 86400 }));
  const sig = createHmac('sha256', config.jwtSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
const sigOk = (body: string, sig: string, secret: string) => {
  if (!secret) return false;
  const want = createHmac('sha256', secret).update(body).digest('base64url');
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
};

export function readToken(token: string | undefined): Claims | null {
  if (!token) return null;
  const [body, sig] = token.replace(/^Bearer\s+/i, '').split('.');
  if (!body || !sig) return null;
  if (!sigOk(body, sig, config.jwtSecret) && !sigOk(body, sig, config.jwtSecretOld)) return null;
  let c: Claims;
  try { c = JSON.parse(Buffer.from(body, 'base64url').toString()) as Claims; } catch { return null; }
  if (c.exp < Date.now() / 1000) return null;
  return c;
}

// Brute-force guard for 4-digit PINs: 5 wrong tries → locked for 15 minutes.
// (Per server instance; at scale this moves to a shared store.)
const fails = new Map<string, { n: number; until: number }>();
export function loginLocked(phone: string) { const f = fails.get(phone); return !!f && f.until > Date.now(); }
export function loginFailed(phone: string) {
  const f = fails.get(phone) ?? { n: 0, until: 0 };
  f.n++; if (f.n >= 5) { f.until = Date.now() + 15 * 60000; f.n = 0; }
  fails.set(phone, f);
}
export function loginOk(phone: string) { fails.delete(phone); }
