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
import { Edit, MoreHorizontal, Trash2, X } from 'lucide-react';
import type { BulkActionDef } from '@object-ui/types';
import { useObjectTranslation, useRowPredicate } from '@object-ui/react';
import {
  RowActionInlineButton,
  RowActionMenuItems,
  formatActionLabel,
  useRowActionPlan,
  type RowActionDef,
  type RowActionMenuPlan,
  type RowActionMenuProps,
} from './RowActionMenu';
import {
  BulkActionButton,
  orderSelectionMenuItems,
  useBulkActionItems,
  type OrderedBulkItem,
} from './BulkActionBar';
import { SelectionActionMenuEntries } from './RowContextMenu';
import { BULK_SELECT_ALL_MATCHING_CAP, exceedsBulkSelectAllMatchingCap } from '../bulkSelectAllMatchingCap';

/**
 * objectstack#35678 — how many of a selection's actions the selection bar
 * draws as labelled buttons; the rest are behind its More. When a selection
 * offers no more than this many, all of them are buttons (Delete included), so
 * a lone action is never hidden behind More.
 */
export const SELECTION_EXPOSED_ACTIONS = 3;

/** One of ONE record's actions, in the order its row menu lists them. */
export type SingleRecordEntry =
  | { kind: 'def'; key: string; def: RowActionDef }
  | { kind: 'edit'; key: 'edit' }
  | { kind: 'legacy'; key: string; name: string }
  | { kind: 'delete'; key: 'delete' };

/**
 * ONE record's actions as one list: the declared `list_item` actions (primaries
 * first), the built-in Edit, the legacy names, and Delete last — the order its
 * row menu draws them.
 */
export function singleRecordEntries(plan: RowActionMenuPlan): SingleRecordEntry[] {
  return [
    ...[...plan.inline, ...plan.custom].map((def) => ({ kind: 'def' as const, key: `def:${def.name}`, def })),
    ...(plan.edit ? [{ kind: 'edit' as const, key: 'edit' as const }] : []),
    ...plan.legacy.map((name) => ({ kind: 'legacy' as const, key: `legacy:${name}`, name })),
    ...(plan.remove ? [{ kind: 'delete' as const, key: 'delete' as const }] : []),
  ];
}

/**
 * Which entries the bar draws as buttons. A selection offering at most
 * `budget` entries gets all of them; otherwise the first `budget` of the
 * entries `exposable` admits (never Delete), in order. `fit` then caps the
 * count to what the bar's width holds; what is not exposed stays behind More,
 * in the menu's own order.
 */
export function planExposedEntries<E extends { key: string }>(
  all: E[],
  exposable: (entry: E) => boolean,
  budget: number,
  fit: number = budget,
): { exposed: E[]; rest: E[] } {
  const chosen = all.length <= budget ? all : all.filter(exposable).slice(0, budget);
  const exposed = chosen.slice(0, Math.max(0, fit));
  const shown = new Set(exposed.map((entry) => entry.key));
  return { exposed, rest: all.filter((entry) => !shown.has(entry.key)) };
}

/** The row menu plan of the entries left behind More. */
function restPlan(plan: RowActionMenuPlan, rest: SingleRecordEntry[]): RowActionMenuPlan {
  const custom = rest.flatMap((entry) => (entry.kind === 'def' ? [entry.def] : []));
  const legacy = rest.flatMap((entry) => (entry.kind === 'legacy' ? [entry.name] : []));
  const edit = rest.some((entry) => entry.kind === 'edit');
  const remove = rest.some((entry) => entry.kind === 'delete');
  return {
    ...plan,
    inline: [],
    custom,
    legacy,
    edit,
    remove,
    menuCount: (edit ? 1 : 0) + (remove ? 1 : 0) + custom.length + legacy.length,
  };
}

const BUTTON_CLASS = 'h-8 shrink-0 gap-1.5';

/** A built-in row action (Edit or Delete) as a bar button, under the same gates as its menu item. */
const BuiltinButton: React.FC<{ menu: RowActionMenuProps; kind: 'edit' | 'delete'; label: string }> = ({
  menu, kind, label,
}) => {
  const predicates = kind === 'edit' ? menu.editPredicates : menu.deletePredicates;
  const disabledWhen = predicates?.disabledWhen;
  const disabledByPredicate = useRowPredicate(disabledWhen, menu.row, {
    fallback: false,
    warnOnError: true,
    label: `builtin:${kind}:disabledWhen`,
    fields: menu.objectFields,
  });
  const disabled = !!menu.crudVerdictPending?.[kind] || (disabledWhen != null && disabledByPredicate);
  const Icon = kind === 'edit' ? Edit : Trash2;
  return (
    <Button
      variant={kind === 'delete' ? 'destructive' : 'outline'}
      size="sm"
      className={BUTTON_CLASS}
      disabled={disabled}
      onClick={() => (kind === 'edit' ? menu.onEdit?.(menu.row) : menu.onDelete?.(menu.row))}
      data-testid={`selection-action-${kind}`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  );
};

/** The bar's More: a labelled button opening the actions that are not exposed. */
const MoreMenu: React.FC<{ label: string; children: React.ReactNode; onOpen?: () => void }> = ({ label, children, onOpen }) => (
  <DropdownMenu onOpenChange={(open) => { if (open) onOpen?.(); }}>
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        size="sm"
        className={BUTTON_CLASS}
        data-testid="selection-actions-more"
      >
        <MoreHorizontal className="h-4 w-4" />
        {label}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" side="top">{children}</DropdownMenuContent>
  </DropdownMenu>
);

const Divider: React.FC = () => <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />;

/** One selected record: its own actions, exactly as its row menu resolves them. */
const SingleRecordActions: React.FC<{ menu: RowActionMenuProps; fit: number; onCount: (n: number) => void }> = ({
  menu, fit, onCount,
}) => {
  const { t } = useObjectTranslation();
  const plan = useRowActionPlan(menu, 0);
  const all = singleRecordEntries(plan);
  const { exposed, rest } = planExposedEntries(
    all,
    // Over the budget, only declared actions and Edit become buttons: a legacy
    // `rowActions` name has no declared label (the menu title-cases its id),
    // so it stays in 「更多」 with Delete.
    (entry) => entry.kind === 'def' || entry.kind === 'edit',
    SELECTION_EXPOSED_ACTIONS,
    fit,
  );
  const { onActionsDemand } = menu;
  React.useEffect(() => {
    onActionsDemand?.();
  }, [onActionsDemand]);
  const chosenCount = Math.min(all.length, SELECTION_EXPOSED_ACTIONS);
  React.useLayoutEffect(() => onCount(chosenCount), [chosenCount, onCount]);
  if (all.length === 0) return null;
  const rest_ = restPlan(plan, rest);
  return (
    <>
      <Divider />
      {exposed.map((entry) => {
        switch (entry.kind) {
          case 'def':
            return (
              <RowActionInlineButton
                key={entry.key}
                def={entry.def}
                row={menu.row}
                objectFields={menu.objectFields}
                onActionDef={menu.onActionDef}
                buttonVariant="outline"
                buttonClassName={BUTTON_CLASS}
              />
            );
          case 'edit':
            return <BuiltinButton key={entry.key} menu={menu} kind="edit" label={t('grid.edit', { defaultValue: 'Edit' })} />;
          case 'delete':
            return <BuiltinButton key={entry.key} menu={menu} kind="delete" label={t('grid.delete', { defaultValue: 'Delete' })} />;
          default:
            return (
              <Button
                key={entry.key}
                variant="outline"
                size="sm"
                className={BUTTON_CLASS}
                onClick={() => menu.onAction?.(entry.name, menu.row)}
                data-testid={`selection-action-${entry.name}`}
              >
                {formatActionLabel(entry.name)}
              </Button>
            );
        }
      })}
      {rest_.menuCount > 0 && (
        <MoreMenu label={t('common.more', { defaultValue: 'More' })} onOpen={onActionsDemand}>
          <RowActionMenuItems plan={rest_} props={menu} />
        </MoreMenu>
      )}
    </>
  );
};

/** Two or more selected records: the bulk actions. */
const BulkActions: React.FC<{
  selectedRows: any[];
  actions: string[];
  actionDefs?: BulkActionDef[];
  objectFields?: unknown;
  onAction?: (action: string, selectedRows: any[]) => void;
  onActionDef?: (def: BulkActionDef, selectedRows: any[]) => void;
  fit: number;
  onCount: (n: number) => void;
}> = ({ selectedRows, actions, actionDefs, objectFields, onAction, onActionDef, fit, onCount }) => {
  const { t } = useObjectTranslation();
  const items = useBulkActionItems({ selectedRows, actions, actionDefs, objectFields });
  const ordered: OrderedBulkItem[] = orderSelectionMenuItems(items);
  const { exposed, rest } = planExposedEntries(ordered, (entry) => !entry.destructive, SELECTION_EXPOSED_ACTIONS, fit);
  const chosenCount = Math.min(ordered.length, SELECTION_EXPOSED_ACTIONS);
  React.useLayoutEffect(() => onCount(chosenCount), [chosenCount, onCount]);
  if (ordered.length === 0) return null;
  return (
    <>
      <Divider />
      {exposed.map((entry) =>
        entry.kind === 'def' ? (
          <BulkActionButton
            key={entry.key}
            def={entry.def}
            selectedRows={selectedRows}
            onActionDef={onActionDef}
          />
        ) : (
          <Button
            key={entry.key}
            variant={entry.destructive ? 'destructive' : 'outline'}
            size="sm"
            className={BUTTON_CLASS}
            onClick={() => onAction?.(entry.legacy.name, selectedRows)}
            data-testid={`bulk-action-${entry.legacy.name}`}
          >
            {entry.destructive && <Trash2 className="h-4 w-4" />}
            {entry.legacy.label}
          </Button>
        ),
      )}
      {rest.length > 0 && (
        <MoreMenu label={t('common.more', { defaultValue: 'More' })}>
          <SelectionActionMenuEntries
            entries={rest}
            selectedRows={selectedRows}
            onAction={onAction}
            onActionDef={onActionDef}
          />
        </MoreMenu>
      )}
    </>
  );
};

/** Is a key event's target a place where Esc belongs to the control itself? */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
}

/** An open layer (dialog, menu, listbox, popover) that does not hold `el`: Esc is that layer's. */
function anotherLayerIsOpen(el: HTMLElement | null): boolean {
  const layers = document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
  );
  for (const layer of Array.from(layers)) {
    if (!el || !layer.contains(el)) return true;
  }
  return false;
}

/**
 * objectstack#35678 — the selection bar's width holds this many exposed
 * actions: starts at `chosen`, gives one back to More while the bar's content
 * is wider than the bar, and starts over when the host's width changes. The
 * bar's own box is watched too, so a late change to what it measures (a font
 * or a stylesheet that arrives after it drew) is measured again.
 */
function useFittedCount(barRef: React.RefObject<HTMLDivElement | null>, chosen: number, key: string): number {
  const [fit, setFit] = React.useState(chosen);
  const [, remeasure] = React.useReducer((n: number) => n + 1, 0);
  React.useLayoutEffect(() => {
    setFit(chosen);
  }, [chosen, key]);
  React.useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || fit <= 0) return;
    if (bar.scrollWidth > bar.clientWidth + 1) setFit((n) => Math.max(0, n - 1));
  });
  React.useEffect(() => {
    const bar = barRef.current;
    const host = bar?.parentElement;
    if (!bar || !host || typeof ResizeObserver === 'undefined') return undefined;
    let width = host.clientWidth;
    const observer = new ResizeObserver(() => {
      if (host.clientWidth !== width) {
        width = host.clientWidth;
        setFit(chosen);
      } else {
        remeasure();
      }
    });
    observer.observe(host);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [barRef, chosen]);
  return fit;
}

export interface BulkActionBarProps {
  /** Array of selected row records */
  selectedRows: any[];
  /**
   * Bulk/batch action identifiers (legacy string list) that resolved to no
   * declared action — dispatched by name for consumers that registered a
   * runner handler under it. Names that DID resolve arrive in `actionDefs`
   * instead (see `resolveBulkActions`), so the two lists never overlap.
   */
  actions: string[];
  /** Rich action definitions — authored inline or derived from the object. */
  actionDefs?: BulkActionDef[];
  /**
   * The object's field definitions (`objectSchema.fields`). Passed to each
   * def's per-record `visible` so a relation field is bound as the FOREIGN KEY
   * the server stores rather than the record `$expand` substituted for it — the
   * selected rows come straight off the grid's expanded fetch, where every
   * relational COLUMN is an object (see `toPredicateRecord`).
   */
  objectFields?: unknown;
  /** Callback when a legacy string-id bulk action button is clicked */
  onAction?: (action: string, selectedRows: any[]) => void;
  /** Callback when a rich-def bulk action button is clicked. */
  onActionDef?: (def: BulkActionDef, selectedRows: any[]) => void;
  /** Callback to clear selection (the bar's ×, and Esc). */
  onClearSelection?: () => void;
  /**
   * The props the ONE selected row's menu renders with. Present ⇒ a selection
   * of exactly one record offers that record's own actions (its row menu's),
   * not the bulk actions.
   */
  singleRowMenu?: RowActionMenuProps;
  /**
   * Cross-page selection — number of rows currently loaded on the page.
   * When `selectedRows.length === pageSize` and `totalMatching > pageSize`,
   * the bar offers to extend the selection across the entire match set.
   */
  pageSize?: number;
  /** Total matching record count from the most recent find. */
  totalMatching?: number;
  /** True when the user has opted into the cross-page selection. */
  allMatchingSelected?: boolean;
  /** Invoked when the user clicks "Select all N". */
  onSelectAllMatching?: () => void;
}

/**
 * objectstack#35678 — the selection bar: while rows are selected, one small
 * bar floats at the bottom centre of the list it belongs to: 「已选 N 条」 and
 * ×, then the actions for what is selected (one record: its own actions; two
 * or more: the bulk actions), up to {@link SELECTION_EXPOSED_ACTIONS} as
 * labelled buttons and the rest behind More. With every loaded row selected
 * and more matching, it offers 「选择全部 N 条」. × and Esc clear the selection.
 *
 * The bar draws itself only; where it floats is its host's: the table keeps
 * room after its last row so nothing stays under it (`data-table`'s
 * `floatingBar`), and every other face of the grid floats it over the end of
 * its own scroller. Every grid draws this one bar — a list page, a record
 * page's child table, a record opened at the side, a table placed on a page.
 */
export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedRows,
  actions,
  actionDefs,
  objectFields,
  onAction,
  onActionDef,
  onClearSelection,
  singleRowMenu,
  pageSize,
  totalMatching,
  allMatchingSelected,
  onSelectAllMatching,
}) => {
  const { t } = useObjectTranslation();
  const barRef = React.useRef<HTMLDivElement | null>(null);
  const [chosen, setChosen] = React.useState(SELECTION_EXPOSED_ACTIONS);
  const count = selectedRows.length;
  const single = count === 1 && !allMatchingSelected && !!singleRowMenu;
  const fit = useFittedCount(barRef, chosen, `${single ? 'one' : 'many'}:${count}`);

  React.useEffect(() => {
    if (!onClearSelection || count === 0) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isEditableTarget(event.target) || anotherLayerIsOpen(barRef.current)) return;
      onClearSelection();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClearSelection, count]);

  if (count === 0) return null;

  const overCap = exceedsBulkSelectAllMatchingCap(totalMatching);
  const offerAll =
    !allMatchingSelected
    && !!onSelectAllMatching
    && typeof totalMatching === 'number'
    && typeof pageSize === 'number'
    && pageSize > 0
    && count >= pageSize
    && totalMatching > pageSize;

  return (
    <div
      ref={barRef}
      className="pointer-events-auto flex h-11 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-xl border border-border bg-popover pl-3 pr-1.5 text-popover-foreground shadow-lg dark:border-foreground/20 dark:shadow-black/60 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
      role="region"
      aria-label={t('grid.bulkActions', { defaultValue: 'Bulk actions' })}
      data-testid="bulk-actions-bar"
    >
      <span
        className="shrink-0 text-xs font-medium tabular-nums"
        // objectstack#28552 — the whole sentence, cap named, where the chip is short.
        title={allMatchingSelected
          ? overCap
            ? t('grid.bulkAllMatchingSelectedCapped', {
                cap: BULK_SELECT_ALL_MATCHING_CAP,
                total: totalMatching,
                defaultValue: 'Only the first {{cap}} of {{total}} matching records will be processed.',
              })
            : t('grid.bulkAllMatchingSelected', { count: totalMatching, defaultValue: 'All {{count}} matching records are selected.' })
          : undefined}
        data-testid="bulk-selection-count"
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
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground"
        onClick={onClearSelection}
        aria-label={t('grid.bulkClear', { defaultValue: 'Clear' })}
        title={t('grid.bulkClear', { defaultValue: 'Clear' })}
        data-testid="bulk-selection-clear"
      >
        <X className="h-4 w-4" />
      </Button>
      {offerAll && (
        <button
          type="button"
          className="shrink-0 rounded px-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
          onClick={onSelectAllMatching}
          data-testid="bulk-select-all-matching"
        >
          {overCap
            ? t('grid.bulkSelectAllMatchingCapped', {
                cap: BULK_SELECT_ALL_MATCHING_CAP,
                total: totalMatching,
                defaultValue: 'Select the first {{cap}} of {{total}} matching',
              })
            : t('grid.selectAllTotal', { total: totalMatching, defaultValue: 'Select all {{total}}' })}
        </button>
      )}
      {single ? (
        <SingleRecordActions menu={singleRowMenu!} fit={fit} onCount={setChosen} />
      ) : (
        <BulkActions
          selectedRows={selectedRows}
          actions={actions}
          actionDefs={actionDefs}
          objectFields={objectFields}
          onAction={onAction}
          onActionDef={onActionDef}
          fit={fit}
          onCount={setChosen}
        />
      )}
    </div>
  );
};

/**
 * Where a grid face that is not the table floats the bar: a zero-height box
 * drawn right AFTER the face's own scroller, the bar centred 12px above it.
 * Outside the scroller it sits at the scroller's bottom when the scroller is
 * bounded, and holds to the bottom of the page's own scroller when the face
 * grows with its rows (a child-table tab, the side record), as the table's
 * `floatingBar` does. Inside it, a scroller that does not scroll would hold
 * it at the end of its rows. The scroller keeps room at its end (`pb-16`) so
 * its last row scrolls clear of the bar.
 */
export const FloatingSelectionBarAnchor: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pointer-events-none sticky bottom-0 z-30 h-0" data-testid="floating-selection-bar">
    <div className="absolute inset-x-0 bottom-3 flex justify-center px-4">{children}</div>
  </div>
);
