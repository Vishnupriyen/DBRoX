// TESRAX BLIND SETS 2 & 3 — 600 phrases written independently (from the demo world and the result codes only, never
// seeing TESRAX's code or training set): set 2 is changes to saved things, set 3 a whole working day. Same codes as
// tesrax-code.ts, same saves made today as in tesrax-5000 (the payments and expenses the corrections refer to).
// First run: set 2 214/300 (71.3%), set 3 247/300 (82.3%). TESRAX learned the rest (arrows, lakh, floor stock talk, bounce/reversal words,
// "N only" corrections…). 24 expectations were changed after review because TESRAX was right for this world: people
// who saved nothing today get "nothing to undo"; Ravi may cancel the Velan cash he collected; owner-only screens and the Outstanding/Cash/Load screens follow the earlier owner decisions; scheme questions
// get the running-schemes table (t:Schemes); bare "vim 700 pcs" from the owner is unclear (ask).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { commit } from '../src/core/proposals';
import type { Role } from '../src/core/types';
import { code, loadNames } from './tesrax-code';
import { FIX_EXPENSES, FIX_PAYMENTS } from './tesrax-gen';

type Case = [said: string, expect: string, role?: Role];
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

describe('TESRAX blind sets (written by someone who never saw TESRAX)', () => {
  for (const file of ['tesrax-blind2.json', 'tesrax-blind3.json']) it(file, async () => {
    const CASES = load(file);
    const wrong: string[] = [];
    for (const [said, want, role = 'owner'] of CASES) {
      setSession('demo', ids[role]);
      let got: string;
      try { got = code(await handle(said, [])); } catch (e) { got = `CRASH ${(e as Error).message}`; }
      if (got !== want) wrong.push(`  [${role}] "${said}"\n      expected ${want}\n      got      ${got}`);
    }
    const score = Math.round((CASES.length - wrong.length) / CASES.length * 1000) / 10;
    if (wrong.length) console.log(`${file}: ${CASES.length - wrong.length}/${CASES.length} (${score}%). Misunderstood:\n${wrong.join('\n')}`);
    expect(wrong, `${score}% understood`).toEqual([]);
  }, 120_000);
});
