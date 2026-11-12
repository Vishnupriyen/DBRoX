// TESRAX 5000: 5,000+ everyday messages — orders, payments, expenses, questions, screens, files, and changes to what
// is already saved (orders, bills, payments, expenses, stock counts, shops, products, undo) — typed by every role with
// short forms, capitals and noise. Generated deterministically (tesrax-gen.ts), so the set never changes
// between runs. Every phrase must be understood; the report shows accuracy per intent.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { commit } from '../src/core/proposals';
import type { Role } from '../src/core/types';
import { code, converse, loadNames } from './tesrax-code';
import { FIX_EXPENSES, FIX_PAYMENTS, generate, type Case } from './tesrax-gen';

let ids: Record<Role, string>;
let CASES: Case[] = [];
beforeAll(async () => {
  await seedDemo();
  await loadNames();
  ids = Object.fromEntries((await db.staff.toArray()).map(s => [s.role, s.id])) as Record<Role, string>;
  // today's saves the corrections and cancels refer to (made by the owner, as in real use)
  setSession('demo', ids.owner);
  for (const [shop, a, mode] of FIX_PAYMENTS) await commit((await handle(`${shop} paid ${a} ${mode}${mode === 'upi' ? ' ref 412345678901' : ''}`, [])).proposal!);
  for (const [said] of FIX_EXPENSES) await commit((await handle(said, [])).proposal!);
  const stock: Record<string, number> = {};
  for (const p of await db.products.toArray()) stock[p.name.split(' ')[0]] = (await db.batches.where('productId').equals(p.id).toArray()).reduce((a, b) => a + b.qty, 0);
  CASES = generate({ stock });
}, 60_000);

// two halves (this file and tesrax-5000b.test.ts) run side by side: every message is checked once, in half the time
const SHARD = Number(process.env.TESRAX_SHARD ?? 0), SHARDS = 2;
export function runHalf(shard: number) {
describe(`TESRAX 5000 (half ${shard + 1} of ${SHARDS})`, () => {
  it('understands every everyday message (5,000+)', async () => {
    expect(CASES.length).toBeGreaterThanOrEqual(5000);
    const mine = CASES.filter((_, k) => k % SHARDS === shard);
    const wrong: string[] = [];
    const per = new Map<string, { n: number; ok: number }>();
    let i = 0;
    for (const c of mine) {
      // fake-indexeddb (tests only) slows down after thousands of transactions; reopening resets it, data stays
      if (++i % 500 === 0) { db.close(); await db.open(); }
      setSession('demo', ids[c.role]);
      let got: string;
      try { got = code(c.dialogue ? await converse(c.dialogue, (m, last) => handle(m, [], { last })) : await handle(c.said, [])); } catch (e) { got = `CRASH ${(e as Error).message}`; }
      const ok = got === c.want || (c.want.endsWith(':') && got.startsWith(c.want));
      const s = per.get(c.intent) ?? { n: 0, ok: 0 }; s.n++; if (ok) s.ok++; per.set(c.intent, s);
      if (!ok) wrong.push(`  [${c.role}] ${c.intent} "${c.said}"\n      expected ${c.want}\n      got      ${got}`);
    }
    const score = Math.round((mine.length - wrong.length) / mine.length * 1000) / 10;
    const table = [...per.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `  ${k.padEnd(12)} ${String(v.ok).padStart(5)}/${String(v.n).padEnd(5)} ${(v.ok / v.n * 100).toFixed(1)}%`).join('\n');
    console.log(`TESRAX 5000 half ${shard + 1}: ${mine.length - wrong.length}/${mine.length} (${score}%)\n${table}`);
    if (wrong.length) console.log(`Misunderstood (first 400):\n${wrong.slice(0, 400).join('\n')}`);
    expect(wrong.length, `${score}% understood`).toBe(0);
  }, 300_000);
});
}
if (!process.env.TESRAX_HALF_B) runHalf(SHARD);
