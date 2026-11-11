// TESRAX BLIND SET 7 — 205 messages written before round 6 changed anything (11 Nov 2026): Tanglish, spelling slips, shop
// nicknames, numbers in words, two things in one message, short forms, from every role. First run on the old engine: see the report.
// Same saves made today as in tesrax-5000.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { commit } from '../src/core/proposals';
import type { Role } from '../src/core/types';
import { code, converse, loadNames } from './tesrax-code';
import { FIX_EXPENSES, FIX_PAYMENTS } from './tesrax-gen';

type Case = [said: string | string[], expect: string, role?: Role];
const load = (f: string): Case[] => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

let ids: Record<Role, string>;
beforeAll(async () => {
  await seedDemo();
  await loadNames();
  ids = Object.fromEntries((await db.staff.toArray()).map(s => [s.role, s.id])) as Record<Role, string>;
  setSession('demo', ids.owner);
  for (const [shop, a, mode] of FIX_PAYMENTS) await commit((await handle(`${shop} paid ${a} ${mode}${mode === 'upi' ? ' ref 412345678901' : ''}`, [])).proposal!);
  for (const [said] of FIX_EXPENSES) await commit((await handle(said, [])).proposal!);
});

describe('TESRAX blind set 7 (Tamil Nadu staff typing)', () => {
  for (const file of ['tesrax-blind7.json']) it(file, async () => {
    const CASES = load(file);
    const wrong: string[] = [];
    for (const [said, want, role = 'owner'] of CASES) {
      setSession('demo', ids[role]);
      let got: string;
      const msgs = Array.isArray(said) ? said : [said];
      try { got = code(await converse(msgs, (s, last) => handle(s, [], { last }))); } catch (e) { got = `CRASH ${(e as Error).message}`; }
      if (got !== want) wrong.push(`  [${role}] ${JSON.stringify(said)}\n      expected ${want}\n      got      ${got}`);
    }
    const score = Math.round((CASES.length - wrong.length) / CASES.length * 1000) / 10;
    if (wrong.length) console.log(`${file}: ${CASES.length - wrong.length}/${CASES.length} (${score}%). Misunderstood:\n${wrong.join('\n')}`);
    expect(wrong, `${score}% understood`).toEqual([]);
  }, 120_000);
});
