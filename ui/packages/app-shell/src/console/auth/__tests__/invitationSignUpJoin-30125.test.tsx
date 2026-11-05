/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #30125 — on `DefaultRegisterPage`, registering from an invitation link joins
 * that invitation's organization and enters the console root, instead of
 * leaving the invitation behind (the page used to go to `/` and the invitee
 * had to open the link again to reach "Accept invitation").
 *
 *  - the sign-up accepts the invitation its `?redirect=` names, switches the
 *    session to that organization, and enters the root once;
 *  - the server refusing the read: nothing is accepted and the page opens the
 *    accept page, which shows the refusal;
 *  - a person already signed in when the page opens accepts nothing and goes
 *    to `/` (objectui#11714's pin, kept).
 *
 * The console's own `/register` carries the same pins in
 * `apps/console/src/pages/auth/__tests__/invitationSignUpJoin-30125.test.tsx`.
 * The real `AuthProvider` runs over a mock client; visible text is read from
 * the en pack.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { RegisterPage } from '../RegisterPage';

const en = builtInLocales.en.auth.register;
const INVITATION_ID = 'inv_30125';
const ACCEPT_PATH = `/accept-invitation/${INVITATION_ID}`;
const ORG = { id: 'org_acme', name: 'Acme', slug: 'acme' };
const USER = { id: 'u_new', name: 'Zhang', email: 'zhang@example.com' };

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  assign = vi.fn();
  vi.spyOn(window.location, 'assign').mockImplementation(assign as never);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createMockClient({ signedInOnArrival = false, refuseRecipient = false } = {}) {
  let signedIn = signedInOnArrival;
  let member = false;
  let active: typeof ORG | null = null;
  const client = {
    getSession: vi.fn(async () =>
      signedIn ? { user: USER, session: { token: 't', createdAt: new Date() } } : null,
    ),
    getConfig: vi.fn().mockResolvedValue({
      emailPassword: { enabled: true, disableSignUp: false, requireEmailVerification: false },
      features: { audiencePosture: 'invite_only' },
    }),
    getInvitationPreview: vi.fn().mockResolvedValue({
      organizationName: ORG.name,
      inviterName: 'Lin',
      email: 'z***@example.com',
    }),
    signUp: vi.fn(async () => {
      signedIn = true;
      return { user: USER, session: undefined, requiresVerification: false };
    }),
    getInvitation: vi.fn(async (id: string) => {
      if (refuseRecipient) {
        throw Object.assign(new Error('You are not the recipient of the invitation'), { status: 403 });
      }
      return { id, organizationId: ORG.id, email: USER.email, role: 'member', status: 'pending' };
    }),
    acceptInvitation: vi.fn(async () => {
      member = true;
    }),
    listOrganizations: vi.fn(async () => (member ? [ORG] : [])),
    getActiveOrganization: vi.fn(async () => active),
    getActiveMember: vi.fn().mockResolvedValue(null),
    setActiveOrganization: vi.fn(async (id: string) => {
      active = id === ORG.id ? ORG : null;
      return active;
    }),
  };
  return client as typeof client & AuthClient;
}

function renderRegister(client: AuthClient) {
  const path = `/register?redirect=${encodeURIComponent(ACCEPT_PATH)}`;
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl="/api/v1/auth" client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/accept-invitation/:invitationId" element={<p>accept page</p>} />
            <Route path="/" element={<p>home</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

async function signUpOnTheForm() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(en.nameLabel), USER.name);
  await user.type(screen.getByLabelText(en.emailLabel), USER.email);
  await user.type(screen.getByLabelText(en.passwordLabel), 'hunter2hunter2');
  await user.type(screen.getByLabelText(en.confirmPasswordLabel), 'hunter2hunter2');
  await user.click(screen.getByRole('button', { name: en.submitButton }));
}

describe('DefaultRegisterPage — a sign-up from an invitation link joins it (#30125)', () => {
  it('accepts the invitation the link names, switches to its organization, and enters the root once', async () => {
    const client = createMockClient();
    renderRegister(client);
    await signUpOnTheForm();

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(client.acceptInvitation).toHaveBeenCalledTimes(1);
    expect(client.acceptInvitation).toHaveBeenCalledWith(INVITATION_ID);
    expect(client.setActiveOrganization).toHaveBeenCalledWith(ORG.id);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(new URL(assign.mock.calls[0][0] as string, document.baseURI).pathname).toBe('/');
    expect(screen.queryByText('home')).toBeNull();
  });

  it('the server refuses this account: accepts nothing and opens the accept page', async () => {
    const client = createMockClient({ refuseRecipient: true });
    renderRegister(client);
    await signUpOnTheForm();

    expect(await screen.findByText('accept page')).toBeInTheDocument();
    expect(client.acceptInvitation).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('CONTROL: already signed in when the page opens — accepts nothing and goes to /', async () => {
    const client = createMockClient({ signedInOnArrival: true });
    renderRegister(client);

    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(client.getInvitation).not.toHaveBeenCalled();
    expect(client.acceptInvitation).not.toHaveBeenCalled();
  });
});
