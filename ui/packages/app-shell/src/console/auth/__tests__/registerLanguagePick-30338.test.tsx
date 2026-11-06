/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30338 — on `DefaultRegisterPage`, a language picked while signed
 * out earlier in this page-load is saved as the new person's own before the
 * page leaves, once registering has signed them in, as the console's own
 * `/login` and `/register` do.
 *
 * The page leaves two ways: the invitation join's full navigation to the root
 * (objectstack#30125), and a client-side move to `/` (the form's `onSuccess`
 * and the signed-in branch). Each waits for the save:
 *
 *  1. with a pick, nothing moves on while the save is in flight, and the page
 *     goes where it would have gone once it settles;
 *  2. without a pick, nothing is saved and the page moves on (CONTROL);
 *  3. a save that fails (it settles having written nothing, app-shell's own
 *     contract, pinned in `hooks/__tests__/userLocaleSignInPick-30338.test.tsx`)
 *     still lets the page move on.
 *
 * The console's own `/register` carries the same pins in
 * `apps/console/src/pages/auth/__tests__/registerLanguagePick-30338.test.tsx`.
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

const pick = vi.hoisted(() => ({
  held: false,
  save: vi.fn<(userId: string) => Promise<void>>(),
}));

vi.mock('../../../hooks/useUserLocale.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasSignInLanguagePick: () => pick.held,
  saveSignInLanguagePick: (userId: string) => pick.save(userId),
}));

import { RegisterPage } from '../RegisterPage';

const en = builtInLocales.en.auth.register;
const INVITATION_ID = 'inv_30338';
const ACCEPT_PATH = `/accept-invitation/${INVITATION_ID}`;
const ORG = { id: 'org_acme', name: 'Acme', slug: 'acme' };
const USER = { id: 'u_new', name: 'Zhang', email: 'zhang@example.com' };

let assign: ReturnType<typeof vi.fn>;
/** Settles the save the page is awaiting. */
let settleSave: () => void;

beforeEach(() => {
  window.localStorage.clear();
  assign = vi.fn();
  vi.spyOn(window.location, 'assign').mockImplementation(assign as never);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  pick.held = true;
  pick.save.mockReset();
  pick.save.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settleSave = () => {
          pick.held = false;
          resolve();
        };
      }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A server on which the form's sign-up signs the person in; `invitation` opens the page from a link the sign-up accepts. */
function createMockClient({ invitation = false } = {}) {
  let signedIn = false;
  let member = false;
  let active: typeof ORG | null = null;
  const client = {
    getSession: vi.fn(async () =>
      signedIn ? { user: USER, session: { token: 't', createdAt: new Date() } } : null,
    ),
    getConfig: vi.fn().mockResolvedValue({
      emailPassword: { enabled: true, disableSignUp: false, requireEmailVerification: false },
      features: { audiencePosture: invitation ? 'invite_only' : 'open' },
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
    getInvitation: vi.fn(async (id: string) => ({
      id,
      organizationId: ORG.id,
      email: USER.email,
      role: 'member',
      status: 'pending',
    })),
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

function renderRegister(client: AuthClient, { invitation = false } = {}) {
  const path = invitation ? `/register?redirect=${encodeURIComponent(ACCEPT_PATH)}` : '/register';
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

/** Long enough for every effect and microtask the page would run before it moves on. */
const settle = () => new Promise((r) => setTimeout(r, 50));
const rootAssigned = () =>
  assign.mock.calls.length === 1 && new URL(assign.mock.calls[0][0] as string, document.baseURI).pathname === '/';

describe('DefaultRegisterPage — a language picked earlier is saved before the page moves on (objectstack#30338)', () => {
  it('a sign-up: nothing moves on while the save is in flight, then the page goes to /', async () => {
    renderRegister(createMockClient());
    await signUpOnTheForm();

    await waitFor(() => expect(pick.save).toHaveBeenCalledTimes(1));
    expect(pick.save).toHaveBeenCalledWith(USER.id);
    await settle();
    expect(screen.queryByText('home')).toBeNull();

    settleSave();
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(pick.save).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('an invitation link: the invitation is accepted, and the root waits for the save as well', async () => {
    const client = createMockClient({ invitation: true });
    renderRegister(client, { invitation: true });
    await signUpOnTheForm();

    await waitFor(() => expect(client.setActiveOrganization).toHaveBeenCalledWith(ORG.id));
    expect(client.acceptInvitation).toHaveBeenCalledWith(INVITATION_ID);
    expect(pick.save).toHaveBeenCalledTimes(1);
    await settle();
    expect(assign).not.toHaveBeenCalled();

    settleSave();
    await waitFor(() => expect(rootAssigned()).toBe(true));
    expect(screen.queryByText('home')).toBeNull();
  });

  it('CONTROL — a sign-up with no pick: nothing is saved and the page goes to /', async () => {
    pick.held = false;
    renderRegister(createMockClient());
    await signUpOnTheForm();

    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(pick.save).not.toHaveBeenCalled();
  });

  it('CONTROL — an invitation link with no pick: nothing is saved and the page enters the root', async () => {
    pick.held = false;
    renderRegister(createMockClient({ invitation: true }), { invitation: true });
    await signUpOnTheForm();

    await waitFor(() => expect(rootAssigned()).toBe(true));
    expect(pick.save).not.toHaveBeenCalled();
  });

  it.each([
    { exit: 'a sign-up', invitation: false },
    { exit: 'an invitation link', invitation: true },
  ])('$exit: a save that fails still lets the page move on', async ({ invitation }) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    pick.save.mockImplementation(async () => {
      pick.held = false;
      console.error('[app-shell] The language picked on the sign-in page was not saved', new Error('refused'));
    });
    renderRegister(createMockClient({ invitation }), { invitation });
    await signUpOnTheForm();

    if (invitation) await waitFor(() => expect(rootAssigned()).toBe(true));
    else expect(await screen.findByText('home')).toBeInTheDocument();
    expect(pick.save).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
