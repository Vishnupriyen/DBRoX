import { useEffect, useRef } from 'react';

// The app's one back (header arrow and the phone's back button, both send "hanubix:back"): a screen with its own
// levels goes up one level instead of jumping home. The screen opened last answers first; a handler returns true
// when it went back itself. (Before, only More listened: back from a half-typed order went home and lost it.)
type H = { fn: () => boolean };
const stack: H[] = [];
let wired = false;
function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('hanubix:back', e => {
    if (e.defaultPrevented) return;
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].fn()) { e.preventDefault(); return; }
  });
}
export function useBack(fn: () => boolean) {
  const h = useRef<H>({ fn });
  h.current.fn = fn;
  useEffect(() => {
    wire();
    const entry = h.current;
    stack.push(entry);
    return () => { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); };
  }, []);
}
