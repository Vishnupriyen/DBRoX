// Demo company (an invented brand) linked to the demo distributor, so the company side can be tried on one phone.
// Everything crosses through the same relay rules as the real server (core/link.ts → shared/relay.ts).
import { ChangeSet, daysFrom, db, onSide, setSession, today } from './db';
import { seedDemo } from './seed';
import { acceptInvite, storeOf } from './link';
import { makeInvoices } from './billing';
import type { DbLink, Order, PrimaryInvoice, Product, Settings, Staff } from './types';

const SEED = 'c1';
export async function seedCompanyDemo() {
  const co = storeOf('company'), dist = storeOf('distributor');
  // the distributor side first (its own demo)
  await onSide(dist, () => seedDemo().then(() => undefined));
  if (await co.settings.count()) {
    // the distributor demo was reset since: the old link points nowhere, so start the company demo again too
    if ((await dist.companies.toArray()).some(c => c.link?.status === 'linked')) return;
    await co.delete(); await co.open();
  }
  try { localStorage.setItem('hanubix.cseed', SEED); } catch { /* private window */ }
  await onSide(co, async () => {
    setSession('demo-company', 'system');
    const cs = new ChangeSet();
    cs.put<Settings>('settings', {
      firmName: 'Kaveri Consumer Products (Demo)', gstin: '33AAICK4821M1Z3', address: 'SIPCOT Industrial Park, Cuddalore 607005', stateCode: '33', phone: '9100000000',
      modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true },
      billFormat: 'A4', returnApprovalLimit: 0, discountAlertPct: 5, kind: 'company', checkInBy: '09:30',
    });
    const st = (name: string, phone: string, role: Staff['role'], pin: string, extra: Partial<Staff> = {}) => cs.put<Staff>('staff', { name, phone, role, pin, active: true, ...extra });
    st('Lakshmi (Head office)', '9100000001', 'cadmin', '1111');
    const asm = st('Senthil (ASM)', '9100000002', 'manager', '2222', { level: 'ASM', hq: 'Cuddalore' });
    const so = st('Divya (SO)', '9100000003', 'manager', '3333', { level: 'SO', managerId: asm.id, hq: 'Tittakudi' });
    const arun = st('Arun (Rep)', '9100000004', 'rep', '4444', { managerId: so.id, hq: 'Tittakudi', grade: 'G1' });
    const meena = st('Meena (Rep)', '9100000005', 'rep', '5555', { managerId: so.id, hq: 'Pennadam', grade: 'G1' });
    const p = (name: string, code: string, hsn: string, gst: number, mrp: number, rate: number, caseSize: number, aliases: string[], focus = false) =>
      cs.put<Product>('products', { companyId: 'own', name, code, hsn, gst, mrp, rate, purchaseRate: Math.round(rate * 0.9 * 100) / 100, caseSize, aliases, focus, active: true });
    const P = [
      p('Kaveri Coconut Oil 500ml', 'KV101', '15131900', 5, 120, 102, 24, ['kaveri oil', 'coconut oil'], true),
      p('Kaveri Sambar Powder 100g', 'KV201', '09109100', 5, 45, 38, 60, ['sambar powder', 'sambar']),
      p('Kaveri Rasam Powder 100g', 'KV202', '09109100', 5, 40, 34, 60, ['rasam powder', 'rasam']),
      p('Kaveri Turmeric Powder 100g', 'KV203', '09103030', 5, 32, 27, 60, ['turmeric', 'manjal']),
      p('Kaveri Chilli Powder 200g', 'KV204', '09042211', 5, 70, 59, 40, ['chilli powder', 'chilli']),
      p('Kaveri Ghee 200ml', 'KV301', '04059020', 5, 160, 136, 24, ['kaveri ghee', 'ghee'], true),
      p('Kaveri Mango Pickle 300g', 'KV401', '20019000', 5, 85, 72, 24, ['mango pickle', 'pickle']),
    ];
    cs.put('schemes', { companyId: 'own', productId: P[0].id, name: 'Coconut Oil 5% off', type: 'pct', value: 5, from: daysFrom(-20), to: daysFrom(20), source: 'company', combine: 'add', budget: 25000 });
    cs.put('schemes', { companyId: 'own', productId: P[1].id, name: 'Sambar buy 12 get 1', type: 'free', value: 0, buyQty: 12, freeQty: 1, from: daysFrom(-20), to: daysFrom(20), source: 'company', combine: 'add', budget: 8000 });
    const murugan = cs.put<DbLink>('dbLinks', { name: 'Sri Murugan Distributors', town: 'Tittakudi', inviteCode: 'KAVDM1', status: 'invited', normDays: 15, kind: 'distributor', gstin: '' });
    cs.put<DbLink>('dbLinks', { name: 'Velan Agencies', town: 'Vriddhachalam', inviteCode: 'KAVVL2', status: 'invited', normDays: 15, kind: 'distributor' });
    cs.put<DbLink>('dbLinks', { name: 'Anbu Super Stockist', town: 'Cuddalore', inviteCode: 'KAVAB3', status: 'invited', normDays: 21, kind: 'super_stockist' });
    arun.dbLinkIds = [murugan.id]; meena.dbLinkIds = [murugan.id]; so.dbLinkIds = [murugan.id];
    await cs.commit('Demo company setup');
  });
  // the demo distributor accepts (as its owner would, in More → Company links)
  await acceptInvite('KAVDM1');
  // history, planned so the numbers look like a real month: shop bills first (what the distributor will sell), then
  // the company's invoices sized to cover them plus a different number of days of stock per product (some low, some fine,
  // one too much). The latest invoice is left waiting to be received (the digital GRN demo).
  const link = (await co.dbLinks.toArray()).find(l => l.inviteCode === 'KAVDM1')!;
  const cp = (await co.products.toArray()).sort((a, b) => String(a.code).localeCompare(String(b.code))); // fixed order: the stock mix below is per product
  const distShops = await dist.shops.toArray();
  const plan: { ago: number; shop: number; lines: [number, number][] }[] = [];
  for (let ago = 28; ago >= 1; ago--) for (let k = 0; k < 3; k++) {
    const lines: [number, number][] = [];
    cp.forEach((x, i) => { if ((i + ago + k) % 3 === 0) lines.push([i, Math.max(6, Math.round(x.caseSize * (0.5 + ((ago * 7 + k * 3 + i) % 5) / 8)))]); });
    if (lines.length) plan.push({ ago, shop: (ago * 3 + k) % distShops.length, lines });
  }
  const sold = cp.map((_, i) => plan.reduce((a, b) => a + b.lines.filter(l => l[0] === i).reduce((x, l) => x + l[1], 0), 0));
  const keepDays = [3, 5, 12, 18, 25, 45, 9]; // days of stock left after the month: oil and sambar low, ghee too much
  const cases = (i: number, share: number) => Math.max(1, Math.ceil(sold[i] * (1 + keepDays[i] / 28) * share / cp[i].caseSize));
  const invoice = (ago: number, share: number, n: number): Omit<PrimaryInvoice, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'> => {
    const lines = cp.map((x, i) => { const qty = cases(i, share) * x.caseSize; const taxable = Math.round(qty * x.purchaseRate * 100) / 100; return { productId: x.id, name: x.name, hsn: x.hsn, qty, freeQty: 0, rate: x.purchaseRate, gst: x.gst, taxable, tax: Math.round(taxable * x.gst) / 100, batch: `K${ago}`, expiry: daysFrom(240 - ago), mrp: x.mrp }; });
    const taxable = Math.round(lines.reduce((a, l) => a + l.taxable, 0) * 100) / 100, tax = Math.round(lines.reduce((a, l) => a + l.tax, 0) * 100) / 100;
    return { dbLinkId: link.id, number: `KCP/26-27/${String(4100 + n)}`, date: daysFrom(-ago), lines, taxable, tax, total: Math.round(taxable + tax), source: 'excel' };
  };
  await onSide(co, async () => {
    setSession('demo-company', 'system');
    const cs = new ChangeSet();
    cs.put<PrimaryInvoice>('primaryInvoices', invoice(40, 0.4, 1));
    cs.put<PrimaryInvoice>('primaryInvoices', invoice(26, 0.35, 2));
    cs.put<PrimaryInvoice>('primaryInvoices', invoice(12, 0.25, 3));
    cs.put<PrimaryInvoice>('primaryInvoices', invoice(2, 0.2, 4));
    await cs.commit('Demo invoices to distributor');
  });
  await onSide(dist, async () => {
    setSession('demo', 'system');
    // received: all but the latest
    const ins = (await dist.inbound.toArray()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, -1);
    for (const i of ins) {
      const cs = new ChangeSet();
      for (const l of i.lines) if (l.productId) cs.put('batches', { productId: l.productId, batch: l.batch ?? i.number, expiry: l.expiry ?? daysFrom(180), mrp: l.mrp ?? 0, qty: l.qty + (l.freeQty ?? 0), godown: 'Main' }, 'stock in');
      cs.put('receipts', { id: i.id, inboundId: i.id, companyId: i.companyId, status: 'received', receivedAt: `${i.date}T11:00:00.000Z`, receivedBy: 'demo', purchaseId: '', short: [], damaged: [] }, 'received');
      await cs.commit('Demo company bill received');
    }
    const kav = new Map((await dist.products.toArray()).filter(x => x.companyProductId).map(x => [x.companyProductId!, x]));
    const owner = (await dist.staff.toArray()).find(s => s.role === 'owner')!;
    setSession('demo', owner.id);
    for (const b of plan) {
      const shop = distShops[b.shop];
      const lines = b.lines.map(([i, qty]) => { const x = kav.get(cp[i].id)!; return { productId: x.id, qty, rate: x.rate }; });
      const cs = new ChangeSet();
      const o = cs.put<Order>('orders', { shopId: shop.id, source: 'salesman', lines, date: daysFrom(-b.ago), status: 'billed', issues: [], invoiceIds: [] });
      const bills = await makeInvoices(cs, o, shop, undefined, o.date);
      o.invoiceIds = bills.map(x => x.id);
      for (const x of bills) cs.put('invoices', { ...x, deliveryStatus: 'delivered', delivery: { at: `${o.date}T15:00:00.000Z`, by: 'demo', shortages: [] } });
      await cs.commit('Demo Kaveri bill');
    }
  });
  // the field team: targets, past orders from the reps (billed by the distributor), and today: Meena is out on her
  // beat, Arun has not started (log in as Arun to try the day yourself)
  const staff = await co.staff.toArray();
  const arun = staff.find(x => x.phone === '9100000004')!, meena = staff.find(x => x.phone === '9100000005')!;
  const coShops = (await co.shops.toArray()).filter(x => x.dbLinkId === link.id);
  await onSide(co, async () => {
    setSession('demo-company', 'system');
    const cs = new ChangeSet();
    cs.put('targets', { companyId: 'own', month: today().slice(0, 7), kind: 'sales', value: 60000, staffId: arun.id });
    cs.put('targets', { companyId: 'own', month: today().slice(0, 7), kind: 'sales', value: 50000, staffId: meena.id });
    await cs.commit('Demo targets');
    for (let ago = 18; ago >= 2; ago -= 4) for (const [rep, k] of [[arun, 0], [meena, 1]] as [Staff, number][]) {
      const shop = coShops[(ago + k * 3) % coShops.length];
      const lines = cp.filter((_, i) => (i + ago + k) % 2 === 0).slice(0, 3).map(x => ({ productId: x.id, qty: x.caseSize / 2, rate: x.rate }));
      const c2 = new ChangeSet();
      c2.put('orders', { shopId: shop.id, dbLinkId: link.id, repId: rep.id, repName: rep.name.replace(/\s*\(.*\)$/, ''), source: 'company', lines, status: 'new', issues: [], date: daysFrom(-ago), invoiceIds: [] });
      c2.put('visits', { shopId: shop.id, staffId: rep.id, date: daysFrom(-ago), at: `${daysFrom(-ago)}T05:30:00.000Z`, outcome: 'order' });
      await c2.commit('Demo rep order');
    }
    // today: Meena started at 9:10, three readings, two visits (one order waiting at the distributor)
    const t0 = new Date(); t0.setHours(9, 10, 0, 0);
    const at = (min: number) => new Date(t0.getTime() + min * 60000).toISOString();
    const c3 = new ChangeSet();
    c3.put('workDays', { staffId: meena.id, date: today(), startAt: at(0), track: [{ at: at(0), lat: 11.4066, lng: 79.2577, acc: 12 }, { at: at(25), lat: 11.4140, lng: 79.2650, acc: 15 }, { at: at(50), lat: 11.4302, lng: 79.2811, acc: 10 }], km: 3.6, flags: [], outstation: false, mode: 'bike' });
    const s1 = coShops[0], s2 = coShops[1];
    c3.put('visits', { shopId: s1.id, staffId: meena.id, date: today(), at: at(20), outcome: 'order' });
    c3.put('visits', { shopId: s2.id, staffId: meena.id, date: today(), at: at(45), outcome: 'no_order', reason: 'Stock is enough' });
    c3.put('orders', { shopId: s1.id, dbLinkId: link.id, repId: meena.id, repName: 'Meena', source: 'company', lines: cp.slice(0, 2).map(x => ({ productId: x.id, qty: x.caseSize, rate: x.rate })), status: 'new', issues: [], date: today(), invoiceIds: [] });
    c3.put('leaves', { staffId: arun.id, from: daysFrom(3), to: daysFrom(4), reason: 'Family function', status: 'waiting' });
    await c3.commit('Demo field today');
  });
  // the distributor billed the reps' past orders (today's waits in Orders received)
  await onSide(dist, async () => {
    const owner = (await dist.staff.toArray()).find(s => s.role === 'owner')!;
    setSession('demo', owner.id);
    for (const o of (await dist.orders.toArray()).filter(x => x.source === 'company' && x.status === 'new' && x.date < today())) {
      const shop = (await dist.shops.get(o.shopId))!;
      const cs = new ChangeSet();
      const ord = cs.put<Order>('orders', { ...o, status: 'billed' }, 'billed');
      const bills = await makeInvoices(cs, ord, shop, undefined, o.date);
      ord.invoiceIds = bills.map(b => b.id);
      for (const b of bills) cs.put('invoices', { ...b, deliveryStatus: 'delivered', delivery: { at: `${o.date}T15:00:00.000Z`, by: 'demo', shortages: [] } });
      await cs.commit('Demo rep order billed');
    }
  });
  void db;
}
