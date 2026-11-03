// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `/home` Administration cluster carries no `sys-objects` entry (objectstack
 * ADR-0146 D1, N-28).
 *
 * objectui#3739 pinned that this entry ("Object Manager") reached Setup's
 * canonical `/apps/setup/metadata/object` route with zero redirects, after
 * objectui#3660 did the same for `sys-datasources` one line below it. N-28
 * retired Setup's metadata catalog into Studio's "All metadata" area, and that
 * route now redirects there, so the entry would leave Home for Setup only to be
 * forwarded on into Studio. The entry is removed. Objects are designed in
 * Studio.
 *
 * The inverse pin is read off a REAL `UnifiedSidebar` render, the same way the
 * original pin read the entry's href. `sys-datasources` stays: the datasource is
 * Setup's (D1), and `systemNavDatasourcesHop.test.tsx` still pins its route.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks — providers and console-only chrome, matching the sibling sidebar
// suites (`systemNavDatasourcesHop.test.tsx`, `systemNavSettingsTarget.test.tsx`).
// `react-router-dom` stays REAL: the chain measurement below IS the router.
// ---------------------------------------------------------------------------

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, signOut: vi.fn(), isAuthEnabled: false, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  getUserInitials: () => 'U',
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ can: () => true, hasCapabilities: () => true }),
  };
});

/** Zero apps. The `/home` context below renders `homeNavigation` whatever this list holds. */
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [], objects: [] }),
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
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLazyIcon: () => () => null,
}));

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
  useNavigationContext: () => ({ context: 'home', currentAppName: undefined }),
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
import { UnifiedSidebar } from '../UnifiedSidebar';

beforeEach(() => {
  localStorage.clear();
});

describe('the /home Administration cluster carries no Object Manager entry (ADR-0146 D1)', () => {
  it('UnifiedSidebar: no `sys-objects` link, and no link into Setup\'s metadata catalog', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <SidebarProvider>
          <UnifiedSidebar activeAppName="" />
        </SidebarProvider>
      </MemoryRouter>,
    );

    const hrefs = screen.queryAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    // Control: the cluster really rendered, with its kept datasource entry.
    expect(hrefs).toContain('/apps/setup/metadata/datasource');
    expect(screen.queryByRole('link', { name: 'Object Manager' })).toBeNull();
    expect(hrefs.filter((href) => /\/metadata\/(?!datasource(?:$|[/?#]))/.test(href))).toEqual([]);
  });
});
