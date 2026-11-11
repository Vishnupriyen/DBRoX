// Final pre-pilot round A (11 Nov 2026): the server holds the app's order / bill-line / cheque-date rules too.
import { describe, it, expect } from 'vitest';
import { badLines } from '../src/rules.js';

describe('order and bill lines', () => {
  it('an order line is whole pieces, more than 0, at a rate more than 0', () => {
    expect(badLines('orders', { lines: [{ qty: 2, rate: 112 }] })).toBeNull();
    expect(badLines('orders', { lines: [{ qty: 2.5, rate: 112 }] })).toMatch(/whole/);
    expect(badLines('orders', { lines: [{ qty: 0, rate: 112 }] })).toMatch(/whole/);
    expect(badLines('orders', { lines: [{ qty: 3, rate: 0 }] })).toMatch(/rate/);
    expect(badLines('orders', { lines: [{ qty: 3, rate: -5 }] })).toMatch(/rate/);
    expect(badLines('orders', { lines: [{ qty: 3 }] })).toMatch(/rate/);
  });
  it('a bill line with pieces has a rate; a line of only free pieces may have qty 0', () => {
    expect(badLines('invoices', { lines: [{ qty: 3, rate: 10 }, { qty: 0, rate: 10 }] })).toBeNull();
    expect(badLines('invoices', { lines: [{ qty: 3, rate: 0 }] })).toMatch(/rate/);
    expect(badLines('invoices', { lines: [{ qty: -1, rate: 10 }] })).toMatch(/whole/);
    expect(badLines('invoices', { lines: [{ qty: 1.5, rate: 10 }] })).toMatch(/whole/);
  });
});

describe('cheque date', () => {
  it('is a real day when sent', () => {
    expect(badLines('payments', { amount: 5 })).toBeNull();
    expect(badLines('payments', { chequeDate: '2026-11-30' })).toBeNull();
    expect(badLines('payments', { chequeDate: '30 nov' })).toMatch(/date/);
    expect(badLines('payments', { chequeDate: '2026-13-01' })).toMatch(/date/);
  });
});
