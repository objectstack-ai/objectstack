/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12109 — the `nav:menu` page block draws the tree the sidebar draws:
 * an entry bound to an object the caller may not read is not drawn here
 * either, and the area it elects is elected over that same pruned tree.
 *
 * The sidebar's half is `UnifiedSidebar.objectReadGate-12109.test.tsx`; both
 * prune through `withoutUnreadableObjectEntries`. The verdict is the REAL
 * `MePermissionsProvider`'s, holding a service agent's `/me/permissions` answer.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Module scope, never a `beforeAll` (AGENTS.md §测试纪律, objectui#3010).
import '@object-ui/components';
import { SchemaRenderer, MetadataCtx } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import '../nav-menu-renderer';

const NAVIGATION = [
  { id: 'nav_home', type: 'dashboard', dashboardName: 'crm_home', label: 'Home' },
  {
    id: 'group_sales',
    type: 'group',
    label: 'Sales',
    children: [
      { id: 'nav_account', type: 'object', objectName: 'crm_account', label: 'Accounts' },
      { id: 'nav_opportunity', type: 'object', objectName: 'crm_opportunity', label: 'Opportunities' },
    ],
  },
  { id: 'nav_my_deals', type: 'object', objectName: 'crm_opportunity', viewName: 'my_open_deals', label: 'My Deals' },
];

const AREAS = [
  {
    id: 'area_pipeline',
    label: 'Pipeline',
    navigation: [{ id: 'nav_opportunity', type: 'object', objectName: 'crm_opportunity', label: 'Opportunities' }],
  },
  {
    id: 'area_service',
    label: 'Service',
    navigation: [{ id: 'nav_account', type: 'object', objectName: 'crm_account', label: 'Accounts' }],
  },
];

function answerFor(opportunityRead: boolean): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u_agent',
    tenantId: null,
    roles: [],
    permissionSets: ['service_agent'],
    systemPermissions: [],
    objects: { crm_account: { allowRead: true }, crm_opportunity: { allowRead: opportunityRead } },
    fields: {},
  };
}

function metadata(app: Record<string, unknown>) {
  return {
    apps: [app],
    objects: [{ name: 'crm_account', label: 'Accounts' }, { name: 'crm_opportunity', label: 'Opportunities' }],
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
}

function renderMenu(answer: MePermissionsResponse, app: Record<string, unknown>) {
  render(
    <MePermissionsProvider initialPermissions={answer}>
      <MemoryRouter initialEntries={['/apps/crm']}>
        <MetadataCtx.Provider value={metadata(app) as never}>
          <Routes>
            <Route
              path="/apps/:appName"
              element={
                <SchemaRenderer
                  schema={{ type: 'page:section', id: 's1', children: [{ type: 'nav:menu', id: 'blk_nav' }] } as never}
                />
              }
            />
          </Routes>
        </MetadataCtx.Provider>
      </MemoryRouter>
    </MePermissionsProvider>,
  );
  return within(screen.getByRole('navigation', { name: 'App navigation' }));
}

describe('objectui#12109 — `nav:menu` prunes an unreadable object entry, as the sidebar does', () => {
  it('the service agent: Opportunities and My Deals are not drawn; Accounts and the dashboard are', () => {
    const menu = renderMenu(answerFor(false), { name: 'crm', label: 'CRM', navigation: NAVIGATION });
    expect(menu.queryByRole('link', { name: 'Opportunities' })).toBeNull();
    expect(menu.queryByRole('link', { name: 'My Deals' })).toBeNull();
    expect(menu.getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/apps/crm/crm_account');
    // CONTROL: an entry not bound to an object is unchanged.
    expect(menu.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/apps/crm/dashboard/crm_home');
  });

  it('a caller who may read the object sees both entries', () => {
    const menu = renderMenu(answerFor(true), { name: 'crm', label: 'CRM', navigation: NAVIGATION });
    expect(menu.getByRole('link', { name: 'Opportunities' })).toHaveAttribute('href', '/apps/crm/crm_opportunity');
    expect(menu.getByRole('link', { name: 'My Deals' })).toHaveAttribute('href', '/apps/crm/crm_opportunity/view/my_open_deals');
  });

  it('the elected area is the first one with a READABLE entry', () => {
    const menu = renderMenu(answerFor(false), { name: 'crm', label: 'CRM', navigation: [], areas: AREAS });
    expect(menu.getByRole('link', { name: 'Accounts' })).toBeInTheDocument();
    expect(menu.queryByRole('link', { name: 'Opportunities' })).toBeNull();
  });
});
