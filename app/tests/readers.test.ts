import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { readPurchaseRows, readBankRows } from '../src/core/readers';

const load = (f: string) => {
  const wb = XLSX.read(readFileSync(new URL(f, import.meta.url)), { type: 'buffer' });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }).map(r => r.map(c => String(c)));
};

describe('readers', () => {
  it('reads every line of a purchase bill', () => {
    const rows = readPurchaseRows(load('./hul_purchase.xlsx'))!;
    expect(rows.map(r => r.item)).toEqual(['SURF EXCEL EASY WASH 1KG', 'LIFEBUOY TOTAL 125G', 'PEARS SOAP 75G']);
    expect(rows[0]).toMatchObject({ code: '21834', batch: 'SE2611', expiry: '2027-06-30', qty: 120, rate: 104, discount: 624, gst: 18, amount: 11856 });
    expect(rows[1].free).toBe(12);
  });
  it('reads a bank statement', () => {
    const rows = readBankRows(load('./sbi_statement.xlsx'))!;
    expect(rows.length).toBe(4);
    expect(rows[0].credit).toBe(5000);
    expect(rows[3].debit).toBe(2000);
  });
});

import { readBillHeader } from '../src/core/readers';
import { findShopInText, parseItemLines } from '../src/core/match';
describe('understanding', () => {
  it('reads bill header', () => {
    expect(readBillHeader(load('./hul_purchase.xlsx'))).toMatchObject({ billNo: 'HUL/889921', total: 26054.4 });
  });
  it('splits shop and items', () => {
    const shops = [{ name: 'Murugan Stores', aliases: [] }, { name: 'Selvam Kirana', aliases: [] }] as never[];
    const r = findShopInText(shops, 'Murugan Stores 1 case surf, 24 good day, 10 lifebuoy');
    expect((r.shop as { name: string }).name).toBe('Murugan Stores');
    expect(parseItemLines(r.rest).map(l => [l.qty, l.unit, l.productText])).toEqual([[1, 'case', 'surf'], [24, 'pcs', 'good day'], [10, 'pcs', 'lifebuoy']]);
    const s = findShopInText(shops, 'selvam return 2 lifebuoy');
    expect((s.shop as { name: string }).name).toBe('Selvam Kirana');
    expect(parseItemLines(s.rest.replace(/return/i, ''))[0]).toMatchObject({ qty: 2, productText: 'lifebuoy' });
  });
});
