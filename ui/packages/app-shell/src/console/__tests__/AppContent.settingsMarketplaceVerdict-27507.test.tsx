// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A caller the Setup app refuses gets the app's access verdict on Setup's
 * settings and marketplace pages too (objectstack#27507), the screen Setup's
 * root already draws (objectui#12706).
 *
 * ## The measured defect
 *
 * A plain member opening `/apps/setup/system/settings` got the default app's
 * chrome around the settings hub, which read the server's empty, filtered
 * manifest list as "No settings registered"; `/apps/setup/system/settings/auth`
 * printed the server's raw capability error under the same chrome; the
 * marketplace drew its own admin-only notice. `/apps/com.objectstack.setup`
 * already drew `app-access-denied`. The server refused every read, so it was
 * three wrong screens, not an access hole.
 *
 * The cause: these routes carry a `system` segment, so they are pseudo-routes
 * (`isSpecialRoute`) and skip the verdict the way the rest of Setup's subtree
 * did before objectui#12706, which gated only the metadata routes and the root.
 *
 * ## What is pinned
 *
 * The settings and marketplace routes wait on the verdict for the app the URL
 * names and draw `app-access-denied` on `denied`, nothing of the page mounted.
 * An admitted caller, an app the server does not have, and an ordinary app's
 * own settings route render as before. The routes objectui#12706 left open
 * (the approvals inbox and the records it links to) stay pinned in
 * `AppContent.setupItemRoutesVerdict-12706.test.tsx`, which this change keeps
 * green unchanged.
 *
 * ## Why the route is stubbed at the TRANSPORT
 *
 * As in `AppContent.setupItemRoutesVerdict-12706.test.tsx`: a real
 * `ObjectStackAdapter` over a stubbed `fetch`, so the verdict comes from the
 * real probe reading the real envelope.
 *
 * NOTE ON SCOPE: this file measures WHICH SURFACE renders. `ConsoleLayout`,
 * the host's settings pages and the marketplace pages are stubbed; each stub
 * counts its mounts, so "nothing of the page mounted" is a count.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Routes, Route, useLocation, useParams } from 'react-router-dom';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';

// ---------------------------------------------------------------------------
// Mocks — everything that takes part in the DECISION stays real.
// ---------------------------------------------------------------------------

/** How many times each stubbed page mounted, by test id. */
const mounts: Record<string, number> = {};
const counted = (testId: string, text?: string) => {
  mounts[testId] = (mounts[testId] ?? 0) + 1;
  return <div data-testid={testId}>{text}</div>;
};

// AGENTS.md §测试纪律 — the lazy page modules are stubbed so no unbounded
// `import()` races a bounded `findBy` window.
vi.mock('../marketplace/MarketplacePage', () => ({
  MarketplacePage: () => counted('marketplace-page'),
}));
vi.mock('../marketplace/MarketplacePackagePage', () => ({
  MarketplacePackagePage: () => {
    const { packageId } = useParams<{ packageId?: string }>();
    return counted('marketplace-package-page', packageId);
  },
}));
vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page" />,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
      <header>chrome</header>
      {children}
    </div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    objectPluralLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ name, label }: { name: string; label?: string }) => label ?? name,
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u_member', name: 'Member', email: 'member@example.com', role: 'member' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: { id: 'org_1', name: 'Org' },
  }),
  // The least-privileged value, so nothing here is an admin-only result.
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

// ---------------------------------------------------------------------------
// The transport. One stubbed `fetch` behind a real adapter + real client.
// ---------------------------------------------------------------------------

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** `GET /api/v1/meta/app/:name` for an app that exists and refuses this session. */
const deniedBody = (app: string) => ({
  success: false,
  error: { code: 'PERMISSION_DENIED', message: `You do not have permission to open the '${app}' app.` },
});
/** …and for a name with nothing behind it. */
const ABSENT_BODY = {
  error: { code: 'RESOURCE_NOT_FOUND', message: 'Metadata item not found or access denied.' },
};

/** URLs the by-name meta route was asked for, in order. */
let metaItemRequests: string[] = [];
/** How the by-name route answers, per app name; unlisted names are absent. */
let byName: Record<string, () => Response> = {};

function makeAdapter() {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/discovery')) {
      return json(200, { success: true, data: { version: 'v0', routes: {}, capabilities: {} } });
    }
    const item = /\/api\/v1\/meta\/app\/([^/?]+)/.exec(url);
    if (item) {
      metaItemRequests.push(url);
      const answer = byName[decodeURIComponent(item[1])];
      return answer ? answer() : json(404, ABSENT_BODY);
    }
    // Nothing else is part of this question; a loud 500 keeps an unexpected
    // call from passing as a silent success.
    return json(500, { error: { code: 'UNEXPECTED_REQUEST', message: url } });
  });
  return new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
}

let adapter: unknown = null;
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
}));

/**
 * The list as the SERVER hands it to this session: an app the session may not
 * open is simply ABSENT (`filterAppForUser`). The member's one app is
 * Showcase, the launcher's default, which a pseudo-route falls back to.
 */
const SHOWCASE_APP = {
  name: 'showcase_app',
  label: 'Showcase',
  isDefault: true,
  navigation: [{ id: 'nav_accounts', type: 'object', objectName: 'showcase_account', label: 'Accounts' }],
};
const SETUP_APP = { name: 'setup', label: 'Setup', navigation: [] };
let metadataApps: unknown[] = [];
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: metadataApps,
    objects: [],
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: vi.fn(async () => {}),
  }),
}));

import { AppContent } from '../AppContent';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

/** The host's settings routes, as `apps/console`'s `systemRoutes` mounts them. */
function SettingsHubStub() {
  return counted('settings-hub-page');
}
function SettingsViewStub() {
  const { namespace } = useParams<{ namespace?: string }>();
  return counted('settings-view-page', namespace);
}
const hostSystemRoutes = (
  <>
    <Route path="system" element={<Navigate to="settings" replace />} />
    <Route path="system/settings" element={<SettingsHubStub />} />
    <Route path="system/settings/:namespace" element={<SettingsViewStub />} />
  </>
);

function renderConsoleAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/apps/:appName/*"
          element={<AppContent extraRoutes={hostSystemRoutes} extraRoutesNoApp={hostSystemRoutes} />}
        />
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const pathname = () => screen.getByTestId('pathname').textContent;

/** Every page stub this file counts; a refused caller mounts none of them. */
const PAGE_STUBS = ['settings-hub-page', 'settings-view-page', 'marketplace-page', 'marketplace-package-page'];
const pagesMounted = () => PAGE_STUBS.filter((id) => (mounts[id] ?? 0) > 0);

describe('AppContent — Setup\'s settings and marketplace routes wait on the app\'s access verdict (objectstack#27507)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mounts)) delete mounts[k];
    metadataApps = [SHOWCASE_APP];
    metaItemRequests = [];
    byName = {
      setup: () => json(403, deniedBody('setup')),
      'com.objectstack.setup': () => json(403, deniedBody('com.objectstack.setup')),
    };
    adapter = makeAdapter();
  });

  it.each([
    ['the settings hub', '/apps/setup/system/settings'],
    ['a settings page the capability gate refuses', '/apps/setup/system/settings/auth'],
    ['a settings page the setup gate refuses', '/apps/setup/system/settings/localization'],
    ['the marketplace', '/apps/setup/system/marketplace'],
    ['a marketplace package page', '/apps/setup/system/marketplace/com.acme.crm'],
  ])('a refused caller gets app-access-denied on %s, with nothing of the page mounted', async (_label, url) => {
    renderConsoleAt(url);

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('console-layout')).not.toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
    // The verdict asked is Setup's, the app the URL names, never the fallback's.
    expect(metaItemRequests).toHaveLength(1);
    expect(metaItemRequests[0]).toContain('/api/v1/meta/app/setup');
    // The URL is left as the caller typed it, and the screen owns its way back.
    expect(pathname()).toBe(url);
    expect(screen.getByTestId('app-access-denied-home')).toBeInTheDocument();
  });

  it('the same verdict on Setup\'s package-id address', async () => {
    renderConsoleAt('/apps/com.objectstack.setup/system/settings/auth');

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
    expect(metaItemRequests[0]).toContain('/api/v1/meta/app/com.objectstack.setup');
  });

  it('the bare system landing forwards onto the settings hub, which is refused', async () => {
    renderConsoleAt('/apps/setup/system');

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(pagesMounted()).toEqual([]);
    expect(pathname()).toBe('/apps/setup/system/settings');
  });

  it('CONTROL — an admitted caller gets the settings page under Setup, and nothing is probed', async () => {
    metadataApps = [SHOWCASE_APP, SETUP_APP];

    renderConsoleAt('/apps/setup/system/settings/auth');

    expect(await screen.findByTestId('settings-view-page')).toHaveTextContent('auth');
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'setup');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(metaItemRequests).toEqual([]);
  });

  it('CONTROL — an admitted caller gets the marketplace, and nothing is probed', async () => {
    metadataApps = [SHOWCASE_APP, SETUP_APP];

    renderConsoleAt('/apps/setup/system/marketplace');

    expect(await screen.findByTestId('marketplace-page')).toBeInTheDocument();
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(metaItemRequests).toEqual([]);
  });

  it('CONTROL — a server that has no such app changes nothing: the page renders as before', async () => {
    // A 404 is not a refusal; the pseudo-route keeps its default-app fallback.
    byName = {};

    renderConsoleAt('/apps/setup/system/settings');

    expect(await screen.findByTestId('settings-hub-page')).toBeInTheDocument();
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'showcase_app');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
  });

  it('CONTROL — the settings route under an app the caller may open renders the page, unprobed', async () => {
    renderConsoleAt('/apps/showcase_app/system/settings');

    expect(await screen.findByTestId('settings-hub-page')).toBeInTheDocument();
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'showcase_app');
    expect(metaItemRequests).toEqual([]);
  });
});
