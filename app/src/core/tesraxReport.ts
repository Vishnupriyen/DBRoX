// The TESRAX report: every message to TESRAX is counted on the phone it was said on —
// how fast it replied, whether it understood, and whether the table it prepared was approved as is.
// One small record per staff per day (synced), so the owner sees every staff's numbers without downloading every message.
import { ChangeSet, db, session, today } from './db';
import type { Reply } from './engine';
import type { TesraxDay } from './types';

export type Result = 'done' | 'answer' | 'ask' | 'missed' | 'refused';
export type Outcome = 'approved' | 'edited' | 'cancelled';
const KEEP_MISSES = 20;

/** what TESRAX did with one message */
export function resultOf(r: Reply | null): Result {
  if (!r) return 'missed'; // it failed
  const all = [r, ...(r.parts ?? [])];
  if (all.some(x => x.missed)) return 'missed';
  if (all.some(x => x.refused)) return 'refused';
  if (all.some(x => x.proposal)) return 'done';
  if (all.some(x => x.pending)) return 'ask';
  return 'answer';
}

/** this phone (one install): the same person on two phones keeps two counts, and the report adds them up */
export function deviceId(): string {
  try {
    let d = localStorage.getItem('hanubix.device');
    if (!d) { d = crypto.getRandomValues(new Uint32Array(2)).reduce((a, x) => a + x.toString(36), ''); localStorage.setItem('hanubix.device', d); }
    return d;
  } catch { return 'phone'; }
}

const blank = (day: string, staffId: string, role: string) => ({
  id: `${staffId}|${day}|${deviceId()}`, day, staffId, role, n: 0, done: 0, answer: 0, ask: 0, missed: 0, refused: 0,
  msTotal: 0, msMax: 0, approved: 0, edited: 0, cancelled: 0, misses: [] as string[],
});

async function change(day: string, role: string, f: (d: ReturnType<typeof blank>) => void) {
  const staffId = session().userId;
  const fresh = blank(day, staffId, role);
  const d = { ...fresh, ...((await db.tesraxDays.get(fresh.id)) ?? {}) };
  f(d);
  const cs = new ChangeSet({ noAudit: true }); // a count, not an action: nothing to undo
  cs.put<TesraxDay>('tesraxDays', d, 'count');
  await cs.commit('TESRAX report');
}

/** count one message. Returns the day it was counted on, so its table's outcome lands on the same record. Never throws. */
export async function noteMessage(role: string, said: string, reply: Reply | null, ms: number): Promise<string> {
  const day = today();
  try {
    const res = resultOf(reply);
    await change(day, role, d => {
      d.n++; d[res]++; d.msTotal += Math.round(ms); d.msMax = Math.max(d.msMax, Math.round(ms));
      // cut by whole characters: an emoji cut in half is text the server's database cannot store
      if (res === 'missed' && said) d.misses = [...d.misses, Array.from(said).slice(0, 120).join('')].slice(-KEEP_MISSES);
    });
  } catch { /* the report must never get in the way of the work */ }
  return day;
}

/** what happened to a table TESRAX prepared */
export async function noteOutcome(day: string, role: string, outcome: Outcome) {
  try { await change(day, role, d => { d[outcome]++; }); } catch { /* never in the way */ }
}

export interface Report {
  messages: number; understood: number; done: number; asked: number; missed: number; refused: number;
  avgMs: number; maxMs: number; tables: number; approved: number; edited: number; cancelled: number;
  staff: { staffId: string; role: string; messages: number; understood: number; avgMs: number }[];
  days: { day: string; messages: number; understood: number }[];
  misses: { day: string; staffId: string; said: string }[];
}
const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : 0);

/** the owner's report over the days from `from` (yyyy-mm-dd) to today */
export async function tesraxReport(from = ''): Promise<Report> {
  const rows = (await db.tesraxDays.toArray()).filter(d => d.day >= from);
  const sum = (k: keyof TesraxDay) => rows.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const messages = sum('n'), missed = sum('missed');
  const byStaff = new Map<string, { staffId: string; role: string; messages: number; missed: number; ms: number }>();
  const byDay = new Map<string, { day: string; messages: number; missed: number }>();
  for (const d of rows) {
    const s = byStaff.get(d.staffId) ?? { staffId: d.staffId, role: d.role, messages: 0, missed: 0, ms: 0 };
    s.messages += d.n; s.missed += d.missed; s.ms += d.msTotal; byStaff.set(d.staffId, s);
    const y = byDay.get(d.day) ?? { day: d.day, messages: 0, missed: 0 };
    y.messages += d.n; y.missed += d.missed; byDay.set(d.day, y);
  }
  const tables = sum('approved') + sum('edited') + sum('cancelled');
  return {
    messages, understood: pct(messages - missed, messages), done: sum('done'), asked: sum('ask'), missed, refused: sum('refused'),
    avgMs: messages ? Math.round(sum('msTotal') / messages) : 0, maxMs: Math.max(0, ...rows.map(d => d.msMax)),
    tables, approved: sum('approved'), edited: sum('edited'), cancelled: sum('cancelled'),
    staff: [...byStaff.values()].sort((a, b) => b.messages - a.messages)
      .map(s => ({ staffId: s.staffId, role: s.role, messages: s.messages, understood: pct(s.messages - s.missed, s.messages), avgMs: s.messages ? Math.round(s.ms / s.messages) : 0 })),
    days: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)).map(y => ({ day: y.day, messages: y.messages, understood: pct(y.messages - y.missed, y.messages) })),
    misses: rows.flatMap(d => d.misses.map(said => ({ day: d.day, staffId: d.staffId, said }))).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30),
  };
}
