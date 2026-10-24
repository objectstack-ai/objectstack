/**
 * Tests for AuthProvider, useAuth, and AuthGuard
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { AuthGuard } from '../AuthGuard';
import type { AuthClient } from '../types';

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
