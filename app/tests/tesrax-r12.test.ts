// TESRAX round 12 (12 Nov 2026, owner: "every report it should send"): the salary sheet and any bill by voice.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
const sent: string[] = [];
vi.mock('../src/core/readers', async (orig) => ({ ...(await orig<object>()), downloadSheet: async (name: string) => { sent.push(name); } }));
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import type { Role } from '../src/core/types';
import { code, loadNames } from './tesrax-code';
const ids: Partial<Record<Role, string>> = {};
const events: string[] = [];
beforeAll(async () => {
  await seedDemo(); await loadNames(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id;
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
  window.addEventListener('hanubix:print-bill', e => events.push((e as CustomEvent).detail.invoiceId));
});
beforeEach(() => setSession('demo', ids.owner!));
const as = (r: Role) => setSession('demo', ids[r]!);
const say = (t: string) => handle(t, [], {});

describe('salary sheet by voice', () => {
  it('"send salary sheet" (owner): net in words, Send salary sheet (Excel)', async () => {
    const r = await say('send salary sheet october');
    expect(r.text).toMatch(/^Salary sheet Oct 2026: .*net to pay ₹/);
    sent.length = 0; await r.actions![0].run(); expect(sent[0]).toBe('salary-2026-10');
  });
  it('"salary sheet excel", "payroll excel" are the file; "salary sheet" alone opens the screen', async () => {
    expect((await say('salary sheet excel')).actions?.[0].label).toBe('Send salary sheet (Excel)');
    expect((await say('payroll excel')).actions?.[0].label).toBe('Send salary sheet (Excel)');
    expect(code(await say('salary sheet'))).toBe('go:salary');
  });
  it('office and staff are told the owner does it', async () => {
    as('office'); expect((await say('send salary sheet')).refused).toBe(true);
    as('salesman'); expect((await say('send salary sheet')).refused).toBe(true);
  });
});
describe('any bill by voice', () => {
  it('"send bill SMD/26-27/00005" finds that bill and opens it to print / PDF', async () => {
    const inv = (await db.invoices.toArray()).find(i => !i.cancelled)!;
    const r = await say(`send bill ${inv.number}`);
    expect(r.text).toMatch(new RegExp(`^Bill ${inv.number.replace(/\//g, '\\/')}`));
    events.length = 0; await r.actions![0].run(); expect(events).toEqual([inv.id]);
  });
  it('"print bill 5" by the number alone; "print <shop> last bill"', async () => {
    const inv = (await db.invoices.toArray()).filter(i => !i.cancelled).sort((a, b) => b.date.localeCompare(a.date))[0];
    const n = Number(inv.number.match(/(\d+)$/)![1]);
    expect((await say(`print bill ${n}`)).text).toMatch(/^Bill /);
    const shop = (await db.shops.get(inv.shopId))!;
    const r = await say(`print ${shop.name} last bill`);
    expect(r.text).toMatch(new RegExp(shop.name));
  });
  it('a bill that does not exist is said plainly; godown is refused', async () => {
    expect((await say('send bill 99999')).text).toMatch(/couldn't find bill number 99999/);
    as('godown');
    const inv = (await db.invoices.toArray())[0];
    expect((await say(`send bill ${inv.number}`)).refused).toBe(true);
  });
  it('"show bills" still opens Bills; "cancel bill" is not a print', async () => {
    expect(code(await say('show bills'))).toBe('go:billed');
    const inv = (await db.invoices.toArray()).find(i => !i.cancelled)!;
    expect((await say(`cancel bill ${inv.number}`)).actions?.[0]?.label ?? '').not.toMatch(/print/);
  });
});
