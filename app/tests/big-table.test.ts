// A long table (a 500-line purchase bill, 2,000 products to choose from) must not build a product list in every row:
// that made ~1 million screen elements and crashed the phone (found by the full working-app test, 9 Nov 2026).
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ApproveTable } from '../src/ui/ApproveTable';
import type { Proposal } from '../src/core/proposals';

describe('approval table with many rows and a long product list', () => {
  it('renders each row with only its chosen option until the cell is opened', () => {
    const options = Array.from({ length: 2000 }, (_, i) => ({ value: `p${i}`, label: `Product ${i}` }));
    const proposal: Proposal = {
      id: 'x', kind: 'purchase', title: 'Purchase', fields: [], meta: {},
      columns: [{ key: 'productId', label: 'Product', type: 'select', options, width: 160 }, { key: 'qty', label: 'Qty', type: 'number', width: 60 }],
      rows: Array.from({ length: 500 }, (_, i) => ({ productId: `p${i}`, qty: 12 })),
    };
    const t0 = Date.now();
    const html = renderToString(createElement(ApproveTable, { proposal, onDone: () => {} }));
    const optionCount = (html.match(/<option/g) ?? []).length;
    expect(optionCount).toBeLessThanOrEqual(500 * 2); // the chosen one (and a blank) per row, not 2,000
    expect(html).toContain('Product 499'); // every row still shows its product
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('a short list (a few companies) is still a plain full list', () => {
    const options = [{ value: 'a', label: 'HUL' }, { value: 'b', label: 'ITC' }];
    const proposal: Proposal = { id: 'y', kind: 'products', title: 'P', fields: [], meta: {}, columns: [{ key: 'companyId', label: 'Company', type: 'select', options }], rows: [{ companyId: 'a' }] };
    const html = renderToString(createElement(ApproveTable, { proposal, onDone: () => {} }));
    expect((html.match(/<option/g) ?? []).length).toBe(2);
  });
});
