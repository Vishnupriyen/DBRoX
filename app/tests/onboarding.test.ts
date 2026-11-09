// A brand-new distributor starts with an empty phone: no companies, no products, no shops. Everything must be
// loadable from the files they already have (found by the full working-app test, 9 Nov 2026).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import * as XLSX from 'xlsx';
import { ChangeSet, db, setSession } from '../src/core/db';
import { handle } from '../src/core/engine';
import { commit, validate, hasErrors } from '../src/core/proposals';

const sheet = (name: string, rows: (string | number)[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], name);
};

beforeAll(async () => {
  setSession('t-new', 'owner-1');
  const cs = new ChangeSet();
  cs.put('settings', { firmName: 'New Agencies', gstin: '', address: 'Cuddalore', stateCode: '33', phone: '9800000001', modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true }, billFormat: 'A5', returnApprovalLimit: 2000, discountAlertPct: 5 });
  cs.put('staff', { id: 'owner-1', name: 'Owner', phone: '9800000001', role: 'owner', pin: '1111', active: true });
  await cs.commit('signup');
});

describe('a new distributor with no companies yet', () => {
  it('imports a product sheet and the companies in it are created', async () => {
    expect(await db.companies.count()).toBe(0);
    const file = sheet('products.xlsx', [
      ['Product', 'Company', 'Code', 'HSN', 'GST', 'MRP', 'Rate', 'Purchase', 'Case'],
      ['Surf Excel Easy Wash 1kg', 'Hindustan Unilever', '21834', '34022090', 18, 140, 112, 104, 12],
      ['Vim Bar 200g', 'Hindustan Unilever', '21330', '34022090', 18, 25, 20.5, 19, 60],
      ['Good Day Cashew 75g', 'Britannia Industries', 'GDC75', '19053100', 5, 20, 16.4, 15.2, 96],
    ]);
    const r = await handle('import products', [file]);
    expect(r.proposal?.kind).toBe('products');
    const v = await validate(r.proposal!);
    expect(hasErrors(v), JSON.stringify(v.errors)).toBe(false);
    await commit(r.proposal!);
    const cos = await db.companies.toArray();
    expect(cos.map(c => c.name).sort()).toEqual(['Britannia Industries', 'Hindustan Unilever']);
    const prods = await db.products.toArray();
    expect(prods).toHaveLength(3);
    const hul = cos.find(c => c.name === 'Hindustan Unilever')!;
    expect(prods.filter(p => p.companyId === hul.id)).toHaveLength(2);
  });
  it('a second sheet with the same company does not make it twice', async () => {
    const file = sheet('more.xlsx', [['Product', 'Company', 'HSN', 'GST', 'MRP', 'Rate'], ['Lifebuoy Soap 125g', 'HINDUSTAN UNILEVER', '34011190', 5, 38, 31]]);
    const r = await handle('import products', [file]);
    await commit(r.proposal!);
    expect(await db.companies.count()).toBe(2);
  });
  it.each(['import shops', 'shops', 'add these shops', 'upload retailers', 'shop list'])('"%s" with a shop sheet imports shops, not a purchase bill', async said => {
    const file = sheet('shops.xlsx', [['Shop', 'Owner', 'Mobile', 'Area', 'Beat'], ['Sri Murugan Stores', 'Murugan', '9443000001', 'Tittakudi', 'Monday']]);
    expect((await handle(said, [file])).proposal?.kind).toBe('shops');
  });
  it('the greeting is English only', async () => {
    const r = await handle('hello', []);
    expect(r.text).toMatch(/^Hello, Owner!/);
    expect(r.text).not.toMatch(/vanakkam/i);
  });
  it('a row with no company at all still asks for one', async () => {
    const file = sheet('nocompany.xlsx', [['Product', 'HSN', 'GST', 'MRP', 'Rate'], ['Mystery Item', '34011190', 5, 38, 31]]);
    const r = await handle('import products', [file]);
    expect(hasErrors(await validate(r.proposal!))).toBe(true);
  });
});
