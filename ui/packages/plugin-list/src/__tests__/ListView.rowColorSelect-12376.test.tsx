/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12376 — a list tinted by a field projects that field.
 *
 * `ListView`'s `$select` builder adds the view bindings, the grouping fields
 * and the predicate operands to the columns, each through `addSpeculative`.
 * It had no arm for `rowColor.field`, and the spec's `ListViewSchema.rowColor`
 * sets no column requirement on it. A list whose `rowColor.field` is not a
 * column therefore fetched rows without that field, and `useRowColor`, which
 * looks `row[field]` up in the `colors` map, painted no row — no error, no
 * warning. The twin of objectui#10370 (the same harvest's `map` arm, pinned in
 * `ListView.mapLocationSelect-10370.test.tsx`).
 *
 * What is pinned:
 *   - a non-column `rowColor.field` is in `$select`;
 *   - a field the viewer may not read is not (the FLS gate inside
 *     `addSpeculative`, objectui#7216), nor is a name the object does not
 *     declare;
 *   - the projection reads `rowColorConfig`, the state a toolbar pick
 *     replaces. The fetch effect does not re-run on a pick: both pickers
 *     offer the columns only, which every request already carries; the last
 *     row pins that premise.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';

/**
 * Same stub shape as `ListView.mapLocationSelect-10370.test.tsx`: swapped by
 * IDENTITY, because the fetch effect names `perms` in its dependency list.
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

import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

const OBJECT = 'crm_case';

const objectDef = {
  name: OBJECT,
  label: 'Case',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    is_sla_violated: { name: 'is_sla_violated', type: 'boolean', label: 'SLA violated' },
    is_escalated: { name: 'is_escalated', type: 'boolean', label: 'Escalated' },
    secret_flag: { name: 'secret_flag', type: 'boolean', label: 'Secret flag' },
  },
};

/** Fields the principal may NOT read. */
const DENIED = ['secret_flag'];

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => (name === OBJECT ? objectDef : null)),
  }) as any;

function mount(schemaExtra: Record<string, unknown>) {
  const dataSource = makeDataSource();
  const schema: any = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: ['subject'],
    ...schemaExtra,
  };
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema }} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

/** Mount a list view and return the params of the LAST request it sent. */
async function paramsFor(schemaExtra: Record<string, unknown>): Promise<Record<string, unknown>> {
  const dataSource = mount(schemaExtra);
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  return (dataSource.find.mock.calls.at(-1)?.[1] ?? {}) as Record<string, unknown>;
}

const sorted = (v: unknown) => [...((v as string[] | undefined) ?? [])].sort();

beforeEach(() => {
  vi.clearAllMocks();
  holder.current = makePerms(true, DENIED);
});
afterEach(() => cleanup());

describe('ListView — a row colour on a non-column field is projected (objectui#12376)', () => {
  it('projects `rowColor.field` when the columns omit it', async () => {
    const params = await paramsFor({ rowColor: { field: 'is_sla_violated', colors: { true: 'red' } } });
    expect(sorted(params.$select)).toEqual(['id', 'is_sla_violated', 'subject']);
  });

  it('control: a `rowColor.field` that is a column is sent once', async () => {
    const params = await paramsFor({
      columns: ['subject', 'is_sla_violated'],
      rowColor: { field: 'is_sla_violated', colors: { true: 'red' } },
    });
    expect(sorted(params.$select)).toEqual(['id', 'is_sla_violated', 'subject']);
  });

  it('does not request a `rowColor.field` the viewer may not read', async () => {
    const params = await paramsFor({ rowColor: { field: 'secret_flag', colors: { true: 'red' } } });
    expect(sorted(params.$select)).toEqual(['id', 'subject']);
  });

  it('does not send a `rowColor.field` the object does not declare', async () => {
    const params = await paramsFor({ rowColor: { field: 'no_such_field', colors: { x: 'red' } } });
    expect(sorted(params.$select)).toEqual(['id', 'subject']);
  });

  // Why the fetch effect does not name the rule: both Color pickers offer the
  // COLUMNS only, which every request already carries, so a pick needs no new
  // request. Should a picker ever offer a non-column field, this row turns red
  // and the dependency list beside the harvest arm has to name the rule.
  it('the toolbar Color picker offers the columns only, so a pick needs no refetch', async () => {
    const dataSource = mount({
      userActions: { rowColor: true },
      rowColor: { field: 'is_sla_violated', colors: { true: 'red' } },
    });
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^color/i }));
    const trigger = await screen.findByTestId('color-field-select');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    const labels = within(listbox).getAllByRole('option').map((o) => o.textContent);
    // The rule in force as the outside value, which re-picking writes nothing
    // for (`ListView.sharedSelect-11865.test.tsx`), "None", and one entry per
    // column (`subject` is the only one; a string column is labelled by its
    // name here). No other object field: `is_escalated` is not offered.
    expect(labels).toEqual(['is_sla_violated', 'None', 'subject']);
  });
});
