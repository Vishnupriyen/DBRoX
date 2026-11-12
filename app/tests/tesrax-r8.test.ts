// TESRAX round 8 (12 Nov 2026, owner on the phone): "open bills" and "send GSTR file export" not understood.
// Voice typing writes GSTR as "GST R", "GST R1", "g s t r"; "open bill" / "open billing" are the same screen as "open bills";
// and a staff role that may not export GST must be told what was understood and who can do it — not a bare "cannot".
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

describe('"open bills" in every way a person says it', () => {
  for (const t of ['open bills', 'Open Bills.', 'open bill', 'Open bill', 'open billing', 'bill list', 'show all bills', 'open invoices'])
    it(`"${t}" opens Bills`, async () => { expect(code(await say(t))).toBe('go:billed'); });
});
describe('GSTR the way voice typing writes it', () => {
  for (const t of ['send GSTR file export', 'send GST R file export', 'GST R1', 'gst r 1 file', 'g s t r file', 'GST R one october', 'export gst r1'])
    it(`"${t}" makes the GSTR-1 file`, async () => { expect(code(await say(t))).toBe('export:gstr1'); });
  it('plain "gst" still opens the GST screen, "gst rate" is not GSTR', async () => {
    expect(code(await say('gst'))).toBe('go:gst');
    expect(code(await say('gst report'))).toBe('go:gst');
    expect(code(await say('open gst r'))).toBe('export:gstr1');
  });
});
describe('a role that may not export GST hears what was understood and who can', () => {
  for (const r of ['delivery', 'salesman', 'godown'] as Role[])
    it(`${r}: "send GSTR file export"`, async () => {
      as(r);
      const x = await say('send GSTR file export');
      expect(x.refused).toBe(true);
      expect(x.text).toMatch(/GSTR-1/);
      expect(x.text).toMatch(/owner or office/i);
    });
  it('delivery: "open bills" says Bills is the owner\'s screen', async () => {
    as('delivery');
    expect((await say('open bills')).text).toMatch(/Bills is the owner's screen/);
  });
});
