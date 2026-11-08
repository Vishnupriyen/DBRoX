// TESRAX BLIND SETS 4–6 — 900 phrases written independently (from the demo world and the result codes only):
// set 4 the field and floor (godown, driver, salesman), set 5 the office and the owner, set 6 several things in one
// message and follow-up dialogues ([messages…], code of the last reply). Same saves made today as in tesrax-5000.
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

describe('TESRAX blind sets 4–6 (written by someone who never saw TESRAX)', () => {
  for (const file of ['tesrax-blind4.json', 'tesrax-blind5.json', 'tesrax-blind6.json']) it(file, async () => {
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
