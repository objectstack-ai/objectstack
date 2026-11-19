/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { Edit, MoreHorizontal, X } from 'lucide-react';
import type { BulkActionDef } from '@object-ui/types';
import { useObjectTranslation, useRowPredicate } from '@object-ui/react';
import {
  RowActionInlineButton,
  RowActionMenuItems,
  useRowActionPlan,
  type RowActionMenuPlan,
  type RowActionMenuProps,
} from './RowActionMenu';
import {
  BulkActionButton,
  orderSelectionMenuItems,
  useBulkActionItems,
} from './BulkActionBar';
import { SelectionActionMenuEntries } from './RowContextMenu';
import { BULK_SELECT_ALL_MATCHING_CAP, exceedsBulkSelectAllMatchingCap } from '../bulkSelectAllMatchingCap';

/**
 * How many of a selection's actions the page bar draws as buttons; the rest
 * are behind its "⋮" (objectstack#35554: 「露出一到两个，其余进⋮」).
 */
export const SELECTION_EXPOSED_ACTIONS = 2;

/**
 * Which of ONE row's actions the page bar exposes. The row's own actions in
 * the order its menu lists them — the declared `list_item` actions (sorted by
 * their `order` when the object is assembled), primaries first — then the
 * built-in Edit when there is room. Delete is never exposed: it stays the last
 * item of the "⋮", apart and in the danger colour.
 */
export function planExposedRowActions(plan: RowActionMenuPlan, budget = SELECTION_EXPOSED_ACTIONS): {
  exposed: RowActionMenuPlan['custom'];
  exposeEdit: boolean;
  rest: RowActionMenuPlan;
} {
  const declared = [...plan.inline, ...plan.custom];
  const exposed = declared.slice(0, budget);
  const exposeEdit = plan.edit && exposed.length < budget;
  const custom = declared.slice(exposed.length);
  const edit = plan.edit && !exposeEdit;
  return {
    exposed,
    exposeEdit,
    rest: {
      ...plan,
      inline: [],
      custom,
      edit,
      menuCount: (edit ? 1 : 0) + (plan.remove ? 1 : 0) + custom.length + plan.legacy.length,
    },
  };
}

/** The built-in Edit as a page bar button, under the same gates as its menu item. */
const EditButton: React.FC<{ menu: RowActionMenuProps; label: string }> = ({ menu, label }) => {
  const disabledWhen = menu.editPredicates?.disabledWhen;
  const disabledByPredicate = useRowPredicate(disabledWhen, menu.row, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:edit:disabledWhen',
    fields: menu.objectFields,
  });
  const disabled = !!menu.crudVerdictPending?.edit || (disabledWhen != null && disabledByPredicate);
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5"
      disabled={disabled}
      onClick={() => menu.onEdit?.(menu.row)}
      data-testid="selection-action-edit"
    >
      <Edit className="h-4 w-4" />
      {label}
    </Button>
  );
};

const OverflowMenu: React.FC<{ label: string; children: React.ReactNode; onOpen?: () => void }> = ({ label, children, onOpen }) => (
  <DropdownMenu onOpenChange={(open) => { if (open) onOpen?.(); }}>
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2"
        aria-label={label}
        data-testid="selection-actions-more"
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">{children}</DropdownMenuContent>
  </DropdownMenu>
);

/** One selected record: its own actions, exactly as its row menu resolves them. */
const SingleRecordActions: React.FC<{ menu: RowActionMenuProps; moreLabel: string; editLabel: string }> = ({
  menu, moreLabel, editLabel,
}) => {
  const plan = useRowActionPlan(menu, 0);
  const { exposed, exposeEdit, rest } = planExposedRowActions(plan);
  React.useEffect(() => {
    menu.onActionsDemand?.();
  }, [menu.onActionsDemand]);
  return (
    <>
      {exposed.map((def) => (
        <RowActionInlineButton
          key={def.name}
          def={def}
          row={menu.row}
          objectFields={menu.objectFields}
          onActionDef={menu.onActionDef}
          buttonVariant="outline"
        />
      ))}
      {exposeEdit && <EditButton menu={menu} label={editLabel} />}
      {rest.menuCount > 0 && (
        <OverflowMenu label={moreLabel} onOpen={menu.onActionsDemand}>
          <RowActionMenuItems plan={rest} props={menu} />
        </OverflowMenu>
      )}
    </>
  );
};

/** Two or more selected records: the bulk actions, the same set the bulk bar offered. */
const BulkActions: React.FC<{
  selectedRows: any[];
  actions: string[];
  actionDefs?: BulkActionDef[];
  objectFields?: unknown;
  onAction?: (action: string, selectedRows: any[]) => void;
  onActionDef?: (def: BulkActionDef, selectedRows: any[]) => void;
  moreLabel: string;
}> = ({ selectedRows, actions, actionDefs, objectFields, onAction, onActionDef, moreLabel }) => {
  const items = useBulkActionItems({ selectedRows, actions, actionDefs, objectFields });
  const ordered = orderSelectionMenuItems(items);
  const exposed = ordered.filter((e) => !e.destructive).slice(0, SELECTION_EXPOSED_ACTIONS);
  const exposedKeys = new Set(exposed.map((e) => e.key));
  const rest = ordered.filter((e) => !exposedKeys.has(e.key));
  return (
    <>
      {exposed.map((entry) =>
        entry.kind === 'def' ? (
          <BulkActionButton
            key={entry.key}
            def={entry.def}
            selectedRows={selectedRows}
            onActionDef={onActionDef}
            size="page-bar"
          />
        ) : (
          <Button
            key={entry.key}
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => onAction?.(entry.legacy.name, selectedRows)}
            data-testid={`bulk-action-${entry.legacy.name}`}
          >
            {entry.legacy.label}
          </Button>
        ),
      )}
      {rest.length > 0 && (
        <OverflowMenu label={moreLabel}>
          <SelectionActionMenuEntries
            entries={rest}
            selectedRows={selectedRows}
            onAction={onAction}
            onActionDef={onActionDef}
          />
        </OverflowMenu>
      )}
    </>
  );
};

export interface SelectionPageBarProps {
  selectedRows: any[];
  /** The props the ONE selected row's menu renders with (its "⋮" and its context menu). */
  singleRowMenu?: RowActionMenuProps;
  actions: string[];
  actionDefs?: BulkActionDef[];
  objectFields?: unknown;
  onAction?: (action: string, selectedRows: any[]) => void;
  onActionDef?: (def: BulkActionDef, selectedRows: any[]) => void;
  onClearSelection: () => void;
  /** Rows the list holds now (all of them are selectable by the header box). */
  loadedCount: number;
  /** Every row the query matches, when known. */
  totalMatching?: number;
  allMatchingSelected?: boolean;
  /** Absent ⇒ the selection cannot grow past the loaded rows. */
  onSelectAllMatching?: () => void;
}

/**
 * objectstack#35554 — what the list page bar shows while rows are selected,
 * in place of its title and actions: 「已选 N 条」, Cancel, and the actions for
 * what is selected (one record: its own actions; two or more: the bulk
 * actions), the first {@link SELECTION_EXPOSED_ACTIONS} as buttons and the rest
 * behind a "⋮". With every loaded row selected and more matching, it offers
 * 「选择全部 M 条」, the cross-window selection the bulk bar used to offer.
 */
export const SelectionPageBar: React.FC<SelectionPageBarProps> = ({
  selectedRows,
  singleRowMenu,
  actions,
  actionDefs,
  objectFields,
  onAction,
  onActionDef,
  onClearSelection,
  loadedCount,
  totalMatching,
  allMatchingSelected,
  onSelectAllMatching,
}) => {
  const { t } = useObjectTranslation();
  const overCap = exceedsBulkSelectAllMatchingCap(totalMatching);
  const count = selectedRows.length;
  const offerAll =
    !allMatchingSelected
    && !!onSelectAllMatching
    && typeof totalMatching === 'number'
    && loadedCount > 0
    && count >= loadedCount
    && totalMatching > loadedCount;
  const moreLabel = t('detail.moreActions', { defaultValue: 'More actions' });
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" data-testid="list-selection-bar">
      <span
        className="shrink-0 text-[13px] font-semibold leading-5 tabular-nums"
        data-testid="list-selection-count"
      >
        {allMatchingSelected
          ? overCap
            ? t('grid.bulkSelectedAllMatchesCapped', {
                cap: BULK_SELECT_ALL_MATCHING_CAP,
                total: totalMatching,
                defaultValue: '{{cap}} selected (of {{total}} matches)',
              })
            : t('grid.bulkSelectedAllMatches', { count: totalMatching, defaultValue: '{{count}} selected (all matches)' })
          : t('grid.selectedCount', { count, defaultValue: '{{count}} selected' })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1 px-2 text-muted-foreground"
        onClick={onClearSelection}
        data-testid="list-selection-cancel"
      >
        <X className="h-4 w-4" />
        {t('common.cancel', { defaultValue: 'Cancel' })}
      </Button>
      {offerAll && (
        <span className="hidden md:flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground" data-testid="list-selection-loaded">
          <span className="truncate">
            {t('grid.selectedAllLoaded', { count: loadedCount, defaultValue: 'All {{count}} loaded records are selected.' })}
          </span>
          <button
            type="button"
            className="shrink-0 font-medium text-primary underline-offset-2 hover:underline"
            onClick={onSelectAllMatching}
            data-testid="list-selection-select-all"
          >
            {overCap
              ? t('grid.bulkSelectAllMatchingCapped', {
                  cap: BULK_SELECT_ALL_MATCHING_CAP,
                  total: totalMatching,
                  defaultValue: 'Select the first {{cap}} of {{total}} matching',
                })
              : t('grid.selectAllTotal', { total: totalMatching, defaultValue: 'Select all {{total}}' })}
          </button>
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5" data-testid="list-selection-actions">
        {count === 1 && !allMatchingSelected && singleRowMenu ? (
          <SingleRecordActions
            menu={singleRowMenu}
            moreLabel={moreLabel}
            editLabel={t('grid.edit', { defaultValue: 'Edit' })}
          />
        ) : (
          <BulkActions
            selectedRows={selectedRows}
            actions={actions}
            actionDefs={actionDefs}
            objectFields={objectFields}
            onAction={onAction}
            onActionDef={onActionDef}
            moreLabel={moreLabel}
          />
        )}
      </div>
    </div>
  );
};
