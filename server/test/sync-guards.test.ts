import { describe, expect, it } from 'vitest';
import { driverTripWrite, driverInvoiceWrite, driverPaymentWrite } from '../src/sync-guards.js';

const at = '2026-11-11T10:00:00.000Z';
const later = '2026-11-11T10:05:00.000Z';
const base = { id: 't1', tenantId: 'tenant', vanId: 'v1', driverId: 'd1', date: '2026-11-11',
  status: 'loaded', stops: ['s1'], track: [] };

describe('driver sync permission guards', () => {
  it('rejects a new or another driver trip, and prevents assignment/route tampering', () => {
    const started = { ...base, status: 'out', startedAt: at };
    expect(driverTripWrite('d1', started)).toMatch(/create/);
    expect(driverTripWrite('d2', started, base)).toMatch(/another driver/);
    expect(driverTripWrite('d1', { ...started, driverId: 'd2' }, base)).toMatch(/another driver/);
    expect(driverTripWrite('d1', { ...started, stops: ['s2'] }, base)).toMatch(/plan/);
    expect(driverTripWrite('d1', { ...started, vanId: 'v2' }, base)).toMatch(/plan/);
    expect(driverTripWrite('d1', started, base)).toBeNull();
  });
  it('permits an offline loaded→out→done upload and forbids impossible transitions', () => {
    const completed = { ...base, status: 'done', startedAt: at, endedAt: later };
    expect(driverTripWrite('d1', completed, base)).toBeNull();
    expect(driverTripWrite('d1', { ...completed, endedAt: '2026-11-11T09:00:00.000Z' }, base)).toMatch(/end/);
    expect(driverTripWrite('d1', { ...completed, startedAt: 'now' }, base)).toMatch(/timestamp/);
    expect(driverTripWrite('d1', completed, { ...base, status: 'planned' })).not.toBeNull();
    expect(driverTripWrite('d1', completed, { ...base, status: 'done' })).not.toBeNull();
  });
  it('requires assigned started trip and immutable financial lines for delivery', () => {
    const line = { productId: 'p1', qty: 2, rate: 100, total: 200, batches: [{ batchId: 'b1', qty: 2 }] };
    const invoice = { id: 'i1', tenantId: 'tenant', tripId: 't1', number: 'A1', total: 200,
      taxable: 200, lines: [line], deliveryStatus: 'planned' };
    const delivered = { ...invoice, deliveryStatus: 'delivered',
      delivery: { at, by: 'd1', shortages: [] } };
    const trip = { ...base, status: 'out' };
    expect(driverInvoiceWrite('d1', delivered, invoice, trip)).toBeNull();
    expect(driverInvoiceWrite('d1', delivered, invoice, base)).toMatch(/started/);
    expect(driverInvoiceWrite('d1', delivered, invoice, base, true)).toBeNull();
    expect(driverInvoiceWrite('d1', { ...delivered, total: 1 }, invoice, trip)).toMatch(/billing/);
    expect(driverInvoiceWrite('d1', { ...delivered, lines: [{ ...line, rate: 1 }] }, invoice, trip)).toMatch(/Financial/);
    expect(driverInvoiceWrite('d2', delivered, invoice, trip)).toMatch(/assigned/);
  });
  it('blocks unauthorized settlement and edits to collected payment amounts', () => {
    const pay = { id: 'p1', tenantId: 'tenant', collectedBy: 'd1', amount: 100, mode: 'cash',
      allocations: [], advance: 100, date: '2026-11-11', status: 'ok', settled: false };
    expect(driverPaymentWrite('d1', pay)).toBeNull();
    expect(driverPaymentWrite('d2', pay)).toMatch(/another/);
    expect(driverPaymentWrite('d1', { ...pay, settled: true }, pay)).toMatch(/settle/);
    expect(driverPaymentWrite('d1', { ...pay, amount: 200 }, pay)).toMatch(/financial/);
    expect(driverPaymentWrite('d1', pay, { ...pay, settled: true })).toMatch(/finalized/);
  });
});
