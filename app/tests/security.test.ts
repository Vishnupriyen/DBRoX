// Security standard round (13 Nov 2026), item 2 — the phone's data at rest, against the real Hanubix server:
// no PIN in any form on the phone after login, no token in localStorage, 5 wrong offline PINs lock for 15 minutes,
// and a phone offline longer than 14 days must log in online (30 days: its copy of the firm's data is removed).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ChangeSet, db, setSession } from '../src/core/db';
import { CONSENT } from '../../server/test/fixtures';

type Server = Awaited<ReturnType<typeof import('../../server/test/harness').startServer>>;
let srv: Server;
const store = new Map<string, string>();
const OWNER_PHONE = '9611100001', OWNER_PIN = '482613', STAFF_PHONE = '9611100002', STAFF_PIN = '7265';

beforeAll(async () => {
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() } });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
  const { startServer } = await import('../../server/test/harness');
  srv = await startServer();
  Object.assign(globalThis, { fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => srv.fetch(url, init) });
}, 120000);
afterAll(async () => { await srv?.stop(); });

const online = (v: boolean) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: v }, configurable: true });
async function dump() {
  const out: Record<string, unknown[]> = {};
  for (const t of db.tables) out[t.name] = await t.toArray();
  return JSON.stringify(out);
}

describe('the phone keeps no PIN and no token in plain sight', () => {
  let tenant = '', owner = '';
  it('after sign-up, adding staff, syncing and logging in: no PIN anywhere in the phone database or localStorage', async () => {
    const { signup, login, syncNow } = await import('../src/core/sync');
    // an older app version left its token here: it moves into the secure store and leaves localStorage
    store.set('dbrox.token', 'old-token');
    const { getToken } = await import('../src/core/secure');
    expect(await getToken()).toBe('old-token');
    expect(store.has('dbrox.token')).toBe(false);
    await db.settings.put({ id: 's1', tenantId: '', firmName: 'X', gstin: '', address: '', stateCode: '33', phone: '', serverUrl: 'http://srv.test', modules: {}, billFormat: 'A5', returnApprovalLimit: 0, discountAlertPct: 0, createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z', dirty: 0 } as never);
    const up = await signup({ firmName: 'Phone Safe', ownerName: 'Owner', phone: OWNER_PHONE, pin: OWNER_PIN, consent: CONSENT });
    tenant = up.tenantId; owner = up.userId;
    setSession(tenant, owner);
    // this phone's settings are the firm's settings record (as on a real phone), with the server address kept
    const sid = (await srv.query(`SELECT id FROM docs WHERE tenant_id=$1 AND tbl='settings'`, [tenant]))[0].id as string;
    await db.settings.clear();
    const cs = new ChangeSet();
    cs.put('settings', { id: sid, firmName: 'Phone Safe', gstin: '', address: '', stateCode: '33', phone: OWNER_PHONE, serverUrl: 'http://srv.test', modules: {}, billFormat: 'A5', returnApprovalLimit: 0, discountAlertPct: 0 });
    cs.put('staff', { id: 'ph-sm', name: 'Ravi', phone: STAFF_PHONE, role: 'salesman', pin: STAFF_PIN, active: true });
    await cs.commit('Staff added');
    expect(await syncNow()).toMatch(/^Synced/);
    const l = await login(OWNER_PHONE, OWNER_PIN);
    expect(l && 'userId' in l && l.userId).toBe(owner);
    const all = await dump() + JSON.stringify([...store.entries()]);
    for (const pin of [OWNER_PIN, STAFF_PIN]) expect(all.includes(pin), pin).toBe(false);
    const token = await getToken();
    expect(token.length).toBeGreaterThan(20);
    expect([...store.values()].some(v => v.includes(token.split('.')[0]))).toBe(false);
    expect(store.has('dbrox.token')).toBe(false);
  });

  it('the offline login checks the PIN against its hash on the phone; 5 wrong PINs lock it for 15 minutes', async () => {
    const { login } = await import('../src/core/sync');
    online(false);
    try {
      const ok = await login(OWNER_PHONE, OWNER_PIN);
      expect(ok && 'userId' in ok && ok.userId).toBe(owner);
      for (let i = 0; i < 4; i++) expect(await login(OWNER_PHONE, '739154')).toBeNull();
      const fifth = await login(OWNER_PHONE, '739154');
      expect(fifth && 'error' in fifth && fifth.error).toMatch(/Too many wrong PINs/);
      const right = await login(OWNER_PHONE, OWNER_PIN); // even the right PIN waits
      expect(right && 'error' in right).toBe(true);
      vi.useFakeTimers({ now: Date.now() + 16 * 60000, toFake: ['Date'] });
      const later = await login(OWNER_PHONE, OWNER_PIN);
      expect(later && 'userId' in later && later.userId).toBe(owner);
    } finally { vi.useRealTimers(); online(true); }
  });

  it('a phone that has not reached the server for 14 days refuses the offline login; at 30 days its data is removed', async () => {
    const { login } = await import('../src/core/sync');
    const { offlineState, touchServer } = await import('../src/core/secure');
    online(false);
    try {
      await touchServer(Date.now() - 15 * 86400000);
      const r = await login(OWNER_PHONE, OWNER_PIN);
      expect(r && 'error' in r && r.error).toMatch(/not reached the server for 15 days/);
      expect((await offlineState(true)).mustLogin).toBe(true);
      expect((await offlineState(true)).wipe).toBe(false);
      await touchServer(Date.now() - 12 * 86400000);
      expect((await offlineState(true)).warnDaysLeft).toBe(2);
      await touchServer(Date.now() - 31 * 86400000);
      expect((await offlineState(true)).wipe).toBe(true);
      expect((await offlineState(false)).mustLogin).toBe(false); // the demo has no server: never locked
    } finally { online(true); }
    // back online: logging in starts the clock again
    expect(await login(OWNER_PHONE, OWNER_PIN)).toMatchObject({ userId: owner });
    expect((await offlineState(true)).days).toBe(0);
  });

  it('the app lock checks only this person\'s PIN', async () => {
    const { checkPinOffline } = await import('../src/core/secure');
    expect((await checkPinOffline('', OWNER_PIN, tenant, owner)).ok).toBe(true);
    expect((await checkPinOffline('', STAFF_PIN, tenant, owner)).ok).toBe(false);
  });
});
