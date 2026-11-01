// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — the sidebar shows the area that holds the current page.
 *
 * In an app with several areas, the area elected on the first render, and
 * whenever the route moves to a page no entry of the shown area addresses, is
 * the one whose navigation holds the entry the route addresses: the entry
 * `resolveActiveNavItem` elects, the same match that highlights the row. With
 * none, the current area stays, else the first visible one. A reader's own
 * area pick holds while the page is one its entries address.
 *
 * `@object-ui/components` and `@object-ui/layout` stay REAL, so the highlight
 * asserted below is the one `NavigationRenderer` draws.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import type { NavigationArea } from '@object-ui/types';

// ---------------------------------------------------------------------------
// Mocks — providers and console-only chrome.
// ---------------------------------------------------------------------------

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

// Mutable permission state — swapped per test, re-read on every render.
let permissionsState: {
  can: (objectName: string, action: string) => boolean;
  hasCapabilities: (caps: string[]) => boolean;
};
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => permissionsState,
  };
});

let metadataState: { apps: unknown[]; objects: unknown[] };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => metadataState,
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  // Mirrors the real evaluateVisibility's literal handling — enough for
  // fixtures gating with `visible: false`.
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

// Lazy lucide DynamicIcon would suspend mid-test; a null icon is enough here.
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));

vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], removeFavorite: vi.fn() }),
}));
vi.mock('../../hooks/useNavPins', () => ({
  useNavPins: () => ({ togglePin: vi.fn(), applyPins: (items: unknown) => items }),
}));
const dispatchNavAction = vi.fn();
vi.mock('../../hooks/useNavActionDispatch', () => ({
  useNavActionDispatch: () => dispatchNavAction,
}));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'app', currentAppName: 'crm' }),
}));
// The sidebar also imports the per-selector scope-key derivation (#3500) to
// build Studio's home link; keep those exports on the mock or the module is
// missing them at import time.
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
// Fixtures — labels are pairwise distinct so a hit is unambiguous.
// ---------------------------------------------------------------------------

const salesArea: NavigationArea = {
  id: 'area-sales',
  label: 'Sales',
  navigation: [
    { id: 'nav-opportunity', type: 'object', label: 'Opportunities', objectName: 'opportunity' },
    { id: 'nav-account-sales', type: 'object', label: 'Accounts (sales)', objectName: 'account' },
  ],
};

const serviceArea: NavigationArea = {
  id: 'area-service',
  label: 'Service',
  navigation: [
    {
      id: 'grp-service',
      type: 'group',
      label: 'Support',
      children: [{ id: 'nav-case', type: 'object', label: 'Cases', objectName: 'case' }],
    },
    { id: 'nav-account-service', type: 'object', label: 'Accounts (service)', objectName: 'account' },
  ],
};

let navigate: NavigateFunction;
function NavigateProbe() {
  navigate = useNavigate();
  return null;
}

function renderAt(path: string) {
  metadataState = {
    apps: [{ name: 'crm', label: 'CRM', active: true, areas: [salesArea, serviceArea] }],
    objects: [],
  };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavigateProbe />
      <SidebarProvider>
        <UnifiedSidebar activeAppName="crm" />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/** The switcher row of an area — the button whose text is the area label. */
function areaButton(label: string): HTMLElement {
  const button = screen.getByText(label).closest('[data-sidebar="menu-button"]');
  if (!(button instanceof HTMLElement)) throw new Error(`no switcher row for area ${label}`);
  return button;
}

function navRow(label: string): HTMLElement {
  const row = screen.getByText(label).closest('[data-active]');
  if (!(row instanceof HTMLElement)) throw new Error(`no navigation row for ${label}`);
  return row;
}

beforeEach(() => {
  permissionsState = { can: () => true, hasCapabilities: () => true };
  localStorage.clear();
});

describe('UnifiedSidebar elects the area that holds the current page', () => {
  it('opens on the second area when the route addresses one of its entries, with that entry highlighted', () => {
    renderAt('/apps/crm/case');
    expect(areaButton('Service')).toHaveAttribute('data-active', 'true');
    expect(areaButton('Sales')).toHaveAttribute('data-active', 'false');
    expect(navRow('Cases')).toHaveAttribute('data-active', 'true');
    expect(screen.queryByText('Opportunities')).not.toBeInTheDocument();
  });

  it('control: a route on a first-area entry keeps the first area', () => {
    renderAt('/apps/crm/opportunity');
    expect(areaButton('Sales')).toHaveAttribute('data-active', 'true');
    expect(navRow('Opportunities')).toHaveAttribute('data-active', 'true');
    expect(screen.queryByText('Cases')).not.toBeInTheDocument();
  });

  it('keeps the first area when no entry of any area addresses the route', () => {
    renderAt('/apps/crm/dashboard/overview');
    expect(areaButton('Sales')).toHaveAttribute('data-active', 'true');
    expect(screen.getByText('Opportunities')).toBeInTheDocument();
  });

  it('follows the route to the area holding the new page when the shown area addresses none of it', () => {
    renderAt('/apps/crm/opportunity');
    expect(areaButton('Sales')).toHaveAttribute('data-active', 'true');
    act(() => navigate('/apps/crm/case/record/42'));
    expect(areaButton('Service')).toHaveAttribute('data-active', 'true');
    expect(navRow('Cases')).toHaveAttribute('data-active', 'true');
  });

  it("holds the reader's own area pick while the page is one the picked area addresses", () => {
    renderAt('/apps/crm/account');
    // Both areas address the account list; the earlier area is elected.
    expect(areaButton('Sales')).toHaveAttribute('data-active', 'true');
    fireEvent.click(screen.getByText('Service'));
    expect(areaButton('Service')).toHaveAttribute('data-active', 'true');
    act(() => navigate('/apps/crm/account/record/7'));
    expect(areaButton('Service')).toHaveAttribute('data-active', 'true');
    expect(navRow('Accounts (service)')).toHaveAttribute('data-active', 'true');
  });

  it('holds a pick of an area that does not address the page until the route moves', () => {
    renderAt('/apps/crm/opportunity');
    fireEvent.click(screen.getByText('Service'));
    expect(areaButton('Service')).toHaveAttribute('data-active', 'true');
    act(() => navigate('/apps/crm/opportunity/record/1'));
    expect(areaButton('Sales')).toHaveAttribute('data-active', 'true');
  });
});
