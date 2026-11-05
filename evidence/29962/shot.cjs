const { chromium } = require('playwright');
const [,, id, out] = process.argv;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, extraHTTPHeaders: { 'Accept-Language': 'en-US' } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5229/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await fetch('/api/v1/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@objectos.ai', password: 'Rig29962!pass' }), credentials: 'include' });
  });
  await page.goto(`http://localhost:5229/apps/com.example.showcase/showcase_project/record/${id}`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes('Atlas Rollout'), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const notNow = page.getByRole('button', { name: 'Not now' });
  if (await notNow.count()) { await notNow.first().click(); await page.waitForTimeout(800); }
  await page.getByText(/Project "/).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const text = await page.evaluate(() => document.body.innerText);
  const lines = text.split('\n').filter((l) => /Atlas Rollout/.test(l));
  console.log(JSON.stringify({ url: page.url(), lines }, null, 1));
  await page.screenshot({ path: out, fullPage: false });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
