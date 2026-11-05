// Files recreated in real Indian bank / bill layouts (from public parser code and common formats).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { readSheet, readBankRows, readPurchaseRows, readBillHeader } from '../src/core/readers';

const file = (n: string) => new File([readFileSync(new URL(`./samples/${n}`, import.meta.url))], n);

describe('bank statements in real layouts', () => {
  const cases: [string, number, number][] = [
    ['sbi_2026.xlsx', 3, 5000], ['canara_2026.csv', 2, 5000], ['hdfc.xlsx', 2, 5000],
    ['icici.xlsx', 2, 5000], ['kvb.xlsx', 1, 5000], ['axis.xlsx', 1, 5000],
  ];
  for (const [name, count, firstCredit] of cases) {
    it(name, async () => {
      const rows = readBankRows(await readSheet(file(name)));
      expect(rows, 'header not found').not.toBeNull();
      expect(rows!.length).toBe(count);
      expect(rows![0].credit).toBe(firstCredit);
      expect(rows![0].date).toBe('2026-11-03');
      expect(rows![0].narration).toMatch(/LAKSHMI/);
      expect(rows![0].narration).not.toMatch(/\n/);
    });
  }
  it('SBI debit line read', async () => {
    const rows = readBankRows(await readSheet(file('sbi_2026.xlsx')))!;
    expect(rows[2]).toMatchObject({ debit: 2000, credit: 0 });
  });
});

describe('purchase bill with month-year expiry and 96+4 quantity', () => {
  it('reads lines', async () => {
    const sheet = await readSheet(file('purchase_mmyy.xlsx'));
    const rows = readPurchaseRows(sheet)!;
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ hsn: '19053100', batch: 'GD2611', expiry: '2027-09-30', qty: 96, free: 4, rate: 15.2 });
    expect(rows[1].expiry).toBe('2027-09-30');
    expect(rows[2].expiry).toBe('2027-03-31');
    expect(readBillHeader(sheet)).toMatchObject({ billNo: 'BRT/2611/0042', date: '2026-11-03', gstin: '33AAACB2894G1Z9', total: 3403.2 });
  });
});
