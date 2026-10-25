/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppComponentSchema, NavigationItem, NavigationEntryItem, NavigationArea } from '@object-ui/types';
import { AppSchemaRenderer } from '../AppSchemaRenderer';
import { hasVisibleNavigationItems } from '../NavigationRenderer';

/** Wrap component in MemoryRouter */
function renderApp(
  schema: AppComponentSchema,
  props: Partial<React.ComponentProps<typeof AppSchemaRenderer>> = {},
  initialEntries: string[] = ['/'],
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppSchemaRenderer schema={schema} basePath="/apps/crm" {...props}>
        <div data-testid="page-content">Page Content</div>
      </AppSchemaRenderer>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const minimalSchema: AppComponentSchema = {
  type: 'app',
  name: 'crm',
  title: 'Sales CRM',
};

const navItems: NavigationItem[] = [
  { id: 'n1', type: 'object', label: 'Accounts', icon: 'Users', objectName: 'account' },
  { id: 'n2', type: 'dashboard', label: 'Overview', icon: 'LayoutDashboard', dashboardName: 'overview' },
  { id: 'n3', type: 'page', label: 'Settings', icon: 'Settings', pageName: 'settings' },
];

const schemaWithNav: AppComponentSchema = {
  type: 'app',
  name: 'crm',
  title: 'Sales CRM',
  description: 'Manage your sales pipeline',
  navigation: navItems,
};

// Typed as ENTRIES, so a case can spread one and add an entry-only key
// (`visible`, `requiredPermissions`); a separator carries neither (objectui#10867).
const salesEntry: NavigationEntryItem = { id: 'a1', type: 'object', label: 'Opportunities', icon: 'Target', objectName: 'opportunity' };
const serviceEntry: NavigationEntryItem = { id: 'a2', type: 'object', label: 'Cases', icon: 'Inbox', objectName: 'case' };

const salesArea: NavigationArea = {
  id: 'area-sales',
  label: 'Sales',
  icon: 'Briefcase',
  navigation: [salesEntry],
};

const serviceArea: NavigationArea = {
  id: 'area-service',
  label: 'Service',
  icon: 'Headphones',
  navigation: [serviceEntry],
};

const marketingArea: NavigationArea = {
  id: 'area-marketing',
  label: 'Marketing',
  icon: 'Megaphone',
  navigation: [
    { id: 'a3', type: 'object', label: 'Campaigns', icon: 'Send', objectName: 'campaign' },
  ],
};

const schemaWithAreas: AppComponentSchema = {
  type: 'app',
  name: 'crm',
  title: 'Sales CRM',
  areas: [salesArea, serviceArea],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppSchemaRenderer', () => {
  // --- Basic rendering ---

  it('renders page content', () => {
    renderApp(minimalSchema);
    expect(screen.getByTestId('page-content')).toBeTruthy();
  });

  it('renders app title in sidebar header', () => {
    renderApp(schemaWithNav);
    expect(screen.getByText('Sales CRM')).toBeTruthy();
  });

  it('renders app description', () => {
    renderApp(schemaWithNav);
    expect(screen.getByText('Manage your sales pipeline')).toBeTruthy();
  });

  // --- Navigation items ---

  it('renders navigation items from schema', () => {
    renderApp(schemaWithNav);
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('generates correct hrefs for navigation items', () => {
    renderApp(schemaWithNav);
    const accountLink = screen.getByText('Accounts').closest('a');
    expect(accountLink?.getAttribute('href')).toBe('/apps/crm/account');

    const dashLink = screen.getByText('Overview').closest('a');
    expect(dashLink?.getAttribute('href')).toBe('/apps/crm/dashboard/overview');

    const pageLink = screen.getByText('Settings').closest('a');
    expect(pageLink?.getAttribute('href')).toBe('/apps/crm/page/settings');
  });

  // #2918 — `type: 'component'` is part of the nav vocabulary; the sidebar
  // renders it as a link to the ComponentRegistry route.
  it('renders a component navigation item with its /component href', () => {
    const schema: AppComponentSchema = {
      type: 'app',
      name: 'crm',
      title: 'Sales CRM',
      navigation: [
        {
          id: 'nc',
          type: 'component',
          label: 'Permissions',
          icon: 'Puzzle',
          componentRef: 'setup:permission_matrix',
        },
      ],
    };
    renderApp(schema);
    const link = screen.getByText('Permissions').closest('a');
    expect(link?.getAttribute('href')).toBe('/apps/crm/component/setup/permission_matrix');
  });

  // --- Legacy menu migration ---

  it('renders legacy menu items converted to NavigationItem', () => {
    const legacySchema: AppComponentSchema = {
      type: 'app',
      name: 'legacy',
      title: 'Legacy App',
      menu: [
        { type: 'item', label: 'Tasks', path: '/tasks', icon: 'CheckSquare' },
        { type: 'item', label: 'Docs', href: 'https://docs.example.com', icon: 'FileText' },
      ],
    };
    renderApp(legacySchema);
    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(screen.getByText('Docs')).toBeTruthy();
  });

  // --- Area switching ---

  it('renders area switcher when multiple areas defined', () => {
    renderApp(schemaWithAreas);
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('Service')).toBeTruthy();
  });

  it('shows first area navigation by default', () => {
    renderApp(schemaWithAreas);
    expect(screen.getByText('Opportunities')).toBeTruthy();
  });

  it('switches area when area button is clicked', () => {
    renderApp(schemaWithAreas);
    // Initially shows Sales area
    expect(screen.getByText('Opportunities')).toBeTruthy();

    // Click Service area
    fireEvent.click(screen.getByText('Service'));

    // Should now show Service area navigation
    expect(screen.getByText('Cases')).toBeTruthy();
  });

  // --- Area gating moved to the navigation ITEM (spec 17.0.0) ---
  //
  // `visible` / `requiredPermissions` were retired at AREA level
  // (`AREA_VISIBLE_RETIRED` / `AREA_REQUIRED_PERMISSIONS_RETIRED`): an area is a
  // layout grouping, not an access boundary. These two tests used to assert the
  // area itself was hidden; after #3315 they asserted the capability still
  // exists one level down, which is where the spec moved it. Losing the gate
  // entirely — rather than relocating it — is the regression worth catching.
  //
  // Since #3311 the gated item needs a VISIBLE sibling here: an area whose
  // items are ALL gated is now derived-hidden and never activated (see the
  // "derived area visibility" block below), which would make a lone-gated-item
  // assertion vacuous. A partially gated area stays visible and active, which
  // is exactly what keeps "the ITEM is gated, the area is not" load-bearing.

  // NB: the gated item must live in the ACTIVE area — the first VISIBLE area
  // is the one the switcher activates by default, so it is the only area whose
  // navigation is actually rendered. Gating an item in a non-active area
  // asserts nothing: it is absent either way.

  it('gates the navigation ITEM by visibility, not the area', () => {
    const schema: AppComponentSchema = {
      type: 'app',
      name: 'crm',
      title: 'CRM',
      areas: [
        {
          ...salesArea,
          navigation: [
            { ...salesEntry, visible: false },
            { id: 'a1b', type: 'object', label: 'Quotes', objectName: 'quote' },
          ],
        },
        serviceArea,
      ],
    };
    renderApp(schema, {
      evaluateVisibility: (expr) => expr !== false,
    });
    // The partially gated area still appears in the switcher, stays active,
    // and renders its visible item…
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('Quotes')).toBeTruthy();
    // …but the item it gates does not render.
    expect(screen.queryByText('Opportunities')).toBeNull();
  });

  it('gates the navigation ITEM by permission, not the area', () => {
    const schema: AppComponentSchema = {
      type: 'app',
      name: 'crm',
      title: 'CRM',
      areas: [
        {
          ...salesArea,
          navigation: [
            { ...salesEntry, requiredPermissions: ['sales:admin'] },
            { id: 'a1b', type: 'object', label: 'Quotes', objectName: 'quote' },
          ],
        },
        serviceArea,
      ],
    };
    renderApp(schema, {
      checkPermission: (perms) => !perms.includes('sales:admin'),
    });
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('Quotes')).toBeTruthy();
    expect(screen.queryByText('Opportunities')).toBeNull();
  });

  // --- Derived area visibility (#3311) ---
  //
  // Spec 17.0.0 retired the authorable area-level `visible` /
  // `requiredPermissions`; #3315 followed suit, which left an area whose items
  // are ALL gated rendering as visible-but-empty in the switcher. Per the
  // #3311 ruling (option C), area visibility is now DERIVED from the items
  // inside — the same item-level guards NavigationRenderer applies — so a
  // fully gated area disappears again, with no authorable key involved. An
  // area with no items at all derives the same way: nothing visible → hidden.

  describe('derived area visibility (#3311)', () => {
    const gatedSales: NavigationArea = {
      ...salesArea,
      navigation: [{ ...salesEntry, visible: false }],
    };

    it('keeps every area in the switcher when every area has a visible item', () => {
      renderApp({ type: 'app', name: 'crm', title: 'CRM', areas: [salesArea, serviceArea, marketingArea] });
      expect(screen.getByText('Sales')).toBeTruthy();
      expect(screen.getByText('Service')).toBeTruthy();
      expect(screen.getByText('Marketing')).toBeTruthy();
      // First area is active.
      expect(screen.getByText('Opportunities')).toBeTruthy();
    });

    it('hides an area whose items are ALL gated and activates the first visible area', () => {
      renderApp(
        { type: 'app', name: 'crm', title: 'CRM', areas: [gatedSales, serviceArea, marketingArea] },
        { evaluateVisibility: (expr) => expr !== false },
      );
      // The fully gated area is not offered in the switcher…
      expect(screen.queryByText('Sales')).toBeNull();
      expect(screen.getByText('Service')).toBeTruthy();
      expect(screen.getByText('Marketing')).toBeTruthy();
      // …and it is never auto-activated: the first VISIBLE area's navigation
      // renders instead of a visible-but-empty Sales area.
      expect(screen.getByText('Cases')).toBeTruthy();
      expect(screen.queryByText('Opportunities')).toBeNull();
    });

    it('hides an area whose items all fail their permission checks', () => {
      const adminSales: NavigationArea = {
        ...salesArea,
        navigation: [
          { ...salesEntry, requiredPermissions: ['sales:admin'] },
        ],
      };
      renderApp(
        { type: 'app', name: 'crm', title: 'CRM', areas: [adminSales, serviceArea, marketingArea] },
        { checkPermission: (perms) => !perms.includes('sales:admin') },
      );
      expect(screen.queryByText('Sales')).toBeNull();
      expect(screen.getByText('Service')).toBeTruthy();
      expect(screen.getByText('Cases')).toBeTruthy();
    });

    it('hides the switcher entirely when only one area remains visible', () => {
      renderApp(
        { type: 'app', name: 'crm', title: 'CRM', areas: [gatedSales, serviceArea] },
        { evaluateVisibility: (expr) => expr !== false },
      );
      // One visible area = nothing to switch between: no switcher at all,
      // so neither area label renders — but the visible area's nav does.
      expect(screen.queryByText('Sales')).toBeNull();
      expect(screen.queryByText('Service')).toBeNull();
      expect(screen.getByText('Cases')).toBeTruthy();
    });

    it('renders no switcher and no area navigation when every area is fully gated', () => {
      renderApp(
        {
          type: 'app',
          name: 'crm',
          title: 'CRM',
          areas: [
            gatedSales,
            { ...serviceArea, navigation: [{ ...serviceEntry, visible: false }] },
          ],
        },
        { evaluateVisibility: (expr) => expr !== false },
      );
      expect(screen.queryByText('Sales')).toBeNull();
      expect(screen.queryByText('Service')).toBeNull();
      expect(screen.queryByText('Opportunities')).toBeNull();
      expect(screen.queryByText('Cases')).toBeNull();
      // The shell itself still renders.
      expect(screen.getByTestId('page-content')).toBeTruthy();
    });

    it('treats an area with no items at all like a fully gated one (hidden)', () => {
      // Boundary decision recorded in #3311: an empty area derives exactly
      // like an all-gated one — no visible item, no entry in the switcher.
      const emptyArea: NavigationArea = { id: 'area-empty', label: 'Empty', navigation: [] };
      renderApp({ type: 'app', name: 'crm', title: 'CRM', areas: [emptyArea, salesArea, serviceArea] });
      expect(screen.queryByText('Empty')).toBeNull();
      expect(screen.getByText('Sales')).toBeTruthy();
      expect(screen.getByText('Service')).toBeTruthy();
      // Active area skips the empty one.
      expect(screen.getByText('Opportunities')).toBeTruthy();
    });

    it('derives through groups: an area whose groups have no visible child is hidden', () => {
      const groupedGated: NavigationArea = {
        id: 'area-grouped',
        label: 'Grouped',
        navigation: [
          {
            id: 'grp',
            type: 'group',
            label: 'Tools',
            children: [
              { id: 'grp-1', type: 'object', label: 'Hidden Tool', objectName: 'tool', visible: false },
            ],
          },
        ],
      };
      renderApp(
        { type: 'app', name: 'crm', title: 'CRM', areas: [groupedGated, serviceArea, marketingArea] },
        { evaluateVisibility: (expr) => expr !== false },
      );
      expect(screen.queryByText('Grouped')).toBeNull();
      expect(screen.getByText('Service')).toBeTruthy();
      expect(screen.getByText('Cases')).toBeTruthy();
    });

    it('re-derives when gating changes: revoking a permission hides the active area and re-elects', () => {
      const adminSales: NavigationArea = {
        ...salesArea,
        navigation: [
          { ...salesEntry, requiredPermissions: ['sales:admin'] },
        ],
      };
      const schema: AppComponentSchema = {
        type: 'app',
        name: 'crm',
        title: 'CRM',
        areas: [adminSales, serviceArea, marketingArea],
      };
      const ui = (checkPermission: (perms: string[]) => boolean) => (
        <MemoryRouter initialEntries={['/']}>
          <AppSchemaRenderer schema={schema} basePath="/apps/crm" checkPermission={checkPermission}>
            <div data-testid="page-content">Page Content</div>
          </AppSchemaRenderer>
        </MemoryRouter>
      );
      const view = render(ui(() => true));
      // Permission granted: Sales is visible and active.
      expect(screen.getByText('Sales')).toBeTruthy();
      expect(screen.getByText('Opportunities')).toBeTruthy();

      // Permission revoked: Sales derives hidden, drops out of the switcher,
      // and the shell re-elects the first visible area.
      view.rerender(ui((perms) => !perms.includes('sales:admin')));
      expect(screen.queryByText('Sales')).toBeNull();
      expect(screen.queryByText('Opportunities')).toBeNull();
      expect(screen.getByText('Cases')).toBeTruthy();

      // Permission granted again: Sales reappears in the switcher, but the
      // user's current area is NOT yanked away — Service stays active.
      view.rerender(ui(() => true));
      expect(screen.getByText('Sales')).toBeTruthy();
      expect(screen.getByText('Cases')).toBeTruthy();
      expect(screen.queryByText('Opportunities')).toBeNull();
    });
  });

  // --- hasVisibleNavigationItems (the predicate behind #3311) ---

  describe('hasVisibleNavigationItems', () => {
    it('returns false for an empty tree', () => {
      expect(hasVisibleNavigationItems([])).toBe(false);
    });

    it('ignores separators — a divider is not content', () => {
      expect(
        hasVisibleNavigationItems([{ id: 's1', type: 'separator' }]),
      ).toBe(false);
    });

    it('counts an action item only when the host wires a dispatcher (framework#4509)', () => {
      const items: NavigationItem[] = [
        {
          id: 'act1',
          type: 'action',
          label: 'Export',
          actionDef: { actionName: 'export_data' },
        },
      ];
      expect(hasVisibleNavigationItems(items)).toBe(false);
      expect(hasVisibleNavigationItems(items, { hasActionHandler: true })).toBe(true);
    });

    it('applies the runtime capability gates (requiresObject / requiresService)', () => {
      const items: NavigationItem[] = [
        { id: 'n1', type: 'object', label: 'Apps', objectName: 'sys_app', requiresObject: 'sys_app' },
      ];
      expect(
        hasVisibleNavigationItems(items, { checkCapability: () => false }),
      ).toBe(false);
      expect(
        hasVisibleNavigationItems(items, { checkCapability: () => true }),
      ).toBe(true);
    });

    it('applies a group\'s own guards before recursing into its children', () => {
      const items: NavigationItem[] = [
        {
          id: 'grp',
          type: 'group',
          label: 'Admin',
          requiredPermissions: ['admin'],
          children: [
            { id: 'grp-1', type: 'object', label: 'Users', objectName: 'user' },
          ],
        },
      ];
      // The child is visible, but the group itself is gated → nothing counts.
      expect(
        hasVisibleNavigationItems(items, { checkPermission: () => false }),
      ).toBe(false);
      expect(
        hasVisibleNavigationItems(items, { checkPermission: () => true }),
      ).toBe(true);
    });

    it('does not count a group with no visible child', () => {
      const items: NavigationItem[] = [
        {
          id: 'grp',
          type: 'group',
          label: 'Tools',
          children: [
            { id: 'grp-1', type: 'object', label: 'Hidden', objectName: 'tool', visible: false },
          ],
        },
      ];
      expect(
        hasVisibleNavigationItems(items, { evaluateVisibility: (expr) => expr !== false }),
      ).toBe(false);
    });
  });

  // --- Mobile bottom_nav mode ---

  it('renders mobile bottom nav when mobileNavMode is bottom_nav', () => {
    const { container } = renderApp(schemaWithNav, { mobileNavMode: 'bottom_nav' });
    const bottomNav = container.querySelector('[role="navigation"][aria-label="Mobile navigation"]');
    expect(bottomNav).toBeTruthy();
  });

  it('does not render bottom nav in drawer mode (default)', () => {
    const { container } = renderApp(schemaWithNav);
    const bottomNav = container.querySelector('[role="navigation"][aria-label="Mobile navigation"]');
    expect(bottomNav).toBeNull();
  });

  // Narrowing `mobileNavMode` to a two-value enum (objectui#3985) must not move
  // either surviving mode. The default is covered above; this is the same value
  // passed EXPLICITLY, which is the path an author takes and the one a
  // vocabulary change would break first — a default that still works says
  // nothing about whether the value is still accepted.
  it('does not render bottom nav when drawer is passed explicitly', () => {
    const { container } = renderApp(schemaWithNav, { mobileNavMode: 'drawer' });
    expect(
      container.querySelector('[role="navigation"][aria-label="Mobile navigation"]'),
    ).toBeNull();
    // Non-vacuity: the shell and its sidebar navigation rendered, so "no bottom
    // nav" is a verdict about the mode rather than about an empty container.
    expect(screen.getByTestId('page-content')).toBeTruthy();
    expect(screen.getAllByText('Accounts').length).toBeGreaterThan(0);
  });

  // --- Sidebar footer slot ---

  it('renders sidebarFooter slot', () => {
    renderApp(schemaWithNav, {
      sidebarFooter: <div data-testid="user-profile">User Profile</div>,
    });
    expect(screen.getByTestId('user-profile')).toBeTruthy();
  });

  // --- Navbar slot ---

  it('renders navbar slot', () => {
    renderApp(schemaWithNav, {
      navbar: <div data-testid="custom-navbar">Search Bar</div>,
    });
    expect(screen.getByTestId('custom-navbar')).toBeTruthy();
  });

  // --- Permission & visibility on nav items ---

  it('hides navigation items based on visibility', () => {
    const schema: AppComponentSchema = {
      type: 'app',
      name: 'crm',
      title: 'CRM',
      navigation: [
        { id: 'n1', type: 'object', label: 'Public', objectName: 'public', visible: true },
        { id: 'n2', type: 'object', label: 'Hidden', objectName: 'hidden', visible: false },
      ],
    };
    renderApp(schema, {
      evaluateVisibility: (expr) => expr !== false,
    });
    expect(screen.getByText('Public')).toBeTruthy();
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('hides navigation items based on permissions', () => {
    const schema: AppComponentSchema = {
      type: 'app',
      name: 'crm',
      title: 'CRM',
      navigation: [
        { id: 'n1', type: 'object', label: 'Allowed', objectName: 'allowed' },
        { id: 'n2', type: 'object', label: 'Restricted', objectName: 'restricted', requiredPermissions: ['admin'] },
      ],
    };
    renderApp(schema, {
      checkPermission: (perms) => !perms.includes('admin'),
    });
    expect(screen.getByText('Allowed')).toBeTruthy();
    expect(screen.queryByText('Restricted')).toBeNull();
  });

  // --- Empty schema ---

  it('renders empty shell with no navigation', () => {
    renderApp(minimalSchema);
    expect(screen.getByTestId('page-content')).toBeTruthy();
    // App name should still be shown
    expect(screen.getByText('Sales CRM')).toBeTruthy();
  });

  // --- P1.7: Search within sidebar navigation ---

  describe('sidebar search', () => {
    it('renders search input when enableSearch is true', () => {
      renderApp(schemaWithNav, { enableSearch: true });
      expect(screen.getByPlaceholderText('Search navigation…')).toBeTruthy();
    });

    it('does not render search input by default', () => {
      renderApp(schemaWithNav);
      expect(screen.queryByPlaceholderText('Search navigation…')).toBeNull();
    });

    it('filters navigation items when user types in search', () => {
      renderApp(schemaWithNav, { enableSearch: true });
      const searchInput = screen.getByPlaceholderText('Search navigation…');
      fireEvent.change(searchInput, { target: { value: 'Accounts' } });
      expect(screen.getByText('Accounts')).toBeTruthy();
      expect(screen.queryByText('Overview')).toBeNull();
      expect(screen.queryByText('Settings')).toBeNull();
    });

    it('shows all items when search is cleared', () => {
      renderApp(schemaWithNav, { enableSearch: true });
      const searchInput = screen.getByPlaceholderText('Search navigation…');
      // Type search
      fireEvent.change(searchInput, { target: { value: 'Accounts' } });
      expect(screen.queryByText('Overview')).toBeNull();
      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });
      expect(screen.getByText('Accounts')).toBeTruthy();
      expect(screen.getByText('Overview')).toBeTruthy();
      expect(screen.getByText('Settings')).toBeTruthy();
    });

    it('search input has correct aria-label', () => {
      renderApp(schemaWithNav, { enableSearch: true });
      expect(screen.getByLabelText('Search navigation')).toBeTruthy();
    });
  });

  // --- P1.7: Pin favorites ---

  describe('pin favorites', () => {
    it('renders pin buttons when enablePinning is true', () => {
      renderApp(schemaWithNav, { enablePinning: true, onPinToggle: vi.fn() });
      expect(screen.getByLabelText('Pin Accounts')).toBeTruthy();
    });

    it('calls onPinToggle when pin button is clicked', () => {
      const onPinToggle = vi.fn();
      renderApp(schemaWithNav, { enablePinning: true, onPinToggle });
      fireEvent.click(screen.getByLabelText('Pin Accounts'));
      // Args: (itemId, pinned, item?, basePath?) — match on the first two
      // and accept any item/basePath. NavigationRenderer forwards the
      // NavigationItem + basePath so consumers can synthesize portable
      // favorites; older signatures still work via positional args.
      expect(onPinToggle).toHaveBeenCalledWith(
        'n1',
        true,
        expect.objectContaining({ id: 'n1' }),
        expect.any(String),
      );
    });
  });

  // --- P1.7: Drag reorder --- retired (objectui#12059): an app's menu order is
  // authored in Studio. The retired props are pinned absent in
  // `NavigationRenderer.pinnedOrder-12059.test.tsx`.

  // --- Slot system ---

  describe('slot system', () => {
    it('renders custom sidebarHeader when provided', () => {
      renderApp(schemaWithNav, {
        sidebarHeader: <div data-testid="custom-header">Custom Header</div>,
      });
      expect(screen.getByTestId('custom-header')).toBeTruthy();
      expect(screen.getByText('Custom Header')).toBeTruthy();
    });

    it('replaces default branding header with sidebarHeader slot', () => {
      renderApp(schemaWithNav, {
        sidebarHeader: <div data-testid="custom-header">App Switcher</div>,
      });
      // Custom header is present
      expect(screen.getByText('App Switcher')).toBeTruthy();
      // Default branding title should not be in the sidebar header
      // (it may still appear elsewhere, but the slot replaces the header content)
      expect(screen.getByTestId('custom-header')).toBeTruthy();
    });

    it('renders sidebarExtra content after navigation', () => {
      renderApp(schemaWithNav, {
        sidebarExtra: <div data-testid="sidebar-extra">Recent Items Section</div>,
      });
      expect(screen.getByTestId('sidebar-extra')).toBeTruthy();
      expect(screen.getByText('Recent Items Section')).toBeTruthy();
    });

    it('renders sidebarFooter slot', () => {
      renderApp(schemaWithNav, {
        sidebarFooter: <div data-testid="user-footer">User Profile</div>,
      });
      expect(screen.getByTestId('user-footer')).toBeTruthy();
      expect(screen.getByText('User Profile')).toBeTruthy();
    });

    it('renders all slots together', () => {
      renderApp(schemaWithNav, {
        sidebarHeader: <div data-testid="header-slot">Header</div>,
        sidebarExtra: <div data-testid="extra-slot">Extra</div>,
        sidebarFooter: <div data-testid="footer-slot">Footer</div>,
        navbar: <div data-testid="navbar-slot">Navbar</div>,
      });
      expect(screen.getByTestId('header-slot')).toBeTruthy();
      expect(screen.getByTestId('extra-slot')).toBeTruthy();
      expect(screen.getByTestId('footer-slot')).toBeTruthy();
      expect(screen.getByTestId('navbar-slot')).toBeTruthy();
      // Navigation still renders
      expect(screen.getByText('Accounts')).toBeTruthy();
    });

    it('uses default branding header when sidebarHeader is not provided', () => {
      renderApp(schemaWithNav);
      // Default header shows app title
      expect(screen.getByText('Sales CRM')).toBeTruthy();
    });
  });
});
