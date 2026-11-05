// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29174 — signing out leaves the list's state behind.
 *
 * A list mirrors its toolbar state into the URL (`uf__filter`, `uf__search`,
 * `uf__sort`, `uf__group`, a quick filter's `uf_<field>`, the tab preset's
 * `uf__tab`; `views/userFilterUrlState.ts` in app-shell owns the family). When
 * the session ends, `LoginRedirect` sends the visitor to `/login` with a
 * `?redirect=` return link, and the login page follows that link after ANY
 * successful sign-in. So whoever signs in next on that browser used to open
 * the previous user's filtered, searched and sorted list — on a shared desk or
 * kiosk, the next person.
 *
 * Pinned here, through the REAL composition: the real `AuthProvider` over a
 * scripted auth client (the session is A's until A signs out, then B's once B
 * signs in on the form), the real `ProtectedRoute` (its `AuthGuard` and
 * `LoginRedirect`), and the real Console `LoginPage` with its post-login
 * hand-off. Only the shell's provider stack is a pass-through.
 *
 *   - A's session expires on a list carrying every kind of list state; the
 *     login page's URL carries none of it, and B lands on the same path with
 *     the other params kept (the card's reproduction, steps 4 to 7, with the
 *     session ending by expiry: an explicit sign-out now carries no return link
 *     at all, pinned in the objectstack#30125 block below);
 *   - an invitation redirect still lands on the invitation;
 *   - a signed-out arrival on a deep link with no list state keeps it byte for
 *     byte;
 *   - a signed-out arrival on a link WITH list state loses that state too: the
 *     guard cannot tell who will sign in, so it never forwards it.
 *
 * What B's list then opens with at that landing URL — B's own stored state or
 * the view's default, and nothing of A's in the first data request — is pinned
 * in app-shell's `ObjectView.listUrlState-11860.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Pass-through: the shell's provider stack does not decide where the guard
  // sends a signed-out visitor.
  ConnectedShell: ({ children }: { children?: ReactNode }) => <>{children}</>,
  RequireOrganization: ({ children }: { children?: ReactNode }) => <>{children}</>,
  LoadingFallback: () => <div data-testid="loading" />,
}));

import { ProtectedRoute } from './ProtectedRoute';
import { LoginPage } from '../pages/auth/LoginPage';
import { withConsoleBase } from '../utils/consoleBase';

const LIST_PATH = '/apps/demo/demo_task/view/in_progress';

/** A's list, as the list writes it: two Filter panel conditions, a search, a sort, a grouping, a chip, a tab, and a record open beside it. */
const A_LIST_SEARCH = new URLSearchParams([
  [
    'uf__filter',
    JSON.stringify({
      logic: 'and',
      conditions: [
        { field: 'estimate_hours', operator: 'greater_than', value: 10 },
        { field: 'progress', operator: 'less_than', value: 80 },
      ],
    }),
  ],
  ['uf__search', 'pipeline'],
  ['uf__sort', JSON.stringify([{ field: 'due_date', order: 'desc' }])],
  ['uf__group', JSON.stringify({ fields: [{ field: 'status', order: 'asc', collapsed: false }] })],
  ['uf_priority', 'urgent'],
  ['uf__tab', 'mine'],
  ['recordId', 'r1'],
]).toString();

const A_LIST_URL = `${LIST_PATH}?${A_LIST_SEARCH}`;

const USER_A = { id: 'user_a', name: 'Ada', email: 'ada@example.com' };
const USER_B = { id: 'user_b', name: 'Ben', email: 'ben@example.com' };

/** The session the scripted server holds, newest state wins. */
let serverUser: typeof USER_A | null;

function createClient(): AuthClient {
  return {
    getSession: vi.fn(async () => (serverUser ? { user: serverUser, session: { token: `tok_${serverUser.id}` } } : null)),
    getConfig: vi.fn().mockResolvedValue({ emailPassword: { enabled: true, disableSignUp: true } }),
    signOut: vi.fn(async () => {
      serverUser = null;
    }),
    signIn: vi.fn(async ({ email }: { email: string }) => {
      serverUser = email === USER_B.email ? USER_B : USER_A;
      return { user: serverUser, session: { token: `tok_${serverUser.id}` } };
    }),
  } as unknown as AuthClient;
}

/** Every location the router settles on, oldest first. */
const seen: string[] = [];
/** The router's own navigate, for an in-app move between sign-ins. */
const navigateTo: { current: ((to: string) => void) | null } = { current: null };
function LocationProbe() {
  const location = useLocation();
  navigateTo.current = useNavigate();
  seen.push(location.pathname + location.search);
  return null;
}

/**
 * The list page, reduced to the account menu's sign-out and a session
 * re-resolution: the provider's own loader, which is how a session that
 * expired or was revoked under the page reaches it.
 */
function SignedInList() {
  const { user, signOut, refreshSession } = useAuth();
  return (
    <div data-testid="list-page" data-user={user?.id ?? ''}>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
      <button type="button" onClick={() => void refreshSession()}>
        Re-check session
      </button>
    </div>
  );
}

/** The server ends the session on its own (expiry, revocation), and the page learns it. */
async function expireSession() {
  serverUser = null;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Re-check session' }));
}

function renderConsole(entry: string, client: AuthClient) {
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/apps/*"
            element={
              <ProtectedRoute requireOrganization={false}>
                <SignedInList />
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

/** The login page the router settled on, and its `?redirect=` decoded. */
async function loginRedirect(): Promise<{ url: string; redirect: string | null }> {
  await screen.findByLabelText('Email');
  const url = seen[seen.length - 1]!;
  expect(url.startsWith('/login')).toBe(true);
  return { url, redirect: new URLSearchParams(url.slice('/login'.length)).get('redirect') };
}

async function signInAs(email: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), 'pw-29174');
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
}

/** The URL the login page sends the browser to once someone is signed in. */
async function landing(): Promise<string> {
  const assign = vi.mocked(window.location.assign);
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(assign).toHaveBeenCalledTimes(1);
  return String(assign.mock.calls[0]![0]);
}

beforeEach(() => {
  seen.length = 0;
  serverUser = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('signing out leaves the list state behind (objectstack#29174)', () => {
  it("A's session expires on a filtered, searched, sorted list; B signs in and lands on the path with none of it", async () => {
    serverUser = USER_A;
    const client = createClient();
    renderConsole(A_LIST_URL, client);

    // A is on the list, and the URL carries A's list state (the control).
    expect((await screen.findByTestId('list-page')).dataset.user).toBe(USER_A.id);
    expect(seen[seen.length - 1]).toBe(A_LIST_URL);

    await expireSession();
    expect(client.signOut).not.toHaveBeenCalled();

    // The login page's own URL carries none of it: not the params, not a value.
    const { url, redirect } = await loginRedirect();
    expect(redirect).toBe(`${LIST_PATH}?recordId=r1`);
    expect(decodeURIComponent(url)).not.toContain('uf_');
    expect(decodeURIComponent(url)).not.toContain('pipeline');
    expect(decodeURIComponent(url)).not.toContain('estimate_hours');

    await signInAs(USER_B.email);
    expect(client.signIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: USER_B.email }),
    );

    // B lands on the list's path, with the record param kept.
    const landed = await landing();
    expect(landed).toBe(withConsoleBase(`${LIST_PATH}?recordId=r1`));
    expect(landed).not.toContain('uf_');
  });

  it('an invitation redirect still lands on the invitation', async () => {
    const client = createClient();
    renderConsole(`/login?redirect=${encodeURIComponent('/accept-invitation/inv_1')}`, client);

    await signInAs(USER_B.email);

    expect(await landing()).toBe(withConsoleBase('/accept-invitation/inv_1'));
  });

  it('a signed-out arrival on a deep link with no list state keeps it byte for byte', async () => {
    const deepLink = '/apps/demo/demo_task/record/r1?tab=details&note=a%20b';
    const client = createClient();
    renderConsole(deepLink, client);

    const { url, redirect } = await loginRedirect();
    expect(url).toBe(`/login?redirect=${encodeURIComponent(deepLink)}`);
    expect(redirect).toBe(deepLink);

    await signInAs(USER_B.email);
    expect(await landing()).toBe(withConsoleBase(deepLink));
  });

  it('a signed-out arrival on a link carrying list state loses the list state: the guard cannot tell who signs in', async () => {
    const client = createClient();
    renderConsole(A_LIST_URL, client);

    const { redirect } = await loginRedirect();
    expect(redirect).toBe(`${LIST_PATH}?recordId=r1`);
  });
});

/**
 * objectstack#30125 — after a sign-out, the next person lands on the previous
 * person's page. A new member's first screen was "you do not have access to
 * this app" for the Setup page the administrator had open.
 *
 * An explicit sign-out sends the visitor to `/login` with no return link, so
 * whoever signs in next lands on their own home. A session that ends under the
 * person (expired, revoked) still keeps the path, so that person signs back in
 * where they were. Same real composition as the block above.
 */
describe('an explicit sign-out leaves no return link (objectstack#30125)', () => {
  const SETUP_PAGE = '/apps/com.objectstack.setup/sys_user/view/all?recordId=u1';

  it('A signs out of a Setup page; B signs in and lands on home, not on that page', async () => {
    serverUser = USER_A;
    const client = createClient();
    renderConsole(SETUP_PAGE, client);
    expect((await screen.findByTestId('list-page')).dataset.user).toBe(USER_A.id);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect(client.signOut).toHaveBeenCalledTimes(1);

    const { url, redirect } = await loginRedirect();
    expect(url).toBe('/login');
    expect(redirect).toBeNull();

    await signInAs(USER_B.email);
    expect(await landing()).toBe(withConsoleBase('/'));
  });

  it("A's session expires on the same page; A signs back in and lands on it", async () => {
    serverUser = USER_A;
    const client = createClient();
    renderConsole(SETUP_PAGE, client);
    expect((await screen.findByTestId('list-page')).dataset.user).toBe(USER_A.id);

    await expireSession();

    const { url, redirect } = await loginRedirect();
    expect(url).toBe(`/login?redirect=${encodeURIComponent(SETUP_PAGE)}`);
    expect(redirect).toBe(SETUP_PAGE);

    await signInAs(USER_A.email);
    expect(await landing()).toBe(withConsoleBase(SETUP_PAGE));
  });

  it('the sign-out is forgotten once someone signs in: a later expiry keeps the path again', async () => {
    serverUser = USER_A;
    const client = createClient();
    renderConsole(SETUP_PAGE, client);
    expect((await screen.findByTestId('list-page')).dataset.user).toBe(USER_A.id);

    // A signs out; B signs in on the same tab, without a page load.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect((await loginRedirect()).redirect).toBeNull();
    await signInAs(USER_B.email);
    await landing();

    // B opens the page in-app, and B's session then expires under it.
    act(() => navigateTo.current!(SETUP_PAGE));
    expect((await screen.findByTestId('list-page')).dataset.user).toBe(USER_B.id);
    await expireSession();

    expect((await loginRedirect()).redirect).toBe(SETUP_PAGE);
  });
});
