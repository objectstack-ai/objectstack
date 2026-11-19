/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * LoginPage — the application's name on an OAuth sign-in hand-off
 * (objectstack#34168).
 *
 * The sign-in page reads the client name only for the client its signed
 * request names: it hands the URL's signed request to plugin-auth's
 * `GET /oauth2/client-name` and, on a name, says "Sign in to continue to
 * NAME". Any other answer keeps the host line.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';

const HOST_LINE = 'Continue to rp.example.com';
const SIGNED = new URLSearchParams({
  response_type: 'code',
  client_id: 'rp-client',
  redirect_uri: 'https://rp.example.com/cb',
  state: 's',
  exp: '1900000000',
  sig: 'c2lnbmF0dXJl',
});
const HANDOFF = `?${SIGNED}`;

/** What the client-name route answers in this test, and what it was asked. */
let answer: () => Promise<Response>;
let asked: string[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  asked = [];
  vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/bootstrap-status')) return json(200, { hasOwner: true });
    if (url.includes('/oauth2/client-name?')) {
      asked.push(url);
      return answer();
    }
    throw new Error(`client-name test: no double for ${url}`);
  }) as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLogin(search: string) {
  window.history.replaceState({}, '', `/login${search}`);
  const client = {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({}),
  } as unknown as AuthClient;
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

/** The hand-off line once the page has had the route's answer. */
async function handoffLine(): Promise<string> {
  await screen.findByLabelText('Email');
  await vi.waitFor(() => expect(asked.length).toBe(1));
  // Let the answer settle into the page.
  await new Promise((r) => setTimeout(r, 0));
  return screen.getByTestId('sso-handoff-target').textContent ?? '';
}

describe('LoginPage — the application name on a sign-in hand-off (objectstack#34168)', () => {
  it('names the application the signed request is for', async () => {
    answer = async () => json(200, { success: true, data: { client_name: 'Acme Portal' } });
    renderLogin(HANDOFF);

    expect(await screen.findByText('Sign in to continue to Acme Portal')).toBeTruthy();
    // Asked once, with the URL's client and the whole signed request.
    expect(asked).toHaveLength(1);
    const url = new URL(asked[0], 'http://console.test');
    expect(url.pathname).toBe('/api/v1/auth/oauth2/client-name');
    expect([...url.searchParams.keys()].sort()).toEqual(['client_id', 'oauth_query']);
    expect(url.searchParams.get('client_id')).toBe('rp-client');
    expect(url.searchParams.get('oauth_query')).toBe(SIGNED.toString());
  });

  it('keeps the host line on a refusal', async () => {
    answer = async () =>
      json(404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'No application name is available for this sign-in.' } });
    renderLogin(HANDOFF);

    expect(await handoffLine()).toBe(HOST_LINE);
  });

  it('keeps the host line on a network failure', async () => {
    answer = async () => {
      throw new TypeError('Failed to fetch');
    };
    renderLogin(HANDOFF);

    expect(await handoffLine()).toBe(HOST_LINE);
  });

  it('keeps the host line on a body of another shape', async () => {
    answer = async () => json(200, { success: true, data: { name: 'Not the field' } });
    renderLogin(HANDOFF);

    expect(await handoffLine()).toBe(HOST_LINE);
  });

  it('CONTROL: a hand-off with no signed request asks nothing and keeps the host line', async () => {
    answer = async () => json(200, { success: true, data: { client_name: 'Acme Portal' } });
    renderLogin('?client_id=rp-client&redirect_uri=https%3A%2F%2Frp.example.com%2Fcb&state=s');

    expect(await screen.findByText(HOST_LINE)).toBeTruthy();
    await screen.findByLabelText('Email');
    expect(asked).toHaveLength(0);
  });
});
