/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #25886 — the accept page names who sent the invitation.
 *
 * better-auth's `GET /organization/get-invitation` answers with the inviting
 * member's email (`inviterEmail`) beside the organization snapshot; it returns
 * no inviter name. The page shows that address under the translated
 * `organization.accept.invitedBy` label, and draws no row for an answer that
 * carries none.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

const INVITATION = {
  id: 'inv-1',
  organizationId: 'org-42',
  organizationName: 'Acme',
  email: 'ada@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: '2099-03-04T12:00:00.000Z',
  inviterId: 'u0',
  inviterEmail: 'grace@example.com',
};

const answer: { current: Record<string, unknown> } = { current: INVITATION };

// ⚠️ STABLE identities: the page keys its fetch effect on `getInvitation`, so
// a mock that minted a new function per render would loop the effect.
vi.mock('@object-ui/auth', async (importActual) => {
  const auth = {
    isAuthenticated: true,
    isLoading: false,
    getInvitation: async () => answer.current,
    acceptInvitation: async () => undefined,
    rejectInvitation: async () => undefined,
    switchOrganization: async () => undefined,
  };
  return {
    ...(await importActual<typeof import('@object-ui/auth')>()),
    useAuth: () => auth,
  };
});

vi.mock('react-router-dom', async (importActual) => {
  const navigate = () => {};
  const location = { pathname: '/accept-invitation/inv-1', search: '' };
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

afterEach(() => {
  cleanup();
  answer.current = INVITATION;
});

function renderIn(language: 'en' | 'zh'): void {
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <AcceptInvitationPage />
    </I18nProvider>,
  );
}

describe('AcceptInvitationPage — names the inviter (#25886)', () => {
  it('shows the inviting member under the "Invited by" label', async () => {
    renderIn('en');

    const inviter = await screen.findByTestId('accept-invitation-inviter');
    expect(inviter).toHaveTextContent('grace@example.com');
    expect(screen.getByText(builtInLocales.en.organization.accept.invitedBy)).toBeInTheDocument();
  });

  it('reads the label from the session language', async () => {
    renderIn('zh');

    await screen.findByTestId('accept-invitation-inviter');
    expect(screen.getByText(builtInLocales.zh.organization.accept.invitedBy)).toBeInTheDocument();
  });

  it('draws no inviter row when the answer carries no inviter address', async () => {
    const { inviterEmail: _omitted, ...withoutInviter } = INVITATION;
    answer.current = withoutInviter;
    renderIn('en');

    await screen.findByTestId('accept-invitation-role');
    expect(screen.queryByTestId('accept-invitation-inviter')).toBeNull();
    expect(screen.queryByText(builtInLocales.en.organization.accept.invitedBy)).toBeNull();
  });
});
