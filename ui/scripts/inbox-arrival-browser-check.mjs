/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Real-browser check for objectui#7011 — drives `inbox-arrival-preview.html` in
 * a real Chromium and reports what the presentation layer actually did.
 *
 * ## Why this is not a vitest file
 *
 * The two APIs this feature turns on are the two happy-dom does not implement:
 * `Notification` is absent, and `document.visibilityState` is a prototype getter
 * a unit test can only fake. Those unit pins are worth having — they are fast
 * and they pin the negative cases — but their failure mode is the bad one: a
 * suite reporting "no desktop notification was raised" for a run in which
 * raising one was never possible. This script measures the same claims against
 * the real API, with a real browser permission grant.
 *
 * It already earned its keep: it found that the settings menu and the presenter
 * held SEPARATE copies of the preferences, so switching desktop notifications on
 * did nothing until the page was reloaded. Every unit pin was green, because a
 * hook mounted alone cannot disagree with itself.
 *
 * ## Running it
 *
 *   pnpm --filter @object-ui/console exec vite --port 5310 --strictPort &
 *   node scripts/inbox-arrival-browser-check.mjs --port 5310
 *
 * Chromium comes from the image's stable alias. ⛔ Never the versioned
 * `chromium-NNNN/...` spelling — that path dies on an image bump and reads as
 * "no browser here" when the browser is present.
 *
 * ## Two contexts, because permission is a per-origin fact
 *
 * A Playwright context that was `grantPermissions(['notifications'])` reports
 * `granted` from the start, and the production code deliberately does NOT prompt
 * over a settled verdict — so the prompt counter can only be LIT in a context
 * that was never granted. Running both is what makes the "never requested"
 * reading a measurement rather than an assumption: the same counter reaches 1 in
 * the second context, from the toggle, and only from the toggle.
 */
import { chromium } from '@playwright/test';

const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? process.argv[portArg + 1] : '5310';
const ORIGIN = `http://localhost:${PORT}`;
const PAGE_URL = `${ORIGIN}/inbox-arrival-preview.html`;

const results = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
}

/**
 * Installed before any page script. Three instruments:
 *  - a controllable `document.visibilityState` (the real one is read-only);
 *  - a recorder AROUND the real `Notification`, so a raised notification is
 *    observable without stopping it from being a real one;
 *  - a counter on `requestPermission` — the whole non-regression axis.
 */
const INIT = `
  let __visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => __visibility });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => __visibility === 'hidden' });
  window.__setVisibility = (value) => {
    __visibility = value;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  window.__permissionRequests = 0;
  window.__desktopNotifications = [];
  const Real = window.Notification;
  function Recorder(title, options) {
    let instance;
    try { instance = new Real(title, options); }
    catch (err) { instance = { onclick: null, close() {}, __synthetic: String(err) }; }
    window.__desktopNotifications.push({ title, options, instance });
    return instance;
  }
  Recorder.prototype = Real.prototype;
  Object.defineProperty(Recorder, 'permission', { get: () => Real.permission });
  Recorder.requestPermission = function (...args) {
    window.__permissionRequests += 1;
    return Real.requestPermission.apply(Real, args);
  };
  window.Notification = Recorder;
`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pageErrors = [];

async function openPage(context) {
  await context.addInitScript(INIT);
  const page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    // The favicon 404 a standalone preview page draws is not this feature's
    // business; anything else is.
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) pageErrors.push(msg.text());
  });
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="fx-first-read"]');
  return page;
}

const helpers = (page) => ({
  toasts: () => page.locator('[data-sonner-toast]'),
  raised: () => page.evaluate(() => window.__desktopNotifications.map((n) => ({ title: n.title, tag: n.options?.tag }))),
  requests: () => page.evaluate(() => window.__permissionRequests),
  log: () => page.evaluate(() => (document.querySelector('[data-testid="fx-log"]')?.textContent ?? '').trim()),
  /** Back to a clean session: memory forgotten, toasts dismissed, rows dropped. */
  reset: async () => { await page.click('[data-testid="fx-reset"]'); await page.waitForTimeout(400); },
  firstRead: async () => { await page.click('[data-testid="fx-first-read"]'); await page.waitForTimeout(400); },
  arrive: async () => { await page.click('[data-testid="fx-one-arrival"]'); await page.waitForTimeout(700); },
  arriveThree: async () => { await page.click('[data-testid="fx-three-arrivals"]'); await page.waitForTimeout(700); },
  hide: () => page.evaluate(() => window.__setVisibility('hidden')),
  show: () => page.evaluate(() => window.__setVisibility('visible')),
});

// ═══ Context A — the browser has GRANTED notifications ══════════════════════
{
  const context = await browser.newContext();
  await context.grantPermissions(['notifications'], { origin: ORIGIN });
  const page = await openPage(context);
  const h = helpers(page);

  check(
    'control: the real Notification API is present and granted in this context',
    await page.evaluate(() => ({ type: typeof window.Notification, permission: window.Notification.permission })),
    { type: 'function', permission: 'granted' },
  );

  // ── Acceptance 2 / constraint 1 ───────────────────────────────────────────
  await h.firstRead();
  check('acceptance 2: the first read of 3 historical unread raises NO toast', await h.toasts().count(), 0);
  check('acceptance 2: ...and no desktop notification either', await h.raised(), []);

  // ── Acceptance 1 ──────────────────────────────────────────────────────────
  await h.arrive();
  check('acceptance 1: one new message raises exactly one toast', await h.toasts().count(), 1);
  check(
    'acceptance 1: the toast names the message',
    await h.toasts().first().innerText().then((text) => text.includes('Assigned to you: m4')),
    true,
  );
  await page.getByRole('button', { name: 'View' }).click();
  await page.waitForTimeout(400);
  // The tail, not the whole log: StrictMode mounts the tree twice in dev, so
  // the initial `/home` location is logged twice. That is a property of the
  // FIXTURE's own logger, not of the feature, and pinning it would make this
  // check fail the day the fixture stops using StrictMode.
  check(
    'acceptance 1: clicking it marks the row read and deep-links to it',
    await h.log().then((text) => text.split('\n').slice(-2)),
    ['markRead:m4', 'navigate:/apps/setup/showcase_task/m4'],
  );

  // ── Acceptance 5 ──────────────────────────────────────────────────────────
  await h.reset();
  await h.firstRead();
  await h.arriveThree();
  check('acceptance 5: three messages in one cycle raise ONE toast, not three', await h.toasts().count(), 1);
  check(
    'acceptance 5: ...and it summarizes rather than picking a winner',
    await h.toasts().first().innerText().then((text) => /3/.test(text)),
    true,
  );

  // ── Acceptance 4 — the user never opted in, so a hidden tab is silent ─────
  await h.reset();
  await h.hide();
  await h.firstRead();
  await h.arrive();
  check(
    'acceptance 4: a hidden tab whose user never opted in stays completely silent',
    { toasts: await h.toasts().count(), desktop: await h.raised() },
    { toasts: 0, desktop: [] },
  );

  // ⭐ Nothing so far touched the prompt. Context B lights this same counter.
  check('⭐ permission was NEVER requested on load, on refresh, or on arrival', await h.requests(), 0);

  // ── Acceptance 3 / constraint 5 — opted in + granted + hidden ⇒ desktop ───
  await h.show();
  await page.click('[data-testid="notification-desktop-toggle"]');
  await page.waitForTimeout(400);
  check(
    'the switch reaches the presenter in the SAME tab (no reload)',
    await page.evaluate(() => window.__inboxArrivalFixture.storedPreferences()),
    '{"toast":true,"desktop":true}',
  );
  check('...and an already-granted browser is not prompted again', await h.requests(), 0);

  await h.reset();
  await h.hide();
  await h.firstRead();
  await h.arrive();
  check(
    'acceptance 3: a hidden tab gets the DESKTOP notification',
    await h.raised().then((all) => all.map((n) => n.title)),
    ['Assigned to you: m4'],
  );
  check('constraint 5: ...and no toast was raised behind it', await h.toasts().count(), 0);

  // ── Constraint 5, the other direction ─────────────────────────────────────
  await h.reset();
  await h.show();
  const desktopBefore = (await h.raised()).length;
  await h.firstRead();
  await h.arrive();
  check(
    'constraint 5: a VISIBLE tab gets the toast and no new desktop notification',
    { toasts: await h.toasts().count(), newDesktop: (await h.raised()).length - desktopBefore },
    { toasts: 1, newDesktop: 0 },
  );

  await context.close();
}

// ═══ Context B — never granted, so the verdict is unsettled ═════════════════
{
  const context = await browser.newContext();
  const page = await openPage(context);
  const h = helpers(page);

  check(
    'control: an un-granted context reports an UNSETTLED verdict',
    await page.evaluate(() => window.Notification.permission),
    'default',
  );

  // Everything the presenter does, with the prompt still unasked.
  await h.firstRead();
  await h.arrive();
  await h.hide();
  await h.arrive();
  check('⭐ still never requested — not on mount, refresh, arrival, or hide', await h.requests(), 0);

  // ⭐ The lit control for that zero: the toggle, and only the toggle, prompts.
  await h.show();
  await page.click('[data-testid="notification-desktop-toggle"]');
  await page.waitForTimeout(600);
  check('⭐ the settings toggle DOES prompt (lights the counter above)', await h.requests(), 1);

  // Headless Chromium answers an un-granted prompt with `denied` — which is the
  // permanent verdict this whole design exists to avoid spending by accident.
  /**
   * Headless Chromium answers an un-granted prompt with `denied`, but whether it
   * then PERSISTS that verdict on the origin is its own business — it was
   * observed doing both. So the invariant asserted here is the one that is the
   * product's: the switch never claims a channel it does not have, nothing is
   * stored as enabled, and the "go to browser settings" hint appears exactly
   * when the browser actually reports `denied` — never on a verdict that is
   * still open, which would tell the user to fix something that is not broken.
   */
  // Headless Chromium auto-answers an un-granted prompt, but not always
  // promptly and not always by PERSISTING the verdict — both were observed. So
  // wait for the settle rather than sampling once, and then assert the
  // invariants that are the PRODUCT's regardless of which way it went.
  let settled = null;
  for (let i = 0; i < 40 && settled === null; i += 1) {
    settled = await page.evaluate(() => window.__inboxArrivalFixture.storedPreferences());
    if (settled === null) await page.waitForTimeout(250);
  }
  const verdict = await page.evaluate(() => window.Notification.permission);
  const hint = await page.locator('[data-testid="notification-desktop-hint"]').count();
  console.log(`      (headless verdict after the prompt: ${verdict}; stored: ${settled})`);
  check(
    'a blocked prompt leaves the switch off and stores nothing enabled',
    {
      state: await page.getAttribute('[data-testid="notification-desktop-toggle"]', 'data-state'),
      stored: settled,
      // The "go to browser settings" hint appears exactly when the browser
      // really says `denied` — never over a verdict that is still open, which
      // would tell the user to fix something that is not broken.
      hintMatchesVerdict: (verdict === 'denied') === (hint > 0),
    },
    { state: 'unchecked', stored: '{"toast":true,"desktop":false}', hintMatchesVerdict: true },
  );

  await context.close();
}

check('no page errors', pageErrors, []);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
