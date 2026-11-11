import { TesraxCore } from './TesraxCore';

export function PoweredBy({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-powered${compact ? ' compact' : ''}`}><span>Powered by</span><TesraxCore size={30} n={260} interactive={false} /><span className="brand-tesrax">TESRAX</span></span>;
}

export function Brand({ powered = true }: { powered?: boolean }) {
  return <span className="brand-lockup"><img src={`${import.meta.env.BASE_URL}hanubix-wordmark.svg`} alt="HANUBIX — RETAIL INTELLIGENCE" width="230" height="35" />{powered && <PoweredBy />}</span>;
}
