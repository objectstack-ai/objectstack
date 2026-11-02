// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#29187 — where the form routes sit in `App`'s
 * route tree, which decides what `FormPage`'s up-front write refusal reads.
 *
 * The app-less `/forms/:name` used to sit beside the console's permissions
 * layout, under `ProtectedRoute` alone, while its in-app twin
 * `/apps/:appName/forms/:name` sat under it. The refusal reads the caller's
 * grants from that layout's `/auth/me/permissions` answer, so on the app-less
 * URL it would have had none and the same form would behave differently by
 * URL. `/forms/:name` is now a child of the same pathless layout route as
 * `/home` and `/apps/:appName/*`: one answer, asked once per session load,
 * held across a hop between them. `/f/:slug` stays outside it: anonymous,
 * no answer, no request.
 *
 * What is real: `App`'s route tree, `ConsolePermissionsScope` and the
 * `MePermissionsProvider` it mounts. The network is the console's
 * authenticated fetcher, mocked. The probes stand where `InternalFormRoute`,
 * the public `FormPage` and Home's page render, and report what they see.
 * `ProtectedRoute` is reduced to the metadata context it provides.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { useContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { usePermissions, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
// Not on the package's entry: the context object itself, read by its module id
// (`@object-ui/permissions` resolves to `packages/permissions/src`, so this is
// the same module instance the provider writes).
import { PermCtx } from '../../../../packages/permissions/src/PermissionContext';

const net = vi.hoisted(() => ({
  /** Every URL the console's authenticated fetcher was asked for. */
  calls: [] as string[],
}));

const METADATA: MetadataContextValue = {
  apps: [{ name: 'crm', label: 'CRM', active: true, navigation: [] }] as never,
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

/** A member who may read `qar8_fsb` and not create it. */
function permissionsAnswer(): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u_member',
    tenantId: null,
    positions: [],
    hasAnyQueue: false,
    permissionSets: ['member'],
    systemPermissions: [],
    objects: { qar8_fsb: { allowRead: true } },
    fields: {},
  } as MePermissionsAuthenticatedResponse;
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
  useAuth: () => ({ user: { id: 'u_member', name: 'Member', email: 'member@example.com' }, isAuthenticated: true, isLoading: false }),
  createAuthenticatedFetch: () => (input: unknown) => {
    net.calls.push(String(input));
    return respond(input);
  },
}));

vi.mock('../components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children?: ReactNode }) => (
    <MetadataCtx.Provider value={METADATA}>{children}</MetadataCtx.Provider>
  ),
}));

/** What a form route sees of the caller's grants on the form's object. */
function GrantProbe({ testId }: { testId: string }) {
  const ctx = useContext(PermCtx);
  const { isLoaded, can } = usePermissions();
  const verdict = ctx === null ? 'no-perm-ctx' : isLoaded ? `create:${String(can('qar8_fsb', 'create'))}` : 'not-loaded';
  return <div data-testid={testId}>{verdict}</div>;
}

/** Stands where Home's page renders, with a way to follow a form link. */
function HomeProbe() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/forms/qar8_fsb.form')}>
      open form
    </button>
  );
}

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConsoleShell: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ConsoleToaster: () => null,
  LoadingScreen: () => <div data-testid="loading-screen" />,
  DefaultHomePage: () => <HomeProbe />,
  DefaultAppContent: () => null,
  BuilderLanding: () => null,
  StudioDesignSurface: () => null,
  getProductName: () => 'ObjectOS',
  getFaviconUrl: () => '',
}));

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
vi.mock('../components/FormPage', () => ({ FormPage: () => <GrantProbe testId="public-form" /> }));
vi.mock('../components/InternalFormRoute', () => ({
  InternalFormRoute: () => <GrantProbe testId="internal-form" />,
  InAppFormRoute: () => <GrantProbe testId="in-app-form" />,
}));
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

const permissionsCalls = () => net.calls.filter((u) => u.includes('/auth/me/permissions'));

function renderAt(url: string) {
  window.history.pushState({}, '', url);
  return render(<App />);
}

beforeEach(() => {
  net.calls = [];
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('the form routes and the permissions answer (#29187)', () => {
  it('/forms/NAME renders under the permissions answer, asked once', async () => {
    renderAt('/forms/qar8_fsb.form');
    await waitFor(() => expect(screen.getByTestId('internal-form')).toHaveTextContent('create:false'));
    expect(permissionsCalls()).toHaveLength(1);
  });

  it('/forms/NAME waits on the answer the way /home and /apps do: the loading screen first, no form', async () => {
    renderAt('/forms/qar8_fsb.form');
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('internal-form')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('internal-form')).toBeInTheDocument());
  });

  it('/home then a form link keeps the one answer: /auth/me/permissions asked ONCE in total', async () => {
    renderAt('/home');
    await waitFor(() => expect(screen.getByRole('button', { name: 'open form' })).toBeInTheDocument());
    await act(async () => {
      screen.getByRole('button', { name: 'open form' }).click();
    });
    await waitFor(() => expect(screen.getByTestId('internal-form')).toHaveTextContent('create:false'));
    expect(permissionsCalls()).toHaveLength(1);
  });

  it('/f/SLUG stays outside it: no permission context and no /auth/me/permissions request', async () => {
    renderAt('/f/feedback');
    await waitFor(() => expect(screen.getByTestId('public-form')).toHaveTextContent('no-perm-ctx'));
    expect(permissionsCalls()).toHaveLength(0);
  });
});
