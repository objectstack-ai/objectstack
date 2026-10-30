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
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, storageState: SP + '/state.json' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const reads = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\/api\/v1\/data\/showcase_(account|task)\/[^/?]+/.test(u)) reads.push(u.replace(/^.*\/api\/v1/, ''));
  });

  // 1. A relation cell in a list: the Account column of Projects.
  await page.goto(APP + '/showcase_project');
  await page.waitForSelector('a[href*="showcase_account/record"]');
  await page.waitForTimeout(3000);
  console.log('account/task by-id reads after the list rendered:', reads.length);
  const cell = page.locator('a[href*="showcase_account/record"]').first();
  await cell.hover();
  await cardShown(page);
  console.log('by-id reads after one hover:', reads.length, reads.join(' '));
  await page.screenshot({ path: SP + '/shots/27604-list-relation-cell.png' });
  console.log('card text (list):', (await page.locator('[data-record-hover-card]').innerText()).replace(/\n/g, ' | '));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(800);

  // 2. A lookup chip in the details column, and 3. a compact related row, on a project record page.
  const href = await page.locator('a[href*="showcase_project/record"]').first().getAttribute('href');
  await page.goto(BASE + href);
  await page.waitForTimeout(6000);
  const chip = page.locator('main a[href*="showcase_account/record"], [role=main] a[href*="showcase_account/record"], a[href*="showcase_account/record"]').first();
  await chip.scrollIntoViewIfNeeded();
  await chip.hover();
  await cardShown(page);
  await page.screenshot({ path: SP + '/shots/27604-details-lookup-chip.png' });
  console.log('card text (details):', (await page.locator('[data-record-hover-card]').innerText()).replace(/\n/g, ' | '));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(800);

  const rowName = page.locator('[data-related-card-row] button').first();
  const rows = await page.locator('[data-related-card-row]').count();
  console.log('compact related rows on the page:', rows);
  if (rows > 0) {
    await rowName.scrollIntoViewIfNeeded();
    await rowName.hover();
    await cardShown(page);
    await page.screenshot({ path: SP + '/shots/27604-compact-related-row.png' });
    console.log('card text (related row):', (await page.locator('[data-record-hover-card]').innerText()).replace(/\n/g, ' | '));
    // Keyboard: Esc hides the card.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    console.log('cards after Esc:', await page.locator('[data-record-hover-card]').count());
  } else {
    await page.screenshot({ path: SP + '/shots/explore-project-record.png' });
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
