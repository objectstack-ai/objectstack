/**
 * Tests for createAuthClient (backed by official better-auth client)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthClient, TokenStorage } from '../createAuthClient';

/**
 * Helper: creates a mock fetch that routes requests based on URL
 * and records every call for inspection.
 */
function createMockFetch(handlers: Record<string, { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const mockFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      url = input.url;
    }
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | null });
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(handler.body), {
          status: handler.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ message: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { mockFn, calls };
}

describe('createAuthClient', () => {
  it('creates a client with all expected methods', () => {
    const { mockFn } = createMockFetch({});
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    expect(client).toHaveProperty('signIn');
    expect(client).toHaveProperty('signUp');
    expect(client).toHaveProperty('signOut');
    expect(client).toHaveProperty('getSession');
    expect(client).toHaveProperty('forgotPassword');
    expect(client).toHaveProperty('resetPassword');
    expect(client).toHaveProperty('updateUser');
  });

  it('signIn sends POST to /sign-in/email', async () => {
    const { mockFn, calls } = createMockFetch({
      '/sign-in/email': {
        body: {
          user: { id: '1', name: 'Test', email: 'test@test.com' },
          session: { token: 'tok123', id: 's1', userId: '1', expiresAt: '2025-01-01' },
        },
      },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    const result = await client.signIn({ email: 'test@test.com', password: 'pass123' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/auth/sign-in/email');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body!)).toMatchObject({ email: 'test@test.com', password: 'pass123' });
    expect(result.user.email).toBe('test@test.com');
    expect(result.session.token).toBe('tok123');
  });

  it('signUp sends POST to /sign-up/email and returns the session when verification is off', async () => {
    const { mockFn, calls } = createMockFetch({
      '/sign-up/email': {
        body: {
          user: { id: '2', name: 'New User', email: 'new@test.com' },
          token: 'tok456',
        },
      },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    const result = await client.signUp({ name: 'New User', email: 'new@test.com', password: 'pass123' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/auth/sign-up/email');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body!)).toMatchObject({ email: 'new@test.com', name: 'New User' });
    expect(result.user.name).toBe('New User');
    expect(result.session?.token).toBe('tok456');
    expect(result.requiresVerification).toBe(false);
  });

  it('signUp surfaces requiresVerification when the server returns a null token', async () => {
    const { mockFn } = createMockFetch({
      '/sign-up/email': {
        body: {
          user: { id: '3', name: 'Pending', email: 'pending@test.com' },
          token: null,
        },
      },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    const result = await client.signUp({ name: 'Pending', email: 'pending@test.com', password: 'pass123' });

    expect(result.user.email).toBe('pending@test.com');
    expect(result.session).toBeNull();
    expect(result.requiresVerification).toBe(true);
  });

  // objectui#10893 — the verification mail's link is built server-side from
  // the sign-up body's `callbackURL`; a body without one mails `callbackURL=/`
  // and the invitee lands on the workspace picker instead of the invitation.
  it('signUp sends the verification callbackURL in the /sign-up/email body (objectui#10893)', async () => {
    const { mockFn, calls } = createMockFetch({
      '/sign-up/email': { body: { user: { id: '4', name: 'Invitee', email: 'invitee@test.com' }, token: null } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    await client.signUp({
      name: 'Invitee',
      email: 'invitee@test.com',
      password: 'pass12345',
      callbackURL: '/_console/accept-invitation/inv_1',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/auth/sign-up/email');
    expect(JSON.parse(calls[0].body!).callbackURL).toBe('/_console/accept-invitation/inv_1');
  });

  it('signUp without a callbackURL leaves the key off the wire, so the server default applies (objectui#10893)', async () => {
    const { mockFn, calls } = createMockFetch({
      '/sign-up/email': { body: { user: { id: '5', name: 'Plain', email: 'plain@test.com' }, token: null } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    await client.signUp({ name: 'Plain', email: 'plain@test.com', password: 'pass12345' });

    expect(Object.keys(JSON.parse(calls[0].body!))).not.toContain('callbackURL');
  });

  it('signOut sends POST to /sign-out', async () => {
    const { mockFn, calls } = createMockFetch({
      '/sign-out': { body: { success: true } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    await client.signOut();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/auth/sign-out');
    expect(calls[0].method).toBe('POST');
  });

  it('getSession sends GET to /get-session', async () => {
    const { mockFn, calls } = createMockFetch({
      '/get-session': {
        body: {
          user: { id: '1', name: 'Test', email: 'test@test.com' },
          session: { token: 'tok789', id: 's1', userId: '1', expiresAt: '2025-01-01' },
        },
      },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    const result = await client.getSession();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/auth/get-session');
    expect(calls[0].method).toBe('GET');
    expect(result?.user.id).toBe('1');
  });

  it('getSession self-heals a stale bearer: cookie session wins and replaces the token', async () => {
    const { TokenStorage } = await import('../createAuthClient');
    TokenStorage.set('stale-token');
    const session = { token: 'fresh-cookie-token', id: 's9', userId: '1', expiresAt: '2027-01-01' };
    const user = { id: '1', name: 'Jack', email: 'jack@test.com' };
    // Bearer-carrying call sees no session (stale token); the cookie-only
    // retry (no Authorization header) sees the live SSO session.
    const mockFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const hasBearer = Boolean(headers.get('Authorization'));
      const body = hasBearer ? null : { user, session };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    const result = await client.getSession();

    expect(result?.user.id).toBe('1');
    expect(result?.session.token).toBe('fresh-cookie-token');
    // The stale token was replaced by the live session's token.
    expect(TokenStorage.get()).toBe('fresh-cookie-token');
    TokenStorage.clear();
  });

  it('getSession drops a dead bearer when the cookie has no session either', async () => {
    const { TokenStorage } = await import('../createAuthClient');
    TokenStorage.set('dead-token');
    // Both the bearer call and the cookie-only retry affirmatively report
    // "no session" (200 + null) — the stored token is dead weight.
    const mockFn = vi.fn(async () =>
      new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    const result = await client.getSession();

    expect(result).toBeNull();
    expect(TokenStorage.get()).toBeNull();
  });

  it('getSession keeps the bearer on transport errors (proves nothing about validity)', async () => {
    const { TokenStorage } = await import('../createAuthClient');
    TokenStorage.set('maybe-good-token');
    const mockFn = vi.fn(async () => { throw new Error('network down'); });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    const result = await client.getSession();

    expect(result).toBeNull();
    expect(TokenStorage.get()).toBe('maybe-good-token');
    TokenStorage.clear();
  });

  it('getSession returns null on failure', async () => {
    const { mockFn } = createMockFetch({
      '/get-session': { status: 401, body: { message: 'Unauthorized' } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    const result = await client.getSession();
    expect(result).toBeNull();
  });

  it('forgotPassword sends POST to /request-password-reset', async () => {
    const { mockFn, calls } = createMockFetch({
      '/request-password-reset': { body: { status: true } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    await client.forgotPassword('test@test.com');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/auth/request-password-reset');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body!)).toMatchObject({ email: 'test@test.com' });
  });

  it('resetPassword sends POST to /reset-password', async () => {
    const { mockFn, calls } = createMockFetch({
      '/reset-password': { body: { status: true } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    await client.resetPassword('token123', 'newpass');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/auth/reset-password');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body!)).toMatchObject({ token: 'token123', newPassword: 'newpass' });
  });

  it('throws error with server message on non-OK response', async () => {
    const { mockFn } = createMockFetch({
      '/sign-in/email': {
        status: 401,
        body: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
      },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    await expect(client.signIn({ email: 'x', password: 'y' })).rejects.toThrow('Invalid credentials');
  });

  it('throws error on non-OK response without message', async () => {
    const { mockFn } = createMockFetch({
      '/sign-in/email': { status: 500, body: {} },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    await expect(client.signIn({ email: 'x', password: 'y' })).rejects.toThrow();
  });

  it('updateUser sends POST to /update-user and returns user', async () => {
    const { mockFn, calls } = createMockFetch({
      '/update-user': {
        body: { user: { id: '1', name: 'Updated', email: 'test@test.com' } },
      },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });

    const result = await client.updateUser({ name: 'Updated' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/auth/update-user');
    expect(calls[0].method).toBe('POST');
    expect(result.name).toBe('Updated');
  });
});

// framework#2780 — phone-number OTP endpoints.
describe('createAuthClient — phone-number OTP (framework#2780)', () => {
  beforeEach(() => {
    TokenStorage.clear();
  });

  it('sendPhoneOtp POSTs /phone-number/send-otp with the number', async () => {
    const { mockFn, calls } = createMockFetch({
      '/phone-number/send-otp': { body: { message: 'code sent' } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await client.sendPhoneOtp('+8613800000000');
    const call = calls.find((c) => c.url.includes('/phone-number/send-otp'));
    expect(call?.method).toBe('POST');
    expect(JSON.parse(call!.body as string)).toEqual({ phoneNumber: '+8613800000000' });
  });

  it('sendPhoneOtp surfaces the 429 cooldown with code + status', async () => {
    const { mockFn } = createMockFetch({
      '/phone-number/send-otp': {
        status: 429,
        body: { message: 'Too many verification codes requested for this phone number. Retry in 42s.' },
      },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await expect(client.sendPhoneOtp('+8613800000000')).rejects.toMatchObject({
      message: expect.stringContaining('Retry in 42s'),
      status: 429,
    });
  });

  it('signInWithPhoneOtp verifies, stores the session token, and returns user+session', async () => {
    const { mockFn, calls } = createMockFetch({
      '/phone-number/verify': {
        body: {
          status: true,
          token: 'otp-session-token',
          user: { id: 'u1', phoneNumber: '+8613800000000', name: 'Phone User' },
        },
      },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    const result = await client.signInWithPhoneOtp('+8613800000000', '123456');
    expect(result.session.token).toBe('otp-session-token');
    expect(result.user.id).toBe('u1');
    expect(TokenStorage.get()).toBe('otp-session-token');
    const call = calls.find((c) => c.url.includes('/phone-number/verify'));
    expect(JSON.parse(call!.body as string)).toEqual({ phoneNumber: '+8613800000000', code: '123456' });
  });

  it('signInWithPhoneOtp rejects when the number belongs to no account (token null)', async () => {
    const { mockFn } = createMockFetch({
      '/phone-number/verify': { body: { status: true, token: null, user: null } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await expect(client.signInWithPhoneOtp('+8613800000000', '123456')).rejects.toThrow(
      /No account is registered/,
    );
    expect(TokenStorage.get()).toBeNull();
  });

  it('signInWithPhonePassword POSTs /sign-in/phone-number, stores the token, returns user+session', async () => {
    const { mockFn, calls } = createMockFetch({
      '/sign-in/phone-number': {
        body: { token: 'pw-session-token', user: { id: 'u2', phoneNumber: '+8613800000000' } },
      },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    const result = await client.signInWithPhonePassword('+8613800000000', 'S3cret-pass!');
    expect(result.session.token).toBe('pw-session-token');
    expect(result.user.id).toBe('u2');
    expect(TokenStorage.get()).toBe('pw-session-token');
    const call = calls.find((c) => c.url.includes('/sign-in/phone-number'));
    expect(call?.method).toBe('POST');
    expect(JSON.parse(call!.body as string)).toEqual({ phoneNumber: '+8613800000000', password: 'S3cret-pass!' });
  });

  it('signInWithPhonePassword rejects invalid credentials and stores no token', async () => {
    const { mockFn } = createMockFetch({
      '/sign-in/phone-number': { status: 401, body: { message: 'Invalid phone number or password', code: 'INVALID_PHONE_NUMBER_OR_PASSWORD' } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await expect(client.signInWithPhonePassword('+8613800000000', 'wrong')).rejects.toMatchObject({
      status: 401,
    });
    expect(TokenStorage.get()).toBeNull();
  });

  it('requestPhonePasswordReset + resetPasswordWithPhoneOtp POST the reset endpoints', async () => {
    const { mockFn, calls } = createMockFetch({
      '/phone-number/request-password-reset': { body: { status: true } },
      '/phone-number/reset-password': { body: { status: true } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await client.requestPhonePasswordReset('+8613800000000');
    await client.resetPasswordWithPhoneOtp('+8613800000000', '654321', 'N3w-Passw0rd!');
    const req = calls.find((c) => c.url.includes('/phone-number/request-password-reset'));
    expect(JSON.parse(req!.body as string)).toEqual({ phoneNumber: '+8613800000000' });
    const reset = calls.find((c) => c.url.includes('/phone-number/reset-password'));
    expect(JSON.parse(reset!.body as string)).toEqual({
      phoneNumber: '+8613800000000',
      otp: '654321',
      newPassword: 'N3w-Passw0rd!',
    });
  });

  it('resetPasswordWithPhoneOtp surfaces INVALID_OTP errors', async () => {
    const { mockFn } = createMockFetch({
      '/phone-number/reset-password': {
        status: 400,
        body: { message: 'Invalid OTP', code: 'INVALID_OTP' },
      },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await expect(
      client.resetPasswordWithPhoneOtp('+8613800000000', '000000', 'x'),
    ).rejects.toMatchObject({ message: 'Invalid OTP', code: 'INVALID_OTP' });
  });
});

describe('createAuthClient — signInWithProvider redirect contract (objectui#2458 item 1)', () => {
  // A provider sign-in that resolves WITHOUT a redirect URL used to resolve
  // silently — the user clicked "Continue with …" and nothing happened. The
  // client must throw so the buttons can surface an inline error.

  it('oidc: signs in through /sign-in/social (better-auth ≥ 1.7 servers)', async () => {
    const { mockFn, calls } = createMockFetch({
      '/sign-in/social': { body: { url: 'https://cloud.example.com/oauth2/authorize?x=1', redirect: true } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await expect(
      client.signInWithProvider('objectstack-cloud', { type: 'oidc', callbackURL: '/x' }),
    ).resolves.toBeUndefined();
    expect(calls.some((c) => c.url.includes('/sign-in/social') && c.method === 'POST')).toBe(true);
    // The legacy route is only a fallback — it must NOT be hit when the
    // social route succeeds.
    expect(calls.some((c) => c.url.includes('/sign-in/oauth2'))).toBe(false);
  });

  it('oidc: falls back to /sign-in/oauth2 when /sign-in/social rejects (< 1.7 servers)', async () => {
    const { mockFn, calls } = createMockFetch({
      '/sign-in/social': { status: 404, body: { message: 'Not found' } },
      '/sign-in/oauth2': { body: { url: 'https://cloud.example.com/oauth2/authorize?x=1', redirect: true } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await expect(
      client.signInWithProvider('objectstack-cloud', { type: 'oidc', callbackURL: '/x' }),
    ).resolves.toBeUndefined();
    expect(calls.some((c) => c.url.includes('/sign-in/social') && c.method === 'POST')).toBe(true);
    expect(calls.some((c) => c.url.includes('/sign-in/oauth2') && c.method === 'POST')).toBe(true);
  });

  it('oidc: rejects when neither route returns a url', async () => {
    const { mockFn, calls } = createMockFetch({
      '/sign-in/social': { body: { redirect: false } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await expect(
      client.signInWithProvider('objectstack-cloud', { type: 'oidc', callbackURL: '/x' }),
    ).rejects.toThrow(/did not return a redirect URL/);
    expect(calls.some((c) => c.url.includes('/sign-in/social') && c.method === 'POST')).toBe(true);
  });

  it('social: rejects when /sign-in/social returns no url', async () => {
    const { mockFn } = createMockFetch({
      '/sign-in/social': { body: {} },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await expect(
      client.signInWithProvider('google', { type: 'social' }),
    ).rejects.toThrow(/did not return a redirect URL/);
  });

  it('oidc: surfaces the social-route error when the fallback also fails', async () => {
    const { mockFn } = createMockFetch({
      '/sign-in/social': { status: 400, body: { message: 'Provider not found' } },
      '/sign-in/oauth2': { status: 404, body: { message: 'Not found' } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    await expect(
      client.signInWithProvider('objectstack-cloud', { type: 'oidc' }),
    ).rejects.toThrow('Provider not found');
  });
});

describe('createAuthClient — getConfig single-flight / cache / retry (#2625)', () => {
  it('single-flights concurrent callers and caches the success', async () => {
    const { mockFn, calls } = createMockFetch({
      '/config': { body: { data: { features: { sso: true } } } },
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
    const [a, b] = await Promise.all([client.getConfig(), client.getConfig()]);
    const c = await client.getConfig();
    expect(a.features?.sso).toBe(true);
    expect(b).toBe(a);
    expect(c).toBe(a);
    // Three consumers, ONE request — the login page used to fire three.
    expect(calls.filter((x) => x.url.includes('/config'))).toHaveLength(1);
  });

  it('retries a failing config fetch with backoff before resolving', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) {
          return new Response(JSON.stringify({ message: 'cold start' }), { status: 503 });
        }
        return new Response(JSON.stringify({ data: { features: { ssoEnforced: true } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
      const pending = client.getConfig();
      // Backoff schedule is 500ms → 1500ms; advance past both.
      await vi.advanceTimersByTimeAsync(500 + 1500 + 50);
      const config = await pending;
      expect(config.features?.ssoEnforced).toBe(true);
      expect(attempts).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a final failure rejects but does not poison the cache', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts += 1;
        if (attempts <= 4) {
          return new Response('down', { status: 503 });
        }
        return new Response(JSON.stringify({ data: { features: {} } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
      const first = client.getConfig();
      const firstAssertion = expect(first).rejects.toThrow(/Failed to load auth config/);
      await vi.advanceTimersByTimeAsync(500 + 1500 + 3500 + 50);
      await firstAssertion;
      // Next caller starts a FRESH cycle (attempt 5 succeeds immediately).
      const second = await client.getConfig();
      expect(second.features).toBeDefined();
      expect(attempts).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createAuthClient — signInWithProvider watchdog (#2626)', () => {
  it('rejects with a timeout error when the sign-in request never returns', async () => {
    vi.useFakeTimers();
    try {
      // A fetch that hangs forever — the cold-start failure mode where the
      // provider button used to spin until a page refresh.
      const mockFn = vi.fn(() => new Promise<Response>(() => { /* never settles */ }));
      const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFn });
      const pending = client.signInWithProvider('objectstack-cloud', { type: 'oidc' });
      const assertion = expect(pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(20_000 + 50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
