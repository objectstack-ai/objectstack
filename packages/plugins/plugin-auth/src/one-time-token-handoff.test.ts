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
  HANDOFF_REFUSED_AT_PARAM,
  NEVER_APP_SCHEMES,
  ONE_TIME_TOKEN_EXPIRES_IN_MINUTES,
  ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS,
  ONE_TIME_TOKEN_GENERATE_PATH,
  ONE_TIME_TOKEN_HANDOFF_PATH,
  ONE_TIME_TOKEN_VERIFY_PATH,
  appSchemeRefusal,
  assertTrustedAppSchemes,
  isPageNavigation,
  oneTimeTokenStoreHasher,
  resolveHandoffSignInEntry,
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

const makeManager = (engine: any, trustedAppSchemes: string[] | undefined = [APP_SCHEME], extra: Record<string, unknown> = {}) =>
  new AuthManager({ secret: SECRET, baseUrl: ORIGIN, dataEngine: engine, trustedAppSchemes, ...extra } as any);

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

const arrange = async (
  trustedAppSchemes?: string[],
  { managerConfig, mountConsole }: { managerConfig?: Record<string, unknown>; mountConsole?: (app: Hono) => void } = {},
) => {
  const engine = createMemoryEngine();
  for (const [name, rows] of await signedUpOnce()) engine.tables.set(name, structuredClone(rows));
  const manager = makeManager(engine, trustedAppSchemes, managerConfig);

  // The REAL route registration — raw mounts ahead of the catch-all.
  const app = new Hono();
  // What this composition serves besides the API, on the same app, as `os serve`
  // mounts the Console beside these routes. A Hono app takes no route after its
  // first request, so it goes on here.
  mountConsole?.(app);
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

  /** GET the hand-off through the Hono app. A browser's navigation headers go in `extra`. */
  const handoff = (cookie: string | undefined, query: Record<string, string>, extra: Record<string, string> = {}) =>
    app.request(`${ORIGIN}${BASE}${ONE_TIME_TOKEN_HANDOFF_PATH}?${new URLSearchParams(query)}`, {
      headers: { ...(cookie ? { cookie } : {}), ...extra },
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

  return { engine, manager, ctx, signIn, handoff, handOff, redeem };
};

/** What a browser's address bar or a `location.assign` sends: Fetch Metadata and an HTML `Accept`. */
const NAVIGATION = {
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/** What `os serve` mounts when the Console is built: an HTML document on every page path. */
const servedConsole = (app: Hono) => {
  app.get('/_console/*', (c) => c.html('<!doctype html><title>Console</title>'));
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

  it('answers a signed-out caller that is not a page navigation with 401, after the request itself is valid', async () => {
    const { handoff } = await arrange();
    const res = await handoff(undefined, { redirect_uri: CALLBACK, code_challenge: s256Challenge(VERIFIER) });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe('UNAUTHENTICATED');
  });
});

describe('one-time-token hand-off — only a fresh sign-in, opened by the app itself (ruling A)', () => {
  const query = { redirect_uri: CALLBACK, code_challenge: s256Challenge(VERIFIER) };

  it(`answers a session older than ${ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS} seconds with 401 and mints nothing, for a caller that is not a page navigation`, async () => {
    const { engine, signIn, handoff } = await arrange();
    const cookie = await signIn();
    const before = verificationRows(engine).length;
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS * 1000 + 1_000 });
    const res = await handoff(cookie, query);
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe('UNAUTHENTICATED');
    expect(res.headers.get('location')).toBeNull();
    expect(verificationRows(engine).length).toBe(before);
  });

  it('still hands off a session inside the window', async () => {
    const { signIn, handoff } = await arrange();
    const cookie = await signIn();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS * 1000 - 5_000 });
    expect((await handoff(cookie, query)).status).toBe(302);
  });

  it('refuses a cross-site navigation with 400 and mints nothing', async () => {
    const { engine, signIn, handoff } = await arrange();
    const cookie = await signIn();
    const before = verificationRows(engine).length;
    const res = await handoff(cookie, query, { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('VALIDATION_ERROR');
    expect(res.headers.get('location')).toBeNull();
    expect(verificationRows(engine).length).toBe(before);
  });

  it.each([['none'], ['same-origin'], ['same-site']])('hands off when Sec-Fetch-Site is %s', async (site) => {
    const { signIn, handoff } = await arrange();
    expect((await handoff(await signIn(), query, { 'sec-fetch-site': site })).status).toBe(302);
  });

  it('does not refuse a request that carries no Sec-Fetch-Site at all', async () => {
    const { signIn, handoff } = await arrange();
    expect((await handoff(await signIn(), query)).status).toBe(302);
  });
});

describe('one-time-token hand-off — a page navigation without a fresh session goes to the sign-in page', () => {
  const query = { redirect_uri: CALLBACK, code_challenge: s256Challenge(VERIFIER), code_challenge_method: 'S256' };
  const handoffPath = `${BASE}${ONE_TIME_TOKEN_HANDOFF_PATH}`;

  /** The answer's `Location`, split into what it names. */
  const signInTarget = (res: Response) => {
    const location = res.headers.get('location')!;
    const url = new URL(location, 'http://never.example');
    return { location, path: url.pathname, query: url.searchParams, redirect: url.searchParams.get('redirect')! };
  };

  it('sends a signed-out navigation there, naming the same request and minting nothing', async () => {
    const { engine, handoff } = await arrange(undefined, { mountConsole: servedConsole });
    const before = verificationRows(engine).length;
    const res = await handoff(undefined, query, NAVIGATION);
    expect(res.status).toBe(302);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const target = signInTarget(res);
    expect(target.path).toBe('/_console/login');
    expect(target.redirect).toBe(`${handoffPath}?${new URLSearchParams(query)}`);
    expect(verificationRows(engine).length).toBe(before);
  });

  it(`sends a session older than ${ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS} seconds there too, minting nothing`, async () => {
    const { engine, signIn, handoff } = await arrange(undefined, { mountConsole: servedConsole });
    const cookie = await signIn();
    const before = verificationRows(engine).length;
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS * 1000 + 1_000 });
    const res = await handoff(cookie, query, NAVIGATION);
    expect(res.status).toBe(302);
    expect(signInTarget(res).path).toBe('/_console/login');
    expect(signInTarget(res).query.get(HANDOFF_REFUSED_AT_PARAM)).toBe(String(Date.now()));
    expect(verificationRows(engine).length).toBe(before);
  });

  it('still hands a fresh session straight to the app: the sign-in page is not in its path', async () => {
    const { signIn, handoff } = await arrange(undefined, { mountConsole: servedConsole });
    const res = await handoff(await signIn(), query, NAVIGATION);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).protocol).toBe(`${APP_SCHEME}:`);
  });

  it('the redirect it names is a request this route accepts: signing in and following it ends at the app, and the token redeems', async () => {
    const { signIn, handoff, redeem } = await arrange(undefined, { mountConsole: servedConsole });
    const { redirect } = signInTarget(await handoff(undefined, query, NAVIGATION));
    const named = new URL(redirect, ORIGIN);
    expect(named.pathname).toBe(handoffPath);

    const cookie = await signIn();
    const res = await handoff(cookie, Object.fromEntries(named.searchParams), { ...NAVIGATION, 'sec-fetch-site': 'same-origin' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.protocol).toBe(`${APP_SCHEME}:`);
    expect((await redeem(`${location.searchParams.get('token')}.${VERIFIER}`)).status).toBe(200);
  });

  it('the redirect is in the form the sign-in page matches: root-relative, one path, and stable when the page re-serializes it', async () => {
    const { handoff } = await arrange(undefined, { mountConsole: servedConsole });
    const { redirect, location } = signInTarget(await handoff(undefined, query, NAVIGATION));
    expect(redirect.startsWith('/')).toBe(true);
    expect(redirect.startsWith('//')).toBe(false);
    const parsed = new URL(redirect, ORIGIN);
    expect(parsed.origin).toBe(ORIGIN);
    expect(`${parsed.pathname}${parsed.search}`).toBe(redirect);
    // `client_id` + `redirect_uri` at the top of the query are what the sign-in
    // page reads as an OAuth authorize replay, so the app's `redirect_uri` stays
    // inside `redirect`.
    expect(new URL(location, ORIGIN).searchParams.has('redirect_uri')).toBe(false);
  });

  it('rebuilds redirect from the validated parameters and leaves code_challenge_method out when the request did', async () => {
    const { handoff } = await arrange(undefined, { mountConsole: servedConsole });
    const res = await handoff(undefined, { redirect_uri: CALLBACK, code_challenge: query.code_challenge }, NAVIGATION);
    expect(signInTarget(res).redirect).toBe(
      `${handoffPath}?${new URLSearchParams({ redirect_uri: CALLBACK, code_challenge: query.code_challenge })}`,
    );
  });

  it('stays on the origin the request arrived on while honouring uiBasePath: the canonical origin never reaches Location', async () => {
    const { handoff } = await arrange(undefined, {
      managerConfig: { baseUrl: 'https://canonical.example.com', uiBasePath: '/console/' },
      mountConsole: (app) => {
        app.get('/console/*', (c) => c.html('<!doctype html><title>Console</title>'));
      },
    });
    const res = await handoff(undefined, query, NAVIGATION);
    expect(res.status).toBe(302);
    const { location, path } = signInTarget(res);
    expect(location.startsWith('/console/login?')).toBe(true);
    expect(location).not.toContain('canonical.example.com');
    expect(path).toBe('/console/login');
  });

  it.each([
    ['Accept: application/json, the app\'s probe', { accept: 'application/json' }],
    ['no Accept and no Fetch Metadata', {}],
    ['Accept: */*', { accept: '*/*' }],
    ['a fetch asking for HTML', { accept: 'text/html', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' }],
    ['an iframe', { accept: 'text/html', 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' }],
  ])('answers %s with 401 and no redirect, with a Console mounted', async (_label, headers) => {
    const { handoff } = await arrange(undefined, { mountConsole: servedConsole });
    const res = await handoff(undefined, query, headers as Record<string, string>);
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe('UNAUTHENTICATED');
    expect(res.headers.get('location')).toBeNull();
  });

  it('a browser that sends no Fetch Metadata still counts: Accept names text/html', async () => {
    const { handoff } = await arrange(undefined, { mountConsole: servedConsole });
    const res = await handoff(undefined, query, { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' });
    expect(res.status).toBe(302);
    expect(signInTarget(res).path).toBe('/_console/login');
  });

  describe('no refusal moves behind the redirect', () => {
    it.each([
      ['an unregistered scheme', { ...query, redirect_uri: 'com.attacker.app://cb' }],
      ['a web scheme', { ...query, redirect_uri: 'https://attacker.example/cb' }],
      ['a malformed challenge', { ...query, code_challenge: 'short' }],
      ['a plain challenge method', { ...query, code_challenge_method: 'plain' }],
      ['an unknown parameter', { ...query, scope: 'x' }],
    ])('%s gets 400 and never reaches the sign-in page', async (_label, bad) => {
      const { handoff } = await arrange(undefined, { mountConsole: servedConsole });
      const res = await handoff(undefined, bad as Record<string, string>, NAVIGATION);
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.code).toBe('VALIDATION_ERROR');
      expect(res.headers.get('location')).toBeNull();
    });

    it('cross-site is judged first: it gets 400 even on a request that is otherwise invalid', async () => {
      const { handoff } = await arrange(undefined, { mountConsole: servedConsole });
      for (const q of [query, { redirect_uri: 'https://attacker.example/cb' }, { ...query, scope: 'x' }]) {
        const res = await handoff(undefined, q as Record<string, string>, { ...NAVIGATION, 'sec-fetch-site': 'cross-site' });
        expect(res.status).toBe(400);
        const { message } = ((await res.json()) as any).error;
        expect(message).toContain('cannot be opened from another site');
        expect(res.headers.get('location')).toBeNull();
      }
    });

    it('with no registered scheme there is no entry either: every target is refused', async () => {
      const { handoff } = await arrange([], { mountConsole: servedConsole });
      const res = await handoff(undefined, query, NAVIGATION);
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
    });
  });

  describe('it cannot bounce', () => {
    it('a navigation the sign-in page forwarded with a refused session gets 401, never another redirect', async () => {
      const { signIn, handoff } = await arrange(undefined, { mountConsole: servedConsole });
      const cookie = await signIn();
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS * 1000 + 1_000 });
      const forwarded = { ...NAVIGATION, 'sec-fetch-site': 'same-origin' };
      for (const session of [cookie, undefined]) {
        const res = await handoff(session, query, forwarded);
        expect(res.status).toBe(401);
        expect(((await res.json()) as any).error.code).toBe('UNAUTHENTICATED');
        expect(res.headers.get('location')).toBeNull();
      }
    });

    it('the mark on the redirect is the refusal\'s time on the server\'s clock, so the page never has to read the device\'s', async () => {
      const refusedAt = 1_900_000_000_000;
      const answer = await runOneTimeTokenHandoff(
        {
          registeredSchemes: [APP_SCHEME],
          sessionCreatedAt: async () => new Date(refusedAt - ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS * 1000 - 1),
          now: () => refusedAt,
          generate: async () => ({ token: 'never' }),
          signInEntry: async () => ({ signInPage: '/_console/login', handoff: handoffPath }),
        },
        { queries: { redirect_uri: [CALLBACK], code_challenge: [query.code_challenge] }, headers: new Headers(NAVIGATION) },
      );
      expect(answer.status).toBe(302);
      expect(new URL(answer.headers.Location, ORIGIN).searchParams.get(HANDOFF_REFUSED_AT_PARAM)).toBe(String(refusedAt));
    });
  });

  describe('a deployment with no Console keeps the 401', () => {
    it.each([
      ['no route at all (--no-ui)', undefined],
      ['the 503 answer of a Console that was not built', (app: Hono) => {
        app.get('/_console/*', (c) => c.text('The ObjectStack Console is not built', 503));
      }],
      ['a redirect elsewhere', (app: Hono) => {
        app.get('/_console/*', (c) => c.redirect('https://control-plane.example/_console/', 302));
      }],
      ['a 200 that is not a document', (app: Hono) => {
        app.get('/_console/*', (c) => c.json({ ok: true }));
      }],
    ])('%s: JSON 401, no redirect, said once', async (_label, mountConsole) => {
      const { ctx, handoff } = await arrange(undefined, { mountConsole });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = await handoff(undefined, query, NAVIGATION);
        expect(res.status).toBe(401);
        expect(((await res.json()) as any).error.code).toBe('UNAUTHENTICATED');
        expect(res.headers.get('location')).toBeNull();
      }
      const said = (ctx.logger.warn as any).mock.calls.filter(([line]: [string]) => line.includes('one-time-token/handoff'));
      expect(said).toHaveLength(1);
      expect(said[0][0]).toContain('/_console/login');
    });

    it('a uiBasePath that composes no URL refuses the same way instead of failing the request', async () => {
      const { handoff } = await arrange(undefined, { managerConfig: { uiBasePath: '_console' } });
      const res = await handoff(undefined, query, NAVIGATION);
      expect(res.status).toBe(401);
    });
  });
});

describe('isPageNavigation', () => {
  it.each<[string, Record<string, string>, boolean]>([
    ['Sec-Fetch-Dest: document', { 'sec-fetch-dest': 'document' }, true],
    ['Sec-Fetch-Dest: document with a wildcard Accept', { 'sec-fetch-dest': 'document', accept: '*/*' }, true],
    ['case and spaces in the value', { 'sec-fetch-dest': ' Document ' }, true],
    ['Sec-Fetch-Dest: empty outranks an HTML Accept', { 'sec-fetch-dest': 'empty', accept: 'text/html' }, false],
    ['Sec-Fetch-Dest: iframe', { 'sec-fetch-dest': 'iframe', accept: 'text/html' }, false],
    ['a browser with no Fetch Metadata', { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }, true],
    ['a media type with parameters', { accept: 'text/html;q=0.9' }, true],
    ['the app\'s probe', { accept: 'application/json' }, false],
    ['a wildcard', { accept: '*/*' }, false],
    ['a lookalike type', { accept: 'text/htmlx, application/text/html' }, false],
    ['no header at all', {}, false],
  ])('%s', (_label, headers, expected) => {
    expect(isPageNavigation(new Headers(headers))).toBe(expected);
  });
});

describe('resolveHandoffSignInEntry', () => {
  const source = (dispatch: (request: Request) => Response, overrides: Record<string, unknown> = {}) => ({
    signInPageUrl: 'https://canonical.example.com/_console/login',
    authBaseUrl: 'https://canonical.example.com/api/v1/auth',
    authMountPath: '/api/v1/auth',
    requestUrl: 'https://arrived-on.example.com/api/v1/auth/one-time-token/handoff?x=1',
    requestHost: 'arrived-on.example.com',
    dispatch,
    onUnserved: vi.fn(),
    ...overrides,
  });
  const documentAnswer = () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });

  it('asks the composed server about the page as this browser would reach it, carrying no credential', async () => {
    const asked: Request[] = [];
    await resolveHandoffSignInEntry(source((request) => {
      asked.push(request);
      return documentAnswer();
    }));
    expect(asked).toHaveLength(1);
    expect(asked[0].url).toBe('https://arrived-on.example.com/_console/login');
    expect(asked[0].headers.get('host')).toBe('arrived-on.example.com');
    expect(asked[0].headers.get('accept')).toBe('text/html');
    expect(asked[0].headers.get('cookie')).toBeNull();
  });

  it('answers only paths, so the canonical origin goes nowhere', async () => {
    expect(await resolveHandoffSignInEntry(source(documentAnswer))).toEqual({
      signInPage: '/_console/login',
      handoff: `/api/v1/auth${ONE_TIME_TOKEN_HANDOFF_PATH}`,
    });
  });

  it('a base path in baseUrl stays in what the browser is told and out of what this process is asked', async () => {
    const asked: string[] = [];
    const entry = await resolveHandoffSignInEntry(source(
      (request) => {
        asked.push(new URL(request.url).pathname);
        return documentAnswer();
      },
      {
        signInPageUrl: 'https://canonical.example.com/erp/_console/login',
        authBaseUrl: 'https://canonical.example.com/erp/api/v1/auth',
      },
    ));
    expect(entry).toEqual({ signInPage: '/erp/_console/login', handoff: `/erp/api/v1/auth${ONE_TIME_TOKEN_HANDOFF_PATH}` });
    expect(asked).toEqual(['/_console/login']);
  });

  it('a configured trailing slash on the auth base does not double in the path', async () => {
    const entry = await resolveHandoffSignInEntry(source(documentAnswer, {
      authBaseUrl: 'https://canonical.example.com/api/v1/auth/',
    }));
    expect(entry?.handoff).toBe(`/api/v1/auth${ONE_TIME_TOKEN_HANDOFF_PATH}`);
  });

  it('says why when the page is not served', async () => {
    const inputs = source(() => new Response('gone', { status: 404 }));
    expect(await resolveHandoffSignInEntry(inputs)).toBeNull();
    expect(inputs.onUnserved).toHaveBeenCalledWith('/_console/login', 'it answers 404');
  });

  it('a server that throws when asked is a page it does not serve, not a failed hand-off', async () => {
    const inputs = source(() => {
      throw new Error('boom');
    });
    expect(await resolveHandoffSignInEntry(inputs)).toBeNull();
    expect(inputs.onUnserved).toHaveBeenCalledWith('/_console/login', 'asking for it threw: boom');
  });
});

describe('one-time-token hand-off — the request is validated before anything is minted', () => {
  const generate = vi.fn(async () => ({ token: 'never' }));
  const signInEntry = vi.fn(async () => ({ signInPage: '/_console/login', handoff: `${BASE}${ONE_TIME_TOKEN_HANDOFF_PATH}` }));
  const deps = { registeredSchemes: [APP_SCHEME], sessionCreatedAt: async () => new Date(), generate, signInEntry };
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
    expect(signInEntry).not.toHaveBeenCalled();
  });
});

describe('trustedAppSchemes — refused at construction, never dropped', () => {
  it.each([
    ['https'], ['HTTPS'], ['javascript'], ['data'],
    ['Com.Example.App'], ['com.example.app://'], ['com.example.app:'], ['myapp'], ['com..app'], ['com.example.'], [''], [42],
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
