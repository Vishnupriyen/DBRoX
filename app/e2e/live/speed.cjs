const { chromium } = require('playwright');
(async () => {
  const out = {};
  for (const slow of [false, true]) {
    const ctx = await chromium.launchPersistentContext(process.argv[2], { viewport: { width: 360, height: 780 } });
    const p = ctx.pages()[0] || await ctx.newPage();
    if (slow) { const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    let t = Date.now(); await p.goto('http://localhost:4180'); await p.waitForSelector('.tile'); out[`${slow ? 'cheap' : 'normal'} · open app to home`] = (Date.now() - t) / 1000;
    const screens = [['Accountant', 'Outstanding', 'text=in the market'], ['Bill', 'Billed', '.item'], ['Bill', 'Orders received', '.sechead'], ['Accountant', 'Day close', 'text=Checklist'], ['Accountant', 'P&L', '.kpi'], ['Accountant', 'GST', '.main .card, .main .kpi'], ['Stock', 'Stock position', '.item'], ['Sales', 'Beats', '.chip']];
    for (const [m, sub, ready] of screens) {
      await p.click('nav >> text=Home'); await p.waitForTimeout(400);
      t = Date.now(); await p.click(`.tile:has-text("${m}")`);
      if (sub) { await p.waitForTimeout(300); await p.click(`.tile:has-text("${sub}")`); }
      try { await p.waitForSelector(ready, { timeout: 120000 }); await p.waitForFunction(() => ![...document.querySelectorAll('.card.muted')].some(e => /^Loading/.test(e.textContent || '')), null, { timeout: 120000 }); out[`${slow ? 'cheap' : 'normal'} · ${sub ?? m}`] = (Date.now() - t) / 1000; }
      catch { out[`${slow ? 'cheap' : 'normal'} · ${sub ?? m}`] = 'did not open in 120 s'; }
    }
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  require('fs').writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
})();
