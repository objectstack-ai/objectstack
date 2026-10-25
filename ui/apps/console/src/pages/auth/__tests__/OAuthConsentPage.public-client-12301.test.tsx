/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * OAuthConsentPage names the requesting application through the route the
 * server serves, and never shows the raw `client_id` in the name's place
 * (objectui#12301).
 *
 * The page used to ask `/oauth2/applications/ID/public`, a route no server
 * mounts; every lookup answered 404 and the page fell back to naming the
 * application by its raw `client_id`. The served lookup is
 * `GET /api/v1/auth/oauth2/public-client?client_id=…`
 * (`@better-auth/oauth-provider`'s `getOAuthClientPublic`, session-required,
 * answering RFC 7591 client metadata: the name is `client_name`).
 *
 * The URL pin is not a copied string: it is the URL the REAL
 * `@objectstack/client` builds for `oauth.applications.getPublic`, so a page
 * that drifts from the SDK's declared route goes red here, and so does a
 * regression to the old path.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ObjectStackClient } from '@objectstack/client';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { OAuthConsentPage } from '../OAuthConsentPage';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
/** Carries characters that must be encoded, so the encoding is pinned too. */
const CLIENT_ID = 'acme/notes app';
const SEARCH = `?client_id=${encodeURIComponent(CLIENT_ID)}&scope=openid%20email&sig=s1`;

type Answer =
  | { kind: 'http'; status: number; body: unknown }
  | { kind: 'network' }
  | { kind: 'never' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The URL `@objectstack/client` requests for `oauth.applications.getPublic`. */
async function sdkPublicClientUrl(clientId: string): Promise<string> {
  let requested = '';
  const sdk = new ObjectStackClient({
    baseUrl: SERVER_URL,
    fetch: (async (input: unknown) => {
      requested = String(input);
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
    }) as never,
  });
  await sdk.oauth.applications.getPublic(clientId);
  return requested;
}

function authClient(signedIn: boolean): AuthClient {
  return {
    getSession: vi
      .fn()
      .mockResolvedValue(
        signedIn ? { user: { id: 'u1', email: 'me@example.com' }, session: {} } : null,
      ),
    getConfig: vi.fn().mockResolvedValue({ features: {} }),
  } as unknown as AuthClient;
}

function stubLookup(answer: Answer) {
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    if (!url.includes('/oauth2/public-client')) {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }
    if (answer.kind === 'never') return new Promise(() => {});
    if (answer.kind === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderConsent(signedIn = true) {
  window.history.replaceState({}, '', `/oauth/consent${SEARCH}`);
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={authClient(signedIn)}>
      <MemoryRouter initialEntries={[`/oauth/consent${SEARCH}`]}>
        <Routes>
          <Route path="/oauth/consent" element={<OAuthConsentPage />} />
          <Route path="/login" element={<div>login-stub</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

const lookupCalls = (fetchMock: ReturnType<typeof stubLookup>) =>
  fetchMock.mock.calls.map(([input]) => String(input)).filter((u) => u.includes('/oauth2/'));

describe('OAuthConsentPage — the public-client lookup (objectui#12301)', () => {
  it('asks the served route with the declared client_id parameter, the URL the SDK builds', async () => {
    const fetchMock = stubLookup({
      kind: 'http',
      status: 200,
      body: { client_id: CLIENT_ID, client_name: 'Acme Notes', redirect_uris: ['https://acme.example/cb'] },
    });
    renderConsent();

    await screen.findByText('Acme Notes wants to access your account');
    const expected = await sdkPublicClientUrl(CLIENT_ID);
    expect(expected).toContain('/api/v1/auth/oauth2/public-client?client_id=');
    expect(lookupCalls(fetchMock)).toEqual([expected]);
    expect(fetchMock).toHaveBeenCalledWith(expected, expect.objectContaining({ credentials: 'include' }));
  });

  it('names a registered client by its client_name and shows its logo_uri', async () => {
    stubLookup({
      kind: 'http',
      status: 200,
      body: {
        client_id: CLIENT_ID,
        client_name: 'Acme Notes',
        logo_uri: 'https://acme.example/logo.png',
        redirect_uris: ['https://acme.example/cb'],
      },
    });
    const { container } = renderConsent();

    expect(await screen.findByText('Acme Notes wants to access your account')).toBeTruthy();
    expect(screen.getByText('Acme Notes is requesting permission for me@example.com.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryAllByText(CLIENT_ID, { exact: false })).toHaveLength(0);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://acme.example/logo.png');
  });

  it.each<[string, Answer]>([
    ['an unknown client (404)', { kind: 'http', status: 404, body: { error: 'not_found', error_description: 'client not found' } }],
    ['a server error (500)', { kind: 'http', status: 500, body: { message: 'boom' } }],
    ['a network failure', { kind: 'network' }],
    ['an answer with no client_name', { kind: 'http', status: 200, body: { client_id: CLIENT_ID, redirect_uris: [] } }],
  ])('%s shows the could-not-identify state with the id labelled as the id', async (_label, answer) => {
    stubLookup(answer);
    renderConsent();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('This application could not be identified.')).toBeTruthy();
    expect(within(alert).getByText('Client ID')).toBeTruthy();
    // The id appears exactly once, as the id — never in the name's place.
    const idNodes = screen.getAllByText(CLIENT_ID, { exact: false });
    expect(idNodes).toHaveLength(1);
    expect(idNodes[0].tagName).toBe('CODE');
    expect(alert.contains(idNodes[0])).toBe(true);
    expect(screen.getByText('an application wants to access your account')).toBeTruthy();
  });

  it('shows neither a name nor the id while the lookup is in flight', async () => {
    const fetchMock = stubLookup({ kind: 'never' });
    renderConsent();

    expect(await screen.findByText('an application is requesting permission for me@example.com.')).toBeTruthy();
    // The placeholder is drawn by the commit; the lookup starts in the passive
    // effect that runs after it, so the call is awaited rather than counted
    // the moment the text appears (objectui#12344).
    await waitFor(() => expect(lookupCalls(fetchMock)).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryAllByText(CLIENT_ID, { exact: false })).toHaveLength(0);
    // The page asks once: still exactly one lookup after the in-flight reads.
    expect(lookupCalls(fetchMock)).toHaveLength(1);
  });

  it('does not ask the session-required route for a signed-out visitor', async () => {
    const fetchMock = stubLookup({
      kind: 'http',
      status: 200,
      body: { client_id: CLIENT_ID, client_name: 'Acme Notes' },
    });
    renderConsent(false);

    expect(await screen.findByText('login-stub')).toBeTruthy();
    expect(lookupCalls(fetchMock)).toEqual([]);
  });
});
