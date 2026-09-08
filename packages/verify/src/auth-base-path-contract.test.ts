// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16025 — the contract an HTTP adapter mounts the auth surface on, pinned on a
// REAL boot.
//
// `@objectstack/hono`'s `createHonoApp` derives its `/auth/*` mount from the
// auth service's own `basePath` (maintainer ruling 2026-09-06, director batch
// #54, options A + B). It reads that value by calling `getBasePath()` on
// whatever the kernel registered as `auth`, through a structural interface —
// the adapter neither depends on `@objectstack/plugin-auth` nor may. So two
// facts hold the mount up, and NEITHER is observable from the adapter's own
// package:
//
//   ① the registered `auth` service really carries `getBasePath`, and it is
//      reachable through the SYNCHRONOUS `kernel.getService`, which is the only
//      accessor a synchronous `createHonoApp` can use;
//   ② better-auth really ROUTES under the string it answers.
//
// ⛔ Fact ② does not hold because the two are one string, and an earlier
// spelling of this header said it did. `createAuthInstance` hands better-auth
// the CONFIGURED `basePath` verbatim while `getBasePath()` answers its
// normalised form; they differ exactly when a trailing slash is configured, and
// that gap is deliberate — normalising the handed string moves the OAuth
// access-token `iss` and this manager's own verifier then rejects the tokens it
// mints (`auth-manager.ts`, `configuredBasePath()`, carries the measurement).
// What holds the mount up is narrower and is what the rows below assert: the
// WIRE PATHS under `getBasePath()`'s answer are the ones better-auth routes.
//
// This file is where they are observable: `@objectstack/verify` boots the real
// kernel with the real `AuthPlugin`. ⛔ Neither fact may be inferred from the
// adapter's fixture-driven cases in `hono-auth-mount-basepath.test.ts`; that
// file pins the adapter's RULE against a stub and says so.
//
// ── The defect this exists to keep closed ──────────────────────────────────
//
// Measured on this harness before the fix, with the documented embed
// `createHonoApp({ kernel })` — adapter prefix defaulting to `/api`, auth
// basePath defaulting to `/api/v1/auth`:
//
//     POST /api/auth/sign-in/email  (valid shape, wrong password)  ->  200 {}
//     GET  /api/auth/get-session                                   ->  200 {}
//     POST /api/auth/sign-up/email                                 ->  200 {}
//
// A failed sign-in answering `200 {}` is the silent-success shape. It was
// produced by mounting `/auth/*` under the ADAPTER's prefix, forwarding a path
// better-auth does not route, and letting the resulting 404 fall to a terminal
// catch-all. The rows below are the same composition seen from the service
// side, which is where the two paths are told apart.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack } from './harness.js';

/** The auth service surface an HTTP adapter mounts against. */
interface AuthServiceShape {
  handleRequest(request: Request): Promise<Response>;
  ownsRoute(request: Request): Promise<boolean>;
  getBasePath(): string;
}

const app = {
  manifest: {
    id: 'com.example.auth-base-path',
    namespace: 'authbasepath',
    version: '0.0.1',
    type: 'app',
    name: 'Auth Base Path Fixture',
  },
  objects: [],
};

const BOOT_TIMEOUT = 180_000;

// One boot for the whole file: every case reads the same live AuthManager, and
// booting the stack per case is the expensive half of this suite.
let stack: Awaited<ReturnType<typeof bootStack>>;
let auth: AuthServiceShape;

beforeAll(async () => {
  stack = await bootStack(app);
  // ⭐ The SYNC accessor on purpose: `createHonoApp` is synchronous and decides
  // the mount before any request exists, so an `auth` service reachable only
  // through `getServiceAsync` would leave the mount where it was.
  auth = stack.kernel.getService('auth') as unknown as AuthServiceShape;
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop();
}, BOOT_TIMEOUT);

const req = (method: string, path: string, body?: string) =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body }),
  });

describe('#16025 fact ①: the registered auth service says where it serves', () => {
  it('carries getBasePath, synchronously reachable, answering an absolute path', () => {
    expect(typeof auth.getBasePath).toBe('function');
    const base = auth.getBasePath();
    expect(typeof base).toBe('string');
    expect(base.startsWith('/')).toBe(true);
    expect(base.endsWith('/')).toBe(false);
    expect(base.length).toBeGreaterThan(1);
  });

  it('is the same instance the async accessor resolves', async () => {
    expect(auth).toBe(await stack.kernel.getServiceAsync('auth'));
  });
});

describe('#16025 fact ②: better-auth routes under exactly that answer', () => {
  it('routes its own endpoints under the answered base', async () => {
    const base = auth.getBasePath();
    expect(await auth.ownsRoute(req('POST', `${base}/sign-in/email`))).toBe(true);
    expect(await auth.ownsRoute(req('GET', `${base}/get-session`))).toBe(true);
  });

  it('⭐ and NOT under a different base — the control that makes the row above mean something', async () => {
    // Without this, an `ownsRoute` that answered `true` for everything would
    // satisfy the case above while telling the adapter nothing.
    expect(await auth.ownsRoute(req('POST', '/somewhere-else/sign-in/email'))).toBe(false);
    expect(await auth.ownsRoute(req('GET', '/somewhere-else/get-session'))).toBe(false);
  });

  it('answers for real under the answered base — the arrival shape', async () => {
    const base = auth.getBasePath();
    const res = await auth.handleRequest(req('POST', `${base}/delete-user`, '{}'));
    // ADR-0112 envelope: the code and the status. A bare "it did not 404" would
    // stay green on a transport that never reached better-auth at all.
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: 'Unauthorized', code: 'UNAUTHORIZED' });
  });
});

describe("#16025: the card's own composition, from the service side", () => {
  it('disclaims the path the adapter used to mount — prefix `/api` plus `/auth`', async () => {
    // The pre-fix wire path. better-auth does not route it, so the adapter's
    // mount forwarded a request that could only 404, and the 404 then became
    // somebody else's `200 {}`.
    expect(await auth.ownsRoute(req('POST', '/api/auth/sign-in/email'))).toBe(false);
    const res = await auth.handleRequest(req('POST', '/api/auth/delete-user', '{}'));
    expect(res.status).toBe(404);
  });

  it('⭐ the two paths differ, which is the whole defect', () => {
    // If a future change made the auth base `/api/auth`, the row above would
    // stop being the defect's shape — and this assertion is what says so out
    // loud instead of leaving two cases quietly asserting the same thing.
    expect(auth.getBasePath()).not.toBe('/api/auth');
  });
});
