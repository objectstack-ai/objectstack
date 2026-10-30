const L = require('./lib');
(async () => {
  const b = await L.chromium.launch();
  for (const w of [1440, 1280]) {
    const { ctx, page, errors } = await L.newCtx(b, w);
    await page.goto(L.URL); await L.waitApp(page);
    console.log(w, JSON.stringify(await L.state(page)));
    console.log(await page.evaluate(() => {
      const sb = document.querySelector('[data-sidebar="sidebar"]');
      let el = sb, out=[]; for (let i=0;i<5 && el;i++){ out.push(el.tagName+' '+(el.className||'').toString().slice(0,200)+' attrs:'+[...el.attributes].filter(a=>a.name.startsWith('data-')).map(a=>a.name+'='+a.value).join(',')); el=el.parentElement;} return out.join('\n');
    }));
    console.log('localStorage', await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))));
    console.log('cookies', (await ctx.cookies()).map(c=>c.name+'='+c.value.slice(0,40)).join('; '));
    console.log('errors', errors);
    await page.screenshot({ path: L.SHOTS + 'explore-'+w+'.png' });
    await ctx.close();
  }
  await b.close();
})();
