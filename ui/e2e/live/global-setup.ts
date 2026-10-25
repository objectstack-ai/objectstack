import { chromium, request, type FullConfig, type LaunchOptions } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Live-e2e auth: sign in against the real ObjectStack backend (better-auth) and
 * persist a Playwright storageState the tests reuse. The console adapter sends a
 * Bearer token read from localStorage `auth-session-token`, so we inject that on
 * the APP origin; we also keep the better-auth session cookie for the API origin.
 */
const APP = process.env.LIVE_APP_URL || 'http://localhost:5180';
const API = process.env.LIVE_API_URL || 'http://localhost:3000';
const EMAIL = process.env.LIVE_EMAIL || 'admin@objectos.ai';
const PASSWORD = process.env.LIVE_PASSWORD || 'admin123';

/**
 * Rooted on THIS FILE, never on `process.cwd()` (objectui#9519). A bare
 * relative path handed to `writeFileSync` names no root, so it gets the ambient
 * one: measured on this tree, a live run launched from `e2e/` really created
 * `e2e/e2e/live/.auth/state.json`, one directory below where the specs — which
 * root their READ on their own file since objectui#9188 — go looking.
 *
 * Bare `import.meta.url` taken apart by hand: the spelling PR #7796 landed and
 * PR #7806 reused. Not `new URL(rel, import.meta.url)` — this repo prescribes
 * one spelling, on grounds of spelling uniqueness (objectui#9191).
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 3; // e2e / live / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');
const STATE_PATH = join(REPO_ROOT, 'e2e/live/.auth/state.json');

export default async function globalSetup(config: FullConfig) {
  const ctx = await request.newContext();
  let res;
  try {
    res = await ctx.post(`${API}/api/v1/auth/sign-in/email`, {
      data: { email: EMAIL, password: PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    throw new Error(
      `Live backend unreachable at ${API} (${e?.message}). Start it (e.g. \`objectstack serve --dev\` in examples/app-showcase) before running live e2e.`,
      { cause: e },
    );
  }
  if (!res.ok()) {
    throw new Error(`Live sign-in failed (${res.status()}) at ${API}: ${await res.text()}`);
  }
  const token = res.headers()['set-auth-token'];
  if (!token) throw new Error('Sign-in succeeded but no `set-auth-token` header was returned.');

  const apiState = await ctx.storageState(); // carries the better-auth session cookie
  await ctx.dispose();

  const state = {
    cookies: apiState.cookies,
    origins: [{ origin: APP, localStorage: [{ name: 'auth-session-token', value: token }] }],
  };
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[live-e2e] authenticated as ${EMAIL}; storageState written to ${STATE_PATH}`);

  // The specs' own launch options, so the prompt is answered in the browser
  // the specs run in.
  await answerTimezonePrompt(token, config.projects[0]?.use?.launchOptions);
}

/**
 * Answer the console's one-time workspace-timezone prompt before any spec runs
 * (objectui#11758).
 *
 * On a `--fresh` backend `localization.timezone` is still the manifest default
 * and the seeded admin may write settings, so the console opens a modal prompt
 * on the first app it renders, and every spec would meet it in front of the
 * control it means to click. The run answers it ONCE, in a real browser,
 * through the prompt's own buttons, and keeps the outcome in the storageState
 * the specs reuse:
 *
 *   LIVE_TIMEZONE_PROMPT=decline  (the default) "Keep the default": nothing is
 *                                 written; the prompt records that it was
 *                                 shown in the app origin's localStorage, and
 *                                 the storageState carries that record.
 *   LIVE_TIMEZONE_PROMPT=confirm  "Set timezone": the browser's zone is written
 *                                 to the workspace through the Settings write
 *                                 path, so no later page is asked either.
 *
 * Skipped when the backend says the prompt would not ask (a zone already
 * chosen, or a locked one). A prompt that was expected but never shown is
 * reported, not failed: the specs then show whether anything stands in their
 * way.
 */
async function answerTimezonePrompt(token: string, launchOptions: LaunchOptions | undefined) {
  const mode = process.env.LIVE_TIMEZONE_PROMPT === 'confirm' ? 'confirm' : 'decline';
  const api = await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  let wouldAsk = false;
  try {
    const res = await api.get(`${API}/api/settings/localization`);
    if (res.ok()) {
      const body = await res.json();
      const timezone = (body?.data ?? body)?.values?.timezone;
      wouldAsk = timezone?.source === 'default' && !timezone?.locked;
    }
  } finally {
    await api.dispose();
  }
  if (!wouldAsk) {
    // eslint-disable-next-line no-console
    console.log('[live-e2e] workspace timezone already chosen; no prompt to answer');
    return;
  }

  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({ storageState: STATE_PATH, baseURL: APP });
    const page = await context.newPage();
    // The built-in Setup app: present on every backend, and an app is where
    // the console mounts the prompt.
    await page.goto('/apps/setup');
    const prompt = page.getByTestId('workspace-timezone-prompt');
    try {
      await prompt.waitFor({ state: 'visible', timeout: 60_000 });
    } catch {
      console.warn('[live-e2e] the workspace timezone is the default, but the console showed no prompt');
      return;
    }
    await page.getByTestId(`workspace-timezone-prompt-${mode}`).click();
    await prompt.waitFor({ state: 'hidden' });
    await context.storageState({ path: STATE_PATH });
    // eslint-disable-next-line no-console
    console.log(`[live-e2e] workspace timezone prompt answered: ${mode}`);
  } finally {
    await browser.close();
  }
}
