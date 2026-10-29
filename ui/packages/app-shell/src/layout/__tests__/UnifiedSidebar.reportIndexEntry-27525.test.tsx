// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — the app's report index is an entry its navigation declares
 * (objectstack#27525, superseding objectui#13020's injected row). The
 * maintainer's model, 「加上才有」: the entry exists only where the author adds
 * it, `{ type: 'report' }` with no `reportName`.
 *
 * Pinned:
 *  (a) an app whose navigation declares no index entry gets no injected row:
 *      no link to `/apps/APP/reports`, no "All reports" text;
 *  (b) a declared index entry is drawn by the navigation renderer and routed to
 *      `/apps/APP/reports`; with no `label` it is named by the console's own
 *      wording for that page ("All reports"), with a `label` as authored;
 *  (c) it is the active row on the index route;
 *  (d) drawing it reads no report list (the sidebar is chrome on every route,
 *      objectui#12980).
 * CONTROL: a named `report` entry still routes to its own `report/NAME` page,
 * and the app's other entries are drawn as before.
 *
 * Harness: the provider / chrome mocks of `UnifiedSidebar.objectReadGate-12109.test.tsx`;
 * `MetadataProvider`, `@object-ui/layout` and `@object-ui/components` stay real.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ label }: { label?: string }) => label,
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  evaluateVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  evaluateNavigationVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  useHasExpressionScope: () => true,
}));

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) =>
    apps.find((a) => a?.name === segment),
  appRouteSegment: (app: { name?: string }) => app?.name,
}));

vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], removeFavorite: vi.fn() }),
}));
vi.mock('../../hooks/useNavPins', () => ({
  useNavPins: () => ({ togglePin: vi.fn(), applyPins: (items: unknown) => items }),
}));
vi.mock('../../hooks/useNavActionDispatch', () => ({
  useNavActionDispatch: () => vi.fn(),
}));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'app', currentAppName: 'crm' }),
}));
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: {}, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: () => null,
}));

import { SidebarProvider } from '@object-ui/components';
import { MetadataProvider } from '../../providers/MetadataProvider';
import { UnifiedSidebar } from '../UnifiedSidebar';

const BASE_NAVIGATION: NavigationItem[] = [
  { id: 'nav_account', type: 'object', objectName: 'crm_account', label: 'Accounts' },
  { id: 'nav_pipeline', type: 'report', reportName: 'crm_pipeline', label: 'Pipeline' },
  { id: 'nav_help', type: 'url', url: '/help', label: 'Help' },
];

function renderSidebar(navigation: NavigationItem[] = BASE_NAVIGATION, at = '/apps/crm') {
  const app = { name: 'crm', label: 'CRM', active: true, navigation };
  const asked: string[] = [];
  const adapter = {
    clearCache: vi.fn(),
    // objectui#13044 — the real MetadataProvider reads an object by name through
    // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string) => {
          asked.push(type);
          return Promise.resolve({ type, items: type === 'app' ? [app] : [] });
        },
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
  const view = render(
    <MetadataProvider adapter={adapter}>
      <MemoryRouter initialEntries={[at]}>
        <SidebarProvider>
          <UnifiedSidebar activeAppName="crm" />
        </SidebarProvider>
      </MemoryRouter>
    </MetadataProvider>,
  );
  return { asked, container: view.container };
}

const INDEX_ENTRY: NavigationItem = { id: 'nav_reports', type: 'report' };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('UnifiedSidebar — the report index is a declared entry (objectstack#27525)', () => {
  it('(a) injects no index row on an app whose navigation declares none', async () => {
    const { container } = renderSidebar();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Accounts' })).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'All reports' })).not.toBeInTheDocument();
    expect(container.querySelector('a[href="/apps/crm/reports"]')).toBeNull();
    expect(container.querySelector('[data-testid="sidebar-report-index"]')).toBeNull();
  });

  it('(b) draws a declared index entry, routed to the report index, named by the console', async () => {
    renderSidebar([...BASE_NAVIGATION, INDEX_ENTRY]);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'All reports' })).toHaveAttribute('href', '/apps/crm/reports'),
    );
  });

  it('(b) a labelled index entry shows its own label, routed the same', async () => {
    renderSidebar([...BASE_NAVIGATION, { ...INDEX_ENTRY, label: 'Reports' }]);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/apps/crm/reports'),
    );
    expect(screen.queryByRole('link', { name: 'All reports' })).not.toBeInTheDocument();
  });

  it('(c) the declared entry is the active row on the index route', async () => {
    renderSidebar([...BASE_NAVIGATION, INDEX_ENTRY], '/apps/crm/reports');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'All reports' })).toHaveAttribute('data-active', 'true'),
    );
    expect(screen.getByRole('link', { name: 'Pipeline' })).not.toHaveAttribute('data-active', 'true');
  });

  it('(d) drawing it reads no report list', async () => {
    const { asked } = renderSidebar([...BASE_NAVIGATION, INDEX_ENTRY]);
    await waitFor(() => expect(screen.getByRole('link', { name: 'All reports' })).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).not.toContain('report');
  });

  it('CONTROL: a named report entry routes to its own page, and the other entries are drawn as before', async () => {
    renderSidebar();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Pipeline' })).toHaveAttribute('href', '/apps/crm/report/crm_pipeline'),
    );
    expect(screen.getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/apps/crm/crm_account');
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
  });
});
