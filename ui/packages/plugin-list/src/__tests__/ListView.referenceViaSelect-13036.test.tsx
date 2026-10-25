/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13036 — a list asks for a `referenceVia` pointer column's type half.
 *
 * A pointer column (objectui#12608) is drawn by the grid through
 * `resolveRecordPointer` (`@object-ui/fields`), which reads the sibling the
 * field's `referenceVia` names off the ROW and answers null when it is absent;
 * the column then draws the stored id. `ListView`'s `$select` builder had no
 * arm for that sibling, so a list whose columns show `record_id` but not
 * `object_name` fetched rows without `object_name` and drew the raw id.
 *
 * This file pins `ListView`'s own fetch. A grouped grid that owns its fetch
 * (`gridOwnsGroupedFetch`) projects through `ObjectGrid`'s `getSelectFields`,
 * pinned with the real grid drawing the record in plugin-grid's
 * `ObjectGrid.referenceViaSelect-13036.test.tsx`. plugin-list does not depend
 * on plugin-grid, so a stub grid stands in here and the drawing is asked of
 * the rule the cell itself asks, `resolveRecordPointer`, against the rows the
 * grid is handed.
 *
 * What is pinned:
 *   - a non-column sibling is in `$select`, and the rows handed to the grid
 *     resolve to the record;
 *   - control: a row whose sibling is genuinely blank stays half-addressed;
 *   - a sibling the viewer may not read is not requested, a pointer column the
 *     viewer may not read harvests nothing, and a sibling the object does not
 *     declare is not sent;
 *   - a sibling that is a column is sent once.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/**
 * Swapped by IDENTITY, because the fetch effect names `perms` in its
 * dependency list.
 */
const { holder, makePerms } = vi.hoisted(() => {
  const makePerms = (isLoaded: boolean, denied: string[]) => ({
    isLoaded,
    checkField: (_object: string, field: string, action: string) =>
      action === 'read' ? !denied.includes(field) : true,
    check: () => ({ allowed: true }),
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    userId: null,
    systemPermissions: undefined,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  });
  return { holder: { current: makePerms(true, []) }, makePerms };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => holder.current as any };
});

import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { resolveRecordPointer } from '@object-ui/fields';
import { ListView } from '../ListView';

const OBJECT = 'sys_approval_request';

const objectDef = {
  name: OBJECT,
  label: 'Approval Request',
  fields: {
    id: { name: 'id', type: 'text' },
    process_name: { name: 'process_name', type: 'text', label: 'Source' },
    object_name: { name: 'object_name', type: 'text', label: 'Object' },
    record_id: { name: 'record_id', type: 'text', label: 'Record ID', referenceVia: 'object_name' },
    // A pointer whose sibling the object does not declare.
    loose_id: { name: 'loose_id', type: 'text', label: 'Loose ID', referenceVia: 'no_such_field' },
  },
};

const ROW = { id: 'req-1', process_name: 'flow:approval', object_name: 'crm_opportunity', record_id: 'opp-1', loose_id: 'x-1' };

let lastGridProps: any = null;
let prevObjectGrid: any;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});

/** Honours `$select` the way a server does: a row carries the selected keys only. */
const makeDataSource = (rows: Array<Record<string, unknown>>) =>
  ({
    find: vi.fn(async (_object: string, params: Record<string, any>) => {
      const select = params?.$select as string[] | undefined;
      const data = rows.map((row) =>
        select ? Object.fromEntries(select.filter((k) => k in row).map((k) => [k, row[k]])) : { ...row },
      );
      return { data, total: data.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => (name === OBJECT ? objectDef : null)),
  }) as any;

async function mount(columns: string[], rows: Array<Record<string, unknown>> = [ROW]) {
  const dataSource = makeDataSource(rows);
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, viewType: 'grid', columns } as any}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  const select = [...((dataSource.find.mock.calls.at(-1)?.[1]?.$select as string[] | undefined) ?? [])].sort();
  return { dataSource, select };
}

/** The rows the grid was handed, once it has been handed some. */
async function gridRows(): Promise<Array<Record<string, unknown>>> {
  await waitFor(() => expect(Array.isArray(lastGridProps?.data) && lastGridProps.data.length > 0).toBe(true));
  return lastGridProps.data;
}

/** The rule the pointer cell asks, applied to a row the grid was handed. */
const pointerOf = (row: Record<string, unknown>) =>
  resolveRecordPointer({ name: 'record_id', type: 'text', referenceVia: 'object_name' }, row);

beforeEach(() => {
  vi.clearAllMocks();
  lastGridProps = null;
  holder.current = makePerms(true, []);
});
afterEach(() => {
  cleanup();
  lastGridProps = null;
});

describe('ListView — a `referenceVia` pointer column asks for its type half (objectui#13036)', () => {
  it('asks for the sibling when the columns omit it, and the rows resolve to the record', async () => {
    const { select } = await mount(['process_name', 'record_id']);
    expect(select).toEqual(['id', 'object_name', 'process_name', 'record_id']);
    const [row] = await gridRows();
    expect(pointerOf(row)).toMatchObject({ objectName: 'crm_opportunity', recordId: 'opp-1' });
  });

  it('control: a row whose sibling is genuinely blank stays half-addressed', async () => {
    const { select } = await mount(['process_name', 'record_id'], [{ ...ROW, object_name: '' }]);
    expect(select).toContain('object_name');
    const [row] = await gridRows();
    expect(pointerOf(row)).toBeNull();
  });

  it('does not request a sibling the viewer may not read', async () => {
    holder.current = makePerms(true, ['object_name']);
    const { select } = await mount(['process_name', 'record_id']);
    expect(select).toEqual(['id', 'process_name', 'record_id']);
  });

  it('a pointer column the viewer may not read harvests nothing', async () => {
    holder.current = makePerms(true, ['record_id']);
    const { select } = await mount(['process_name', 'record_id']);
    expect(select).toEqual(['id', 'process_name']);
  });

  it('does not send a sibling the object does not declare', async () => {
    const { select } = await mount(['process_name', 'loose_id']);
    expect(select).toEqual(['id', 'loose_id', 'process_name']);
  });

  it('control: a sibling that is a column is sent once', async () => {
    const { dataSource } = await mount(['process_name', 'object_name', 'record_id']);
    const raw = dataSource.find.mock.calls.at(-1)?.[1]?.$select as string[];
    expect(raw.filter((f) => f === 'object_name')).toHaveLength(1);
  });
});
