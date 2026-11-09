// Sync sends everything waiting on the phone in one go, not just the first 500 of a table
// (found by the full working-app test, 9 Nov 2026: a day's 1,363 bills reached the server in 30-second steps).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ChangeSet, db, setSession } from '../src/core/db';

const store = new Map<string, string>();
beforeAll(() => {
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
});

describe('sync', () => {
  it('one "Sync now" sends 1,200 new shops, in batches, until nothing is left', async () => {
    setSession('t1', 'o1');
    const cs = new ChangeSet();
    cs.put('settings', { firmName: 'X', gstin: '', address: '', stateCode: '33', phone: '9800000001', serverUrl: 'http://server.test', modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true }, billFormat: 'A5', returnApprovalLimit: 2000, discountAlertPct: 5 });
    for (let i = 0; i < 1200; i++) cs.put('shops', { name: `Shop ${i}`, area: 'A', beat: 'Monday', creditLimit: 0, creditDays: 7, cashOnly: false, type: 'retail', approved: true, aliases: [] });
    await cs.commit('import');
    let calls = 0, received = 0;
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      calls++;
      const b = JSON.parse(init.body) as { cursor: number; changes: { table: string; id: string }[] };
      received += b.changes.filter(c => c.table === 'shops').length;
      return new Response(JSON.stringify({ cursor: b.cursor, changes: [], accepted: b.changes.map(c => `${c.table}|${c.id}`), more: false }), { status: 200 });
    });
    const { syncNow } = await import('../src/core/sync');
    await syncNow();
    expect(received).toBe(1200);
    expect(await db.shops.where('dirty').equals(1).count()).toBe(0);
    expect(calls).toBeGreaterThanOrEqual(3);
    vi.unstubAllGlobals();
  });
});

describe('first sync of a busy distributor', () => {
  it('keeps pulling until the server has nothing more (a month of history is ~150,000 records)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      calls++;
      const b = JSON.parse(init.body) as { cursor: number };
      const more = calls < 60; // 60 pages of 2,000 = 120,000 records
      return new Response(JSON.stringify({ cursor: b.cursor + 2000, changes: [], accepted: [], more }), { status: 200 });
    });
    const { syncNow } = await import('../src/core/sync');
    await syncNow();
    expect(calls).toBe(60);
    vi.unstubAllGlobals();
  });
});
