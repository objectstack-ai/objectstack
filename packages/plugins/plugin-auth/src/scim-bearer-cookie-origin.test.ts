// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33237] A SCIM bearer write is not refused by the browser origin check
 * because some Cookie rode along with it.
 *
 * ## The defect
 *
 * better-auth's `validateOrigin` (1.7.12, `dist/api/middlewares/origin-check.mjs`)
 * decides `useCookies = headers.has("cookie")` and, when it is true, requires an
 * `Origin` (or `Referer`) — `403 MISSING_OR_NULL_ORIGIN` without one. It reads
 * the request `AuthManager.handleRequest` hands it, and `handleRequest` used to
 * forward the Cookie header untouched on `/scim/v2/*`. So an identity provider
 * that keeps a cookie jar (an edge cookie such as `__cf_bm`, a sticky-session
 * load-balancer cookie) could neither provision nor deprovision a user: a SCIM
 * POST or `PATCH active:false` with any Cookie and no Origin answered 403.
 *
 * `@better-auth/scim` authenticates `/scim/v2/*` by the `Authorization: Bearer`
 * credential alone (`createSCIMConnectionMiddleware`), and the platform's
 * verifier reads only that token (`verifyScimBearerToken`), so a Cookie carries
 * no authority on that path: the origin check protected nothing there.
 * `handleRequest` now drops the Cookie from a `/scim/v2/*` request that carries
 * a bearer, before the vendor sees it. No check is relaxed: every other route,
 * and a SCIM request with no bearer, still reaches the origin check with its
 * Cookie.
 *
 * ## Why NODE_ENV is production here
 *
 * Two things would let every case below pass with or without the fix, and the
 * harness turns both off. Outside production `handleRequest` synthesizes a
 * same-origin `Origin` for a request that has none (the dev-DX block): each
 * case runs with `NODE_ENV=production` stubbed, and its first assertion reads
 * it back. And better-auth skips the origin check outright under a test
 * NODE_ENV: `boot()` puts the production value on the live context (the note
 * there says why it cannot come from the stub).
 *
 * Harness: a real `AuthManager` over a real `ObjectQL` on better-sqlite3 with
 * SCIM on and a minted connection credential — the shape of
 * `scim-transaction-scope.test.ts`.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import { mintScimConnectionCredential } from './scim-connection-service.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-33237';
const PASSWORD = 'correct-horse-battery-staple-33237';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** An edge cookie of the kind a CDN sets on every response, plus an expired empty one. */
const EDGE_COOKIE = '__cf_bm=Zm9vYmFyLWJvdC1tYW5hZ2VtZW50; better-auth.session_token=';

const SYSTEM = { context: { isSystem: true } } as const;

const engines: ObjectQL[] = [];
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

interface Harness {
  engine: ObjectQL;
  token: string;
  send: (request: Request) => Promise<Response>;
}

async function boot(): Promise<Harness> {
  const engine = new ObjectQL();
  engines.push(engine);
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();

  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: { scim: true, organization: true },
  } as never);

  // better-auth reads NODE_ENV ONCE, when `@better-auth/core/env` loads, and
  // under vitest that read is `test`, for which it defaults the context's
  // `skipOriginCheck` to `true` (`create-context.mjs`: `disableOriginCheck`
  // unset ⇒ `isTest()`). A deployment runs with `false`. The stub above comes
  // too late for that module-load read, so the production value is put on the
  // live context here — and read back, so a harness that never reached the
  // origin check fails instead of passing every case below vacuously.
  const context = (await (await manager.getAuthInstance()).$context) as {
    skipOriginCheck: unknown;
    skipCSRFCheck: unknown;
  };
  context.skipOriginCheck = false;
  expect(context.skipCSRFCheck, 'the CSRF check is on, as in a deployment').toBe(false);

  const { token } = await mintScimConnectionCredential(engine as never, SECRET, {
    connectionId: 'okta-33237',
    organizationId: 'org_scim_33237',
  });

  return { engine, token, send: (request) => manager.handleRequest(request) };
}

/** A SCIM request as an IdP with a cookie jar sends it: a Cookie, NO Origin, no Referer. */
function scimRequest(
  path: string,
  init: { method: string; bearer?: string; cookie?: string; body?: unknown },
): Request {
  const headers: Record<string, string> = {};
  if (init.bearer !== undefined) headers.authorization = `Bearer ${init.bearer}`;
  if (init.cookie !== undefined) headers.cookie = init.cookie;
  if (init.body !== undefined) headers['content-type'] = 'application/scim+json';
  return new Request(`${AUTH}/scim/v2${path}`, {
    method: init.method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

const userBody = (localPart: string) => ({
  schemas: [USER_SCHEMA],
  userName: `${localPart}@example.com`,
  name: { givenName: localPart, familyName: 'Example' },
  displayName: `${localPart} Example`,
  emails: [{ value: `${localPart}@example.com`, primary: true, type: 'work' }],
  active: true,
});

async function errorCode(res: Response): Promise<unknown> {
  const body = (await res.clone().json().catch(() => null)) as
    | { code?: unknown; error?: { code?: unknown } }
    | null;
  return body?.code ?? body?.error?.code;
}

async function userRow(h: Harness, email: string): Promise<Record<string, unknown> | null> {
  return h.engine.findOne('sys_user', { where: { email }, fields: ['id', 'email'] }, SYSTEM) as Promise<
    Record<string, unknown> | null
  >;
}

/** The dev-DX Origin synthesis must be OFF, or every case below passes without the fix. */
function assertProductionSemantics(): void {
  expect(process.env.NODE_ENV, 'NODE_ENV must read production so no Origin is synthesized').toBe('production');
}

describe('[#33237] a SCIM bearer request is not refused for the Cookie it carries', () => {
  it('POST /Users with a SCIM bearer, a Cookie and no Origin is served (201)', async () => {
    assertProductionSemantics();
    const h = await boot();

    const res = await h.send(
      scimRequest('/Users', { method: 'POST', bearer: h.token, cookie: EDGE_COOKIE, body: userBody('alice') }),
    );

    expect(res.status, `SCIM POST /Users: ${await res.clone().text()}`).toBe(201);
    expect(await userRow(h, 'alice@example.com'), 'the provisioned sys_user row').not.toBeNull();
  }, 60_000);

  it('PATCH /Users/{id} active:false with a SCIM bearer, a Cookie and no Origin is served (200)', async () => {
    assertProductionSemantics();
    const h = await boot();
    const created = await h.send(
      scimRequest('/Users', { method: 'POST', bearer: h.token, body: userBody('bob') }),
    );
    expect(created.status, `SCIM POST /Users (setup, no cookie): ${await created.clone().text()}`).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const res = await h.send(
      scimRequest(`/Users/${id}`, {
        method: 'PATCH',
        bearer: h.token,
        cookie: EDGE_COOKIE,
        body: { schemas: [PATCH_SCHEMA], Operations: [{ op: 'replace', path: 'active', value: false }] },
      }),
    );

    expect(res.status, `SCIM PATCH active:false: ${await res.clone().text()}`).toBe(200);
    expect(((await res.json()) as { active?: unknown }).active, 'the deprovisioned resource').toBe(false);
  }, 60_000);
});

describe('[#33237] the origin check still guards every cookie-carrying request it guarded', () => {
  it('a SCIM POST with a Cookie and NO bearer is still refused: 403 MISSING_OR_NULL_ORIGIN, nothing written', async () => {
    assertProductionSemantics();
    const h = await boot();

    const res = await h.send(
      scimRequest('/Users', { method: 'POST', cookie: EDGE_COOKIE, body: userBody('mallory') }),
    );

    expect(res.status, await res.clone().text()).toBe(403);
    expect(await errorCode(res)).toBe('MISSING_OR_NULL_ORIGIN');
    expect(await userRow(h, 'mallory@example.com'), 'no sys_user row may be written').toBeNull();
  }, 60_000);

  it('CONTROL: a cookie-authenticated non-SCIM POST with no Origin is still refused: 403 MISSING_OR_NULL_ORIGIN', async () => {
    assertProductionSemantics();
    const h = await boot();
    const up = await h.send(
      new Request(`${AUTH}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email: 'carol@example.com', password: PASSWORD, name: 'Carol Example' }),
      }),
    );
    expect(up.status, `sign-up: ${await up.clone().text()}`).toBeLessThan(300);
    const sessionCookie = (up.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .find((c) => c.includes('session_token='));
    expect(sessionCookie, 'sign-up set a session cookie').toBeTruthy();

    // The same session, presented as a browser would — cookie only — on a
    // state-changing route, with no Origin and no Referer.
    const res = await h.send(
      new Request(`${AUTH}/sign-out`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `${sessionCookie}; __cf_bm=Zm9vYmFy` },
        body: '{}',
      }),
    );

    expect(res.status, await res.clone().text()).toBe(403);
    expect(await errorCode(res)).toBe('MISSING_OR_NULL_ORIGIN');
  }, 60_000);
});
