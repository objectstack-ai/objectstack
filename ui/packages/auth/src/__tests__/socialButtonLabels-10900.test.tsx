/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10900 — the social provider buttons and the divider under them
 * reach `LoginForm` / `RegisterForm`'s `labels`, the one channel this package
 * localizes through.
 *
 * The 2026-09-28 cloud E2E, browser in zh-CN, read `Continue with ObjectStack`
 * and `OR CONTINUE WITH EMAIL` on the environment login page. Both strings were
 * `SocialSignInButtons` defaults that no label reached: the forms rendered the
 * buttons with no text props, and their `orText` label — documented as this
 * very divider — was defaulted and then never rendered anywhere. `orText` now
 * feeds the divider and `socialButton` the button, a `{provider}` template so a
 * translation places the name where its grammar needs it.
 *
 * Unset labels are the control: the English an embedder without labels has
 * always seen must not move.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { LoginForm } from '../LoginForm';
import { RegisterForm } from '../RegisterForm';
import type { AuthClient, AuthPublicConfig } from '../types';

afterEach(() => cleanup());

const CONFIG: AuthPublicConfig = {
  socialProviders: [{ id: 'objectstack-cloud', name: 'ObjectStack', enabled: true, type: 'oidc' }],
};

function client(config: AuthPublicConfig): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
    signInWithProvider: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthClient;
}

function renderIn(node: React.ReactNode, config: AuthPublicConfig = CONFIG) {
  return render(
    <AuthProvider authUrl="/api/auth" client={client(config)}>
      {node}
    </AuthProvider>,
  );
}

// Names are matched at their END: an unknown provider id renders a one-letter
// icon badge (`ProviderIcon`) inside the button, ahead of the label.
describe('LoginForm — social button labels (objectui#10900)', () => {
  it('unset labels keep the English defaults', async () => {
    renderIn(<LoginForm />);
    expect(await screen.findByRole('button', { name: /Continue with ObjectStack$/ })).toBeTruthy();
    expect(screen.getByText('or continue with email')).toBeTruthy();
  });

  it('socialButton fills {provider} with the provider name, and orText is the divider', async () => {
    renderIn(<LoginForm labels={{ socialButton: '使用 {provider} 继续', orText: '或使用邮箱继续' }} />);
    expect(await screen.findByRole('button', { name: /使用 ObjectStack 继续$/ })).toBeTruthy();
    expect(screen.getByText('或使用邮箱继续')).toBeTruthy();
    expect(screen.queryByText(/Continue with/)).toBeNull();
    expect(screen.queryByText('or continue with email')).toBeNull();
  });

  it('a provider name is inserted as text, never read as a replacement pattern', async () => {
    // As a plain replacement STRING, `$&` would echo the matched `{provider}`
    // back: "Continue with Acme {provider} Co".
    renderIn(<LoginForm />, {
      socialProviders: [{ id: 'acme-sso', name: 'Acme $& Co', enabled: true, type: 'oidc' }],
    });
    const button = await screen.findByRole('button', { name: /Continue with Acme \$& Co$/ });
    expect(button.textContent).not.toContain('{provider}');
  });
});

describe('RegisterForm — social button labels (objectui#10900)', () => {
  it('unset labels keep the English defaults', async () => {
    renderIn(<RegisterForm />);
    expect(await screen.findByRole('button', { name: /Sign up with ObjectStack$/ })).toBeTruthy();
    expect(screen.getByText('or continue with email')).toBeTruthy();
  });

  it('socialButton and orText reach the sign-up buttons and divider', async () => {
    renderIn(<RegisterForm labels={{ socialButton: '使用 {provider} 注册', orText: '或使用邮箱继续' }} />);
    expect(await screen.findByRole('button', { name: /使用 ObjectStack 注册$/ })).toBeTruthy();
    expect(screen.getByText('或使用邮箱继续')).toBeTruthy();
    expect(screen.queryByText(/Sign up with/)).toBeNull();
  });
});
