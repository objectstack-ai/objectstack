/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3562 — the row overflow ("⋮") trigger must be decided by the menu
 * items that will ACTUALLY render for that row, not by the handlers the schema
 * supplied.
 *
 * Bug shape: the guard asked `!onRowEdit && !onRowDelete && customActions === 0`
 * (handlers supplied), while the items were filtered a SECOND time, per item and
 * per record, against `rowEditPredicates` / `rowDeletePredicates` / a custom
 * def's `visible`. Handlers present + every item suppressed = a trigger that
 * opens an empty box — measured downstream at 128×10 with zero `[role=menu]`
 * children, which reads as a broken page.
 *
 * Predicates are per-RECORD, so the decision is per row: within one table, one
 * row can legitimately keep its menu while the next has nothing left. The
 * actions `<TableCell>` is never dropped, so the column stays aligned with its
 * header no matter which rows kept a trigger.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { DataTableSchema } from '@object-ui/types';
import { PredicateScopeProvider } from '@object-ui/react';
import { planDataTableRowMenu } from '../data-table';

/** Both rows frozen: an edit/delete gated on "not frozen" survives on neither. */
const FROZEN_ROWS = [
  { id: 'r1', name: 'Frozen A', frozen: true },
  { id: 'r2', name: 'Frozen B', frozen: true },
];
/** One frozen, one not — the mixed-column case. */
const MIXED_ROWS = [
  { id: 'r1', name: 'Frozen A', frozen: true },
  { id: 'r2', name: 'Draft B', frozen: false },
];

/** The real `userActions.edit.visibleWhen` shape (objectui#2614). */
const NOT_FROZEN = 'record.frozen != true';
/** Its `disabledWhen` counterpart — HOLDS for the frozen rows, so they grey out. */
const IS_FROZEN = 'record.frozen == true';

const BASE_SCHEMA = {
  type: 'data-table',
  pagination: false,
  searchable: false,
  // The table-level actions column: header + one cell per row. Independent of
  // whether any given row ends up with a trigger.
  rowActions: true,
  columns: [{ header: 'Name', accessorKey: 'name' }],
};

function renderTable(schema: Record<string, unknown>) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(
    <PredicateScopeProvider scope={{}}>
      <DataTable schema={{ ...BASE_SCHEMA, ...schema }} />
    </PredicateScopeProvider>,
  );
}

/** Every row overflow trigger currently in the document. */
const triggers = () => screen.queryAllByLabelText('Row actions');

/** The actions cell of each body row (always the last one here). */
function actionCells(container: HTMLElement): HTMLTableCellElement[] {
  return Array.from(container.querySelectorAll('tbody tr')).map((tr) => {
    const cells = Array.from(tr.querySelectorAll('td')) as HTMLTableCellElement[];
    return cells[cells.length - 1];
  });
}

describe('data-table row overflow menu — the trigger counts renderable items (#3562)', () => {
  it('renders NO trigger on a row whose every item is predicate-suppressed', () => {
    const { container } = renderTable({
      data: FROZEN_ROWS,
      onRowEdit: () => {},
      onRowDelete: () => {},
      rowEditPredicates: { visibleWhen: NOT_FROZEN },
      rowDeletePredicates: { visibleWhen: NOT_FROZEN },
    });

    // Handlers ARE supplied — the old guard rendered a trigger here.
    expect(triggers()).toHaveLength(0);
    // Nothing can be opened, so the empty 128×10 box has no way to exist.
    expect(screen.queryByRole('menu')).toBeNull();

    // The column survives: header plus one (empty) actions cell per row, so
    // rows stay aligned exactly as in a table with no handlers at all.
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    const cells = actionCells(container);
    expect(cells).toHaveLength(FROZEN_ROWS.length);
    for (const cell of cells) expect(cell.querySelector('button')).toBeNull();
  });

  it('keeps the trigger when only SOME items are suppressed', () => {
    renderTable({
      data: FROZEN_ROWS,
      onRowEdit: () => {},
      onRowDelete: () => {},
      // Edit is gated away on both rows; Delete is ungated and survives.
      rowEditPredicates: { visibleWhen: NOT_FROZEN },
    });
    expect(triggers()).toHaveLength(FROZEN_ROWS.length);
  });

  it('renders no trigger when no handlers are supplied (unchanged)', () => {
    renderTable({ data: MIXED_ROWS });
    expect(triggers()).toHaveLength(0);
  });

  it('renders one trigger per row for the plain Edit + Delete case (unchanged)', () => {
    renderTable({ data: MIXED_ROWS, onRowEdit: () => {}, onRowDelete: () => {} });
    expect(triggers()).toHaveLength(MIXED_ROWS.length);
  });

  it('mixes rows with and without a trigger while keeping the column aligned', () => {
    const { container } = renderTable({
      data: MIXED_ROWS,
      onRowEdit: () => {},
      rowEditPredicates: { visibleWhen: NOT_FROZEN },
    });

    // Only the non-frozen row keeps an item, so only it keeps a trigger.
    expect(triggers()).toHaveLength(1);
    const cells = actionCells(container);
    expect(cells).toHaveLength(MIXED_ROWS.length);
    // Same cell count on every row — no row is short a `<td>`.
    const widths = Array.from(container.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelectorAll('td').length,
    );
    expect(new Set(widths).size).toBe(1);
    expect(cells[0].querySelector('button')).toBeNull();
    expect(cells[1].querySelector('button')).not.toBeNull();
  });

  it('suppresses the trigger when every CUSTOM action is invisible for the row', () => {
    renderTable({
      data: FROZEN_ROWS,
      onRowActionDef: () => {},
      rowActionDefs: [
        { name: 'unfreeze', label: 'Unfreeze', visible: NOT_FROZEN },
        { name: 'publish', label: 'Publish', visible: NOT_FROZEN },
      ],
    });
    expect(triggers()).toHaveLength(0);
  });

  /**
   * The other side of #3562's rule, observed where a user meets it: a row whose
   * only item is greyed out is NOT an empty menu. `disabledWhen` is a rendering
   * verdict, not a visibility one, so the item counts, the trigger survives, and
   * what it opens is that item — present and `aria-disabled` (objectui#4354).
   *
   * End-to-end on purpose: the two halves live apart — the count in
   * `planDataTableRowMenu`, the greying in `DataTableBuiltinRowActionItem` — and
   * each half's own test stays green while the other regresses. Neither could
   * observe this pairing before: the planner's cases read its return value, and
   * the item's own cases (`data-table-builtin-row-action-predicates.test.tsx`)
   * render the item directly inside an already-open menu, never through the
   * table that decides whether a trigger exists at all.
   */
  it('keeps the trigger for a row whose only item renders merely DISABLED', async () => {
    renderTable({
      data: FROZEN_ROWS,
      onRowEdit: () => {},
      rowEditPredicates: { disabledWhen: IS_FROZEN },
    });

    // Counted: a greyed-out item is still an item, so every row keeps its "⋮".
    expect(triggers()).toHaveLength(FROZEN_ROWS.length);

    // Radix opens on `pointerdown` (a plain click does nothing) and portals its
    // content on the next tick, hence the async find.
    fireEvent.pointerDown(triggers()[0], { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const item = await screen.findByTestId('row-action-builtin-edit');
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });
});

/**
 * The item-resolution the guard counts with, exercised directly: the DOM tests
 * above pin whether a trigger exists, these pin WHICH items it would hold. Both
 * read the same `planDataTableRowMenu`, which is also what the item components
 * gate themselves on — so the trigger and its contents cannot drift apart.
 */
describe('planDataTableRowMenu', () => {
  const scope = {};
  const frozen = FROZEN_ROWS[0];
  const draft = MIXED_ROWS[1];
  const noop = () => {};

  it('counts nothing when no handlers are supplied', () => {
    const plan = planDataTableRowMenu({ customActions: [], row: draft, scope });
    expect(plan).toMatchObject({ edit: false, remove: false, count: 0 });
  });

  it('counts both built-ins when they are ungated', () => {
    const plan = planDataTableRowMenu({
      onRowEdit: noop,
      onRowDelete: noop,
      customActions: [],
      row: frozen,
      scope,
    });
    expect(plan).toMatchObject({ edit: true, remove: true, count: 2 });
  });

  it('drops only the suppressed built-in', () => {
    const plan = planDataTableRowMenu({
      onRowEdit: noop,
      onRowDelete: noop,
      editPredicates: { visibleWhen: NOT_FROZEN },
      customActions: [],
      row: frozen,
      scope,
    });
    expect(plan).toMatchObject({ edit: false, remove: true, count: 1 });
  });

  it('reaches zero when every built-in is suppressed for the row', () => {
    const args = {
      onRowEdit: noop,
      onRowDelete: noop,
      editPredicates: { visibleWhen: NOT_FROZEN },
      deletePredicates: { visibleWhen: NOT_FROZEN },
      customActions: [],
      scope,
    };
    expect(planDataTableRowMenu({ ...args, row: frozen }).count).toBe(0);
    // …and the very same table keeps both items on a row that passes.
    expect(planDataTableRowMenu({ ...args, row: draft }).count).toBe(2);
  });

  it('keeps the custom actions whose `visible` passes, in declared order', () => {
    const plan = planDataTableRowMenu({
      customActions: [
        { name: 'unfreeze', visible: 'record.frozen == true' },
        { name: 'publish', visible: NOT_FROZEN },
        { name: 'view' },
      ] as any,
      row: frozen,
      scope,
    });
    expect(plan.custom.map((a) => a.name)).toEqual(['unfreeze', 'view']);
    expect(plan.count).toBe(2);
  });

  // Renamed from "still counts an item that renders merely DISABLED"
  // (objectui#4354). The planner never reads `disabledWhen`, so this fixture
  // behaves identically to `{}` and could not pin the disabled-counting claim
  // its old name made — that claim now lives where it can actually be observed,
  // in "keeps the trigger for a row whose only item renders merely DISABLED"
  // above. What survives here is the verdict this case really does decide, and
  // it is worth deciding: a predicate object is not itself a gate.
  it('an object with no `visibleWhen` does not hide the item', () => {
    // Typed as what the production caller actually hands the planner —
    // `schema.rowEditPredicates`, whose declared shape carries `disabledWhen`
    // alongside `visibleWhen` (`@object-ui/types`, objectui#2614). The planner's
    // own parameter is now `Pick`ed from that same key rather than hand-restated
    // (#4354), so it stays the deliberate `visibleWhen`-only subset: a bare
    // object literal still trips excess-property checking, while the identical
    // value reaches it unremarked in production (objectui#4040). Annotating from
    // the authoring type keeps the fixture honest about which key is ignored.
    const editPredicates: DataTableSchema['rowEditPredicates'] = {
      disabledWhen: IS_FROZEN,
    };
    const plan = planDataTableRowMenu({
      onRowEdit: noop,
      editPredicates,
      customActions: [],
      row: frozen,
      scope,
    });
    expect(plan).toMatchObject({ edit: true, count: 1 });
  });

  it('fails CLOSED on a faulting predicate (no phantom item, no phantom trigger)', () => {
    const plan = planDataTableRowMenu({
      onRowEdit: noop,
      editPredicates: { visibleWhen: 'record.frozen ==' },
      customActions: [],
      row: frozen,
      scope,
    });
    expect(plan).toMatchObject({ edit: false, count: 0 });
  });
});

/**
 * objectui#3758 reaching the guard: `planDataTableRowMenu` counts with the same
 * `isCustomRowActionVisible` the item gates itself on, so correcting the gate
 * propagates to whether the row gets a "⋮" at all — no separate change, and no
 * way for the trigger and its contents to disagree about a boolean `visible`.
 */
describe('planDataTableRowMenu — declared boolean `visible` (objectui#3758)', () => {
  const scope = {};
  const row = MIXED_ROWS[1];

  it('drops a custom action declaring `visible: false`, reaching zero items', () => {
    const plan = planDataTableRowMenu({
      customActions: [{ name: 'ghost', visible: false }] as any,
      row,
      scope,
    });
    expect(plan.custom).toEqual([]);
    expect(plan.count).toBe(0);
  });

  // Keeps the assertion above from passing for the empty reason: a gate
  // rewritten to "always hide" would also reach `count: 0`.
  it('keeps a custom action declaring `visible: true` — declaration detection, not "always hide"', () => {
    const plan = planDataTableRowMenu({
      customActions: [{ name: 'always', visible: true }] as any,
      row,
      scope,
    });
    expect(plan.custom.map((a) => a.name)).toEqual(['always']);
    expect(plan.count).toBe(1);
  });

  it('treats an empty-string `visible` as no gate at all, matching `hasVisibilityGate`', () => {
    const plan = planDataTableRowMenu({
      customActions: [{ name: 'compiled_away', visible: '' }] as any,
      row,
      scope,
    });
    expect(plan.custom.map((a) => a.name)).toEqual(['compiled_away']);
    expect(plan.count).toBe(1);
  });
});
