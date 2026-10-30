const { chromium } = require('playwright');
const fs = require('fs');
const { open, state, BASE } = require('./lib');
const URL0 = BASE + '/apps/com.example.crm/crm_contact';
const short = s => ({ st: s.dataState, rail: s.rail, sbW: s.sidebar && s.sidebar.w, mainX: s.main.x, mainW: s.main.w, path: s.path });
(async () => {
  const browser = await chromium.launch();
  const R = { steps: [] };
  const { ctx, page } = await open(browser, 1280);
  const step = async (label) => { const s = short(await state(page)); const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => /side|console/i.test(k)).map(k => [k, localStorage.getItem(k)]))); const ck = await page.evaluate(() => document.cookie); R.steps.push({ label, ...s, ls, ck }); console.log(label.padEnd(58), JSON.stringify(s), JSON.stringify(ls), ck); };
  await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await page.keyboard.press('Control+b'); await page.waitForTimeout(700);
  await page.click('[data-sidebar="footer"] button'); await page.waitForTimeout(700);
  await step('pinned');
  await page.keyboard.press('Control+b'); await page.waitForTimeout(700);
  await step('pinned + Ctrl+B (collapsed docked)');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await step('  reload');
  await page.screenshot({ path: 'shots/p3-edge-pinned-ctrlb-reload.png' });
  await page.mouse.click(24, 700); await page.waitForTimeout(800);
  await step('  click rail background');
  await page.screenshot({ path: 'shots/p3-edge-pinned-collapsed-railbg-click.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  await step('  Esc');
  // get to collapsed docked again and press the pin icon in the rail foot
  let s = await state(page);
  if (s.dataState === 'expanded') { await page.keyboard.press('Control+b'); await page.waitForTimeout(700); await step('  Ctrl+B to collapse'); }
  const footBtn = await page.$('[data-sidebar="footer"] button');
  if (footBtn) { await footBtn.click(); await page.waitForTimeout(800); await step('  press foot pin icon while collapsed'); await page.screenshot({ path: 'shots/p3-edge-unpin-from-collapsed.png' }); }
  else { await step('  no foot button in collapsed state'); }
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await step('  reload');
  fs.writeFileSync('readings-p3-edge.json', JSON.stringify(R, null, 2));
  await browser.close();
})();
