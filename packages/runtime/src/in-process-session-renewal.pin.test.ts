// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] An in-process session read never leaves the browser's cookie behind.
 *
 * better-auth's `getSession` renews a session older than `updateAge` — it moves
 * `sys_session.expires_at` to `now + expiresIn` — and stages the renewed cookie
 * on THAT call's response. A door reading in-process answers with its own
 * response, so the cookie was thrown away: the session lived on as a bearer
 * while the browser's cookie died at its old `Max-Age` (a SPLIT session). The
 * rule every in-process reader now applies (`inProcessSessionReadInput`,
 * `@objectstack/types`): a request carrying a session cookie reads without
 * renewal; a bearer-only request renews as before.
 *
 * Pinned here against REAL better-auth, the version this repo pins, its
 * `expiresIn` / `updateAge` read off the running instance. A session is aged to
 * `now + expiresIn − updateAge − 60 s` — past `updateAge`, the method the card
 * measured with — and read back from `sys_session` at driver level below every
 * hook after each request:
 *
 *   - each of this lane's doors, by cookie: `expires_at` does not move and no
 *     session cookie is set — cookie and session stay aligned;
 *   - the same door, bearer only: `expires_at` renews as before, and still no
 *     cookie is set on a response to a request that sent none (this half is
 *     also each door's positive control — it proves the door's reader ran);
 *   - the control, `GET /auth/get-session`: renews AND re-issues the cookie with
 *     `Max-Age = expiresIn`, and still does so right after the inbound rate
 *     limiter's reader (`resolveSessionPrincipalId`, which runs on EVERY request
 *     ahead of the route) has read the same aged session.
 *
 * Doors and the reader each one reaches:
 *   `GET /data/:object`           → `@objectstack/rest` `computeExecCtx`
 *   `GET /auth/me/permissions`    → `@objectstack/plugin-hono-server` current-user endpoints
 *   `GET /i18n/locales`           → this package's dispatcher, `resolveExecutionContext`
 *   `resolveSessionPrincipalId`   → this package's `resolve-session-principal` (rate limiter,
 *                                   concrete route mounts), called as the limiter calls it
 * The remaining in-process readers — the dispatcher's auth-gate and membership
 * reads, REST's gate re-read, cloud-connection's three — are pinned on the
 * input they hand better-auth in their own packages' `in-process-session-read`
 * pins; this file is what that input DOES.
 *
 * Composition: an in-process `ObjectKernel` in the order `@objectstack/verify`'s
 * `bootStack` uses (engine, sqlite-wasm default datasource, HTTP server, the
 * app, platform objects, auth, security, REST, dispatcher), requests injected
 * through the HTTP app, signed in as the dev-seeded administrator. The boot is
 * paid in `beforeAll`, never inside a case.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { AppPlugin } from './app-plugin.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { resolveSessionPrincipalId } from './security/resolve-session-principal.js';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };
/** Clock slack between the server's `now` and this file's, in ms. */
const SLACK_MS = 5_000;

const PIN_APP: any = {
  manifest: { id: 'com.pin.session22258', name: 'Session renewal pins', version: '1.0.0' },
  objects: [{ name: 'pin_session_note', label: 'Pin note', fields: { title: { type: 'text', label: 'Title' } } }],
};

let kernel: any;
let httpServer: any;
let app: any;
let prevNodeEnv: string | undefined;
let expiresInSec: number;
let updateAgeSec: number;
/** The admin's credentials, as a browser and as a bearer client hold them. */
let cookiePair: string;
let bearer: string;
let sessionToken: string;

const req = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${API}${path}`, init);

/** The `sys_session` row's expiry, read at driver level below every hook. */
async function storedExpiry(): Promise<number> {
  const engine: any = await kernel.getServiceAsync('objectql');
  const driver = engine.getDriver('sys_session');
  const found = await driver.find('sys_session', { where: { token: sessionToken } });
  const row = (Array.isArray(found) ? found : [found]).find(Boolean) as Record<string, unknown> | undefined;
  if (!row) throw new Error('pin: the signed-in session row is gone');
  return new Date(String(row.expires_at)).getTime();
}

/** Age the session to just past `updateAge` — the card's `now + expiresIn − updateAge − 60 s`. */
async function ageSession(): Promise<number> {
  const target = Date.now() + (expiresInSec - updateAgeSec - 60) * 1000;
  const engine: any = await kernel.getServiceAsync('objectql');
  const driver = engine.getDriver('sys_session');
  const found = await driver.find('sys_session', { where: { token: sessionToken } });
  const row = (Array.isArray(found) ? found : [found]).find(Boolean) as Record<string, unknown>;
  await driver.update('sys_session', String(row.id), { expires_at: new Date(target).toISOString() });
  const stored = await storedExpiry();
  expect(Math.abs(stored - target), 'the aging write did not land').toBeLessThan(1_000);
  return stored;
}

/** The session-token cookie a response stages, or `null`. */
function sessionCookieOf(res: Response): { maxAgeSec: number | null } | null {
  const staged = res.headers.getSetCookie().find((c) => /(?:^|\.)session_token=/.test(c.split(';')[0]));
  if (!staged) return null;
  const m = /;\s*max-age=(\d+)/i.exec(staged);
  return { maxAgeSec: m ? Number(m[1]) : null };
}

const asCookie = (): Record<string, string> => ({ cookie: cookiePair });
const asBearer = (): Record<string, string> => ({ authorization: `Bearer ${bearer}` });

/**
 * The pin: cookie and session expiry stay ALIGNED — either the session did not
 * move and no cookie was staged, or it moved and its cookie was re-issued to
 * expire with it.
 */
function expectAligned(label: string, aged: number, after: number, res: Response) {
  const cookie = sessionCookieOf(res);
  if (after !== aged) {
    expect(cookie, `${label}: the session renewed (+${Math.round((after - aged) / 1000)} s) but its cookie was not re-issued`).not.toBeNull();
    const cookieExpiry = Date.now() + (cookie!.maxAgeSec ?? 0) * 1000;
    expect(Math.abs(cookieExpiry - after), `${label}: re-issued cookie and session expire apart`).toBeLessThan(SLACK_MS);
  } else {
    expect(cookie, `${label}: a cookie was staged for a session that did not move`).toBeNull();
  }
}

beforeAll(async () => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` / bootStack arm it

  kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(PIN_APP));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new AuthPlugin({ secret: 'session-renewal-22258-secret', autoDefaultOrganization: false }));
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();

  // The version this repo pins, read off the running instance — never assumed.
  const authService: any = await kernel.getServiceAsync('auth');
  const authContext: any = await authService.getAuthContext();
  expiresInSec = Number(authContext.sessionConfig.expiresIn);
  updateAgeSec = Number(authContext.sessionConfig.updateAge);

  const res = await req('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  if (!res.ok) throw new Error(`pin signIn failed: ${res.status} ${await res.text()}`);
  const staged = res.headers.getSetCookie().find((c: string) => /(?:^|\.)session_token=/.test(c.split(';')[0]));
  if (!staged) throw new Error('pin signIn staged no session cookie');
  cookiePair = staged.split(';')[0];
  bearer = String(res.headers.get('set-auth-token') ?? '');
  if (!bearer) throw new Error('pin signIn emitted no set-auth-token');
  sessionToken = String(((await res.json()) as any).token);
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe('[#22258] precondition — this stack renews, and the defect is better-auth\'s own behaviour', () => {
  it('reads expiresIn / updateAge off the running better-auth', () => {
    expect(expiresInSec).toBeGreaterThan(updateAgeSec);
    expect(updateAgeSec).toBeGreaterThan(60);
  });

  it('a bare in-process getSession on an aged session renews it and stages a cookie nobody sends', async () => {
    const aged = await ageSession();
    const authService: any = await kernel.getServiceAsync('auth');
    const api: any = await authService.getApi();
    // No rule: the call every reader used to make.
    await api.getSession({ headers: new Headers({ cookie: cookiePair }) });
    const after = await storedExpiry();
    expect(after - aged, 'the fixture does not renew — every pin below would pass vacuously')
      .toBeGreaterThan((updateAgeSec - SLACK_MS / 1000) * 1000);
  });
});

const DOORS: Array<{ label: string; path: string }> = [
  { label: 'GET /data/:object (rest computeExecCtx)', path: '/data/pin_session_note?limit=1' },
  { label: 'GET /auth/me/permissions (hono current-user endpoints)', path: '/auth/me/permissions' },
  { label: 'GET /i18n/locales (dispatcher resolveExecutionContext)', path: '/i18n/locales' },
];

describe('[#22258] each door of this lane leaves cookie and session expiry aligned', () => {
  for (const door of DOORS) {
    it(`${door.label} — by cookie: no renewal, no cookie`, async () => {
      const aged = await ageSession();
      const res = await req(door.path, { headers: asCookie() });
      expect(res.status, `${door.label} answered ${res.status}`).toBeLessThan(500);
      const after = await storedExpiry();
      expectAligned(door.label, aged, after, res);
      expect(after, `${door.label}: a cookie request renewed in-process`).toBe(aged);
    });

    it(`${door.label} — bearer only: renews as before, sets no cookie`, async () => {
      const aged = await ageSession();
      const res = await req(door.path, { headers: asBearer() });
      expect(res.status, `${door.label} answered ${res.status}`).toBeLessThan(500);
      const after = await storedExpiry();
      expect(after, `${door.label}: a bearer-only read no longer renews`).toBeGreaterThan(aged);
      expect(Math.abs(after - (Date.now() + expiresInSec * 1000)), `${door.label}: the renewal is not to now + expiresIn`)
        .toBeLessThan(SLACK_MS);
      expect(sessionCookieOf(res), `${door.label}: a cookie was set on a response to a request that sent none`).toBeNull();
    });
  }
});

describe('[#22258] the rate limiter\'s reader (resolveSessionPrincipalId)', () => {
  it('by cookie: resolves the principal without renewal — and get-session then still renews AND re-issues', async () => {
    const aged = await ageSession();
    const authService: any = await kernel.getServiceAsync('auth');
    // Exactly the limiter's call: the request's raw header record.
    const principal = await resolveSessionPrincipalId(authService, asCookie());
    expect(principal, 'the limiter resolved no principal from the cookie').toBeTruthy();
    expect(await storedExpiry(), 'the limiter renewed a cookie session in-process').toBe(aged);

    // The route behind it: renewal still happens where the cookie is re-issued.
    const res = await req('/auth/get-session', { headers: asCookie() });
    expect(res.status).toBe(200);
    const after = await storedExpiry();
    expect(after, 'get-session found nothing left to renew').toBeGreaterThan(aged);
    expectAligned('get-session after the limiter', aged, after, res);
  });

  it('bearer only: resolves the principal AND renews as before', async () => {
    await ageSession();
    const authService: any = await kernel.getServiceAsync('auth');
    expect(await resolveSessionPrincipalId(authService, asBearer())).toBeTruthy();
    expect(Math.abs((await storedExpiry()) - (Date.now() + expiresInSec * 1000)), 'a bearer-only read no longer renews')
      .toBeLessThan(SLACK_MS);
  });
});

describe('[#22258] control — the browser-facing get-session still renews and re-issues', () => {
  it('renews an aged session and re-issues the cookie with Max-Age = expiresIn', async () => {
    const aged = await ageSession();
    const res = await req('/auth/get-session', { headers: asCookie() });
    expect(res.status).toBe(200);
    const after = await storedExpiry();
    expect(Math.abs(after - (Date.now() + expiresInSec * 1000)), 'get-session did not renew').toBeLessThan(SLACK_MS);
    expect(sessionCookieOf(res)?.maxAgeSec, 'get-session did not re-issue the cookie with Max-Age = expiresIn').toBe(expiresInSec);
    expectAligned('get-session', aged, after, res);
  });
});
