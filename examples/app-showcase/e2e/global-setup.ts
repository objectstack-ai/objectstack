import { chromium, request, type FullConfig, type LaunchOptions } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Ambient `process` with `env` — types/node-shim.d.ts declares the global as
// `{ cwd(): string }` only, so each module that reads env widens it locally.
// Same one-liner as the specs beside this file and objectstack.config.ts.
// Declared above the block comment below so that comment stays attached to the
// first emitted statement.
declare const process: { env: Record<string, string | undefined> };

/**
 * Auth for the showcase smoke: sign in against the backend (better-auth) and
 * persist a Playwright storageState. The console (served at :3000/_console)
 * reads a Bearer token from localStorage `auth-session-token` on the :3000
 * origin, so we inject that there; the session cookie covers the API.
 */
const API = process.env.SMOKE_API_URL || 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL || 'admin@objectos.ai';
const PASSWORD = process.env.SMOKE_PASSWORD || 'admin123';
const STATE_PATH = 'e2e/.auth/state.json';
const APP = process.env.SHOWCASE_APP || 'com.example.showcase';

export default async function globalSetup(config: FullConfig) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${API}/api/v1/auth/sign-in/email`, {
    data: { email: EMAIL, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`sign-in failed (${res.status()}): ${await res.text()}`);
  const token = res.headers()['set-auth-token'];
  if (!token) throw new Error('no set-auth-token header from sign-in');
  const apiState = await ctx.storageState();
  await ctx.dispose();
  const state = {
    cookies: apiState.cookies,
    origins: [{ origin: API, localStorage: [{ name: 'auth-session-token', value: token }] }],
  };
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  // The specs' own launch options (playwright.config.ts carries
  // `OS_TEST_CHROMIUM_EXECUTABLE_PATH` there), so the prompt is answered in the
  // browser the specs run in.
  const promptRecord = await declineWorkspacePrompt(token, config.projects[0]?.use?.launchOptions);
  if (promptRecord.length > 0) {
    state.origins[0].localStorage.push(...promptRecord);
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }
}

/**
 * Decline the console's one-time workspace prompt before any spec runs.
 *
 * The console asks an administrator, in ONE modal dialog on the first app page
 * it renders, to set the workspace timezone while it is still the manifest
 * default, and — since the prompt's currency arm (objectstack#28872, commit
 * 2ac698baf1) — the default currency while `localization.currency` has no
 * value. The showcase's dev seed derives the currency from the host's POSIX
 * locale and leaves it unset on a host that sets none or names no country, and
 * the seeded admin may write settings, so every spec would meet that dialog in
 * front of the page it reads: the modal makes the page behind it
 * `aria-hidden`, so role queries (`getByRole('checkbox')`, `getByRole('table')`,
 * a section's disclosure button) find nothing and a click never lands.
 *
 * The run answers it ONCE, in a real browser, through the prompt's own decline
 * button ("Not now" / "Keep the default"), the same way the console's own live
 * suite does (ui/e2e/live/global-setup.ts). Declining writes nothing to the
 * workspace — the showcase stays exactly as seeded, so no spec's reading of an
 * amount moves — and the prompt keeps its per-device record of having asked in
 * this origin's localStorage (`PROMPT_RECORD_PREFIX`:ORG:USER). That record,
 * and nothing else the console stored while it was open, is what this returns
 * for the storageState every spec reuses: the rest (the sidebar's wide-open
 * flag, recent items, the active organization) would change the fresh-context
 * layout the specs measure from — detail-shapes derives its 780 px window from
 * a context with no stored sidebar state.
 *
 * Skipped when the backend says the prompt would not ask (the console's own
 * condition per key, `workspaceTimezonePromptLogic.ts`). A prompt that was
 * expected but never shown is reported, not failed: the specs then show whether
 * anything stands in their way. A prompt that was declined but left no record
 * throws: every spec would meet it again, and that is the run's one cause.
 */
const PROMPT_RECORD_PREFIX = 'os:workspace-timezone-prompt:';

async function declineWorkspacePrompt(
  token: string,
  launchOptions: LaunchOptions | undefined,
): Promise<{ name: string; value: string }[]> {
  const api = await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  let wouldAsk = false;
  try {
    const res = await api.get(`${API}/api/settings/localization`);
    if (res.ok()) {
      const body = await res.json();
      const values = (body?.data ?? body)?.values;
      const timezone = values?.timezone;
      const currency = values?.currency;
      const timezoneUnset = timezone?.source === 'default' && !timezone?.locked;
      const currencyUnset =
        currency?.source === 'default' &&
        !currency?.locked &&
        (currency?.value === null || currency?.value === undefined || currency?.value === '');
      wouldAsk = timezoneUnset || currencyUnset;
    }
  } finally {
    await api.dispose();
  }
  if (!wouldAsk) return [];

  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({ storageState: STATE_PATH, baseURL: API });
    const page = await context.newPage();
    await page.goto(`/_console/apps/${APP}`, { waitUntil: 'domcontentloaded' });
    const prompt = page.getByTestId('workspace-timezone-prompt');
    try {
      await prompt.waitFor({ state: 'visible', timeout: 60_000 });
    } catch {
      console.warn('[showcase-smoke] the workspace timezone or currency is unset, but the console showed no prompt');
      return [];
    }
    await page.getByTestId('workspace-timezone-prompt-decline').click();
    await prompt.waitFor({ state: 'hidden' });
    const stored = await context.storageState();
    const record = (stored.origins.find((o) => o.origin === new URL(API).origin)?.localStorage ?? []).filter((e) =>
      e.name.startsWith(PROMPT_RECORD_PREFIX),
    );
    if (record.length === 0) {
      throw new Error(
        `the workspace prompt was declined but left no ${PROMPT_RECORD_PREFIX}* record in localStorage, ` +
          'so every spec would meet it again',
      );
    }
    return record;
  } finally {
    await browser.close();
  }
}
