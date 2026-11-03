/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Under declared SSO enforcement (`features.ssoEnforced` with
 * `features.sso`), the email-routed "Sign in with SSO" button is the way in.
 * It used to render only inside the password form, which enforcement keeps
 * collapsed until "Use a password instead" is clicked, so the first paint
 * offered no SSO control at all. The first paint now carries the email field
 * and the SSO button, and no password field; the break-glass link still
 * reveals the password form.
 *
 * The same holds when the password door is shut (`emailPassword.enabled:
 * false`) and the server advertises SSO without enforcing it: that collapses
 * the same form. There the break-glass link is no longer offered: the
 * password form it would open is one the server refuses, unless phone+password
 * sign-in is on.
 *
 * The controls: federated providers only, a server whose password form is
 * shown, and the no-method state keep their views.
 */
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { LoginForm } from '../LoginForm';
import type { AuthClient, AuthPublicConfig } from '../types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SSO_BUTTON = { name: 'Sign in with SSO' } as const;
const BREAK_GLASS = { name: 'Use a password instead' } as const;
const BACK_TO_SSO = { name: 'Back to single sign-on' } as const;
const PROVIDER_BUTTON = { name: /Continue with Acme IdP$/ } as const;
const DIVIDER = 'or continue with email';
const OIDC: AuthPublicConfig['socialProviders'] = [
  { id: 'acme-idp', name: 'Acme IdP', enabled: true, type: 'oidc' },
];

/** The card's staging reading of an SSO-enforced deployment with a registered OIDC provider. */
const ENFORCED_SSO: AuthPublicConfig = {
  socialProviders: [],
  emailPassword: { enabled: true, disableSignUp: true },
  features: { sso: true, ssoEnforced: true },
};

function renderLogin(config: AuthPublicConfig) {
  const client = {
    signIn: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
    signInWithProvider: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthClient;
  return render(
    <AuthProvider authUrl="/api/auth" client={client}>
      <LoginForm registerUrl="/register" />
    </AuthProvider>,
  );
}

const configResolved = () =>
  waitFor(() => expect(screen.queryByTestId('login-config-loading')).toBeNull());

describe('LoginForm — SSO enforcement with SSO advertised: the first paint is the SSO path', () => {
  it('draws the email field and the SSO button, and no password field', async () => {
    renderLogin(ENFORCED_SSO);
    await configResolved();

    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByRole('button', SSO_BUTTON)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', BREAK_GLASS)).toBeTruthy();
    expect(screen.queryByText('Sign up')).toBeNull();
  });

  it('routes the entered email to the IdP from the first paint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'No SSO provider for that domain' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderLogin(ENFORCED_SSO);
    await configResolved();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' jane@acme.example ' } });
    fireEvent.click(screen.getByRole('button', SSO_BUTTON));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/sign-in/sso');
    expect(JSON.parse(String(init.body)).email).toBe('jane@acme.example');
    expect(await screen.findByText('No SSO provider for that domain')).toBeTruthy();
  });

  it('keeps "Use a password instead" as the break-glass route to the password form, and back', async () => {
    renderLogin(ENFORCED_SSO);
    await configResolved();

    fireEvent.click(screen.getByRole('button', BREAK_GLASS));
    expect(await screen.findByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', SSO_BUTTON)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', BACK_TO_SSO));
    await screen.findByRole('button', BREAK_GLASS);
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', SSO_BUTTON)).toBeTruthy();
  });

  it('separates the provider buttons from the SSO email field with the divider', async () => {
    renderLogin({ ...ENFORCED_SSO, socialProviders: OIDC });
    await configResolved();

    expect(await screen.findByRole('button', PROVIDER_BUTTON)).toBeTruthy();
    expect(screen.getByText(DIVIDER)).toBeTruthy();
    expect(screen.getByRole('button', SSO_BUTTON)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
});

describe('LoginForm — password door shut with SSO advertised: the first paint is the SSO path too', () => {
  it('draws the email field and the SSO button, and no password field, without enforcement', async () => {
    renderLogin({
      socialProviders: [],
      emailPassword: { enabled: false },
      features: { sso: true, ssoEnforced: false },
    });
    await configResolved();

    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByRole('button', SSO_BUTTON)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByTestId('login-no-sign-in-method')).toBeNull();
    // The password form the link would open is one the server refuses.
    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
  });

  it('keeps the link when phone+password is a door the server still accepts', async () => {
    renderLogin({
      socialProviders: [],
      emailPassword: { enabled: false },
      features: { sso: true, ssoEnforced: false, phoneNumber: true },
    });
    await configResolved();

    expect(screen.getByRole('button', SSO_BUTTON)).toBeTruthy();
    expect(screen.getByRole('button', BREAK_GLASS)).toBeTruthy();
  });
});

describe('LoginForm — the views around it stay as they were', () => {
  it('enforcement with federated providers only: the providers and the link, no email field', async () => {
    renderLogin({ socialProviders: OIDC, features: { sso: false, ssoEnforced: true } });
    await configResolved();

    expect(await screen.findByRole('button', PROVIDER_BUTTON)).toBeTruthy();
    expect(screen.getByRole('button', BREAK_GLASS)).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('button', SSO_BUTTON)).toBeNull();
    expect(screen.queryByText(DIVIDER)).toBeNull();
  });

  it('no enforcement: the password form, with the SSO button inside it', async () => {
    renderLogin({ socialProviders: [], features: { sso: true, ssoEnforced: false } });
    await configResolved();

    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', SSO_BUTTON)).toBeTruthy();
    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
    expect(screen.queryByTestId('login-sso-email-form')).toBeNull();
  });

  it('password off and nothing else advertised: the no-method statement', async () => {
    renderLogin({
      socialProviders: [],
      emailPassword: { enabled: false },
      features: { sso: false, ssoEnforced: false },
    });

    expect(await screen.findByTestId('login-no-sign-in-method')).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('button', SSO_BUTTON)).toBeNull();
  });
});
