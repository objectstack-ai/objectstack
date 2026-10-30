const { chromium } = require('playwright');
const { BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p0 = await ctx.newPage();
  await p0.request.post(BASE + '/api/v1/auth/sign-in/email', { data: { email: 'admin@objectos.ai', password: 'admin123' } });
  await p0.goto(URL0, { waitUntil: 'networkidle' }); await p0.waitForTimeout(1200);
  await p0.keyboard.press('Control+b'); await p0.waitForTimeout(500); await p0.keyboard.press('Control+b'); await p0.waitForTimeout(800);
  const state = await ctx.storageState();
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: state, recordVideo: { dir: 'video2', size: { width: 1280, height: 900 } } });
  const page = await ctx2.newPage();
  await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await ctx2.close();
  await browser.close();
})();
