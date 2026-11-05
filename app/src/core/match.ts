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
    }
    hit += best;
  }
  return hit / Math.max(q.length, 1);
}

export function bestProduct(products: Product[], q: string): { product?: Product; score: number } {
  let best: Product | undefined; let score = 0;
  for (const p of products) {
    const names = [p.name, p.nameTa ?? '', p.code ?? '', ...p.aliases];
    for (const n of names) {
      if (!n) continue;
      const s = n && norm(n) === norm(q) ? 1.2 : similarity(q, n);
      if (s > score) { score = s; best = p; }
    }
  }
  return { product: score >= 0.6 ? best : undefined, score };
}

export function findShopInText(shops: Shop[], text: string): { shop?: Shop; rest: string } {
  const n = norm(text);
  let best: Shop | undefined; let bestLen = 0;
  for (const s of shops) {
    for (const name of [s.name, ...s.aliases]) {
      const nn = norm(name);
      if (nn && n.includes(nn) && nn.length > bestLen) { best = s; bestLen = nn.length; }
      // allow first word + "stores/traders" dropped, e.g. "murugan" for "Murugan Stores"
      const first = nn.split(' ')[0];
      if (!best && first.length >= 4 && new RegExp(`(^| )${first}( |$)`).test(n) && first.length > bestLen) {
        best = s; bestLen = first.length;
      }
    }
  }
  if (!best) return { rest: text };
  // remove the shop name from the ORIGINAL text, keeping commas so item lines still split
  const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let rest = text;
  for (const name of [best.name, ...best.aliases].sort((a, b) => b.length - a.length)) {
    const words = name.trim().split(/\s+/).map(escape).join('[\\s.,-]*');
    rest = rest.replace(new RegExp(words, 'i'), ' ');
  }
  const first = escape(best.name.split(/\s+/)[0]);
  rest = rest.replace(new RegExp(`(^|\\s)${first}(?=\\s|,|$)`, 'i'), ' ');
  return { shop: best, rest: rest.replace(/^[\s,;:-]+/, '') };
}

const CASE_WORDS = ['case', 'cases', 'cs', 'box', 'boxes', 'ctn', 'carton', 'cartons', 'கேஸ்', 'பெட்டி'];
const PCS_WORDS = ['pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'units', 'unit', 'பீஸ்', 'எண்ணம்'];
const DOZEN_WORDS = ['dozen', 'dz', 'doz', 'டஜன்'];

export interface ParsedLine { text: string; qty: number; unit: 'case' | 'pcs' | 'dozen'; productText: string }

// "5 case surf, 10 lifebuoy and 2 dozen good day" → lines. Works with Tamil unit words too.
export function parseItemLines(text: string): ParsedLine[] {
  const parts = text.split(/,|\n|;| and | மற்றும் | & /i).map(s => s.trim()).filter(Boolean);
  const out: ParsedLine[] = [];
  for (const part of parts) {
    const words = norm(part).split(' ');
    const idx = words.findIndex(w => /^\d+(\.\d+)?$/.test(w));
    if (idx < 0) continue;
    const qty = Number(words[idx]);
    let unit: ParsedLine['unit'] = 'pcs';
    const rest = [...words];
    rest.splice(idx, 1);
    const unitIdx = rest.findIndex(w => CASE_WORDS.includes(w) || PCS_WORDS.includes(w) || DOZEN_WORDS.includes(w));
    if (unitIdx >= 0) {
      const u = rest[unitIdx];
      unit = CASE_WORDS.includes(u) ? 'case' : DOZEN_WORDS.includes(u) ? 'dozen' : 'pcs';
      rest.splice(unitIdx, 1);
    }
    const productText = rest.filter(w => !['of', 'the'].includes(w)).join(' ').trim();
    if (productText) out.push({ text: part, qty, unit, productText });
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
