// One session: open a contact, then SPA-navigate to Accounts and open an account; is child metadata fetched again?
const { chromium } = require('playwright');
const fs = require('fs');
const SHOTS = '/tmp/claude-0/-home-claude-objectstack/7935dc52-4879-5e5d-a8db-0047aee0acbe/scratchpad/issue-27626/preview/shots/';
const BASE = 'http://localhost:38618';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const T0 = Date.now(); let phase = 'signin';
  const log = { run: 'cross-object one session', viewport: '1440x900', phases: [], requests: [], console: [] };
  page.on('request', q => { if (!['script', 'stylesheet', 'image', 'font'].includes(q.resourceType())) log.requests.push({ t: Date.now() - T0, phase, method: q.method(), url: q.url(), postData: q.postData() || undefined }); });
  page.on('console', m => { if (m.type() === 'error') log.console.push({ phase, text: m.text().slice(0, 300) }); });
  page.on('pageerror', e => log.console.push({ phase, pageerror: String(e).slice(0, 300) }));
  await page.request.post(BASE + '/api/v1/auth/sign-in/email', { data: { email: 'admin@objectos.ai', password: 'admin123' } });
  const mark = n => { phase = n; log.phases.push({ name: n, start: Date.now() - T0 }); };
  mark('contact-list-load');
  await page.goto(BASE + '/apps/com.example.crm/crm_contact', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('a[data-testid="primary-field-link"]', { timeout: 180000 }); await sleep(10000);
  mark('contact-open-cold'); await page.locator('a[data-testid="primary-field-link"]').first().click(); await sleep(9000);
  mark('contact-close'); await page.keyboard.press('Escape'); await sleep(5000);
  mark('nav-to-accounts'); await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.waitForURL(/crm_account/, { timeout: 60000 }); await page.waitForSelector('a[data-testid="primary-field-link"][href*="crm_account"]', { timeout: 120000 }); await sleep(8000);
  mark('account-open-first-in-session'); await page.locator('a[data-testid="primary-field-link"]').first().click(); await sleep(9000);
  await page.screenshot({ path: SHOTS + '21-crossobj-account-drawer.png' });
  mark('account-close'); await page.keyboard.press('Escape'); await sleep(5000);
  mark('done');
  fs.writeFileSync(SHOTS + '22-crossobj-requests.json', JSON.stringify(log, null, 2));
  for (const p of log.phases) { if (p.name === 'done') continue; const rs = log.requests.filter(r => r.phase === p.name); console.log(`\n== ${p.name}: ${rs.length}`); if (!p.name.includes('load')) rs.forEach(r => console.log('  ', r.method, r.url.replace(BASE, '').slice(0, 170), r.postData ? r.postData.slice(0, 100) : '')); else console.log('   meta/object*:', rs.filter(r => r.url.includes('/meta/object')).map(r => r.url.replace(BASE, ''))); }
  console.log('console', log.console);
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
