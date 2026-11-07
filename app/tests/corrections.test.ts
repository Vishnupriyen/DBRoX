// Corrections in plain words ("it is not 500, it is 300"), and TESRAX never guessing an order from words that
// aren't products. Reported from the owner's phone on 2026-11-07.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { commit, validate, hasErrors } from '../src/core/proposals';
import { shopOutstanding } from '../src/core/ledger';

let selvam = '';
beforeAll(async () => {
  await seedDemo();
  setSession('demo', (await db.staff.where('role').equals('owner').first())!.id);
  selvam = (await db.shops.toArray()).find(s => /selvam/i.test(s.name))!.id;
});
const pay = async (amount: number) => { const r = await handle(`Selvam Kirana paid ${amount} cash`, []); await commit(r.proposal!); };
const live = async () => (await db.payments.where('shopId').equals(selvam).toArray()).filter(p => p.status === 'ok');

describe('TESRAX understands corrections', () => {
  for (const said of [
    'Adjust selvam bill it is not 500 , it is 300',  // exactly what was typed
    'selvam paid 300 not 500',
    'change selvam payment 500 to 300',
    'wrong amount for selvam, it is 300',
  ]) it(`"${said}" corrects the last ₹500 payment to ₹300`, async () => {
    await pay(500);
    const before = await shopOutstanding(selvam);
    const r = await handle(said, []);
    expect(r.proposal?.kind).toBe('paymentFix');
    expect(hasErrors(await validate(r.proposal!))).toBe(false);
    const res = await commit(r.proposal!);
    expect(res.message).toMatch(/500.*300/);
    expect((await live()).some(p => p.amount === 500)).toBe(false); // the ₹500 is cancelled (kept for the audit trail)
    expect((await live()).some(p => p.amount === 300)).toBe(true);
    expect((await shopOutstanding(selvam)).total).toBeCloseTo(before.total + 200, 1);
  });

  it('warns about day close only when that day was really closed', async () => {
    await pay(450);
    expect((await handle('selvam it is not 450, it is 400', [])).text).not.toMatch(/day close/);
  });

  it('says so plainly when there is no such payment, and never makes an order', async () => {
    const r = await handle('selvam it is not 777, it is 300', []);
    expect(r.proposal?.kind).not.toBe('order');
    expect(r.text).toMatch(/couldn.t find a payment of ₹777/i);
  });
});

describe('TESRAX never guesses an order from words that are not products', () => {
  it('a shop + numbers but no product → asks, does not build a junk order', async () => {
    const r = await handle('Selvam Kirana hello 12 something 40', []);
    expect(r.proposal).toBeUndefined();
    expect(r.tone).toBe('warn');
    expect(r.text).toMatch(/Selvam Kirana/);
  });
  it('a real order still works', async () => {
    const r = await handle('Selvam Kirana 1 case surf, 24 good day', []);
    expect(r.proposal?.kind).toBe('order');
  });
});
