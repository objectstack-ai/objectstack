/**
 * Sign-out follows the provider-logout redirect better-auth answers (#26618).
 *
 * better-auth's `POST /sign-out` ends the local session and, for a user linked
 * through a provider that can end its own session (an OIDC provider with an
 * `end_session_endpoint`), answers `{ success: true, url, redirect: true }`.
 * The client is built with `disableDefaultFetchPlugins: true`, which drops
 * better-auth's `redirectPlugin`, so before this the answer was ignored: the
 * environment session ended, the provider session survived, and the next
 * "continue with" on the same browser signed straight back in as the user who
 * had just signed out.
 *
 * Pinned here:
 *  - sign-out sends `callbackURL` = this SPA's own sign-in page (under the
 *    `<base href>` basename), which better-auth hands the provider as its
 *    `post_logout_redirect_uri`;
 *  - a `{ redirect: true, url }` answer with an http(s) URL navigates the
 *    window there, after the bearer token is cleared;
 *  - any other answer does not navigate, so a deployment without a provider
 *    keeps its in-app route to the sign-in page;
 *  - through `AuthProvider`, the state reset and the cache purge have run by
 *    the time `signOut()` resolves, alongside the navigation.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, cleanup } from '@testing-library/react';
import { createAuthClient, TokenStorage } from '../createAuthClient';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import type { AuthClient } from '../types';
import type { AuthContextValue } from '../AuthContext';

const END_SESSION_URL =
  'https://cloud.example.com/api/v1/auth/oauth2/end-session?id_token_hint=eyJ.hint&post_logout_redirect_uri=https%3A%2F%2Fenv.example.com%2F_console%2Flogin';

/** A fetch double that answers `/sign-out` with `answer` and records each body. */
function signOutFetch(answer: unknown, status = 200) {
  const bodies: Array<Record<string, unknown> | null> = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes('/sign-out')) {
      return new Response(JSON.stringify({ message: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
    return new Response(JSON.stringify(answer), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchFn, bodies };
}

let originalLocation: Location;
let assignSpy: ReturnType<typeof vi.fn>;
/** `TokenStorage.get()` read at the moment the navigation starts. */
let tokenAtAssign: Array<string | null>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  TokenStorage.clear();
  document.head.querySelectorAll('base').forEach((el) => el.remove());
  tokenAtAssign = [];
  originalLocation = window.location;
  assignSpy = vi.fn(() => {
    tokenAtAssign.push(TokenStorage.get());
  });
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...originalLocation, origin: 'https://env.example.com', assign: assignSpy } as unknown as Location,
  });
});

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('base').forEach((el) => el.remove());
  Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
  vi.restoreAllMocks();
});

function setBaseHref(href: string) {
  const base = document.createElement('base');
  base.setAttribute('href', href);
  document.head.appendChild(base);
}

describe('createAuthClient.signOut follows the provider-logout redirect (#26618)', () => {
  it('navigates to the answered url after clearing the token, and sends callbackURL = <basename>/login', async () => {
    setBaseHref('/_console/');
    TokenStorage.set('tok-alice');
    const { fetchFn, bodies } = signOutFetch({ success: true, url: END_SESSION_URL, redirect: true });
    const client = createAuthClient({ baseURL: '/api/v1/auth', fetchFn });

    await client.signOut();

    expect(bodies).toEqual([{ callbackURL: '/_console/login' }]);
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(assignSpy).toHaveBeenCalledWith(END_SESSION_URL);
    expect(tokenAtAssign).toEqual([null]);
  });

  it('sends callbackURL = /login for a SPA at the origin root', async () => {
    const { fetchFn, bodies } = signOutFetch({ success: true });
    const client = createAuthClient({ baseURL: '/api/v1/auth', fetchFn });

    await client.signOut();

    expect(bodies).toEqual([{ callbackURL: '/login' }]);
  });

  it('does not navigate when the answer carries no provider logout', async () => {
    setBaseHref('/_console/');
    TokenStorage.set('tok-alice');
    const { fetchFn } = signOutFetch({ success: true });
    const client = createAuthClient({ baseURL: '/api/v1/auth', fetchFn });

    await client.signOut();

    expect(assignSpy).not.toHaveBeenCalled();
    expect(TokenStorage.get()).toBeNull();
  });

  it.each([
    ['redirect is not true', { success: true, url: END_SESSION_URL, redirect: false }],
    ['redirect is a string', { success: true, url: END_SESSION_URL, redirect: 'true' }],
    ['the url is javascript:', { success: true, url: 'javascript:alert(1)', redirect: true }],
    ['the url is data:', { success: true, url: 'data:text/html,hi', redirect: true }],
    ['the url is relative', { success: true, url: '/elsewhere', redirect: true }],
    ['the url is not a string', { success: true, url: 42, redirect: true }],
  ])('does not navigate when %s', async (_label, answer) => {
    const { fetchFn } = signOutFetch(answer);
    const client = createAuthClient({ baseURL: '/api/v1/auth', fetchFn });

    await client.signOut();

    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('does not navigate on a failed sign-out, and still clears the token', async () => {
    TokenStorage.set('tok-alice');
    const { fetchFn } = signOutFetch({ message: 'boom', url: END_SESSION_URL, redirect: true }, 500);
    const client = createAuthClient({ baseURL: '/api/v1/auth', fetchFn });

    await expect(client.signOut()).rejects.toThrow('boom');

    expect(assignSpy).not.toHaveBeenCalled();
    expect(TokenStorage.get()).toBeNull();
  });
});

const authRef: { current: AuthContextValue | null } = { current: null };

function Probe() {
  const auth = useAuth();
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);
  return <span data-testid="user">{auth.user?.name ?? 'none'}</span>;
}

describe('AuthProvider.signOut with a provider-logout answer (#26618)', () => {
  it('resets the session and purges the tab caches, and the window follows the provider', async () => {
    setBaseHref('/_console/');
    const { fetchFn } = signOutFetch({ success: true, url: END_SESSION_URL, redirect: true });
    // The real client's `signOut` (it reads no `this`), with the boot reads
    // answered by doubles — the same one-place cast as the other provider tests.
    const real = createAuthClient({ baseURL: '/api/v1/auth', fetchFn });
    const client = {
      signOut: real.signOut,
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'u_alice', name: 'Alice', email: 'alice@test.com' },
        session: { token: 'tok-alice' },
      }),
      listOrganizations: vi.fn().mockResolvedValue([]),
      getActiveOrganization: vi.fn().mockResolvedValue(null),
    } as unknown as AuthClient;

    const view = render(
      <AuthProvider authUrl="/api/v1/auth" client={client}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(view.getByTestId('user').textContent).toBe('Alice'));
    sessionStorage.setItem('objectui:metadata:app:org_a:abc', JSON.stringify([{ name: 'crm' }]));

    await act(async () => {
      await authRef.current!.signOut();
    });

    expect(assignSpy).toHaveBeenCalledWith(END_SESSION_URL);
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('objectui:metadata:'))).toEqual([]);
    expect(view.getByTestId('user').textContent).toBe('none');
    expect(authRef.current!.error).toBeNull();
  });
});
