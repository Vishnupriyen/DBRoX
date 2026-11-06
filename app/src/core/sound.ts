// TESRAX sounds: tiny synthesized tones, no audio files. Notes are pentatonic so any tapping sounds musical.
// Kept quiet on purpose (shop floor, phone speaker). The owner can switch them off; remembered per phone.

let ac: AudioContext | null = null;
let on = (() => { try { return localStorage.getItem('hanubix.sound') !== 'off'; } catch { return true; } })();

function ctx(): AudioContext | null {
  if (!on || typeof window === 'undefined') return null;
  const A = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!A) return null;
  if (!ac) ac = new A();
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

function tone(freq: number, at = 0, len = 0.14, type: OscillatorType = 'sine', gain = 0.06) {
  const c = ctx(); if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + len + 0.05);
}

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];

export const sound = {
  isOn: () => on,
  set(v: boolean) { on = v; try { localStorage.setItem('hanubix.sound', v ? 'on' : 'off'); } catch { /* private mode */ } if (v) this.wake(); },
  /** the core was touched: x is 0..1 across the core */
  note(x: number) { const f = PENTA[Math.min(PENTA.length - 1, Math.max(0, Math.floor(x * PENTA.length)))]; tone(f, 0, 0.32, 'sine', 0.06); tone(f * 2, 0, 0.16, 'triangle', 0.015); },
  /** engine opened */
  wake() { tone(523.25, 0, 0.12, 'sine', 0.045); tone(783.99, 0.08, 0.16, 'sine', 0.045); },
  /** a soft tick while thinking */
  tick() { tone(1200 + Math.random() * 400, 0, 0.05, 'triangle', 0.012); },
  /** answer ready */
  done() { tone(659.25, 0, 0.26, 'sine', 0.06); tone(987.77, 0.12, 0.36, 'sine', 0.055); },
  /** something needs attention */
  warn() { tone(440, 0, 0.18, 'triangle', 0.05); tone(392, 0.12, 0.22, 'triangle', 0.05); },
  /** a key press while typing to the engine */
  key() { tone(PENTA[Math.floor(Math.random() * PENTA.length)] * 2, 0, 0.04, 'sine', 0.008); },
};
