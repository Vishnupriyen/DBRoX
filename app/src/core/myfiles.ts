// TESRAX memory on this phone (founder, 14 Nov 2026 — items 6 and 44):
// • My files: every table TESRAX answers with and every Excel the app makes is kept here, to download again as Excel or PDF.
// • Chat history: the conversation stays when TESRAX is closed and opened again; one log per person per day, kept 30 days.
// Both live in the phone's local key/value table (meta) under the person's own id — never synced, never shown to anyone else.
import { db, session, today } from './db';

export interface SheetData { name: string; header: string[]; rows: (string | number)[][] }
export interface MyFile { id: string; name: string; at: string; sheets: SheetData[] }
export interface ChatLine { from: 'me' | 'bot'; text: string; tone?: 'ok' | 'warn' | 'error'; table?: { columns: string[]; rows: (string | number)[][]; name: string }; files?: string[]; note?: string }

export const KEEP_DAYS = 30;
export const MAX_FILES = 300;
const me = () => session().userId || 'nobody';
const filesKey = (u = me()) => `myfiles:${u}`;
const chatKey = (day: string, u = me()) => `chat:${u}:${day}`;
const dayMinus = (d: string, n: number) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };

// ---------- My files ----------
export async function myFiles(): Promise<MyFile[]> {
  return ((await db.meta.get(filesKey()))?.value as MyFile[] | undefined) ?? [];
}
/** keep a file (newest first). The same name with the same rows made again within a minute is kept once. */
export async function keepFile(name: string, sheets: SheetData[]): Promise<void> {
  if (!sheets.some(s => s.rows.length)) return;
  const list = await myFiles();
  const at = new Date().toISOString();
  const same = list[0] && list[0].name === name && Date.now() - Date.parse(list[0].at) < 60_000 && JSON.stringify(list[0].sheets) === JSON.stringify(sheets);
  if (same) return;
  const file: MyFile = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, at, sheets };
  await db.meta.put({ key: filesKey(), value: [file, ...list].slice(0, MAX_FILES) });
}
export async function dropFile(id: string): Promise<void> {
  await db.meta.put({ key: filesKey(), value: (await myFiles()).filter(f => f.id !== id) });
}

// ---------- Chat history ----------
export async function chatDay(day = today()): Promise<ChatLine[]> {
  return ((await db.meta.get(chatKey(day)))?.value as ChatLine[] | undefined) ?? [];
}
export async function saveChatDay(lines: ChatLine[], day = today()): Promise<void> {
  if (!lines.length) { await db.meta.delete(chatKey(day)); return; }
  await db.meta.put({ key: chatKey(day), value: lines.slice(-400) });
}
/** the days this person talked to TESRAX, newest first, within the last 30 days; older days are deleted here */
export async function chatDays(now = today()): Promise<{ day: string; count: number }[]> {
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
export async function clearChatDay(day = today()): Promise<void> { await db.meta.delete(chatKey(day)); }
