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
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { VerifyEmailPage } from '../VerifyEmailPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VALID = 'eyJhbGciOiJIUzI1NiJ9.valid+token/with=chars';
const EXPIRED = 'eyJhbGciOiJIUzI1NiJ9.expired';
const GARBAGE = 'not-a-jwt';

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
