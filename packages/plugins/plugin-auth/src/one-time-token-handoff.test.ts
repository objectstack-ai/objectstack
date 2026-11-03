// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The mobile sign-in hand-off (`one-time-token-handoff.ts`): a session signed
// in in the system browser is handed to a REGISTERED app scheme as a
// single-use token bound to the shell's PKCE challenge, and redeemed at
// better-auth's own `/one-time-token/verify`.
//
// ## Why the server here is the real one
//
// The interception claim is a claim about what better-auth's plugin STORES and
// what it LOOKS UP: that a callback another app intercepts cannot be redeemed,
// and that trying does not burn the real holder's token. A double of the
// plugin would certify a lookup this file invented. So every end-to-end case
// runs the real `AuthManager` (better-auth 1.7.12 and its `one-time-token`
// plugin) over the in-memory engine the package's other suites share, and the
// hand-off through the REAL raw-app registration (`registerAuthRoutes`), as
// `sys-session-revoke.test.ts` does.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import {
  NEVER_APP_SCHEMES,
  ONE_TIME_TOKEN_EXPIRES_IN_MINUTES,
  ONE_TIME_TOKEN_GENERATE_PATH,
  ONE_TIME_TOKEN_HANDOFF_PATH,
  ONE_TIME_TOKEN_VERIFY_PATH,
  appSchemeRefusal,
  assertTrustedAppSchemes,
  oneTimeTokenStoreHasher,
  runOneTimeTokenHandoff,
  s256Challenge,
} from './one-time-token-handoff';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-one-time-token';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const ALICE_EMAIL = 'alice@one-time-token.example.com';
const APP_SCHEME = 'com.example.mobile';
const CALLBACK = `${APP_SCHEME}://auth/callback?state=shell-state`;
/** An RFC 7636 code_verifier, as the shell would make it. */
const VERIFIER = 'Shell-made_code.verifier~0123456789abcdefghijklmnop';

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as any;

const makeManager = (engine: any, trustedAppSchemes: string[] | undefined = [APP_SCHEME]) =>
  new AuthManager({ secret: SECRET, baseUrl: ORIGIN, dataEngine: engine, trustedAppSchemes } as any);

const direct = (manager: AuthManager, path: string, init: RequestInit = {}) =>
  manager.handleRequest(new Request(`${ORIGIN}${BASE}${path}`, init));

const postJson = (manager: AuthManager, path: string, body: unknown) =>
  direct(manager, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

const userRows = (engine: any) => (engine.tables.get('sys_user') ?? []) as any[];
const verificationRows = (engine: any) => (engine.tables.get('sys_verification') ?? []) as any[];

/** The one sign-up every case starts from, made once per file (one scrypt derivation). */
let signedUpTables: Promise<Map<string, any[]>> | undefined;
const signedUpOnce = (): Promise<Map<string, any[]>> =>
  (signedUpTables ??= (async () => {
    const template = createMemoryEngine();
    const manager = makeManager(template);
    await inviteForAudienceGate(manager, ALICE_EMAIL);
    const res = await postJson(manager, '/sign-up/email', { email: ALICE_EMAIL, password: PASSWORD, name: 'Alice' });
    expect(res.status, `sign-up: ${await res.clone().text()}`).toBe(200);
    return template.tables as Map<string, any[]>;
  })());

const arrange = async (trustedAppSchemes?: string[]) => {
  const engine = createMemoryEngine();
  for (const [name, rows] of await signedUpOnce()) engine.tables.set(name, structuredClone(rows));
  const manager = makeManager(engine, trustedAppSchemes);

  // The REAL route registration — raw mounts ahead of the catch-all.
  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const signIn = async (): Promise<string> => {
    const res = await postJson(manager, '/sign-in/email', { email: ALICE_EMAIL, password: PASSWORD });
    expect(res.status, `sign-in: ${await res.clone().text()}`).toBe(200);
    return cookieFrom(res);
  };

  /** GET the hand-off through the Hono app, as the system browser does. */
  const handoff = (cookie: string | undefined, query: Record<string, string>) =>
    app.request(`${ORIGIN}${BASE}${ONE_TIME_TOKEN_HANDOFF_PATH}?${new URLSearchParams(query)}`, {
      headers: cookie ? { cookie } : {},
    });

  /** Hand off and return the token the app callback received. */
  const handOff = async (cookie: string, verifier = VERIFIER): Promise<string> => {
    const res = await handoff(cookie, { redirect_uri: CALLBACK, code_challenge: s256Challenge(verifier), code_challenge_method: 'S256' });
    expect(res.status, `hand-off: ${await res.clone().text()}`).toBe(302);
    const token = new URL(res.headers.get('location')!).searchParams.get('token');
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    return token!;
  };

  const redeem = (token: string) => postJson(manager, ONE_TIME_TOKEN_VERIFY_PATH, { token });

  return { engine, manager, signIn, handoff, handOff, redeem };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

describe('one-time-token hand-off — the redeem is bound to the shell that started it', () => {
  it('hands the system-browser session to the registered app scheme, and the holder of the verifier redeems it once', async () => {
    const { engine, signIn, handoff, redeem } = await arrange();
    const cookie = await signIn();

    const res = await handoff(cookie, { redirect_uri: CALLBACK, code_challenge: s256Challenge(VERIFIER) });
    expect(res.status).toBe(302);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const location = new URL(res.headers.get('location')!);
    expect(location.protocol).toBe(`${APP_SCHEME}:`);
    expect(location.searchParams.get('state')).toBe('shell-state');
    const token = location.searchParams.get('token')!;

    const redeemed = await redeem(`${token}.${VERIFIER}`);
    expect(redeemed.status).toBe(200);
    const body = (await redeemed.json()) as any;
    expect(body.user.id).toBe(userRows(engine).find((r) => r.email === ALICE_EMAIL).id);
    expect(cookieFrom(redeemed)).toContain('session_token=');

    const replay = await redeem(`${token}.${VERIFIER}`);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as any).message).toBe('Invalid token');
  });

  it('an intercepted callback cannot be redeemed, and trying does not burn the real holder\'s token', async () => {
    const { signIn, handOff, redeem } = await arrange();
    const token = await handOff(await signIn());

    // The interceptor holds the callback URL, so the token, and nothing else.
    for (const attempt of [token, `${token}.`, `${token}.${'A'.repeat(43)}`, `${token}.${s256Challenge(VERIFIER)}`]) {
      const res = await redeem(attempt);
      expect(res.status, attempt).toBe(400);
      expect(((await res.json()) as any).message).toBe('Invalid token');
      expect(cookieFrom(res)).not.toContain('session_token=');
    }

    // The shell that started the hand-off still redeems it.
    expect((await redeem(`${token}.${VERIFIER}`)).status).toBe(200);
  });

  it('stores the token hashed and bound to the challenge: neither the token nor the challenge is in the row', async () => {
    const { engine, signIn, handOff } = await arrange();
    const before = verificationRows(engine).length;
    const token = await handOff(await signIn());
    const rows = verificationRows(engine).slice(before);
    expect(rows).toHaveLength(1);
    const identifier = String(rows[0].identifier);
    expect(identifier.startsWith('one-time-token:')).toBe(true);
    expect(identifier).not.toContain(token);
    expect(identifier).not.toContain(s256Challenge(VERIFIER));
    // The same key the redemption computes from `T.verifier`.
    expect(identifier).toBe(`one-time-token:${await oneTimeTokenStoreHasher(`${token}.${VERIFIER}`)}`);
  });

  it(`expires after ${ONE_TIME_TOKEN_EXPIRES_IN_MINUTES} minute`, async () => {
    const { signIn, handOff, redeem } = await arrange();
    const token = await handOff(await signIn());
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ONE_TIME_TOKEN_EXPIRES_IN_MINUTES * 60_000 + 1_000 });
    const res = await redeem(`${token}.${VERIFIER}`);
    expect(res.status).toBe(400);
  });

  it('refuses a client request to the vendor generate route: the hand-off is the only minter', async () => {
    const { manager, signIn } = await arrange();
    const cookie = await signIn();
    const signedIn = await direct(manager, ONE_TIME_TOKEN_GENERATE_PATH, { headers: { cookie } });
    expect(signedIn.status).toBe(400);
    expect(((await signedIn.json()) as any).message).toBe('Client requests are disabled');
    expect((await direct(manager, ONE_TIME_TOKEN_GENERATE_PATH)).status).toBe(401);
  });

  it('a token minted server-side outside the hand-off is unredeemable (fails closed)', async () => {
    const { manager, signIn, redeem } = await arrange();
    const cookie = await signIn();
    const api: any = await manager.getApi();
    const { token } = await api.generateOneTimeToken({ headers: new Headers({ cookie }) });
    expect((await redeem(token)).status).toBe(400);
    expect((await redeem(`${token}.${VERIFIER}`)).status).toBe(400);
  });
});

describe('one-time-token hand-off — the redirect goes to a registered app scheme only', () => {
  it('refuses an unregistered scheme with a 400 and no redirect', async () => {
    const { signIn, handoff } = await arrange();
    const cookie = await signIn();
    for (const redirect_uri of ['com.attacker.app://cb', 'https://attacker.example/cb', 'javascript:alert(1)']) {
      const res = await handoff(cookie, { redirect_uri, code_challenge: s256Challenge(VERIFIER) });
      expect(res.status, redirect_uri).toBe(400);
      expect(res.headers.get('location')).toBeNull();
      expect(((await res.json()) as any).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('matches the registered scheme case-insensitively', async () => {
    const { signIn, handoff } = await arrange();
    const res = await handoff(await signIn(), {
      redirect_uri: 'COM.Example.Mobile://auth/callback',
      code_challenge: s256Challenge(VERIFIER),
    });
    expect(res.status).toBe(302);
  });

  it('with no registered scheme the plugin is not mounted and the hand-off refuses every target', async () => {
    const { manager, signIn, handoff } = await arrange([]);
    const cookie = await signIn();
    expect((await postJson(manager, ONE_TIME_TOKEN_VERIFY_PATH, { token: 'x' })).status).toBe(404);
    const res = await handoff(cookie, { redirect_uri: CALLBACK, code_challenge: s256Challenge(VERIFIER) });
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('refuses a signed-out caller with 401, after the request itself is valid', async () => {
    const { handoff } = await arrange();
    const res = await handoff(undefined, { redirect_uri: CALLBACK, code_challenge: s256Challenge(VERIFIER) });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe('UNAUTHENTICATED');
  });
});

describe('one-time-token hand-off — the request is validated before anything is minted', () => {
  const generate = vi.fn(async () => ({ token: 'never' }));
  const deps = { registeredSchemes: [APP_SCHEME], hasSession: async () => true, generate };
  const ask = (queries: Record<string, string[]>) => runOneTimeTokenHandoff(deps, { queries, headers: new Headers() });
  const challenge = s256Challenge(VERIFIER);

  it.each([
    ['an unknown parameter', { redirect_uri: [CALLBACK], code_challenge: [challenge], scope: ['x'] }],
    ['a repeated redirect_uri', { redirect_uri: [CALLBACK, CALLBACK], code_challenge: [challenge] }],
    ['no redirect_uri', { code_challenge: [challenge] }],
    ['a relative redirect_uri', { redirect_uri: ['/cb'], code_challenge: [challenge] }],
    ['no code_challenge', { redirect_uri: [CALLBACK] }],
    ['a malformed code_challenge', { redirect_uri: [CALLBACK], code_challenge: ['short'] }],
    ['a plain code_challenge_method', { redirect_uri: [CALLBACK], code_challenge: [challenge], code_challenge_method: ['plain'] }],
  ])('refuses %s with 400 VALIDATION_ERROR and mints nothing', async (_label, queries) => {
    generate.mockClear();
    const answer = await ask(queries as Record<string, string[]>);
    expect(answer.status).toBe(400);
    expect((answer.body as any).error.code).toBe('VALIDATION_ERROR');
    expect(answer.headers.Location).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('trustedAppSchemes — refused at construction, never dropped', () => {
  it.each([
    ['https'], ['HTTPS'], ['javascript'], ['data'],
    ['Com.Example.App'], ['com.example.app://'], ['com.example.app:'], ['myapp'], [''], [42],
  ])('refuses %j', (entry) => {
    expect(appSchemeRefusal(entry)).toBeDefined();
    expect(() => assertTrustedAppSchemes(['com.example.ok', entry])).toThrow(/invalid trustedAppSchemes/);
    expect(() => makeManager(createMemoryEngine(), ['com.example.ok', entry as string])).toThrow(/invalid trustedAppSchemes/);
  });

  it('accepts reverse-domain private-use schemes', () => {
    for (const entry of ['com.example.app', 'io.objectstack.mobile', 'com.example.app-beta']) {
      expect(appSchemeRefusal(entry)).toBeUndefined();
    }
    expect(() => assertTrustedAppSchemes(undefined)).not.toThrow();
  });

  it('every web or script scheme is refused even in reverse-domain-looking company', () => {
    for (const scheme of NEVER_APP_SCHEMES) expect(appSchemeRefusal(scheme)).toBeDefined();
  });

  it('applyConfigPatch refuses a bad list and keeps the standing one', () => {
    const manager = makeManager(createMemoryEngine());
    expect(() => manager.applyConfigPatch({ trustedAppSchemes: ['https'] } as any)).toThrow(/invalid trustedAppSchemes/);
    expect(manager.getRegisteredAppSchemes()).toEqual([APP_SCHEME]);
  });
});
