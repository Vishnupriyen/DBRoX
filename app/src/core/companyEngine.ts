// TESRAX on the company side. Same rule as everywhere: it reads, proposes and opens screens; nothing is saved without ✓.
import { db, newId, session, thisMonth, today } from './db';
import { bestProduct, findShopInText, learnNames, parseItemLines, toPieces } from './match';
import { myShops } from './field';
import type { Row } from './proposals';
import { hasWord as has, norm } from './match';
import { inr } from './i18n';
import { myLinks, salesByDistributor, stockCover } from './company';
import type { Reply } from './engine';
import type { Role } from './types';

export const REP_HELP = `Type an order the way you say it: "Murugan Stores 2 case coconut oil, 1 case sambar". Check the table and tap ✓ — it goes to the shop's distributor for billing.
• "start day" · "end day" · "today's beat" · "new shop" · "my orders" · "my sales" · "leave"`;
export const COMPANY_HELP = `Ask in plain words, or say a screen name to open it.
• "sales this month" · "sales of Murugan distributors"
• "low stock" · "stock at distributors"
• "distributors" · "shops" · "schemes" · "products" · "team" · "invoices"
Head office: upload your SAP or Tally sales register in Invoices to distributors; prices and schemes reach every linked distributor on their next sync.`;

const SCREENS: { page: string; name: string; words: string[]; roles?: Role[] }[] = [
  { page: 'co-sales', name: 'Sales', words: ['sales', 'secondary', 'primary', 'sell through', 'sold'] },
  { page: 'co-stock', name: 'Stock at distributors', words: ['stock', 'low stock', 'days of stock', 'stock cover', 'inventory'] },
  { page: 'co-distributors', name: 'Distributors', words: ['distributors', 'distributor', 'invite', 'dbs', 'db list'] },
  { page: 'co-outlets', name: 'Shops', words: ['shops', 'outlets', 'retailers', 'outlet list'] },
  { page: 'co-invoices', name: 'Invoices to distributors', words: ['invoices', 'invoice', 'sales register', 'primary invoices', 'upload invoices'], roles: ['cadmin'] },
  { page: 'co-products', name: 'Products & prices', words: ['products', 'price', 'prices', 'price list', 'ptr', 'ptd'], roles: ['cadmin'] },
  { page: 'co-schemes', name: 'Schemes', words: ['schemes', 'scheme', 'offers'], roles: ['cadmin'] },
  { page: 'co-team', name: 'Team', words: ['team', 'staff', 'reps', 'my team'] },
  { page: 'fd-team', name: 'Team today', words: ['who did not visit', 'who didn t visit', 'not visited', 'team today', 'live', 'where is'], roles: ['cadmin', 'manager'] },
  { page: 'fd-approvals', name: 'Approvals', words: ['approvals', 'approve', 'leave requests', 'pending leave'], roles: ['cadmin', 'manager'] },
  { page: 'fd-targets', name: 'Targets', words: ['targets', 'target', 'leaderboard'], roles: ['cadmin', 'manager'] },
];
const REP_SCREENS: { page: string; name: string; words: string[] }[] = [
  { page: 'fd-day', name: 'My day', words: ['start day', 'start my day', 'end day', 'end my day', 'my day', 'check in', 'attendance', 'km'] },
  { page: 'fd-beat', name: "Today's beat", words: ['beat', 'today s beat', 'my shops', 'visit', 'shops'] },
  { page: 'fd-orders', name: 'My orders', words: ['my orders', 'orders'] },
  { page: 'fd-month', name: 'My month', words: ['my sales', 'sales', 'my target', 'target', 'leave', 'my month'] },
  { page: 'fd-newshop', name: 'New shop', words: ['new shop', 'add shop', 'new outlet'] },
];

// "lunch 120, bus 45, lodge 800" → the rep's expenses (checked against the travel policy in the month's claim)
const EXP: [RegExp, string][] = [[/\b(lunch|dinner|breakfast|food|meal|meals|tea|snacks|coffee)\b/, 'Food'], [/\b(bus|train|ticket)\b/, 'Bus'], [/\b(auto|rickshaw|cab|taxi|share auto)\b/, 'Auto'], [/\b(lodge|room|hotel|stay)\b/, 'Lodge'], [/\b(phone|recharge|mobile|data)\b/, 'Phone']];
function repExpenses(text: string): Reply | null {
  const rows: Row[] = [];
  for (const part of text.split(/,|\n|;|\band\b/)) {
    const t = norm(part); const amt = t.match(/\b(\d+(?:\.\d+)?)\b/); if (!amt) continue;
    const cat = EXP.find(([re]) => re.test(t)); if (!cat) return null; // anything that is not an expense word: not an expense message
    rows.push({ date: today(), category: cat[1], amount: Number(amt[1]), note: part.trim() });
  }
  if (!rows.length) return null;
  const cats = ['Food', 'Bus', 'Auto', 'Lodge', 'Phone', 'Other'].map(c => ({ value: c, label: c }));
  return {
    text: 'Expenses ready. Add the bill photo from Travel & expenses if you have one. Check and tap ✓.',
    proposal: { id: newId(), kind: 'expense', title: 'My expenses', fields: [], columns: [
      { key: 'date', label: 'Date', type: 'date', width: 105 }, { key: 'category', label: 'For', type: 'select', options: cats, width: 90 },
      { key: 'amount', label: '₹', type: 'number', width: 75 }, { key: 'note', label: 'Note', width: 140 }], rows, meta: {} },
  };
}

/** "Murugan Stores 2 case coconut oil, 1 case sambar" → an order table for the shop's distributor */
async function fieldOrder(textIn: string, role: Role): Promise<Reply | null> {
  const shops = role === 'rep' ? await myShops() : (await db.shops.toArray()).filter(x => x.active !== false && x.dbLinkId);
  const found = findShopInText(shops, textIn);
  if (found.ties?.length) return { text: `Which ${found.ties[0].name} — ${found.ties.map(t => t.area).join(' or ')}? Say the town too.`, tone: 'warn' };
  if (!found.shop) return null;
  const products = (await db.products.toArray()).filter(p => p.active);
  learnNames(products);
  const parsed = parseItemLines(found.rest).filter(l => l.qty > 0 && l.productText);
  if (!parsed.length) return null;
  const rows: Row[] = []; const unsure: string[] = [];
  for (const l of parsed) {
    const { product, ambiguous } = bestProduct(products, l.productText);
    if (!product) { unsure.push(l.productText); rows.push({ said: l.text, productId: '', qty: l.qty, rate: 0, amount: 0 }); continue; }
    if (ambiguous) unsure.push(l.productText);
    const qty = toPieces(l.qty, l.unit, product);
    rows.push({ said: l.text, productId: ambiguous ? '' : product.id, qty, rate: product.rate, amount: Math.round(qty * product.rate * 100) / 100 });
  }
  const opts = [{ value: '', label: '— pick —' }, ...products.sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ value: p.id, label: p.name }))];
  return {
    text: unsure.length ? `Pick the product for: ${unsure.join(', ')}.` : `Order for ${found.shop.name}. Check and tap ✓ — it goes to the distributor for billing.`,
    proposal: {
      id: newId(), kind: 'fieldOrder', title: `Order for ${found.shop.name}`,
      fields: [{ key: 'shopId', label: 'Shop', type: 'select', options: shops.map(x => ({ value: x.id, label: `${x.name} · ${x.area}` })), value: found.shop.id }],
      columns: [
        { key: 'said', label: 'You said', readonly: true, width: 130 },
        { key: 'productId', label: 'Product', type: 'select', options: opts, width: 170 },
        { key: 'qty', label: 'Qty (pcs)', type: 'number', width: 75 },
        { key: 'rate', label: 'PTR', type: 'number', readonly: true, width: 70 },
        { key: 'amount', label: 'Value', type: 'number', readonly: true, width: 85 },
      ],
      rows, meta: {},
    },
  };
}

export async function handleCompany(textIn: string, role: Role): Promise<Reply> {
  const text = norm(textIn);
  if (!text || has(text, ['help', 'what can you do', 'how'])) return { text: role === 'rep' ? REP_HELP : COMPANY_HELP };
  if (/\d/.test(text)) {
    const e = repExpenses(textIn); if (e) return e;
    const o = await fieldOrder(textIn, role); if (o) return o;
  }
  if (role === 'rep') {
    const hit = REP_SCREENS.find(x => has(text, x.words));
    if (hit) return { text: `Opening ${hit.name}.`, go: hit.page };
    return { text: `I didn't understand that yet.\n\n${REP_HELP}` };
  }
  const links = await myLinks(session().userId);
  const ids = new Set(links.map(l => l.id));
  // "sales this month" / "sales of <distributor>": the number, then the screen
  if (has(text, ['sales', 'sold', 'secondary', 'sell through'])) {
    const rows = (await salesByDistributor(thisMonth())).filter(r => ids.has(r.link.id));
    const one = rows.find(r => text.includes(norm(r.link.name)) || norm(r.link.name).split(' ').some(w => w.length > 4 && text.split(' ').includes(w)));
    const pick = one ? [one] : rows;
    const p = pick.reduce((a, r) => a + r.primary, 0), s = pick.reduce((a, r) => a + r.secondary - r.returns, 0);
    return { text: `${one ? one.link.name : 'All your distributors'}, this month (before GST): sales to distributors ${inr(p)}, distributor sales to shops ${inr(s)}${p ? ` (${Math.round(s / p * 100)}% sold through)` : ''}.`, actions: [], go: undefined, table: { name: 'Sales by distributor', columns: ['Distributor', 'To them', 'To shops', 'Shops'], rows: pick.map(r => [r.link.name, inr(r.primary), inr(r.secondary - r.returns), r.shops]) } };
  }
  if (has(text, ['low stock', 'running low', 'out of stock', 'stock out', 'reorder'])) {
    const names = new Map(links.map(l => [l.id, l.name]));
    const low = (await stockCover()).filter(c => ids.has(c.dbLinkId) && c.status === 'low');
    if (!low.length) return { text: 'Nothing is running low at your distributors.', tone: 'ok' };
    return { text: `${low.length} product${low.length > 1 ? 's are' : ' is'} running low (under half the stock norm).`, table: { name: 'Low stock', columns: ['Distributor', 'Product', 'Stock', 'Days'], rows: low.map(c => [names.get(c.dbLinkId) ?? '', c.name, c.qty, c.days ?? '—']) } };
  }
  const hit = SCREENS.find(s => has(text, s.words));
  if (hit) {
    if (hit.roles && !hit.roles.includes(role)) return { text: `${hit.name} is a head-office screen.`, refused: true };
    return { text: `Opening ${hit.name}.`, go: hit.page };
  }
  void db;
  return { text: `I didn't understand that yet.\n\n${COMPANY_HELP}` };
}
