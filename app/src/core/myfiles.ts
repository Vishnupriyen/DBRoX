// TESRAX memory on this phone (founder, 14 Nov 2026 — items 6 and 44):
// • My files: every table TESRAX answers with and every Excel the app makes is kept here, to download again as Excel or PDF.
// • Chat history: the conversation stays when TESRAX is closed and opened again; one log per person per day, kept 30 days.
// Both live in the phone's local key/value table (meta) under the person's own id — never synced, never shown to anyone else.
import { db, session, today } from './db';
import type { Role } from './types';

export interface SheetData { name: string; header: string[]; rows: (string | number)[][] }
/** kind: what the file holds, where a role rule applies (salary, P&L, cash flow are the owner's, same as their screens) */
export type FileKind = 'salary' | 'pnl' | 'cashflow';
export interface MyFile { id: string; name: string; at: string; sheets: SheetData[]; role?: Role; kind?: FileKind }
export interface ChatLine { from: 'me' | 'bot'; text: string; tone?: 'ok' | 'warn' | 'error'; table?: { columns: string[]; rows: (string | number)[][]; name: string }; files?: string[]; note?: string }

export const KEEP_DAYS = 30;
export const MAX_FILES = 300;
// no one logged in: nothing is kept and nothing is shown (never a shared bucket — security, 14 Nov 2026)
const me = () => session().userId || '';
const filesKey = (u = me()) => `myfiles:${u}`;
const chatKey = (day: string, u = me()) => `chat:${u}:${day}`;
export const OWNER_ONLY_KINDS: FileKind[] = ['salary', 'pnl', 'cashflow'];
export function kindOf(name: string): FileKind | undefined {
  const n = name.toLowerCase();
  if (/\bsalar(y|ies)\b|\bpayroll\b|\bpayslip/.test(n)) return 'salary';
  if (/\bp&l\b|\bp & l\b|\bpnl\b|profit ?(and|&) ?loss|profit-loss/.test(n)) return 'pnl';
  if (/cash ?flow/.test(n)) return 'cashflow';
  return undefined;
}
const roleNow = async (): Promise<Role | undefined> => (await db.staff.get(me()))?.role as Role | undefined;
const fresh = (f: MyFile, now = Date.now()) => now - Date.parse(f.at) < KEEP_DAYS * 86_400_000;
const allFiles = async (u = me()): Promise<MyFile[]> => u ? ((await db.meta.get(filesKey(u)))?.value as MyFile[] | undefined) ?? [] : [];
const dayMinus = (d: string, n: number) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };

// ---------- My files ----------
/** this person's files from the last 30 days that their role may see now (a file made as owner is hidden when the same
 *  person logs in as office or salesman) */
export async function myFiles(): Promise<MyFile[]> {
  const role = await roleNow();
  return (await allFiles()).filter(f => fresh(f) && (!role || role === 'owner' || !OWNER_ONLY_KINDS.includes((f.kind ?? kindOf(f.name)) as FileKind)));
}
/** keep a file (newest first). The same name with the same rows made again within a minute is kept once. */
export async function keepFile(name: string, sheets: SheetData[]): Promise<void> {
  if (!me() || !sheets.some(s => s.rows.length)) return;
  const list = await allFiles();
  const at = new Date().toISOString();
  const same = list[0] && list[0].name === name && Date.now() - Date.parse(list[0].at) < 60_000 && JSON.stringify(list[0].sheets) === JSON.stringify(sheets);
  if (same) return;
  const role = await roleNow(), kind = kindOf(name);
  const file: MyFile = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, at, sheets, ...(role ? { role } : {}), ...(kind ? { kind } : {}) };
  await db.meta.put({ key: filesKey(), value: [file, ...list].slice(0, MAX_FILES) });
}
export async function dropFile(id: string): Promise<void> {
  if (!me()) return;
  await db.meta.put({ key: filesKey(), value: (await allFiles()).filter(f => f.id !== id) });
}

// ---------- Chat history ----------
export async function chatDay(day = today()): Promise<ChatLine[]> {
  if (!me()) return [];
  return ((await db.meta.get(chatKey(day)))?.value as ChatLine[] | undefined) ?? [];
}
export async function saveChatDay(lines: ChatLine[], day = today()): Promise<void> {
  if (!me()) return;
  if (!lines.length) { await db.meta.delete(chatKey(day)); return; }
  await db.meta.put({ key: chatKey(day), value: lines.slice(-400) });
}
/** the days this person talked to TESRAX, newest first, within the last 30 days; older days are deleted here */
export async function chatDays(now = today()): Promise<{ day: string; count: number }[]> {
  if (!me()) return [];
  const prefix = `chat:${me()}:`, oldest = dayMinus(now, KEEP_DAYS - 1);
  const rows = await db.meta.where('key').startsWith(prefix).toArray();
  const out: { day: string; count: number }[] = [];
  for (const r of rows) {
    const day = r.key.slice(prefix.length);
    if (day < oldest) { await db.meta.delete(r.key); continue; }
    out.push({ day, count: (r.value as ChatLine[]).length });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}
export async function clearChatDay(day = today()): Promise<void> { if (me()) await db.meta.delete(chatKey(day)); }

// ---------- Clearing (security, 14 Nov 2026) ----------
/** delete chats and My files from this phone: one person's, or everyone's when no id is given */
export async function purgePersonal(userId?: string): Promise<void> {
  const prefixes = userId ? [`chat:${userId}:`, `myfiles:${userId}`] : ['chat:', 'myfiles:'];
  for (const p of prefixes) {
    const keys = (await db.meta.where('key').startsWith(p).primaryKeys()) as string[];
    // "myfiles:u1" must not take "myfiles:u12" with it
    await db.meta.bulkDelete(keys.filter(k => !userId || p.endsWith(':') || k === p));
  }
}
/** once a day at app start: chat days and My files older than 30 days are deleted, for every person on this phone */
export async function dailyPurge(now = today()): Promise<boolean> {
  if ((await db.meta.get('purgedOn'))?.value === now) return false;
  const oldest = dayMinus(now, KEEP_DAYS - 1), cut = Date.parse(`${now}T12:00:00`);
  for (const r of await db.meta.where('key').startsWith('chat:').toArray()) if (r.key.slice(r.key.lastIndexOf(':') + 1) < oldest) await db.meta.delete(r.key);
  for (const r of await db.meta.where('key').startsWith('myfiles:').toArray()) {
    const list = (r.value as MyFile[]) ?? [], keep = list.filter(f => fresh(f, cut));
    if (keep.length !== list.length) await db.meta.put({ key: r.key, value: keep });
  }
  await db.meta.put({ key: 'purgedOn', value: now });
  return true;
}
