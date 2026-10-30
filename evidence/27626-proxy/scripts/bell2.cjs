// Bell polling: idle on the contact list, visible then truly hidden (background tab in same window),
// via raw CDP so Playwright's focus emulation does not pin the page visible.
const { spawn } = require('child_process');
const fs = require('fs');
const { CDP } = require('./cdp.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = '/tmp/claude-0/-home-claude-objectstack/7935dc52-4879-5e5d-a8db-0047aee0acbe/scratchpad/issue-27626/preview/shots/';
const VISIBLE_MS = +(process.env.VISIBLE_MS || 5000), HIDDEN_MS = +(process.env.HIDDEN_MS || 140000); const METHOD = process.env.METHOD || 'tab'; const OUTJSON = process.env.OUTJSON; const OUTPNG = process.env.OUTPNG;
(async () => {
  const exe = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
  const port = +(process.env.PORT || 39241);
  const udd = __dirname + '/udd-bell2-' + METHOD + '-' + Date.now();
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${udd}`, '--no-first-run', '--no-sandbox', '--disable-background-networking', '--disable-component-update', '--no-default-browser-check', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let ver; for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) { ver = await r.json(); break; } } catch {} await sleep(500); }
  const c = await new CDP(ver.webSocketDebuggerUrl).open();
  const { targetInfos } = await c.send('Target.getTargets');
  const pageA = targetInfos.find(t => t.type === 'page');
  const { sessionId: sa } = await c.send('Target.attachToTarget', { targetId: pageA.targetId, flatten: true });
  const ev = async (expr) => { const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sa); return r.result.value; };
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sa);
  const T0 = Date.now();
  const log = { startedAt: new Date(T0).toISOString(), phases: [], requests: [], websockets: [], visibility: [], consoleErrors: [] };
  let phase = 'load';
  c.on(m => {
    if (m.sessionId !== sa) return;
    if (m.method === 'Network.requestWillBeSent') {
      const q = m.params.request; const type = m.params.type;
      if (['Script', 'Stylesheet', 'Image', 'Font'].includes(type)) return;
      log.requests.push({ t: Date.now() - T0, phase, method: q.method, type, url: q.url, postData: q.postData });
    } else if (m.method === 'Network.webSocketCreated') log.websockets.push({ t: Date.now() - T0, phase, url: m.params.url });
    else if (m.method === 'Network.webSocketClosed') log.websockets.push({ t: Date.now() - T0, phase, closed: m.params.requestId });
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') log.consoleErrors.push({ t: Date.now() - T0, phase, text: m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300) });
  });
  await c.send('Network.enable', {}, sa); await c.send('Page.enable', {}, sa); await c.send('Runtime.enable', {}, sa);
  await c.send('Page.navigate', { url: 'http://localhost:38618/api/v1/discovery' }, sa); await sleep(1500);
  const si = await ev(`fetch('/api/v1/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@objectos.ai',password:'admin123'}),credentials:'include'}).then(r=>r.status)`);
  console.log('signin', si);
  log.requests.length = 0;
  phase = 'list-load';
  const tLoad = Date.now() - T0;
  await c.send('Page.navigate', { url: 'http://localhost:38618/apps/com.example.crm/crm_contact' }, sa);
  for (let i = 0; i < 240; i++) { if (await ev(`!!document.querySelector('a[data-testid="primary-field-link"]')`)) break; await sleep(500); }
  const tRows = Date.now() - T0;
  console.log('rows at', tRows);
  await ev("window.__vis=[];document.addEventListener('visibilitychange',()=>window.__vis.push([Math.round(performance.now()),document.visibilityState]));1");
  log.visibility.push({ t: Date.now() - T0, state: await ev('document.visibilityState') });
  log.phases.push({ name: 'list-load', start: tLoad, rowsAt: tRows });
  phase = 'idle-visible';
  const tV = Date.now() - T0;
  await sleep(VISIBLE_MS);
  const vEnd = Date.now() - T0;
  log.visibility.push({ t: vEnd, state: await ev('document.visibilityState') });
  log.phases.push({ name: 'idle-visible', start: tV, end: vEnd });
  const shot = await c.send('Page.captureScreenshot', { format: 'png' }, sa);
  if (OUTPNG) fs.writeFileSync(SHOTS + OUTPNG, Buffer.from(shot.data, 'base64'));
  // Hide: open another tab in the same window and activate it.
  let tb, windowId;
  if (METHOD === 'tab') { ({ targetId: tb } = await c.send('Target.createTarget', { url: 'about:blank', newWindow: false })); await c.send('Target.activateTarget', { targetId: tb }); }
  else { ({ windowId } = await c.send('Browser.getWindowForTarget', { targetId: pageA.targetId })); await c.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }); }
  await sleep(1000);
  phase = 'idle-hidden';
  const tH = Date.now() - T0;
  const hidState = await ev('document.visibilityState');
  log.visibility.push({ t: tH, state: hidState });
  console.log('A state after hiding', hidState);
  // sample visibility every 15s
  for (let s = 0; s < HIDDEN_MS; s += 10000) { await sleep(Math.min(10000, HIDDEN_MS - s)); log.visibility.push({ t: Date.now() - T0, state: await ev('document.visibilityState') }); }
  const hEnd = Date.now() - T0;
  log.phases.push({ name: 'idle-hidden', start: tH, end: hEnd });
  if (METHOD === 'tab') await c.send('Target.activateTarget', { targetId: pageA.targetId }); else await c.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }); await sleep(500);
  phase = 'back-visible';
  const tB = Date.now() - T0;
  log.visibility.push({ t: tB, state: await ev('document.visibilityState') });
  await sleep(20000);
  log.phases.push({ name: 'back-visible', start: tB, end: Date.now() - T0 });
  log.visibilityEvents = await ev('JSON.stringify(window.__vis)');
  const bell = r => /sys_inbox_message|approvals\/requests/.test(r.url);
  const summary = {};
  for (const p of ['list-load', 'idle-visible', 'idle-hidden', 'back-visible']) {
    const rs = log.requests.filter(r => r.phase === p);
    summary[p] = {
      total: rs.length,
      inbox: rs.filter(r => r.url.includes('sys_inbox_message')).map(r => r.t),
      approvals: rs.filter(r => r.url.includes('approvals/requests')).map(r => r.t),
      other: rs.filter(r => !bell(r)).map(r => r.method + ' ' + r.url.replace('http://localhost:38618', '').slice(0, 120) + ' @' + r.t),
    };
  }
  log.summary = summary;
  log.method = METHOD; if (OUTJSON) fs.writeFileSync(SHOTS + OUTJSON, JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ phases: log.phases, visibility: log.visibility, visibilityEvents: log.visibilityEvents, websockets: log.websockets, summary }, null, 2));
  c.close(); proc.kill();
  fs.rmSync(udd, { recursive: true, force: true });
})().catch(e => { console.error('ERR', e); process.exit(1); });
