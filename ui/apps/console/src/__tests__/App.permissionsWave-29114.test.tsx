// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29114 — `/auth/me/permissions` leaves in the same wave as
 * `organization/list` when the `get-session` answer already names the active
 * organization.
 *
 * ## The defect
 *
 * `ConsolePermissionsScope` (the one permissions source for `/home` and every
 * app) is mounted under `ProtectedRoute`'s `ConnectedShell`, which renders
 * nothing until its adapter's `discovery` round trip answers, and under its
 * `RequireOrganization`, which renders nothing until `organization/list`
 * answers. Both leave when the session answer lands, so the permissions request
 * left one whole wave late, and every read Home and an app make after the
 * answer waited one wave longer. The server answers that endpoint for the
 * session's active organization, which the session answer already names.
 *
 * ## What is real here
 *
 * `App`'s route tree, `ConsolePermissionsRequest` beside the real
 * `ProtectedRoute`, the real `RequireOrganization` (its loading wait and its
 * redirect), `ConsolePermissionsScope` and the `MePermissionsProvider` and
 * `LauncherAppsProvider` it mounts. The auth state is a store the test moves
 * the way `AuthProvider` does: the session first, with the organization list
 * still in flight, then the list's answer. `ConnectedShell` is cut down to its
 * one effect on this order: nothing below it renders until the test says its
 * adapter connected. `AuthGuard` has opened by the time the session is known
 * and passes through. The network is the console's authenticated fetcher,
 * which records every URL.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
// Paid at collection, not inside the mock factory's clocked first call.
import '@object-ui/react';

interface AuthState {
  session: { activeOrganizationId?: string | null } | null;
  organizations: Array<{ id: string; name: string; slug: string }>;
  activeOrganization: { id: string; name: string; slug: string } | null;
  isOrganizationsLoading: boolean;
  /** Whether the metadata shell's adapter has connected (its `discovery` round trip answered). */
  shellReady: boolean;
}

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    /** Every URL the console's authenticated fetcher was asked for, in order. */
    calls: [] as string[],
    auth: null as unknown as AuthState,
    listeners,
    set(next: Partial<AuthState>) {
      h.auth = { ...h.auth, ...next };
      for (const l of Array.from(listeners)) l();
    },
  };
});

const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };

function respond(input: unknown): Promise<Response> {
  const url = String(input);
  const body = url.includes('/auth/me/permissions')
    ? { authenticated: true, userId: 'u1', tenantId: ORG.id, positions: [], permissionSets: [], objects: {}, fields: {}, hasAnyQueue: false }
    : url.includes('/me/apps')
      ? { apps: [] }
      : {};
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response);
}

vi.mock('@object-ui/auth', async (importOriginal) => {
  const { useSyncExternalStore: useStore } = await import('react');
  const subscribe = (l: () => void) => {
    h.listeners.add(l);
    return () => h.listeners.delete(l);
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    AuthProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    AuthGuard: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useAuth: () => {
      const auth = useStore(subscribe, () => h.auth);
      return {
        user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
        isAuthenticated: true,
        isLoading: false,
        getAuthConfig: () => Promise.resolve({ features: { multiOrgEnabled: true } }),
        ...auth,
      };
    },
    createAuthenticatedFetch: () => (input: unknown) => {
      h.calls.push(String(input));
      return respond(input);
    },
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => {
  const { MetadataCtx } = await import('@object-ui/react');
  const { useSyncExternalStore: useStore } = await import('react');
  const subscribe = (l: () => void) => {
    h.listeners.add(l);
    return () => h.listeners.delete(l);
  };
  // What `ConnectedShell` provides that this order reads: one active app, so the
  // launcher's `/me/apps` read has something to ask about.
  const metadata = {
    apps: [{ name: 'crm', label: 'CRM', active: true }],
    objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
    getItem: async () => null, getItemsByType: () => [], getTypeStatus: () => 'ready',
  } as never;
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    ConsoleShell: ({ children }: { children?: ReactNode }) => <>{children}</>,
      // The real shell renders nothing below it until its adapter has connected,
    // a round trip that leaves in the same wave as `organization/list`.
    ConnectedShell: function ConnectedShell({ children }: { children?: ReactNode }) {
      const ready = useStore(subscribe, () => h.auth.shellReady);
      if (!ready) return null;
      return <MetadataCtx.Provider value={metadata}>{children}</MetadataCtx.Provider>;
    },
    ConsoleToaster: () => null,
    LoadingScreen: () => <div data-testid="loading-screen" />,
    DefaultHomeLayout: ({ children }: { children?: ReactNode }) => <>{children}</>,
    DefaultHomePage: () => <div data-testid="home-page" />,
    DefaultAppContent: () => <div data-testid="app-content" />,
    DefaultOrganizationsLayout: ({ children }: { children?: ReactNode }) => <>{children}</>,
    DefaultOrganizationsPage: () => <div data-testid="organizations-page" />,
    getProductName: () => 'ObjectOS',
    getFaviconUrl: () => '',
  };
});

vi.mock('../LocalizationFetchProvider', () => ({
  LocalizationFetchProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../pages/settings/WorkspaceTimezonePrompt', () => ({ WorkspaceTimezonePrompt: () => null }));
vi.mock('../components/RootLandingRedirect', () => ({ RootLandingRedirect: () => null }));
vi.mock('../components/SetupRoute', () => ({ SetupRoute: () => null }));
vi.mock('../components/FormPage', () => ({ FormPage: () => null }));
vi.mock('../components/InternalFormRoute', () => ({ InternalFormRoute: () => null, InAppFormRoute: () => null }));
vi.mock('../components/MetadataHmrReloader', () => ({ MetadataHmrReloader: () => null }));
vi.mock('../components/FaviconSync', () => ({ FaviconSync: () => null }));
vi.mock('../pages/SharedRecordPage', () => ({ default: () => null }));
vi.mock('../pages/auth/LoginPage', () => ({ LoginPage: () => null }));
vi.mock('../pages/auth/RegisterPage', () => ({ RegisterPage: () => null }));
vi.mock('../pages/auth/ForgotPasswordPage', () => ({ ForgotPasswordPage: () => null }));
vi.mock('../pages/auth/ResetPasswordPage', () => ({ ResetPasswordPage: () => null }));
vi.mock('../pages/auth/SetPasswordPage', () => ({ SetPasswordPage: () => null }));
vi.mock('../pages/auth/VerifyEmailPage', () => ({ VerifyEmailPage: () => null }));
vi.mock('../pages/auth/VerifyEmailPromptPage', () => ({ VerifyEmailPromptPage: () => null }));
vi.mock('../pages/auth/OAuthConsentPage', () => ({ OAuthConsentPage: () => null }));
vi.mock('../pages/auth/DeviceAuthPage', () => ({ DeviceAuthPage: () => null }));
vi.mock('../dev/DevMasterDetail', () => ({ DevMasterDetail: () => null }));
vi.mock('../dev/DevLists', () => ({ DevLists: () => null }));
vi.mock('../dev/DevModal', () => ({ DevModal: () => null }));
vi.mock('../dev/DevLookup', () => ({ DevLookup: () => null }));
vi.mock('../dev/DevRowActions', () => ({ DevRowActions: () => null }));

import { App } from '../App';

const permissionsCalls = () => h.calls.filter((u) => u.includes('/auth/me/permissions'));
const launcherCalls = () => h.calls.filter((u) => u.includes('/me/apps'));

/** Let the first render's effects and the answers they await run out (a negative reading needs it). */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

function openAt(url: string, session: AuthState['session']) {
  // The moment `AuthGuard` opens: the session is known; `organization/list` and
  // the shell's `discovery` are in flight.
  h.auth = { session, organizations: [], activeOrganization: null, isOrganizationsLoading: true, shellReady: false };
  window.history.pushState({}, '', url);
  return render(<App />);
}

/** The shell's adapter connects (`discovery` answers). */
function shellAnswers() {
  act(() => h.set({ shellReady: true }));
}

/** `organization/list` answers. */
function organizationsAnswer(active: AuthState['activeOrganization'], organizations = [ORG]) {
  act(() => h.set({ organizations, activeOrganization: active, isOrganizationsLoading: false }));
}

beforeEach(() => {
  h.calls = [];
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('/auth/me/permissions leaves in the organization/list wave when the session names the active organization (objectstack#29114)', () => {
  it('the session names the organization: the request leaves while organization/list is still in flight, once; the page waits for the list', async () => {
    openAt('/home', { activeOrganizationId: ORG.id });
    // Asked now, beside organization/list and discovery (both still unanswered:
    // the test holds them), not after them.
    await waitFor(() => expect(permissionsCalls()).toHaveLength(1));
    await settle();
    // What needs the chosen organization still waits for it.
    shellAnswers();
    await settle();
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
    expect(launcherCalls()).toHaveLength(0);

    organizationsAnswer(ORG);
    await waitFor(() => expect(screen.getByTestId('home-page')).toBeInTheDocument());
    // The launcher's `/me/apps` read leaves from its provider's effect, which can
    // run after the commit that shows the page (objectstack#29468: red once on a
    // loaded Test UI shard). Wait for it, then let any second request show.
    await waitFor(() => expect(launcherCalls()).toHaveLength(1));
    await settle();
    // No second request and no duplicate URL: the answer asked early is the one used.
    expect(permissionsCalls()).toHaveLength(1);
    expect(launcherCalls()).toHaveLength(1);
    expect(new Set(h.calls).size).toBe(h.calls.length);
  });

  it('an app route takes the same path', async () => {
    openAt('/apps/crm', { activeOrganizationId: ORG.id });
    await waitFor(() => expect(permissionsCalls()).toHaveLength(1));
    await settle();
    // The other order: the organization list answers before the shell connects.
    organizationsAnswer(ORG);
    await settle();
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
    shellAnswers();
    await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument());
    expect(permissionsCalls()).toHaveLength(1);
  });

  it('CONTROL: a session that names no organization asks nothing until the organization pipeline has chosen one', async () => {
    openAt('/home', { activeOrganizationId: null });
    await settle();
    shellAnswers();
    await settle();
    expect(permissionsCalls()).toHaveLength(0);

    // e.g. the single-membership repair activated the one organization.
    organizationsAnswer(ORG);
    await waitFor(() => expect(screen.getByTestId('home-page')).toBeInTheDocument());
    expect(permissionsCalls()).toHaveLength(1);
  });

  it('CONTROL: a session with no active organization is sent to /organizations without asking for permissions', async () => {
    openAt('/home', { activeOrganizationId: null });
    await settle();
    shellAnswers();
    organizationsAnswer(null, [ORG, { id: 'org_2', name: 'Beta', slug: 'beta' }]);
    await waitFor(() => expect(screen.getByTestId('organizations-page')).toBeInTheDocument());
    expect(permissionsCalls()).toHaveLength(0);
  });
});
