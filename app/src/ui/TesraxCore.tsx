// Locked signature: airy round jade–gold particles, touch deflection, drag, double-tap activation.
import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import { sound } from '../core/sound';

export type CoreState = 'idle' | 'listening' | 'thinking' | 'ready';
export function TesraxCore({ state = 'idle', size = 160, n, pulse = 0, interactive = true, label = 'TESRAX', onActivate, onDark = false, gather = false }: {
  state?: CoreState; size?: number; n?: number; pulse?: number; interactive?: boolean; label?: string; onActivate?: () => void;
  /** on a dark jade background: bright mint → gold particles that glow where they overlap */ onDark?: boolean;
  /** the opening screen: scattered particles gather into the sphere */ gather?: boolean;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef({ state, energy: 0, down: false, x: .5, y: .5, angle: 0, tilt: .12, spin: 0, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false, lastTap: -1000, tapX: 0, tapY: 0, lastNote: -1000 });
  useEffect(() => { live.current.state = state; }, [state]);
  useEffect(() => { if (pulse) live.current.energy = .55; }, [pulse]);
  useEffect(() => {
    const c = cv.current, g = c?.getContext('2d'); if (!c || !g) return;
    const N = Math.max(2, n ?? (size >= 120 ? 2200 : 260));
    const pts = Array.from({ length: N }, (_, i) => { const y = 1 - 2 * (i + .5) / N, r = Math.sqrt(1 - y * y), a = i * 2.3999632297; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const d = Math.min(window.devicePixelRatio || 1, 2); c.width = size * d; c.height = size * d; g.setTransform(d, 0, 0, d, 0, 0);
    let raf = 0, previous = 0, deflect = 0; const born = performance.now();
    const scatter = pts.map(() => [(Math.random() - .5) * 3.2, (Math.random() - .5) * 3.2]);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame); const dt = Math.min((now - previous) / 1000 || .016, .05); previous = now;
      if (document.hidden) return;
      const L = live.current;
      if (!reduced) { L.angle += dt * (.10 + (L.down ? 5.5 : L.spin) + (L.state === 'thinking' ? 1.1 : 0)); if (!L.down) L.spin *= Math.pow(.972, dt * 60); }
      L.energy *= Math.pow(.965, dt * 60); deflect += ((L.down ? 1 : 0) - deflect) * Math.min(1, dt * 12);
      g.clearRect(0, 0, size, size);
      const r = size * .345, mid = size / 2, co = Math.cos(L.angle), si = Math.sin(L.angle), ct = Math.cos(L.tilt), st = Math.sin(L.tilt);
      const points = pts.map((p, idx) => { const x = p[0] * co + p[2] * si; let z = -p[0] * si + p[2] * co; const y = p[1] * ct - z * st; z = p[1] * st + z * ct; const wave = reduced ? 0 : Math.sin(p[1] * 15 + now * .0022) * .008 + L.energy * Math.sin(p[1] * 17 - now * .007) * .025, k = (1 + wave) * 3.7 / (3.7 - z * .35); return { x: mid + x * r * k, y: mid + y * r * k, z, t: (x + 1) / 2, idx }; }).sort((a, b) => a.z - b.z);
      const k = gather && !reduced ? Math.min(1, Math.max(0, (now - born - 100) / 1300)) : 1, e = 1 - Math.pow(1 - k, 3);
      g.globalCompositeOperation = onDark ? 'lighter' : 'source-over';
      for (const p of points) {
        if (e < 1) { p.x = mid + (p.x - mid) * e + scatter[p.idx][0] * r * (1 - e); p.y = mid + (p.y - mid) * e + scatter[p.idx][1] * r * (1 - e); }
        const dx = p.x - L.x * size, dy = p.y - L.y * size, dist = Math.hypot(dx, dy), reach = size * .21;
        if (deflect > .001 && dist < reach) { const force = Math.pow(1 - dist / reach, 2) * size * .095 * deflect, a = Math.atan2(dy, dx); p.x += Math.cos(a) * force - Math.sin(a) * force * .3; p.y += Math.sin(a) * force + Math.cos(a) * force * .3; }
        g.fillStyle = onDark
          ? `rgba(${Math.round(127 + 105 * p.t)},${Math.round(224 - 32 * p.t)},${Math.round(173 - 69 * p.t)},${.34 + (p.z + 1) * .33})`
          : `rgba(${Math.round(9 + 183 * p.t)},${Math.round(134 + 17 * p.t)},${Math.round(95 - 34 * p.t)},${.18 + (p.z + 1) * .36})`;
        g.beginPath(); g.arc(p.x, p.y, Math.max(.5, (1.35 + (p.z + 1) * .75) * size / 430), 0, Math.PI * 2); g.fill();
      }
    };
    raf = requestAnimationFrame(frame); return () => cancelAnimationFrame(raf);
  }, [size, n, onDark, gather]);
  const activate = () => { live.current.energy = 1; live.current.spin = 5; sound.cinematic(); onActivate?.(); };
  const locate = (e: PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); live.current.x = (e.clientX - r.left) / r.width; live.current.y = (e.clientY - r.top) / r.height; };
  const down = (e: PointerEvent<HTMLButtonElement>) => { const L = live.current; e.currentTarget.setPointerCapture(e.pointerId); locate(e); L.down = true; L.moved = false; L.startX = L.lastX = e.clientX; L.startY = L.lastY = e.clientY; L.energy = 1; L.spin = 5.5; sound.note(1 - L.y); };
  const move = (e: PointerEvent<HTMLButtonElement>) => { const L = live.current; if (!L.down) return; locate(e); L.angle += (e.clientX - L.lastX) * .009; L.tilt = Math.max(-.8, Math.min(.8, L.tilt + (e.clientY - L.lastY) * .005)); L.moved ||= Math.hypot(e.clientX - L.startX, e.clientY - L.startY) > 7; L.lastX = e.clientX; L.lastY = e.clientY; const now = performance.now(); if (now - L.lastNote > 125) { L.lastNote = now; sound.note(1 - L.y); } };
  const up = (e: PointerEvent<HTMLButtonElement>) => { const L = live.current; L.down = false; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); if (L.moved) return; const now = performance.now(); if (now - L.lastTap < 380 && Math.hypot(e.clientX - L.tapX, e.clientY - L.tapY) < 40) { L.lastTap = -1000; activate(); } else { L.lastTap = now; L.tapX = e.clientX; L.tapY = e.clientY; } };
  const canvas = <canvas ref={cv} aria-hidden="true" style={{ width: '100%', height: '100%' }} />;
  return interactive ? <button type="button" className={`tx-core ${state}`} style={{ width: size, height: size, maxWidth: '100%', aspectRatio: '1' }} aria-label={`${label}. Hold to ripple, drag to spin, double tap to activate.`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { live.current.down = false; live.current.lastTap = -1000; }} onClick={e => { if (e.detail === 0) activate(); }}>{canvas}</button> : <span className={`tx-core ${state}`} style={{ width: size, height: size }} role="img" aria-label={label}>{canvas}</span>;
}
