import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const requests = [];
page.on('request', (req) => requests.push({ url: req.url(), type: req.resourceType() }));
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const baseURL = 'http://localhost:4173/console/';
const t0 = Date.now();
const resp = await page.goto(baseURL, { waitUntil: 'load', timeout: 30000 });
const t1 = Date.now();
console.log(`GET ${baseURL} -> ${resp.status()} in ${t1 - t0} ms`);

await page.waitForTimeout(2000);

const jsRequests = requests.filter((r) => r.type === 'script');
const totalBytes = (await Promise.all(jsRequests.map(async (r) => {
  try {
    const res = await page.request.get(r.url);
    return (await res.body()).byteLength;
  } catch { return 0; }
}))).reduce((a, b) => a + b, 0);

console.log(`\nTotal JS chunks loaded for initial paint: ${jsRequests.length}`);
console.log(`Total JS bytes (uncompressed): ${(totalBytes / 1024).toFixed(1)} KB`);

const heavyChunks = ['plugin-calendar', 'plugin-charts', 'maplibre-gl', 'plugin-markdown', 'plugin-gantt', 'plugin-map', 'plugin-kanban'];
const eagerlyLoadedHeavy = jsRequests.filter((r) => heavyChunks.some((h) => r.url.includes(h)));
console.log(`\nHeavy lazy chunks loaded eagerly (should be 0): ${eagerlyLoadedHeavy.length}`);
eagerlyLoadedHeavy.forEach((r) => console.log('  - ' + r.url.split('/').pop()));

const title = await page.title();
const rootText = await page.evaluate(() => document.querySelector('#root')?.innerText?.slice(0, 200) || '');
console.log(`\nTitle: ${title}`);
console.log(`#root text (first 200): ${rootText.replace(/\n/g, ' | ')}`);

console.log(`\nErrors (${errors.length}):`);
errors.slice(0, 10).forEach((e) => console.log('  - ' + e.slice(0, 200)));

await page.screenshot({ path: '/tmp/console-home.png', fullPage: false });
console.log('\nScreenshot: /tmp/console-home.png');

console.log('\n--- Now navigate to a kanban view to test lazy load ---');
const beforeNav = requests.length;
// Try common routes
const routes = ['/console/objects', '/console/apps', '/console/'];
for (const r of routes) {
  try {
    const navResp = await page.goto(`http://localhost:4173${r}`, { waitUntil: 'load', timeout: 10000 });
    console.log(`${r} -> ${navResp.status()}`);
    await page.waitForTimeout(1000);
  } catch (e) { console.log(`${r} -> ERROR ${String(e).slice(0,100)}`); }
}
const lazyLoaded = requests.slice(beforeNav).filter((r) => heavyChunks.some((h) => r.url.includes(h)));
console.log(`\nHeavy chunks loaded after navigation: ${lazyLoaded.length}`);
lazyLoaded.forEach((r) => console.log('  - ' + r.url.split('/').pop()));

await browser.close();
