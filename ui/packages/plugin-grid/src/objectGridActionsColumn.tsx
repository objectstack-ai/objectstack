/**
 * The Actions column of `ObjectGrid` (`./ObjectGrid.tsx`) and the pinned column
 * sets it joins, moved out of the component verbatim (objectstack#25994, slice
 * 8). A plain function: it runs below the component's early returns.
 */

import React from 'react';
import type { ObjectGridSchema } from '@object-ui/types';
import { useAction, usePredicateScope, useCapabilityGate } from '@object-ui/react';
import { isActionSwitchedOff } from '@object-ui/core';
import { PINNED_RIGHT_SEAM_SHADOW_CLASSES } from '@object-ui/components';
import { resolveRowRecordCrudAffordance } from './rowCrudAffordances';
import { useRecordCrudVerdicts } from './hooks/useRecordCrudVerdicts';
import { resolveLegacyRowActions } from './resolveLegacyRowActions';
import { RowActionMenu, planRowActionMenu, type RowActionMenuProps } from './components/RowActionMenu';
import { rowRecordId } from './objectGridLinkCell';
import { useGridTranslation } from './objectGridTranslations';
import type { resolveObjectGridPersistedColumns } from './objectGridPersistedColumns';
import type { resolveRowCrudAffordances } from './rowCrudAffordances';
import type { ObjectGridComponentProps } from './ObjectGrid';

type RowCrudAffordances = ReturnType<typeof resolveRowCrudAffordances>;

/**
 * The persisted columns plus the Actions column when a row on screen offers an
 * action, split into the pinned and unpinned sets the table layout reads.
 * `ObjectGrid` calls it where these lines used to stand.
 */
export function resolveObjectGridActionsColumn({
  schema, data, objectSchema, persistedColumns, operations, customRowActions, resolvedRowActionDefs,
  wantEditAction, wantDeleteAction, mayInvokeRowAction, rowOperations, canEdit, canDelete,
  recordVerdict, predicateScope, onEdit, onDelete, editPredicates, deletePredicates, executeAction,
  setRefreshKey, t,
}: {
  schema: ObjectGridSchema;
  data: any[];
  objectSchema: any;
  persistedColumns: ReturnType<typeof resolveObjectGridPersistedColumns>['persistedColumns'];
  operations: ObjectGridSchema['operations'] | { update: boolean; delete: boolean };
  customRowActions: ReturnType<typeof resolveLegacyRowActions>['unresolved'];
  resolvedRowActionDefs: ReturnType<typeof resolveLegacyRowActions>['defs'];
  wantEditAction: boolean;
  wantDeleteAction: boolean;
  mayInvokeRowAction: ReturnType<typeof useCapabilityGate>;
  rowOperations: ObjectGridComponentProps['rowOperations'];
  canEdit: RowCrudAffordances['canEdit'];
  canDelete: RowCrudAffordances['canDelete'];
  recordVerdict: ReturnType<typeof useRecordCrudVerdicts>;
  predicateScope: ReturnType<typeof usePredicateScope>;
  onEdit: ObjectGridComponentProps['onEdit'];
  onDelete: ObjectGridComponentProps['onDelete'];
  editPredicates: RowCrudAffordances['editPredicates'];
  deletePredicates: RowCrudAffordances['deletePredicates'];
  executeAction: ReturnType<typeof useAction>['execute'];
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  t: ReturnType<typeof useGridTranslation>['t'];
}) {
  // `operations`, the row-action lists and the row CRUD affordance verdict are
  // resolved further up, next to the permission reads they AND with — this
  // render path sits BELOW the error / loading early returns, and [#4296] the
  // record-level verdict they feed is fetched by a hook, which may not sit
  // behind a conditional return.
  const hasActions = !!(operations && (operations.update || operations.delete));
  const hasRowActions = customRowActions.length > 0 || resolvedRowActionDefs.length > 0 || wantEditAction || wantDeleteAction;

  // objectui#12708 — the Actions column is drawn only when a row on screen
  // OFFERS something: its plan, the one `RowActionMenu` renders the row's cell
  // from, holds an inline button or a menu item once its capability gate, its
  // per-record predicates and the record-level verdicts are applied. Wiring
  // alone (`operations`, a declared list) used to draw an empty column over
  // rows that offer nothing. One row is enough, so the read stops at the first.
  const rowActionDefsGated = (resolvedRowActionDefs as any[]).filter((d) => mayInvokeRowAction(d?.requiredPermissions) && !isActionSwitchedOff(d));
  // NON-AUTHOR SURFACE — see the `maxInlineActions` prop below.
  const maxInlineRowActions: number = (schema as any).maxInlineRowActions ?? 1;
  const rowCrudVerdicts = (row: any) => {
    // [objectui#8674] The CALLER's answer for this one row, ANDed in below.
    const rowOps = rowOperations?.(row);
    return {
      canEdit: resolveRowRecordCrudAffordance(canEdit && rowOps?.update !== false, recordVerdict(rowRecordId(row), 'update')),
      canDelete: resolveRowRecordCrudAffordance(canDelete && rowOps?.delete !== false, recordVerdict(rowRecordId(row), 'delete')),
    };
  };
  const rowOffersAction = (row: any): boolean => {
    const plan = planRowActionMenu({
      row,
      scope: predicateScope,
      actionDefs: rowActionDefsGated,
      maxInlineActions: maxInlineRowActions,
      rowActions: customRowActions,
      ...rowCrudVerdicts(row),
      onEdit,
      onDelete,
      editPredicates,
      deletePredicates,
      objectFields: objectSchema?.fields,
    });
    return plan.inline.length > 0 || plan.menuCount > 0;
  };
  const drawActionsColumn = (hasActions || hasRowActions) && data.some(rowOffersAction);

  /**
   * The props ONE row's "⋮" cell renders with — and, verbatim, the props its
   * context menu reads (objectstack#28434), so the two entry points resolve the
   * same items through the same handlers and the same confirm dialogs.
   */
  const rowActionMenuProps = (row: any): RowActionMenuProps => {
    // [objectui#8674] The CALLER's answer for this one row, resolved
    // once per row and ANDed into the two verdicts below. A host whose
    // refusal is per record (a system field the designer may not drop)
    // has no other place to put it: `operations` and the `onEdit` /
    // `onDelete` wiring are grid-level and identical for every row, so
    // the refusal used to live in the callback and fire AFTER the button
    // had been drawn and clicked. Narrowing only — see `rowOperations`.
    // Resolved by `rowCrudVerdicts`, the same call the column's draw
    // verdict above reads (objectui#12708).
    const rowVerdicts = rowCrudVerdicts(row);
    return {
      row,
      rowActions: customRowActions,
      rowActionDefs: resolvedRowActionDefs as any[],
      objectFields: objectSchema?.fields,
      // NON-AUTHOR SURFACE — `maxInlineRowActions` is deliberately
      // absent from `GRID_QUERY_INPUTS` (maintainer ruling, 2026-08-18,
      // objectui#5091), so the cast read behind `maxInlineRowActions` (resolved
      // above, beside the column's draw verdict) is deliberate, not missed. It is
      // a host/internal switch for the inline-button budget before the
      // rest fold into the "⋮" menu — an embedder's layout call, set from
      // code (`apps/console/src/dev/DevRowActions.tsx:51`), never from a
      // view document. `ComponentPropsMap['object-grid']` is a
      // `strictObject` and rejects the key by name, so publishing it would
      // advertise a key the save gate refuses. The `?? 1` default is the
      // published behaviour and stays the one an author sees. Pinned by
      // `__tests__/gridNonAuthorKeys.test.tsx`.
      maxInlineActions: maxInlineRowActions,
      // [#4296] The object verdict ANDed with THIS row's record-level one.
      // It rides the same per-row channel the #2614 predicates ride —
      // `planRowActionMenu` conjoins `canEdit`/`canDelete` with
      // `visibleWhen` in one expression, so the item and the "⋮" guard read
      // one decision (#3562) and a hidden row grows no empty trigger. An
      // unanswered row keeps the object verdict, i.e. today's rendering.
      // [objectui#8674] `rowOps` (inside `rowCrudVerdicts`) is the third narrowing in this one
      // expression, and an INTERSECTION like the two around it: only
      // `false` removes, so a caller that passes no `rowOperations` —
      // every caller but the field designer today — reads exactly the
      // verdict this line carried before the prop existed.
      canEdit: rowVerdicts.canEdit,
      canDelete: rowVerdicts.canDelete,
      editPredicates,
      deletePredicates,
      onEdit,
      onDelete,
      onAction: (action, r) => {
        void executeAction({ type: action, params: { record: r } }).then(res => {
          // A successful row action typically mutated this record; refresh
          // so the grid reflects the server state (same rationale as bulk).
          if (res?.success) setRefreshKey(k => k + 1);
        });
      },
      onActionDef: (def, r) => {
        // Dispatch schema-driven row action through the runner. We forward
        // the full action def so type/target/recordIdParam/bodyShape/etc.
        // route correctly, attach the row record under `_rowRecord` for the
        // apiHandler row-id injection, and surface raw `params` as
        // `actionParams` so the runner shows the param dialog when present.
        const { params: rawParams, ...rest } = def;
        const dispatch: any = { ...rest };
        if (Array.isArray(rawParams) && rawParams.length > 0) {
          dispatch.actionParams = rawParams;
        }
        dispatch.params = { _rowRecord: r };
        void executeAction(dispatch).then(res => {
          if (res?.success) setRefreshKey(k => k + 1);
        });
      },
    };
  };

  const columnsWithActions = drawActionsColumn ? [
    ...persistedColumns,
    {
      header: t('grid.actions'),
      accessorKey: '_actions',
      // Size to the buttons it holds (never the 80px char-estimate floor) and
      // don't clip — otherwise multiple inline actions (e.g. Open + Upgrade)
      // overflow the fixed-width cell and the leftmost button gets cut off.
      fitContent: true,
      align: 'right',
      // Stick to the right edge so the actions stay reachable when a wide table
      // scrolls horizontally (otherwise the last column sits past the scroll
      // extent and is hidden). Excluded from the frozen-column decision below so
      // this auto-pin doesn't cancel the default left-freeze of the first column.
      pinned: 'right',
      cell: (_value: any, row: any) => <RowActionMenu {...rowActionMenuProps(row)} />,
      sortable: false,
    },
  ] : persistedColumns;

  // --- Pinned column reordering ---
  // Reorder: pinned:'left' first, unpinned middle, pinned:'right' last
  const pinnedLeftCols = columnsWithActions.filter((c: any) => c.pinned === 'left');
  const pinnedRightCols = columnsWithActions.filter((c: any) => c.pinned === 'right');
  const unpinnedCols = columnsWithActions.filter((c: any) => !c.pinned);
  const hasPinnedColumns = pinnedLeftCols.length > 0 || pinnedRightCols.length > 0;
  // Both carry the shared seam shadow (objectui#12708): inside the grouped
  // grid's one scroller (a `seam="pinned"` overflow box) a right-pinned cell
  // draws it on its own left edge while columns remain to the right. Outside
  // such a box it stays invisible, and `data-table` places its own.
  const rightPinnedClasses = `sticky right-0 z-10 bg-background border-l border-border ${PINNED_RIGHT_SEAM_SHADOW_CLASSES}`;
  // A body cell also layers the row's `--os-row-tint` (set by `useRowColor`)
  // over its opaque `bg-background`, so a tinted row's colour reaches its
  // right-pinned cells while they stay opaque over the content scrolling
  // beneath them (objectui#12375). The same literal as `data-table`'s
  // `STICKY_ROW_TINT` for its frozen cells; an untinted row resolves it to
  // nothing.
  const rightPinnedCellClasses =
    `sticky right-0 z-10 bg-background bg-[image:linear-gradient(var(--os-row-tint,transparent),var(--os-row-tint,transparent))] border-l border-border ${PINNED_RIGHT_SEAM_SHADOW_CLASSES}`;
  // The `_actions` column is auto-pinned right (above), so it must be excluded
  // from the frozen-column decision — otherwise every list with row actions
  // would trip `hasPinnedColumns` and lose the implicit left-freeze of its
  // first column. Only USER-declared pins should drive freezing.
  const userLeftPinnedCount = pinnedLeftCols.filter((c: any) => c.accessorKey !== '_actions').length;
  const hasUserPinnedColumns =
    userLeftPinnedCount > 0 || pinnedRightCols.some((c: any) => c.accessorKey !== '_actions');

  return {
    // objectstack#28434 — the row context menu reads the cell's own props,
    // whether this table offers row actions at all (a face-level answer), and
    // the cell's own "does this row offer anything" verdict.
    rowActionMenuProps,
    tableOffersRowActions: hasActions || hasRowActions,
    rowOffersAction: (row: any): boolean => (hasActions || hasRowActions) && rowOffersAction(row),
    columnsWithActions, hasActions, hasPinnedColumns, hasUserPinnedColumns, pinnedLeftCols,
    pinnedRightCols, unpinnedCols, rightPinnedClasses, rightPinnedCellClasses, userLeftPinnedCount,
  };
}
