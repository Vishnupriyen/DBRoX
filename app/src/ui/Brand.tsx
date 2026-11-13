import { TesraxCore } from './TesraxCore';

// The HANUBIX logo (locked 12 Nov 2026): wide thin geometric letters, A without a crossbar, a complete B, even spacing,
// RETAIL INTELLIGENCE underneath at exactly the logo's width. Drawn as lines, so it is sharp at any size and takes the
// colour of the text around it (jade-black on white, white on the dark opening screen).
export function Logo({ width = 190, stroke = 2.8, tagline = true, tagSize = 10.4, gap = 0, title = 'HANUBIX — RETAIL INTELLIGENCE' }: { width?: number; stroke?: number; tagline?: boolean; tagSize?: number; gap?: number; title?: string }) {
  // tagSize: RETAIL INTELLIGENCE grows when the logo is drawn small (the header), so it stays readable at the logo's width
  const h = tagline ? 52 + gap + Math.round(tagSize * 1.35) : 52;
  // the tagline runs edge to edge with the drawn letters: their outer edge is half a stroke past 0 and 380, and the
  // first and last capitals have a small built-in side margin (about 7% of the size), so the text is widened by both
  const b = tagSize * 0.07, x0 = -stroke / 2 - b, len = 380 + stroke + b - tagSize * 0.05; // the E ends almost on its edge
  return (
    <svg className="hx-logo" viewBox={`-4 0 388 ${h}`} width={width} height={width * h / 388} fill="none" stroke="currentColor" strokeWidth={stroke} strokeMiterlimit={2.5} role="img" aria-label={title}>
      <path d="M0 10V46M46 10V46M0 28H46" />
      <path d="M64 46L89 10L114 46" />
      <path d="M132 46V10L176 46V10" />
      <path d="M194 10V28A22 18 0 0 0 238 28V10" />
      <path d="M256 10V46M256 10H286A8.5 8.5 0 0 1 286 27H256M256 27H289A9.5 9.5 0 0 1 289 46H256" />
      <path d="M316 10V46" />
      <path d="M334 10L380 46M380 10L334 46" />
      {tagline && <text x={x0} y={52 + gap + tagSize * 1.01} textAnchor="start" fill="currentColor" stroke="none" fontFamily="Montserrat, Arial, sans-serif" fontWeight={600} fontSize={tagSize} textLength={len} lengthAdjust="spacing">RETAIL INTELLIGENCE</text>}
    </svg>
  );
}

/** "Powered by TESRAX" — shown once, on the opening screen (locked 12 Nov 2026) */
export function PoweredBy({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-powered${compact ? ' compact' : ''}`}><span>Powered by</span><TesraxCore size={30} n={260} interactive={false} /><span className="brand-tesrax">TESRAX</span></span>;
}

export function Brand({ width = 170, tagline = true, tagSize, stroke, gap }: { width?: number; tagline?: boolean; tagSize?: number; stroke?: number; gap?: number } = {}) {
  return <span className="brand-lockup"><Logo width={width} stroke={stroke ?? (tagline ? 3.4 : 4)} tagline={tagline} tagSize={tagSize} gap={gap} /></span>;
}
