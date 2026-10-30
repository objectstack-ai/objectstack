const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const dir = path.join(__dirname, 'boards');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.dc.html'));
  const browser = await chromium.launch();
  const out = {};
  for (const f of files) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(dir, f));
    await page.waitForTimeout(800);
    const info = await page.evaluate(() => {
      const r = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      const asides = [...document.querySelectorAll('aside')].map(a => ({ box: r(a), style: a.getAttribute('style'), text: a.innerText.slice(0, 200).replace(/\n+/g, ' | ') }));
      return { title: document.title, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, asides };
    });
    out[f] = info;
    const name = 'board-' + f.replace('.dc.html', '') + '.png';
    await page.screenshot({ path: path.join(__dirname, 'shots', name), fullPage: true });
    await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname, 'boards-readings.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
