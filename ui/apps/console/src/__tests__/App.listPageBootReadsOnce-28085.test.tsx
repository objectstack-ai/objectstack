// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28085 — a console list page load asks `auth/get-session`,
 * `meta/app`, `auth/me/permissions` and `me/apps` once each.
 *
 * ## What is real here
 *
 * The boot order `main.tsx` runs: the pre-React `preflightAuth` validating the
 * stored Bearer, then `App` — the real `AuthProvider` with its own better-auth
 * client, `AuthGuard`, `ProtectedRoute`, `ConsoleShell`, `ConnectedShell` with
 * the real `ObjectStackAdapter` and `MetadataProvider`, `RequireOrganization`,
 * `ConsolePermissionsScope` (the `/me/permissions` provider) and the console's
 * `LauncherAppsProvider` (`/me/apps`). The network is one stubbed global
 * `fetch` that records every URL and answers it, so a count is of requests that
 * would reach the wire. No `React.StrictMode`: a built console does not replay
 * effects, and the doubling this card was filed on was that replay behind the
 * Vite dev server.
 *
 * The app's own content is a stub: the four reads under test are the shell's,
 * which every list page shares, not the list view's.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
// Paid at collection, not inside the mock factory's clocked first call.
import '@object-ui/react';
import '@object-ui/app-shell';

const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };
const USER = { id: 'u1', name: 'Ada', email: 'ada@example.test' };
const TOKEN = 'tok_valid';
const SESSION_BODY = {
  user: USER,
  session: { id: 's_1', userId: USER.id, token: TOKEN, activeOrganizationId: ORG.id, expiresAt: '2099-01-01T00:00:00.000Z' },
};

/** The one app the deployment serves; the list page under test is one of its objects. */
const APPS = [{ name: 'crm', label: 'CRM', active: true, isDefault: true }];
const LIST_PAGE = '/apps/crm/crm_contact';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const calls: string[] = [];
const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
  const url = urlOf(input);
  calls.push(url);
  if (url.includes('/auth/get-session')) return json(SESSION_BODY);
  if (url.includes('/auth/organization/list')) return json([ORG]);
  if (url.includes('/auth/organization/get-active-member')) {
    return json({ id: 'm_1', organizationId: ORG.id, userId: USER.id, role: 'member' });
  }
  if (url.includes('/auth/me/permissions')) {
    return json({
      authenticated: true, userId: USER.id, tenantId: ORG.id, positions: [], permissionSets: [], objects: {}, fields: {}, hasAnyQueue: false, objectsUsingQueues: [],
    });
  }
  if (url.includes('/auth/')) return json({});
  if (url.includes('/api/v1/discovery')) {
    return json({
      success: true,
      data: { version: '1.0.0', apiName: 'v1', routes: { data: '/api/v1/data', metadata: '/api/v1/meta' }, services: {} },
    });
  }
  if (url.includes('/me/apps')) return json({ apps: APPS });
  if (/\/api\/v1\/meta\/app(\?|$)/.test(url)) return json({ success: true, data: { type: 'app', items: APPS } });
  if (url.includes('/api/v1/meta/')) return json({ success: true, data: { items: [] } });
  if (url.includes('/api/v1/data/')) return json({ success: true, data: { records: [], total: 0 } });
  return json({ success: true, data: {} });
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
vi.mock('../pages/auth/LoginPage', () => ({ LoginPage: () => <div data-testid="login-page" /> }));
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
import { preflightAuth } from '../lib/auth-preflight';

const pathOf = (url: string) => {
  try {
    return new URL(url, 'http://console.test').pathname;
  } catch {
    return url;
  }
};
const readsOf = (test: (path: string) => boolean) => calls.filter((u) => test(pathOf(u)));
const FOUR = {
  'auth/get-session': (p: string) => p.endsWith('/api/v1/auth/get-session'),
  'meta/app': (p: string) => p.endsWith('/api/v1/meta/app'),
  'auth/me/permissions': (p: string) => p.endsWith('/api/v1/auth/me/permissions'),
  'me/apps': (p: string) => p.endsWith('/api/v1/me/apps'),
} as const;
const countFour = () =>
  Object.fromEntries(Object.entries(FOUR).map(([name, test]) => [name, readsOf(test).length]));

/** Let the effects and the answers they await run out (a count of one needs it). */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

/** The boot `main.tsx` runs, landing on a list page. */
async function openListPage() {
  localStorage.setItem('auth-session-token', TOKEN);
  window.history.pushState({}, '', LIST_PAGE);
  await preflightAuth('/api/v1/auth');
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument(), { timeout: 5000 });
  // Each read is sent from an effect, which a busy run can flush after the DOM
  // shows the page: wait until all four have gone out, then let the load run out.
  await waitFor(() => {
    for (const test of Object.values(FOUR)) expect(readsOf(test).length).toBeGreaterThan(0);
  });
  await settle();
}

beforeEach(() => {
  calls.length = 0;
  fetchStub.mockClear();
  vi.stubGlobal('fetch', fetchStub);
  localStorage.clear();
  sessionStorage.clear();
  delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('objectui.authPreflightSession')];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('a console list page load asks each of its four boot reads once (objectstack#28085)', () => {
  it('get-session, meta/app, me/permissions and me/apps go out once each', async () => {
    await openListPage();
    expect(window.location.pathname).toBe(LIST_PAGE);
    expect(countFour()).toEqual({
      'auth/get-session': 1,
      'meta/app': 1,
      'auth/me/permissions': 1,
      'me/apps': 1,
    });
  });
});
