// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32633 — opening the console at its root (`/`, served as
 * `/_console/`) and landing on the default app asks `GET /meta/app` and the
 * boot `sys_user_preference` read once each, the same as opening the app page
 * directly.
 *
 * ## The defect
 *
 * `<Route path="/">` had its own `ProtectedRoute`, so its own `ConnectedShell`:
 * a data adapter, a `MetadataProvider` (which reads `/meta/app` eagerly, to
 * resolve the landing) and the `UserStateBridge` that attaches the favorites,
 * recents and list/record-state adapters (one batched `sys_user_preference`
 * read). The landing `/apps/<app>` lives under a different route, whose
 * `ProtectedRoute` mounted a second shell after the redirect: a new adapter, a
 * new metadata provider and a new bridge, so every one of those reads went out
 * again, one wave later.
 *
 * ## What is real here
 *
 * `App`'s route tree, `ProtectedRoute`, `ConsoleShell` with its user-state
 * providers, `ConnectedShell` with the real `ObjectStackAdapter`,
 * `MetadataProvider` and `UserStateBridge`, `RequireOrganization`,
 * `ConsolePermissionsScope` and `RootLandingRedirect`. The network is the
 * console's authenticated fetcher, which records every URL and answers it.
 * Auth is a signed-in session in its active organization (`AuthGuard` has
 * opened). The app's own content and Home are stubs: the reads under test are
 * the shell's, not the page's.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
// Paid at collection, not inside the mock factory's clocked first call.
import '@object-ui/react';
import '@object-ui/app-shell';

const h = vi.hoisted(() => ({
  /** Every URL the console's authenticated fetcher was asked for, in order. */
  calls: [] as string[],
}));

const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };
const USER = { id: 'u1', name: 'Ada', email: 'ada@example.com' };

/** The one app the deployment serves, declared as the landing. */
const APPS = [{ name: 'crm', label: 'CRM', active: true, isDefault: true }];

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return json(body);
    },
  } as unknown as Response;
}

function respond(input: unknown): Promise<Response> {
  const url = String(typeof input === 'object' && input && 'url' in input ? (input as Request).url : input);
  if (url.includes('/api/v1/discovery')) {
    return Promise.resolve(json({
      success: true,
      data: { version: '1.0.0', apiName: 'v1', routes: { data: '/api/v1/data', metadata: '/api/v1/meta' }, services: {} },
    }));
  }
  if (url.includes('/auth/me/permissions')) {
    return Promise.resolve(json({
      authenticated: true, userId: USER.id, tenantId: ORG.id, positions: [], permissionSets: [], objects: {}, fields: {}, hasAnyQueue: false,
    }));
  }
  if (url.includes('/me/apps')) return Promise.resolve(json({ apps: APPS }));
  if (/\/api\/v1\/meta\/app(\?|$)/.test(url)) {
    return Promise.resolve(json({ success: true, data: { type: 'app', items: APPS } }));
  }
  if (url.includes('/api/v1/meta/')) return Promise.resolve(json({ success: true, data: { items: [] } }));
  if (url.includes('/api/v1/data/')) return Promise.resolve(json({ success: true, data: { records: [], total: 0 } }));
  return Promise.resolve(json({ success: true, data: {} }));
}

vi.mock('@object-ui/auth', async (importOriginal) => {
  const record = (input: unknown) => {
    h.calls.push(String(typeof input === 'object' && input && 'url' in input ? (input as Request).url : input));
    return respond(input);
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    AuthProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    AuthGuard: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useAuth: () => ({
      user: USER,
      session: { activeOrganizationId: ORG.id },
      isAuthenticated: true,
      isLoading: false,
      organizations: [ORG],
      activeOrganization: ORG,
      isOrganizationsLoading: false,
      getAuthConfig: () => Promise.resolve({ features: { multiOrgEnabled: true } }),
    }),
    createAuthenticatedFetch: () => record,
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConsoleToaster: () => null,
  DefaultHomeLayout: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DefaultHomePage: () => <div data-testid="home-page" />,
  DefaultAppContent: () => <div data-testid="app-content" />,
}));

vi.mock('../LocalizationFetchProvider', () => ({
  LocalizationFetchProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../pages/settings/FirstRunChecklist', () => ({ FirstRunChecklist: () => null }));
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

const pathOf = (url: string) => {
  try {
    return new URL(url, 'http://console.test').pathname;
  } catch {
    return url;
  }
};
const appListReads = () => h.calls.filter((u) => /\/api\/v1\/meta\/app(\?|$)/.test(u));
const preferenceReads = () => h.calls.filter((u) => pathOf(u).endsWith('/api/v1/data/sys_user_preference'));
const duplicateUrls = () => h.calls.filter((u, i) => h.calls.indexOf(u) !== i);

/** Let the effects and the answers they await run out (a negative reading needs it). */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

async function openAt(url: string) {
  window.history.pushState({}, '', url);
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument(), { timeout: 5000 });
  await waitFor(() => expect(preferenceReads().length).toBeGreaterThan(0));
  await settle();
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

describe('the console root lands on the default app with one /meta/app read and one boot preference read (objectstack#32633)', () => {
  it('opening `/` lands on `/apps/crm` and asks /meta/app and sys_user_preference once each', async () => {
    await openAt('/');
    expect(window.location.pathname).toBe('/apps/crm');
    expect(appListReads()).toHaveLength(1);
    expect(preferenceReads()).toHaveLength(1);
    // Nothing else the shell asks goes out twice either (the adapter's
    // discovery, the signed-in user's locale row).
    expect(duplicateUrls()).toEqual([]);
  });

  it('CONTROL: opening the app page directly asks each once too', async () => {
    await openAt('/apps/crm');
    expect(window.location.pathname).toBe('/apps/crm');
    expect(appListReads()).toHaveLength(1);
    expect(preferenceReads()).toHaveLength(1);
    expect(duplicateUrls()).toEqual([]);
  });
});
