import { useEffect, useState } from 'react';
import { TesraxCore } from './TesraxCore';
import { Logo } from './Brand';

// The opening screen (locked 12 Nov 2026): on the dark jade background, scattered jade and gold particles gather into the
// TESRAX sphere, then HANUBIX · RETAIL INTELLIGENCE and "Powered by TESRAX" fade in. Once per app start, about 2.5 s;
// a tap skips it. Not shown to the robot checks (they drive the app straight away) and kept short for reduced motion.
let shown = false;
export function Splash() {
  const robot = typeof navigator !== 'undefined' && (navigator as Navigator & { webdriver?: boolean }).webdriver;
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [phase, setPhase] = useState<'on' | 'out' | 'off'>(() => (shown || robot ? 'off' : 'on'));
  useEffect(() => {
    if (phase !== 'on') return;
    shown = true;
    const t1 = setTimeout(() => setPhase('out'), reduced ? 700 : 2500);
    return () => clearTimeout(t1);
  }, [phase, reduced]);
  useEffect(() => { if (phase === 'out') { const t = setTimeout(() => setPhase('off'), 450); return () => clearTimeout(t); } }, [phase]);
  if (phase === 'off') return null;
  return (
    <div className={`splash${phase === 'out' ? ' out' : ''}`} onClick={() => setPhase('out')} role="presentation">
      <div className="splash-halo" />
      <TesraxCore size={240} n={1250} interactive={false} onDark gather />
      <div className="splash-logo"><Logo width={260} stroke={2.6} /></div>
      <div className="splash-powered">POWERED BY <b>TESRAX</b></div>
      <div className="splash-bar"><i /></div>
    </div>
  );
}
