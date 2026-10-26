/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * DeviceAuthPage — deviceAuthorization capability gate (framework#2874 /
 * objectui#2513).
 *
 * The RFC 8628 device-approval endpoints (`/device`, `/device/approve`,
 * `/device/deny`) only exist when the opt-in better-auth deviceAuthorization
 * plugin is wired. The page reads `features.deviceAuthorization` from the
 * public auth config and, when it is off, shows a plain "not enabled" notice
 * instead of an approve form that would only fail on submit.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { DeviceAuthPage } from '../DeviceAuthPage';

afterEach(cleanup);

function createMockClient(opts: { deviceAuthorization?: boolean; signedIn?: boolean }): AuthClient {
  return {
    getSession: vi
      .fn()
      .mockResolvedValue(
        opts.signedIn ? { user: { id: 'u1', email: 'me@example.com' }, session: {} } : null,
      ),
    getConfig: vi.fn().mockResolvedValue({
      features:
        opts.deviceAuthorization === undefined
          ? {}
          : { deviceAuthorization: opts.deviceAuthorization },
    }),
  } as unknown as AuthClient;
}

function renderDevice(client: AuthClient, search = '?user_code=WDJB-MJHT') {
  window.history.replaceState({}, '', `/auth/device${search}`);
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={[`/auth/device${search}`]}>
        <DeviceAuthPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('DeviceAuthPage — deviceAuthorization gate', () => {
  it('shows a "not enabled" notice and no approve form when the flag is off', async () => {
    renderDevice(createMockClient({ deviceAuthorization: false }));

    expect(await screen.findByText(/not enabled/i)).toBeTruthy();
    expect(screen.queryByText(/Approve device/i)).toBeNull();
  });

  it('treats an absent flag as off (opt-in default)', async () => {
    renderDevice(createMockClient({}));

    expect(await screen.findByText(/not enabled/i)).toBeTruthy();
    expect(screen.queryByText(/Approve device/i)).toBeNull();
  });

  it('renders the approve form when the flag is on and the user is signed in', async () => {
    renderDevice(createMockClient({ deviceAuthorization: true, signedIn: true }));

    expect(await screen.findByText(/Approve device/i)).toBeTruthy();
    expect(screen.queryByText(/not enabled/i)).toBeNull();
  });
});
