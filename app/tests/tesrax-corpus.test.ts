// TESRAX TRAINING SET — every way a distributor's team is likely to type a request, and what TESRAX must do.
// Short forms, typos, any word order, rupee signs, Tanglish. Each line is a permanent test: once TESRAX learns a
// phrase it can never forget it. Add a line whenever a real user is misunderstood.
//
// Expected result codes:
//   order:<shop>            a new-order table for that shop
//   payment:<shop>:<₹>[:mode]  a payment table          fix:<old>-><new>   a payment correction
//   return:<shop>  claim  newshop  schemes  expense:<₹>[:category]  leave  advance:<₹>
//   t:<table>               an answer table (Outstanding, Sales, Stock, Near, Cash, Load, Needs)
//   go:<screen>             opens that screen        export:<tally|gstr1|einvoice|claims>
//   help                    the help list            ask    a clear question back (never a wrong action)
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle, HELP_TEXT, type Reply } from '../src/core/engine';
import type { Role } from '../src/core/types';

type Case = [said: string, expect: string, role?: Role];

const CORPUS: Case[] = [
  // ---------------------------------------------------------------- orders (salesman / office)
  ['Murugan Stores 1 case surf, 24 good day', 'order:Murugan Stores'],
  ['murugan stores 2 case surf excel 1 dozen lifebuoy', 'order:Murugan Stores'],
  ['murugan 2cs surf, 12 pcs vim bar', 'order:Murugan Stores'],
  ['Murugan Stores - Surf Excel 12 pcs', 'order:Murugan Stores'],
  ['order for murugan stores surf 2 case', 'order:Murugan Stores'],
  ['2 case surf for murugan stores', 'order:Murugan Stores'],
  ['murugan stores: surf 1c, lifebuoy 48', 'order:Murugan Stores'],
  ['selvam kirana 10 red label tea and 5 marie gold', 'order:Selvam Kirana'],
  ['Selvam 24 goodday 12 bingo', 'order:Selvam Kirana'],
  ['kumar mart 5 atta', 'order:Kumar Mart'],
  ['kumar mart aashirvaad atta 5kg 10 bags', 'order:Kumar Mart'],
  ['annai super market 1 case dark fantasy', 'order:Annai Super Market'],
  ['annai 3 dozen clinic plus', 'order:Annai Super Market'],
  ['sri lakshmi traders 50 classmate notebook', 'order:Sri Lakshmi Traders'],
  ['lakshmi traders 2 cs surf', 'order:Sri Lakshmi Traders'],
  ['ganapathi stores 12 britannia cake', 'order:Ganapathi Stores'],
  ['velan provision vim bar 24', 'order:Velan Provision'],
  ['pennadam wholesale 5 case lifebuoy', 'order:Pennadam Wholesale Agency'],
  ['Murugan Stores 1 case surf, 24 good day', 'order:Murugan Stores', 'salesman'],
  ['murugan 2 surf 2 vim', 'order:Murugan Stores', 'salesman'],
  ['take order murugan stores 12 lifebuoy', 'order:Murugan Stores', 'salesman'],
  ['new order kumar mart 6 red label', 'order:Kumar Mart', 'salesman'],
  ['2 case surf', 'ask'], // which shop?

  // ---------------------------------------------------------------- payments / collection
  ['Murugan Stores paid 500', 'payment:Murugan Stores:500:cash'],
  ['murugan stores paid rs.2,450 cash', 'payment:Murugan Stores:2450:cash'],
  ['murugan paid ₹1500', 'payment:Murugan Stores:1500'],
  ['received 1500 from murugan stores', 'payment:Murugan Stores:1500'],
  ['received rs 800 from selvam', 'payment:Selvam Kirana:800'],
  ['collected 2000 from selvam kirana', 'payment:Selvam Kirana:2000'],
  ['selvam kirana 500 paid', 'payment:Selvam Kirana:500'],
  ['murugan gave 300 upi 432100000005', 'payment:Murugan Stores:300:upi'],
  ['murugan 500 gpay', 'payment:Murugan Stores:500:upi'],
  ['murugan stores paid 700 by phonepe', 'payment:Murugan Stores:700:upi'],
  ['kumar mart cheque 2507 no 456789', 'payment:Kumar Mart:2507:cheque'],
  ['kumar mart paid by cheque 2507', 'payment:Kumar Mart:2507:cheque'],
  ['payment 1000 from annai', 'payment:Annai Super Market:1000'],
  ['annai super market payment 1000', 'payment:Annai Super Market:1000'],
  ['cash 600 from lakshmi traders', 'payment:Sri Lakshmi Traders:600:cash'],
  ['got 450 from ganapathi', 'payment:Ganapathi Stores:450'],
  ['ganapathi stores amount 450 received', 'payment:Ganapathi Stores:450'],
  ['murugan 500 kuduthaanga', 'payment:Murugan Stores:500'],
  ['selvam 300 kuduthar', 'payment:Selvam Kirana:300'],
  ['selvam kirana paid 500 cash', 'payment:Selvam Kirana:500:cash', 'salesman'],
  ['kumar mart paid 1000', 'payment:Kumar Mart:1000', 'delivery'],
  ['murugan collected 2000 upi', 'payment:Murugan Stores:2000:upi', 'delivery'],

  // ---------------------------------------------------------------- corrections
  ['Adjust selvam bill it is not 500 , it is 300', 'fix:'],
  ['selvam paid 300 not 500', 'fix:'],
  ['change selvam payment 500 to 300', 'fix:'],
  ['wrong amount for selvam, it is 300', 'fix:'],

  // ---------------------------------------------------------------- returns, damage, claims
  ['selvam return 2 surf', 'return:Selvam Kirana'],
  ['selvam kirana returned 5 good day', 'return:Selvam Kirana'],
  ['return from murugan 1 case surf', 'return:Murugan Stores'],
  ['murugan sent back 6 vim bar', 'return:Murugan Stores'],
  ['5 good day damaged', 'claim'],
  ['2 surf leaked', 'claim'],
  ['3 lifebuoy expired', 'claim'],
  ['damaged 4 vim bar', 'claim'],
  ['broken 2 atta bags', 'claim'],
  ['10 marie gold damage', 'claim', 'godown'],

  // ---------------------------------------------------------------- shops & schemes
  ['new shop Ganesh Stores Pennadam 9876543210', 'newshop'],
  ['add shop Raja Traders Tittakudi', 'newshop'],
  ['add new retailer Bala Stores', 'newshop', 'salesman'],
  ['HUL Surf 5% off till 30 Nov', 'schemes'],
  ['Good Day buy 24 get 2', 'schemes'],
  ['scheme on surf 10% discount', 'schemes'],
  ['offer bingo 2% till month end', 'schemes'],

  // ---------------------------------------------------------------- expenses
  ['diesel 1500', 'expense:1500:Fuel'],
  ['van 1 diesel 1500', 'expense:1500:Fuel'],
  ['petrol 500 for bike', 'expense:500'],
  ['toll 80', 'expense:80'],
  ['rent 12000', 'expense:12000:Rent'],
  ['tea 60', 'expense:60'],
  ['spent 200 on tea', 'expense:200'],
  ['paid electricity bill 3200', 'expense:3200'],
  ['current bill 3200', 'expense:3200'],
  ['van repair 2500', 'expense:2500'],
  ['loading charges 400', 'expense:400'],
  ['diesel 1500', 'expense:1500:Fuel', 'delivery'],

  // ---------------------------------------------------------------- payroll by chat
  ['leave monday', 'leave', 'salesman'],
  ['i want leave tomorrow', 'leave', 'salesman'],
  ['sick leave today', 'leave', 'godown'],
  ['leave from 12/11 to 14/11 fever', 'leave', 'delivery'],
  ['Karthik leave tomorrow', 'leave'],
  ['advance 1000', 'advance:1000', 'salesman'],
  ['need advance 2000', 'advance:2000', 'delivery'],
  ['advance 2000 to ravi', 'advance:2000'],

  // ---------------------------------------------------------------- questions
  ['who owes more than 5000', 't:Outstanding'],
  ['outstanding', 't:Outstanding'],
  ['murugan outstanding', 't:Outstanding'],
  ['murugan balance', 't:Outstanding'],
  ['how much murugan has to pay', 't:Outstanding'],
  ['pending amount selvam', 't:Outstanding'],
  ['dues', 'go:outstanding'],              // the owner gets the full Outstanding screen
  ['who has not paid', 't:Outstanding'],
  ['kumar mart outstanding', 't:Outstanding', 'delivery'],
  ['today sales', 't:Sales'],
  ['sales today', 't:Sales'],
  ['how much sold today', 't:Sales'],
  ["today's billing", 't:Sales'],
  ['today summary', 't:Sales'],
  ['stock of surf', 't:Stock'],
  ['how much surf', 't:Stock'],
  ['surf stock', 't:Stock'],
  ['is good day available', 't:Stock'],
  ['how many lifebuoy left', 't:Stock'],
  ['stock of surf', 't:Stock', 'godown'],
  ['near expiry', 't:Near'],
  ["what's expiring", 't:Near'],
  ['items expiring soon', 't:Near'],
  ['cash in hand', 't:Cash'],
  ['how much cash do i have', 't:Cash'],
  ['cash with staff', 'go:cash'],
  ['load sheet', 't:Load'],
  ['load sheet', 'go:load', 'godown'],

  // ---------------------------------------------------------------- reports & files
  ['tally export', 'export:tally'],
  ['tally xml october', 'export:tally'],
  ['gstr1 october', 'export:gstr1'],
  ['gst return file', 'export:gstr1'],
  ['e-invoice', 'export:einvoice'],
  ['einvoice json', 'export:einvoice'],
  ['claim file', 'export:claims'],
  ['make claim for this month', 'export:claims'],

  // ---------------------------------------------------------------- open a screen
  ['delivery plan', 'go:plan'],
  ['plan delivery', 'go:plan'],
  ['plan route', 'go:plan'],
  ['orders received', 'go:orders-received'],
  ['approve orders', 'go:orders-received'],
  ['what needs my approval', 'go:orders-received'],
  ['pending approvals', 'go:orders-received'],
  ['live vans', 'go:live'],
  ['where is the van', 'go:live'],
  ['track van 1', 'go:live'],
  ['day close', 'go:dayclose'],
  ['close the day', 'go:dayclose'],
  ['p&l', 'go:pnl'],
  ['profit and loss', 'go:pnl'],
  ['how much profit this month', 'go:pnl'],
  ['cash flow', 'go:cashflow'],
  ['what do i owe companies', 'go:cashflow'],
  ['gst', 'go:gst'],
  ['fast movers', 'go:reports'],
  ['dead stock', 'go:reports'],
  ['shop wise sales', 'go:reports'],
  ['bank', 'go:bank'],
  ['expenses', 'go:expenses'],
  ['stock position', 'go:stock'],
  ['ageing', 'go:ageing'],
  ['vans and drivers', 'go:vans'],
  ['trip report', 'go:trips'],
  ['salary', 'go:salary'],
  ['salary sheet', 'go:salary'],
  ['attendance', 'go:today'],
  ['who is absent today', 'go:today'],
  ['billed bills', 'go:billed'],
  ['verify', 'go:verify'],
  ['new shops to approve', 'go:newshops'],
  ['targets', 'go:targets'],
  ['pick orders', 'go:pick', 'godown'],
  ['my trip', 'go:trip', 'delivery'],
  ['my beat', 'go:beat', 'salesman'],
  ['my day', 'go:myday', 'salesman'],
  ['delivery plan', 'ask', 'delivery'], // a driver asking for the owner's screen gets a clear answer

  // ---------------------------------------------------------------- ROUND 2: real-life messiness
  // capitals, spacing, typos, shorthand
  ['MURUGAN STORES 1 CASE SURF', 'order:Murugan Stores'],
  ['murugan  stores   2case surf', 'order:Murugan Stores'],
  ['murgan stores 2 case surf', 'order:Murugan Stores'],
  ['murugan stores 2 case surff', 'order:Murugan Stores'],
  ['murugan stores 2 case lifeboy', 'order:Murugan Stores'],
  ['murugan stores surf excel - 2 cases, good day - 3 dozen', 'order:Murugan Stores'],
  ['murugan stores 1cs surf 1cs vim', 'order:Murugan Stores'],
  ['murugan stores lifebuoy x 48', 'order:Murugan Stores'],
  ['murugan stores 48 nos lifebuoy', 'order:Murugan Stores'],
  ['murugan stores 5 boxes good day', 'order:Murugan Stores'],
  ['selvam kirana: 6 atta bags', 'order:Selvam Kirana'],
  ['send 2 case surf to murugan stores', 'order:Murugan Stores'],
  ['murugan stores wants 2 case surf', 'order:Murugan Stores'],
  ['murugan needs 24 good day', 'order:Murugan Stores'],
  ['pls book 12 vim for kumar mart', 'order:Kumar Mart'],
  // voice typing writes numbers as words
  ['murugan stores two case surf', 'order:Murugan Stores'],
  ['selvam kirana twelve lifebuoy and six vim', 'order:Selvam Kirana'],
  ['murugan stores paid five hundred', 'payment:Murugan Stores:500'],
  ['selvam paid one thousand five hundred', 'payment:Selvam Kirana:1500'],
  ['murugan paid 5k', 'payment:Murugan Stores:5000'],
  ['murugan paid 2.5k cash', 'payment:Murugan Stores:2500:cash'],
  ['murugan paid rs 500/-', 'payment:Murugan Stores:500'],
  ['murgan paid 500', 'payment:Murugan Stores:500'],
  ['MURUGAN PAID 500', 'payment:Murugan Stores:500'],
  ['rcvd 500 frm murugan', 'payment:Murugan Stores:500'],
  ['murugan pd 500', 'payment:Murugan Stores:500'],
  ['murugan 500 recieved', 'payment:Murugan Stores:500'],
  ['selvam settled 1755', 'payment:Selvam Kirana:1755'],
  ['kumar mart neft 2507', 'payment:Kumar Mart:2507'],
  ['annai paid 1000 gpay ref 123456789012', 'payment:Annai Super Market:1000:upi'],
  ['murugan 500 cash kuduthanga', 'payment:Murugan Stores:500:cash'],
  // corrections said differently
  ['murugan 500 is wrong it is 400', 'fix:'],
  ['selvam payment wrong, correct is 250', 'fix:'],
  // dues
  ['murugan pending', 't:Outstanding'],
  ['how much is pending from selvam', 't:Outstanding'],
  ['selvam kitta evlo baaki', 't:Outstanding'],
  ['what is murugan due', 't:Outstanding'],
  ['who is overdue', 't:Outstanding'],
  ['overdue shops', 't:Outstanding'],
  // sales & stock
  ['what did we sell today', 't:Sales'],
  ['today total sales', 't:Sales'],
  ['surf irukka', 't:Stock'],
  ['check stock surf', 't:Stock'],
  ['stock check good day', 't:Stock'],
  ['vim bar stock?', 't:Stock'],
  ['do we have red label tea', 't:Stock'],
  // expenses said differently
  ['1500 diesel', 'expense:1500:Fuel'],
  ['diesel 1500 van 1', 'expense:1500:Fuel'],
  ['paid 80 toll', 'expense:80:Toll'],
  ['tea 50 for staff', 'expense:50'],
  ['office rent 15000 paid', 'expense:15000:Rent'],
  ['hamali 300', 'expense:300'],
  // screens said differently
  ['show me fast movers', 'go:reports'],
  ['open day close', 'go:dayclose'],
  ['go to gst', 'go:gst'],
  ['outstanding list', 'go:outstanding'],
  ['profit', 'go:pnl'],
  ['salary sheet please', 'go:salary'],
  // payroll said differently
  ['tomorrow leave', 'leave', 'salesman'],
  ['i am on leave monday', 'leave', 'godown'],
  ['Ravi on leave tomorrow', 'leave'],
  ['leave pls', 'leave', 'delivery'],
  // help
  ['?', 'help'],
  ['what can u do', 'help'],
  ['options', 'help'],

  // ---------------------------------------------------------------- help, greetings, nonsense
  ['help', 'help'],
  ['what can you do', 'help'],
  ['hi', 'help'],
  ['hello', 'help'],
  ['good morning', 'help'],
  ['asdfgh', 'ask'],
  ['how are you', 'help'],
  ['Selvam Kirana hello 12 something 40', 'ask'],
];

// ---------------------------------------------------------------- what TESRAX did, as a code
let shopName = new Map<string, string>();
function code(r: Reply): string {
  const p = r.proposal;
  if (p) {
    const f = (k: string) => p.fields.find(x => x.key === k)?.value;
    const shop = shopName.get(String(f('shopId') ?? '')) ?? '?';
    switch (p.kind) {
      case 'order': return `order:${shop}`;
      case 'payment': return `payment:${shop}:${f('amount')}:${f('mode')}`;
      case 'paymentFix': return `fix:${f('was')}->${f('amount')}`;
      case 'return': return `return:${shop}`;
      case 'expense': return `expense:${p.rows[0]?.amount}:${p.rows[0]?.category}`;
      default: return p.kind;
    }
  }
  if (r.go) return `go:${r.go}`;
  if (r.table) {
    const n = r.table.name.toLowerCase();
    if (/^tally/.test(n)) return 'export:tally';
    if (/^gstr/.test(n)) return 'export:gstr1';
    if (/^e-?invoice/.test(n)) return 'export:einvoice';
    if (/^claim/.test(n)) return 'export:claims';
    return `t:${r.table.name.split(' ')[0]}`;
  }
  if (/couldn.t find a payment/i.test(r.text)) return 'fix:none'; // understood as a correction; no such payment in this data
  const act = r.actions?.map(a => a.label.toLowerCase()).join(' ') ?? '';
  if (/tally/.test(act)) return 'export:tally';
  if (/gstr/.test(act)) return 'export:gstr1';
  if (/e-invoice|einvoice/.test(act)) return 'export:einvoice';
  if (/claim/.test(act)) return 'export:claims';
  if (r.text === HELP_TEXT || r.text.endsWith(HELP_TEXT) && !/didn.t understand/i.test(r.text)) return 'help';
  if (r.tone === 'ok' && /leave/i.test(r.text)) return 'leave';
  if (r.tone === 'ok' && /advance/i.test(r.text)) return `advance:${(r.text.match(/₹(\d+)/) ?? [])[1]}`;
  if (r.tone === 'warn') return 'ask';
  return `other:${r.text.slice(0, 50)}`;
}

let ids: Record<Role, string>;
beforeAll(async () => {
  await seedDemo();
  shopName = new Map((await db.shops.toArray()).map(s => [s.id, s.name]));
  const staff = await db.staff.toArray();
  ids = Object.fromEntries(staff.map(s => [s.role, s.id])) as Record<Role, string>;
});

describe('TESRAX training set', () => {
  it(`understands all ${CORPUS.length} phrasings`, async () => {
    const wrong: string[] = [];
    for (const [said, want, role = 'owner'] of CORPUS) {
      setSession('demo', ids[role]);
      let got: string;
      try { got = code(await handle(said, [])); } catch (e) { got = `CRASH ${(e as Error).message}`; }
      if (!got.startsWith(want)) wrong.push(`  [${role}] "${said}"\n      expected ${want}\n      got      ${got}`);
    }
    const score = Math.round((CORPUS.length - wrong.length) / CORPUS.length * 1000) / 10;
    if (wrong.length) console.log(`TESRAX understood ${CORPUS.length - wrong.length}/${CORPUS.length} (${score}%). Misunderstood:\n${wrong.join('\n')}`);
    expect(wrong, `${score}% understood`).toEqual([]);
  });
});
