import { request } from '@playwright/test';
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

export default async function globalSetup() {
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
  // No first-run answer is needed before the specs: the administrator's
  // first-run checklist (objectstack#30206) is a card on Home, not a dialog
  // over the page, and it writes nothing until its own Confirm.
}
