// Release gate, part 2: opens EVERY screen for EVERY role at small-phone width (360 px) and the common Android width (412 px), and fails on:
// crashes, console errors, sideways scrolling, text cut off, elements off screen, unexpected dark backgrounds,
// and text too faint to read (contrast below 3:1).   node e2e/sweep.cjs [outDir]
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'sweep'), { recursive: true });
const BASE = process.env.E2E_URL || 'http://localhost:4173';
const ROLES = ['Vishnu (Owner)', 'Priya (Office)', 'Ravi (Salesman)', 'Mani (Godown)', 'Karthik (Delivery)',
  // company side (a brand's head office and team), opened with "Company demo" on the login screen
  'co:Lakshmi (Head office)', 'co:Senthil (ASM)', 'co:Divya (SO)', 'co:Arun (Rep)'];
const audit = () => {
  const out = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.push(`H-OVERFLOW page ${de.scrollWidth}>${de.clientWidth}`);
  const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); if (a < .5) return null; const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const bgOf = el => { while (el) { const cs = getComputedStyle(el); if (cs.backgroundImage.includes('gradient') && !/text/.test(cs.backgroundClip + ' ' + cs.webkitBackgroundClip)) { const stops = cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []; return stops.length ? Math.max(...stops.map(c => lum(c) ?? 0)) : 0; } const l = lum(cs.backgroundColor); if (l !== null) return l; el = el.parentElement; } return 0; };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.bill, .pack, svg, canvas, .no-audit')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const bl = lum(cs.backgroundColor);
    if ((el === document.body || el.classList.contains('app')) && bl !== null && bl < .6) out.push('DARK-SURFACE ' + el.tagName.toLowerCase());
    const direct = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (direct && cs.webkitTextFillColor !== 'rgba(0, 0, 0, 0)' && cs.color !== 'rgba(0, 0, 0, 0)') {
      const tl = lum(cs.color), bg = bgOf(el);
      if (tl !== null) { const c = (Math.max(tl, bg) + .05) / (Math.min(tl, bg) + .05); if (c < 3) { const k = `LOW-CONTRAST ${c.toFixed(1)} ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 30)}"`; if (!seen.has(k)) { seen.add(k); out.push(k); } } }
    }
    if (direct && (cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && !cs.webkitLineClamp) { const k = `CLIPPED ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 30)}"`; if (!seen.has(k)) { seen.add(k); out.push(k); } }
    if (r.right > de.clientWidth + 2 && !el.closest('.tablewrap, table, .chips, .cat, .segmented, [style*="overflow"]') && cs.position !== 'fixed') { const k = `OFFSCREEN ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent || '').trim().slice(0, 30)}" right=${Math.round(r.right)}`; if (!seen.has(k) && seen.size < 400) { seen.add(k); out.push(k); } }
  }
  // a word (or a bill number) is never broken across two lines in a list row
  for (const el of document.querySelectorAll('.item .s, .item .t, .billno')) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) for (const m of n.textContent.matchAll(/\S+/g)) {
      const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      const lines = new Set([...rg.getClientRects()].map(q => Math.round(q.top / 4))); if (lines.size > 1) { const k = `WORD-SPLIT "${m[0]}" in "${el.textContent.trim().slice(0, 30)}"`; if (!seen.has(k)) { seen.add(k); out.push(k); } }
    }
  }
  // text drawn over other text (a label running into its neighbour on a wider phone)
  const texts = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.bill, .pack, svg, canvas, .no-audit, .toast, .dialog-back, .engine')) continue;
    const t = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    if (!t.length) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    // what is actually visible: cut to any clipping box above it (ellipsis, scroll areas); fixed bars are their own layer
    let box = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }, layer = 'page';
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.position === 'fixed' || as.position === 'sticky') { layer = a; break; }
      if (as.overflowX !== 'visible' || as.overflowY !== 'visible') { const q = a.getBoundingClientRect(); box = { left: Math.max(box.left, q.left), top: Math.max(box.top, q.top), right: Math.min(box.right, q.right), bottom: Math.min(box.bottom, q.bottom) }; }
    }
    for (const n of t) { const rg = document.createRange(); rg.selectNodeContents(n); for (const q of rg.getClientRects()) {
      const r = { left: Math.max(q.left, box.left), top: Math.max(q.top, box.top), right: Math.min(q.right, box.right), bottom: Math.min(q.bottom, box.bottom) };
      if (r.right - r.left > 2 && r.bottom - r.top > 2) texts.push({ el, r, layer, s: n.textContent.trim().slice(0, 20) });
    } }
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j]; if (a.layer !== b.layer || a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 3 && h > 3) { const k = `OVERLAP "${a.s}" / "${b.s}"`; if (!seen.has(k)) { seen.add(k); out.push(k); } }
  }
  return out;
};
// scrolled to the end, no button or box on the page sits under the TESRAX core in the tab bar (UX round 4)
const ballCheck = async (p) => {
  await p.evaluate(() => { const m = document.querySelector('.main'); if (m) m.scrollTo(0, m.scrollHeight); }); await p.waitForTimeout(200);
  return p.evaluate(() => {
    const fab = document.querySelector('.fab'); if (!fab || getComputedStyle(fab).display === 'none') return [];
    const f = fab.getBoundingClientRect(); const out = [];
    for (const el of document.querySelectorAll('.main button, .main a.btn, .main input, .main select')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.right > f.left + 4 && r.left < f.right - 4 && r.bottom > f.top + 4 && r.top < f.bottom) out.push(`TESRAX core covers "${(el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30)}"`);
    }
    return out;
  });
};
module.exports = { audit, ROLES }; // the Android check (e2e/android-sweep.cjs) uses the same rules on the real phone app
if (require.main === module) (async () => {
  const b = await chromium.launch();
  const report = []; let screens = 0;
  const WIDTHS = (process.env.SWEEP_WIDTHS || '360,412').split(',').map(Number);
  for (const width of WIDTHS) for (let who of ROLES) {
    const ctx = await b.newContext({ viewport: { width, height: width === 360 ? 780 : 900 }, geolocation: { latitude: 11.4066, longitude: 79.2577 }, permissions: ['geolocation'] });
    // GPS as a real phone indoors: the first position takes 4 seconds
    await ctx.addInitScript(() => { const g = navigator.geolocation, orig = g.getCurrentPosition.bind(g); g.getCurrentPosition = (ok, bad, o) => setTimeout(() => orig(ok, bad, o), 4000); });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 160)); });
    await p.goto(BASE); await p.waitForSelector('text=Demo logins'); await p.waitForTimeout(800);
    const isCo = who.startsWith('co:'); if (isCo) who = who.slice(3);
    if (isCo) { await p.click('text=Company demo'); await p.waitForTimeout(800); await p.waitForSelector(`text=${who}`, { timeout: 60000 }); await p.waitForTimeout(800); }
    await p.click(`text=${who}`); await p.waitForTimeout(1200);
    const gate = await p.$('.gate .big-btn');
    // check-in must not wait for GPS (indoors a phone can take many seconds): the day opens at once
    if (gate) { await gate.click(); await p.waitForTimeout(1000); if (await p.$('.gate')) report.push({ who: who.split(' ')[0], page: 'check-in', issues: ['CHECK-IN still waiting after 1 s'] }); await p.waitForTimeout(3600);
      const toast = await p.$eval('.toast', el => el.textContent).catch(() => ''); if (/place/i.test(toast || '')) report.push({ who: who.split(' ')[0], page: 'check-in', issues: ['an Undo bubble for the GPS place covers the screen'] }); }
    const tag = who.split(' ')[0] + (width === 360 ? '' : `@${width}`);
    const check = async (name) => {
      await p.waitForTimeout(450);
      const a0 = await p.evaluate(audit);
      await p.screenshot({ path: `${OUT}/sweep/${tag}-${name.replace(/[^a-z0-9]+/gi, '_')}.png` });
      const a = [...a0, ...await ballCheck(p)];
      const e = errs.splice(0);
      if (a.length || e.length) report.push({ who: tag, page: name, issues: [...e, ...a] });
      screens++;
    };
    await check('home');
    const goHome = async () => { await p.click('nav >> text=Home').catch(() => {}); await p.waitForTimeout(300); };
    const top = await p.$$eval('.home > .tile', ts => ts.map(t => ({ label: t.querySelector('.tile-l')?.textContent, mod: t.classList.contains('module') })));
    for (const t of top) {
      await goHome();
      const el = p.locator('.home > .tile', { has: p.locator('.tile-l', { hasText: new RegExp(`^${t.label.replace(/[()+?]/g, '\\$&')}$`) }) }).first();
      await el.click(); await p.waitForTimeout(400);
      if (!t.mod) { await check(t.label); continue; }
      await check(t.label + ' (module)');
      const subs = await p.$$eval('.home > .tile .tile-l', ts => ts.map(x => x.textContent));
      for (const s of subs) {
        await goHome(); await el.click(); await p.waitForTimeout(300);
        await p.locator('.home > .tile', { has: p.locator('.tile-l', { hasText: new RegExp(`^${s.replace(/[()+?]/g, '\\$&')}$`) }) }).first().click();
        await check(`${t.label} › ${s}`);
      }
    }
    // More menu + engine
    await p.click('nav >> text=More'); await check('More');
    for (const item of ['Bills', 'Claims tracker', 'Staff & access', 'Company links', 'Settings', 'Plan & billing']) {
      if (await p.$(`.item:has-text("${item}")`)) { await p.click(`.item:has-text("${item}")`); await check('More › ' + item); await p.click('nav >> text=More'); await p.waitForTimeout(200); const back = await p.$('button:has-text("← More")'); if (back) await back.click(); }
    }
    await p.dblclick('.fab .tx-core'); await check('Engine fresh');
    await p.fill('.engine textarea', 'help'); await p.keyboard.press('Enter'); await p.waitForTimeout(1200); await check('Engine help');
    // a TESRAX table on a narrow phone: the money column is on screen, next to the product; "#" and "You said" are left out
    if (who.startsWith('Vishnu')) {
      await p.fill('.engine textarea', 'Murugan Stores 2 case Surf'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
      const t = await p.evaluate(() => { const ths = [...document.querySelectorAll('.engine .prop table.grid th')]; const a = ths.find(x => x.textContent.trim() === 'Amount'); return { heads: ths.map(x => x.textContent.trim()), right: a ? a.getBoundingClientRect().right : 1e9, vw: document.documentElement.clientWidth }; });
      const issues = [];
      if (t.right > t.vw) issues.push(`TESRAX order table: the Amount column is off screen (${Math.round(t.right)} > ${t.vw})`);
      if (width <= 430 && (t.heads.includes('#') || t.heads.includes('You said'))) issues.push(`TESRAX order table at ${width} px still shows # / You said: ${t.heads.join(', ')}`);
      if (t.heads.indexOf('Amount') !== t.heads.indexOf('Product') + 1) issues.push(`TESRAX order table: Amount should sit next to Product (${t.heads.join(', ')})`);
      if (issues.length) report.push({ who: tag, page: 'Engine order table', issues });
      await check('Engine order table');
    }
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/sweep/report.json`, JSON.stringify(report, null, 1));
  await b.close();
  const n = report.reduce((a, r) => a + r.issues.length, 0);
  console.log(`SWEEP: ${screens} screens checked, ${n} issue(s)`);
  for (const r of report) for (const i of r.issues) console.log(`  ${r.who} / ${r.page}: ${i}`);
  if (n) process.exit(1);
})().catch(e => { console.error('SCRIPT', e.message.split('\n')[0]); process.exit(1); });
