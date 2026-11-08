// TESRAX BLIND SET — 120 phrases written independently (without seeing TESRAX or its training set) to measure
// how well TESRAX understands people it was not tuned on. Same result codes as tesrax-corpus.test.ts.
// (kept as a permanent test once fixed). First run: 105/120 (87.5%). Three expectations were corrected after review,
// because TESRAX was right: 'day close' and 'salary sheet' typed by OFFICE get "that's the owner's screen" (owner-only
// screens), and 'outstanding list' opens the Outstanding screen (the owner's choice).
// TESRAX TRAINING SET — every way a distributor's team is likely to type a request, and what TESRAX must do.
// Short forms, typos, any word order, rupee signs. Each line is a permanent test: once TESRAX learns a
// phrase it can never forget it. Add a line whenever a real user is misunderstood.
//
// Expected result codes:
//   order:<shop>            a new-order table for that shop
//   payment:<shop>:<₹>[:mode]  a payment table          fix:<old>-><new>   a payment correction
//   return:<shop>  claim  newshop  schemes  expense:<₹>[:category]  leave  advance:<₹>
//   t:<table>               an answer table (Outstanding, Sales, Stock, Near, Cash, Load, Needs)
//   go:<screen>             opens that screen        export:<tally|gstr1|einvoice|claims>
//   help                    the help list            ask    a clear question back (never a wrong action)
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { code, loadNames } from './tesrax-code';
import type { Role } from '../src/core/types';

type Case = [said: string, expect: string, role?: Role];

import { readFileSync } from 'node:fs';
const CORPUS: Case[] = JSON.parse(readFileSync(new URL('./fixtures/tesrax-blind.json', import.meta.url), 'utf8'));

let ids: Record<Role, string>;
beforeAll(async () => {
  await seedDemo();
  await loadNames();
  const staff = await db.staff.toArray();
  ids = Object.fromEntries(staff.map(s => [s.role, s.id])) as Record<Role, string>;
});

describe('TESRAX blind set (written by someone who never saw TESRAX)', () => {
  it(`understands all ${CORPUS.length} blind phrasings`, async () => {
    const wrong: string[] = [];
    for (const [said, want, role = 'owner'] of CORPUS) {
      setSession('demo', ids[role]);
      let got: string;
      try { got = code(await handle(said, [])); } catch (e) { got = `CRASH ${(e as Error).message}`; }
      if (!got.startsWith(want)) wrong.push(`  [${role}] "${said}"\n      expected ${want}\n      got      ${got}`);
    }
    const score = Math.round((CORPUS.length - wrong.length) / CORPUS.length * 1000) / 10;
    if (wrong.length) console.log(`TESRAX understood ${CORPUS.length - wrong.length}/${CORPUS.length} (${score}%). Misunderstood:\n${wrong.join('\n')}`);
    expect(wrong, `${score}% understood`).toEqual([]);
  });
});
