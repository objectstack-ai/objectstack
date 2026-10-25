/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * LoginPage — OAuth callback `?error=` banner (objectui#2458 item 1).
 *
 * better-auth redirects a failed OAuth callback (expired hand-off, replayed
 * `state`, IdP error) to its error URL with `?error=<code>`; the runtime
 * points that at the console login page. The page must surface the code as a
 * visible banner — before this fix the user landed on a silent login form
 * right after successfully entering their password on the IdP.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';

afterEach(cleanup);

function createMockClient(): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({}),
  } as unknown as AuthClient;
}

function renderLogin(search: string) {
  window.history.replaceState({}, '', `/login${search}`);
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={createMockClient()}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('LoginPage — OAuth callback error banner', () => {
  it('surfaces ?error= as a visible alert banner', async () => {
    renderLogin('?error=state_mismatch');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/state_mismatch/);
  });

  it('prefers the human-readable error_description when present', async () => {
    renderLogin('?error=access_denied&error_description=User%20cancelled');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/User cancelled/);
  });

  it('shows no banner on a plain login page', async () => {
    renderLogin('');

    // Wait for the form to settle, then assert no alert is present.
    await screen.findByLabelText('Email');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
