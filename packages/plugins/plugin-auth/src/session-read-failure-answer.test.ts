// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25096] A session lookup the store cannot answer is a FAILURE, never a
 * signed-out caller.
 *
 * plugin-auth mounts better-auth's `customSession` whenever a data engine is
 * configured, so `GET /get-session` and every in-process `api.getSession` run
 * its override. Up to 1.7.7 that override caught whatever the inner session
 * read threw and answered `null`, so a store outage read exactly like "nobody
 * is signed in": over HTTP `anonymous-session-refusal.ts` then turned that
 * `null` into its 401 `UNAUTHENTICATED`, telling a signed-in browser to sign in
 * again. From 1.7.8 (better-auth/better-auth#11391) the override lets the
 * read's error through, so the store failure reaches the caller as
 * better-auth's own 500 `FAILED_TO_GET_SESSION`, which that seam passes
 * through untouched (it converts a `200` + `null` only).
 *
 * That is the right answer for this platform (AGENTS.md, "Absence must be
 * loud" and the degradation-log-level rule): a failure the caller is told
 * about is not a silent degradation, and the browser can tell "retry later"
 * from "sign in again". The in-process callers that want the old reading keep
 * it on purpose: `resolveSessionData` (runtime) and `resolveRequestExecutionContext`
 * (core) catch the throw themselves and treat the request as anonymous.
 *
 * Real stack: `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, the
 * objects from this plugin's manifest and a real `AuthManager`. The fault is
 * injected at the engine, on the `sys_session` reads alone, after the sign-up
 * wrote the session, so every other read the request makes is the real one.
 *
 * Pinned:
 *  - the store failure answers 500 `FAILED_TO_GET_SESSION` over HTTP and
 *    rejects the in-process read, and it does not clear the session cookie;
 *  - the two controls the failure must stay distinguishable from: the healthy
 *    store answers the session, and a token the store does not hold is signed
 *    out (401 `UNAUTHENTICATED` over HTTP, `null` in process).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-25096';
const PASSWORD = 'S3cure!Passw0rd-25096';
const SESSION_OBJECT = 'sys_session';

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()!.destroy(); } catch { /* noop */ }
  }
});

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();
  return engine;
}

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

const getSession = (manager: AuthManager, cookie: string) =>
  manager.handleRequest(new Request(`${AUTH}/get-session`, { headers: { cookie } }));

/** A signed-up user's session cookie, on a manager over a real engine. */
async function signedIn(): Promise<{ engine: ObjectQL; manager: AuthManager; cookie: string }> {
  const engine = await bootEngine();
  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never } as never);
  const signedUp = await manager.handleRequest(new Request(`${AUTH}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: 'reader@example.com', password: PASSWORD, name: 'Reader' }),
  }));
  expect(signedUp.status, await signedUp.clone().text()).toBe(200);
  const cookie = cookieFrom(signedUp);
  expect(cookie, 'the sign-up set a session cookie').toMatch(/session_token=/);
  return { engine, manager, cookie };
}

/** Every engine read of `sys_session` throws from here on; every other read is the real one. */
function failSessionStore(engine: ObjectQL): { attempts: () => number } {
  let attempts = 0;
  const target = engine as unknown as Record<'find' | 'findOne', (object: string, ...rest: unknown[]) => Promise<unknown>>;
  for (const method of ['find', 'findOne'] as const) {
    const real = target[method].bind(engine);
    vi.spyOn(target, method).mockImplementation(async (object: string, ...rest: unknown[]) => {
      if (object === SESSION_OBJECT) {
        attempts += 1;
        throw new Error('session store unavailable (injected)');
      }
      return real(object, ...rest);
    });
  }
  return { attempts: () => attempts };
}

describe('[#25096] a session lookup the store cannot answer is a failure, never a signed-out caller', () => {
  it('CONTROL: the healthy store answers the signed-in session', async () => {
    const { manager, cookie } = await signedIn();
    const res = await getSession(manager, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user?: { email?: string } } | null;
    expect(body?.user?.email).toBe('reader@example.com');
  });

  it('CONTROL: a token the store does not hold is signed out, 401 UNAUTHENTICATED over HTTP and null in process', async () => {
    const { manager } = await signedIn();
    const stranger = 'better-auth.session_token=not-a-session-the-store-holds.sig';
    const res = await getSession(manager, stranger);
    const text = await res.clone().text();
    expect(res.status, text).toBe(401);
    expect(JSON.stringify(JSON.parse(text))).toContain('UNAUTHENTICATED');
    const api = await manager.getApi();
    expect(await api.getSession({ headers: new Headers({ cookie: stranger }) } as never)).toBeNull();
  });

  it('over HTTP: the store failure answers 500 FAILED_TO_GET_SESSION and keeps the session cookie', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, manager, cookie } = await signedIn();
    const fault = failSessionStore(engine);

    const res = await getSession(manager, cookie);

    expect(fault.attempts(), 'the request really reached the session store').toBeGreaterThan(0);
    const text = await res.clone().text();
    expect(res.status, text).toBe(500);
    expect((JSON.parse(text) as { code?: string }).code).toBe('FAILED_TO_GET_SESSION');
    // Nothing tells the browser to drop its credential: the session still
    // exists, the store just could not read it.
    const cleared = (res.headers.getSetCookie?.() ?? []).filter((c) => /session_token=;|session_token=\s*;|Max-Age=0/i.test(c));
    expect(cleared).toEqual([]);
  });

  it('in process: the store failure rejects `api.getSession` instead of resolving null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, manager, cookie } = await signedIn();
    const api = await manager.getApi();
    const fault = failSessionStore(engine);

    const read = api.getSession({ headers: new Headers({ cookie }) } as never);

    await expect(read).rejects.toMatchObject({ statusCode: 500, body: { code: 'FAILED_TO_GET_SESSION' } });
    expect(fault.attempts()).toBeGreaterThan(0);
  });
});
