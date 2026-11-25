// Mockup capture for objectstack#37197 (stage 1). Usage:
//   node shoot.cjs <appUrl> <apiUrl> <outDir> [only]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [APP, API, OUT, ONLY] = process.argv.slice(2);
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';

async function token() {
  const res = await fetch(`${API}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in ${res.status}: ${await res.text()}`);
  const t = res.headers.get('set-auth-token');
  if (!t) throw new Error('no set-auth-token');
  return t;
}

async function ctxFor(browser, tok, viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'zh-CN', ...extra });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('auth-session-token', t); } catch {}
  }, tok);
  return ctx;
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tok = await token();
  const browser = await chromium.launch();
  const shots = [];
  const want = (n) => !ONLY || ONLY.split(',').includes(n);

  const desk = { width: 1440, height: 900 };
  // (1) desktop landing
  if (want('1')) {
    const ctx = await ctxFor(browser, tok, desk);
    const page = await ctx.newPage();
    await page.goto(`${APP}/docs`);
    await page.getByTestId('docs-group').first().waitFor({ timeout: 60000 });
    await settle(page);
    await page.screenshot({ path: path.join(OUT, '1-desktop-docs-landing-1440.png') });
    shots.push('1');
    await ctx.close();
  }
  // (2) one doc open
  if (want('2')) {
    const ctx = await ctxFor(browser, tok, desk);
    const page = await ctx.newPage();
    await page.goto(`${APP}/docs`);
    await page.getByTestId('docs-group').first().waitFor({ timeout: 60000 });
    const href = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href^="/docs/"]')].map((x) => x.getAttribute('href'));
      return a;
    });
    fs.writeFileSync(path.join(OUT, 'links.json'), JSON.stringify(href, null, 2));
    const target = process.env.DOC_PATH || '/docs/showcase_manual/showcase_tour_data';
    await page.goto(`${APP}${target}`);
    await page.getByTestId('doc-breadcrumb').waitFor({ timeout: 60000 });
    await page.locator('article h1').first().waitFor({ timeout: 60000 });
    await settle(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, '2-desktop-doc-open-1440.png') });
    shots.push('2');
    // (3) head menu open, on the same page
    if (want('3')) {
      const before = page.url();
      await page.getByTestId('sidebar-docs-portal-menu-trigger').focus();
      await page.keyboard.press('Enter');
      await page.getByTestId('sidebar-docs-portal-menu').waitFor();
      await page.getByRole('menuitem').first().waitFor();
      await page.waitForTimeout(2500);
      console.log('url before/after menu', before, page.url());
      await page.screenshot({ path: path.join(OUT, '3-desktop-docs-head-app-switcher-open-1440.png') });
      shots.push('3');
      await page.keyboard.press('Escape');
    }
    // (4) collapsed
    if (want('4')) {
      await page.getByTestId('sidebar-collapse').click();
      await page.waitForTimeout(900);
      await page.mouse.move(900, 450);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, '4-desktop-sidebar-collapsed-1440.png') });
      shots.push('4');
      // (4b) the floated menu over the content (pointer on the left edge)
      await page.mouse.move(2, 450);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, '4b-desktop-sidebar-collapsed-floated-1440.png') });
      shots.push('4b');
    }
    await ctx.close();
  }
  // (5) phone control
  if (want('5')) {
    const ctx = await ctxFor(browser, tok, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const target = process.env.DOC_PATH || '/docs/showcase_manual/showcase_tour_data';
    await page.goto(`${APP}/docs`);
    await page.getByTestId('docs-group').first().waitFor({ timeout: 60000 });
    await settle(page);
    await page.screenshot({ path: path.join(OUT, '5-phone-docs-landing-390-unchanged.png') });
    await page.goto(`${APP}${target}`);
    await page.getByTestId('doc-breadcrumb').waitFor({ timeout: 60000 });
    await page.locator('article h1').first().waitFor({ timeout: 60000 });
    await settle(page);
    await page.screenshot({ path: path.join(OUT, '5b-phone-doc-open-390-unchanged.png') });
    shots.push('5');
    await ctx.close();
  }
  // (6) optional 768
  if (want('6')) {
    const ctx = await ctxFor(browser, tok, { width: 768, height: 1024 });
    const page = await ctx.newPage();
    await page.goto(`${APP}/docs`);
    await page.getByTestId('docs-group').first().waitFor({ timeout: 60000 });
    await settle(page);
    await page.screenshot({ path: path.join(OUT, '6-tablet-docs-landing-768.png') });
    await page.getByTestId('shell-sidebar-expand').first().click().catch(async () => { await page.keyboard.press('Control+b'); });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, '6b-tablet-docs-landing-768-sidebar-open.png') });
    shots.push('6');
    await ctx.close();
  }
  await browser.close();
  console.log('shots', shots.join(','));
})().catch((e) => { console.error(e); process.exit(1); });
