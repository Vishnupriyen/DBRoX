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
  p.on('close', () => console.log('PAGE CLOSED at', new Date().toISOString()));
  const errs = []; const report = []; const notChecked = []; let screens = 0;
  const focusNow = async () => (await device.shell('dumpsys window | grep mCurrentFocus')).toString();
  const appOnTop = async () => {
    for (let t = 0; t < 3; t++) {
      if (/com\.hanubix\.app/.test(await focusNow())) return true;
      await device.shell('am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS').catch(() => {});
      if (/Not Responding/.test(await focusNow())) await device.shell('input keyevent KEYCODE_ENTER').catch(() => {}); // "Wait" / "Close app"
      await device.shell('monkey -p com.hanubix.app -c android.intent.category.LAUNCHER 1'); await p.waitForTimeout(2000);
    }
    return /com\.hanubix\.app/.test(await focusNow());
  };
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (/\[back\]/.test(m.text())) console.log('PAGE', m.text()); if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 160)); });
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
    // switching side reloads the page; on a slow emulator a tap can land before the button is live — tap again until the names show
    for (let t = 0; ; t++) {
      await p.click(`text=${side}`, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(1000);
      if (await p.waitForSelector(`text=${who}`, { timeout: 30000 }).then(() => true, () => false)) break;
      if (t === 3) throw new Error(`login list for ${who} never showed after 4 taps on "${side}"`);
    }
    await p.waitForTimeout(500);
    await p.click(`text=${who}`); await p.waitForTimeout(1500);
    const gate = await p.$('.gate .big-btn');
    if (gate) { await gate.click(); await p.waitForTimeout(1000); if (await p.$('.gate')) report.push({ who: who.split(' ')[0], page: 'check-in', issues: ['CHECK-IN still waiting after 1 s'] }); await p.waitForTimeout(500); }
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
    await p.click('nav >> text=Menu'); await check('Menu');
    await p.dblclick('.fab .tx-core'); await check('Engine fresh');
    await p.fill('.engine textarea', 'help'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500); await check('Engine help');
    // the phone's back button closes the engine instead of leaving the app
    await p.evaluate(() => (document.activeElement)?.blur?.()); // keyboard away, as a person would see it
    // the first BACK while the keyboard is still closing only closes the keyboard (normal Android): wait until it is gone
    for (let k = 0; k < 10 && /mInputShown=true/.test((await device.shell('dumpsys input_method')).toString()); k++) await p.waitForTimeout(300);
    // another app's "not responding" box on the emulator takes the key press (seen 12 Nov 2026, Android 14: the launcher) —
    // that is the emulator, not Hanubix: close it and bring the app back; if it can't be, this check is reported as not run
    if (!(await appOnTop())) { notChecked.push(`${tag}: another app's window was on top (${(await focusNow()).trim()})`); continue; }
    await device.shell('input keyevent KEYCODE_BACK'); await p.waitForTimeout(1000);
    const st = await p.evaluate(() => ({ engine: !!document.querySelector('.engine'), vis: document.visibilityState })).catch(e => ({ err: e.message }));
    const focus = (await device.shell('dumpsys window | grep mCurrentFocus')).toString().trim();
    if (st.engine || st.err) report.push({ who: tag, page: 'back button', issues: [`BACK did not close the engine ${JSON.stringify(st)} ${focus}`] });
    // and from a screen: back goes home, never out of the app
    if (!st.err) {
      await p.click('nav >> text=Menu').catch(() => {}); await p.waitForTimeout(500);
      await device.shell('input keyevent KEYCODE_BACK'); await p.waitForTimeout(1000);
      const home = await p.$('.home').catch(() => null);
      const f2 = (await device.shell('dumpsys window | grep mCurrentFocus')).toString();
      if (!home || !/hanubix/.test(f2)) report.push({ who: tag, page: 'back button', issues: [`BACK from Menu did not go home (${f2.trim()})`] });
      if (!/hanubix/.test(f2)) { await device.shell('monkey -p com.hanubix.app -c android.intent.category.LAUNCHER 1'); await p.waitForTimeout(2000); }
    }
  }
  const n = report.reduce((a, r) => a + r.issues.length, 0);
  console.log(`ANDROID SWEEP (${LABEL}): ${screens} screens checked, ${n} issue(s)`);
  for (const r of report) for (const i of r.issues) console.log(`  ISSUE ${r.who} / ${r.page}: ${i}`);
  for (const x of notChecked) console.log(`  NOT CHECKED (emulator) back button — ${x}`);
  await device.close();
  process.exit(n ? 1 : 0); // an issue fails the phone check (it used to end green whatever it found)
})().catch(async e => {
  console.error('SCRIPT', e.message.split('\n').slice(0, 3).join(' | '));
  // why the app's page went away: the device's own log of the last moments (crash, kill, reload)
  const { execSync } = require('child_process');
  try { console.log(execSync("adb logcat -d -t 1500 | grep -iE 'hanubix|ActivityManager|ActivityTaskManager|lowmemory|lmkd|crash|died|fatal|renderer|SIGSEGV|Capacitor/' | grep -v 'Line 349' | tail -120").toString()); } catch { /* no device */ }
  process.exit(1);
});
