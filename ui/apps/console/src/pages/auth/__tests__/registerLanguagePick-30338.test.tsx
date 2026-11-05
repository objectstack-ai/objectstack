/**
 * The console's `/register` saves a language picked on it before it navigates
 * away, once registering has signed the person in (objectstack#30338, the
 * register-page remainder of the save `/login` makes since objectstack#30399).
 *
 * The knowledge that the pick was made on this page is memory, and every exit
 * of the post-signup step is a full navigation that ends it. So the page awaits
 * app-shell's `saveSignInLanguagePick` before each exit — a write sent beside
 * the navigation races the unload. What the save writes, when it writes
 * nothing, and that a failed read or write resolves instead of rejecting, are
 * app-shell's and pinned beside the pick itself
 * (`userLocaleSignInPick-30338.test.tsx`); this file pins the ORDER on the
 * page, one case per exit, each reached by a sign-up on the form:
 *
 *  1. with a pick, nothing navigates while the save is in flight, and the exit
 *     the page would have taken is taken once it settles;
 *  2. without a pick, nothing is saved and the page leaves (CONTROL);
 *  3. a save that fails (it settles having written nothing) still lets the
 *     page leave.
 *
 * The invitation join (objectstack#30125) is one of the exits: the acceptance
 * and the save both finish before the page enters the root.
 *
 * The real `AuthProvider` runs over a mock client, as in
 * `invitationSignUpJoin-30125.test.tsx`; the Console is mounted as the shipped
 * build is (`<base href="/_console/">`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';

const pick = vi.hoisted(() => ({
  held: false,
  save: vi.fn<(userId: string) => Promise<void>>(),
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasSignInLanguagePick: () => pick.held,
  saveSignInLanguagePick: (userId: string) => pick.save(userId),
}));

const follow = vi.hoisted(() => vi.fn());
vi.mock('../followAuthorize', () => ({ followOauthAuthorize: follow }));

import { RegisterPage } from '../RegisterPage';

const HANDOFF =
  '/api/v1/auth/one-time-token/handoff?redirect_uri=ai.objectos.mobile%3A%2F%2Fauth%2Fcallback' +
  '&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';
const OAUTH = '?client_id=rp&redirect_uri=https%3A%2F%2Frp.example%2Fcb&state=s';
const INVITATION_ID = 'inv_30338';
const ACCEPT_PATH = `/accept-invitation/${INVITATION_ID}`;
const ORG = { id: 'org_acme', name: 'Acme', slug: 'acme' };

const USER = { id: 'u_new', name: 'Zhang', email: 'zhang@example.com' };

let baseEl: HTMLBaseElement | null = null;
let assign: ReturnType<typeof vi.fn>;
/** Settles the save the page is awaiting. */
let settleSave: () => void;

beforeEach(() => {
  window.localStorage.clear();
  baseEl = document.createElement('base');
  baseEl.setAttribute('href', '/_console/');
  document.head.appendChild(baseEl);
  vi.stubEnv('BASE_URL', './');
  assign = vi.fn();
  vi.spyOn(window.location, 'assign').mockImplementation(assign as never);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  follow.mockReset();
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
  baseEl?.remove();
  baseEl = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Orgs = Array<{ id: string; name: string; slug: string }>;

/**
 * A server on which the form's sign-up signs the person in. `organizations`
 * absent: the client has no organization calls (none to choose from).
 * `invitation`: the page is opened from an invitation link, which the sign-up
 * accepts, joining `ORG`.
 */
function createMockClient({ organizations, invitation = false }: { organizations?: Orgs; invitation?: boolean } = {}) {
  let signedIn = false;
  let member = false;
  let active: { id: string; name: string; slug: string } | null = null;
  const orgs = (): Orgs => (invitation ? (member ? [ORG] : []) : (organizations ?? []));
  const client = {
    getSession: vi.fn(async () => (signedIn ? { user: USER, session: { token: 't', createdAt: new Date() } } : null)),
    getConfig: vi.fn().mockResolvedValue({
      emailPassword: { enabled: true, disableSignUp: false, requireEmailVerification: false },
      features: { audiencePosture: invitation ? 'invite_only' : 'open' },
    }),
    signUp: vi.fn(async () => {
      signedIn = true;
      return { user: USER, session: undefined, requiresVerification: false };
    }),
    signIn: vi.fn(),
    signInWithProvider: vi.fn(),
    ...(invitation
      ? {
          getInvitationPreview: vi.fn().mockResolvedValue({
            organizationName: ORG.name,
            inviterName: 'Lin',
            email: 'z***@example.com',
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
          getActiveMember: vi.fn().mockResolvedValue(null),
        }
      : {}),
    ...(organizations || invitation
      ? {
          listOrganizations: vi.fn(async () => orgs()),
          getActiveOrganization: vi.fn(async () => active),
          setActiveOrganization: vi.fn(async (id: string) => {
            active = orgs().find((o) => o.id === id) ?? null;
            return active;
          }),
        }
      : {}),
  };
  return client as typeof client & AuthClient;
}

function renderRegister(client: AuthClient, search = '') {
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
/** Long enough for every effect and microtask the page would run before an exit. */
const settle = () => new Promise((r) => setTimeout(r, 50));
const assigned = () => (assign.mock.calls[0] ? lands(assign.mock.calls[0][0] as string) : null);

const EXITS: Array<{
  exit: string;
  search: string;
  client: () => ReturnType<typeof createMockClient>;
  left: () => string | null;
  expected: string;
}> = [
  {
    exit: 'no organization: the Console root',
    search: '',
    client: () => createMockClient(),
    left: assigned,
    expected: '/_console/',
  },
  {
    exit: 'several organizations, none active: the picker',
    search: '',
    client: () =>
      createMockClient({
        organizations: [
          { id: 'org_1', name: 'One', slug: 'one' },
          { id: 'org_2', name: 'Two', slug: 'two' },
        ],
      }),
    left: assigned,
    expected: '/_console/organizations',
  },
  {
    exit: 'one organization: selected, then the safe redirect',
    search: `?redirect=${encodeURIComponent('/settings')}`,
    client: () => createMockClient({ organizations: [{ id: 'org_1', name: 'One', slug: 'one' }] }),
    left: assigned,
    expected: '/_console/settings',
  },
  {
    exit: 'an invitation link: joined, then the Console root',
    search: `?redirect=${encodeURIComponent(ACCEPT_PATH)}`,
    client: () => createMockClient({ invitation: true }),
    left: assigned,
    expected: '/_console/',
  },
  {
    exit: 'the mobile sign-in hand-off',
    search: `?redirect=${encodeURIComponent(HANDOFF)}`,
    client: () => createMockClient(),
    left: () => (assign.mock.calls[0] ? (assign.mock.calls[0][0] as string) : null),
    expected: HANDOFF,
  },
  {
    exit: 'the OAuth provider hand-off',
    search: OAUTH,
    client: () => createMockClient(),
    left: () => (follow.mock.calls[0] ? (follow.mock.calls[0][0] as string) : null),
    expected: OAUTH,
  },
];

describe('console /register — a language picked here is saved before the page leaves (objectstack#30338)', () => {
  it.each(EXITS)('$exit: nothing leaves while the save is in flight, then the page leaves', async (c) => {
    renderRegister(c.client(), c.search);
    await signUpOnTheForm();

    await waitFor(() => expect(pick.save).toHaveBeenCalledTimes(1));
    expect(pick.save).toHaveBeenCalledWith(USER.id);
    await settle();
    expect(assign).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();

    settleSave();
    await waitFor(() => expect(c.left()).toBe(c.expected));
    expect(assign.mock.calls.length + follow.mock.calls.length).toBe(1);
    expect(pick.save).toHaveBeenCalledTimes(1);
  });

  it('an invitation link: the invitation is accepted, and the root waits for the save as well', async () => {
    const client = createMockClient({ invitation: true });
    renderRegister(client, `?redirect=${encodeURIComponent(ACCEPT_PATH)}`);
    await signUpOnTheForm();

    await waitFor(() => expect(client.acceptInvitation).toHaveBeenCalledWith(INVITATION_ID));
    await waitFor(() => expect(client.setActiveOrganization).toHaveBeenCalledWith(ORG.id));
    await settle();
    expect(assign).not.toHaveBeenCalled();

    settleSave();
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(lands(assign.mock.calls[0][0] as string)).toBe('/_console/');
  });

  // Which exit, and how often, is the post-signup step's own behaviour with
  // nothing to wait for, unchanged by this card; this pins that nothing waits.
  it.each(EXITS)('CONTROL — $exit, with no pick: nothing is saved and the page leaves', async (c) => {
    pick.held = false;
    renderRegister(c.client(), c.search);
    await signUpOnTheForm();

    await waitFor(() => expect(c.left()).toBe(c.expected));
    expect(pick.save).not.toHaveBeenCalled();
  });

  it.each(EXITS)('$exit: a save that fails still lets the page leave', async (c) => {
    // The save's own contract (app-shell): a failed read or write is logged and
    // the promise resolves, having written nothing.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    pick.save.mockImplementation(async () => {
      pick.held = false;
      console.error('[app-shell] The language picked on the sign-in page was not saved', new Error('refused'));
    });
    renderRegister(c.client(), c.search);
    await signUpOnTheForm();

    await waitFor(() => expect(c.left()).toBe(c.expected));
    expect(pick.save).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls.length + follow.mock.calls.length).toBe(1);
  });
});
