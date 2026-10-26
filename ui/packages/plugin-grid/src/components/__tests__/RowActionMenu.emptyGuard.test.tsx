/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3562 — the row "⋮" trigger must be decided by the items that will
 * ACTUALLY render for that row, not by the handlers wired or the actions
 * declared.
 *
 * This is the reporter's own screen. The console object list (all three list
 * callers converge on `ObjectGrid`, which injects its own `_actions` column and
 * renders THIS component in the cell — it never passes `onRowEdit`/`onRowDelete`
 * to data-table) showed a "⋮" on every `sys_approval_request` row that opened a
 * 128×10 box with zero `[role=menu]` children. The guard read
 * `(canEdit && onEdit) || (canDelete && onDelete) || menuDefs.length > 0 || rowActions.length > 0`
 * — handlers and DECLARATIONS — while the items were filtered a second time, per
 * item and per record, by `visibleWhen` / `visible`. The object's `list_item`
 * actions (approve / reject / recall) are gated for approvers, so an admin in the
 * "全部" view failed every one of them row by row: guard true, zero items.
 *
 * That this component renders no separators at all is why the reporter measured
 * exactly 0 children rather than a stray rule — see PR #3756's「登陆点更正」.
 *
 * The data-table half of the same defect is PR #3756; this suite mirrors it
 * (same dispositions, same pure-function cases) with the two additions this
 * surface needs: the inline PRIMARY button path, and the legacy string
 * `rowActions` that carry no predicate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PredicateScopeProvider, ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import type { CrudAffordances } from '@object-ui/core';
import { RowActionMenu, planRowActionMenu } from '../RowActionMenu';
import { ObjectGrid } from '../../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from '../../__tests__/explainDouble';

registerAllFields();

/** The real `userActions.edit.visibleWhen` shape (objectui#2614). */
const NOT_FROZEN = 'record.frozen != true';
/** Its `disabledWhen` counterpart — HOLDS for the frozen row, so it greys out. */
const IS_FROZEN = 'record.frozen == true';
/** The reporter's shape: an action gated for a role the viewer is not in. */
const IS_APPROVER = 'record.approver == "u-me"';

const FROZEN = { id: 'r1', name: 'Frozen A', frozen: true, approver: 'someone-else' };
const DRAFT = { id: 'r2', name: 'Draft B', frozen: false, approver: 'someone-else' };

const trigger = () => screen.queryByTestId('row-action-trigger');

function renderMenu(props: Record<string, unknown>) {
  return render(
    <PredicateScopeProvider scope={{}}>
      <RowActionMenu row={FROZEN} onActionDef={() => {}} {...props} />
    </PredicateScopeProvider>,
  );
}

// [#4296] The `ObjectGrid` describe at the bottom of this file renders a real
// grid, which batches a record-level explain probe for its rows. Answer it from
// a double instead of letting it escape to the network (objectui#3339 / PR
// #4105); `visible: true` for every row leaves this file's alignment and
// trigger-count assertions measuring exactly what they measured before.
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('RowActionMenu — the "⋮" counts renderable items, not handlers (#3562)', () => {
  it('renders NO trigger when every built-in item is predicate-suppressed', () => {
    const { container } = renderMenu({
      canEdit: true,
      canDelete: true,
      onEdit: () => {},
      onDelete: () => {},
      editPredicates: { visibleWhen: NOT_FROZEN },
      deletePredicates: { visibleWhen: NOT_FROZEN },
    });

    // Handlers ARE wired and `canEdit`/`canDelete` ARE true — the old guard
    // rendered a trigger here, which is the reported empty box.
    expect(trigger()).not.toBeInTheDocument();
    // With no trigger there is nothing to open, so the empty menu cannot exist.
    expect(screen.queryByRole('menu')).toBeNull();
    // The cell wrapper survives (see the ObjectGrid alignment test below), but
    // it holds nothing.
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps the trigger when only SOME items are suppressed', () => {
    renderMenu({
      canEdit: true,
      canDelete: true,
      onEdit: () => {},
      onDelete: () => {},
      // Edit is gated away on a frozen row; Delete is ungated and survives.
      editPredicates: { visibleWhen: NOT_FROZEN },
    });
    expect(trigger()).toBeInTheDocument();
  });

  it('renders one trigger for the plain Edit + Delete case (the reporter’s control group)', () => {
    // Their own business object: no predicates, two items, menu works. This is
    // the case that must not move.
    renderMenu({ canEdit: true, canDelete: true, onEdit: () => {}, onDelete: () => {} });
    expect(trigger()).toBeInTheDocument();
  });

  it('renders no trigger when nothing is wired at all (unchanged)', () => {
    renderMenu({});
    expect(trigger()).not.toBeInTheDocument();
  });

  it('suppresses the trigger when every CUSTOM action is invisible for the row', () => {
    // sys_approval_request as the reporter sees it: the declared list_item
    // actions all gate on being the approver, and this admin is not.
    renderMenu({
      rowActionDefs: [
        { name: 'approve', label: 'Approve', variant: 'secondary', visible: IS_APPROVER },
        { name: 'reject', label: 'Reject', variant: 'secondary', visible: IS_APPROVER },
        { name: 'recall', label: 'Recall', variant: 'secondary', visible: IS_APPROVER },
      ],
    });
    expect(trigger()).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the trigger for the custom action that DOES survive', () => {
    renderMenu({
      rowActionDefs: [
        { name: 'approve', label: 'Approve', variant: 'secondary', visible: IS_APPROVER },
        { name: 'view', label: 'View', variant: 'secondary' },
      ],
    });
    expect(trigger()).toBeInTheDocument();
  });

  it('legacy string rowActions carry no predicate, so they always keep the trigger', () => {
    // Preserved deliberately: a bare identifier has nothing to evaluate, so it
    // cannot be suppressed and the menu is never empty.
    renderMenu({ rowActions: ['send_email'], onAction: () => {} });
    expect(trigger()).toBeInTheDocument();
  });

  /**
   * The other side of #3562's rule, observed where a user meets it: a row whose
   * only item is greyed out is NOT an empty menu. `disabledWhen` is a rendering
   * verdict, not a visibility one, so the item counts, the trigger survives, and
   * what it opens is that item — present and `aria-disabled` (objectui#4429).
   *
   * End-to-end on purpose: the two halves live apart — the count in
   * `planRowActionMenu`, the greying in `BuiltinRowActionItem` — and each half's
   * own test stays green while the other regresses. Neither could observe this
   * pairing before: the planner's cases read its return value (and the planner
   * never reads `disabledWhen` at all — see the renamed case below), while the
   * item's own cases (`RowActionMenu.test.tsx`) render `BuiltinRowActionItem`
   * directly inside an already-open dropdown, never through the component that
   * decides whether a trigger exists at all.
   *
   * This is the level where the two halves actually meet: `RowActionMenu` is
   * both the caller of the planner and the renderer of the item. The
   * `ObjectGrid` describe further down is a level ABOVE it (column alignment
   * plus the async `userActions` plumbing) and its cases read `visibleWhen`
   * only, so it did not pin this either.
   */
  it('keeps the trigger for a row whose only item renders merely DISABLED', async () => {
    renderMenu({
      canEdit: true,
      onEdit: () => {},
      editPredicates: { disabledWhen: IS_FROZEN },
    });

    // Counted: a greyed-out item is still an item, so the row keeps its "⋮".
    expect(trigger()).toBeInTheDocument();

    // Radix opens on `pointerdown` (a plain click does nothing) and portals its
    // content on the next tick, hence the async find.
    fireEvent.pointerDown(trigger()!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const item = await screen.findByTestId('row-action-builtin-edit');
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });
});

/**
 * The inline PRIMARY button path. It already returned `null` on a failing
 * predicate; what changes is that it reads the SAME visibility function as the
 * menu items and the guard, so the three cannot drift. These pin the outcome the
 * ruling names: a primary whose predicate fails for the row renders nothing —
 * and does not conjure a "⋮" either.
 */
describe('RowActionMenu — the inline primary button shares one visibility source (#3562)', () => {
  const OPEN_IF_APPROVER = {
    name: 'approve',
    label: 'Approve',
    variant: 'primary' as const,
    visible: IS_APPROVER,
  };

  it('a primary whose predicate fails renders neither a button nor a trigger', () => {
    renderMenu({ rowActionDefs: [OPEN_IF_APPROVER] });
    expect(screen.queryByTestId('row-action-inline-approve')).not.toBeInTheDocument();
    // …and nothing folded into a menu behind it.
    expect(trigger()).not.toBeInTheDocument();
  });

  it('the same def renders inline on a row whose predicate passes', () => {
    render(
      <PredicateScopeProvider scope={{}}>
        <RowActionMenu
          row={{ ...DRAFT, approver: 'u-me' }}
          rowActionDefs={[OPEN_IF_APPROVER]}
          onActionDef={() => {}}
        />
      </PredicateScopeProvider>,
    );
    expect(screen.getByTestId('row-action-inline-approve')).toBeInTheDocument();
    // A single surviving primary needs no overflow — unchanged behavior.
    expect(trigger()).not.toBeInTheDocument();
  });

  // objectui#3762 replaced the fixture that used to live here. It pinned the
  // status quo — `a suppressed primary does NOT promote the next primary into its
  // inline slot` — because slot allocation ran on the DECLARED primaries and
  // #3562's ruling covered only whether the trigger renders, not where an item
  // lands. #3762 then decided the placement question, the other way: a slot is a
  // width budget for a button that renders, so a suppressed primary holds none.
  // The old expectations (`upgrade` not inline, a "⋮" present) are now the wrong
  // verdicts, so the case is replaced rather than re-spelled — see the describe
  // below, which asserts the opposite direction on the same fixture.
});

/**
 * objectui#3762 — the inline budget belongs to the primaries that RENDER.
 *
 * Same shape as the cloud `sys_environment` list that motivated
 * `maxInlineActions` in the first place (two `variant:'primary'` actions, Open +
 * Upgrade Plan), with the leading one gated for this row. Slicing the declared
 * primaries left that suppressed action holding the single inline slot —
 * `RowActionInlineButton` returned `null` into it — while the surviving primary
 * had already been folded into the "⋮". The row then showed no inline button at
 * all and hid its main CTA one click deep, even though exactly one primary was
 * visible and the budget was exactly one.
 */
describe('RowActionMenu — inline slots go to SURVIVING primaries (objectui#3762)', () => {
  const APPROVE_IF_APPROVER = {
    name: 'approve',
    label: 'Approve',
    variant: 'primary' as const,
    visible: IS_APPROVER,
  };
  const UPGRADE = { name: 'upgrade', label: 'Upgrade', variant: 'primary' as const };

  it('a suppressed leading primary yields its inline slot to the surviving one', () => {
    renderMenu({ rowActionDefs: [APPROVE_IF_APPROVER, UPGRADE] });
    // The gated primary renders nowhere, as before.
    expect(screen.queryByTestId('row-action-inline-approve')).not.toBeInTheDocument();
    // …and the primary that DOES survive now takes the slot instead of folding.
    expect(screen.getByTestId('row-action-inline-upgrade')).toBeInTheDocument();
    // With the budget spent on a real button there is nothing left to fold, so
    // this row has no "⋮" at all. Before #3762 this row rendered ONLY a "⋮".
    expect(trigger()).not.toBeInTheDocument();
  });

  it('both primaries surviving → the second still folds into the menu (budget unchanged)', () => {
    // The guard against over-correcting: #3762 changes WHICH primaries compete
    // for the slots, never how many there are. `maxInlineActions` still defaults
    // to 1, so the clipped-column regression the budget exists for stays fixed.
    renderMenu({
      row: { ...DRAFT, approver: 'u-me' },
      rowActionDefs: [APPROVE_IF_APPROVER, UPGRADE],
    });
    expect(screen.getByTestId('row-action-inline-approve')).toBeInTheDocument();
    expect(screen.queryByTestId('row-action-inline-upgrade')).not.toBeInTheDocument();
    // `upgrade` is folded, so the trigger is back — and holds it.
    expect(trigger()).toBeInTheDocument();
  });

  it('every primary suppressed → no inline button and no "⋮" (guard cross-check)', () => {
    // The empty-guard invariant (#3562) still holds under survivor-based slots:
    // reallocating slots must not conjure a trigger for a row with nothing to
    // show. Both primaries gate on being the approver, and FROZEN is not.
    renderMenu({
      rowActionDefs: [APPROVE_IF_APPROVER, { ...UPGRADE, visible: IS_APPROVER }],
    });
    expect(screen.queryByTestId('row-action-inline-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-action-inline-upgrade')).not.toBeInTheDocument();
    expect(trigger()).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

/**
 * Column alignment through the REAL grid — the surface the reporter looked at.
 * `ObjectGrid` injects the `_actions` column (header + one cell per row) at
 * table level; this change only decides what goes INSIDE the cell, so a row with
 * nothing to offer renders an empty cell and every row keeps the same `<td>`
 * count. Same convention as PR #3756's data-table half.
 */
describe('ObjectGrid actions column stays aligned when a row loses its menu (#3562)', () => {
  function renderGrid(rows: Record<string, unknown>[], userActions: Record<string, unknown>) {
    const dataSource: any = {
      getObjectSchema: async (name: string) => ({
        name,
        userActions,
        fields: {
          id: { type: 'text' },
          name: { type: 'text', label: 'Name' },
          frozen: { type: 'boolean', label: 'Frozen' },
        },
      }),
    };
    return render(
      <ActionProvider>
        <SchemaRendererProvider dataSource={dataSource}>
          <ObjectGrid
            schema={{
              type: 'object-grid',
              objectName: 'test_object',
              columns: [{ field: 'name', label: 'Name' }],
              data: { provider: 'value', items: rows },
            } as any}
            dataSource={dataSource}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
          />
        </SchemaRendererProvider>
      </ActionProvider>,
    );
  }

  /** The last `<td>` of every body row — the `_actions` cell. */
  function actionCells(container: HTMLElement): HTMLTableCellElement[] {
    return Array.from(container.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')) as HTMLTableCellElement[];
      return cells[cells.length - 1];
    });
  }

  it('every row suppressed → no triggers, and no Actions column at all (objectui#12708)', async () => {
    const { container } = renderGrid([FROZEN, { ...DRAFT, frozen: true }], {
      edit: { enabled: true, visibleWhen: NOT_FROZEN },
      delete: { enabled: true, visibleWhen: NOT_FROZEN },
    });
    await waitFor(() => expect(screen.getByText('Frozen A')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Draft B')).toBeInTheDocument());

    // `waitFor`, not a bare assertion: `userActions` arrives from the async
    // `getObjectSchema`, so the settled verdict is the one to read — before the
    // fetch lands the grid has no predicates and BOTH rows carry a trigger.
    // Verified: asserted synchronously, this reads 2 triggers on the fixed
    // build. So the transition 2 → 0 is real, not an assertion that passes
    // because nothing ever rendered.
    await waitFor(() => expect(screen.queryAllByTestId('row-action-trigger')).toHaveLength(0));
    expect(screen.queryByRole('menu')).toBeNull();
    // objectui#12708 retired the empty column this case used to pin (a header
    // over one empty cell per row): no row offers an action, so the column is
    // not drawn — the shape a grid that wires no row handlers has always had.
    // Every row still has exactly the header's cell count.
    await waitFor(() => expect(screen.queryByText('Actions')).toBeNull());
    const headCount = container.querySelectorAll('thead th').length;
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    for (const tr of rows) expect(tr.children).toHaveLength(headCount);
    for (const cell of actionCells(container)) expect(cell.querySelector('button')).toBeNull();
  });

  it('mixed rows keep identical td counts (one row with a trigger, one without)', async () => {
    const { container } = renderGrid([FROZEN, DRAFT], {
      edit: { enabled: true, visibleWhen: NOT_FROZEN },
      delete: false,
    });
    await waitFor(() => expect(screen.getByText('Frozen A')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Draft B')).toBeInTheDocument());

    // Only the non-frozen row keeps an item, so only it keeps a trigger.
    await waitFor(() => expect(screen.queryAllByTestId('row-action-trigger')).toHaveLength(1));
    const widths = Array.from(container.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelectorAll('td').length,
    );
    // No row is short a cell — the trigger's absence never collapses the column.
    expect(new Set(widths).size).toBe(1);
    const cells = actionCells(container);
    expect(cells[0].querySelector('button')).toBeNull();
    expect(cells[1].querySelector('button')).not.toBeNull();
  });
});

/**
 * The resolution the guard counts with, exercised directly: the DOM tests above
 * pin whether a trigger exists, these pin WHICH items it would hold — and, since
 * objectui#3762, WHERE each one lands. Both read the same `planRowActionMenu`,
 * and the item components re-read the same visibility functions — so the trigger
 * and its contents cannot drift apart.
 *
 * `actionDefs` is the whole declared (capability-gated) set in declared order;
 * the function partitions primary from non-primary itself, because the inline
 * budget may only be spent on defs that survive `visible` (#3762). Defs without
 * a `variant` are non-primary, so the menu-side cases below read the same as when
 * this suite handed the split in pre-sliced.
 */
describe('planRowActionMenu', () => {
  const scope = {};
  const noop = () => {};
  const base = { scope, actionDefs: [] } as const;

  it('counts nothing when nothing is wired', () => {
    expect(planRowActionMenu({ ...base, row: DRAFT })).toMatchObject({
      edit: false,
      remove: false,
      menuCount: 0,
    });
  });

  it('counts both built-ins when they are ungated', () => {
    expect(planRowActionMenu({
      ...base,
      row: FROZEN,
      canEdit: true,
      canDelete: true,
      onEdit: noop,
      onDelete: noop,
    })).toMatchObject({ edit: true, remove: true, menuCount: 2 });
  });

  it('drops only the suppressed built-in', () => {
    expect(planRowActionMenu({
      ...base,
      row: FROZEN,
      canEdit: true,
      canDelete: true,
      onEdit: noop,
      onDelete: noop,
      editPredicates: { visibleWhen: NOT_FROZEN },
    })).toMatchObject({ edit: false, remove: true, menuCount: 1 });
  });

  it('reaches zero on a suppressed row while the SAME grid keeps both on a row that passes', () => {
    const args = {
      ...base,
      canEdit: true,
      canDelete: true,
      onEdit: noop,
      onDelete: noop,
      editPredicates: { visibleWhen: NOT_FROZEN },
      deletePredicates: { visibleWhen: NOT_FROZEN },
    };
    expect(planRowActionMenu({ ...args, row: FROZEN }).menuCount).toBe(0);
    expect(planRowActionMenu({ ...args, row: DRAFT }).menuCount).toBe(2);
  });

  it('a wired handler without the object verdict counts for nothing', () => {
    // `canEdit` folds the ADR-0103 bucket, `userActions` and the server's
    // effective operation set; a handler alone was never enough.
    expect(planRowActionMenu({ ...base, row: DRAFT, onEdit: noop, onDelete: noop }))
      .toMatchObject({ edit: false, remove: false, menuCount: 0 });
  });

  it('keeps the menu defs whose `visible` passes, in declared order', () => {
    const plan = planRowActionMenu({
      ...base,
      actionDefs: [
        { name: 'unfreeze', visible: 'record.frozen == true' },
        { name: 'publish', visible: NOT_FROZEN },
        { name: 'view' },
      ],
      row: FROZEN,
    });
    expect(plan.custom.map((a) => a.name)).toEqual(['unfreeze', 'view']);
    expect(plan.menuCount).toBe(2);
  });

  it('filters the inline primaries too, without counting them toward the trigger', () => {
    const plan = planRowActionMenu({
      ...base,
      actionDefs: [{ name: 'approve', variant: 'primary', visible: IS_APPROVER }],
      row: FROZEN,
    });
    expect(plan.inline).toEqual([]);
    // An inline button is not a menu item: it never keeps the "⋮" alive, and a
    // surviving one does not either.
    expect(plan.menuCount).toBe(0);
    const passing = planRowActionMenu({
      ...base,
      actionDefs: [{ name: 'approve', variant: 'primary', visible: IS_APPROVER }],
      row: { ...DRAFT, approver: 'u-me' },
    });
    expect(passing.inline.map((a) => a.name)).toEqual(['approve']);
    expect(passing.menuCount).toBe(0);
  });

  it('legacy string actions count — they have no predicate to fail', () => {
    expect(planRowActionMenu({ ...base, row: FROZEN, rowActions: ['send_email'] }))
      .toMatchObject({ legacy: ['send_email'], menuCount: 1 });
  });

  // Renamed from "still counts an item that renders merely DISABLED"
  // (objectui#4429). The planner never reads `disabledWhen`, so this fixture
  // behaves identically to `{}` and could not pin the disabled-counting claim
  // its old name made — that claim now lives where it can actually be observed,
  // in "keeps the trigger for a row whose only item renders merely DISABLED"
  // above. What survives here is the verdict this case really does decide, and
  // it is worth deciding: a predicate object is not itself a gate.
  it('an object with no `visibleWhen` does not hide the item', () => {
    // Typed as what the production caller actually hands the planner —
    // `resolveRowCrudAffordances`' `editPredicates`, whose spec-owned shape
    // (`RowCrudPredicates`, ADR-0103) carries `disabledWhen` alongside
    // `visibleWhen`. The planner's own parameter is now `Pick`ed from that same
    // key rather than hand-restated (objectui#4429), so it stays the deliberate
    // `visibleWhen`-only subset: a bare object literal trips excess-property
    // checking, while the identical value reaches it unremarked in production.
    // Annotating from the authoring type keeps the fixture honest about which
    // key is being ignored, rather than deleting the key and quietly renaming
    // the case.
    const editPredicates: CrudAffordances['editPredicates'] = {
      disabledWhen: IS_FROZEN,
    };
    expect(planRowActionMenu({
      ...base,
      row: FROZEN,
      canEdit: true,
      onEdit: noop,
      editPredicates,
    })).toMatchObject({ edit: true, menuCount: 1 });
  });

  it('fails CLOSED on a faulting predicate (no phantom item, no phantom trigger)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(planRowActionMenu({
        ...base,
        row: FROZEN,
        canEdit: true,
        onEdit: noop,
        editPredicates: { visibleWhen: 'record.frozen ==' },
        actionDefs: [{ name: 'broken', visible: 'record.frozen ==' }],
      })).toMatchObject({ edit: false, custom: [], menuCount: 0 });
    } finally {
      warn.mockRestore();
    }
  });

  // objectui#3758 replaced the fixture that used to live here. It pinned the
  // truthiness gate verbatim — `!def.visible` read `false` as "ungated", so the
  // def rendered and counted — because re-deciding `visible: false` changes
  // WHICH items render and was out of #3562's scope. #3758 then decided it, the
  // other way: a declared boolean is a verdict (the #3492 invariant), so the
  // fixture's expectations (`['ghost']` / `1`) are now the wrong verdicts and
  // are replaced rather than re-spelled.
  it('a declared `visible: false` excludes the def and leaves no trigger (objectui#3758)', () => {
    const plan = planRowActionMenu({
      ...base,
      row: FROZEN,
      actionDefs: [{ name: 'ghost', visible: false }],
    });
    expect(plan.custom).toEqual([]);
    expect(plan.menuCount).toBe(0);
  });

  // The counterpart that keeps the assertion above from passing for the empty
  // reason: a gate rewritten to "always hide" would also reach `menuCount: 0`.
  it('a declared `visible: true` still counts — declaration detection, not "always hide"', () => {
    const plan = planRowActionMenu({
      ...base,
      row: FROZEN,
      actionDefs: [{ name: 'always', visible: true }],
    });
    expect(plan.custom.map((a) => a.name)).toEqual(['always']);
    expect(plan.menuCount).toBe(1);
  });

  it('an empty-string `visible` is no gate at all, matching `hasVisibilityGate`', () => {
    const plan = planRowActionMenu({
      ...base,
      row: FROZEN,
      actionDefs: [{ name: 'compiled_away', visible: '' }],
    });
    expect(plan.custom.map((a) => a.name)).toEqual(['compiled_away']);
    expect(plan.menuCount).toBe(1);
  });

  // --- inline slot allocation (objectui#3762) --------------------------------
  // `base` declares no `maxInlineActions`, so these read the default budget of
  // 1 — the same default `RowActionMenuProps` documents.

  it('spends the inline slot on the surviving primary, not the declared first', () => {
    const plan = planRowActionMenu({
      ...base,
      row: FROZEN,
      actionDefs: [
        { name: 'approve', variant: 'primary', visible: IS_APPROVER },
        { name: 'upgrade', variant: 'primary' },
      ],
    });
    expect(plan.inline.map((a) => a.name)).toEqual(['upgrade']);
    // Nothing folded, so nothing is left for the "⋮" to hold.
    expect(plan.custom).toEqual([]);
    expect(plan.menuCount).toBe(0);
  });

  it('two surviving primaries still put the second in the menu', () => {
    const plan = planRowActionMenu({
      ...base,
      row: { ...DRAFT, approver: 'u-me' },
      actionDefs: [
        { name: 'approve', variant: 'primary', visible: IS_APPROVER },
        { name: 'upgrade', variant: 'primary' },
      ],
    });
    expect(plan.inline.map((a) => a.name)).toEqual(['approve']);
    expect(plan.custom.map((a) => a.name)).toEqual(['upgrade']);
    expect(plan.menuCount).toBe(1);
  });

  it('fills EVERY slot from the survivors, and keeps folded primaries above secondaries', () => {
    const plan = planRowActionMenu({
      ...base,
      row: FROZEN,
      maxInlineActions: 2,
      actionDefs: [
        { name: 'approve', variant: 'primary', visible: IS_APPROVER },
        { name: 'open', variant: 'primary' },
        { name: 'upgrade', variant: 'primary' },
        { name: 'archive', variant: 'secondary' },
      ],
    });
    // Both slots go to survivors — the suppressed leading primary consumes none.
    expect(plan.inline.map((a) => a.name)).toEqual(['open', 'upgrade']);
    expect(plan.custom.map((a) => a.name)).toEqual(['archive']);
    expect(plan.menuCount).toBe(1);
  });

  it('maxInlineActions: 0 keeps every surviving primary in the menu, above the secondaries', () => {
    const plan = planRowActionMenu({
      ...base,
      row: FROZEN,
      maxInlineActions: 0,
      actionDefs: [
        { name: 'archive', variant: 'secondary' },
        { name: 'upgrade', variant: 'primary' },
      ],
    });
    expect(plan.inline).toEqual([]);
    expect(plan.custom.map((a) => a.name)).toEqual(['upgrade', 'archive']);
    expect(plan.menuCount).toBe(2);
  });
});

/**
 * The DOM half of objectui#3758 on this surface: a row whose only custom action
 * declares `visible: false` renders no "⋮" at all. This is the #3562 guard and
 * the #3758 gate meeting — the guard counts what the items will render, so
 * correcting the gate propagates to the trigger with no separate change.
 */
describe('declared `visible: false` reaches the "⋮" guard (objectui#3758)', () => {
  it('renders no trigger when the row\'s only custom action declares `visible: false`', () => {
    renderMenu({ rowActionDefs: [{ name: 'ghost', label: 'Ghost', variant: 'secondary', visible: false }] });
    expect(trigger()).not.toBeInTheDocument();
  });

  it('keeps the trigger when that same action declares `visible: true`', () => {
    renderMenu({ rowActionDefs: [{ name: 'ghost', label: 'Ghost', variant: 'secondary', visible: true }] });
    expect(trigger()).toBeInTheDocument();
  });
});
