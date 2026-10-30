const { chromium } = require('playwright');
const B = '/tmp/claude-0/-home-claude-objectstack/7935dc52-4879-5e5d-a8db-0047aee0acbe/scratchpad/issue-27626/preview/review-inputs/boards/';
const SHOTS = '/tmp/claude-0/-home-claude-objectstack/7935dc52-4879-5e5d-a8db-0047aee0acbe/scratchpad/issue-27626/preview/shots/';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const ext = [];
  page.on('request', q => { if (!q.url().startsWith('file:')) ext.push(q.url()); });
  page.on('pageerror', e => console.log('pageerror', String(e).slice(0, 200)));
  for (const [f, out] of [['RecordDrawerV4Peek.dc.html', '23-board-drawer-v4-peek.png'], ['RecordDrawerV4Max.dc.html', '24-board-drawer-v4-max.png']]) {
    await page.goto('file://' + B + f, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const dims = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, title: document.title }));
    console.log(f, dims);
    await page.screenshot({ path: SHOTS + out, fullPage: true });
  }
  console.log('external requests', ext.length, ext.slice(0, 5));
  await browser.close();
})();
