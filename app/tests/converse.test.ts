// Two things in one message, and follow-up replies to the table just shown.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { code, converse, loadNames } from './tesrax-code';

let owner = '';
const prod: Record<string, string> = {};
beforeAll(async () => {
  await seedDemo(); await loadNames();
  owner = (await db.staff.toArray()).find(s => s.role === 'owner')!.id;
  setSession('demo', owner);
  for (const p of await db.products.toArray()) prod[p.name.split(' ')[0].toLowerCase()] = p.id;
});
const say = async (s: string) => code(await handle(s, []));
const talk = (...m: string[]) => converse(m, (s, last) => handle(s, [], { last }));

describe('several things in one message', () => {
  it.each([
    ['Murugan paid 500, send 2 case surf', 'payment:Murugan Stores:500:cash + order:Murugan Stores'],
    ['selvam paid 300 and 2 case vim', 'payment:Selvam Kirana:300:cash + order:Selvam Kirana'],
    ['murugan 2 case surf and selvam 24 good day', 'order:Murugan Stores + order:Selvam Kirana'],
    ['murugan paid 500, selvam paid 300 upi', 'payment:Murugan Stores:500:cash + payment:Selvam Kirana:300:upi'],
    ['diesel 1500, toll 85', 'expense:1500:Fuel + expense:85:Toll'],
    ['kumar mart 2 case surf then kumar mart outstanding', 'order:Kumar Mart + t:Outstanding'],
  ])('%s', async (s, want) => expect(await say(s)).toBe(want));
  it.each([
    ['murugan 2 case surf, 24 good day', 'order:Murugan Stores'],
    ['murugan stores paid rs.2,450 cash', 'payment:Murugan Stores:2450:cash'],
    ['wrong amount for selvam, it is 300', 'fix:'],
    ['profit and loss', 'go:pnl'],
  ])('one thing: %s', async (s, want) => expect((await say(s)).startsWith(want)).toBe(true));
});

describe('follow-ups', () => {
  it('answers "which shop?" with just the shop', async () => {
    expect(code(await talk('2 case surf', 'murugan'))).toBe('order:Murugan Stores');
  });
  it('changes a payment amount, mode and shop', async () => {
    expect(code(await talk('murugan paid 500', 'make it 600'))).toBe('payment:Murugan Stores:600:cash');
    expect(code(await talk('murugan paid 500', 'gpay'))).toBe('payment:Murugan Stores:500:upi');
    expect(code(await talk('murugan paid 500', 'no, selvam'))).toBe('payment:Selvam Kirana:500:cash');
  });
  it('changes an order: add, set the last item, remove, move shop', async () => {
    const r = await talk('murugan 2 case surf', 'add 2 vim', 'make it 3 case');
    const rows = r.proposal!.rows;
    expect(rows.find(x => x.productId === prod.surf)?.qty).toBe(24);
    expect(rows.find(x => x.productId === prod.vim)?.qty).toBe(180); // "make it 3 case" = the last item: 3 × 60 vim
    const r2 = await talk('murugan 2 case surf, 24 good day', 'remove surf');
    expect(r2.proposal!.rows.map(x => x.productId)).toEqual([prod.good]);
    expect(code(await talk('murugan 2 case surf', 'for selvam'))).toBe('order:Selvam Kirana');
  });
  it('changes an expense amount and category', async () => {
    expect(code(await talk('diesel 1500', '1400'))).toBe('expense:1400:Fuel');
    expect(code(await talk('diesel 1500', 'it is toll'))).toBe('expense:1500:Toll');
  });
  it('yes never saves; no drops the table', async () => {
    expect(code(await talk('murugan paid 500', 'yes'))).toBe('tap');
    expect(code(await talk('murugan paid 500', 'no'))).toBe('dropped');
    expect((await db.payments.toArray()).filter(x => x.amount === 500).length).toBe(0);
  });
  it('a new request after a table is just a new request', async () => {
    expect(code(await talk('murugan paid 500', 'selvam outstanding'))).toBe('t:Outstanding');
  });
});
