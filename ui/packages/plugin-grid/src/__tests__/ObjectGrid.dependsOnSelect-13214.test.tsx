/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13214 — a grid that fetches for itself asks for a shown column's
 * declared `dependsOn` siblings.
 *
 * A faced column reads its siblings off the ROW the grid hands it as
 * `dependentValues`: the `recipient-picker` face (objectui#12613) names a
 * stored id by the row's `recipient_type`, and draws the stored text when the
 * kind is absent. `getSelectFields` had no arm for those siblings, so a grid
 * whose columns show `recipient_id` but not `recipient_type` fetched rows
 * without the kind and drew the raw user id. This is the projection a
 * standalone `object-grid` and a grouped grid that owns its fetch send;
 * `ListView`'s own fetch is pinned in plugin-list's
 * `ListView.dependsOnSelect-13214.test.tsx`.
 *
 * The console's real face lives in `@object-ui/app-shell`, which this package
 * does not depend on, so a face reading the same sibling against a stubbed
 * directory is registered under the same key for this file and restored after.
 *
 * What is pinned:
 *   - a non-column `dependsOn` sibling is in `$select`, and the face names the
 *     recipient by its kind instead of drawing the raw id;
 *   - control: a column authored `hidden: true` pulls nothing;
 *   - control: a `dependsOn` name the object does not declare is not sent;
 *   - a sibling the principal may not read is not requested;
 *   - a sibling that is a column is sent once.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

/** Stable stub identity: `ObjectGrid` carries `perms` in memo dep arrays. */
const { permsStub, state } = vi.hoisted(() => {
  const state: { denied: string[] } = { denied: [] };
  return {
    state,
    permsStub: {
      isLoaded: true,
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? !state.denied.includes(field) : true,
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
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields, registerFieldRenderer, getCellRenderer, type CellRendererProps } from '@object-ui/fields';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

const OBJECT = 'sys_record_share';

const SHARE_FIELDS = {
  id: { name: 'id', type: 'text', label: 'Id' },
  object_name: { name: 'object_name', type: 'text', label: 'Object' },
  recipient_type: { name: 'recipient_type', type: 'text', label: 'Recipient Type' },
  recipient_id: {
    name: 'recipient_id',
    type: 'text',
    label: 'Recipient',
    widget: 'recipient-picker',
    dependsOn: ['recipient_type'],
  },
  // A faced field whose `dependsOn` names a sibling the object does not declare.
  loose_id: { name: 'loose_id', type: 'text', label: 'Loose', dependsOn: ['no_such_field'] },
};

/** The stubbed directory: the label a kind's id names. */
const DIRECTORY: Record<string, Record<string, string>> = {
  user: { usr_1: 'Ada Lovelace' },
};

/** Reads the kind off `dependentValues`, as the console's face does; the stored text without it. */
function StubRecipientFace({ value, dependentValues }: CellRendererProps) {
  const kind = String(dependentValues?.recipient_type ?? '');
  const label = DIRECTORY[kind]?.[String(value)];
  return label ? <span data-recipient-face="named">{label}</span> : <span>{String(value ?? '')}</span>;
}

let prevRecipientRenderer: React.FC<CellRendererProps>;
beforeAll(() => {
  registerAllFields();
  prevRecipientRenderer = getCellRenderer('recipient-picker');
  registerFieldRenderer('recipient-picker', StubRecipientFace);
});
afterAll(() => {
  registerFieldRenderer('recipient-picker', prevRecipientRenderer);
});

/** Honours `$select` the way a server does: a row carries the selected keys only. */
const makeDataSource = (rows: Array<Record<string, unknown>>) => ({
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
  getObjectSchema: vi.fn(async (name: string) => {
    if (name === OBJECT) return { name: OBJECT, label: 'Record Share', fields: SHARE_FIELDS };
    throw new Error('unknown object');
  }),
});

type Ds = ReturnType<typeof makeDataSource>;

const ROW = { id: 'sh-1', object_name: 'crm_account', recipient_type: 'user', recipient_id: 'usr_1', loose_id: 'x-1' };

/** One array per column set: the fetch effect names `columns` by identity. */
const RECIPIENT_ONLY = ['object_name', 'recipient_id'];
const BOTH = ['object_name', 'recipient_type', 'recipient_id'];
const HIDDEN_RECIPIENT = [{ field: 'object_name' }, { field: 'recipient_id', hidden: true }];
const LOOSE = ['object_name', 'loose_id'];

const renderGrid = (ds: Ds, extra: Record<string, unknown>) =>
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: OBJECT, ...extra } as unknown as ObjectGridSchema}
        dataSource={ds as unknown as DataSource}
      />
    </ActionProvider>,
  );

/** The last `$select` the grid sent for its own rows, sorted. */
const lastSelect = (ds: Ds) =>
  [...((ds.find.mock.calls.at(-1)?.[1]?.$select as string[] | undefined) ?? [])].sort();

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = [];
});
afterEach(() => cleanup());

describe('ObjectGrid — a shown column asks for its declared `dependsOn` siblings (objectui#13214)', () => {
  it('asks for `recipient_type` when no column shows it, and the face names the recipient', async () => {
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: RECIPIENT_ONLY });
    expect(await screen.findByText('Ada Lovelace')).toHaveAttribute('data-recipient-face', 'named');
    expect(lastSelect(ds)).toEqual(['id', 'object_name', 'recipient_id', 'recipient_type']);
    expect(screen.queryByText('usr_1')).toBeNull();
  });

  it('control: a column authored `hidden: true` pulls nothing', async () => {
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: HIDDEN_RECIPIENT });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(lastSelect(ds)).not.toContain('recipient_type'));
  });

  it('control: a `dependsOn` name the object does not declare is not sent', async () => {
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: LOOSE });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(lastSelect(ds)).toEqual(['id', 'loose_id', 'object_name']));
  });

  it('does not request a sibling the principal may not read; the face draws the stored text', async () => {
    state.denied = ['recipient_type'];
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: RECIPIENT_ONLY });
    await waitFor(() => expect(screen.getByText('usr_1')).toBeInTheDocument());
    expect(lastSelect(ds)).toEqual(['id', 'object_name', 'recipient_id']);
  });

  it('control: a sibling that is a column is sent once', async () => {
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: BOTH });
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    const raw = ds.find.mock.calls.at(-1)?.[1]?.$select as string[];
    expect(raw.filter((f) => f === 'recipient_type')).toHaveLength(1);
  });
});
