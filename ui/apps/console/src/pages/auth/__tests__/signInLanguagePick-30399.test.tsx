/**
 * The sign-in page saves a language picked on it before it navigates away
 * (objectstack#30399, the saved half of objectstack#30338).
 *
 * The knowledge that the pick was made on this page is memory, and every exit
 * of the post-login step is a full navigation that ends it. So the page awaits
 * app-shell's `saveSignInLanguagePick` before each exit — a write sent beside
 * the navigation races the unload. What the save writes, and when it writes
 * nothing, is app-shell's and pinned beside the pick itself
 * (`userLocaleSignInPick-30338.test.tsx`); this file pins the ORDER on the
 * page, one case per exit:
 *
 *  1. with a pick, nothing navigates while the save is in flight, and the exit
 *     the page would have taken is taken once it settles;
 *  2. without a pick, nothing is saved and nothing waits (CONTROL);
 *  3. a session the mobile hand-off refuses for its age is not a sign-in yet:
 *     nothing is saved for it.
 *
 * The real `AuthProvider` runs over a mock client, as in
 * `signInHandoff-29971.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';

const pick = vi.hoisted(() => ({
  held: false,
  save: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasSignInLanguagePick: () => pick.held,
  saveSignInLanguagePick: (...args: unknown[]) => pick.save(...args),
}));

const follow = vi.hoisted(() => vi.fn());
vi.mock('../followAuthorize', () => ({ followOauthAuthorize: follow }));

import { LoginPage } from '../LoginPage';

const HANDOFF =
  '/api/v1/auth/one-time-token/handoff?redirect_uri=ai.objectos.mobile%3A%2F%2Fauth%2Fcallback' +
  '&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';
const OAUTH = '?client_id=rp&redirect_uri=https%3A%2F%2Frp.example%2Fcb&state=s';

const USER = { id: 'u1', name: 'Ada', email: 'ada@example.com' };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

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
  pick.save = vi.fn(
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

function createMockClient(organizations?: Orgs, createdAt: Date = minutesAgo(1)) {
  const client = {
    getSession: vi.fn().mockResolvedValue({ user: USER, session: { token: 't', createdAt } }),
    getConfig: vi.fn().mockResolvedValue({}),
    signIn: vi.fn().mockResolvedValue({ user: USER, session: undefined }),
    signUp: vi.fn(),
    signInWithProvider: vi.fn(),
    ...(organizations
      ? {
          listOrganizations: vi.fn().mockResolvedValue(organizations),
          getActiveOrganization: vi.fn().mockResolvedValue(null),
          setActiveOrganization: vi.fn().mockResolvedValue(undefined),
        }
      : {}),
  };
  return client as typeof client & AuthClient;
}

function renderLogin(client: AuthClient, search = '') {
  window.history.replaceState({}, '', `/_console/login${search}`);
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const lands = (target: string) => new URL(target, document.baseURI).pathname;
/** Long enough for every effect and microtask the page would run before an exit. */
const settle = () => new Promise((r) => setTimeout(r, 50));

const EXITS: Array<{
  exit: string;
  search: string;
  organizations?: Orgs;
  left: () => string | null;
  expected: string;
}> = [
  {
    exit: 'no organization: the Console root',
    search: '',
    left: () => (assign.mock.calls[0] ? lands(assign.mock.calls[0][0] as string) : null),
    expected: '/_console/',
  },
  {
    exit: 'several organizations, none active: the picker',
    search: '',
    organizations: [
      { id: 'org_1', name: 'One', slug: 'one' },
      { id: 'org_2', name: 'Two', slug: 'two' },
    ],
    left: () => (assign.mock.calls[0] ? lands(assign.mock.calls[0][0] as string) : null),
    expected: '/_console/organizations',
  },
  {
    exit: 'one organization: selected, then the safe redirect',
    search: `?redirect=${encodeURIComponent('/settings')}`,
    organizations: [{ id: 'org_1', name: 'One', slug: 'one' }],
    left: () => (assign.mock.calls[0] ? lands(assign.mock.calls[0][0] as string) : null),
    expected: '/_console/settings',
  },
  {
    exit: 'the mobile sign-in hand-off',
    search: `?redirect=${encodeURIComponent(HANDOFF)}`,
    left: () => (assign.mock.calls[0] ? (assign.mock.calls[0][0] as string) : null),
    expected: HANDOFF,
  },
  {
    exit: 'the OAuth provider hand-off',
    search: OAUTH,
    left: () => (follow.mock.calls[0] ? (follow.mock.calls[0][0] as string) : null),
    expected: OAUTH,
  },
];

describe('LoginPage — a language picked here is saved before the page leaves (objectstack#30399)', () => {
  it.each(EXITS)('$exit: nothing leaves while the save is in flight, then the page leaves', async (c) => {
    renderLogin(createMockClient(c.organizations), c.search);

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

  it.each(EXITS)('CONTROL — $exit, with no pick: nothing is saved and nothing waits', async (c) => {
    pick.held = false;
    renderLogin(createMockClient(c.organizations), c.search);

    await waitFor(() => expect(c.left()).toBe(c.expected));
    expect(pick.save).not.toHaveBeenCalled();
  });

  it('a session the mobile hand-off refuses for its age is not a sign-in yet: nothing is saved', async () => {
    renderLogin(createMockClient(undefined, minutesAgo(6)), `?redirect=${encodeURIComponent(HANDOFF)}`);

    expect(await screen.findByLabelText('Email')).toBeTruthy();
    await settle();
    expect(pick.save).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
