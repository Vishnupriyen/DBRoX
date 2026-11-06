// RoX presence: a Sunrise orb inside a kolam ring of dots. Four states —
// idle (breathes), listening (pulses), thinking (dots orbit), ready (turns jade, tick).
import { RoxMark } from './icons';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'ready';

export function RoxOrb({ state = 'idle', size = 56, mark = true }: { state?: OrbState; size?: number; mark?: boolean }) {
  const dots = 12;
  return (
    <span className={`orb ${state}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="orb-ring">
        {Array.from({ length: dots }, (_, i) => <i key={i} style={{ transform: `rotate(${i * 360 / dots}deg) translateY(${-size / 2 + 3}px)`, animationDelay: `${i * 90}ms` }} />)}
      </span>
      <span className="orb-core">
        {state === 'ready'
          ? <svg viewBox="0 0 24 24" width={size * .42} height={size * .42}><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          : mark ? <RoxMark size={size * .5} /> : null}
      </span>
    </span>
  );
}
