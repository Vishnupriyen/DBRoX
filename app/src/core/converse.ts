// TESRAX in a conversation: one message can ask for several things ("Murugan paid 500, send 2 case surf"), and the
// next message can refer to the table just shown ("make it 600", "for Selvam", "add 2 vim", "yes", "no").
// Every part still goes through handleOne(), and nothing is saved before ✓.
import { db, newId } from './db';
import { bestProduct, cleanSaid, findShopInText, hasWord as has, norm, parseItemLines, toPieces } from './match';
import { handleOne, SCREENS, setDry, W, type Reply } from './engine';
import { categoryOf, orderOps } from './modify';
import { orderRow, type Proposal, type Row } from './proposals';
import type { Product, Shop } from './types';

export interface Context { last?: Reply }

export async function handle(said: string, files: File[], ctx?: Context): Promise<Reply> {
  if (!files.length && ctx?.last) { const f = await followUp(said, ctx.last); if (f) return f; }
  if (!files.length) {
    const groups = await splitIntents(said);
    if (groups.length === 1 && groups[0] !== said) return handleOne(groups[0], []);
    if (groups.length > 1) {
      const parts: Reply[] = [];
      for (const g of groups) parts.push(await handleOne(g, []));
      return { text: `That's ${parts.length} things. Each one is below — check and tap ✓ on each.`, parts };
    }
  }
  return handleOne(said, files);
}

// ------------------------------------------------------------------------------------------------------------
// SEVERAL THINGS IN ONE MESSAGE
// The message is cut at "," "." "?" "/" "+" "and" "also" "then"; each piece is tried on its own (nothing saved).
// A piece that means nothing alone ("24 good day", "it is 300", "main road") belongs to the piece before it;
// a piece that needs the shop said before gets it ("Murugan paid 500, send 2 case surf").
const CONT = /\b(entry|mistake|wrong entry|no|not|its|it s|it is|it was|it|is|was|for|to|the|please|sorry|make|make it|instead|amount|rs|rupees|only|actually|actual|correct|wrong|sir|ok|this|that|one|of|in|wait|now|should be|van|auto|right|then|so)\b/g;
let ANCHORS: string[] | null = null;
const VERB = /^(cancel|delete|remove|change|edit|update|undo)\b/;
const CARRY = /\b(cancel|delete|remove|count|counted)\b/;
const MERGE = new Set(['order', 'orderEdit', 'return', 'claim']);

function actionable(r: Reply) {
  if (r.proposal || r.table || r.go || r.refused || r.parts || (r.tone === 'ok' && !r.pending)) return true;
  if (r.pending?.need === 'shop') return false;
  return r.tone === 'warn' && /^(I couldn't find|Can't |There's nothing of yours|Did |The ₹|No product matches)/.test(r.text);
}
/** what a piece asks for: the same thing twice is one thing ("undo, undo pls"); items for one shop's order belong together */
function sig(r: Reply): string {
  const p = r.proposal;
  const f = (k: string) => p?.fields.find(x => x.key === k)?.value ?? '';
  if (p) return MERGE.has(p.kind) ? `${p.kind}:${f('shopId')}` : `${p.kind}:${f('shopId')}:${f('productId')}:${f('amount')}:${f('was')}:${JSON.stringify(p.rows[0] ?? {})}`;
  if (r.go) return `go:${r.go}`;
  if (r.table) return `t:${r.table.name}:${JSON.stringify(r.table.rows[0] ?? [])}`;
  return `x:${r.text}`;
}

export async function splitIntents(said: string): Promise<string[]> {
  const t = cleanSaid(said).replace(/(\d),(\d{3})\b/g, '$1$2')
    // "2000 cash 1000 gpay" = two payments
    .replace(/(\d+(?:\.\d+)?\s*(?:cash|upi|gpay|google pay|phonepe|paytm|cheque|chq|neft))\s+(?=\d+(?:\.\d+)?\s*(?:cash|upi|gpay|google pay|phonepe|paytm|cheque|chq|neft)\b)/gi, '$1, ');
  const segs = t.split(/\s*(?:;|\n|,|\?|\.(?=\s|$)|\s\/\s|\s\+\s|\band also\b|\band then\b|\balso\b|\bthen\b|\bapram\b|\bnext\b|\band\b|\s&\s)\s*/i).map(x => x.trim()).filter(Boolean);
  if (segs.length < 2) return [said];
  const shops = (await db.shops.toArray()).filter(s => s.active !== false);
  // quick look first: when no later piece could be a request of its own, it is one request (most orders with commas)
  const anchors = ANCHORS ??= [...new Set([...Object.values(W).flat(), ...SCREENS.flatMap(x => x.words), 'leave', 'advance', 'undo', 'count', 'counted', 'short', 'extra', 'excess', 'missing', 'reduce', 'rate', 'mrp', 'price', 'phone', 'limit', 'credit', 'gst', 'scheme', 'schemes', 'offer', 'outstanding', 'bal', 'balance', 'stock'].filter(w => !/[^\x00-\x7f]/.test(w) && w.length > 1))];
  const products0 = (await db.products.toArray()).filter(p => p.active);
  const firstIsItems = parseItemLines(findShopInText(shops, segs[0]).rest).some(l => !!bestProduct(products0, l.productText).product) && !has(norm(segs[0]), W.paid) && !VERB.test(norm(segs[0]))
    && !/\b(count|counted|short|shortage|reduce|extra|excess|missing|stock|correct|only|damaged|expired|return|returned)\b/.test(norm(segs[0]));
  if (firstIsItems && !segs.slice(1).some(x => { const n = norm(x); return VERB.test(n) || CARRY.test(n) || has(n, anchors) || !!findShopInText(shops, x).shop; })) return [said];
  type G = { parts: string[]; shop?: Shop; sig?: string; verb?: string; orderish?: boolean };
  const groups: G[] = [];
  const probe = async (s: string) => { setDry(true); try { return await handleOne(s, []); } finally { setDry(false); } };
  const products = (await db.products.toArray()).filter(p => p.active);
  let lend = '';
  let asked = false; // a "is 96 correct?" question was folded into the next piece
  for (let seg of segs) {
    if (lend) { seg = `${lend} ${seg}`; lend = ''; }
    const pre = norm(seg).match(/^(.+?)\s+\d+\s+(?:correct|right|ok)\s*\?*$/);
    if (pre && bestProduct(products, pre[1]).product) { lend = pre[1]; asked = true; continue; }
    const n = norm(seg);
    const prev = groups[groups.length - 1];
    if (prev && !n.replace(CONT, ' ').replace(/\b\d+(\.\d+)?\b/g, ' ').trim()) { prev.parts.push(seg); continue; } // "it is 300"
    const shop = findShopInText(shops, seg).shop;
    // the rest of an order change ("change murugan order surf 2 case, vim 24") stays with it
    if (prev?.orderish && !shop) { prev.parts.push(seg); continue; }
    const prevText = prev?.parts[prev.parts.length - 1];
    let used = seg;
    // more items for the order (or return / damage) just said: "lifebuoy 10 cs, vim 10 cs" stays one order
    if (prev?.shop && !shop && (!prev.sig || MERGE.has(prev.sig.split(':')[0]))) {
      const rr = await probe(`${prev.shop.name} ${seg}`);
      if (actionable(rr) && (!prev.sig || sig(rr) === prev.sig)) { prev.parts.push(seg); prev.sig ??= sig(rr); continue; }
    }
    let r = await probe(seg);
    // the shop said before, when the piece alone is not a table of its own ("credit days 15", "his balance", "2 case surf")
    if (prev?.shop && !shop && !r.proposal) { const w = `${prev.shop.name} ${seg}`; const r2 = await probe(w); if (r2.proposal || (r2.table && !actionable(r)) || (r2.table && /Outstanding/.test(r2.table.name))) { r = r2; used = w; } }
    if (!actionable(r) && shop && /\d/.test(n) && prevText) {
      const lent = bestProduct(products, norm(prevText).replace(/\b(stock|how much|how many|is|available)\b/g, ' ').trim()).product;
      if (lent) { const w = `${seg} ${lent.name}`; const r4 = await probe(w); if (actionable(r4)) { r = r4; used = w; } }
    }
    if (!actionable(r) && prev?.verb && !VERB.test(n) && !CARRY.test(n)) { const w = `${prev.verb} ${seg}`; const r3 = await probe(w); if (actionable(r3)) { r = r3; used = w; } }
    const verb = n.match(VERB)?.[1] ?? n.match(CARRY)?.[1] ?? prev?.verb;
    const fromTable = shops.find(s => s.id === String(r.proposal?.fields.find(f => f.key === 'shopId')?.value ?? ''));
    const pshop = shop ?? fromTable ?? (used !== seg ? prev?.shop : undefined);
    if (!actionable(r)) { if (prev) prev.parts.push(seg); else groups.push({ parts: [seg], shop, verb }); continue; }
    const s = sig(r);
    if (prev && prev.parts.length === 1 && !/\d/.test(prev.parts[0]) && s.startsWith('expense') && has(norm(prev.parts[0]), W.expense)) { prev.parts.push(seg); prev.sig = s; continue; }
    if (prev && !prev.sig) { prev.parts.push(seg); prev.sig = s; prev.orderish = /^order(Edit|Cancel)/.test(r.proposal?.kind ?? '') || /open order|change this order/.test(r.text); prev.shop ??= pshop; prev.verb ??= verb; continue; }
    if (prev && prev.sig === s) { prev.parts.push(seg); continue; }
    groups.push({ parts: [used], shop: pshop, sig: s, verb, orderish: /^order(Edit|Cancel)/.test(r.proposal?.kind ?? '') || /open order|change this order/.test(r.text) });
  }
  if (asked && groups.length === 1 && groups[0].sig) return [groups[0].parts.join(', ')];
  if (groups.length < 2 || groups.some(g => !g.sig)) return [said];
  if (groups.some(g => g.sig?.startsWith('payment'))) for (const g of groups) if (g.sig?.startsWith('x:Did ')) g.parts[0] += ' paid';
  return groups.map(g => g.parts.join(', '));
}

// ------------------------------------------------------------------------------------------------------------
// FOLLOW-UPS to the table just shown
const YES_W = new Set(['yes', 'ok', 'okay', 'save', 'confirm', 'confirmed', 'correct', 'done', 'fine', 'go', 'ahead', 'approve', 'approved', 'right', 'perfect', 'good', 'it', 'that', 'this', 'its', 's', 'is', 'please', 'now', 'sir', 'both', 'all', 'cancel', 'proceed', 'super', 'yeah', 'yep', 'k', 'thats', 'them']);
const YES_STRONG = /\b(yes|ok|okay|save|confirm|confirmed|correct|done|fine|go ahead|approve|approved|right|perfect|proceed|yeah|yep|k)\b/;
const NO_W = new Set(['no', 'nope', 'cancel', 'leave', 'drop', 'forget', 'wrong', 'dont', 'don', 't', 'do', 'not', 'save', 'needed', 'need', 'skip', 'discard', 'ignore', 'it', 'that', 'this', 'please', 'now', 'sir', 'all', 'both', 'never', 'mind', 'nevermind', 'scrap', 'delete']);
const NO_STRONG = /\b(no|nope|cancel|leave|drop|forget|skip|discard|ignore|scrap|never mind|nevermind|dont save|don t save|do not save)\b/;
const FILL = /\b(no|not|its|it s|it is|it was|it|is|was|yes|for|to|the|shop|please|sorry|make|make it|change|change to|change it to|changed to|instead|amount|rs|rupees|only|actually|correct|wrong|sir|ok|oh|this|that|one|order|payment|expense|bill|of|in|wait|now|total|plan|so|then|also|just|actual)\b/g;

const allIn = (t: string, set: Set<string>) => t.split(' ').every(w => set.has(w));

async function followUp(said: string, last: Reply): Promise<Reply | null> {
  const textIn = cleanSaid(said);
  const t = norm(textIn);
  if (!t) return null;
  const shops = (await db.shops.toArray()).filter(s => s.active !== false);
  const products = (await db.products.toArray()).filter(p => p.active);
  const areas = [...new Set(shops.map(s => norm(s.area ?? '')).filter(Boolean))];
  const staff = (await db.staff.toArray()).map(s => norm(s.name.split(' ')[0]));
  const p = last.proposal;
  const curShopId = String(p?.fields.find(x => x.key === 'shopId')?.value ?? '');
  // every shop named ("not velan, selvam", "not velan, kumar mart"); the one that is not the current one is meant
  const named = shops.filter(s => findShopInText([s], textIn).shop);
  const others = named.filter(s => s.id !== curShopId);
  const shop = named.length === 1 ? named[0] : others.length === 1 ? others[0] : undefined;
  let rest = textIn;
  for (const s of named) rest = findShopInText([s], rest).rest;
  let restBare = norm(rest).replace(FILL, ' ');
  for (const a of [...areas, ...staff]) restBare = restBare.replace(new RegExp(`\\b${a}\\b`, 'g'), ' ');
  restBare = restBare.replace(/\s+/g, ' ').trim();

  // TESRAX asked "which shop?" — the answer is just a shop name
  if (last.pending?.need === 'shop' && shop && !restBare) return handleOne(`${shop.name} ${last.pending.said}`, []);
  // TESRAX asked "what is the correct amount?"
  if (last.pending?.need === 'amount') { const m = restBare.match(/^(\d+(?:\.\d+)?)$/); if (m) return handleOne(`${last.pending.said} it is ${m[1]}`, []); }

  if (!p) return null;
  if (YES_STRONG.test(t) && allIn(t, YES_W) && !/^cancel/.test(t)) return { text: 'Tap ✓ on the table to save it. I never save money or stock from a typed "yes".', tone: 'ok', follow: 'tap' };
  if (NO_STRONG.test(t) && allIn(t, NO_W)) return { text: 'OK, dropped. Nothing was saved.', tone: 'ok', follow: 'dropped', replaces: true };

  const f = (k: string) => p.fields.find(x => x.key === k);
  const amountIn = (words: string) => {
    const nums = (words.match(/\b\d+(?:\.\d+)?\b/g) ?? []).map(Number);
    if (!nums.length || words.replace(/\b\d+(?:\.\d+)?\b/g, '').trim()) return undefined;
    const not = norm(rest).match(/\bnot (\d+(?:\.\d+)?)\b/);
    const keep = nums.filter(x => !not || x !== Number(not[1]));
    return keep.length ? keep[keep.length - 1] : undefined;
  };
  const mode = /\b(upi|gpay|google pay|phonepe|paytm|neft|imps)\b/.test(t) ? 'upi' : /\b(cheque|chq|check)\b/.test(t) ? 'cheque' : /\bcash\b/.test(t) ? 'cash' : undefined;
  const otherShop = shop && shop.id !== curShopId ? shop : undefined;
  const reshape = (r: Reply): Reply => ({ ...r, replaces: true });

  switch (p.kind) {
    case 'payment': {
      const words = restBare.replace(/\b(upi|gpay|google pay|phonepe|paytm|neft|imps|cheque|chq|check|cash|by|via|through|thru|paid|received|collected|got|gave|pd|rcvd)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (words.replace(/\b\d+(?:\.\d+)?\b/g, '').trim()) return null;
      const newAmount = amountIn(words);
      if (!otherShop && newAmount == null && !mode) return null;
      if (otherShop && newAmount != null && mode) return null; // "velan 600 cash" is a new payment, not a change
      const shopName = otherShop?.name ?? shops.find(s => s.id === curShopId)?.name ?? '';
      const amount = newAmount ?? Number(f('amount')?.value ?? 0);
      return reshape(await handleOne(`${shopName} paid ${amount} ${mode ?? String(f('mode')?.value ?? 'cash')} ${String(f('ref')?.value ?? '')}`.trim(), []));
    }
    case 'paymentFix': {
      const newAmount = amountIn(restBare);
      if (newAmount == null || shop) return null;
      const shopName = shops.find(s => s.id === curShopId)?.name ?? '';
      return reshape(await handleOne(`${shopName} it is not ${f('was')?.value} it is ${newAmount}`, []));
    }
    case 'expense': case 'expenseFix': {
      if (shop) return null;
      const cat = categoryOf(t);
      const vocab = [...W.expense, ...W.expense.flatMap(w => w.split(' ')), 'gate', 'driver', 'office', 'godown', 'shop', 'van', 'auto', 'vehicle', 'bunk', 'unloading', 'coolie', 'plan', 'bill', 'charges', 'category', 'type', 'under', 'head'].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const words = restBare.replace(new RegExp(`\\b(${vocab.join('|')})\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
      if (words.replace(/\b\d+(?:\.\d+)?\b/g, '').trim()) return null;
      const newAmount = amountIn(words);
      if (newAmount == null && cat === 'Other') return null;
      const rows = p.rows.map((r, i) => i === 0 ? { ...r, ...(newAmount != null ? { amount: newAmount } : {}), ...(cat !== 'Other' ? { category: cat } : {}) } : r);
      const fields = p.kind === 'expenseFix' ? p.fields.map(x => x.key === 'action' ? { ...x, value: 'edit' } : x) : p.fields;
      return { text: 'Changed. Check and tap ✓.', proposal: { ...p, id: newId(), rows, fields }, replaces: true };
    }
    case 'order': case 'orderEdit': {
      if (otherShop && p.kind === 'order' && !restBare) {
        return { text: `Moved to ${otherShop.name}. Check and tap ✓.`, proposal: { ...p, id: newId(), fields: p.fields.map(x => x.key === 'shopId' ? { ...x, value: otherShop.id } : x) }, replaces: true };
      }
      if (shop) return null; // a shop named with items is a new order, not a change to this one
      const rows = await applyOrderFollow(p, textIn.replace(/\b(also|too)\b/gi, ' '), products);
      return rows ? { text: 'Changed. Check and tap ✓.', proposal: { ...p, id: newId(), rows }, replaces: true } : null;
    }
    default:
      return null;
  }
}

/** "add 2 vim", "remove surf", "make it 3 case" (the last item), "24 good day" → the order's new rows */
async function applyOrderFollow(p: Proposal, textIn: string, products: Product[]): Promise<Row[] | null> {
  const t = norm(textIn).replace(/\b(please|only|now|sir|ok)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const schemes = await db.schemes.toArray();
  const byId = new Map(products.map(x => [x.id, x]));
  const rows = p.rows.map(r => ({ ...r }));
  const ops = orderOps(textIn, products);
  if (!ops.length) {
    // no product named: the quantity is for the last item ("make it 3 case", "8 case only")
    const m = t.match(/^(?:make it |make |change to |change it to |it is |its |no |not \d+ \w* ?)?(\d+)\s*(case|cases|cs|box|dozen|dz|pcs|pieces|nos)?$/);
    if (!m || !rows.length) return null;
    const last = rows[rows.length - 1];
    const prod = byId.get(String(last.productId)); if (!prod) return null;
    const unit = /case|cs|box/.test(m[2] ?? '') ? 'case' : /dozen|dz/.test(m[2] ?? '') ? 'dozen' : 'pcs';
    rows[rows.length - 1] = { ...last, ...(await orderRow(prod, toPieces(Number(m[1]), unit, prod), String(last.said ?? ''), schemes, Number(last.rate) || prod.rate)) };
    return rows;
  }
  for (const op of ops) {
    const i = rows.findIndex(r => r.productId === op.product.id);
    const was = i >= 0 ? Number(rows[i].qty) : 0;
    const qty = op.mode === 'remove' ? 0 : op.mode === 'set' ? op.qty! : op.mode === 'add' ? was + op.qty! : Math.max(0, was - op.qty!);
    if (i >= 0) {
      if (qty === 0 && p.kind === 'order') { rows.splice(i, 1); continue; }
      rows[i] = { ...rows[i], ...(await orderRow(op.product, qty, String(rows[i].said ?? ''), schemes, Number(rows[i].rate) || op.product.rate)) };
    } else if (qty > 0) rows.push({ ...(await orderRow(op.product, qty, '', schemes)), ...(p.kind === 'orderEdit' ? { was: 0 } : {}) });
  }
  return rows;
}
