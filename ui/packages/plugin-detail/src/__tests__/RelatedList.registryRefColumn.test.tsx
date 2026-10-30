/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27861 — a user's Permission Sets and Positions tabs draw each
 * set's and position's LABEL, with the api name on `title`.
 *
 * Both tabs are `record:related_list`s over by-name text columns that declare
 * `widget: 'permission-ref'` / `widget: 'position-ref'`
 * (`sys_user_permission_set.permission_set`, `sys_user_position.position`).
 * The related list draws its own cells (`makeCell` in `RelatedList.tsx`), and
 * it resolved their key from `type` and `format` only, so the widget never
 * reached `@object-ui/fields`' read face and the column printed the api name.
 *
 * The real data-table and cell renderers draw (nothing mocked); the catalog is
 * the data source's `listMetadataItems`, read once for the whole column.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

import '@object-ui/components';
import { SchemaRendererProvider } from '@object-ui/react';
import { RelatedList } from '../RelatedList';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

const CATALOGS: Record<string, Array<{ name: string; label?: string }>> = {
  permission: [
    { name: 'organization_admin_no_bypass', label: 'Organization Admin' },
    { name: 'admin_full_access', label: 'Full Access' },
  ],
  position: [{ name: 'sales_manager', label: 'Sales Manager' }],
};

function makeDataSource(objectName: string, column: string, widget: string, values: string[]) {
  const rows = values.map((value, i) => ({ id: `r${i}`, user_id: 'u1', [column]: value }));
  return {
    getObjectSchema: vi.fn(async () => ({
      name: objectName,
      fields: { [column]: { type: 'text', label: 'Granted', widget } },
    })),
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    listMetadataItems: vi.fn(async (type: string) => CATALOGS[type] ?? []),
  };
}

async function mountTab(objectName: string, column: string, widget: string, values: string[]) {
  const ds = makeDataSource(objectName, column, widget, values);
  const { container } = render(
    <SchemaRendererProvider dataSource={ds as any}>
      <RelatedList
        title="Grants"
        type="table"
        api={objectName}
        objectName={objectName}
        referenceField="user_id"
        parentId="u1"
        dataSource={ds as any}
        columns={[column] as any}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBe(values.length));
  const cells = () =>
    [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td [title]') as HTMLElement | null);
  return { ds, cells };
}

describe('objectstack#27861 — a related list draws a registry-name column through its read face', () => {
  it("Permission Sets: each set's label, its api name on title, one catalog read for the column", async () => {
    const { ds, cells } = await mountTab('sys_user_permission_set', 'permission_set', 'permission-ref', [
      'organization_admin_no_bypass',
      'admin_full_access',
    ]);
    await waitFor(() => expect(cells()[0]).toHaveTextContent('Organization Admin'));
    expect(cells()[0]).toHaveAttribute('title', 'organization_admin_no_bypass');
    expect(cells()[1]).toHaveTextContent('Full Access');
    expect(cells()[1]).toHaveAttribute('title', 'admin_full_access');
    expect(ds.listMetadataItems).toHaveBeenCalledTimes(1);
    expect(ds.listMetadataItems).toHaveBeenCalledWith('permission');
  });

  it("Positions: each position's label, its api name on title", async () => {
    const { ds, cells } = await mountTab('sys_user_position', 'position', 'position-ref', ['sales_manager']);
    await waitFor(() => expect(cells()[0]).toHaveTextContent('Sales Manager'));
    expect(cells()[0]).toHaveAttribute('title', 'sales_manager');
    expect(ds.listMetadataItems).toHaveBeenCalledWith('position');
  });

  it('a name the catalog does not hold still renders, as the name', async () => {
    const { cells } = await mountTab('sys_user_permission_set', 'permission_set', 'permission-ref', [
      'retired_set',
      'admin_full_access',
    ]);
    await waitFor(() => expect(cells()[1]).toHaveTextContent('Full Access'));
    expect(cells()[0]).toHaveTextContent(/^retired_set$/);
    expect(cells()[0]).toHaveAttribute('title', 'retired_set');
  });
});
