/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12393 — a grid that fetches for itself projects its row colour's
 * field.
 *
 * `useRowColor` paints a row from `row[rowColor.field]`, and the spec sets no
 * column requirement on that field. `ObjectGrid`'s own `$select`
 * (`getSelectFields`) unioned the columns, the predicate operands, the
 * grouping fields and the concurrency token, with no arm for the row colour,
 * so a grid tinted by a field no column shows fetched rows without it and
 * painted nothing, with no error. `ListView`'s harvest gained the same arm in
 * objectui#12376 (`ListView.rowColorSelect-12376.test.tsx`); this is the
 * grid's own build site, the one a standalone `object-grid` and a grouped grid
 * that owns its fetch both go through. The grouped grid under `ListView` and
 * the family enumeration are pinned in plugin-list's
 * `ListView.gridRowColorSelect-12393.test.tsx`.
 *
 * What is pinned:
 *   - a non-column `rowColor.field` is in `$select`, and the row is tinted;
 *   - a field the principal may not read is not requested, nor is a name the
 *     object does not declare (the gates every other harvested field takes);
 *   - a field that is a column is sent once;
 *   - a server-grouped grid's group row pages carry it;
 *   - a rule naming a new field re-reads the rows, and a change to the
 *     `colors` map alone does not.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
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
import { registerAllFields } from '@object-ui/fields';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'crm_case';

const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  subject: { type: 'text', label: 'Subject' },
  region: { type: 'text', label: 'Region' },
  is_escalated: { type: 'boolean', label: 'Escalated' },
  priority: { type: 'text', label: 'Priority' },
  secret_flag: { type: 'boolean', label: 'Secret flag' },
};

const ROWS: Array<Record<string, unknown>> = [
  { id: 'c1', subject: 'Printer on fire', region: 'north', is_escalated: true, priority: 'high', secret_flag: true },
  { id: 'c2', subject: 'Password reset', region: 'north', is_escalated: false, priority: 'low', secret_flag: false },
];

/**
 * Answers the group header query and pages rows, and honours `$select` the way
 * a server does: a row carries the selected keys only. So a field left out of
 * the projection is really absent from the row the grid paints.
 */
const makeDataSource = () => ({
  queryGroupHeaders: vi.fn(async () => [{ region: 'north', count: ROWS.length }]),
  find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
    const select = params.$select as string[] | undefined;
    const data = ROWS.map((row) =>
      select ? Object.fromEntries(select.filter((k) => k in row).map((k) => [k, row[k]])) : { ...row },
    );
    return { data, total: data.length };
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
});

type Ds = ReturnType<typeof makeDataSource>;

/**
 * One array for every render: the fetch effect names `columns` by identity,
 * so a fresh literal per render would re-read the rows for a reason that has
 * nothing to do with the row colour.
 */
const COLUMNS = ['subject'];

const node = (extra: Record<string, unknown>) =>
  ({ type: 'object-grid', objectName: OBJECT, columns: COLUMNS, ...extra }) as unknown as ObjectGridSchema;

const renderGrid = (ds: Ds, extra: Record<string, unknown>) =>
  render(
    <ActionProvider>
      <ObjectGrid schema={node(extra)} dataSource={ds as unknown as DataSource} />
    </ActionProvider>,
  );

const lastSelect = (ds: Ds) => [...((ds.find.mock.calls.at(-1)?.[1]?.$select as string[] | undefined) ?? [])].sort();

const ESCALATED = { field: 'is_escalated', colors: { true: 'red' } };

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = ['secret_flag'];
});
afterEach(() => cleanup());

describe('ObjectGrid — a row colour on a non-column field is projected (objectui#12393)', () => {
  it('asks for `rowColor.field` when no column shows it, and tints the matching row', async () => {
    const ds = makeDataSource();
    renderGrid(ds, { rowColor: ESCALATED });
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastSelect(ds)).toEqual(['id', 'is_escalated', 'subject']);

    // The end the projection exists for: the row whose field matches a
    // `colors` key carries the tint, and the other does not.
    const tinted = (await screen.findByText('Printer on fire')).closest('tr');
    const plain = screen.getByText('Password reset').closest('tr');
    // `red` resolves to the `--color-red-100` tint (`useRowColor`); an
    // untinted row sets the property to `transparent` instead.
    expect(tinted?.className).toContain('var(--color-red-100)');
    expect(plain?.className ?? '').not.toContain('var(--color-red-100)');
  });

  it('control: a `rowColor.field` that is a column is sent once', async () => {
    const ds = makeDataSource();
    renderGrid(ds, { columns: ['subject', 'is_escalated'], rowColor: ESCALATED });
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastSelect(ds)).toEqual(['id', 'is_escalated', 'subject']);
  });

  it('does not request a `rowColor.field` the principal may not read', async () => {
    const ds = makeDataSource();
    renderGrid(ds, { rowColor: { field: 'secret_flag', colors: { true: 'red' } } });
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastSelect(ds)).toEqual(['id', 'subject']);
  });

  it('does not send a `rowColor.field` the object does not declare', async () => {
    const ds = makeDataSource();
    renderGrid(ds, { rowColor: { field: 'no_such_field', colors: { x: 'red' } } });
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastSelect(ds)).toEqual(['id', 'subject']);
  });

  it('a server-grouped grid asks for it on every group row page', async () => {
    const ds = makeDataSource();
    renderGrid(ds, {
      rowColor: ESCALATED,
      grouping: { fields: [{ field: 'region', order: 'asc', collapsed: false }] },
    });
    await vi.waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalled());
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    for (const [, params] of ds.find.mock.calls) {
      expect([...(params.$select as string[])].sort()).toEqual(['id', 'is_escalated', 'region', 'subject']);
    }
    const tinted = (await screen.findByText('Printer on fire')).closest('tr');
    expect(tinted?.className).toContain('var(--color-red-100)');
  });

  // The fetch effect names the rule's FIELD (`rowColorField`), so a host that
  // replaces the rule on a mounted grid gets the new field fetched; the
  // `colors` map is a render-time concern and costs no request.
  it('re-reads the rows when the rule names a new field, and not when only its colours change', async () => {
    const ds = makeDataSource();
    const view = renderGrid(ds, { rowColor: ESCALATED });
    await vi.waitFor(() => expect(lastSelect(ds)).toEqual(['id', 'is_escalated', 'subject']));
    const callsAfterMount = ds.find.mock.calls.length;

    view.rerender(
      <ActionProvider>
        <ObjectGrid
          schema={node({ rowColor: { field: 'is_escalated', colors: { true: 'orange' } } })}
          dataSource={ds as unknown as DataSource}
        />
      </ActionProvider>,
    );
    // Give a stray re-run the chance to land before reading the count.
    await new Promise((r) => setTimeout(r, 50));
    expect(ds.find.mock.calls.length).toBe(callsAfterMount);

    view.rerender(
      <ActionProvider>
        <ObjectGrid
          schema={node({ rowColor: { field: 'priority', colors: { high: 'red' } } })}
          dataSource={ds as unknown as DataSource}
        />
      </ActionProvider>,
    );
    await vi.waitFor(() => expect(lastSelect(ds)).toEqual(['id', 'priority', 'subject']));
  });
});
