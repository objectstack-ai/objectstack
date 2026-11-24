/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36754 — a signed-out person who opens a record link is sent to
 * the sign-in page with `?redirect=<record>`. Password and provider-button
 * sign-in brought them to the record; "Sign in with SSO" (by email domain)
 * sent the identity provider back to the console root, so they landed in
 * their last app instead.
 *
 * The SSO request's `callbackURL` now returns to the sign-in page itself with
 * that redirect when it is safe (a same-origin path, never an absolute or
 * protocol-relative URL: the console sign-in page's own rule), the return the
 * provider buttons already use; the page then finishes sign-in and lands the
 * person on the link. An unsafe redirect is dropped, and with none the
 * callback is the console root exactly as before.
 */

import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { LoginForm } from '../LoginForm';
import type { AuthClient } from '../types';

const RECORD = '/apps/crm/account/acc_1?tab=contacts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

function client(): AuthClient {
  return {
    signIn: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({ features: { sso: true } }),
  } as unknown as AuthClient;
}

/** Open the sign-in page at `url`, press "Sign in with SSO", and read the request's callbackURL. */
async function ssoCallbackFrom(url: string): Promise<string> {
  window.history.replaceState(null, '', url);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ message: 'No SSO provider is configured for this email domain.' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
  );
  render(
    <AuthProvider authUrl="/api/auth" client={client()}>
      <LoginForm />
    </AuthProvider>,
  );
  const button = await screen.findByRole('button', { name: 'Sign in with SSO' });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@corp.example' } });
  fireEvent.click(button);
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  expect(String(fetchSpy.mock.calls[0][0])).toBe('/api/v1/auth/sign-in/sso');
  return (JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)) as { callbackURL: string }).callbackURL;
}

describe('LoginForm — SSO keeps the pre-login link (objectstack#36754)', () => {
  it('returns to the sign-in page with a safe redirect', async () => {
    const callbackURL = await ssoCallbackFrom(`/login?redirect=${encodeURIComponent(RECORD)}`);
    expect(callbackURL).toBe(`/login?redirect=${encodeURIComponent(RECORD)}`);
    expect(new URL(callbackURL, 'https://host.example').searchParams.get('redirect')).toBe(RECORD);
  });

  it('keeps the console mount and carries only the redirect, not the rest of the query', async () => {
    const callbackURL = await ssoCallbackFrom(
      `/_console/login?redirect=${encodeURIComponent(RECORD)}&error=state_mismatch&error_description=x`,
    );
    expect(callbackURL).toBe(`/_console/login?redirect=${encodeURIComponent(RECORD)}`);
  });

  it.each([
    ['an absolute URL', 'https://evil.example/phish'],
    ['a protocol-relative URL', '//evil.example/phish'],
    ['a relative path that is not root-relative', 'evil.example/phish'],
    ['an empty value', ''],
  ])('drops %s and returns to the console root', async (_label, redirect) => {
    const callbackURL = await ssoCallbackFrom(`/login?redirect=${encodeURIComponent(redirect)}`);
    expect(callbackURL).toBe('/');
    expect(callbackURL).not.toContain('evil.example');
  });

  it('drops an unsafe redirect under the console mount, keeping the mount root', async () => {
    const callbackURL = await ssoCallbackFrom(
      `/_console/login?redirect=${encodeURIComponent('//evil.example/phish')}`,
    );
    expect(callbackURL).toBe('/_console/');
  });

  it('CONTROL: with no redirect the callback is the console root, as before', async () => {
    expect(await ssoCallbackFrom('/login')).toBe('/');
    cleanup();
    vi.restoreAllMocks();
    expect(await ssoCallbackFrom('/_console/login')).toBe('/_console/');
  });
});
