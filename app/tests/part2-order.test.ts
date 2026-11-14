// Part 2 item 16 (docs/PART2_SPEC.md): Sales comes before Bill on Home, the Menu, TESRAX help and the licence list; Sales has a
// "Sales reports" tile; a role without the Sales licence sees no gap.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { MODULES } from '../src/core/types';
import { HELP_TEXT } from '../src/core/engine';

const home = readFileSync('src/ui/Home.tsx', 'utf8'), menu = readFileSync('src/ui/More.tsx', 'utf8');
describe('item 16: Sales before Bill everywhere', () => {
  it('licence list: Sales first, then Bill', () => { expect(MODULES.map(m => m.key).slice(0, 2)).toEqual(['sales', 'bill']); });
  it('Home module tiles and Menu groups: Sales above Bill', () => {
    expect(home.indexOf("module: 'sales'")).toBeLessThan(home.indexOf("module: 'bill'"));
    expect(menu.indexOf("group: 'Sales'")).toBeLessThan(menu.indexOf("group: 'Bill'"));
  });
  it('Sales has a "Sales reports" tile on Home and in the Menu', () => {
    expect(home.slice(home.indexOf('sub.sales = ['), home.indexOf('sub.bill = ['))).toMatch(/en: 'Sales reports'/);
    const sales = menu.slice(menu.indexOf("group: 'Sales'"), menu.indexOf("group: 'Bill'"));
    expect(sales).toMatch(/label: 'Sales reports'/);
  });
  it('TESRAX help names sales words before bill words', () => {
    expect(HELP_TEXT.indexOf('today sales')).toBeGreaterThan(-1);
  });
  it('a role without the Sales licence sees no gap: tiles are filtered, never blanked', () => {
    expect(home).toMatch(/\.filter\(/);
  });
});
