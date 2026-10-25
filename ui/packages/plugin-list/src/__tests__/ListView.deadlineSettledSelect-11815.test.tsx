/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11815 — a list showing a declared deadline projects its
 * `settledWhen` operands.
 *
 * The grid judges each row's declared deadline with `isDeadlineSettled`
 * against the row it draws. `ListView` builds the `$select` the rows arrive
 * through, and a list showing Title and Due but not `status` fetched rows
 * without it: CEL faults `No such key`, the predicate fails, and a done row's
 * deadline still read overdue. `ObjectGrid`'s own projection gained this arm
 * in the same card; this is `ListView`'s harvest, beside its `rowColor` arm
 * (`ListView.rowColorSelect-12376.test.tsx`).
 *
 * What is pinned:
 *   - a shown declared deadline's operand is in `$select`, and with a backend
 *     that honours `$select` a done row reads neutral, an open one overdue.
 *     `plugin-grid` is not a dependency of `plugin-list` (that would be a
 *     cycle), so the grid slot is stubbed, as `ListView.viewSwitchRefetch-7394`
 *     does: the stub draws each row ListView hands it through the real date
 *     cell and the real `isDeadlineSettled`, the call `ObjectGrid` makes (its
 *     own pins live in `plugin-grid`);
 *   - CONTROL: a date that does not declare `dueLike` pulls nothing in, even
 *     with a `settledWhen` beside it;
 *   - CONTROL: an operand the viewer may not read is not requested (the FLS
 *     gate inside `addSpeculative`, objectui#7216).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

/** Same stub shape as `ListView.rowColorSelect-12376.test.tsx`. */
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
import { ComponentRegistry, isDeadlineSettled } from '@object-ui/core';
import { getCellRenderer } from '@object-ui/fields';

const OBJECT = 'task';

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const objectDef = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    title: { name: 'title', type: 'text', label: 'Title' },
    status: { name: 'status', type: 'text', label: 'Status' },
    secret_flag: { name: 'secret_flag', type: 'boolean', label: 'Secret flag' },
    deliver_by: { name: 'deliver_by', type: 'date', label: 'Deliver by', dueLike: true, settledWhen: "record.status == 'done'" },
    // Not a declared deadline: its `settledWhen` is read by nothing.
    reviewed_on: { name: 'reviewed_on', type: 'date', label: 'Reviewed on', settledWhen: "record.status == 'done'" },
    // A declared deadline whose operand the viewer may not read.
    gated_by: { name: 'gated_by', type: 'date', label: 'Gated by', dueLike: true, settledWhen: 'record.secret_flag == true' },
  },
};

const DENIED = ['secret_flag'];

const ROWS = [
  { id: 't-open', title: 'Open task', status: 'open', secret_flag: true, deliver_by: daysAgo(5), reviewed_on: daysAgo(5), gated_by: daysAgo(5) },
  { id: 't-done', title: 'Done task', status: 'done', secret_flag: true, deliver_by: daysAgo(5), reviewed_on: daysAgo(5), gated_by: daysAgo(5) },
];

/** A backend that honours `$select`: a key not asked for does not arrive. */
const makeDataSource = () =>
  ({
    find: vi.fn(async (_object: string, params: { $select?: string[] } = {}) => {
      const select = params.$select;
      const data = select
        ? ROWS.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => select.includes(k))))
        : ROWS;
      return { data, total: data.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => (name === OBJECT ? objectDef : null)),
  }) as any;

function mount(columns: string[]) {
  const dataSource = makeDataSource();
  const schema: any = { type: 'list-view', objectName: OBJECT, viewType: 'grid', columns };
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

async function selectFor(columns: string[]): Promise<string[]> {
  const dataSource = mount(columns);
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  return [...((dataSource.find.mock.calls.at(-1)?.[1]?.$select as string[] | undefined) ?? [])].sort();
}

const isRed = (text: string) => screen.getByText(text).closest('span.tabular-nums')?.className.includes('text-red-600');

let prevGrid: any;
beforeAll(() => {
  prevGrid = ComponentRegistry.get('object-grid');
  const DateCell = getCellRenderer('date');
  const def = objectDef.fields.deliver_by;
  ComponentRegistry.register('object-grid', (props: any) => (
    <div data-testid="grid-stub">
      {(props.data ?? []).map((row: Record<string, unknown>) => (
        <div key={String(row.id)}>
          <DateCell value={row.deliver_by} field={def as never} deadlineSettled={isDeadlineSettled(def, row, { fields: objectDef.fields })} />
        </div>
      ))}
    </div>
  ), { namespace: 'plugin-grid' } as never);
});
afterAll(() => {
  if (prevGrid) ComponentRegistry.register('object-grid', prevGrid);
  else ComponentRegistry.unregister('object-grid');
});

beforeEach(() => {
  vi.clearAllMocks();
  holder.current = makePerms(true, DENIED);
});
afterEach(() => cleanup());

describe("ListView — a shown declared deadline projects its `settledWhen` operands (objectui#11815)", () => {
  it('asks for `status` when the columns show the deadline but not `status`', async () => {
    expect(await selectFor(['title', 'deliver_by'])).toEqual(['deliver_by', 'id', 'status', 'title']);
  });

  it("a done row's deadline reads neutral, an open row's reads overdue", async () => {
    mount(['title', 'deliver_by']);
    await waitFor(() => expect(screen.getByText('Overdue 5d')).toBeInTheDocument());
    expect(isRed('Overdue 5d')).toBe(true);
    expect(screen.getAllByText('5 days ago')).toHaveLength(1);
    expect(isRed('5 days ago')).toBe(false);
  });

  it('CONTROL: an undeclared date pulls nothing in, even with a `settledWhen` beside it', async () => {
    expect(await selectFor(['title', 'reviewed_on'])).toEqual(['id', 'reviewed_on', 'title']);
  });

  it('CONTROL: an operand the viewer may not read is not requested', async () => {
    expect(await selectFor(['title', 'gated_by'])).toEqual(['gated_by', 'id', 'title']);
  });
});
