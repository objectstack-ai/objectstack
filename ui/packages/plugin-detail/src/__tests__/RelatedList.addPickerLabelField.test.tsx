/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3365 — the related-list Add picker must honour
 * `add.picker.labelField`.
 *
 * Pre-fix the dialog received only `objectName`, so it fell back to its
 * `displayField = 'name'` default with a single title-cased NAME column:
 * assigning a position / granting a permission set showed machine names
 * (`admin_full_access`) even though the platform page metadata declared
 * `picker: { object: 'sys_permission_set', labelField: 'label' }`.
 *
 * Now the picker leads with `labelField`, derives its columns (and their
 * headers) from the target object's schema via the shared
 * `deriveLookupColumns`, and — when the schema cannot be fetched — still
 * displays the `labelField` column instead of `name`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

// The list body itself is irrelevant here — only the Add dialog matters.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, SchemaRenderer: () => null };
});

const junctionSchema = {
  name: 'sys_user_permission_set',
  fields: {
    permission_set_id: {
      type: 'lookup',
      label: 'Permission Set',
      reference: 'sys_permission_set',
    },
  },
};

// The exact sys_permission_set shape: `name` is the machine/API name, the
// human-readable display name lives in `label`.
const permissionSetSchema = {
  name: 'sys_permission_set',
  nameField: 'label',
  fields: {
    name: { type: 'text', label: 'API Name' },
    label: { type: 'text', label: '权限集名称' },
  },
};

const candidates = [
  { id: 'ps_1', name: 'admin_full_access', label: '管理员完全访问' },
  { id: 'ps_2', name: 'ehr_operator', label: 'EHR 操作员' },
];

const makeDataSource = () => ({
  getObjectSchema: vi.fn(async (api: string) =>
    api === 'sys_permission_set' ? permissionSetSchema : junctionSchema,
  ),
  find: vi.fn(async (api: string) =>
    api === 'sys_permission_set'
      ? { data: candidates, total: candidates.length }
      : { data: [], total: 0 },
  ),
});

const renderList = (ds: any) =>
  render(
    <RelatedList
      title="Permission Sets"
      type="table"
      api="sys_user_permission_set"
      objectName="sys_user_permission_set"
      referenceField="user_id"
      parentId="u_1"
      columns={[{ accessorKey: 'permission_set_id', header: 'Permission Set' }]}
      dataSource={ds}
      add={{
        picker: { object: 'sys_permission_set', labelField: 'label' },
        linkField: 'permission_set_id',
        label: 'Grant permission set',
      }}
    />,
  );

describe('RelatedList Add picker — add.picker.labelField (#3365)', () => {
  it('shows labelField values with schema-derived column headers', async () => {
    const ds = makeDataSource();
    renderList(ds);

    fireEvent.click(screen.getByRole('button', { name: /Grant permission set/ }));

    await waitFor(() =>
      expect(ds.getObjectSchema).toHaveBeenCalledWith('sys_permission_set'),
    );
    // Candidate rows show the human-readable labelField value…
    await waitFor(() =>
      expect(screen.getByText('管理员完全访问')).toBeInTheDocument(),
    );
    expect(screen.getByText('EHR 操作员')).toBeInTheDocument();
    // …and the leading column header is the schema field's label, not
    // titleCase('name').
    expect(screen.getByText('权限集名称')).toBeInTheDocument();
  });

  it('still leads with labelField when the picker schema is unavailable', async () => {
    const ds = makeDataSource();
    ds.getObjectSchema.mockImplementation(async (api: string) => {
      if (api === 'sys_permission_set') throw new Error('no schema');
      return junctionSchema;
    });
    renderList(ds);

    fireEvent.click(screen.getByRole('button', { name: /Grant permission set/ }));

    // No schema → no derived columns, but displayField alone must already
    // surface the human-readable label instead of the machine name.
    await waitFor(() =>
      expect(screen.getByText('管理员完全访问')).toBeInTheDocument(),
    );
  });
});
