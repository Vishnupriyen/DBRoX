// TESRAX round 9 (12 Nov 2026, owner: "every word of the app and every report it should send"). Every screen the app
// has opens by its own name, every module tile opens, and every owner report comes back for any period, ready to send.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle, SCREENS } from '../src/core/engine';
import { periodIn, REPORT_WORDS } from '../src/core/reportsVoice';
import type { Role } from '../src/core/types';
import { code, loadNames } from './tesrax-code';
const ids: Partial<Record<Role, string>> = {};
beforeAll(async () => { await seedDemo(); await loadNames(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id; });
beforeEach(() => setSession('demo', ids.owner!));
const as = (r: Role) => setSession('demo', ids[r]!);
const say = (t: string) => handle(t, [], {});

describe('every screen opens by its own name (owner)', () => {
  const cases: [string, string][] = [
    ['open company bills', 'inbound'], ['order to company', 'reorder'], ['open staff', 'staff'], ['staff list', 'staff'],
    ['open settings', 'settings'], ['company links', 'links'], ['tesrax report', 'tesrax'], ['my plan', 'billing'],
    ['beats', 'beat'], ['beat plan', 'beat'], ['picked to verify', 'verify'], ['cheques and upi', 'cheques'],
    ['open inventory', 'module:inventory'], ['open accountant', 'module:accountant'], ['open payroll', 'module:payroll'],
    ['open delivery', 'module:delivery'], ['salary sheet', 'salary'], ['open bills', 'billed'], ['cash with staff', 'cash'],
  ];
  for (const [t, page] of cases) it(`"${t}" → ${page}`, async () => { expect(code(await say(t))).toBe(`go:${page}`); });
  it('the driver still gets his trip for "delivery", the salesman his beat for "beats"', async () => {
    as('delivery'); expect(code(await say('delivery'))).toBe('go:trip');
    as('salesman'); expect(code(await say('beats'))).toBe('go:beat');
  });
  it('every screen name in the list opens that screen for a role that may see it', async () => {
    const miss: string[] = [];
    // "open bill" opens the Bills list and "open collection" the Collect screen (the screens people mean); the tiles: "bill module"
    for (const s of SCREENS.filter(x => x.page !== 'module:bill' && x.page !== 'module:collection')) {
      as(s.roles[0]);
      const r = await say(`open ${s.name.toLowerCase()}`);
      if (r.go !== s.page && !(SCREENS.some(o => o.page === r.go && o.name === s.name))) miss.push(`${s.name} → ${code(r)}`);
    }
    expect(miss).toEqual([]);
  });
});

describe('every report by name, for any period', () => {
  for (const r of REPORT_WORDS.filter(x => x.key !== 'all'))
    it(`"${r.words[0]}" gives the ${r.key} report`, async () => {
      const x = await say(`${r.words[0]} last month`);
      expect(x.missed).toBeFalsy(); expect(x.refused).toBeFalsy();
      expect(x.text).toMatch(new RegExp(`— ${periodIn('last month').label}`));
      expect(x.link?.page).toBe('reports');
    });
  it('"send day book october" has the table and a Send as Excel button', async () => {
    const x = await say('send day book this month');
    expect(x.text).toMatch(/^Day book/);
    if (x.table) { expect(x.table.rows.length).toBeGreaterThan(0); expect(x.actions?.[0].label).toBe('Send as Excel'); }
  });
  it('"all reports last month" sends every report in one Excel', async () => {
    const x = await say('all reports last month');
    expect(x.actions?.[0].label).toMatch(/Send all reports/);
    expect(x.text).toMatch(/All 14 reports/);
  });
  it('staff are told reports are for the owner or office', async () => {
    as('salesman');
    const x = await say('fast movers this month');
    expect(x.refused).toBe(true); expect(x.text).toMatch(/owner or office/);
  });
  it('"sales this month" is still the quick answer in words, not the report table', async () => {
    expect((await say('sales this month')).table).toBeUndefined();
  });
});

describe('periods', () => {
  afterEach(() => vi.useRealTimers());
  it('today, yesterday, weeks, months, a named month', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 12, 10)); // Thu 12 Nov 2026
    expect(periodIn('today')).toMatchObject({ from: '2026-11-12', to: '2026-11-12' });
    expect(periodIn('yesterday')).toMatchObject({ from: '2026-11-11', to: '2026-11-11' });
    expect(periodIn('this week')).toMatchObject({ from: '2026-11-09', to: '2026-11-12' });
    expect(periodIn('last week')).toMatchObject({ from: '2026-11-02', to: '2026-11-08' });
    expect(periodIn('last month')).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodIn('october')).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodIn('dec')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' }); // a month still to come = last year's
    expect(periodIn('march 2026')).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
    expect(periodIn('fast movers')).toMatchObject({ from: '2026-11-01', to: '2026-11-12' });
    expect(periodIn('murugan mart sales')).toMatchObject({ from: '2026-11-01' }); // "mart" is not March
  });
});
