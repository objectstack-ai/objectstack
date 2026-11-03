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
 *   - A signs out of a list carrying every kind of list state; the login page's
 *     URL carries none of it, and B lands on the same path with the other
 *     params kept (the card's reproduction, steps 4 to 7);
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
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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
function LocationProbe() {
  const location = useLocation();
  seen.push(location.pathname + location.search);
  return null;
}

/** The list page, reduced to the account menu's sign-out. */
function SignedInList() {
  const { user, signOut } = useAuth();
  return (
    <div data-testid="list-page" data-user={user?.id ?? ''}>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
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
  it('A signs out of a filtered, searched, sorted list; B signs in and lands on the path with none of it', async () => {
    serverUser = USER_A;
    const client = createClient();
    renderConsole(A_LIST_URL, client);

    // A is on the list, and the URL carries A's list state (the control).
    expect((await screen.findByTestId('list-page')).dataset.user).toBe(USER_A.id);
    expect(seen[seen.length - 1]).toBe(A_LIST_URL);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect(client.signOut).toHaveBeenCalledTimes(1);

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
