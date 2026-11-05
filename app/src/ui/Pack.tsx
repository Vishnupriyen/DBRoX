import type { Product } from '../core/types';

// Product picture. Real pack photos are added per product (from the company catalogue or a photo
// of the pack); until then a clear drawn pack by category, coloured per company, so pickers can
// recognise items at a glance.
const CAT: { test: RegExp; kind: 'soap' | 'biscuit' | 'tea' | 'bag' | 'sachet' | 'book' | 'chips' | 'bottle' | 'box' }[] = [
  { test: /soap|bar|lifebuoy|lux|pears|vim/i, kind: 'soap' },
  { test: /biscuit|marie|good day|fantasy|cake|cookie/i, kind: 'biscuit' },
  { test: /tea|coffee/i, kind: 'tea' },
  { test: /atta|rice|dal|flour|sugar|salt/i, kind: 'bag' },
  { test: /shampoo|sachet/i, kind: 'sachet' },
  { test: /notebook|book|pen/i, kind: 'book' },
  { test: /chips|bingo|angles|namkeen|snack/i, kind: 'chips' },
  { test: /oil|juice|drink|water|bottle|surf.*liquid/i, kind: 'bottle' },
];

const HUES = ['#2563a8', '#d64545', '#2d8a57', '#c47a0a', '#7b4fb0', '#0e8a8a', '#b03a7a', '#5a6b2e'];
export function companyHue(companyId: string) {
  let h = 0; for (const c of companyId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function Pack({ product, size = 'md', photo }: { product: Pick<Product, 'name' | 'companyId' | 'mrp'>; size?: 'md' | 'lg'; photo?: string }) {
  const hue = companyHue(product.companyId);
  const kind = CAT.find(c => c.test.test(product.name))?.kind ?? 'box';
  const initials = product.name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  if (photo) return <div className={`pack ${size === 'lg' ? 'lg' : ''}`}><img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>;
  return (
    <div className={`pack ${size === 'lg' ? 'lg' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <rect width="64" height="64" fill={hue} opacity=".12" />
        {kind === 'soap' && <><rect x="10" y="20" width="44" height="26" rx="8" fill={hue} /><rect x="16" y="26" width="32" height="6" rx="3" fill="#fff" opacity=".7" /></>}
        {kind === 'biscuit' && <><rect x="8" y="16" width="48" height="32" rx="4" fill={hue} /><circle cx="32" cy="32" r="9" fill="#f6d9a0" /><circle cx="32" cy="32" r="5" fill="#e3b86a" /></>}
        {kind === 'tea' && <><rect x="14" y="12" width="36" height="42" rx="3" fill={hue} /><rect x="20" y="20" width="24" height="12" rx="2" fill="#fff" opacity=".8" /><path d="M24 44 q8 -8 16 0" stroke="#fff" strokeWidth="2.5" fill="none" /></>}
        {kind === 'bag' && <><path d="M18 14 h28 l6 44 h-40 z" fill={hue} /><rect x="24" y="26" width="16" height="14" rx="2" fill="#fff" opacity=".8" /></>}
        {kind === 'sachet' && <><path d="M16 10 h32 v44 h-32 z" fill={hue} /><path d="M16 14 h32 M16 50 h32" stroke="#fff" strokeWidth="2" strokeDasharray="3 2" /><circle cx="32" cy="32" r="8" fill="#fff" opacity=".8" /></>}
        {kind === 'book' && <><rect x="14" y="10" width="36" height="44" rx="3" fill={hue} /><rect x="14" y="10" width="6" height="44" fill="#000" opacity=".25" /><rect x="26" y="20" width="18" height="3" fill="#fff" /><rect x="26" y="27" width="18" height="3" fill="#fff" opacity=".7" /></>}
        {kind === 'chips' && <><path d="M18 8 h28 l-3 48 h-22 z" fill={hue} /><path d="M18 8 q14 6 28 0" fill="#fff" opacity=".5" /><circle cx="32" cy="34" r="9" fill="#f7c948" /></>}
        {kind === 'bottle' && <><rect x="26" y="6" width="12" height="8" rx="2" fill={hue} /><path d="M22 14 h20 v40 a4 4 0 0 1 -4 4 h-12 a4 4 0 0 1 -4 -4 z" fill={hue} /><rect x="26" y="26" width="12" height="14" rx="2" fill="#fff" opacity=".8" /></>}
        {kind === 'box' && <><rect x="10" y="18" width="44" height="30" rx="3" fill={hue} /><path d="M10 26 h44" stroke="#fff" strokeWidth="2" opacity=".6" /></>}
        <text x="32" y="60" textAnchor="middle" fontSize="9" fontWeight="700" fill={hue} fontFamily="Anek Tamil, sans-serif">{initials}</text>
      </svg>
    </div>
  );
}
