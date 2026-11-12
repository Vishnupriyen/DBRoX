import { TesraxCore } from './TesraxCore';

// The HANUBIX logo (locked 12 Nov 2026): wide thin geometric letters, A without a crossbar, a complete B, even spacing,
// RETAIL INTELLIGENCE underneath at exactly the logo's width. Drawn as lines, so it is sharp at any size and takes the
// colour of the text around it (jade-black on white, white on the dark opening screen).
export function Logo({ width = 190, stroke = 2.8, tagline = true, title = 'HANUBIX — RETAIL INTELLIGENCE' }: { width?: number; stroke?: number; tagline?: boolean; title?: string }) {
  return (
    <svg className="hx-logo" viewBox={`-4 0 388 ${tagline ? 66 : 52}`} width={width} height={width * (tagline ? 66 : 52) / 388} fill="none" stroke="currentColor" strokeWidth={stroke} strokeMiterlimit={2.5} role="img" aria-label={title}>
      <path d="M0 10V46M46 10V46M0 28H46" />
      <path d="M64 46L89 10L114 46" />
      <path d="M132 46V10L176 46V10" />
      <path d="M194 10V28A22 18 0 0 0 238 28V10" />
      <path d="M256 10V46M256 10H286A8.5 8.5 0 0 1 286 27H256M256 27H289A9.5 9.5 0 0 1 289 46H256" />
      <path d="M316 10V46" />
      <path d="M334 10L380 46M380 10L334 46" />
      {tagline && <text x="190" y="62.5" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="Montserrat, Arial, sans-serif" fontWeight={600} fontSize={10.4} textLength={380} lengthAdjust="spacing">RETAIL INTELLIGENCE</text>}
    </svg>
  );
}

/** "Powered by TESRAX" — shown once, on the opening screen (locked 12 Nov 2026) */
export function PoweredBy({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-powered${compact ? ' compact' : ''}`}><span>Powered by</span><TesraxCore size={30} n={260} interactive={false} /><span className="brand-tesrax">TESRAX</span></span>;
}

export function Brand({ width = 170, tagline = true }: { width?: number; tagline?: boolean } = {}) {
  return <span className="brand-lockup"><Logo width={width} stroke={tagline ? 3.4 : 4} tagline={tagline} /></span>;
}
