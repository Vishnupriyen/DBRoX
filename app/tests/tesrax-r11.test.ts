// TESRAX round 11 (12 Nov 2026): misses from the blind check of round 10 (new sentences the training never saw).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import type { Role } from '../src/core/types';
import { code, loadNames } from './tesrax-code';
const ids: Partial<Record<Role, string>> = {};
beforeAll(async () => { await seedDemo(); await loadNames(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id; });
beforeEach(() => setSession('demo', ids.owner!));
const as = (r: Role) => setSession('demo', ids[r]!);
const say = (t: string) => handle(t, [], {});

describe('blind-check misses', () => {
  it('"open damages register" opens Damages', async () => { expect(code(await say('open damages register'))).toBe('go:damages'); });
  it('"report menu" opens Reports', async () => { expect(code(await say('report menu'))).toBe('go:reports'); });
  it('"credit note for ganapathi 6 good day" is a return', async () => {
    const r = await say('credit note for ganapathi 6 good day');
    expect(r.proposal?.kind).toBe('return');
  });
  it('godown: "received 5 cases lifebuoy from hul" is stock in', async () => {
    as('godown');
    const r = await say('received 5 cases lifebuoy from hul');
    expect(r.go === 'stockin' || r.proposal?.kind === 'stockin').toBe(true);
  });
  it('"what is my stock value" answers the stock value', async () => {
    const r = await say('what is my stock value');
    expect(r.missed).toBeFalsy(); expect(r.text).toMatch(/₹/);
  });
  it('"top 5 shops this month" gives the shop-wise report', async () => {
    const r = await say('top 5 shops this month');
    expect(r.text).toMatch(/^Shop-wise/);
  });
});
