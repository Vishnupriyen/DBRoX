// A new phone also gets the bills the server moved to its archive (older than last financial year), so a shop's old
// dues and last year's reports stay complete (10 Nov 2026). Saved as already-synced; a newer copy on the phone wins.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ChangeSet, db, setSession } from '../src/core/db';

const store = new Map<string, string>();
beforeAll(() => {
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
});
const inv = (id: string, total: number, updatedAt: string) => ({ table: 'invoices', id, updatedAt, data: { id, tenantId: 't1', number: id, shopId: 's1', companyId: 'c1', date: '2024-05-10', lines: [], total, updatedAt, createdAt: updatedAt } });

describe('old records on a new phone', () => {
  it('fetched once after the first full sync, month by month, never sent back, never over a newer local copy', async () => {
    setSession('t1', 'o1');
    const cs = new ChangeSet();
    cs.put('settings', { firmName: 'X', gstin: '', address: '', stateCode: '33', phone: '9800000001', serverUrl: 'http://server.test', modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true }, billFormat: 'A5', returnApprovalLimit: 2000, discountAlertPct: 5 });
    await cs.commit('setup');
    // the phone already holds a newer, unsent edit of one old bill
    await db.table('invoices').put({ ...inv('old2', 999, '2026-11-01T00:00:00.000Z').data, dirty: 1 });
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const path = new URL(url).pathname; calls.push(path);
      const b = JSON.parse(init.body);
      if (path === '/v1/sync') return new Response(JSON.stringify({ cursor: 7, changes: [], accepted: b.changes.map((c: { table: string; id: string }) => `${c.table}|${c.id}`), more: false }), { status: 200 });
      if (path === '/v1/archive/list') return new Response(JSON.stringify({ months: [{ tbl: 'invoices', month: '2024-05', n: 2 }, { tbl: 'payments', month: '2024-05', n: 0 }] }), { status: 200 });
      if (path === '/v1/archive/month') return new Response(JSON.stringify({ changes: b.tbl === 'invoices' ? [inv('old1', 420, '2024-05-10T10:00:00.000Z'), inv('old2', 840, '2024-05-10T10:00:00.000Z')] : [] }), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    const { syncNow } = await import('../src/core/sync');
    await syncNow();
    expect(calls.filter(c => c === '/v1/archive/month')).toHaveLength(2);
    const o1 = await db.table('invoices').get('old1');
    expect(o1).toMatchObject({ total: 420, dirty: 0 }); // saved as already-synced: never sent back
    expect((await db.table('invoices').get('old2')).total).toBe(999); // the phone's newer edit kept
    // later syncs do not fetch again
    calls.length = 0;
    await syncNow();
    expect(calls.filter(c => c.startsWith('/v1/archive'))).toHaveLength(0);
    // and the old bill was not pushed to the server as a change
    vi.unstubAllGlobals();
  });

  it('a download cut off half way carries on with the months still missing', async () => {
    await db.meta.put({ key: 'archiveDone', value: 'pending' });
    await db.meta.delete('archive:payments|2024-05');
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const path = new URL(url).pathname; calls.push(path);
      const b = JSON.parse(init.body);
      if (path === '/v1/sync') return new Response(JSON.stringify({ cursor: 7, changes: [], accepted: [], more: false }), { status: 200 });
      if (path === '/v1/archive/list') return new Response(JSON.stringify({ months: [{ tbl: 'invoices', month: '2024-05', n: 2 }, { tbl: 'payments', month: '2024-05', n: 1 }] }), { status: 200 });
      return new Response(JSON.stringify({ changes: b.tbl === 'payments' ? [{ table: 'payments', id: 'p1', updatedAt: '2024-05-10T10:00:00.000Z', data: { id: 'p1', shopId: 's1', amount: 420 } }] : [] }), { status: 200 });
    });
    const { syncNow } = await import('../src/core/sync');
    await syncNow();
    expect(calls.filter(c => c === '/v1/archive/month')).toHaveLength(1); // only payments: invoices were already saved
    expect(await db.table('payments').get('p1')).toMatchObject({ amount: 420, dirty: 0 });
    expect((await db.meta.get('archiveDone'))?.value).toBe('yes');
    vi.unstubAllGlobals();
  });
});
