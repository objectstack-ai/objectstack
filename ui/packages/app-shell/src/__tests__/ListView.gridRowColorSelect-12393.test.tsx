/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12393 — the grid half of objectui#12376, and the family pin.
 *
 * plugin-list's `ListView.rowColorSelect-12376.test.tsx` pins `ListView`'s own `$select`
 * asking for a non-column `rowColor.field`. That projection does not reach
 * every row the list draws: a GROUPED grid over a data source that answers the
 * group header query owns its fetch (`gridOwnsGroupedFetch`), and its rows
 * arrive through `ObjectGrid`'s own `$select`, which had no row-colour arm. So
 * a grouped list tinted by a field no column shows painted nothing.
 *
 * Both blocks below take the same two steps, with a stub `object-grid`
 * registered over whatever the registry holds (the `@object-ui/plugin-grid`
 * import registers the real one; `afterAll` puts it back):
 *   1. mount `ListView` with a stub `object-grid` and keep the node it hands
 *      the grid, and the `$select` of its own window fetch;
 *   2. render the real `ObjectGrid` with that node, and read the `$select` of
 *      the group row pages it asks for.
 * The registry glue between the two (`ObjectGridRenderer`, the element
 * data-source gate) is not exercised here; plugin-grid's own tests pin it.
 *
 * THE FAMILY PIN. Each binding `ListView` adds to its `$select` (the columns,
 * the grouping fields, the row colour, the predicate operands, the
 * concurrency token, the view-kind bindings) has to be added by `ObjectGrid`
 * as well when the grid owns the fetch, or the grouped grid draws the binding
 * from an absent key. The pin feeds one binding of every arm, then compares
 * the two projections. The difference has to be exactly
 * `NOT_GRID_BINDINGS`, an explicit allow-list: today the other view kinds'
 * blocks only, which the grid never draws.
 *
 * ⚠️ The bound, said per AGENTS.md #9: the pin sees only the inputs it feeds.
 * A new arm in `ListView`'s harvest that reads a key this fixture does not
 * carry is invisible to it until a row is added to `FULL_VIEW`.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';

/**
 * One stub, swapped by nothing: `ListView` and `ObjectGrid` both name `perms`
 * in effect dependencies, so its identity has to hold.
 */
const { permsStub } = vi.hoisted(() => ({
  permsStub: {
    isLoaded: true,
    checkField: () => true,
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
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider, ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
// Both components by package name. This file lives in app-shell because
// app-shell declares both packages; plugin-list declares no dependency on
// plugin-grid (it renders the grid through the registry). It used to sit in
// plugin-list and reach the grid by a relative path, so plugin-list's
// type-check compiled `ObjectGrid` and its `@object-ui/plugin-detail` import
// without any declared edge ordering that build first (objectui#12422).
import { ListView } from '@object-ui/plugin-list';
import { ObjectGrid } from '@object-ui/plugin-grid';

const OBJECT = 'crm_case';

/**
 * One declared field per arm of the harvest, so a field missing from one
 * projection names the arm that dropped it.
 */
const objectDef = {
  name: OBJECT,
  label: 'Case',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    // grouping
    region: { name: 'region', type: 'text', label: 'Region' },
    // rowColor
    tier: { name: 'tier', type: 'text', label: 'Tier' },
    // conditionalFormatting
    score: { name: 'score', type: 'number', label: 'Score' },
    // rowActionDefs (`visible` and `recordIdField`)
    owner: { name: 'owner', type: 'text', label: 'Owner' },
    case_ref: { name: 'case_ref', type: 'text', label: 'Case ref' },
    // bulkActionDefs
    status: { name: 'status', type: 'text', label: 'Status' },
    // the object's own actions
    approver: { name: 'approver', type: 'text', label: 'Approver' },
    // the object's CRUD predicates (`userActions`)
    locked: { name: 'locked', type: 'boolean', label: 'Locked' },
    // the other view kinds' blocks
    stage: { name: 'stage', type: 'text', label: 'Stage' },
    due_date: { name: 'due_date', type: 'date', label: 'Due' },
  },
  actions: [{ name: 'approve', label: 'Approve', locations: ['list_item'], visible: "record.approver == 'u1'" }],
  userActions: { edit: { visibleWhen: 'record.locked != true' } },
};

const ROWS: Array<Record<string, unknown>> = [
  { id: 'c1', subject: 'Printer on fire', region: 'north', tier: 'gold', score: 9, owner: 'u1', case_ref: 'R1', status: 'open', approver: 'u1', locked: false, stage: 'new', due_date: '2026-10-01', updated_at: '2026-10-01T00:00:00Z' },
  { id: 'c2', subject: 'Password reset', region: 'north', tier: 'bronze', score: 1, owner: 'u2', case_ref: 'R2', status: 'open', approver: 'u2', locked: false, stage: 'new', due_date: '2026-10-02', updated_at: '2026-10-02T00:00:00Z' },
];

/**
 * Answers the group header query (so the grouped grid owns its fetch) and
 * honours `$select` the way a server does: each row carries the selected keys
 * only.
 */
const makeDataSource = () =>
  ({
    queryGroupHeaders: vi.fn(async () => [{ region: 'north', count: ROWS.length }]),
    find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
      const select = params?.$select as string[] | undefined;
      const data = ROWS.map((row) =>
        select ? Object.fromEntries(select.filter((k) => k in row).map((k) => [k, row[k]])) : { ...row },
      );
      return { data, total: data.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  }) as any;

const GROUPING = { fields: [{ field: 'region', order: 'asc', collapsed: false }] };
const ROW_COLOR = { field: 'tier', colors: { gold: 'yellow' } };

/** A grouped grid view tinted by `tier`, which no column shows. */
const TINTED_VIEW = {
  columns: ['subject'],
  grouping: GROUPING,
  rowColor: ROW_COLOR,
};

/** One binding of every arm of `ListView`'s harvest. */
const FULL_VIEW = {
  ...TINTED_VIEW,
  conditionalFormatting: [{ condition: 'record.score > 5', style: { backgroundColor: '#fee2e2' } }],
  rowActionDefs: [{ name: 'escalate', label: 'Escalate', visible: "record.owner == 'u1'", recordIdField: 'case_ref' }],
  bulkActionDefs: [{ name: 'archive', label: 'Archive', disabled: "record.status == 'closed'" }],
  inlineEdit: true,
  kanban: { groupByField: 'stage' },
  calendar: { startDateField: 'due_date' },
};

/** Every binding above the grid draws, by the field it names. */
const GRID_BINDINGS = {
  column: 'subject',
  grouping: 'region',
  rowColor: 'tier',
  conditionalFormatting: 'score',
  rowActionDefsVisible: 'owner',
  rowActionDefsRecordIdField: 'case_ref',
  bulkActionDefs: 'status',
  objectActions: 'approver',
  objectUserActions: 'locked',
  concurrencyToken: 'updated_at',
} as const;

/**
 * The allow-list: bindings `ListView` adds to `$select` that `ObjectGrid`
 * does not, each with the reason it is not a gap.
 */
const NOT_GRID_BINDINGS: Record<string, string> = {
  // `ListView` collects the kanban, calendar, gallery, timeline, gantt and map
  // blocks into its projection whatever the current view, so a view that can
  // switch kinds fetches their fields on the grid too. The grid draws none of
  // them, so it owes them nothing.
  stage: 'kanban.groupByField: another view kind',
  due_date: 'calendar.startDateField: another view kind',
};

let lastGridProps: any = null;
let prevObjectGrid: any;
beforeAll(() => {
  registerAllFields();
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
beforeEach(() => {
  vi.clearAllMocks();
  lastGridProps = null;
});
afterEach(() => cleanup());

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

/**
 * Step 1: mount the list view and return the node it hands the grid, and the
 * `$select` of its own window fetch.
 */
async function listViewHandOff(view: Record<string, unknown>) {
  const ds = makeDataSource();
  const schema: any = { type: 'list-view', objectName: OBJECT, viewType: 'grid', ...view };
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema} dataSource={ds} />
    </SchemaRendererProvider>,
  );
  // The projection reads the object's definition: wait for a request built
  // with it, and for the node to carry the grouping that hands the fetch over.
  await waitFor(() => expect(ds.find.mock.calls.at(-1)?.[1]?.$select ?? []).toContain('region'));
  await waitFor(() => expect(lastGridProps?.schema?.grouping).toBeTruthy());
  await settle();
  expect(lastGridProps.data, 'the grouped grid has to own its fetch: no rows handed down').toBeUndefined();
  const node = lastGridProps.schema;
  const listSelect = [...(ds.find.mock.calls.at(-1)?.[1]?.$select as string[])].sort();
  cleanup();
  return { node, listSelect };
}

/** Step 2: render the real grid with that node; return its group pages' `$select`. */
async function gridGroupSelect(node: any) {
  const ds = makeDataSource();
  render(
    <ActionProvider>
      <ObjectGrid schema={node} dataSource={ds} />
    </ActionProvider>,
  );
  await waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalled());
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  await settle();
  const selects = ds.find.mock.calls.map((call: any[]) => [...(call[1]?.$select as string[])].sort());
  // Every group row page asks with the same projection.
  for (const s of selects) expect(s).toEqual(selects[0]);
  return selects[0] as string[];
}

describe('ListView → grouped grid: the row colour reaches the grid\'s own fetch (objectui#12393)', () => {
  it('a grouped grid tinted by a non-column field asks for it on its group pages, and tints the row', async () => {
    const { node, listSelect } = await listViewHandOff(TINTED_VIEW);
    // objectui#12376's half: the list's own window fetch already asks for it.
    expect(listSelect).toContain('tier');
    expect(node.rowColor).toEqual(ROW_COLOR);

    const gridSelect = await gridGroupSelect(node);
    expect(gridSelect).toEqual(expect.arrayContaining(['id', 'region', 'subject', 'tier']));
    const tinted = (await screen.findByText('Printer on fire')).closest('tr');
    const plain = screen.getByText('Password reset').closest('tr');
    // `yellow` resolves to the `--color-yellow-100` tint (`useRowColor`).
    expect(tinted?.className).toContain('var(--color-yellow-100)');
    expect(plain?.className ?? '').not.toContain('var(--color-yellow-100)');
  });
});

describe('the `$select` family: what ListView asks for, the grid asks for when it owns the fetch (objectui#12393)', () => {
  it('every grid binding ListView projects, ObjectGrid projects too; the difference is the allow-list', async () => {
    const { node, listSelect } = await listViewHandOff(FULL_VIEW);

    // The fixture exercises every arm: each binding is in the list's
    // projection, or the comparison below proves nothing about it.
    for (const [arm, field] of Object.entries(GRID_BINDINGS)) {
      expect(listSelect, `fixture: ListView did not project the ${arm} binding \`${field}\``).toContain(field);
    }
    for (const field of Object.keys(NOT_GRID_BINDINGS)) {
      expect(listSelect, `fixture: ListView did not project the allow-listed \`${field}\``).toContain(field);
    }

    const gridSelect = await gridGroupSelect(node);
    const missing = listSelect.filter((f) => !gridSelect.includes(f));
    expect(
      missing,
      'A field ListView asks for and the grid, owning the fetch, does not. A grouped grid draws '
        + 'that binding from an absent key. Give `ObjectGrid`\'s `getSelectFields` the arm, or, if '
        + 'the grid never draws it, add it to NOT_GRID_BINDINGS with the reason.',
    ).toEqual(Object.keys(NOT_GRID_BINDINGS).sort());
  });
});
