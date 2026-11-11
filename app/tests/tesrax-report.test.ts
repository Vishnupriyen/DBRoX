// The TESRAX report (11 Nov 2026): every message is counted on the phone it was said on — speed, understood or not,
// and whether the table TESRAX prepared was approved as is. These numbers are the proof behind the TESRAX claim,
// so a miss must be counted as a miss, never as an answer.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { setSession, db, today } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { handleCompany } from '../src/core/companyEngine';
import { noteMessage, noteOutcome, resultOf, tesraxReport } from '../src/core/tesraxReport';

let owner = '';
beforeAll(async () => {
  await seedDemo();
  owner = (await db.staff.toArray()).find(s => s.role === 'owner')!.id;
  setSession('demo', owner);
});

describe('what TESRAX did with a message', () => {
  it('nonsense is a miss, with a short reply (not the whole help)', async () => {
    const r = await handle('zzqx blorf wibble', []);
    expect(resultOf(r)).toBe('missed');
    expect(r.text.length).toBeLessThan(200);
  });
  it('the company side marks its misses too, and no longer dumps the whole help', async () => {
    for (const role of ['rep', 'cadmin'] as const) {
      const r = await handleCompany('zzqx blorf wibble', role);
      expect(resultOf(r)).toBe('missed');
      expect(r.text.length).toBeLessThan(200);
    }
  });
  it('an order is a table to approve; a question is an answer; a failure is a miss', async () => {
    const shop = (await db.shops.toArray())[0], p = (await db.products.toArray())[0];
    expect(resultOf(await handle(`${shop.name} 2 ${p.name}`, []))).toBe('done');
    expect(resultOf(await handle('who owes more than 5000', []))).toBe('answer');
    expect(resultOf(null)).toBe('missed');
  });
});

describe('the report', () => {
  it('counts messages, speed, misses and outcomes on one record per staff per day', async () => {
    const day = await noteMessage('owner', 'diesel 1500', { text: 'x', proposal: {} as never }, 40);
    await noteOutcome(day, 'owner', 'approved');
    await noteMessage('owner', 'Murugan 2 surf', { text: 'x', proposal: {} as never }, 60);
    await noteOutcome(day, 'owner', 'edited');
    await noteMessage('owner', 'zzqx', { text: 'x', missed: true }, 20);
    await noteMessage('owner', 'P&L', { text: 'x' }, 80);
    const recs = await db.tesraxDays.toArray();
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toMatch(new RegExp(`^${owner}\\|${today()}\\|.+`)); // one record per staff per day per phone (11 Nov 2026)
    const r = await tesraxReport(today());
    expect(r.messages).toBe(4);
    expect(r.missed).toBe(1);
    expect(r.understood).toBe(75);
    expect(r.avgMs).toBe(50);
    expect(r.maxMs).toBe(80);
    expect([r.done, r.approved, r.edited, r.cancelled]).toEqual([2, 1, 1, 0]);
    expect(r.misses.map(m => m.said)).toEqual(['zzqx']);
    expect(r.staff).toEqual([{ staffId: owner, role: 'owner', messages: 4, understood: 75, avgMs: 50 }]);
  });
  it('a count is not an action: nothing to undo, no history entry', async () => {
    const before = await db.audit.count();
    await noteMessage('owner', 'today sales', { text: 'x' }, 5);
    expect(await db.audit.count()).toBe(before);
  });
  it('keeps only the last 20 misses per day', async () => {
    for (let i = 0; i < 25; i++) await noteMessage('owner', `miss ${i}`, { text: 'x', missed: true }, 1);
    const d = (await db.tesraxDays.toArray())[0];
    expect(d.misses).toHaveLength(20);
    expect(d.misses.at(-1)).toBe('miss 24');
  });
});
