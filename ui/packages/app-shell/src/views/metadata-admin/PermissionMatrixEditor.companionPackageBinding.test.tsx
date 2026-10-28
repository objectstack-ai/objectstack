// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The delegated-admin companion list reads its package binding from the
 * editor's `packageId`, at both of the editor's facet mounts.
 *
 * Under a package binding (the package door, ADR-0086 P0) the draft holds only
 * the package's own objects, so the list cannot tell whether the stored set
 * grants a `sys_*` row: it lists the five grants unmarked, with no one-click
 * grant. At environment scope it marks each grant. The binding is the page's
 * `packageId`, not the presentation (`studio` sets the facet's `only`): a
 * Setup page under a package is bound, a Studio presentation without one is
 * not.
 *
 * Driven through the real `PermissionMatrixEditPage` load path against a fake
 * client, with the set's scope already naming a business unit, so the list
 * renders on open.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const SET = {
  name: 'field_ops_delegate',
  label: 'Field Ops Delegate',
  systemPermissions: ['setup.access'],
  objects: { a_account: { allowRead: true } },
  adminScope: { businessUnit: 'bu_field_ops', manageAssignments: true },
};

const client = {
  layered: async () => ({ effective: SET, code: null, overlay: null, overlayScope: null }),
  getDraft: async () => null,
  // objectstack#26840 — the package door reads its objects through the draft-overlaid door.
  withPreviewDrafts() { return this; },
  list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
  get: async () => null,
  save: async (_type: string, _name: string, payload: unknown) => payload,
};

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => client,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));

vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

const COMPANION = 'admin-companion-setup.access';

async function openSetupPage(packageId?: string) {
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name={SET.name} packageId={packageId} />
    </MemoryRouter>,
  );
  await screen.findByText('a_account');
  // Setup's stacked presentation: the scope section starts collapsed.
  fireEvent.click(screen.getByRole('button', { name: /Delegated Admin Scope/ }));
  return screen.findByTestId(COMPANION);
}

async function openStudioAdminTab(packageId?: string) {
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name={SET.name}
        packageId={packageId}
        embedded
        studio={{ tab: 'admin', onTabChange: () => {} }}
      />
    </MemoryRouter>,
  );
  return screen.findByTestId(COMPANION);
}

describe('PermissionMatrixEditPage · companion list binding comes from packageId', () => {
  it('Setup mount, environment scope: the grant is marked', async () => {
    const row = await openSetupPage(undefined);
    expect(row.getAttribute('data-granted')).toBe('true');
  });

  it('Setup mount, under a package: the grant is listed unmarked', async () => {
    const row = await openSetupPage('app.a');
    expect(row.hasAttribute('data-granted')).toBe(false);
  });

  it('Studio mount, under a package: the grant is listed unmarked', async () => {
    const row = await openStudioAdminTab('app.a');
    expect(row.hasAttribute('data-granted')).toBe(false);
  });

  it('Studio mount, environment scope: the presentation alone does not bind, the grant is marked', async () => {
    const row = await openStudioAdminTab(undefined);
    expect(row.getAttribute('data-granted')).toBe('true');
  });
});
