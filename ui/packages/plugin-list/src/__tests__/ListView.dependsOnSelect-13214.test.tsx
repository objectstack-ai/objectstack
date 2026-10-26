/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13214 — a list asks for a shown column's declared `dependsOn`
 * siblings.
 *
 * A faced column reads its siblings off the ROW the grid hands it as
 * `dependentValues`: the `recipient-picker` face (objectui#12613) names a
 * stored id by the row's `recipient_type`, and draws the stored text when the
 * kind is absent. `ListView`'s `$select` builder had no arm for those siblings,
 * so the Record Shares views whose columns show `recipient_id` but not
 * `recipient_type` fetched rows without the kind and drew the raw user id.
 *
 * This file pins `ListView`'s own fetch. A grouped grid that owns its fetch
 * projects through `ObjectGrid`'s `getSelectFields`, pinned with the real grid
 * and a face in plugin-grid's `ObjectGrid.dependsOnSelect-13214.test.tsx`.
 * plugin-list does not depend on plugin-grid, so a stub grid stands in here
 * and the rows it is handed are read for the sibling the face reads.
 *
 * What is pinned:
 *   - a non-column `dependsOn` sibling is in `$select`, and every row handed to
 *     the grid carries it;
 *   - control: a column authored `hidden: true` pulls nothing;
 *   - control: a `dependsOn` name the object does not declare is not sent;
 *   - a sibling the viewer may not read is not requested, and a column the
 *     viewer may not read pulls nothing;
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
import { ListView } from '../ListView';

const OBJECT = 'sys_record_share';

const objectDef = {
  name: OBJECT,
  label: 'Record Share',
  fields: {
    id: { name: 'id', type: 'text' },
    object_name: { name: 'object_name', type: 'text', label: 'Object' },
    recipient_type: { name: 'recipient_type', type: 'text', label: 'Recipient Type' },
    recipient_id: {
      name: 'recipient_id',
      type: 'text',
      label: 'Recipient',
      widget: 'recipient-picker',
      dependsOn: ['recipient_type'],
    },
    // A field whose `dependsOn` names a sibling the object does not declare.
    loose_id: { name: 'loose_id', type: 'text', label: 'Loose', dependsOn: ['no_such_field'] },
  },
};

const ROW = { id: 'sh-1', object_name: 'crm_account', recipient_type: 'user', recipient_id: 'usr_1', loose_id: 'x-1' };

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

async function mount(columns: unknown[]) {
  const dataSource = makeDataSource([ROW]);
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

beforeEach(() => {
  vi.clearAllMocks();
  lastGridProps = null;
  holder.current = makePerms(true, []);
});
afterEach(() => {
  cleanup();
  lastGridProps = null;
});

describe('ListView — a shown column asks for its declared `dependsOn` siblings (objectui#13214)', () => {
  it('asks for `recipient_type` when the columns omit it, and the rows carry the kind', async () => {
    const { select } = await mount(['object_name', 'recipient_id']);
    expect(select).toEqual(['id', 'object_name', 'recipient_id', 'recipient_type']);
    const [row] = await gridRows();
    expect(row).toMatchObject({ recipient_type: 'user', recipient_id: 'usr_1' });
  });

  it('control: a column authored `hidden: true` pulls nothing', async () => {
    const { select } = await mount([{ field: 'object_name' }, { field: 'recipient_id', hidden: true }]);
    expect(select).not.toContain('recipient_type');
  });

  it('control: a `dependsOn` name the object does not declare is not sent', async () => {
    const { select } = await mount(['object_name', 'loose_id']);
    expect(select).toEqual(['id', 'loose_id', 'object_name']);
  });

  it('does not request a sibling the viewer may not read', async () => {
    holder.current = makePerms(true, ['recipient_type']);
    const { select } = await mount(['object_name', 'recipient_id']);
    expect(select).toEqual(['id', 'object_name', 'recipient_id']);
  });

  it('a column the viewer may not read pulls nothing', async () => {
    holder.current = makePerms(true, ['recipient_id']);
    const { select } = await mount(['object_name', 'recipient_id']);
    expect(select).toEqual(['id', 'object_name']);
  });

  it('control: a sibling that is a column is sent once', async () => {
    const { dataSource } = await mount(['object_name', 'recipient_type', 'recipient_id']);
    const raw = dataSource.find.mock.calls.at(-1)?.[1]?.$select as string[];
    expect(raw.filter((f) => f === 'recipient_type')).toHaveLength(1);
  });
});
