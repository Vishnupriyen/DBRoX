// TESRAX with a real-size catalogue's traps (found by the full working-app test with 2,000 products and 1,200 shops,
// 9 Nov 2026). Product names that contain other words ("Tata Tea", "Intense Repair", "Set Wet", "&", "5 Star",
// "Total 10"), pack sizes that differ only by size, and the same shop name in two towns.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { ChangeSet, db, setSession } from '../src/core/db';
import { handle } from '../src/core/converse';
import type { Reply } from '../src/core/engine';

const P: Record<string, string> = {};
const S: Record<string, string> = {};
const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
const other = day === 'Monday' ? 'Tuesday' : 'Monday';

beforeAll(async () => {
  setSession('cat', 'owner');
  const cs = new ChangeSet();
  cs.put('settings', { firmName: 'Cat Agencies', gstin: '', address: 'Tittakudi', stateCode: '33', phone: '9800000001', modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true }, billFormat: 'A5', returnApprovalLimit: 2000, discountAlertPct: 5 });
  cs.put('staff', { id: 'owner', name: 'Owner', phone: '9800000001', role: 'owner', pin: '1111', active: true });
  cs.put('staff', { id: 'ravi', name: 'Ravi', phone: '9800000002', role: 'salesman', pin: '2222', active: true });
  cs.put('staff', { id: 'bala', name: 'Bala', phone: '9800000003', role: 'salesman', pin: '3333', active: true });
  const co = cs.put('companies', { name: 'Mixed', code: 'MX', gstin: '', nextBillNo: 1 });
  const names = ['Tata Tea Premium 250g', 'Tata Tea Gold 250g', 'Dove Intense Repair 180ml', 'Set Wet Hair Gel 50ml', 'Set Wet Hair Gel 150ml',
    'Hide & Seek Choco Chip 100g', 'Hide & Seek Choco Chip 200g', 'Hide & Seek Fab Bourbon 100g', '5 Star Original 22g', '5 Star Original 40g',
    'Lifebuoy Total 10 125g', 'Lifebuoy Total 10 4x125g', 'NutriChoice 5 Grain 100g', 'NutriChoice Oats Cookies 100g',
    'Surf Excel Easy Wash 1kg', 'Surf Excel Quick Wash 1kg', 'Surf Excel Easy Wash 500g', 'Tide Lemon & Mint 500g', 'Tide Lemon & Mint 2kg', 'Vim Bar 200g',
    'Classmate Notebook Four Line 172 pages', 'Classmate Notebook Single Line 172 pages', 'HIT Mosquito Spray 1pc', 'HIT Mosquito Spray 200ml',
    'Rin Bar 1kg', 'Rin Advanced 1kg', 'Tetley Classic 25 bags', 'Tetley Classic 10 bags', 'Knorr Hot & Sour Soup Pack of 4', 'Navratna Cool Oil 100ml', 'Navratna Almond 100ml',
    'Good Knight Gold Flash Refill 10pcs', 'Maggi 2-Minute Masala 70g', 'Tetley Classic 25 bags (Promo Pack)', 'Whisper Choice 30 pads', 'Whisper Choice 15 pads',
    'Sunfeast Bounce Cream 75g', 'Classmate Notebook Four Line 240 pages', 'Classmate Notebook Four Line 240 pages (Promo Pack)', 'Classmate Drawing Book 172 pages', 'Classmate Drawing Book 172 pages (Promo Pack)'];
  for (const n of names) { const p = cs.put('products', { companyId: co.id, name: n, code: '', hsn: '34022090', gst: 18, mrp: 100, rate: 80, purchaseRate: 75, caseSize: 12, aliases: [], active: true }); P[n] = p.id; cs.put('batches', { productId: p.id, batch: 'B1', expiry: '2027-12-31', mrp: 100, qty: 600, godown: 'Main' }); }
  const shop = (name: string, area: string, salesmanId: string, beat: string) => cs.put('shops', { name, area, beat, salesmanId, creditLimit: 50000, creditDays: 7, cashOnly: false, type: 'retail', approved: true, aliases: [] }).id;
  S.murTit = shop('Sri Murugan Stores', 'Tittakudi', 'ravi', day);
  S.murPen = shop('Sri Murugan Stores', 'Pennadam', 'bala', day);
  S.murRaviOther = shop('Sri Murugan Stores', 'Neyveli', 'ravi', other);
  S.lak = shop('Lakshmi Traders', 'Tittakudi', 'ravi', day);
  await cs.commit('setup');
});

const as = (who: string) => setSession('cat', who);
const shopOf = (r: Reply) => r.proposal?.fields.find(f => f.key === 'shopId')?.value;
const ids = (r: Reply) => (r.proposal?.rows ?? []).map(x => x.productId);

describe('product names that contain other words are still orders', () => {
  it.each([
    ['lakshmi traders 2 case tata tea premium 250g', 'Tata Tea Premium 250g'],
    ['lakshmi traders 1 case dove intense repair 180ml', 'Dove Intense Repair 180ml'],
    ['lakshmi traders 1 case set wet hair gel 50ml', 'Set Wet Hair Gel 50ml'],
  ])('"%s"', async (said, want) => {
    as('owner'); const r = await handle(said, []);
    expect(r.proposal?.kind, r.text).toBe('order');
    expect(ids(r)).toEqual([P[want]]);
  });
  it('with no shop it asks which shop, never an expense or a damage claim', async () => {
    as('owner');
    for (const said of ['1 case tata tea premium 250g', '2 case dove intense repair 180ml', '1 case set wet hair gel 150ml']) {
      const r = await handle(said, []);
      expect(r.proposal?.kind, said).toBeUndefined();
      expect(r.text, said).toMatch(/which shop/i);
    }
  });
  it('a real expense still is one', async () => {
    as('owner');
    expect((await handle('tea and snacks 240', [])).proposal?.kind).toBe('expense');
    expect((await handle('van repair 1800', [])).proposal?.kind).toBe('expense');
  });
});

describe('pack sizes and numbers inside names', () => {
  it.each([
    ['lakshmi traders 2 case hide & seek choco chip 100g', ['Hide & Seek Choco Chip 100g']],
    ['lakshmi traders 6 pcs tide lemon & mint 500g', ['Tide Lemon & Mint 500g']],
    ['lakshmi traders 2 case 5 star original 22g', ['5 Star Original 22g']],
    ['lakshmi traders 2 case lifebuoy total 10 4x125g', ['Lifebuoy Total 10 4x125g']],
    ['lakshmi traders 6 pcs nutrichoice 5 grain 100g', ['NutriChoice 5 Grain 100g']],
    ['lakshmi traders 2 case hide & seek choco chip 100g, 6 pcs vim bar 200g', ['Hide & Seek Choco Chip 100g', 'Vim Bar 200g']],
    ['lakshmi traders 1 case surf excel easy wash 1kg and 2 case vim bar 200g', ['Surf Excel Easy Wash 1kg', 'Vim Bar 200g']],
  ])('"%s"', async (said, want) => {
    as('owner'); const r = await handle(said, []);
    expect(r.proposal?.kind, r.text).toBe('order');
    expect(ids(r)).toEqual(want.map(w => P[w]));
  });
  it.each([
    ['lakshmi traders 2 case classmate notebook four line 172 pages', 'Classmate Notebook Four Line 172 pages', 24],
    ['lakshmi traders 6 pcs hit mosquito spray 1pc', 'HIT Mosquito Spray 1pc', 6],
    ['lakshmi traders 6 pcs rin bar 1kg', 'Rin Bar 1kg', 6],
    ['lakshmi traders 2 case tetley classic 25 bags', 'Tetley Classic 25 bags', 24],
    ['lakshmi traders 1 case good knight gold flash refill 10pcs', 'Good Knight Gold Flash Refill 10pcs', 12],
    ['lakshmi traders 1 case knorr hot & sour soup pack of 4', 'Knorr Hot & Sour Soup Pack of 4', 12],
    ['lakshmi traders tittakudi 1 case vim bar 200g', 'Vim Bar 200g', 12],
    ['lakshmi traders 2 case maggi 2-minute masala 70g', 'Maggi 2-Minute Masala 70g', 24],
    ['lakshmi traders maggi 2 case', 'Maggi 2-Minute Masala 70g', 24],
    ['lakshmi traders 6 pcs whisper choice 30 pads', 'Whisper Choice 30 pads', 6],
    ['lakshmi traders 2 case classmate drawing book 172 pages', 'Classmate Drawing Book 172 pages', 24],
    ['lakshmi traders 2 case sunfeast bounce cream 75g', 'Sunfeast Bounce Cream 75g', 24],
    ['lakshmi traders 6 pcs classmate notebook four line 240 pages', 'Classmate Notebook Four Line 240 pages', 6],
  ])('"%s" → %s × %i', async (said, want, qty) => {
    as('owner'); const r = await handle(said, []);
    expect(r.proposal?.kind, r.text).toBe('order');
    expect(ids(r)).toEqual([P[want]]);
    expect(r.proposal!.rows[0].qty).toBe(qty);
  });
  it('quantities are right when the name has a number', async () => {
    as('owner'); const r = await handle('lakshmi traders 2 case 5 star original 22g', []);
    expect(r.proposal?.rows[0].qty).toBe(24);
  });
});

describe('a short name that fits several packs is never guessed', () => {
  it.each(['lakshmi traders 1 case surf excel 1kg', 'lakshmi traders 1 case hide & seek 100g', 'lakshmi traders 2 case tata tea 250g', 'lakshmi traders 1 case navratna 100ml'])('"%s" → the row waits for a pick', async said => {
    as('owner'); const r = await handle(said, []);
    expect(r.proposal?.kind, r.text).toBe('order');
    expect(r.proposal!.rows[0].productId).toBe('');
    expect(String(r.proposal!.rows[0].said)).toMatch(/or/);
    expect(r.text).toMatch(/pick|which/i);
  });
});

describe('the same shop name in different towns', () => {
  it('the salesman gets his own shop on today\'s beat', async () => {
    as('ravi'); expect(shopOf(await handle('sri murugan stores 1 case vim bar 200g', []))).toBe(S.murTit);
    as('bala'); expect(shopOf(await handle('sri murugan stores 1 case vim bar 200g', []))).toBe(S.murPen);
    as('ravi'); expect((await handle('sri murugan stores paid 500 cash', [])).proposal?.fields.find(f => f.key === 'shopId')?.value).toBe(S.murTit);
  });
  it('the town in the message decides', async () => {
    as('owner'); expect(shopOf(await handle('sri murugan stores pennadam 1 case vim bar 200g', []))).toBe(S.murPen);
    as('owner'); expect(shopOf(await handle('sri murugan stores neyveli paid 300', []))).toBe(S.murRaviOther);
  });
  it('the owner with no town is asked which one, with the towns named', async () => {
    as('owner'); const r = await handle('sri murugan stores 1 case vim bar 200g', []);
    expect(r.proposal).toBeUndefined();
    expect(r.text).toMatch(/Tittakudi/); expect(r.text).toMatch(/Pennadam/);
  });
});
