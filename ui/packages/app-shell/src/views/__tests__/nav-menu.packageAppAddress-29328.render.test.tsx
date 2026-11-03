/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `nav:menu` page block addresses a package's second app by its own
 * address, as the sidebar does (`UnifiedSidebar.packageAppAddress-29328`).
 *
 * `/apps/SEGMENT` resolves to a package's FIRST app when SEGMENT is the package
 * id, so inside the second app the block's links carry the app's name, the
 * address `appAddressSegment` answers among the metadata app list. A package's
 * first or only app keeps its package-id address.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Module scope, never a `beforeAll` (AGENTS.md §测试纪律, objectui#3010).
import '@object-ui/components';
import { SchemaRenderer, MetadataCtx } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import '../nav-menu-renderer';

const APPS = [
  {
    name: 'crm',
    label: 'Sales',
    _packageId: 'com.example.crm',
    navigation: [{ id: 'nav_opportunity', type: 'object', objectName: 'crm_opportunity', label: 'Opportunities' }],
  },
  {
    name: 'crm_service',
    label: 'Service',
    _packageId: 'com.example.crm',
    navigation: [
      { id: 'nav_case', type: 'object', objectName: 'crm_case', label: 'Cases' },
      { id: 'nav_board', type: 'dashboard', dashboardName: 'service_board', label: 'Service board' },
    ],
  },
  {
    name: 'hr',
    label: 'People',
    _packageId: 'com.example.hr',
    navigation: [{ id: 'nav_employee', type: 'object', objectName: 'hr_employee', label: 'Employees' }],
  },
];

const ANSWER: MePermissionsAuthenticatedResponse = {
  authenticated: true,
  userId: 'u_member',
  tenantId: null,
  positions: [],
  hasAnyQueue: false,
  permissionSets: ['member'],
  systemPermissions: [],
  objects: {
    crm_opportunity: { allowRead: true },
    crm_case: { allowRead: true },
    hr_employee: { allowRead: true },
  },
  fields: {},
};

const METADATA = {
  apps: APPS,
  objects: [
    { name: 'crm_opportunity', label: 'Opportunities' },
    { name: 'crm_case', label: 'Cases' },
    { name: 'hr_employee', label: 'Employees' },
  ],
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

function renderMenuAt(path: string) {
  render(
    <MePermissionsProvider initialPermissions={ANSWER}>
      <MemoryRouter initialEntries={[path]}>
        <MetadataCtx.Provider value={METADATA as never}>
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

describe("`nav:menu` addresses a package's second app by its own address", () => {
  it("inside the package's second app, every link stays in that app", () => {
    const menu = renderMenuAt('/apps/crm_service');
    expect(menu.getByRole('link', { name: 'Cases' })).toHaveAttribute('href', '/apps/crm_service/crm_case');
    expect(menu.getByRole('link', { name: 'Service board' })).toHaveAttribute(
      'href',
      '/apps/crm_service/dashboard/service_board',
    );
  });

  it("control: the package's first app keeps its package-id address", () => {
    const menu = renderMenuAt('/apps/com.example.crm');
    expect(menu.getByRole('link', { name: 'Opportunities' })).toHaveAttribute(
      'href',
      '/apps/com.example.crm/crm_opportunity',
    );
  });

  it("control: a package's only app keeps its package-id address", () => {
    const menu = renderMenuAt('/apps/com.example.hr');
    expect(menu.getByRole('link', { name: 'Employees' })).toHaveAttribute('href', '/apps/com.example.hr/hr_employee');
  });
});
