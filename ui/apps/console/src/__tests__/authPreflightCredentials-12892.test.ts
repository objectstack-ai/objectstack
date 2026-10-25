/**
 * objectui#12892 — the boot preflight's `get-session` carries the cookie.
 *
 * Past better-auth's `updateAge` that read renews the session and re-issues the
 * cookie in `Set-Cookie`. With `credentials: 'omit'` the browser never stored
 * it, so the session row outlived the cookie. The browser's half (a response
 * cookie is stored under `include`, dropped under `omit`) is the Fetch spec's
 * and is not re-modelled here: these pins hold the request the preflight sends,
 * and that the stale-token check survives the cookie riding along.
 *
 * The stale case runs the REAL preflight against a stub server that models the
 * one server fact the check leans on: better-auth's `bearer()` plugin writes the
 * Bearer's token over the request's session cookie, so a request carrying both
 * is judged by the Bearer. The stub's cookie jar holds a LIVE session, and is
 * only "sent" when the request says `credentials: 'include'`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { preflightAuth } from '../lib/auth-preflight';

const AUTH_URL = '/api/v1/auth';
const SLOT = Symbol.for('objectui.authPreflightSession');
const ORG_KEY = 'auth-active-organization-id:u:u_old';

const LIVE_COOKIE_SESSION = {
  user: { id: 'u_cookie', name: 'Grace' },
  session: { id: 's_cookie', userId: 'u_cookie', token: 'tok_cookie' },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The server model: Bearer first (better-auth `bearer()` overwrites the
 * request's session cookie with the Bearer's token), the cookie only when no
 * Bearer is sent. `tok_stale` names a session that no longer exists.
 */
function serverAnswer(init: RequestInit | undefined): unknown {
  const headers = new Headers(init?.headers);
  const auth = headers.get('authorization');
  const cookieSent = init?.credentials === 'include';
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7) === 'tok_stale' ? null : { user: { id: 'u_bearer' }, session: { token: auth.slice(7) } };
  }
  return cookieSent ? LIVE_COOKIE_SESSION : null;
}

const fetchStub = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => json(serverAnswer(init)));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  fetchStub.mockClear();
  localStorage.clear();
  delete (globalThis as unknown as Record<symbol, unknown>)[SLOT];
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete (globalThis as unknown as Record<symbol, unknown>)[SLOT];
});

describe('the boot preflight carries the cookie (objectui#12892)', () => {
  it('sends get-session with credentials include and the Bearer header', async () => {
    localStorage.setItem('auth-session-token', 'tok_live');

    await preflightAuth(AUTH_URL);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe(`${AUTH_URL}/get-session`);
    expect(init?.credentials).toBe('include');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer tok_live');
    expect(headers.get('accept')).toBe('application/json');
  });

  it('a stale Bearer beside a live cookie is still judged stale and purged', async () => {
    // The model's cookie is live: without a Bearer, the same request shape
    // answers a session. So the null below comes from the Bearer, not from an
    // empty jar.
    expect(serverAnswer({ credentials: 'include' })).toEqual(LIVE_COOKIE_SESSION);

    localStorage.setItem('auth-session-token', 'tok_stale');
    localStorage.setItem(ORG_KEY, 'org_old');

    await preflightAuth(AUTH_URL);

    expect(fetchStub.mock.calls[0]![1]?.credentials).toBe('include');
    expect(localStorage.getItem('auth-session-token')).toBeNull();
    expect(localStorage.getItem(ORG_KEY)).toBeNull();
    expect((globalThis as unknown as Record<symbol, unknown>)[SLOT]).toBeUndefined();
  });

  it('CONTROL: with no stored token nothing is sent and nothing is purged', async () => {
    localStorage.setItem(ORG_KEY, 'org_kept');

    await preflightAuth(AUTH_URL);

    expect(fetchStub).not.toHaveBeenCalled();
    expect(localStorage.getItem(ORG_KEY)).toBe('org_kept');
    expect((globalThis as unknown as Record<symbol, unknown>)[SLOT]).toBeUndefined();
  });
});
