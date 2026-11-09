// TESRAX at full distributor size: 2,000 products, 1,200 shops (names repeat across towns), 4 salesmen on beats.
// Measures, per kind of message: right / asked a question / WRONG, and time per message.
//   LIVE_DATA=… LIVE_OUT=… npx vitest run -c vitest.live.config.ts tests/live/tesrax-big.live.ts
import 'fake-indexeddb/auto';
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

const W = JSON.parse(readFileSync(process.env.LIVE_DATA + '/world.json', 'utf8'));
const OUT = process.env.LIVE_OUT ?? '/tmp';
const file = (n: string) => new File([readFileSync(`${process.env.LIVE_DATA}/${n}`)], n);

it('TESRAX at full size', async () => {
  const { ChangeSet, db, setSession } = await import('../../src/core/db');
  const { handle } = await import('../../src/core/converse');
  const { commit } = await import('../../src/core/proposals');
  setSession('big', 'owner');
  const cs = new ChangeSet();
  cs.put('settings', { firmName: W.firm.firmName, gstin: W.firm.gstin, address: 'Tittakudi', stateCode: '33', phone: W.firm.phone, modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true }, billFormat: 'A5', returnApprovalLimit: 2000, discountAlertPct: 5 });
  W.staff.forEach(([name, phone, role, pin]: string[], i: number) => cs.put('staff', { id: i ? `s${i}` : 'owner', name, phone, role, pin, active: true }));
  await cs.commit('setup');
  await commit((await handle('import products', [file('products.xlsx')])).proposal!);
  await commit((await handle('import shops', [file('shops.xlsx')])).proposal!);
  for (const s of W.stockFiles) await commit((await handle('add this to inventory', [file(s.file)])).proposal!);
  // beats as the owner set them: salesman k has areas 6k..6k+5, one per day
  const salesmen = W.staff.map((s: string[], i: number) => [s, i]).filter(([s]: [string[]]) => s[2] === 'salesman').map(([, i]: [string[], number]) => `s${i}`);
  const shopsDb = await db.shops.toArray();
  const byKey = new Map(shopsDb.map(s => [`${s.name}|${s.area}`, s]));
  const cs2 = new ChangeSet();
  for (const s of W.shops) { const x = byKey.get(`${s.name}|${s.area}`)!; cs2.put('shops', { ...x, salesmanId: salesmen[s.salesman] }, 'beat'); }
  await cs2.commit('beats');
  const prods = await db.products.toArray();
  const pByName = new Map(prods.map(p => [p.name, p]));
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];

  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const base = W.products.filter((p: { name: string }) => !/\(/.test(p.name)); // the regular packs
  const results: Record<string, { right: number; asked: number; wrong: number; ms: number[]; wrongs: string[] }> = {};
  const rec = (kind: string, outcome: 'right' | 'asked' | 'wrong', ms: number, said: string, got: string) => {
    const r = results[kind] ??= { right: 0, asked: 0, wrong: 0, ms: [], wrongs: [] };
    r[outcome]++; r.ms.push(ms); if (outcome === 'wrong' && r.wrongs.length < 8) r.wrongs.push(`"${said}" → ${got}`); if (outcome === 'asked' && kind.startsWith('A') && r.wrongs.length < 16) r.wrongs.push(`ASKED "${said}" → ${got}`);
  };
  const run = async (kind: string, said: string, check: (r: Awaited<ReturnType<typeof handle>>) => 'right' | 'asked' | 'wrong', who: string) => {
    setSession('big', who);
    const t = performance.now(); const r = await handle(said, []); const ms = performance.now() - t;
    const p = r.proposal; const got = p ? `${p.kind} shop=${shopsDb.find(s => s.id === p.fields.find(f => f.key === 'shopId')?.value)?.name ?? '?'} rows=${p.rows.map(x => prods.find(q => q.id === x.productId)?.name ?? '?').join('; ')}` : `text: ${r.text.slice(0, 80)}`;
    rec(kind, check(r), ms, said, got);
  };
  const shopOf = (r: Awaited<ReturnType<typeof handle>>) => String(r.proposal?.fields.find(f => f.key === 'shopId')?.value ?? '');
  const asked = (r: Awaited<ReturnType<typeof handle>>) => !r.proposal && (r.tone === 'warn' || !!r.pending || /which|did you mean|\?/i.test(r.text));

  for (let i = 0; i < 300; i++) {
    const k = Math.floor(rnd() * 4); const me = salesmen[k];
    const mine = W.shops.filter((s: { salesman: number; beat: string }) => s.salesman === k && s.beat === dayName);
    const s = pick(mine); const shop = byKey.get(`${s.name}|${s.area}`)!;
    const p1 = pick(base) as { name: string }, p2 = pick(base) as { name: string };
    const want = [pByName.get(p1.name)!.id, pByName.get(p2.name)!.id];
    // A) salesman, shop on his beat today, full product names
    await run('A. salesman: own shop + full product names', `${s.name.toLowerCase()} 2 case ${p1.name.toLowerCase()}, 6 pcs ${p2.name.toLowerCase()}`, r => {
      if (asked(r)) return 'asked';
      if (r.proposal?.kind !== 'order' || shopOf(r) !== shop.id) return 'wrong';
      const ids = r.proposal.rows.map(x => String(x.productId));
      if (want.every(w => ids.includes(w)) && ids.length === new Set(want).size) return 'right';
      return r.proposal.rows.some(x => x.productId === '' && / or /.test(String(x.said))) && ids.filter(Boolean).every(i => want.includes(i)) ? 'asked' : 'wrong';
    }, me);
    // B) owner, same message (no beat to narrow the shop)
    await run('B. owner: shop name only (names repeat across towns)', `${s.name.toLowerCase()} 1 case ${p1.name.toLowerCase()}`, r => {
      if (asked(r)) return 'asked';
      if (r.proposal?.kind !== 'order') return 'wrong';
      return shopOf(r) === shop.id ? 'right' : 'wrong';
    }, 'owner');
    // C) owner adds the town
    await run('C. owner: shop name + town', `${s.name.toLowerCase()} ${s.area.toLowerCase()} 1 case ${p1.name.toLowerCase()}`, r => {
      if (asked(r)) return 'asked';
      return r.proposal?.kind === 'order' && shopOf(r) === shop.id ? 'right' : 'wrong';
    }, 'owner');
    // D) short product name that fits several packs ("surf excel 1kg" → Easy Wash / Quick Wash / Matic …)
    const brand = p1.name.split(' ').slice(0, p1.name.startsWith('Surf') || p1.name.startsWith('Red') || p1.name.startsWith('Good') || p1.name.startsWith('Marie') ? 2 : 1).join(' ');
    const size = p1.name.split(' ').pop()!;
    const fits = prods.filter(p => p.name.toLowerCase().startsWith(brand.toLowerCase()) && p.name.toLowerCase().includes(` ${size.toLowerCase()}`));
    await run('D. salesman: short product name (several packs fit)', `${s.name.toLowerCase()} 1 case ${brand.toLowerCase()} ${size.toLowerCase()}`, r => {
      if (asked(r)) return 'asked';
      if (r.proposal?.kind !== 'order' || shopOf(r) !== shop.id) return 'wrong';
      const ids = r.proposal.rows.map(x => String(x.productId));
      // one pack fits → it must be that one; several fit → picking one silently is a guess (counted wrong unless the row is flagged)
      if (fits.length === 1) return ids[0] === fits[0].id ? 'right' : 'wrong';
      return ids.length === 1 && ids[0] === '' && / or /.test(String(r.proposal.rows[0].said)) ? 'asked' : 'wrong';
    }, me);
    // E) payment by a salesman for a shop on his beat
    await run('E. salesman: payment', `${s.name.toLowerCase()} paid ${500 + i * 10} cash`, r => {
      if (asked(r)) return 'asked';
      return r.proposal?.kind === 'payment' && shopOf(r) === shop.id && Number(r.proposal.fields.find(f => f.key === 'amount')?.value) === 500 + i * 10 ? 'right' : 'wrong';
    }, me);
  }
  const summary = Object.fromEntries(Object.entries(results).map(([k, v]) => {
    const ms = [...v.ms].sort((a, b) => a - b);
    return [k, { right: v.right, asked: v.asked, wrong: v.wrong, medianMs: Math.round(ms[Math.floor(ms.length / 2)]), p95Ms: Math.round(ms[Math.floor(ms.length * 0.95)]), wrongExamples: v.wrongs }];
  }));
  writeFileSync(`${OUT}/tesrax-big.json`, JSON.stringify(summary, null, 1));
}, 3600_000);
