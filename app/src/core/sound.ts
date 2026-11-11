// TESRAX sounds: tiny synthesized tones, no audio files. Notes are pentatonic so any tapping sounds musical.
// Touch notes and original cinematic activation, with compression and a remembered per-phone mute.

let ac: AudioContext | null = null;
let master: DynamicsCompressorNode | null = null;
let on = (() => { try { return localStorage.getItem('hanubix.sound') !== 'off'; } catch { return true; } })();

function ctx(): AudioContext | null {
  if (!on || typeof window === 'undefined') return null;
  const A = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!A) return null;
  try { if (!ac) { ac = new A(); master = ac.createDynamicsCompressor(); master.threshold.value = -18; master.ratio.value = 6; master.connect(ac.destination); } } catch { return null; }
  if (ac.state === 'suspended') void ac.resume().catch(() => {});
  return ac;
}

function tone(freq: number, at = 0, len = 0.14, type: OscillatorType = 'sine', gain = 0.06) {
  const c = ctx(); if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(master ?? c.destination); o.start(t); o.stop(t + len + 0.05);
}

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];

export const sound = {
  isOn: () => on,
  set(v: boolean) { on = v; try { localStorage.setItem('hanubix.sound', v ? 'on' : 'off'); } catch { /* private mode */ } if (v) this.wake(); },
  /** the core was touched: x is 0..1 across the core */
  note(x: number) { const f = PENTA[Math.min(PENTA.length - 1, Math.max(0, Math.floor(x * PENTA.length)))]; tone(f, 0, 0.65, 'sine', 0.19); tone(f * 2, 0, 0.4, 'sine', 0.03); },
  /** Original cinematic bass and filtered-noise whoosh; no movie recordings. */
  cinematic() {
    const c = ctx(); if (!c) return;
    tone(65.41, 0, 1.4, 'sine', .30);
    [261.63, 329.63, 392, 523.25].forEach((f, i) => tone(f, i * .07, 1.2, 'sine', .13));
    const t = c.currentTime, b = c.createBuffer(1, Math.ceil(c.sampleRate * .55), c.sampleRate), samples = b.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain(); noise.buffer = b; filter.type = 'bandpass'; filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(400, t); filter.frequency.exponentialRampToValueAtTime(2400, t + .2); filter.frequency.exponentialRampToValueAtTime(350, t + .55);
    gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(.10, t + .15); gain.gain.exponentialRampToValueAtTime(.0001, t + .55);
    noise.connect(filter).connect(gain).connect(master ?? c.destination); noise.start(t); noise.stop(t + .6);
  },
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
