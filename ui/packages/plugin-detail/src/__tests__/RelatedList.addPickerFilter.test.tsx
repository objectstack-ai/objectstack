/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3831 — the related-list Add picker must honour
 * `add.picker.filter`.
 *
 * The spec declares it ("Restrict which records the picker offers") and, until
 * this fix, nothing in the repo read it: the dialog mount passed `objectName` /
 * `title` / `displayField` / `columns` / `cellRenderer` / `fieldsMeta` /
 * `multiple` / `onSelect` / `onSelectRecords` and no filter at all. An author
 * who scoped the candidate set — only ACTIVE positions may be assigned, only
 * unexpired licences may be attached — got every record of `picker.object`,
 * with `os validate` / `os build` silently green and no runtime diagnostic. The
 * pick then created the link row or re-parented outright.
 *
 * It is wired to `baseFilter`, not `lookupFilters`: `lookupFilters` renders its
 * entries as filter-bar rows the user can edit, which would turn the author's
 * restriction into a suggestion. `baseFilter` never surfaces in the UI and
 * cannot be widened back out.
 *
 * These assertions read the `$filter` the picker's own query carries, i.e. the
 * question actually asked of the data source — not merely that a prop was
 * threaded somewhere.
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
  name: 'sys_user_position',
  fields: {
    position: { type: 'lookup', label: 'Position', reference: 'sys_position' },
  },
};

const positionSchema = {
  name: 'sys_position',
  fields: {
    name: { type: 'text', label: 'Name' },
    is_active: { type: 'boolean', label: 'Active' },
  },
};

const makeDataSource = () => ({
  getObjectSchema: vi.fn(async (api: string) =>
    api === 'sys_position' ? positionSchema : junctionSchema,
  ),
  find: vi.fn(async (api: string) =>
    api === 'sys_position'
      ? { data: [{ id: 'p1', name: 'Nurse', is_active: true }], total: 1 }
      : { data: [], total: 0 },
  ),
});

/** `$filter` of the most recent query against the PICKER's object. */
function lastPickerFilter(ds: any) {
  const calls = ds.find.mock.calls.filter((c: any[]) => c[0] === 'sys_position');
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1]?.$filter;
}

const renderList = (ds: any, filter?: any) =>
  render(
    <RelatedList
      title="Holders"
      type="table"
      api="sys_user_position"
      objectName="sys_user_position"
      referenceField="user_id"
      parentId="u_1"
      columns={[{ accessorKey: 'position', header: 'Position' }]}
      dataSource={ds}
      add={{
        picker: { object: 'sys_position', ...(filter ? { filter } : {}) },
        linkField: 'position',
        label: 'Assign position',
      }}
    />,
  );

const openPicker = () =>
  fireEvent.click(screen.getByRole('button', { name: /Assign position/ }));

describe('RelatedList Add picker — add.picker.filter (#3831)', () => {
  it('scopes the picker query with the authored restriction', async () => {
    const ds = makeDataSource();
    renderList(ds, [{ field: 'is_active', operator: 'equals', value: true }]);
    openPicker();

    await waitFor(() => expect(lastPickerFilter(ds)).toBeDefined());
    // Lowered by the shared filter sink, so the rule reaches the wire as an AST
    // node rather than as a bare rule object the server refuses.
    expect(lastPickerFilter(ds)).toEqual([['is_active', 'equals', true]]);
  });

  it('carries every rule of a multi-rule restriction, operators intact', async () => {
    const ds = makeDataSource();
    renderList(ds, [
      { field: 'is_active', operator: 'equals', value: true },
      // Two rules on ONE field — a range the field-keyed record form could not
      // have expressed without merging them by hand.
      { field: 'headcount', operator: 'greater_than', value: 0 },
      { field: 'headcount', operator: 'less_than', value: 100 },
      // The operators with no MongoDB-style `$op`, hence no lossless record
      // representation: `before`/`after` and the emptiness pair.
      { field: 'starts_at', operator: 'before', value: '2026-06-01' },
      { field: 'ends_at', operator: 'after', value: '2026-01-01' },
      { field: 'retired_at', operator: 'is_empty' },
    ]);
    openPicker();

    await waitFor(() => expect(lastPickerFilter(ds)).toBeDefined());
    expect(lastPickerFilter(ds)).toEqual([
      ['is_active', 'equals', true],
      ['headcount', 'greater_than', 0],
      ['headcount', 'less_than', 100],
      ['starts_at', 'before', '2026-06-01'],
      ['ends_at', 'after', '2026-01-01'],
      ['retired_at', 'is_empty'],
    ]);
  });

  it('leaves the picker unfiltered when the author declared no restriction', async () => {
    const ds = makeDataSource();
    renderList(ds);
    openPicker();

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('sys_position'));
    await waitFor(() =>
      expect(ds.find.mock.calls.some((c: any[]) => c[0] === 'sys_position')).toBe(true),
    );
    // No `add.picker.filter` → no `$filter`. The status quo for every existing
    // related list stays exactly as it was.
    expect(lastPickerFilter(ds)).toBeUndefined();
  });

  it('does not demote the restriction into an editable filter-bar row', async () => {
    const ds = makeDataSource();
    renderList(ds, [{ field: 'is_active', operator: 'equals', value: true }]);
    openPicker();

    await waitFor(() => expect(lastPickerFilter(ds)).toBeDefined());
    // `lookupFilters` is what derives the picker's filter bar; routing the
    // author's restriction there would have published it as a user-editable
    // suggestion. Its absence is the observable difference.
    expect(screen.queryByTestId('record-picker-filter-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: /filters/i })).toBeNull();
  });
});
