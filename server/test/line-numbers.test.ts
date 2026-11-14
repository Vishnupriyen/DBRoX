// Part 2 step 2a0: order line numbers are stable ids. An old phone that sends an order without them never wipes the
// numbers the server already holds (same products in the same order); a real change of lines takes the phone's copy.
import { describe, it, expect } from 'vitest';
import { keepLineNumbers } from '../src/rules.js';

const stored = { id: 'o1', lines: [{ productId: 'a', qty: 5, rate: 10, line: 1 }, { productId: 'b', qty: 2, rate: 20, line: 3 }], picked: [{ productId: 'a', qty: 5, line: 1 }] };
describe('order line numbers (server keeps them)', () => {
  it('an incoming order without line numbers, same products: the stored numbers stay (qty/rate are the phone\'s)', () => {
    const out = keepLineNumbers({ id: 'o1', lines: [{ productId: 'a', qty: 6, rate: 10 }, { productId: 'b', qty: 2, rate: 20 }], picked: [{ productId: 'a', qty: 6 }] }, stored);
    expect((out.lines as { line?: number; qty: number }[]).map(l => [l.line, l.qty])).toEqual([[1, 6], [3, 2]]);
    expect((out.picked as { line?: number }[])[0].line).toBe(1);
  });
  it('a different product list or numbers already sent: the phone\'s copy as it is', () => {
    const other = { id: 'o1', lines: [{ productId: 'b', qty: 2, rate: 20 }] };
    expect(keepLineNumbers(other, stored)).toEqual(other);
    const numbered = { id: 'o1', lines: [{ productId: 'a', qty: 5, rate: 10, line: 7 }, { productId: 'b', qty: 2, rate: 20, line: 8 }] };
    expect(keepLineNumbers(numbered, stored)).toEqual(numbered);
    expect(keepLineNumbers(other, undefined)).toEqual(other);
  });
});
