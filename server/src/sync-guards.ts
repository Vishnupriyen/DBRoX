// Server-side authorization of driver sync writes. Never trust an offline phone's
// cached trip assignment or financial/payment approval flags.
type Doc = Record<string, unknown>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const iso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(v) && Number.isFinite(Date.parse(v));
const unchanged = (next: Doc, prev: Doc, keys: string[]) => keys.every(k => same(next[k], prev[k]));

// A driver must not create or allocate a trip. The owner/office creates the plan
// and godown marks it loaded. A phone can upload a whole offline start/end sequence
// as one final "done" snapshot, but must provide valid ordered timestamps.
export function driverTripWrite(userId: string, next: Doc, prev?: Doc): string | null {
  if (!prev) return 'Only office may create and assign a trip';
  if (prev.driverId !== userId || next.driverId !== userId) return 'Trip belongs to another driver';
  if (!unchanged(next, prev, ['vanId', 'driverId', 'date', 'stops', 'tenantId', 'id'])) return 'Trip assignment or plan cannot be changed by driver';
  const from = prev.status, to = next.status;
  if (from === 'loaded' && (to === 'out' || to === 'done')) {
    if (!iso(next.startedAt)) return 'Trip start timestamp is required';
    if (to === 'done' && (!iso(next.endedAt) || Date.parse(String(next.endedAt)) < Date.parse(String(next.startedAt)))) return 'Trip end must follow start';
    return null;
  }
  if (from === 'out' && (to === 'out' || to === 'done')) {
    if (!same(next.startedAt, prev.startedAt)) return 'Trip start cannot be changed';
    if (to === 'done' && (!iso(next.endedAt) || Date.parse(String(next.endedAt)) < Date.parse(String(next.startedAt)))) return 'Invalid trip end';
    if (to === 'out' && !same(next.endedAt, prev.endedAt)) return 'Trip end cannot be changed';
    return null;
  }
  return 'Trip transition is not permitted';
}

export function driverInvoiceWrite(userId: string, next: Doc, prev: Doc | undefined, trip: Doc | undefined): string | null {
  if (!prev) return 'Driver cannot create invoices';
  if (!trip || trip.driverId !== userId || trip.id !== prev.tripId) return 'Invoice is not on an assigned trip';
  if (!unchanged(next, prev, [
    'id', 'tenantId', 'number', 'companyId', 'shopId', 'orderId', 'date', 'kind',
    'taxable', 'cgst', 'sgst', 'igst', 'roundOff', 'total', 'schemeSaving',
    'vanId', 'tripId', 'stopNo', 'cancelled', 'diffAction', 'original'
  ])) return 'Driver cannot alter billing or trip allocation';
  if (next.deliveryStatus === 'out' && prev.deliveryStatus === 'planned') {
    if (!same(next.lines, prev.lines) || !same(next.delivery, prev.delivery)) return 'Cannot change bill while starting trip';
    return null;
  }
  if (!['delivered', 'partial', 'returned'].includes(String(next.deliveryStatus)) ||
      !['planned', 'out'].includes(String(prev.deliveryStatus))) return 'Invalid delivery transition';
  const proof = next.delivery as Doc | undefined;
  if (!proof || proof.by !== userId || !iso(proof.at)) return 'Delivery proof must identify the driver and time';
  const oldLines = prev.lines as Doc[] | undefined;
  const newLines = next.lines as Doc[] | undefined;
  if (!Array.isArray(oldLines) || !Array.isArray(newLines) || oldLines.length !== newLines.length) return 'Invoice lines cannot be replaced';
  // Delivery may update batch allocations for shortages/excess, never prices or billed quantities.
  for (let i = 0; i < oldLines.length; i++) {
    const { batches: _old, ...oldRest } = oldLines[i];
    const { batches: _new, ...newRest } = newLines[i];
    if (!same(oldRest, newRest)) return 'Financial invoice lines are immutable';
  }
  return null;
}

export function driverPaymentWrite(userId: string, next: Doc, prev?: Doc): string | null {
  if (next.collectedBy !== userId) return 'Cannot record another staff member’s collection';
  if (next.settled || next.status === 'cancelled' || next.status === 'bounced') return 'Only office may settle or reverse collections';
  if (prev) {
    if (prev.collectedBy !== userId || prev.settled || prev.status === 'cancelled' || prev.status === 'bounced') return 'Collection already finalized';
    if (!unchanged(next, prev, ['shopId', 'amount', 'mode', 'date', 'allocations', 'advance', 'collectedBy', 'tenantId', 'id'])) return 'Collection financial fields cannot change';
  }
  return null;
}
