// Release gate, part 2: opens EVERY screen for EVERY role at small-phone width (360 px) and fails on:
// crashes, console errors, sideways scrolling, text cut off, elements off screen, leftover light backgrounds,
// and text too faint to read (contrast below 3:1).   node e2e/sweep.cjs [outDir]
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'sweep'), { recursive: true });
const BASE = process.env.E2E_URL || 'http://localhost:4173';
const ROLES = ['Vishnu (Owner)', 'Priya (Office)', 'Ravi (Salesman)', 'Mani (Godown)', 'Karthik (Delivery)'];
const audit = () => {
  const out = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.push(`H-OVERFLOW page ${de.scrollWidth}>${de.clientWidth}`);
  const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); if (a < .5) return null; const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const bgOf = el => { while (el) { const cs = getComputedStyle(el); if (cs.backgroundImage.includes('gradient') && !/text/.test(cs.backgroundClip + ' ' + cs.webkitBackgroundClip)) return .72; const l = lum(cs.backgroundColor); if (l !== null) return l; el = el.parentElement; } return 0; };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.bill, .pack, svg, canvas, .no-audit')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const bl = lum(cs.backgroundColor);
    if (bl !== null && bl > .6 && !el.closest('.btn.primary, .tile-n, .badge, .chip.on, .switch, .gate, .pins, .pad .go, .icon-btn.gold, .toast button, .morning .pill, .avatar, .msg.typing, .tx-core, input[type=checkbox]') && !cs.backgroundImage.includes('gradient')) { const k = 'LIGHT-BG ' + el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"'; if (!seen.has(k)) { seen.add(k); out.push(k); } }
    const direct = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (direct && cs.webkitTextFillColor !== 'rgba(0, 0, 0, 0)' && cs.color !== 'rgba(0, 0, 0, 0)') {
      const tl = lum(cs.color), bg = bgOf(el);
      if (tl !== null) { const c = (Math.max(tl, bg) + .05) / (Math.min(tl, bg) + .05); if (c < 3) { const k = `LOW-CONTRAST ${c.toFixed(1)} ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 30)}"`; if (!seen.has(k)) { seen.add(k); out.push(k); } } }
    }
    if (direct && (cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && !cs.webkitLineClamp) { const k = `CLIPPED ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 30)}"`; if (!seen.has(k)) { seen.add(k); out.push(k); } }
    if (r.right > de.clientWidth + 2 && !el.closest('.tablewrap, table, .chips, .cat, .segmented, [style*="overflow"]') && cs.position !== 'fixed') { const k = `OFFSCREEN ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent || '').trim().slice(0, 30)}" right=${Math.round(r.right)}`; if (!seen.has(k) && seen.size < 400) { seen.add(k); out.push(k); } }
  }
  return out;
};
(async () => {
  const b = await chromium.launch();
  const report = []; let screens = 0;
  for (const who of ROLES) {
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, geolocation: { latitude: 11.4066, longitude: 79.2577 }, permissions: ['geolocation'] });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 160)); });
    await p.goto(BASE); await p.waitForSelector('text=Demo logins'); await p.waitForTimeout(800);
    await p.click(`text=${who}`); await p.waitForTimeout(1200);
    const gate = await p.$('.gate .big-btn');
    if (gate) { await gate.click(); await p.waitForTimeout(1500); }
    const tag = who.split(' ')[0];
    const check = async (name) => {
      await p.waitForTimeout(450);
      const a = await p.evaluate(audit);
      const e = errs.splice(0);
      if (a.length || e.length) report.push({ who: tag, page: name, issues: [...e, ...a] });
      screens++;
      await p.screenshot({ path: `${OUT}/sweep/${tag}-${name.replace(/[^a-z0-9]+/gi, '_')}.png` });
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
    for (const item of ['Bills', 'Claims tracker', 'Staff & access', 'Settings']) {
      if (await p.$(`.item:has-text("${item}")`)) { await p.click(`.item:has-text("${item}")`); await check('More › ' + item); await p.click('nav >> text=More'); await p.waitForTimeout(200); const back = await p.$('button:has-text("← More")'); if (back) await back.click(); }
    }
    await p.click('.fab'); await check('Engine fresh');
    await p.fill('.engine textarea', 'help'); await p.keyboard.press('Enter'); await p.waitForTimeout(1200); await check('Engine help');
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/sweep/report.json`, JSON.stringify(report, null, 1));
  await b.close();
  const n = report.reduce((a, r) => a + r.issues.length, 0);
  console.log(`SWEEP: ${screens} screens checked, ${n} issue(s)`);
  for (const r of report) for (const i of r.issues) console.log(`  ${r.who} / ${r.page}: ${i}`);
  if (n) process.exit(1);
})().catch(e => { console.error('SCRIPT', e.message.split('\n')[0]); process.exit(1); });
