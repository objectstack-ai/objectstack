// 390x844 evidence for the phone record page (Chromium mobile emulation).
const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-claude-objectstack/adf7b63e-e3ad-58a4-8413-b5780a2a8775/scratchpad/issue-27058';
const OUT = SP + '/evidence';
const BASE = 'http://localhost:37159';
const APP = '/apps/com.example.crm';

function patchLead(node) {
  if (Array.isArray(node)) { node.forEach(patchLead); return; }
  if (node && typeof node === 'object') {
    if (node.name === 'crm_lead' && node.fields && typeof node.fields === 'object') {
      node.highlightFields = ['company', 'title', 'email', 'phone', 'source', 'lead_score'];
    }
    Object.values(node).forEach(patchLead);
  }
}

async function newPage(browser, { patch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN', storageState: SP + '/state.json' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  if (patch) {
    await page.route('**/api/**', async (route) => {
      if (route.request().url().includes('events')) return route.continue();
      const response = await route.fetch();
      const type = response.headers()['content-type'] || '';
      if (!type.includes('json')) return route.fulfill({ response });
      const text = await response.text();
      if (!text.includes('crm_lead')) return route.fulfill({ response, body: text });
      try {
        const json = JSON.parse(text);
        patchLead(json);
        return route.fulfill({ response, body: JSON.stringify(json) });
      } catch {
        return route.fulfill({ response, body: text });
      }
    });
  }
  return page;
}

const scroller = (page) => page.locator('[data-record-page-root] .overflow-auto').first();
async function barBox(page) {
  const bar = page.locator('[data-record-action-bar]');
  if ((await bar.count()) === 0) return 'no bar';
  const box = await bar.first().boundingBox();
  return box ? `bar y=${Math.round(box.y)} h=${Math.round(box.height)} bottom=${Math.round(box.y + box.height)}` : 'no bar';
}
async function shot(page, name, { park = true } = {}) {
  // Park the pointer on an empty spot of the top bar, so a hover card the tap
  // left under it does not cover the shot.
  if (park) {
    await page.mouse.move(200, 67);
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const back = page.locator('[data-record-crumb-back]');
  const backText = (await back.count()) > 0 ? `back=「‹ ${(await back.first().textContent())?.trim()}」` : 'no back';
  console.log('shot', name, page.url().replace(BASE, ''), await barBox(page), backText);
}

(async () => {
  const browser = await chromium.launch();
  const page = await newPage(browser);
  await page.goto(BASE + APP + '/crm_lead', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(2500);
  await shot(page, '01-lead-list');

  await page.getByText('Marie Curie').first().click();
  await page.waitForTimeout(4500);
  await shot(page, '02-lead-record');

  const sc = scroller(page);
  const dims = await sc.evaluate((el) => ({ h: el.scrollHeight, c: el.clientHeight }));
  console.log('lead scroller', JSON.stringify(dims));
  await sc.evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); });
  await page.waitForTimeout(1500);
  console.log('mid scrollTop', await sc.evaluate((el) => el.scrollTop));
  await shot(page, '03-lead-record-mid-scroll');
  await sc.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(1500);
  await sc.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(1000);
  await shot(page, '04-lead-record-end');

  // The account lookup on the lead → the account pushed as a page.
  const lookup = page.locator('[data-record-page-root] a[href*="/crm_account/record/"]').first();
  console.log('lookup links', await page.locator('[data-record-page-root] a[href*="/crm_account/record/"]').count());
  await lookup.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const leadScrollBefore = await sc.evaluate((el) => el.scrollTop);
  await lookup.click();
  await page.waitForTimeout(4500);
  await shot(page, '05-lead-to-account-pushed');

  // A related opportunity row on the account → pushed one more level.
  const asc = scroller(page);
  await asc.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(2000);
  await asc.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(1500);
  const accountScrollBefore = await asc.evaluate((el) => el.scrollTop);
  await shot(page, '06-account-related-panels');
  const row = page.getByText('Acme — Add-on Module').first();
  console.log('opp rows', await page.getByText('Acme — Add-on Module').count());
  await row.click();
  await page.waitForTimeout(4500);
  await shot(page, '07-account-to-opportunity-pushed');

  await page.locator('[data-record-crumb-back]').first().click();
  await page.waitForTimeout(4000);
  console.log('account scrollTop before/after back', accountScrollBefore, await scroller(page).evaluate((el) => el.scrollTop));
  await shot(page, '08-back-to-account');

  await page.locator('[data-record-crumb-back]').first().click();
  await page.waitForTimeout(4000);
  console.log('lead scrollTop before/after back', leadScrollBefore, await scroller(page).evaluate((el) => el.scrollTop));
  await shot(page, '09-back-to-lead');

  // The account's related tab active (enlarged).
  await page.goto(BASE + APP + '/crm_account', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.getByText('Acme Corp').first().click();
  await page.waitForTimeout(4500);
  const tabs = page.locator('[data-record-tab-row] [role="tab"]');
  const tabTexts = await tabs.allTextContents();
  console.log('tabs', JSON.stringify(tabTexts));
  await shot(page, '10-account-record');
  const oppTab = page.locator('[data-record-tab-row] [role="tab"][data-record-tab*="crm_opportunity"]').first();
  if (await oppTab.count()) await oppTab.click();
  else await tabs.nth(2).click();
  await page.waitForTimeout(3500);
  await shot(page, '11-account-related-tab-active');

  // The bar's ⋯ on the lead.
  await page.goto(BASE + APP + '/crm_lead', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.getByText('Marie Curie').first().click();
  await page.waitForTimeout(4500);
  await page.locator('[data-record-action-bar] button[aria-label]').last().click();
  await page.waitForTimeout(1200);
  await shot(page, '12-lead-bar-more', { park: false });
  await page.context().close();

  // Rig-only: the lead's highlightFields declared in the served metadata (a
  // browser-side response patch; not in the diff), to show the subtitle.
  const patched = await newPage(browser, { patch: true });
  await patched.goto(BASE + APP + '/crm_lead', { waitUntil: 'networkidle', timeout: 120000 });
  await patched.waitForTimeout(2000);
  await patched.getByText('Marie Curie').first().click();
  await patched.waitForTimeout(4500);
  console.log('subtitle', await patched.locator('[data-page-header-subtitle="host"]').allTextContents());
  await shot(patched, '13-lead-header-declared-highlights');
  await patched.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
