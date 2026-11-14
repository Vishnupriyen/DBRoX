// TESRAX for Orders received (Part 2 item 8 — docs/PART2_SPEC.md "TESRAX", PART2_UX.md): "download orders", "open order <shop>",
// "approve order <shop>". Answers in place; a file comes with a Download button; nothing is saved before the person taps.
import { db } from './db';
import { inr, plural } from './i18n';
import { findShopInText } from './match';
import { approveOrder } from './pipeline';
import { ordersSheet } from './orderEdit';
import type { Order, Role } from './types';

export const OPEN_ORDER_KEY = 'hanubix.openOrder'; // Orders received opens this order once (TESRAX "open order <shop>")
type R = { text: string; tone?: 'ok' | 'warn' | 'error'; go?: string; actions?: { label: string; run: () => void | Promise<void> }[]; table?: { name: string; columns: string[]; rows: (string | number)[][] } };

const ORDERS = /\b(orders?|ordrs?|odrs?)\b/;
export async function ordersByVoice(text: string, role: Role): Promise<R | null> {
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
