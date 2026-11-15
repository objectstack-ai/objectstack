/**
 * An explicit sign-out that leaves through the identity provider's logout is
 * still an explicit sign-out when the provider brings the tab back
 * (objectstack#33183, the maintainer's ruling 6879236460: after an explicit
 * sign-out the sign-in page stays, with a button to sign in again).
 *
 * `AuthProvider` keeps "ended by sign-out" in React state, which a full page
 * load does not keep. The tab's note (`../signOutRoundTrip`) carries it:
 *  - `createAuthClient.signOut` writes it just before following a
 *    provider-logout URL, and only then;
 *  - the sign-out purge that runs before the page unloads keeps it;
 *  - the first `AuthProvider` mount after the round trip starts with
 *    `sessionEndedBySignOut: true`, and drops the note, so it is read once;
 *  - a note older than the round trip's window is a fresh visit.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, cleanup } from '@testing-library/react';
import { createAuthClient, TokenStorage } from '../createAuthClient';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import type { AuthClient } from '../types';
import type { AuthContextValue } from '../AuthContext';
import {
  SIGN_OUT_ROUND_TRIP_KEY,
  SIGN_OUT_ROUND_TRIP_MAX_AGE_MS,
  markSignOutRoundTrip,
  readSignOutRoundTrip,
} from '../signOutRoundTrip';

const END_SESSION_URL =
  'https://idp.example.com/end-session?post_logout_redirect_uri=https%3A%2F%2Fenv.example.com%2Flogin';

function signOutFetch(answer: unknown, status = 200) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes('/sign-out')) {
      return new Response(JSON.stringify({ message: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } });
  });
}

let originalLocation: Location;
let assignSpy: ReturnType<typeof vi.fn>;
/** Whether the note was already written when the navigation started. */
let noteAtAssign: Array<string | null>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  TokenStorage.clear();
  noteAtAssign = [];
  originalLocation = window.location;
  assignSpy = vi.fn(() => {
    noteAtAssign.push(sessionStorage.getItem(SIGN_OUT_ROUND_TRIP_KEY));
  });
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...originalLocation, origin: 'https://env.example.com', assign: assignSpy } as unknown as Location,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const authRef: { current: AuthContextValue | null } = { current: null };
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);
  return <span data-testid="ended">{String(auth.sessionEndedBySignOut)}</span>;
}

function signedOutClient(): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    listOrganizations: vi.fn().mockResolvedValue([]),
    getActiveOrganization: vi.fn().mockResolvedValue(null),
  } as unknown as AuthClient;
}

describe('createAuthClient.signOut writes the note only for a provider logout', () => {
  it('writes it before the browser leaves for the provider', async () => {
    const client = createAuthClient({
      baseURL: '/api/v1/auth',
      fetchFn: signOutFetch({ success: true, url: END_SESSION_URL, redirect: true }),
    });
    await client.signOut();
    expect(assignSpy).toHaveBeenCalledWith(END_SESSION_URL);
    expect(noteAtAssign).toHaveLength(1);
    expect(noteAtAssign[0]).not.toBeNull();
    expect(readSignOutRoundTrip()).toBe(true);
  });

  it('CONTROL: writes nothing when the sign-out stays in the page', async () => {
    const client = createAuthClient({ baseURL: '/api/v1/auth', fetchFn: signOutFetch({ success: true }) });
    await client.signOut();
    expect(assignSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(SIGN_OUT_ROUND_TRIP_KEY)).toBeNull();
  });

  it('writes nothing for a failed sign-out', async () => {
    const client = createAuthClient({
      baseURL: '/api/v1/auth',
      fetchFn: signOutFetch({ message: 'boom', url: END_SESSION_URL, redirect: true }, 500),
    });
    await expect(client.signOut()).rejects.toThrow('boom');
    expect(sessionStorage.getItem(SIGN_OUT_ROUND_TRIP_KEY)).toBeNull();
  });

  it('the sign-out purge keeps the note (the key spelled out in the purge list)', async () => {
    const real = createAuthClient({
      baseURL: '/api/v1/auth',
      fetchFn: signOutFetch({ success: true, url: END_SESSION_URL, redirect: true }),
    });
    const client = {
      signOut: real.signOut,
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'u_alice', name: 'Alice', email: 'alice@test.com' },
        session: { token: 'tok-alice' },
      }),
      listOrganizations: vi.fn().mockResolvedValue([]),
      getActiveOrganization: vi.fn().mockResolvedValue(null),
    } as unknown as AuthClient;
    render(
      <AuthProvider authUrl="/api/v1/auth" client={client}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(authRef.current?.user?.name).toBe('Alice'));
    sessionStorage.setItem('objectui:metadata:app:org_a:abc', '[]');

    await act(async () => {
      await authRef.current!.signOut();
    });

    expect(assignSpy).toHaveBeenCalledWith(END_SESSION_URL);
    expect(sessionStorage.getItem('objectui:metadata:app:org_a:abc')).toBeNull();
    expect(readSignOutRoundTrip()).toBe(true);
  });
});

describe('AuthProvider reads the note once, on the mount after the round trip', () => {
  it('starts with sessionEndedBySignOut raised, and drops the note', async () => {
    markSignOutRoundTrip();
    const view = render(
      <AuthProvider authUrl="/api/v1/auth" client={signedOutClient()}>
        <Probe />
      </AuthProvider>,
    );
    expect(view.getByTestId('ended').textContent).toBe('true');
    await waitFor(() => expect(sessionStorage.getItem(SIGN_OUT_ROUND_TRIP_KEY)).toBeNull());
    expect(view.getByTestId('ended').textContent).toBe('true');
  });

  it('a second load (a reload) is a fresh visit', async () => {
    markSignOutRoundTrip();
    const first = render(
      <AuthProvider authUrl="/api/v1/auth" client={signedOutClient()}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(sessionStorage.getItem(SIGN_OUT_ROUND_TRIP_KEY)).toBeNull());
    first.unmount();
    const second = render(
      <AuthProvider authUrl="/api/v1/auth" client={signedOutClient()}>
        <Probe />
      </AuthProvider>,
    );
    expect(second.getByTestId('ended').textContent).toBe('false');
  });

  it('CONTROL: with no note it starts lowered', () => {
    const view = render(
      <AuthProvider authUrl="/api/v1/auth" client={signedOutClient()}>
        <Probe />
      </AuthProvider>,
    );
    expect(view.getByTestId('ended').textContent).toBe('false');
  });

  it('a note older than the round trip window is a fresh visit', () => {
    markSignOutRoundTrip(Date.now() - SIGN_OUT_ROUND_TRIP_MAX_AGE_MS - 1000);
    const view = render(
      <AuthProvider authUrl="/api/v1/auth" client={signedOutClient()}>
        <Probe />
      </AuthProvider>,
    );
    expect(view.getByTestId('ended').textContent).toBe('false');
  });

  it('a session on return lowers it, whoever it belongs to', async () => {
    markSignOutRoundTrip();
    const client = {
      ...signedOutClient(),
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'u_bob', name: 'Bob', email: 'bob@test.com' },
        session: { token: 'tok-bob' },
      }),
    } as unknown as AuthClient;
    const view = render(
      <AuthProvider authUrl="/api/v1/auth" client={client}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(view.getByTestId('ended').textContent).toBe('false'));
  });
});
