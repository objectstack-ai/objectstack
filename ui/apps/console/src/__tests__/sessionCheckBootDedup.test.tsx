/**
 * objectstack#29118 — the boot's `get-session` starts at parse time, beside
 * `runtime/config`, and the preflight reads that answer.
 *
 * The card measured `auth/get-session` leaving ~100–150 ms after
 * `runtime/config` on staging: `runtime/config` is sent by `index.html`'s inline
 * script during parse, while the session check waited in `preflightAuth()` for
 * the main bundle to download and evaluate. The inline `startEarlySessionCheck`
 * script now sends the preflight's exact request during parse and hands the
 * pending answer over; the preflight takes it once instead of asking again.
 *
 * These grade THE SHIPPED ARTIFACT, as `runtimeConfigBootDedup.test.ts` does:
 * the inline scripts are extracted from `index.html` and executed, then the REAL
 * `preflightAuth()` (and, end to end, the REAL `AuthProvider`) run over one
 * stubbed `fetch`, so every count is of requests that would reach the wire and
 * the slot the two sides spell by hand is exercised from both ends.
 */

import React, { useLayoutEffect } from 'react';
import indexHtml from '../../index.html?raw';
import mainSource from '../main.tsx?raw';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { AuthGuard, AuthProvider, useAuth } from '@object-ui/auth';
import { preflightAuth } from '../lib/auth-preflight';
import { readConsoleDiscovery } from '../lib/early-discovery';
import { getSharedDiscovery } from '@object-ui/data-objectstack';
import { clearSharedDiscoveryCache } from '../../../../packages/data-objectstack/src/sharedDiscovery';

const TOKEN = 'tok_valid';
const EARLY_SLOT = Symbol.for('objectui.earlySessionCheck');
const PREFLIGHT_SLOT = Symbol.for('objectui.authPreflightSession');
const RUNTIME_SLOT = Symbol.for('objectui.earlyRuntimeConfig');

const SESSION_BODY = {
  user: { id: 'u_1', name: 'Ada', email: 'ada@example.test' },
  session: { id: 's_1', userId: 'u_1', token: TOKEN, expiresAt: '2099-01-01T00:00:00.000Z' },
};

/** Every inline classic script body in document order, comments removed. */
function inlineScripts(html: string): string[] {
  return [
    ...html
      // Comments first — prose describing a script tag parses as one.
      .replace(/<!--[\s\S]*?-->/g, '')
      .matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ].map((match) => match[1] ?? '');
}

/** One inline script, found by its IIFE's name — renaming it fails here. */
function extractScript(marker: string, html: string = indexHtml): string {
  const found = inlineScripts(html).filter((body) => body.includes(marker));
  if (found.length !== 1) {
    throw new Error(`expected exactly 1 inline ${marker} script in index.html, found ${found.length}`);
  }
  return found[0]!;
}

/** Run a shipped parse-time script, as the browser would. */
function runScript(marker: string, html: string = indexHtml): void {
  new Function(extractScript(marker, html))();
}
const runEarlySessionCheck = (html?: string) => runScript('startEarlySessionCheck', html);

/** Vite's `%ENV%` HTML substitution, as `htmlEnvHook` performs it. */
function applyViteHtmlEnv(html: string, env: Record<string, string>): string {
  return html.replace(/%(\S+?)%/g, (text, key: string) => (key in env ? env[key]! : text));
}

/** `src/main.tsx`'s `AUTH_URL`, for a given `VITE_SERVER_URL`. */
const authUrlFor = (server?: string) => `${server || ''}/api/v1/auth`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

let sessionAnswer: () => Response | Promise<Response> = () => json(SESSION_BODY);
const fetchStub = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
  const url = urlOf(input);
  if (url.includes('/get-session')) return sessionAnswer();
  if (url.includes('/runtime/config')) return json({ branding: {} });
  if (url.includes('/organization/')) return json([]);
  return json(null);
});

function sessionCalls() {
  return fetchStub.mock.calls.filter(([input]) => urlOf(input).includes('/get-session'));
}

/** Let the parse-time request settle, as it often does before the bundle asks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function clearSlots(): void {
  const holder = globalThis as unknown as Record<symbol, unknown>;
  delete holder[EARLY_SLOT];
  delete holder[PREFLIGHT_SLOT];
  delete holder[RUNTIME_SLOT];
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  fetchStub.mockClear();
  sessionAnswer = () => json(SESSION_BODY);
  localStorage.clear();
  clearSlots();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  clearSlots();
});

describe('the shipped parse-time session check is findable', () => {
  it('is exactly one inline classic script in index.html', () => {
    const source = extractScript('startEarlySessionCheck');
    expect(source).toContain('/get-session');
    expect(source).toContain("Symbol.for('objectui.earlySessionCheck')");
    expect(source).toContain('%VITE_SERVER_URL%');
  });

  it('fails loudly if the script is gone rather than passing vacuously', () => {
    expect(() => extractScript('startEarlySessionCheck', '<html></html>')).toThrow(/found 0/);
  });

  it('spells the auth URL as main.tsx does, and main.tsx hands it to the preflight', () => {
    // The handoff keys on the full URL. The script copies this formula through
    // Vite's HTML substitution; a different spelling here would split the two
    // callers on a split-origin dev server and silently restore the second ask.
    expect(mainSource).toContain("const AUTH_URL = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;");
    expect(mainSource).toContain('preflightAuth(AUTH_URL)');
  });
});

describe('one page load, one get-session, started at parse time', () => {
  it('starts in the same parse pass as runtime/config, before any bundle code runs', () => {
    localStorage.setItem('auth-session-token', TOKEN);

    // The two parse-time scripts, in document order, and nothing else: no
    // microtask, no module chunk.
    runScript('applyEarlyBranding');
    runEarlySessionCheck();

    const urls = fetchStub.mock.calls.map(([input]) => urlOf(input));
    expect(urls).toEqual(['/api/v1/runtime/config', '/api/v1/auth/get-session']);
  });

  it('the preflight reads the parse-time answer instead of asking again', async () => {
    localStorage.setItem('auth-session-token', TOKEN);

    runEarlySessionCheck();
    expect(sessionCalls()).toHaveLength(1);
    // `main.tsx` awaits the preflight once the bundle has evaluated.
    await preflightAuth(authUrlFor());

    expect(sessionCalls()).toHaveLength(1);
    // The answer still reached AuthProvider's slot, as the preflight's own did.
    const slot = (globalThis as unknown as Record<symbol, { token: string; body: string }>)[PREFLIGHT_SLOT];
    expect(slot?.token).toBe(TOKEN);
    expect(JSON.parse(slot!.body).user.name).toBe('Ada');
    expect(localStorage.getItem('auth-session-token')).toBe(TOKEN);
  });

  it('reads it after it settled, too — the bundle usually arrives later', async () => {
    localStorage.setItem('auth-session-token', TOKEN);

    runEarlySessionCheck();
    await settle();
    await preflightAuth(authUrlFor());

    expect(sessionCalls()).toHaveLength(1);
    expect((globalThis as unknown as Record<symbol, unknown>)[PREFLIGHT_SLOT]).toBeTruthy();
  });

  it('asks exactly what the preflight would ask: URL, Bearer, cookie and Accept', async () => {
    localStorage.setItem('auth-session-token', TOKEN);
    runEarlySessionCheck();
    const [earlyUrl, earlyInit] = sessionCalls()[0]!;

    // CONTROL leg: the preflight alone, on a page without the script.
    clearSlots();
    fetchStub.mockClear();
    await preflightAuth(authUrlFor());
    const [ownUrl, ownInit] = sessionCalls()[0]!;

    expect(earlyUrl).toBe(ownUrl);
    expect(earlyInit?.method).toBe(ownInit?.method);
    expect(earlyInit?.credentials).toBe('include');
    expect(earlyInit?.credentials).toBe(ownInit?.credentials);
    const early = new Headers(earlyInit?.headers);
    const own = new Headers(ownInit?.headers);
    expect(early.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect([...early.entries()]).toEqual([...own.entries()]);
  });

  it('end to end: parse-time script, preflight and AuthProvider ask once', async () => {
    localStorage.setItem('auth-session-token', TOKEN);

    runEarlySessionCheck();
    await preflightAuth(authUrlFor());

    const probe: { current: ReturnType<typeof useAuth> | null } = { current: null };
    function Probe() {
      const value = useAuth();
      useLayoutEffect(() => {
        probe.current = value;
      });
      return <span>{value.isLoading ? 'loading' : value.user?.name ?? 'nobody'}</span>;
    }
    render(
      <React.StrictMode>
        <AuthProvider authUrl={authUrlFor()}>
          <Probe />
        </AuthProvider>
      </React.StrictMode>,
    );
    expect(await screen.findByText('Ada')).toBeTruthy();
    await act(async () => { await settle(); });

    expect(sessionCalls()).toHaveLength(1);
    expect(probe.current?.isAuthenticated).toBe(true);
  });
});

describe('every safety of the preflight is kept', () => {
  it('blocked storage: no parse-time request, and the script does not throw', () => {
    // Blocked storage throws on access. Spied on the window's accessor: this
    // test environment's `localStorage` does not reach `Storage.prototype`,
    // and a read answering `null` is the no-token case, which now asks the
    // cookie session's question (objectstack#35455).
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => window.localStorage.getItem('auth-session-token')).toThrow();
    expect(() => runEarlySessionCheck()).not.toThrow();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('a non-OK parse-time answer is not reused: the preflight fetches once itself', async () => {
    localStorage.setItem('auth-session-token', TOKEN);
    sessionAnswer = () => json(null, 503);

    runEarlySessionCheck();
    await settle();
    sessionAnswer = () => json(SESSION_BODY);
    await preflightAuth(authUrlFor());

    expect(sessionCalls()).toHaveLength(2);
    // The preflight's own answer decided: the token is kept and handed on.
    expect(localStorage.getItem('auth-session-token')).toBe(TOKEN);
    expect((globalThis as unknown as Record<symbol, unknown>)[PREFLIGHT_SLOT]).toBeTruthy();
  });

  it('a failed (network) parse-time request is not reused: the preflight fetches once itself', async () => {
    localStorage.setItem('auth-session-token', TOKEN);
    sessionAnswer = () => Promise.reject(new TypeError('Failed to fetch'));

    runEarlySessionCheck();
    await settle();
    sessionAnswer = () => json(SESSION_BODY);
    await preflightAuth(authUrlFor());

    expect(sessionCalls()).toHaveLength(2);
    expect((globalThis as unknown as Record<symbol, unknown>)[PREFLIGHT_SLOT]).toBeTruthy();
  });

  it('a stale token answered at parse time is purged by the preflight, with no second ask', async () => {
    localStorage.setItem('auth-session-token', 'tok_stale');
    localStorage.setItem('auth-active-organization-id:u:u_old', 'org_1');
    // better-auth answers an unknown session 200 with a null body.
    sessionAnswer = () => json(null);

    runEarlySessionCheck();
    await preflightAuth(authUrlFor());

    expect(sessionCalls()).toHaveLength(1);
    expect(localStorage.getItem('auth-session-token')).toBeNull();
    expect(localStorage.getItem('auth-active-organization-id:u:u_old')).toBeNull();
    expect((globalThis as unknown as Record<symbol, unknown>)[PREFLIGHT_SLOT]).toBeUndefined();
  });

  it('a token that changed since parse time is not answered by the old request', async () => {
    localStorage.setItem('auth-session-token', 'tok_old');
    runEarlySessionCheck();
    localStorage.setItem('auth-session-token', TOKEN);

    await preflightAuth(authUrlFor());

    expect(sessionCalls()).toHaveLength(2);
    expect(new Headers(sessionCalls()[1]![1]?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('the answer is taken once: a second preflight asks the server', async () => {
    localStorage.setItem('auth-session-token', TOKEN);
    runEarlySessionCheck();
    await preflightAuth(authUrlFor());
    await preflightAuth(authUrlFor());

    expect(sessionCalls()).toHaveLength(2);
  });
});

/**
 * objectstack#35455 — with no stored Bearer (a cookie session, the hosted
 * posture's first visit) `get-session` was asked by `AuthProvider` after the
 * mount, so it waited on the language seed's race. The parse-time script now
 * asks the cookie session's question and the preflight hands the answer on.
 */
describe('no stored token: the cookie session is asked at parse time and handed on', () => {
  /** AuthProvider, read through a probe, behind the same gate a protected route uses. */
  function renderApp() {
    const probe: { current: ReturnType<typeof useAuth> | null } = { current: null };
    function Probe() {
      const value = useAuth();
      useLayoutEffect(() => {
        probe.current = value;
      });
      return <span>{value.isLoading ? 'loading' : value.user?.name ?? 'nobody'}</span>;
    }
    render(
      <React.StrictMode>
        <AuthProvider authUrl={authUrlFor()}>
          <Probe />
          <AuthGuard fallback={<span>sign-in</span>} loadingFallback={<span>guard-waits</span>}>
            <span>protected</span>
          </AuthGuard>
        </AuthProvider>
      </React.StrictMode>,
    );
    return probe;
  }

  it('sends the cookie question in the same parse pass, with no Authorization header', () => {
    runScript('applyEarlyBranding');
    runEarlySessionCheck();

    const urls = fetchStub.mock.calls.map(([input]) => urlOf(input));
    expect(urls).toEqual(['/api/v1/runtime/config', '/api/v1/auth/get-session']);
    const [, init] = sessionCalls()[0]!;
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it('asks exactly what the preflight would ask without a token', async () => {
    runEarlySessionCheck();
    const [earlyUrl, earlyInit] = sessionCalls()[0]!;

    // CONTROL leg: the preflight alone, on a page without the script.
    clearSlots();
    fetchStub.mockClear();
    await preflightAuth(authUrlFor());
    const [ownUrl, ownInit] = sessionCalls()[0]!;

    expect(earlyUrl).toBe(ownUrl);
    expect(earlyInit?.credentials).toBe(ownInit?.credentials);
    expect([...new Headers(earlyInit?.headers).entries()]).toEqual([...new Headers(ownInit?.headers).entries()]);
  });

  it('end to end: one get-session, signed in, and the protected route renders with the session', async () => {
    runEarlySessionCheck();
    await preflightAuth(authUrlFor());
    const probe = renderApp();

    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(screen.getByText('protected')).toBeTruthy();
    await act(async () => { await settle(); });

    expect(sessionCalls()).toHaveLength(1);
    expect(probe.current?.isAuthenticated).toBe(true);
    // The answer's token is synced exactly as `getSession()` syncs it.
    expect(localStorage.getItem('auth-session-token')).toBe(TOKEN);
  });

  it('a signed-out answer is handed on too: still one get-session, and the sign-in fallback', async () => {
    // better-auth answers "no session" 200 with a null body.
    sessionAnswer = () => json(null);
    runEarlySessionCheck();
    await preflightAuth(authUrlFor());
    const probe = renderApp();

    expect(await screen.findByText('sign-in')).toBeTruthy();
    await act(async () => { await settle(); });

    expect(sessionCalls()).toHaveLength(1);
    expect(probe.current?.isLoading).toBe(false);
    expect(probe.current?.user).toBeNull();
  });

  it('CONTROL: a non-OK answer hands nothing on, and the protected route waits for AuthProvider\'s own read', async () => {
    sessionAnswer = () => json(null, 503);
    runEarlySessionCheck();
    await settle();
    // The preflight asks once itself and gets the 503 too.
    await preflightAuth(authUrlFor());
    expect((globalThis as unknown as Record<symbol, unknown>)[PREFLIGHT_SLOT]).toBeUndefined();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    sessionAnswer = () => gate.then(() => json(SESSION_BODY));
    renderApp();
    expect(screen.getByText('guard-waits')).toBeTruthy();
    expect(screen.queryByText('protected')).toBeNull();

    await act(async () => { release(); await settle(); });
    expect(await screen.findByText('protected')).toBeTruthy();
    // Parse time and the preflight answered 503; AuthProvider asked itself.
    expect(sessionCalls().length).toBeGreaterThanOrEqual(3);
  });

  it('CONTROL: a token stored since the cookie question was asked is not answered by it', async () => {
    runEarlySessionCheck();
    await preflightAuth(authUrlFor());
    localStorage.setItem('auth-session-token', TOKEN);

    renderApp();
    expect(await screen.findByText('Ada')).toBeTruthy();
    await act(async () => { await settle(); });

    // The handed-on answer belonged to the cookie question; AuthProvider asked
    // itself, with the token now stored.
    const calls = sessionCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(new Headers(calls[0]![1]?.headers).has('authorization')).toBe(false);
    expect(new Headers(calls[calls.length - 1]![1]?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });
});

describe('one page, one server origin', () => {
  const SERVER = 'https://api.example.test';

  it('sends the parse-time request to VITE_SERVER_URL, so the preflight joins it', async () => {
    localStorage.setItem('auth-session-token', TOKEN);

    runEarlySessionCheck(applyViteHtmlEnv(indexHtml, { VITE_SERVER_URL: SERVER }));
    await preflightAuth(authUrlFor(SERVER));

    expect(sessionCalls()).toHaveLength(1);
    expect(sessionCalls()[0]![0]).toBe(`${SERVER}/api/v1/auth/get-session`);
  });

  it('agrees with main.tsx on a trailing slash too, whatever the spelling', async () => {
    localStorage.setItem('auth-session-token', TOKEN);

    runEarlySessionCheck(applyViteHtmlEnv(indexHtml, { VITE_SERVER_URL: `${SERVER}/` }));
    await preflightAuth(authUrlFor(`${SERVER}/`));

    expect(sessionCalls()).toHaveLength(1);
  });

  it('falls back to same-origin when the variable is unset, never to the raw token', () => {
    localStorage.setItem('auth-session-token', TOKEN);
    const productionHtml = applyViteHtmlEnv(indexHtml, {});
    expect(extractScript('startEarlySessionCheck', productionHtml)).toContain('%VITE_SERVER_URL%');

    runEarlySessionCheck(productionHtml);

    expect(sessionCalls()[0]![0]).toBe('/api/v1/auth/get-session');
  });
});

describe('discovery starts at parse time beside get-session, and the console reads that request (objectstack#34211)', () => {
  const DISCOVERY_SLOT = Symbol.for('objectui.earlyDiscovery');
  const SERVER = 'https://api.example.test';
  const discoveryCalls = () => fetchStub.mock.calls.filter(([input]) => urlOf(input).includes('/discovery'));

  beforeEach(() => {
    clearSharedDiscoveryCache();
    delete (globalThis as unknown as Record<symbol, unknown>)[DISCOVERY_SLOT];
  });
  afterEach(() => {
    clearSharedDiscoveryCache();
    delete (globalThis as unknown as Record<symbol, unknown>)[DISCOVERY_SLOT];
  });

  it('is sent in the same parse pass as get-session, before any bundle code runs', () => {
    localStorage.setItem('auth-session-token', TOKEN);
    runScript('applyEarlyBranding');
    runEarlySessionCheck();
    runScript('startEarlyDiscovery');

    const urls = fetchStub.mock.calls.map(([input]) => urlOf(input));
    expect(urls).toEqual(['/api/v1/runtime/config', '/api/v1/auth/get-session', '/api/v1/discovery']);
  });

  it('main.tsx starts the console reader on every boot, over the same server base', () => {
    expect(mainSource).toContain('void readConsoleDiscovery(SERVER_BASE)');
  });

  it("the console reader takes the parse-time request, and the adapter's connect joins it: one discovery per load", async () => {
    runScript('startEarlyDiscovery', applyViteHtmlEnv(indexHtml, { VITE_SERVER_URL: SERVER }));
    await settle();

    const consoleRead = readConsoleDiscovery(SERVER);
    // `ObjectStackAdapter.connect()` asks the same shared cache with a fetcher of its own.
    const adapterFetcher = vi.fn(async () => ({ from: 'adapter' }));
    const adapterRead = getSharedDiscovery(SERVER, adapterFetcher);

    expect(await consoleRead).toBeNull();
    expect(await adapterRead).toBeNull();
    expect(adapterFetcher).not.toHaveBeenCalled();
    expect(discoveryCalls()).toHaveLength(1);
    expect(discoveryCalls()[0]![0]).toBe(`${SERVER}/api/v1/discovery`);
  });

  const authOf = (call: unknown[]) => new Headers((call[1] as RequestInit | undefined)?.headers).get('Authorization');

  it('carries the stored Bearer, in the parse-time request and in the reader\'s own, and none without one', async () => {
    localStorage.setItem('auth-session-token', TOKEN);
    runScript('startEarlyDiscovery');
    expect(authOf(discoveryCalls()[0]!)).toBe(`Bearer ${TOKEN}`);
    await readConsoleDiscovery('');
    expect(discoveryCalls()).toHaveLength(1);

    // The reader's own request: no slot left to take.
    clearSharedDiscoveryCache();
    delete (globalThis as unknown as Record<symbol, unknown>)[DISCOVERY_SLOT];
    await readConsoleDiscovery('');
    expect(discoveryCalls()).toHaveLength(2);
    expect(authOf(discoveryCalls()[1]!)).toBe(`Bearer ${TOKEN}`);

    localStorage.clear();
    clearSharedDiscoveryCache();
    runScript('startEarlyDiscovery');
    await readConsoleDiscovery('');
    expect(discoveryCalls()).toHaveLength(3);
    expect(authOf(discoveryCalls()[2]!)).toBeNull();
  });

  it('a parse-time request sent with a token the preflight has since purged is not taken', async () => {
    localStorage.setItem('auth-session-token', 'tok_stale');
    runScript('startEarlyDiscovery');
    localStorage.removeItem('auth-session-token');

    await readConsoleDiscovery('');

    expect(discoveryCalls()).toHaveLength(2);
    expect(authOf(discoveryCalls()[1]!)).toBeNull();
  });

  it('a parse-time request that never answers rejects as a timeout within the 10 s bound, and is not asked again', async () => {
    vi.useFakeTimers();
    try {
      (globalThis as unknown as Record<symbol, unknown>)[DISCOVERY_SLOT] = {
        url: '/api/v1/discovery',
        token: '',
        body: new Promise(() => {}),
      };
      const read = readConsoleDiscovery('');
      const outcome = read.then(() => 'answered', (err: Error) => err.message);
      await vi.advanceTimersByTimeAsync(9_999);
      let settled = false;
      void outcome.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toBe('discovery timeout');
      expect(discoveryCalls()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the parse-time request itself is aborted at 10 s and hands over a timeout', async () => {
    vi.useFakeTimers();
    try {
      fetchStub.mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      );
      runScript('startEarlyDiscovery');
      const slot = (globalThis as unknown as Record<symbol, { body: Promise<unknown> }>)[DISCOVERY_SLOT]!;
      const outcome = slot.body.then(() => 'answered', (err: Error) => err.message);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await outcome).toBe('discovery timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed parse-time request is not reused: the reader asks the server itself', async () => {
    fetchStub.mockImplementationOnce(async () => json({ error: 'boom' }, 503));
    runScript('startEarlyDiscovery');
    await settle();

    await readConsoleDiscovery('');

    expect(discoveryCalls()).toHaveLength(2);
  });
});
