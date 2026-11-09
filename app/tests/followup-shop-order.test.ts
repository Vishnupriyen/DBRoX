// "Selvam Kirana paid 500" » "not Selvam Kirana, Pennadam Wholesale Agency" — the corrected shop starts with the
// first shop's town. Taking out "Selvam Kirana, Pennadam" (shop + town) ate the next shop's first word, so TESRAX
// said "I didn't understand". It failed only when Selvam's random id sorted first (million re-run, 10 Nov 2026).
import 'fake-indexeddb/auto';
import { it, expect, beforeAll } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { code, converse, loadNames } from './tesrax-code';

beforeAll(async () => {
  await seedDemo();
  // put Pennadam Wholesale Agency last in the table so Selvam Kirana is always read first
  const pwa = (await db.shops.toArray()).find(s => s.name === 'Pennadam Wholesale Agency')!;
  await db.shops.delete(pwa.id); await db.shops.put({ ...pwa, id: 'zzzzzzzz-last' });
  await loadNames();
  setSession('demo', (await db.staff.toArray()).find(s => s.role === 'owner')!.id);
});
const talk = (...m: string[]) => converse(m, (s, last) => handle(s, [], { last }));

it.each([
  ['Selvam Kirana paid 500', 'not Selvam Kirana, Pennadam Wholesale Agency', 'payment:Pennadam Wholesale Agency:500:cash'],
  ['lakshmi paid 500', 'not sri lakshmi traders, pennadam wholesale agency', 'payment:Pennadam Wholesale Agency:500:cash'],
  ['selvam paid 12500', 'not Selvam Kirana, pennadam wholesale', 'payment:Pennadam Wholesale Agency:12500:cash'],
])('%s » %s', async (a, b, want) => expect(code(await talk(a, b))).toBe(want));
