/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11633 — `/verify-email?token=…` verifies through the GET route
 * better-auth actually serves.
 *
 * better-auth declares `/verify-email` as `method: "GET"` only, and the
 * framework's auth route ledger lists only `GET /api/v1/auth/verify-email`.
 * The page used to POST `{ token }`, which the server answers 404, so every
 * valid token rendered the error state and the account stayed unverified.
 *
 * The stub answers the way the live route answers a request that carries no
 * `callbackURL`: a JSON receipt `{ status: true, user: null }` for a token
 * that verifies, and a 401 `{ code, message }` for a garbage or expired one.
 * Any other method is a 404, as on the server. A `callbackURL` would turn the
 * answer into a 302 whose followed landing is an HTML page, so the stub serves
 * that page to such a request, and the page must not send one.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { VerifyEmailPage } from '../VerifyEmailPage';
import { LoginPage } from '../LoginPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VALID = 'eyJhbGciOiJIUzI1NiJ9.valid+token/with=chars';
const EXPIRED = 'eyJhbGciOiJIUzI1NiJ9.expired';
const GARBAGE = 'not-a-jwt';
/** A token whose verification would also sign in an account with an enrolled second factor. */
const SECOND_FACTOR = 'eyJhbGciOiJIUzI1NiJ9.second-factor';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

interface Call {
  url: URL;
  init: RequestInit | undefined;
}

/** A server that answers `/api/v1/auth/verify-email` like better-auth does. */
function verifyEmailServer(opts: { htmlOk?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    calls.push({ url, init });
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.pathname !== '/api/v1/auth/verify-email' || method !== 'GET') {
      return new Response(null, { status: 404 });
    }
    if (opts.htmlOk || url.searchParams.has('callbackURL')) {
      return new Response('<!doctype html><html><body>console</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    const token = url.searchParams.get('token');
    if (token === VALID) return json(200, { status: true, user: null });
    // The address is verified; the sign-in it would make waits for the second factor.
    if (token === SECOND_FACTOR) return json(200, { twoFactorRedirect: true, twoFactorMethods: ['totp'] });
    if (token === EXPIRED) return json(401, { code: 'TOKEN_EXPIRED', message: 'Token expired' });
    return json(401, { code: 'INVALID_TOKEN', message: 'Invalid token' });
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

function renderAt(search: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/verify-email${search}`]}>
        <VerifyEmailPage />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('VerifyEmailPage verifies through GET ?token= (objectui#11633)', () => {
  it('a valid token reaches the success state through a GET that carries it in the query', async () => {
    const calls = verifyEmailServer();
    renderAt(`?token=${encodeURIComponent(VALID)}`);

    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    expect(screen.queryByText('Verification failed')).toBeNull();

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url.pathname).toBe('/api/v1/auth/verify-email');
    expect((init?.method ?? 'GET').toUpperCase()).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(url.searchParams.get('token')).toBe(VALID);
    // Without callbackURL the route answers its JSON receipt, not a 302.
    expect(url.searchParams.has('callbackURL')).toBe(false);
  });

  it('a garbage token renders the error state with the server reason', async () => {
    verifyEmailServer();
    renderAt(`?token=${GARBAGE}`);

    expect(await screen.findByText('Verification failed')).toBeInTheDocument();
    expect(screen.getByText('Invalid token')).toBeInTheDocument();
    expect(screen.queryByText('Email verified')).toBeNull();
  });

  it('an expired token renders the error state', async () => {
    verifyEmailServer();
    renderAt(`?token=${EXPIRED}`);

    expect(await screen.findByText('Verification failed')).toBeInTheDocument();
    expect(screen.getByText('Token expired')).toBeInTheDocument();
    expect(screen.queryByText('Email verified')).toBeNull();
  });

  it('a 2xx that is not the JSON receipt (an HTML page) is not a success', async () => {
    verifyEmailServer({ htmlOk: true });
    renderAt(`?token=${encodeURIComponent(VALID)}`);

    expect(await screen.findByText('Verification failed')).toBeInTheDocument();
    expect(screen.queryByText('Email verified')).toBeNull();
  });
});

describe('VerifyEmailPage — a verification that signs in an account with an enrolled second factor continues to the two-factor prompt', () => {
  const USER = { id: 'u1', name: 'Totp User', email: 'totp@example.com' };

  function stubClient(): AuthClient {
    return {
      getSession: vi.fn().mockResolvedValue(null),
      getConfig: vi.fn().mockResolvedValue({}),
      signOut: vi.fn().mockResolvedValue(undefined),
      // The password door answers the challenge for this account, as better-auth's `/sign-in/email` does.
      signIn: vi.fn().mockResolvedValue({ twoFactor: { methods: ['totp'] } }),
      verifySignInTwoFactor: vi.fn().mockResolvedValue({ user: USER, session: { token: 'session-token' } }),
    } as unknown as AuthClient;
  }

  function renderConsoleAt(search: string, client: AuthClient) {
    return render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <AuthProvider authUrl="/api/v1/auth" client={client}>
          <MemoryRouter initialEntries={[`/verify-email${search}`]}>
            <Routes>
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </I18nProvider>,
    );
  }

  it('says the address is verified, shows no error, and the sign-in it leads to asks for the second factor', async () => {
    verifyEmailServer();
    const client = stubClient();
    renderConsoleAt(`?token=${encodeURIComponent(SECOND_FACTOR)}`, client);

    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    expect(screen.queryByText('Verification failed')).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Go to sign in' }));

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), USER.email);
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByTestId('two-factor-challenge')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('CONTROL: a plain account verifies as today', async () => {
    verifyEmailServer();
    renderConsoleAt(`?token=${encodeURIComponent(VALID)}`, stubClient());

    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Verification failed')).toBeNull();
  });

  it('CONTROL: a bad token still shows the existing error', async () => {
    verifyEmailServer();
    renderConsoleAt(`?token=${GARBAGE}`, stubClient());

    expect(await screen.findByText('Verification failed')).toBeInTheDocument();
    expect(screen.getByText('Invalid token')).toBeInTheDocument();
    expect(screen.queryByText('Email verified')).toBeNull();
  });
});
