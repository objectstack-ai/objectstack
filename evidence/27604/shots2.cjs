const { chromium } = require('playwright');
const SP = process.env.SP;
const BASE = 'http://localhost:51604';
const APP = BASE + '/apps/com.example.showcase';
async function cardShown(page) {
  await page.waitForSelector('[data-record-hover-card]:not([aria-busy])', { timeout: 15000 });
  await page.waitForTimeout(600);
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, storageState: SP + '/state.json' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);

  // A compact related row in the record page's related column (Contoso → Contacts).
  await page.goto(APP + '/showcase_account/record/7-UwoU8wVoVXgOPb');
  await page.waitForSelector('[data-related-card-row] button');
  await page.waitForTimeout(2000);
  const row = page.locator('[data-related-card-row] button', { hasText: 'Carl Fox' }).first();
  await row.hover();
  await cardShown(page);
  await page.screenshot({ path: SP + '/shots/27604-compact-related-row.png' });
  console.log('card text (related row):', (await page.locator('[data-record-hover-card]').innerText()).replace(/\n/g, ' | '));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(800);
  // Keyboard on the same row: Space shows, Esc hides.
  await row.focus();
  await page.keyboard.press(' ');
  await cardShown(page);
  console.log('cards after Space:', await page.locator('[data-record-hover-card]').count(), 'url still', page.url().includes('7-UwoU8wVoVXgOPb'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log('cards after Esc:', await page.locator('[data-record-hover-card]').count());

  // A lookup chip in the details column (Field Zoo → Lookup → Account).
  await page.locator('a', { hasText: 'Field Zoo' }).first().click();
  await page.waitForTimeout(5000);
  const first = page.locator('a[href*="/record/"]').first();
  const href = await first.getAttribute('href');
  await page.goto(BASE + href);
  await page.waitForTimeout(7000);
  const chips = page.locator('a[href*="showcase_account/record"]');
  console.log('account chips on the field zoo record:', await chips.count(), 'url', page.url());
  const chip = chips.first();
  await chip.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await chip.hover();
  await cardShown(page);
  await page.screenshot({ path: SP + '/shots/27604-details-lookup-chip.png' });
  console.log('card text (details chip):', (await page.locator('[data-record-hover-card]').innerText()).replace(/\n/g, ' | '));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
