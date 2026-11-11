// Demo distributor so the app can be tried before real data is loaded.
// GST rates and HSN codes here are demo values — real ones come from the company purchase bill.
import { ChangeSet, daysFrom, db, setSession, today } from './db';
import { makeInvoices } from './billing';
import { allocateOldestFirst } from './ledger';
import type { Company, Order, Payment, Product, Settings, Shop, Staff, Van } from './types';

export function gstinWithCheck(first14: string) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) { const v = chars.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(v / 36) + (v % 36); }
  return first14 + chars[(36 - (sum % 36)) % 36];
}

// local days, the same as the app's today() (UTC dates were a day behind between midnight and 5:30 AM in India)
const daysAgo = (n: number) => daysFrom(-n);
const inDays = (n: number) => daysFrom(n);

const SEED_VERSION = 'v0.9';
export async function seedDemo(tenantId = 'demo') {
  const ls = typeof localStorage === 'undefined' ? null : localStorage;
  if (await db.settings.count()) {
    if (!ls || ls.getItem('dbrox.seed') === SEED_VERSION) return;
    // older demo on this phone: start fresh so every stage of the pipeline has something to show
    await db.delete(); ls.removeItem('dbrox.session'); ls.setItem('dbrox.seed', SEED_VERSION); location.reload(); return;
  }
  ls?.setItem('dbrox.seed', SEED_VERSION);
  setSession(tenantId, 'system');
  const cs = new ChangeSet();
  const settings = cs.put<Settings>('settings', {
    firmName: 'Sri Murugan Distributors (Demo)', gstin: gstinWithCheck('33ABCDE1234F1Z'),
    address: '12 Bazaar Street, Tittakudi, Cuddalore 606106', stateCode: '33', phone: '9876543210',
    modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true },
    billFormat: 'A5', returnApprovalLimit: 2000, discountAlertPct: 5,
    billPrefix: 'SMD', nextBillNo: 1, checkInBy: '09:30', grnPhoto: true, upiId: 'srimurugan@okaxis', godownLat: 11.41, godownLng: 79.12,
  });
  const van = cs.put<Van>('vans', { name: 'Van 1', number: 'TN 31 AB 1234', kind: 'own' });
  cs.put<Van>('vans', { name: 'Auto 2', number: 'TN 31 C 5678', kind: 'hired' });
  const staff = (name: string, phone: string, role: Staff['role'], pin: string, extra: Partial<Staff> = {}) =>
    cs.put<Staff>('staff', { name, phone, role, pin, active: true, ...extra });
  const owner = staff('Vishnu (Owner)', '9000000001', 'owner', '1111');
  staff('Priya (Office)', '9000000002', 'office', '2222', { salary: 12000 });
  const ravi = staff('Ravi (Salesman)', '9000000003', 'salesman', '3333', { salary: 15000, batta: 150 });
  staff('Mani (Godown)', '9000000004', 'godown', '4444', { salary: 11000 });
  const karthik = staff('Karthik (Delivery)', '9000000005', 'delivery', '5555', { vanId: van.id, salary: 12000, batta: 150 });
  van.driverId = karthik.id;

  const co = (name: string, code: string, pan: string) => cs.put<Company>('companies', { name, code, gstin: gstinWithCheck(`33${pan}1Z`), nextBillNo: 1 });
  const hul = co('Hindustan Unilever', 'HUL', 'AAACH1004N');
  const itc = co('ITC Limited', 'ITC', 'AAACI5950L');
  const brit = co('Britannia Industries', 'BRT', 'AAACB2894G');

  const prod = (c: Company, name: string, code: string, hsn: string, gst: number, mrp: number, rate: number, caseSize: number, aliases: string[], focus = false) =>
    cs.put<Product>('products', { companyId: c.id, name, code, hsn, gst, mrp, rate, purchaseRate: Math.round(rate * 0.93 * 100) / 100, caseSize, aliases, focus, active: true });
  const P = [
    prod(hul, 'Surf Excel Easy Wash 1kg', '21834', '34022090', 18, 140, 112, 12, ['surf', 'surf excel', 'surf 1kg'], true),
    prod(hul, 'Lifebuoy Soap 125g', '21110', '34011190', 5, 38, 31, 72, ['lifebuoy', 'lifeboy']),
    prod(hul, 'Clinic Plus Shampoo Sachet (16 pcs)', '21455', '33051090', 5, 32, 26.5, 48, ['clinic plus', 'clinic']),
    prod(hul, 'Red Label Tea 250g', '21901', '09024020', 5, 145, 124, 40, ['red label', 'tea']),
    prod(hul, 'Vim Bar 200g', '21330', '34022090', 18, 25, 20.5, 60, ['vim']),
    prod(itc, 'Aashirvaad Atta 5kg', 'A5K', '11010000', 5, 290, 255, 4, ['aashirvaad', 'atta']),
    prod(itc, 'Sunfeast Dark Fantasy 75g', 'SDF75', '19053100', 5, 40, 33, 48, ['dark fantasy', 'sunfeast']),
    prod(itc, 'Bingo Mad Angles 66g', 'BMA66', '21069099', 5, 20, 16.2, 60, ['bingo', 'mad angles'], true),
    prod(itc, 'Classmate Notebook 172 pages', 'CM172', '48202000', 0, 60, 48, 24, ['classmate', 'notebook']),
    prod(brit, 'Good Day Cashew 75g', 'GDC75', '19053100', 5, 20, 16.4, 96, ['good day', 'goodday']),
    prod(brit, 'Marie Gold 250g', 'MG250', '19059090', 5, 40, 33, 36, ['marie', 'marie gold']),
    prod(brit, 'Britannia Cake Fruit 60g', 'BCF60', '19059020', 5, 15, 12.3, 72, ['cake', 'fruit cake']),
  ];
  // stock: two batches each, older one first
  P.forEach((p, i) => {
    cs.put('batches', { productId: p.id, batch: `B${100 + i}A`, expiry: inDays(25 + i * 9), mrp: p.mrp, qty: p.caseSize * 2, godown: 'Main' });
    cs.put('batches', { productId: p.id, batch: `B${100 + i}B`, expiry: inDays(200 + i * 15), mrp: p.mrp, qty: p.caseSize * 10, godown: 'Main' });
  });
  cs.put('schemes', { companyId: hul.id, productId: P[0].id, name: 'HUL Surf 5% off', type: 'pct', value: 5, from: daysAgo(30), to: inDays(30), source: 'company', combine: 'add' });
  cs.put('schemes', { companyId: brit.id, productId: P[9].id, name: 'Good Day buy 24 get 2', type: 'free', value: 0, buyQty: 24, freeQty: 2, from: daysAgo(30), to: inDays(30), source: 'company', combine: 'add' });
  cs.put('schemes', { companyId: itc.id, productId: P[7].id, name: 'Our Bingo 2% push', type: 'pct', value: 2, from: daysAgo(10), to: inDays(20), source: 'own', combine: 'add' });

  const shop = (name: string, area: string, beat: string, extra: Partial<Shop> = {}) =>
    cs.put<Shop>('shops', { name, area, beat, creditLimit: 25000, creditDays: 7, cashOnly: false, type: 'retail', approved: true, aliases: [], salesmanId: ravi.id, ...extra });
  const todayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
  const S = [
    shop('Murugan Stores', 'Tittakudi', todayName, { owner: 'Murugan', phone: '9443000001', address: 'Main Road, Tittakudi 606106' }),
    shop('Sri Lakshmi Traders', 'Pennadam', todayName, { gstin: gstinWithCheck('33AAKFS1234M1Z'), creditLimit: 60000, creditDays: 15, address: 'Bus Stand Road, Pennadam 606105', type: 'wholesale' }),
    shop('Annai Super Market', 'Tittakudi', 'Tuesday', { gstin: gstinWithCheck('33BBNPA5678K1Z'), creditLimit: 50000, creditDays: 10, address: 'Vriddhachalam Road, Tittakudi 606106' }),
    shop('Selvam Kirana', 'Pennadam', todayName, { phone: '9443000004' }),
    shop('Ganapathi Stores', 'Avinangudi', 'Wednesday', { cashOnly: true, creditLimit: 0 }),
    shop('Velan Provision', 'Thozhudur', 'Wednesday', { creditLimit: 15000 }),
    shop('Kumar Mart', 'Tittakudi', todayName),
    shop('Pennadam Wholesale Agency', 'Pennadam', 'Friday', { gstin: gstinWithCheck('33CCQPK9012L1Z'), type: 'subdistributor', creditLimit: 150000, creditDays: 21, address: 'Market Street, Pennadam 606105' }),
  ];
  cs.put('targets', { companyId: hul.id, month: today().slice(0, 7), kind: 'sales', value: 250000 });
  cs.put('targets', { companyId: brit.id, month: today().slice(0, 7), kind: 'sales', value: 120000 });
  await cs.commit('Demo setup');

  // a few past bills and payments so dashboards have something to show
  setSession(tenantId, owner.id);
  const past = async (shopIdx: number, ago: number, lines: [number, number][], payFrac: number, mode: Payment['mode'] = 'cash') => {
    const c2 = new ChangeSet();
    const o = c2.put<Order>('orders', { shopId: S[shopIdx].id, salesmanId: ravi.id, source: 'salesman', lines: lines.map(([pi, q]) => ({ productId: P[pi].id, qty: q, rate: P[pi].rate })), date: daysAgo(ago), status: 'billed', issues: [], invoiceIds: [] });
    const invs = await makeInvoices(c2, o, S[shopIdx], undefined, o.date);
    o.invoiceIds = invs.map(i => i.id);
    for (const i of invs) c2.put('invoices', { ...i, deliveryStatus: 'delivered', vanId: van.id, delivery: { at: daysAgo(ago), by: 'demo', shortages: [] } });
    await c2.commit('Demo bill');
    if (payFrac > 0) {
      const amt = Math.round(invs.reduce((a, i) => a + i.total, 0) * payFrac);
      const { allocations, advance } = await allocateOldestFirst(S[shopIdx].id, amt);
      const c3 = new ChangeSet();
      c3.put<Payment>('payments', { shopId: S[shopIdx].id, amount: amt, mode, ref: mode === 'upi' ? '4321' + String(ago).padStart(8, '0') : '', date: daysAgo(ago), collectedBy: ravi.id, shopConfirmed: true, allocations, advance, settled: ago > 1, status: 'ok' });
      await c3.commit('Demo payment');
    }
  };
  await past(0, 12, [[0, 24], [1, 72], [9, 48]], 0.5);
  await past(1, 9, [[5, 8], [6, 96], [10, 36]], 0);
  await past(2, 5, [[0, 12], [3, 40], [7, 120]], 1, 'upi');
  await past(3, 3, [[1, 36], [2, 48]], 0.3);
  await past(5, 1, [[9, 96], [11, 72]], 1);
  // today: the pipeline has something at every stage so each role's screen has work waiting
  const c4 = new ChangeSet();
  // approved & billed, waiting for the delivery plan
  const o = c4.put<Order>('orders', { shopId: S[6].id, salesmanId: ravi.id, source: 'salesman', lines: [{ productId: P[0].id, qty: 12, rate: P[0].rate }, { productId: P[7].id, qty: 60, rate: P[7].rate }], date: today(), status: 'billed', issues: [], invoiceIds: [] });
  const invs = await makeInvoices(c4, o, S[6], undefined, o.date);
  for (const i of invs) c4.put('invoices', { ...i, vanId: van.id });
  o.invoiceIds = invs.map(i => i.id);
  // packed by godown, waiting for the owner's approval
  c4.put<Order>('orders', { shopId: S[1].id, salesmanId: ravi.id, source: 'salesman', lines: [{ productId: P[5].id, qty: 24, rate: P[5].rate }, { productId: P[9].id, qty: 48, rate: P[9].rate }], date: today(), status: 'picked', issues: [], invoiceIds: [], picked: [{ productId: P[5].id, qty: 24 }, { productId: P[9].id, qty: 48 }], pickedBy: 'demo', pickedAt: new Date().toISOString() });
  // just booked by the salesman, waiting at the godown
  c4.put<Order>('orders', { shopId: S[2].id, salesmanId: ravi.id, source: 'salesman', lines: [{ productId: P[1].id, qty: 36, rate: P[1].rate }, { productId: P[3].id, qty: 20, rate: P[3].rate }], date: today(), status: 'approved', approvedBy: 'demo', approvedAt: new Date().toISOString(), issues: [], invoiceIds: [] });
  // just booked by the salesman, waiting for the owner
  c4.put<Order>('orders', { shopId: S[4].id, salesmanId: ravi.id, source: 'salesman', lines: [{ productId: P[0].id, qty: 24, rate: P[0].rate }, { productId: P[8].id, qty: 12, rate: P[8].rate }], date: today(), status: 'new', issues: [], invoiceIds: [] });
  await c4.commit('Demo today pipeline');
  return settings;
}
