// TESRAX changes things after the fact: an order, a bill, a payment, an expense, a stock count, a shop's details,
// a product's rate, or the last thing saved. Each one is a table the person checks and approves with ✓. Nothing
// changes before that, and every change is saved through the same laws (guard) and can be undone.
import { db, daysFrom, newId, session } from './db';
import { bestProduct, hasWord as has, norm, parseItemLines, toPieces } from './match';
import { orderRow, productOptions, shopOptions, type Row } from './proposals';
import { r2 } from './ledger';
import { orderBlock } from './pipeline';
import type { Reply } from './engine';
import type { Order, Product, Role, Shop } from './types';

export interface ModCtx {
  text: string;       // normalised
  textIn: string;     // cleaned, punctuation kept (decimals, GSTIN)
  shop?: Shop;
  rest: string;       // textIn without the shop's name
  role: Role;
  products: Product[];
  isExpense: boolean;
  isDamage: boolean;
  fixOf: (t: string) => { old?: number; next: number } | null;
}

const CANCEL = ['cancel', 'cancelled', 'delete', 'deleted', 'remove', 'drop', 'scrap', 'void', 'discard', 'no need', 'not needed', 'dont want', 'don t want', 'do not want', 'call off', 'take out', 'erase', 'strike off', 'undo', 'revert', 'withdraw'];
const EDIT = ['change', 'changed', 'edit', 'update', 'modify', 'correct', 'correction', 'alter', 'revise', 'set', 'make it', 'make', 'increase', 'decrease', 'reduce', 'add', 'extra', 'more', 'less', 'minus', 'instead', 'replace', 'should be', 'wrong', 'mistake', 'actually', 'fix', 'adjust', 'only'];
const ORDER = ['order', 'ஆர்டர்'];
const PAY = ['payment', 'collection', 'receipt', 'paid', 'received', 'cheque', 'chq', 'upi', 'gpay', 'phonepe', 'money'];
const BOUNCE = ['bounce', 'bounced', 'reversed', 'reversal', 'payment failed', 'upi failed', 'failed', 'fail', 'upi return', 'not credited', 'not received in bank', 'dishonoured', 'dishonored', 'cheque returned', 'cheque return', 'returned cheque', 'cheque bounce', 'chq bounce', 'chq returned'];
const BILL = ['bill', 'invoice', 'inv'];
const NEW_SHOP = ['new shop', 'add shop', 'new retailer', 'add retailer', 'new customer', 'add customer'];
const OPEN: Order['status'][] = ['new', 'needs_ok', 'approved'];
const office = (r: Role) => r === 'owner' || r === 'office';
const deny = (): Reply => ({ text: 'Your role cannot do this. Ask the owner.', tone: 'warn' });

/** amounts written in the message: "₹2,450", "rs.500", "9.5" (phone numbers and GSTINs are not amounts) */
export function numbersIn(s: string): number[] {
  const t = s.toLowerCase().replace(/(\d),(\d{3})\b/g, '$1$2').replace(/₹|\brs\.?\s*|\binr\b/g, ' ');
  return [...t.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w])/g)].map(m => m[1]).filter(x => x.length < 10).map(Number);
}

export function categoryOf(t: string) {
  if (/\b(diesel|petrol|fuel)\b|டீசல்|பெட்ரோல்/.test(t)) return 'Fuel';
  if (/\b(hire|hired)\b/.test(t) || (/\b(auto|tempo|lorry|van|vehicle)\b/.test(t) && /\brent\b/.test(t))) return 'Van hire';
  if (/\btoll\b/.test(t)) return 'Toll';
  if (/\b(repair|service|tyre|tire|puncture|maintenance)s?\b/.test(t)) return 'Van repair';
  if (/\b(electricity|eb|current|power)\b/.test(t)) return 'Electricity';
  if (/\brent\b|வாடகை/.test(t)) return 'Rent';
  if (/\bsalary\b|சம்பளம்/.test(t)) return 'Salary';
  if (/\bbatta\b/.test(t)) return 'Batta';
  if (/\b(hamali|coolie|labour|labor|wages|loading|unloading)\b/.test(t)) return 'Loading & labour';
  if (/\b(tea|snacks|food|lunch|coffee)\b/.test(t)) return 'Tea & food';
  if (/\b(internet|wifi|phone|mobile|recharge)\b/.test(t)) return 'Phone & internet';
  return 'Other';
}

function isUndo(t: string) {
  if (/^(please )?(undo|revert)( (it|that|this|the|my|last|previous|latest|one|1|entry|action|save|change|thing|record|please|what i did|just now|now))*$/.test(t)) return true;
  if (/^(please )?(cancel|delete|remove|reverse|scrap|take back)( (it|that|this|the|my))* (last|previous|latest) (entry|one|thing|action|save|change|record|saved)( please)?$/.test(t)) return true;
  if (/^(please )?(cancel|delete|reverse|take back) (that|it|this)( please| now)?$/.test(t)) return true;
  if (/^(that|it|this) (was|is) (wrong|a mistake|mistake)( please)?( (undo|cancel|remove|delete) (it|that))?$/.test(t)) return true;
  if (/^(i made a mistake|my mistake|wrong entry|mistake|entry wrong|last entry wrong|last entry is wrong)( please)?( (undo|cancel|remove|delete)( it| that)?)?$/.test(t)) return true;
  return /\b(undo|revert)\b/.test(t) && !/\d{2,}/.test(t);
}

// ------------------------------------------------------------------------------------------------------------
export async function modifyIntent(c: ModCtx): Promise<Reply | null> {
  const t = c.text;
  if (has(t, NEW_SHOP)) return null;
  const cancel = has(t, CANCEL);
  const edit = has(t, EDIT);
  const orderWord = has(t, ORDER);

  // the last thing saved
  if (isUndo(t) && !orderWord && !has(t, PAY) && !has(t, BILL) && !c.isExpense && !c.shop) return undoLast(c.role);

  // orders: said with the word "order", or a change to the open order of a named shop
  if (orderWord && (cancel || edit || /\bnot \d/.test(t) || /\b(no|without) [a-z]/.test(t))) return orderChange(c, true);
  if (c.shop) { const r = await shopEdit(c); if (r) return r; }
  if (!c.shop && (cancel || edit) && /\b(credit limit|credit days|limit|phone|mobile|address|gstin|cash only)\b/.test(t))
    return { text: 'Which shop? Say it with the shop name, e.g. "Murugan Stores credit limit 30000".', tone: 'warn' };
  if (c.shop && !c.isDamage && (cancel || edit) && !has(t, PAY) && !has(t, BILL) && !has(t, BOUNCE)) {
    const r = await orderChange(c, false); if (r) return r;
  }

  // bills
  if (cancel && has(t, BILL) && !c.isExpense && !has(t, ['payment']) && (c.shop || /\d{2,}/.test(t))) return billCancel(c);

  // payments
  if (has(t, BOUNCE) || (cancel && (has(t, PAY) || (c.shop && numbersIn(c.rest).length)))) return paymentCancel(c, has(t, BOUNCE));

  // expenses: "diesel was 1400 not 1500", "delete the tea expense 120"
  if (c.isExpense && !c.shop && (cancel || c.fixOf(t) || (edit && numbersIn(c.textIn).length))) return expenseFix(c, cancel);

  // stock counts: "surf stock is 240 not 288", "physical count surf 240", "6 surf short"
  if (!c.shop && !c.isDamage && !c.isExpense) { const r = await stockFix(c); if (r) return r; }

  // a product's rate / MRP / case size / GST
  if (!c.shop) { const r = await productEdit(c); if (r) return r; }

  return null;
}

// ------------------------------------------------------------------------------------------------------------
// UNDO the last thing this person saved today
async function undoLast(_role: Role): Promise<Reply> {
  const me = session().userId;
  const mine = (await db.audit.toArray()).filter(a => a.by === me && !a.undone && a.at >= daysFrom(-1) && !/^Demo /.test(a.action) && a.table !== 'audit');
  const last = mine.sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!last) return { text: "There's nothing of yours to undo from today.", tone: 'warn' };
  const entries = mine.filter(a => a.batchId === last.batchId && a.table !== 'settings');
  const label = last.action.split(':')[0];
  const rows: Row[] = entries.map(e => ({ table: e.table, change: e.action.split(': ').slice(1).join(': ') || e.action, what: describe(e.table, e.after) }));
  return {
    text: `The last thing you saved was "${label}" at ${last.at.slice(11, 16)}. Tap ✓ to undo it.`,
    proposal: {
      id: newId(), kind: 'undo', title: `Undo: ${label}`,
      fields: [{ key: 'label', label: 'Saved', value: label, readonly: true }, { key: 'at', label: 'At', value: last.at.slice(0, 16).replace('T', ' '), readonly: true }],
      columns: [{ key: 'table', label: 'Record', readonly: true, width: 90 }, { key: 'change', label: 'Change', readonly: true, width: 150 }, { key: 'what', label: 'Details', readonly: true, width: 180 }],
      rows, meta: { batchId: last.batchId },
    },
  };
}
function describe(table: string, rec: unknown): string {
  const r = (rec ?? {}) as Record<string, unknown>;
  if (table === 'payments') return `₹${r.amount} ${r.mode ?? ''}`;
  if (table === 'expenses') return `₹${r.amount} ${r.category ?? ''}`;
  if (table === 'invoices') return `${r.number ?? ''} ₹${r.total ?? ''}`;
  if (table === 'orders') return `${(r.lines as unknown[] | undefined)?.length ?? 0} item(s), ${r.status ?? ''}`;
  if (table === 'batches') return `lot ${r.batch ?? ''}: ${r.qty ?? ''} pcs`;
  return String(r.name ?? r.number ?? r.category ?? '');
}

// product names that contain a command word ("Clinic Plus") are joined with "_" so "plus" is not read as "add";
// norm() turns "_" back into a space when the item is parsed
const KEYWORDS = /\b(plus|more|extra|add|less|no|only|set|make|change|cut|short|drop|count|stock)\b/;
const masks = new WeakMap<Product[], string[]>();
function maskProducts(t: string, products: Product[]) {
  let ph = masks.get(products);
  if (!ph) {
    ph = [...new Set(products.flatMap(p => [p.name, ...p.aliases]).map(norm).filter(x => x.includes(' ') && KEYWORDS.test(x)))].sort((a, b) => b.length - a.length);
    masks.set(products, ph);
  }
  for (const x of ph) t = t.replace(new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), x.replace(/ /g, '_'));
  return t;
}

// ------------------------------------------------------------------------------------------------------------
// ORDERS
type Op = { product: Product; mode: 'set' | 'add' | 'sub' | 'remove'; qty?: number };
const UNIT = '(?:case|cases|cs|c|box|boxes|pcs|pc|pieces|piece|dozen|dz|nos)';

/** "change surf to 3 case, remove vim and add 2 dozen good day" → one change per product */
export function orderOps(text: string, products: Product[]): Op[] {
  const t = ` ${maskProducts(norm(text), products)} `;
  const global = /\b(add|more|extra|additional|another)\b|\bplus \d/.test(t) ? 'add' : /\b(reduce|decrease|less|minus)\b/.test(t) && !/\bto \d/.test(t) ? 'sub' : null;
  const clauses = t.replace(/\b(from|to)\b(?= \w+ order)/g, ' ').split(/,|;|\band\b|\balso\b|\bthen\b|&/).map(x => ` ${x.trim()} `).filter(x => x.trim());
  const ops: Op[] = [];
  for (let cl of clauses) {
    let mode: Op['mode'] | null = null;
    if (/\b(remove|delete|drop|cancel|exclude|take out|without|scrap|no need|not needed|dont want|don t want)\b/.test(cl) || /\b(no|without) (?=[a-z])/.test(cl) || /\b0\b/.test(cl)) mode = 'remove';
    else if (/\b(to|into|as)\s+\d/.test(cl) || /\bnot \d/.test(cl) || /\b(should be|only)\b/.test(cl)) mode = 'set';
    else if (/\b(reduce|decrease|less|minus|cut|short)\b/.test(cl)) mode = 'sub';
    else if (/\b(add|more|extra|additional|another|increase)\b|\bplus \d/.test(cl)) mode = 'add';
    else if (/\b(change|make|set|update|edit|modify|correct|instead|actually|replace)\b/.test(cl)) mode = 'set';
    mode ??= global ?? 'set';
    cl = cl
      .replace(new RegExp(`\\bfrom \\d+(?:\\.\\d+)? ?${UNIT}? (?=to )`, 'g'), ' ')
      .replace(new RegExp(`\\bnot \\d+(?:\\.\\d+)? ?${UNIT}?\\b`, 'g'), ' ')
      .replace(/\bplus (?=\d)/g, ' ')
      .replace(/\b(order|orders|the|in|from|of|for|his|her|their|my|last|latest|previous|today|todays|existing|current|same|that|this|booked|placed|please|it|is|its|it s|to|into|as|by|only|should be|remove|delete|drop|cancel|exclude|take out|without|scrap|no need|not needed|dont want|don t want|reduce|decrease|less|minus|cut|short|add|more|extra|additional|another|increase|change|make|set|update|edit|modify|correct|instead|actually|replace|qty|quantity|wrong|mistake|was|typo|actual|cash|upi|rs|rupees|amount|amt|payment|nu|ah|changed|pcs only)\b/g, ' ')
      .replace(/\b(no|without) (?=[a-z])/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cl) continue;
    const lines = parseItemLines(cl);
    if (lines.length) {
      for (const l of lines) {
        const p = bestProduct(products, l.productText).product; if (!p) continue;
        ops.push({ product: p, mode, qty: toPieces(l.qty, l.unit, p) });
      }
      continue;
    }
    const words = cl.replace(new RegExp(`\\b\\d+(?:\\.\\d+)?\\b|\\b${UNIT}\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
    const p = words ? bestProduct(products, words).product : undefined;
    if (p && (mode === 'remove' || /\b0\b/.test(cl))) ops.push({ product: p, mode: 'remove' });
  }
  return ops;
}

async function findOrder(shopId: string | undefined, role: Role): Promise<Order | undefined> {
  const me = session().userId;
  let os = (await db.orders.toArray()).filter(o => o.date >= daysFrom(-3) && o.status !== 'cancelled');
  if (shopId) os = os.filter(o => o.shopId === shopId);
  else { const mine = os.filter(o => o.salesmanId === me); os = mine.length || !office(role) ? mine : os; }
  os.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return os.find(o => OPEN.includes(o.status) && !orderBlock(o, role, me)) ?? os.find(o => OPEN.includes(o.status)) ?? os[0];
}

async function orderChange(c: ModCtx, explicit: boolean): Promise<Reply | null> {
  if (!['owner', 'office', 'salesman'].includes(c.role)) return explicit ? deny() : null;
  const me = session().userId;
  if (!c.shop && !/\b(my|last|latest|previous|that|this|same)\b/.test(c.text)) return { text: 'Which shop\'s order? Say it with the shop name, e.g. "change Murugan Stores order surf to 3 case".', tone: 'warn' };
  const order = await findOrder(c.shop?.id, c.role);
  const ops = orderOps(c.shop ? c.rest : c.textIn, c.products);
  const addOnly = ops.length > 0 && ops.every(o => o.mode === 'add');
  const cancelAll = !ops.length && has(c.text, CANCEL);
  if (!explicit && !ops.length) return null;
  const shopName = c.shop?.name ?? (order ? (await db.shops.get(order.shopId))?.name : '') ?? '';
  if (!order || (addOnly && orderBlock(order, c.role, me))) {
    if (addOnly || (!explicit)) return null; // nothing open to add to: it is simply a new order
    return { text: `I couldn't find an open order${shopName ? ` for ${shopName}` : ' of yours'} in the last 3 days. To book one, say "${shopName || 'Murugan Stores'} 2 case Surf".`, tone: 'warn' };
  }
  const block = orderBlock(order, c.role, me);
  if (block) return { text: `Can't change this order: ${block}`, tone: 'warn' };
  const shop = (await db.shops.get(order.shopId))!;
  const products = new Map(c.products.map(p => [p.id, p]));
  const schemes = await db.schemes.toArray();
  const statusText = order.status === 'approved' ? 'approved, at the godown' : 'waiting for approval';
  const header = [
    { key: 'shopId', label: 'Shop', type: 'select' as const, options: await shopOptions(), value: shop.id, readonly: true },
    { key: 'status', label: 'Order', value: `${order.date} · ${statusText}`, readonly: true },
  ];
  if (cancelAll) {
    const rows: Row[] = [];
    for (const l of order.lines) { const p = products.get(l.productId); if (p) rows.push({ productId: p.id, qty: l.qty, amount: (await orderRow(p, l.qty, '', schemes, l.rate)).amount }); }
    return {
      text: `Cancel ${shop.name}'s order of ${order.date} (${order.lines.length} item${order.lines.length > 1 ? 's' : ''})? Tap ✓ to cancel it.`,
      proposal: {
        id: newId(), kind: 'orderCancel', title: 'Cancel order',
        fields: [...header, { key: 'reason', label: 'Reason', value: 'Shop cancelled' }],
        columns: [
          { key: 'productId', label: 'Product', type: 'select', options: await productOptions(), readonly: true, width: 170 },
          { key: 'qty', label: 'Qty (pcs)', type: 'number', readonly: true, width: 75 },
          { key: 'amount', label: 'Amount', type: 'number', readonly: true, width: 85 },
        ],
        rows, meta: { orderId: order.id },
      },
    };
  }
  // apply the changes to the order's lines
  const qty = new Map(order.lines.map(l => [l.productId, l.qty]));
  const rate = new Map(order.lines.map(l => [l.productId, l.rate]));
  const notIn: string[] = [];
  const changes: string[] = [];
  for (const op of ops) {
    const was = qty.get(op.product.id) ?? 0;
    const now = op.mode === 'remove' ? 0 : op.mode === 'set' ? op.qty! : op.mode === 'add' ? was + op.qty! : Math.max(0, was - op.qty!);
    if (!qty.has(op.product.id) && (op.mode === 'remove' || op.mode === 'sub')) { notIn.push(op.product.name); continue; }
    qty.set(op.product.id, now);
    changes.push(now === 0 ? `${op.product.name} removed` : `${op.product.name} ${was} → ${now}`);
  }
  const rows: Row[] = [];
  for (const [pid, q] of qty) {
    const p = products.get(pid); if (!p) continue;
    const was = order.lines.find(l => l.productId === pid)?.qty ?? 0;
    rows.push({ ...(await orderRow(p, q, '', schemes, rate.get(pid) ?? p.rate)), was });
  }
  const msg = changes.length
    ? `${shop.name}'s order: ${changes.join(', ')}.` + (notIn.length ? ` ${notIn.join(', ')} is not in this order.` : '') + ' Check and tap ✓.'
    : notIn.length ? `${notIn.join(', ')} is not in ${shop.name}'s order. Change the quantities in the table.` : `${shop.name}'s order is below. Change the quantities and tap ✓ (0 removes an item).`;
  return {
    text: msg,
    proposal: {
      id: newId(), kind: 'orderEdit', title: 'Change order', fields: header,
      columns: [
        { key: 'productId', label: 'Product', type: 'select', options: (await productOptions()).filter(o => o.value !== '__new'), width: 170 },
        { key: 'was', label: 'Was', type: 'number', readonly: true, width: 60 },
        { key: 'qty', label: 'Qty (pcs)', type: 'number', width: 75 },
        { key: 'rate', label: 'Rate', type: 'number', width: 75 },
        { key: 'free', label: 'Free', type: 'number', readonly: true, width: 55 },
        { key: 'amount', label: 'Amount', type: 'number', readonly: true, width: 85 },
        { key: 'stock', label: 'Stock', readonly: true, width: 70 },
      ],
      rows, meta: { orderId: order.id },
    },
  };
}

// ------------------------------------------------------------------------------------------------------------
// BILLS (owner / office): "cancel murugan bill", "cancel bill 12"
async function billCancel(c: ModCtx): Promise<Reply> {
  if (!office(c.role)) return deny();
  const nums = numbersIn(c.shop ? c.rest : c.textIn);
  let invs = (await db.invoices.toArray()).filter(i => !i.cancelled && i.date >= daysFrom(-90));
  if (c.shop) invs = invs.filter(i => i.shopId === c.shop!.id);
  const byNo = invs.filter(i => nums.some(n => Number(i.number.match(/(\d+)$/)?.[1]) === n && Number.isInteger(n)));
  const byAmt = invs.filter(i => nums.some(n => Math.abs(i.total - n) < 1));
  const pool = byNo.length ? byNo : byAmt.length ? byAmt : nums.length && !c.shop ? [] : invs;
  const inv = pool.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
  if (!inv) return { text: `I couldn't find a bill to cancel${c.shop ? ` for ${c.shop.name}` : ''}${nums.length ? ` matching ${nums.join(', ')}` : ''}. Open Bill → Billed to pick it.`, tone: 'warn' };
  const shop = (await db.shops.get(inv.shopId))!;
  const products = new Map(c.products.map(p => [p.id, p]));
  return {
    text: `Cancel bill ${inv.number} for ${shop.name} (₹${inv.total}, ${inv.date})? The stock goes back to the godown. Give a reason and tap ✓.`,
    proposal: {
      id: newId(), kind: 'billCancel', title: 'Cancel bill',
      fields: [
        { key: 'shopId', label: 'Shop', type: 'select', options: await shopOptions(), value: shop.id, readonly: true },
        { key: 'number', label: 'Bill', value: inv.number, readonly: true },
        { key: 'total', label: 'Total ₹', type: 'number', value: inv.total, readonly: true },
        { key: 'reason', label: 'Reason', value: '' },
      ],
      columns: [
        { key: 'product', label: 'Product', readonly: true, width: 170 },
        { key: 'qty', label: 'Qty (pcs)', type: 'number', readonly: true, width: 75 },
        { key: 'total', label: 'Amount', type: 'number', readonly: true, width: 85 },
      ],
      rows: inv.lines.map(l => ({ product: products.get(l.productId)?.name ?? '', qty: l.qty, total: l.total })),
      meta: { invoiceId: inv.id },
    },
  };
}

// ------------------------------------------------------------------------------------------------------------
// PAYMENTS: "cancel selvam payment", "delete the 500 from murugan", "murugan cheque bounced"
async function paymentCancel(c: ModCtx, bounce: boolean): Promise<Reply> {
  if (!['owner', 'office', 'salesman', 'delivery'].includes(c.role)) return deny();
  const me = session().userId;
  const amt = numbersIn(c.shop ? c.rest : c.textIn).filter(n => n > 0);
  if (!c.shop && (bounce || (!amt.length && office(c.role)))) return { text: `Which shop's ${bounce ? 'cheque' : 'payment'}? Say it with the shop name, e.g. "cancel Murugan Stores payment 2000".`, tone: 'warn' };
  const pays = (await db.payments.toArray())
    .filter(p => p.status === 'ok' && p.date >= daysFrom(bounce ? -45 : -7) && (c.shop ? p.shopId === c.shop.id : (office(c.role) ? true : p.collectedBy === me)))
    .filter(p => !bounce || p.mode !== 'cash')
    .filter(p => !amt.length || amt.some(a => Math.abs(p.amount - a) < 0.01))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const p = pays[0];
  if (!p) return { text: `I couldn't find a payment to cancel${amt.length ? ` of ₹${amt[0]}` : ''}${c.shop ? ` for ${c.shop.name}` : ''}${bounce ? ' (cheque or UPI)' : ''} in the last ${bounce ? 45 : 7} days.`, tone: 'warn' };
  if (!office(c.role) && (p.collectedBy !== me || p.settled)) return { text: "Can't cancel this payment: it is already with the office. Ask the owner.", tone: 'warn' };
  if (p.bankLineId) return { text: "Can't cancel this payment here: it is matched to the bank statement. Unmatch it in Accounts → Bank first.", tone: 'warn' };
  const shop = (await db.shops.get(p.shopId))!;
  const invs = new Map((await db.invoices.where('shopId').equals(p.shopId).toArray()).map(i => [i.id, i.number]));
  const rows: Row[] = p.allocations.map(a => ({ bill: invs.get(a.invoiceId) ?? '', amount: a.amount }));
  if (p.advance > 0.5) rows.push({ bill: 'Advance', amount: p.advance });
  if (!rows.length) rows.push({ bill: '—', amount: p.amount });
  return {
    text: `Cancel the ₹${p.amount} ${p.mode} payment from ${shop.name} on ${p.date}? These bills will be open again. Tap ✓.`,
    proposal: {
      id: newId(), kind: 'paymentCancel', title: bounce ? 'Cheque bounced' : 'Cancel payment',
      fields: [
        { key: 'shopId', label: 'Shop', type: 'select', options: await shopOptions(), value: shop.id, readonly: true },
        { key: 'amount', label: 'Amount ₹', type: 'number', value: p.amount, readonly: true },
        { key: 'mode', label: 'Mode', value: p.mode, readonly: true },
        { key: 'date', label: 'Date', value: p.date, readonly: true },
        { key: 'reason', label: 'Reason', value: bounce ? 'Cheque bounced' : 'Entered by mistake' },
      ],
      columns: [{ key: 'bill', label: 'Was paid to', readonly: true, width: 150 }, { key: 'amount', label: '₹', type: 'number', readonly: true, width: 90 }],
      rows, meta: { paymentId: p.id },
    },
  };
}

// ------------------------------------------------------------------------------------------------------------
// EXPENSES
async function expenseFix(c: ModCtx, cancel: boolean): Promise<Reply> {
  const me = session().userId;
  const vans = await db.vans.toArray();
  const t = c.text.replace(/\b(van|auto|vehicle|lorry|tempo|bike)\s*\d+\b/g, ' ');
  const fix = c.fixOf(t);
  const del = cancel && (!fix || fix.old == null);
  const cat = categoryOf(c.text);
  const amt = numbersIn(c.textIn.replace(/\b(van|auto|vehicle|lorry|tempo|bike)\s*\d+\b/gi, ' '));
  const old = fix ? fix.old : amt[0];
  const list = (await db.expenses.toArray())
    .filter(e => e.amount > 0 && e.date >= daysFrom(-7) && (cat === 'Other' || e.category === cat) && (old == null || Math.abs(e.amount - old) < 0.01) && (office(c.role) || e.by === me))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const e = list[0];
  if (!e) return { text: `I couldn't find ${cat === 'Other' ? 'an' : `a ${cat.toLowerCase()}`} expense${old != null ? ` of ₹${old}` : ''}${office(c.role) ? '' : ' entered by you'} in the last 7 days.`, tone: 'warn' };
  const next = del ? e.amount : fix?.next ?? e.amount;
  const cats = ['Fuel', 'Toll', 'Van repair', 'Van hire', 'Batta', 'Salary', 'Rent', 'Electricity', 'Tea & food', 'Loading & labour', 'Phone & internet', 'Other'];
  return {
    text: del ? `Delete the ₹${e.amount} ${e.category} expense of ${e.date}? Tap ✓.` : `Correcting the ${e.category} expense of ${e.date}: ₹${e.amount} → ₹${next}. Check and tap ✓.`,
    proposal: {
      id: newId(), kind: 'expenseFix', title: del ? 'Delete expense' : 'Correct expense',
      fields: [
        { key: 'action', label: 'Do', type: 'select', value: del ? 'delete' : 'edit', options: [{ value: 'edit', label: 'Correct it' }, { value: 'delete', label: 'Delete it' }] },
        { key: 'was', label: 'Was ₹', type: 'number', value: e.amount, readonly: true },
      ],
      columns: [
        { key: 'date', label: 'Date', type: 'date', width: 120 },
        { key: 'category', label: 'Category', type: 'select', options: [...new Set([...cats, e.category])].map(x => ({ value: x, label: x })), width: 120 },
        { key: 'amount', label: 'Amount ₹', type: 'number', width: 90 },
        { key: 'vanId', label: 'Van', type: 'select', options: [{ value: '', label: '—' }, ...vans.map(v => ({ value: v.id, label: v.name }))], width: 100 },
        { key: 'note', label: 'Note', width: 200 },
      ],
      rows: [{ date: e.date, category: e.category, amount: next, vanId: e.vanId ?? '', note: e.note ?? '' }],
      meta: { expenseId: e.id },
    },
  };
}

// ------------------------------------------------------------------------------------------------------------
// STOCK COUNTS (owner / office / godown)
const STOCK_WORDS = ['stock', 'count', 'counted', 'physical', 'shelf', 'godown', 'actual', 'short', 'shortage', 'excess', 'missing', 'found', 'closing stock', 'physical stock'];
async function stockFix(c: ModCtx): Promise<Reply | null> {
  const t = maskProducts(c.text, c.products);
  // "surf stock 80", or how it is said on the floor: "surf 80 only", "red label 4 reduce", "cake 12 extra"; the godown may just say "vim 700"
  const floor = /\b(only|reduce|excess|extra|short|shortage|missing|less|count|counted)\b/.test(t) || /\bnot \d/.test(t);
  if (!has(t, STOCK_WORDS) && !floor && c.role !== 'godown') return null;
  if (/\b(rate|price|mrp|size|per case|gst|order|orders|paid|payment|bill)\b/.test(t)) return null;
  if (/\?/.test(c.textIn) || /\b(how|what|which|available|enough|do we have|is there|any|check|report|list|position|value|alert|alerts|old|near|expiry|ageing|aging)\b/.test(t)) return null;
  const nums = numbersIn(c.textIn);
  if (!nums.length) return null;
  const mode: 'set' | 'add' | 'sub' = /\b(short|shortage|missing|less|reduce|minus|lost|stolen)\b/.test(t) ? 'sub' : /\b(excess|extra|found extra|add|more)\b|\bplus \d/.test(t) ? 'add' : 'set';
  const cleaned = t
    .replace(new RegExp(`\\b(not|was|from) \\d+(?: ${UNIT})?\\b`, 'g'), ' ')
    .replace(/\b(stock|stocks|count|counted|physical|shelf|godown|in|actual|is|are|the|of|only|set|to|correct|correction|adjust|update|change|mismatch|wrong|should be|it|its|now|short|shortage|excess|extra|missing|found|add|plus|more|less|reduce|minus|lost|stolen|closing|by|we|have|has|there|qty|quantity|please|system|shows|says|but)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const lines = parseItemLines(cleaned);
  const words = cleaned.replace(new RegExp(`\\b\\d+(?:\\.\\d+)?\\b|\\b${UNIT}\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  const product = (lines[0] && bestProduct(c.products, lines[0].productText).product) || (words ? bestProduct(c.products, words).product : undefined);
  if (!product) return null;
  if (!['owner', 'office', 'godown'].includes(c.role)) return deny();
  const fixNext = c.fixOf(t)?.next;
  let said = lines[0] ? toPieces(lines[0].qty, lines[0].unit, product) : (fixNext ?? nums[0]);
  const loose = cleaned.match(new RegExp(`\\b(\\d+) (?:case|cases|cs|box) (\\d+) ?(?:pcs|pieces|nos|loose)?\\b`));
  if (loose && lines[0]?.unit === 'case') said = Number(loose[1]) * product.caseSize + Number(loose[2]); // "10 case + 30 pcs"
  const lots = (await db.batches.where('productId').equals(product.id).toArray()).sort((a, b) => a.expiry.localeCompare(b.expiry));
  if (!lots.length) return { text: `${product.name} has no lot in stock yet. Add it with a purchase bill first.`, tone: 'warn' };
  const system = lots.reduce((a, b) => a + b.qty, 0);
  const target = mode === 'set' ? said : mode === 'add' ? system + said : Math.max(0, system - said);
  // a shortage comes off the oldest lots first; extra pieces go to the newest lot
  const counted = new Map(lots.map(b => [b.id, b.qty]));
  let diff = target - system;
  if (diff > 0) counted.set(lots[lots.length - 1].id, lots[lots.length - 1].qty + diff);
  for (const b of lots) { if (diff >= 0) break; const take = Math.min(b.qty, -diff); counted.set(b.id, b.qty - take); diff += take; }
  const rows: Row[] = lots.filter(b => b.qty > 0 || counted.get(b.id)! > 0 || b === lots[lots.length - 1]).map(b => ({ batchId: b.id, batch: b.batch, expiry: b.expiry, system: b.qty, counted: counted.get(b.id)! }));
  const d = target - system;
  return {
    text: `${product.name}: system shows ${system} pcs, counted ${target} (${d >= 0 ? '+' : ''}${d}). Check the lots and tap ✓.`,
    proposal: {
      id: newId(), kind: 'stockFix', title: 'Stock count',
      fields: [
        { key: 'productId', label: 'Product', type: 'select', options: await productOptions(), value: product.id, readonly: true },
        { key: 'reason', label: 'Reason', value: mode === 'set' ? 'Physical count' : mode === 'add' ? 'Found extra' : 'Shortage' },
      ],
      columns: [
        { key: 'batch', label: 'Lot', readonly: true, width: 80 },
        { key: 'expiry', label: 'Expiry', readonly: true, width: 100 },
        { key: 'system', label: 'System', type: 'number', readonly: true, width: 75 },
        { key: 'counted', label: 'Counted', type: 'number', width: 80 },
      ],
      rows, meta: { target },
    },
  };
}

// ------------------------------------------------------------------------------------------------------------
// PRODUCTS (owner / office): "surf rate 115", "change surf mrp from 140 to 145", "good day case size 96"
const P_FIELDS: { key: 'rate' | 'mrp' | 'purchaseRate' | 'caseSize' | 'gst'; label: string; rx: RegExp }[] = [
  { key: 'purchaseRate', label: 'Buying rate', rx: /\b(purchase rate|purchase price|buying rate|buying price|buy rate|buy price|landing cost|landing price|landing rate|landing|cost price|cost)\b/ },
  { key: 'caseSize', label: 'Pcs per case', rx: /\b(case size|pcs per case|pieces per case|pcs in a case|pieces in a case|per case|case qty|case quantity|in one case|in a case)\b/ },
  { key: 'mrp', label: 'MRP', rx: /\bmrp\b/ },
  { key: 'gst', label: 'GST %', rx: /\b(gst rate|gst percent|gst)\b/ },
  { key: 'rate', label: 'Selling rate', rx: /\b(selling price|selling rate|sale price|sale rate|sales rate|billing rate|billing price|dealer price|retailer price|retailer rate|dealer rate|selling|rate|price)\b/ },
];
async function productEdit(c: ModCtx): Promise<Reply | null> {
  const lo = ` ${c.textIn.toLowerCase().replace(/(\d),(\d{3})\b/g, '$1$2').replace(/₹|\brs\.?\s*|\binr\b|\/-/g, ' ').replace(/[^a-z0-9.%\s]/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ')} `;
  if (/\?/.test(c.textIn) || /\b(what|how much|how many|tell me|show|list|report)\b/.test(c.text)) return null;
  // mark each field phrase, longest first, so "purchase rate" is not also "rate"
  // "1 case = 120 pcs", "case 48 pcs", "1 case la 5 bag" → case size
  let marked = lo.replace(/\b1\s*(?:case|cs|box)\s*(?:=|is|la|has|contains|of|means)?\s*(?=\d+\s*(?:pcs|pieces|nos|bags?|packets?|pkts?)\b)/g, ' case size ')
    .replace(/(?<!\d\s)\bcase\s+(?=\d+\s*(?:pcs|pieces|nos|bags?|packets?|pkts?)\b)/g, ' case size ');
  for (const f of P_FIELDS) marked = marked.replace(new RegExp(f.rx.source, 'g'), ` §${f.key}§ `);
  if (!/§/.test(marked)) return null;
  if (/%/.test(marked) && !/§gst§/.test(marked)) return null; // "5% off" is a scheme
  const toks = marked.replace(/%/g, ' ').split(/\s+/).filter(Boolean);
  type PKey = (typeof P_FIELDS)[number]['key'];
  const set: Partial<Record<PKey, { value?: number; by?: number }>> = {};
  const name: string[] = [];
  let field = null as PKey | null;
  let rel: 1 | -1 | 0 = 0;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    const f = w.match(/^§(\w+)§$/);
    if (f) { field = f[1] as PKey; continue; }
    if (/^\d+(\.\d+)?$/.test(w)) {
      if (!field) continue;
      if (toks[i - 1] === 'from' && toks.slice(i + 1).includes('to')) continue; // "from 140 to 145"
      if (toks[i - 1] === 'by' || rel) set[field] = { by: Number(w) * (rel || 1) }; else set[field] = { value: Number(w) };
      continue;
    }
    if (/^(increase|increased|raise|up|hike)$/.test(w)) { rel = 1; continue; }
    if (/^(decrease|decreased|reduce|reduced|down|cut|drop)$/.test(w)) { rel = -1; continue; }
    if (/^(change|changed|set|update|updated|make|new|is|to|as|now|should|be|from|by|of|the|for|per|pc|pcs|piece|pieces|it|its|rs|rupees|change|correct|wrong|please|pcs|percent|bag|bags|packets|pkts|from|and|also|then|only|not|kg|g)$/.test(w)) {
      if (w === 'kg' || w === 'g') name.push(w);
      continue;
    }
    name.push(w);
  }
  const keys = Object.keys(set) as (keyof typeof set)[];
  if (!keys.length) return null;
  const product = name.length ? bestProduct(c.products, name.join(' ')).product : undefined;
  if (!product) return null;
  if (!office(c.role)) return deny();
  const rows: Row[] = keys.map(k => {
    const was = product[k] ?? 0;
    const s = set[k]!;
    return { key: k, field: P_FIELDS.find(f => f.key === k)!.label, was, value: s.by != null ? r2(was + s.by) : s.value! };
  });
  return {
    text: `${product.name}: ${rows.map(r => `${r.field} ${r.was} → ${r.value}`).join(', ')}. Check and tap ✓.`,
    proposal: {
      id: newId(), kind: 'productEdit', title: 'Change product',
      fields: [{ key: 'productId', label: 'Product', type: 'select', options: await productOptions(), value: product.id, readonly: true }],
      columns: [{ key: 'field', label: 'What', readonly: true, width: 110 }, { key: 'was', label: 'Was', type: 'number', readonly: true, width: 80 }, { key: 'value', label: 'New', type: 'number', width: 90 }],
      rows, meta: {},
    },
  };
}

// ------------------------------------------------------------------------------------------------------------
// SHOPS: "murugan phone 9443012345", "selvam credit limit 20000", "kumar mart cash only", "annai address is …"
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const S_LABEL: Record<string, string> = { phone: 'Mobile', creditLimit: 'Credit limit ₹', creditDays: 'Credit days', gstin: 'GSTIN', address: 'Address', owner: 'Owner', area: 'Area', beat: 'Beat (day)', cashOnly: 'Cash only', name: 'Shop name' };
async function shopEdit(c: ModCtx): Promise<Reply | null> {
  const shop = c.shop!;
  const t = ` ${c.text} `;
  const r = ` ${c.rest.replace(/\s+/g, ' ').trim()} `;
  const lo = r.toLowerCase().replace(/(\d),(\d{3})\b/g, '$1$2');
  const val: Record<string, string | number> = {};
  const phoneWord = /\b(phone|mobile|mob|cell|contact|whatsapp|ph)\b/.test(t) || (/\b(number|no)\b/.test(t) && !has(t, PAY));
  const phone = lo.replace(/(\d)[\s-](?=\d)/g, '$1').match(/(?:\+?91)?([6-9]\d{9})\b/);
  if (phone && (phoneWord || norm(r).replace(/\d+/g, '').trim() === '')) val.phone = phone[1];
  const gst = r.match(/\b(\d{2}[a-z]{5}\d{4}[a-z][a-z0-9]z[a-z0-9])\b/i);
  if (gst && /\b(gst|gstin|gst no|gst number|tin)\b/.test(t)) val.gstin = gst[1].toUpperCase();
  const lim = lo.match(/\blimit\b[^0-9]*(\d+(?:\.\d+)?)/) ?? lo.match(/(\d+(?:\.\d+)?)\s*(?:rs\s*)?(?:credit\s*)?limit\b/);
  if (lim && !/\bdays?\b[^0-9]*$/.test(lo.slice(0, lo.indexOf(lim[1])))) val.creditLimit = Number(lim[1]);
  const days = lo.match(/\bcredit (?:days|period)\b[^0-9]*(\d+)/) ?? lo.match(/\b(\d+)\s*days?\s*(?:credit|period)\b/) ?? (/\bcredit\b/.test(t) && !lim ? lo.match(/\b(\d+)\s*days?\b/) : null) ?? lo.match(/\bdays\b[^0-9]*(\d+)\b(?!\s*(?:rs|limit))/);
  if (days && Number(days[1]) <= 365) val.creditDays = Number(days[1]);
  if (/\b(remove cash only|cash only (remove|cancel|off|no|not needed|cancel)|allow credit|give credit|credit allowed|enable credit|open credit|start credit|credit ok|unblock)\b/.test(t)) val.cashOnly = 'no';
  else if (/\b(cash only|only cash|no credit|stop credit|block credit|stop giving credit|cash and carry|no more credit)\b/.test(t)) val.cashOnly = 'yes';
  // values are read from what was typed (the shop's own words are kept), without trailing "please" / "change" words
  const tidy = (v: string) => v.replace(/\s+(nu|ah|aa)?\s*(change|changed|make|update|please|now)\b.*$/i, '').replace(/^[\s,:-]+|[\s,.]+$/g, '').trim();
  const title = (v: string) => v.replace(/\b\w/g, x => x.toUpperCase());
  const addr = c.rest.match(/\baddress\b(?:\s*(?:is|to|as|:|-|change to|changed to|now|should be))*\s+(.+)$/i);
  if (addr) val.address = tidy(addr[1]);
  // "owner name is Ravi", "owner Selvam illa, Kannan" (= not Selvam, it is Kannan)
  const own = c.textIn.match(/\bowner(?:\s*name)?\b\s*(.+)$/i);
  if (own) { const v = tidy(own[1].split(/\b(?:not|is|to|as|it is)\b|[,:]/i).map(x => x.trim()).filter(Boolean).pop() ?? ''); if (/^[a-zA-Z][a-zA-Z .]{1,40}$/.test(v)) val.owner = title(v); }
  const area = c.rest.match(/\barea(?:\s*(?:is|to|as|:|-|now|change to|changed to))*\s+([a-zA-Z][a-zA-Z ]{1,40})$/i);
  if (area && tidy(area[1])) val.area = title(tidy(area[1]));
  const beat = t.match(/\bbeat(?:\s*day)?(?:\s*(?:is|to|as|now|change to|changed to))*\s+(mon|tue|wed|thu|fri|sat|sun)[a-z]*/) ?? t.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]* beat\b/);
  if (beat) val.beat = DAYS.find(d => d.toLowerCase().startsWith(beat[1]))!;
  const nm = !own ? c.textIn.match(/\b(?:rename(?:\s+(?:as|to))?|name\s+(?:is|to|change|changed|change to|changed to|should be|as)(?:\s+to)?)\s+(.+)$/i) : null;
  if (nm && tidy(nm[1])) val.name = tidy(nm[1]);
  const keys = Object.keys(val);
  if (!keys.length) return null;
  if (c.role === 'godown' || c.role === 'delivery') return deny();
  if (c.role === 'salesman' && keys.some(k => ['creditLimit', 'creditDays', 'cashOnly', 'name'].includes(k))) return { text: 'Credit terms and the shop name are changed by the owner. Ask the owner.', tone: 'warn' };
  const cur = shop as unknown as Record<string, unknown>;
  const was = (k: string) => k === 'cashOnly' ? (shop.cashOnly ? 'yes' : 'no') : String(cur[k] ?? '');
  const rows: Row[] = keys.map(k => ({ key: k, field: S_LABEL[k], was: was(k), value: val[k] }));
  return {
    text: `${shop.name}: ${rows.map(x => `${x.field} ${x.was || '—'} → ${x.value}`).join(', ')}. Check and tap ✓.`,
    proposal: {
      id: newId(), kind: 'shopEdit', title: 'Change shop details',
      fields: [{ key: 'shopId', label: 'Shop', type: 'select', options: await shopOptions(), value: shop.id, readonly: true }],
      columns: [{ key: 'field', label: 'What', readonly: true, width: 110 }, { key: 'was', label: 'Was', readonly: true, width: 140 }, { key: 'value', label: 'New', width: 180 }],
      rows, meta: {},
    },
  };
}

