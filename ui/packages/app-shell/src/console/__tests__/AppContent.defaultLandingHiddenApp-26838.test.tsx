// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26838 — when a URL names no app the shell can resolve (a
 * pseudo-route such as `/apps/ghost/system/marketplace`), `AppContent` falls
 * back to the default launcher app. That fallback never lands on an app the
 * user's permission sets hide (`tabPermissions: hidden`): its list is the one
 * Home's tiles and the switcher offer, narrowed by the `GET /me/apps` answer.
 *
 * Under the real `LauncherAppsProvider` fed a `/me/apps` double; the routing
 * harness (stubs, `ConsoleLayout` probe echoing `activeAppName`) is
 * `AppContent.pseudoRouteSegments.test.tsx`'s.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  MemoryRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks — everything that takes part in the routing decision (AppContent's
// guards, its nested <Routes>, react-router's matching) stays real.
// ---------------------------------------------------------------------------

// AGENTS.md §测试纪律 — the lazy page modules are stubbed so no unbounded
// `import()` races a bounded `findBy` window.
vi.mock('../../views/metadata-admin', () => ({
  MetadataDirectoryPage: () => <div data-testid="metadata-directory-page">directory</div>,
  MetadataResourceListPage: () => {
    const { type } = useParams<{ type?: string }>();
    return <div data-testid="metadata-resource-list-page">{type}</div>;
  },
  MetadataResourceEditPage: () => <div data-testid="metadata-resource-edit-page" />,
  MetadataResourceHistoryPage: () => <div data-testid="metadata-resource-history-page" />,
  MetadataDiagnosticsPage: () => <div data-testid="metadata-diagnostics-page" />,
}));

vi.mock('../marketplace/MarketplacePage', () => ({
  MarketplacePage: () => <div data-testid="marketplace-page">marketplace</div>,
}));
vi.mock('../marketplace/MarketplacePackagePage', () => ({
  MarketplacePackagePage: () => <div data-testid="marketplace-package-page" />,
}));

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page">create app</div>,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

// Pay the real designer barrel's load in the IMPORT phase, where no timeout
// applies. `AppContent` reaches `CreateAppPage` only through
// `React.lazy(() => import('@object-ui/plugin-designer'))`, so the factory
// above -- which now awaits the real module -- first runs when that lazy
// boundary resolves, i.e. INSIDE the `findByTestId` budget of the two cases
// below that assert on `create-app-page`. Under a saturated transform pipeline
// the barrel's graph does not fit in that budget and the file goes red on LOAD
// rather than on behaviour (AGENTS.md, the flaky-test discipline: an unbounded
// module load counted against a bounded window). The specifier is byte-
// identical to the component's own, so ESM hands the lazy factory this
// already-resolved module.
import '@object-ui/plugin-designer';

/**
 * The probe that makes the bug visible: it reports WHICH app's shell rendered.
 * The real `ConsoleLayout` drags in the whole console chrome (sidebar, header,
 * chat dock) — none of it part of this question.
 */
vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
      {children}
    </div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));

/** Echoes `:objectName` — the near-miss segment is taken as an object name. */
vi.mock('../../views/ObjectView', () => ({
  ObjectView: () => {
    const { objectName } = useParams<{ objectName?: string }>();
    return <div data-testid="object-view">{objectName}</div>;
  },
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
  }),
}));

// A workspace admin: the zero-app cases below land on the "no apps configured"
// empty state, which since objectui#4473 renders for admins only — a viewer who
// cannot act on its CTAs is bounced to `/home` with the shell chrome instead of
// being stranded there (`AppContent.inaccessibleAppStrand.test.tsx`). Which
// BRANCH a segment reaches — the question this file measures — does not depend
// on the viewer.
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // A signed-in user: the `/me/apps` read is asked per user.
  useAuth: () => ({
    user: { id: 'u1' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

/**
 * Two published apps, one of them the default. The default is what a broken
 * `requestedAppMissing` falls back to, so `crm` is the app that must NEVER
 * appear for a `/apps/<mistyped>/…` URL.
 */
const APPS = [
  { name: 'crm', label: 'CRM', isDefault: true, navigation: [] },
  { name: 'sales', label: 'Sales', navigation: [] },
];

const refreshMetadata = vi.fn(async () => {});
let metadataApps: unknown[] = APPS;
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: metadataApps,
    objects: [],
    loading: false,
    // `undefined` — no bucket preloading to await, so the shell is ready on
    // first render (mirrors a host that ships metadata eagerly).
    ensureType: undefined,
    error: null,
    refresh: refreshMetadata,
  }),
}));

import { AppContent } from '../AppContent';
import { LauncherAppsProvider } from '../../hooks/useLauncherApps';

/** A `/me/apps` double: the listed names, or a bare status. */
function meApps(answer: string[] | number) {
  return vi.fn(async (_url: unknown) =>
    typeof answer === 'number'
      ? new Response('{}', { status: answer })
      : new Response(JSON.stringify({ apps: answer.map((name) => ({ name })) }), { status: 200 }),
  );
}

function renderAt(url: string, fetcher: ReturnType<typeof meApps>) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <LauncherAppsProvider endpoint="/me-apps-double" fetcher={fetcher as unknown as typeof fetch}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
          <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </LauncherAppsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  metadataApps = APPS;
});

afterEach(() => cleanup());

describe('the default-app fallback skips an app a permission set hides (objectstack#26838)', () => {
  it('the default app hidden by /me/apps: the fallback lands on the next launcher app', async () => {
    const fetcher = meApps(['sales']);
    renderAt('/apps/ghost/system/marketplace', fetcher);
    expect(await screen.findByTestId('marketplace-page')).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'sales'),
    );
  });

  it('CONTROL — a 404 (no security plugin) keeps the declared default', async () => {
    const fetcher = meApps(404);
    renderAt('/apps/ghost/system/marketplace', fetcher);
    expect(await screen.findByTestId('marketplace-page')).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'crm');
  });

  it('a URL that names the hidden app still opens it', async () => {
    renderAt('/apps/crm/system/marketplace', meApps(['sales']));
    expect(await screen.findByTestId('marketplace-page')).toBeInTheDocument();
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'crm');
  });
});
