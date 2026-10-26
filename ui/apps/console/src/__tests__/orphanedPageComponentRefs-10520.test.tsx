// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `audit:log`, `ai:approvals` and `developer:integrations`: the
 * component-registry keys for the console pages that lost their only in-app
 * link when the System Hub card wall retired (objectui#10520).
 *
 * ## What this file is for
 *
 * Framework navigation reaches a console page only through a
 * `type: 'component'` item whose `componentRef` is a registry key, never a
 * console path. `AuditLogPage`, `AiPendingActionsPage` and `IntegrationsPage`
 * had a route but no key, so no navigation entry could name them. This file
 * pins, per key, the properties a nav item exercises, in the order it
 * exercises them:
 *
 *   1. the key is registered at all, by importing the registration module the
 *      way `main.tsx` does (a side effect);
 *   2. the key addresses the `component/<ns>/<name>` URL, built from the ref
 *      through the same helper the sidebar uses rather than spelled out;
 *   3. that URL, rendered by app-shell's REAL `DefaultAppContent`, reaches the
 *      page. Its `component/:ns/:name/*` route is what serves `ComponentNavView`
 *      in the shipped console, so a key that is registered but spelled
 *      differently from the URL fails here, not only in a browser;
 *   4. the key is ADDITIVE: the page's standalone route, from this host's REAL
 *      `systemRoutes` fragment (imported, never transcribed), still renders it,
 *      because bookmarks and deep links carry it.
 *
 * Plus the premise the Developer Hub's retirement rests on: all four of its
 * cards' destinations are registered `developer:*` keys.
 *
 * ## Why the whole `DefaultAppContent`, and not `ComponentNavView` alone
 *
 * `ComponentNavView` is not on app-shell's barrel, and importing it by source
 * path puts app-shell's file into this app's `tsc` program under this app's
 * compiler options, which it is not written against. The route table that
 * serves it IS exported, so the probe goes through that: the same lazy
 * `ComponentNavView`, the same registry, the same URL grammar as production.
 *
 * ## Scope of the stubs
 *
 * The three pages are stubbed at the exact specifiers the registration modules
 * and `AppContent` lazy-import, so the registry entries and the routes under
 * test are the production ones, Suspense wrappers included. The shell around
 * them is stubbed the way `AppContent.systemHubRoutes.test.tsx` stubs it, for
 * the reasons given there.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';

// AGENTS.md §测试纪律: the lazily-imported app-shell pages are stubbed so no
// unbounded `import()` races a bounded assertion window. The paths are relative
// to app-shell's OWN source tree (`@object-ui/app-shell` is aliased to
// `packages/app-shell/src` by `apps/console/vite.config.ts`).
vi.mock('../../../../packages/app-shell/src/views/metadata-admin', () => ({
  MetadataDirectoryPage: () => <div data-testid="metadata-directory-page" />,
  MetadataResourceListPage: () => <div data-testid="metadata-resource-list-page" />,
  MetadataResourceEditPage: () => <div data-testid="metadata-resource-edit-page" />,
  MetadataResourceHistoryPage: () => <div data-testid="metadata-resource-history-page" />,
  MetadataDiagnosticsPage: () => <div data-testid="metadata-diagnostics-page" />,
  MetadataResourceRouter: () => <div data-testid="metadata-resource-router" />,
  registerMetadataResource: () => {},
}));
vi.mock('../../../../packages/app-shell/src/console/marketplace/MarketplacePage', () => ({
  MarketplacePage: () => <div data-testid="marketplace-page" />,
}));
vi.mock('../../../../packages/app-shell/src/console/marketplace/MarketplacePackagePage', () => ({
  MarketplacePackagePage: () => <div data-testid="marketplace-package-page" />,
}));
vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page" />,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));
vi.mock('../../../../packages/app-shell/src/layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
      {children}
    </div>
  ),
}));
vi.mock('../../../../packages/app-shell/src/chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../../../packages/app-shell/src/chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../../../packages/app-shell/src/chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../../../packages/app-shell/src/views/ObjectView', () => ({
  ObjectView: () => <div data-testid="object-view" />,
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
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: null,
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));
const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../../../packages/app-shell/src/providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));
vi.mock('../../../../packages/app-shell/src/providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: [
      { name: 'setup', label: 'Setup', isDefault: true, navigation: [] },
      { name: 'studio', label: 'Studio', navigation: [] },
    ],
    objects: [],
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: vi.fn(async () => {}),
  }),
}));

/**
 * The probes stand in for the three pages at the exact specifiers
 * `registerSystemComponents`, `registerDeveloperComponents` and `AppContent`
 * lazy-import. Each echoes `:appName`, which `IntegrationsPage` builds its
 * "Open API Console" link from.
 */
function probe(testId: string) {
  return function Probe() {
    const { appName } = useParams<{ appName?: string }>();
    return <div data-testid={testId}>{appName ?? '(none)'}</div>;
  };
}
vi.mock('../pages/system/AuditLogPage', () => ({ AuditLogPage: probe('audit-log-probe') }));
vi.mock('../pages/system/AiPendingActionsPage', () => ({ AiPendingActionsPage: probe('ai-approvals-probe') }));
vi.mock('../pages/developer/IntegrationsPage', () => ({ IntegrationsPage: probe('integrations-probe') }));

import { DefaultAppContent, getAppComponent, componentRefToUrlSegments } from '@object-ui/app-shell';
import { systemRoutes } from '../AppContent';

// Side-effect imports: these are the modules under test, imported the way
// `main.tsx` imports them.
import '../registerSystemComponents';
import '../registerDeveloperComponents';

/** The `component/...` path the sidebar builds for a `componentRef` nav item. */
const componentPath = (ref: string) => `component/${componentRefToUrlSegments(ref).join('/')}`;

function renderConsoleAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/apps/:appName/*"
          element={<DefaultAppContent extraRoutes={systemRoutes} extraRoutesNoApp={systemRoutes} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe.each([
  { ref: 'audit:log', segments: ['audit', 'log'], probeId: 'audit-log-probe', app: 'setup', route: 'system/audit-log' },
  { ref: 'ai:approvals', segments: ['ai', 'approvals'], probeId: 'ai-approvals-probe', app: 'setup', route: 'system/ai-approvals' },
  {
    ref: 'developer:integrations',
    segments: ['developer', 'integrations'],
    probeId: 'integrations-probe',
    app: 'studio',
    route: 'developer/integrations',
  },
])('$ref component ref (objectui#10520)', ({ ref, segments, probeId, app, route }) => {
  it('is registered by the module `main.tsx` side-effect-imports', () => {
    expect(getAppComponent(ref)).toBeDefined();
    expect(getAppComponent(ref)?.source).toBe('@object-ui/console');
  });

  it(`addresses the component/${segments.join('/')} URL segments`, () => {
    expect(componentRefToUrlSegments(ref)).toEqual(segments);
    expect(componentPath(ref)).toBe(`component/${segments.join('/')}`);
  });

  it('the component URL reaches the page through the shipped route table', async () => {
    renderConsoleAt(`/apps/${app}/${componentPath(ref)}`);

    expect(await screen.findByTestId(probeId)).toHaveTextContent(app);
    expect(screen.queryByText('Component not registered')).not.toBeInTheDocument();
  });

  it(`the standalone ${route} route keeps rendering the page (the key is additive)`, async () => {
    renderConsoleAt(`/apps/${app}/${route}`);

    expect(await screen.findByTestId(probeId)).toHaveTextContent(app);
  });
});

describe('the retired Developer Hub (objectui#10520)', () => {
  it('every one of its four destinations is a registered developer:* key', () => {
    // The hub's four cards, by the key a navigation entry would name. This is
    // the premise its retirement rests on: were any of them unkeyed, the hub
    // would still be that page's only way in.
    for (const ref of [
      'developer:integrations',
      'developer:api-console',
      'developer:flow-runs',
      'developer:public-forms',
    ]) {
      expect(getAppComponent(ref), ref).toBeDefined();
    }
  });
});
