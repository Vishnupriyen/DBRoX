// TESRAX round 6 (11 Nov 2026): real misses from the UX review and from blind set 7 — how Tamil Nadu distributor
// staff really type. Each case failed before the change. An unclear order still asks; nothing is saved before ✓.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db, setSession, today, daysFrom } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle, type Reply } from '../src/core/engine';
import { commit } from '../src/core/proposals';
import type { Role } from '../src/core/types';
import { code, converse, loadNames } from './tesrax-code';

const ids: Partial<Record<Role, string>> = {};
beforeAll(async () => {
  await seedDemo();
  await loadNames();
  for (const s of await db.staff.toArray()) ids[s.role] ??= s.id;
});
beforeEach(() => setSession('demo', ids.owner!));
const as = (r: Role) => setSession('demo', ids[r]!);
const say = (t: string, last?: Reply) => handle(t, [], { last });
const talk = (...m: string[]) => converse(m, (s, last) => handle(s, [], { last }));

describe('Tamil words in an order', () => {
  it('"Murugan kadaiku 2 petti surf excel" is an order of 2 cases (24 pcs) of Surf for Murugan Stores', async () => {
    as('salesman');
    const r = await say('Murugan kadaiku 2 petti surf excel');
    expect(code(r)).toBe('order:Murugan Stores');
    expect(r.proposal!.rows).toHaveLength(1);
    expect(r.proposal!.rows[0].qty).toBe(24);
  });
  it.each([
    ['selvam kadai 2 case vim', 'order:Selvam Kirana'],
    ['kumar mart ku 48 good day anupunga', 'order:Kumar Mart'],
    ['velan kadaiku oru petti vim', 'order:Velan Provision'],
    ['murugan rendu case surf', 'order:Murugan Stores'],
    ['kumar mart la 24 classmate', 'order:Kumar Mart'],
    ['ganapathi stores ku 6 atta venum', 'order:Ganapathi Stores'],
    ['velan provison 36 cake', 'order:Velan Provision'], // a slip in the shop's second word is not a product
  ])('%s', async (s, want) => { as('salesman'); expect(code(await say(s))).toBe(want); });
  it('one petti of vim is one case (60 pcs)', async () => {
    as('salesman');
    expect((await say('velan kadaiku oru petti vim')).proposal!.rows[0].qty).toBe(60);
  });
  it('an unclear order still asks: no shop, or no product', async () => {
    as('salesman');
    for (const s of ['kadai 2 petti surf', '2 petti surf', 'murugan 2 petti horlicks', 'murugan kadaiku surf']) {
      const r = await say(s);
      expect(r.proposal, s).toBeUndefined();
      expect(r.tone, s).toBe('warn');
    }
  });
  it('two shops in one line without a comma are two orders', async () => {
    expect(code(await say('murugan 2 case surf ganapathi 1 case vim'))).toBe('order:Murugan Stores + order:Ganapathi Stores');
  });
});

describe('money words', () => {
  it.each([
    ['murugan 1000 kuduthaanga', 'payment:Murugan Stores:1000:cash'],
    ['velan 1000 kuduthar', 'payment:Velan Provision:1000:cash'],
    ['annai 1000 kudutha', 'payment:Annai Super Market:1000:cash'],
    ['annai 5000 cheque kuduthanga', 'payment:Annai Super Market:5000:cheque'],
    ['murugan baaki', 't:Outstanding'],
    ['murugan kadai baaki evlo', 't:Outstanding'],
    ['selvam balance', 't:Outstanding'],
    ['kumar mart evlo kudukanum', 't:Outstanding'],
  ])('%s', async (s, want) => expect(code(await say(s))).toBe(want));
  it('"selvam 2 surf thirumba kuduthanga" (gave back) is a return, never a payment', async () => {
    as('delivery');
    expect(code(await say('selvam 2 surf thirumba kuduthanga'))).toBe('return:Selvam Kirana');
  });
  it('"illa" after an amount corrects it', async () => {
    await commit((await say('Kumar Mart paid 1500 upi ref 412345678901')).proposal!);
    expect(code(await say('kumar mart 1500 illa 1400'))).toBe('fix:1500->1400');
  });
});

describe('questions in Tanglish', () => {
  it.each([
    ['surf evlo irukku', 't:Stock', 'godown'],
    ['surf stock irukka', 't:Stock', 'salesman'],
    ['today sales evlo', 't:Sales', 'office'],
    ['low stock', 'go:stock', 'godown'],
    ['low stock', 'go:stock', 'owner'],
    ['who has cash', 'go:cash', 'owner'],
    ['staff kitta evlo cash irukku', 'go:cash', 'owner'],
    ['van enga irukku', 'go:live', 'owner'],
    ['next shop', 'go:beat', 'salesman'],
    ['en target evlo', 'go:myday', 'salesman'],
    ['HUL stock vandhuchu', 'go:stockin', 'godown'],
    ['stock vanthuchu entry podanum', 'go:stockin', 'godown'],
  ] as [string, string, Role][])('%s (%s)', async (s, want, role) => { as(role); expect(code(await say(s))).toBe(want); });
});

describe('expenses', () => {
  it.each([['desel 1200', 1200], ['deisel 900 van 1', 900], ['deisal 700', 700]])('%s is fuel', async (s, n) => {
    as('delivery');
    expect(code(await say(s))).toBe(`expense:${n}:Fuel`);
  });
});

describe('a visit with no order, and why', () => {
  it('"no order ganapathi shop closed" is a no-order visit, saved only on ✓, once', async () => {
    as('salesman');
    const before = await db.visits.count();
    const r = await say('no order ganapathi shop closed');
    expect(code(r)).toBe('noOrder:Ganapathi Stores');
    expect(r.proposal!.fields.find(f => f.key === 'reason')?.value).toBe('Shop closed');
    expect(await db.visits.count()).toBe(before); // nothing saved before ✓
    await commit(r.proposal!);
    const v = (await db.visits.toArray()).filter(x => x.staffId === ids.salesman && x.date === today());
    expect(v).toHaveLength(1);
    expect(v[0].outcome).toBe('no_order');
    expect(v[0].reason).toBe('Shop closed');
    await commit(r.proposal!); // a second tap keeps one visit
    expect((await db.visits.toArray()).filter(x => x.staffId === ids.salesman && x.date === today())).toHaveLength(1);
    // the open order of Ganapathi is untouched
    expect((await db.orders.toArray()).filter(o => o.status === 'new').length).toBeGreaterThan(0);
  });
  it.each([
    ['velan no order, stock irukku', 'Stock is enough'],
    ['kumar mart owner illa, no order', 'Owner not there'],
    ['selvam kadai closed today', 'Shop closed'],
    ['murugan no order, panam illa', 'No money now'],
  ])('%s → %s', async (s, why) => {
    as('salesman');
    const r = await say(s);
    expect(r.proposal?.kind).toBe('visit');
    expect(r.proposal!.fields.find(f => f.key === 'reason')?.value).toBe(why);
  });
  it('a driver or godown cannot mark a no-order visit; cancelling an order is still a cancel', async () => {
    as('godown');
    expect((await say('no order ganapathi shop closed')).proposal).toBeUndefined();
    as('salesman');
    expect(code(await say('cancel ganapathi order'))).toBe('orderCancel:Ganapathi Stores');
  });
});

describe('follow-ups in Tanglish', () => {
  it.each([
    [['kumar mart 1000 paid', 'venam'], 'dropped'],
    [['velan 2 case vim', 'sari'], 'tap'],
    [['selvam paid 500', 'illa 600'], 'payment:Selvam Kirana:600:cash'],
    [['selvam 300', 'gpay la'], 'payment:Selvam Kirana:300:upi'],
    [['murugan 2 case surf', 'add 1 petti vim'], 'order:Murugan Stores'],
    [['2 petti surf', 'murugan kadai'], 'order:Murugan Stores'],
  ])('%j', async (m, want) => expect(code(await talk(...m))).toBe(want));
});

describe('round 4 words still hold', () => {
  it('nalaiku / naalai / inniku leave, udanju damage', async () => {
    as('salesman');
    expect((await say('nalaiku leave')).proposal?.rows[0].from).toBe(daysFrom(1));
    expect((await say('naalai leave')).proposal?.rows[0].from).toBe(daysFrom(1));
    expect((await say('inniku leave')).proposal?.rows[0].from).toBe(today());
    as('godown');
    expect(code(await say('good day 4 pcs udanju'))).toBe('claim');
  });
});
