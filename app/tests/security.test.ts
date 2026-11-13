// Security standard round (13 Nov 2026), item 2 — the phone's data at rest, against the real Hanubix server:
// no PIN in any form on the phone after login, no token in localStorage, 5 wrong offline PINs lock for 15 minutes,
// and a phone offline longer than 14 days must log in online (30 days: its copy of the firm's data is removed).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ChangeSet, db, onSide, RoxDB, setSession } from '../src/core/db';
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

let tenant = '', owner = '';
describe('the phone keeps no PIN and no token in plain sight', () => {
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

// Independent tester, 13 Nov 2026: the 30-day removal wiped unsent work, and the forced 6-digit owner PIN could be
// skipped by closing the app. Regression tests first.
describe('found by the independent tester', () => {
  it('the forced 6-digit PIN change is remembered on the phone until done (closing the app never skips it)', async () => {
    const { login, pinChangeDue, changePin } = await import('../src/core/sync');
    const up = await srv.fetch('http://srv.test/v1/signup', { method: 'POST', body: JSON.stringify({ consent: CONSENT, firmName: 'Old Owner Firm', ownerName: 'O', phone: '9611100009', pin: '391742' }), headers: { 'x-forwarded-for': '10.99.0.1' } }).then(r => r.json());
    const { hashPin } = await import('../../server/src/auth');
    await srv.query('UPDATE users SET pin_hash=$2, pin_len=4 WHERE id=$1', [up.userId, hashPin('3917')]);
    const l = await login('9611100009', '3917');
    expect(l).toMatchObject({ mustChangePin: true, pinLength: 6 });
    expect(await pinChangeDue(up.tenantId, up.userId)).toBe(6); // what the app checks when it restores a saved session
    await changePin(up.tenantId, up.userId, '9611100009', '3917', '615384');
    expect(await pinChangeDue(up.tenantId, up.userId)).toBeNull();
  });

  it('31 days offline with unsent bills and payments: nothing is removed; after the online login they reach the server', async () => {
    const { login, syncNow, offlineCheck } = await import('../src/core/sync');
    const { touchServer } = await import('../src/core/secure');
    const { bookOrder, approveOrder, suggestPick, pickOrder, approvePicked } = await import('../src/core/pipeline');
    expect(await login(OWNER_PHONE, OWNER_PIN)).toMatchObject({ userId: owner });
    setSession(tenant, owner);
    const cs = new ChangeSet();
    const co = cs.put('companies', { name: 'HUL', code: 'HUL', gstin: '', nextBillNo: 1 });
    const p = cs.put('products', { companyId: co.id, name: 'Soap', code: 'S1', hsn: '3401', gst: 18, mrp: 50, rate: 40, purchaseRate: 30, caseSize: 12, aliases: [], active: true });
    cs.put('batches', { productId: p.id, batch: 'L1', expiry: '2099-12-31', mrp: 50, qty: 50, godown: 'Main' });
    const shop = cs.put('shops', { name: 'Kept Stores', area: 'A', beat: 'B', creditLimit: 1e9, creditDays: 7, cashOnly: false, type: 'retail', approved: true, aliases: [] });
    await cs.commit('setup');
    expect(await syncNow()).toMatch(/^Synced/);
    // a bill made with signal (its number from the server), then the phone goes offline before it is sent
    const ocs = new ChangeSet(); const o = await bookOrder(ocs, shop as never, [{ productId: p.id, qty: 2, rate: 40 }], 'test'); await ocs.commit('booked');
    await approveOrder(o.id);
    const pick = await suggestPick((await db.orders.get(o.id))!);
    await pickOrder(o.id, pick.map(x => ({ productId: x.productId, qty: 2 })));
    const { invoices } = await approvePicked(o.id);
    online(false);
    const pay = new ChangeSet();
    const pm = pay.put('payments', { shopId: shop.id, amount: 50, mode: 'cash', date: '2026-11-13', collectedBy: owner, shopConfirmed: false, allocations: [{ invoiceId: invoices[0].id, amount: 50 }], advance: 0, settled: false });
    await pay.commit('payment');
    await touchServer(Date.now() - 31 * 86400000);
    try {
      const r = await offlineCheck();
      expect(r).toMatchObject({ wiped: false, mustLogin: true, kept: true });
      expect(await db.invoices.get(invoices[0].id)).toBeTruthy();
      expect((await db.payments.get(pm.id))?.dirty).toBe(1);
    } finally { online(true); }
    expect(await login(OWNER_PHONE, OWNER_PIN)).toMatchObject({ userId: owner });
    expect(await syncNow()).toMatch(/^Synced/);
    const onServer = (await srv.query(`SELECT id FROM docs WHERE tenant_id=$1 AND id = ANY($2)`, [tenant, [invoices[0].id, pm.id]])).map(x => x.id).sort();
    expect(onServer).toEqual([invoices[0].id, pm.id].sort());
    // with nothing unsent, 31 days away does remove the phone's copy
    await touchServer(Date.now() - 31 * 86400000);
    online(false);
    try { expect(await offlineCheck()).toMatchObject({ wiped: true }); expect(await db.invoices.count()).toBe(0); } finally { online(true); }
  });
});

describe('found by the tester: "Access removed" with unsent work (13 Nov 2026)', () => {
  it('a removed salesman\'s unsent payment is kept; only the owner or office can log in to send it; then the phone is wiped', async () => {
    const { syncNow, login, accessRemovedState, finishRemovedPhone } = await import('../src/core/sync');
    // a fresh firm and owner on the main phone; a salesman added
    const up = await srv.fetch('http://srv.test/v1/signup', { method: 'POST', body: JSON.stringify({ consent: CONSENT, firmName: 'Removed Firm', ownerName: 'O', phone: '9611100020', pin: '391742' }), headers: { 'x-forwarded-for': '10.99.0.2' } }).then(r => r.json());
    const sid = (await srv.query(`SELECT id FROM docs WHERE tenant_id=$1 AND tbl='settings'`, [up.tenantId]))[0].id as string;
    const phone = new RoxDB(`removed-${Date.now()}`);
    await onSide(phone, async () => {
      await db.open();
      setSession(up.tenantId, up.userId);
      const cs = new ChangeSet();
      cs.put('settings', { id: sid, firmName: 'Removed Firm', gstin: '', address: '', stateCode: '33', phone: '9611100020', serverUrl: 'http://srv.test', modules: {}, billFormat: 'A5', returnApprovalLimit: 0, discountAlertPct: 0 });
      await cs.commit('settings');
      expect(await login('9611100020', '391742')).toMatchObject({ userId: up.userId });
      const cs2 = new ChangeSet();
      cs2.put('staff', { id: 'rm-sm', name: 'Babu', phone: '9611100021', role: 'salesman', pin: '7265', active: true });
      await cs2.commit('setup');
      expect(await syncNow()).toMatch(/^Synced/);
      // the salesman logs in on this phone and takes a payment offline
      expect(await login('9611100021', '7265')).toMatchObject({ userId: 'rm-sm' });
      setSession(up.tenantId, 'rm-sm');
      const pay = new ChangeSet();
      const pm = pay.put('payments', { shopId: 'x', amount: 75, mode: 'cash', date: '2026-11-13', collectedBy: 'rm-sm', shopConfirmed: false, allocations: [], advance: 75, settled: false, status: 'ok' });
      await pay.commit('payment');
      // the owner removes him (from the server side, as another phone would)
      await srv.query(`UPDATE users SET active=false WHERE tenant_id=$1 AND id='rm-sm'`, [up.tenantId]);
      const msg = await syncNow();
      expect(msg).toMatch(/Access removed\. This phone has \d+ unsent record/);
      expect((await db.payments.get(pm.id))?.dirty).toBe(1);
      expect(await accessRemovedState()).not.toBeNull();
      // another salesman (a valid login on the server) is refused on this phone: only the firm's owner or office
      await srv.query(`INSERT INTO users(tenant_id, id, phone, name, role, pin_hash) VALUES ($1, 'rm-sm2', '9611100022', 'Kumar', 'salesman', $2)`, [up.tenantId, (await import('../../server/src/auth')).hashPin('7416')]);
      expect(await login('9611100022', '7416')).toMatchObject({ error: expect.stringMatching(/owner or office must log in/) });
      // a brand's head office (another firm) is refused too
      const co = await srv.fetch('http://srv.test/v1/signup', { method: 'POST', body: JSON.stringify({ consent: CONSENT, firmName: 'Brand', ownerName: 'HO', phone: '9611100023', pin: '391742', kind: 'company' }), headers: { 'x-forwarded-for': '10.99.0.3' } }).then(r => r.json());
      expect(co.userId).toBeTruthy();
      expect(await login('9611100023', '391742')).toMatchObject({ error: expect.stringMatching(/owner or office must log in/) });
      // nobody gets in offline; the owner logs in and the payment reaches the server
      online(false);
      try { expect(await login('9611100020', '391742')).toMatchObject({ error: expect.stringMatching(/Connect to the internet/) }); } finally { online(true); }
      expect(await login('9611100020', '391742')).toMatchObject({ userId: up.userId });
      setSession(up.tenantId, up.userId);
      expect(await syncNow()).toMatch(/^Synced/);
      expect((await srv.query(`SELECT id FROM docs WHERE tenant_id=$1 AND id=$2`, [up.tenantId, pm.id])).length).toBe(1);
      expect(await finishRemovedPhone()).toBe(true);
      expect(await db.payments.count()).toBe(0);
    });
  });
});
