// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — inside a package's second app, every link addresses that app.
 *
 * `/apps/SEGMENT` resolves through `matchAppBySegment` over the metadata app
 * list, so a package id opens the package's FIRST app. Two apps shipped by one
 * package share that id; the name is the only address that reaches the second.
 * The sidebar's links and the route its area election reads are built on
 * `appAddressSegment(apps, activeApp)`, the address `AppContent` resolves the
 * open app's links with, so a package's first or only app keeps its package-id
 * address and its second app is addressed by name.
 *
 * The route helpers stay REAL (`../../utils` is not mocked), and so do
 * `@object-ui/components` and `@object-ui/layout`, so the hrefs asserted below
 * are the ones `NavigationRenderer` draws.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationArea } from '@object-ui/types';

// Partial mock: @object-ui/components also imports from @object-ui/i18n
// (createSafeTranslation), so the rest of the module must stay real.
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
  useAuth: () => ({ user: null, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/permissions')>()),
  usePermissions: () => ({ can: () => true, hasCapabilities: () => true }),
}));

let metadataState: { apps: unknown[]; objects: unknown[] };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => metadataState,
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  evaluateVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  evaluateNavigationVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  useHasExpressionScope: () => true,
}));

// Lazy lucide DynamicIcon would suspend mid-test; a null icon is enough here.
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
let currentAppName = '';
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'app', currentAppName }),
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

// ---------------------------------------------------------------------------
// Fixtures — `com.example.crm` ships `crm` (first) and `crm_service`;
// `com.example.hr` ships `hr` alone. Labels are pairwise distinct.
// ---------------------------------------------------------------------------

const queueArea: NavigationArea = {
  id: 'area-queue',
  label: 'Queue',
  navigation: [{ id: 'nav-queue', type: 'object', label: 'Queues', objectName: 'crm_queue' }],
};

const casesArea: NavigationArea = {
  id: 'area-cases',
  label: 'Casework',
  navigation: [
    { id: 'nav-case', type: 'object', label: 'Cases', objectName: 'crm_case' },
    { id: 'nav-board', type: 'dashboard', label: 'Service board', dashboardName: 'service_board' },
  ],
};

const APPS = [
  {
    name: 'crm',
    label: 'Sales',
    _packageId: 'com.example.crm',
    active: true,
    navigation: [{ id: 'nav-opportunity', type: 'object', label: 'Opportunities', objectName: 'crm_opportunity' }],
  },
  {
    name: 'crm_service',
    label: 'Service',
    _packageId: 'com.example.crm',
    active: true,
    areas: [queueArea, casesArea],
  },
  {
    name: 'hr',
    label: 'People',
    _packageId: 'com.example.hr',
    active: true,
    navigation: [{ id: 'nav-employee', type: 'object', label: 'Employees', objectName: 'hr_employee' }],
  },
];

/** Render the sidebar as `AppContent` does: the app segment the URL carries. */
function renderAt(path: string) {
  const segment = decodeURIComponent(path.split('/')[2] ?? '');
  currentAppName = segment;
  metadataState = { apps: APPS, objects: [] };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <UnifiedSidebar activeAppName={segment} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

function href(label: string): string | null {
  const link = screen.getByText(label).closest('a');
  if (!(link instanceof HTMLAnchorElement)) throw new Error(`no link for ${label}`);
  return link.getAttribute('href');
}

function areaButton(label: string): HTMLElement {
  const button = screen.getByText(label).closest('[data-sidebar="menu-button"]');
  if (!(button instanceof HTMLElement)) throw new Error(`no switcher row for area ${label}`);
  return button;
}

beforeEach(() => {
  localStorage.clear();
});

describe("UnifiedSidebar addresses a package's second app by its own address", () => {
  it("inside the package's second app, every entry links into that app", () => {
    renderAt('/apps/crm_service/crm_queue');
    expect(href('Queues')).toBe('/apps/crm_service/crm_queue');
  });

  it('elects the area holding the routed entry of the second app, and its links stay in that app', () => {
    renderAt('/apps/crm_service/crm_case');
    expect(areaButton('Casework')).toHaveAttribute('data-active', 'true');
    expect(areaButton('Queue')).toHaveAttribute('data-active', 'false');
    expect(href('Cases')).toBe('/apps/crm_service/crm_case');
    expect(href('Service board')).toBe('/apps/crm_service/dashboard/service_board');
  });

  it("control: the package's first app keeps its package-id address", () => {
    renderAt('/apps/com.example.crm/crm_opportunity');
    expect(href('Opportunities')).toBe('/apps/com.example.crm/crm_opportunity');
  });

  it("control: a package's only app keeps its package-id address", () => {
    renderAt('/apps/com.example.hr/hr_employee');
    expect(href('Employees')).toBe('/apps/com.example.hr/hr_employee');
  });
});
