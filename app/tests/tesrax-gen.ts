// TESRAX 5000 — everyday messages built from real templates × shops × products × amounts × roles × typing noise.
// Deterministic (seeded), so the same 5,000+ phrases are tested on every run. Expected codes: see tesrax-code.ts.
import type { Role } from '../src/core/types';

export type Case = { said: string; want: string; role: Role; intent: string };
export interface Facts { stock: Record<string, number> }

// --------------------------------------------------------------------------------------------- seeded randomness
function rng(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// --------------------------------------------------------------------------------------------- the demo world
const SHOPS: Record<string, string[]> = {
  'Murugan Stores': ['Murugan Stores', 'murugan stores', 'murugan', 'Murugan', 'murgan stores'],
  'Selvam Kirana': ['Selvam Kirana', 'selvam kirana', 'selvam', 'Selvam'],
  'Kumar Mart': ['Kumar Mart', 'kumar mart', 'Kumar mart'],
  'Annai Super Market': ['Annai Super Market', 'annai super market', 'annai', 'Annai'],
  'Sri Lakshmi Traders': ['Sri Lakshmi Traders', 'sri lakshmi traders', 'lakshmi traders', 'lakshmi'],
  'Ganapathi Stores': ['Ganapathi Stores', 'ganapathi stores', 'ganapathi', 'ganapathy'],
  'Velan Provision': ['Velan Provision', 'velan provision', 'velan'],
  'Pennadam Wholesale Agency': ['Pennadam Wholesale Agency', 'pennadam wholesale', 'pennadam wholesale agency'],
};
const SHOP_NAMES = Object.keys(SHOPS);
// product code (first word of the name), how people say it, pieces per case, rate, MRP
const PRODUCTS: [string, string[], number, number, number][] = [
  ['Surf', ['surf', 'Surf Excel', 'surf excel', 'surf 1kg'], 12, 112, 140],
  ['Lifebuoy', ['lifebuoy', 'Lifebuoy soap', 'lifeboy', 'lifebuoy 125g'], 72, 31, 38],
  ['Clinic', ['clinic plus', 'Clinic Plus shampoo'], 48, 26.5, 32],
  ['Red', ['red label', 'Red Label'], 40, 124, 145],
  ['Vim', ['vim', 'vim bar', 'Vim Bar'], 60, 20.5, 25],
  ['Aashirvaad', ['atta', 'aashirvaad atta', 'aashirvaad 5kg'], 4, 255, 290],
  ['Sunfeast', ['dark fantasy', 'sunfeast dark fantasy'], 48, 33, 40],
  ['Bingo', ['bingo', 'mad angles', 'bingo mad angles'], 60, 16.2, 20],
  ['Classmate', ['classmate', 'classmate notebook'], 24, 48, 60],
  ['Good', ['good day', 'goodday', 'Good Day cashew'], 96, 16.4, 20],
  ['Marie', ['marie gold', 'marie'], 36, 33, 40],
  ['Britannia', ['britannia cake', 'fruit cake'], 72, 12.3, 15],
];
// these shops have an order in the last 3 days, and how it can be changed (from the demo data)
const OPEN_ORDER: Record<string, 'open' | 'approved' | 'locked' | 'none'> = {
  'Ganapathi Stores': 'open', 'Annai Super Market': 'approved', 'Sri Lakshmi Traders': 'locked', 'Kumar Mart': 'locked',
  'Selvam Kirana': 'locked', 'Velan Provision': 'locked', 'Murugan Stores': 'none', 'Pennadam Wholesale Agency': 'none',
};
const HAS_BILL = new Set(['Murugan Stores', 'Sri Lakshmi Traders', 'Annai Super Market', 'Selvam Kirana', 'Velan Provision', 'Kumar Mart']);
// payments the test adds today (by the owner): shop → amount, mode
export const FIX_PAYMENTS: [string, number, string][] = [['Murugan Stores', 2000, 'cash'], ['Kumar Mart', 1500, 'upi'], ['Selvam Kirana', 500, 'cash']];
// expenses the test adds today (by the owner)
export const FIX_EXPENSES: [string, number, string][] = [['van 1 diesel 1500', 1500, 'diesel'], ['tea 120', 120, 'tea'], ['toll 85', 85, 'toll'], ['rent 12000', 12000, 'rent'], ['eb bill 3200', 3200, 'eb bill']];

const QTY: [string, number][] = [['1 case', 1], ['2 case', 2], ['3 cs', 3], ['5 cases', 5], ['2cs', 2], ['12', 12], ['24 pcs', 24], ['6', 6], ['48 nos', 48], ['2 dozen', 2], ['10', 10], ['4 box', 4], ['1 dozen', 1], ['36', 36]];
const AMOUNTS = [300, 450, 500, 750, 1000, 1200, 1755, 2000, 2450, 3000, 5000, 12500];

export function generate(facts: Facts): Case[] {
  const R = rng(20261108);
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const out: Case[] = [];
  const seen = new Set<string>();
  const add = (intent: string, said: string, want: string, role: Role = 'owner') => {
    said = said.replace(/\s+/g, ' ').trim();
    const k = `${role}|${said.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k); out.push({ said, want, role, intent });
  };
  const sv = (shop: string) => pick(SHOPS[shop]);
  const pv = (i: number) => pick(PRODUCTS[i][1]);
  const amt = (a: number) => {
    const forms = [`${a}`, `${a}`, `rs ${a}`, `₹${a}`, `rs.${a}`, `${a}/-`];
    if (a >= 1000) forms.push(`${a.toLocaleString('en-IN')}`, `rs.${a.toLocaleString('en-IN')}`);
    if (a % 1000 === 0) forms.push(`${a / 1000}k`);
    if (a % 500 === 0 && a > 1000) forms.push(`${a / 1000}k`);
    return pick(forms);
  };
  // typing noise that must never change the meaning
  const noisy = (s: string) => {
    const r = R();
    if (r < 0.15) return s.toUpperCase();
    if (r < 0.3) return s.replace(/\b\w/g, x => x.toUpperCase());
    if (r < 0.45) return `${s} pls`;
    if (r < 0.55) return `${s}.`;
    if (r < 0.65) return s.replace(/ /g, '  ');
    if (r < 0.72) return `${s} sir`;
    return s.toLowerCase();
  };
  const both = (intent: string, said: string, want: string, role: Role = 'owner') => { add(intent, said, want, role); add(intent, noisy(said), want, role); };

  // ------------------------------------------------------------------------------------- new orders
  const ORDER_T: ((s: string, q: string, p: string, q2: string, p2: string) => string)[] = [
    (s, q, p) => `${s} ${q} ${p}`, (s, q, p) => `${s} ${p} ${q}`, (s, q, p, q2, p2) => `${s} ${q} ${p}, ${q2} ${p2}`,
    (s, q, p, q2, p2) => `${s} ${q} ${p} and ${q2} ${p2}`, (s, q, p, q2, p2) => `${s}: ${p} ${q}, ${p2} ${q2}`, (s, q, p) => `${s} - ${p} ${q}`,
    (s, q, p) => `order for ${s} ${p} ${q}`, (s, q, p) => `${q} ${p} for ${s}`, (s, q, p) => `take order ${s} ${q} ${p}`,
    (s, q, p) => `new order ${s} ${q} ${p}`, (s, q, p) => `send ${q} ${p} to ${s}`, (s, q, p) => `${s} wants ${q} ${p}`,
    (s, q, p) => `${s} needs ${q} ${p}`, (s, q, p) => `${s} ku ${q} ${p} anuppunga`, (s, q, p) => `${s} la ${q} ${p} venum`,
    (s, q, p) => `pls book ${q} ${p} for ${s}`, (s, q, p, q2, p2) => `${s} ${p} ${q} ${p2} ${q2}`,
  ];
  for (let i = 0; i < 1000; i++) {
    const shop = pick(SHOP_NAMES); const a = Math.floor(R() * 12); let b = Math.floor(R() * 12); if (b === a) b = (b + 1) % 12;
    const t = pick(ORDER_T);
    both('order', t(sv(shop), pick(QTY)[0], pv(a), pick(QTY)[0], pv(b)), `order:${shop}`, pick(['owner', 'office', 'salesman'] as Role[]));
  }
  for (let i = 0; i < 40; i++) add('ask', `${pick(QTY)[0]} ${pv(Math.floor(R() * 12))}`, 'ask', pick(['owner', 'salesman'] as Role[])); // which shop?

  // ------------------------------------------------------------------------------------- payments
  const MODES: [string, string][] = [['cash', 'cash'], ['gpay', 'upi'], ['upi', 'upi'], ['phonepe', 'upi'], ['google pay', 'upi'], ['paytm', 'upi'], ['cheque', 'cheque'], ['chq', 'cheque']];
  const PAY_T: [(s: string, a: string, m: string) => string, boolean][] = [
    [(s, a) => `${s} paid ${a}`, false], [(s, a, m) => `${s} paid ${a} ${m}`, true], [(s, a, m) => `${s} paid ${a} by ${m}`, true],
    [(s, a) => `received ${a} from ${s}`, false], [(s, a, m) => `received ${a} from ${s} by ${m}`, true], [(s, a) => `collected ${a} from ${s}`, false],
    [(s, a, m) => `${s} ${a} ${m}`, true], [(s, a) => `got ${a} from ${s}`, false], [(s, a) => `${s} ${a} received`, false], [(s, a) => `${s} gave ${a}`, false],
    [(s, a) => `${s} ${a} kuduthaanga`, false], [(s, a) => `${s} kitta ${a} vangitten`, false], [(s, a) => `payment ${a} from ${s}`, false],
    [(s, a) => `${s} payment ${a}`, false], [(s, a) => `${s} pd ${a}`, false], [(s, a) => `rcvd ${a} frm ${s}`, false], [(s, a) => `${s} settled ${a}`, false],
    [(s, a, m) => `${m} ${a} from ${s}`, true], [(s, a, m) => `${s} ${m} ${a}`, true],
  ];
  for (let i = 0; i < 900; i++) {
    const shop = pick(SHOP_NAMES); const a = pick(AMOUNTS); const [t, withMode] = pick(PAY_T); const [mw, mode] = pick(MODES);
    both('payment', t(sv(shop), amt(a), mw), `payment:${shop}:${a}:${withMode ? mode : 'cash'}`, pick(['owner', 'office', 'salesman', 'delivery'] as Role[]));
  }

  // ------------------------------------------------------------------------------------- payment corrections
  const FIX_T: ((s: string, o: number, n: number) => string)[] = [
    (s, o, n) => `${s} it is not ${o}, it is ${n}`, (s, o, n) => `${s} paid ${n} not ${o}`, (s, o, n) => `change ${s} payment ${o} to ${n}`,
    (s, o, n) => `${s} ${o} illa ${n}`, (s, o, n) => `adjust ${s} bill it is not ${o} it is ${n}`, (s, o, n) => `correct ${s} payment ${o} to ${n}`,
    (s, o, n) => `${s} payment wrong, ${o} should be ${n}`, (s, o, n) => `${s} ${o} is wrong it is ${n}`, (s, o, n) => `sorry ${s} payment ${o} illa ${n}`,
    (s, o, n) => `${s} not ${o} it is ${n}`, (s, o, n) => `update ${s} payment from ${o} to ${n}`,
  ];
  for (const [shop, old] of FIX_PAYMENTS) for (const t of FIX_T) for (const n of [old - 200, old - 100, Math.round(old / 2)]) {
    both('paymentFix', t(sv(shop), old, n), `fix:${old}->${n}`);
    add('paymentFix', t(sv(shop), 777, n), 'fix:none');
  }
  for (const [shop, old] of FIX_PAYMENTS) {
    for (const n of [old - 300, old - 50]) {
      add('paymentFix', `wrong amount for ${sv(shop)}, it is ${n}`, `fix:${old}->${n}`);
      add('paymentFix', `${sv(shop)} payment mistake, actually ${n}`, `fix:${old}->${n}`);
      add('paymentFix', `${sv(shop)} it is not ${old}, it is ${n}`, 'ask', 'godown');
    }
  }

  // ------------------------------------------------------------------------------------- expenses
  const EXP: [string[], string][] = [
    [['diesel', 'petrol', 'fuel'], 'Fuel'], [['toll', 'toll gate'], 'Toll'], [['van repair', 'tyre puncture', 'van service', 'puncture'], 'Van repair'],
    [['eb bill', 'electricity bill', 'current bill', 'electricity'], 'Electricity'], [['rent', 'office rent'], 'Rent'], [['batta', 'driver batta'], 'Batta'],
    [['hamali', 'loading charges', 'coolie', 'unloading charges', 'labour charges'], 'Loading & labour'], [['tea', 'lunch', 'snacks'], 'Tea & food'],
    [['mobile recharge', 'internet bill', 'wifi bill', 'phone bill'], 'Phone & internet'], [['parking', 'courier', 'stationery'], 'Other'], [['salary'], 'Salary'],
  ];
  const EXP_T: ((w: string, a: string) => string)[] = [
    (w, a) => `${w} ${a}`, (w, a) => `${a} ${w}`, (w, a) => `paid ${w} ${a}`, (w, a) => `spent ${a} on ${w}`, (w, a) => `${w} expense ${a}`,
    (w, a) => `${w} ${a} paid`, (w, a) => `today ${w} ${a}`, (w, a) => `${w} rs.${a}`, (w, a) => `van 1 ${w} ${a}`, (w, a) => `auto 2 ${w} ${a}`, (w, a) => `${w} ${a} rs`,
  ];
  for (let i = 0; i < 520; i++) {
    const [words, cat] = pick(EXP); const a = pick([50, 80, 120, 250, 400, 850, 1500, 2500, 3200, 12000]); const t = pick(EXP_T);
    if (cat === 'Salary' && t !== EXP_T[0] && t !== EXP_T[1]) continue;
    if ((t === EXP_T[8] || t === EXP_T[9]) && !['Fuel', 'Toll', 'Van repair', 'Batta'].includes(cat)) continue; // "auto 2 rent" is van hire
    both('expense', t(pick(words), String(a)), `expense:${a}:${cat}`, pick(['owner', 'office', 'delivery'] as Role[]));
  }

  // ------------------------------------------------------------------------------------- questions
  const OUT_T: ((s: string) => string)[] = [
    s => `${s} outstanding`, s => `${s} balance`, s => `how much ${s} has to pay`, s => `${s} pending`, s => `pending amount ${s}`, s => `${s} evlo baaki`,
    s => `${s} kitta evlo baaki`, s => `what is ${s} due`, s => `how much is pending from ${s}`, s => `${s} dues`, s => `${s} total outstanding`, s => `${s} bal`,
  ];
  for (const shop of SHOP_NAMES) for (const t of OUT_T) both('outstanding', t(sv(shop)), 't:Outstanding', pick(['owner', 'office', 'salesman', 'delivery'] as Role[]));
  for (const s of ['who owes more than 5000', 'who owes more than 10000', 'outstanding', 'who has not paid', 'who is overdue', 'overdue shops', 'total outstanding', 'pending payments', 'who has to pay', 'list of dues', 'who owes above 20000'])
    both('outstanding', s, 't:Outstanding');
  for (const s of ['today sales', 'sales today', 'how much sold today', "today's billing", 'today summary', 'what did we sell today', 'today total sales', 'total sales today', 'sales summary', 'how much billed today', 'turnover today'])
    { both('sales', s, 't:Sales'); add('sales', s, 't:Sales', 'office'); }
  const STOCK_Q: ((p: string) => string)[] = [
    p => `stock of ${p}`, p => `how much ${p}`, p => `${p} stock`, p => `is ${p} available`, p => `how many ${p} left`, p => `${p} irukka`, p => `check stock ${p}`,
    p => `do we have ${p}`, p => `${p} stock?`, p => `how much ${p} in godown`, p => `${p} available?`, p => `any ${p} in stock`,
  ];
  for (let i = 0; i < PRODUCTS.length; i++) for (const t of STOCK_Q) for (const v of PRODUCTS[i][1].slice(0, 2)) add('stockQ', t(v), 't:Stock', pick(['owner', 'office', 'godown', 'salesman'] as Role[]));
  for (const s of ['cash in hand', 'how much cash do i have', 'cash balance', 'how much cash']) both('cash', s, 't:Cash');
  for (const s of ['near expiry', 'items expiring soon', "what's expiring", 'expiring items', 'expiry soon items', 'what is going to expire']) both('expiry', s, 't:Near');
  for (const s of ['load sheet', 'today load sheet', 'load sheet for today']) { both('load', s, 't:Load'); add('load', s, 'go:load', 'godown'); }

  // ------------------------------------------------------------------------------------- files
  const EXPORTS: [string, string][] = [
    ['tally export', 'tally'], ['tally xml october', 'tally'], ['tally export last month', 'tally'], ['export to tally', 'tally'], ['tally for september', 'tally'],
    ['gstr1 october', 'gstr1'], ['gstr1', 'gstr1'], ['gst return file', 'gstr1'], ['gstr-1 for october', 'gstr1'], ['gstr1 last month', 'gstr1'],
    ['e-invoice', 'einvoice'], ['einvoice json', 'einvoice'], ['e invoice for today', 'einvoice'], ['e-invoice json october', 'einvoice'],
    ['claim file', 'claims'], ['claims file', 'claims'], ['make claim for this month', 'claims'], ['claim report october', 'claims'],
  ];
  for (const [s, k] of EXPORTS) { both('export', s, `export:${k}`); add('export', s, `export:${k}`, 'office'); }

  // ------------------------------------------------------------------------------------- screens
  const SCREENS: [string, string][] = [
    ['delivery plan', 'plan'], ['plan delivery', 'plan'], ['orders received', 'orders-received'], ['approve orders', 'orders-received'],
    ['pending approvals', 'orders-received'], ['live vans', 'live'], ['where is the van', 'live'], ['day close', 'dayclose'], ['close the day', 'dayclose'],
    ['p&l', 'pnl'], ['profit and loss', 'pnl'], ['cash flow', 'cashflow'], ['gst', 'gst'], ['fast movers', 'reports'], ['dead stock', 'reports'],
    ['shop wise sales', 'reports'], ['bank', 'bank'], ['expenses', 'expenses'], ['stock position', 'stock'], ['ageing', 'ageing'],
    ['vans and drivers', 'vans'], ['trip report', 'trips'], ['salary sheet', 'salary'], ['attendance', 'today'], ['billed bills', 'billed'],
    ['verify', 'verify'], ['new shops to approve', 'newshops'], ['targets', 'targets'], ['purchases', 'stockin'], ['damages', 'damages'],
    ['delivery status', 'status'], ['cheques', 'cheques'], ['claims', 'claims'], ['stock report', 'stock-reports'], ['collection', 'collect'],
  ];
  for (const [s, page] of SCREENS) for (const pre of ['', 'open ', 'show ', 'show me ', 'go to ']) for (const suf of ['', ' please', ' screen', ' page']) {
    if (R() < 0.5 && (pre || suf)) continue;
    add('screen', `${pre}${s}${suf}`, `go:${page}`);
  }
  for (const [s, page, role] of [['pick orders', 'pick', 'godown'], ['load vans', 'load', 'godown'], ['my trip', 'trip', 'delivery'], ['start trip', 'trip', 'delivery'], ['my beat', 'beat', 'salesman'], ['my day', 'myday', 'salesman']] as [string, string, Role][])
    for (const pre of ['', 'open ', 'show ']) add('screen', `${pre}${s}`, `go:${page}`, role);

  // ------------------------------------------------------------------------------------- returns, damage, schemes, new shops
  const RET_T: ((s: string, q: string, p: string) => string)[] = [
    (s, q, p) => `${s} return ${q} ${p}`, (s, q, p) => `${s} returned ${q} ${p}`, (s, q, p) => `return from ${s} ${q} ${p}`, (s, q, p) => `${s} sent back ${q} ${p}`, (s, q, p) => `${s} gave back ${q} ${p}`,
  ];
  for (let i = 0; i < 200; i++) { const shop = pick(SHOP_NAMES); both('return', pick(RET_T)(sv(shop), pick(['2', '5', '1 case', '6', '12']), pv(Math.floor(R() * 12))), `return:${shop}`, pick(['owner', 'salesman', 'delivery'] as Role[])); }
  const DMG_T: ((q: string, p: string) => string)[] = [(q, p) => `${q} ${p} damaged`, (q, p) => `${q} ${p} leaked`, (q, p) => `${q} ${p} expired`, (q, p) => `damaged ${q} ${p}`, (q, p) => `${q} ${p} broken`, (q, p) => `${p} ${q} damage`];
  for (let i = 0; i < 160; i++) both('damage', pick(DMG_T)(pick(['2', '5', '3', '10', '1 case']), pv(Math.floor(R() * 12))), 'claim', pick(['owner', 'godown'] as Role[]));
  const SCH_T: ((p: string, n: number) => string)[] = [p => `${p} 5% off till 30 Nov`, (p, n) => `${p} ${n}% off`, p => `${p} buy 24 get 2`, (p, n) => `scheme on ${p} ${n}% discount`, (p, n) => `offer ${p} ${n}% till month end`, p => `${p} buy 12 get 1 free`];
  for (let i = 0; i < 120; i++) both('scheme', pick(SCH_T)(pv(Math.floor(R() * 12)), pick([2, 3, 5, 8, 10])), 'schemes', pick(['owner', 'office'] as Role[]));
  const NEW_NAMES = ['Ganesh Stores', 'Raja Traders', 'Bala Stores', 'Sakthi Agencies', 'Ramesh Kirana', 'Lucky Mart', 'Sri Balaji Stores', 'Kannan Provision'];
  const NS_T: ((n: string) => string)[] = [n => `new shop ${n} Pennadam 9876543210`, n => `add shop ${n}`, n => `add new retailer ${n}`, n => `pudhu kadai ${n}`, n => `new customer ${n} Tittakudi`, n => `add customer ${n}`];
  for (const n of NEW_NAMES) for (const t of NS_T) add('newshop', t(n), 'newshop', pick(['owner', 'salesman'] as Role[]));

  // ------------------------------------------------------------------------------------- help and nonsense
  for (const s of ['help', 'what can you do', 'what can i ask', 'options', 'menu', 'how to use', 'hi', 'hello', 'good morning', 'vanakkam', 'thanks', 'hi tesrax', 'hello there', 'thank you', 'good evening'])
    for (const r of ['owner', 'salesman', 'delivery'] as Role[]) add('help', s, 'help', r);
  for (const s of ['asdfgh', 'qwerty', 'blah blah', 'xyz 123 abc'.replace('123', 'abc')]) add('ask', s, 'ask');
  for (const shop of SHOP_NAMES) { add('ask', `${sv(shop)} hello 12 something 40`, 'ask'); }

  // ------------------------------------------------------------------------------------- payroll
  for (const s of ['leave monday', 'i want leave tomorrow', 'sick leave today', 'tomorrow leave', 'leave pls']) for (const r of ['salesman', 'godown', 'delivery'] as Role[]) add('leave', s, 'leave', r);
  for (const a of [500, 1000, 2000]) for (const r of ['salesman', 'delivery'] as Role[]) add('advance', `advance ${a}`, `advance:${a}`, r);

  // ================================================================================== CHANGES TO WHAT IS SAVED
  // ------------------------------------------------------------------------------------- change an order
  const OE_SET: ((s: string, p: string, q: string) => string)[] = [
    (s, p, q) => `change ${s} order ${p} to ${q}`, (s, p, q) => `${s} order ${p} change to ${q}`, (s, p, q) => `make ${s} order ${p} ${q}`,
    (s, p, q) => `${s} order ${p} ${q} only`, (s, p, q) => `update ${s} order ${p} ${q}`, (s, p, q) => `${s} order ${p} maathu ${q}`,
    (s, p, q) => `increase ${p} to ${q} in ${s} order`, (s, p, q) => `${s} order wrong, ${p} should be ${q}`, (s, p, q) => `in ${s} order make ${p} ${q}`,
    (s, p, q) => `${s} order ${p} ${q} not 1 case`, (s, p, q) => `edit ${s} order ${p} ${q}`,
  ];
  const OE_REMOVE: ((s: string, p: string) => string)[] = [
    (s, p) => `remove ${p} from ${s} order`, (s, p) => `${s} order remove ${p}`, (s, p) => `${s} order ${p} vendam`, (s, p) => `delete ${p} in ${s} order`,
    (s, p) => `${s} order la ${p} eduthudunga`, (s, p) => `drop ${p} from ${s} order`, (s, p) => `${s} order no ${p}`,
  ];
  const OE_ADD: ((s: string, p: string, q: string) => string)[] = [
    (s, p, q) => `add ${q} ${p} to ${s} order`, (s, p, q) => `${s} order add ${q} ${p}`, (s, p, q) => `${s} order ${q} more ${p}`, (s, p, q) => `${s} order extra ${q} ${p}`,
    (s, p, q) => `${s} order la ${q} ${p} serthu`,
  ];
  const OE_SUB: ((s: string, p: string, q: string) => string)[] = [(s, p, q) => `reduce ${p} in ${s} order by ${q}`, (s, p, q) => `${s} order ${p} reduce ${q}`, (s, p, q) => `${s} order ${p} kammi ${q}`];
  for (const shop of SHOP_NAMES) {
    const st = OPEN_ORDER[shop];
    const changeWant = (role: Role) => st === 'none' ? 'orderEdit:none' : st === 'locked' || (st === 'approved' && role === 'salesman') ? 'orderEdit:locked' : `orderEdit:${shop}`;
    const addWant = (role: Role) => st === 'open' || (st === 'approved' && role !== 'salesman') ? `orderEdit:${shop}` : `order:${shop}`;
    for (const role of ['owner', 'office', 'salesman'] as Role[]) {
      for (const t of OE_SET) for (let k = 0; k < 2; k++) both('orderEdit', t(sv(shop), pv(Math.floor(R() * 12)), pick(QTY)[0]), changeWant(role), role);
      for (const t of OE_REMOVE) for (let k = 0; k < 2; k++) both('orderEdit', t(sv(shop), pv(Math.floor(R() * 12))), changeWant(role), role);
      for (const t of OE_SUB) add('orderEdit', t(sv(shop), pv(Math.floor(R() * 12)), pick(['2', '6', '1 case'])), changeWant(role), role);
      for (const t of OE_ADD) for (let k = 0; k < 2; k++) both('orderEdit', t(sv(shop), pv(Math.floor(R() * 12)), pick(QTY)[0]), addWant(role), role);
      add('orderEdit', `edit ${sv(shop)} order`, changeWant(role), role);
      add('orderEdit', `${sv(shop)} order change ${pv(0)} 2 case, ${pv(4)} 24`, changeWant(role), role);
      add('orderEdit', `remove ${pv(4)} and add 2 case ${pv(1)} in ${sv(shop)} order`, changeWant(role), role);
    }
    // cancel the whole order
    const cancelWant = (role: Role) => changeWant(role).replace('orderEdit:' + shop, 'orderCancel:' + shop);
    for (const role of ['owner', 'office', 'salesman'] as Role[]) for (const t of [
      (s: string) => `cancel ${s} order`, (s: string) => `${s} order cancel`, (s: string) => `${s} order cancel pannunga`, (s: string) => `${s} order vendam`,
      (s: string) => `delete ${s} order`, (s: string) => `scrap ${s} order`, (s: string) => `${s} order no need`, (s: string) => `cancel the order for ${s}`,
      (s: string) => `${s} cancelled the order`, (s: string) => `${s} dont want the order`,
    ]) both('orderCancel', t(sv(shop)), cancelWant(role), role);
    for (const role of ['godown', 'delivery'] as Role[]) add('orderEdit', `cancel ${sv(shop)} order`, 'ask', role);
  }
  for (const s of ['cancel my last order', 'cancel my order', 'change my last order surf to 3 case']) add('orderEdit', s, s.startsWith('change') ? 'orderEdit:Ganapathi Stores' : 'orderCancel:Ganapathi Stores', 'salesman');

  // ------------------------------------------------------------------------------------- cancel a bill
  const BC_T: ((s: string) => string)[] = [s => `cancel ${s} bill`, s => `cancel ${s} invoice`, s => `${s} bill cancel`, s => `delete ${s} bill`, s => `${s} bill cancel pannunga`, s => `cancel the bill for ${s}`, s => `${s} last bill cancel`, s => `void ${s} bill`];
  for (const shop of SHOP_NAMES) for (const t of BC_T) {
    both('billCancel', t(sv(shop)), HAS_BILL.has(shop) ? `billCancel:${shop}` : 'billCancel:none', pick(['owner', 'office'] as Role[]));
    add('billCancel', t(sv(shop)), 'ask', 'salesman');
  }

  // ------------------------------------------------------------------------------------- cancel a payment
  const PC_T: ((s: string, a: number) => string)[] = [
    s => `cancel ${s} payment`, (s, a) => `cancel ${s} payment ${a}`, s => `delete ${s} payment`, s => `${s} payment cancel`, (s, a) => `${s} ${a} payment delete`,
    (s, a) => `remove ${s} collection ${a}`, s => `${s} payment entry wrong, delete it`, (s, a) => `cancel the ${a} from ${s}`, s => `${s} payment cancel pannunga`,
    (s, a) => `delete ${a} payment of ${s}`,
  ];
  for (const [shop, a] of FIX_PAYMENTS) for (const t of PC_T) {
    both('payCancel', t(sv(shop), a), `payCancel:${shop}:${a}`);
    add('payCancel', t(sv(shop), 999), t(sv(shop), 999).includes('999') ? 'payCancel:none' : `payCancel:${shop}:${a}`);
    add('payCancel', t(sv(shop), a), 'payCancel:locked', pick(['salesman', 'delivery'] as Role[]));
  }
  for (const shop of ['Ganapathi Stores', 'Sri Lakshmi Traders', 'Pennadam Wholesale Agency']) for (const t of PC_T.slice(0, 4)) add('payCancel', t(sv(shop), 500), 'payCancel:none');
  for (const t of [(s: string) => `${s} cheque bounced`, (s: string) => `${s} cheque returned`, (s: string) => `cheque bounce ${s}`, (s: string) => `${s} chq bounced`, (s: string) => `${s} payment bounced`])
    for (const [shop, a, mode] of FIX_PAYMENTS) both('payCancel', t(sv(shop)), mode === 'cash' ? 'payCancel:none' : `payCancel:${shop}:${a}`);

  // ------------------------------------------------------------------------------------- correct / delete an expense
  for (const [, old, w] of FIX_EXPENSES) {
    const news = [Math.round(old * 0.9), old - 20, Math.round(old * 1.1)];
    for (const n of news) for (const t of [
      (o: number, x: number) => `${w} was ${x} not ${o}`, (o: number, x: number) => `${w} ${o} wrong it is ${x}`, (o: number, x: number) => `change ${w} ${o} to ${x}`,
      (o: number, x: number) => `correct ${w} expense ${o} to ${x}`, (o: number, x: number) => `${w} ${o} illa ${x}`, (o: number, x: number) => `${w} expense ${o} is wrong, it should be ${x}`,
      (o: number, x: number) => `${w} not ${o} it is ${x}`,
    ]) { both('expenseFix', t(old, n), `expFix:${old}->${n}`); add('expenseFix', t(old + 7, n), 'expFix:none'); }
    for (const n of news) add('expenseFix', `${w} expense should be ${n}`, `expFix:${old}->${n}`);
    for (const t of [(o: number) => `delete ${w} expense ${o}`, () => `delete ${w} expense`, (o: number) => `cancel ${w} ${o}`, (o: number) => `remove ${w} ${o}`, () => `delete the ${w} entry`, (o: number) => `${w} ${o} entry delete pannu`])
      { both('expenseFix', t(old), `expDel:${old}`); add('expenseFix', t(old), 'expFix:none', 'salesman'); }
  }

  // ------------------------------------------------------------------------------------- stock counts
  const SET_T: ((p: string, n: string) => string)[] = [
    (p, n) => `physical count ${p} ${n}`, (p, n) => `${p} stock is ${n} not 999`, (p, n) => `${p} count ${n}`, (p, n) => `${p} actual stock ${n}`,
    (p, n) => `set ${p} stock to ${n}`, (p, n) => `${p} stock correct ${n}`, (p, n) => `${p} shelf count ${n}`, (p, n) => `counted ${p} ${n}`,
    (p, n) => `${p} physical stock ${n}`, (p, n) => `${p} stock mismatch actual ${n}`, (p, n) => `${p} stock ${n}`, (p, n) => `godown has ${n} ${p}`,
  ];
  const SUB_T: ((p: string, n: number) => string)[] = [(p, n) => `${n} ${p} short`, (p, n) => `${p} shortage ${n}`, (p, n) => `${n} ${p} missing`, (p, n) => `${p} stock short by ${n}`];
  const ADD_T: ((p: string, n: number) => string)[] = [(p, n) => `${n} ${p} found extra`, (p, n) => `${p} excess ${n}`, (p, n) => `${p} stock excess ${n}`];
  for (let i = 0; i < PRODUCTS.length; i++) {
    const [code, names, cs] = PRODUCTS[i];
    const sys = facts.stock[code];
    for (const v of names) {
      for (const t of SET_T) for (const n of [40, 100, 240]) both('stockFix', t(v, String(n)), `stockFix:${code}:${n}`, pick(['owner', 'office', 'godown'] as Role[]));
      both('stockFix', `physical count ${v} 3 case`, `stockFix:${code}:${3 * cs}`, 'godown');
      for (const t of SUB_T) for (const n of [2, 6]) both('stockFix', t(v, n), `stockFix:${code}:${Math.max(0, sys - n)}`, pick(['owner', 'godown'] as Role[]));
      for (const t of ADD_T) for (const n of [3, 12]) add('stockFix', t(v, n), `stockFix:${code}:${sys + n}`, pick(['owner', 'godown'] as Role[]));
      add('stockFix', `physical count ${v} 100`, 'ask', pick(['salesman', 'delivery'] as Role[]));
    }
  }

  // ------------------------------------------------------------------------------------- product rate / MRP / case size / GST
  for (let i = 0; i < PRODUCTS.length; i++) {
    const [code, names, cs, rate, mrp] = PRODUCTS[i];
    const nr = Math.round(rate * 1.03 * 10) / 10, nm = Math.round(mrp * 1.05), nb = Math.round(rate * 0.9 * 10) / 10;
    for (const v of names) {
      const T: [string, string][] = [
        [`${v} rate ${nr}`, `rate=${nr}`], [`${v} selling price ${nr}`, `rate=${nr}`], [`change ${v} rate to ${nr}`, `rate=${nr}`], [`${v} new rate ${nr}`, `rate=${nr}`],
        [`set ${v} price ${nr}`, `rate=${nr}`], [`${v} price changed to ${nr}`, `rate=${nr}`], [`${v} mrp ${nm}`, `mrp=${nm}`], [`change ${v} mrp from ${mrp} to ${nm}`, `mrp=${nm}`],
        [`${v} mrp is ${nm} now`, `mrp=${nm}`], [`new mrp for ${v} ${nm}`, `mrp=${nm}`], [`${v} purchase rate ${nb}`, `purchaseRate=${nb}`], [`${v} landing cost ${nb}`, `purchaseRate=${nb}`],
        [`${v} buying price ${nb}`, `purchaseRate=${nb}`], [`${v} case size ${cs * 2}`, `caseSize=${cs * 2}`], [`${v} pcs per case ${cs * 2}`, `caseSize=${cs * 2}`],
        [`${v} gst 12`, 'gst=12'], [`increase ${v} rate by 2`, `rate=${Math.round((rate + 2) * 100) / 100}`], [`${v} rate ${nr} mrp ${nm}`, `rate=${nr},mrp=${nm}`],
        [`reduce ${v} price by 1`, `rate=${Math.round((rate - 1) * 100) / 100}`],
      ];
      for (const [s, kv] of T) { both('productEdit', s, `product:${code}:${kv}`, pick(['owner', 'office'] as Role[])); }
      add('productEdit', `${v} rate ${nr}`, 'ask', pick(['salesman', 'godown', 'delivery'] as Role[]));
    }
  }

  // ------------------------------------------------------------------------------------- shop details
  const PHONES = ['9876501234', '9443012345', '8012345678', '7010203040'];
  for (const shop of SHOP_NAMES) {
    for (const ph of PHONES) for (const t of [(s: string) => `${s} phone ${ph}`, (s: string) => `${s} mobile number ${ph}`, (s: string) => `change ${s} phone to ${ph}`, (s: string) => `${s} new number ${ph}`, (s: string) => `update ${s} contact ${ph}`, (s: string) => `${s} whatsapp ${ph}`])
      { both('shopEdit', t(sv(shop)), `shop:${shop}:phone=${ph}`, pick(['owner', 'office', 'salesman'] as Role[])); }
    for (const L of [10000, 30000, 75000]) for (const t of [(s: string) => `${s} credit limit ${L}`, (s: string) => `set ${s} limit ${L}`, (s: string) => `increase ${s} credit limit to ${L}`, (s: string) => `${s} limit ${L.toLocaleString('en-IN')}`, (s: string) => `change ${s} credit limit to ${L / 1000}k`])
      { both('shopEdit', t(sv(shop)), `shop:${shop}:creditLimit=${L}`, pick(['owner', 'office'] as Role[])); add('shopEdit', t(sv(shop)), 'ask', 'salesman'); }
    for (const d of [7, 15, 30]) for (const t of [(s: string) => `${s} credit days ${d}`, (s: string) => `${s} ${d} days credit`, (s: string) => `give ${s} ${d} days credit`, (s: string) => `${s} credit period ${d} days`])
      both('shopEdit', t(sv(shop)), `shop:${shop}:creditDays=${d}`, pick(['owner', 'office'] as Role[]));
    for (const [t, v] of [[(s: string) => `${s} cash only`, 'yes'], [(s: string) => `${s} no credit`, 'yes'], [(s: string) => `make ${s} cash only`, 'yes'], [(s: string) => `stop credit for ${s}`, 'yes'], [(s: string) => `allow credit for ${s}`, 'no'], [(s: string) => `${s} give credit`, 'no']] as [(s: string) => string, string][])
      both('shopEdit', t(sv(shop)), `shop:${shop}:cashOnly=${v}`);
    for (const t of [(s: string) => `${s} gst 33ABCDE1234F1Z5`, (s: string) => `${s} gstin is 33ABCDE1234F1Z5`, (s: string) => `update ${s} gst number 33abcde1234f1z5`])
      add('shopEdit', t(sv(shop)), `shop:${shop}:gstin=33ABCDE1234F1Z5`);
    for (const a of ['14 Bazaar Street Tittakudi', 'No 5 Main Road Thozhudur', 'Near Bus Stand Avinangudi'])
      for (const t of [(s: string) => `${s} address is ${a}`, (s: string) => `change ${s} address to ${a}`, (s: string) => `${s} address ${a}`]) add('shopEdit', t(sv(shop)), `shop:${shop}:address=${a}`);
    for (const o of ['Senthil', 'Muthu Raja', 'Ravi']) for (const t of [(s: string) => `${s} owner name is ${o}`, (s: string) => `${s} owner ${o}`]) add('shopEdit', t(sv(shop)), `shop:${shop}:owner=${o}`);
    for (const ar of ['Thozhudur', 'Avinangudi', 'Vriddhachalam']) add('shopEdit', `${sv(shop)} area ${ar}`, `shop:${shop}:area=${ar}`);
    for (const d of ['monday', 'friday', 'Saturday']) for (const t of [(s: string) => `${s} beat ${d}`, (s: string) => `${s} beat day ${d}`, (s: string) => `change ${s} beat to ${d}`])
      add('shopEdit', t(sv(shop)), `shop:${shop}:beat=${d[0].toUpperCase()}${d.slice(1).toLowerCase()}`);
  }

  // ------------------------------------------------------------------------------------- undo
  for (const s of ['undo', 'undo last', 'undo that', 'undo it', 'undo the last entry', 'cancel last entry', 'delete the last entry', 'i made a mistake', 'that was wrong',
    'reverse that', 'revert', 'undo please', 'cancel that', 'delete that', 'undo last action', 'remove last entry', 'my mistake undo it', 'wrong entry', 'undo what i did', 'take back last entry'])
    { both('undo', s, 'undo'); add('undo', s, 'undo', 'office'); }
  return out;
}
