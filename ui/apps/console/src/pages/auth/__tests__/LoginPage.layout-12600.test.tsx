/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console login page's layout (objectui#12600): one accent, the card's own
 * header, provider buttons only with a provider, and a footer whose legal links
 * exist only when the server's auth config serves their URLs.
 *
 * The sign-up line's rule is pinned where it lives — `decideSignUpOffer`, read
 * by `LoginPage.sign-up-gate-11634.test.tsx` and
 * `signUpFollowsPosture-11691.test.tsx` — and the dev-admin row in
 * `LoginPage.dev-admin-hint.test.tsx`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';
import { AuthLayout } from '../AuthLayout';

const HERE = dirname(fileURLToPath(import.meta.url));

afterEach(cleanup);

function createMockClient(config: Record<string, unknown>): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
  } as unknown as AuthClient;
}

function renderLogin(config: Record<string, unknown>) {
  window.history.replaceState({}, '', '/login');
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={createMockClient(config)}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const LEGAL = {
  features: {
    privacyUrl: 'https://legal.example.com/privacy',
    termsUrl: 'https://legal.example.com/terms',
  },
};

describe('AuthLayout — one accent (objectui#12600)', () => {
  it('names no indigo class in its source', () => {
    const source = readFileSync(join(HERE, '..', 'AuthLayout.tsx'), 'utf8');
    expect(source).not.toMatch(/indigo-/);
  });

  it('draws the brand tile and the glow from --primary, and nothing indigo', () => {
    const { container } = render(
      <AuthLayout>
        <p>form</p>
      </AuthLayout>,
    );
    expect(container.querySelectorAll('[class*="indigo"]')).toHaveLength(0);
    expect(screen.getByTestId('auth-brand-tile').className).toContain('bg-primary');
    expect(screen.getByTestId('auth-glow').className).toContain('bg-primary/10');
  });
});

describe('LoginPage — the card and its footer (objectui#12600)', () => {
  it('draws one header, its own: LoginForm renders none', async () => {
    renderLogin({});

    await screen.findByLabelText('Email');
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Welcome back');
    expect(screen.getByText('Sign in to continue your work')).toBeTruthy();
    expect(screen.queryByText('Sign in to your account')).toBeNull();
  });

  it('renders no provider button and no "or" divider without a provider', async () => {
    renderLogin({ socialProviders: [] });

    await screen.findByLabelText('Email');
    expect(screen.queryByRole('button', { name: /Continue with/ })).toBeNull();
    expect(screen.queryByText('or continue with email')).toBeNull();
  });

  it('renders one provider button and the divider when a provider is configured', async () => {
    renderLogin({ socialProviders: [{ id: 'github', name: 'GitHub', enabled: true }] });

    expect(await screen.findByRole('button', { name: 'Continue with GitHub' })).toBeTruthy();
    expect(screen.getByText('or continue with email')).toBeTruthy();
  });

  it('links privacy and terms when the auth config serves their URLs', async () => {
    renderLogin(LEGAL);

    const footer = await screen.findByTestId('auth-footer');
    const privacy = await screen.findByRole('link', { name: 'Privacy' });
    const terms = screen.getByRole('link', { name: 'Terms' });
    expect(footer.contains(privacy) && footer.contains(terms)).toBe(true);
    expect(privacy.getAttribute('href')).toBe(LEGAL.features.privacyUrl);
    expect(terms.getAttribute('href')).toBe(LEGAL.features.termsUrl);
    expect(privacy.getAttribute('rel')).toContain('noopener');
  });

  it('renders no legal link when the auth config serves no URL', async () => {
    renderLogin({ features: {} });

    await screen.findByLabelText('Email');
    expect(screen.getByTestId('auth-footer').querySelectorAll('a')).toHaveLength(0);
  });

  it('renders no legal link for a URL that is neither http(s) nor a same-origin path', async () => {
    renderLogin({
      features: { privacyUrl: 'javascript:alert(1)', termsUrl: '//evil.example.com/terms' },
    });

    await screen.findByLabelText('Email');
    expect(screen.getByTestId('auth-footer').querySelectorAll('a')).toHaveLength(0);
  });
});
