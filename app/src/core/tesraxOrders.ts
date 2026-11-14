// TESRAX for Orders received (Part 2 item 8 — docs/PART2_SPEC.md "TESRAX", PART2_UX.md): "download orders", "open order <shop>",
// "approve order <shop>". Answers in place; a file comes with a Download button; nothing is saved before the person taps.
import { db } from './db';
import { inr, plural } from './i18n';
import { bestProduct, findShopInText } from './match';
import { approveOrder } from './pipeline';
import { editOrder, ordersSheet } from './orderEdit';
import type { Order, Role } from './types';

export const OPEN_ORDER_KEY = 'hanubix.openOrder'; // Orders received opens this order once (TESRAX "open order <shop>")
type R = { text: string; tone?: 'ok' | 'warn' | 'error'; go?: string; actions?: { label: string; run: () => void | Promise<void> }[]; table?: { name: string; columns: string[]; rows: (string | number)[][] } };

const ORDERS = /\b(orders?|ordrs?|odrs?)\b/;
export async function ordersByVoice(text: string, role: Role): Promise<R | null> {
  const d = await discountByVoice(text, role); if (d) return d;
  if (!ORDERS.test(text)) return null;
  const boss = role === 'owner' || role === 'office';
  const waiting = async () => [...await db.orders.where('status').equals('new').toArray(), ...await db.orders.where('status').equals('needs_ok').toArray()];
  // "download orders", "orders excel"
  // only the file asked for as such: "Surf Excel" in an order is a product, never a download
  if (/^(?:please )?(?:download|send|export|give)\s+(?:me\s+)?(?:the\s+|all\s+)?(?:orders?|ordrs?)(?:\s+received)?(?:\s+(?:excel|file|sheet|list))?$/.test(text) || /^(?:orders?|ordrs?)(?:\s+received)?\s+(?:excel|xls|xlsx|file|sheet|download)$/.test(text)) {
    if (!boss) return { text: 'The orders file is the owner\'s and office\'s. Ask them to send it.', tone: 'warn' };
    const os = await waiting();
    if (!os.length) return { text: 'No orders waiting, so there is nothing to download.' };
    const sheet = await ordersSheet(os.map(o => o.id));
    const total = sheet.rows.filter(r => r[1] === 'Total').reduce((a, r) => a + Number(r[r.length - 1]), 0);
    return {
      text: `${plural(os.length, 'order')} waiting, ${inr(total)} in all. Tap Download for the Excel.`,
      actions: [{ label: 'Download orders (Excel)', run: async () => { const { downloadWorkbook } = await import('./readers'); await downloadWorkbook(`Orders-received-${new Date().toISOString().slice(0, 10)}`, [sheet]); } }],
    };
  }
  const m = text.match(/^(?:please )?(open|show|see|approve|ok|okay)\s+(?:the\s+)?(?:orders?|ordrs?|odrs?)\s+(?:of\s+|for\s+)?(.+)$/);
  if (!m) return null;
  const os = await waiting();
  const shops = (await db.shops.toArray()).filter(s => os.some(o => o.shopId === s.id));
  const hit = findShopInText(shops, m[2]).shop;
  if (!hit && m[1] !== 'approve') return null; // "open orders to approve" is the screen, not a shop
  if (!hit) return { text: `I didn't find a waiting order for "${m[2]}". Try: 'open order Sri Ram'.`, tone: 'warn' };
  if (!boss) return { text: 'Orders are approved by the owner or office.', tone: 'warn' };
  const o = os.find(x => x.shopId === hit.id) as Order;
  if (m[1] === 'open' || m[1] === 'show' || m[1] === 'see') {
    try { sessionStorage.setItem(OPEN_ORDER_KEY, o.id); } catch { /* no session storage (tests) */ }
    return { text: `Opening ${hit.name}'s order (${plural(o.lines.length, 'line')}).`, go: 'orders-received' };
  }
  return {
    text: `${hit.name}: ${plural(o.lines.length, 'line')}. Tap Approve to send it to the godown.`,
    actions: [{ label: 'Approve', run: async () => { await approveOrder(o.id); } }],
  };
}

// "discount 5 percent on Parle-G", "disc 5% parle g", "5 per discount parle g", "... in order Sri Ram": Disc % on that product's
// lines of an order still waiting for approval (one tap; nothing saved before it)
const PCT = '(\\d+(?:\\.\\d+)?)\\s*(?:percent|per ?cent|pc|per)?';
const DISC_A = new RegExp(`^(?:give |set |put |add )?(?:disc|discount|dis)\\s*(?:of\\s+)?${PCT}\\s+(?:on\\s+|for\\s+|to\\s+)?(.+)$`);
const DISC_B = new RegExp(`^(?:give |set |put |add )?${PCT}\\s*(?:disc|discount|dis)\\s+(?:on\\s+|for\\s+|to\\s+)?(.+)$`);
async function discountByVoice(text: string, role: Role): Promise<R | null> {
  // a running offer for shops ("5% discount on surf this month for all shops") is a scheme, not one order's line
  if (/\b(all shops|every shop|each shop|this month|next month|this week|scheme|offer|from|till|until|upto|up to|days?|weeks?|months?)\b/.test(text)) return null;
  const m = text.match(DISC_A) ?? text.match(DISC_B); if (!m) return null;
  if (role !== 'owner' && role !== 'office') return { text: 'A discount is set by the owner or office.', tone: 'warn' };
  const pct = Number(m[1]);
  if (!(pct >= 0)) return null;
  if (pct > 100) return { text: "Discount can't be more than 100%.", tone: 'warn' };
  let rest = m[2]; let shopWords = '';
  const at = rest.match(/^(.+?)\s+(?:in|of|for)\s+(?:the\s+)?(?:orders?|ordrs?)\s+(?:of\s+)?(.+)$/); if (at) { rest = at[1]; shopWords = at[2]; }
  const product = bestProduct((await db.products.toArray()).filter(p => p.active), rest).product;
  if (!product) return { text: `I didn't find "${rest}". Try: 'discount 5 percent on Parle-G'.`, tone: 'warn' };
  const os = [...await db.orders.where('status').equals('new').toArray(), ...await db.orders.where('status').equals('needs_ok').toArray()].filter(o => o.lines.some(l => l.productId === product.id));
  const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
  let hit = os;
  if (shopWords) { const sh = findShopInText([...shops.values()].filter(s => os.some(o => o.shopId === s.id)), shopWords).shop; hit = sh ? os.filter(o => o.shopId === sh.id) : []; }
  if (!hit.length) return { text: `No order waiting has ${product.name}${shopWords ? ` for "${shopWords}"` : ''}.`, tone: 'warn' };
  if (hit.length > 1) return { text: `${plural(hit.length, 'order')} have ${product.name}: ${hit.slice(0, 4).map(o => shops.get(o.shopId)?.name ?? '').join(', ')}. Say 'discount ${pct}% on ${product.name} in order ${shops.get(hit[0].shopId)?.name ?? 'Sri Ram'}'.` };
  const o = hit[0]; const shop = shops.get(o.shopId)?.name ?? 'the shop';
  return {
    text: `Disc ${pct}% on ${product.name} in ${shop}'s order. Tap to set it, then say 'approve order ${shop}'.`,
    actions: [{ label: `Set ${pct}% on ${product.name}`, run: async () => { const now = await db.orders.get(o.id); if (now) await editOrder(o.id, now.lines.map(l => (l.productId === product.id ? { ...l, discountPct: pct } : l))); } }],
  };
}
