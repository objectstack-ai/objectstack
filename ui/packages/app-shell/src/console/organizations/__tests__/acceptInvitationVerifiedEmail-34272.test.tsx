// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Accepting or declining an invitation needs a verified email address: the
 * server refuses either from a session whose address is not verified, with
 * better-auth's own
 * `403 EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION`.
 * The page answers that refusal with the verification-mail screen for this
 * account's address, whose link returns here, instead of a toast. Reading the
 * invitation stays open, so the page still names it.
 *
 * The auth client is the REAL `createAuthClient` over a stubbed `fetch` that
 * answers with the server's body, as `invitationVendorRefusals-33650.test.tsx`
 * does: the code must survive the client's own error mapping to be routed.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { createAuthClient } from '@object-ui/auth';

type Answer = { status: number; body: unknown };
const answers = new Map<string, Answer>();

const PENDING = {
  id: 'inv-1',
  organizationId: 'org-42',
  organizationName: 'Acme',
  organizationSlug: 'acme',
  email: 'zhang.wei@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: '2099-03-04T12:00:00.000Z',
  inviterId: 'u-0',
  inviterEmail: 'grace@example.com',
};

/** The server's refusal, verbatim (better-auth `ORGANIZATION_ERROR_CODES`). */
const NEEDS_VERIFIED_EMAIL: Answer = {
  status: 403,
  body: {
    code: 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION',
    message: 'Email verification required before accepting or rejecting invitation',
  },
};

const fetchFn = vi.fn(async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  for (const [path, answer] of answers) {
    if (url.includes(path)) {
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

const client = createAuthClient({
  baseURL: 'http://localhost/api/auth',
  fetchFn: fetchFn as unknown as typeof fetch,
});

// ⚠️ STABLE identities: the accept page keys its fetch effect on `getInvitation`.
const auth = {
  user: { id: 'u-1', email: 'zhang.wei@example.com', name: 'Zhang Wei' },
  isAuthenticated: true,
  isLoading: false,
  getInvitation: (id: string) => client.getInvitation(id),
  acceptInvitation: (id: string) => client.acceptInvitation(id),
  rejectInvitation: (id: string) => client.rejectInvitation(id),
  switchOrganization: vi.fn(async () => undefined),
};

vi.mock('@object-ui/auth', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/auth')>()),
  useAuth: () => auth,
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m) } }));

const navigate = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const location = { pathname: '/accept-invitation/inv-1', search: '' };
  const params = { invitationId: 'inv-1' };
  return {
    ...(await importActual<typeof import('react-router-dom')>()),
    useNavigate: () => navigate,
    useLocation: () => location,
    useParams: () => params,
  };
});

import { AcceptInvitationPage } from '../manage/AcceptInvitationPage';

const en = builtInLocales.en as any;

const renderPage = () =>
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AcceptInvitationPage />
    </I18nProvider>,
  );

beforeEach(() => {
  answers.clear();
  fetchFn.mockClear();
  toastError.mockClear();
  navigate.mockClear();
  auth.switchOrganization.mockClear();
});

afterEach(() => cleanup());

describe('an accept or a decline refused for an unverified address goes to the verification mail', () => {
  it('hands over to /verify-email-prompt for this account’s address, returning here, with no toast', async () => {
    answers.set('/organization/get-invitation', { status: 200, body: PENDING });
    answers.set('/organization/accept-invitation', NEEDS_VERIFIED_EMAIL);
    renderPage();

    await screen.findByTestId('accept-invitation-role');
    fireEvent.click(screen.getByText(en.organization.accept.accept));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const target = String(navigate.mock.calls.at(-1)?.[0]);
    const [path, query] = target.split('?');
    expect(path).toBe('/verify-email-prompt');
    const sp = new URLSearchParams(query);
    expect(sp.get('email')).toBe('zhang.wei@example.com');
    expect(sp.get('redirect')).toBe('/accept-invitation/inv-1');
    expect(toastError).not.toHaveBeenCalled();
    expect(auth.switchOrganization).not.toHaveBeenCalled();
    // The refusal really came over the wire from the accept route.
    expect(
      fetchFn.mock.calls.some(([u]) => String(u instanceof Request ? u.url : u).includes('/organization/accept-invitation')),
    ).toBe(true);
  });

  it('a refused decline hands over to /verify-email-prompt alike, with no toast', async () => {
    answers.set('/organization/get-invitation', { status: 200, body: PENDING });
    answers.set('/organization/reject-invitation', NEEDS_VERIFIED_EMAIL);
    renderPage();

    await screen.findByTestId('accept-invitation-role');
    fireEvent.click(screen.getByText(en.organization.accept.decline));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const target = String(navigate.mock.calls.at(-1)?.[0]);
    const [path, query] = target.split('?');
    expect(path).toBe('/verify-email-prompt');
    const sp = new URLSearchParams(query);
    expect(sp.get('email')).toBe('zhang.wei@example.com');
    expect(sp.get('redirect')).toBe('/accept-invitation/inv-1');
    expect(toastError).not.toHaveBeenCalled();
    expect(
      fetchFn.mock.calls.some(([u]) => String(u instanceof Request ? u.url : u).includes('/organization/reject-invitation')),
    ).toBe(true);
  });

  it('CONTROL: another refusal of the same route still toasts and stays on the page', async () => {
    answers.set('/organization/get-invitation', { status: 200, body: PENDING });
    answers.set('/organization/accept-invitation', {
      status: 403,
      body: {
        code: 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
        message: 'You are not the recipient of the invitation',
      },
    });
    renderPage();

    await screen.findByTestId('accept-invitation-role');
    fireEvent.click(screen.getByText(en.organization.accept.accept));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenLastCalledWith(en.organization.errors.notTheRecipient);
    expect(navigate.mock.calls.some(([to]) => String(to).startsWith('/verify-email-prompt'))).toBe(false);
  });
});
