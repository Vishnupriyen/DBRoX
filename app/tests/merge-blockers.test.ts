import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ChangeSet, db, setSession, undoBatch } from '../src/core/db';
import { startTrip } from '../src/core/pipeline';
import { mayOfferUndo } from '../src/ui/UndoToast';

describe('offline delivery merge blockers', () => {
  it('cannot start an unassigned or another driver trip locally', async () => {
    setSession('security-tenant', 'driver-one');
    const trip = { id: 'security-trip', tenantId: 'security-tenant',
      driverId: 'driver-two', vanId: 'van-one', date: '2026-11-11',
      status: 'loaded', stops: [], track: [], updatedAt: '2026-11-11T10:00:00.000Z' };
    await db.trips.put(trip as never);
    await expect(startTrip(trip.id)).rejects.toThrow(/assigned to you/);
    expect((await db.trips.get(trip.id))?.status).toBe('loaded');
    await db.trips.put({ ...trip, driverId: undefined } as never);
    await expect(startTrip(trip.id)).rejects.toThrow(/assigned to you/);
    await db.trips.put({ ...trip, driverId: 'driver-one' } as never);
    await startTrip(trip.id);
    expect((await db.trips.get(trip.id))?.status).toBe('out');
  });

  it('blocks undo for trip transitions and financial or delivery records at UI and core levels', async () => {
    expect(mayOfferUndo(['trips'], 'Trip started')).toBe(false);
    expect(mayOfferUndo(['payments'], 'Payment received')).toBe(false);
    expect(mayOfferUndo(['invoices'], 'Delivered')).toBe(false);
    expect(mayOfferUndo(['shops'], 'Shop name changed')).toBe(true);
    const tripAudit = (await db.audit.toArray()).find(a => a.recordId === 'security-trip');
    expect(tripAudit).toBeDefined();
    expect(await undoBatch(tripAudit!.batchId)).toBe(-1);
    expect((await db.trips.get('security-trip'))?.status).toBe('out');

    const cs = new ChangeSet();
    cs.put('payments', { shopId: 'shop-one', amount: 100, mode: 'cash',
      collectedBy: 'driver-one', allocations: [], advance: 100, date: '2026-11-11',
      shopConfirmed: false, status: 'ok', settled: false });
    const batch = await cs.commit('Payment received');
    expect(await undoBatch(batch)).toBe(-1);
  });
});
