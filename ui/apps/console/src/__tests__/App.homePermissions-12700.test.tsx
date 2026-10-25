// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12700 (part 2) — `/home` answers a `current_user.can(object, verb)`
 * navigation gate from the console's ONE `/auth/me/permissions` source.
 *
 * ## The defect
 *
 * The console mounted `MePermissionsProvider` inside `AppContent`, the element
 * of `/apps/:appName/*` alone. Home's bell and activity card build their roster
 * from every app's navigation (`activityObjectRoster` through
 * `useNavMemberGates`), so on `/home` a gate such as HotCRM's
 * `current_user.can("crm_opportunity", "read")` had no payload to answer from:
 * the engine refused, the entry was withheld (part 1), and the refusal was
 * printed on every console load, which lands on `/home`.
 *
 * ## What is real here
 *
 * `App`'s route tree (the pathless layout route over `/home` and
 * `/apps/:appName/*`, and the Studio subtree beside it), `ConsolePermissionsScope`
 * and the `MePermissionsProvider` it mounts, `HomeLayout` and the
 * `ExpressionProvider` it mounts, `useNavMemberGates`, `activityObjectRoster`,
 * the formula engine, and Studio's entry gate. The network is the mock: the
 * console's authenticated fetcher answers `/auth/me/permissions`. The probes
 * stand where Home's page, the app content and the Studio builder render, and
 * report what they see. `ProtectedRoute` is reduced to the metadata context it
 * provides through `ConnectedShell`; auth is not the question here. Chrome that
 * decides nothing about visibility (the top bar, the palette, the assistant
 * launcher) is stubbed.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { useContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MetadataCtx, type MetadataContextValue, __resetVisibilityPredicateWarnings } from '@object-ui/react';
import { usePermissions, type MePermissionsResponse } from '@object-ui/permissions';
// Not on the package's entry: the context object itself, read by its module id
// (`@object-ui/permissions` resolves to `packages/permissions/src`, so this is
// the same module instance the provider writes).
import { PermCtx } from '../../../../packages/permissions/src/PermissionContext';
import type { NavigationItem } from '@object-ui/types';

const net = vi.hoisted(() => ({
  /** Every URL the console's authenticated fetcher was asked for. */
  calls: [] as string[],
  /** Whether the permissions answer grants read on `crm_opportunity`. */
  opportunityRead: false,
}));

/** The served shape: the spec normalizes an authored `visible` string into a CEL envelope. */
const CAN_READ_OPPORTUNITY = { dialect: 'cel', source: 'current_user.can("crm_opportunity", "read")' };

/**
 * An OBJECT entry on a readable object, gated on a DIFFERENT object's read: the
 * roster only lists object entries, and an entry on `crm_opportunity` itself
 * would be pruned by the object-read gate (objectui#12109) whatever the
 * predicate said.
 */
const NAVIGATION: NavigationItem[] = [
  { id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
  { id: 'nav_forecasts', type: 'object', objectName: 'crm_forecast', label: 'Forecasts', visible: CAN_READ_OPPORTUNITY as never },
];

const METADATA: MetadataContextValue = {
  apps: [{ name: 'crm', label: 'CRM', active: true, navigation: NAVIGATION }] as never,
  objects: [],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready',
} as unknown as MetadataContextValue;

function permissionsAnswer(): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u_agent',
    tenantId: null,
    roles: [],
    permissionSets: ['service_agent'],
    systemPermissions: ['studio.access'],
    objects: {
      crm_account: { allowRead: true },
      crm_forecast: { allowRead: true },
      crm_opportunity: { allowRead: net.opportunityRead },
    },
    fields: {},
  } as MePermissionsResponse;
}

function respond(input: unknown): Promise<Response> {
  const url = String(input);
  const body = url.includes('/auth/me/permissions') ? permissionsAnswer() : {};
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response);
}

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AuthProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: { id: 'u_agent', name: 'Agent', email: 'agent@example.com' }, isAuthenticated: true, isLoading: false }),
  // The network: every authenticated read the console makes goes through here.
  createAuthenticatedFetch: () => (input: unknown) => {
    net.calls.push(String(input));
    return respond(input);
  },
}));

// What `ConnectedShell` provides to everything under `ProtectedRoute` that this
// question reads: the app list. Studio's routes use the same wrapper.
vi.mock('../components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children?: ReactNode }) => (
    <MetadataCtx.Provider value={METADATA}>{children}</MetadataCtx.Provider>
  ),
}));

/** Stands where Home's page renders: Home's activity roster, as the bell and the card derive it. */
function HomeRosterProbe() {
  const gates = useNavMemberGates();
  const roster = activityObjectRoster(METADATA.apps as never, gates);
  const navigate = useNavigate();
  return (
    <div>
      <div data-testid="home-roster">{roster.join(',')}</div>
      <button type="button" onClick={() => navigate('/apps/crm')}>open crm</button>
    </div>
  );
}

/** Stands where the app content renders. */
function AppContentProbe() {
  const { isLoaded } = usePermissions();
  return <div data-testid="app-content">{isLoaded ? 'permissions-loaded' : 'no-permissions'}</div>;
}

/** Stands where the Studio builder renders: does it sit under a permission context? */
function StudioBuilderProbe() {
  const ctx = useContext(PermCtx);
  return <div data-testid="studio-builder">{ctx === null ? 'no-perm-ctx' : 'perm-ctx'}</div>;
}

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConsoleShell: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ConsoleToaster: () => null,
  LoadingScreen: () => <div data-testid="loading-screen" />,
  DefaultHomePage: () => <HomeRosterProbe />,
  DefaultAppContent: () => <AppContentProbe />,
  BuilderLanding: () => <StudioBuilderProbe />,
  StudioDesignSurface: () => <StudioBuilderProbe />,
  getProductName: () => 'ObjectOS',
  getFaviconUrl: () => '',
}));

// Chrome that decides nothing about visibility, by the module id `HomeLayout`
// and the Studio frame import it through.
vi.mock('../../../../packages/app-shell/src/layout/AppHeader', () => ({ AppHeader: () => null }));
vi.mock('../../../../packages/app-shell/src/chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../../../packages/app-shell/src/hooks/useAiSurface', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));

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

import { useNavMemberGates } from '../../../../packages/app-shell/src/hooks/useNavMemberGates';
import { activityObjectRoster } from '../../../../packages/app-shell/src/hooks/sharedUserFeeds';
import { App } from '../App';

const permissionsCalls = () => net.calls.filter((u) => u.includes('/auth/me/permissions'));
const visibilityWarnings = (spy: MockInstance<typeof console.warn>) =>
  spy.mock.calls.map((c) => c.map(String).join(' ')).filter((l) => l.includes('app-shell:visible'));

function renderAt(url: string) {
  window.history.pushState({}, '', url);
  return render(<App />);
}

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  net.calls = [];
  net.opportunityRead = false;
  localStorage.clear();
  sessionStorage.clear();
  __resetVisibilityPredicateWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  warn.mockRestore();
  window.history.pushState({}, '', '/');
});

describe('console /home — a navigation can() gate answers from the one /auth/me/permissions source (objectui#12700)', () => {
  it('(a) a fresh /home for a member without read: the gated entry is absent from the activity roster, and nothing is reported', async () => {
    renderAt('/home');
    await waitFor(() => expect(screen.getByTestId('home-roster')).toHaveTextContent('crm_account'));
    expect(screen.getByTestId('home-roster').textContent).toBe('crm_account');
    expect(visibilityWarnings(warn)).toEqual([]);
  });

  it('(b) a fresh /home for a member with read: the gated entry is in the roster, and nothing is reported', async () => {
    net.opportunityRead = true;
    renderAt('/home');
    await waitFor(() => expect(screen.getByTestId('home-roster').textContent).toBe('crm_account,crm_forecast'));
    expect(visibilityWarnings(warn)).toEqual([]);
  });

  it('(c) /home then /apps/crm asks /auth/me/permissions ONCE in total', async () => {
    renderAt('/home');
    await waitFor(() => expect(screen.getByTestId('home-roster')).toHaveTextContent('crm_account'));
    await act(async () => {
      screen.getByRole('button', { name: 'open crm' }).click();
    });
    await waitFor(() => expect(screen.getByTestId('app-content')).toHaveTextContent('permissions-loaded'));
    expect(permissionsCalls()).toHaveLength(1);
  });

  it('(c, loading) Home waits on the answer the way /apps does: the loading screen, not the page', async () => {
    renderAt('/home');
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('home-roster')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('home-roster')).toBeInTheDocument());
  });

  it('(d) CONTROL: /studio mounts no permission context; the builder renders outside it as before', async () => {
    renderAt('/studio');
    await waitFor(() => expect(screen.getByTestId('studio-builder')).toHaveTextContent('no-perm-ctx'));
  });
});
