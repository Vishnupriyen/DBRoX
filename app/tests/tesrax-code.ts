// What TESRAX did with a message, as a short code the training tests compare. Shared by every TESRAX test.
//   order:<shop>                 new order table            orderEdit:<shop> | orderCancel:<shop>   change / cancel an order
//   orderEdit:none               no open order found        orderEdit:locked                        packed/billed/approved: refused
//   payment:<shop>:<₹>:<mode>    payment table              fix:<old>-><new> | fix:none             payment correction
//   payCancel:<shop>:<₹>         cancel a payment           payCancel:none | payCancel:locked
//   billCancel:<shop>            cancel a bill              billCancel:none
//   expense:<₹>:<category>       expense table              expFix:<old>-><new> | expDel:<₹> | expFix:none
//   stockFix:<product>:<pcs>     stock count table          product:<product>:<field>=<value>,…     product change
//   shop:<shop>:<field>=<value>,…  shop details change      undo | undo:none                         undo the last save
//   return:<shop>  claim  newshop  schemes  leave  advance:<₹>
//   t:<table>  go:<screen>  export:<tally|gstr1|einvoice|claims>  help  ask (a clear question back, never a wrong action)
import { db } from '../src/core/db';
import { HELP_TEXT, type Reply } from '../src/core/engine';

let shopName = new Map<string, string>();
let productName = new Map<string, string>();
export async function loadNames() {
  shopName = new Map((await db.shops.toArray()).map(s => [s.id, s.name]));
  productName = new Map((await db.products.toArray()).map(p => [p.id, p.name.split(' ')[0]]));
}

export function code(r: Reply): string {
  if (r.parts?.length) return r.parts.map(code).join(' + ');
  if (r.follow) return r.follow;
  const p = r.proposal;
  if (p) {
    const f = (k: string) => p.fields.find(x => x.key === k)?.value;
    const shop = shopName.get(String(f('shopId') ?? '')) ?? '?';
    const prod = productName.get(String(f('productId') ?? '')) ?? '?';
    const kv = () => p.rows.map(x => `${x.key}=${x.value}`).join(',');
    switch (p.kind) {
      case 'order': return `order:${shop}`;
      case 'orderEdit': return `orderEdit:${shop}`;
      case 'orderCancel': return `orderCancel:${shop}`;
      case 'payment': return `payment:${shop}:${f('amount')}:${f('mode')}`;
      case 'paymentFix': return `fix:${f('was')}->${f('amount')}`;
      case 'paymentCancel': return `payCancel:${shop}:${f('amount')}`;
      case 'billCancel': return `billCancel:${shop}`;
      case 'return': return `return:${shop}`;
      case 'expense': return `expense:${p.rows[0]?.amount}:${p.rows[0]?.category}`;
      case 'expenseFix': return f('action') === 'delete' ? `expDel:${f('was')}` : `expFix:${f('was')}->${p.rows[0]?.amount}`;
      case 'stockFix': return `stockFix:${prod}:${p.meta.target}`;
      case 'productEdit': return `product:${prod}:${kv()}`;
      case 'shopEdit': return `shop:${shop}:${kv()}`;
      case 'undo': return 'undo';
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
  const t = r.text;
  if (/couldn.t find a payment to cancel/i.test(t)) return 'payCancel:none';
  if (/can.t cancel this payment/i.test(t)) return 'payCancel:locked';
  if (/couldn.t find a payment/i.test(t)) return 'fix:none'; // understood as a correction; no such payment in this data
  if (/couldn.t find an open order/i.test(t)) return 'orderEdit:none';
  if (/can.t change this order/i.test(t)) return 'orderEdit:locked';
  if (/couldn.t find a bill to cancel/i.test(t)) return 'billCancel:none';
  if (/couldn.t find .*expense/i.test(t)) return 'expFix:none';
  if (/nothing of yours to undo/i.test(t)) return 'undo:none';
  const act = r.actions?.map(a => a.label.toLowerCase()).join(' ') ?? '';
  if (/tally/.test(act)) return 'export:tally';
  if (/gstr/.test(act)) return 'export:gstr1';
  if (/e-invoice|einvoice/.test(act)) return 'export:einvoice';
  if (/claim/.test(act)) return 'export:claims';
  if (t === HELP_TEXT || t.endsWith(HELP_TEXT) && !/didn.t understand/i.test(t)) return 'help';
  if (r.tone === 'ok' && /leave/i.test(t)) return 'leave';
  if (r.tone === 'ok' && /advance/i.test(t)) return `advance:${(t.match(/₹(\d+)/) ?? [])[1]}`;
  if (r.tone === 'warn') return 'ask';
  return `other:${t.slice(0, 50)}`;
}

/** run a dialogue the way the chat screen does: each message sees the table or question just shown */
export async function converse(msgs: string[], run: (said: string, last?: Reply) => Promise<Reply>): Promise<Reply> {
  let open: Reply | undefined;
  let r: Reply = { text: '' };
  for (const said of msgs) {
    r = await run(said, open);
    if (r.replaces && r.follow === 'dropped') open = undefined;
    else if (r.parts) open = [...r.parts].reverse().find(x => x.proposal || x.pending);
    else if (r.proposal || r.pending) open = r;
    else if (!r.follow) open = undefined;
  }
  return r;
}
