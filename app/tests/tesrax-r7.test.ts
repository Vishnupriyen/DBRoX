// TESRAX round 7 (11 Nov 2026): "anna", typo vs not stocked, missing shop. From the end-user panel.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle, type Reply } from '../src/core/engine';
import type { Role } from '../src/core/types';
import { code, loadNames } from './tesrax-code';
const ids: Partial<Record<Role, string>> = {};
beforeAll(async () => { await seedDemo(); await loadNames(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id; });
beforeEach(() => setSession('demo', ids.owner!));
const as = (r: Role) => setSession('demo', ids[r]!);
const say = (t: string, last?: Reply) => handle(t, [], { last });

describe('"anna" is a way to call someone, never a shop', () => {
  it('"anna 2 case surf" asks which shop', async () => {
    as('salesman');
    const r = await say('anna 2 case surf');
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/Which shop/);
  });
  it('a real name close to it still matches ("annai", "annia")', async () => {
    as('salesman');
    expect(code(await say('annai 2 case surf'))).toBe('order:Annai Super Market');
    expect(code(await say('annia 2 case surf'))).toBe('order:Annai Super Market');
  });
});
describe('typo vs not in the product list', () => {
  it('"sarf" is a typo: did you mean Surf', async () => {
    as('salesman');
    const r = await say('kumar mart 2 case sarf');
    expect(r.text).toMatch(/did you mean Surf/i);
    expect(r.proposal).toBeUndefined();
  });
  it('"lux" is not in the list', async () => {
    as('salesman');
    const r = await say('kumar mart 2 case lux');
    expect(r.text).toMatch(/"lux" is not in your product list/);
    expect(r.text).not.toMatch(/did you mean/);
  });
  it('cases for a shop we do not have: ask which shop', async () => {
    as('salesman');
    const r = await say('Kaveri 3 case coconut oil order');
    expect(r.text).toMatch(/Which shop/);
    expect(r.tone).toBe('warn');
  });
});
