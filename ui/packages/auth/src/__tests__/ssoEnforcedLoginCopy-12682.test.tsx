/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12682 — the login page of an SSO-enforced environment said two
 * things that were not true.
 *
 * - While the auth config was still resolving, `LoginForm`'s header read
 *   "Enter your email and password to continue": the password form's
 *   description, on the one deployment class with no password path. The
 *   header now carries no description until the config answers.
 * - Once it answered, the provider button was followed by an "or continue with
 *   email" divider with no email form under it, because `SocialSignInButtons`
 *   always drew its divider. `LoginForm` now withholds it, through the
 *   component's `hideDivider` prop, for as long as the password form is
 *   collapsed; the break-glass link brings both back.
 *
 * The controls: a server that does not enforce SSO keeps the divider and the
 * description exactly as before, and `SocialSignInButtons` without the prop
 * still draws its divider. `RegisterForm`'s divider, which takes the default,
 * is held by `socialButtonLabels-10900.test.tsx`.
 */

import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { LoginForm } from '../LoginForm';
import { SocialSignInButtons } from '../SocialSignInButtons';
import type { AuthClient, AuthPublicConfig } from '../types';

afterEach(() => cleanup());

const PROVIDERS: AuthPublicConfig['socialProviders'] = [
  { id: 'acme-idp', name: 'Acme IdP', enabled: true, type: 'oidc' },
];
const ENFORCED: AuthPublicConfig = { socialProviders: PROVIDERS, features: { ssoEnforced: true } };
const OPEN: AuthPublicConfig = { socialProviders: PROVIDERS, features: { ssoEnforced: false } };

const PASSWORD_COPY = /Enter your email and password/;
const SSO_ONLY_COPY = "Sign in with your organization's single sign-on";
const DIVIDER = 'or continue with email';
const PROVIDER_BUTTON = { name: /Continue with Acme IdP$/ } as const;
const BREAK_GLASS = { name: 'Use a password instead' } as const;

function client(getConfig: AuthClient['getConfig']): AuthClient {
  return {
    signIn: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    getConfig,
    signInWithProvider: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthClient;
}

/** Render with the config read held open; `answer` settles it. */
function renderPending(node: React.ReactNode) {
  let answer!: (config: AuthPublicConfig) => void;
  const pending = new Promise<AuthPublicConfig>((resolve) => {
    answer = resolve;
  });
  render(
    <AuthProvider authUrl="/api/auth" client={client(vi.fn().mockReturnValue(pending))}>
      {node}
    </AuthProvider>,
  );
  return { answer };
}

function renderWith(node: React.ReactNode, config: AuthPublicConfig) {
  return render(
    <AuthProvider authUrl="/api/auth" client={client(vi.fn().mockResolvedValue(config))}>
      {node}
    </AuthProvider>,
  );
}

const configResolved = () =>
  waitFor(() => expect(screen.queryByTestId('login-config-loading')).toBeNull());

describe('LoginForm — the header while the auth config resolves (objectui#12682)', () => {
  it('carries no password copy while pending, then the SSO-only description under enforcement', async () => {
    const { answer } = renderPending(<LoginForm />);

    expect(screen.getByTestId('login-config-loading')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign in to your account');
    expect(screen.queryByText(PASSWORD_COPY)).toBeNull();

    answer(ENFORCED);
    await configResolved();
    expect(screen.getByText(SSO_ONLY_COPY)).toBeTruthy();
    expect(screen.queryByText(PASSWORD_COPY)).toBeNull();
  });

  it('holds back a description the host passed, and shows it once a server without enforcement answers', async () => {
    // `DefaultLoginPage` passes its translated `auth.login.description` here.
    const { answer } = renderPending(<LoginForm description="Use your work email and password" />);

    expect(screen.getByTestId('login-config-loading')).toBeTruthy();
    expect(screen.queryByText('Use your work email and password')).toBeNull();

    answer(OPEN);
    await configResolved();
    expect(screen.getByText('Use your work email and password')).toBeTruthy();
  });

  it('with hideHeader, renders no description line at all while pending', async () => {
    const { answer } = renderPending(<LoginForm hideHeader />);

    expect(screen.getByTestId('login-config-loading')).toBeTruthy();
    expect(screen.queryByText(PASSWORD_COPY)).toBeNull();
    expect(screen.queryByText(SSO_ONLY_COPY)).toBeNull();

    answer(ENFORCED);
    expect(await screen.findByText(SSO_ONLY_COPY)).toBeTruthy();
  });

  it('shows the description again when the config read fails (the password-form fallback)', async () => {
    render(
      <AuthProvider
        authUrl="/api/auth"
        client={client(vi.fn().mockRejectedValue(new Error('config down')))}
      >
        <LoginForm />
      </AuthProvider>,
    );

    await screen.findByLabelText('Email');
    expect(screen.getByText(PASSWORD_COPY)).toBeTruthy();
  });
});

describe('LoginForm — the provider divider under SSO enforcement (objectui#12682)', () => {
  it('draws no divider while the password form is collapsed; the break-glass link brings both back', async () => {
    renderWith(<LoginForm />, ENFORCED);

    // The provider button proves `SocialSignInButtons` has resolved its own
    // config read, so the divider's absence below is a reading, not a race.
    await screen.findByRole('button', PROVIDER_BUTTON);
    await screen.findByRole('button', BREAK_GLASS);
    expect(screen.queryByText(DIVIDER)).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();

    fireEvent.click(screen.getByRole('button', BREAK_GLASS));
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(screen.getByText(DIVIDER)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to single sign-on' }));
    await screen.findByRole('button', BREAK_GLASS);
    expect(screen.queryByText(DIVIDER)).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('keeps the divider, the email form and the description when the server does not enforce SSO', async () => {
    renderWith(<LoginForm description="Form description" />, OPEN);

    await screen.findByRole('button', PROVIDER_BUTTON);
    expect(screen.getByText(DIVIDER)).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByText('Form description')).toBeTruthy();
  });
});

describe('SocialSignInButtons — hideDivider (objectui#12682)', () => {
  it('draws its divider by default', async () => {
    renderWith(<SocialSignInButtons />, OPEN);

    await screen.findByRole('button', PROVIDER_BUTTON);
    expect(screen.getByText(DIVIDER)).toBeTruthy();
  });

  it('draws the provider buttons and no divider when hideDivider is set', async () => {
    renderWith(<SocialSignInButtons hideDivider dividerText="or use email" />, OPEN);

    await screen.findByRole('button', PROVIDER_BUTTON);
    expect(screen.queryByText('or use email')).toBeNull();
    expect(screen.queryByText(DIVIDER)).toBeNull();
  });
});
