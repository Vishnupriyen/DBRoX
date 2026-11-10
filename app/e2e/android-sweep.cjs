// The same screen sweep, run inside the real Android app (APK) on an emulator: every screen for every role, with the
// same rules (crashes, console errors, sideways scrolling, cut-off text, off-screen elements, faint text), plus a check
// with the phone's text size set large (many owners use it). Screenshots go to the log as small JPEGs for review.
//   adb must see one device with com.hanubix.app (debug build) installed.   node e2e/android-sweep.cjs [label]
const { _android: android } = require('playwright');
const { audit, ROLES } = require('./sweep.cjs');
const LABEL = process.argv[2] || 'normal';
const SHOTS = process.env.SHOTS !== '0';
(async () => {
  const [device] = await android.devices();
  await device.shell('am force-stop com.hanubix.app');
  await device.shell('monkey -p com.hanubix.app -c android.intent.category.LAUNCHER 1');
  const webview = await device.webView({ pkg: 'com.hanubix.app' }, { timeout: 60000 });
  const p = await webview.page();
  const errs = []; const report = []; let screens = 0;
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 160)); });
  const shot = async (name) => {
    if (!SHOTS) return;
    const b = await p.screenshot({ type: 'jpeg', quality: 45, scale: 'css' }).catch(() => null);
    if (b) console.log(`@@SHOT ${LABEL}/${name} ${b.toString('base64')}`);
  };
  const vp = await p.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent, font: getComputedStyle(document.body).fontFamily }));
  console.log('VIEWPORT', JSON.stringify(vp));
  for (let who of ROLES) {
    await p.evaluate(() => localStorage.removeItem('dbrox.session')); await p.reload(); await p.waitForSelector('text=Demo logins', { timeout: 60000 }); await p.waitForTimeout(800);
    const isCo = who.startsWith('co:'); if (isCo) who = who.slice(3);
    const side = isCo ? 'Company demo' : 'Distributor demo';
    await p.click(`text=${side}`).catch(() => {}); await p.waitForTimeout(1000);
    await p.waitForSelector(`text=${who}`, { timeout: 60000 }); await p.waitForTimeout(500);
    await p.click(`text=${who}`); await p.waitForTimeout(1500);
    const gate = await p.$('.gate .big-btn'); if (gate) { await gate.click(); await p.waitForTimeout(1500); }
    const tag = who.split(' ')[0];
    const check = async (name) => {
      await p.waitForTimeout(450);
      const a = await p.evaluate(audit);
      const e = errs.splice(0);
      if (a.length || e.length) report.push({ who: tag, page: name, issues: [...e, ...a] });
      screens++; await shot(`${tag}-${name}`);
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
    await p.click('nav >> text=More'); await check('More');
    await p.click('.fab'); await check('Engine fresh');
    await p.fill('.engine textarea', 'help'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500); await check('Engine help');
    // the phone's back button closes the engine instead of leaving the app
    await device.shell('input keyevent KEYCODE_BACK'); await p.waitForTimeout(800);
    const stillOpen = await p.$('.engine'); if (stillOpen) report.push({ who: tag, page: 'back button', issues: ['BACK did not close the engine'] });
  }
  const n = report.reduce((a, r) => a + r.issues.length, 0);
  console.log(`ANDROID SWEEP (${LABEL}): ${screens} screens checked, ${n} issue(s)`);
  for (const r of report) for (const i of r.issues) console.log(`  ISSUE ${r.who} / ${r.page}: ${i}`);
  await device.close();
  process.exit(0);
})().catch(e => { console.error('SCRIPT', e.message.split('\n').slice(0, 3).join(' | ')); process.exit(1); });
