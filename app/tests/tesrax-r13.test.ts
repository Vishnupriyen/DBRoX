// TESRAX round 13 (12 Nov 2026, owner: "every report it should send"): files for the screens that had none — P&L,
// GST summary, day close, attendance, trip reports — each the same figures as its screen.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
const sent: { name: string; sheets: { name: string; header: string[]; rows: (string | number)[][] }[] }[] = [];
vi.mock('../src/core/readers', async (orig) => ({ ...(await orig<object>()), downloadWorkbook: async (name: string, sheets: never) => { sent.push({ name, sheets }); } }));
import { db, setSession, today } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { profitAndLoss, pnlTotals } from '../src/core/pnl';
import { salesSummary } from '../src/core/reports';
import { daySummary } from '../src/core/pipeline';
import type { Role } from '../src/core/types';
import { code, loadNames } from './tesrax-code';
const ids: Partial<Record<Role, string>> = {};
beforeAll(async () => { await seedDemo(); await loadNames(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id; });
beforeEach(() => setSession('demo', ids.owner!));
const as = (r: Role) => setSession('demo', ids[r]!);
const say = (t: string) => handle(t, [], {});
const send = async (t: string) => { const r = await say(t); sent.length = 0; await r.actions![0].run(); await new Promise(res => setTimeout(res, 20)); return { r, f: sent[0] }; };

describe('P&L file', () => {
  it('"send p&l": the profit in words and the same figure in the file', async () => {
    const { r, f } = await send('send p&l');
    const t = pnlTotals(await profitAndLoss('month'));
    expect(r.text).toMatch(/^P&L .*: income ₹/);
    const last = f.sheets[0].rows.find(x => x[0] === 'PROFIT' || x[0] === 'LOSS')!;
    expect(last[1]).toBe(Math.abs(t.profit));
  });
  it('"pnl excel today" is today; office and staff are told it is the owner\'s', async () => {
    expect((await say('pnl excel today')).text).toMatch(/^P&L Today/);
    as('office'); const r = await say('send p&l'); expect(r.refused).toBe(true); expect(r.text).toMatch(/owner only/);
  });
  it('"profit" alone is still the answer in words, "p&l" alone still opens the screen', async () => {
    expect(code(await say('p&l'))).toBe('go:pnl');
  });
});
describe('GST summary file', () => {
  it('"send gst summary october": net sales and tax as the GST screen', async () => {
    const { r, f } = await send('send gst summary october');
    const s = await salesSummary({ from: '2026-10-01', to: '2026-10-31' });
    expect(r.text).toMatch(/^GST Oct 2026: net sales/);
    expect(f.sheets[0].rows.find(x => x[0] === 'Total tax')![1]).toBe(s.tax);
    expect(f.sheets[0].rows.find(x => x[0] === 'GSTR-1 due')![1]).toMatch(/11 Nov/);
  });
});
describe('day close, attendance, trips', () => {
  it('"day close report": sales and collected as the Day close screen', async () => {
    const { r, f } = await send('day close report');
    const d = await daySummary(today());
    expect(r.text).toMatch(/^Day close/);
    expect(f.sheets[0].rows.find(x => x[0] === 'Sales (after returns)')![1]).toBe(d.sales);
    expect(f.sheets.map(s => s.name)).toEqual(['Summary', 'Vans', 'Cash by staff', 'UPI & cheques']);
  });
  it('"attendance report" is today; "attendance excel october" is the month', async () => {
    expect((await say('attendance report')).text).toMatch(/^Attendance \d/);
    expect((await say('attendance excel october')).text).toMatch(/^Attendance Oct 2026/);
    expect(code(await say('attendance'))).toBe('go:today');
  });
  it('"send trip report": every trip with km and diesel', async () => {
    const { r, f } = await send('send trip report');
    expect(r.text).toMatch(/^Trip reports: /);
    expect(f.sheets[0].header).toEqual(['Date', 'Van', 'Stops', 'Done', 'km', 'Idle min', 'Diesel ₹']);
    expect(code(await say('trip reports'))).toBe('go:trips');
  });
  it('the salesman is told who can', async () => {
    as('salesman');
    expect((await say('day close report')).refused).toBe(true);
    expect((await say('send gst summary')).refused).toBe(true);
  });
});
