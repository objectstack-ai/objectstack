/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The login card names only the sign-in methods the server advertises.
 *
 * With email+password sign-in turned off (`emailPassword.enabled: false`) and
 * no SSO, the card used to read "Sign in with your organization's single
 * sign-on" with no SSO button, plus a "Use a password instead" link to a form
 * the server refuses (`EMAIL_PASSWORD_DISABLED`): `LoginForm` read the shut
 * password door as SSO enforcement. Enforcement now comes only from the
 * server's own `features.ssoEnforced`; a shut door with nothing else
 * advertised draws a plain "no sign-in method" state.
 *
 * The controls: a real SSO-enforced deployment keeps its SSO-only view, a
 * door the server does advertise (a provider, SSO, phone sign-in) keeps the
 * card usable, and a FAILED config fetch still falls back to the password
 * form (break-glass beats lock-out).
 */

import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { LoginForm, type LoginFormProps } from '../LoginForm';
import type { AuthClient, AuthPublicConfig } from '../types';

afterEach(() => cleanup());

const NO_METHOD = 'No sign-in method is available. Contact your administrator.';
const SSO_ONLY_COPY = "Sign in with your organization's single sign-on";
const BREAK_GLASS = { name: 'Use a password instead' } as const;
const SSO_BUTTON = { name: 'Sign in with SSO' } as const;
const PROVIDER_BUTTON = { name: /Continue with Acme IdP$/ } as const;
const OTP_LINK = { name: 'Sign in with verification code' } as const;
const PASSWORD_INSTEAD = { name: 'Sign in with password instead' } as const;
const BACK_TO_SSO = { name: 'Back to single sign-on' } as const;
const OIDC: AuthPublicConfig['socialProviders'] = [
  { id: 'acme-idp', name: 'Acme IdP', enabled: true, type: 'oidc' },
];

/** The QA repro: admin turned email+password off on a stock boot. */
const PASSWORD_OFF_NOTHING_ELSE: AuthPublicConfig = {
  socialProviders: [],
  emailPassword: { enabled: false },
  features: { sso: false, ssoEnforced: false },
};

function client(getConfig: AuthClient['getConfig'], overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    signIn: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    getConfig,
    signInWithProvider: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AuthClient;
}

function renderLogin(
  config: AuthPublicConfig | Error,
  props: LoginFormProps = {},
  overrides: Partial<AuthClient> = {},
) {
  const getConfig =
    config instanceof Error ? vi.fn().mockRejectedValue(config) : vi.fn().mockResolvedValue(config);
  return render(
    <AuthProvider authUrl="/api/auth" client={client(getConfig, overrides)}>
      <LoginForm registerUrl="/register" {...props} />
    </AuthProvider>,
  );
}

const configResolved = () =>
  waitFor(() => expect(screen.queryByTestId('login-config-loading')).toBeNull());

describe('LoginForm — email+password off and nothing else advertised', () => {
  it('says no sign-in method is available, with no SSO copy, no password link and no form', async () => {
    renderLogin(PASSWORD_OFF_NOTHING_ELSE);
    await configResolved();

    const state = screen.getByTestId('login-no-sign-in-method');
    expect(state.textContent).toBe(NO_METHOD);
    expect(state.getAttribute('role')).toBe('status');

    expect(screen.queryByText(SSO_ONLY_COPY)).toBeNull();
    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
    expect(screen.queryByRole('button', SSO_BUTTON)).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    // Sign-up is an email+password door too; the server refuses it here.
    expect(screen.queryByText('Sign up')).toBeNull();
    // The host's password-form description would mislead as well.
    expect(screen.queryByText(/Enter your email and password/)).toBeNull();
  });

  it('carries the host-translated label, and draws no SSO line under hideHeader', async () => {
    renderLogin(PASSWORD_OFF_NOTHING_ELSE, {
      hideHeader: true,
      labels: { noSignInMethodText: '当前没有可用的登录方式，请联系管理员。' },
    });
    await configResolved();

    expect(screen.getByTestId('login-no-sign-in-method').textContent).toBe(
      '当前没有可用的登录方式，请联系管理员。',
    );
    expect(screen.queryByText(SSO_ONLY_COPY)).toBeNull();
    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
  });
});

describe('LoginForm — doors the server does advertise stay usable', () => {
  it('keeps the SSO-only view of an SSO-enforced deployment', async () => {
    renderLogin({ socialProviders: OIDC, features: { sso: true, ssoEnforced: true } });
    await configResolved();

    expect(screen.getByText(SSO_ONLY_COPY)).toBeTruthy();
    expect(await screen.findByRole('button', PROVIDER_BUTTON)).toBeTruthy();
    expect(screen.getByRole('button', BREAK_GLASS)).toBeTruthy();
    expect(screen.queryByTestId('login-no-sign-in-method')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('keeps the SSO-only copy under declared enforcement with password off, but offers no refused password link', async () => {
    renderLogin({
      socialProviders: OIDC,
      emailPassword: { enabled: false },
      features: { sso: false, ssoEnforced: true },
    });
    await configResolved();

    expect(screen.getByText(SSO_ONLY_COPY)).toBeTruthy();
    expect(await screen.findByRole('button', PROVIDER_BUTTON)).toBeTruthy();
    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
    expect(screen.queryByTestId('login-no-sign-in-method')).toBeNull();
  });

  it('with password off and only a provider, draws the provider without SSO copy or a password link', async () => {
    renderLogin({
      socialProviders: OIDC,
      emailPassword: { enabled: false },
      features: { sso: false, ssoEnforced: false },
    });
    await configResolved();

    expect(await screen.findByRole('button', PROVIDER_BUTTON)).toBeTruthy();
    expect(screen.queryByText(SSO_ONLY_COPY)).toBeNull();
    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
    expect(screen.queryByTestId('login-no-sign-in-method')).toBeNull();
  });

  it('with password off and SSO advertised, says SSO and offers the SSO button with no refused password link', async () => {
    renderLogin({
      socialProviders: [],
      emailPassword: { enabled: false },
      features: { sso: true, ssoEnforced: false },
    });
    await configResolved();

    expect(screen.getByText(SSO_ONLY_COPY)).toBeTruthy();
    expect(screen.queryByTestId('login-no-sign-in-method')).toBeNull();
    // The SSO way in is on the first paint since #29274, so the link no longer
    // has a door to reach here: the password form it opens is one the server
    // refuses.
    expect(screen.getByRole('button', SSO_BUTTON)).toBeTruthy();
    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
  });

  it('with password off and phone sign-in on, is not the no-method state', async () => {
    renderLogin({
      socialProviders: [],
      emailPassword: { enabled: false },
      features: { phoneNumber: true, phoneNumberOtp: true },
    });
    await configResolved();

    expect(screen.queryByTestId('login-no-sign-in-method')).toBeNull();
    expect(screen.queryByText(SSO_ONLY_COPY)).toBeNull();
    // The phone ways in are on the first paint; the full matrix is below.
    expect(screen.getByRole('button', OTP_LINK)).toBeTruthy();
  });

  it('falls back to the password form when the config fetch fails (break-glass beats lock-out)', async () => {
    renderLogin(new Error('config unreachable'));
    await configResolved();

    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByTestId('login-no-sign-in-method')).toBeNull();
    expect(screen.queryByText(SSO_ONLY_COPY)).toBeNull();
  });

  it('shows the password form as before when email+password is on', async () => {
    renderLogin({ socialProviders: [], emailPassword: { enabled: true }, features: { sso: false } });
    await configResolved();

    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByText('Sign up')).toBeTruthy();
    expect(screen.queryByTestId('login-no-sign-in-method')).toBeNull();
  });
});

/**
 * The password door shut, no single sign-on offered or enforced, and a phone
 * way in advertised: the card is not collapsed into the single sign-on view.
 * The form holding the phone way in is the first paint, and no "Back to single
 * sign-on" button is drawn, since there is no single sign-on to go back to.
 * Cells with single sign-on keep their collapse and their back button.
 */
describe('LoginForm — password off, phone sign-in on, no single sign-on', () => {
  /** The QA repro: `email_password_enabled` false on a boot with phone sign-in. */
  const PHONE_ONLY: AuthPublicConfig = {
    socialProviders: [],
    emailPassword: { enabled: false },
    features: { sso: false, ssoEnforced: false, phoneNumber: true, phoneNumberOtp: true },
  };

  it('draws the phone+password form and the verification-code way in on first paint, with no SSO view', async () => {
    renderLogin(PHONE_ONLY);
    await configResolved();

    // The identifier the server still accepts is a phone number; email is refused.
    expect(screen.getByLabelText('Phone number')).toBeTruthy();
    expect(screen.queryByLabelText('Email or phone number')).toBeNull();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', OTP_LINK)).toBeTruthy();

    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
    expect(screen.queryByRole('button', BACK_TO_SSO)).toBeNull();
    expect(screen.queryByText(SSO_ONLY_COPY)).toBeNull();
    expect(screen.queryByTestId('login-no-sign-in-method')).toBeNull();
    // Sign-up and the password-form copy are email+password doors the server refuses.
    expect(screen.queryByText('Sign up')).toBeNull();
    expect(screen.queryByText(/Enter your email and password/)).toBeNull();
  });

  it('draws no back-to-SSO button in the verification-code form either, and switches back', async () => {
    renderLogin(PHONE_ONLY, { hideHeader: true });
    await configResolved();

    fireEvent.click(screen.getByRole('button', OTP_LINK));
    expect(await screen.findByLabelText('Verification code')).toBeTruthy();
    expect(screen.queryByRole('button', BACK_TO_SSO)).toBeNull();
    expect(screen.queryByText(SSO_ONLY_COPY)).toBeNull();

    // Phone+password is a door the server accepts, so the switch back is offered.
    fireEvent.click(screen.getByRole('button', PASSWORD_INSTEAD));
    expect(await screen.findByLabelText('Password')).toBeTruthy();
    expect(screen.queryByRole('button', BACK_TO_SSO)).toBeNull();
  });

  it('signs a phone number in with its password from the first paint', async () => {
    const signIn = vi.fn();
    const signInWithPhonePassword = vi
      .fn()
      .mockResolvedValue({ user: { id: 'u2' }, session: { token: 'pw-tok' } });
    renderLogin(PHONE_ONLY, {}, { signIn, signInWithPhonePassword });
    await configResolved();

    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '13800138000' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'S3cret!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(signInWithPhonePassword).toHaveBeenCalledWith('13800138000', 'S3cret!'));
    expect(signIn).not.toHaveBeenCalled();
  });

  it('with phone OTP the only way in, opens on the verification-code form with no switch to a refused password form', async () => {
    renderLogin({
      socialProviders: [],
      emailPassword: { enabled: false },
      features: { sso: false, ssoEnforced: false, phoneNumber: false, phoneNumberOtp: true },
    });
    await configResolved();

    expect(screen.getByLabelText('Phone number')).toBeTruthy();
    expect(screen.getByLabelText('Verification code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Get code' })).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByRole('button', PASSWORD_INSTEAD)).toBeNull();
    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
    expect(screen.queryByRole('button', BACK_TO_SSO)).toBeNull();
  });

  it('with phone+password the only way in, draws it with no verification-code link', async () => {
    renderLogin({
      socialProviders: [],
      emailPassword: { enabled: false },
      features: { sso: false, ssoEnforced: false, phoneNumber: true, phoneNumberOtp: false },
    });
    await configResolved();

    expect(screen.getByLabelText('Phone number')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByRole('button', OTP_LINK)).toBeNull();
    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
    expect(screen.queryByRole('button', BACK_TO_SSO)).toBeNull();
  });

  it('CONTROL: with SSO advertised as well, the card stays collapsed and the back button returns', async () => {
    renderLogin({ ...PHONE_ONLY, features: { ...PHONE_ONLY.features, sso: true } });
    await configResolved();

    expect(screen.getByText(SSO_ONLY_COPY)).toBeTruthy();
    expect(screen.getByRole('button', SSO_BUTTON)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();

    fireEvent.click(screen.getByRole('button', BREAK_GLASS));
    expect(await screen.findByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', BACK_TO_SSO)).toBeTruthy();
  });

  it('CONTROL: under declared enforcement, the card stays collapsed and the back button returns', async () => {
    renderLogin(
      {
        ...PHONE_ONLY,
        socialProviders: OIDC,
        features: { ...PHONE_ONLY.features, ssoEnforced: true },
      },
      { hideHeader: true },
    );
    await configResolved();

    expect(screen.getByText(SSO_ONLY_COPY)).toBeTruthy();
    expect(await screen.findByRole('button', PROVIDER_BUTTON)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();

    fireEvent.click(screen.getByRole('button', BREAK_GLASS));
    expect(await screen.findByLabelText('Password')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', BACK_TO_SSO));
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull());
  });
});
