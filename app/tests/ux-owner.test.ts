// The owner's first five minutes (UX review, 11 Nov 2026): what TESRAX says must be specific and short, and money and
// dates read the Indian way. Each case was a real miss found by using the app as an owner.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { setSession, db } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { inr, showDate, showMonth, plural } from '../src/core/i18n';

beforeAll(async () => {
  await seedDemo();
  setSession('demo', (await db.staff.toArray()).find(s => s.role === 'owner')!.id);
});
const say = (t: string) => handle(t, []);

describe('the owner\'s first five minutes', () => {
  it('money and dates read the Indian way', () => {
    expect(inr(9901.6)).toBe('₹9,901.60');
    expect(inr(1200)).toBe('₹1,200');
    expect(inr(190895.28)).toBe('₹1,90,895.28');
    expect(inr(-58.32)).toBe('−₹58.32');
    expect(showDate(`${new Date().getFullYear()}-10-30`)).toBe('30 Oct');
    expect(showDate('2024-05-10')).toBe('10 May 2024');
    expect(showMonth('2026-11')).toBe('Nov 2026');
    expect(plural(1, 'bill')).toBe('1 bill'); expect(plural(2, 'bill')).toBe('2 bills'); expect(plural(1, 'person', 'people')).toBe('1 person');
  });
  it('a question about profit is answered in words, with the P&L one tap away (it used to jump to another screen)', async () => {
    const r = await say('what is my profit this month');
    expect(r.go).toBeUndefined();
    expect(r.link?.page).toBe('pnl');
    expect(r.text).toMatch(/^This month: (profit|loss) ₹/);
  });
  it('an unknown product names what was not found, in two lines (it used to say "not sure" plus examples)', async () => {
    const r = await say('murugan stores 2 box sunlight');
    expect(r.text).toMatch(/Found Murugan Stores, but no product called "/);
    expect(r.text.split('\n').length).toBeLessThanOrEqual(2);
  });
  it('a message not understood gets one short line, never the whole help page', async () => {
    const r = await say('asdf qwer zxcv');
    expect(r.text.length).toBeLessThan(200);
    expect(r.text).toMatch(/say "help"/);
  });
  it('"cancel last bill" shows the newest bill to cancel (it used to dump the help page)', async () => {
    const r = await say('cancel last bill');
    expect(r.text).toMatch(/^Cancel bill /);
  });
});
