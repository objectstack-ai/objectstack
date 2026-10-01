// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21078] The OIDC discovery routes are on the router before the route hook
 * returns — so a request that arrives before the better-auth instance is
 * ready cannot freeze them out.
 *
 * ## The defect
 *
 * Hono builds its route matcher on the first request it matches; from then on
 * `app.get(...)` throws `Can not add a route since the matcher is already
 * built`. `registerAuthRoutes` used to dispatch the discovery mount with
 * `void`, and that mount awaited the better-auth instance BEFORE calling
 * `rawApp.get(...)`. Whenever the instance outlived the rest of the boot, the
 * socket opened first; one request in that window (any path — a readiness
 * probe is the likely one) built the matcher, the late mount threw, the throw
 * was caught and logged, and `/.well-known/openid-configuration` and
 * `/.well-known/oauth-authorization-server` answered 404 for the life of the
 * process. Measured downstream on a real composition; the instance resolving
 * after the first request is reproduced here with a deferred.
 *
 * ## What these pins drive, and what they stub
 *
 * The REAL `registerAuthRoutes` on a REAL Hono app — the matcher whose
 * freezing is the defect — and the REAL `@better-auth/oauth-provider` document
 * builders, over a fake `auth.api` that answers the two config reads they
 * make. Only `AuthManager` is a stand-in, so the test owns WHEN the instance
 * resolves; it carries exactly the members the mount and the handlers read.
 *
 * ## Why the pins can fail
 *
 * The control is the late-but-IDLE boot (the instance resolves, then the
 * first request arrives): both doors answer 200 under the old shape and the
 * new one alike, so the harness can produce a 200. The pin differs from it in
 * one variable — a request lands BEFORE the instance resolves — and under the
 * old await-then-mount shape it answers 404. The PR carries the ablation run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin';

const ORIGIN = 'http://localhost:3000';
const ISSUER = `${ORIGIN}/api/v1/auth`;

const DOORS = [
  '/.well-known/openid-configuration',
  '/.well-known/oauth-authorization-server',
] as const;
/** RFC 8414 §3.1 path-inserted alias, and the two RFC 9728 documents. */
const SIBLINGS = [
  '/.well-known/oauth-authorization-server/api/v1/auth',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/api/v1/mcp',
] as const;
const ALL_DISCOVERY_PATHS = [...DOORS, ...SIBLINGS];

/**
 * The publish smoke greps this phrase out of a boot log by name
 * (`scripts/publish-smoke.sh`, SMOKE_BOOT_ERROR_PATTERN) — the one consumer
 * that parses this line's text, which is why the anchor is asserted and the
 * rest of the sentence is not.
 */
const SMOKE_ANCHOR = 'Failed to register OIDC discovery routes';

const savedEnv = {
  mcp: process.env.OS_MCP_SERVER_ENABLED,
  oidc: process.env.OS_OIDC_PROVIDER_ENABLED,
};
beforeEach(() => {
  delete process.env.OS_MCP_SERVER_ENABLED;
  delete process.env.OS_OIDC_PROVIDER_ENABLED;
});
afterEach(() => {
  for (const [key, value] of [
    ['OS_MCP_SERVER_ENABLED', savedEnv.mcp],
    ['OS_OIDC_PROVIDER_ENABLED', savedEnv.oidc],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A better-auth instance as far as the vendor's two document builders read it. */
const fakeAuthInstance = () => ({
  api: {
    getOAuthServerConfig: async () => ({ issuer: ISSUER, token_endpoint: `${ISSUER}/oauth2/token` }),
    getOpenIdConfig: async () => ({ issuer: ISSUER, userinfo_endpoint: `${ISSUER}/oauth2/userinfo` }),
  },
});

/** Let every queued continuation run — long enough for any late mount to land. */
const settle = () => new Promise((r) => setTimeout(r, 20));

interface MountOptions {
  /** `false` composes the same plugin with the embedded AS off — the unmounted baseline. */
  oidcProvider?: boolean;
  /** What `getAuthInstance()` hands back; defaults to an already-resolved instance. */
  instance?: () => Promise<unknown>;
  degraded?: Array<{ feature: string; error: string }>;
  /** Wrap the real app's `get` (to record, or to refuse a path). */
  wrapGet?: (realGet: (...args: any[]) => unknown) => (...args: any[]) => unknown;
}

function mount(opts: MountOptions = {}) {
  const app = new Hono();
  const errors: string[] = [];
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn(),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn((msg: unknown) => errors.push(String(msg))),
    },
    getKernel: vi.fn(),
  } as unknown as PluginContext;

  const plugin = new AuthPlugin({
    secret: 'test-secret-at-least-32-chars-long!!',
    baseUrl: ORIGIN,
    ...(opts.oidcProvider === false ? { plugins: { oidcProvider: false } } : {}),
  } as any);
  const instance = opts.instance ?? (async () => fakeAuthInstance());
  (plugin as any).authManager = {
    getAuthInstance: vi.fn(() => instance()),
    getDegradedAuthFeatures: () => opts.degraded ?? [],
    getAuthIssuer: () => ISSUER,
    isMcpOAuthEnabled: () => true,
    getMcpResourceUrl: () => `${ORIGIN}/api/v1/mcp`,
    getMcpProtectedResourceMetadata: () => ({
      resource: `${ORIGIN}/api/v1/mcp`,
      authorization_servers: [ISSUER],
    }),
    // The auth catch-all's two reads; no request here reaches it.
    handleRequest: vi.fn(async () => new Response(null, { status: 404 })),
    ownsRoute: vi.fn(async () => false),
  };

  const rawApp = opts.wrapGet
    ? new Proxy(app, {
        get(target, prop, receiver) {
          if (prop === 'get') return opts.wrapGet!(target.get.bind(target));
          return Reflect.get(target, prop, receiver);
        },
      })
    : app;
  const register = () =>
    (plugin as any).registerAuthRoutes({ getRawApp: () => rawApp, getPort: () => 0 }, ctx);
  return { app, errors, register };
}

const get = (app: Hono, path: string) => app.request(`${ORIGIN}${path}`);

describe('[#21078] discovery routes mount before the first request, not after the instance', () => {
  it('control — the late-but-IDLE boot: instance ready before the first request, both doors 200', async () => {
    const late = deferred<unknown>();
    const { app, errors, register } = mount({ instance: () => late.promise });
    register();
    late.resolve(fakeAuthInstance());
    await settle(); // the idle gap: nothing has asked the server anything yet

    for (const door of DOORS) {
      const res = await get(app, door);
      expect([door, res.status]).toEqual([door, 200]);
      expect((await res.json()).issuer).toBe(ISSUER);
    }
    expect(errors).toEqual([]);
  });

  it('⭐ a request that lands BEFORE the instance resolves does not freeze the doors out', async () => {
    const late = deferred<unknown>();
    const { app, errors, register } = mount({ instance: () => late.promise });
    register();

    // The readiness probe: the first request this server ever matches. It
    // builds Hono's matcher — after this, nothing can be added to it.
    const probe = await get(app, '/api/v1/health');
    expect(probe.status).toBe(404);

    late.resolve(fakeAuthInstance());
    await settle(); // any late mount has had its chance to land (and throw)

    for (const door of DOORS) {
      const res = await get(app, door);
      expect([door, res.status]).toEqual([door, 200]);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect((await res.json()).issuer).toBe(ISSUER);
    }
    // ⛔ And nothing was thrown-and-logged on the way: a swallowed mount
    // failure is exactly how the defect stayed invisible.
    expect(errors).toEqual([]);
  });

  it('⭐ a discovery request that arrives first WAITS for the instance and then answers 200', async () => {
    const late = deferred<unknown>();
    const { app, register } = mount({ instance: () => late.promise });
    register();

    const pending = DOORS.map((door) => get(app, door));
    late.resolve(fakeAuthInstance());
    const answers = await Promise.all(pending);
    expect(answers.map((r) => r.status)).toEqual([200, 200]);
  });

  it('the alias and the protected-resource documents survive the early request too', async () => {
    const late = deferred<unknown>();
    const { app, register } = mount({ instance: () => late.promise });
    register();
    await get(app, '/api/v1/health');
    late.resolve(fakeAuthInstance());
    await settle();

    const statuses = await Promise.all(SIBLINGS.map(async (p) => [p, (await get(app, p)).status]));
    expect(statuses).toEqual(SIBLINGS.map((p) => [p, 200]));
  });

  it('every discovery path is on the router by the time registerAuthRoutes RETURNS', () => {
    const mounted: string[] = [];
    const { register } = mount({
      // An instance that never resolves: whatever is mounted here was mounted
      // without waiting for it.
      instance: () => new Promise(() => {}),
      wrapGet: (realGet) => (path: string, ...handlers: unknown[]) => {
        mounted.push(path);
        return realGet(path, ...handlers);
      },
    });
    register(); // synchronous — no await between this and the read below
    expect(ALL_DISCOVERY_PATHS.filter((p) => !mounted.includes(p))).toEqual([]);
  });

  it('⛔ a discovery route that cannot mount fails the route hook — it is not caught and logged', async () => {
    const refusal = new Error('route table refused a /.well-known path');
    const { errors, register } = mount({
      wrapGet: (realGet) => (path: string, ...handlers: unknown[]) => {
        if (path.startsWith('/.well-known/')) throw refusal;
        return realGet(path, ...handlers);
      },
    });

    let thrown: unknown;
    try {
      register();
    } catch (e) {
      thrown = e;
    }
    // The very error the router raised, out of the hook's own call — so the
    // kernel's propagating `kernel:ready` dispatch fails the boot with it.
    expect(thrown).toBe(refusal);
    await settle();
    expect(errors.filter((e) => e.includes(SMOKE_ANCHOR))).toEqual([]);
  });
});

describe('[#21078] the instance-level half is answered by the handler', () => {
  it('a degraded oauthProvider: the doors answer exactly as the UNMOUNTED paths do, and the boot says so once', async () => {
    const degraded = [{ feature: 'oidcProvider', error: 'oauthProvider init threw' }];
    const subject = mount({ degraded });
    const baseline = mount({ oidcProvider: false }); // same plugin, discovery never mounted
    subject.register();
    baseline.register();
    await settle();

    for (const path of ALL_DISCOVERY_PATHS) {
      const got = await get(subject.app, path);
      const unmounted = await get(baseline.app, path);
      expect([path, got.status, await got.text()]).toEqual([
        path,
        unmounted.status,
        await unmounted.text(),
      ]);
    }
    // Reported once, at ERROR, naming the cause — the wording is not pinned.
    expect(subject.errors.filter((e) => e.includes('oauthProvider init threw'))).toHaveLength(1);
    expect(baseline.errors).toEqual([]);
  });

  it('an instance that cannot be built: reported at boot under the smoke anchor, answered 500, and retried per request', async () => {
    let failing = true;
    const { app, errors, register } = mount({
      instance: async () => {
        if (failing) throw new Error('better-auth build failed');
        return fakeAuthInstance();
      },
    });
    register();
    await settle();

    // Boot: the failure is logged once, at ERROR, under the anchor — not swallowed.
    expect(errors.filter((e) => e.includes(SMOKE_ANCHOR))).toHaveLength(1);

    const broken = await get(app, DOORS[0]);
    expect(broken.status).toBe(500);

    // The route is not frozen to that answer: the next request rebuilds.
    failing = false;
    const recovered = await get(app, DOORS[0]);
    expect(recovered.status).toBe(200);
  });
});
