/**
 * #30125 — registering from an invitation link joins that invitation's
 * organization and enters the console, instead of stopping on the accept page
 * ("Accept invitation") and then on "Invitation accepted … Continue".
 *
 * Pinned on the console's own `/register`, the page the console routes:
 *
 *  - the sign-up accepts the invitation its `?redirect=` names, switches the
 *    session to that organization, and leaves for the console root once;
 *  - the server refusing the read (an address that is not the invited one):
 *    nothing is accepted and the page opens the accept page, as before;
 *  - a person already signed in when the page opens accepts nothing here.
 *
 * The real `AuthProvider` runs over a mock client, so the session appears the
 * way a sign-up makes it appear. The Console is mounted as the shipped build
 * is (`<base href="/_console/">`), so "the root" is read where the browser
 * would land. The package's `DefaultRegisterPage` carries the same pins in
 * `packages/app-shell/src/console/auth/__tests__/invitationSignUpJoin-30125.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { RegisterPage } from '../RegisterPage';

const INVITATION_ID = 'inv_30125';
const ACCEPT_PATH = `/accept-invitation/${INVITATION_ID}`;
const ORG = { id: 'org_acme', name: 'Acme', slug: 'acme' };
const USER = { id: 'u_new', name: 'Zhang', email: 'zhang@example.com' };

let baseEl: HTMLBaseElement | null = null;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  baseEl = document.createElement('base');
  baseEl.setAttribute('href', '/_console/');
  document.head.appendChild(baseEl);
  vi.stubEnv('BASE_URL', './');
  assign = vi.fn();
  vi.spyOn(window.location, 'assign').mockImplementation(assign as never);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  baseEl?.remove();
  baseEl = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

interface ServerOptions {
  /** Signed in already when the page opens. */
  signedInOnArrival?: boolean;
  /** `get-invitation` refuses this account (better-auth's recipient check). */
  refuseRecipient?: boolean;
}

function createMockClient({ signedInOnArrival = false, refuseRecipient = false }: ServerOptions = {}) {
  let signedIn = signedInOnArrival;
  let member = false;
  let active: typeof ORG | null = null;
  const session = () => ({ user: USER, session: { token: 't', createdAt: new Date() } });
  const client = {
    getSession: vi.fn(async () => (signedIn ? session() : null)),
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
        throw Object.assign(new Error('You are not the recipient of the invitation'), {
          code: 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
          status: 403,
        });
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
  const search = `?redirect=${encodeURIComponent(ACCEPT_PATH)}`;
  window.history.replaceState({}, '', `/_console/register${search}`);
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={[`/register${search}`]}>
        <RegisterPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

async function signUpOnTheForm() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Name'), USER.name);
  await user.type(screen.getByLabelText('Email'), USER.email);
  await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
  await user.type(screen.getByLabelText('Confirm Password'), 'hunter2hunter2');
  await user.click(screen.getByRole('button', { name: 'Create Account' }));
}

/** Where a full-page navigation lands, per the browser's own resolution. */
const lands = (target: string) => new URL(target, document.baseURI).pathname;

describe('console /register — a sign-up from an invitation link joins it (#30125)', () => {
  it('accepts the invitation the link names, switches to its organization, and enters the root once', async () => {
    const client = createMockClient();
    renderRegister(client);
    await signUpOnTheForm();

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(client.getInvitation).toHaveBeenCalledWith(INVITATION_ID);
    expect(client.acceptInvitation).toHaveBeenCalledTimes(1);
    expect(client.acceptInvitation).toHaveBeenCalledWith(INVITATION_ID);
    expect(client.setActiveOrganization).toHaveBeenCalledWith(ORG.id);
    expect(assign).toHaveBeenCalledTimes(1);
    // The root, never the accept page and its "Invitation accepted" step.
    expect(lands(assign.mock.calls[0][0] as string)).toBe('/_console/');
  });

  it('the server refuses this account: accepts nothing and opens the accept page, as before', async () => {
    const client = createMockClient({ refuseRecipient: true });
    renderRegister(client);
    await signUpOnTheForm();

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(client.acceptInvitation).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(lands(assign.mock.calls[0][0] as string)).toBe(`/_console${ACCEPT_PATH}`);
  });

  it('CONTROL: already signed in when the page opens — nothing is accepted, the accept page decides', async () => {
    const client = createMockClient({ signedInOnArrival: true });
    renderRegister(client);

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(client.getInvitation).not.toHaveBeenCalled();
    expect(client.acceptInvitation).not.toHaveBeenCalled();
    expect(lands(assign.mock.calls[0][0] as string)).toBe(`/_console${ACCEPT_PATH}`);
  });
});
