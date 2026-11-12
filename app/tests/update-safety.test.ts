// Updates without stopping the business (owner, 12 Nov 2026: "after deployment, if we do maintenance or modification will it
// affect business"). New app versions go to one or two distributors first, so for a day old and new phones share one server.
// Found while checking that promise: a phone that met a record from a table it did not know yet (one added in a newer
// version) stopped syncing completely until it was updated. Regression tests first.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { ChangeSet, db, setSession } from '../src/core/db';
import shared from '../../shared/tables.json';

const store = new Map<string, string>();
beforeAll(async () => {
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
  setSession('t1', 'o1');
  const cs = new ChangeSet();
  cs.put('settings', { firmName: 'X', gstin: '', address: '', stateCode: '33', phone: '9800000001', serverUrl: 'http://server.test', modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true }, billFormat: 'A5', returnApprovalLimit: 2000, discountAlertPct: 5 });
  await cs.commit('setup');
});
beforeEach(() => vi.unstubAllGlobals());

const rec = (table: string, id: string, data: Record<string, unknown> = {}) => ({ table, id, updatedAt: new Date().toISOString(), data: { id, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), ...data } });

describe('a newer server talking to an older phone', () => {
  it('a record from a table this phone does not know yet never stops the sync; the rest is saved', async () => {
    await db.meta.put({ key: 'cursor', value: 0 });
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      if (!url.endsWith('/v1/sync')) return new Response('{}', { status: 404 });
      const b = JSON.parse(init.body) as { cursor: number };
      return new Response(JSON.stringify({ cursor: b.cursor + 2, accepted: [], more: false, changes: [rec('aTableFromTheFuture', 'f1', { x: 1 }), rec('shops', 'shop-new', { name: 'Kumar Stores', area: 'A' })] }), { status: 200 });
    });
    const { syncNow } = await import('../src/core/sync');
    const msg = await syncNow();
    expect(String(msg)).not.toMatch(/paused/i);
    expect((await db.shops.get('shop-new'))?.name).toBe('Kumar Stores');
    expect(Number((await db.meta.get('cursor'))?.value)).toBe(2);
  });

  it('every sync tells the server which tables this phone knows, so it is sent only those', async () => {
    let tables: unknown;
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      if (!url.endsWith('/v1/sync')) return new Response('{}', { status: 404 });
      const b = JSON.parse(init.body) as { cursor: number; tables?: string[] };
      if (b.cursor > 0) tables = b.tables;
      return new Response(JSON.stringify({ cursor: b.cursor, accepted: [], more: false, changes: [] }), { status: 200 });
    });
    const { syncNow } = await import('../src/core/sync');
    await syncNow();
    expect(tables).toEqual(shared.tables);
  });

  it('after an update adds a table, the phone fetches that table\'s earlier records once, without losing its place', async () => {
    await db.meta.put({ key: 'cursor', value: 500 });
    await db.meta.put({ key: 'knownTables', value: shared.tables.filter(t => t !== 'boostRequests') }); // the phone before the update
    const asked: { cursor: number; tables?: string[] }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      if (!url.endsWith('/v1/sync')) return new Response('{}', { status: 404 });
      const b = JSON.parse(init.body) as { cursor: number; tables?: string[] };
      asked.push(b);
      const catchUp = b.tables?.length === 1 && b.tables[0] === 'boostRequests';
      if (catchUp && b.cursor === 0) return new Response(JSON.stringify({ cursor: 40, accepted: [], more: true, changes: [rec('boostRequests', 'br1', { kind: 'gst', status: 'open', by: 'o1' })] }), { status: 200 });
      if (catchUp) return new Response(JSON.stringify({ cursor: 90, accepted: [], more: false, changes: [rec('boostRequests', 'br2', { kind: 'tally', status: 'open', by: 'o1' })] }), { status: 200 });
      return new Response(JSON.stringify({ cursor: b.cursor, accepted: [], more: false, changes: [] }), { status: 200 });
    });
    const { syncNow } = await import('../src/core/sync');
    await syncNow();
    expect((await db.boostRequests.get('br1'))?.kind).toBe('gst');
    expect((await db.boostRequests.get('br2'))?.kind).toBe('tally');
    expect(Number((await db.meta.get('cursor'))?.value)).toBe(500); // its place in the main sync is kept
    expect((await db.meta.get('knownTables'))?.value).toEqual(shared.tables); // done once
    const before = asked.length;
    await syncNow();
    expect(asked.slice(before).every(b => b.tables?.length === shared.tables.length)).toBe(true); // no second catch-up
  });

  it('a phone updating to this version, or a brand-new phone, has nothing to catch up', async () => {
    await db.meta.delete('knownTables');
    await db.meta.put({ key: 'cursor', value: 700 });
    const asked: { tables?: string[] }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      if (!url.endsWith('/v1/sync')) return new Response('{}', { status: 404 });
      const b = JSON.parse(init.body) as { cursor: number; tables?: string[] };
      asked.push(b);
      return new Response(JSON.stringify({ cursor: b.cursor, accepted: [], more: false, changes: [] }), { status: 200 });
    });
    const { syncNow } = await import('../src/core/sync');
    await syncNow();
    expect(asked.every(b => b.tables?.length === shared.tables.length)).toBe(true);
    expect((await db.meta.get('knownTables'))?.value).toEqual(shared.tables);
  });
});
