// TESRAX MILLION — 1,000,000+ different everyday messages (every request, every role, two-in-one messages and
// follow-up conversations) with real typing noise: slips in shop and product names, numbers in words, "k" and
// "rs" amounts, Tanglish particles, unit spellings, filler words, capitals and punctuation.
// Built from the same deterministic generator as tesrax-5000 run with many seeds in "wild" mode.
//   npm run train:million                 all of them, in 4 shards (about an hour on 2 cores)
//   MILLION_SAMPLE=40000 npm run train:million   an even sample, for quick teaching rounds
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';
import { db, setSession } from '../../src/core/db';
import { seedDemo } from '../../src/core/seed';
import { handle } from '../../src/core/engine';
import { commit } from '../../src/core/proposals';
import type { Role } from '../../src/core/types';
import { code, converse, loadNames } from '../tesrax-code';
import { FIX_EXPENSES, FIX_PAYMENTS, generate, type Case, type Facts } from '../tesrax-gen';

export const TARGET = 1_000_000;

export function millionCases(facts: Facts, target = TARGET): Case[] {
  const seen = new Set<string>();
  const out: Case[] = [];
  for (let seed = 1; out.length < target && seed < 2000; seed++) {
    for (const c of generate(facts, { seed: seed * 7919, wild: true })) {
      const k = `${c.role}|${c.said.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k); out.push(c);
      if (out.length >= target) break;
    }
  }
  return out;
}

export async function runShard(shard: number, shards: number) {
  await seedDemo();
  await loadNames();
  const ids = Object.fromEntries((await db.staff.toArray()).map(s => [s.role, s.id])) as Record<Role, string>;
  setSession('demo', ids.owner);
  for (const [shop, a, mode] of FIX_PAYMENTS) await commit((await handle(`${shop} paid ${a} ${mode}${mode === 'upi' ? ' ref 412345678901' : ''}`, [])).proposal!);
  for (const [said] of FIX_EXPENSES) await commit((await handle(said, [])).proposal!);
  const stock: Record<string, number> = {};
  for (const p of await db.products.toArray()) stock[p.name.split(' ')[0]] = (await db.batches.where('productId').equals(p.id).toArray()).reduce((a, b) => a + b.qty, 0);

  const all = millionCases({ stock });
  const sample = Number(process.env.MILLION_SAMPLE ?? 0);
  const step = sample ? Math.max(1, Math.floor(all.length / sample)) : 1;
  const offset = Number(process.env.MILLION_OFFSET ?? 0) % step;
  const mine = all.filter((_, i) => i % step === offset).filter((_, i) => i % shards === shard);

  const per: Record<string, { n: number; ok: number }> = {};
  const misses: { role: string; intent: string; said: string; want: string; got: string }[] = [];
  let i = 0;
  const t0 = Date.now();
  for (const c of mine) {
    if (++i % 500 === 0) { db.close(); await db.open(); } // fake-indexeddb slows down after many transactions
    setSession('demo', ids[c.role]);
    let got: string;
    try { got = code(c.dialogue ? await converse(c.dialogue, (m, last) => handle(m, [], { last })) : await handle(c.said, [])); } catch (e) { got = `CRASH ${(e as Error).message}`; }
    const ok = got === c.want;
    (per[c.intent] ??= { n: 0, ok: 0 }).n++; if (ok) per[c.intent].ok++;
    if (!ok) misses.push({ role: c.role, intent: c.intent, said: c.said, want: c.want, got });
  }
  mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`./out/shard-${shard}.json`, import.meta.url), JSON.stringify({ shard, shards, total: all.length, ran: mine.length, seconds: Math.round((Date.now() - t0) / 1000), per, misses }, null, 1));
  expect(all.length).toBeGreaterThanOrEqual(sample ? 0 : TARGET);
}
