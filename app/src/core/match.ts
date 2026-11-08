import type { Product, Shop } from './types';

export const norm = (s: string) =>
  s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

function tokens(s: string) { return norm(s).split(' ').filter(Boolean); }

// Simple, explainable similarity: shared words, with partial credit for prefixes ("surf" ~ "surfexcel").
export function similarity(query: string, target: string): number {
  const q = tokens(query), tt = tokens(target);
  if (!q.length || !tt.length) return 0;
  let hit = 0;
  for (const a of q) {
    let best = 0;
    for (const b of tt) {
      if (a === b) best = Math.max(best, 1);
      else if (a.length >= 3 && (b.startsWith(a) || a.startsWith(b))) best = Math.max(best, 0.8);
      else if (a.length >= 4 && b.includes(a)) best = Math.max(best, 0.6);
      else if (a.length >= 5 && b.length >= 5 && lev(a, b) === 1) best = Math.max(best, 0.85); // one slip: "lifeboy", "classamte"
    }
    if (best < 0.8 && a.length >= 5 && tt.join('').includes(a)) best = 0.8; // written together: "goodday" ~ "Good Day"
    hit += best;
  }
  return hit / Math.max(q.length, 1);
}

export function bestProduct(products: Product[], q: string): { product?: Product; score: number } {
  let best: Product | undefined; let score = 0;
  for (const p of products) {
    const names = [p.name, p.code ?? '', ...p.aliases];
    for (const n of names) {
      if (!n) continue;
      const s = n && norm(n) === norm(q) ? 1.2 : similarity(q, n);
      if (s > score) { score = s; best = p; }
    }
  }
  return { product: score >= 0.6 ? best : undefined, score };
}

// Generic words in shop names. "Lakshmi" finds "Sri Lakshmi Traders"; "stores" alone finds nothing.
const SHOP_GENERIC = new Set(['sri', 'shree', 'shri', 'new', 'the', 'stores', 'store', 'traders', 'trader', 'mart', 'super', 'market', 'supermarket', 'agency', 'agencies', 'provision', 'provisions', 'kirana', 'wholesale', 'shop', 'enterprises', 'general', 'and', 'co', 'company', 'centre', 'center', 'bros', 'brothers']);

export function findShopInText(shops: Shop[], text: string): { shop?: Shop; rest: string } {
  const n = ` ${norm(text)} `;
  const areas = new Set(shops.map(s => norm(s.area ?? '')).filter(Boolean));
  const scored: { shop: Shop; score: number; phrase: string }[] = [];
  for (const s of shops) {
    for (const name of [s.name, ...s.aliases]) {
      const nn = norm(name); if (!nn) continue;
      const words = nn.split(' ');
      // 1) the whole name; 2) its first 2+ words ("pennadam wholesale"); 3) its distinctive word ("lakshmi", "selvam")
      if (n.includes(` ${nn} `)) { scored.push({ shop: s, score: 100 + nn.length, phrase: nn }); continue; }
      let hit = false;
      for (let k = words.length - 1; k >= 2 && !hit; k--) { const pre = words.slice(0, k).join(' '); if (n.includes(` ${pre} `)) { scored.push({ shop: s, score: 50 + pre.length, phrase: pre }); hit = true; } }
      if (hit) continue;
      let found = false;
      for (const w of words) if (w.length >= 4 && !SHOP_GENERIC.has(w) && !areas.has(w) && n.includes(` ${w} `)) { scored.push({ shop: s, score: 10 + w.length, phrase: w }); found = true; break; }
      if (found) continue;
      // one-letter typo in the distinctive word ("murgan" → Murugan): weaker than an exact hit
      for (const w of words) {
        if (w.length < 5 || SHOP_GENERIC.has(w) || areas.has(w)) continue;
        const typo = n.trim().split(' ').find(x => x.length >= 4 && lev(x, w) === 1);
        if (typo) { scored.push({ shop: s, score: 5 + w.length, phrase: typo }); break; }
      }
    }
  }
  if (!scored.length) return { rest: text };
  scored.sort((a, b) => b.score - a.score);
  // the same distinctive word in two shops (e.g. two "Murugan"s) → don't guess; the caller asks
  if (scored.length > 1 && scored[1].score === scored[0].score && scored[1].shop.id !== scored[0].shop.id) return { rest: text };
  const best = scored[0].shop;
  // take the shop's words out of the ORIGINAL text, keeping commas so item lines still split
  const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let rest = text;
  for (const name of [best.name, ...best.aliases].sort((x, y) => y.length - x.length)) {
    const words = name.trim().split(/\s+/).map(escape).join('[\\s.,-]*');
    rest = rest.replace(new RegExp(words, 'i'), ' ');
  }
  for (const w of norm(best.name).split(' ').concat(scored[0].phrase.split(' '))) if (w.length >= 2) rest = rest.replace(new RegExp(`(^|[^a-z0-9])${escape(w)}(?=[^a-z0-9]|$)`, 'ig'), ' ');
  return { shop: best, rest: rest.replace(/^[\s,;:-]+/, '').replace(/\s+/g, ' ') };
}

const CASE_WORDS = ['case', 'cases', 'cs', 'c', 'cse', 'box', 'boxes', 'ctn', 'carton', 'cartons'];
const PCS_WORDS = ['pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'units', 'unit', 'pkt', 'pkts', 'packet', 'packets', 'bag', 'bags', 'bottle', 'bottles', 'tin', 'tins', 'bar', 'bars'];
const DOZEN_WORDS = ['dozen', 'dozens', 'dz', 'dzn', 'doz'];
// pack sizes are part of the product name, never a quantity: "5kg", "250 g", "172 pages"
const MEASURE = new Set(['kg', 'kgs', 'g', 'gm', 'gms', 'gram', 'grams', 'ml', 'l', 'ltr', 'litre', 'liter', 'pages', 'page', 'mm', 'cm']);
const FILLER = new Set(['order', 'orders', 'take', 'new', 'for', 'please', 'pls', 'plz', 'send', 'need', 'needs', 'want', 'wants', 'give', 'of', 'the', 'to', 'x', 'each', 'also', 'more', 'add', 'extra', 'additional', 'another', 'from', 'book', 'booking']);

export interface ParsedLine { text: string; qty: number; unit: 'case' | 'pcs' | 'dozen'; productText: string }
const unitOf = (w: string): ParsedLine['unit'] | null => CASE_WORDS.includes(w) ? 'case' : DOZEN_WORDS.includes(w) ? 'dozen' : PCS_WORDS.includes(w) ? 'pcs' : null;

// "5 case surf, 10 lifebuoy and 2 dozen good day", "surf 2 case lifebuoy 48", "2cs surf 1 dz vim" → lines.
export function parseItemLines(text: string): ParsedLine[] {
  // "2,450" is one number, not two items
  const parts = text.replace(/(\d),(\d{3})\b/g, '$1$2').split(/,|\n|;|\+| and | also | & /i).map(x => x.trim()).filter(Boolean);
  const out: ParsedLine[] = [];
  for (const part of parts) {
    // split glued quantity+unit ("2cs", "1c", "12pcs"), keep pack sizes glued ("5kg", "250g")
    const raw = norm(part).split(' ').flatMap(w => { const m = w.match(/^(\d+)([a-z]+)$/); return m && !MEASURE.has(m[2]) && unitOf(m[2]) ? [m[1], m[2]] : [w]; });
    // a number followed by a measure word belongs to the name ("172 pages", "5 kg")
    const toks: { w: string; num: boolean }[] = [];
    for (let i = 0; i < raw.length; i++) {
      const w = raw[i];
      if (/^\d+(\.\d+)?$/.test(w) && MEASURE.has(raw[i + 1] ?? '')) { toks.push({ w: `${w}${raw[i + 1]}`, num: false }); i++; continue; }
      if (FILLER.has(w)) continue;
      toks.push({ w, num: /^\d+(\.\d+)?$/.test(w) });
    }
    if (!toks.some(t => t.num)) continue;
    const items: { qty: number; unit: ParsedLine['unit']; words: string[] }[] = [];
    if (toks[0].num) {
      // quantity first: each number starts an item ("2 case surf excel 1 dozen lifebuoy")
      for (const t of toks) {
        if (t.num) { items.push({ qty: Number(t.w), unit: 'pcs', words: [] }); continue; }
        const it = items[items.length - 1]; const u = unitOf(t.w);
        if (u && !it.words.length) it.unit = u; else it.words.push(t.w);
      }
    } else {
      // quantity after the name: "surf 2 case lifebuoy 48"
      let words: string[] = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (!t.num) { words.push(t.w); continue; }
        const u = unitOf(toks[i + 1]?.w ?? '');
        items.push({ qty: Number(t.w), unit: u ?? 'pcs', words }); words = [];
        if (u) i++;
      }
      if (words.length && items.length) items[items.length - 1].words.push(...words.filter(w => !unitOf(w)));
    }
    for (const it of items) {
      const productText = it.words.filter(w => !unitOf(w) || it.words.length === 1).join(' ').trim();
      if (productText && it.qty > 0) out.push({ text: part, qty: it.qty, unit: it.unit, productText });
    }
  }
  return out;
}

export function toPieces(qty: number, unit: ParsedLine['unit'], p: Product) {
  return unit === 'case' ? qty * p.caseSize : unit === 'dozen' ? qty * 12 : qty;
}

export function findAmount(text: string): number | undefined {
  const m = text.replace(/,/g, '').match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d{1,2})?)/i);
  return m ? Number(m[1]) : undefined;
}

// ---------------------------------------------------------------- reading messy typing
/** edit distance, two letters swapped counting as one slip ("murgan", "selvma", "annia" ~ Murugan, Selvam, Annai) */
export function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE: Record<string, number> = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000 };
/** "one thousand five hundred" → "1500", "twelve" → "12" (voice typing writes numbers as words) */
export function wordsToNumbers(t: string): string {
  const w = t.split(/(\s+)/);
  const out: string[] = [];
  let i = 0;
  while (i < w.length) {
    const lw = w[i].toLowerCase().replace(/[^a-z]/g, '');
    if (ONES[lw] == null && TENS[lw] == null && !(SCALE[lw] && out.length === 0)) { out.push(w[i]); i++; continue; }
    let total = 0, cur = 0, j = i, used = 0;
    while (j < w.length) {
      const x = w[j].toLowerCase().replace(/[^a-z]/g, '');
      if (/^\s+$/.test(w[j]) || x === 'and') { j++; continue; }
      if (ONES[x] != null) cur += ONES[x];
      else if (TENS[x] != null) cur += TENS[x];
      else if (x === 'hundred') cur = (cur || 1) * 100;
      else if (SCALE[x]) { total += (cur || 1) * SCALE[x]; cur = 0; }
      else break;
      used = j + 1; j++;
    }
    if (!used) { out.push(w[i]); i++; continue; }
    out.push(String(total + cur) + w[used - 1].replace(/^[A-Za-z]+/, '')); // keep a comma or full stop typed after it
    // keep the space that followed the last number word
    i = used;
  }
  return out.join('');
}

// shorthand → plain words TESRAX knows (whole words only). English only for launch.
const SAY: [RegExp, string][] = [
  [/\b(rs|inr)\.\s*/gi, 'rs '], [/\b(\d+(?:\.\d+)?)\s?k\b/gi, '__K$1'],
  [/\s*(→|->|=>|-->)\s*/g, ' changed to '],
  [/\b(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs)\b/gi, '__L$1'],
  [/\b(ordr|odr|ordar|oder)\b/gi, 'order'], [/\bphone\s*pe\b/gi, 'phonepe'], [/\b(trdrs|tradrs|trdr|tradr)\b/gi, 'traders'], [/\bcooly\b/gi, 'coolie'],
  [/\bpd\b/gi, 'paid'], [/\b(rcvd|recd|recvd|recieved|receieved|recived|revd)\b/gi, 'received'], [/\bfrm\b/gi, 'from'],
  [/\b(for him|for her|for them|to him|to her|to them)\b/gi, ' '],
  [/\bu\b/gi, 'you'], [/\bamt\b/gi, 'amount'], [/\b(pls|plz|plss)\b/gi, 'please'], [/\b(tmrw|tmr|tmrrw|tomo|tommorow|tomorow)\b/gi, 'tomorrow'],
  [/\bbal\b/gi, 'balance'], [/\bo\/s\b/gi, 'outstanding'], [/\b(qty)\b/gi, 'quantity'],
  [/\b(settled|settle|cleared)\b/gi, 'paid'],
  [/\b(sir|bro|boss|madam|mam)\b/gi, ' '],
];
/** one clean-up pass before TESRAX reads a message */
export function cleanSaid(t: string): string {
  let s = wordsToNumbers(t);
  for (const [rx, to] of SAY) s = s.replace(rx, to);
  s = s.replace(/__K(\d+(?:\.\d+)?)/g, (_, n) => String(Math.round(Number(n) * 1000))).replace(/__L(\d+(?:\.\d+)?)/g, (_, n) => String(Math.round(Number(n) * 100000)));
  return s.replace(/\/-/g, ' ').replace(/\s+/g, ' ').trim();
}

const wordRx = new Map<string, RegExp>();
/** whole words only ("rent" is not in "current", "tea" is not in "team"); a plural s/es is allowed */
export const hasWord = (t: string, words: string[]) => words.some(w => {
  if (/[^\x00-\x7f]/.test(w)) return t.includes(w);
  let r = wordRx.get(w);
  if (!r) { r = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?(?=[^a-z0-9]|$)`); wordRx.set(w, r); }
  return r.test(t);
});
