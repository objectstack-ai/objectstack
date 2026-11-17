/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34257 — the accept page's one-step path. A signed-out visitor
 * whose invitation link carries the mailbox proof sees one form (a name and a
 * password, or a provider sign-in) instead of the sign-in redirect; a link
 * without the proof keeps today's path.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

const en = builtInLocales.en.organization.accept;

const INVITATION = {
  id: 'inv-1',
  organizationId: 'org-42',
  organizationName: 'Acme',
  email: 'ada@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: '2099-03-04T12:00:00.000Z',
  inviterId: 'u0',
};

const PREVIEW = { organizationName: 'Acme', inviterName: 'Grace', email: 'a***@example.com' };

const socialProps: { current: Record<string, unknown> | null } = { current: null };

// STABLE identities: the page keys its effects on these functions.
const auth = {
  isAuthenticated: false,
  isLoading: false,
  getInvitation: vi.fn(async () => INVITATION),
  getInvitationPreview: vi.fn(async () => PREVIEW as typeof PREVIEW | null),
  acceptInvitation: vi.fn(async () => undefined),
  acceptInvitationOneStep: vi.fn(async (): Promise<unknown> => ({ outcome: 'accepted', organizationId: 'org-42' })),
  rejectInvitation: vi.fn(async () => undefined),
  switchOrganization: vi.fn(async () => undefined),
};

vi.mock('@object-ui/auth', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/auth')>()),
  useAuth: () => auth,
  SocialSignInButtons: (props: Record<string, unknown>) => {
    socialProps.current = props;
    return <div data-testid="social-sign-in" />;
  },
}));

const navigate = vi.fn();
const location = { pathname: '/accept-invitation/inv-1', search: '' };
vi.mock('react-router-dom', async (importActual) => {
  const params = { invitationId: 'inv-1' };
  return {
    ...(await importActual<typeof import('react-router-dom')>()),
    useNavigate: () => navigate,
    useLocation: () => location,
    useParams: () => params,
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AcceptInvitationPage } from '../manage/AcceptInvitationPage';

const LOGIN_REDIRECT = '/login?redirect=' + encodeURIComponent('/accept-invitation/inv-1');

function arriveAt(url: string, signedIn: boolean): void {
  window.history.replaceState(null, '', url);
  location.search = new URL(url, 'http://localhost').search;
  auth.isAuthenticated = signedIn;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AcceptInvitationPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  socialProps.current = null;
  auth.getInvitationPreview.mockImplementation(async () => PREVIEW);
  auth.acceptInvitationOneStep.mockImplementation(async () => ({ outcome: 'accepted', organizationId: 'org-42' }));
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  location.search = '';
});

function fillAndSubmit(): void {
  fireEvent.change(screen.getByLabelText(en.proofNameLabel), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText(en.proofPasswordLabel), { target: { value: 'S3cure!pass' } });
  fireEvent.click(screen.getByRole('button', { name: en.proofSubmit }));
}

describe('AcceptInvitationPage — one-step acceptance (objectstack#34257)', () => {
  it('a signed-out visitor holding the proof sees the one form, not the sign-in redirect', async () => {
    arriveAt('/accept-invitation/inv-1#proof=p-1', false);

    expect(await screen.findByTestId('accept-invitation-one-step')).toBeInTheDocument();
    expect(await screen.findByText('Join Acme')).toBeInTheDocument();
    expect(screen.getByTestId('social-sign-in')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('the proof leaves the address bar once read', async () => {
    arriveAt('/accept-invitation/inv-1#proof=p-1', false);

    await screen.findByTestId('accept-invitation-one-step');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('p-1');
  });

  it('the provider sign-in returns to this page without the proof', async () => {
    arriveAt('/accept-invitation/inv-1#proof=p-1', false);

    await screen.findByTestId('social-sign-in');
    const callbackURL = String(socialProps.current?.callbackURL);
    expect(new URL(callbackURL).pathname).toBe('/accept-invitation/inv-1');
    expect(callbackURL).not.toContain('p-1');
  });

  it('one submit sends the name, the password and the proof, and an acceptance shows the joined state', async () => {
    arriveAt('/accept-invitation/inv-1#proof=p-1', false);
    await screen.findByText('Join Acme');

    fillAndSubmit();

    expect(await screen.findByTestId('accept-invitation-joined')).toHaveTextContent('Welcome to Acme.');
    expect(auth.acceptInvitationOneStep).toHaveBeenCalledWith({
      invitationId: 'inv-1',
      proof: 'p-1',
      name: 'Ada',
      password: 'S3cure!pass',
    });
    expect(screen.getByRole('button', { name: en.continue })).toBeInTheDocument();
  });

  it('an address with an account hands over to the sign-in, as today', async () => {
    auth.acceptInvitationOneStep.mockImplementation(async () => ({ outcome: 'sign_in' }));
    arriveAt('/accept-invitation/inv-1#proof=p-1', false);
    await screen.findByText('Join Acme');

    fillAndSubmit();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(LOGIN_REDIRECT));
  });

  it('a refused proof says the link can no longer be used', async () => {
    auth.acceptInvitationOneStep.mockImplementation(async () => {
      throw Object.assign(new Error('no'), { code: 'INVALID_TOKEN', status: 400 });
    });
    arriveAt('/accept-invitation/inv-1#proof=p-1', false);
    await screen.findByText('Join Acme');

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(en.proofInvalid);
    expect(screen.queryByTestId('accept-invitation-joined')).toBeNull();
  });

  it('a link without the proof keeps the sign-in redirect', async () => {
    arriveAt('/accept-invitation/inv-1', false);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(LOGIN_REDIRECT));
    expect(screen.queryByTestId('accept-invitation-one-step')).toBeNull();
    expect(auth.acceptInvitationOneStep).not.toHaveBeenCalled();
  });

  it('back from a provider sign-in, the page redeems the invitation for the session', async () => {
    arriveAt('/accept-invitation/inv-1?via=provider', true);

    expect(await screen.findByTestId('accept-invitation-joined')).toHaveTextContent('Welcome to Acme.');
    expect(auth.acceptInvitationOneStep).toHaveBeenCalledTimes(1);
    expect(auth.acceptInvitationOneStep).toHaveBeenCalledWith({ invitationId: 'inv-1' });
    expect(auth.switchOrganization).toHaveBeenCalledWith('org-42');
    expect(window.location.search).toBe('');
  });

  it('back from a provider sign-in with an address that is not the verified invited one, the page asks for verification', async () => {
    auth.acceptInvitationOneStep.mockImplementation(async () => ({ outcome: 'verify_email' }));
    arriveAt('/accept-invitation/inv-1?via=provider', true);

    expect(await screen.findByTestId('accept-invitation-verify-email')).toHaveTextContent(en.verifyEmailTitle);
    expect(screen.queryByTestId('accept-invitation-joined')).toBeNull();
  });

  it('a signed-in visitor without the provider return keeps the Accept button path', async () => {
    arriveAt('/accept-invitation/inv-1', true);

    expect(await screen.findByRole('button', { name: en.accept })).toBeInTheDocument();
    expect(auth.acceptInvitationOneStep).not.toHaveBeenCalled();
  });
});
