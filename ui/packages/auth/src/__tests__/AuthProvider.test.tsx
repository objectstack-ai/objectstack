/**
 * Tests for AuthProvider, useAuth, and AuthGuard
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { AuthGuard } from '../AuthGuard';
import type { AuthClient } from '../types';
import { registerBeforeSignOut, resetBeforeSignOutForTests } from '../beforeSignOut';
import { createAuthClient } from '../createAuthClient';
import { createAuthenticatedFetch } from '../createAuthenticatedFetch';
import { sessionEndEvents } from '../session-end-events';

function createMockClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    signIn: vi.fn().mockResolvedValue({
      user: { id: '1', name: 'Test User', email: 'test@test.com' },
      session: { token: 'tok123' },
    }),
    signUp: vi.fn().mockResolvedValue({
      user: { id: '2', name: 'New User', email: 'new@test.com' },
      session: { token: 'tok456' },
    }),
    signOut: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(null),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    updateUser: vi.fn().mockResolvedValue({ id: '1', name: 'Updated', email: 'test@test.com' }),
    ...overrides,
    // `AuthClient` declares ~38 methods; this double implements the eight the
    // provider reaches on the paths under test, which is the same shape (and
    // the same assertion) as `LoginForm.test.tsx`, `identifier-trim.test.tsx`
    // and `SocialSignInButtons.test.tsx` in this package. Asserting at the one
    // seam keeps the lie in a single named place instead of stubbing thirty
    // methods no test calls.
  } as unknown as AuthClient;
}

function TestConsumer() {
  const { user, isAuthenticated, isLoading, error } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="user-name">{user?.name ?? 'none'}</span>
      <span data-testid="error">{error?.message ?? 'none'}</span>
    </div>
  );
}

describe('AuthProvider', () => {
  it('starts in loading state and resolves to unauthenticated when no session', async () => {
    const client = createMockClient();

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <TestConsumer />
      </AuthProvider>,
    );

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('user-name').textContent).toBe('none');
  });

  it('resolves to authenticated when session exists', async () => {
    const client = createMockClient({
      getSession: vi.fn().mockResolvedValue({
        user: { id: '1', name: 'Alice', email: 'alice@test.com' },
        session: { token: 'session-tok' },
      }),
    });

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-name').textContent).toBe('Alice');
  });

  it('sets error state when getSession fails', async () => {
    const client = createMockClient({
      getSession: vi.fn().mockRejectedValue(new Error('Session fetch failed')),
    });

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('error').textContent).toBe('Session fetch failed');
  });

  it('calls onAuthStateChange when auth state changes', async () => {
    const onAuthStateChange = vi.fn();
    const client = createMockClient();

    render(
      <AuthProvider authUrl="/api/auth" client={client} onAuthStateChange={onAuthStateChange}>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(onAuthStateChange).toHaveBeenCalled();
  });
});

describe('useAuth', () => {
  it('returns safe defaults when used outside AuthProvider', () => {
    function OutsideConsumer() {
      const auth = useAuth();
      return <span data-testid="outside">{String(auth.isAuthenticated)}</span>;
    }

    render(<OutsideConsumer />);
    expect(screen.getByTestId('outside').textContent).toBe('false');
  });

  it('signIn updates user state', async () => {
    const client = createMockClient();

    function SignInConsumer() {
      const { signIn, user, isAuthenticated } = useAuth();
      return (
        <div>
          <button onClick={() => signIn('test@test.com', 'pass')}>Sign In</button>
          <span data-testid="auth">{String(isAuthenticated)}</span>
          <span data-testid="name">{user?.name ?? 'none'}</span>
        </div>
      );
    }

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <SignInConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('false');
    });

    await act(async () => {
      await userEvent.click(screen.getByText('Sign In'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('true');
    });
    expect(screen.getByTestId('name').textContent).toBe('Test User');
    expect(client.signIn).toHaveBeenCalledWith({ email: 'test@test.com', password: 'pass' });
  });

  it('signOut clears user state', async () => {
    const client = createMockClient({
      getSession: vi.fn().mockResolvedValue({
        user: { id: '1', name: 'Test', email: 'test@test.com' },
        session: { token: 'tok' },
      }),
    });

    function SignOutConsumer() {
      const { signOut, isAuthenticated } = useAuth();
      return (
        <div>
          <button onClick={() => signOut()}>Sign Out</button>
          <span data-testid="auth">{String(isAuthenticated)}</span>
        </div>
      );
    }

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <SignOutConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('true');
    });

    await act(async () => {
      await userEvent.click(screen.getByText('Sign Out'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('false');
    });
  });
});

/**
 * objectstack#29042 — a step registered with `registerBeforeSignOut` runs while
 * the session still exists: `signOut()` awaits it before `client.signOut()`,
 * and a failing step does not hold the sign-out back.
 */
describe('signOut runs the before-sign-out steps first', () => {
  function SignOutButton() {
    const { signOut, isAuthenticated } = useAuth();
    return (
      <div>
        <button onClick={() => signOut()}>Sign Out</button>
        <span data-testid="auth">{String(isAuthenticated)}</span>
      </div>
    );
  }

  function signedInClient(order: string[]) {
    return createMockClient({
      getSession: vi.fn().mockResolvedValue({
        user: { id: '1', name: 'Test', email: 'test@test.com' },
        session: { token: 'tok' },
      }),
      signOut: vi.fn().mockImplementation(async () => {
        order.push('client.signOut');
      }),
    });
  }

  async function signOutThrough(client: AuthClient) {
    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <SignOutButton />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('true'));
    await act(async () => {
      await userEvent.click(screen.getByText('Sign Out'));
    });
    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('false'));
  }

  it('awaits a registered step before the session ends', async () => {
    resetBeforeSignOutForTests();
    const order: string[] = [];
    const remove = registerBeforeSignOut(async () => {
      await Promise.resolve();
      order.push('step');
    });
    await signOutThrough(signedInClient(order));
    expect(order).toEqual(['step', 'client.signOut']);
    remove();
  });

  it('a step that fails does not stop the sign-out', async () => {
    resetBeforeSignOutForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];
    const remove = registerBeforeSignOut(async () => {
      throw new Error('unregister failed');
    });
    await signOutThrough(signedInClient(order));
    expect(order).toEqual(['client.signOut']);
    remove();
    warn.mockRestore();
  });
});

describe('AuthGuard', () => {
  it('shows loading fallback while loading', () => {
    const client = createMockClient({
      getSession: () => new Promise(() => {}), // Never resolves
    });

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <AuthGuard loadingFallback={<span>Loading...</span>} fallback={<span>Not auth</span>}>
          <span>Protected</span>
        </AuthGuard>
      </AuthProvider>,
    );

    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('shows fallback when not authenticated', async () => {
    const client = createMockClient();

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <AuthGuard fallback={<span>Not authenticated</span>}>
          <span>Protected content</span>
        </AuthGuard>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Not authenticated')).toBeTruthy();
    });
  });

  it('shows children when authenticated', async () => {
    const client = createMockClient({
      getSession: vi.fn().mockResolvedValue({
        user: { id: '1', name: 'Test', email: 'test@test.com' },
        session: { token: 'tok' },
      }),
    });

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <AuthGuard fallback={<span>Not auth</span>}>
          <span>Protected content</span>
        </AuthGuard>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Protected content')).toBeTruthy();
    });
  });

  it('enforces role requirements', async () => {
    const client = createMockClient({
      getSession: vi.fn().mockResolvedValue({
        user: { id: '1', name: 'Test', email: 'test@test.com', role: 'member' },
        session: { token: 'tok' },
      }),
    });

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <AuthGuard requiredRoles={['admin']} fallback={<span>Access denied</span>}>
          <span>Admin content</span>
        </AuthGuard>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Access denied')).toBeTruthy();
    });
  });

  it('allows access when user has required role', async () => {
    const client = createMockClient({
      getSession: vi.fn().mockResolvedValue({
        user: { id: '1', name: 'Admin', email: 'admin@test.com', role: 'admin' },
        session: { token: 'tok' },
      }),
    });

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <AuthGuard requiredRoles={['admin']} fallback={<span>Access denied</span>}>
          <span>Admin content</span>
        </AuthGuard>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Admin content')).toBeTruthy();
    });
  });

  it('allows access when user holds one of the required positions', async () => {
    // Until objectui#5424 this fixture spelled the array `roles`, pinning the
    // retired dialect: it stayed green precisely because the alias branch this
    // card deletes still read it. `positions` is the published spelling
    // (framework ADR-0090 D3); the full admission/refusal matrix lives in
    // `authGuardPositions-5424.test.tsx`.
    const client = createMockClient({
      getSession: vi.fn().mockResolvedValue({
        user: { id: '1', name: 'Manager', email: 'mgr@test.com', positions: ['manager', 'viewer'] },
        session: { token: 'tok' },
      }),
    });

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <AuthGuard requiredRoles={['admin', 'manager']} fallback={<span>Access denied</span>}>
          <span>Manager content</span>
        </AuthGuard>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Manager content')).toBeTruthy();
    });
  });

  it('does NOT honour the retired `roles` spelling as a second dialect', async () => {
    // framework ADR-0090 D3 renamed `roles` → `positions` with no deprecation
    // window and bans resurrecting the old name as a fallback. Before
    // objectui#5424 this exact fixture was ADMITTED (the gate read
    // `user.roles` first); a regression that quietly re-reads it turns this
    // red before it can widen any real gate.
    const client = createMockClient({
      getSession: vi.fn().mockResolvedValue({
        user: { id: '1', name: 'Relic', email: 'relic@test.com', role: 'user', roles: ['admin'] },
        session: { token: 'tok' },
      }),
    });

    render(
      <AuthProvider authUrl="/api/auth" client={client}>
        <AuthGuard requiredRoles={['admin']} fallback={<span>Access denied</span>}>
          <span>Admin content</span>
        </AuthGuard>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Access denied')).toBeTruthy();
    });
  });
});

/**
 * objectstack#32138 — a 401 on an API call re-checks the session, and only
 * the server's "no session" ends it in the tab. Driven through the real
 * `createAuthenticatedFetch` and a real `createAuthClient`, whose `get-session`
 * answers are scripted at the fetch seam: the "was this read answered?" signal
 * the re-check relies on exists only on a client that module built.
 */
describe('a 401 on an API call re-checks the session (objectstack#32138)', () => {
  const AUTH_URL = 'http://localhost/api/v1/auth';
  const ALICE = { id: '1', name: 'Alice', email: 'alice@test.com' };

  /**
   * Budget for each step of the chain (mount read -> identity set; 401 -> re-check
   * read -> identity cleared). Each step is a few awaited microtasks plus one React
   * commit, tens of ms on an idle box; the 1000 ms `waitFor` default was measured
   * too tight when a Test UI shard runs ~5000 tests alongside (one 1022 ms red).
   * It bounds only a failure's wait: a passing run returns as soon as the DOM says so.
   * It is not what orders the chain: `signedIn()` and `sessionReads()` below do that.
   */
  const CHAIN_MS = 10_000;

  /** What `get-session` answers next. */
  let getSessionAnswer: () => Promise<Response>;

  /**
   * Resolves when the provider subscribes to the 401 reports, which it does only
   * while it holds a session. That subscription is a passive effect of the commit
   * that puts identity on screen, and React can run it in a later task than the
   * commit's DOM write. A `waitFor` on the DOM can return inside that gap, and a
   * 401 reported there reaches no listener: nothing re-checks, and the case waits
   * out its whole budget (objectstack#32713: measured 1 in 40 iterations on a
   * shared box, every failure with zero listeners at the report). So the test
   * waits for the subscription itself, settled by the subscription and not by a poll.
   */
  let providerListening: Promise<void>;
  let subscribeSpy: { mockRestore(): void };

  beforeEach(() => {
    let heard!: () => void;
    providerListening = new Promise<void>((resolve) => {
      heard = resolve;
    });
    const subscribe = sessionEndEvents.subscribe;
    subscribeSpy = vi.spyOn(sessionEndEvents, 'subscribe').mockImplementation((listener) => {
      const unsubscribe = subscribe(listener);
      heard();
      return unsubscribe;
    });
  });

  function liveSession() {
    return new Response(JSON.stringify({ user: ALICE, session: { id: 's1', userId: '1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function realClient() {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL) => getSessionAnswer()) as unknown as typeof fetch;
    const client = createAuthClient({ baseURL: AUTH_URL, fetchFn });
    // Observed, not replaced: `recheckAnswered()` awaits the answer the provider awaits.
    vi.spyOn(client, 'getSession');
    return { client, fetchFn };
  }

  /**
   * Settles once the latest `getSession()` answer has been handed to the
   * provider. The provider awaited that same promise first, so its continuation
   * has run by the time this one resumes.
   */
  async function recheckAnswered(client: AuthClient) {
    const answers = vi.mocked(client.getSession).mock.results;
    await answers[answers.length - 1].value;
  }

  /**
   * The `get-session` reads that reached the server. Only these can be the
   * re-check: the same client also sends `organization/list` once a session is
   * held, and that request can land after the count is taken, so counting every
   * request let it stand in for a re-check that never happened.
   */
  function sessionReads(fetchFn: typeof fetch): number {
    return vi
      .mocked(fetchFn)
      .mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith('/get-session')).length;
  }

  async function signedIn() {
    getSessionAnswer = async () => liveSession();
    const { client, fetchFn } = realClient();
    render(
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('user-name').textContent).toBe('Alice'), {
      timeout: CHAIN_MS,
    });
    // Identity is on screen; the 401 subscription may still be pending.
    await providerListening;
    return { client, fetchFn };
  }

  /** An API call on the data lane answers 401. */
  async function apiAnswers401() {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await act(async () => {
      await createAuthenticatedFetch()('http://localhost/api/v1/meta/page/home');
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    subscribeSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('the server answers "no session": identity clears, so the guard can send the visitor to sign in', async () => {
    const { fetchFn } = await signedIn();
    const reads = sessionReads(fetchFn);

    getSessionAnswer = async () => new Response('null', { status: 401 });
    await apiAnswers401();

    // Wait on the event first: the re-check read itself reaching the server.
    await waitFor(() => expect(sessionReads(fetchFn)).toBeGreaterThan(reads), {
      timeout: CHAIN_MS,
    });
    await waitFor(() => expect(screen.getByTestId('authenticated').textContent).toBe('false'), {
      timeout: CHAIN_MS,
    });
    expect(screen.getByTestId('user-name').textContent).toBe('none');
    expect(sessionReads(fetchFn)).toBeGreaterThan(reads);
  });

  it('the server says the session is live: nothing changes', async () => {
    const { client, fetchFn } = await signedIn();
    const reads = sessionReads(fetchFn);

    await apiAnswers401();

    await waitFor(() => expect(sessionReads(fetchFn)).toBeGreaterThan(reads), {
      timeout: CHAIN_MS,
    });
    // Read "nothing changed" after the provider has the re-check's answer, not while it is in flight.
    await recheckAnswered(client);
    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-name').textContent).toBe('Alice');
  });

  it('the re-check is not answered (transport error): the session is kept, an unanswered read is not a sign-out', async () => {
    const { fetchFn } = await signedIn();
    const reads = sessionReads(fetchFn);

    getSessionAnswer = async () => {
      throw new TypeError('Failed to fetch');
    };
    await apiAnswers401();

    await waitFor(() => expect(sessionReads(fetchFn)).toBeGreaterThan(reads), {
      timeout: CHAIN_MS,
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('user-name').textContent).toBe('Alice');
  });

  it('no session held: a 401 is the expected answer and asks the server nothing', async () => {
    getSessionAnswer = async () => new Response('null', { status: 401 });
    const { client, fetchFn } = realClient();
    render(
      <AuthProvider authUrl={AUTH_URL} client={client}>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    const reads = vi.mocked(fetchFn).mock.calls.length;

    await apiAnswers401();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(vi.mocked(fetchFn).mock.calls.length).toBe(reads);
    expect(screen.getByTestId('authenticated').textContent).toBe('false');
  });
});
