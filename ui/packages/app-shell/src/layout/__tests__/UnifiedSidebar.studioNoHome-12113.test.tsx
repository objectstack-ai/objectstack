// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — the Studio app's sidebar has no Home entry (objectui#12113).
 *
 * The sidebar drew a Studio-only "Home" row linking the app root, which
 * rendered `StudioHomePage`. Ruling A1 retired the page, and the app root now
 * lands on the app's first navigation entry, so the row goes with the page.
 * The entries the sidebar already draws for Studio are unchanged: the Overview
 * group's children sit at the top level, the metadata directory entry is
 * hidden, and the packages entry links package management with the active
 * package scope.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.recentPackage-11863.test.tsx`, with the Studio app active and
 * a package selected; `@object-ui/layout` and `@object-ui/components` stay
 * REAL.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/permissions')>()),
  usePermissions: () => ({ can: () => true, hasCapabilities: () => true }),
}));

/** The platform's Studio app, as served: its first two navigation groups. */
const STUDIO = {
  name: 'studio',
  label: 'Studio',
  active: true,
  navigation: [
    {
      id: 'group_overview',
      type: 'group',
      label: 'Overview',
      children: [
        { id: 'nav_app_builder', type: 'component', label: 'App Builder', componentRef: 'studio:builder' },
        { id: 'nav_metadata_directory', type: 'component', label: 'All Metadata Types', componentRef: 'metadata:directory' },
        { id: 'nav_packages', type: 'component', label: 'Packages', componentRef: 'developer:packages' },
      ],
    },
    {
      id: 'group_data_model',
      type: 'group',
      label: 'Data Model',
      children: [
        {
          id: 'nav_objects',
          type: 'component',
          label: 'Objects',
          componentRef: 'metadata:resource',
          params: { type: 'object', package: '{active_package}' },
        },
      ],
    },
  ],
};

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [STUDIO], objects: [] }),
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  evaluateVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  evaluateNavigationVisibility: (expr: unknown) => expr !== false && expr !== 'false',
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
  useNavigationContext: () => ({ context: 'app', currentAppName: 'studio' }),
}));
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: { active_package: 'com.acme.crm' }, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: () => null,
}));

import { SidebarProvider } from '@object-ui/components';
import { UnifiedSidebar } from '../UnifiedSidebar';

function renderStudioSidebarAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <SidebarProvider>
        <UnifiedSidebar activeAppName="studio" />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/** Every link the sidebar draws, by its href. */
function hrefs(): string[] {
  return screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
}

describe('UnifiedSidebar — the Studio app has no Home entry (objectui#12113)', () => {
  it('draws no Home row and no link to the bare app root', () => {
    renderStudioSidebarAt('/apps/studio/component/studio/builder?package=com.acme.crm');

    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    expect(hrefs().filter((href) => href.split('?')[0].replace(/\/+$/, '') === '/apps/studio')).toEqual([]);
  });

  it("draws the app's first entry first: the App Builder, at the URL the root lands on", () => {
    renderStudioSidebarAt('/apps/studio/component/studio/builder');

    const builder = screen.getByRole('link', { name: /App Builder/ });
    expect(builder).toHaveAttribute('href', '/apps/studio/component/studio/builder');
    expect(hrefs()[0]).toBe('/apps/studio/component/studio/builder');
  });

  it('control: package management keeps the active package scope, and the directory entry stays hidden', () => {
    renderStudioSidebarAt('/apps/studio/component/studio/builder');

    expect(screen.getByRole('link', { name: /Package management/ })).toHaveAttribute(
      'href',
      '/apps/studio/component/developer/packages?package=com.acme.crm',
    );
    expect(screen.queryByRole('link', { name: /All Metadata Types/ })).not.toBeInTheDocument();
  });
});
