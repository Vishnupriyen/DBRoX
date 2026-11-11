// TESRAX: a shop visited with no order, and why — "no order ganapathi shop closed", "velan no order, stock irukku",
// "selvam kadai closed today". Shown as a table; the visit is saved only on ✓ (one visit per shop, per person, per day),
// so the shop counts as done on the salesman's beat. Never an order, never a change to an order already booked.
import { newId } from './db';
import { norm } from './match';
import { shopOptions, type Proposal } from './proposals';
import { NO_ORDER_REASONS } from './field';
import type { Role, Shop } from './types';
import type { Reply } from './engine';

const NO_ORDER = /\b(no order|no orders|order not|not order|nothing to order|no need order|order nil|nil order)\b/;
const CLOSED = /\b(closed|close|shut|holiday|locked)\b/;

/** the reason in the person's words → one of the beat screen's reasons */
export function noOrderReason(t: string): string {
  if (CLOSED.test(t)) return 'Shop closed';
  if (/\b(stock (available|enough|full|is there|there|has|have)|enough stock|have stock|has stock|stock full|still (have|has) stock)\b/.test(t)) return 'Stock is enough';
  if (/\b(owner (not|absent|out|away|not there|not available)|no owner)\b/.test(t)) return 'Owner not there';
  if (/\b(no (money|cash|panam)|(money|cash|panam) not|next week pay|pay later)\b/.test(t)) return 'No money now';
  if (/\b(buys? from|buying from|other distributor|another distributor|elsewhere)\b/.test(t)) return 'Buys from elsewhere';
  return 'Other';
}

/** a no-order visit, when the message says so for one shop (and has no items or money in it) */
export async function noOrderVisit(textIn: string, shop: Shop | undefined, role: Role, hasItems: boolean): Promise<Reply | null> {
  const t = norm(textIn);
  const said = NO_ORDER.test(t) || (CLOSED.test(t) && /\b(shop|shops|closed today|today closed|is closed)\b/.test(t));
  if (!said || !shop || hasItems || /\d/.test(t)) return null;
  if (/\b(cancel|cancelled|delete|remove|change|edit|bill|payment|paid)\b/.test(t)) return null;
  if (role !== 'salesman' && role !== 'owner' && role !== 'office') return { text: 'Only the salesman marks a shop visit. Ask them.', tone: 'warn', refused: true };
  const reason = noOrderReason(t);
  const proposal: Proposal = {
    id: newId(), kind: 'visit', title: 'Shop visit · no order',
    fields: [
      { key: 'shopId', label: 'Shop', type: 'select', options: await shopOptions(), value: shop.id, readonly: true },
      { key: 'reason', label: 'Why no order', type: 'select', options: NO_ORDER_REASONS.map(r => ({ value: r, label: r })), value: reason },
    ],
    columns: [{ key: 'said', label: 'You said', readonly: true, width: 220 }],
    rows: [{ said: textIn }],
    meta: {},
  };
  return { text: `${shop.name}: visited, no order (${reason.toLowerCase()}). Check and tap ✓.`, proposal };
}
