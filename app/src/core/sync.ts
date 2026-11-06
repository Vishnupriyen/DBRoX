// Our own sync layer (scale plan): phone ⇄ DBRoX server. Phones work offline; this runs when
// there is signal. Server is swappable because the app only knows this small protocol.
import { db, getSettings } from './db';
import type { Base, TableName } from './types';

import shared from '../../../shared/tables.json';
// Phone and server load the same shared/tables.json, so a table can never exist on one side only.
const SYNC_TABLES = shared.tables as TableName[];

interface Change { table: string; id: string; updatedAt: string; data: Base }

// Server address: set at build time (VITE_SERVER_URL) for real distributors, or typed in Settings.
export const ENV_SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') || '';
export async function server(): Promise<string | null> {
  if (ENV_SERVER) return ENV_SERVER;
  try { return (await getSettings()).serverUrl?.replace(/\/$/, '') || null; } catch { return null; }
}

export async function signup(body: { firmName: string; ownerName: string; phone: string; pin: string; gstin?: string; address?: string }) {
  const url = await server();
  if (!url) throw new Error('No server');
  const r = await fetch(`${url}/v1/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? 'Sign-up failed');
  localStorage.setItem('dbrox.token', j.token);
  return { tenantId: j.tenantId as string, userId: j.userId as string };
}

export type LoginResult = { tenantId: string; userId: string } | { choose: { tenantId: string; firm: string }[] } | null;
export async function login(phone: string, pin: string, tenantId?: string): Promise<LoginResult> {
  const url = await server();
  if (url && navigator.onLine) {
    try {
      const r = await fetch(`${url}/v1/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, pin, tenantId }) });
      if (r.ok) {
        const j = await r.json();
        if (j.choose) return { choose: j.choose }; // same phone under two distributors → the app asks which firm
        localStorage.setItem('dbrox.token', j.token);
        return { tenantId: j.tenantId, userId: j.userId };
      }
      if (r.status === 401) return null;
    } catch { /* offline: fall back to the PIN kept on this phone */ }
  }
  const s = (await db.staff.where('phone').equals(phone).toArray()).find(x => !tenantId || x.tenantId === tenantId);
  if (!s || !s.active || s.pin !== pin) return null;
  return { tenantId: s.tenantId, userId: s.id };
}

// Bill / credit-note / receipt numbers come from the server (one series per distributor, never a duplicate).
// Without a server (demo), the phone keeps its own series.
export async function nextNumbers(kind: 'bill' | 'cn' | 'receipt', count = 1): Promise<{ first: number; prefix: string } | null> {
  const url = await server();
  if (!url) return null;
  if (!navigator.onLine) throw new Error('offline');
  const r = await fetch(`${url}/v1/number`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('dbrox.token') ?? ''}` }, body: JSON.stringify({ kind, count }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not get a bill number');
  return await r.json();
}

let running = false;
export async function syncNow(): Promise<string> {
  let msg = '';
  for (let i = 0; i < 25; i++) { // keep pulling while the server says there is more
    const r = await syncOnce();
    msg = r.msg;
    if (!r.more) break;
  }
  return msg;
}

async function syncOnce(): Promise<{ msg: string; more: boolean }> {
  const done = (msg: string, more = false) => ({ msg, more });
  const url = await server();
  if (!url) return done('Not connected to a DBRoX server yet. Everything is saved safely on this phone.');
  if (!navigator.onLine) return done('Offline — will sync when there is signal.');
  if (running) return done('Sync already running.');
  running = true;
  try {
    const token = localStorage.getItem('dbrox.token') ?? '';
    const cursor = Number((await db.meta.get('cursor'))?.value ?? 0);
    const changes: Change[] = [];
    for (const t of SYNC_TABLES) {
      const dirty = await db.table(t).where('dirty').equals(1).limit(500).toArray();
      for (const d of dirty) changes.push({ table: t, id: d.id, updatedAt: d.updatedAt, data: { ...d, dirty: undefined } });
    }
    const r = await fetch(`${url}/v1/sync`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ cursor, changes }) });
    if (r.status === 401 || r.status === 403) { localStorage.removeItem('dbrox.session'); window.dispatchEvent(new Event('dbrox:logout')); return done('Your access was removed or expired. Please log in again.'); }
    if (!r.ok) return done(`Sync failed (${r.status}). Data is safe on this phone; will retry.`);
    const res: { cursor: number; changes: Change[]; accepted: string[]; more?: boolean } = await r.json();
    const accepted = new Set(res.accepted);
    await db.transaction('rw', SYNC_TABLES.map(t => db.table(t)), async () => {
      for (const c of changes) {
        if (!accepted.has(`${c.table}|${c.id}`)) continue;
        const cur = await db.table(c.table).get(c.id);
        if (cur && cur.updatedAt === c.updatedAt) await db.table(c.table).put({ ...cur, dirty: 0 });
      }
      for (const c of res.changes) {
        const cur = await db.table(c.table).get(c.id);
        if (!cur || (!cur.dirty && cur.updatedAt <= c.updatedAt)) await db.table(c.table).put({ ...c.data, dirty: 0 });
      }
    });
    await db.meta.put({ key: 'cursor', value: res.cursor });
    return done(`Synced: sent ${accepted.size}, received ${res.changes.length}.`, !!res.more);
  } catch (e) {
    return done(`Sync paused: ${(e as Error).message}. Data is safe on this phone.`);
  } finally { running = false; }
}

export function startAutoSync() {
  const tick = () => { void syncNow(); };
  window.addEventListener('online', tick);
  setInterval(tick, 30000); // target: owner sees data within 30 s when there is signal
}
