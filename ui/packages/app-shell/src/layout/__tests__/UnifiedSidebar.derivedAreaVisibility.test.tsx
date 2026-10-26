// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — derived area visibility (objectui#3319).
 *
 * The inline area switcher adopts the #3311 derivation via the SHARED
 * `hasVisibleNavigationItems` predicate from `@object-ui/layout` — an area is
 * offered iff something inside it renders, and the active area is elected among
 * the visible areas only.
 *
 * One behavior is specific to this sidebar: it wires
 * `onAction={dispatchNavAction}` (framework#4509), so an `action` nav item IS
 * content and can carry its area's visibility (`hasActionHandler: true`).
 *
 * NB (lesson from #3322): a gated fixture is only load-bearing when it sits
 * in the area that would otherwise be ACTIVE.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationArea, NavigationEntryItem } from '@object-ui/types';

// ---------------------------------------------------------------------------
// Mocks — providers and console-only chrome. @object-ui/components and
// @object-ui/layout stay REAL so the shared predicate and the item-level
// guards inside NavigationRenderer are actually exercised.
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

// Typed as ENTRIES, so a case can spread one and add an entry-only key
// (`visible`, `requiredPermissions`); a separator carries neither (objectui#10867).
const salesEntry: NavigationEntryItem = { id: 'a1', type: 'object', label: 'Opportunities', objectName: 'opportunity' };
const serviceEntry: NavigationEntryItem = { id: 'a2', type: 'object', label: 'Cases', objectName: 'case' };

const salesArea: NavigationArea = {
  id: 'area-sales',
  label: 'Sales',
  navigation: [salesEntry],
};

const serviceArea: NavigationArea = {
  id: 'area-service',
  label: 'Service',
  navigation: [serviceEntry],
};

const marketingArea: NavigationArea = {
  id: 'area-marketing',
  label: 'Marketing',
  navigation: [{ id: 'a3', type: 'object', label: 'Campaigns', objectName: 'campaign' }],
};

const gatedSales: NavigationArea = {
  ...salesArea,
  navigation: [{ ...salesEntry, visible: false }],
};

function sidebarUi(areas: NavigationArea[]) {
  metadataState = {
    apps: [{ name: 'crm', label: 'CRM', active: true, areas }],
    objects: [],
  };
  return (
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider>
        <UnifiedSidebar activeAppName="crm" />
      </SidebarProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  permissionsState = { can: () => true, hasCapabilities: () => true };
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UnifiedSidebar derived area visibility (#3319)', () => {
  it('keeps every area in the switcher when every area has a visible item', () => {
    render(sidebarUi([salesArea, serviceArea, marketingArea]));
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    // First area is active — only its navigation renders.
    expect(screen.getByText('Opportunities')).toBeInTheDocument();
    expect(screen.queryByText('Cases')).not.toBeInTheDocument();

    // Switching among visible areas still works.
    fireEvent.click(screen.getByText('Marketing'));
    expect(screen.getByText('Campaigns')).toBeInTheDocument();
    expect(screen.queryByText('Opportunities')).not.toBeInTheDocument();
  });

  it('keeps a PARTIALLY gated area visible and active, hiding only the gated item', () => {
    const partialSales: NavigationArea = {
      ...salesArea,
      navigation: [
        { ...salesEntry, visible: false },
        { id: 'a1b', type: 'object', label: 'Quotes', objectName: 'quote' },
      ],
    };
    render(sidebarUi([partialSales, serviceArea]));
    // The area survives (it still has a visible item) and stays active…
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Quotes')).toBeInTheDocument();
    // …but the gated ITEM does not render (real NavigationRenderer guard).
    expect(screen.queryByText('Opportunities')).not.toBeInTheDocument();
  });

  it('hides an area whose items are ALL gated and elects the first VISIBLE area', () => {
    render(sidebarUi([gatedSales, serviceArea, marketingArea]));
    // The fully gated area is not offered in the switcher…
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    // …and never auto-activated: the first VISIBLE area's navigation renders.
    expect(screen.getByText('Cases')).toBeInTheDocument();
    expect(screen.queryByText('Opportunities')).not.toBeInTheDocument();
  });

  it('hides the switcher entirely when only one area remains visible', () => {
    render(sidebarUi([gatedSales, serviceArea]));
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
    expect(screen.queryByText('Service')).not.toBeInTheDocument();
    expect(screen.getByText('Cases')).toBeInTheDocument();
  });

  it('renders no switcher and no area navigation when every area is fully gated', () => {
    render(
      sidebarUi([
        gatedSales,
        { ...serviceArea, navigation: [{ ...serviceEntry, visible: false }] },
      ]),
    );
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
    expect(screen.queryByText('Service')).not.toBeInTheDocument();
    expect(screen.queryByText('Opportunities')).not.toBeInTheDocument();
    expect(screen.queryByText('Cases')).not.toBeInTheDocument();
  });

  it('counts an action item as area content — this sidebar wires a dispatcher (framework#4509)', () => {
    const actionsArea: NavigationArea = {
      id: 'area-actions',
      label: 'Actions',
      navigation: [
        { id: 'act1', type: 'action', label: 'Run Sync', actionDef: { actionName: 'sync' } } as never,
      ],
    };
    render(sidebarUi([actionsArea, serviceArea]));
    // The action-only area is visible AND active (it is first): the switcher
    // offers both areas. With no dispatcher this area would derive hidden.
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Run Sync')).toBeInTheDocument();
  });

  it('re-elects when the ACTIVE area is gated away, and a mere reveal does not steal the selection', () => {
    const adminSales: NavigationArea = {
      ...salesArea,
      navigation: [{ ...salesEntry, requiredPermissions: ['sales:admin'] }],
    };
    const areas = [adminSales, serviceArea, marketingArea];

    const view = render(sidebarUi(areas));
    // Permission granted: Sales is visible and active.
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Opportunities')).toBeInTheDocument();

    // Permission revoked (`object:action` form → can('sales','admin') false):
    // Sales derives hidden, drops out of the switcher, and the sidebar
    // re-elects the first visible area.
    permissionsState = {
      can: (objectName, action) => !(objectName === 'sales' && action === 'admin'),
      hasCapabilities: () => true,
    };
    view.rerender(sidebarUi(areas));
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();
    expect(screen.queryByText('Opportunities')).not.toBeInTheDocument();
    expect(screen.getByText('Cases')).toBeInTheDocument();

    // Permission granted again: Sales REAPPEARS in the switcher, but the
    // user's current selection is not yanked away — Service stays active.
    permissionsState = { can: () => true, hasCapabilities: () => true };
    view.rerender(sidebarUi(areas));
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Cases')).toBeInTheDocument();
    expect(screen.queryByText('Opportunities')).not.toBeInTheDocument();
  });
});
