/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * LoginPage — a sign-up-disabled deployment offers no "Sign up" link
 * (objectui#11634).
 *
 * The page reads `/auth/config` and, when the server reports
 * `emailPassword.disableSignUp: true`, hands `registerUrl={undefined}` to
 * `<LoginForm>`. The form used to default `registerUrl` to `'/register'`, so
 * that `undefined` brought the link straight back. The form no longer has a
 * default; this pins the page-level outcome.
 *
 * The dev-seeded admin hint is set by the SAME config read that sets the
 * sign-up gate, so its appearance is the proof that the config was applied
 * before the link is judged — the same signal the card's reproduction used.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
});

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

const DEV_SEED = { devSeedAdmin: { email: 'admin@objectos.ai', password: 'admin123' } };
const SIGN_UP_LINK = { name: 'Sign up' } as const;

describe('LoginPage — the sign-up link follows emailPassword.disableSignUp (objectui#11634)', () => {
  it('renders no sign-up link when the server reports disableSignUp: true', async () => {
    renderLogin({ ...DEV_SEED, emailPassword: { enabled: true, disableSignUp: true } });

    await screen.findByTestId('dev-admin-hint');
    await screen.findByLabelText('Email');
    expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
  });

  it('keeps the sign-up link when the server reports disableSignUp: false', async () => {
    renderLogin({ ...DEV_SEED, emailPassword: { enabled: true, disableSignUp: false } });

    await screen.findByTestId('dev-admin-hint');
    await screen.findByLabelText('Email');
    expect(screen.getByRole('link', SIGN_UP_LINK).getAttribute('href')).toBe('/register');
  });
});
