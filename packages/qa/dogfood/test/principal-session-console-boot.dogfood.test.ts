// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23813] A session minted by `IAuthService.mintPrincipalSession` boots the
 * REAL console — the door the print service (#22269) sends its headless
 * browser through, under the requesting user's principal (#8346 B′, M2).
 *
 * ## The defect this pins
 *
 * better-auth refreshed a minted session on every read. #23772's guard held
 * its `expiresAt`, but the refresh still wrote the row, re-set the session
 * cookie and so made `bearer()` answer `set-auth-token` on every request. The
 * console's auth client reads that header as a token rotation and re-resolves
 * identity; the new identity re-runs its organization reads, whose session
 * reads refresh again. Measured on this file's stack with the fix ablated: the
 * console never leaves "Opening your console…" and `get-session` runs without
 * end, for an administrator and a member alike, while a normal sign-in session
 * for the same user boots.
 *
 * ## The stack
 *
 * The showcase booted in-process (`bootShowcase`), the console mounted on the
 * same Hono app by the CLI's own `createConsoleStaticPlugin` (what `os serve`
 * mounts), and a real Chromium whose every request is answered by that app.
 * The minted cookie is set exactly as the mint hands it out, and nothing else
 * is: no bearer, no dont-remember cookie.
 *
 * Two prerequisites live outside the test runner: the built console
 * (`scripts/build-console.sh`, at `.objectui-sha`) and a Chromium executable
 * (`OS_TEST_CHROMIUM_EXECUTABLE_PATH`, or `PLAYWRIGHT_BROWSERS_PATH/chromium`).
 * Without either the file skips and says so; the wire half of the pin (no
 * refresh, no `set-auth-token`, no row write, on both lanes) runs everywhere,
 * in `plugin-auth`'s `principal-session-mint.no-refresh.pin.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';
import { hasConsoleDist, resolveConsolePath, createConsoleStaticPlugin } from '@objectstack/cli/console';
import showcaseStack from '@objectstack/example-showcase';
import { bootShowcase } from './showcase-boot.js';

const ORIGIN = 'http://localhost:3000';
const CONSOLE_URL = `${ORIGIN}/_console/`;
/** `bootStack`'s seeded dev admin (`@objectstack/verify`). */
const ADMIN_EMAIL = 'admin@objectos.ai';
const ADMIN_PASSWORD = 'admin123';
const MEMBER_EMAIL = 'member.23813@example.com';
const MEMBER_PASSWORD = 'Member!Pass23813';
/** How long a boot may take before the splash counts as stuck. */
const BOOT_BUDGET_MS = 30_000;
/** The quiet window after boot: a settled console reads no session in it. */
const SETTLE_MS = 3_000;

function chromiumExecutable(): string | null {
  const explicit = process.env.OS_TEST_CHROMIUM_EXECUTABLE_PATH;
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root) return null;
  const candidate = path.join(root, 'chromium');
  return fs.existsSync(candidate) ? candidate : null;
}

const consoleDist = resolveConsolePath();
const executable = chromiumExecutable();
const ready = !!consoleDist && hasConsoleDist(consoleDist) && !!executable;
if (!ready) {
  console.warn(
    `[#23813] principal-session-console-boot SKIPPED: ${!consoleDist || !hasConsoleDist(consoleDist) ? 'no built console (run scripts/build-console.sh)' : ''}` +
      `${!executable ? ' no Chromium (set OS_TEST_CHROMIUM_EXECUTABLE_PATH or PLAYWRIGHT_BROWSERS_PATH)' : ''}`,
  );
}

/** What one console boot did, as the browser saw it. */
interface BootReading {
  /** The splash is gone, the signed-in shell is on screen, and no sign-in form is. */
  booted: boolean;
  /** `get-session` answers that resolved the user, before the boot settled. */
  sessionsResolved: number;
  getSessionDuringBoot: number;
  /** `get-session` calls in the quiet window after boot — a settled console makes none. */
  getSessionAfterSettle: number;
  /** Responses that handed the browser a reissued session (`bearer()`'s `set-auth-token`). */
  setAuthTokenResponses: number;
}

describe.skipIf(!ready)('[#23813] a minted principal session boots the real console', () => {
  let stack: VerifyStack;
  let auth: any;
  let browser: any;
  let cookieName: string;

  beforeAll(async () => {
    // The console is composed into the app's own plugins, as `os serve` mounts it beside them.
    const plugins = [
      ...((showcaseStack as { plugins?: unknown[] }).plugins ?? []),
      createConsoleStaticPlugin(path.join(consoleDist!, 'dist')),
    ];
    stack = await bootShowcase({ orgContext: true }, { ...showcaseStack, plugins });
    auth = await stack.kernel.getServiceAsync('auth');
    cookieName = (await auth.getAuthContext()).authCookies.sessionToken.name;
    await stack.signUp(MEMBER_EMAIL, MEMBER_PASSWORD, 'Member 23813');
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ executablePath: executable!, headless: true });
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await stack?.stop();
  });

  /** The user and organization a bearer session resolves to, as the HTTP entry reads them. */
  async function whoIs(bearer: string): Promise<{ userId: string; tenantId?: string }> {
    const res = await stack.raw('/api/v1/auth/get-session', { headers: { authorization: `Bearer ${bearer}`, origin: ORIGIN } });
    const body = (await res.json()) as any;
    return { userId: String(body.user.id), tenantId: body.session.activeOrganizationId ?? undefined };
  }

  /** A normal sign-in of the dev admin, on the cookie lane: the session cookie value the sign-in route sets. */
  async function signInCookie(): Promise<string> {
    const res = await stack.raw('/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const set = res.headers.getSetCookie().find((c) => c.startsWith(`${cookieName}=`));
    if (!set) throw new Error(`control: the sign-in route answered ${res.status} and set no session cookie`);
    return set.slice(cookieName.length + 1).split(';')[0];
  }

  /** Open the console in a fresh browser context carrying exactly `cookieValue` as the session cookie. */
  async function bootConsole(cookieValue: string): Promise<BootReading> {
    const context = await browser.newContext();
    const reading: BootReading = {
      booted: false,
      sessionsResolved: 0,
      getSessionDuringBoot: 0,
      getSessionAfterSettle: 0,
      setAuthTokenResponses: 0,
    };
    let settled = false;
    try {
      await context.addCookies([{ name: cookieName, value: cookieValue, url: ORIGIN, httpOnly: true, sameSite: 'Lax' }]);
      await context.route('**/*', async (route: any) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin !== ORIGIN) return route.abort();
        const isGetSession = url.pathname.endsWith('/auth/get-session');
        if (isGetSession) {
          if (settled) reading.getSessionAfterSettle++;
          else reading.getSessionDuringBoot++;
        }
        const body = req.postDataBuffer();
        const res = await stack.raw(`${url.pathname}${url.search}`, {
          method: req.method(),
          headers: await req.allHeaders(),
          ...(body && req.method() !== 'GET' && req.method() !== 'HEAD' ? { body } : {}),
        });
        if (res.headers.has('set-auth-token')) reading.setAuthTokenResponses++;
        const payload = Buffer.from(await res.arrayBuffer());
        if (isGetSession && res.status === 200 && !settled) {
          try {
            if (JSON.parse(payload.toString('utf8'))?.user?.id) reading.sessionsResolved++;
          } catch { /* not a session answer */ }
        }
        const out: Record<string, string> = {};
        res.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
        const cookies = res.headers.getSetCookie();
        if (cookies.length) out['set-cookie'] = cookies.join('\n');
        await route.fulfill({ status: res.status, headers: out, body: payload });
      });

      const page = await context.newPage();
      await page.goto(CONSOLE_URL);
      const deadline = Date.now() + BOOT_BUDGET_MS;
      while (Date.now() < deadline) {
        const text: string = await page.evaluate(() => document.body?.innerText ?? '');
        const onSplash = text.includes('Opening your console');
        const onSignIn = /sign in to your account/i.test(text) || /\/login\b/.test(page.url());
        if (!onSplash && !onSignIn && text.trim().length > 0 && reading.sessionsResolved > 0) {
          reading.booted = true;
          break;
        }
        await page.waitForTimeout(250);
      }
      settled = true;
      await page.waitForTimeout(SETTLE_MS);
    } finally {
      await context.close();
    }
    return reading;
  }

  it('control: a normal sign-in session for the administrator boots the console', async () => {
    const reading = await bootConsole(await signInCookie());
    expect(reading.booted, `the harness cannot boot the console at all: ${JSON.stringify(reading)}`).toBe(true);
    expect(reading.getSessionAfterSettle).toBe(0);
  }, 90_000);

  for (const who of ['administrator', 'member'] as const) {
    it(`a minted session for the ${who} boots the console and then reads no session`, async () => {
      const bearer = who === 'administrator' ? await stack.signIn() : await stack.signIn(MEMBER_EMAIL, MEMBER_PASSWORD);
      const { userId, tenantId } = await whoIs(bearer);
      const minted = await auth.mintPrincipalSession({
        userId,
        ...(tenantId ? { tenantId } : {}),
        positions: [],
        permissions: [],
        isSystem: false,
      });
      try {
        const reading = await bootConsole(minted.cookie.value);
        expect(
          {
            booted: reading.booted,
            getSessionAfterSettle: reading.getSessionAfterSettle,
            setAuthTokenResponses: reading.setAuthTokenResponses,
          },
          `the console did not settle on a minted session: ${JSON.stringify(reading)}`,
        ).toEqual({ booted: true, getSessionAfterSettle: 0, setAuthTokenResponses: 0 });
      } finally {
        await minted.revoke();
      }
    }, 90_000);
  }
});
