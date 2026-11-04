import { test, expect } from '@playwright/test';

// Ambient `process` for the env reads below: the showcase tsconfig does not pull
// in `@types/node` (same idiom and reason as the specs beside this file).
declare const process: { env: Record<string, string | undefined> };

/**
 * The mobile sign-in, end to end, in a real browser against the real Console: the
 * app opens the hand-off route and nothing else, the signed-out browser lands on
 * the sign-in page, and after the sign-in the route hands a token to the app.
 *
 * An installed app stays in use for months while the server under it upgrades, so
 * this is what notices a Console upgrade breaking it for those people: a sign-in
 * route that moved, or a page that stopped treating `redirect` as the hand-off.
 * No unit test holds both ends. It runs in the nightly `live` tier
 * (`test/showcase-smoke.live.test.ts`), the one lane where the backend serves the
 * Console at its real mount, as a deployment does: `Live E2E UI` serves it from
 * `vite preview` at the root, where the route's redirect has nothing to land on.
 *
 * On a server that did not boot with `playwright.config.ts`'s
 * `OS_TRUSTED_APP_SCHEMES`, such as one `reuseExistingServer` attached to, the first
 * assertion fails with a `400`: no scheme is registered there.
 */

const API = process.env.SMOKE_API_URL || 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL || 'admin@objectos.ai';
const PASSWORD = process.env.SMOKE_PASSWORD || 'admin123';

/** The scheme `playwright.config.ts` registers on its `webServer`. */
const HANDOFF_APP_SCHEME = 'com.example.showcase.e2e';
const CALLBACK = `${HANDOFF_APP_SCHEME}://auth/callback`;
/** An RFC 7636 verifier, as the app makes one, and `BASE64URL(SHA-256(verifier))`. */
const VERIFIER = 'showcase-e2e_mobile.handoff~verifier-0123456789abcdef';
const CHALLENGE = '9IIwBgnDEsLVGM-qq6wnLXO6eiMqtyyEEOJEyOGnc5M';

const HANDOFF_PATH = '/api/v1/auth/one-time-token/handoff';
const HANDOFF = `${HANDOFF_PATH}?${new URLSearchParams({
  redirect_uri: CALLBACK,
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
})}`;

// The hand-off exists for a browser with no session, so nothing from the suite's
// sign-in comes along.
test.use({ storageState: { cookies: [], origins: [] } });

test('a signed-out browser opens the hand-off, signs in on the sign-in page, and the route hands a token to the app', async ({ page, request }) => {
  // The app's probe: not a page navigation, so it reads `401` as "this server
  // registered me" and is never sent to a page.
  const probe = await request.get(HANDOFF, { headers: { Accept: 'application/json' }, maxRedirects: 0 });
  expect(probe.status(), await probe.text()).toBe(401);

  const toApp = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === HANDOFF_PATH &&
      response.status() === 302 &&
      (response.headers().location ?? '').startsWith(`${HANDOFF_APP_SCHEME}:`),
  );

  // The one URL the app opens. The browser is sent to the form on this origin.
  await page.goto(HANDOFF, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').waitFor({ state: 'visible', timeout: 25_000 });
  const signInPage = new URL(page.url());
  expect(signInPage.origin).toBe(new URL(API).origin);
  expect(signInPage.pathname).toBe('/_console/login');
  expect(signInPage.searchParams.get('redirect')).toBe(HANDOFF);

  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').first().click();

  // The page forwards by script, and the route answers with the app's scheme. A
  // browser has no handler for that scheme, so the response is the end of the road.
  const answer = await toApp;
  expect((await answer.request().allHeaders())['sec-fetch-site']).toBe('same-origin');
  const location = new URL(answer.headers().location);
  const token = location.searchParams.get('token');
  expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);

  // What the app does next: the token redeems for the holder of the verifier only.
  const intercepted = await request.post('/api/v1/auth/one-time-token/verify', { data: { token } });
  expect(intercepted.status()).toBe(400);
  const redeemed = await request.post('/api/v1/auth/one-time-token/verify', { data: { token: `${token}.${VERIFIER}` } });
  expect(redeemed.status(), await redeemed.text()).toBe(200);
});
