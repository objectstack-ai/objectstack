const L = require('./lib');
const ls = p => p.evaluate(() => localStorage.getItem('os:console-sidebar:wide-open'));
const ck = async ctx => (await ctx.cookies()).filter(c => c.name.startsWith('sidebar')).map(c => c.name + '=' + c.value).join(';');
const mainX = p => p.evaluate(() => { const m = document.querySelector('main'); return m ? Math.round(m.getBoundingClientRect().x) : null; });
async function snap(page, ctx) { const s = await L.state(page); return `${s.state}/${s.panelW}px mainX=${await mainX(page)} keepOpen=${s.keepOpen} ls=${await ls(page)} ck=${await ck(ctx)}`; }
async function run(b, dir, reloadAt1280) {
  const log = [];
  const { ctx, page, errors } = await L.newCtx(b, 1440);
  await page.goto(L.URL); await L.waitApp(page);
  log.push('1440 initial: ' + await snap(page, ctx));
  const T = '[data-sidebar="trigger"]';
  if (dir === 'collapsed') { await page.click(T); await page.waitForTimeout(600); }
  else { await page.click(T); await page.waitForTimeout(600); await page.click(T); await page.waitForTimeout(600); }
  log.push(`1440 after choosing ${dir}: ` + await snap(page, ctx));
  const tag = `28079-${dir}${reloadAt1280 ? '-reload1280' : ''}`;
  await page.screenshot({ path: L.SHOTS + `${tag}-1-wide-choice.png` });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(800);
  log.push('1280 after narrowing: ' + await snap(page, ctx));
  await page.mouse.click(24, 700); await page.waitForTimeout(700);
  log.push('1280 after clicking rail: ' + await snap(page, ctx));
  await page.click('[data-testid="sidebar-keep-open"]'); await page.waitForTimeout(700);
  log.push('1280 keep open ON: ' + await snap(page, ctx));
  await page.screenshot({ path: L.SHOTS + `${tag}-2-keepopen-on-1280.png` });
  await page.click('[data-testid="sidebar-keep-open"]'); await page.waitForTimeout(700);
  log.push('1280 keep open OFF: ' + await snap(page, ctx));
  await page.mouse.move(900, 500); await page.waitForTimeout(700);
  log.push('1280 pointer moved to content: ' + await snap(page, ctx));
  if (reloadAt1280) { await page.reload(); await L.waitApp(page); log.push('1280 after reload: ' + await snap(page, ctx)); }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(800);
  const widened = await L.state(page);
  log.push('1440 after widening: ' + await snap(page, ctx));
  await page.screenshot({ path: L.SHOTS + `${tag}-3-widened-1440.png` });
  await page.reload(); await L.waitApp(page);
  const reloaded = await L.state(page);
  log.push('1440 after reload: ' + await snap(page, ctx));
  await page.screenshot({ path: L.SHOTS + `${tag}-4-reloaded-1440.png` });
  // fresh tab in same profile
  const p2 = await ctx.newPage(); await p2.setViewportSize({ width: 1440, height: 900 }); await p2.goto(L.URL); await L.waitApp(p2);
  const tab = await L.state(p2);
  log.push('1440 new tab same profile: ' + await snap(p2, ctx));
  await ctx.close();
  const pass = widened.state === dir && reloaded.state === dir && tab.state === dir;
  return { dir, reloadAt1280, pass, log, errors };
}
(async () => {
  const b = await L.chromium.launch();
  const res = [];
  for (const [d, r] of [['collapsed', false], ['expanded', false], ['collapsed', true], ['expanded', true]]) res.push(await run(b, d, r));
  for (const r of res) { console.log(`== ${r.dir} reloadAt1280=${r.reloadAt1280} PASS=${r.pass}`); r.log.forEach(l => console.log('  ' + l)); console.log('  errors', JSON.stringify(r.errors)); }
  await b.close();
})();
