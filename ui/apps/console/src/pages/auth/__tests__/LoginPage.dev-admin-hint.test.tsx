/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * LoginPage — the dev-seeded admin row (objectui#12600; first shipped as a
 * banner for the framework 15.1 third-party eval).
 *
 * The runtime seeds an admin on an empty dev DB and reports it on
 * `/auth/config` as `devSeedAdmin` ONLY in development while the default
 * password still verifies. The page turns that into the card's last row: a
 * "Local development instance" label and a chip that signs in as that admin
 * through the same `signIn` the form submits with.
 *
 * Pinned here:
 *  - the row renders only when the server reports `devSeedAdmin`;
 *  - ⛔ the password never reaches the DOM — not as text, not in an attribute,
 *    not in a hidden element — read off the whole document's markup;
 *  - the chip hands the reported email and password to `signIn`, and a signed-in
 *    user moves the page to its post-login state;
 *  - a refused sign-in says why and gives the chip back;
 *  - after the chip's sign-in the page hands over exactly as after a typed one:
 *    the same landing, a safe `?redirect=`, and the SSO hand-off's authorize
 *    replay (the typed path's hand-off is pinned beside it, since the page's
 *    `?redirect=` and SSO behaviour must not change).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { LoginPage } from '../LoginPage';
import { followOauthAuthorize } from '../followAuthorize';
import { withConsoleBase } from '../../../utils/consoleBase';

// The SSO hand-off replays the authorize request through this helper, a
// fetch-and-follow; the pins below read whether the page called it, and with
// which query string.
vi.mock('../followAuthorize', () => ({ followOauthAuthorize: vi.fn() }));

/** Distinctive, so a hit in the markup can only be this value. */
const SEED_PASSWORD = 'seed-Pw-12600-x7q';
const SEED_EMAIL = 'admin@objectos.ai';
const DEV_SEED = { devSeedAdmin: { email: SEED_EMAIL, password: SEED_PASSWORD } };

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
  vi.mocked(followOauthAuthorize).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function createMockClient(
  config: Record<string, unknown>,
  signIn: AuthClient['signIn'] = vi.fn().mockResolvedValue({
    user: { id: 'u1', name: 'Admin', email: SEED_EMAIL },
    session: { token: 'tok' },
  }),
): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
    signIn,
  } as unknown as AuthClient;
}

/** `search` lands on both the router and `window.location`: the page reads `?redirect=` from the one and the SSO hand-off from the other. */
function renderLogin(client: AuthClient, search = '') {
  window.history.replaceState({}, '', `/login${search}`);
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('LoginPage — the dev-seeded admin row (objectui#12600)', () => {
  it('renders the row and its sign-in chip when the server reports devSeedAdmin', async () => {
    renderLogin(createMockClient(DEV_SEED));

    const row = await screen.findByTestId('dev-admin-hint');
    expect(row.textContent).toContain('Local development instance');
    const chip = screen.getByTestId('dev-admin-signin');
    expect(chip.textContent).toContain('Sign in as dev admin');
    expect(chip.getAttribute('title')).toBe(SEED_EMAIL);
  });

  it('never puts the password in the DOM: not as text, not in an attribute, not hidden', async () => {
    renderLogin(createMockClient(DEV_SEED));

    await screen.findByTestId('dev-admin-signin');
    expect(document.documentElement.outerHTML).not.toContain(SEED_PASSWORD);
  });

  it('renders no row without devSeedAdmin (production config)', async () => {
    renderLogin(createMockClient({ emailPassword: { enabled: true, disableSignUp: false } }));

    // The form appears once the config read has settled; the row must not.
    await screen.findByLabelText('Email');
    expect(screen.queryByTestId('dev-admin-hint')).toBeNull();
    expect(screen.queryByTestId('dev-admin-signin')).toBeNull();
  });

  it('signs in with the reported email and password through the same signIn the form uses', async () => {
    const signIn = vi.fn().mockResolvedValue({
      user: { id: 'u1', name: 'Admin', email: SEED_EMAIL },
      session: { token: 'tok' },
    });
    renderLogin(createMockClient(DEV_SEED, signIn));
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('dev-admin-signin'));

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith({ email: SEED_EMAIL, password: SEED_PASSWORD });
    // A signed-in user moves the page to its post-login state.
    expect(await screen.findByText('Signing you in…')).toBeTruthy();
  });

  it('says why a refused sign-in failed and gives the chip back', async () => {
    const refusal = Object.assign(new Error('Invalid email or password'), {
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });
    const signIn = vi.fn().mockRejectedValue(refusal);
    renderLogin(createMockClient(DEV_SEED, signIn));
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('dev-admin-signin'));

    const row = screen.getByTestId('dev-admin-hint');
    const alert = await waitFor(() => {
      const el = row.querySelector('[role="alert"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(alert.textContent).not.toBe('');
    expect((screen.getByTestId('dev-admin-signin') as HTMLButtonElement).disabled).toBe(false);
    expect(document.documentElement.outerHTML).not.toContain(SEED_PASSWORD);
  });

  it('shows the email and no chip for a seed reported without a password', async () => {
    renderLogin(createMockClient({ devSeedAdmin: { email: SEED_EMAIL } }));

    const row = await screen.findByTestId('dev-admin-hint');
    expect(row.textContent).toContain(SEED_EMAIL);
    expect(screen.queryByTestId('dev-admin-signin')).toBeNull();
  });
});

describe('LoginPage — after the chip, the same hand-off as a typed sign-in (objectui#12600)', () => {
  const SSO_SEARCH = `?client_id=c1&redirect_uri=${encodeURIComponent('https://rp.example.com/cb')}`;

  /** The URL the page sends the browser to once a user is signed in. */
  async function landing(): Promise<string> {
    const assign = vi.mocked(window.location.assign);
    await waitFor(() => expect(assign).toHaveBeenCalled());
    return String(assign.mock.calls[0]![0]);
  }

  async function typeAndSubmit() {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), SEED_EMAIL);
    await user.type(screen.getByLabelText('Password'), SEED_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
  }

  it('lands where a typed sign-in lands: the console root, which resolves to home', async () => {
    renderLogin(createMockClient({}));
    await typeAndSubmit();
    const typed = await landing();

    cleanup();
    window.localStorage.clear();
    vi.mocked(window.location.assign).mockClear();

    renderLogin(createMockClient(DEV_SEED));
    await userEvent.setup().click(await screen.findByTestId('dev-admin-signin'));

    expect(await landing()).toBe(typed);
    expect(typed).toBe(withConsoleBase('/'));
  });

  it('honours a safe ?redirect= after the chip, as after a typed sign-in', async () => {
    renderLogin(createMockClient(DEV_SEED), `?redirect=${encodeURIComponent('/settings')}`);
    await userEvent.setup().click(await screen.findByTestId('dev-admin-signin'));

    expect(await landing()).toBe(withConsoleBase('/settings'));
  });

  it('a typed sign-in under an SSO hand-off shows the relying party and replays the authorize request', async () => {
    renderLogin(createMockClient({}), SSO_SEARCH);

    expect(await screen.findByText('Continue to rp.example.com')).toBeTruthy();
    await typeAndSubmit();

    await waitFor(() => expect(followOauthAuthorize).toHaveBeenCalledTimes(1));
    expect(followOauthAuthorize).toHaveBeenCalledWith(SSO_SEARCH);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('the chip under an SSO hand-off replays the authorize request too', async () => {
    renderLogin(createMockClient(DEV_SEED), SSO_SEARCH);
    await userEvent.setup().click(await screen.findByTestId('dev-admin-signin'));

    await waitFor(() => expect(followOauthAuthorize).toHaveBeenCalledTimes(1));
    expect(followOauthAuthorize).toHaveBeenCalledWith(SSO_SEARCH);
    expect(window.location.assign).not.toHaveBeenCalled();
  });
});
