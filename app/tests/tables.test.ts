import { describe, it, expect } from 'vitest';
import shared from '../../shared/tables.json';
import type { TableName } from '../src/core/types';

// The phone's table union and the shared list must match exactly; the server reads the same file.
const PHONE: TableName[] = ['settings', 'staff', 'companies', 'products', 'shops', 'batches', 'schemes', 'orders', 'invoices', 'creditNotes', 'payments', 'purchases', 'expenses', 'bankLines', 'claimEntries', 'claims', 'vans', 'audit', 'visits', 'targets', 'trips', 'dayCloses', 'dayPlans', 'liteEntries', 'checkIns', 'leaves', 'advances',
  'territories', 'dbLinks', 'secondary', 'secondaryReturns', 'dbStock', 'primaryInvoices', 'inbound', 'grns', 'primaryOrders', 'dbClaims', 'claimDecisions', 'shopRequests', 'workDays', 'travelClaims', 'receipts', 'tesraxDays', 'openingDues', 'requests', 'stockMoves'];
describe('shared table definition', () => {
  it('lists every phone table once', () => { expect([...shared.tables].sort()).toEqual([...PHONE].sort()); });
  it('every role list names real tables', () => {
    for (const m of [shared.read, shared.write]) for (const v of Object.values(m)) if (v !== '*') for (const t of v) expect(shared.tables).toContain(t);
  });
});
