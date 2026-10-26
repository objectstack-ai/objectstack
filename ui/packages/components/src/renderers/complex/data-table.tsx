/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Enterprise-level DataTable Component (Airtable-like)
import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { cn } from '../../lib/utils';
import { resolveIcon } from '../action/resolve-icon';
import { hasDeclaredVisibilityGate } from '../action/visibility-gate';
import { useGridFieldAuthoring } from '../../context/gridFieldAuthoring';
import { useHorizontalOverflow, HOVER_SCROLLBAR_CLASSES } from '../../custom/use-horizontal-overflow';
import { describeIgnoredBind, describeNonArrayData } from './dataTableBindDiagnostic';
import { ComponentRegistry, compareSortValues, evalRowPredicate, formatDate, hasDeclaredPredicate, formatDateTime, fromDateTimeInputValue, getSortValue, isEmptyValue, isImpossibleStoredDay, toDateInputValue, toDateTimeInputValue } from '@object-ui/core';
import type { DataTableSchema, TableColumn, TableSortItem, TableColumnType } from '@object-ui/types';
import type { SortDirection } from '@objectstack/spec/shared';
import { SchemaRenderer, toRenderableSchema, useCapabilityGate, useRowPredicate, usePredicateScope } from '@object-ui/react';
import { createSafeTranslation, useDisplayLocale } from '@object-ui/i18n';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableHead, 
  TableRow, 
  TableCell, 
  TableCaption 
} from '../../ui/table';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { 
  ChevronUp, 
  ChevronDown, 
  ChevronsUpDown,
  Search,
  Download,
  Edit,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  GripVertical,
  Save,
  X,
  Plus,
  MoreHorizontal,
  AlertCircle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

/**
 * The inline date editors read and write through `@object-ui/core`'s native
 * date adapters (`toDateInputValue` / `toDateTimeInputValue` /
 * `fromDateTimeInputValue`), the one set `@object-ui/fields`' date widgets
 * use. The table used to keep private copies of them, with no check for a
 * stored day that does not exist: a `datetime` value written on 30 February
 * showed as March 2nd and a minutes-only edit wrote that day back, and a
 * `date` value on it blanked silently (objectui#10625). A `date` field stays a
 * plain `yyyy-MM-dd` string; a `datetime` field round-trips through ISO.
 */
// Column types that should edit as a numeric `<Input type="number">`.
//
// `int` / `integer` / `float` / `double` USED to be members (`fc62bb490`).
// They were never declared by `TableColumn.type` — they arrived because
// column-inference producers forwarded an object schema's field type verbatim,
// which is also why this key had to be read through an `as any` below. Those
// producers now fold their inferred value onto the declared vocabulary at their
// emit seam (`normalizeTableColumnType`), so an undeclared spelling can no
// longer reach this set. Typed as `TableColumnType` so re-adding one is a tsc
// error rather than a silent re-opening of the undeclared dialect.
const NUMERIC_EDIT_TYPES = new Set<TableColumnType>(['number', 'currency', 'percent']);

/**
 * The identity a pending edit is kept under (objectui#12310): the record's id
 * (`row.id`, the id `getRowId` reads; a null one names no record), or, for a
 * row that carries none, the row object itself. Never a position. A pending edit used to be keyed by its
 * row's page-local index, so any re-read that put the page in a new order (a
 * row save's refresh, the data-invalidation bus, a page change) drew a kept
 * edit on whichever record now sat at that index, and Save All wrote it
 * there.
 *
 * An id-less row has no identity that survives a re-read, so its edit follows
 * the row OBJECT: it stays put through a client-side sort, filter or page
 * change, and a re-read that hands over new objects leaves it pending against
 * the object it was typed on, never against the row now in its place.
 */
type PendingRowKey = unknown;

function pendingRowKeyOf(row: unknown): PendingRowKey {
  if (row !== null && typeof row === 'object' && 'id' in row && row.id != null) return row.id;
  return row;
}

/**
 * One row's staged edits, per column key, and the row they were last staged
 * against. The row is read only when the rows the table holds no longer
 * include that record (a re-read dropped it, or it sits on another server
 * page): Save All then hands the edit over with the row it was typed on,
 * never with the row at its old position.
 */
interface PendingRow {
  row: any;
  changes: Record<string, any>;
}
type PendingChanges = Map<PendingRowKey, PendingRow>;

/** The cell an inline editor is open on, and the row it was opened on. */
interface EditingCell {
  rowKey: PendingRowKey;
  columnKey: string;
  row: any;
}

/** A decimal numeral, as a number `<input>` hands it back — never hex, `Infinity` or blank. */
const DECIMAL_NUMERAL = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

/** A number and the decimal string that spells it (`5` and `'5.0'`) are one value. */
function isSameCellScalar(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'number' && typeof b === 'string') {
    const s = b.trim();
    return DECIMAL_NUMERAL.test(s) && Number(s) === a;
  }
  if (typeof b === 'number' && typeof a === 'string') return isSameCellScalar(b, a);
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}

/**
 * Whether a value an inline editor hands back is the value the row LOADED with
 * (objectui#11816) — the one question that decides whether a cell is staged as
 * an edit. Before this, every commit was staged, so clicking into a cell and
 * out again showed "1 row modified · Save All (1)" for a row nobody changed.
 *
 * Each rule answers a round trip the editors measurably make:
 *
 * - **The emptiness floor** (`isEmptyValue`, `@object-ui/core`): `null`,
 *   `undefined`, `''` and `[]` are one blank here. `startEdit` seeds the
 *   editor with `''` for a cell that loaded `null`, so a text cell left as it
 *   was hands back `''`, and an emptied multi-select hands back `[]`.
 * - **A number against its decimal string**: the built-in number editor stores
 *   the `<input>`'s string, so retyping `5` over a loaded `5` hands back `'5'`.
 * - **A multi-value set in another order**: toggling an option off and on
 *   again appends it, so `['a', 'b']` comes back as `['b', 'a']`.
 * - **Two objects that serialize alike** are the same value.
 *
 * ⚠️ The failure direction is asymmetric, as `isSameStoredValue` in
 * `@object-ui/plugin-form` says of its own rule: "unchanged" about a changed
 * pair drops the user's edit, "changed" about an equal pair costs one redundant
 * write. So nothing else is equal — in particular a select's stored code is
 * never compared with an option LABEL: the table holds no options, and the
 * option widgets hand back `option.value`, the code the row stores.
 */
function isUnchangedCellValue(staged: unknown, loaded: unknown): boolean {
  if (isEmptyValue(staged) && isEmptyValue(loaded)) return true;
  if (Array.isArray(staged) && Array.isArray(loaded)) {
    if (staged.length !== loaded.length) return false;
    const unmatched = [...loaded];
    return staged.every((item) => {
      const at = unmatched.findIndex((other) => isSameCellScalar(item, other));
      if (at < 0) return false;
      unmatched.splice(at, 1);
      return true;
    });
  }
  return isSameCellScalar(staged, loaded);
}

/**
 * `prev` with one cell's edit staged — or, when `value` is the loaded value,
 * with that cell's entry REMOVED, and the row's with it once nothing else is
 * staged on it (objectui#11816). That is what makes staging a value back to
 * the loaded one un-mark the row. Returns `prev` itself when nothing changes,
 * so a no-op commit schedules no state update.
 *
 * The edit is kept under the record's key, with `row` (the row it is staged
 * against, whose own value for the column is the loaded one) as its snapshot
 * (objectui#12310).
 *
 * `inFlight` is what a running save sent for this record (objectui#12322).
 * While a save of the cell is in flight, the record will hold the value sent,
 * or the loaded one if the save fails, so no commit there is called
 * unchanged: it is staged, and the save's settle (`removeSentEdits`) decides
 * what stays. Otherwise a cell re-edited back to its loaded value during its
 * save would be dropped here, and the save would then write the old edit.
 */
function stageCellChange(
  prev: PendingChanges,
  rowKey: PendingRowKey,
  row: any,
  columnKey: string,
  value: unknown,
  inFlight?: Record<string, unknown>,
): PendingChanges {
  const current = prev.get(rowKey);
  const unchanged = !(inFlight && columnKey in inFlight) && isUnchangedCellValue(value, row?.[columnKey]);
  if (unchanged && !(current && columnKey in current.changes)) return prev;
  const next = new Map(prev);
  const rowChanges = { ...(current?.changes || {}) };
  if (unchanged) delete rowChanges[columnKey];
  else rowChanges[columnKey] = value;
  if (Object.keys(rowChanges).length > 0) next.set(rowKey, { row, changes: rowChanges });
  else next.delete(rowKey);
  return next;
}

/**
 * The pending edits once a save of `sent` (record key -> the changes it
 * handed over) has landed (objectui#12322). For each record sent, each column
 * whose staged value is still the very value sent is removed, and the
 * record's entry goes once nothing else is staged on it. Everything else
 * stays: an edit staged on another record during the save, another column
 * staged on the record being saved, a new value for a column being saved.
 *
 * It is applied as a `setPendingChanges` updater, to the edits as they stand
 * when the save settles. Applied to the copy read when the save was pressed,
 * it would drop every edit made during the round trip, with no signal.
 *
 * "Still the value sent" means the same value (`Object.is`), not
 * `isUnchangedCellValue`'s equality. The question here is whether the cell was
 * staged again since it was sent. A value staged again with an equal copy (a
 * lookup picked again) stays pending, which costs at most one redundant
 * write. An equality judged too loosely would drop an edit instead.
 *
 * Returns `prev` itself when nothing is removed.
 */
function removeSentEdits(
  prev: PendingChanges,
  sent: ReadonlyMap<PendingRowKey, Record<string, unknown>>,
): PendingChanges {
  let next: PendingChanges | null = null;
  for (const [rowKey, sentChanges] of sent) {
    const current = prev.get(rowKey);
    if (!current) continue;
    const remaining = { ...current.changes };
    let removed = false;
    for (const columnKey of Object.keys(sentChanges)) {
      if (columnKey in remaining && Object.is(remaining[columnKey], sentChanges[columnKey])) {
        delete remaining[columnKey];
        removed = true;
      }
    }
    if (!removed) continue;
    next ??= new Map(prev);
    if (Object.keys(remaining).length > 0) next.set(rowKey, { row: current.row, changes: remaining });
    else next.delete(rowKey);
  }
  return next ?? prev;
}

/**
 * Human label for an object/array cell value (e.g. an expanded reference like
 * `{ id, name: 'Dev Admin' }`) shown in the read-only inline editor so we never
 * render "[object Object]". Mirrors @object-ui/fields' `coerceToSafeValue`
 * (which @object-ui/components can't import — it would be a circular dep).
 */
function safeObjectLabel(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        v != null && typeof v === 'object'
          ? safeObjectLabel(v)
          : String(v),
      )
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return String(o.name ?? o.label ?? o.externalId ?? o.id ?? o._id ?? '');
  }
  return String(value);
}

// Default English fallback translations for the data table
const TABLE_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'table.rowsPerPage': 'Rows per page',
  'table.pageInfo': 'Page {{current}} of {{total}}',
  // objectui#12124 — the pager's four icon buttons' accessible names.
  'table.firstPage': 'First page',
  'table.previousPage': 'Previous page',
  'table.nextPage': 'Next page',
  'table.lastPage': 'Last page',
  'table.totalRecords': '{{count}} total',
  'table.noResults': 'No results found',
  'table.noResultsHint': 'Try adjusting your filters or search query.',
  'table.sortAsc': 'Sort ascending',
  'table.sortDesc': 'Sort descending',
  'table.hideColumn': 'Hide column',
  'table.cancelAll': 'Cancel All',
  'table.saveAll': 'Save All ({{count}})',
  'table.exportCSV': 'Export CSV',
  'table.addRecord': 'Add record',
  'table.open': 'Open',
  'table.search': 'Search…',
  'table.modified': '{{count}} row modified',
  // A count family (objectui#11445): `fallbackT` reads the `_one` / `_other`
  // row for a numeric `count`, as i18next reads the `en` pack.
  'table.modified_one': '{{count}} row modified',
  'table.modified_other': '{{count}} rows modified',
  'table.saveFailed': 'Save failed',
  'table.selected': '{{count}} selected',
  // objectui#11690 — the selection checkboxes' accessible names.
  'table.selectAllRows': 'Select all rows',
  'table.selectRow': 'Select row',
  // objectui#12145 — the row menu trigger's accessible name.
  'table.rowActions': 'Row actions',
  'table.edit': 'Edit',
  'table.delete': 'Delete',
  'common.actions': 'Actions',
  // objectui#10625 — the inline date editors' notice for a stored value
  // written on a day that does not exist. The SAME keys `DateField` /
  // `DateTimeField` use, with the `en` pack's values, for provider-less
  // rendering.
  'fields.date.impossibleDay':
    'The stored value "{{value}}" is not a real date. Pick a date to replace it.',
  'fields.dateTime.impossibleDay':
    'The stored value "{{value}}" is not a real date. Pick a date and time to replace it.',
};

/**
 * Safe wrapper for useObjectTranslation that falls back to English defaults
 * when I18nProvider is not available (e.g., standalone usage).
 *
 * Delegates to `@object-ui/i18n`'s `createSafeTranslation`; the local copy
 * this replaced wrapped the hook in try/catch (rules-of-hooks, objectui#2879).
 * Only the COPY comes from here: the date cells below format with
 * `useDisplayLocale()`, never with the `language` this hook also reports
 * (objectui#10442).
 */
const useTableTranslation = createSafeTranslation(TABLE_DEFAULT_TRANSLATIONS, 'table.rowsPerPage');

/**
 * Pull the most useful human-readable message out of whatever the save path
 * threw. The ObjectStack adapter decorates thrown errors with the parsed
 * response body on `details` (e.g. a `{ message, error }` from a validation
 * failure), so prefer that; fall back to `error.message`, then a raw string.
 * Never returns empty — callers render it as the save-failure reason.
 */
function extractSaveErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; details?: { message?: unknown; error?: unknown } };
    const detail = e.details && (e.details.message ?? e.details.error);
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
    if (typeof e.message === 'string' && e.message.trim()) return e.message.trim();
  }
  return typeof error === 'string' && error.trim() ? error.trim() : 'Unknown error';
}

/**
 * The element type of `DataTableSchema.rowActionDefs`. Derived via indexed
 * access rather than imported by name: `@object-ui/types` defines
 * `DataTableRowAction` but doesn't re-export it from its public entry, so it's
 * only reachable structurally through `DataTableSchema`.
 */
type RowActionDef = NonNullable<DataTableSchema['rowActionDefs']>[number];
/** The element type of `DataTableSchema.rowGroups` (objectui#12620). */
type RowGroup = NonNullable<DataTableSchema['rowGroups']>[number];

/**
 * The per-row outcome `onBatchSave` may resolve with (objectui#12292), derived
 * from the slot's declared return rather than restated here.
 */
type BatchSaveOutcome = Exclude<
  Awaited<ReturnType<NonNullable<DataTableSchema['onBatchSave']>>>,
  void
>;

/**
 * The authoring shape of the built-in row Edit/Delete predicates — derived from
 * `DataTableSchema`, never restated by hand (objectui#4354). Everything below
 * reads what the production caller hands it (`schema.rowEditPredicates` /
 * `rowDeletePredicates`), so a hand-written `{ visibleWhen?: unknown; … }` here
 * would be a second definition of one authoring shape, free to drift from the
 * type it is supposed to mirror without a single test going red.
 *
 * The union of the two twins is deliberate: every consumer below serves BOTH
 * built-ins (`name: 'edit' | 'delete'`), so it may only read keys that BOTH
 * schema keys declare — if either twin dropped one, the read stops compiling
 * instead of silently reading `undefined`.
 */
type BuiltinRowPredicates = NonNullable<
  DataTableSchema['rowEditPredicates'] | DataTableSchema['rowDeletePredicates']
>;

/**
 * Evaluate a row-action visibility predicate the way the row menu's items do —
 * on the canonical CEL engine, failing CLOSED with a diagnosable warning — but
 * WITHOUT a hook.
 *
 * Hook-free matters because the row-level guard below asks this question for a
 * VARIABLE number of custom actions inside a single `useMemo`; one
 * `useRowPredicate` per action would tie the hook count to
 * `schema.rowActionDefs.length`. Mirrors
 * `useRowPredicate(pred, row, { fallback: false, warnOnError: true, label })`,
 * boolean short-circuit included — a boolean handed to the engine faults
 * ("AST-only evaluation not yet supported") and fails closed, which is how
 * `visible: true` once hid a bulk button from everyone (objectui#3492; the same
 * short-circuit is spelled out in plugin-grid's `bulkEligibility`).
 */
function evalRowActionVisibility(
  pred: unknown,
  row: any,
  scope: Record<string, unknown>,
  label: string,
  fields?: unknown,
): boolean {
  if (typeof pred === 'boolean') return pred;
  // Not dead, and not the place that decides "was a gate declared?" — the two
  // callers below answer that first, each by its own rule. `''` still arrives
  // here from `isBuiltinRowActionVisible`, whose gate is `!= null` alone; a
  // nothing-to-evaluate predicate that reached an evaluator fails CLOSED like
  // any other unevaluable one.
  if (pred == null || pred === '') return false;
  return evalRowPredicate(pred as never, row ?? {}, {
    fallback: false,
    scope,
    warnOnError: true,
    label,
    // Only plugin-grid's row menu passes the object's fields (see
    // `isCustomRowActionVisible`). This file's own callers pass none, and
    // `undefined` keeps the row payload verbatim, as before.
    fields: fields as never,
  });
}

/**
 * Does the built-in Edit/Delete item render for THIS row? The single
 * definition, read both by the item itself and by the row-level guard that
 * decides whether the "⋮" trigger exists at all. The two disagreeing is
 * objectui#3562: the guard counted handlers, the items were then filtered by
 * these predicates, and a row with every item suppressed still got a trigger
 * that opened an empty 128×10 box.
 *
 * `visibleWhen` counts as a declared gate by `!= null`, not by truthiness —
 * `visibleWhen: false` hides the item rather than reading as "ungated".
 *
 * The parameter is consumption-shaped — visibility is all this decides, so
 * `disabledWhen` is deliberately absent — but `Pick`ed from the authoring type
 * rather than hand-written, so it is a SUBSET of that type by construction
 * (objectui#4354).
 */
export function isBuiltinRowActionVisible(
  predicates: Pick<BuiltinRowPredicates, 'visibleWhen'> | undefined,
  name: 'edit' | 'delete',
  row: any,
  scope: Record<string, unknown>,
): boolean {
  const pred = predicates?.visibleWhen;
  if (pred == null) return true;
  return evalRowActionVisibility(pred, row, scope, `builtin:${name}:visibleWhen`);
}

/**
 * Does this schema-driven custom row action render for THIS row? Same
 * single-definition rule as the built-ins above, and the ONE definition for
 * every row menu: this file's (the related list's data table) and
 * plugin-grid's `RowActionMenu` (its "⋮" items, its inline primary buttons and
 * its "⋮" guard), which imports it from the `@object-ui/components` barrel
 * rather than keeping a twin (objectui#11294).
 *
 * Whether a gate is DECLARED at all is asked with `hasDeclaredVisibilityGate`,
 * the action family's one definition (objectui#3812): the related list's
 * toolbar, `action:*`, `DeclaredActionsBar` and the rest ask it too, so an
 * action cannot show in a list's header and be missing from its rows.
 *
 * - `visible: false` is a declared gate that excludes every row. Truthiness
 *   cannot answer the question: testing `!action.visible` read it as ungated
 *   and rendered the item for everyone (objectui#3758). The boolean then
 *   decides in {@link evalRowActionVisibility}, which short-circuits it instead
 *   of handing it to the engine.
 * - A blank predicate is no gate, so the action shows: `''`, a whitespace-only
 *   string, and an envelope whose `source` is blank. The blank is still
 *   reported (ADR-0137 D4) through the family's one `[blank]` report, once per
 *   blank spelling rather than once per row. This test used to be
 *   `pred == null || pred === ''`, so a whitespace-only `visible` counted as
 *   declared, was evaluated, and failed closed: the action showed in a related
 *   list's toolbar and was missing from its rows (objectui#11294).
 * - A value that is not a predicate at all (`0`, `{}`, an array, an
 *   `ast`-only envelope) IS a declared gate, one that cannot be evaluated
 *   (objectui#11358): the family's definition answers "declared", the row fold
 *   faults on it and fails closed, so the action is hidden and the fault is
 *   reported — as on every other member of the family.
 *
 * `fields` is the object's field definitions, for a caller that has them:
 * plugin-grid passes them so a relation compares as its stored foreign key
 * (see `evalRowPredicate`). This file's own callers pass none.
 */
export function isCustomRowActionVisible(
  action: { name?: string; visible?: unknown } | undefined,
  row: any,
  scope: Record<string, unknown>,
  fields?: unknown,
): boolean {
  const pred = action?.visible;
  if (!hasDeclaredVisibilityGate(pred)) return true;
  return evalRowActionVisibility(pred, row, scope, action?.name ?? 'row-action', fields);
}

/** What the row overflow menu will actually render for ONE row. */
export interface DataTableRowMenuPlan {
  /** The built-in Edit item renders for this row. */
  edit: boolean;
  /** The built-in Delete item renders for this row. */
  remove: boolean;
  /** Custom actions surviving their own `visible` predicate, in declared order. */
  custom: RowActionDef[];
  /** Items that will render. `0` means: render no trigger at all (#3562). */
  count: number;
}

/**
 * Resolve the row overflow menu for ONE row — which items survive their
 * per-record predicates, and how many that leaves.
 *
 * Per ROW, not per table: `visibleWhen` / `visible` are per-record predicates,
 * so two rows of the same table legitimately differ (one keeps Edit, the next
 * has nothing left). A table-level guard cannot express that, which is why the
 * trigger decision lives here and is recomputed for every row.
 *
 * Only visibility is decided here — a `disabled` item still renders (greyed
 * out) and still counts, exactly as before. That counting is pinned where it
 * can be OBSERVED, on the rendered menu, by
 * `data-table-row-menu-empty-guard.test.tsx`'s "keeps the trigger for a row
 * whose only item renders merely DISABLED".
 *
 * The predicate parameters are consumption-shaped — this function reads
 * `visibleWhen` and nothing else, and the signature keeps saying so — but each
 * is `Pick`ed from the authoring key its production caller passes, rather than
 * hand-restated (objectui#4354). Same subset, minus the drift: a rename in
 * `@object-ui/types` fails here at compile time instead of leaving a stale
 * hand-copy that still type-checks against nothing.
 */
export function planDataTableRowMenu(input: {
  onRowEdit?: unknown;
  onRowDelete?: unknown;
  editPredicates?: Pick<NonNullable<DataTableSchema['rowEditPredicates']>, 'visibleWhen'>;
  deletePredicates?: Pick<NonNullable<DataTableSchema['rowDeletePredicates']>, 'visibleWhen'>;
  customActions: readonly RowActionDef[];
  row: any;
  scope: Record<string, unknown>;
}): DataTableRowMenuPlan {
  const { row, scope } = input;
  const edit = !!input.onRowEdit && isBuiltinRowActionVisible(input.editPredicates, 'edit', row, scope);
  const remove = !!input.onRowDelete && isBuiltinRowActionVisible(input.deletePredicates, 'delete', row, scope);
  const custom = input.customActions.filter((action) => isCustomRowActionVisible(action, row, scope));
  return {
    edit,
    remove,
    custom,
    count: (edit ? 1 : 0) + (remove ? 1 : 0) + custom.length,
  };
}

/**
 * One schema-driven custom row action in the data-table's inline row overflow
 * menu. Extracted into its own component so the action's `visible` (and
 * `disabled`) CEL predicate can be evaluated with a hook (`useCondition`)
 * without violating the rules-of-hooks inside a `.map()`.
 *
 * Mirrors `RowActionMenuItem` on the ObjectGrid path so BOTH row-menu
 * renderers honor `visible`/`disabled` identically. Previously this path
 * (used by a detail page's related list) rendered every custom action
 * unconditionally, so e.g. a member row's "Transfer Ownership"
 * (`visible: "record.role != 'owner' && …"`) showed on the owner's own row.
 *
 * Bare field references (`role`) resolve against the row record and `record.`
 * references (`record.role`) against the same, while `features`/`user` come
 * from the ambient ExpressionProvider scope — so gating stays consistent with
 * the grid's own row menu.
 *
 * Exported for unit tests — NOT part of the package's public API: the
 * `@object-ui/components` barrel only side-effect-imports this module (to run
 * its `ComponentRegistry.register`), so this named export is reachable solely
 * via the deep module path the colocated test uses.
 */
export const DataTableRowActionItem: React.FC<{
  action: RowActionDef;
  row: any;
  onActionDef?: (action: RowActionDef, row: any) => void | Promise<void>;
}> = ({ action, row, onActionDef }) => {
  // Evaluate on the canonical CEL engine (issue #1584): row bound as
  // `record.*`, ambient `features`/`current_user` scope merged. Both keys fail
  // CLOSED, each in its own direction: a `visible` that faults hides the item,
  // a `disabled` that faults DISABLES it, and both warn.
  //
  // `disabled` used to fail soft (not disabled), so `disabled:
  // !current_user.can(…)` left the item pressable until the permissions
  // payload arrived (objectui#11242 — Rider 1 of objectui#4421). Same
  // mechanism as `page:header` (objectui#11212) and plugin-grid's
  // `RowActionMenuItem`: the key's fail direction is the evaluator's
  // `fallback`, per key rather than a `can()` special case, and since that
  // fallback also answers an ABSENT predicate the verdict only counts where a
  // gate is DECLARED. The built-in `disabledWhen` below stays fail-soft.
  //
  // `visible` goes through the shared `isCustomRowActionVisible` — the SAME
  // function the row-level guard uses to decide whether this row gets a "⋮"
  // trigger at all, so an item can never be suppressed behind a trigger that
  // survived (objectui#3562).
  const scope = usePredicateScope();
  const isVisible = useMemo(() => isCustomRowActionVisible(action, row, scope), [action, row, scope]);
  const disabledVerdict = useRowPredicate(action.disabled, row, { fallback: true, warnOnError: true, label: `${action.name}:disabled` });
  const isDisabled = hasDeclaredPredicate(action.disabled) && disabledVerdict;
  if (!isVisible) return null;
  const ActionIcon = resolveIcon(action.icon);
  return (
    <DropdownMenuItem
      disabled={isDisabled}
      onClick={() => { if (!isDisabled) void onActionDef?.(action, row); }}
      data-testid={`row-action-${action.name}`}
      className={cn(
        action.variant === 'danger' && 'text-destructive focus:text-destructive',
      )}
    >
      {/* Dynamic icon resolution from Lucide, not component creation during render */}
      {/* eslint-disable-next-line react-hooks/static-components */}
      {ActionIcon && <ActionIcon className="mr-2 h-4 w-4" />}
      {action.label || action.name}
    </DropdownMenuItem>
  );
};

/**
 * A built-in Edit/Delete item in the data-table's row overflow menu, gated by
 * the per-record CEL predicates from the object's `userActions.edit` /
 * `delete` object form (objectui#2614) — `schema.rowEditPredicates` /
 * `rowDeletePredicates`. Mirrors `BuiltinRowActionItem` on the ObjectGrid
 * path so BOTH row-menu renderers honor the predicates identically (the
 * related-list case is where the master-detail scenario from the issue
 * actually renders). Same posture: `visibleWhen` fails CLOSED, `disabledWhen`
 * fails soft. Evaluation only happens when the menu is open (Radix mounts
 * content lazily), so declared predicates cost nothing at table render time.
 *
 * Exported for unit tests — NOT part of the package's public API (the barrel
 * only side-effect-imports this module; see `DataTableRowActionItem`).
 */
export const DataTableBuiltinRowActionItem: React.FC<{
  name: 'edit' | 'delete';
  /**
   * The whole authoring pair, because this component reads both keys — derived
   * from `DataTableSchema` rather than hand-copied (objectui#4354).
   */
  predicates?: BuiltinRowPredicates;
  row: any;
  icon: React.ReactNode;
  label: string;
  className?: string;
  onSelect: (row: any) => void;
}> = ({ name, predicates, row, icon, label, className, onSelect }) => {
  // `visibleWhen` is read through the shared `isBuiltinRowActionVisible`, the
  // same function the row-level guard counts with — see objectui#3562.
  const scope = usePredicateScope();
  const isVisible = useMemo(
    () => isBuiltinRowActionVisible(predicates, name, row, scope),
    [predicates, name, row, scope],
  );
  const isDisabled = useRowPredicate(predicates?.disabledWhen, row, {
    fallback: false,
    warnOnError: true,
    label: `builtin:${name}:disabledWhen`,
  });
  if (!isVisible) return null;
  const disabled = predicates?.disabledWhen != null && isDisabled;
  return (
    <DropdownMenuItem
      disabled={disabled}
      onClick={() => { if (!disabled) onSelect(row); }}
      data-testid={`row-action-builtin-${name}`}
      className={className}
    >
      {icon}
      {label}
    </DropdownMenuItem>
  );
};

/**
 * The row overflow ("⋮") menu for ONE row — trigger included, or nothing at all.
 *
 * A component per row rather than inline JSX in the row loop, because deciding
 * whether the trigger exists means evaluating THIS row's predicates, and that
 * needs a hook scope of its own (the row loop's arity is the page's row count).
 *
 * objectui#3562: the old guard asked whether HANDLERS were supplied
 * (`onRowEdit` / `onRowDelete` / `rowActionDefs`) while the items were filtered
 * a second time by their per-record predicates. Handlers present + every item
 * suppressed = a trigger that opens an empty box (measured at 128×10 with zero
 * `[role=menu]` children). The guard now counts the items that will actually
 * render, so the two can't disagree.
 *
 * The actions `<TableCell>` around this is NOT conditional: a row with no
 * surviving actions renders an empty cell, keeping every row aligned with the
 * `Actions` header — the same shape a table with no handlers at all has always
 * produced.
 */
const DataTableRowActionsMenu: React.FC<{
  schema: DataTableSchema;
  row: any;
  t: (key: string) => string;
}> = ({ schema, row, t }) => {
  const scope = usePredicateScope();
  /**
   * [ADR-0066 D4 / objectui#9623] The capability gate, applied ONCE to the
   * whole declared set so `plan.count` (the "⋮" trigger) and the items it
   * renders agree — the objectui#3562 invariant, and verbatim the posture
   * `plugin-grid`'s `RowActionMenu` already takes for the standalone grid.
   *
   * This surface filters its own action list instead of routing through
   * `ActionEngine.getActionsForLocation`, so the engine's gate never reached
   * it. That left `requiredPermissions` INERT on every `list_item` action a
   * data-table renders — the record page's related-list panel above all, which
   * feeds a child object's `list_item` actions in as `rowActionDefs`
   * (`RelatedRecordActionsBridge`). The record surface one level up gates the
   * same declaration correctly, off the SAME `<ActionProvider>` this hook
   * reads: the capability was on the page all along, this renderer just never
   * asked (objectui#9623, cloud#2224 — a plain member was offered Set as
   * Primary and read a 403 toast on click).
   *
   * A UI MIRROR of a decision the server still enforces, nothing more: unknown
   * capabilities fail OPEN (see `useCapabilityGate`), an EMPTY held set gates
   * normally, and the server remains the authority.
   *
   * Custom defs are only dispatchable when there is a handler to dispatch them
   * to, so an unhandled `rowActionDefs` contributes no items (unchanged).
   */
  const mayInvoke = useCapabilityGate();
  const customActions = useMemo(
    () =>
      Array.isArray(schema.rowActionDefs) && schema.onRowActionDef
        ? schema.rowActionDefs.filter((d) => mayInvoke(d.requiredPermissions))
        : [],
    [schema.rowActionDefs, schema.onRowActionDef, mayInvoke],
  );
  const plan = useMemo(
    () =>
      planDataTableRowMenu({
        onRowEdit: schema.onRowEdit,
        onRowDelete: schema.onRowDelete,
        editPredicates: schema.rowEditPredicates,
        deletePredicates: schema.rowDeletePredicates,
        customActions,
        row,
        scope,
      }),
    [
      schema.onRowEdit,
      schema.onRowDelete,
      schema.rowEditPredicates,
      schema.rowDeletePredicates,
      customActions,
      row,
      scope,
    ],
  );
  // Nothing to show → no trigger. An affordance that opens empty reads as a
  // broken page, which is the whole of #3562.
  if (plan.count === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          // objectui#12423 — shown on row hover, on focus-within, on a selected
          // row, while its menu is open and on a coarse pointer; hidden by
          // OPACITY only, so it keeps its Tab stop and its accessible name.
          // `RowActionMenu` (`@object-ui/plugin-grid`) carries the same set.
          className="h-8 w-8 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[state=selected]/row:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          onClick={(e) => e.stopPropagation()}
          aria-label={t('table.rowActions')}
          data-testid="data-table-row-actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {plan.edit && (
          <DataTableBuiltinRowActionItem
            name="edit"
            predicates={schema.rowEditPredicates}
            row={row}
            icon={<Edit className="mr-2 h-4 w-4" />}
            label={t('table.edit')}
            onSelect={(r) => schema.onRowEdit?.(r)}
          />
        )}
        {/* Child-object custom actions (e.g. a related list surfacing the
            child's `list_item` actions). Dispatched with the clicked row.
            Separators are placed off the SURVIVING groups, so a suppressed
            group can no longer leave a stray rule behind. */}
        {plan.custom.length > 0 && plan.edit && <DropdownMenuSeparator />}
        {plan.custom.map((action) => (
          <DataTableRowActionItem
            key={action.name}
            action={action}
            row={row}
            onActionDef={schema.onRowActionDef}
          />
        ))}
        {plan.remove && (plan.edit || plan.custom.length > 0) && <DropdownMenuSeparator />}
        {plan.remove && (
          <DataTableBuiltinRowActionItem
            name="delete"
            predicates={schema.rowDeletePredicates}
            row={row}
            icon={<Trash2 className="mr-2 h-4 w-4" />}
            label={t('table.delete')}
            className="text-destructive focus:text-destructive"
            onSelect={(r) => schema.onRowDelete?.(r)}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * The selection modes this table implements — the renderer half of the spec's
 * `SelectionConfigSchema.type` vocabulary (`ui/view.zod.ts`). Kept as an
 * explicit export so a parity test can fail the moment either side moves
 * (#2941; template: plugin-grid `summary-spec-parity.test.ts`).
 */
export const SUPPORTED_SELECTION_MODES: ReadonlySet<string> = new Set(['none', 'single', 'multiple']);

type SelectionMode = 'none' | 'single' | 'multiple';

/**
 * Resolve the `selectable` prop — `boolean | 'single' | 'multiple'` (plus
 * `'none'` arriving verbatim from raw SDUI JSON) — to a selection mode.
 * `'single'` is a real mode (replace-on-select, no select-all), not a truthy
 * alias for `'multiple'`; collapsing the two rendered per-row checkboxes AND
 * a select-all header for `selection.type: 'single'` (#2941). Legacy `true`
 * and unrecognized truthy strings keep their historical multi-select meaning.
 */
function resolveSelectionMode(selectable: DataTableSchema['selectable'] | 'none'): SelectionMode {
  if (selectable === 'single') return 'single';
  if (selectable === 'none' || !selectable) return 'none';
  return 'multiple';
}

/**
 * Shared empty fallbacks for the `columns` / `data` props (objectui#4618).
 *
 * A destructuring default (`columns: rawColumns = []`) or an inline fallback
 * (`Array.isArray(raw) ? raw : []`) evaluates a FRESH array on every render, so
 * an absent prop churns identity on a schema that never changed. Downstream
 * that identity is a `useMemo` key and — for `columns` — a `useEffect` key whose
 * body writes state, which closes a self-sustaining render loop: the table's own
 * re-render regenerates the literal that scheduled it. Hoisting the empties to
 * module scope makes "absent" a stable value, so the memo and the effect see
 * what is actually true — nothing changed.
 *
 * Frozen so a consumer that mutates the array it was handed cannot corrupt the
 * shared instance for every other table on the page.
 */
const EMPTY_COLUMNS = Object.freeze([]) as unknown as DataTableSchema['columns'];
const EMPTY_ROWS = Object.freeze([]) as unknown as DataTableSchema['data'];

/**
 * Value-equality over two normalized column lists (objectui#4618).
 *
 * The prop→state sync below re-seeds `columns` whenever `initialColumns` is a
 * new object. That is the right trigger for a real change and the wrong one for
 * identity churn, which every consumer that derives its columns per render
 * produces — `ObjectDataTable` and both dashboard surfaces build the node fresh
 * on each of their renders. Comparing the values instead lets the sync stay
 * exactly as eager as before for genuine edits (a renamed header, an added
 * column, a hidden one) while a re-derived-but-identical list costs nothing.
 *
 * Shallow per column, on purpose: column entries carry render functions
 * (`cell`, `render`), and comparing those by identity is what the sync already
 * did — deep-comparing them is neither possible nor wanted.
 */
function columnsAreEquivalent(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((col, i) => {
    const other = b[i];
    if (col === other) return true;
    if (!col || !other || typeof col !== 'object' || typeof other !== 'object') return false;
    const left = col as Record<string, unknown>;
    const right = other as Record<string, unknown>;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((k) => Object.is(left[k], right[k]));
  });
}

/**
 * Is the column under `accessorKey` MASKED (objectui#10657)? The one reading
 * of `TableColumn.masked` for the table's client search, its client sort and
 * its sort controls. The producer decides the flag; this only reads it.
 *
 * It reads the columns the producer handed the table on THIS render, not the
 * `columns` state. That state is re-seeded from them one commit later, and it
 * drops a column the reader hid. So a flag the producer has just stamped
 * counts at once, and a hidden column keeps its answer.
 *
 * Fail closed: a key that names none of those columns cannot be told apart
 * from a masked one, so it answers `true`.
 */
function isMaskedColumnKey(columns: readonly TableColumn[], accessorKey: string): boolean {
  const column = columns.find((col) => col?.accessorKey === accessorKey);
  return !column || column.masked === true;
}

/**
 * A row tint reaching the row's STICKY cells (objectui#12375).
 *
 * A row may carry a tint as the `--os-row-tint` custom property: `ObjectGrid`'s
 * `rowColor` does, through `rowClassName` (`useRowColor` in
 * `@object-ui/plugin-grid`). The row paints it through its own background, but
 * a sticky cell paints an opaque `bg-background` of its own, because content
 * scrolls beneath it, so the tint stopped at the selection checkbox, the row
 * number and every frozen column. This layers the same tint over that opaque
 * fill as a background image: the cell shows the row's colour and stays
 * opaque in both themes, even where the tint itself is translucent.
 *
 * Every row sets `--os-row-tint: transparent` unless its `rowClassName` sets a
 * tint, and suspends it while hovered or selected, when the row's own fill
 * gives way to the hover and selection fills. So an untinted row's sticky
 * cells paint `bg-background` alone, as before, and a tint never outlives the
 * row's own. A right-pinned column's cells carry the same literal from their
 * producer (`ObjectGrid`'s right-pinned cell classes).
 *
 * One complete literal: Tailwind v4 builds only from scanned source text.
 */
const STICKY_ROW_TINT =
  'bg-[image:linear-gradient(var(--os-row-tint,transparent),var(--os-row-tint,transparent))]';

/**
 * objectui#13188 — whether the viewer has selected text that touches `el`.
 * A drag that selects text ends in a `click` on the row or cell it started
 * in, so the row's open-record and the cell's start-edit read this first
 * and stand down: the gesture was a selection, not an activation. A plain
 * click collapses any earlier selection on mousedown, so it still activates.
 */
function hasTextSelectionIn(el: Element): boolean {
  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  if (selection.toString().trim() === '') return false;
  return selection.getRangeAt(0).intersectsNode(el);
}

/**
 * A right-pinned column: its sticky utilities arrive on `col.className` (the
 * auto-pinned row-actions column, and an author's `pinned: 'right'`, both
 * from `ObjectGrid`).
 */
function isPinnedRightColumn(col: { className?: unknown }): boolean {
  return typeof col.className === 'string'
    && /\bsticky\b/.test(col.className)
    && /\bright-0\b/.test(col.className);
}

/**
 * The attribute an auto-sized column's header label and display cells carry,
 * naming the column (its `accessorKey`), so the auto-width estimate can read
 * back what they drew (objectui#11682). The two JSX sites spell it literally;
 * the read below selects by this constant.
 */
const AUTO_WIDTH_ATTR = 'data-auto-width-key';

/**
 * The column an auto-width target names: only one the estimate sizes (no
 * explicit `width`, not `fitContent`), and never a masked one, whose values
 * the estimate does not read (objectui#10657). A chip column is read with an
 * explicit `width` too: its chips floor that width (objectui#12708).
 */
function autoWidthKey(col: TableColumn): string | undefined {
  return (!col.width || col.chips === true) && !col.fitContent && !col.masked ? col.accessorKey : undefined;
}

/**
 * What an auto-sized column's header and cells DREW, read back from the
 * rendered table (objectui#11682). Keyed by `accessorKey`.
 */
type DrawnColumnSizes = {
  /** Longest drawn cell text, in characters: the estimate's input where nothing is laid out. */
  chars: Record<string, number>;
  /**
   * Width, in px, that renders the column's widest drawn cell and its header
   * whole, padding and borders included; `null` where nothing is laid out
   * (no layout engine, or a table inside a hidden panel).
   */
  px: Record<string, number> | null;
  /**
   * The same width for the display cells alone, header left out: a chip
   * column's floor is its widest drawn chip (objectui#12708). `null` exactly
   * where `px` is.
   */
  cellPx: Record<string, number> | null;
};

/**
 * The elements the drawn-size read measures: this table's own header labels
 * and display cells, never a nested table's (each match is a direct child of
 * one of THIS table's header or body cells).
 */
function drawnSizeTargets(
  headerRow: HTMLTableRowElement | null,
  body: HTMLTableSectionElement | null,
): { heads: HTMLElement[]; cells: HTMLElement[] } {
  return {
    heads: headerRow ? Array.from(headerRow.querySelectorAll<HTMLElement>(`:scope > th > div > [${AUTO_WIDTH_ATTR}]`)) : [],
    cells: body ? Array.from(body.querySelectorAll<HTMLElement>(`:scope > tr > td > [${AUTO_WIDTH_ATTR}]`)) : [],
  };
}

/**
 * Everything a drawn-size read depends on: each target's column, its text,
 * and the classes of the cell around it (they set its font and padding: the
 * row density, a staged edit's weight). An equal signature means an equal
 * read, so the measurement is skipped.
 */
function drawnSizeSignature(targets: readonly HTMLElement[]): string {
  const firstBoxClass = new Map<string, string>();
  const parts: string[] = [];
  for (const el of targets) {
    const key = el.getAttribute(AUTO_WIDTH_ATTR) ?? '';
    const box = el.closest('th, td');
    const boxClass = `${box?.tagName ?? ''} ${box?.className ?? ''}`;
    const slot = `${box?.tagName ?? ''}:${key}`;
    if (!firstBoxClass.has(slot)) firstBoxClass.set(slot, boxClass);
    parts.push(key, el.textContent ?? '', firstBoxClass.get(slot) === boxClass ? '' : boxClass);
  }
  return JSON.stringify([...firstBoxClass.entries(), ...parts]);
}

/**
 * The box a target is drawn in, and the element that spans that box's content
 * width: a display cell is itself `w-full` in its `td`; a header label sits
 * in the `th`'s full-width row (`th > div > label`).
 */
function drawnSizeBox(el: HTMLElement): { box: Element | null; span: Element | null } {
  const box = el.closest('th, td');
  return { box, span: box?.tagName === 'TH' ? el.parentElement : el };
}

/**
 * Read what the targets drew. The text lengths are read always; the widths
 * only where the page is laid out.
 *
 * A column's width is its widest target's NATURAL width (the content on one
 * line, at `max-content`) plus the space its cell keeps around the content.
 * That space is MEASURED (the cell's width less its content box's), never
 * read off the computed padding: under the table's collapsed borders a cell
 * beside a frozen column's 2px rule carries half of it, which no computed
 * style of its own reports. One layout reads the boxes, one reads the probe,
 * and each target's own inline width is restored at once, inside the same
 * task, so no frame is ever painted with the probe in place. The targets
 * carry no React-managed `style`, so the probe and its removal are invisible
 * to React.
 */
function measureDrawnColumnSizes(heads: readonly HTMLElement[], cells: readonly HTMLElement[]): DrawnColumnSizes {
  const chars: Record<string, number> = {};
  for (const el of cells) {
    const key = el.getAttribute(AUTO_WIDTH_ATTR) ?? '';
    const len = (el.textContent ?? '').length;
    if (!(key in chars) || len > chars[key]) chars[key] = len;
  }
  const targets = [...heads, ...cells];
  const insets = targets.map((el) => {
    const { box, span } = drawnSizeBox(el);
    if (!box || !span) return 0;
    const inset = box.getBoundingClientRect().width - span.getBoundingClientRect().width;
    return Number.isFinite(inset) && inset > 0 ? inset : 0;
  });
  const saved = targets.map((el) => el.style.width);
  for (const el of targets) el.style.width = 'max-content';
  const natural = targets.map((el) => el.getBoundingClientRect().width);
  targets.forEach((el, i) => { el.style.width = saved[i]; });
  if (!natural.some((w) => Number.isFinite(w) && w > 0)) return { chars, px: null, cellPx: null };
  const px: Record<string, number> = {};
  const cellPx: Record<string, number> = {};
  targets.forEach((el, i) => {
    const key = el.getAttribute(AUTO_WIDTH_ATTR) ?? '';
    const need = Math.ceil((Number.isFinite(natural[i]) ? natural[i] : 0) + insets[i]);
    if (!(key in px) || need > px[key]) px[key] = need;
    if (i >= heads.length && (!(key in cellPx) || need > cellPx[key])) cellPx[key] = need;
  });
  return { chars, px, cellPx };
}

function sameNumberRecord(a: Record<string, number> | null, b: Record<string, number> | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function sameDrawnSizes(a: DrawnColumnSizes, b: DrawnColumnSizes): boolean {
  return sameNumberRecord(a.chars, b.chars) && sameNumberRecord(a.px, b.px) && sameNumberRecord(a.cellPx, b.cellPx);
}

/**
 * Enterprise-level data table component with Airtable-like features.
 *
 * Provides comprehensive table functionality including:
 * - Multi-column sorting (ascending/descending/none)
 * - Real-time search across all columns
 * - Pagination with configurable page sizes
 * - Row selection with persistence across pages (multi-select), or
 *   replace-on-select when the view declares `selection.type: 'single'`
 * - CSV export of filtered/sorted data
 * - Row action buttons (edit/delete)
 * 
 * @example
 * ```json
 * {
 *   "type": "data-table",
 *   "pagination": true,
 *   "searchable": true,
 *   "selectable": true,
 *   "sortable": true,
 *   "exportable": true,
 *   "rowActions": true,
 *   "columns": [
 *     { "header": "ID", "accessorKey": "id", "width": "80px" },
 *     { "header": "Name", "accessorKey": "name" }
 *   ],
 *   "data": [
 *     { "id": 1, "name": "John Doe" }
 *   ]
 * }
 * ```
 * 
 * @param {Object} props - Component props
 * @param {DataTableSchema} props.schema - Table schema configuration
 * @returns {JSX.Element} Rendered data table component
 */
const DataTableRenderer = ({ schema }: { schema: DataTableSchema }) => {
  const {
    caption,
    // Module-scope empties, never `[]` literals — see EMPTY_COLUMNS/EMPTY_ROWS.
    columns: rawColumns = EMPTY_COLUMNS,
    data: rawData = EMPTY_ROWS,
    pagination = true,
    pageSize: initialPageSize = 10,
    pageSizeOptions,
    manualPagination = false,
    rowCount,
    page: controlledPage,
    onPageChange,
    onPageSizeChange,
    manualSorting = false,
    sort: controlledSort,
    onSortChange,
    searchable = true,
    manualSearch = false,
    search: controlledSearch,
    onSearchChange,
    selectable: selectableProp = false,
    showSelectionCount = true,
    selectionResetKey,
    sortable = true,
    exportable = false,
    rowActions = false,
    resizableColumns = true,
    reorderableColumns = true,
    editable = false,
    singleClickEdit = false,
    keyboardNavigation = false,
    rowClassName,
    rowStyle,
    className,
    cellClassName,
    frozenColumns = 0,
    showRowNumbers = false,
    showAddRow = false,
    borderless = false,
    disableInnerScroll = false,
    rowGroups,
    // Read ONLY to diagnose it. `data-table` does not resolve `bind` and the
    // objectui#6575 ruling is explicit that it must not start — see
    // `dataTableBindDiagnostic.ts`.
    bind: authoredBind,
  } = schema;

  // 'single' caps the selection at one row (replace-on-select) and drops the
  // select-all header; every truthy legacy value keeps meaning 'multiple'.
  const selectionMode = resolveSelectionMode(selectableProp);
  const selectable = selectionMode !== 'none';
  /**
   * objectui#12423 — the row's LEADING cell is one cell. With selection on it
   * holds the checkbox, and the row number too when `showRowNumbers` is on:
   * the number by default, the checkbox on row hover, on focus-within, on a
   * coarse pointer (no hover to reveal it) and on every row while anything is
   * selected. The two are swapped by CSS classes on one fixed-width cell,
   * never mounted and unmounted, so nothing shifts. Without selection it is
   * the row-number cell alone, as before.
   */
  const leadingCellCount = selectable || showRowNumbers ? 1 : 0;

  // Ambient design-surface affordance: when a host (Studio) provides it, render
  // a trailing "+ add field" column header. `null` for every runtime table, so
  // existing tables render unchanged.
  const fieldAuthoring = useGridFieldAuthoring();
  const addColumnEnabled = !!fieldAuthoring?.onAddColumn;
  const editColumnEnabled = !!fieldAuthoring?.onEditColumn;
  // The table already implements column drag-reorder; a design host enables it by
  // providing onReorderFields (to persist the order to the object's field metadata).
  const reorderEnabled = reorderableColumns || !!fieldAuthoring?.onReorderFields;

  // i18n support for pagination labels
  const { t } = useTableTranslation();
  // The id of the inline date editor's impossible-day notice (objectui#10625).
  // One per table: at most one cell is in edit mode at a time.
  const impossibleDayNoticeId = React.useId();
  // The DISPLAY locale, not the UI language: an English UI with a `de-CH`
  // display locale reads `4.3.2020`, never `3/4/2020` (objectui#10442). The
  // hook's own fallback chain answers when no tenant locale is configured, so
  // nothing here adds a second one.
  const displayLocale = useDisplayLocale();

  /**
   * Format a cell value for display. ISO date / datetime strings are
   * formatted in the display locale (`useDisplayLocale()`), the one channel
   * every date renderer reads (e.g. zh-CN → 2024/12/15, en-US → 12/15/2024).
   * Non-date values are returned untouched.
   */
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  const formatCellValue = React.useCallback((value: unknown): unknown => {
    if (typeof value !== 'string' || value.length < 8) return value;
    if (!ISO_DATE_RE.test(value)) return value;
    // A VALIDITY check only: an unparsable string keeps rendering as itself
    // rather than as the shared functions' dash. The value handed on below is
    // the STRING, never a `Date` built from `ts` — a pre-built `Date` is an
    // instant the shared parse step leaves alone, so a date-only value reached
    // it as UTC midnight and rendered one day early west of UTC (objectui#10183).
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) return value;
    const hasTime = value.includes('T');
    try {
      // The datetime half is `formatDateTime`'s DEFAULT style — the one home
      // for this convention (objectui#7443). It used to be a third,
      // independently authored `Intl.DateTimeFormat` bag here, close to but
      // not derived from the shared function. Byte-identical in en-US, zh and
      // de-DE, so no table cell changes.
      if (hasTime) return formatDateTime(value, { locale: displayLocale });
      // The DATE-only half is `formatDate`'s DEFAULT style — the same one home,
      // one type over (`c15d7eca6`, maintainer ruling A). It used to build its
      // own `Intl.DateTimeFormat` bag here, which asked for `year: 'numeric'`
      // unconditionally while `formatDate` drops the year INSIDE the current
      // year on purpose; so one table showed two faces for one value, picked by
      // which path the cell happened to take. Current-year cells move with this
      // (`Jul 4, 2026` → `Jul 4`, matching the `date` field cell beside them);
      // past-year cells are byte-identical, which is why the split went
      // unnoticed. A column that genuinely wants the year on every row is an
      // explicit `format` style honoured by both paths, never a second bag.
      //
      // `undefined` in the positional slot is how the published signature
      // `formatDate(value, style?, options?)` asks for the default face; the
      // positional argument outranks `options.style` (objectui#7745).
      return formatDate(value, undefined, { locale: displayLocale });
    } catch {
      return value;
    }
  }, [displayLocale]);

  // Ensure data is always an array – provider config objects or null/undefined
  // must not reach array operations like .filter() / .some(). The non-array
  // fallback is the shared empty, so a provider-config schema does not re-key
  // every downstream memo on each render (objectui#4618).
  //
  // This branch is ALSO the objectui#6665 defect: it swallows an AUTHORED
  // non-array as quietly as an absent key — a `${...}` expression string, a
  // number, an object, a `null`. The behaviour is deliberate and unchanged
  // here; the second effect below is what stops it being silent.
  //
  // objectui#12620 — a grouped table draws the rows of its `rowGroups`, in
  // group order, and `data` is not read.
  const groupSourceRows = useMemo(
    () => (rowGroups ? rowGroups.flatMap((group) => group.rows) : null),
    [rowGroups],
  );
  const data = groupSourceRows ?? (Array.isArray(rawData) ? rawData : EMPTY_ROWS);

  // objectui#6575 — say out loud that an authored `bind` was ignored.
  //
  // Channel: the one `plugin-grid` already uses for "you declared it, the
  // renderer dropped it" — a `useEffect` keyed on the schema slice and one
  // `console.warn` (see `columnSpellingDiagnostics.ts`) — rather than a second,
  // differently-shaped one. `data` is in the key because the message's
  // consequence clause is measured against the rows actually resolved.
  const bindDiagnosticBlockType = (schema as { type?: unknown }).type;
  const bindDiagnosticId = (schema as { id?: unknown }).id;
  useEffect(() => {
    const message = describeIgnoredBind(authoredBind, data, {
      blockType: bindDiagnosticBlockType,
      id: bindDiagnosticId,
      caption,
    });
    if (message) console.warn(message);
  }, [authoredBind, data, bindDiagnosticBlockType, bindDiagnosticId, caption]);

  // objectui#6665 — say out loud that a non-array `data` was dropped.
  //
  // The SAME channel as the effect above (one module, one `console.warn`, an
  // effect key as the rate limit) asking a DIFFERENT question: these nodes
  // carry no `bind` at all, so the #6575 predicate is correctly silent on them.
  // A second effect rather than a wider key on that one, because the two
  // judgements are independent and #6575's key is pinned by its own tests.
  //
  // The message is computed in render and IS the effect key, rather than the
  // effect being keyed on `rawData`. Two reasons, and neither is style:
  //   - `data` (the collapsed value) cannot be the key — it is already
  //     `EMPTY_ROWS` for every value this diagnostic fires on, so one bad value
  //     replaced by another would not re-key and the second would go unsaid.
  //   - `rawData` cannot be the key either — an authored OBJECT is a fresh
  //     reference on every render that rebuilds the node, which would print the
  //     same line again and again. Keying on the message keeps the ceiling this
  //     module documents: one line per distinct authoring bug.
  const nonArrayDataMessage = describeNonArrayData(rawData, {
    blockType: bindDiagnosticBlockType,
    id: bindDiagnosticId,
    caption,
  });
  useEffect(() => {
    if (nonArrayDataMessage) console.warn(nonArrayDataMessage);
  }, [nonArrayDataMessage]);

  // The adapter reads ONLY the column keys `TableColumn` DECLARES. Both
  // undeclared aliases are now retired: `label` (objectui#5351) and `name`
  // (objectui#5120, this change).
  //
  // These two lines used to normalize each column as
  // `header: col.header || col.label` and
  // `accessorKey: col.accessorKey || col.name` — two undeclared aliases for two
  // declared keys. `TableColumn` (`packages/types/src/data-display.ts`) declares
  // `header: string` and `accessorKey: string`; it declares neither. So the
  // declared surface admitted one spelling while the runtime admitted two, which
  // is the second de-facto contract AGENTS.md #0.1 forbids, and the 2026-08-20
  // ruling settled the direction for the whole family: retire the consumer-side
  // alias, unify the producers.
  //
  // Where the translation went — `columnIdentity` / `columnHeader` in
  // `@object-ui/core`, called by each producer BEFORE delivery:
  //   `ObjectDataTable.normalizeColumns`  (`@object-ui/plugin-dashboard`)
  //   `RelatedList.normalizeColumn`       (`@object-ui/plugin-detail`)
  //   `ObjectGrid.generateColumns`        (`@object-ui/plugin-grid`, since #5068)
  // Metadata vocabulary in, adapter vocabulary out; one translation, one place —
  // and that place is each producer, never here. A `{ name, label }` column
  // arriving through any of the three still renders: its producer resolved the
  // identity into `accessorKey` before the adapter ever saw it. What no longer
  // resolves is `name` on a column authored DIRECTLY onto a `data-table` node,
  // which is the accepted-set narrowing objectui#5120 rules and ships.
  //
  // The instruction corpus moved in the SAME commit, which is the whole reason
  // this step could be taken: `skill-guide-data-table-binding.test.tsx` lifts the
  // fenced JSON out of the published guides at run time and renders it, so the
  // guides are executable fixtures rather than prose. Both now teach
  // `{ header, accessorKey }`:
  //   skills/objectui/guides/data-integration.md
  //   skills/objectui/guides/schema-expressions.md
  // Retiring the runtime ahead of the instruction would have left the platform
  // refusing a spelling it still shipped, and the failure it teaches into is the
  // illegible one: a header over blank cells (pinned in
  // `data-table-declared-column-keys.test.tsx`).
  const initialColumns = useMemo(() => {
    return rawColumns.map((col: any) => ({
      ...col,
      accessorKey: col.accessorKey,
    }));
  }, [rawColumns]);

  // What each auto-sized column's cells DREW (objectui#11682), keyed by
  // `accessorKey` and read back from the rendered table by the layout effect
  // that drives `readDrawnSizesRef` below. `null` until the table has drawn.
  const [drawnSizes, setDrawnSizes] = useState<DrawnColumnSizes | null>(null);

  // Auto-size columns: estimate width from header and data content for columns without explicit widths
  const autoSizedWidths = useMemo(() => {
    const widths: Record<string, number> = {};
    // Spelled identically to `initialColumns` above — the auto-width pass must
    // measure the SAME columns the table renders, so the two reads move
    // together (objectui#5351 retired `header`'s alias, objectui#5120 `name`'s).
    const cols = rawColumns.map((col: any) => ({
      header: col.header,
      accessorKey: col.accessorKey,
      width: col.width,
      fitContent: col.fitContent,
      masked: col.masked === true,
    }));
    for (const col of cols) {
      if (col.width) continue; // Skip columns with explicit widths
      // `fitContent` columns (e.g. the row-actions column) size to their own
      // content via a `width:1%` + nowrap cell, not a char-count estimate —
      // estimating them from an absent string value pins them to the 80px
      // floor and clips inline buttons. Leave them out of the width map.
      if (col.fitContent) continue;
      // Every column but a masked one is sized from WHAT ITS CELLS DREW
      // (objectui#11682): a currency cell stores `200000` and draws
      // `200,000.00`, a progress cell stores `45` and draws a bar and `45%`, a
      // lookup stores an id and draws a name, a date stores an ISO string and
      // draws `Feb 3, 2027`. Sized from the stored value, the first two were
      // too narrow (the cell truncated) and the last two too wide (the sum
      // pushed the scrolling columns under the right-pinned actions column).
      // The drawn content is whatever the column's own `cell` renderer, or
      // this table's `formatCellValue`, put in the cell — read back below, so
      // no formatter is repeated here and no column key is needed to reach it.
      //
      // Where the page is laid out, the read is the width the widest drawn
      // cell (and the header) needs to render whole, padding included.
      const drawnPx = col.masked ? undefined : drawnSizes?.px?.[col.accessorKey];
      if (drawnPx !== undefined) {
        widths[col.accessorKey] = Math.min(400, Math.max(80, drawnPx));
        continue;
      }
      const headerLen = (col.header || '').length;
      let maxLen = headerLen;
      // A MASKED column never reads its values here (objectui#10657). Sized
      // from them, its width grew with the credential's length. Its cells draw
      // the producer's mask, which does not depend on the value, so the header
      // alone sizes it, with the same floor as every other column.
      //
      // Where nothing is laid out (no layout engine, or a table drawn inside a
      // hidden panel) the drawn TEXT is still there, and its length is the
      // estimate's input. Before the table has drawn at all (the first render
      // pass, which the layout effect re-sizes before paint, or a render with
      // no effects) the stored value is the only text there is.
      const drawnLen = col.masked ? undefined : drawnSizes?.chars[col.accessorKey];
      if (drawnLen !== undefined) {
        if (drawnLen > maxLen) maxLen = drawnLen;
      } else {
        // Sample up to 50 rows for content width estimation
        const sampleRows = col.masked ? [] : data.slice(0, 50);
        for (const row of sampleRows) {
          const val = row[col.accessorKey];
          const len = val != null ? String(val).length : 0;
          if (len > maxLen) maxLen = len;
        }
      }
      // Estimate pixel width: ~8px per character + 48px padding, min 80, max 400
      widths[col.accessorKey] = Math.min(400, Math.max(80, maxLen * 8 + 48));
    }
    return widths;
  }, [rawColumns, data, drawnSizes]);

  // State management
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  // The sort state's second half. `SortDirection` is `@objectstack/spec`'s own
  // export, imported rather than re-declared: this module used to hand-write
  // `'asc' | 'desc' | null` under that exact export name, which is the planted-
  // premise class `check:spec-symbols` exists to stop (objectui#7265).
  //
  // `null` is the ONE divergence, and it lives HERE rather than in the name
  // because it is not a third direction — it is the absence of one, the
  // unsorted end of the client-side header cycle in `handleSort`. That is the
  // same "this half is empty" that `sortColumn` above already spells at its own
  // slot, which is why folding it into a type would have been the odd one out.
  // No `null` can reach the protocol's vocabulary: the sort comparator is past
  // the `!sortDirection` guard in `sortedData`, and `activeSort` emits a
  // `TableSortItem` only when both halves are set. The cycle that produces the
  // third state is pinned by the `leaves client-side sorting exactly as it was`
  // case in data-table-manual-sorting.test.tsx.
  const [sortDirection, setSortDirection] = useState<SortDirection | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<any>>(new Set());
  /** Anything selected ⇒ every row shows its checkbox (objectui#12423). */
  const selectionActive = selectedRowIds.size > 0;
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [columns, setColumns] = useState(initialColumns);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  // objectui#12708 — a chip column's floor: its widest drawn chip among the
  // rows on screen, measured once per data load (a new `data`, page or page
  // size) by the drawn-size read below, so a single-word chip value is never
  // cut to an ellipsis. Text columns have none and keep their width, so where
  // the table runs short of room they truncate and the chips stay whole. The
  // load is told apart by its PRIMITIVE inputs and the `data` prop, never by a
  // memoised value's identity (AGENTS.md #10).
  const [chipFloors, setChipFloors] = useState<Record<string, number>>({});
  const chipFloorLoadRef = useRef<readonly unknown[] | null>(null);
  /**
   * The width a column renders at: a user's resize, else the declared width,
   * else the estimate; a chip column's floor raises a numeric width, or stands
   * in for none. A width spelled as a CSS string is left as authored.
   */
  const resolvedColumnWidth = (col: TableColumn): string | number | undefined => {
    const base = columnWidths[col.accessorKey] || col.width || autoSizedWidths[col.accessorKey];
    const floor = col.chips === true ? chipFloors[col.accessorKey] : undefined;
    if (floor === undefined || (base !== undefined && typeof base !== 'number')) return base;
    return Math.max(base ?? 0, floor);
  };

  // Sticky-left offsets for the leading pinned cells (checkbox, row number,
  // frozen data columns), measured from the REAL rendered header-cell widths.
  // The table's auto layout does not guarantee the utility columns their
  // declared `w-10`: the checkbox column can collapse to its ~28px min-content
  // while the row-number column stretches past 40px. Hardcoded 40px offsets
  // then leave an uncovered strip between pinned cells where horizontally
  // scrolled content shows through (titanwind-ehr#418), so pin each cell at
  // the cumulative measured width of the cells before it instead.
  const headerRowRef = useRef<HTMLTableRowElement | null>(null);
  const [measuredStickyLefts, setMeasuredStickyLefts] = useState<number[] | null>(null);
  const stickyLeadingCount = frozenColumns > 0
    ? leadingCellCount + Math.min(frozenColumns, columns.length)
    : 0;

  useLayoutEffect(() => {
    const headerRow = headerRowRef.current;
    if (stickyLeadingCount === 0 || !headerRow) {
      setMeasuredStickyLefts(null);
      return;
    }
    const measure = () => {
      const cells = Array.from(headerRow.children).slice(0, stickyLeadingCount) as HTMLElement[];
      let acc = 0;
      const lefts = cells.map((cell) => {
        const left = acc;
        acc += cell.getBoundingClientRect().width;
        return left;
      });
      setMeasuredStickyLefts((prev) =>
        prev && prev.length === lefts.length && prev.every((v, i) => Math.abs(v - lefts[i]) < 0.5)
          ? prev
          : lefts
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // Header-cell widths ARE the column widths, and they change outside React
    // (column resize drag, density toggle, content growth), so re-measure on
    // any of the observed cells resizing.
    const observer = new ResizeObserver(measure);
    Array.from(headerRow.children)
      .slice(0, stickyLeadingCount)
      .forEach((cell) => observer.observe(cell));
    return () => observer.disconnect();
  }, [stickyLeadingCount, columns]);

  // Sticky-right offsets for the trailing pinned cells (objectui#11682), the
  // mirror of the lefts above. Every right-pinned column carries `right-0`, so
  // with two of them (an author's `pinned: 'right'` beside the auto-pinned
  // row-actions column) both stuck to the same edge and the outer one drew
  // over the inner one's content. Pin each at the cumulative measured width of
  // the pinned header cells AFTER it instead; the outermost stays at
  // `right-0`, so a table with one right-pinned column renders as before.
  const [measuredStickyRights, setMeasuredStickyRights] = useState<Record<string, number> | null>(null);
  useLayoutEffect(() => {
    const headerRow = headerRowRef.current;
    const leading = leadingCellCount;
    const pinned = columns
      .map((col, index) => ({ key: col.accessorKey, index, col }))
      .filter(({ col }) => isPinnedRightColumn(col));
    const cells = headerRow ? pinned.map(({ index }) => headerRow.children[leading + index] as HTMLElement | undefined) : [];
    if (pinned.length < 2 || cells.some((cell) => !cell)) {
      setMeasuredStickyRights(null);
      return;
    }
    const measure = () => {
      const rights: Record<string, number> = {};
      let acc = 0;
      for (let j = pinned.length - 1; j >= 0; j--) {
        rights[pinned[j].key] = acc;
        acc += (cells[j] as HTMLElement).getBoundingClientRect().width;
      }
      setMeasuredStickyRights((prev) => (sameNumberRecord(prev, rights) ? prev : rights));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    cells.forEach((cell) => observer.observe(cell as HTMLElement));
    return () => observer.disconnect();
  }, [leadingCellCount, columns]);
  const [draggedColumn, setDraggedColumn] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<number | null>(null);
  // Keyed by the record, like a pending edit (objectui#12310): a re-read that
  // reorders the page leaves the open editor on its record, so its commit
  // stages there, never on the row now at the editor's old position.
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  // Mirror of `editingCell` that is mutated synchronously, so the `startEdit`
  // re-entry guard can't be defeated by a stale closure. A lookup/select option
  // renders in a Portal; picking it fires the option's onChange (which stages
  // the value) and — because React synthetic events still bubble through the
  // component tree — the cell's onClick, re-invoking `startEdit` for the SAME
  // cell within one event. Reading `editingCell` state there can observe a stale
  // (pre-edit) value under batching/contention, so the guard misses and the
  // just-picked value is reset from empty `pendingChanges`. The ref always
  // reflects the latest edit target within the same tick, so re-entry is caught.
  const editingCellRef = useRef<EditingCell | null>(null);
  const [editValue, setEditValueState] = useState<any>('');
  // Mirror of `editValue` written synchronously, read by `saveEdit`
  // (objectui#12664). An injected widget can stage and the table commit inside
  // ONE event: the platform date picker parses its text on Enter (or on the
  // blur `flushInjectedEditor` causes) and stages the day, and the wrapper's
  // Enter / the click-outside listener then commits. `editValue` in that
  // event's closure is the value from before the stage, so committing it
  // staged the old value over the new one and the typed day was lost. Every
  // write goes through `setEditValue` below, so the ref is always the last
  // value written.
  const editValueRef = useRef<unknown>('');
  const setEditValue = (value: unknown) => {
    editValueRef.current = value;
    setEditValueState(value);
  };
  // Track pending changes for multi-cell editing, per record (objectui#12310):
  // record key -> { row, changes: { columnKey -> newValue } }
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>(new Map());
  // What a running row save or Save All sent, per record key (objectui#12322).
  // Cell editing stays open during a save, and a commit on a cell in here is
  // always staged (see `stageCellChange`). Set when the save is pressed and
  // cleared when it settles; read only by event handlers, never by render.
  const inFlightRef = useRef<Map<PendingRowKey, Record<string, unknown>>>(new Map());

  // objectui#7188 — the row merged with its STAGED edits, handed to the host
  // editor as `pendingRow` next to the persisted `row`. Cached per row object
  // and rebuilt whenever `pendingChanges` is replaced (every stage / save /
  // cancel builds a new Map), so the merged record keeps its IDENTITY across
  // renders that stage nothing. That matters: `LookupField` keys its
  // `dependentFilter` / `popoverFilter` memos on the identity of the record it
  // is handed, and its recent-ids effect keys on `popoverFilter`, so a fresh
  // object per render would re-issue that query on every table re-render while
  // the picker is open (`useRecordQuery` itself is immune — it keys on a JSON
  // signature). `row` is identity-stable for the same reason; a row with
  // nothing staged is handed `row` itself.
  const pendingRows = useMemo(() => {
    const byRow = new WeakMap<object, any>();
    return {
      /** `row` merged with its staged edits — or `row` itself when it has none. */
      of(row: any, rowKey: PendingRowKey): any {
        const changes = pendingChanges.get(rowKey)?.changes;
        if (!changes || row === null || typeof row !== 'object') return row;
        const hit = byRow.get(row);
        if (hit !== undefined) return hit;
        const merged = { ...row, ...changes };
        byRow.set(row, merged);
        return merged;
      },
    };
  }, [pendingChanges]);
  const [isSaving, setIsSaving] = useState(false);
  // Last save failure message (server validation text, etc.) shown in the
  // toolbar; null when the last save attempt succeeded or nothing's been saved.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Records whose last save attempt failed, by the key their pending edit is
  // kept under (objectui#12310) — tinted destructive so the author sees exactly
  // which rows didn't persist (no silent "phantom save").
  const [erroredRows, setErroredRows] = useState<Set<PendingRowKey>>(new Set());
  // Column header context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; columnKey: string } | null>(null);
  
  // Refs for column resizing
  const resizingColumn = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);
  /**
   * Final width produced by the in-flight drag, so `handleResizeEnd` can report
   * it once. It has to be a ref, not state: the document-level listeners are one
   * render's closures and cannot observe a later `columnWidths` update.
   */
  const lastResizeWidth = useRef<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  // When an edit ends via Enter (already saved) or Escape (cancelled), the
  // input also blurs. This flag tells the blur handler not to save again so we
  // don't double-commit (Enter) or resurrect a cancelled value (Escape).
  const skipBlurSaveRef = useRef(false);
  // DOM node of a host-injected widget editor (rendered via `renderCellEditor`),
  // captured while it's mounted, so the document-level pointerdown listener
  // below can tell "inside this editor" from "outside" and exit edit mode.
  // Null ⇒ no injected editor is active (a built-in editor, or nothing, is
  // showing).
  //
  // This used to justify itself with "the injected widgets (text, number, date,
  // lookup, …) have no such handler". That claim is no longer true and is no
  // longer the reason (`64d937c53`). `onBlur` is a DECLARED DOM pass-through
  // key — named in `FieldWidgetDomProps` (`@object-ui/fields`), named in
  // `SDUI_DOM_PASS_THROUGH_KEYS` (`@object-ui/core`), forwarded by
  // `toDomProps` — and every widget reachable as an inline editor spreads that
  // whitelist onto a real control (26 of the 27 components in `EDIT_WIDGETS`
  // call `toDomProps` directly; `UserField` delegates its whole props object to
  // `LookupField`, which does). The five widgets that own a blur handler now
  // COMPOSE the host's rather than overriding it (objectui#6780, #6802).
  //
  // The listener is still needed, for a different reason: NOTHING EVER HANDS
  // THE WIDGET ONE. The wrapper below carries `onKeyDown` alone, and the
  // context object `renderCellEditor` receives — `{ column, row, pendingRow,
  // value, stage, commit, cancel }` — has no DOM-props slot to put an `onBlur` in.
  //
  // ⚠️ The second half of that reason is GONE (objectui#6909). The in-repo
  // factory behind the seam, `@object-ui/fields`' `FieldEditWidget`, used to
  // forward `autoFocus` and nothing else out of the DOM block, so a host
  // handler could not have reached the control even if one were passed. It now
  // hands the widget its whole `toDomProps` set, so a passed `onBlur` WOULD
  // arrive. What keeps this listener load-bearing is the FIRST half alone: the
  // seam still has nowhere to put one. Widening that context object is a
  // `DataTableSchema` contract change, not something to infer from here.
  //
  // Note also what the listener is NOT load-bearing for. Its job is exiting
  // EDIT MODE, not rescuing the value: most injected widgets stage on every
  // change (the host wires the widget's `onChange` to `stageEdit` below), so a
  // typed value is already in `pendingChanges` before any exit event — measured
  // in a real browser on the text, date and number editors for `64d937c53`.
  // Retiring this listener would strand cells in edit mode; it would not drop
  // edits. The one exception is a widget that reads its input on blur (the
  // platform date picker, objectui#12664): the listener blurs the focused
  // control before it commits (`flushInjectedEditor`), and that blur is what
  // stages such a widget's value.
  const injectedEditorElRef = useRef<HTMLDivElement | null>(null);
  // Snapshot of the active cell's pending value when editing began, so Escape /
  // cancel can revert this session's changes. Injected widgets stage on every
  // change (unlike built-ins, which only commit on blur/Enter), so without this
  // an Escape would leave the half-typed value staged. `had` distinguishes "no
  // pending change existed" from "the pending value was undefined".
  const editRevertRef = useRef<{ had: boolean; value: any } | null>(null);

  // Update columns when schema changes.
  //
  // Re-seed only on a real change: `initialColumns` is a fresh array whenever
  // its memo recomputes, and every consumer that derives columns per render
  // hands us one. Writing state for a value-identical list re-renders the whole
  // table for nothing, and — when the churn originates inside this component —
  // schedules the render that regenerates the churn (objectui#4618).
  useEffect(() => {
    setColumns((prev) => (columnsAreEquivalent(prev, initialColumns) ? prev : initialColumns));
  }, [initialColumns]);

  // Clear the internal checkbox selection when the host bumps selectionResetKey.
  // Row selection is otherwise table-internal state a host can't reach; this lets
  // e.g. a grid reset the checkboxes after a bulk action. On mount the selection
  // is already empty, so the initial run is a no-op.
  useEffect(() => {
    if (selectionResetKey === undefined) return;
    setSelectedRowIds(new Set());
  }, [selectionResetKey]);

  // Filtering — client-side, over the rows this table was handed.
  //
  // Under `manualSearch` there is nothing to do: `data` is already the server's
  // answer to the term, computed over the whole collection rather than this
  // window. Re-filtering it here would search the CURRENT PAGE — the defect
  // objectui#3118 reports, where "2 results" is true of fifty rows and says
  // nothing about the 3075 that never participated. Note this is the *only*
  // filter path, so leaving both active would not even be redundant: the client
  // pass would narrow the server's answer to whichever of its rows happen to
  // contain the term as rendered text.
  const filteredData = useMemo(() => {
    if (manualSearch) return data;
    if (!searchQuery) return data;

    // A MASKED column is left out of the predicate (objectui#10657). A
    // substring match on it answers "does the credential contain this?", which
    // recovers the value one character at a time while its cell draws a mask.
    const searchedColumns = columns.filter((col) => !isMaskedColumnKey(rawColumns, col.accessorKey));
    return data.filter((row) =>
      searchedColumns.some((col) => {
        const value = row[col.accessorKey];
        return value?.toString().toLowerCase().includes(searchQuery.toLowerCase());
      })
    );
  }, [data, searchQuery, columns, rawColumns, manualSearch]);

  // Sorting — client-side, over the rows this table was handed.
  //
  // Under `manualSorting` there is nothing to do: `data` arrived in the order
  // the server produced, for the whole collection rather than this window.
  // Re-sorting it here would order the CURRENT PAGE — the defect objectui#3106
  // reports, where "sorted by this column" is true of fifty rows and false of
  // the list they came from.
  //
  // Sort keys go through `getSortValue` so a relational column orders by the
  // label its cell shows, not by the `$expand`-ed record object (objectui#3096).
  // The old `aValue < bValue` was always false for two objects, so a lookup
  // column's comparator collapsed to the constant `1` and the sort produced an
  // order unrelated to anything on screen.
  //
  // Decorate → sort → undecorate: the key is resolved ONCE per row rather than
  // on every one of the O(n log n) comparisons.
  const sortedFlatData = useMemo(() => {
    if (manualSorting) return filteredData;
    if (!sortColumn || !sortDirection) return filteredData;
    // A MASKED column orders nothing (objectui#10657), including a sort set
    // before its producer stamped the flag. Rows ordered by a credential tell
    // the reader how it compares with every other row's.
    if (isMaskedColumnKey(rawColumns, sortColumn)) return filteredData;

    const keyed = filteredData.map((row) => ({ row, key: getSortValue(row[sortColumn]) }));
    // Array#sort is stable, so rows with equal keys keep their incoming order.
    keyed.sort((a, b) => {
      const comparison = compareSortValues(a.key, b.key);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return keyed.map((entry) => entry.row);
  }, [filteredData, sortColumn, sortDirection, manualSorting, rawColumns]);

  // objectui#12620 — a grouped table keeps every row in its own band. The
  // sorted rows are partitioned back into their groups, in group order; the
  // partition is stable, so each group's rows keep the sort's order.
  // `groupLayout` says where each group's rows sit in `sortedData`.
  const groupedOrder = useMemo((): { rows: any[]; layout: { group: RowGroup; start: number; length: number }[] } | null => {
    if (!rowGroups) return null;
    const groupOf = new Map<any, number>();
    rowGroups.forEach((group, at) => {
      group.rows.forEach((row) => { if (!groupOf.has(row)) groupOf.set(row, at); });
    });
    const buckets: any[][] = rowGroups.map(() => []);
    for (const row of sortedFlatData) {
      const at = groupOf.get(row);
      if (at !== undefined) buckets[at].push(row);
    }
    const rows: any[] = [];
    const layout = rowGroups.map((group, at) => {
      const start = rows.length;
      rows.push(...buckets[at]);
      return { group, start, length: buckets[at].length };
    });
    return { rows, layout };
  }, [rowGroups, sortedFlatData]);
  const sortedData = groupedOrder ? groupedOrder.rows : sortedFlatData;
  const groupLayout = groupedOrder?.layout ?? null;

  // Pagination. Under manual (server-side) pagination the parent controls the
  // page and supplies the grand total via `rowCount`; `data` already IS the
  // current page, so we never slice it locally. Otherwise we paginate the
  // in-memory rows client-side (legacy behavior).
  const effectivePage = manualPagination
    ? Math.max(1, controlledPage ?? 1)
    : currentPage;
  const totalPages = manualPagination
    ? Math.max(1, Math.ceil((rowCount ?? sortedData.length) / pageSize))
    : Math.ceil(sortedData.length / pageSize);
  // A grouped table is never paged here: its pages are the host's (objectui#12620).
  const paginatedData = (pagination && !manualPagination && !groupLayout)
    ? sortedData.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : sortedData;

  // objectui#12310 — where each record sits in the rows this table holds NOW,
  // by the key its pending edit is kept under. Every reader of a pending edit
  // resolves it through here at the moment it reads, so an edit is drawn,
  // saved and reported against its own record whatever order a re-read put
  // the rows in. A record the held rows do not include (a re-read dropped it,
  // or it sits on another server page) has no entry: its edit stays pending
  // and is handed over with the row it was staged against.
  const sortedIndexByKey = useMemo(() => {
    const index = new Map<PendingRowKey, number>();
    sortedData.forEach((row, at) => {
      const key = pendingRowKeyOf(row);
      if (!index.has(key)) index.set(key, at);
    });
    return index;
  }, [sortedData]);
  /** The row this table holds now for a record key, or `undefined`. */
  const heldRowOf = (rowKey: PendingRowKey): any => {
    const at = sortedIndexByKey.get(rowKey);
    return at === undefined ? undefined : sortedData[at];
  };
  /**
   * The `rowIndex` the published callbacks receive for a record key, computed
   * when they are called: the row's global index, as before, while the table
   * holds it, and `-1` while it does not — no position in these rows is that
   * record's, so none is handed over as if it were.
   */
  const rowIndexOf = (rowKey: PendingRowKey): number => {
    const at = sortedIndexByKey.get(rowKey);
    if (at === undefined) return -1;
    return manualPagination ? (effectivePage - 1) * pageSize + at : at;
  };

  // Route page / page-size changes to the parent under manual pagination,
  // otherwise drive the internal state.
  const goToPage = (p: number) => {
    const clamped = Math.min(totalPages, Math.max(1, p));
    if (manualPagination) onPageChange?.(clamped);
    else setCurrentPage(clamped);
  };
  const changePageSize = (size: number) => {
    setPageSize(size);
    if (manualPagination) {
      onPageSizeChange?.(size);
      onPageChange?.(1);
    } else {
      setCurrentPage(1);
    }
  };

  // Rows-per-page choices: caller-supplied options (e.g. view metadata's
  // pagination.pageSizeOptions) or the built-in fallback. The active pageSize
  // is always merged in and the list de-duplicated + sorted so the selector can
  // display the current value even when it is not one of the configured steps.
  const pageSizeChoices = React.useMemo(() => {
    const base = pageSizeOptions && pageSizeOptions.length > 0
      ? pageSizeOptions
      : [5, 10, 20, 50, 100];
    return Array.from(new Set([...base, pageSize]))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
  }, [pageSizeOptions, pageSize]);

  /**
   * Generates a unique identifier for each row to maintain stable selection state
   * across pagination and sorting operations.
   * 
   * @param {any} row - The data row object
   * @param {number} index - The row's index in the dataset
   * @returns {string | number} Unique row identifier (uses 'id' field if available, falls back to index)
   */
  const getRowId = (row: any, index: number) => {
    // Try to use 'id' field, fall back to index
    return row.id !== undefined ? row.id : `row-${index}`;
  };

  // The sort the headers display and cycle.
  //
  // Under `manualSorting` this is the caller's prop and nothing else — the two
  // `useState`s below are not read, not written, and not mirrored. Keeping a
  // private copy in sync with a controlled prop is precisely how objectui#3106
  // happened: the table held the user's sort somewhere the layer that fetches
  // the rows could not see it.
  const activeSort: TableSortItem[] = manualSorting
    ? (controlledSort ?? [])
    : (sortColumn && sortDirection ? [{ field: sortColumn, order: sortDirection }] : []);

  // A manual-sorting table with nowhere to report a click renders inert headers
  // rather than clickable ones that do nothing — a dead affordance is the same
  // class of lie as a sort that only covers the current page.
  const sortingEnabled = sortable && (!manualSorting || !!onSortChange);

  // Does this column's header sort? One answer for its cursor, its click and
  // its indicator. A MASKED column's header is inert in both modes
  // (objectui#10657): a client sort orders the rows by the credential, and a
  // manual one asks the host to, so the order says how it compares with every
  // other row's. Disabled rather than refused on click, for the reason
  // `sortingEnabled` gives: a header that looks sortable and does nothing is a
  // dead affordance.
  const isColumnSortable = (col: TableColumn) =>
    sortingEnabled && col.sortable !== false && !isMaskedColumnKey(rawColumns, col.accessorKey);

  // The term the search box displays.
  //
  // Under `manualSearch` this is the caller's prop and nothing else — the
  // `searchQuery` state is not read, not written, and not mirrored, for the
  // same reason `activeSort` keeps no copy: a private term beside a controlled
  // one is a term the layer that fetches the rows cannot see (objectui#3118).
  const activeSearch = manualSearch ? (controlledSearch ?? '') : searchQuery;

  // A manual-search table with nowhere to report the term renders NO search box
  // rather than one that filters the page it can see. There is no honest local
  // fallback here — the rows to search are on the server — so the box is
  // withheld entirely, which is also the shape ListView already relies on when
  // it passes `showSearch: false` and searches from its own toolbar.
  const searchEnabled = searchable && (!manualSearch || !!onSearchChange);

  /**
   * Apply a new search term — the single write path, so the controlled and
   * local modes cannot diverge about where the term lands.
   *
   * Page reset: in client mode the table owns its page and snaps it to 1, since
   * a narrower result set makes the old page index meaningless. Under
   * `manualSearch` the host owns both the page and the refetch, and resets there
   * (the term and the page have to reach the server in the same request; a reset
   * issued from here would be a second, racing one).
   */
  const applySearch = (value: string) => {
    if (manualSearch) {
      onSearchChange?.(value);
      return;
    }
    setSearchQuery(value);
    setCurrentPage(1);
  };

  /**
   * Sort by one column in a given direction — the single write path, so the
   * column-header cycle and the header context menu cannot diverge about where
   * a sort goes. The menu used to call `setSortColumn`/`setSortDirection`
   * directly, which under `manualSorting` would have written to state nothing
   * reads: a menu item that highlights, closes, and changes nothing.
   */
  const applySort = (columnKey: string, order: SortDirection) => {
    // A MASKED column is never sorted by, whichever control asked
    // (objectui#10657; see `isColumnSortable`).
    if (isMaskedColumnKey(rawColumns, columnKey)) return;
    if (manualSorting) {
      onSortChange?.([{ field: columnKey, order }]);
      return;
    }
    setSortColumn(columnKey);
    setSortDirection(order);
  };

  // Handlers
  const handleSort = (columnKey: string) => {
    if (!sortingEnabled || isMaskedColumnKey(rawColumns, columnKey)) return;

    if (manualSorting) {
      // Two states, not three. A header click REPLACES the order — the column
      // under the cursor becomes the one the list is sorted by — and it never
      // produces "no sort": across a server-paged collection that is an
      // arbitrary order per page (objectstack#4363), so it is not a state a
      // header should be able to ask for. Clearing a sort belongs to the host's
      // sort builder, which can also restore the view's configured default.
      const current = activeSort.find((s) => s.field === columnKey);
      applySort(columnKey, current?.order === 'asc' ? 'desc' : 'asc');
      return;
    }

    if (sortColumn === columnKey) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortDirection(null);
        setSortColumn(null);
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  // Column header context menu handler
  const handleColumnContextMenu = (e: React.MouseEvent, columnKey: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, columnKey });
  };

  // The column the open context menu belongs to (objectui#10727). The menu
  // holds only a key, so it is resolved from `columns`, the list the header
  // row renders: `isColumnSortable` then reads the very object the header's
  // cursor, click and indicator read, and the menu cannot offer a sort the
  // header refuses. `rawColumns` can carry a different `sortable` for the one
  // commit after the producer hands new columns, before `columns` re-seeds.
  // A key that names no rendered column resolves to nothing, and nothing
  // offers no sort.
  const contextMenuColumn = contextMenu
    ? columns.find((col) => col.accessorKey === contextMenu.columnKey)
    : undefined;

  const hideColumn = (columnKey: string) => {
    setColumns(prev => prev.filter(c => c.accessorKey !== columnKey));
    setContextMenu(null);
  };

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  const handleSelectAll = (checked: boolean) => {
    const newSelected = new Set<any>();
    if (checked) {
      paginatedData.forEach((row, idx) => {
        const globalIndex = (effectivePage - 1) * pageSize + idx;
        const rowId = getRowId(row, globalIndex);
        newSelected.add(rowId);
      });
    }
    setSelectedRowIds(newSelected);
    
    // Call callback if provided
    if (schema.onSelectionChange) {
      const selectedData = sortedData.filter((row, idx) => {
        const rowId = getRowId(row, idx);
        return newSelected.has(rowId);
      });
      schema.onSelectionChange(selectedData);
    }
  };

  const handleSelectRow = (rowId: any, checked: boolean) => {
    // Single mode replaces the previous selection instead of accumulating —
    // the spec's 'single' must never hold two rows (#2941).
    const newSelected = new Set(selectionMode === 'single' ? [] : selectedRowIds);
    if (checked) {
      newSelected.add(rowId);
    } else {
      newSelected.delete(rowId);
    }
    setSelectedRowIds(newSelected);
    
    // Call callback if provided
    if (schema.onSelectionChange) {
      const selectedData = sortedData.filter((row, idx) => {
        const id = getRowId(row, idx);
        return newSelected.has(id);
      });
      schema.onSelectionChange(selectedData);
    }
  };

  const handleExport = () => {
    // A MASKED column is OMITTED from the export (objectui#10583), header and
    // all: its cells draw a mask, so the file must not carry the raw value.
    // Omitted rather than blanked — a column of empty strings would assert
    // the records hold nothing, and a re-import of it would write that.
    const exportColumns = columns.filter((col) => !col.masked);
    const csvContent = [
      exportColumns.map(col => col.header).join(','),
      ...sortedData.map(row =>
        exportColumns.map(col => JSON.stringify(row[col.accessorKey] || '')).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'table-export.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  /**
   * The indicator for one column, read from {@link activeSort}.
   *
   * Every participating key is marked, not just the first: a multi-key sort
   * arrives from the host's sort builder, and showing only its primary column
   * would say "sorted by Status" about a list actually ordered by Status then
   * Rank. The rank badge appears only when there is more than one key, so the
   * ordinary single-column case renders exactly as it always has.
   */
  const getSortIcon = (columnKey: string) => {
    const index = activeSort.findIndex((s) => s.field === columnKey);
    if (index === -1) {
      return <ChevronsUpDown className="h-3 w-3 ml-0.5 opacity-0 group-hover:opacity-50 transition-opacity" />;
    }
    const Arrow = activeSort[index].order === 'asc' ? ChevronUp : ChevronDown;
    return (
      <span className="inline-flex items-center shrink-0">
        <Arrow className="h-3 w-3 ml-0.5 text-primary" />
        {activeSort.length > 1 && (
          <span className="text-[10px] font-medium text-primary tabular-nums leading-none">
            {index + 1}
          </span>
        )}
      </span>
    );
  };

  // Column resizing handlers
  const handleResizeStart = (e: React.MouseEvent, columnKey: string) => {
    if (!resizableColumns) return;
    e.preventDefault();
    e.stopPropagation();
    
    resizingColumn.current = columnKey;
    startX.current = e.clientX;
    lastResizeWidth.current = null;
    
    const headerCell = (e.target as HTMLElement).closest('th');
    if (headerCell) {
      startWidth.current = headerCell.offsetWidth;
    }
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!resizingColumn.current) return;
    
    const diff = e.clientX - startX.current;
    const newWidth = Math.max(50, startWidth.current + diff); // Min width 50px
    
    setColumnWidths(prev => ({
      ...prev,
      [resizingColumn.current!]: newWidth
    }));
    lastResizeWidth.current = newWidth;
  };

  const handleResizeEnd = () => {
    const resizedColumn = resizingColumn.current;
    const finalWidth = lastResizeWidth.current;
    resizingColumn.current = null;
    lastResizeWidth.current = null;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
    // objectui#6175: report the SETTLED width, once, at mouseup — never per
    // mousemove. `onColumnResize` was declared here and invoked nowhere, which
    // is why ObjectGrid's `saveColumnState` never ran and column widths never
    // persisted. The host turns this into a real write (localStorage plus
    // `onColumnStateChange` -> the host's own store; the console keeps it on
    // the user's own list state), so a per-move callback would be a write
    // storm.
    if (resizedColumn && finalWidth != null) {
      schema.onColumnResize?.(resizedColumn, finalWidth);
    }
  };

  // Column reordering handlers
  const handleColumnDragStart = (e: React.DragEvent, index: number) => {
    if (!reorderEnabled) return;
    setDraggedColumn(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleColumnDragOver = (e: React.DragEvent, index: number) => {
    if (!reorderEnabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(index);
  };

  const handleColumnDrop = (e: React.DragEvent, dropIndex: number) => {
    if (!reorderEnabled || draggedColumn === null) return;
    e.preventDefault();

    if (draggedColumn === dropIndex) {
      setDraggedColumn(null);
      setDragOverColumn(null);
      return;
    }

    const newColumns = [...columns];
    const [removed] = newColumns.splice(draggedColumn, 1);
    newColumns.splice(dropIndex, 0, removed);

    setColumns(newColumns);
    setDraggedColumn(null);
    setDragOverColumn(null);

    // Call callback if provided
    if (schema.onColumnsReorder) {
      schema.onColumnsReorder(newColumns);
    }
    // Design host: persist the new order to the object's field metadata.
    fieldAuthoring?.onReorderFields?.(newColumns.map((c) => c.accessorKey));
  };

  const handleColumnDragEnd = () => {
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  // Cell editing handlers
  const startEdit = (row: any, columnKey: string) => {
    if (!editable) return;
    const rowKey = pendingRowKeyOf(row);

    // Already editing THIS cell — do nothing. Re-entering would reset `editValue`
    // from `pendingChanges`, and when a widget-injected editor commits via an
    // overlay (a lookup/select popover renders in a Portal, but React events
    // still bubble through the component tree to this cell's onClick), that reset
    // reads a stale `pendingChanges` — before the just-staged value has flushed —
    // and clobbers the freshly picked value. Guard on the synchronous ref (not
    // the `editingCell` state, which can read stale under batching/contention —
    // the intermittent CI failure #2150) so the re-entrant call is always caught.
    const active = editingCellRef.current;
    if (active !== null && active.rowKey === rowKey && active.columnKey === columnKey) return;

    const column = columns.find(col => col.accessorKey === columnKey);
    if (column?.editable === false) return;
    // A MASKED column never enters edit mode, on any trigger (objectui#10583):
    // the editor is seeded with the RAW row value below, so every editor —
    // the built-in inputs and a host's `renderCellEditor` alike — would draw
    // the credential the cell's mask hides. This is the one door Enter, click
    // and double-click all pass through.
    if (column?.masked) return;

    const cell: EditingCell = { rowKey, columnKey, row };
    editingCellRef.current = cell;
    setEditingCell(cell);

    // Check if there's a pending change for this cell, otherwise use current data value
    const rowChanges = pendingChanges.get(rowKey)?.changes;
    const currentValue = row[columnKey];
    const valueToEdit = rowChanges?.[columnKey] ?? currentValue ?? '';
    setEditValue(valueToEdit);
    // Snapshot the cell's pending state so Escape/cancel can revert an injected
    // widget edit (which stages on every change) back to exactly what it was.
    editRevertRef.current = rowChanges && columnKey in rowChanges
      ? { had: true, value: rowChanges[columnKey] }
      : { had: false, value: undefined };
  };

  const saveEdit = (force: boolean = false, explicitValue?: any) => {
    if (!editingCell) return;

    // Don't save if we're in cancelled state (unless forced)
    if (!force && editingCell === null) return;

    const { rowKey, columnKey } = editingCell;
    // The record the editor is open on, as the table holds it now — or, if
    // the held rows no longer include it, the row the editor was opened on
    // (objectui#12310). Never the row now at the editor's old position.
    const row = heldRowOf(rowKey) ?? editingCell.row;

    // Discrete editors (select / checkbox) commit the chosen value synchronously
    // via `explicitValue` — their `setEditValue` hasn't flushed to state yet.
    // Otherwise the LAST value written, read from the synchronous mirror rather
    // than this render's `editValue`: a value staged earlier in the same event
    // (objectui#12664) has not reached state yet either.
    const valueToStage = explicitValue !== undefined ? explicitValue : editValueRef.current;

    // Update pending changes — or drop this cell's entry when the committed
    // value is the one the row loaded with (objectui#11816). An updater, so a
    // save that settled since this render is not undone (objectui#12322).
    const inFlight = inFlightRef.current.get(rowKey);
    setPendingChanges((prev) => stageCellChange(prev, rowKey, row, columnKey, valueToStage, inFlight));

    // Call the legacy onCellChange callback if provided
    if (schema.onCellChange) {
      schema.onCellChange(rowIndexOf(rowKey), columnKey, valueToStage, row);
    }

    editRevertRef.current = null;
    editingCellRef.current = null;
    setEditingCell(null);
    setEditValue('');
  };

  // Latest-ref to `saveEdit` so the document-level click-outside listener (whose
  // closure is captured once per edit session) always commits with the CURRENT
  // editValue rather than a stale one. Updated in an effect (after every render)
  // so it's current well before any user pointer event fires.
  const saveEditRef = useRef(saveEdit);
  useEffect(() => {
    saveEditRef.current = saveEdit;
  });

  // The injected-editor commit contract (objectui#12664): before the table
  // commits an injected editor — Enter, or a pointer press outside it — it
  // blurs the control that holds focus inside the editor, so a widget that
  // reads its own input on blur stages that value first, exactly as it would
  // when a form's Save button takes focus. A widget that stages on every
  // change is unaffected: its blur stages nothing new.
  //
  // This is how a widget TELLS the seam its pending value without a new
  // member on the `renderCellEditor` context: `stage` was always the channel,
  // and `onBlur` is the widget's own declared DOM handler. What was missing
  // was the event — the click-outside listener runs on `pointerdown`, before
  // the browser moves focus, and Enter never moved focus at all, so a
  // commit-on-blur widget (the platform date picker, which parses its
  // locale-formatted text when it loses focus) had not staged when the table
  // read the value. Escape does NOT flush: it discards, so the widget's text
  // is never read.
  const flushInjectedEditor = () => {
    const el = injectedEditorElRef.current;
    if (!el || typeof document === 'undefined') return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && el.contains(focused)) focused.blur();
  };

  // Exit edit mode. When `revert` is true, roll the active cell's pending value
  // back to the snapshot taken when editing began (see `editRevertRef`) — this
  // is what makes Escape/cancel discard an injected widget's staged changes. For
  // built-in editors (which don't stage until commit) the snapshot equals the
  // live pending value, so the revert is a no-op.
  const exitEdit = (revert: boolean) => {
    const active = editingCellRef.current;
    const snap = editRevertRef.current;
    editRevertRef.current = null;
    if (revert && active && snap) {
      const { rowKey, columnKey } = active;
      setPendingChanges((prev) => {
        const cur = prev.get(rowKey);
        const staged = !!cur && columnKey in cur.changes;
        if (!staged && !snap.had) return prev; // nothing changed for this cell
        const next = new Map(prev);
        const rc = { ...(cur?.changes || {}) };
        if (snap.had) rc[columnKey] = snap.value;
        else delete rc[columnKey];
        if (Object.keys(rc).length > 0) next.set(rowKey, { row: cur?.row ?? active.row, changes: rc });
        else next.delete(rowKey);
        return next;
      });
    }
    editingCellRef.current = null;
    setEditingCell(null);
    setEditValue('');
  };

  const cancelEdit = () => {
    // A built-in <input>'s ensuing blur must not re-save the value we're
    // discarding; injected editors have no such blur, so they call `exitEdit`
    // directly (setting this flag there would leak to the next built-in blur).
    skipBlurSaveRef.current = true;
    exitEdit(true);
  };

  // Stage an in-flight edit into pendingChanges WITHOUT closing the editor —
  // used by injected widget editors (multi-value pickers, free text) that
  // commit when the user moves on rather than on each keystroke/toggle. Mirrors
  // what saveEdit stages, minus the close.
  const stageEdit = (value: any) => {
    if (!editingCell) return;
    const { rowKey, columnKey } = editingCell;
    // The row the edit is addressed to, the way `saveEdit` addresses it.
    const row = heldRowOf(rowKey) ?? editingCell.row;
    const inFlight = inFlightRef.current.get(rowKey);
    setEditValue(value);
    setPendingChanges((prev) => stageCellChange(prev, rowKey, row, columnKey, value, inFlight));
  };

  // Commit the in-flight edit when the input loses focus (e.g. the user clicks
  // another cell). Without this, switching cells discards the typed value.
  const handleEditBlur = () => {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }
    saveEdit(true);
  };

  // Marks what a save sends as in flight until `settled` resolves, so a commit
  // on one of those cells during the save is staged (objectui#12322).
  const whileInFlight = async <T,>(
    sent: ReadonlyMap<PendingRowKey, Record<string, unknown>>,
    settled: () => Promise<T>,
  ): Promise<T> => {
    for (const [rowKey, changes] of sent) inFlightRef.current.set(rowKey, changes);
    try {
      return await settled();
    } finally {
      for (const [rowKey, changes] of sent) {
        if (inFlightRef.current.get(rowKey) === changes) inFlightRef.current.delete(rowKey);
      }
    }
  };

  // A row's own save, from the save button on the row the record is drawn on:
  // the edit kept under that record's key, handed over with the row the table
  // holds for it now (objectui#12310).
  //
  // Cell editing stays open while the save is in flight, so when it settles it
  // removes only what it sent, from the pending edits as they stand then
  // (objectui#12322).
  const saveRow = async (rowKey: PendingRowKey) => {
    const pending = pendingChanges.get(rowKey);
    
    if (!pending || Object.keys(pending.changes).length === 0) return;
    const rowChanges = pending.changes;
    const row = heldRowOf(rowKey) ?? pending.row;
    const sent = new Map([[rowKey, rowChanges]]);
    // The editor open when the save was pressed, if any.
    const openEditor = editingCellRef.current;
    
    setIsSaving(true);
    try {
      await whileInFlight(sent, async () => {
        if (schema.onRowSave) {
          await schema.onRowSave(rowIndexOf(rowKey), rowChanges, row);
        }
      });
      
      // Clear this row's saved edits, and only those.
      setPendingChanges((prev) => removeSentEdits(prev, sent));
      // A staged editor (e.g. a lookup picker, which keeps its widget open on
      // pick rather than committing) must exit edit mode once its value is
      // persisted — otherwise the saved cell stays stuck showing the editor.
      // Only the editor that was open on this row when the save was pressed:
      // one opened during the save is still in use.
      if (openEditor !== null && openEditor.rowKey === rowKey && editingCellRef.current === openEditor) {
        editingCellRef.current = null;
        setEditingCell(null);
        setEditValue('');
      }
      // Saved — drop any prior error for this row, and clear the banner once
      // no errored rows remain.
      setErroredRows((prev) => {
        if (!prev.has(rowKey)) return prev;
        const next = new Set(prev);
        next.delete(rowKey);
        if (next.size === 0) setSaveError(null);
        return next;
      });
    } catch (error) {
      // Keep the pending change so the author can fix and retry; surface the
      // reason instead of failing silently, and flag the row.
      console.error('Failed to save row:', error);
      setSaveError(extractSaveErrorMessage(error));
      setErroredRows((prev) => new Set(prev).add(rowKey));
    } finally {
      setIsSaving(false);
    }
  };

  const cancelRowChanges = (rowKey: PendingRowKey) => {
    const newPendingChanges = new Map(pendingChanges);
    newPendingChanges.delete(rowKey);
    setPendingChanges(newPendingChanges);
    setErroredRows((prev) => {
      if (!prev.has(rowKey)) return prev;
      const next = new Set(prev);
      next.delete(rowKey);
      if (next.size === 0) setSaveError(null);
      return next;
    });
  };

  // Save All. Like `saveRow`, it settles against the pending edits as they
  // stand when the batch returns, and removes only what it sent
  // (objectui#12322).
  const saveBatch = async () => {
    if (pendingChanges.size === 0) return;
    const sent = new Map(Array.from(pendingChanges, ([rowKey, pending]) => [rowKey, pending.changes] as const));
    // The editor open when Save All was pressed, if any.
    const openEditor = editingCellRef.current;
    
    setIsSaving(true);
    try {
      // The record key each handed-over `rowIndex` came from, so a per-row
      // outcome can name its row back (objectui#12292).
      //
      // Each edit goes out with its OWN record, resolved by key when Save All
      // is pressed (objectui#12310): the row the table holds for that record
      // now, with its global index; or, when the held rows no longer include
      // it, the row the edit was staged against, with a negative `rowIndex`
      // (-1, -2, …) that no held row can carry, so the outcome still names
      // each entry apart. A position is never what picks the record.
      const keyOfRowIndex = new Map<number, PendingRowKey>();
      let notHeld = 0;
      const changesToSave = Array.from(pendingChanges.entries()).map(([rowKey, pending]) => {
        const held = heldRowOf(rowKey);
        const rowIndex = held === undefined ? -(++notHeld) : rowIndexOf(rowKey);
        keyOfRowIndex.set(rowIndex, rowKey);
        return { rowIndex, changes: pending.changes, row: held ?? pending.row };
      });

      // `void` at runtime is `undefined`: the handler persisted every row.
      const outcome = (schema.onBatchSave
        ? await whileInFlight(sent, async () => schema.onBatchSave?.(changesToSave))
        : undefined) as BatchSaveOutcome | undefined;
      const failed = outcome?.failed ?? [];
      const failedKeys = new Set<PendingRowKey>();
      for (const entry of failed) {
        const key = keyOfRowIndex.get(entry.rowIndex);
        // A failure naming a row this batch never handed over cannot be
        // placed, so no row can be called persisted: fall back to the
        // all-or-nothing reading below rather than clear an unsaved edit.
        if (key === undefined) throw entry.error;
        failedKeys.add(key);
      }

      // Any staged editor left open (e.g. a lookup picker that keeps its widget
      // open on pick) must exit edit mode now that the batch has settled —
      // otherwise the edited cell stays stuck showing the editor after 全部保存.
      // Only the editor that was open when Save All was pressed: one opened
      // during the save is still in use.
      if (openEditor !== null && editingCellRef.current === openEditor) {
        editingCellRef.current = null;
        setEditingCell(null);
        setEditValue('');
      }
      if (failedKeys.size > 0) {
        // Per-row outcome: the rows that persisted are cleared, and only the
        // rows that did not are kept and flagged. The server already accepted
        // the others, so keeping them pending would report a landed write as
        // a failed one, and a retry would send it again.
        console.error('Failed to save rows:', failed.map((entry) => entry.error));
        const landed = new Map(Array.from(sent).filter(([key]) => !failedKeys.has(key)));
        setPendingChanges((prev) => removeSentEdits(prev, landed));
        setErroredRows(failedKeys);
        setSaveError(extractSaveErrorMessage(failed[0].error));
        return;
      }
      // Clear every edit the batch saved, and only those.
      setPendingChanges((prev) => removeSentEdits(prev, sent));
      // Saved — clear any prior errors.
      setErroredRows(new Set());
      setSaveError(null);
    } catch (error) {
      // A rejection says nothing about which rows landed, so it is read as
      // all-or-nothing: keep every pending row, flag every row it sent (not
      // one staged during the save), and surface the reason instead of
      // failing silently.
      console.error('Failed to save batch:', error);
      setSaveError(extractSaveErrorMessage(error));
      setErroredRows(new Set(sent.keys()));
    } finally {
      setIsSaving(false);
    }
  };

  const cancelAllChanges = () => {
    setPendingChanges(new Map());
    setErroredRows(new Set());
    setSaveError(null);
  };

  // ── Keyboard navigation (objectui#11068) ──────────────────────────────────
  //
  // Arrow-key cell navigation on the WAI-ARIA grid pattern, behind
  // `keyboardNavigation`. Off — the default, and every host but `ObjectGrid`
  // leaves it off — nothing below changes the table: every data cell is its own
  // Tab stop (`tabIndex={0}`), the markup carries no grid role, and the arrows
  // do what the browser does with them.
  //
  // On, the table is a `grid` and its data cells are a ROVING tab stop: exactly
  // one of them is in the Tab sequence (`tabIndex` 0, the rest -1), so Tab
  // reaches the cells once instead of once per cell. That cell is the one that
  // last held focus — a click, a Tab, an arrow — and the first cell of the first
  // row until one has. Its position is clamped to the page on every render, so a
  // shorter page, a filter or a removed column never leaves the grid with NO
  // cell in the Tab sequence.
  //
  // Only the data cells rove. A widget a cell renders (a record link, a row's
  // action menu, a selection checkbox) keeps its own Tab stop: it is the cell
  // renderer's markup, not this table's, and taking it out of the sequence
  // would leave it with no keyboard path at all.
  const tableRef = useRef<HTMLTableElement | null>(null);

  /**
   * objectui#12463 — the right-edge scroll shadow: drawn while more columns
   * remain to the right of the box (`scrollLeft + clientWidth < scrollWidth`)
   * and gone at the far right. It replaces the box's static inset shadow,
   * which the table cells' own opaque backgrounds painted over, so it never
   * showed. The overlay sits beside the box (not inside it, or it would scroll
   * away with the content), at the seam where the content slides under the
   * right-pinned columns (the auto-pinned row-actions column), and clear of
   * the box's own vertical scrollbar. `pointer-events-none`: it never takes a
   * click, and being absolutely positioned it moves no layout. A grouped
   * sub-table (`disableInnerScroll`) scrolls in a shared ancestor and draws
   * none.
   */
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  // Whether columns remain to the right: the shared overflow read
  // (objectui#12708), the same one `ObjectGrid`'s grouped scroller and a
  // page's own table use. Only the shadow's PLACEMENT is this table's own.
  const overflowRight = useHorizontalOverflow(scrollBoxRef, { disabled: disableInnerScroll });
  const [rightShadow, setRightShadow] = useState<{ right: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const box = scrollBoxRef.current;
    if (!overflowRight || !box) {
      setRightShadow(null);
      return;
    }
    const measure = () => {
      const cs = typeof getComputedStyle === 'function' ? getComputedStyle(box) : null;
      const borderX = cs ? (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0) : 0;
      const borderY = cs ? (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0) : 0;
      const scrollbarY = Math.max(0, box.offsetWidth - box.clientWidth - borderX);
      const scrollbarX = Math.max(0, box.offsetHeight - box.clientHeight - borderY);
      let pinnedRight = 0;
      const headerRow = headerRowRef.current;
      if (headerRow) {
        columns.forEach((col, index) => {
          if (!isPinnedRightColumn(col)) return;
          const cell = headerRow.children[leadingCellCount + index] as HTMLElement | undefined;
          if (cell) pinnedRight += cell.getBoundingClientRect().width;
        });
      }
      const right = Math.round(scrollbarY + pinnedRight + (cs ? parseFloat(cs.borderRightWidth) || 0 : 0));
      const bottom = Math.round(scrollbarX + (cs ? parseFloat(cs.borderBottomWidth) || 0 : 0));
      setRightShadow((prev) => (prev && prev.right === right && prev.bottom === bottom ? prev : { right, bottom }));
    };
    measure();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(box);
      if (tableRef.current) observer.observe(tableRef.current);
    }
    return () => observer?.disconnect();
  }, [overflowRight, columns, leadingCellCount, paginatedData.length]);

  const [rovingCell, setRovingCell] = useState<{ rowIndex: number; colIndex: number }>({ rowIndex: 0, colIndex: 0 });
  const rovingRowIndex = Math.max(0, Math.min(rovingCell.rowIndex, paginatedData.length - 1));
  const rovingColIndex = Math.max(0, Math.min(rovingCell.colIndex, columns.length - 1));
  // A cell whose edit was just ended from the keyboard, to be focused once the
  // editor has unmounted (the effect below). A ref, not state: it is consumed
  // by the commit that follows, and must not cause a render of its own.
  const pendingCellFocusRef = useRef<{ rowIndex: number; colIndex: number } | null>(null);

  const rove = (rowIndex: number, colIndex: number) => {
    setRovingCell((prev) =>
      prev.rowIndex === rowIndex && prev.colIndex === colIndex ? prev : { rowIndex, colIndex });
  };

  const focusGridCell = (rowIndex: number, colIndex: number) => {
    const cell = tableRef.current?.querySelector<HTMLElement>(`[data-grid-cell="${rowIndex}:${colIndex}"]`);
    if (!cell) return;
    rove(rowIndex, colIndex);
    cell.focus();
  };

  // The edit's editor is gone once this runs, so focus has nowhere to land but
  // `<body>` — hand it back to the cell, where the arrows carry on. Only an edit
  // ended by a key that bubbled through its cell arms this (see
  // `handleCellKeyDown`): one committed by a pointer press elsewhere leaves
  // focus where that press put it.
  useEffect(() => {
    const target = pendingCellFocusRef.current;
    if (!target || editingCell) return;
    pendingCellFocusRef.current = null;
    if (!keyboardNavigation) return;
    focusGridCell(target.rowIndex, target.colIndex);
  });

  /**
   * The cell an arrow / Home / End press moves to, or `null` when the key is
   * not a navigation key. At an edge the answer is the cell itself: the key is
   * still the grid's (the page must not scroll under a focused cell), and focus
   * stays put, as the pattern asks.
   */
  const navigationTarget = (
    e: React.KeyboardEvent,
    rowIndex: number,
    colIndex: number,
  ): { rowIndex: number; colIndex: number } | null => {
    // Shift / Alt / Meta combinations belong to the browser and the OS (text
    // selection, history, app shortcuts); Ctrl only qualifies Home / End.
    if (e.shiftKey || e.altKey || e.metaKey) return null;
    const lastRow = paginatedData.length - 1;
    const lastCol = columns.length - 1;
    if (e.ctrlKey) {
      if (e.key === 'Home') return { rowIndex: 0, colIndex: 0 };
      if (e.key === 'End') return { rowIndex: lastRow, colIndex: lastCol };
      return null;
    }
    switch (e.key) {
      case 'ArrowUp': return { rowIndex: Math.max(0, rowIndex - 1), colIndex };
      case 'ArrowDown': return { rowIndex: Math.min(lastRow, rowIndex + 1), colIndex };
      case 'ArrowLeft': return { rowIndex, colIndex: Math.max(0, colIndex - 1) };
      case 'ArrowRight': return { rowIndex, colIndex: Math.min(lastCol, colIndex + 1) };
      case 'Home': return { rowIndex, colIndex: 0 };
      case 'End': return { rowIndex, colIndex: lastCol };
      default: return null;
    }
  };

  const handleCellKeyDown = (e: React.KeyboardEvent, rowIndex: number, colIndex: number, columnKey: string) => {
    if (keyboardNavigation) {
      // An edit in this cell that the key now bubbling through it just ended
      // (Enter committed it, Escape cancelled it): `editingCellRef` is cleared
      // synchronously by the editor's own handler, while `editingCell` is still
      // this render's value. Focus goes back to the cell after the commit.
      if (editingCell && editingCellRef.current === null && (e.key === 'Enter' || e.key === 'Escape')) {
        pendingCellFocusRef.current = { rowIndex, colIndex };
        return;
      }
      // The cell itself, not a widget inside it: a link, a picker or an editor
      // keeps the keys it handles.
      if (!editingCell && e.target === e.currentTarget) {
        const next = navigationTarget(e, rowIndex, colIndex);
        if (next) {
          e.preventDefault();
          focusGridCell(next.rowIndex, next.colIndex);
          return;
        }
      }
    }

    // Copy cell value with Ctrl+C / Cmd+C
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !editingCell) {
      // objectui#13188 — text the viewer selected in this cell is what they
      // copy: the browser's own copy runs. A masked cell never gets here
      // with its default intact — the mask rule below goes first.
      if (!columns.find((col) => col.accessorKey === columnKey)?.masked && hasTextSelectionIn(e.currentTarget)) return;
      e.preventDefault();
      // A MASKED column copies NOTHING (objectui#10583) — the producer drew a
      // mask, so the keyboard must not hand out what the cell hides. The
      // detail page's house shape (objectui#8440, option A): no copy at all,
      // ⛔ not the bullets — which is also why `preventDefault()` above stays:
      // measured in Chromium, letting the default run copies a selected mask
      // as `••••••`, the payload that ruling refused. Unmasked cells are
      // untouched below.
      if (columns.find((col) => col.accessorKey === columnKey)?.masked) return;
      const globalIdx = (effectivePage - 1) * pageSize + rowIndex;
      const row = sortedData[manualPagination ? rowIndex : globalIdx];
      if (row) {
        const value = row[columnKey];
        const text = value != null ? String(value) : '';
        navigator.clipboard.writeText(text).catch(() => {
          // Fallback for environments without clipboard API
        });
      }
      return;
    }

    if (!editable) return;
    
    const column = columns.find(col => col.accessorKey === columnKey);
    if (column?.editable === false) return;
    
    if (e.key === 'Enter' && !editingCell) {
      e.preventDefault();
      startEdit(paginatedData[rowIndex], columnKey);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Already saving here; suppress the redundant save the ensuing blur triggers.
      skipBlurSaveRef.current = true;
      saveEdit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  // Auto-focus on edit input when entering edit mode
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // Commit a host-injected widget editor on click-outside (objectui#2321).
  //
  // Built-in `<input>` editors commit via their own onBlur (handleEditBlur). The
  // widgets injected through `renderCellEditor` (text, number, date, lookup, …)
  // never receive one — not because they cannot deliver it (they can, and do:
  // see `injectedEditorElRef` above and `64d937c53`) but because nothing on
  // this seam passes it to them — so without this they stay stuck in edit mode
  // when the user clicks away. A capture-phase document listener (capture so a cell's
  // own `stopPropagation` can't hide it) commits the staged value and exits edit
  // mode when the pointer goes down truly outside the editor — but NOT inside a
  // Radix overlay the widget itself opened (a lookup popover / record-picker
  // dialog renders in a portal at <body> yet is logically part of the editor).
  // Only armed while an INJECTED editor is mounted (`injectedEditorElRef` set);
  // built-in editors keep their existing blur path untouched.
  useEffect(() => {
    if (!editingCell) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = injectedEditorElRef.current;
      if (!el) return; // built-in editor → its own onBlur handles the commit
      const target = e.target as Node | null;
      if (!target || el.contains(target)) return; // inside the editor itself
      if (target instanceof Element) {
        // A transient popper (Popover/Select/Menu) the widget opened. Guard on
        // `!contains(el)` so a popper that merely HOSTS the grid never suppresses
        // the commit — only one stacked ABOVE the editor does.
        const popper = target.closest('[data-radix-popper-content-wrapper]');
        if (popper && !popper.contains(el)) return;
        // A dialog/sheet the widget opened (e.g. the lookup record-picker) —
        // again only when it's a nested overlay above the editor, not the modal
        // that happens to contain the whole grid.
        const dialog = target.closest('[role="dialog"],[role="alertdialog"]');
        if (dialog && !dialog.contains(el)) return;
      }
      // Truly outside → commit the staged value and exit edit mode, matching the
      // built-in inputs' commit-on-blur. The focused control is blurred first
      // (objectui#12664): this runs before the browser moves focus, so a
      // widget that reads its input on blur would otherwise not have staged.
      flushInjectedEditor();
      saveEditRef.current(true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editingCell]);

  // objectui#11682 — read back what the auto-sized columns DREW, for the
  // width estimate (`autoSizedWidths`). Each such column's header label and
  // display cells carry `AUTO_WIDTH_ATTR`; what they hold is the formatted
  // content the column's own renderer produced (the display locale's grouping
  // and currency, a percent's conversion and its bar, a lookup's resolved
  // name, a select's badge), so the estimate never re-derives it.
  //
  // Read in a layout effect after every commit, so the first frame the user
  // sees is already sized from the drawn content, and measured only when what
  // was drawn changed (`drawnSizeSignature`): a commit that draws the same
  // text in the same cells costs two queries and no layout. Read again when a
  // cell's content changes AFTER this table rendered (a lookup cell resolves
  // its name asynchronously, inside its own component), through a
  // MutationObserver on the body; when the table changes size (a table shown
  // from a hidden panel is laid out for the first time); and once the fonts
  // have loaded (a width read in a fallback font is not the drawn one). Text
  // and nodes only are observed: the probe and the style writes a re-size
  // makes are attribute changes, and the state is replaced only when a size
  // moved, so a read can never feed itself.
  //
  // Skipped while a cell is edited: its display element is unmounted for the
  // editor, and a read then would size its column without it.
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null);
  const drawnSignatureRef = useRef<string | null>(null);
  // The last read, mirrored so an equal read writes no state at all (and so
  // costs this table no commit).
  const drawnSizesRef = useRef<DrawnColumnSizes | null>(null);
  const readDrawnSizesRef = useRef<(force?: boolean) => void>(() => {});
  useLayoutEffect(() => {
    readDrawnSizesRef.current = (force = false) => {
      const body = tableBodyRef.current;
      if (!body || editingCellRef.current) return;
      const { heads, cells } = drawnSizeTargets(headerRowRef.current, body);
      const signature = drawnSizeSignature([...heads, ...cells]);
      if (!force && signature === drawnSignatureRef.current) return;
      const next = measureDrawnColumnSizes(heads, cells);
      // The chip floors, once per data load (objectui#12708): the first read
      // that is laid out after the rows on screen changed.
      // The props, not `data`: a grouped table's `data` is a memoised flatten.
      const load = [rowGroups ?? rawData, effectivePage, pageSize] as const;
      const prevLoad = chipFloorLoadRef.current;
      if (next.cellPx && !(prevLoad && load.every((v, i) => v === prevLoad[i]))) {
        chipFloorLoadRef.current = load;
        const floors: Record<string, number> = {};
        for (const col of columns) {
          const need = col.chips === true ? next.cellPx[col.accessorKey] : undefined;
          if (need !== undefined) floors[col.accessorKey] = need;
        }
        setChipFloors((prev) => (sameNumberRecord(prev, floors) ? prev : floors));
      }
      // A read with nothing laid out is not remembered, so the next commit or
      // resize reads again instead of keeping the text-only estimate.
      drawnSignatureRef.current = next.px ? signature : null;
      if (drawnSizesRef.current && sameDrawnSizes(drawnSizesRef.current, next)) return;
      drawnSizesRef.current = next;
      setDrawnSizes(next);
    };
    readDrawnSizesRef.current();
  });
  useEffect(() => {
    const body = tableBodyRef.current;
    if (!body) return;
    const read = () => readDrawnSizesRef.current();
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(read);
    mutations?.observe(body, { subtree: true, childList: true, characterData: true });
    const table = tableRef.current;
    const resizes = typeof ResizeObserver === 'undefined' || !table ? null : new ResizeObserver(read);
    if (table) resizes?.observe(table);
    let live = true;
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    fonts?.ready?.then(() => { if (live) readDrawnSizesRef.current(true); });
    return () => {
      live = false;
      mutations?.disconnect();
      resizes?.disconnect();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
  }, []);

  // Check if all rows on current page are selected
  const allPageRowsSelected = paginatedData.length > 0 && paginatedData.every((row, idx) => {
    const globalIndex = (effectivePage - 1) * pageSize + idx;
    const rowId = getRowId(row, globalIndex);
    return selectedRowIds.has(rowId);
  });
  
  const somePageRowsSelected = paginatedData.some((row, idx) => {
    const globalIndex = (effectivePage - 1) * pageSize + idx;
    const rowId = getRowId(row, globalIndex);
    return selectedRowIds.has(rowId);
  }) && !allPageRowsSelected;

  const hasPendingChanges = pendingChanges.size > 0;
  // objectui#11816 — the trailing `rowActions` column is an EDIT column, not an
  // actions column, when nothing can put a row menu in it: the table is
  // editable with a save path, and no menu handler is supplied. Its cells then
  // only ever hold a modified row's cancel/save pair. That is the shape
  // `ObjectGrid` builds — its row menu lives in a host column of its own,
  // already headed "Actions" — so titling this one "Actions" as well drew two
  // columns of that name side by side. It is headed by the pencil the
  // toolbar's "Edit inline" toggle carries, named `table.edit` for assistive
  // tech. The same three menu inputs `DataTableRowActionsMenu` reads.
  const rowMenuDeclared = !!(
    schema.onRowEdit ||
    schema.onRowDelete ||
    (Array.isArray(schema.rowActionDefs) && schema.rowActionDefs.length > 0 && schema.onRowActionDef)
  );
  const rowActionsColumnIsEditOnly = editable && !!(schema.onRowSave || schema.onBatchSave) && !rowMenuDeclared;
  const showToolbar = searchEnabled || exportable || (showSelectionCount && selectable && selectedRowIds.size > 0) || hasPendingChanges;

  // The span of a row drawn as one cell across the table: the leading utility
  // cell, every column, the row-actions cell and the add-column cell.
  const fullRowColSpan = columns.length + leadingCellCount + (rowActions ? 1 : 0) + (addColumnEnabled ? 1 : 0);

  // What the body draws, in order. Flat: the data rows. Grouped (objectui#12620):
  // per group, its band, its data rows and its optional footer. A data row
  // keeps its index in `paginatedData`, so selection, keyboard navigation and
  // every per-row callback read a grouped row exactly as a flat one.
  type BodyItem =
    | { kind: 'row'; row: any; rowIndex: number }
    | { kind: 'band'; group: RowGroup }
    | { kind: 'footer'; group: RowGroup };
  const bodyItems: BodyItem[] = groupLayout
    ? groupLayout.flatMap(({ group, start, length }) => [
      { kind: 'band' as const, group },
      ...paginatedData.slice(start, start + length).map((row, at) => ({ kind: 'row' as const, row, rowIndex: start + at })),
      ...(group.footer != null ? [{ kind: 'footer' as const, group }] : []),
    ])
    : paginatedData.map((row, rowIndex) => ({ kind: 'row' as const, row, rowIndex }));

  return (
    <div className={`flex flex-col h-full gap-2 sm:gap-4 ${className || ''}`}>
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-4 flex-none">
          <div className="flex items-center gap-2 flex-1">
            {searchEnabled && (
              <div className="relative w-full sm:max-w-sm flex-1">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('table.search')}
                  value={activeSearch}
                  onChange={(e) => applySearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {hasPendingChanges && (
              <>
                {saveError && (
                  <div
                    role="alert"
                    className="flex items-center gap-1.5 text-sm text-destructive max-w-[16rem] sm:max-w-sm"
                  >
                    <AlertCircle className="h-4 w-4 flex-none" />
                    <span className="truncate" title={`${t('table.saveFailed')}: ${saveError}`}>
                      {t('table.saveFailed')}: {saveError}
                    </span>
                  </div>
                )}
                <div className="text-sm text-muted-foreground">
                  {t('table.modified', { count: pendingChanges.size })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelAllChanges}
                  disabled={isSaving}
                >
                  <X className="h-4 w-4 mr-2" />
                  {t('table.cancelAll')}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={saveBatch}
                  disabled={isSaving}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {t('table.saveAll', { count: pendingChanges.size })}
                </Button>
              </>
            )}
            
            {exportable && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={sortedData.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                {t('table.exportCSV')}
              </Button>
            )}
            
            {showSelectionCount && selectable && selectedRowIds.size > 0 && (
              <div className="text-sm text-muted-foreground">
                {t('table.selected', { count: selectedRowIds.size })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table. When `borderless`, drop the rounded frame so the table sits
          flush against its container. The outer box holds the scroll box and
          the right-edge scroll shadow beside it (objectui#12463). */}
      <div className={cn("relative", !disableInnerScroll && "flex flex-col flex-1 min-h-0")}>
      <div
        ref={scrollBoxRef}
        data-testid="data-table-scroll-box"
        className={cn(
        "relative bg-background",
        // When embedded in a shared scroll container (grouped grid), let the
        // table overflow outward instead of creating its own scrollbar so all
        // sub-tables share one horizontal scrollbar with aligned columns.
        disableInnerScroll
          ? "overflow-visible"
          : ["flex-1 min-h-0 overflow-auto [-webkit-overflow-scrolling:touch]", HOVER_SCROLLBAR_CLASSES],
        !borderless && "rounded-md border",
      )}>
        {/* This div is already the (bounded) scroll container for BOTH axes —
            or, in grouped mode, the table overflows into a shared ancestor
            scroller. Either way the shadcn <Table>'s default `overflow-auto`
            wrapper must NOT create a second, height-unbounded scroll context;
            otherwise the horizontal scrollbar drops to the bottom of all rows
            and is only reachable after scrolling to the last row. */}
        <Table
          ref={tableRef}
          containerClassName="overflow-visible"
          // objectui#11068 — the WAI-ARIA grid pattern's container role, which
          // tells assistive tech the arrow keys move between cells. Only when
          // the table really does that; otherwise it stays a plain table.
          role={keyboardNavigation ? 'grid' : undefined}
        >
          {caption && <TableCaption>{caption}</TableCaption>}
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow ref={headerRowRef}>
              {selectable && (
                <TableHead className={cn("w-10 bg-background", showRowNumbers ? "px-0" : "px-3", frozenColumns > 0 && "sticky left-0 z-20")}>
                  {/* Select-all is a multi-select affordance; a 'single' view
                      keeps the column (alignment) but offers no way to select
                      more than one row (#2941). */}
                  {/* objectui#13293 — with row numbers on, the rows centre their
                      checkbox and number in the leading cell, so select-all is
                      centred too; without them both sit at the cell's start.
                      The centred cells drop their side padding: the base cell
                      zeroes the right padding of any cell holding a checkbox,
                      and a 12px/0 cell centres its text 6px right of the
                      absolutely placed checkbox. */}
                  {selectionMode === 'multiple' && (
                    <div data-slot="select-all" className={cn("flex items-center", showRowNumbers && "justify-center")}>
                      <Checkbox
                        checked={allPageRowsSelected ? true : somePageRowsSelected ? 'indeterminate' : false}
                        onCheckedChange={handleSelectAll}
                        aria-label={t('table.selectAllRows')}
                      />
                    </div>
                  )}
                </TableHead>
              )}
              {/* With selection on, the row number shares the select-all
                  column's cell (objectui#12423), so `#` heads it only alone. */}
              {showRowNumbers && !selectable && (
                <TableHead className={cn("w-10 bg-background text-center px-3", frozenColumns > 0 && "sticky left-0 z-20")}>
                  <span className="text-xs text-muted-foreground">#</span>
                </TableHead>
              )}
              {columns.map((col, index) => {
                // `fitContent` columns hug their content (no fixed width /
                // char-estimate) so inline row-action buttons never get clipped.
                const isFit = col.fitContent === true
                  && !columnWidths[col.accessorKey] && !col.width;
                const columnWidth = isFit
                  ? '1%'
                  : resolvedColumnWidth(col);
                const isDragging = draggedColumn === index;
                const isDragOver = dragOverColumn === index;
                const isFrozen = frozenColumns > 0 && index < frozenColumns;
                // Right-pinned columns (e.g. the auto-pinned row-actions column)
                // carry their sticky class via `col.className`. The header cell
                // otherwise appends a `relative` position utility below, which —
                // because `cn` is tailwind-merge — would win over that `sticky`
                // and let the header scroll away while its body cells stay pinned.
                // Detect it here so we skip `relative` and re-assert the pin.
                const isPinnedRight = isPinnedRightColumn(col);
                const pinnedRightOffset = isPinnedRight ? measuredStickyRights?.[col.accessorKey] : undefined;
                const frozenOffset = isFrozen
                  ? measuredStickyLefts?.[leadingCellCount + index]
                    ?? columns.slice(0, index).reduce((sum, c, i) => {
                      if (i < frozenColumns) {
                        const w = resolvedColumnWidth(c);
                        return sum + (typeof w === 'number' ? w : w ? parseInt(String(w), 10) || 150 : 150);
                      }
                      return sum;
                    }, leadingCellCount * 40)
                  : undefined;
                
                return (
                  <TableHead
                    key={col.accessorKey}
                    // Which column this header is, for a host that reads the
                    // rendered table (objectui#12725: Studio's canvas selects
                    // the column a header click names). Nothing else in the
                    // header carries the key on every column.
                    data-column-key={col.accessorKey}
                    className={cn(
                      col.className,
                      isColumnSortable(col) && 'cursor-pointer select-none',
                      isDragging && 'opacity-50',
                      isDragOver && 'border-l-2 border-primary',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      isFit && 'whitespace-nowrap',
                      'group bg-background',
                      // `relative` anchors the resize handle; a sticky cell is
                      // already its own positioning context, so only add it when
                      // the column isn't right-pinned (else it clobbers sticky).
                      !isPinnedRight && 'relative',
                      // Re-assert the pin AFTER col.className so tailwind-merge
                      // keeps it, and bump above body pinned cells (z-10).
                      isPinnedRight && 'sticky right-0 z-20',
                      isFrozen && 'sticky z-20',
                      isFrozen && index === frozenColumns - 1 && 'border-r-2 border-border shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]',
                    )}
                    style={{ 
                      width: columnWidth,
                      minWidth: columnWidth,
                      ...(isFrozen && { left: frozenOffset }),
                      ...(pinnedRightOffset ? { right: pinnedRightOffset } : {}),
                    }}
                    draggable={reorderEnabled}
                    onDragStart={(e) => handleColumnDragStart(e, index)}
                    onDragOver={(e) => handleColumnDragOver(e, index)}
                    onDrop={(e) => handleColumnDrop(e, index)}
                    onDragEnd={handleColumnDragEnd}
                    onClick={() => isColumnSortable(col) && handleSort(col.accessorKey)}
                    onContextMenu={(e) => handleColumnContextMenu(e, col.accessorKey)}
                  >
                    <div className={cn(
                      "flex items-center",
                      col.align === 'right' ? 'justify-end' : 'justify-between'
                    )}>
                      <div
                        className="flex items-center gap-1"
                        // The header half of the drawn-size read the auto
                        // width is estimated from (objectui#11682).
                        data-auto-width-key={autoWidthKey(col)}
                      >
                        {reorderEnabled && (
                          <GripVertical className="h-4 w-4 opacity-0 group-hover:opacity-50 cursor-grab active:cursor-grabbing shrink-0" />
                        )}
                        {col.headerIcon && (
                          <span className="text-muted-foreground shrink-0">{col.headerIcon}</span>
                        )}
                        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap truncate">{col.header}</span>
                        {isColumnSortable(col) && getSortIcon(col.accessorKey)}
                        {editColumnEnabled && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              fieldAuthoring!.onEditColumn!(col.accessorKey);
                            }}
                            title={fieldAuthoring!.editColumnLabel ?? 'Edit field'}
                            aria-label={fieldAuthoring!.editColumnLabel ?? 'Edit field'}
                            data-testid={`grid-edit-column-${col.accessorKey}`}
                            className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                          >
                            <Edit className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {resizableColumns && col.resizable !== false && (
                        <div
                          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary opacity-0 hover:opacity-100 transition-opacity"
                          onMouseDown={(e) => handleResizeStart(e, col.accessorKey)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                    </div>
                  </TableHead>
                );
              })}
              {/* The label sits in the same `text-xs` muted span every data
                  column's header label uses (objectui#11816): a bare string
                  here took the cell's larger default type. */}
              {rowActions && (rowActionsColumnIsEditOnly ? (
                <TableHead
                  className="w-24 text-right bg-background"
                  title={t('table.edit')}
                  data-testid="data-table-edit-column-header"
                >
                  <Pencil aria-hidden="true" className="inline-block h-3.5 w-3.5" />
                  <span className="sr-only">{t('table.edit')}</span>
                </TableHead>
              ) : (
                <TableHead className="w-24 text-right bg-background">
                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">{t('common.actions')}</span>
                </TableHead>
              ))}
              {addColumnEnabled && (
                <TableHead className="w-10 bg-background px-1 text-center">
                  <button
                    type="button"
                    onClick={fieldAuthoring!.onAddColumn}
                    title={fieldAuthoring!.addColumnLabel ?? 'Add field'}
                    aria-label={fieldAuthoring!.addColumnLabel ?? 'Add field'}
                    data-testid="grid-add-column"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody ref={tableBodyRef}>
            {/* A grouped table with any group draws its bands even when no
                group holds a row, all of them collapsed (objectui#12620). */}
            {paginatedData.length === 0 && !groupLayout?.length ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={fullRowColSpan}
                  className="h-48 text-center text-muted-foreground border-0"
                >
                  <div className="flex flex-col items-center justify-center gap-3">
                    <Search className="h-8 w-8 text-muted-foreground/50" />
                    <div className="space-y-1">
                      <p>{t('table.noResults')}</p>
                      <p className="text-xs text-muted-foreground/50">{t('table.noResultsHint')}</p>
                    </div>
                    {/* CTA slot — when the schema declares an `emptyAction`,
                        render it as an inviting follow-up instead of leaving
                        the user at a dead end. The node can be any schema node
                        (button, link, action) authored in JSON.

                        Mounted through `SchemaRenderer`, NOT by resolving the
                        registry here. `visibleWhen` is enforced once and
                        generically in `packages/react/src/SchemaRenderer.tsx`:
                        `shouldHide` tests it ahead of the hoisted `visible`
                        (objectui#5454), sets `_hidden`, and the `_hidden` early
                        return fires BEFORE the registry dispatches. The direct
                        `ComponentRegistry.get(node.type)` this replaced skipped
                        that path entirely, so an authored `visibleWhen` on an
                        `emptyAction` was accepted by the spec and then never
                        evaluated — declared-not-enforced (objectui#5926 gap 1),
                        the same class `c86185eb5` closed for
                        `record:alert`, one level down.

                        Routing to the ONE gate rather than adding a local
                        `visibleWhen` test here is the whole point: a second
                        check on this slot would be a FOURTH evaluator, which is
                        exactly the drift `page:tabs`' item-level predicate
                        already records. Same shape as the `empty` renderer's
                        `action` slot, which has always mounted its authored
                        node this way. Consequence worth stating: a node whose
                        `type` is missing or unregistered now gets the
                        platform's uniform "unknown component type" report
                        instead of rendering as silent nothing here — one
                        answer for malformed metadata, not a private one.

                        No object-only guard either (objectui#8331), ruled one
                        slot over together with the declaration: objectui#7105
                        (director seat, decision batch #69, 2026-09-07) settled
                        the identical shape on `EmptySchema.action` as RELAX THE
                        RENDERER, do not narrow the declaration. `emptyAction`
                        is declared `SchemaNode` on BOTH published faces, and a
                        `typeof === 'object'` test made this slot narrower than
                        the thing it declares: a bare string was silently
                        DROPPED instead of rendering as its own text.

                        The truthiness leg STAYS and the `&&` chain became a
                        ternary. Both are load-bearing, and together they make
                        this slot behave exactly as handing the raw node to
                        `SchemaRenderer` would - the "one answer, not a private
                        one" rule above, extended to the non-object members of
                        the union:

                        - `toRenderableSchema` is the repo's permanent bridge
                          onto `SchemaRendererProps['schema']`, which declares
                          no `number` / `boolean` (objectui#4548 ruling Q2).
                          Since objectui#8908 it is behaviour-preserving across
                          the WHOLE union: a truthy primitive becomes its text,
                          which is what the renderer's own defensive branch
                          produces, and a falsy one becomes nothing, which is
                          what the renderer's first leg produces. Until then it
                          mapped every `number` / `boolean` onto its `String`
                          form, so `0` / `false` arrived as the text "0" and
                          "false" while `SchemaRenderer` renders them as nothing
                          (pinned, objectui#4548) - and gating on truthiness is
                          what kept THIS slot out of that defect while the
                          shipped `empty` renderer, which gates on nullish,
                          printed a stray "0".
                        - So the truthiness leg no longer DECIDES the answer;
                          it reaches the same one a step earlier. It stays
                          anyway, and objectui#8908 said so rather than letting
                          it vanish as tidying: it is what makes this slot's
                          answer independent of the bridge, which is the whole
                          reason this slot survived the bridge being wrong. ⛔ Do
                          not drop it as redundant without re-measuring both
                          paths - the pins below assert the OUTCOME, and they
                          would stay green through the removal right up until
                          the bridge regressed again.
                        - The ternary replaces an `&&` chain that LEAKED: with
                          `emptyAction: 0` the chain evaluated to the number `0`
                          itself, which React renders as a stray "0" inside the
                          empty state. That is the numeric-falsy JSX trap, not a
                          decision; a ternary yields `null` instead.

                        Both legs are pinned in
                        `__tests__/data-table-empty-action-primitive-node.test.tsx`. */}
                    {schema.emptyAction ? (
                      <SchemaRenderer schema={toRenderableSchema(schema.emptyAction)} />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              <>
                {bodyItems.map((item) => {
                  if (item.kind === 'band') {
                    return (
                      <TableRow
                        key={`group-band:${item.group.key}`}
                        data-testid="data-table-group-band"
                        data-group-key={item.group.key}
                        data-group-depth={item.group.depth ?? 0}
                        className="h-9 bg-muted/30 hover:bg-muted/30 border-b border-border/60"
                      >
                        <TableCell colSpan={fullRowColSpan} className="h-9 px-0 py-0">
                          {item.group.band}
                        </TableCell>
                      </TableRow>
                    );
                  }
                  if (item.kind === 'footer') {
                    return (
                      <TableRow
                        key={`group-footer:${item.group.key}`}
                        data-testid="data-table-group-footer"
                        data-group-key={item.group.key}
                        className="hover:bg-transparent border-b border-border/60"
                      >
                        <TableCell colSpan={fullRowColSpan} className="px-0 py-0">
                          {item.group.footer}
                        </TableCell>
                      </TableRow>
                    );
                  }
                  const { row, rowIndex } = item;
                  const globalIndex = (effectivePage - 1) * pageSize + rowIndex;
                  const rowId = getRowId(row, globalIndex);
                  const isSelected = selectedRowIds.has(rowId);
                  // The record's own pending edit and save state, read by its
                  // key, never by where the row sits (objectui#12310).
                  const rowKey = pendingRowKeyOf(row);
                  const rowPending = pendingChanges.get(rowKey);
                  const rowHasChanges = rowPending !== undefined;
                  const rowChanges = rowPending?.changes || {};
                  const rowErrored = erroredRows.has(rowKey);
                  
                  return (
                    <TableRow 
                      key={rowId} 
                      data-state={isSelected ? 'selected' : undefined}
                      className={cn(
                        // Unified row state styling — softer hover (40 vs default 50),
                        // brand-tinted selected fill, and explicit focus-visible ring
                        // for keyboard navigation. Overrides the upstream Shadcn
                        // TableRow defaults (which we cannot edit directly per
                        // No-Touch-Zone policy).
                        "bg-background border-b border-border/60 group/row transition-colors",
                        // The row's tint, as its sticky cells read it
                        // (`STICKY_ROW_TINT`): none unless `rowClassName`
                        // sets one, and suspended under hover and selection.
                        "[--os-row-tint:transparent] hover:[--os-row-tint:transparent] data-[state=selected]:[--os-row-tint:transparent]",
                        "hover:bg-muted/40",
                        "data-[state=selected]:bg-primary/5 data-[state=selected]:hover:bg-primary/10",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
                        schema.onRowClick && "cursor-pointer",
                        rowHasChanges && !rowErrored && "bg-amber-50 dark:bg-amber-950/20",
                        rowErrored && "bg-destructive/10 dark:bg-destructive/15 ring-1 ring-inset ring-destructive/40",
                        rowClassName && rowClassName(row, rowIndex)
                      )}
                      style={rowStyle ? rowStyle(row, rowIndex) : undefined}
                      onClick={(e) => {
                        // objectui#13188 — a drag that selected text in the
                        // row is a copy gesture, not an open.
                        if (schema.onRowClick && !e.defaultPrevented && !hasTextSelectionIn(e.currentTarget)) {
                           // Heuristic to avoid triggering on interactive elements if they didn't stop propagation.
                           // Note: Radix overlays (DropdownMenu, Popover, Dialog, etc.) render their content in a
                           // Portal but React events still bubble up through the virtual tree to this row. So we
                           // must also ignore menu/dialog/listbox/option/tab targets, otherwise a click on a
                           // dropdown "Edit" item would navigate to the record detail.
                           const target = e.target as HTMLElement;
                           if (
                             // objectui#13016 — the leading cell is the selection's hit area
                             // (see its own handler below): a click that
                             // misses the small checkbox there selects the
                             // row, never opens the record.
                             target.closest('[data-slot="row-leading-cell"]') ||
                             target.closest('button') ||
                             target.closest('a') ||
                             target.closest('input, select, textarea, label') ||
                             target.closest('[role="checkbox"]') ||
                             target.closest('[role="menu"]') ||
                             target.closest('[role="menuitem"]') ||
                             target.closest('[role="menuitemcheckbox"]') ||
                             target.closest('[role="menuitemradio"]') ||
                             target.closest('[role="dialog"]') ||
                             target.closest('[role="alertdialog"]') ||
                             target.closest('[role="listbox"]') ||
                             target.closest('[role="option"]') ||
                             target.closest('[role="tab"]') ||
                             target.closest('[data-radix-popper-content-wrapper]')
                           ) {
                             return;
                           }
                           // objectui#9462 — the DOM event goes with the row.
                           // `ObjectGrid` and `ListView` put the navigation
                           // hook's own `handleClick` on this slot, and that
                           // hook reads `metaKey` / `ctrlKey` / `button` off a
                           // second argument to decide "open in a new tab".
                           // Calling with one argument dropped the payload
                           // here, so Cmd/Ctrl/middle-click reached no host
                           // handler and degraded to an ordinary navigation.
                           schema.onRowClick(row, e);
                        }
                      }}
                    >
                      {selectable && (
                        <TableCell
                          data-slot="row-leading-cell"
                          // objectui#13016 — the whole cell toggles the row, not the 16px box
                          // alone: on a tall row the box is a small target
                          // and a near miss used to open the record. The
                          // checkbox itself handles its own clicks.
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('[role="checkbox"]')) return;
                            handleSelectRow(rowId, !isSelected);
                          }}
                          className={cn(cellClassName, "w-10 relative cursor-pointer", showRowNumbers ? "px-0 text-center" : "px-3", frozenColumns > 0 && ["sticky left-0 z-10 bg-background", STICKY_ROW_TINT])}
                        >
                          {/* objectui#12423 — the leading cell (see
                              `leadingCellCount`): the row number by default,
                              the checkbox on hover / focus-within / a coarse
                              pointer, and on every row while any is selected.
                              The checkbox is hidden by OPACITY only, so it
                              stays in the tab order and reachable by assistive
                              tech; focusing it reveals it. */}
                          {showRowNumbers && (
                            <span
                              data-slot="row-number"
                              aria-hidden={selectionActive || undefined}
                              className={cn(
                                "text-xs text-muted-foreground tabular-nums select-none",
                                selectionActive
                                  ? "invisible"
                                  : "group-hover/row:invisible group-focus-within/row:invisible pointer-coarse:invisible",
                              )}
                            >
                              {globalIndex + 1}
                            </span>
                          )}
                          <span
                            data-slot="row-select"
                            className={cn(
                              "flex items-center transition-opacity",
                              showRowNumbers && "absolute inset-0 justify-center",
                              !selectionActive
                                && "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100",
                            )}
                          >
                            {/* A checkbox drawn alone in its cell has no label of its
                                own; the name is the action, as the header's is
                                (objectui#11690). */}
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => handleSelectRow(rowId, checked as boolean)}
                              aria-label={t('table.selectRow')}
                            />
                          </span>
                        </TableCell>
                      )}
                      {showRowNumbers && !selectable && (
                        <TableCell className={cn("text-center w-10 relative", cellClassName, frozenColumns > 0 && ["sticky left-0 z-10 bg-background", STICKY_ROW_TINT])}>
                          <span className={cn("text-xs text-muted-foreground tabular-nums select-none", !selectable && schema.onRowClick && "group-hover/row:invisible")}>
                            {globalIndex + 1}
                          </span>
                          {!selectable && schema.onRowClick && (
                            <button
                              type="button"
                              className="absolute inset-0 hidden group-hover/row:flex items-center justify-center gap-0.5 text-xs font-medium text-primary hover:text-primary/80"
                              data-testid="row-expand-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                // objectui#9462 — same forward as the row's own
                                // handler above. `e` was already bound here for
                                // `stopPropagation`, so the payload was in
                                // scope on this line and still was not handed
                                // on: the hover "open record" affordance
                                // answered a Cmd/Ctrl-click exactly like a
                                // plain one.
                                schema.onRowClick?.(row, e);
                              }}
                              title="Open record"
                            >
                              <span>{t('table.open')}</span>
                              <ChevronRight className="h-3 w-3" />
                            </button>
                          )}
                        </TableCell>
                      )}
                      {columns.map((col, colIndex) => {
                        const isFit = col.fitContent === true
                          && !columnWidths[col.accessorKey] && !col.width;
                        // objectui#6650 (maintainer ruling 2026-09-02, Option B).
                        // `TableColumn.wrap` — the authored `ListColumn.wrap`
                        // that `@objectstack/spec` declares and describes to
                        // authors as "Allow text wrapping" — turns this cell's
                        // one-line clamp OFF: the body renders
                        // `whitespace-normal break-words` in place of
                        // `truncate`. Absent or `false` renders exactly what
                        // shipped before.
                        //
                        // ⭐ PRECEDENCE, and it is a decision this card was
                        // told to make and pin: `fitContent` WINS. The two keys
                        // do not compose. A fit cell is `width:1%` with
                        // `minWidth`/`maxWidth` left undefined (see the style
                        // object below), so the auto table layout sizes that
                        // column from its content alone: `whitespace-nowrap`
                        // makes the content's min-content width equal its
                        // max-content width — one line — and dropping nowrap
                        // drops min-content back to the longest WORD. Honouring
                        // `wrap` on a fit column therefore does not wrap it, it
                        // COLLAPSES it.
                        //
                        // Measured (Chromium 1194, this cell shape reproduced
                        // exactly — 900px container, auto layout, sibling
                        // column at 400px; harness and numbers in the PR body):
                        // the fit cell is 463.9px wide on ONE line with nowrap
                        // and 70.9px wide over TEN lines without it — 6.5x
                        // narrower and 5.9x taller. That is not the affordance
                        // the author asked for by either key.
                        //
                        // ⚠️ Note what the same measurement does NOT show:
                        // the shipped fit producer — `ObjectGrid`'s injected
                        // `_actions` column — measures identically both ways
                        // (179px), because `RowActionMenu` carries its own
                        // `whitespace-nowrap` on a nowrap flex row. So the
                        // collapse is not a risk to that column; it is what a
                        // TEXT column authored with both keys would get, and
                        // that is the case this branch refuses.
                        const isWrap = col.wrap === true && !isFit;
                        const pinnedRightOffset = isPinnedRightColumn(col) ? measuredStickyRights?.[col.accessorKey] : undefined;
                        const columnWidth = isFit
                          ? '1%'
                          : resolvedColumnWidth(col);
                        const originalValue = row[col.accessorKey];
                        const hasPendingChange = rowChanges[col.accessorKey] !== undefined;
                        const cellValue = hasPendingChange ? rowChanges[col.accessorKey] : originalValue;
                        const isEditing = editingCell !== null && editingCell.rowKey === rowKey && editingCell.columnKey === col.accessorKey;
                        // A masked column reads as NOT editable here too
                        // (objectui#10583), so its cell neither shows the
                        // edit cursor nor swallows the row's click —
                        // `startEdit` would refuse it anyway.
                        const isEditable = editable && col.editable !== false && !col.masked;
                        const isFrozen = frozenColumns > 0 && colIndex < frozenColumns;
                        const frozenOffset = isFrozen
                          ? measuredStickyLefts?.[leadingCellCount + colIndex]
                            ?? columns.slice(0, colIndex).reduce((sum, c, i) => {
                              if (i < frozenColumns) {
                                const w = resolvedColumnWidth(c);
                                return sum + (typeof w === 'number' ? w : w ? parseInt(String(w), 10) || 150 : 150);
                              }
                              return sum;
                            }, leadingCellCount * 40)
                          : undefined;
                        
                        return (
                          <TableCell 
                            key={colIndex} 
                            className={cn(
                              col.cellClassName,
                              col.align === 'right' && 'text-right',
                              col.align === 'center' && 'text-center',
                              // `fitContent` cells must not clip their inline
                              // content (row-action buttons); every other column
                              // keeps overflow-hidden for truncation.
                              isFit ? 'whitespace-nowrap' : 'overflow-hidden',
                              isEditable && !isEditing && "cursor-text hover:bg-muted/50",
                              hasPendingChange && "font-semibold text-amber-700 dark:text-amber-400",
                              isFrozen && ['sticky z-10 bg-background', STICKY_ROW_TINT],
                              isFrozen && colIndex === frozenColumns - 1 && 'border-r-2 border-border shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]',
                            )}
                            style={{
                              width: columnWidth,
                              // fit columns hug content: a `1%` width with no
                              // max clamp lets the cell grow to its buttons and
                              // other auto columns absorb the remaining space.
                              minWidth: isFit ? undefined : columnWidth,
                              maxWidth: isFit ? undefined : columnWidth,
                              ...(isFrozen && { left: frozenOffset }),
                              // Stacked right pins (objectui#11682): the
                              // header cell's offset, so each body cell sticks
                              // where its column does.
                              ...(pinnedRightOffset ? { right: pinnedRightOffset } : {}),
                            }}
                            onDoubleClick={(e) => {
                              // Entering edit mode must NOT also fire the row's
                              // onRowClick (record-detail drawer). The row heuristic
                              // can't see the editor yet (the <input> only renders
                              // next frame), so stop propagation here explicitly.
                              // objectui#13188 — selecting text is not an edit.
                              if (isEditable && !singleClickEdit && !hasTextSelectionIn(e.currentTarget)) {
                                e.stopPropagation();
                                startEdit(row, col.accessorKey);
                              }
                            }}
                            onClick={(e) => {
                              if (isEditable && singleClickEdit && !hasTextSelectionIn(e.currentTarget)) {
                                e.stopPropagation();
                                startEdit(row, col.accessorKey);
                              }
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, colIndex, col.accessorKey)}
                            // objectui#11068 — one roving Tab stop across the
                            // data cells when `keyboardNavigation` is on (see
                            // `handleCellKeyDown`); every cell its own stop when
                            // it is off, exactly as before. The address and the
                            // focus tracking exist only in the first case.
                            tabIndex={keyboardNavigation ? (rowIndex === rovingRowIndex && colIndex === rovingColIndex ? 0 : -1) : 0}
                            data-grid-cell={keyboardNavigation ? `${rowIndex}:${colIndex}` : undefined}
                            onFocus={keyboardNavigation ? () => rove(rowIndex, colIndex) : undefined}
                          >
                            {isEditing ? (
                              (() => {
                                // Type-aware inline editor. `col.type` is forwarded
                                // from a producer's column inference, folded onto the
                                // DECLARED vocabulary at that producer's emit seam
                                // (`fc62bb490`). This used to be
                                // `(col as any).type as string | undefined` — a cast that
                                // existed only because the values arriving were not the
                                // values `TableColumn` declares. They are now, so the read
                                // is typed and the switch below can only branch on
                                // spellings the interface actually publishes.
                                const editType: TableColumnType | undefined = col.type;

                                // Host-injected editor: a higher layer (ObjectGrid) renders
                                // the dedicated @object-ui/fields widget for this field's
                                // type — the SAME control the form uses — so we don't
                                // re-implement select/boolean/etc. down here in the
                                // (fields-free) component layer. Returning null means "no
                                // widget for this type" → fall through to the built-ins.
                                //
                                // This used to be `(schema as any).renderCellEditor as
                                // (…) => React.ReactNode` — a cast that existed for one
                                // reason only: `DataTableSchema` did not declare the key
                                // this renderer has always read, so the read had to
                                // re-state the contract locally and the schema had to be
                                // opened up to let it. `bf97b98c8` declared it (the
                                // 2026-08-30 ruling), so the read is typed at its source
                                // and the ctx shape below is checked against the
                                // declaration instead of asserted against nothing.
                                const injectEditor = schema.renderCellEditor;
                                if (typeof injectEditor === 'function') {
                                  const node = injectEditor({
                                    column: col,
                                    row,
                                    // The persisted row with this row's staged,
                                    // unsaved edits merged over it (objectui#7188);
                                    // the SAME object as `row` when nothing is
                                    // staged, so `row === pendingRow` reads as
                                    // "clean" on the host side.
                                    pendingRow: rowHasChanges ? pendingRows.of(row, rowKey) : row,
                                    value: editValue,
                                    stage: stageEdit,
                                    commit: (v?: any) => saveEdit(true, v),
                                    cancel: cancelEdit,
                                  });
                                  if (node != null) {
                                    // Wrap the injected widget so it gains the
                                    // exit-edit-mode affordances the built-in
                                    // editors have: Enter commits, Escape cancels,
                                    // and — via `injectedEditorElRef` + the
                                    // document pointerdown listener above — a
                                    // click-outside commits (objectui#2321).
                                    // Keydowns bubbling up through a React portal
                                    // from the widget's own popover (e.g. a lookup
                                    // search box) carry a target OUTSIDE this
                                    // wrapper, so the `contains` guard ignores them
                                    // — Enter/Escape there drive the popover, not
                                    // the cell. Enter commits only from a single-
                                    // line `<input>` (text/number/date/…); on a
                                    // picker's `<button>` trigger or a multi-line
                                    // textarea it's left alone so Enter opens the
                                    // dropdown / inserts a newline as usual.
                                    //
                                    // Tab is deliberately NOT in that list, and
                                    // tabbing out therefore does not leave edit
                                    // mode — measured, `64d937c53`. It costs
                                    // nothing: the widget has already staged
                                    // every keystroke into `pendingChanges` (or,
                                    // reading its input on blur, staged on the
                                    // Tab's own blur — objectui#12664), so
                                    // the value is safe; the cell simply stays
                                    // open until Enter, Escape, or a pointer
                                    // press outside closes it.
                                    return (
                                      <div
                                        ref={(n) => { injectedEditorElRef.current = n; }}
                                        className="w-full"
                                        onKeyDown={(e) => {
                                          if (!e.currentTarget.contains(e.target as Node)) return;
                                          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
                                            e.preventDefault();
                                            // A commit-on-blur widget stages
                                            // on this blur (objectui#12664).
                                            flushInjectedEditor();
                                            saveEdit(true);
                                          } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            exitEdit(true);
                                          }
                                        }}
                                      >
                                        {node}
                                      </div>
                                    );
                                  }
                                }

                                if (editType === 'date' || editType === 'datetime') {
                                  const isDateTime = editType === 'datetime';
                                  // A stored value written on a day that does not
                                  // exist (objectui#10625): the control can paint it
                                  // only blank, so it gets `""`, is marked invalid,
                                  // and the stored string is NAMED beside it —
                                  // `DateField` / `DateTimeField`'s face. Nothing
                                  // changes until the user picks a new value: an
                                  // Enter with no edit stages the stored string as
                                  // it was, never a rolled day.
                                  const impossible = isImpossibleStoredDay(editValue);
                                  const control = (
                                    <Input
                                      ref={editInputRef}
                                      type={isDateTime ? 'datetime-local' : 'date'}
                                      value={
                                        impossible
                                          ? ''
                                          : isDateTime
                                            ? toDateTimeInputValue(editValue)
                                            : toDateInputValue(editValue)
                                      }
                                      // `date` stores the control's plain yyyy-MM-dd;
                                      // `datetime` stores ISO, read back on the same
                                      // basis the control was written on.
                                      onChange={(e) =>
                                        setEditValue(
                                          isDateTime ? fromDateTimeInputValue(e.target.value) : e.target.value,
                                        )
                                      }
                                      onKeyDown={handleEditKeyDown}
                                      onBlur={handleEditBlur}
                                      aria-invalid={impossible || undefined}
                                      aria-describedby={impossible ? impossibleDayNoticeId : undefined}
                                      className="h-8 px-2 py-1"
                                    />
                                  );
                                  if (!impossible) return control;
                                  return (
                                    <div className="space-y-1">
                                      {control}
                                      <p
                                        id={impossibleDayNoticeId}
                                        className="text-xs text-destructive"
                                        data-testid={isDateTime ? 'datetime-impossible-day' : 'date-impossible-day'}
                                      >
                                        {isDateTime
                                          ? t('fields.dateTime.impossibleDay', { value: String(editValue) })
                                          : t('fields.date.impossibleDay', { value: String(editValue) })}
                                      </p>
                                    </div>
                                  );
                                }

                                if (editType && NUMERIC_EDIT_TYPES.has(editType)) {
                                  return (
                                    <Input
                                      ref={editInputRef}
                                      type="number"
                                      value={editValue ?? ''}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onKeyDown={handleEditKeyDown}
                                      onBlur={handleEditBlur}
                                      className="h-8 px-2 py-1"
                                    />
                                  );
                                }

                                // Select / boolean / multi-select / etc. are NOT hand-rolled
                                // here — the host (ObjectGrid) provides them via
                                // `renderCellEditor` using the dedicated @object-ui/fields
                                // widgets, so they exactly match the form's controls.

                                // Object/array values (e.g. an expanded reference like
                                // `{ id, name }`) have no safe free-text editor: a plain
                                // <input> renders them as "[object Object]", and blur
                                // auto-saves (saveEdit) would clobber the object with that
                                // string. Show the coerced label read-only and cancel (not
                                // save) on blur so the value is never corrupted — such
                                // fields are edited from the record form / a dedicated picker.
                                if (editValue != null && typeof editValue === 'object') {
                                  return (
                                    <Input
                                      ref={editInputRef}
                                      value={safeObjectLabel(editValue)}
                                      readOnly
                                      onKeyDown={handleEditKeyDown}
                                      onBlur={cancelEdit}
                                      className="h-8 px-2 py-1 text-muted-foreground cursor-default"
                                      title={safeObjectLabel(editValue)}
                                    />
                                  );
                                }

                                // Fallback: plain text input (when no host editor matched and
                                // the type isn't date/datetime/number).
                                return (
                                  <Input
                                    ref={editInputRef}
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={handleEditKeyDown}
                                    onBlur={handleEditBlur}
                                    className="h-8 px-2 py-1"
                                  />
                                );
                              })()
                            ) : (
                              <div
                                className={
                                  isFit
                                    ? 'w-full whitespace-nowrap'
                                    : isWrap
                                      ? 'w-full whitespace-normal break-words'
                                      : 'truncate w-full'
                                }
                                // No tooltip on a MASKED column (objectui#10583):
                                // the title carried the raw value, so a hover
                                // showed what the cell's mask hides. None on a
                                // FOREIGN-KEY column either (objectui#13377): its
                                // raw value is the referenced record's id, which
                                // the drawn name (or "Restricted record") withholds.
                                title={!isFit && !col.masked && !col.foreignKey && cellValue != null && typeof cellValue !== 'object' ? String(cellValue) : undefined}
                                // The cell half of the drawn-size read the
                                // auto width is estimated from (objectui#11682).
                                data-auto-width-key={autoWidthKey(col)}
                              >
                                {typeof col.cell === 'function'
                                  ? col.cell(cellValue, row)
                                  : (cellValue != null && typeof cellValue === 'object' ? String(cellValue) : formatCellValue(cellValue) as any)}
                              </div>
                            )}
                          </TableCell>
                        );
                      })}
                      {rowActions && (
                        <TableCell className={cn("text-right", cellClassName)}>
                          <div className="flex items-center justify-end gap-1">
                            {rowHasChanges && (schema.onRowSave || schema.onBatchSave) ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => cancelRowChanges(rowKey)}
                                  disabled={isSaving}
                                  title="Cancel changes"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => saveRow(rowKey)}
                                  disabled={isSaving}
                                  title="Save row"
                                >
                                  <Save className="h-4 w-4 text-green-600" />
                                </Button>
                              </>
                            ) : (
                              /* Trigger + menu, or nothing when this row's
                                 predicates leave no item to show (#3562). */
                              <DataTableRowActionsMenu schema={schema} row={row} t={t} />
                            )}
                          </div>
                        </TableCell>
                      )}
                      {addColumnEnabled && <TableCell aria-hidden className="w-10" />}
                    </TableRow>
                  );
                })}
                {/* Add record row (Airtable-style) */}
                {showAddRow && (
                  <TableRow
                    className="hover:bg-muted/30 cursor-pointer border-b border-border"
                    data-testid="add-record-row"
                    onClick={() => schema.onAddRecord?.()}
                  >
                    <TableCell
                      colSpan={fullRowColSpan}
                      className="h-9 px-3 py-1.5"
                    >
                      <span className="flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground transition-colors">
                        <Plus className="h-3.5 w-3.5" />
                        {t('table.addRecord')}
                      </span>
                    </TableCell>
                  </TableRow>
                )}
                {/* Filler rows intentionally removed: they create visible
                 * bordered empty bands on incomplete pages, making the table
                 * look broken. The scroll container's flex-1 min-h-0 handles
                 * height stability instead. */}
              </>
            )}
          </TableBody>
        </Table>
      </div>
      {rightShadow && (
        <div
          aria-hidden="true"
          data-testid="data-table-scroll-shadow-right"
          className="pointer-events-none absolute top-0 z-30 w-6 bg-gradient-to-l from-foreground/10 to-transparent"
          // Measured offsets, like the frozen cells' `left` in this file: the
          // seam before the right-pinned columns and the box's scrollbars.
          style={{ right: rightShadow.right, bottom: rightShadow.bottom }}
        />
      )}
      </div>

      {/* Pagination — hidden when only one page (no controls would be actionable) */}
      {pagination && !groupLayout && sortedData.length > 0 && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-3 sm:px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm text-muted-foreground">{t('table.rowsPerPage')}:</span>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => changePageSize(Number(value))}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeChoices.map((n) => (
                  <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm text-muted-foreground">
              {t('table.pageInfo', { current: effectivePage, total: totalPages })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => goToPage(1)}
                disabled={effectivePage === 1}
                aria-label={t('table.firstPage')}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => goToPage(effectivePage - 1)}
                disabled={effectivePage === 1}
                aria-label={t('table.previousPage')}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => goToPage(effectivePage + 1)}
                disabled={effectivePage === totalPages}
                aria-label={t('table.nextPage')}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => goToPage(totalPages)}
                disabled={effectivePage === totalPages}
                aria-label={t('table.lastPage')}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Column header context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          data-testid="column-context-menu"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Sort entries exactly where the header sorts: the header's one
              predicate, `isColumnSortable`, over the same column. So a column
              declared `sortable: false` offers none (objectui#10727), and
              neither does a MASKED one (objectui#10657). */}
          {contextMenuColumn && isColumnSortable(contextMenuColumn) && (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                onClick={() => {
                  applySort(contextMenu.columnKey, 'asc');
                  setContextMenu(null);
                }}
              >
                <ChevronUp className="h-3.5 w-3.5" />
                {t('table.sortAsc')}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                onClick={() => {
                  applySort(contextMenu.columnKey, 'desc');
                  setContextMenu(null);
                }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
                {t('table.sortDesc')}
              </button>
              <div className="my-1 h-px bg-border" />
            </>
          )}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
            onClick={() => hideColumn(contextMenu.columnKey)}
          >
            <X className="h-3.5 w-3.5" />
            {t('table.hideColumn')}
          </button>
        </div>
      )}
    </div>
  );
};

// Register the component
ComponentRegistry.register('data-table', DataTableRenderer, {
  namespace: 'ui',
  label: 'Data Table',
  icon: 'table',
  inputs: [
    { name: 'caption', type: 'string' },
    {
      name: 'columns',
      type: 'array',
      description: 'Array of { header, accessorKey, className, width, sortable, filterable, resizable }',
      required: true,
    },
    {
      name: 'data',
      type: 'array',
      description: 'Array of data objects',
      required: true,
    },
    { name: 'pagination', type: 'boolean' },
    { name: 'pageSize', type: 'number' },
    { name: 'searchable', type: 'boolean' },
    { name: 'selectable', type: 'boolean' },
    { name: 'sortable', type: 'boolean' },
    { name: 'exportable', type: 'boolean' },
    { name: 'rowActions', type: 'boolean' },
    { name: 'resizableColumns', type: 'boolean' },
    { name: 'reorderableColumns', type: 'boolean' },
    { name: 'className', type: 'string' },
  ],
  defaultProps: {
    caption: 'Enterprise Data Table',
    pagination: true,
    pageSize: 10,
    searchable: true,
    selectable: true,
    sortable: true,
    exportable: true,
    rowActions: true,
    resizableColumns: true,
    reorderableColumns: true,
    columns: [
      { header: 'ID', accessorKey: 'id', width: '80px' },
      { header: 'Name', accessorKey: 'name' },
      { header: 'Email', accessorKey: 'email' },
      { header: 'Status', accessorKey: 'status' },
      { header: 'Role', accessorKey: 'role' },
    ],
    data: [
      { id: 1, name: 'John Doe', email: 'john@example.com', status: 'Active', role: 'Admin' },
      { id: 2, name: 'Jane Smith', email: 'jane@example.com', status: 'Active', role: 'User' },
      { id: 3, name: 'Bob Johnson', email: 'bob@example.com', status: 'Inactive', role: 'User' },
      { id: 4, name: 'Alice Williams', email: 'alice@example.com', status: 'Active', role: 'Manager' },
      { id: 5, name: 'Charlie Brown', email: 'charlie@example.com', status: 'Active', role: 'User' },
      { id: 6, name: 'Diana Prince', email: 'diana@example.com', status: 'Active', role: 'Admin' },
      { id: 7, name: 'Ethan Hunt', email: 'ethan@example.com', status: 'Inactive', role: 'User' },
      { id: 8, name: 'Fiona Gallagher', email: 'fiona@example.com', status: 'Active', role: 'User' },
      { id: 9, name: 'George Wilson', email: 'george@example.com', status: 'Active', role: 'Manager' },
      { id: 10, name: 'Hannah Montana', email: 'hannah@example.com', status: 'Active', role: 'User' },
      { id: 11, name: 'Ivan Drago', email: 'ivan@example.com', status: 'Inactive', role: 'User' },
      { id: 12, name: 'Julia Roberts', email: 'julia@example.com', status: 'Active', role: 'Admin' },
    ],
  },
});
