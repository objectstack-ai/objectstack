/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29105 — the auth client's half of a two-factor sign-in.
 *
 * For an account with two-factor sign-in on, better-auth's `/sign-in/email`
 * answers `{ twoFactorRedirect: true, twoFactorMethods }` with no session and
 * no token: the pending sign-in lives in a signed cookie. The client must
 * report that as a challenge (it used to hand back `{ user: undefined }`, and
 * the sign-in page stayed as it was), and finish it through the sign-in lane
 * of `/two-factor/verify-totp` or `/two-factor/verify-backup-code`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthClient, TokenStorage } from '../createAuthClient';

type Handler = { status?: number; body: unknown; headers?: Record<string, string> };

function mockFetch(handlers: Record<string, Handler>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
    for (const [path, h] of Object.entries(handlers)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(h.body), {
          status: h.status ?? 200,
          headers: { 'Content-Type': 'application/json', ...(h.headers ?? {}) },
        });
      }
    }
    return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
  });
  return { fn, calls };
}

const USER = { id: 'u1', name: 'Totp User', email: 'totp@example.com' };

beforeEach(() => {
  TokenStorage.clear();
});

describe('signIn — an account with two-factor sign-in on (objectstack#29105)', () => {
  it('answers a challenge with the offered methods and stores no token', async () => {
    const { fn } = mockFetch({
      '/sign-in/email': { body: { twoFactorRedirect: true, twoFactorMethods: ['totp'] } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/v1/auth', fetchFn: fn });

    const result = await client.signIn({ email: USER.email, password: 'pw' });

    expect(result).toEqual({ twoFactor: { methods: ['totp'] } });
    expect(TokenStorage.get()).toBeNull();
  });

  it('drops a method name the server has no step for, keeps the challenge', async () => {
    const { fn } = mockFetch({
      '/sign-in/email': { body: { twoFactorRedirect: true, twoFactorMethods: ['passkey', 'otp'] } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/v1/auth', fetchFn: fn });

    expect(await client.signIn({ email: USER.email, password: 'pw' })).toEqual({
      twoFactor: { methods: ['otp'] },
    });
  });

  it('still answers a session for an account without two-factor sign-in', async () => {
    const { fn } = mockFetch({
      '/sign-in/email': { body: { user: USER, session: { token: 'plain-token' } } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/v1/auth', fetchFn: fn });

    const result = await client.signIn({ email: USER.email, password: 'pw' });

    expect(result.twoFactor).toBeUndefined();
    expect(result.user?.email).toBe(USER.email);
    expect(TokenStorage.get()).toBe('plain-token');
  });
});

describe('verifySignInTwoFactor (objectstack#29105)', () => {
  it('posts an authenticator code to /two-factor/verify-totp and installs the session', async () => {
    const { fn, calls } = mockFetch({
      '/two-factor/verify-totp': { body: { token: 'session-token', user: USER } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/v1/auth', fetchFn: fn });

    const result = await client.verifySignInTwoFactor('123456', 'totp');

    expect(calls.map((c) => [new URL(c.url).pathname, c.body])).toEqual([
      ['/api/v1/auth/two-factor/verify-totp', { code: '123456' }],
    ]);
    expect(result.user.email).toBe(USER.email);
    expect(result.session.token).toBe('session-token');
    expect(TokenStorage.get()).toBe('session-token');
  });

  it('posts a backup code to /two-factor/verify-backup-code', async () => {
    const { fn, calls } = mockFetch({
      '/two-factor/verify-backup-code': { body: { token: 'backup-session', user: USER } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/v1/auth', fetchFn: fn });

    const result = await client.verifySignInTwoFactor('abcde-fghij', 'backup-code');

    expect(calls.map((c) => [new URL(c.url).pathname, c.body])).toEqual([
      ['/api/v1/auth/two-factor/verify-backup-code', { code: 'abcde-fghij' }],
    ]);
    expect(result.session.token).toBe('backup-session');
  });

  it('rejects a wrong code with the server code and stores nothing', async () => {
    const { fn } = mockFetch({
      '/two-factor/verify-totp': { status: 401, body: { code: 'INVALID_CODE', message: 'Invalid code' } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/v1/auth', fetchFn: fn });

    await expect(client.verifySignInTwoFactor('000000', 'totp')).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
    expect(TokenStorage.get()).toBeNull();
  });
});
