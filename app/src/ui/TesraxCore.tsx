// TESRAX core: the Gostamo particle sphere — tiny dots on a Fibonacci sphere in the signature gradient.
// States: idle (slow turn) · listening (swells with each word) · thinking (fast spin + ticks) · ready (turns green).
// Touch it and it ripples and plays a note.
import { useEffect, useRef } from 'react';
import type React from 'react';
import { sound } from '../core/sound';

export type CoreState = 'idle' | 'listening' | 'thinking' | 'ready';

const SIG0 = [79, 227, 214], SIG1 = [230, 233, 244], SIG2 = [249, 181, 91], GRN = [79, 227, 160];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function sigAt(f: number, green: boolean): number[] {
  f = clamp(f, 0, 1);
  if (green) return [GRN[0], GRN[1] - (f * 30 | 0), GRN[2] + (f * 40 | 0)];
  const a = f < .5 ? SIG0 : SIG1, b = f < .5 ? SIG1 : SIG2, k = f < .5 ? f * 2 : (f - .5) * 2;
  return [a[0] + (b[0] - a[0]) * k | 0, a[1] + (b[1] - a[1]) * k | 0, a[2] + (b[2] - a[2]) * k | 0];
}

export function TesraxCore({ state = 'idle', size = 160, n, pulse = 0, interactive = true, label = 'TESRAX' }: {
  state?: CoreState; size?: number; n?: number; pulse?: number; interactive?: boolean; label?: string;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef({ state, pulse, touch: 0 });
  live.current.state = state;
  // each new pulse value (a keystroke, a word) kicks the sphere
  useEffect(() => { live.current.touch = Math.max(live.current.touch, .55); }, [pulse]);

  useEffect(() => {
    const c = cv.current; if (!c) return;
    const g = c.getContext('2d'); if (!g) return;
    const N = n ?? (size >= 120 ? 900 : 360);
    const pts: number[][] = []; const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i; pts.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, rot = 0, energy = 0, green = 0, lastTick = 0;
    const d = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * d; c.height = size * d;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const L = live.current; const st = L.state;
      const target = st === 'listening' ? .55 : st === 'thinking' ? .45 : 0;
      energy += (target - energy) * .08; L.touch *= .93;
      green += ((st === 'ready' ? 1 : 0) - green) * .12;
      const speed = st === 'thinking' ? 4.2 : 1;
      if (st === 'thinking' && t - lastTick > 240) { lastTick = t; sound.tick(); }
      rot += reduce ? 0 : (0.004 + energy * 0.02 + L.touch * 0.03) * speed;
      const W = c.width, H = c.height, R = Math.min(W, H) * .36;
      g.clearRect(0, 0, W, H);
      const cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(.35), stt = Math.sin(.35);
      g.globalCompositeOperation = 'lighter';
      const breathe = st === 'idle' ? Math.sin(t / 900) * .015 : 0;
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        const x = p[0] * cr - p[2] * sr; let z = p[0] * sr + p[2] * cr; const y = p[1] * ct - z * stt; z = p[1] * stt + z * ct;
        const wob = 1 + breathe + Math.sin(i * 1.7 + rot * 6) * (.02 + energy * .09) + L.touch * .12 * Math.sin(i + rot * 20);
        const sc = 1 / (1.9 - z * .6), px = W / 2 + x * R * wob * sc * 1.25, py = H / 2 + y * R * wob * sc * 1.25;
        const a = (.22 + (z + 1) * .36);
        const s = (1.05 + (z + 1) * 1.05) * d * (size < 100 ? .75 : .9);
        const f = (px / W - .5) * 1.9 + .5;
        const c1 = sigAt(f, false), c2 = sigAt(f, true);
        const col = [c1[0] + (c2[0] - c1[0]) * green | 0, c1[1] + (c2[1] - c1[1]) * green | 0, c1[2] + (c2[2] - c1[2]) * green | 0];
        g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`;
        g.fillRect(px - s / 2, py - s / 2, s, s);
      }
      g.globalCompositeOperation = 'source-over';
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, n]);

  const poke = (e: React.PointerEvent) => {
    if (!interactive) return;
    live.current.touch = 1;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    sound.note((e.clientX - r.left) / r.width);
  };
  return (
    <span className={`tx-core ${state}`} style={{ width: size, height: size }} onPointerDown={interactive ? poke : undefined} role={interactive ? 'img' : undefined} aria-label={label}>
      <canvas ref={cv} style={{ width: size, height: size }} />
      {state === 'ready' && <svg className="tx-tick" viewBox="0 0 24 24" style={{ width: size * .3, height: size * .3 }}><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#4FE3A0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </span>
  );
}
