/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #25885 — the sign-up page links privacy and terms, as `/login` does.
 *
 * Sign-up is where a visitor accepts the terms, yet only `/login` drew the
 * legal links `GET /api/v1/auth/config` serves as `features.privacyUrl` /
 * `features.termsUrl`. The register page now draws the same footer, from the
 * same reader, and nothing for a URL the server did not send or that is not
 * http(s) / same-origin. Login's own pins stay in
 * `LoginPage.layout-12600.test.tsx`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { RegisterPage } from '../RegisterPage';

afterEach(cleanup);

function renderRegister(config: Record<string, unknown>) {
  window.history.replaceState({}, '', '/register');
  const client = {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
  } as unknown as AuthClient;
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const LEGAL = {
  features: {
    privacyUrl: 'https://legal.example.com/privacy',
    termsUrl: '/legal/terms',
  },
};

describe('RegisterPage — privacy and terms links (#25885)', () => {
  it('links privacy and terms in its footer when the auth config serves their URLs', async () => {
    renderRegister(LEGAL);

    await screen.findByLabelText('Confirm Password');
    const footer = screen.getByTestId('auth-footer');
    const privacy = screen.getByRole('link', { name: 'Privacy' });
    const terms = screen.getByRole('link', { name: 'Terms' });
    expect(footer.contains(privacy) && footer.contains(terms)).toBe(true);
    expect(privacy.getAttribute('href')).toBe(LEGAL.features.privacyUrl);
    expect(terms.getAttribute('href')).toBe(LEGAL.features.termsUrl);
    expect(privacy.getAttribute('rel')).toContain('noopener');
  });

  it('renders no legal link when the auth config serves no URL', async () => {
    renderRegister({ features: {} });

    await screen.findByLabelText('Confirm Password');
    expect(screen.queryByRole('link', { name: 'Privacy' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Terms' })).toBeNull();
  });

  it('renders no legal link for a URL that is neither http(s) nor a same-origin path', async () => {
    renderRegister({
      features: { privacyUrl: 'javascript:alert(1)', termsUrl: '//evil.example.com/terms' },
    });

    await screen.findByLabelText('Confirm Password');
    expect(screen.queryByRole('link', { name: 'Privacy' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Terms' })).toBeNull();
  });
});
