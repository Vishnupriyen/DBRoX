// TESRAX: turns "send + say" into a Proposal (table to approve) or an answer.
// Understanding is rule-based first (free, offline, Tamil + English). The AI is only used to
// read photos, never to decide money.
import { licenceState } from './licence';
import { ChangeSet, db, getSettings, newId, session, today, ymd, daysFrom } from './db';
import { applySchemes, activeSchemes, stockOf } from './billing';
import { invoiceBalances, r2, shopOutstanding } from './ledger';
import { bestProduct, findAmount, findShopInText, norm, parseItemLines, toPieces } from './match';
import {
  companyOptions, productOptions, shopOptions, type Col, type Proposal, type Row,
} from './proposals';
import { isImageOrPdf, isSheet, readBankRows, readBillHeader, readProductRows, readPurchaseRows, readSheet, readShopRows, toIsoDate } from './readers';
import { NoServerError, fileToDataUrl, looksBlurry, scanFile } from './scan';
import { MODULES, type Advance, type LeaveRequest, type ModuleKey, type Product, type Role, type Scheme, type Staff } from './types';
import { exportClaims, exportEinvoice, exportGstr1, exportTally } from './exports';
const ENV_SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';

export interface Reply {
  text: string;
  tone?: 'ok' | 'warn' | 'error';
  proposal?: Proposal;
  table?: { columns: string[]; rows: (string | number)[][]; name: string };
  actions?: { label: string; run: () => void | Promise<void> }[];
  go?: string; // open this screen (Page id in the app shell)
}

// Screens TESRAX can open by name. Checked per role so a driver asking for "delivery plan" is told it is the owner's screen.
const SCREENS: { page: string; name: string; roles: Role[]; words: string[] }[] = [
  { page: 'orders-received', name: 'Orders received', roles: ['owner', 'office'], words: ['orders received', 'approve', 'approval', 'needs ok', 'waiting for me', 'new orders', 'ஒப்புதல்', 'வந்த ஆர்டர்'] },
  { page: 'verify', name: 'Picked — to verify', roles: ['owner', 'office'], words: ['verify', 'to verify', 'picked', 'சரிபார்'] },
  { page: 'billed', name: 'Billed', roles: ['owner', 'office'], words: ['billed', 'today bills', 'பில் ஆனது'] },
  { page: 'newshops', name: 'New shops', roles: ['owner', 'office'], words: ['new shops', 'shops to approve', 'புதிய கடைகள்'] },
  { page: 'targets', name: 'Targets', roles: ['owner', 'office'], words: ['target', 'targets', 'இலக்கு'] },
  { page: 'stockin', name: 'Purchases', roles: ['owner', 'office', 'godown'], words: ['stock in', 'purchases', 'purchase', 'கொள்முதல்'] },
  { page: 'ageing', name: 'Ageing', roles: ['owner', 'office', 'godown'], words: ['ageing', 'aging', 'old stock', 'பழைய ஸ்டாக்'] },
  { page: 'damages', name: 'Damages', roles: ['owner', 'office', 'godown'], words: ['damages', 'damage register', 'சேதம்'] },
  { page: 'status', name: 'Delivery status', roles: ['owner', 'office'], words: ['delivery status', 'delivered today', 'டெலிவரி நிலை'] },
  { page: 'trips', name: 'Trip reports', roles: ['owner', 'office'], words: ['trip report', 'trip reports', 'km', 'டிரிப் அறிக்கை'] },
  { page: 'outstanding', name: 'Outstanding', roles: ['owner', 'office'], words: ['outstanding list', 'who owes', 'dues', 'நிலுவை பட்டியல்'] },
  { page: 'cheques', name: 'Cheques & UPI', roles: ['owner', 'office'], words: ['cheques', 'cheque', 'upi list', 'செக்'] },
  { page: 'bank', name: 'Bank', roles: ['owner', 'office'], words: ['bank', 'statement', 'வங்கி'] },
  { page: 'expenses', name: 'Expenses', roles: ['owner', 'office'], words: ['expenses', 'expense list', 'செலவுகள்'] },
  { page: 'pnl', name: 'P&L', roles: ['owner'], words: ['p&l', 'pnl', 'profit', 'profit and loss', 'லாபம்'] },
  { page: 'cashflow', name: 'Cash flow', roles: ['owner'], words: ['cash flow', 'cashflow', 'position', 'net worth', 'loans', 'who will pay', 'what do i owe', 'payables', 'receivables', 'pending cheques', 'பண ஓட்டம்', 'நிலை'] },
  { page: 'reports', name: 'Reports', roles: ['owner', 'office'], words: ['reports', 'fast movers', 'slow movers', 'dead stock', 'high margin', 'low margin', 'shop wise', 'shop-wise', 'company wise', 'company-wise', 'salesman wise', 'salesman-wise', 'area wise', 'area-wise', 'returns report', 'scheme cost', 'அறிக்கைகள்'] },
  { page: 'vans', name: 'Vans & drivers', roles: ['owner'], words: ['van list', 'add van', 'my vans', 'vans and drivers', 'assign driver', 'வண்டிகள்'] },
  { page: 'export', name: 'Export', roles: ['owner', 'office'], words: ['export', 'tally export', 'ஏற்றுமதி'] },
  { page: 'gst', name: 'GST', roles: ['owner', 'office'], words: ['gst', 'gstr', 'gstr1', 'gstr-1', 'tax', 'e-invoice'] },
  { page: 'today', name: 'Today (attendance)', roles: ['owner', 'office'], words: ['attendance', 'who is in', 'who came', 'வருகை'] },
  { page: 'salary', name: 'Salary', roles: ['owner'], words: ['salary', 'salary sheet', 'payroll', 'சம்பளம்'] },
  { page: 'newshop', name: 'New shop', roles: ['salesman', 'owner', 'office'], words: ['add shop form', 'new shop form', 'onboard shop'] },
  { page: 'plan', name: 'Delivery plan', roles: ['owner', 'office'], words: ['delivery plan', 'plan delivery', 'plan the delivery', 'route plan', 'plan', 'டெலிவரி திட்டம்', 'திட்டம்'] },
  { page: 'live', name: 'Live vans', roles: ['owner'], words: ['live', 'where is the van', 'where is van', 'track', 'tracking', 'வண்டி எங்கே'] },
  { page: 'cash', name: 'Cash with staff', roles: ['owner'], words: ['cash with staff', 'staff cash', 'ஊழியர் பணம்'] },
  { page: 'stock', name: 'Stock position', roles: ['owner', 'office', 'godown'], words: ['stock position', 'stock alert', 'stock alerts', 'out of stock', 'stock list', 'ஸ்டாக் நிலை'] },
  { page: 'claims', name: 'Claims', roles: ['owner', 'office'], words: ['claims', 'claim tracker', 'கிளைம்'] },
  { page: 'dayclose', name: 'Day close', roles: ['owner'], words: ['day close', 'close day', 'close the day', 'reconcile', 'reconciliation', 'நாள் முடி'] },
  { page: 'stock-reports', name: 'Stock reports', roles: ['owner', 'office'], words: ['stock report', 'fast moving', 'slow moving', 'அறிக்கை'] },
  { page: 'billed', name: 'Bills', roles: ['owner', 'office'], words: ['bills', 'invoices', 'bill list', 'பில்கள்'] },
  { page: 'collect', name: 'Collect', roles: ['owner', 'office', 'salesman', 'delivery'], words: ['collect', 'collection', 'வசூல்'] },
  { page: 'pick', name: 'Pick orders', roles: ['godown'], words: ['pick', 'pick orders', 'orders to pick', 'pack', 'ஆர்டர் எடு'] },
  { page: 'print', name: 'Load sheet print', roles: ['godown', 'owner', 'office'], words: ['print load sheet', 'print', 'பிரிண்ட்'] },
  { page: 'load', name: 'Load vans', roles: ['godown'], words: ['load van', 'load vans', 'load sheet', 'loading', 'லோடு', 'ஏற்று'] },
  { page: 'trip', name: 'My trip', roles: ['delivery'], words: ['trip', 'my trip', 'start trip', 'delivery', 'டிரிப்', 'டெலிவரி'] },
  { page: 'beat', name: "Today's beat", roles: ['salesman'], words: ['beat', 'today beat', 'my shops', 'பீட்'] },
  { page: 'myday', name: 'My day', roles: ['salesman'], words: ['my day', 'my orders', 'என் நாள்'] },
];
function screenFor(text: string, role: Role): Reply | null {
  const hit = SCREENS.filter(s => s.words.some(w => text === w || text.startsWith(w + ' ') || text.endsWith(' ' + w) || text.includes(' ' + w + ' ') || (w.length > 5 && text.includes(w))))
    .sort((a, b) => Math.max(...b.words.filter(w => text.includes(w)).map(w => w.length)) - Math.max(...a.words.filter(w => text.includes(w)).map(w => w.length)))[0];
  if (!hit) return null;
  if (!hit.roles.includes(role)) return { text: `${hit.name} is the ${hit.roles[0] === 'owner' ? 'owner' : hit.roles[0]}'s screen. Ask them to open it.`, tone: 'warn' };
  return { text: `Opening ${hit.name}.`, go: hit.page };
}

const has = (t: string, words: string[]) => words.some(w => t.includes(w));
const W = {
  help: ['help', 'what can you do', 'உதவி', 'எப்படி'],
  stockIn: ['inventory', 'stock in', 'add to stock', 'purchase', 'add this', 'goods received', 'ஸ்டாக்', 'சரக்கு', 'கொள்முதல்', 'சேர்'],
  expense: ['expense', 'diesel', 'petrol', 'fuel', 'toll', 'repair', 'rent', 'batta', 'salary', 'tea', 'செலவு', 'டீசல்', 'பெட்ரோல்', 'வாடகை', 'சம்பளம்'],
  bank: ['bank', 'statement', 'match payment', 'வங்கி', 'ஸ்டேட்மென்ட்'],
  products: ['product list', 'products', 'item master', 'பொருட்கள்'],
  shops: ['shop list', 'shops list', 'retailer list', 'customer list', 'கடைகள்'],
  newShop: ['new shop', 'add shop', 'புதிய கடை'],
  paid: ['paid', 'payment', 'received', 'collected', 'gave', 'கொடுத்தார்', 'பணம்', 'வசூல்', 'செலுத்தினார்'],
  ret: ['return', 'returned', 'திரும்ப', 'ரிட்டர்ன்'],
  damage: ['damage', 'damaged', 'expired', 'expiry claim', 'leak', 'broken', 'சேதம்', 'காலாவதி', 'உடைந்த'],
  order: ['order', 'ஆர்டர்'],
  outstanding: ['outstanding', 'pending', 'owes', 'balance', 'due', 'நிலுவை', 'பாக்கி', 'கடன்'],
  sales: ['sales', 'sale today', 'today summary', 'summary', 'விற்பனை', 'இன்றைய'],
  stock: ['stock of', 'how much stock', 'stock', 'கையிருப்பு', 'ஸ்டாக்'],
  loadSheet: ['load sheet', 'loading', 'லோடு', 'ஏற்று'],
  nearExpiry: ['near expiry', 'expiring', 'expiry soon', 'காலாவதி ஆக'],
  cashHand: ['cash in hand', 'cash with', 'கையில் பணம்', 'கையிருப்பு பணம்'],
  tally: ['tally', 'டேலி'],
  gstr: ['gstr', 'gst return', 'gstr1', 'gstr-1'],
  einv: ['e-invoice', 'einvoice', 'e invoice', 'irn'],
  claimFile: ['claim file', 'claim report', 'claims for', 'make claim', 'கிளைம்'],
  needsOk: ['needs ok', 'approval', 'waiting', 'ஒப்புதல்'],
  scheme: ['scheme', 'offer', 'ஸ்கீம்', 'சலுகை'],
};

const ROLE_CAN: Record<Role, string[]> = {
  owner: ['*'],
  office: ['*'],
  salesman: ['order', 'payment', 'newshop', 'return', 'outstanding', 'stock', 'help', 'sales'],
  godown: ['purchase', 'claim', 'stock', 'loadsheet', 'expiry', 'help', 'return'],
  delivery: ['payment', 'return', 'help', 'outstanding'],
};

function need(mod: ModuleKey, modules: Record<ModuleKey, boolean>): Reply | null {
  if (modules[mod]) return null;
  const name = MODULES.find(m => m.key === mod)!.name;
  return { text: `${name} is not in your plan yet. Call Hanubix to add it.`, tone: 'warn' };
}

function can(role: Role, what: string) { return ROLE_CAN[role].includes('*') || ROLE_CAN[role].includes(what); }

async function myRole(): Promise<Role> {
  return (await db.staff.get(session().userId))?.role ?? 'owner';
}

export const HELP_TEXT = `Send a file or photo, say what you want, then check the table and tap ✓.
Examples:
• (attach purchase bill photo/Excel) "add this to inventory"
• (attach bank statement Excel) "match payments"
• "Murugan Stores 5 case Surf, 10 Lifebuoy"
• "Murugan Stores paid 2450 cash"
• "van 1 diesel 1500"
• "5 Good Day damaged" · "Selvam return 2 Surf"
• "who owes more than 10000" · "today sales" · "stock of surf"
• "load sheet" · "near expiry" · "cash in hand"
• say a screen name to open it: "delivery plan", "approve", "live vans", "day close"
• "HUL Surf 5% off till 30 Nov" · "Good Day buy 24 get 2"
• "tally export" · "gstr1 october" · "e-invoice" · "claim file"
• (attach product or shop list Excel) "add products" / "add shops"`;

export async function handle(textIn: string, files: File[]): Promise<Reply> {
  const text = norm(textIn);
  const settings = await getSettings();
  const mods = (await licenceState(!!ENV_SERVER_URL, settings)).mods; // what the distributor has paid for, never a phone setting
  const role = await myRole();
  const file = files[0];

  if (!text && !file) return { text: HELP_TEXT };
  if (has(text, W.help)) return { text: HELP_TEXT };

  // ------------------------ with a file ------------------------
  if (file) {
    if (has(text, W.bank)) {
      if (!can(role, 'bank')) return deny();
      return need('accountant', mods) ?? bankProposal(file);
    }
    if (has(text, W.products) && isSheet(file)) return importProducts(file);
    if (has(text, W.shops) && isSheet(file)) return importShops(file);
    if (has(text, W.expense)) return expenseFromFile(file, textIn);
    if (has(text, W.damage)) { const r = need('inventory', mods); if (r) return r; return damageProposal(textIn, file); }
    if (has(text, W.order) || has(text, ['diary'])) {
      const r = need('sales', mods) ?? need('inventory', mods); if (r) return r;
      return orderFromPhoto(file, textIn);
    }
    if (!can(role, 'purchase')) return deny();
    const r = need('inventory', mods); if (r) return r;
    return purchaseProposal(file);
  }

  // ------------------------ exports ------------------------
  if (has(text, W.tally)) { if (!can(role, 'accounts')) return deny(); return need('accountant', mods) ?? exportTally(monthIn(text)); }
  if (has(text, W.gstr)) { if (!can(role, 'accounts')) return deny(); return need('accountant', mods) ?? exportGstr1(monthIn(text)); }
  if (has(text, W.einv)) { if (!can(role, 'accounts')) return deny(); return need('accountant', mods) ?? exportEinvoice(monthIn(text)); }
  if (has(text, W.claimFile)) { if (!can(role, 'claims')) return deny(); return need('inventory', mods) ?? exportClaims(monthIn(text)); }

  // ------------------------ actions ------------------------
  const shops = await db.shops.toArray();
  const { shop, rest } = findShopInText(shops, textIn);

  if ((has(text, W.scheme) || /\d\s*%/.test(textIn) || /buy\s*\d+\s*get\s*\d+/.test(text)) && !has(text, W.claimFile)) { if (role !== 'owner' && role !== 'office') return deny(); return schemeProposal(textIn); }
  if (has(text, W.newShop)) { if (!can(role, 'newshop')) return deny(); return newShopProposal(textIn); }
  if (has(text, W.damage) && !has(text, W.outstanding)) { const r = need('inventory', mods); if (r) return r; if (!can(role, 'claim')) return deny(); return damageProposal(textIn); }
  if (shop && has(text, W.ret)) { if (!can(role, 'return')) return deny(); return returnProposal(shop.id, rest); }
  // Corrections in plain words: "it is not 500, it is 300", "300 not 500", "change payment 500 to 300", "wrong, it is 300"
  const fix = correctionIn(text);
  if (fix) {
    const r = need('collection', mods); if (r) return r;
    if (!can(role, 'payment')) return deny();
    return paymentCorrection(shop?.id, fix.old, fix.next, role);
  }
  if (shop && has(text, W.paid) && findAmount(rest) != null) {
    const r = need('collection', mods); if (r) return r;
    if (!can(role, 'payment')) return deny();
    return paymentProposal(shop.id, findAmount(rest)!, modeIn(text), refIn(textIn));
  }
  if (has(text, W.expense) && findAmount(text) != null && !shop) return expenseFromText(textIn);
  // Payroll by chat: "leave monday", "leave 12/11 to 14/11 fever", "advance 1000", owner: "Karthik leave tomorrow", "advance 2000 to Ravi"
  if (has(text, ['leave', 'லீவு', 'விடுமுறை'])) return leaveRequest(textIn, role);
  if (has(text, ['advance', 'அட்வான்ஸ்']) && findAmount(text) != null) return advanceRequest(textIn, role);

  // ------------------------ questions ------------------------
  if (has(text, W.needsOk)) return (role === 'owner' || role === 'office') ? { text: 'Opening Orders received.', go: 'orders-received' } : needsOkTable();
  if (has(text, W.cashHand)) return cashInHand();
  if (has(text, W.loadSheet)) { const r = need('inventory', mods); if (r) return r; if (role === 'godown') return { text: 'Opening Load vans.', go: 'load' }; return loadSheet(); }
  if (has(text, W.nearExpiry)) return nearExpiry();
  if (has(text, W.outstanding)) return outstandingTable(shop?.id, findAmount(text));
  if (has(text, W.sales)) return salesToday();

  // ------------------------ orders ------------------------
  const lines = parseItemLines(shop ? rest : textIn);
  // never guess an order from words that aren't products: if nothing matches a product, ask instead
  if (lines.length) {
    const active = (await db.products.toArray()).filter(p => p.active);
    if (!lines.some(l => bestProduct(active, l.productText).product)) {
      const who = shop?.name ?? 'Murugan Stores';
      return { text: `I'm not sure what you want${shop ? ` for ${shop.name}` : ''}. Try one of these:\n• "${who} paid 500 cash"\n• "${who} 2 case Surf, 24 Good Day"\n• "${who} outstanding"\n• "${who} it is not 500, it is 300" (to correct a payment)`, tone: 'warn' };
    }
  }
  if (shop && lines.length) {
    const r = need('sales', mods) ?? (mods.bill ? null : null); if (r) return r;
    if (!can(role, 'order')) return deny();
    return orderProposal(shop.id, shop ? rest : textIn);
  }
  if (has(text, W.stock)) return stockTable(text.replace(/stock of|how much stock|stock|ஸ்டாக்|கையிருப்பு/g, '').trim());
  if (lines.length && !shop) {
    return { text: 'Which shop is this order for? Start with the shop name, e.g. "Murugan Stores 5 case Surf".', tone: 'warn' };
  }
  const sc = screenFor(text, role); if (sc) return sc;
  return { text: `I didn't understand that yet.\n\n${HELP_TEXT}`, tone: 'warn' };
}

// "not 500 … 300", "300 not 500", "500 to 300" (with change/adjust/correct), "wrong … it is 300"
function correctionIn(t: string): { old?: number; next: number } | null {
  const nums = [...t.replace(/,/g, '').matchAll(/(?:₹|rs\.?\s*)?\b(\d{1,5}(?:\.\d{1,2})?)\b/g)].map(m => Number(m[1])).filter(n => n > 0);
  if (!nums.length) return null;
  const notN = t.match(/\bnot\s*(?:₹|rs\.?\s*)?(\d{1,5}(?:\.\d{1,2})?)\b/);
  if (notN) { const old = Number(notN[1]); const next = nums.find(n => n !== old); return next ? { old, next } : null; }
  const fixWord = /\b(adjust|correct|correction|change|edit|update|wrong|mistake|actually|instead)\b|தவறு|மாற்று/.test(t);
  if (!fixWord) return null;
  const to = t.match(/(\d{1,5}(?:\.\d{1,2})?)\s*(?:to|->|→|into)\s*(?:₹|rs\.?\s*)?(\d{1,5}(?:\.\d{1,2})?)/);
  if (to) return { old: Number(to[1]), next: Number(to[2]) };
  if (/\b(wrong|mistake|actually|correct)\b|தவறு/.test(t) && nums.length === 1) return { next: nums[0] };
  return null;
}

async function paymentCorrection(shopId: string | undefined, old: number | undefined, next: number, role: Role): Promise<Reply> {
  const since = daysFrom(-7);
  const me = session().userId;
  const shopName = shopId ? (await db.shops.get(shopId))?.name ?? 'this shop' : '';
  const pays = (await db.payments.toArray())
    .filter(p => p.status === 'ok' && p.date >= since && (shopId ? p.shopId === shopId : p.collectedBy === me) && (old == null || Math.abs(p.amount - old) < 0.01))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const p = pays[0];
  if (!p) return { text: `I couldn't find a payment${old != null ? ` of ₹${old}` : ''}${shopName ? ` for ${shopName}` : ' recorded by you'} in the last 7 days. To change a bill instead, open Bill → Billed → Edit.`, tone: 'warn' };
  if (role !== 'owner' && role !== 'office' && p.collectedBy !== me) return deny();
  // balances as if the old payment never happened, then the new amount goes to the oldest bills first
  const back = new Map(p.allocations.map(a => [a.invoiceId, a.amount]));
  const bills = (await invoiceBalances(p.shopId)).map(b => ({ b, base: r2(b.balance + (back.get(b.invoice.id) ?? 0)) })).filter(x => x.base > 0.5);
  let left = next;
  const rows: Row[] = bills.map(({ b, base }) => { const pay = r2(Math.max(0, Math.min(left, base))); left = r2(left - pay); return { invoiceId: b.invoice.id, number: b.invoice.number, date: b.invoice.date, balance: base, overdue: b.overdueDays ? `${b.overdueDays} days` : '', pay }; });
  const name = (await db.shops.get(p.shopId))?.name ?? '';
  const counted = p.mode === 'cash' && (await db.dayCloses.where('date').equals(p.date).count()) > 0; // only if that day was really closed
  return {
    text: `Correcting the ${p.mode} payment from ${name} on ${p.date}: ₹${p.amount} → ₹${next}. Check and tap ✓.` + (counted ? `\nThis cash was already counted at day close — the ₹${r2(Math.abs(p.amount - next))} difference will need to be settled with the person who collected it.` : ''),
    proposal: {
      id: newId(), kind: 'paymentFix', title: 'Correct payment',
      fields: [
        { key: 'shopId', label: 'Shop', type: 'select', options: await shopOptions(), value: p.shopId, readonly: true },
        { key: 'was', label: 'Was ₹', type: 'number', value: p.amount, readonly: true },
        { key: 'amount', label: 'Correct amount ₹', type: 'number', value: next },
        { key: 'mode', label: 'Mode', type: 'select', value: p.mode, options: [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'cheque', label: 'Cheque' }] },
        { key: 'ref', label: 'UPI / cheque no', value: p.ref ?? '' },
      ],
      columns: [
        { key: 'number', label: 'Bill', readonly: true, width: 150 },
        { key: 'date', label: 'Date', readonly: true, width: 95 },
        { key: 'balance', label: 'Balance ₹', type: 'number', readonly: true, width: 90 },
        { key: 'overdue', label: 'Overdue', readonly: true, width: 80 },
        { key: 'pay', label: 'Pay now ₹', type: 'number', width: 90 },
      ],
      rows, meta: { paymentId: p.id },
    },
  };
}

function deny(): Reply { return { text: 'Your role cannot do this. Ask the owner.', tone: 'warn' }; }

function monthIn(t: string): string {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const d = new Date(today());
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${months[i]}`).test(t)) {
      const y = i > d.getMonth() ? d.getFullYear() - 1 : d.getFullYear();
      return `${y}-${String(i + 1).padStart(2, '0')}`;
    }
  }
  if (/last month|போன மாதம்/.test(t)) { d.setMonth(d.getMonth() - 1); }
  return ymd(d).slice(0, 7);
}
function modeIn(t: string): 'cash' | 'upi' | 'cheque' {
  if (/upi|gpay|phonepe|paytm|google pay/.test(t)) return 'upi';
  if (/cheque|check|chq|காசோலை/.test(t)) return 'cheque';
  return 'cash';
}
function refIn(t: string) { return t.match(/\b(\d{6,12})\b/)?.[1] ?? ''; }

// ---------------------------------------------------------------------------------------------
async function purchaseProposal(file: File): Promise<Reply> {
  const products = await db.products.toArray();
  let rows: Row[] = [];
  const fields = { companyId: '', billNo: '', date: today(), supplierGstin: '', billTotal: 0 as number };
  let source: 'excel' | 'photo' = 'excel';
  let note = '';
  if (isSheet(file)) {
    const sheet = await readSheet(file);
    const pr = readPurchaseRows(sheet);
    if (!pr) return { text: 'I could not find the item and quantity columns in this sheet. Is it the purchase bill?', tone: 'error' };
    rows = pr.map(x => lineToRow(products, x));
    const h = readBillHeader(sheet);
    Object.assign(fields, { billNo: h.billNo, date: h.date || today(), supplierGstin: h.gstin, billTotal: h.total });
  } else if (isImageOrPdf(file)) {
    source = 'photo';
    if (await looksBlurry(file)) note = 'The photo looks blurry — check every number carefully, or retake it.';
    try {
      const res = await scanFile(file, 'purchase');
      rows = (res.lines ?? []).map(x => lineToRow(products, { item: x.item, code: x.code ?? '', hsn: x.hsn ?? '', batch: x.batch ?? '', expiry: x.expiry ?? '', mrp: x.mrp ?? 0, qty: x.qty, free: x.free ?? 0, rate: x.rate ?? 0, discount: x.discount ?? 0, gst: x.gst ?? 0, amount: x.amount ?? 0 }));
      Object.assign(fields, { billNo: res.billNo ?? '', date: res.date ?? today(), supplierGstin: res.supplierGstin ?? '', billTotal: res.total ?? 0 });
    } catch (e) {
      if (e instanceof NoServerError) {
        note = 'Photo reading needs the Hanubix server, which is not connected yet. Type the items below, or send the bill as Excel.';
        rows = [emptyPurchaseRow()];
      } else return { text: `Could not read the photo: ${(e as Error).message}`, tone: 'error' };
    }
  } else return { text: 'Send a photo, PDF or Excel of the purchase bill.', tone: 'error' };

  // company = the company most matched products belong to
  const counts = new Map<string, number>();
  for (const r of rows) { const p = products.find(x => x.id === r.productId); if (p) counts.set(p.companyId, (counts.get(p.companyId) ?? 0) + 1); }
  fields.companyId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  const proposal: Proposal = {
    id: newId(), kind: 'purchase', title: 'Add purchase bill to stock',
    fields: [
      { key: 'companyId', label: 'Company', type: 'select', options: await companyOptions(), value: fields.companyId },
      { key: 'billNo', label: 'Bill no', value: fields.billNo },
      { key: 'date', label: 'Bill date', type: 'date', value: fields.date },
      { key: 'supplierGstin', label: 'Supplier GSTIN', value: fields.supplierGstin },
      { key: 'billTotal', label: 'Bill total ₹', type: 'number', value: fields.billTotal },
    ],
    columns: purchaseColumns(await productOptions()),
    rows, meta: { source, file: file.name }, note,
  };
  const unmatched = rows.filter(r => !r.productId).length;
  return {
    text: `I read ${rows.length} item(s) from ${file.name}.` + (unmatched ? ` ${unmatched} item(s) need you to pick the product once — I'll remember next time.` : ''),
    proposal,
  };
}

function purchaseColumns(opts: { value: string; label: string }[]): Col[] {
  return [
    { key: 'item', label: 'Bill says', readonly: true, width: 150 },
    { key: 'productId', label: 'Our product', type: 'select', options: opts, width: 160 },
    { key: 'batch', label: 'Batch', width: 80 },
    { key: 'expiry', label: 'Expiry', type: 'date', width: 120 },
    { key: 'mrp', label: 'MRP', type: 'number', width: 70 },
    { key: 'qty', label: 'Qty (pcs)', type: 'number', width: 70 },
    { key: 'free', label: 'Free', type: 'number', width: 60 },
    { key: 'rate', label: 'Rate', type: 'number', width: 80 },
    { key: 'discount', label: 'Disc ₹', type: 'number', width: 70 },
    { key: 'gst', label: 'GST %', type: 'number', width: 60 },
    { key: 'amount', label: 'Amount', type: 'number', width: 90 },
  ];
}
function emptyPurchaseRow(): Row { return { item: '', code: '', productId: '', batch: '', expiry: '', mrp: 0, qty: 0, free: 0, rate: 0, discount: 0, gst: 0, amount: 0 }; }

function lineToRow(products: Product[], x: { item: string; code: string; hsn: string; batch: string; expiry: string; mrp: number; qty: number; free: number; rate: number; discount: number; gst: number; amount: number }): Row {
  // learned supplier codes first, then name similarity
  const byCode = x.code ? products.find(p => p.code === x.code || p.aliases.includes(x.code)) : undefined;
  const byName = byCode ?? products.find(p => p.aliases.includes(x.item)) ?? bestProduct(products, x.item).product;
  return { item: x.item, code: x.code, hsn: x.hsn, productId: byName?.id ?? '', batch: x.batch, expiry: x.expiry, mrp: x.mrp, qty: x.qty, free: x.free, rate: x.rate, discount: x.discount, gst: x.gst || byName?.gst || 0, amount: x.amount };
}

// ---------------------------------------------------------------------------------------------
async function bankProposal(file: File): Promise<Reply> {
  if (!isSheet(file)) return { text: 'Please send the statement as Excel or CSV (download it from net banking). PDF statements will be read once the server is connected.', tone: 'warn' };
  const rows = readBankRows(await readSheet(file));
  if (!rows) return { text: 'I could not find date / narration / credit columns in this statement.', tone: 'error' };
  const shops = await db.shops.toArray();
  const pays = (await db.payments.toArray()).filter(p => p.mode !== 'cash' && !p.bankLineId && p.status !== 'cancelled');
  const already = new Set((await db.bankLines.toArray()).map(b => `${b.date}|${b.credit}|${b.narration}`));
  const balances = await invoiceBalances();
  const out: Row[] = [];
  for (const r of rows) {
    if (already.has(`${r.date}|${r.credit}|${r.narration}`)) continue; // statement uploaded twice: skip repeats
    if (r.credit <= 0) { out.push({ date: r.date, narration: r.narration, ref: r.ref, credit: 0, debit: r.debit, shopId: '', paymentId: '', why: 'Debit', action: 'ignore' }); continue; }
    let shopId = '', paymentId = '', why = '', action = 'check';
    // 1) UPI/cheque ref recorded by our staff
    const byRef = r.ref ? pays.find(p => p.ref && (r.ref.includes(p.ref) || r.narration.includes(p.ref))) : undefined;
    if (byRef && Math.abs(byRef.amount - r.credit) < 1) { shopId = byRef.shopId; paymentId = byRef.id; why = `Ref ${byRef.ref} recorded by staff`; action = 'match'; }
    // 2) shop name inside narration
    if (!shopId) {
      const f = findShopInText(shops, r.narration);
      if (f.shop) { shopId = f.shop.id; why = 'Shop name in narration'; action = 'match'; }
    }
    // 3) exact amount equals one pending bill
    if (!shopId) {
      const same = balances.filter(b => Math.abs(b.balance - r.credit) < 1);
      if (same.length === 1) { shopId = same[0].invoice.shopId; why = `Equals bill ${same[0].invoice.number}`; action = 'match'; }
      else if (same.length > 1) why = `${same.length} bills have this amount`;
    }
    // 4) amount equals an unmatched UPI payment
    if (!shopId) {
      const amt = pays.filter(p => Math.abs(p.amount - r.credit) < 1);
      if (amt.length === 1) { shopId = amt[0].shopId; paymentId = amt[0].id; why = 'Same amount as a UPI/cheque entry'; action = 'match'; }
    }
    if (!why) why = 'No match found';
    out.push({ date: r.date, narration: r.narration, ref: r.ref, credit: r.credit, debit: 0, shopId, paymentId, why, action });
  }
  const so = await shopOptions();
  const proposal: Proposal = {
    id: newId(), kind: 'bank', title: 'Match bank statement', fields: [],
    columns: [
      { key: 'date', label: 'Date', readonly: true, width: 95 },
      { key: 'narration', label: 'Narration', readonly: true, width: 220 },
      { key: 'credit', label: 'Credit ₹', type: 'number', readonly: true, width: 90 },
      { key: 'shopId', label: 'Shop', type: 'select', options: so, width: 170 },
      { key: 'why', label: 'Why', readonly: true, width: 160 },
      { key: 'action', label: 'Action', type: 'select', width: 100, options: [{ value: 'match', label: 'Match' }, { value: 'check', label: 'Check' }, { value: 'ignore', label: 'Ignore' }] },
    ],
    rows: out, meta: { statement: file.name },
  };
  const m = out.filter(r => r.action === 'match').length;
  const c = out.filter(r => r.action === 'check').length;
  return { text: `${out.length} new line(s). ${m} matched automatically, ${c} need you to check (yellow).`, proposal };
}

// ---------------------------------------------------------------------------------------------
async function orderProposal(shopId: string, itemText: string): Promise<Reply> {
  const products = (await db.products.toArray()).filter(p => p.active);
  const parsed = parseItemLines(itemText);
  const schemes = await db.schemes.toArray();
  const rows: Row[] = [];
  const unknown: string[] = [];
  for (const l of parsed) {
    const { product } = bestProduct(products, l.productText);
    if (!product) { unknown.push(l.productText); rows.push({ said: l.text, productId: '', qty: l.qty, rate: 0, free: 0, amount: 0, stock: '' }); continue; }
    const qty = toPieces(l.qty, l.unit, product);
    rows.push(await orderRow(product, qty, l.text, schemes));
  }
  return {
    text: unknown.length ? `I couldn't find: ${unknown.join(', ')}. Pick them in the table.` : 'Order ready. Check and tap ✓.',
    proposal: {
      id: newId(), kind: 'order', title: 'New order',
      fields: [{ key: 'shopId', label: 'Shop', type: 'select', options: await shopOptions(), value: shopId }],
      columns: [
        { key: 'said', label: 'You said', readonly: true, width: 130 },
        { key: 'productId', label: 'Product', type: 'select', options: (await productOptions()).filter(o => o.value !== '__new'), width: 170 },
        { key: 'qty', label: 'Qty (pcs)', type: 'number', width: 75 },
        { key: 'rate', label: 'Rate', type: 'number', width: 75 },
        { key: 'free', label: 'Free', type: 'number', readonly: true, width: 55 },
        { key: 'amount', label: 'Amount', type: 'number', readonly: true, width: 85 },
        { key: 'stock', label: 'Stock', readonly: true, width: 70 },
      ],
      rows, meta: {},
    },
  };
}

export async function orderRow(product: Product, qty: number, said: string, schemes?: Scheme[]): Promise<Row> {
  const sc = schemes ?? await db.schemes.toArray();
  const sch = applySchemes(product, qty, product.rate, activeSchemes(sc, product, today()));
  const amount = r2((sch.gross - sch.discount) * (1 + product.gst / 100));
  return { said, productId: product.id, qty, rate: product.rate, free: sch.freeQty, amount, stock: await stockOf(product.id) };
}

// Re-compute dependent cells when a person edits an order row.
export async function refreshOrderRow(r: Row): Promise<Row> {
  const p = await db.products.get(String(r.productId));
  if (!p) return r;
  const sch = applySchemes(p, Number(r.qty) || 0, Number(r.rate) || p.rate, activeSchemes(await db.schemes.toArray(), p, today()));
  return { ...r, free: sch.freeQty, amount: r2((sch.gross - sch.discount) * (1 + p.gst / 100)), stock: await stockOf(p.id), rate: Number(r.rate) || p.rate };
}

async function orderFromPhoto(file: File, _text: string): Promise<Reply> {
  try {
    const res = await scanFile(file, 'order');
    const shops = await db.shops.toArray();
    const shop = res.shop ? findShopInText(shops, res.shop).shop : undefined;
    const itemText = (res.lines ?? []).map(l => `${l.qty} ${l.item}`).join(', ');
    if (!shop) return { text: `I read: ${itemText}. Which shop is it for? Type: "<shop name> ${itemText}"`, tone: 'warn' };
    return orderProposal(shop.id, itemText);
  } catch (e) {
    if (e instanceof NoServerError) return { text: 'Reading a diary photo needs the Hanubix server, which is not connected yet. Type the order instead, e.g. "Murugan Stores 5 case Surf".', tone: 'warn' };
    return { text: `Could not read the photo: ${(e as Error).message}`, tone: 'error' };
  }
}

// ---------------------------------------------------------------------------------------------
async function paymentProposal(shopId: string, amount: number, mode: 'cash' | 'upi' | 'cheque', ref: string): Promise<Reply> {
  const bills = (await invoiceBalances(shopId)).filter(b => b.balance > 0.5);
  let left = amount;
  const rows: Row[] = bills.map(b => {
    const pay = r2(Math.max(0, Math.min(left, b.balance)));
    left = r2(left - pay);
    return { invoiceId: b.invoice.id, number: b.invoice.number, date: b.invoice.date, balance: b.balance, overdue: b.overdueDays ? `${b.overdueDays} days` : '', pay };
  });
  return {
    text: rows.length ? 'Applied to oldest bills first. Change the amounts if the shop wants different bills.' : 'This shop has no pending bills; the money will be kept as advance.',
    proposal: {
      id: newId(), kind: 'payment', title: 'Record payment',
      fields: [
        { key: 'shopId', label: 'Shop', type: 'select', options: await shopOptions(), value: shopId, readonly: true },
        { key: 'amount', label: 'Amount ₹', type: 'number', value: amount },
        { key: 'mode', label: 'Mode', type: 'select', value: mode, options: [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'cheque', label: 'Cheque' }] },
        { key: 'ref', label: 'UPI / cheque no', value: ref },
      ],
      columns: [
        { key: 'number', label: 'Bill', readonly: true, width: 150 },
        { key: 'date', label: 'Date', readonly: true, width: 95 },
        { key: 'balance', label: 'Balance ₹', type: 'number', readonly: true, width: 90 },
        { key: 'overdue', label: 'Overdue', readonly: true, width: 80 },
        { key: 'pay', label: 'Pay now ₹', type: 'number', width: 90 },
      ],
      rows, meta: {},
    },
  };
}

// ---------------------------------------------------------------------------------------------
async function expenseFromText(textIn: string): Promise<Reply> {
  const t = norm(textIn);
  const vans = await db.vans.toArray();
  const me = await db.staff.get(session().userId);
  const van = vans.find(v => t.includes(norm(v.name)) || t.includes(norm(v.number))) ?? (me?.vanId ? vans.find(v => v.id === me.vanId) : undefined);
  return expenseProposal([{ date: today(), category: categoryOf(t), amount: findAmount(t.replace(/van \d+/, '')) ?? 0, vanId: van?.id ?? '', note: textIn }]);
}

async function expenseFromFile(file: File, textIn: string): Promise<Reply> {
  const t = norm(textIn);
  const vans = await db.vans.toArray();
  const van = vans.find(v => t.includes(norm(v.name)) || t.includes(norm(v.number)));
  let amount = findAmount(t.replace(/van \d+/, '')) ?? 0;
  let date = today();
  let note = textIn;
  let warn = '';
  try {
    const res = await scanFile(file, 'expense');
    amount = res.amount ?? amount; date = res.date ?? date; note = [res.supplier, textIn].filter(Boolean).join(' · ');
  } catch (e) {
    if (e instanceof NoServerError) warn = 'Photo saved with the expense. Type the amount (photo reading needs the server).';
    else warn = `Could not read the bill: ${(e as Error).message}`;
  }
  const photo = file.type.startsWith('image/') ? await fileToDataUrl(file, 1000, 0.6) : undefined;
  const r = await expenseProposal([{ date, category: categoryOf(t), amount, vanId: van?.id ?? '', note }], photo);
  if (warn) r.text = warn;
  return r;
}

function categoryOf(t: string) {
  if (/diesel|petrol|fuel|டீசல்|பெட்ரோல்/.test(t)) return 'Fuel';
  if (/toll/.test(t)) return 'Toll';
  if (/repair|service|tyre|tire/.test(t)) return 'Van repair';
  if (/rent|வாடகை/.test(t)) return 'Rent';
  if (/salary|சம்பளம்/.test(t)) return 'Salary';
  if (/batta/.test(t)) return 'Batta';
  if (/tea|snacks|food/.test(t)) return 'Tea & food';
  if (/hire/.test(t)) return 'Van hire';
  return 'Other';
}

async function expenseProposal(rows: Row[], photo?: string): Promise<Reply> {
  const vans = await db.vans.toArray();
  const cats = ['Fuel', 'Toll', 'Van repair', 'Van hire', 'Batta', 'Salary', 'Rent', 'Electricity', 'Tea & food', 'Loading', 'Other'];
  return {
    text: 'Expense ready. Check and tap ✓.',
    proposal: {
      id: newId(), kind: 'expense', title: 'Record expense', fields: [],
      columns: [
        { key: 'date', label: 'Date', type: 'date', width: 120 },
        { key: 'category', label: 'Category', type: 'select', options: cats.map(c => ({ value: c, label: c })), width: 120 },
        { key: 'amount', label: 'Amount ₹', type: 'number', width: 90 },
        { key: 'vanId', label: 'Van', type: 'select', options: [{ value: '', label: '—' }, ...vans.map(v => ({ value: v.id, label: v.name }))], width: 100 },
        { key: 'note', label: 'Note', width: 200 },
      ],
      rows, meta: { photo },
    },
  };
}

// ---------------------------------------------------------------------------------------------
async function damageProposal(textIn: string, file?: File): Promise<Reply> {
  const products = await db.products.toArray();
  const t = norm(textIn);
  const kind = /expir|காலாவதி/.test(t) ? 'expiry' : /transit|van/.test(t) ? 'transit' : 'damage';
  const cleaned = textIn.replace(/damaged|damage|expired|expiry|claim|add to|leak|broken|சேதம்|காலாவதி/gi, ' ');
  const lines = parseItemLines(cleaned);
  const rows: Row[] = lines.map(l => {
    const p = bestProduct(products, l.productText).product;
    const qty = p ? toPieces(l.qty, l.unit, p) : l.qty;
    return { said: l.text, productId: p?.id ?? '', qty, kind, amount: p ? r2(qty * p.purchaseRate) : 0, fromStock: 'yes', note: '' };
  });
  if (!rows.length) rows.push({ said: '', productId: '', qty: 0, kind, amount: 0, fromStock: 'yes', note: '' });
  const photo = file && file.type.startsWith('image/') ? await fileToDataUrl(file, 1000, 0.6) : undefined;
  return {
    text: 'Damage / expiry entry ready. It will go into this month\'s company claim.',
    proposal: {
      id: newId(), kind: 'claim', title: 'Damage / expiry for claim', fields: [],
      columns: [
        { key: 'said', label: 'You said', readonly: true, width: 120 },
        { key: 'productId', label: 'Product', type: 'select', options: (await productOptions()).filter(o => o.value !== '__new'), width: 170 },
        { key: 'qty', label: 'Qty (pcs)', type: 'number', width: 75 },
        { key: 'kind', label: 'Type', type: 'select', width: 100, options: [{ value: 'damage', label: 'Damage' }, { value: 'expiry', label: 'Expiry' }, { value: 'transit', label: 'Transit' }] },
        { key: 'amount', label: 'Value ₹', type: 'number', width: 85 },
        { key: 'fromStock', label: 'Remove from stock', type: 'select', width: 90, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
        { key: 'note', label: 'Note', width: 140 },
      ],
      rows, meta: { photo },
    },
  };
}

async function returnProposal(shopId: string, itemText: string): Promise<Reply> {
  const products = await db.products.toArray();
  const invs = (await db.invoices.where('shopId').equals(shopId).toArray()).filter(i => !i.cancelled).sort((a, b) => b.date.localeCompare(a.date));
  const rows: Row[] = parseItemLines(itemText.replace(/return(ed)?|திரும்ப/gi, ' ')).map(l => {
    const p = bestProduct(products, l.productText).product;
    const qty = p ? toPieces(l.qty, l.unit, p) : l.qty;
    const inv = p ? invs.find(i => i.lines.some(x => x.productId === p.id)) : undefined;
    const line = inv?.lines.find(x => x.productId === p?.id);
    const perPc = line ? line.total / (line.qty || 1) : 0;
    return { said: l.text, productId: p?.id ?? '', qty, invoiceId: inv?.id ?? '', bill: inv?.number ?? '', amount: r2(qty * perPc), restock: 'yes' };
  });
  return {
    text: rows.length ? 'Return ready. A credit note will be made against the latest bill with that item.' : 'Say the items, e.g. "Selvam return 2 Surf".',
    proposal: {
      id: newId(), kind: 'return', title: 'Shop return → credit note',
      fields: [
        { key: 'shopId', label: 'Shop', type: 'select', options: await shopOptions(), value: shopId, readonly: true },
        { key: 'reason', label: 'Reason', value: 'Return' },
      ],
      columns: [
        { key: 'said', label: 'You said', readonly: true, width: 110 },
        { key: 'productId', label: 'Product', type: 'select', options: (await productOptions()).filter(o => o.value !== '__new'), width: 160 },
        { key: 'qty', label: 'Qty (pcs)', type: 'number', width: 70 },
        { key: 'bill', label: 'Against bill', readonly: true, width: 140 },
        { key: 'amount', label: 'Credit ₹', type: 'number', width: 85 },
        { key: 'restock', label: 'Back to stock', type: 'select', width: 90, options: [{ value: 'yes', label: 'Yes (good)' }, { value: 'no', label: 'No (damaged)' }] },
      ],
      rows, meta: {},
    },
  };
}

async function newShopProposal(textIn: string): Promise<Reply> {
  const name = textIn.replace(/new shop|add shop|புதிய கடை/gi, '').replace(/[,]/g, ' ').trim();
  return {
    text: 'Fill the shop details. The owner approves new shops before the first bill.',
    proposal: {
      id: newId(), kind: 'newshop', title: 'New shop', fields: [],
      columns: shopColumns(),
      rows: [{ name, owner: '', phone: '', gstin: '', area: '', beat: '', creditLimit: 0, creditDays: 7, cashOnly: 'no', type: 'retail' }],
      meta: {},
    },
  };
}

async function schemeProposal(textIn: string): Promise<Reply> {
  const t = norm(textIn);
  const companies = await db.companies.toArray();
  const products = await db.products.toArray();
  const company = companies.find(c => t.includes(norm(c.code)) || t.includes(norm(c.name).split(' ')[0]));
  const pct = textIn.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(?:%|percent|சதவீதம்)/)?.[1];
  const bg = t.match(/buy\s*(\d+)\s*get\s*(\d+)/);
  const stripped = t.replace(/scheme|offer|ஸ்கீம்|சலுகை|buy\s*\d+\s*get\s*\d+|\d+(\.\d+)?\s*(%|percent)|off|till.*|to \d.*/g, ' ')
    .replace(company ? new RegExp(`${norm(company.code)}|${norm(company.name).split(' ')[0]}`, 'g') : /$^/, ' ').trim();
  const prod = stripped ? bestProduct(products.filter(p => !company || p.companyId === company.id), stripped).product : undefined;
  const till = textIn.match(/(?:till|to|until|வரை)\s+(\d{1,2}[/\-. ][0-9A-Za-z]{1,3}(?:[/\-. ]\d{2,4})?)/i)?.[1];
  let to = daysFrom(30);
  if (till) { const d = toIsoDate(/\d{2,4}$/.test(till) && till.split(/[/\-. ]/).length === 3 ? till : `${till} ${new Date().getFullYear()}`); if (d) to = d; }
  const row: Row = {
    companyId: company?.id ?? prod?.companyId ?? '', productId: prod?.id ?? '', name: textIn.slice(0, 40),
    type: bg ? 'free' : 'pct', value: pct ? Number(pct) : 0, buyQty: bg ? Number(bg[1]) : 0, freeQty: bg ? Number(bg[2]) : 0,
    from: today(), to, source: 'company', combine: 'add',
  };
  return {
    text: 'Scheme ready. Company schemes are claimed back automatically every month.',
    proposal: {
      id: newId(), kind: 'schemes', title: 'Add scheme', fields: [],
      columns: [
        { key: 'companyId', label: 'Company', type: 'select', options: await companyOptions(), width: 120 },
        { key: 'productId', label: 'Product (blank = all)', type: 'select', options: [{ value: '', label: 'All products' }, ...(await productOptions()).filter(o => o.value && o.value !== '__new')], width: 170 },
        { key: 'name', label: 'Name', width: 150 },
        { key: 'type', label: 'Type', type: 'select', width: 90, options: [{ value: 'pct', label: '% off' }, { value: 'free', label: 'Buy X get Y' }] },
        { key: 'value', label: '%', type: 'number', width: 55 },
        { key: 'buyQty', label: 'Buy (pcs)', type: 'number', width: 65 },
        { key: 'freeQty', label: 'Free (pcs)', type: 'number', width: 65 },
        { key: 'from', label: 'From', type: 'date', width: 120 },
        { key: 'to', label: 'To', type: 'date', width: 120 },
        { key: 'source', label: 'Given by', type: 'select', width: 100, options: [{ value: 'company', label: 'Company' }, { value: 'own', label: 'Our own' }] },
        { key: 'combine', label: 'With other schemes', type: 'select', width: 100, options: [{ value: 'add', label: 'Add on' }, { value: 'replace', label: 'Replace' }] },
      ],
      rows: [row], meta: {},
    },
  };
}

function shopColumns(): Col[] {
  return [
    { key: 'name', label: 'Shop name', width: 150 },
    { key: 'owner', label: 'Owner', width: 100 },
    { key: 'phone', label: 'Mobile', width: 110 },
    { key: 'gstin', label: 'GSTIN (if B2B)', width: 150 },
    { key: 'area', label: 'Area', width: 100 },
    { key: 'beat', label: 'Beat (day)', width: 90 },
    { key: 'creditLimit', label: 'Credit limit ₹', type: 'number', width: 90 },
    { key: 'creditDays', label: 'Credit days', type: 'number', width: 70 },
    { key: 'cashOnly', label: 'Cash only', type: 'select', width: 70, options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }] },
    { key: 'type', label: 'Type', type: 'select', width: 110, options: [{ value: 'retail', label: 'Retail' }, { value: 'wholesale', label: 'Wholesale' }, { value: 'subdistributor', label: 'Sub-distributor' }] },
  ];
}

async function importProducts(file: File): Promise<Reply> {
  const rows = readProductRows(await readSheet(file));
  if (!rows) return { text: 'I could not find a product name column.', tone: 'error' };
  const companies = await db.companies.toArray();
  const existing = await db.products.toArray();
  return {
    text: `${rows.length} product(s) read. Check company, HSN, GST and rates.`,
    proposal: {
      id: newId(), kind: 'products', title: 'Import products', fields: [],
      columns: [
        { key: 'name', label: 'Name', width: 170 },
        { key: 'nameTa', label: 'Tamil name', width: 120 },
        { key: 'companyId', label: 'Company', type: 'select', options: await companyOptions(), width: 110 },
        { key: 'code', label: 'Code', width: 80 },
        { key: 'hsn', label: 'HSN', width: 70 },
        { key: 'gst', label: 'GST %', type: 'number', width: 60 },
        { key: 'mrp', label: 'MRP', type: 'number', width: 70 },
        { key: 'rate', label: 'Sell rate', type: 'number', width: 80 },
        { key: 'purchaseRate', label: 'Buy rate', type: 'number', width: 80 },
        { key: 'caseSize', label: 'Pcs/case', type: 'number', width: 70 },
      ],
      rows: rows.map(r => {
        const c = companies.find(x => r.company && (norm(x.name).includes(norm(r.company)) || norm(r.company).includes(norm(x.code))));
        const ex = existing.find(p => norm(p.name) === norm(r.name));
        return { id: ex?.id ?? '', name: r.name, nameTa: r.nameTa, companyId: c?.id ?? '', code: r.code, hsn: r.hsn, gst: r.gst, mrp: r.mrp, rate: r.rate, purchaseRate: r.purchase, caseSize: r.caseSize };
      }),
      meta: {},
    },
  };
}

async function importShops(file: File): Promise<Reply> {
  const rows = readShopRows(await readSheet(file));
  if (!rows) return { text: 'I could not find a shop name column.', tone: 'error' };
  return {
    text: `${rows.length} shop(s) read. Check GSTIN and credit terms.`,
    proposal: {
      id: newId(), kind: 'shops', title: 'Import shops', fields: [], columns: shopColumns(),
      rows: rows.map(r => ({ ...r, cashOnly: 'no', type: 'retail' })), meta: {},
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Questions → read-only tables (always downloadable as Excel)
async function outstandingTable(shopId?: string, above?: number): Promise<Reply> {
  const shops = await db.shops.toArray();
  const rows: (string | number)[][] = [];
  for (const s of shops.filter(x => !shopId || x.id === shopId)) {
    const o = await shopOutstanding(s.id);
    if (o.total > 0.5 && (!above || o.total >= above)) rows.push([s.name, s.area, o.total, o.overdue, o.maxOverdueDays, o.bills.length]);
  }
  rows.sort((a, b) => Number(b[2]) - Number(a[2]));
  const total = r2(rows.reduce((a, r) => a + Number(r[2]), 0));
  return {
    text: rows.length ? `${rows.length} shop(s) owe ₹${total.toLocaleString('en-IN')} in total.` : 'Nobody owes anything. 🎉',
    table: { name: 'Outstanding', columns: ['Shop', 'Area', 'Pending ₹', 'Overdue ₹', 'Max days overdue', 'Bills'], rows },
  };
}

async function salesToday(): Promise<Reply> {
  const d = today();
  const invs = (await db.invoices.where('date').equals(d).toArray()).filter(i => !i.cancelled);
  const pays = (await db.payments.where('date').equals(d).toArray()).filter(p => p.status === 'ok');
  const companies = new Map((await db.companies.toArray()).map(c => [c.id, c.name]));
  const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
  const orders = new Map((await db.orders.toArray()).map(o => [o.id, o]));
  const byKey = new Map<string, { bills: number; amount: number }>();
  for (const i of invs) {
    const sm = staff.get(orders.get(i.orderId ?? '')?.salesmanId ?? '') ?? 'Office';
    const k = `${companies.get(i.companyId)}|${sm}`;
    const v = byKey.get(k) ?? { bills: 0, amount: 0 };
    v.bills++; v.amount = r2(v.amount + i.total); byKey.set(k, v);
  }
  const rows = [...byKey.entries()].map(([k, v]) => [...k.split('|'), v.bills, v.amount]);
  const sales = r2(invs.reduce((a, i) => a + i.total, 0));
  const coll = r2(pays.reduce((a, p) => a + p.amount, 0));
  return {
    text: `Today: ${invs.length} bills, sales ₹${sales.toLocaleString('en-IN')}, collected ₹${coll.toLocaleString('en-IN')}.`,
    table: { name: `Sales ${d}`, columns: ['Company', 'Salesman', 'Bills', 'Amount ₹'], rows },
  };
}

async function stockTable(q: string): Promise<Reply> {
  const products = (await db.products.toArray()).filter(p => p.active);
  const list = q ? products.filter(p => bestProduct([p], q).product) : products;
  const batches = await db.batches.toArray();
  const rows = list.map(p => {
    const bs = batches.filter(b => b.productId === p.id && b.qty > 0 && b.expiry >= today()).sort((a, b) => a.expiry.localeCompare(b.expiry));
    const qty = bs.reduce((a, b) => a + b.qty, 0);
    return [p.name, qty, `${Math.floor(qty / p.caseSize)} cs + ${qty % p.caseSize}`, bs[0]?.expiry ?? '', r2(qty * p.purchaseRate)];
  });
  return { text: q && !rows.length ? `No product matches "${q}".` : `Stock of ${rows.length} product(s).`, table: { name: 'Stock', columns: ['Product', 'Pieces', 'Cases', 'Oldest expiry', 'Value ₹'], rows } };
}

export async function loadSheet(): Promise<Reply> {
  const invs = (await db.invoices.where('deliveryStatus').equals('pending').toArray()).filter(i => !i.cancelled);
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  const total = new Map<string, { qty: number; batches: Map<string, number> }>();
  for (const i of invs) for (const l of i.lines) {
    const v = total.get(l.productId) ?? { qty: 0, batches: new Map() };
    v.qty += l.qty + l.freeQty;
    for (const b of l.batches) v.batches.set(`${b.batch} (exp ${b.expiry})`, (v.batches.get(`${b.batch} (exp ${b.expiry})`) ?? 0) + b.qty);
    total.set(l.productId, v);
  }
  const rows = [...total.entries()].map(([pid, v]) => {
    const p = products.get(pid)!;
    return [p.name, p.nameTa ?? '', v.qty, `${Math.floor(v.qty / p.caseSize)} cs + ${v.qty % p.caseSize}`, [...v.batches.entries()].map(([b, q]) => `${b}: ${q}`).join('; ')];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return { text: `Load sheet for ${invs.length} bill(s) waiting for delivery. Pick oldest batch first.`, table: { name: 'Load sheet', columns: ['Product', 'Tamil', 'Pieces', 'Cases', 'Batches (oldest first)'], rows } };
}

async function nearExpiry(): Promise<Reply> {
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  const limit = daysFrom(60);
  const rows = (await db.batches.toArray()).filter(b => b.qty > 0 && b.expiry <= limit).sort((a, b) => a.expiry.localeCompare(b.expiry))
    .map(b => [products.get(b.productId)?.name ?? '', b.batch, b.expiry, b.qty, b.expiry < today() ? 'EXPIRED' : 'Push sale']);
  return { text: rows.length ? `${rows.length} batch(es) expire within 60 days.` : 'Nothing expires in the next 60 days.', table: { name: 'Near expiry', columns: ['Product', 'Batch', 'Expiry', 'Pieces', 'Action'], rows } };
}

export async function cashInHand(): Promise<Reply> {
  const pays = (await db.payments.toArray()).filter(p => p.mode === 'cash' && !p.settled && p.status === 'ok');
  const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name]));
  const by = new Map<string, { amt: number; n: number; oldest: string }>();
  for (const p of pays) {
    const v = by.get(p.collectedBy) ?? { amt: 0, n: 0, oldest: p.date };
    v.amt = r2(v.amt + p.amount); v.n++; if (p.date < v.oldest) v.oldest = p.date; by.set(p.collectedBy, v);
  }
  const rows = [...by.entries()].map(([id, v]) => [staff.get(id) ?? id, v.amt, v.n, v.oldest]);
  return { text: rows.length ? `₹${r2(rows.reduce((a, r) => a + Number(r[1]), 0)).toLocaleString('en-IN')} cash is with staff, not yet handed to office.` : 'No cash pending with staff.', table: { name: 'Cash in hand', columns: ['Staff', 'Cash ₹', 'Payments', 'Since'], rows } };
}

async function needsOkTable(): Promise<Reply> {
  const orders = (await db.orders.where('status').equals('needs_ok').toArray());
  const shops = new Map((await db.shops.toArray()).map(s => [s.id, s.name]));
  return { text: orders.length ? `${orders.length} order(s) wait for your OK. Open "Today" to approve them.` : 'Nothing waiting for your OK.', table: { name: 'Needs OK', columns: ['Shop', 'Date', 'Items', 'Why'], rows: orders.map(o => [shops.get(o.shopId) ?? '', o.date, o.lines.length, o.issues.join('; ')]) } };
}


// ---------------- Payroll by chat ----------------
function parseDate(t: string): string | null {
  const m = t.match(/(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today().slice(0, 4); return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (t.includes('tomorrow') || t.includes('நாளை')) return daysFrom(1);
  if (t.includes('today') || t.includes('இன்று')) return today();
  for (let i = 0; i < 7; i++) if (t.includes(days[i])) { const d = new Date(); const diff = (i - d.getDay() + 7) % 7 || 7; return daysFrom(diff); }
  return null;
}
async function whom(t: string, role: Role): Promise<Staff | undefined> {
  const staff = (await db.staff.toArray()).filter(s => s.active);
  if (role === 'owner' || role === 'office') { const hit = staff.find(s => s.role !== 'owner' && t.includes(norm(s.name.split(' ')[0]))); if (hit) return hit; }
  return staff.find(s => s.id === session().userId);
}
async function leaveRequest(textIn: string, role: Role): Promise<Reply> {
  const t = norm(textIn);
  const who = await whom(t, role); if (!who) return { text: 'Who is the leave for?', tone: 'warn' };
  const dates = [...t.matchAll(/(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/g)].map(m => parseDate(m[0])!);
  const from = dates[0] ?? parseDate(t) ?? today(); const to = dates[1] ?? from;
  const reason = textIn.replace(/leave|லீவு|விடுமுறை|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|to|for|on/gi, '').replace(new RegExp(who.name.split(' ')[0], 'i'), '').trim() || 'personal';
  const self = who.id === session().userId;
  const cs = new ChangeSet();
  cs.put<LeaveRequest>('leaves', { staffId: who.id, from, to, reason, status: self && role !== 'owner' ? 'waiting' : 'approved' }, 'leave');
  await cs.commit('Leave');
  return { text: self && role !== 'owner' ? `Leave request ${from}${to !== from ? ' to ' + to : ''} (${reason}) sent to the owner.` : `${who.name.split(' ')[0]}: leave ${from}${to !== from ? ' to ' + to : ''} recorded (${reason}).`, tone: 'ok' };
}
async function advanceRequest(textIn: string, role: Role): Promise<Reply> {
  const t = norm(textIn);
  const who = await whom(t, role); if (!who) return { text: 'Who is the advance for?', tone: 'warn' };
  const amount = findAmount(t)!;
  const self = who.id === session().userId;
  const cs = new ChangeSet();
  cs.put<Advance>('advances', { staffId: who.id, amount, reason: textIn, status: self && role !== 'owner' ? 'waiting' : 'approved', instalments: 1, recovered: 0 }, 'advance');
  if (!(self && role !== 'owner')) cs.put('expenses', { date: today(), category: 'advance', amount, note: `Advance to ${who.name}` }, 'advance paid');
  await cs.commit('Advance');
  return { text: self && role !== 'owner' ? `Advance request ₹${amount} sent to the owner.` : `Advance ₹${amount} to ${who.name.split(' ')[0]} recorded; recovered from next salary.`, tone: 'ok' };
}
