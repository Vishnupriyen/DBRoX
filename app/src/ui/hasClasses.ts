// Older phones (12 Nov 2026): CSS ":has()" needs Android System WebView 105+, and many field phones run older ones — there the
// whole rule is ignored (the TESRAX button kept showing over an open bill, the page behind TESRAX never blurred). These classes
// do the same job everywhere: .app.has-sheet, .app.has-engine and .main.has-home, kept in step with what is on screen.
const RULES: [string, string, string][] = [['.app', 'has-sheet', '.sheet-wrap'], ['.app', 'has-engine', '.engine'], ['.main', 'has-home', '.home']];

export function syncHasClasses(doc: Document = document) {
  for (const [host, cls, inner] of RULES)
    doc.querySelectorAll(host).forEach(el => { const on = !!el.querySelector(inner); if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); });
}

export function startHasClasses() {
  let queued = false;
  const run = () => { queued = false; syncHasClasses(); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(document.body, { childList: true, subtree: true });
  run();
}
