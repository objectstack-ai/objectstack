/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectGrid Component
 * 
 * A specialized grid component built on top of data-table.
 * Auto-generates columns from ObjectQL schema with type-aware rendering.
 * Implements the grid view type from @objectstack/spec view.zod ListView schema.
 * 
 * Features:
 * - Traditional table/grid with CRUD operations
 * - Search, filters, pagination
 * - Column resizing, sorting
 * - Row selection
 * - Inline editing support
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import type { ObjectGridSchema, DataSource, ViewData, TableSortItem, DataTableSchema, ListViewExportFormat, RecordNavigateAction } from '@object-ui/types';
import { isSystemManagedField } from '@object-ui/types';
import { resolveFieldScale } from '@objectstack/spec/data';
import { SchemaRenderer, useDataScope, useNavigationOverlay, useAction, useSafeFieldLabel, usePredicateScope, useCapabilityGate, notifyDataChanged, useMetadata } from '@object-ui/react';
// objectui#8920 — the grid reaches a cell renderer through THIS module and
// nowhere else. `getCellRenderer` / `resolveCellRendererType` are deliberately
// NOT imported here: six sites spelling the resolve three different ways is
// what dropped a `format`-hinted column's renderer, and one shared owner is
// what stops a seventh site picking a convention of its own.
import { resolveGridCellRendering } from './cellRendererResolution';
import { isMaskedGridColumn } from './maskedColumn';
import { formatCurrency, formatCompactCurrency, formatDate, formatPercent, percentCellScale, humanizeLabel, getBadgeColorClasses, getBadgeHexAppearance, FieldEditWidget, hasFieldEditWidget, DISCRETE_EDIT_TYPES, coerceToSafeValue, MaskedCellRenderer, withKnownObjects, RICH_TEXT_FIELD_TYPES } from '@object-ui/fields';
import { useLocalization, useDisplayLocale, resolveFieldCurrency } from '@object-ui/i18n';
// Two resolvers, two vocabularies — the repo spells the distinction into the
// NAMES (objectui#4167). `resolveInlineI18nLabel` is the spec's own
// `resolveI18nLabel`: it resolves the INLINE per-locale map
// (`{ en: …, 'fr-FR': … }`) that `I18nLabel` carries. It does NOT accept
// objectui's keyed `{ key, defaultValue, params }` ref — that vocabulary lives
// on the FLAT `schema.ariaLabel` and is resolved by `SchemaRenderer` instead.
// Needed here since objectui#9092 restored `ObjectGridSchema.label` to the
// `string | I18nLabel` form `BaseSchema` has carried since objectui#4580: the
// two reads below put the label in STRING positions, so a map-valued label used
// to reach them as an object and the compiler could not say so.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
import { stateMachineNextValues } from './inline-edit-options';
import {
  Badge, Button, NavigationOverlay, EmptyValue,
  legacyRecordDrawerWidthKey, recordOverlayWidthStorageKey,
  Popover, PopoverContent, PopoverTrigger,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  RefreshIndicator,
  DataEmptyState, EmptyStateLink, resolveIcon,
  HorizontalOverflowBox,
  toast,
} from '@object-ui/components';
import { resolveConditionalFormatting, declaredNameField, buildExportFileName, resolveAffordance, type SchemaLike, isExpandableFieldType, isUnmaterializedFieldType, readObjectSortability, isPlatformSortableField, filterPlatformSortableSort, filterRefusalSubject, FilterOperatorError, resolveRecordSourceConfig, resolveRecordSourceObjectName, partitionRowsByPredicate } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import {
  RECORD_OVERLAY_DEFAULT_WIDTH,
  RecordDetailPanel,
  ConcurrentUpdateDialog,
  isConcurrentUpdateError,
  useDetailTranslation,
  type ConcurrentUpdateConflict,
} from '@object-ui/plugin-detail';
import { ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Download, Rows2, Rows3, Rows4, AlignJustify, Loader2 } from 'lucide-react';
import { useRowColor } from './useRowColor';
import { GroupRow } from './GroupRow';
import { resolveRowCrudAffordances } from './rowCrudAffordances';
import { useRecordCrudVerdicts } from './hooks/useRecordCrudVerdicts';
import { resolveLegacyRowActions } from './resolveLegacyRowActions';
import { resolveBulkActions, resolvePromotedBulkParams } from './resolveBulkActions';
import { partitionBulkRows } from './bulkEligibility';
import { formatActionLabel } from './components/RowActionMenu';
import { BulkActionBar } from './components/BulkActionBar';
import { BulkActionDialog } from './components/BulkActionDialog';
import type { BulkResult } from './hooks/useBulkExecutor';
import type { BulkActionDef } from '@object-ui/types';
import { type ObjectGridColumnDraft } from './objectGridColumns';
import { rowRecordId } from './objectGridLinkCell';
import { useGridTranslation } from './objectGridTranslations';
import { DEFAULT_DISPLAY_PAGE_SIZE, DEFAULT_SELECTION_TYPE, type RowHeightMode, resolvePageSize, resolveRowHeightMode } from './objectGridDefaults';
import { type BatchSaveOutcome, type RowConflictChoice, type WrittenRowVersion, rowVersionOf, rowVersionToSend } from './objectGridRowVersion';
import { type ObjectGridExternalPaginationProps, type ObjectGridFooterSummary } from './objectGridProps';
import { FooterSummaryReport } from './objectGridFooterSummaryReport';
import { useObjectGridDiagnostics } from './objectGridDiagnostics';
import { useObjectGridQueryInputs } from './objectGridQueryInputs';
import { useObjectGridGroupingDecisions } from './objectGridGroupingDecisions';
import { useObjectGridRowLoad } from './objectGridRowLoad';
import { temporalGroupHeading, useObjectGridGrouping } from './objectGridGrouping';
import { useObjectGridSummaries } from './objectGridSummaries';
import { useObjectGridRowHeightSync } from './objectGridRowHeight';
import { useObjectGridColumnState } from './objectGridColumnState';
import { useObjectGridMobile } from './objectGridMobile';
import { useObjectGridGenerateColumns } from './objectGridGenerateColumns';
import { resolveObjectGridPersistedColumns } from './objectGridPersistedColumns';
import { resolveObjectGridActionsColumn } from './objectGridActionsColumn';
export type { RetiredListColumnKey, ObjectGridColumnHolds, ObjectGridColumnDraft, ObjectGridColumn } from './objectGridColumns';
export type { ObjectGridColumnState, ObjectGridFooterSummary, ObjectGridExternalPaginationProps } from './objectGridProps';

/**
 * A view's declared `sort` → the shape the table's header indicators read.
 *
 * `[{ field, order }, …]` is the ONE spelling `@objectstack/spec` still
 * declares for `ObjectGridPropsSchema.sort` (objectui#8221 retired the string
 * clauses), and since objectui#8961 it is the only spelling this reader
 * admits. The headers agree with the fetch path on it: a view that arrives
 * sorted by `created_at desc` shows that arrow before anyone clicks anything —
 * otherwise the first click on that column produces `asc` while the list was
 * already `desc`, and the arrow tells the truth only from the second click on.
 *
 * ⭐ A retired string spelling (`"name desc"`, `["name desc", …]`) yields
 * NOTHING here, so it lights no arrow. That is the agreement, not an omission:
 * the fetch path REFUSES the same spelling and sends no `$orderby`
 * (objectui#8767). Between #8767 and objectui#8961 this reader was WIDER than
 * that path — it parsed the string and drew a confident arrow for an ordering
 * the query did not carry, a UI element stating something untrue about the rows
 * beside it, with nothing but a console line to say so.
 *
 * ⛔ Do not re-widen it for a stored `sys_metadata` row still carrying the old
 * spelling. The author is already told, once per spelling, by PR #8758's own
 * diagnostic at the fetch path — it quotes the offending value and prescribes
 * the array form. A second reading here would restore exactly the arrow the
 * wire cannot honour.
 *
 * The wire shape is NOT what moved: this block still sends its own
 * `"field order"` join string (see {@link toOrderByClause}), the shared sink's
 * `{field: direction}` map stays declined, and the server-side export path
 * reads `schema.sort` itself rather than through this function, so it was
 * already array-only and is untouched.
 *
 * Exported for the test that pins it against the fetch path's own reading.
 */
export function parseSchemaSort(sort: unknown): TableSortItem[] {
  const entries = Array.isArray(sort) ? sort : [];
  const items: TableSortItem[] = [];
  for (const entry of entries) {
    if (entry && typeof entry === 'object' && typeof (entry as any).field === 'string') {
      const { field, order } = entry as { field: string; order?: string };
      items.push({ field, order: String(order).toLowerCase() === 'desc' ? 'desc' : 'asc' });
    }
  }
  return items;
}

/**
 * Props of the `ObjectGrid` React component.
 *
 * Renamed off the bare `ObjectGridProps` (objectui#4650): from 17.0.0
 * `@objectstack/spec/ui` owns that name, where it is the AUTHORED props
 * document of the `object-grid` element — `z.input<typeof
 * ObjectGridPropsSchema>`, i.e. serialisable authoring keys only (`label`,
 * `fields`, `filter`, `pagination`, …). This is the RENDERER's props: a
 * live `dataSource`, the host pagination handles below, and eleven callbacks,
 * none of which can exist in authored metadata. Two layers under one word,
 * resolved the way this repo already resolved it for `PageHeaderProps` ->
 * `PageHeaderComponentProps` (app-shell) and the `Record*ComponentProps` family
 * in `@object-ui/types`.
 *
 * The barrel keeps `ObjectGridProps` as a deprecated alias of this type, so no
 * importer breaks. Tripwire: `__tests__/spec-symbol-4650.test.ts`.
 */
/**
 * The subset of the grid-level `operations` block that a row may answer for
 * ITSELF — the vocabulary {@link ObjectGridComponentProps.rowOperations} speaks.
 *
 * `update` / `delete` are the two the row kebab renders, and they are spelled
 * exactly as the authored `operations` block spells them, so one word means one
 * thing whether it is declared for the whole grid or resolved for one row. The
 * block's other members (`create`, `export`) are deliberately absent: neither
 * is a row affordance, so a per-row answer for them would have nowhere to land.
 */
export interface ObjectGridRowOperations {
  update?: boolean;
  delete?: boolean;
}

export interface ObjectGridComponentProps extends ObjectGridExternalPaginationProps {
  schema: ObjectGridSchema;
  dataSource?: DataSource;
  className?: string;
  /**
   * [objectui#10657] The object's field catalogue (`fields` of the definition
   * `getObjectSchema(objectName)` returns), handed down by a HOST that has
   * already read it. `ListView` passes the definition it fetched before its
   * rows; the grid answers every field-type question from it until its own
   * read of the definition lands, and from its own read after that.
   *
   * ## Why a host hands it down
   *
   * A host that fetches the rows hands them down as `data`, so they paint
   * before the grid's own schema read settles. Until then an untyped view
   * column over a `password` / `secret` field has no type, and the grid can
   * only withhold it (drawn as the mask, never as text). With the catalogue in
   * hand there is no such window: the column draws, and is flagged, from its
   * declared type at first paint.
   *
   * ## A RUNTIME prop, never authored metadata
   *
   * The name is the host channel decision batch #70 ruled for the object's
   * field catalogue (objectui#7742): `SchemaRenderer` strips an AUTHORED
   * `objectFields` on every spelling (objectui#8818), so only a host's React
   * prop can reach this slot, and no view author can supply a catalogue that
   * types a credential field as text.
   */
  objectFields?: Readonly<Record<string, unknown>>;
  /**
   * [objectui#12423] Row numbers on the leading cell, as a HOST says: `ListView`
   * passes its Display control's Row numbers switch here (session-only, never
   * stored). Absent ⇒ on, the grid's default since it drew them. A RUNTIME
   * prop: the protocol declares no row-number key on a view, and none is read
   * off the node.
   */
  showRowNumbers?: boolean;
  /**
   * [objectui#12528] A HOST that draws its own footer row takes the column
   * summaries into it. When this is passed the grid draws no summary row of
   * its own and reports, in column order, what that row would have drawn —
   * `null` when it would draw none (no summary, a grouped grid, unmounted).
   * `ListView` passes it so the summaries sit at the right of its record-count
   * row: one footer row instead of two. Reported on a change of CONTENT, never
   * of identity. A RUNTIME prop, never authored metadata.
   */
  onColumnSummaryChange?: (summaries: readonly ObjectGridFooterSummary[] | null) => void;
  /**
   * [objectui#8674] Narrow ONE row's generic Edit / Delete entries — the layer
   * that lets a host withhold an operation the record itself cannot accept.
   *
   * ## Why this exists
   *
   * `operations` and the `onEdit` / `onDelete` wiring are GRID-level: they say
   * whether the affordance exists at all, identically for every row. A host
   * whose refusal is per RECORD had nowhere to put it, so it put the refusal in
   * the callback instead — `FieldDesigner`'s delete handler returned early on a
   * system field, after the grid had already drawn the button. The two states
   * it was distinguishing (`readOnly`, which withholds the callback, and
   * `isSystem`, which swallowed the click) differed in the code and did not
   * differ on screen: the author clicked a button drawn as available and got no
   * dialog, no toast, no console message. The operation an affordance cannot
   * perform is not offered.
   *
   * ## The contract
   *
   * Called with a row record; returns the overrides for THAT row. It is an
   * INTERSECTION, like every layer around it (the ADR-0103 bucket, the object's
   * `userActions`, the server's effective API operations, the principal's own
   * grant and the record-level explain verdict): `false` WITHHOLDS, and nothing
   * it returns can re-open what those closed. `true`, an omitted member, a
   * `null` / `undefined` return, and an absent prop all leave the verdict
   * exactly as the grid resolved it — so a caller that passes nothing renders
   * what it rendered before this prop existed.
   *
   * Scope is the row's kebab. Bulk delete rides `onBulkDelete` and the object
   * verdict behind the selection bar, which no per-row answer can speak for:
   * one selected row's `false` must not silently drop the other rows' action.
   */
  rowOperations?: (record: any) => ObjectGridRowOperations | null | undefined;
  /**
   * [objectui#13330] A host-drawn node beside ONE row's title: the cell of the
   * object's declared name field when a column shows it, else the first shown
   * column (the row actions are never it), and the title of the row's card in
   * the card view. Called with the row record; `null` / `undefined` draws
   * nothing, and so does an absent prop, so a caller that passes nothing
   * renders exactly what it rendered before this prop existed.
   *
   * The console's Users list on a managed environment passes a marker for a
   * user who holds nothing beyond the baseline. What the node says is the
   * host's; the grid only places it, after the cell's own content and never in
   * place of it, so the value, its link and its mask all stay as drawn.
   *
   * A RUNTIME prop, never authored metadata: it is a React node a host
   * composes, nothing an author writes, and no node key reaches it.
   */
  rowAdornment?: (record: any) => React.ReactNode;
  /**
   * [objectstack#26681] A host-drawn node beside ONE row's record LINK — the
   * link cell the row's record opens from (the primary field, or a column
   * authored `link: true`) — after the link and never inside it, in the grid
   * and in the card view's title alike. Called with the row record; `null` /
   * `undefined` draws nothing, and so does an absent prop, so a caller that
   * passes nothing renders exactly what it rendered before this prop existed.
   *
   * Not {@link rowAdornment}: that one sits beside the row's TITLE, the
   * declared name field's column when shown, which need not be the column
   * that opens the record. The console's object list passes an "open as full
   * page" arrow for a row that opens the drawer, so it belongs at the link.
   *
   * A RUNTIME prop, never authored metadata: it is a React node a host
   * composes, nothing an author writes, and no node key reaches it.
   */
  recordLinkAdornment?: (record: any) => React.ReactNode;
  /**
   * TWO parameters since objectui#9357, and the second is not decoration: this
   * prop reaches `useNavigationOverlay` as its `onRowClick`, and `handleClick`
   * invokes it as `onRowClick(record, event)` — the modifier payload a host
   * needs to implement Cmd/Ctrl/middle-click for itself. Declaring one
   * parameter hid the second on the ONE line a host reads. Spelled `any` and
   * not `HandleClickModifiers` for the reason objectui#9341 measured on
   * `ObjectKanbanSchema.onCardClick`: that interface lives in
   * `@object-ui/react`, the published twins in `@object-ui/types` may not name
   * it, and a host that discovered the payload from the implementation
   * annotated it `React.MouseEvent` — which a narrower declaration refuses
   * contravariantly. `BaseSchema`'s own `onClick` / `onChange` / `onSubmit`
   * already use this spelling for exactly this situation.
   */
  onRowClick?: (record: any, event?: any) => void;
  /**
   * Called for page-level navigation with the record id and a
   * {@link RecordNavigateAction} — a navigation-MODE token from a closed
   * vocabulary: `'view'` opens the record page, `'new_window'` opens it in a
   * new browser tab.
   *
   * [objectui#9547] The tenth callback on this interface, and the channel a
   * programmatic caller should use: its nine siblings below are props here
   * too, and `ObjectGridSchema.onNavigate`'s own docblock sends callers to
   * this interface for it. That schema key still works — it is the
   * same slot reached off the node — and when BOTH are supplied, THIS PROP
   * WINS (maintainer ruling C on objectui#9547: the programmatic caller is the
   * nearer party). `onRowClick` above still takes full priority over either:
   * a host that owns the row click owns navigation too.
   */
  onNavigate?: (recordId: string | number, action: RecordNavigateAction) => void;
  onEdit?: (record: any) => void;
  onDelete?: (record: any) => void;
  onBulkDelete?: (records: any[]) => void;
  onCellChange?: (rowIndex: number, columnKey: string, newValue: any, row: any) => void;
  onRowSave?: (rowIndex: number, changes: Record<string, any>, row: any) => void | Promise<void>;
  onBatchSave?: (changes: Array<{ rowIndex: number; changes: Record<string, any>; row: any }>) => void | Promise<void>;
  onRowSelect?: (selectedRows: any[]) => void;
  onAddRecord?: () => void;
}

/**
 * Helper to get data configuration from schema.
 *
 * The ruled three-rung ladder itself (`data`, then `staticData`, then
 * `objectName`) is `resolveRecordSourceConfig` in `@object-ui/core` — ONE
 * implementation of a contract published on both faces (`77cb489b4`), which
 * this file used to hand-copy (`ce2aaefe1`).
 *
 * What used to stay here was the head above it: the bare-array `data`
 * shorthand, which lifted `data: [...]` to `{ provider: 'value', items }`.
 * ⛔ IT IS GONE (objectui#8348, decision batch #83, maintainer verbatim
 * 「8348 以协议为准」 — the contract decides).
 *
 * MEASURED on `@objectstack/spec` 17.4.0:
 * `ComponentPropsMap['object-grid'].data` is the `ViewData` union, and its own
 * description names the refusal — *"Static inline rows live at
 * `{ provider: 'value', items: [...] }`; the bare-array shortcut is refused —
 * see migration `object-grid-data-view-data-converged`"*. This block's own
 * registration publishes the same arm (`{ name: 'data', type: 'object' }` in
 * `index.tsx`), and `gridDataInputContract.test.ts` has pinned that declaration
 * since objectui#5090. The head was the last carrier of a spelling every one of
 * those faces refuses, so `data` is honoured here on the OBJECT arm only and
 * the shared rung is passed `'view-data'`.
 *
 * ⛔ WHAT THIS REACHES, measured per CARRIER — do NOT read it as "the array is
 * gone". An authored `data` array reaches this component TWICE: as
 * `schema.data`, which this function used to lift, and as the `data` PROP,
 * because `SchemaRenderer` spreads every non-metadata node key and
 * `index.tsx` forwards `{...rest}`. That prop is `passedData` below, and it
 * lifts an array to `{ provider: 'value', items }` at HIGHER priority than this
 * ladder — it is the channel a host such as `ListView` uses to hand down rows it
 * already fetched, and it is indistinguishable here from an authored key.
 *
 * ⇒ at the ladder the array is no longer a record source; through
 * `SchemaRenderer` an authored `data: [ …rows… ]` still draws, from the props
 * channel. Both halves are pinned in
 * `__tests__/gridBareArrayDataRefused-8348.test.tsx`, which had to correct its
 * own first draft on exactly this point. Collapsing the two carriers would take
 * the host path with it and is outside objectui#8348's scope — reported on the
 * card, not changed in passing.
 *
 * The declared spelling for inline rows is
 * `data: { provider: 'value', items: [...] }`, and the deprecated `staticData`
 * array still works as before.
 */
function getDataConfig(schema: ObjectGridSchema): ViewData | null {
  return resolveRecordSourceConfig(schema, 'view-data');
}

/**
 * The relational copy set and `applyRelationalMeta` moved to
 * `./relationalMetaKeys` for objectui#6875. The list there is DERIVED from a
 * table classifying every key swept off the three `@object-ui/fields` consumers,
 * and a gate re-derives that read set from their sources — so the copy set can
 * no longer drift into being a strict subset of what those consumers read,
 * which is what it had silently become. Read that file's docblock before
 * adding, removing or re-spelling a key.
 *
 * ⚠️ What this bag actually feeds is ONE of those three: the read-only cell.
 * `fieldMeta` is handed to `<CellRenderer field={…}>` and nowhere else in this
 * file. The inline picker is the OTHER seam — `renderCellEditor` below looks
 * the field up in `objectSchema` and spreads the whole def into the widget, so
 * a picker key reaches `LookupField` whether or not it is on the copy set.
 * Measured in `__tests__/lookupPickerKeys-7154.test.tsx` (objectui#7154).
 */

/**
 * ⭐ THE SCHEMA SLOT THIS GRID FILLS (objectui#6459) — the receiver half of the
 * seam whose producer half #6004 typed. `dataTableSchema` below was
 * `const dataTableSchema: any`, so the ~46 keys assembled there were checked
 * against nothing, while the `DataTableSchema` this file imports went unused as
 * that object's annotation.
 *
 * ## Why the fix is not `: DataTableSchema` — measured before choosing this shape
 *
 * objectui#6459's sizing note predicted a bare annotation would be inert
 * because `buildGroupedTableSchema` re-emits the value through a spread and
 * excess-property checking is a freshness check. Measured here (on
 * `38a123cac`), the truth is stronger and the spread is not even needed:
 *
 *   1. `const dataTableSchema: DataTableSchema = {`, everything else unchanged,
 *      PLUS an undeclared `bogusKeyForProbe6459: true` WRITTEN OUT LONGHAND in
 *      the (fresh) literal  →  `tsc --noEmit` exit 0, ZERO diagnostics.
 *
 * The reason was `BaseSchema`'s `[key: string]: any` index signature, which
 * `DataTableSchema` inherited until objectui#8347: under an index signature
 * EVERY key is a member,
 * so excess-property checking never has a non-member to refuse — at a fresh
 * literal, through a spread, anywhere. It is the terminal case of the rule the
 * `options` tombstone above records ("a pin enforced by a key's non-membership
 * silently stops enforcing the moment the key becomes a member"): with an
 * index signature there is no non-membership to enforce with, ever.
 *
 * `RemoveIndexSignature` stripped it (since objectui#8347 it strips nothing on
 * `DataTableSchema`) — DERIVED from `DataTableSchema`, never a
 * hand-copied member list, so a member added there tomorrow flows in on its
 * own and two enumerations of one vocabulary never exist. With the signature
 * gone, the same probe goes red (TS2353 naming the key), measured at both
 * annotated literals — the flat one and `buildGroupedTableSchema`'s return.
 *
 * ## What the instrument is, and is not (pinned in dataTableSchemaSlot-6459.test.ts)
 *
 * Both writers of this type are object literals sitting DIRECTLY in annotated
 * positions (a `const` initializer; an annotated arrow's parenthesized return),
 * so unlike `generateColumns()` — where `.map()` laundered freshness away and
 * only `?: never` tombstones could bite — excess-property checking is live
 * here for longhand keys, and the group literal's spread source is itself the
 * checked `const`, so every key entering that spread was already refused or
 * admitted at ITS literal. What this shape does NOT do is refuse an undeclared
 * key riding a NON-FRESH value assigned into the slot (assignability admits
 * extra keys; that is structural typing, not a bug here) — per-key `?: never`
 * tombstones remain the instrument for a key RETIRED by ruling, but an open
 * census cannot be tombstoned, because a tombstone needs the key's name.
 *
 * ## The census this annotation surfaced — CLOSED, re-derived by objectui#7196
 *
 * Diffing the 46 keys the flat literal writes (plus the 8 the group literal
 * re-writes) against `DataTableSchema` + `BaseSchema` declared members left
 * exactly TWO undeclared keys when this was written. Re-derived on 2026-09-01
 * against the same two literals (still 46 and 8), it now leaves **ZERO**. Both
 * halves closed:
 *
 *   - the card's speculative list (`pagination`, `manualPagination`, `rowCount`,
 *     `frozenColumns`, `singleClickEdit`, `selectionResetKey`,
 *     `disableInnerScroll`, `borderless`) was already declared then, and is
 *     still declared now;
 *   - the two keys that survived that diff, `renderCellEditor` and
 *     `cellClassName`, were DECLARED by `bf97b98c8` (maintainer ruling
 *     2026-08-30) on three surfaces:
 *       · `packages/types/src/data-display.ts` — the members themselves
 *       · `packages/types/src/zod/data-display.zod.ts` — the Zod mirror
 *       · `packages/types/src/__tests__/data-table-declared-keys-6882.test.ts`
 *         — an `Equal` (not `extends`) exact-shape pin
 *
 * ⇒ The ruling this census was filed for HAPPENED, and it went the declare way.
 * `ObjectGridDataTableSchemaHolds` below is therefore redundant rather than
 * load-bearing — the position `headerIcon` reached at objectui#6615 — and
 * removing it is the same separate, MEASURED step objectui#6424 took there. Its
 * docblock carries what #7196 measured toward that.
 *
 * ### What the two entries used to say, and what is true instead
 *
 *   - `renderCellEditor` — said HELD, read "via its own `(schema as any)`
 *     cast", and called the `packages/types` ruling still open. All three are
 *     over: the key is declared, the cast went with the declaration
 *     (`data-table.tsx` reads `schema.renderCellEditor` directly; the line where
 *     the cast stood still spells it, as a quotation inside its own
 *     correction), and the ruling landed. BEHAVIOUR is unchanged and always
 *     was — a returned widget takes the cell, `null` falls through to the
 *     built-in text / number / date inputs.
 *   - `cellClassName` — said HELD, and described the key as folded "into every
 *     body cell's `className`". The hold is over (declared by the same `bf97b98c8`);
 *     the DESCRIPTION was wrong from the day it was written, which is the more
 *     useful half of this correction. Measured: `data-table.tsx` folds the
 *     SCHEMA-level key at exactly three sites and every one is a UTILITY cell —
 *     the selection checkbox, the row-number cell, the row-actions cell. It
 *     never reaches a data cell; a data cell folds `col.cellClassName`, the
 *     per-column twin declared on `TableColumn`. The two class slots style
 *     DISJOINT cells and never combine on one. So what breaks when the schema
 *     key is absent is NOT "density stops reaching cells": data cells keep
 *     their density, because `applyDensity` below puts the same class on every
 *     column. What breaks is the checkbox / row-number / row-actions cells
 *     falling out of height alignment with the data beside them, which is why
 *     this grid sets BOTH slots. `bf97b98c8`'s declaration is where the authoritative
 *     version of this now lives; this is the local copy agreeing with it.
 *     ⭐ GUARDED SINCE `4eb665bcf`: the cell set is MEASURED in the rendered
 *     DOM by `packages/components/src/renderers/complex/__tests__/`
 *     `data-table-cellClassName-population-6921.test.tsx` — the fence (a data
 *     cell does NOT fold this key) and the non-regression (the three utility
 *     cells DO) — and this entry's wording is pinned against that measurement
 *     by `cellClassNameCensusProse-6921.test.ts` beside the slot suite. The
 *     false sentence was copied forward for three days before anyone measured
 *     it; a re-wording here that drops a cell name or revives the hold goes red.
 *
 * ⛔ The old closing note ("do not fix either hold by declaring the key on
 * `DataTableSchema` as a rider — that package is published surface with its own
 * review floor") governs nothing now. It was asking for the ruling to be taken
 * deliberately at that package's floor, and that is exactly how `bf97b98c8` took it.
 */
type RemoveIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** `DataTableSchema`'s DECLARED members only — any index signature stripped (it has none since objectui#8347). */
export type DeclaredDataTableSchema = RemoveIndexSignature<DataTableSchema>;

/**
 * The SCHEMA-level keys this grid holds at the seam — the schema-slot sibling
 * of `ObjectGridColumnHolds`. Shapes mirror the CONSUMER's reads in
 * `data-table.tsx`, not what this file happens to pass.
 *
 * ⚠️ "Undeclared by `DataTableSchema`" was this type's ENTRY CONDITION, and —
 * exactly as `ObjectGridColumnHolds` warns about its own — it is a claim about
 * ANOTHER package that can stop being true with nothing going red here. It
 * stopped being true on 2026-08-30: `bf97b98c8` declared BOTH members. As of
 * objectui#7196 this type holds nothing; every member is redundant with
 * `DeclaredDataTableSchema`.
 *
 * ⛔ Kept rather than deleted, because deleting a member of an EXPORTED type is
 * a change of a different kind and gets its own card — the order objectui#6615
 * → #6424 took for `headerIcon`. What #7196 measured, so that card can start
 * from a reading instead of a guess:
 *
 *   - each member's shape is `Equal` (not merely assignable) to the upstream
 *     declared member, so removing it cannot narrow or widen the seam;
 *   - the seam's `cellClassName` is already reduced (`string & string` is
 *     `string`), while its `renderCellEditor` resolves to the SAME signature
 *     intersected with itself. That is inert — mutually assignable with the
 *     declared member, measured in both directions — but it is the one visible
 *     trace the redundant hold leaves, and it is what the exact-shape pin in
 *     `packages/types` would report if pointed at the seam type;
 *   - unlike `ObjectGridColumnHolds.pinned`, neither member is its own ONLY
 *     declaration on the emitted type, so deleting them deletes nothing from
 *     it. That is precisely the ⛔ contrast `ObjectGridColumnHolds` spells out,
 *     and this type is now on the other side of it.
 *
 * ⭐ GUARDED SINCE objectui#7201 — this is the one paragraph that changed.
 * Until then nothing above was mechanically checked, which is how it went stale
 * unseen: `dataTableSchemaSlot-6459.test.ts` pinned only that the seam ACCEPTS
 * both keys, an assertion that stays green whether they are held HERE or
 * declared THERE. That suite now also carries the column-level twin's shape
 * (`columnHoldsExpiry-6424.test.ts`, which asserts `TableColumn` does NOT
 * declare `pinned`), transplanted: a compile-time verdict per member of this
 * type, recording whether `DataTableSchema` declares that key. Both members are
 * pinned DECLARED today, so a revert upstream reddens; and the key set itself is
 * pinned, so a member added or removed here reddens too. ⚠️ The transplant is
 * NOT literal in one respect, deliberately: the probe reads
 * `DeclaredDataTableSchema`, not `DataTableSchema`, because the index signature
 * stripped above made the raw type answer "declared" to EVERY key — measured,
 * and pinned in that suite as its own control, which is flipped since
 * objectui#8347 removed the signature.
 *
 * ⇒ Anything in this census that a reader would otherwise have to re-measure by
 * hand is still prose; what is mechanical is the ENTRY CONDITION of the two
 * holds below. ⛔ Do not read the gate as covering the rest of the census — the
 * 46-key derivation is still hand-maintained, and whether this repo wants a
 * derivation gate over it is the question objectui#7201 left for a ruling.
 */
export type ObjectGridDataTableSchemaHolds = {
  /**
   * REDUNDANT since `bf97b98c8` (2026-08-30) — `DataTableSchema` declares this
   * key itself now, with a shape measured `Equal` to this one. `data-table`
   * calls it to render a host cell editor; returning `null` falls through to the
   * built-in text / number / date inputs. objectui#7188 added `pendingRow` (the
   * persisted `row` merged with the row's staged, unsaved edits) upstream, and
   * this copy carries it too so the seam's intersection stays INERT — `Equal`
   * in both directions, as #7196 measured — rather than becoming a second,
   * narrower signature that a `pendingRow`-reading host would trip on.
   */
  renderCellEditor?: (ctx: {
    column: any;
    row: any;
    pendingRow: any;
    value: any;
    stage: (v: any) => void;
    commit: (v?: any) => void;
    cancel: () => void;
  }) => React.ReactNode;
  /**
   * REDUNDANT since `bf97b98c8` (2026-08-30) — `DataTableSchema` declares this
   * key itself now, with a shape measured `Equal` to this one. `data-table`
   * folds it into the three UTILITY body cells (selection, row-number,
   * row-actions) and never into a data cell, which folds
   * `TableColumn.cellClassName` instead.
   */
  cellClassName?: string;
};

/** What this grid is allowed to write into the `data-table` schema slot. */
export type ObjectGridDataTableSchema =
  DeclaredDataTableSchema & ObjectGridDataTableSchemaHolds;

export const ObjectGrid: React.FC<ObjectGridComponentProps> = ({
  schema,
  dataSource,
  onEdit,
  onDelete,
  rowOperations,
  rowAdornment,
  recordLinkAdornment,
  onBulkDelete,
  onRowSelect,
  onRowClick,
  onNavigate,
  onCellChange,
  onRowSave,
  onBatchSave,
  onAddRecord,
  // The host-driven mode (`ObjectGridExternalPaginationProps`). Every one of
  // these was read out of `...rest` through an `as any` cast until #4277 gave
  // them a declaration; they are ordinary typed props now, and `rest` is gone
  // with them. Renamed on the way in only where the component already owns the
  // plain name (`data` is the fetched rows, `pageSize` the schema's).
  data: passedData,
  manualPagination: hostManualPagination,
  rowCount: hostRowCount,
  page: hostPage,
  pageSize: hostPageSize,
  onPageChange: hostOnPageChange,
  onPageSizeChange: hostOnPageSizeChange,
  sort: hostSort,
  onSortChange: hostOnSortChange,
  search: hostSearch,
  onSearchChange: hostOnSearchChange,
  findParams: hostFindParams,
  onColumnStateChange,
  objectFields: hostObjectFields,
  showRowNumbers: hostShowRowNumbers,
  onColumnSummaryChange,
}) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Tenant default currency (ADR-0053) backstops amount cells that lack a code.
  const { currency: tenantCurrency } = useLocalization();
  // The one date/number locale resolver: tenant regional default → active UI
  // language → 'en' (objectui#4272). Read unconditionally at component level.
  const displayLocale = useDisplayLocale();
  const { t, language: uiLanguage } = useGridTranslation();
  const { fieldLabel: resolveFieldLabel, fieldOptionLabel: resolveFieldOptionLabel, translateOptions, actionLabel: resolveActionLabel } = useSafeFieldLabel();
  // The session's object metadata (objectui#12105) — what a promoted bulk
  // action's `objectOverride` param resolves against, as on the record page.
  // The CONTEXT VALUE is closed over, never a snapshot of its `objects`
  // getter, which reads the live cache at call time.
  const metadata = useMetadata();
  const [objectSchema, setObjectSchema] = useState<any>(null);
  const [useCardView, setUseCardView] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Optimistic concurrency for the default inline-edit saves (objectui#12292).
  // Per record, the version this grid's last landed write returned — see
  // `rowVersionToSend`. It lives as long as this grid does.
  const writtenVersionsRef = React.useRef(new Map<string, WrittenRowVersion>());
  // The conflict a 409 opened, on the record surfaces' own dialog, and the
  // resolver of the save that is awaiting the user's choice.
  const { t: tDetail } = useDetailTranslation();
  const [rowConflict, setRowConflict] = useState<ConcurrentUpdateConflict | null>(null);
  const rowConflictDecisionRef = React.useRef<((choice: RowConflictChoice) => void) | null>(null);
  // A grid torn down mid-conflict settles it as Cancel, so the awaiting save
  // never hangs.
  useEffect(() => () => rowConflictDecisionRef.current?.('cancel'), []);
  const [showExport, setShowExport] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [rowHeightMode, setRowHeightMode] = useState<RowHeightMode>(resolveRowHeightMode(schema.rowHeight));
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  // Bumped to tell the underlying table to drop its internal checkbox selection.
  // The table owns that state, so clearing our `selectedRows` alone would leave
  // the checkboxes ticked (toolbar gone, rows still visibly selected).
  const [selectionResetKey, setSelectionResetKey] = useState(0);
  const [totalMatching, setTotalMatching] = useState<number | undefined>(undefined);
  const [activeBulkDef, setActiveBulkDef] = useState<BulkActionDef | null>(null);
  const [activeBulkRows, setActiveBulkRows] = useState<any[]>([]);
  // Selected records the def's `visible` excluded (#3067) — shown in the
  // dialog so a run over fewer records than the user picked says so.
  const [activeBulkSkipped, setActiveBulkSkipped] = useState(0);
  const lastFindParamsRef = React.useRef<Record<string, unknown> | null>(null);
  // Grouped view paginates whole groups (groups stay intact, never split across
  // pages). Defaults to the schema page size, falling back to the display
  // default the spec declares (objectui#9853) — here counted in groups.
  const [groupedPage, setGroupedPage] = useState(1);
  const [groupedPageSize, setGroupedPageSize] = useState<number>(
    resolvePageSize(schema, DEFAULT_DISPLAY_PAGE_SIZE),
  );

  // The row-height sync (`./objectGridRowHeight`), run here in hook order.
  useObjectGridRowHeightSync({ schema, rowHeightMode, setRowHeightMode });

  // Column state persistence: the seed, the external sync and the save, in
  // hook order (`./objectGridColumnState`).
  const { columnState, saveColumnState } = useObjectGridColumnState({ schema, onColumnStateChange });

  // Pull to refresh and the card-view breakpoint, in hook order (`./objectGridMobile`).
  const { pullRef, isRefreshing, pullDistance } = useObjectGridMobile({
    schema, dataSource, setRefreshKey, setUseCardView,
  });

  // `passedData` — data handed down directly (from ListView) — is destructured
  // from props above.

  // Resolve bound data if 'bind' property exists
  const boundData = useDataScope(schema.bind);

  // Get data configuration (supports both new and legacy formats)
  const rawDataConfig = getDataConfig(schema);
  // Memoize dataConfig using deep comparison to prevent infinite loops
  const dataConfig = React.useMemo(() => {
    // If we have passed data (highest priority), treat it as value provider
    if (passedData && Array.isArray(passedData)) {
        return {
            provider: 'value',
            items: passedData
        };
    }

    // If we have bound data, it takes precedence as inline value
    if (boundData && Array.isArray(boundData)) {
        return {
            provider: 'value',
            items: boundData
        };
    }
    return rawDataConfig;
  }, [JSON.stringify(rawDataConfig), boundData, passedData]);
  
  const hasInlineData = dataConfig?.provider === 'value';

  // External (parent-driven) server pagination. When a host like ListView fetches
  // the data itself, it passes the current window down as `data` AND hands us the
  // real match total + page controls. We must forward those straight to DataTable
  // instead of client-slicing the window — otherwise the footer would report
  // "pages = window / pageSize" and records beyond the window stay unreachable
  // (objectstack-ai/objectstack#2212). `data` is a prop, and so are these — all declared on
  // `ObjectGridExternalPaginationProps` since #4277.
  const externalManualPagination =
    hostManualPagination === true &&
    typeof hostRowCount === 'number' &&
    typeof hostOnPageChange === 'function';

  // Extract stable primitive/reference-stable values from schema for dependency arrays.
  // This prevents infinite re-render loops when schema is a new object on each render
  // (e.g. when rendered through SchemaRenderer which creates a fresh evaluatedSchema).
  // The `?? schema.objectName` tail is NOT the shared rung repeated: it stands
  // in for the old `'object' in dataConfig` test, i.e. this site's own coercion
  // of the OFF-CONTRACT `data: { provider: 'object' }` that carries no `object`
  // (`ViewDataSchema` declares it required). Kept because this name gates the
  // permission verdicts below — see the note at `inlineEditable`.
  const objectName = resolveRecordSourceObjectName(schema, dataConfig) ?? schema.objectName;
  /**
   * The field catalogue this grid answers field-type questions from
   * (objectui#10657): its own object definition once that read has landed,
   * the catalogue a host handed down (`objectFields`) until then.
   *
   * ⚠️ Only the field reads that decide how a column DRAWS and whether it is
   * MASKED go through this — the column builders, the masked flag, the client
   * export, the grouping, the mobile card. Everything that needs the whole
   * definition (actions, `highlightFields`, the default-column policy) still
   * waits for `objectSchema`, exactly as before.
   */
  const objectFields: Record<string, any> | undefined =
    objectSchema?.fields ?? hostObjectFields ?? undefined;
  /**
   * Are this grid's OBJECT field types still unknown (objectui#10657, which
   * folded objectui#10706)? True while an object definition is expected (an
   * object to ask about, and a data source that can answer `getObjectSchema`)
   * and no catalogue is in hand: the read is in flight, or it failed, which
   * the inline path swallows as non-fatal. Rows a host hands down paint inside
   * that window, so every untyped column is WITHHELD until it closes, and for
   * good if it never does (`isWithheldGridColumn`). With no `getObjectSchema`
   * there is nothing to wait for, and the authored column types are all this
   * grid will ever know.
   */
  const objectTypesPending =
    !!objectName && typeof dataSource?.getObjectSchema === 'function' && !objectFields;
  // [objectstack#3391] Server-resolved effective API operation set for this object
  // (/me/permissions `apiOperations`). The Export button and handler AND their
  // gate with this — a missing set (unrestricted object / old backend / no
  // provider) keeps the current behavior. The frontend consumes the effective
  // set the server resolved; it never reads the raw `apiMethods`.
  const perms = usePermissions();
  const { getObjectApiOperations } = perms;
  const effectiveApiOps = objectName ? getObjectApiOperations(objectName) : undefined;
  // [#4096] The CURRENT PRINCIPAL's write verdict on this object, the same
  // source the toolbar's `can(obj, 'create')` reads (`/me/permissions`
  // `allowEdit` / `allowDelete`). `effectiveApiOps` above cannot stand in for
  // it: that set is the object's API exposure surface and is identical for
  // every account, so the row kebab and the bulk bar used to fail open for a
  // read-only principal. Undefined when no object name is resolved (element
  // data source), which leaves the affordance verdict untouched.
  //
  // [objectui#12082] Every object-level verdict this grid renders — the row
  // kebab's Edit / Delete, the bulk bar's Delete, in-place editing and the
  // add-record row — is a row of the affordance-to-grant map, resolved by
  // `resolveAffordance` from `@object-ui/core` against this one source: the
  // object's `managedBy` / `userActions`, the effective operation set and the
  // caller's grant, all asked of `objectName`. With no `objectName` (an element
  // or inline data source) nothing is asked and every verdict reads open.
  //
  // KEY COLLISION — the OBJECT's `userActions` block, and the only one these
  // verdicts can consume. `userActions` names two different shapes: on a VIEW
  // it is toolbar policy (`UserActionsConfigSchema` — `sort`/`search`/`filter`/
  // `refresh`/`rowHeight`/`addRecordForm`/`editInline`/`buttons`, which rejects
  // `edit` BY NAME), on an OBJECT it is the CRUD-predicate block `edit`/
  // `delete`/`create` carrying `visibleWhen`/`disabledWhen`. Only the object
  // block means anything to the map's rows — or to `listViewPredicates` at the
  // `$select` read below, which carries the full measurement. So the source
  // stays `objectSchema`-only and must never gain the VIEW's `userActions` as a
  // fallback: that is the shadowing this grid was fixed for (maintainer ruling
  // of 2026-08-20 on objectui#5240, Q3=B). Pinned by
  // `__tests__/gridNonAuthorKeys.test.tsx`.
  const affordanceSource = { objectSchema: objectSchema as SchemaLike | null | undefined, objectName, perms };
  const rowEditVerdict = resolveAffordance('rowEdit', affordanceSource);
  const rowDeleteVerdict = resolveAffordance('rowDelete', affordanceSource);
  // [#5148] …and the same verdict for `create`, the third face of the shape.
  // Its two siblings above have carried the principal's own grant since #4096
  // while the inline add-record row below rode on the author-declared
  // `operations.create` ALONE — a flag that says whether the affordance was
  // WIRED, never a permission grant. One component therefore answered "may
  // this user create records here?" two opposite ways on the same screen: the
  // toolbar's New button hid itself for a principal with no grant, while the
  // add row underneath stayed live and walked that user through a write it
  // already knew the server would 403. Resolved here beside its siblings so
  // the three read as one block rather than drifting apart again.
  const addRowGranted = resolveAffordance('gridAddRow', affordanceSource).allowed;

  // [#5143] Whether THIS principal may edit THIS object's rows in place — the
  // single verdict behind every inline-edit affordance this grid renders
  // (`editable`, the cell editor, and the save/cancel column that serves them).
  //
  // `permissionUpdate` above was resolved for the row kebab and consumed by
  // nothing else, while the inline-edit props read `schema.editable` raw. That
  // left one component answering "may this user write these records?" two
  // opposite ways on the same rows: the kebab hid Edit for a read-only
  // principal, and a declaratively-authored `object-grid` block carrying
  // `editable: true` dropped that same principal straight into editable cells,
  // to be stopped only by the server's 403. No data ever landed (the server
  // gate is solid) — the cost was a round-trip the UI guaranteed would fail.
  //
  // #4647 closed the ListView door with this exact conjunction (PR #5145,
  // `inlineEditOffered`); the SDUI-authored grid schema is a SECOND, independent
  // door into the same state that never passes through ListView. Spelling the
  // gate identically here is what keeps the two from drifting: the object's
  // resolved affordance — ADR-0103 bucket ∧ `userActions.edit` ∧ the server's
  // effective API operations (objectstack#3391/objectstack#3546), which is what `isObjectInlineEditable`
  // names — AND the current principal's own grant (#4096).
  //
  // Fail-open, like every sibling gate in this file. `can()` answers `true`
  // with no `PermissionProvider`, and `isObjectInlineEditable` resolves the
  // default-writable bucket for a null/absent object schema, so a standalone
  // embed, the Studio designer, and a pure inline-data grid with no object
  // semantics at all keep today's behavior. The narrowing only ever engages
  // where there IS an object to have a verdict about.
  const objectInlineEditable = resolveAffordance('listInlineEdit', affordanceSource).allowed;

  // [#5143] The authored request ∧ the verdict — resolved ONCE and read by all
  // three inline-edit props below (`editable`, `renderCellEditor`, and the
  // save/cancel `rowActions` column). Three sites re-deriving `schema.editable`
  // is how they came to disagree in the first place; one name is what keeps a
  // future prop from being added on the raw key again.
  //
  // The authored key stays the gate's left half, so this narrows and never
  // widens: no verdict can turn inline editing ON for a grid that did not ask
  // for it.
  //
  // When ListView owns this grid it has already ANDed its own copy of this
  // conjunction into the `editable` it hands down (#4647 / PR #5145), so on
  // that path the second application is idempotent — A ∧ B, then ∧ B again.
  // The two are NOT the same predicate everywhere, though, and the difference
  // runs in the safe direction: ListView reads `schema.objectName`, while
  // `objectName` here is `dataConfig.object ?? schema.objectName`. A grid whose
  // object identity arrives only through its data config (`{ provider:
  // 'object', object: … }`, no top-level `objectName`) falls through ListView's
  // `schema.objectName ? … : true` branch OPEN and is judged solely here. This
  // gate is therefore the only one on that shape, not a redundant copy of
  // ListView's — verified rather than assumed, since "it's already gated
  // upstream" is exactly the reasoning that left this door open to begin with.
  const inlineEditable = (schema.editable ?? false) && objectInlineEditable;

  // When the consumer wired onEdit/onDelete callbacks but the view schema
  // omits an explicit `operations` block, default to allowing those actions.
  // This gives every main list a Row actions kebab out of the box without
  // forcing every view JSON to declare operations: { update: true, delete: true }.
  const explicitOperations = 'operations' in schema ? schema.operations : undefined;
  const operations = explicitOperations ?? {
    update: !!onEdit,
    delete: !!onDelete,
  };
  // Row actions can declare 'edit' / 'delete' as canonical strings — they
  // SELECT the native Edit/Delete entries inside what `operations` allows
  // (objectui#9819: `operations` is the ceiling), so the dropdown surfaces
  // native entries (with proper icons) and
  // routes them to onEdit / onDelete instead of the generic action runner
  // (which has no 'edit' handler and a parameter-shape mismatch for 'delete').
  //
  // [objectui#10083] Whether the list was DECLARED is its own signal, read
  // before the `[]` below erases it: `rowActions` narrows the generic
  // Edit/Delete to the canonical names it carries only when the view declared
  // it; an absent list keeps the default (see `resolveRowCrudAffordances`).
  const rowActionsDeclared = Array.isArray(schema.rowActions);
  const rowActionsList: string[] = Array.isArray(schema.rowActions) ? schema.rowActions : [];
  /**
   * NON-AUTHOR SURFACE — `rowActionDefs` is deliberately absent from
   * `GRID_QUERY_INPUTS` (`index.tsx`), by the maintainer ruling of 2026-08-19
   * on objectui#5091. Both cast reads on the line below are therefore
   * DELIBERATE, not missed.
   *
   * That ruling KNOWINGLY REVERSES one line of the 2026-08-18 ruling on the
   * same card, which had sent this key INTO the manifest as the "symmetric
   * partner" of the declared `bulkActionDefs`. The symmetry premise did not
   * survive measurement, and the reversal was flagged and accepted on the
   * record:
   *
   *   - The PRODUCER derives it. `app-shell/src/views/ObjectView.tsx:1968`
   *     builds this key from `objectDef.actions` filtered by
   *     `locations.includes('list_item')`, then localizes each def — see its
   *     own docblock there. Twenty lines below it, `bulkActionDefs` is passed
   *     STRAIGHT THROUGH from the view author. The two keys are asymmetric by
   *     construction: one is computed for the grid, the other is authored.
   *   - The contract refuses it. `ComponentPropsMap['object-grid']`
   *     (`@objectstack/spec@17`) is a `strictObject` that accepts
   *     `bulkActionDefs` and answers `unrecognized_keys` for THIS key, so an
   *     author who took a published offer could not save the document.
   *   - `@object-ui/types`' `ObjectGridSchema` declares `bulkActionDefs` and no
   *     `rowActionDefs` — which is why this read is a cast in the first place.
   *
   * The AUTHORED way to put an action on a row is unchanged and stays declared:
   * `locations: ['list_item']` on the object's own action, plus the legacy
   * `rowActions` name list (`GRID_QUERY_INPUTS`, `index.tsx:190`) that the fold
   * below resolves against the object. Both halves — unlisted here, rejected
   * there — are pinned by `__tests__/gridNonAuthorKeys.test.tsx`, together with
   * the read itself, so this exemption cannot decay into a silent drop.
   */
  const rowActionDefsList: any[] = Array.isArray((schema as any).rowActionDefs) ? (schema as any).rowActionDefs : [];
  const wantEditAction = rowActionsList.includes('edit');
  const wantDeleteAction = rowActionsList.includes('delete');
  // Legacy `rowActions` carry a bare action NAME, which the runner cannot
  // execute on its own — resolve each against the object's declared actions so
  // it dispatches as a real def (and so a name that duplicates an existing
  // `list_item` def stops rendering a dead twin of it). See
  // `resolveLegacyRowActions` for the full rationale (objectui#2960).
  const { defs: resolvedRowActionDefs, unresolved: customRowActions } = resolveLegacyRowActions({
    rowActions: rowActionsList.filter(a => a !== 'edit' && a !== 'delete'),
    rowActionDefs: rowActionDefsList,
    objectActions: (objectSchema as any)?.actions,
  });
  // Honor the object's resolved CRUD affordance: the ADR-0103 lifecycle bucket
  // (`managedBy`), the `userActions.edit`/`delete` override — explicit `false`
  // opts out of the generic row Edit/Delete (e.g. sys_environment ships a
  // dedicated Rename + cascade-Delete instead, and the generic entries would
  // duplicate them) — and [objectstack#3720] the server's effective API operation set, so
  // the row kebab never offers an update/delete the server would reject.
  // `operations` above only says whether the CONSUMER wired the affordance; it
  // is not a permission grant, which is why the object verdict is ANDed here
  // rather than assumed to have been applied upstream.
  // [#4096] …and neither is `apiOperations`, which describes the OBJECT, not
  // the caller — so the principal's own `allowEdit` / `allowDelete` is ANDed on
  // top, matching the toolbar and the record header on the very same screen.
  // [objectui#12082] Those object layers arrive as the map's `rowEdit` /
  // `rowDelete` verdicts (`affordanceSource` above); this call adds the row
  // wiring on top of them.
  //
  // Resolved HERE, above the error / loading early returns, rather than beside
  // the row-actions column it feeds: the record-level layer below is a hook and
  // may not sit behind a conditional return.
  const { canEdit, canDelete, objectCanDelete, editPredicates, deletePredicates, objectDeletePredicates } = resolveRowCrudAffordances({
    operationsUpdate: operations?.update,
    operationsDelete: operations?.delete,
    wantEditAction,
    wantDeleteAction,
    rowActionsDeclared,
    hasOnEdit: !!onEdit,
    hasOnDelete: !!onDelete,
    // The object's `managedBy` / `userActions` reach these two verdicts through
    // `affordanceSource.objectSchema` above — see the KEY COLLISION note there.
    edit: rowEditVerdict,
    delete: rowDeleteVerdict,
  });
  // [#4296] …and neither of those describes the ROW. `allowEdit` is the
  // principal's verdict on the OBJECT; `writeScope`, the sharing model and RLS
  // narrow it per record, so everything above fails OPEN for every row the
  // principal does not own — the kebab offered Edit/Delete on rows the server
  // answers 403 for, while the record detail header (which has ANDed the
  // record-grained verdict since objectstack#3821) correctly hid both on the
  // very same record. One batched explain call per (object, operation) for the
  // rows on screen answers it for the whole page; rows with no answer keep the
  // object-level verdict (see `useRecordCrudVerdicts` — fail open, never
  // over-hide).
  const pageRecordIds = useMemo(
    () => Array.from(new Set(
      data.map(rowRecordId).filter((id) => id != null).map((id) => String(id)),
    )),
    [data],
  );
  const recordVerdict = useRecordCrudVerdicts({
    objectName,
    recordIds: pageRecordIds,
    update: canEdit,
    delete: canDelete,
  });

  // The projection keys and the filter, sort, search and server-paging state,
  // read here in hook order (`./objectGridQueryInputs`).
  const {
    schemaFields,
    schemaColumns,
    carriesConcurrencyToken,
    rowColorField,
    groupingProjectionKey,
    predicateProjectionKey,
    filterScope,
    schemaFilterSource,
    schemaFilterRefusal,
    schemaFilter,
    schemaSort,
    schemaPagination,
    schemaPageSize,
    serverPage,
    setServerPage,
    serverPageSize,
    setServerPageSize,
    headerSort,
    setHeaderSort,
    setSearchTerm,
    hostOwnsSearch,
    querySearchTerm,
    searchFieldsKey,
  } = useObjectGridQueryInputs({ schema, objectName, externalManualPagination, hostSearch });

  // --- Inline data effect (synchronous, no fetch needed) ---
  useEffect(() => {
    if (hasInlineData && dataConfig?.provider === 'value') {
       // Only update if data is different to avoid infinite loop
       setData(prev => {
         const newItems = dataConfig.items as any[];
         if (JSON.stringify(prev) !== JSON.stringify(newItems)) {
            return newItems;
         }
         return prev;
       });
       setLoading(false);
    }
  }, [hasInlineData, dataConfig]);

  // --- Inline data: still fetch objectSchema for type-aware rendering ---
  // When data is inline (provider: 'value'), we skip the data fetch but still need
  // the object schema to resolve field types (lookup, select, currency, etc.) and
  // enable proper CellRenderer selection.
  useEffect(() => {
    if (!hasInlineData) return;
    if (!objectName || !dataSource) return;

    let cancelled = false;

    const fetchSchema = async () => {
      try {
        if (typeof dataSource.getObjectSchema !== 'function') return;
        const schemaData = await dataSource.getObjectSchema(objectName);
        if (!cancelled) {
          setObjectSchema(schemaData);
        }
      } catch (err) {
        // Schema fetch failure for inline data is non-fatal: the rows still
        // draw. An untyped column does NOT fall back to heuristic inference,
        // though: with no field types in hand it stays WITHHELD (drawn as the
        // mask, handled as masked), because it could be a `password` /
        // `secret` field — fail closed (objectui#10657, `objectTypesPending`).
        console.warn(`[ObjectGrid] Failed to fetch objectSchema for inline data (objectName: ${objectName}):`, err);
      }
    };

    fetchSchema();

    return () => { cancelled = true; };
  }, [hasInlineData, objectName, dataSource]);

  // The grouping decisions: masked-key refusal, server grouping, the two
  // grouping refusals and the fetch window (`./objectGridGroupingDecisions`).
  const {
    unmaskedGroupingFields,
    groupingRefusesNothing,
    groupingKeyReadable,
    serverGroupedFetch,
    groupingNeedsHeaderQuery,
    groupingNeedsWholeRows,
    fetchWindow,
    groupRowQuery,
    setGroupRowQuery,
  } = useObjectGridGroupingDecisions({
    schema,
    objectName,
    objectFields,
    objectTypesPending,
    perms,
    dataSource,
    hasInlineData,
    dataConfig,
    externalManualPagination,
    hostRowCount,
    serverPageSize,
  });

  // The row load: the invalidation nonce, the load effect, and the
  // `findParams` and page-1 resets, in hook order (`./objectGridRowLoad`).
  const { invalidationNonce } = useObjectGridRowLoad({
    schema, dataSource, objectName, dataConfig, hasInlineData, perms, refreshKey, hostFindParams,
    lastFindParamsRef, setData, setLoading, setError, setObjectSchema, setTotalMatching,
    setSelectAllMatching, schemaFields, schemaColumns, carriesConcurrencyToken, rowColorField,
    groupingProjectionKey, predicateProjectionKey, schemaFilter, schemaFilterRefusal, schemaSort,
    schemaPagination, schemaPageSize, serverPage, setServerPage, headerSort, querySearchTerm,
    searchFieldsKey, serverGroupedFetch, groupingNeedsHeaderQuery, fetchWindow, setGroupRowQuery,
  });

  // --- NavigationConfig support ---
  // Must be called before any early returns to satisfy React hooks rules
  const navigation = useNavigationOverlay({
    navigation: schema.navigation,
    objectName: schema.objectName,
    // NON-AUTHOR SURFACE — `onNavigate` is deliberately absent from
    // `GRID_QUERY_INPUTS` (`index.tsx`), by the maintainer ruling of
    // 2026-08-19 on objectui#5234, so this read is deliberate, not missed.
    //
    // Unlike the four keys objectui#5091 ruled, this one IS declared — in
    // `@object-ui/types`' `ObjectGridSchema` (`objectql.ts`), with its own doc
    // comment — which is why the read below is plain and not a cast. It is NOT
    // drift absorbed by `BaseSchema`'s index signature: the reading that said
    // so was measured wrong and withdrawn on the card before it was ruled.
    //
    // It stays unpublished because it is a FUNCTION VALUE and a schema is a
    // SERIALISABLE DOCUMENT. `(recordId, action) => void` cannot survive a
    // metadata round-trip whatever declares it, so no author writing JSON or
    // YAML — and no AI emitting a schema document — can ever express this key.
    // Publishing it into the designer panel and the generated
    // `sdui-intrinsics.d.ts` would advertise an offer nobody can take, which
    // is the option the ruling rejected as the most AI-error-prone of the
    // three. Programmatic callers already have the channel its nine siblings
    // use: `onRowClick`, `onRowSelect`, `onCellChange`, `onRowSave`,
    // `onBatchSave`, `onEdit`, `onDelete`, `onBulkDelete` and `onAddRecord`
    // are props on `ObjectGridComponentProps`, and since objectui#9547 this one
    // is the tenth prop there, which is where a caller should prefer to pass
    // it. When both are supplied the PROP WINS (maintainer ruling C on
    // objectui#9547), so `schema.onNavigate` below is the fallback read — kept,
    // because a host that builds the node in TypeScript still reaches the slot
    // that way. `__tests__/onNavigateProp-9547.test.tsx` pins both halves.
    //
    // The contract says the same thing independently: `ComponentPropsMap
    // ['object-grid']` (`@objectstack/spec@17`) is a `strictObject` and
    // rejects `onNavigate` BY NAME (`unrecognized_keys`), so an author who
    // took the offer could not save the document. Both halves — unlisted here,
    // rejected there — are pinned by `__tests__/gridNonAuthorKeys.test.tsx`,
    // together with the read itself, so this exemption cannot decay into a
    // silent drop.
    onNavigate: onNavigate ?? schema.onNavigate,
    onRowClick,
  });

  // --- Action support for action columns ---
  const { execute: executeAction, updateContext: updateActionContext } = useAction();

  // Publish the checkbox selection into the shared ActionRunner context so
  // actions rendered OUTSIDE the grid but inside the same <ActionProvider>
  // (e.g. `list_toolbar` flow buttons in the ObjectView header) can resolve a
  // recordId from the selected rows. Cleared on unmount / selection change so
  // a stale selection never leaks into later invocations.
  React.useEffect(() => {
    updateActionContext({ selectedRecords: selectedRows });
    return () => { updateActionContext({ selectedRecords: [] }); };
  }, [selectedRows, updateActionContext]);

  // --- Row color support ---
  const getRowClassName = useRowColor(schema.rowColor);

  // --- Conditional formatting support ---
  // Delegates to the shared CEL evaluator (issue #1584 / ADR-0058) so the grid
  // and ListView reach the identical verdict and the whole platform speaks one
  // expression dialect. The host predicate scope is bound so `features.*`
  // predicates resolve, mirroring row-action visibility.
  const predicateScope = usePredicateScope();
  // objectui#12708 — the row actions' capability gate, the one `RowActionMenu`
  // applies per row, read here too so the Actions column's verdict (below the
  // early returns, where no hook may sit) sees the same declared set.
  const mayInvokeRowAction = useCapabilityGate();
  const getRowStyle = useCallback((row: Record<string, unknown>): React.CSSProperties | undefined => {
    const rules = schema.conditionalFormatting;
    if (!rules || rules.length === 0) return undefined;
    // `objectSchema.fields` binds relation fields as the stored foreign key
    // rather than the record `$expand` substituted for them — the grid expands
    // every relational COLUMN, so without this a rule comparing one could only
    // ever be false (see `toPredicateRecord`).
    const style = resolveConditionalFormatting(row, rules as any, predicateScope, objectSchema?.fields);
    return Object.keys(style).length > 0 ? (style as React.CSSProperties) : undefined;
  }, [schema.conditionalFormatting, predicateScope, objectSchema]);

  // The grouping: the group value formatter and date faces, the server group
  // headers and rows, and the grouped data, in hook order (`./objectGridGrouping`).
  const {
    temporalGroupFaces, groupWhere, groupHeaders, groups, isGrouped, toggleGroup, groupRows,
  } = useObjectGridGrouping({
    schema, dataSource, objectName, objectFields, objectTypesPending, data, setData,
    setTotalMatching, t, translateOptions, groupedPage, setGroupedPage, groupedPageSize, refreshKey,
    serverPageSize, groupRowQuery, groupingKeyReadable, groupingRefusesNothing,
    unmaskedGroupingFields, serverGroupedFetch, invalidationNonce,
  });

  // The fan-out query, the resolved match total and the column summaries, in
  // hook order (`./objectGridSummaries`).
  const {
    bulkFanoutParams, resolvedTotalMatching, summaries, hasSummary,
  } = useObjectGridSummaries({
    schema, dataSource, objectName, objectSchema, data, hasInlineData, externalManualPagination,
    hostFindParams, hostRowCount, lastFindParamsRef, totalMatching, refreshKey, serverPage,
    fetchWindow, serverGroupedFetch, isGrouped,
  });

  // The authored-input diagnostics (`columns`, `bulkActionDefs`, page size),
  // three `console.warn` effects, run here in hook order (`./objectGridDiagnostics`).
  useObjectGridDiagnostics(schema);

  // `generateColumns`, the column generator, in hook order (`./objectGridGenerateColumns`).
  const { generateColumns } = useObjectGridGenerateColumns({
    schema, dataSource, data, dataConfig, hasInlineData, objectName, objectSchema, objectFields,
    objectTypesPending, schemaFields, schemaColumns, perms, navigation, executeAction, predicateScope,
    resolveFieldLabel, translateOptions, uiLanguage, recordLinkAdornment,
  });

  // Formats this grid can actually deliver (objectui#2942): the server stream
  // handles csv/xlsx/json, the client fallback only csv/json. Declared-but-dead
  // formats used to render as menu items whose click did nothing; now they're
  // dropped from the menu (with a one-time warning for the app author).
  //
  // The filter is format-AGNOSTIC — it keeps what `supported` lists — so it
  // still covers the live case (`xlsx` declared with no server stream) and, for
  // free, the legacy one: `'pdf'` was declined platform-side
  // (objectstack#1301) and left the spec's format enum in 17.0.0
  // (objectstack#8010), so it is no longer authorable, but metadata stored
  // before the retirement still carries it until `os migrate meta --from 16`
  // runs. Such a value reaches here and is dropped by the same rule, with no
  // `'pdf'`-specific branch to keep alive (objectui#4535).
  // (Hoisted above the error/loading early returns to satisfy hooks rules.)
  const exportableFormats = useMemo(() => {
    const declared = schema.exportOptions?.formats || ['csv', 'json'];
    const serverAvailable = typeof dataSource?.exportDownload === 'function'
      && !!objectName
      && !hasInlineData
      && schema.exportOptions?.streaming !== false;
    const supported = serverAvailable ? ['csv', 'xlsx', 'json'] : ['csv', 'json'];
    return declared.filter((f: string) => supported.includes(f));
  }, [schema.exportOptions, dataSource, objectName, hasInlineData]);
  useEffect(() => {
    const declared = schema.exportOptions?.formats;
    if (!declared) return;
    const dropped = declared.filter((f) => !exportableFormats.includes(f));
    if (dropped.length > 0) {
      console.warn(`[ObjectUI] ObjectGrid export: unsupported format(s) hidden from the menu: ${dropped.join(', ')}`);
    }
  }, [schema.exportOptions, exportableFormats]);

  const handleExport = useCallback((format: ListViewExportFormat) => {
    // Object-level export permission gate. Default-allow: an explicit
    // `operations.export === false` blocks it, and — when the server hands down
    // an effective API operation set for this object (objectstack#3391) — so does its
    // exclusion of `export`. Missing effective set keeps current behavior.
    if (schema.operations?.export === false) return;
    if (effectiveApiOps && !effectiveApiOps.includes('export')) return;
    const exportConfig = schema.exportOptions;
    const maxRecords = exportConfig?.maxRecords || 0;
    const includeHeaders = exportConfig?.includeHeaders !== false;
    // Download filename: `<配置前缀|对象中文标签|API名>-<视图名>-<日期时间>.<ext>`,
    // e.g. `合同-进行中-20260714-153045.xlsx`. The translated object label (when
    // the schema has loaded) beats the raw API name; a configured
    // exportOptions.fileNamePrefix beats both (and suppresses the view label).
    const fileNameFor = (ext: string) => buildExportFileName(ext, {
      prefix: exportConfig?.fileNamePrefix,
      label: objectSchema?.label,
      objectName: objectName || schema.objectName,
      // `title` is the deprecated spelling of `label` and takes the same door:
      // the spec types it `I18nLabel`, so an inline locale map reaches this
      // string sink and must resolve here, not stringify (objectui#10993).
      viewLabel: resolveInlineI18nLabel(schema.label, displayLocale)
        || resolveInlineI18nLabel(schema.title, displayLocale),
    });

    // Server-streamed path: csv / xlsx / json via dataSource.exportDownload.
    // XLSX is server-only; type-aware value formatting, field resolution and
    // permission enforcement all happen server-side. Mirrors the grid's
    // configured filter + sort so the exported file matches what's shown.
    const serverEligible = (format === 'csv' || format === 'xlsx' || format === 'json')
      && typeof dataSource?.exportDownload === 'function'
      && !!objectName
      && !hasInlineData
      // Honor an opt-out: schema.exportOptions.streaming === false forces client-side.
      && exportConfig?.streaming !== false;

    if (serverEligible) {
      const cols = generateColumns().filter((c) => c.accessorKey !== '_actions');
      const fields = cols.map((c) => c.accessorKey).filter(Boolean);

      // Same lowered value the fetch above sends, which is what keeps the
      // downloaded file agreeing with the screen: both read `schemaFilter`
      // AFTER `toFilterNode`, so an authored `ViewFilterRule[]` cannot reach
      // the wire as bare rule objects on one path and as AST on the other.
      const filter = Array.isArray(schemaFilter) ? schemaFilter : undefined;
      const sort = Array.isArray(schemaSort)
        ? schemaSort
            .filter((s: any) => s && s.field)
            .map((s: any) => ({ field: s.field, direction: (s.order as 'asc' | 'desc') ?? 'asc' }))
        : undefined;

      setExportError(null);
      setExportBusy(true);
      void (async () => {
        try {
          const blob = await dataSource!.exportDownload!(objectName!, {
            format: format as 'csv' | 'xlsx' | 'json',
            fields: fields.length ? fields : undefined,
            filter,
            sort,
            includeHeaders,
            limit: maxRecords > 0 ? maxRecords : undefined,
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileNameFor(format);
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          setShowExport(false);
        } catch (err) {
          // Surface the failure instead of swallowing it (e.g. permission denied
          // or a server error) — the toolbar shows the message.
          console.error('ObjectGrid export failed:', err);
          setExportError(err instanceof Error ? err.message : String(err));
        } finally {
          setExportBusy(false);
        }
      })();
      return;
    }

    // Client-side fallback (legacy synchronous blob path).
    const exportData = maxRecords > 0 ? data.slice(0, maxRecords) : data;

    const downloadFile = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    };

    const escapeCsvValue = (val: any): string => {
      const str = val == null ? '' : String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    // objectui#10583 — a MASKED field leaves neither file. The same rule that
    // stamps `TableColumn.masked` (`isMaskedGridColumn`, the narrow-only union
    // of the column's type and the object-declared type), asked per KEY
    // because the JSON branch writes whole records, including fields that are
    // not columns. While the object's field types are unknown (objectui#10657),
    // a key with no column type of its own is WITHHELD and leaves both files
    // too: a record field no column types is judged by its object type alone,
    // and there is none yet.
    const columnTypeByKey = new Map(generateColumns().map((c) => [c.accessorKey, c.type]));
    const isMaskedKey = (key: string) =>
      isMaskedGridColumn(columnTypeByKey.get(key), objectFields?.[key]?.type, objectTypesPending);

    if (format === 'csv') {
      const cols = generateColumns().filter((c) => c.accessorKey !== '_actions' && !isMaskedKey(c.accessorKey));
      const fields = cols.map((c) => c.accessorKey);
      const headers = cols.map((c) => c.header);
      const rows: string[] = [];
      if (includeHeaders) {
        rows.push(headers.join(','));
      }
      exportData.forEach(record => {
        rows.push(fields.map((f: string) => escapeCsvValue(record[f])).join(','));
      });
      downloadFile(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' }), fileNameFor('csv'));
    } else if (format === 'json') {
      const unmasked = exportData.map((record) =>
        Object.fromEntries(Object.entries(record).filter(([key]) => !isMaskedKey(key))),
      );
      downloadFile(new Blob([JSON.stringify(unmasked, null, 2)], { type: 'application/json' }), fileNameFor('json'));
    }
    setShowExport(false);
  }, [data, schema.exportOptions, schema.operations?.export, effectiveApiOps, schema.objectName, objectName, objectSchema, objectFields, objectTypesPending, generateColumns, dataSource, hasInlineData, schemaFilter, schemaSort]);

  // objectui#9050 step 2 — a refused filter: `schema.filter` (a render-time
  // `useMemo`, which would otherwise have thrown out of render), or a
  // `FilterOperatorError` the load effect caught. The second entry used to be
  // `schema.defaultFilters`, lowered inside the load effect; that alias is not
  // read since `@objectstack/spec` 18 retired it (objectui#12030). Ahead of the
  // load-error branch because it is not a
  // load failure: nothing was ever sent, and the repair is in the author's
  // metadata rather than in the network. It NAMES the operator, which is what
  // separates it from the `SchemaErrorBoundary`'s "Component failed to render"
  // banner — and from the "Error loading grid" heading this path used to show.
  const filterRefusal = schemaFilterRefusal
    ?? (error instanceof FilterOperatorError ? error : undefined);
  if (filterRefusal) {
    return (
      <div
        role="alert"
        className="p-3 sm:p-4 border border-amber-300 bg-amber-50 rounded-md"
        data-testid="grid-malformed-filter"
      >
        {/* Separately addressable: this is the half that has to NAME the
            operator, and the technical line below repeats the token
            incidentally. */}
        <h3 className="text-amber-800 font-semibold" data-testid="grid-malformed-filter-subject">
          {t('view.malformedFilter', { subject: filterRefusalSubject(filterRefusal) ?? '' })}
        </h3>
        <p className="text-amber-700 text-sm mt-1">{filterRefusal.message}</p>
      </div>
    );
  }

  // [objectui#10881] A grouping of rows a host declared to be one page of
  // more, refused in the load-error panel's own shape with its own sentence
  // (`groupingNeedsWholeRows`). Nothing to wait for: the rows are the host's,
  // so this comes before the spinner.
  if (groupingNeedsWholeRows) {
    return (
      <div
        role="alert"
        className="p-3 sm:p-4 border border-red-300 bg-red-50 rounded-md"
        data-testid="grid-grouping-needs-whole-rows"
      >
        <h3 className="text-red-800 font-semibold">{t('grid.errorLoading')}</h3>
        <p className="text-red-600 text-sm mt-1">{t('grid.grouping.needsWholeRows')}</p>
      </div>
    );
  }

  // [objectui#7189] A server-grouped grid fails like any other load: the
  // header query refused, or a view filter that would not lower for it.
  const loadError = error
    ?? (serverGroupedFetch ? (groupWhere.error ?? groupHeaders.error ?? null) : null);
  if (loadError) {
    return (
      <div className="p-3 sm:p-4 border border-red-300 bg-red-50 rounded-md">
        <h3 className="text-red-800 font-semibold">{t('grid.errorLoading')}</h3>
        <p className="text-red-600 text-sm mt-1">{loadError.message}</p>
      </div>
    );
  }

  // …and it is loading until its group set has first arrived: the flat fetch
  // it skips never clears `data`'s emptiness, so `loading` alone says nothing.
  const serverGroupsFirstLoad = serverGroupedFetch && !groupHeaders.headers;
  if ((loading && data.length === 0) || serverGroupsFirstLoad) {
    if (useCardView) {
      return (
        <div className="space-y-2 p-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border rounded-lg p-3 bg-card animate-pulse">
              <div className="h-5 bg-muted rounded w-3/4 mb-3" />
              <div className="flex items-center justify-between mb-2">
                <div className="h-4 bg-muted rounded w-1/4" />
                <div className="h-5 bg-muted rounded-full w-20" />
              </div>
              <div className="h-3 bg-muted rounded w-1/3" />
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="p-4 sm:p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
        <p className="mt-2 text-sm text-muted-foreground">{t('grid.loading')}</p>
      </div>
    );
  }

  // [objectui#10881] A grouping the data source cannot count, refused in the
  // load-error panel's own shape: nothing was fetched, and the sentence names
  // the member the data source would need (`groupingNeedsHeaderQuery`). AFTER
  // the spinner, deliberately: the refusal is decided before the object's
  // field types are known, and a grouping whose only key turns out to be a
  // masked type is no grouping at all — so while that one read is in flight
  // the grid shows it is loading, never an error it is about to withdraw.
  if (groupingNeedsHeaderQuery) {
    return (
      <div
        role="alert"
        className="p-3 sm:p-4 border border-red-300 bg-red-50 rounded-md"
        data-testid="grid-grouping-needs-header-query"
      >
        <h3 className="text-red-800 font-semibold">{t('grid.errorLoading')}</h3>
        <p className="text-red-600 text-sm mt-1">{t('grid.grouping.needsHeaderQuery')}</p>
      </div>
    );
  }

  // The generated columns, enriched and folded, with the persisted widths and
  // order applied (`./objectGridPersistedColumns`).
  const { persistedColumns } = resolveObjectGridPersistedColumns({
    generateColumns, objectFields, objectName, perms, objectTypesPending, columnState,
  });

  // The Actions column and the pinned column sets (`./objectGridActionsColumn`).
  const {
    columnsWithActions, hasActions, hasPinnedColumns, hasUserPinnedColumns, pinnedLeftCols,
    pinnedRightCols, unpinnedCols, rightPinnedClasses, rightPinnedCellClasses, userLeftPinnedCount,
  } = resolveObjectGridActionsColumn({
    schema, data, objectSchema, persistedColumns, operations, customRowActions, resolvedRowActionDefs,
    wantEditAction, wantDeleteAction, mayInvokeRowAction, rowOperations, canEdit, canDelete,
    recordVerdict, predicateScope, onEdit, onDelete, editPredicates, deletePredicates, executeAction,
    setRefreshKey, t,
  });

  // Density-driven cell padding/font (applied to every column so it actually reaches <td>).
  // `h-*` enforces a minimum row height so the action-button column doesn't dictate it.
  const rowHeightCellClass =
    rowHeightMode === 'compact'
      ? 'px-3 py-1 h-9 text-[13px] leading-tight'
      : rowHeightMode === 'short'
        ? 'px-3 py-1 h-9 text-[13px] leading-normal'
        : rowHeightMode === 'tall'
          ? 'px-3 py-2.5 h-14 text-sm'
          : rowHeightMode === 'extra_tall'
            ? 'px-3 py-3.5 h-16 text-sm leading-relaxed'
            : 'px-3 py-1.5 h-11 text-[13px] leading-normal';

  // Body cells get `px-3` from rowHeightCellClass; give the header the same
  // horizontal padding so header labels line up exactly with the cell content
  // below them (the primitive <th> default is px-4, which is 4px wider).
  const applyDensity = (col: any) => ({
    ...col,
    className: ['px-3', col.className].filter(Boolean).join(' '),
    cellClassName: [rowHeightCellClass, col.cellClassName].filter(Boolean).join(' '),
  });

  // Server-side pagination applies to every list whose rows the server pages:
  // the flat, server-fetched list, and a server-grouped one (per group).
  // Inline/static data paginates in-memory, and so does a grid grouping a page
  // it fetched (grouped mode keeps whole groups together via its own
  // groupedPage state), so they stay on DataTable's client-side slicing.
  //
  // Declared here rather than beside the rest of the manual-mode wiring below
  // because `orderedColumns` needs it: which columns may be sorted at all
  // depends on whether the sort is the server's.
  //
  // [objectui#7189] The grouped exclusion is gone for a grid that groups on
  // the SERVER: it pages each group's rows there (see `renderServerGroupFooter`), so its
  // sort is the server's too. A grid grouping a page it fetched from a source
  // that cannot answer the header query still holds whole groups in memory.
  const useServerPagination = !hasInlineData && (!isGrouped || serverGroupedFetch);

  // Either we own the server fetch (useServerPagination) or a parent does
  // (externalManualPagination). This is the FLAT table's pager: a grouped grid
  // pages whole groups and each group's rows (`renderServerGroupFooter`) — so it
  // never switches this on. Both server modes feed DataTable a manual pager
  // backed by the real match total.
  const manualPaginationOn = (useServerPagination || externalManualPagination) && !isGrouped;

  // Server-side sorting, in either of the two server modes (objectui#3106).
  //
  // Tied to who owns the ROWS, not to who owns the pager: whenever `data` is
  // one window of a larger collection, sorting it in the browser orders that
  // window and nothing else. A server-grouped grid holds one PAGE of each
  // group, so its sort is the server's (objectui#7189); a grid grouping rows
  // it holds keeps DataTable's own client-side sort.
  const manualSortingOn = manualPaginationOn || (isGrouped && serverGroupedFetch);

  // Server-side search, on exactly the same condition (objectui#3118). Same
  // question, filter axis: when `data` is one window, a `.filter()` over it
  // narrows the fifty rows on screen while the rest of the collection never
  // participates — and unlike a mis-scoped sort, the count it produces reads as
  // a statement about the whole list. A flat grid over inline rows holds every
  // row it displays, so its box keeps filtering client-side, where it is
  // honest. A grouped grid draws no box (each group's table is
  // `searchable: false`); one that groups on the server sends its term — typed
  // while flat, or a host's `search` — on its group header query and on every
  // group's row query (objectui#11021), so its groups are the searched ones.
  const manualSearchOn = manualPaginationOn;

  /**
   * [#5729] The SERVED per-column sortability projection for this object —
   * objectstack#10235's ruling A, consumed rather than re-derived.
   *
   * `undefined` means the metadata response carried no `sortability` key at
   * all: a backend older than the upstream change, or an inline/mock data
   * source. That is NOT "nothing is sortable" — see the branch in
   * `withSortability` below, which is why this stays a nullable projection
   * instead of collapsing to an empty map at the read.
   */
  const platformSortability = readObjectSortability(objectSchema);

  /**
   * Withhold the sort affordance from a column the server cannot honestly order
   * by, when the sort is the server's (objectui#3096 + #3106, #3950).
   *
   * TWO reasons, one mechanism — a column is offered as a sort key only when
   * both hold:
   *
   *  - RELATIONAL (`lookup` / `master_detail` / `user` / `tree`): the column
   *    stores a foreign-key id and shows the related record's name. A server
   *    `$orderby` can only order by the stored id — objectstack#4256 settled
   *    that no relation join is coming — so the column of names would come back
   *    in an order with no relation to the names.
   *  - UNMATERIALIZED (`formula`): no driver materialises a column for it, so
   *    there is nothing to order by at all. That sort never worked; until
   *    objectstack#6994 the platform did not say so (a `200` whose rows carried
   *    the values they were asked to be ordered by, unordered), and now it
   *    answers `400 INVALID_SORT`. Both are the same defect on this side of the
   *    wire: a header offering a sort the platform cannot perform.
   *
   * The ListView toolbar's sort picker withholds both for exactly these
   * reasons; a clickable header would have been the same illusion through a
   * different control.
   *
   * Only under manual sorting. A client-side sort keys off the value the cell
   * renders (`getSortValue`, #3096) — the resolved label for a relational
   * column, the server-hydrated result for a formula one — which is honest, so
   * those headers stay.
   */
  const withSortability = (col: any) => {
    if (!manualSortingOn || col.sortable === false) return col;
    const fieldDef = (objectSchema as any)?.fields?.[col.accessorKey];
    // RELATIONAL — unchanged, and deliberately NOT delegated to the platform
    // signal. The projection answers `sortable: true` for a `lookup` (measured:
    // it has a stored column and both runtime doors accept an ORDER BY over
    // it), because the platform's question is whether it can order by the
    // STORED foreign key — which it can. Ours is whether that order means
    // anything next to a column of names, and it does not. Two different
    // questions; folding this one into the signal would hand every relational
    // header its sort click back.
    if (isExpandableFieldType(fieldDef)) return { ...col, sortable: false };
    // PLATFORM — the served projection is authoritative when it was served.
    // `isPlatformSortableField` is the contract: an entry must EXIST and say
    // `sortable: true`. Absence is a refusal (an unknown name, a dotted path,
    // an unprovisioned audit column), never a default of `true`.
    if (platformSortability) {
      return isPlatformSortableField(platformSortability, col.accessorKey)
        ? col
        : { ...col, sortable: false };
    }
    // NO SIGNAL SERVED — a deployment older than objectstack#10235, or an
    // inline/mock data source. Behaviour is exactly what it was before this
    // card, via the same `@objectstack/spec` set (`SEARCH_VIRTUAL_TYPES`) the
    // platform's own projection is computed from, so the two cannot disagree
    // about `formula`. This branch is a compatibility floor, not a second
    // judge: the moment a backend serves the signal it is unreachable, and it
    // is meant to be deleted when the supported floor passes that release.
    return isUnmaterializedFieldType(fieldDef) ? { ...col, sortable: false } : col;
  };

  /**
   * objectui#12480 — a rich-content cell keeps the grid's one-line row.
   *
   * `data-table` clamps a cell body to one line with `truncate` unless the
   * column is authored `wrap: true`. `truncate` (nowrap + overflow hidden +
   * ellipsis) bounds INLINE content only: it never bounds a body's height. The
   * three rich-content renderers (`markdown`, `html`, `richtext` — the
   * `RICH_TEXT_FIELD_TYPES` table in `@object-ui/fields`) draw a BLOCK document
   * (paragraphs, headings, lists), and blocks stack under nowrap, so one such
   * value grew its whole row to the document's height. Measured in Chromium at
   * 1280 x 900 on HotCRM's `crm_account` shape: one long `description` made its
   * row 456 px tall; the rows after it fell below the scroll box's fold while
   * the footer still counted them, which read as "fewer rows drawn, a gap
   * before the last one". Every other cell renderer stays within one line
   * (measured per type on the same harness; the readings are in the PR).
   *
   * So a rich-content column that is not `wrap: true` wraps its renderer's
   * output in a one-line clamp: the first line of the document shows, the rest
   * is cut. The renderer itself is unchanged (its sanitising pipeline stays the
   * trust boundary), and `wrap: true` keeps the whole document, as authored.
   */
  const withOneLineRichText = (col: any) => {
    if (col.wrap === true || typeof col.cell !== 'function') return col;
    const fieldDef = (objectSchema as any)?.fields?.[col.accessorKey];
    const { rendererType } = resolveGridCellRendering(fieldDef);
    if (!rendererType || !(RICH_TEXT_FIELD_TYPES as readonly string[]).includes(rendererType)) return col;
    const cell = col.cell;
    return {
      ...col,
      cell: (value: any, row: any) => (
        <div className="line-clamp-1" data-testid="grid-rich-text-one-line">
          {cell(value, row)}
        </div>
      ),
    };
  };

  const applyColumnChrome = (col: any) => withOneLineRichText(withSortability(applyDensity(col)));

  const orderedColumns = hasPinnedColumns
    ? [
        ...pinnedLeftCols.map(applyColumnChrome),
        ...unpinnedCols.map(applyColumnChrome),
        ...pinnedRightCols.map((col: any) => ({
          ...applyColumnChrome(col),
          className: ['px-3', col.className, rightPinnedClasses].filter(Boolean).join(' '),
          cellClassName: [rowHeightCellClass, col.cellClassName, rightPinnedCellClasses].filter(Boolean).join(' '),
        })),
      ]
    : columnsWithActions.map(applyColumnChrome);

  // Calculate frozenColumns: if the USER pinned columns, use their left-pinned
  // count; otherwise fall back to the schema default (freeze the first column).
  // The auto-pinned actions column is intentionally not counted here.
  const effectiveFrozenColumns = hasUserPinnedColumns
    ? userLeftPinnedCount
    : (schema.frozenColumns ?? 1);

  // Determine selection mode (support both new and legacy formats)
  // Auto-enable 'multiple' selection when bulk actions are defined OR when
  // a bulk-delete affordance is implicitly available (canDelete + onBulkDelete
  // wired by the consumer). This gives every list a multi-select + delete UX
  // out of the box without forcing each view JSON to declare bulkActions.
  // [objectstack#3720] Bulk delete is the most destructive affordance on the list, so it
  // rides the same object-level `delete` verdict as the row kebab (bucket lock
  // ∧ userActions ∧ the server's effective operation set). An author-declared
  // `bulkActions: ['delete']` / `bulkActionDefs[].operation === 'delete'` is a
  // WIRING declaration, not a permission grant — so the built-in delete is
  // filtered out of both when the verdict is off. Custom action ids and
  // `custom` operations are untouched: they route through the action runner
  // and carry their own gates. (An `update` operation is the edit verdict's —
  // see `bulkActionDefs` below.)
  const declaredBulkActions = schema.batchActions ?? schema.bulkActions;
  const explicitBulkActions = objectCanDelete
    ? declaredBulkActions
    : declaredBulkActions?.filter((a: unknown) => String(a).toLowerCase() !== 'delete');
  // `bulkActions` carries a bare action NAME, which the runner cannot execute
  // on its own — resolve each against `objectDef.actions` so it dispatches as a
  // real def. See `resolveBulkActions` (objectui#3002). The
  // canonical `'delete'` is held back: it routes to `onBulkDelete` (which owns
  // confirm + refresh), not the runner, even if the object declares an action
  // that happens to be named `delete`.
  const legacyBulkNames = (explicitBulkActions ?? []).filter(
    (a: unknown) => String(a).toLowerCase() !== 'delete',
  );
  const { defs: resolvedBulkDefs, unresolved: unresolvedBulkActions } = resolveBulkActions({
    bulkActions: legacyBulkNames,
    bulkActionDefs: Array.isArray(schema.bulkActionDefs) ? schema.bulkActionDefs : [],
    objectActions: (objectSchema as any)?.actions,
    localizeLabel: (actionName, fallback) =>
      resolveActionLabel(schema.objectName, actionName, fallback),
  });
  // [objectui#12082] …and a bulk FIELD UPDATE (`operation: 'update'`) is the
  // same object's edit verdict, the map's `rowEdit` row the row kebab's Edit
  // reads (`rowEditVerdict` above): a def that writes a patch to every selected
  // record must not outlive the caller's update grant, the effective operation
  // set or the object's policy any more than the bulk delete outlives its
  // delete verdict. A withheld def takes its dialog with it, and so the
  // executor's per-row update, its undo and its retry, which re-run that write.
  // `custom` defs are untouched, as above.
  const bulkActionDefs: BulkActionDef[] = resolvedBulkDefs.filter(
    (def: BulkActionDef) =>
      (objectCanDelete || def?.operation !== 'delete')
      && (rowEditVerdict.allowed || def?.operation !== 'update'),
  );
  // Names still dispatched by string: the unresolved ones, plus `'delete'`
  // when the author asked for it — or the implicit bulk-delete affordance.
  const keptDeleteAction = (explicitBulkActions ?? []).filter(
    (a: unknown) => String(a).toLowerCase() === 'delete',
  );
  const effectiveBulkActions: string[] =
    explicitBulkActions && explicitBulkActions.length > 0
      ? [...unresolvedBulkActions, ...keptDeleteAction]
      : canDelete && onBulkDelete && bulkActionDefs.length === 0
        ? ['delete']
        : [];
  const hasBulkActions = effectiveBulkActions.length > 0 || bulkActionDefs.length > 0;
  let selectionMode: 'none' | 'single' | 'multiple' | boolean = false;
  if (schema.selection !== undefined) {
    // "presence enables; an explicit off wins" — the ONE rule both
    // object-armed keys on this block obey (objectui#9837, ruling A-prime, batch
    // #162 item 2), `paginationEnabled` below being the other half.
    //
    // Writing the object is how an author asks for selection; `type: 'none'`
    // is this key's own explicit off and beats the presence. Before the ruling
    // the read was `schema.selection?.type`, so an object with no `type` fell
    // through to the legacy arms and the object itself meant NOTHING — the
    // exact opposite of what the neighbouring `pagination` key taught, with no
    // error and no diagnostic either way.
    const authoredType = schema.selection?.type;
    selectionMode =
      authoredType === 'none' ? false : (authoredType ?? DEFAULT_SELECTION_TYPE);
  } else if (schema.selectable !== undefined) {
    // Legacy support — read only when `selection` is absent.
    selectionMode = schema.selectable;
  } else if (hasBulkActions) {
    // Auto-enable multi-select when bulk actions exist
    selectionMode = 'multiple';
  }
  // `selection.type: 'single'` caps the selection at one row (the data-table
  // enforces replace-on-select, #2941), so the cross-page "select all N
  // matching" escalation must never be offered.
  const singleSelection = selectionMode === 'single';

  // The floor. With no query to replay there is no honest "all N matching", so
  // the escalation is not offered — the same answer as a match set that does not
  // exist. This is what makes an unfiltered fan-out structurally unreachable
  // rather than merely currently-wired-right: a host that forgets `findParams`
  // loses the affordance, it does not silently get the whole object.
  //
  // ONE condition, consumed by both `BulkActionBar` sites below. Do NOT re-spell
  // it at a consumption site — a second copy is how one of them gets missed
  // (objectui#4138, #4464).
  const canOfferSelectAllMatching = !singleSelection && bulkFanoutParams !== null;

  // Resolve the rows the bulk action should actually operate on. When
  // "select all N matching" is active, fan out a paged find against the
  // current query so we can hand a complete record list to the executor.
  // (Plain function — placed late in the component body where prior renders
  // sometimes short-circuit before reaching it; using useCallback here would
  // tripwire the rules-of-hooks balance.)
  const resolveBulkRows = async (rowsHint: any[]): Promise<any[]> => {
    if (!selectAllMatching) return rowsHint;
    const objectName = schema.objectName;
    if (!dataSource || !objectName) return rowsHint;
    // The floor again, at the point of consumption: the affordance gate above
    // means an escalation cannot be reached without params, and this means it
    // cannot be ACTED on without them either. Same single source, so the two
    // cannot drift.
    if (!bulkFanoutParams) return rowsHint;
    const base = { ...bulkFanoutParams } as Record<string, unknown>;
    delete (base as any).$top;
    delete (base as any).$skip;
    const HARD_CAP = 5000;
    const PAGE = 500;
    const collected: any[] = [];
    let skip = 0;
    while (collected.length < HARD_CAP) {
      const page = await dataSource.find(objectName, { ...base, $top: PAGE, $skip: skip });
      const items = page.data ?? [];
      if (items.length === 0) break;
      collected.push(...items);
      if (items.length < PAGE) break;
      skip += PAGE;
    }
    return collected.slice(0, HARD_CAP);
  };

  // Bulk action dispatcher — for the implicit 'delete' action, route through
  // the consumer-provided onBulkDelete (which already knows about confirm +
  // refresh). Other actions fall through to the generic action runner.
  //
  // [#3056] Every path that clears the selection must clear BOTH selection
  // sources. `selectedRows` is ours and drives the toolbar; the row checkboxes
  // live inside the data-table and only clear when `selectionResetKey` moves.
  // Bumping one without the other strands the user on a page of ticked rows
  // with no toolbar to act on them — the exact drift `handleBulkDialogClose`
  // below already guards.
  //
  // [#4140] So this is the ONE reset — dispatch, delete, dialog-close AND the
  // bulk bar's own `onClearSelection`. Both `BulkActionBar` sites previously
  // hand-wrote `setSelectedRows([]); setSelectAllMatching(false);`, which is
  // this function minus the key bump: Clear emptied the toolbar and left every
  // checkbox ticked. Never re-implement the reset inline — call this.
  const resetSelection = () => {
    setSelectedRows([]);
    setSelectAllMatching(false);
    setSelectionResetKey(k => k + 1);
  };

  /**
   * [objectui#4420] The built-in Delete, as a def — so the ONE selection whose
   * records the predicate split can be reported on the surface built to report
   * it. Constructed only when the dialog route is taken (see below), never
   * rendered in the bar: the bar's Delete stays the legacy string button it has
   * always been, because the ruling is explicit that the predicate must not
   * change whether the button is offered.
   */
  const builtInDeleteDef = (): BulkActionDef => ({
    name: 'delete',
    label: resolveActionLabel(schema.objectName, 'delete', formatActionLabel('delete')),
    operation: 'delete',
    variant: 'danger',
  });

  const dispatchBulkAction = (action: string, rows: any[]) => {
    void (async () => {
      const expanded = await resolveBulkRows(rows);
      if (action === 'delete' && onBulkDelete) {
        // [objectui#4420] `userActions.delete.visibleWhen` gates the built-in
        // Delete PER RECORD — the same key, the same fail-closed fold and the
        // same evaluator the row kebab and the rich-def bar already run
        // (`partitionRowsByPredicate`). Applied to the EXPANDED set for the
        // reason #3067 states one line down in `dispatchBulkActionDef`: "select
        // all N matching" pulls in records no on-screen check ever evaluated.
        //
        // The fold directly, NOT `partitionBulkRows` (objectui#11322). That door
        // belongs to bulk ACTIONS and asks the action family's "is a gate
        // declared?" first, which reads a blank `visible` as no gate. This key
        // is a field-rule key: a blank one keeps the fold's own answer and
        // excludes every record, as plugin-list's `ListView` does with the
        // same key.
        //
        // The predicates come from `objectDeletePredicates`, not
        // `deletePredicates`: the latter rides `canDelete`, which folds in the
        // ROW wiring (`onDelete`), and bulk delete rides `onBulkDelete`. A
        // consumer wiring only the bulk handler would otherwise have the
        // author's predicate silently dropped.
        const { eligible, skipped } = partitionRowsByPredicate(
          objectDeletePredicates?.visibleWhen as never,
          expanded,
          { scope: predicateScope, fields: objectSchema?.fields, label: 'delete' },
        );
        if (skipped === 0) {
          // Nothing was excluded, so there is nothing to report and no reason
          // to change surfaces: the consumer's own delete flow — which owns the
          // confirmation, the toast and the refresh — runs exactly as before.
          // This is also what keeps every object that declares no predicate at
          // all byte-identical to its previous behaviour.
          onBulkDelete(eligible);
          resetSelection();
          return;
        }
        // Something WAS excluded. The run must own up to it, and
        // `BulkActionDialog`'s `bulk-skipped-notice` is the slot built for this
        // shape (objectui#3067) — so the delete is confirmed and executed
        // there, over `eligible` only. Routing it back through `onBulkDelete`
        // instead would put the host's own confirmation dialog behind this
        // one and confirm the same delete twice.
        //
        // `eligible` may be EMPTY, and that case deliberately still opens the
        // dialog: the maintainer ruled a selection where every row is excluded
        // must produce "a legible refusal, not a hidden button whose absence is
        // unexplained". The dialog reports zero affected records beside the
        // skipped notice, and declines to run (see `noEligibleRows` there).
        setActiveBulkDef(builtInDeleteDef());
        setActiveBulkRows(eligible);
        setActiveBulkSkipped(skipped);
        return;
      }
      // A string bulk action (e.g. a consumer-registered runner handler)
      // mutated the selected records, usually through a custom API that never
      // touches dataSource.update — so nothing else signals the grid to
      // refetch. On success, reset the selection and refresh so the list
      // reflects the server state (mirrors the delete branch and
      // handleBulkDialogClose).
      const res = await executeAction({ type: action, params: { records: expanded } });
      if (res?.success) {
        resetSelection();
        setRefreshKey(k => k + 1);
      }
    })();
  };

  // [objectui#12105] A PROMOTED def's params are its action's, resolved here —
  // when the dialog opens — through the one resolver the record page uses
  // (`resolveActionParam`, `@object-ui/fields`), so a field-backed param
  // (`{ field, objectOverride }`) inherits its type, label, options and picker
  // target instead of drawing a raw text box. The order is the record dialog's:
  // ask the session for its object metadata first, so an `objectOverride`
  // target that has not loaded yet is a wait rather than a refusal; then union
  // this grid's own schema with the session's objects, the grid's FIRST (it is
  // the world this grid renders). An authored def comes back unchanged.
  const resolveDialogParams = async (def: BulkActionDef): Promise<BulkActionDef> => {
    if (!def.actionDef) return def;
    await metadata.ensureType('object').catch(() => []);
    return resolvePromotedBulkParams(def, {
      objectName: objectName ?? '',
      objects: withKnownObjects(objectSchema ? [objectSchema] : undefined, metadata.objects),
      fieldLabel: resolveFieldLabel,
      fieldOptionLabel: resolveFieldOptionLabel,
      locale: uiLanguage,
    });
  };

  // Rich BulkActionDef dispatcher — opens the BulkActionDialog (params →
  // confirm → progress → result). When the user closes the dialog after a
  // run, refresh data so the grid reflects mutations.
  const dispatchBulkActionDef = (def: BulkActionDef, rows: any[]) => {
    void (async () => {
      const expanded = await resolveBulkRows(rows);
      // [#3067] Re-apply `visible` to the EXPANDED set, not just the page
      // selection the bar could see: "select all N matching" pulls in records
      // the button's own eligibility check never evaluated, and running the
      // action on those would defeat the gate the author wrote.
      const { eligible, skipped } = partitionBulkRows(def, expanded, {
        scope: predicateScope,
        fields: objectSchema?.fields,
      });
      setActiveBulkDef(await resolveDialogParams(def));
      setActiveBulkRows(eligible);
      setActiveBulkSkipped(skipped);
    })();
  };

  // Per-record executor for a PROMOTED bulk action (objectui#3002) — one
  // declared object action applied to each selected record through the action
  // runner. The dialog already collected params and took the confirmation, so
  // this dispatch strips both from the def: leaving them on would make the
  // runner re-prompt once per record. Toasts are muted for the same reason —
  // the dialog's progress/result panel is the single report for the whole run.
  // (Plain function for the same reason as `resolveBulkRows` above: this point
  // in the body is past render paths that short-circuit, so a hook here would
  // tripwire the rules-of-hooks balance.)
  // Shared def-key strip for BOTH bulk dispatchers below. The dialog already
  // collected params and took the confirmation, so the dispatch must remove
  // them from the source action — leaving them on would make the runner
  // re-prompt (once per record on the per-record path). Kept in one place so
  // the two dispatchers cannot drift on what gets stripped.
  const stripCollectedActionKeys = (source: Record<string, any>) => {
    const {
      params: _declaredParams,
      actionParams: _actionParams,
      confirmText: _confirmText,
      confirm: _confirm,
      ...rest
    } = source;
    return rest;
  };

  const runBulkActionRecord = async (
    def: BulkActionDef,
    row: Record<string, unknown>,
    params: Record<string, unknown>,
  ): Promise<void> => {
    const source = def.actionDef as Record<string, any> | undefined;
    if (!source) return;
    const {
      // A one-shot reveal (2FA code, fresh OAuth secret) is a single-record
      // affordance by construction, and the runner AWAITS acknowledgement —
      // one modal per record would stall the run behind N dialogs.
      resultDialog: _resultDialog,
      ...rest
    } = stripCollectedActionKeys(source);
    const res = await executeAction({
      ...rest,
      // `_rowRecord` is the same row-context key the list_item path attaches,
      // so `recordIdParam` / `recordIdField` injection behaves identically.
      params: { ...params, _rowRecord: row },
      toast: { showOnSuccess: false, showOnError: false },
    } as any);
    // Reject so the executor records this row under its own id in the result
    // (and the error CSV) instead of counting a failed action as succeeded.
    if (!res?.success) {
      throw new Error(res?.error || `Action ${def.name} failed`);
    }
  };

  // Whole-selection dispatcher for a def that opted into
  // `execution: 'aggregate'` (objectui#3139): ONE runner dispatch carrying
  // every selected id as `params._selectedIds`, so the target endpoint can
  // produce a single aggregate artifact (zip of QR codes, merged PDF…).
  // Unlike the per-record path, `resultDialog` is NOT stripped — the
  // per-record rationale (one modal per record stalls the run) does not
  // apply to a single call, and a one-shot reveal of the aggregate result
  // (download URL, generated codes) is exactly this mode's use case.
  const runBulkActionAggregate = async (
    def: BulkActionDef,
    rows: Array<Record<string, unknown>>,
    params: Record<string, unknown>,
  ): Promise<void> => {
    const source = def.actionDef as Record<string, any> | undefined;
    if (!source) return;
    const rest = stripCollectedActionKeys(source);
    const ids = rows.map((r) => (r.id != null ? String(r.id) : '')).filter(Boolean);
    // Publish the EXPANDED, eligibility-filtered rows the run actually covers
    // — the standing selection effect only carries the current page's ticks,
    // while "select all N matching" and the `visible` partition can both
    // change the real set. Handlers and `${ctx.selection.*}` interpolation
    // read this. The next selection change re-publishes, so no cleanup here.
    updateActionContext({ selectedRecords: rows });
    const res = await executeAction({
      ...rest,
      params: { ...params, _selectedIds: ids },
      toast: { showOnSuccess: false, showOnError: false },
    } as any);
    if (!res?.success) {
      throw new Error(res?.error || `Action ${def.name} failed`);
    }
  };
  const handleBulkDialogClose = (result?: BulkResult | null) => {
    setActiveBulkDef(null);
    setActiveBulkRows([]);
    setActiveBulkSkipped(0);
    // Only reset selection when the run actually changed something. A total
    // failure (0 succeeded — e.g. a "推计划" precondition error) leaves the data
    // untouched, so we keep the selection *and* the toolbar so the user can fix
    // it and retry the same rows.
    if (result && result.succeeded > 0) {
      resetSelection();
      // Trigger refresh via the same path used by single-record mutations.
      setRefreshKey(k => k + 1);
    }
  };

  // Default inline-edit persistence.
  //
  // When a consumer wires `onRowSave`/`onBatchSave` (React host), we defer to it.
  // But a declaratively-configured `editable: true` view has no host wiring — so
  // "Save All" would otherwise just clear pending changes without writing to the
  // backend. Supply a default that persists through the grid's `dataSource`, then
  // refresh so the grid reflects persisted values. Reporting failure is
  // important: DataTable's saveRow keeps a row's pending changes when the save
  // promise rejects, and saveBatch keeps exactly the rows the batch hands back
  // as `failed`, so a failed write doesn't silently lose the user's edits.
  // The one place a row's primary key is read for a write. `string`, as
  // `@objectstack/spec` declares every record door — the union this used to
  // annotate was a claim about `any`-typed row data, not a measurement of it
  // (objectui#9333).
  const resolveRecordId = (row: any): string | undefined =>
    row?._id ?? row?.id;

  // ── Optimistic concurrency on the default saves (objectui#12292) ──────────
  //
  // Every save below sends the row's token as `If-Match` (`rowVersionOf`,
  // `rowVersionToSend`), so a write made from a stale row is refused `409`
  // instead of landing over a concurrent one with a 200. A `409` goes to the
  // record surfaces' own conflict dialog, `ConcurrentUpdateDialog` from
  // `@object-ui/plugin-detail`, the one `InlineEditSaveBar` opens. There is no
  // grid-only dialog, and nothing is retried without the user's choice.

  /**
   * Open the conflict dialog and wait for the user's choice. A save still
   * waiting on an earlier dialog is settled as Cancel first, so no save is
   * left waiting on a dialog that is no longer shown.
   */
  const askRowConflict = (conflict: ConcurrentUpdateConflict): Promise<RowConflictChoice> =>
    new Promise<RowConflictChoice>((resolve) => {
      rowConflictDecisionRef.current?.('cancel');
      rowConflictDecisionRef.current = resolve;
      setRowConflict(conflict);
    });
  const settleRowConflict = (choice: RowConflictChoice) => {
    const resolve = rowConflictDecisionRef.current;
    rowConflictDecisionRef.current = null;
    setRowConflict(null);
    resolve?.(choice);
  };

  /** The header the user reads over a column, for naming the field in the dialog. */
  const columnHeaderOf = (field: string): string | undefined => {
    const column = (orderedColumns as Array<{ accessorKey?: unknown; header?: unknown }>)
      .find((c) => c?.accessorKey === field);
    return typeof column?.header === 'string' && column.header.length > 0 ? column.header : undefined;
  };

  /**
   * The dialog's payload for one row's 409, in the shape `InlineEditSaveBar`
   * builds for a record's draft: one edited field shows its own before and
   * after, several show the record-level summary.
   */
  const buildRowConflict = (
    changes: Record<string, any>,
    err: { currentVersion?: string; currentRecord?: Record<string, unknown> | null },
  ): ConcurrentUpdateConflict => {
    const keys = Object.keys(changes);
    const current = err.currentRecord ?? null;
    if (keys.length === 1) {
      const field = keys[0];
      return {
        field,
        label: columnHeaderOf(field),
        pendingValue: changes[field],
        currentValue: current ? current[field] : undefined,
        currentVersion: err.currentVersion,
        currentRecord: current,
      };
    }
    return {
      field: keys.join(', '),
      label: tDetail('detail.concurrentUpdateRecordLabel', { defaultValue: 'this record' }),
      pendingValue: changes,
      currentValue: current ? Object.fromEntries(keys.map((k) => [k, current[k]])) : undefined,
      currentVersion: err.currentVersion,
      currentRecord: current,
    };
  };

  /**
   * Remember what a landed write answered with, for the next save of the same
   * record. A result with no token clears the entry, so that save falls back
   * to the row's own token rather than to an older write's.
   */
  const rememberRowWrite = (id: string, readVersion: string | undefined, result: unknown) => {
    const version = rowVersionOf(result);
    if (readVersion && version) writtenVersionsRef.current.set(id, { readVersion, version });
    else writtenVersionsRef.current.delete(id);
  };

  /** One row's guarded write. Rejects with whatever the data source threw. */
  const writeRowGuarded = async (
    ds: DataSource,
    resource: string,
    id: string,
    changes: Record<string, any>,
    row: any,
  ): Promise<void> => {
    const readVersion = rowVersionOf(row);
    const ifMatch = rowVersionToSend(writtenVersionsRef.current.get(id), readVersion);
    const result = await ds.update(resource, id, changes, ifMatch ? { ifMatch } : undefined);
    rememberRowWrite(id, readVersion, result);
  };

  /**
   * After a row's 409, the user's choice on the dialog:
   *  - Overwrite: the same changes, re-keyed to the version the 409 reported
   *    ("I have seen the newer record, apply mine on top"). Resolves `saved`.
   *  - Reload latest: the edit is dropped and the record is declared changed on
   *    the data-invalidation bus, so whoever holds the rows reads them again.
   *    Resolves `reloaded`; nothing was written.
   *  - Cancel: rejects with the 409, so the table keeps the edit and flags the
   *    row as not saved.
   */
  const resolveRowConflict = async (
    ds: DataSource,
    resource: string,
    id: string,
    changes: Record<string, any>,
    row: any,
    err: { currentVersion?: string; currentRecord?: Record<string, unknown> | null },
  ): Promise<'saved' | 'reloaded'> => {
    const choice = await askRowConflict(buildRowConflict(changes, err));
    if (choice === 'cancel') throw err;
    if (choice === 'reload') {
      notifyDataChanged({ objectName: resource, recordId: String(id) });
      return 'reloaded';
    }
    const currentVersion = typeof err.currentVersion === 'string' && err.currentVersion.length > 0
      ? err.currentVersion
      : undefined;
    const result = await ds.update(
      resource, id, changes, currentVersion ? { ifMatch: currentVersion } : undefined,
    );
    rememberRowWrite(id, rowVersionOf(row), result);
    return 'saved';
  };

  const defaultRowSave = async (
    _rowIndex: number,
    changes: Record<string, any>,
    row: any,
  ): Promise<void> => {
    if (!dataSource || !objectName) {
      throw new Error('Cannot persist inline edit: no dataSource/objectName configured on the grid.');
    }
    const id = resolveRecordId(row);
    if (id === undefined || id === null) {
      throw new Error('Cannot persist inline edit: row has no id/_id.');
    }
    try {
      await writeRowGuarded(dataSource, objectName, id, changes, row);
    } catch (err) {
      if (!isConcurrentUpdateError(err)) throw err;
      // A reload re-reads through the bus; there is nothing of ours to show.
      if ((await resolveRowConflict(dataSource, objectName, id, changes, row, err)) === 'reloaded') return;
    }
    // Refresh so the grid shows the persisted values.
    setRefreshKey(k => k + 1);
    // objectui#12303 — the write is said, through the console's shared toast
    // (the one the form, kanban and view surfaces raise). Only here, once the
    // row landed: a refusal rejects above, and the table flags the row.
    toast.success(t('table.saved', { count: 1 }));
  };

  const defaultBatchSave = async (
    changes: Array<{ rowIndex: number; changes: Record<string, any>; row: any }>,
  ): Promise<BatchSaveOutcome | undefined> => {
    if (!dataSource || !objectName) {
      throw new Error('Cannot persist inline edits: no dataSource/objectName configured on the grid.');
    }
    // Update each modified row. The DataSource `bulk`/`bulkUpdate` primitives
    // apply a single uniform patch across many ids, which does NOT fit per-row
    // edits (each row has its own field changes), so issue one update per row.
    //
    // Each row is its own write and its own outcome (objectui#12292). All are
    // attempted together and every one is waited for, so a refused row never
    // hides what happened to the others; a conflict is then put to the user
    // one row at a time. Nothing the server accepted is taken back: the rows
    // that landed are reported as saved, and only the rows that did not are
    // handed back to the table as `failed`.
    const ids = changes.map(({ row }) => resolveRecordId(row));
    const attempts = await Promise.allSettled(
      changes.map(({ changes: rowChanges, row }, i) => {
        const id = ids[i];
        if (id === undefined || id === null) {
          return Promise.reject(new Error('Cannot persist inline edit: row has no id/_id.'));
        }
        return writeRowGuarded(dataSource, objectName, id, rowChanges, row);
      }),
    );
    const failed: BatchSaveOutcome['failed'] = [];
    // How many rows the server accepted — the number the toast below names.
    let saved = 0;
    for (let i = 0; i < changes.length; i++) {
      const attempt = attempts[i];
      if (attempt.status === 'fulfilled') {
        saved += 1;
        continue;
      }
      const { rowIndex, changes: rowChanges, row } = changes[i];
      const id = ids[i];
      const err: unknown = attempt.reason;
      if (!isConcurrentUpdateError(err) || id === undefined || id === null) {
        failed.push({ rowIndex, error: err });
        continue;
      }
      try {
        if ((await resolveRowConflict(dataSource, objectName, id, rowChanges, row, err)) === 'saved') {
          saved += 1;
        }
      } catch (resolutionError) {
        failed.push({ rowIndex, error: resolutionError });
      }
    }
    if (saved > 0) {
      // Refresh so the grid shows the persisted values.
      setRefreshKey(k => k + 1);
      // objectui#12303 — "Save All" says what it saved, through the console's
      // shared toast, counting only the rows the server accepted. A row that
      // failed is not in the count: the table keeps it, flags it and shows
      // the reason. A reloaded row wrote nothing, so it is not either.
      toast.success(t('table.saved', { count: saved }));
    }
    return failed.length > 0 ? { failed } : undefined;
  };

  // Determine pagination settings (support both new and legacy formats)
  //
  // "presence enables; an explicit off wins" — the same ONE rule
  // `selectionMode` above obeys (objectui#9837, ruling A-prime, batch #162 item 2).
  //
  // The order of the two arms is the whole ruling. `pagination` declares no off
  // switch of its own (its members are `pageSize` / `pageSizeOptions`), so the
  // deprecated flat `showPagination: false` is the ONLY way an author can turn
  // paging off — and it therefore has to be read BEFORE the object's presence.
  // Before the ruling the presence check ran first and hard-forced `true`,
  // which made `showPagination: false` unreachable the moment the object was
  // written: a block that cannot turn off the thing it names (objectui#9819).
  const paginationEnabled =
    schema.showPagination === false
      ? false // explicit off wins, whatever `pagination` says
      : schema.pagination !== undefined
        ? true // the object's presence asks for paging with its settings
        : (schema.showPagination ?? true); // neither written: today's default
  
  // Through the same resolver as the two seeds above (objectui#9853). This
  // site used `||` and the seeds used `??`, so one authored `pageSize: 0`
  // reached three read points and got two different answers.
  const pageSize = resolvePageSize(schema, DEFAULT_DISPLAY_PAGE_SIZE);

  // Determine search settings
  const searchEnabled = schema.searchableFields !== undefined
    ? schema.searchableFields.length > 0
    : (schema.showSearch !== undefined ? schema.showSearch : true);

  const manualPage = externalManualPagination ? hostPage : serverPage;
  const manualPageSize = externalManualPagination
    ? (hostPageSize ?? serverPageSize)
    : serverPageSize;
  const manualOnPageChange = externalManualPagination
    ? hostOnPageChange
    : setServerPage;
  const manualOnPageSizeChange = externalManualPagination
    ? hostOnPageSizeChange
    : (size: number) => { setServerPageSize(size); setServerPage(1); };

  // Before anyone clicks, the headers show the sort the view was authored with
  // — read from the same `schemaSort` the fetch path above lowers, so the
  // arrow on screen and the `$orderby` on the wire are the same sort. (The
  // retired `defaultSort` fallback is read by neither, objectui#5861.)
  // Without that a view arriving `created_at desc` would show no arrow, and
  // the first click on that column would ask for `asc` on a list that was
  // already `desc`.
  //
  // ⭐ That agreement now covers the SPELLING too (objectui#8961). One used to
  // escape it: since objectui#8767 the fetch path REFUSES a string `sort` and
  // sends no `$orderby`, while {@link parseSchemaSort} went on parsing one, so
  // a grid authored `sort: 'name desc'` painted a descending arrow over rows
  // the server returned in no declared order. That reader now admits only the
  // declared `[{ field, order }]` array — the one spelling the fetch path
  // still lowers — so the arrow on screen and the `$orderby` on the wire read
  // the same key the same way, and a retired spelling lights nothing on either
  // side. What did NOT move is the wire shape: the array arm still lowers to
  // this block's own `"field order"` join string, and the shared sink's
  // `{field: direction}` map stays declined (see {@link toOrderByClause}).
  //
  // A plain expression, not a `useMemo`: this sits below the component's early
  // returns, where a hook would be skipped on some renders and change the hook
  // order. Parsing at most a handful of sort keys costs nothing worth a hook.
  const declaredSort = parseSchemaSort(schemaSort);
  /**
   * [#5729] The RESTORE leg of objectstack#10235's contract, and the guard
   * that keeps the personalization PUT off an unsortable column.
   *
   * Withholding the header click (see `withSortability`) stops a NEW sort on
   * such a column from ever being created — `DataTable` emits `onSortChange`
   * only out of `handleSort`, which is itself gated on `col.sortable !== false`
   * — but it says nothing about a sort that is ALREADY in stored view state,
   * persisted before the signal existed. Replayed, that entry would put a
   * refused `$orderby` on the wire, paint an active-sort arrow on a header
   * that offers no click, and ride along into the next sort the host stores
   * for an unrelated reason — the exact half-fix where the affordance is gone
   * and the write still fires.
   *
   * So both directions run through the same filter: what the grid RENDERS the
   * sort state as, and what it EMITS back to whoever persists it. A stale
   * entry is inert on arrival and is dropped the first time anything writes
   * the sort back. Only under a served projection — with no signal there is no
   * verdict to filter by, and the pre-objectstack-ai/objectstack#10235 behaviour stands unchanged.
   */
  const rawManualSort: TableSortItem[] = externalManualPagination
    ? (hostSort ?? [])
    : (headerSort ?? declaredSort);
  const manualSort: TableSortItem[] = platformSortability
    ? filterPlatformSortableSort(rawManualSort, platformSortability)
    : rawManualSort;
  const rawManualOnSortChange = externalManualPagination
    ? hostOnSortChange
    : setHeaderSort;
  // Wrap only when there is BOTH a projection to judge by and a handler to
  // wrap. Manufacturing a function where the host offered none would flip
  // `DataTable`'s `sortingEnabled` (`!manualSorting || !!onSortChange`) from
  // false to true and hand sort clicks to a host that never asked for them.
  const manualOnSortChange = platformSortability && rawManualOnSortChange
    ? (next: TableSortItem[]) => rawManualOnSortChange(
        filterPlatformSortableSort(next, platformSortability),
      )
    : rawManualOnSortChange;

  // The search term, in whichever server mode applies. When a parent owns the
  // rows it owns the term too (ListView already does, from its own toolbar —
  // which is why it passes `showSearch: false` and no box is rendered here),
  // and so does a parent that hands down `search` (`hostOwnsSearch`); else the
  // box writes `searchTerm`. Either way the effect above turns the term into
  // `$search` when this grid fetches. A parent that owns the term but offers
  // no `onSearchChange` gets NO box rather than one that cannot change it.
  const manualSearch = querySearchTerm;
  const manualOnSearchChange = hostOwnsSearch
    ? hostOnSearchChange
    : setSearchTerm;

  // objectui#13330 — the host's node beside each row's title (`rowAdornment`):
  // in the declared name field's column when one is shown, else the first
  // shown column. After the cell's own content, never in place of it.
  const tableColumns = (() => {
    if (!rowAdornment) return orderedColumns;
    const declaredTitle = declaredNameField(objectSchema);
    const shown = (orderedColumns as any[]).filter((c) => c?.accessorKey !== '_actions');
    const titleColumn =
      (typeof declaredTitle === 'string' && declaredTitle !== ''
        ? shown.find((c) => c.accessorKey === declaredTitle)
        : undefined) ?? shown[0];
    if (!titleColumn) return orderedColumns;
    const cell = titleColumn.cell;
    const adorned = {
      ...titleColumn,
      cell: (value: any, row: any) => {
        const own = typeof cell === 'function' ? cell(value, row) : String(coerceToSafeValue(value) ?? '');
        const extra = rowAdornment(row);
        if (extra === null || extra === undefined || extra === false) return own;
        return (
          <span className="flex min-w-0 items-center gap-1.5" data-testid="grid-row-adornment">
            <span className="min-w-0 truncate">{own}</span>
            {extra}
          </span>
        );
      },
    };
    return (orderedColumns as any[]).map((c) => (c === titleColumn ? adorned : c));
  })();

  const dataTableSchema: ObjectGridDataTableSchema = {
    type: 'data-table',
    // The deprecated `title` fallback resolves like `label` (objectui#10993):
    // handed on raw, a locale map reached the data-table caption as an object
    // and the whole block failed to render.
    caption: resolveInlineI18nLabel(schema.label, displayLocale)
      || resolveInlineI18nLabel(schema.title, displayLocale),
    columns: tableColumns,
    data,
    pagination: paginationEnabled,
    pageSize: manualPaginationOn ? manualPageSize : pageSize,
    // Rows-per-page selector options sourced from view metadata
    // (schema.pagination.pageSizeOptions). When absent the DataTable falls back
    // to its built-in list. This is what makes the single, server-driven pager
    // expose the configured 50/100/200/500 choices instead of a second control.
    pageSizeOptions: schema.pagination?.pageSizeOptions,
    // In server mode `data` IS the current page; tell DataTable to render it
    // as-is and drive paging via the callbacks below using the real match total.
    manualPagination: manualPaginationOn,
    rowCount: manualPaginationOn ? resolvedTotalMatching : undefined,
    page: manualPaginationOn ? manualPage : undefined,
    onPageChange: manualPaginationOn ? manualOnPageChange : undefined,
    onPageSizeChange: manualPaginationOn ? manualOnPageSizeChange : undefined,
    manualSorting: manualSortingOn,
    sort: manualSortingOn ? manualSort : undefined,
    onSortChange: manualSortingOn ? manualOnSortChange : undefined,
    searchable: searchEnabled,
    manualSearch: manualSearchOn,
    search: manualSearchOn ? manualSearch : undefined,
    onSearchChange: manualSearchOn ? manualOnSearchChange : undefined,
    selectable: selectionMode,
    // ObjectGrid surfaces the selection via its own bottom BulkActionBar
    // (count + Clear + bulk actions). Suppress the data-table's built-in
    // "N selected" toolbar so it doesn't render a duplicate, orphaned row
    // above the table when search/export are handled by the outer toolbar.
    showSelectionCount: false,
    sortable: true,
    exportable: operations?.export,
    // Flat list view: drop the rounded outer frame so the table sits flush
    // beneath the toolbar's `border-b`. Matches the Airtable-style grouped
    // mode introduced for `buildGroupedTableSchema`. Metadata can re-enable
    // the frame by setting `borderless: false` on the schema.
    borderless: true,
    // RowActionMenu column (from columnsWithActions) already handles edit/delete
    // actions via onEdit/onDelete props. Only enable DataTable's built-in action
    // column for inline-editing save/cancel (editable grids with onRowSave).
    //
    // [#5143] …which is exactly why it follows `inlineEditable` and not the raw
    // schema key. This column's ONLY populated state is the save/cancel pair,
    // shown when a row has pending changes: ObjectGrid never passes DataTable
    // the `onRowEdit`/`onRowDelete`/`rowActionDefs` its built-in menu needs
    // (they go to `columnsWithActions` instead), so `DataTableRowActionsMenu`
    // renders `null` here on every row. Gate the editing but not this column and
    // a read-only principal gets a permanently empty trailing column plus its
    // header — a grid shape that has never existed, since a schema WITHOUT
    // `editable` produces no such column today. Following the same verdict is
    // what makes the gated grid identical to the non-editable one.
    rowActions: !!(inlineEditable && hasActions),
    // `resizable` alone (objectui#6152 round 7): the legacy `resizableColumns`
    // spelling is retired on both faces and by `@objectstack/spec` 17.7.0, so
    // it is no longer read here. (`resizableColumns` on the left is DataTable's
    // own prop, a different block's key.)
    resizableColumns: schema.resizable ?? true,
    reorderableColumns: schema.reorderableColumns ?? false,
    // [#5143] The authored key ∧ this principal's write verdict on the object.
    editable: inlineEditable,
    // In-place cell editor: render the dedicated @object-ui/fields widget for
    // the field's type — the SAME control the form uses (select→dropdown,
    // boolean→checkbox, date→date picker, multi-select, …). Returning null lets
    // DataTable fall back to its built-in text/number/date inputs. Discrete
    // pickers commit-and-close on choose; everything else stages and closes when
    // the user moves on.
    // [#5143] Same verdict as `editable` above: withholding the mode but still
    // handing DataTable an editor factory would leave the built-in fallback
    // editors as the only reachable ones if any future path re-opened the mode.
    renderCellEditor: inlineEditable
      ? (ctx: { column: any; row: any; pendingRow: any; value: any; stage: (v: any) => void; commit: (v?: any) => void }) => {
          const fieldDef = (objectSchema as any)?.fields?.[ctx.column?.accessorKey];
          if (!fieldDef || !hasFieldEditWidget(fieldDef.type)) return null;
          const discrete = DISCRETE_EDIT_TYPES.has(fieldDef.type);
          let field: any = { name: ctx.column.accessorKey, ...fieldDef };
          // State-machine-aware: a field bound to a `state_machine` validation
          // only offers transitions valid from the current value, so the editor
          // can't stage an edit the server would reject (e.g. done → in_review).
          const reachable = stateMachineNextValues(objectSchema, ctx.column.accessorKey, ctx.value);
          if (reachable && Array.isArray(field.options)) {
            field = {
              ...field,
              options: field.options.filter((o: any) => reachable.has(String(o?.value ?? o))),
            };
          }
          return (
            <FieldEditWidget
              field={field}
              value={ctx.value}
              onChange={(v: any) => (discrete ? ctx.commit(v) : ctx.stage(v))}
              // The record a dependent widget scopes itself by (objectui#7165,
              // finished by objectui#7188). `LookupField` resolves
              // `dependentValues ?? {}`, so this prop is the only channel that
              // can carry a record. The chain used to end
              // `?? ctx.formValues ?? ctx.data`, but `SchemaRendererContextType`
              // declares exactly `dataSource` / `debug` / `debugFlags` /
              // `apiFetch`, so that tail was unconditionally empty repo-wide and
              // has been retired (objectui#7206) — which is why the repair is
              // this prop and could not have been a provider. A grid that supplied none of the three rendered every
              // `dependsOn` column as a permanently gated, disabled trigger
              // ("Select region first") even when the row carried the parent —
              // a field that could never be filled, with no diagnostic. PR
              // objectui#2216 gave the FORM renderer exactly this injection (its
              // LIVE watched record); the other half — every picker taking the
              // `dependsOn` chain as a hard `baseFilter` — is host-independent
              // and was already live here, so this line supplies a missing INPUT
              // and re-implements no cascade.
              //
              // `pendingRow` is the PERSISTED row shallow-merged with this row's
              // STAGED, unsaved edits (`data-table` builds it from its
              // `pendingChanges`), so a parent edited in the same row re-scopes
              // the child before anything is saved — the form's semantics.
              // `ctx.row` alone was #7165's interim and scoped by the SAVED
              // parent. `pendingRow` is a REQUIRED member of the declared
              // context (`@object-ui/types`, `bf97b98c8` + #7188), so the
              // `?? ctx.row` never selects for a conforming host; it is spelled
              // so a context handed to this factory WITHOUT it degrades to the
              // saved-row scoping rather than to `{}` — gated forever — and it
              // is the spelling objectui#7188's ruling chose.
              dependentValues={ctx.pendingRow ?? ctx.row}
            />
          );
        }
      : undefined,
    singleClickEdit: schema.singleClickEdit ?? true,
    // objectui#11068 — arrow-key cell navigation on the WAI-ARIA grid pattern:
    // the data cells become ONE roving Tab stop that the arrows move (the
    // behaviour is `data-table`'s, documented on `DataTableSchema`). The
    // declared default is "on when `editable`", and the `editable` that counts
    // is the one this grid renders — `inlineEditable`, the authored key AND the
    // viewer's write verdict (#5143), the same value handed down above. So a
    // grid that renders read-only keeps every cell its own Tab stop unless the
    // author writes `true`, and an explicit `false` turns it off on an editable
    // grid. Not an alias fallback: the right side is the key's own default.
    keyboardNavigation: schema.keyboardNavigation ?? inlineEditable,
    className: schema.className,
    cellClassName: rowHeightMode === 'compact'
      ? 'px-3 py-1 text-[13px] leading-tight'
      : rowHeightMode === 'short'
        ? 'px-3 py-1 text-[13px] leading-normal'
        : rowHeightMode === 'tall'
          ? 'px-3 py-2.5 text-sm'
          : rowHeightMode === 'extra_tall'
            ? 'px-3 py-3.5 text-sm leading-relaxed'
            : 'px-3 py-1.5 text-[13px] leading-normal',
    // objectui#12423 — the host's Row numbers switch; on unless a host says off.
    showRowNumbers: hostShowRowNumbers ?? true,
    // [#5148] The authored request ∧ the principal's verdict — the conjunction
    // #5143 spelled for `editable` and #4646 / PR #5145 spelled for the
    // related-list "+ New" (`objectCanCreate = affordances.create ∧
    // can(obj,'create')`), with the operation moved to `create`.
    //
    // The authored key stays the gate's LEFT half, so this narrows and never
    // widens: no verdict can turn the add row ON for a grid that did not ask
    // for it, and a grid declaring no `operations` at all keeps falling through
    // the `{ update: !!onEdit, delete: !!onDelete }` default that carries no
    // `create` key.
    //
    // Fail-open, like every sibling gate in this file. `can()` answers `true`
    // with no `PermissionProvider` mounted, and `permissionCreate` is
    // `undefined` when no object name resolved (element/inline data source) —
    // both leave today's behaviour exactly as it was. That fallback is
    // load-bearing rather than incidental: `plugin-designer`'s `FieldDesigner`
    // and `ObjectManager` both build grids with `operations: { create: true,
    // update: true, delete: true }` when not read-only, and those surfaces
    // typically render with no provider. Pinned by test `d` in
    // `addRowCreatePermissionGate.test.tsx`.
    //
    // The object-level layers stop here deliberately. `resolveCrudAffordances`
    // also emits `createPredicates`, but PR #5145 binds those ONCE PER TOOLBAR
    // against the host record in scope — an add-record row is not a toolbar and
    // has no record to bind, and that precedent surfaces predicates only AFTER
    // the object-level verdict passed. The conjunct that was missing here is
    // that verdict, which is what this adds.
    showAddRow: !!operations?.create && addRowGranted,
    onAddRecord: onAddRecord,
    rowClassName: schema.rowColor ? (row: any, _idx: number) => getRowClassName(row) : undefined,
    rowStyle: schema.conditionalFormatting?.length ? (row: any, _idx: number) => getRowStyle(row) : undefined,
    frozenColumns: effectiveFrozenColumns,
    onSelectionChange: (rows: any[]) => {
      setSelectedRows(rows);
      onRowSelect?.(rows);
    },
    selectionResetKey,
    onRowClick: navigation.handleClick,
    onCellChange: onCellChange,
    // Install a dataSource-backed default only when the consumer did NOT wire
    // its own handler, so declarative `editable: true` views still persist.
    onRowSave: onRowSave ?? defaultRowSave,
    onBatchSave: onBatchSave ?? defaultBatchSave,
    onColumnResize: (columnKey: string, width: number) => {
      saveColumnState({
        ...columnState,
        widths: { ...columnState.widths, [columnKey]: width },
      });
    },
    // objectui#6175: the renderer invokes `onColumnsReorder` (with the `s`) —
    // `data-table.tsx:handleColumnDrop` — and has never invoked the singular
    // `onColumnReorder` this used to emit, so reorders were never persisted.
    // Producer-side fix (AGENTS #0.1: fix the producer, don't teach the renderer
    // a second spelling), which retires nothing: `onColumnReorder` stays declared
    // on `DataTableSchema` and stays unwired, exactly as the RuntimeOnlyDeclared
    // ledger records it. Which of the two declared spellings survives is still an
    // open ruling and is deliberately NOT settled here.
    onColumnsReorder: (newColumns: any[]) => {
      const order = newColumns
        .map((c) => c?.accessorKey)
        .filter((key): key is string => typeof key === 'string' && key.length > 0);
      saveColumnState({
        ...columnState,
        order,
      });
    },
  };

  // Shared column widths for the grouped view. Each per-group sub-table would
  // otherwise auto-size its columns from its own (often 1–2) rows, so columns
  // never line up between groups and each group gets its own horizontal
  // scrollbar. Pre-computing explicit widths from the FULL dataset (same
  // heuristic as DataTable's autosize) keeps every group's columns aligned and
  // lets them share ONE horizontal scrollbar provided by the wrapper below.
  const groupedColumnWidths: Record<string, number | string> = {};
  for (const col of orderedColumns as any[]) {
    const key = col.accessorKey;
    if (!key) continue;
    const saved = columnState.widths?.[key];
    if (saved) { groupedColumnWidths[key] = saved; continue; }
    if (col.width) { groupedColumnWidths[key] = col.width; continue; }
    // `fitContent` columns (row actions) hug their content — leave them out so
    // they aren't pinned to the 80px char-estimate floor and clipped in
    // grouped mode the same way they were in the flat list.
    //
    // Read WITHOUT a cast since objectui#6424 (maintainer ruling 2026-08-29,
    // option 甲): `TableColumn` declares `fitContent` now, so the key this
    // renderer honours is the key the published type admits. ⚠️ Read the
    // narrowness of that claim: the cast was already buying ZERO type safety
    // here, because `col` is `any` either way — `applyColumnChrome` is
    // `(col: any)`, so `orderedColumns` is `any[]` and the loop above widens it
    // a second time. This read is unchecked for that reason, not for want of a
    // declaration, and typing it is the separate question the `as any[]` on the
    // loop belongs to (objectui#6459). Removing the cast changed no type.
    if (col.fitContent) continue;
    let maxLen = String(col.header ?? '').length;
    for (const row of data.slice(0, 50)) {
      const v = row?.[key];
      const len = v != null ? String(v).length : 0;
      if (len > maxLen) maxLen = len;
    }
    groupedColumnWidths[key] = Math.min(400, Math.max(80, maxLen * 8 + 48));
  }

  /** Build a per-group data-table schema (inherits everything except data & pagination). */
  // objectui#12620 — a grouped grid is ONE table: one header, and per group a
  // band row followed by the group's rows (`rowGroups`, drawn by `data-table`).
  // Columns are one set of widths for every band because they are one table;
  // the explicit widths below keep each column's width stable while bands
  // collapse and expand.
  const buildGroupedTableSchema = (
    rowGroups: NonNullable<ObjectGridDataTableSchema['rowGroups']>,
  ): ObjectGridDataTableSchema => ({
    ...dataTableSchema,
    caption: undefined,
    data: rowGroups.flatMap((group) => group.rows),
    rowGroups,
    // Pages are the grid's: whole groups (`groupedPager`), and on a
    // server-grouped grid each open group's own rows (its band footer).
    pagination: false,
    manualPagination: false,
    searchable: false,
    // The grouped scroller frames the table.
    borderless: true,
    // The table overflows into the grouped scroller (see grouped
    // `gridContent`), which holds both scrollbars and the sticky header.
    disableInnerScroll: true,
    // Frozen columns rely on per-table sticky offsets that don't compose with
    // the shared scroll container; disable them in grouped mode.
    frozenColumns: 0,
    // No cast: `dataTableSchema` is typed, so `.columns` is `TableColumn[]`
    // (the `as any[]` existed only because the surrounding value was `any`, #6459).
    columns: dataTableSchema.columns.map((c) => ({
      ...c,
      width: groupedColumnWidths[c.accessorKey] ?? c.width,
    })),
  });

  // Build record detail title.
  //
  // Keyed, not string-built (objectui#3426). This value is handed to
  // `NavigationOverlay`'s `title` prop, which means the overlay's own
  // `detail.recordDetail` default never applies here — whatever this computes
  // IS the visible heading of the drawer. Interpolating
  // the label through `detail.recordDetailWithLabel` instead of splicing it
  // into an English template lets each pack choose its own word order; the
  // no-label branch reuses the overlay's own key rather than a twin.
  //
  // English output is unchanged in all three branches (`Contacts Detail` /
  // `Contacts Detail` / `Record Detail`), including with no `I18nProvider`
  // mounted — `createSafeTranslation`'s fallback interpolates `{{label}}` from
  // `GRID_DEFAULT_TRANSLATIONS`.
  //
  // ⚠️ The label is RESOLVED before it reaches `t()` (objectui#9092). This is an
  // UNTYPED sink: `t`'s options are `Record<string, unknown>`, so when
  // `ObjectGridSchema.label` was restored to `string | I18nLabel` the compiler
  // named the two `string`-typed reads above and said nothing about this one.
  // Unresolved, an inline locale map interpolates as `[object Object]` on BOTH
  // paths — i18next substitutes the raw value, and the provider-less
  // `interpolateFallback` runs it through `String(v)` — and this value IS the
  // overlay's visible heading (`NavigationOverlay title=`, below), so the
  // failure is user-facing rather than diagnostic.
  //
  // The fallthrough is deliberate: `resolveI18nLabel` answers `undefined` for an
  // entry-less map and `''` for an empty entry, and both are falsy, so a label
  // that resolves to nothing lands on the `objectName` branch exactly as a
  // missing label always did. Testing `schema.label` itself could not do that —
  // every object is truthy, so an entry-less map used to take the label branch.
  const resolvedDetailLabel = resolveInlineI18nLabel(schema.label, displayLocale);
  const detailTitle = resolvedDetailLabel
    ? t('detail.recordDetailWithLabel', { label: resolvedDetailLabel })
    : schema.objectName
      ? t('detail.recordDetailWithLabel', {
          label: schema.objectName.charAt(0).toUpperCase() + schema.objectName.slice(1),
        })
      : t('detail.recordDetail');

  /**
   * The shell-side props both of this component's `NavigationOverlay` call
   * sites share (objectui#9299). Spelled once so the two cannot drift. (A
   * `popoverAnchorRef` used to ride here too, and a third, `split` call site
   * shared the set: both went with the retired `popover` and `split` modes,
   * objectstack#26677.)
   *
   * - `storageKey` / `legacyStorageKey` (item 4): one drag-resize
   *   implementation, one key per object across every view type, and a width
   *   persisted under the retired `objectui.drawerWidth.OBJECT` carries over.
   * - `width`: an unauthored width lands on the ruled default (objectui#6584)
   *   rather than on the shell's own `42rem` floor.
   */
  const recordOverlayShellProps = {
    storageKey: schema.objectName ? recordOverlayWidthStorageKey(schema.objectName) : undefined,
    legacyStorageKey: schema.objectName ? legacyRecordDrawerWidthKey(schema.objectName) : undefined,
    width: navigation.width ?? RECORD_OVERLAY_DEFAULT_WIDTH,
  };

  // Form-based record detail renderer (replaces simple key-value dump).
  // Hoisted above the mobile card-view's early return (below) so both the
  // card view's detail overlay and the desktop table's detail overlay share
  // this same type-aware renderer instead of the card view falling back to
  // a raw `String(value)` dump (which showed "[object Object]" for lookups).
  const renderRecordDetail = (record: any) => {
    // ⭐ objectui#9299 — ONE payload on every view type.
    //
    // `ObjectGrid` already honoured every overlay `navigation.mode` through
    // `NavigationOverlay`, but it drew its OWN read-only key/value panel inside
    // them while the gantt/kanban/calendar drew the rich
    // `InlineEditProvider` -> `DetailView` -> `InlineEditSaveBar` payload. The
    // card measured that as "nobody gets both": the renderers that honoured the
    // mode drew the poorer body. The ruling closes it in one direction — one
    // payload everywhere.
    //
    // ⚠️ READ-ONLY here, and deliberately so: capability is handler presence,
    // and this renderer has no per-field write path to hand the panel. What
    // changes is the FIDELITY of the reading (declared labels, typed widgets,
    // honoured `hidden`, the object's own field order), not the ability to edit.
    // ⚠️ DECLARED-FIELDS GATE, measured rather than assumed. The shared payload
    // renders the object's DECLARED fields: `RecordDetailPanel` derives widgets
    // from `objectSchema.fields[name].type`. The panel below renders the same
    // values by INFERRING from them — a date-shaped string on a `*_date` key,
    // a number on an `amount`-ish key — which is what objectui#4541 (locale-
    // aware date fallback), objectui#8491 (the localized `Empty` placeholder)
    // and objectui#8920 (the `format` hint) put here. A grid with no object
    // schema — inline `value` rows, or a DataSource with no `getObjectSchema`
    // — has NOTHING declared, so handing it to the shared payload renders raw
    // ISO strings where a localized date used to be. Measured on this branch:
    // `recordDetailDateLocale` read back `close_date2024-03-15` in a zh
    // session. So the shared payload takes every grid that HAS declared
    // fields — every console surface — and the inference reading stands where
    // there is nothing to declare. ⛔ Not a preference: it is which of the two
    // can render the value at all.
    const panelRecordId = rowRecordId(record);
    const hasDeclaredFields = !!objectSchema?.fields
      && Object.keys(objectSchema.fields as Record<string, unknown>).length > 0;
    if (schema.objectName && panelRecordId != null && hasDeclaredFields) {
      return (
        <div className="px-6 pt-6 pb-6" data-testid="record-detail-panel">
          {/*
            objectui#9722: `dataSource` is passed straight through — no cast.
            This hand-off carried an `as any` too; measured on this branch, it
            was paying for NOTHING (both sides declare `DataSource | undefined`
            from `@object-ui/types`), so removing it restores a real check at
            zero cost. The `objectSchema` cast below is a different question
            and is deliberately left alone.
          */}
          <RecordDetailPanel
            record={record}
            objectName={schema.objectName}
            recordId={panelRecordId}
            dataSource={dataSource}
            objectSchema={objectSchema as any}
            onClose={navigation.close}
          />
        </div>
      );
    }
    // No addressable record behind this row — a grid over inline `value` rows
    // with no object name. The payload needs an object and an id to render
    // field widgets against, so the plain reading of what the row carries is
    // the honest answer; inventing an id would not be.
    const entries = Object.entries(record);
    // Honor `hidden: true` on the schema field def — internal/system fields
    // (e.g. database_url, environment_id, is_system) shouldn't leak into the
    // grid's record-detail drawer just because they're in the record payload.
    const isHidden = (key: string) => objectFields?.[key]?.hidden === true;
    // Split business fields from framework-managed system/audit/ownership
    // columns via the shared classifier (branches on `field.system`), so the
    // injected `owner_id` and friends land in the muted meta section rather than
    // the business body — consistent with the grid's default-column derivation.
    const isSystem = (key: string) => isSystemManagedField(key, objectFields?.[key]);
    const regularFields = entries.filter(([key]) => !isSystem(key) && !isHidden(key));
    const metaFields = entries.filter(([key]) => isSystem(key) && key !== '_id' && key !== 'id' && !isHidden(key));

    const formatFieldLabel = (key: string): string =>
      key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');

    const renderFieldValue = (key: string, value: any): React.ReactNode => {
      if (value == null || value === '') {
        return <EmptyValue className="text-sm italic" glyph={t('grid.empty')} />;
      }

      // objectui#10657 — while the object's field types are unknown (the
      // schema read is in flight, or it failed) no value here can be typed,
      // and any of them could be a `password` / `secret` field: each is drawn
      // WITHHELD, as the mask, like the grid's own untyped cells, never as the
      // inferred text below.
      if (objectTypesPending) return <MaskedCellRenderer value={value} />;

      // Use objectSchema field type for type-aware rendering
      const fieldDef = objectFields?.[key];
      // Through the shared resolve, so the panel honours a `format` hint the
      // same way the row above it does (objectui#8920). `rendererType` is null
      // exactly when the key has no declared type, which is the guard this
      // used to spell as `if (fieldDef?.type)`. The old inner
      // `if (CellRenderer)` was DEAD — `getCellRenderer` ends in
      // `standardMap[key] || TextCellRenderer` and never returns anything
      // falsy — and `GridCellRendering.Renderer` states that totality in the
      // type, so the dead branch goes with it.
      const { rendererType, Renderer } = resolveGridCellRendering(fieldDef);
      if (rendererType) {
        return <Renderer value={value} field={fieldDef} dependentValues={record} />;
      }

      // Fallback: infer from value and key name
      if (typeof value === 'boolean') {
        return <Badge variant={value ? 'default' : 'outline'}>{value ? t('grid.yes') : t('grid.no')}</Badge>;
      }
      // Detect date-like values. The tag comes from `useDisplayLocale()` like
      // every other date channel: passing no options at all handed `Intl` an
      // `undefined` tag, i.e. the MACHINE's locale, which is neither of the
      // repo's two locale channels — so this cell rendered `Mar 15, 2024` on a
      // zh console while its neighbours rendered `2024年3月15日` (objectui#4541).
      if (typeof value === 'string' && !isNaN(Date.parse(value)) && (key.includes('date') || key.includes('_at') || key.includes('time'))) {
        return <span className="text-sm tabular-nums">{formatDate(value, undefined, { locale: displayLocale })}</span>;
      }
      // Detect currency-like fields by name
      const currencyFields = ['amount', 'price', 'total', 'revenue', 'cost', 'value', 'budget', 'salary'];
      // The currency sibling of the date branch above takes the SAME tag.
      // objectui#4541 threaded it into the date branch and left this one, and
      // `formatCurrency` reads an omitted tag as "follow the runtime", i.e. the
      // MACHINE's locale — invisible to a source scan, since the call merely
      // omits the argument (objectui#9909).
      if (typeof value === 'number' && currencyFields.some(f => key.toLowerCase().includes(f))) {
        return <span className="text-sm tabular-nums font-medium">{formatCurrency(value, tenantCurrency, displayLocale)}</span>;
      }
      // No field-type match (e.g. a computed/untyped key): never dump a raw
      // object as a React child — extract a display name/id instead.
      return <span className="text-sm break-words">{String(coerceToSafeValue(value) ?? '')}</span>;
    };

    return (
      <div className="space-y-4" data-testid="record-detail-panel">
        {/* Regular fields in form-like layout */}
        <div className="rounded-lg border bg-card">
          <div className="divide-y">
            {regularFields.map(([key, value]) => (
              <div key={key} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-4 py-3">
                <span className="text-xs font-medium text-muted-foreground sm:w-1/3 sm:text-right sm:pt-0.5 uppercase tracking-wide shrink-0">
                  {formatFieldLabel(key)}
                </span>
                <div className="flex-1 min-w-0">
                  {renderFieldValue(key, value)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* System/meta fields */}
        {metaFields.length > 0 && (
          <div className="rounded-lg border bg-muted/30">
            <div className="px-4 py-2 border-b">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('grid.systemFields')}</span>
            </div>
            <div className="divide-y divide-border/50">
              {metaFields.map(([key, value]) => (
                <div key={key} className="flex items-center gap-4 px-4 py-2">
                  <span className="text-xs text-muted-foreground w-1/3 text-right shrink-0">
                    {formatFieldLabel(key)}
                  </span>
                  <span className="text-xs text-muted-foreground flex-1 min-w-0 break-words">
                    {/* Withheld while the field types are unknown (objectui#10657). */}
                    {objectTypesPending ? <MaskedCellRenderer value={value} /> : String(coerceToSafeValue(value) ?? '')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // objectui#11068 — `description`: one line of help text above the grid, in
  // the treatment `ListView` gives a view's description (`view-description`),
  // so the two surfaces draw the same key the same way. Resolved like `label`:
  // a locale map against the display locale. Guarded on the RESOLVED text, so a
  // map with no usable entry draws no empty strip. Drawn by every branch that
  // draws rows — the card view, the split pane and the table.
  const resolvedDescription = resolveInlineI18nLabel(schema.description, displayLocale);
  const gridDescription = resolvedDescription ? (
    <p className="px-3 sm:px-4 pt-1.5 text-xs text-muted-foreground" data-testid="object-grid-description">
      {resolvedDescription}
    </p>
  ) : null;

  // Mobile card-view: below the 768px app breakpoint (matches useIsMobile /
  // Tailwind md: / the responsive page+grid layout), render stacked cards
  // instead of a side-scrolling wide table.
  //
  // objectstack#26896 — one renderer draws a record's card for both card
  // views: the plain list below, and a grouped list on a phone (the grouped
  // `gridContent`), which draws each group's band followed by its rows as
  // these same cards rather than keeping the desktop table.
  const buildMobileCardRenderer = () => {
    const displayColumns = generateColumns().filter((c) => c.accessorKey !== '_actions');

    // Build a lookup of column metadata for smart rendering
    const colMap = new Map<string, ObjectGridColumnDraft>();
    displayColumns.forEach((col) => colMap.set(col.accessorKey, col));

    // [objectui#13150] The card is titled by the object's DECLARED name field,
    // read through `declaredNameField` (the resolver's single spelling of the
    // pointer, the one the bulk confirm step names records by), never by
    // whichever column a view happens to show first: a view leading with
    // Owner titled every card with the owner's name and pushed the record's
    // own name down into a body row. Where the name field is a shown column,
    // that column is the title. Where it is not, the title reads the row's
    // value of it: both fetches that feed this grid ask for the declared name
    // field whether or not a column shows it (`getSelectFields` here,
    // objectui#13107; `ListView`'s harvest, objectui#13116), and a value the
    // row lacks (the viewer may not read it) draws the card's empty title,
    // never another field's value. Only an object that declares no name field
    // keeps the first shown column as its title.
    const declaredName = declaredNameField(objectSchema);
    const nameFieldKey = typeof declaredName === 'string' && declaredName !== '' ? declaredName : undefined;
    const titleCol = nameFieldKey !== undefined ? colMap.get(nameFieldKey) : displayColumns[0];
    const titleKey = titleCol?.accessorKey ?? nameFieldKey;
    // The body never repeats the title: it is every shown column but the one
    // that titles the card, so a first column the name field displaced (the
    // Owner above) reads as an ordinary body row.
    const bodyColumns = displayColumns.filter((c) => c !== titleCol);

    // Identify special columns by inferred type for visual hierarchy
    const amountKeys = ['amount', 'price', 'total', 'revenue', 'cost', 'value', 'budget', 'salary'];
    const stageKeys = ['stage', 'status', 'priority', 'category', 'severity', 'level'];
    const dateKeys = ['date', 'due', 'created', 'updated', 'deadline', 'start', 'end', 'expires'];
    const percentKeys = ['probability', 'percent', 'rate', 'ratio', 'confidence', 'score'];

    // Stage badge color mapping for common pipeline stages — soft pill style.
    const stageBadgeColor = (value: string): string => {
      const v = (value || '').toLowerCase();
      if (v.includes('won') || v.includes('completed') || v.includes('done') || v.includes('active') || v === 'activated' || v === 'success' || v === 'approved' || v === 'paid')
        return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/60';
      if (v.includes('lost') || v.includes('cancelled') || v.includes('rejected') || v.includes('closed lost') || v === 'expired' || v === 'terminated' || v === 'failed' || v === 'overdue')
        return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60';
      if (v.includes('negotiation') || v.includes('review') || v.includes('in progress') || v.includes('approval') || v === 'in_approval' || v === 'pending_approval')
        return 'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-900/60';
      if (v.includes('proposal') || v.includes('pending'))
        return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60';
      if (v.includes('qualification') || v.includes('qualified'))
        return 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/60';
      if (v.includes('prospecting') || v.includes('new') || v.includes('open'))
        return 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/60';
      if (v === 'draft' || v.includes('draft'))
        return 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-950/40 dark:text-slate-300 dark:border-slate-900/60';
      return 'bg-muted text-muted-foreground border-border';
    };

    // Left border color for card accent based on stage
    const stageBorderLeft = (value: string): string => {
      const v = (value || '').toLowerCase();
      if (v.includes('won') || v.includes('completed') || v.includes('done') || v.includes('active') || v === 'activated')
        return 'border-l-green-500';
      if (v.includes('lost') || v.includes('cancelled') || v.includes('rejected') || v === 'expired' || v === 'terminated')
        return 'border-l-red-500';
      if (v.includes('negotiation') || v.includes('review') || v.includes('in progress') || v.includes('approval'))
        return 'border-l-yellow-500';
      if (v.includes('proposal') || v.includes('pending'))
        return 'border-l-blue-500';
      if (v.includes('qualification') || v.includes('qualified'))
        return 'border-l-indigo-500';
      if (v.includes('prospecting') || v.includes('new') || v.includes('open'))
        return 'border-l-purple-500';
      if (v === 'draft' || v.includes('draft'))
        return 'border-l-slate-400';
      return 'border-l-gray-300';
    };

    // objectui#10583 — a MASKED column (the rule that stamps `TableColumn.masked`)
    // is drawn only through its own `cell`, which draws the mask. The branches
    // below pick amount / stage / date / percent by the field's NAME and print
    // the raw value, so a masked column is never classified; it lands in the
    // `col.cell` branch, and the title row routes it through `cell` as well.
    // A WITHHELD column (objectui#10657: the object's field types are still
    // unknown, and the column has no type of its own) is handled the same way:
    // its `cell` draws the mask.
    const isMaskedCardColumn = (key: string) =>
      isMaskedGridColumn(colMap.get(key)?.type, objectFields?.[key]?.type, objectTypesPending);

    const classify = (key: string): 'amount' | 'stage' | 'date' | 'percent' | 'other' => {
      if (isMaskedCardColumn(key)) return 'other';
      const k = key.toLowerCase();
      if (amountKeys.some(p => k.includes(p))) return 'amount';
      if (stageKeys.some(p => k.includes(p))) return 'stage';
      if (dateKeys.some(p => k.includes(p))) return 'date';
      if (percentKeys.some(p => k.includes(p))) return 'percent';
      return 'other';
    };

    // Resolve a select-like value to its translated option label and
    // explicit color so card badges match the desktop grid — the raw
    // stored value (e.g. "in_review") must never reach the user.
    const resolveOptionMeta = (fieldKey: string, value: any): { label: string; color?: string } => {
      const rawOptions = objectSchema?.fields?.[fieldKey]?.options;
      if (Array.isArray(rawOptions) && rawOptions.length > 0) {
        const translated = schema.objectName
          ? translateOptions(schema.objectName, fieldKey, rawOptions)
          : rawOptions;
        const opt = (translated as any[]).find(o => o && String(o.value) === String(value));
        if (opt) {
          return { label: opt.label != null ? String(opt.label) : String(value), color: (opt as any).color };
        }
      }
      // Option-less enum-looking values still get humanized; free text is
      // passed through untouched so we never rewrite user data.
      const str = String(value);
      return { label: /^[a-z0-9]+(_[a-z0-9]+)+$/.test(str) ? humanizeLabel(str) : str };
    };

    return (row: any, idx: number) => {
      // Collect secondary fields (skip the title column)
      const secondaryCols = bodyColumns.slice(0, 4);
      const amountCol = secondaryCols.find((c: any) => classify(c.accessorKey) === 'amount');
      const stageCol = secondaryCols.find((c: any) => classify(c.accessorKey) === 'stage');
      const dateCols = secondaryCols.filter((c: any) => classify(c.accessorKey) === 'date');
      const percentCols = secondaryCols.filter((c: any) => classify(c.accessorKey) === 'percent');
      const otherCols = secondaryCols.filter(
        (c: any) => c !== amountCol && c !== stageCol && !dateCols.includes(c) && !percentCols.includes(c)
      );

      // Determine left border accent color from stage value
      const stageValue = stageCol ? String(row[stageCol.accessorKey] ?? '') : '';
      const leftBorderClass = stageValue ? stageBorderLeft(stageValue) : '';
      const cardClassName = [
        'border rounded-lg p-2.5 bg-card hover:bg-accent/50 cursor-pointer transition-colors touch-manipulation',
        leftBorderClass ? `border-l-[3px] ${leftBorderClass}` : '',
      ].filter(Boolean).join(' ');

      return (
        <div
          key={row.id || row._id || idx}
          className={cardClassName}
          onClick={() => navigation.handleClick(row)}
        >
          {/* Title row - Name as bold prominent title */}
          {titleKey !== undefined && (
            <div data-testid="grid-card-title" className="font-semibold text-sm truncate mb-1">
              {isMaskedCardColumn(titleKey)
                ? (titleCol
                    ? titleCol.cell?.(row[titleKey], row)
                    // A masked name field no column shows has no `cell`
                    // to draw its mask, so the mask is drawn here.
                    : <MaskedCellRenderer value={row[titleKey]} />)
                : (coerceToSafeValue(row[titleKey]) ?? '—')}
              {/* objectui#13330 — the host's node beside the title. */}
              {rowAdornment ? <span className="ml-1.5 inline-flex align-middle">{rowAdornment(row)}</span> : null}
            </div>
          )}

          {/* Amount + Stage row - side by side for compact display */}
          {(amountCol || stageCol) && (
            <div className="flex items-center justify-between gap-2 mb-1">
              {amountCol && (
                <span className="text-sm tabular-nums font-medium">
                  {/* objectui#10423 — the currency resolves from the FIELD
                      def, as the desktop cell's does (objectui#10354);
                      `amountCol` is a column draft and carries neither
                      `currency` nor `currencyConfig`. */}
                  {typeof row[amountCol.accessorKey] === 'number'
                    ? formatCompactCurrency(row[amountCol.accessorKey], resolveFieldCurrency(objectSchema?.fields?.[amountCol.accessorKey], tenantCurrency), displayLocale)
                    : (coerceToSafeValue(row[amountCol.accessorKey]) ?? '—')}
                </span>
              )}
              {stageCol && row[stageCol.accessorKey] && (() => {
                const rawValue = row[stageCol.accessorKey];
                const optMeta = resolveOptionMeta(stageCol.accessorKey, rawValue);
                // Explicit option color wins, resolved EXACTLY as the
                // desktop cell resolves it (`SelectCellRenderer` in
                // `@object-ui/fields`): a declared hex renders as
                // declared via `getBadgeHexAppearance` (objectui#5141,
                // adopted here by objectui#5183), a family name keeps
                // going through `getBadgeColorClasses`. The `style` is
                // load-bearing — the hex ships as CSS custom properties
                // that the returned className reads, so dropping it
                // yields a badge referencing undefined variables.
                // With no declared colour at all we keep the
                // pipeline-stage heuristic keyed on the raw value,
                // which stays stable across locales.
                const hexBadge = getBadgeHexAppearance(optMeta.color);
                const badgeClasses = hexBadge
                  ? hexBadge.className
                  : optMeta.color
                    ? getBadgeColorClasses(optMeta.color, rawValue)
                    : stageBadgeColor(String(rawValue));
                return (
                  <Badge
                    variant="outline"
                    className={`text-xs shrink-0 max-w-[140px] truncate ${badgeClasses}`}
                    style={hexBadge?.style}
                  >
                    {optMeta.label}
                  </Badge>
                );
              })()}
            </div>
          )}

          {/* Date + Percent combined row for density */}
          {(dateCols.length > 0 || percentCols.length > 0) && (
            <div className="flex items-center justify-between py-0.5 text-xs text-muted-foreground">
              {dateCols[0] && (
                <span className="tabular-nums">
                  {row[dateCols[0].accessorKey]
                    ? formatDate(row[dateCols[0].accessorKey], 'short', { locale: displayLocale })
                    : '—'}
                </span>
              )}
              {percentCols[0] && row[percentCols[0].accessorKey] != null && (() => {
                // objectui#11254 — the width is the FIELD's, read through
                // `resolveFieldScale` (ruling A′ on
                // objectstack-ai/objectstack#19628) off the field def the
                // amount cell above reads its currency from, so a percent
                // declaring `scale: 2` reads two decimals here as it does
                // in the desktop cell. This cell handed `formatPercent` an
                // `undefined` width, so the function's own default decided.
                //
                // Only a `percent` field's width is a percent width. The
                // column reached this slot by its NAME (`classify`), and a
                // `number` named like a rate counts its `scale` in the
                // stored value's decimals, not in the percentage points
                // printed here, so its scale is not read.
                //
                // objectui#11475 — nor is a non-percent field printed as a
                // percent at all. A percent face reads the field's declared
                // STORAGE (`percentCellScale`, the spec's `percentScaleOf`),
                // and a field that is not a `percent` declares none: the
                // spec's words are "a plain `number` carries no percent
                // semantics". Choosing a percent face by the column's NAME
                // was a consumer-side guess (`lead_score` and `tax_rate`,
                // both `Field.number` in the showcase, printed with a
                // percent sign), so
                // such a field prints through its own cell, as the desktop
                // row prints it, with no percent affix.
                const percentDef = objectSchema?.fields?.[percentCols[0].accessorKey];
                if (percentDef?.type !== 'percent') {
                  const { Renderer: SlotRenderer } = resolveGridCellRendering(percentDef);
                  return (
                    <span className="tabular-nums">
                      <SlotRenderer
                        value={row[percentCols[0].accessorKey]}
                        field={percentDef ?? { name: percentCols[0].accessorKey }}
                      />
                    </span>
                  );
                }
                const width = resolveFieldScale({ type: percentDef.type, scale: percentDef.scale });
                return (
                  <span className="tabular-nums">
                    {/* objectui#4553: the mobile card's percent cell takes
                        the same `displayLocale` its date sibling above
                        already does (objectui#4272). */}
                    {formatPercent(
                      Number(row[percentCols[0].accessorKey]),
                      percentCellScale(percentDef),
                      width,
                      displayLocale,
                    )}
                  </span>
                );
              })()}
            </div>
          )}

          {/* Additional date fields beyond the first */}
          {dateCols.slice(1).map((col: any) => (
            <div key={col.accessorKey} className="flex justify-between items-center py-0.5">
              <span className="text-xs text-muted-foreground">{col.header}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {row[col.accessorKey] ? formatDate(row[col.accessorKey], 'short', { locale: displayLocale }) : '—'}
              </span>
            </div>
          ))}

          {/* Other fields - hide empty values on mobile */}
          {otherCols.map((col: any) => {
            const val = row[col.accessorKey];
            if (val == null || val === '') return null;
            return (
              <div key={col.accessorKey} className="flex justify-between items-center py-0.5">
                <span className="text-xs text-muted-foreground">{col.header}</span>
                <span className="text-xs font-medium truncate ml-2 text-right">
                  {col.cell ? col.cell(val, row) : String(coerceToSafeValue(val) ?? '')}
                </span>
              </div>
            );
          })}
        </div>
      );
    };
  };

  if (useCardView && data.length > 0 && !isGrouped) {
    const renderMobileCard = buildMobileCardRenderer();

    // objectui#13134 — the card list scrolls in a box of its own, as the
    // table does in its own body. Its host bounds it (`ListView`'s view area
    // is `overflow-hidden`), so without this box a list taller than the
    // screen was clipped with nothing to scroll, and a host could not leave
    // room at its end: padding inside a clipping box makes no scroll room.
    //
    // `data-fab-clearance` marks it as the scroller whose end a host's
    // floating button can cover. The host that draws such a button pads it
    // from outside (the console object page does, for its phone create
    // button), so this component learns nothing about buttons it does not
    // draw: a DOM attribute, the same posture as `data-fab-yield`, rather
    // than a prop or an export. With no such host it is unpadded.
    return (
      <>
        <div
          className="h-full overflow-y-auto overflow-x-hidden"
          data-fab-clearance=""
          data-testid="object-grid-card-scroller"
        >
        {gridDescription}
        <div className="space-y-2 p-2">
          {data.map(renderMobileCard)}
        </div>
        </div>
        {navigation.isOverlay && (
          <NavigationOverlay
            {...navigation}
            title={detailTitle}
            {...recordOverlayShellProps}
          >
            {(record) => renderRecordDetail(record)}
          </NavigationOverlay>
        )}
      </>
    );
  }

  // Row height cycle handler (plain function, not hook — after early returns)
  const cycleRowHeight = () => {
    setRowHeightMode(prev => {
      if (prev === 'compact') return 'short';
      if (prev === 'short') return 'medium';
      if (prev === 'medium') return 'tall';
      if (prev === 'tall') return 'extra_tall';
      return 'compact';
    });
  };

  const rowHeightIcons = { compact: Rows4, short: Rows3, medium: Rows2, tall: AlignJustify, extra_tall: AlignJustify };
  const RowHeightIcon = rowHeightIcons[rowHeightMode];

  // Grid toolbar (row height toggle + export)
  // Hide row-height toggle when parent (e.g., ListView) controls density externally,
  // signaled by `hideRowHeightToggle` prop on schema.
  //
  // NON-AUTHOR SURFACE — `hideRowHeightToggle` is deliberately absent from
  // `GRID_QUERY_INPUTS` (maintainer ruling, 2026-08-18, objectui#5091), so this
  // cast read is deliberate, not missed. It is the host's own signal, written
  // by the embedding view when IT owns density (`plugin-list/src/ListView.tsx`
  // :1866 sets it unconditionally); the author-facing way to ask for a density
  // is `rowHeight`, which IS declared. `ComponentPropsMap['object-grid']` is a
  // `strictObject` and rejects this key by name, so publishing it would offer a
  // key the save gate refuses. Pinned by
  // `__tests__/gridNonAuthorKeys.test.tsx`.
  const showRowHeightToggle = schema.rowHeight !== undefined && !(schema as any).hideRowHeightToggle;
  // Export is offered only when configured AND not blocked by object-level perms
  // — including the server's effective API operation set (objectstack#3391): when present
  // and it excludes `export`, the button is hidden. Missing set → unchanged.
  const exportEnabled =
    !!schema.exportOptions &&
    exportableFormats.length > 0 &&
    schema.operations?.export !== false &&
    (effectiveApiOps ? effectiveApiOps.includes('export') : true);
  const hasToolbar = exportEnabled || showRowHeightToggle;
  const gridToolbar = hasToolbar ? (
    <div className="flex items-center justify-end gap-1 px-2 py-1">
      {/* Row height toggle */}
      {showRowHeightToggle && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-primary text-xs"
          onClick={cycleRowHeight}
          title={`Row height: ${rowHeightMode}`}
        >
          <RowHeightIcon className="h-3.5 w-3.5 mr-1.5" />
          <span className="hidden sm:inline capitalize">{rowHeightMode}</span>
        </Button>
      )}

      {/* Export */}
      {exportEnabled && (
        <Popover open={showExport} onOpenChange={setShowExport}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-primary text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              <span className="hidden sm:inline">{t('grid.export')}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-2">
            <div className="space-y-1">
              {exportableFormats.map(format => (
                <Button
                  key={format}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start h-8 text-xs"
                  disabled={exportBusy}
                  onClick={() => handleExport(format)}
                >
                  {exportBusy
                    ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    : <Download className="h-3.5 w-3.5 mr-2" />}
                  {t('grid.exportAs', { format: format.toUpperCase() })}
                </Button>
              ))}
              {exportError && (
                <div
                  className="px-2 py-1 text-xs"
                  style={{ color: 'var(--destructive, #ef4444)' }}
                  role="alert"
                >
                  {exportError}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  ) : null;

  // objectui#12528 — a host that passes `onColumnSummaryChange` draws the
  // summaries in its own footer row: the grid draws none and reports, through
  // `FooterSummaryReport` mounted where the row would be, what it would have
  // drawn. Mounted in the same place, so whatever withholds the row (a
  // grouped grid, the card view, a loading or error face) reports `null`.
  const summaryColumnsShown: Array<{ accessorKey: string; header?: React.ReactNode }> = hasSummary
    ? orderedColumns.filter((col: { accessorKey: string }) => summaries.has(col.accessorKey))
    : [];
  const summaryFooter = hasSummary && onColumnSummaryChange ? (
    <FooterSummaryReport
      summaries={summaryColumnsShown.map((col) => ({
        key: String(col.accessorKey),
        header: typeof col.header === 'string' ? col.header : String(col.accessorKey),
        label: summaries.get(col.accessorKey)!.label,
      }))}
      onChange={onColumnSummaryChange}
    />
  ) : hasSummary ? (
    <div className="border-t bg-muted/30 px-2 py-1.5" data-testid="column-summary-footer">
      <div className="flex gap-4 text-xs text-muted-foreground font-medium">
        {summaryColumnsShown.map((col) => {
          const summary = summaries.get(col.accessorKey)!;
          return (
            <span key={col.accessorKey} data-testid={`summary-${col.accessorKey}`}>
              {col.header}: {summary.label}
            </span>
          );
        })}
      </div>
    </div>
  ) : null;

  // Render grid content: grouped (recursive nested headers + leaf table) or
  // flat (single table). Multi-level grouping renders one `GroupRow` per level
  // with progressive indentation; the deepest level hosts the data table.
  // Resolve the small grey caption (field label) and a soft colored pill
  // class for a group header. Only fields of type select/status get colored
  // pills — matching the cell renderer's color scheme so the same value
  // looks the same in the grouped header and the cell.
  const resolveGroupHeader = (field: string, label: string) => {
    const fieldDef = objectSchema?.fields?.[field] as any;
    const fieldLabel = schema.objectName
      ? resolveFieldLabel(schema.objectName, field, fieldDef?.label || field)
      : (fieldDef?.label || field);
    let labelColorClass: string | undefined;
    let labelColorStyle: React.CSSProperties | undefined;
    const ftype = fieldDef?.type;
    if (ftype === 'select' || ftype === 'status') {
      const opts = fieldDef?.options
        ? translateOptions(schema.objectName, field, fieldDef.options)
        : undefined;
      const matched = Array.isArray(opts)
        ? opts.find((o: any) => String(o.label) === label || String(o.value) === label)
        : undefined;
      // Same resolution as the cell below the header (`SelectCellRenderer`):
      // a declared hex renders as declared (objectui#5141/#5183), everything
      // else keeps resolving to a palette family. `labelColorStyle` carries
      // the CSS custom properties the hex className reads — the pill needs
      // BOTH halves or it references undefined variables.
      const hexBadge = getBadgeHexAppearance(matched?.color);
      labelColorClass = hexBadge
        ? hexBadge.className
        : getBadgeColorClasses(matched?.color, matched?.value ?? label);
      labelColorStyle = hexBadge?.style;
    }
    return { fieldLabel, labelColorClass, labelColorStyle };
  };

  // [objectui#7189] What a server-grouped open leaf draws after its rows: its
  // error, its loading line, or — when the group spans more than one page —
  // the group's own pager, driven by the header's count. Turning it asks the
  // server for the group's next page, so every row of every group is
  // reachable. objectui#12620: drawn in the band's footer row of the one table.
  const renderServerGroupFooter = (group: typeof groups[number]): React.ReactNode => {
    const held = groupRows.pages[group.key];
    if (held?.error) {
      return (
        <p data-testid={`group-rows-error-${group.key}`} className="sticky left-0 w-max px-3 py-2 text-xs text-destructive">
          {held.error.message}
        </p>
      );
    }
    if (!held || (held.loading && held.rows.length === 0)) {
      return (
        <p data-testid={`group-rows-loading-${group.key}`} className="sticky left-0 w-max px-3 py-2 text-xs text-muted-foreground">
          {t('grid.loading')}
        </p>
      );
    }
    const pageCount = Math.max(1, Math.ceil(group.count / serverPageSize));
    if (pageCount <= 1) return undefined;
    const page = Math.min(held.page, pageCount);
    const goTo = (next: number) => groupRows.setPage(group.key, Math.min(pageCount, Math.max(1, next)));
    return (
      <div data-testid={`group-pager-${group.key}`} className="sticky left-0 flex w-max items-center gap-4 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('table.rowsPerPage')}:</span>
          <Select value={String(serverPageSize)} onValueChange={(size) => setServerPageSize(Number(size))}>
            <SelectTrigger className="h-7 w-20 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from(new Set([5, 10, 20, 50, 100, serverPageSize])).sort((a, b) => a - b).map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('table.pageInfo', { current: page, total: pageCount })}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goTo(1)} disabled={page === 1} aria-label={t('table.firstPage')}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goTo(page - 1)} disabled={page === 1} aria-label={t('table.previousPage')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goTo(page + 1)} disabled={page === pageCount} aria-label={t('table.nextPage')}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goTo(pageCount)} disabled={page === pageCount} aria-label={t('table.lastPage')}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // objectui#12620 — the groups on this page of groups, flattened into the
  // one table's bands in display order: each group's band, then (open leaf)
  // its rows, then (open parent) its subgroups. A collapsed group keeps its
  // band and draws nothing under it.
  const groupBandsOf = (list: typeof groups): NonNullable<ObjectGridDataTableSchema['rowGroups']> => {
    const bands: NonNullable<ObjectGridDataTableSchema['rowGroups']> = [];
    const visit = (group: typeof groups[number]) => {
      const { fieldLabel, labelColorClass, labelColorStyle } = resolveGroupHeader(group.field, group.label);
      // [objectui#13234] A date-family key reads as its cell reads; the
      // group's own label (its sort key) everywhere else.
      const temporalFace = temporalGroupFaces.get(group.field);
      const heading = (temporalFace && temporalGroupHeading(temporalFace, group.keyValues[group.field], displayLocale))
        || group.label;
      const openLeaf = !group.collapsed && group.subgroups.length === 0;
      bands.push({
        key: group.key,
        depth: group.depth,
        band: (
          <GroupRow
            groupKey={group.key}
            label={heading}
            count={group.count}
            collapsed={group.collapsed}
            aggregations={group.aggregations}
            fieldLabel={group.depth === 0 ? fieldLabel : undefined}
            labelColorClass={labelColorClass}
            labelColorStyle={labelColorStyle}
            depth={group.depth}
            onToggle={toggleGroup}
          />
        ),
        rows: !openLeaf ? [] : serverGroupedFetch ? (groupRows.pages[group.key]?.rows ?? []) : group.rows,
        footer: openLeaf && serverGroupedFetch ? renderServerGroupFooter(group) : undefined,
      });
      if (!group.collapsed) group.subgroups.forEach(visit);
    };
    list.forEach(visit);
    return bands;
  };

  // Grouped pagination — paginate whole top-level groups so a group is never
  // split across pages. Clamp the current page in case the group count shrank.
  const totalGroupPages = Math.max(1, Math.ceil(groups.length / groupedPageSize));
  const safeGroupedPage = Math.min(groupedPage, totalGroupPages);
  const pagedGroups = groups.slice(
    (safeGroupedPage - 1) * groupedPageSize,
    safeGroupedPage * groupedPageSize,
  );

  const groupedPager = groups.length > 0 && totalGroupPages > 1 ? (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-3 sm:px-4 py-2 border-t">
      <div className="flex items-center gap-2">
        <span className="text-xs sm:text-sm text-muted-foreground">{t('table.rowsPerPage')}:</span>
        {/* The shared `Select`, drawn as the DataTable pager draws its own
            size picker (objectui#11865); it was a browser-native `<select>`.
            A pick writes the same number and returns to page 1, as before. */}
        <Select
          value={String(groupedPageSize)}
          onValueChange={(size) => { setGroupedPageSize(Number(size)); setGroupedPage(1); }}
        >
          <SelectTrigger className="h-8 w-20 px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* The active size is merged in, as the DataTable pager does, so the
                selector shows the size in force even when it is not one of the
                steps: the spec's display default is not (objectui#9853). */}
            {Array.from(new Set([5, 10, 20, 50, 100, groupedPageSize])).sort((a, b) => a - b).map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs sm:text-sm text-muted-foreground">
          {t('table.pageInfo', { current: safeGroupedPage, total: totalGroupPages })}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setGroupedPage(1)} disabled={safeGroupedPage === 1} aria-label={t('table.firstPage')}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setGroupedPage(Math.max(1, safeGroupedPage - 1))} disabled={safeGroupedPage === 1} aria-label={t('table.previousPage')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setGroupedPage(Math.min(totalGroupPages, safeGroupedPage + 1))} disabled={safeGroupedPage === totalGroupPages} aria-label={t('table.nextPage')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setGroupedPage(totalGroupPages)} disabled={safeGroupedPage === totalGroupPages} aria-label={t('table.lastPage')}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  // Every branch fills the remaining height (flex-1 + min-h-0) so the
  // BulkActionBar rendered *after* gridContent stays inside the flex column
  // and remains visible; otherwise an h-full table pushes the bar past the
  // bottom of an overflow-hidden ancestor and clips it.
  //
  // objectstack#26896 — on a phone (`useCardView`, the plain list's card
  // breakpoint) a grouped list draws the same bands in the same order, each
  // followed by its rows as the plain list's cards and by its footer (a
  // server-grouped group's pager), in one vertical scroller like the plain
  // card list's. A band keeps its toggle and count, `groupedPager` still
  // pages whole groups, and the desktop table's columns never reach a phone.
  const gridContent = isGrouped && useCardView ? (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        data-fab-clearance=""
        data-testid="grouped-grid-card-scroller"
      >
        {(() => {
          const renderMobileCard = buildMobileCardRenderer();
          return groupBandsOf(pagedGroups).map((group) => (
            <div key={group.key} data-testid="grouped-grid-card-band">
              {group.band}
              {group.rows.length > 0 && (
                <div className="space-y-2 px-2 pb-2">{group.rows.map(renderMobileCard)}</div>
              )}
              {group.footer}
            </div>
          ));
        })()}
      </div>
      {groupedPager}
    </div>
  ) : isGrouped ? (
    <div className="flex flex-col flex-1 min-h-0">
      {/* One scroller for the one grouped table (objectui#12620): it holds
          both scrollbars, and the table's sticky header sticks to its top
          over every band. It draws the shared overflow affordance
          (objectui#12708): with a right-pinned column the shadow sits at that
          column's seam, otherwise at the box's right edge. */}
      <HorizontalOverflowBox
        seam={pinnedRightCols.length > 0 ? 'pinned' : 'edge'}
        outerClassName="flex flex-col flex-1 min-h-0"
        className="flex-1 min-h-0 overflow-auto [-webkit-overflow-scrolling:touch]"
        data-testid="grouped-grid-scroller"
      >
        <div className="min-w-max">
          <SchemaRenderer schema={buildGroupedTableSchema(groupBandsOf(pagedGroups))} />
        </div>
      </HorizontalOverflowBox>
      {groupedPager}
    </div>
  ) : (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col flex-1 min-h-0">
        <SchemaRenderer schema={dataTableSchema} />
      </div>
      {summaryFooter}
    </div>
  );

  // objectui#11068 — `emptyState`: what the grid draws INSTEAD of an empty
  // table, through the same shared component (`DataEmptyState`) and the same
  // icon resolver (`resolveIcon`) `ListView` draws a list's empty state with,
  // so one key means one picture on both surfaces.
  //
  // Drawn only when the author declared it, the grid holds no row to draw (no
  // group, when grouped) and nothing is loading — and NOT when a term typed
  // into this grid's own server-side search box is what emptied it: replacing
  // the table there would take the search box with it, and the user could not
  // clear the term. That case keeps the table's own "no results" row. Rows the
  // browser filters itself never reach here: `data` still holds them.
  //
  // A member left out keeps the grid's default: `DataEmptyState`'s own glyph
  // (an icon name that resolves to nothing is the same as none), the table's
  // "No results found" heading, and no message line. No add-record action, as
  // the table's empty row draws none either.
  //
  // objectui#12270 — the one action it does draw is the authored `link`,
  // `{ label, url }`, through the one shared `EmptyStateLink` that `ListView`'s
  // empty state draws it with, so the click is the action runner's navigation
  // (`classifyNavigationTarget`) here too. ⛔ No scheme test of its own.
  //
  // objectui#11227 — `title` and `message` are the spec's `I18nLabel`: a plain
  // string or an inline locale map. Each is resolved against the display locale
  // the way `description` above is, so a map draws its locale's entry instead of
  // reaching `DataEmptyState` as an object (React refuses an object child). A map
  // with no usable entry resolves to nothing and keeps that member's default.
  const authoredEmptyState = schema.emptyState;
  const authoredEmptyTitle = resolveInlineI18nLabel(authoredEmptyState?.title, displayLocale);
  const authoredEmptyMessage = resolveInlineI18nLabel(authoredEmptyState?.message, displayLocale);
  const searchEmptiedRows = manualSearchOn && manualSearch.trim() !== '';
  const holdsNoRows = !loading && (isGrouped ? groups.length === 0 : data.length === 0);
  const drawsAuthoredEmptyState = authoredEmptyState != null
    && holdsNoRows
    && !searchEmptiedRows;
  // objectui#13142 — with no authored `emptyState`, an empty grid used to fall
  // through to the table's own empty row, "No results found / Try adjusting
  // your filters or search query.", which is the right sentence only when the
  // USER's query emptied it. Over an object that has no record and a grid
  // nobody searched, there is no filter to adjust. So the grid tells the two
  // apart, the way `ListEmptyState` (plugin-list) does, with the same `list.*`
  // copy:
  //
  // - a search term (this grid's own box, or the host's `search`) is the
  //   user's query: the table stays, with its row and its search box, so the
  //   term can be cleared;
  // - the declared `filter` alone is the view's, not the user's: "No matching
  //   records / No records match this view's filter." — never the first-run
  //   invitation over an object that may be full of records (objectui#4155);
  // - neither: the first-run copy, "Nothing here yet / Create your first
  //   record to get started.", which points at the host's own create control.
  //
  // This grid has no user-filter or quick-filter control of its own. The one
  // host that merges its user's filters into `filter` (`ListView`, for a grid
  // grouping on the server) draws its own empty state before it mounts this
  // grid, from its window fetched under the same filter.
  const userQueryEmptiedRows = querySearchTerm.trim() !== '';
  const drawsDefaultEmptyState = authoredEmptyState == null
    && holdsNoRows
    && !userQueryEmptiedRows;
  const viewFilterEmptiedRows = schemaFilter !== undefined;
  // objectstack#25898 — the two cases `ListEmptyState` tells apart, the same
  // way: a declared filter naming the signed-in user (the "my …" view) emptied
  // the grid because the caller has none yet; and with no filter, a caller
  // KNOWN not to hold the create grant (the `listNew` row, asked once the
  // permission answer has loaded — an unloaded provider answers every grant
  // closed) is told there is nothing here they can see, never invited to
  // create the first record.
  //
  // The filter is read as `ListEmptyState`'s `filterNamesCurrentUser` reads it,
  // shape-agnostic: some string comparand is the caller's id (the host usually
  // resolved the placeholder already) or the `{current_user_id}` placeholder
  // itself. Neither package depends on the other, so the walk is restated here.
  const namesCurrentUser = (node: unknown): boolean => {
    if (typeof node === 'string') {
      return /^\$?\{current_user_id\}$/.test(node)
        || (!!filterScope.currentUserId && node === filterScope.currentUserId);
    }
    if (Array.isArray(node)) return node.some(namesCurrentUser);
    if (node && typeof node === 'object') return Object.values(node).some(namesCurrentUser);
    return false;
  };
  const ownFilterEmptiedRows = viewFilterEmptiedRows && namesCurrentUser(schemaFilterSource);
  const createKnownDenied = perms.isLoaded && !resolveAffordance('listNew', affordanceSource).allowed;
  const defaultEmptyCopy = ownFilterEmptiedRows
    ? { title: 'list.ownedNoneTitle', message: 'list.ownedNoneMessage' }
    : viewFilterEmptiedRows
      ? { title: 'list.noMatches', message: 'list.viewFilterNoMatchesMessage' }
      : createKnownDenied
        ? { title: 'list.noneVisibleTitle', message: 'list.noneVisibleMessage' }
        : { title: 'list.firstRunTitle', message: 'list.firstRunMessage' };
  const AuthoredEmptyIcon = drawsAuthoredEmptyState ? resolveIcon(authoredEmptyState?.icon) : null;
  const renderedGridContent = drawsDefaultEmptyState ? (
    <DataEmptyState
      data-testid="object-grid-empty-state"
      className="flex-1 min-h-[200px]"
      title={t(defaultEmptyCopy.title)}
      description={t(defaultEmptyCopy.message)}
    />
  ) : drawsAuthoredEmptyState ? (
    <DataEmptyState
      data-testid="object-grid-empty-state"
      className="flex-1 min-h-[200px]"
      // The annotation the other `resolveIcon` seam call sites carry: it returns
      // a STABLE, cached component per icon name; it does not create one during
      // render. The rule cannot see that through a call.
      // eslint-disable-next-line react-hooks/static-components
      icon={AuthoredEmptyIcon ? <AuthoredEmptyIcon className="size-5 text-muted-foreground" /> : undefined}
      title={authoredEmptyTitle || t('table.noResults')}
      description={authoredEmptyMessage || undefined}
      action={authoredEmptyState?.link
        ? <EmptyStateLink link={authoredEmptyState.link} displayLocale={displayLocale} />
        : undefined}
    />
  ) : gridContent;

  // Rendered BulkActionDialog (shared across both render branches).
  //
  // ⭐ objectui#9722: `dataSource` reaches this hand-off through a `!`, and
  // that non-null assertion is ALL that is erased here. It used to be an
  // `as any`, and measured on this branch that cast was paying for two
  // separate things at once: the optional-vs-required arm (this grid declares
  // `dataSource?: DataSource`, the dialog demands one) AND the structural
  // assignability of the four data-source members — which did not hold,
  // because the executor's face still spelled the pre-objectui#9511
  // `ReadonlyArray<string | number>` for the two bulk doors. Deriving those
  // two doors from `DataSource` (see `BulkExecutorOptions`) makes the second
  // one hold for real, so only the first still needs erasing, and any future
  // drift of that face reddens HERE instead of passing silently.
  //
  // ⚠️ The `!` is not an idle tidy-up of the same lie: it preserves exactly
  // today's runtime behaviour (a grid with no `dataSource` still hands the
  // dialog `undefined`), and it is the one arm a type cannot check for us.
  const bulkDialog = (
    <BulkActionDialog
      def={activeBulkDef}
      rows={activeBulkRows}
      skippedCount={activeBulkSkipped}
      open={!!activeBulkDef}
      onClose={handleBulkDialogClose}
      dataSource={dataSource!}
      resource={schema.objectName ?? ''}
      objectDef={objectSchema}
      objectFields={objectSchema?.fields}
      runAction={runBulkActionRecord}
      runAggregate={runBulkActionAggregate}
    />
  );

  // A row save's 409, on the record surfaces' own dialog (objectui#12292).
  // Shared across both render branches, like the bulk dialog above.
  const rowConflictDialog = (
    <ConcurrentUpdateDialog
      open={!!rowConflict}
      conflict={rowConflict}
      onReload={() => settleRowConflict('reload')}
      onOverwrite={() => settleRowConflict('overwrite')}
      onCancel={() => settleRowConflict('cancel')}
    />
  );

  return (
    <div ref={pullRef} className="relative h-full flex flex-col">
      {/* Re-fetch indicator while existing rows remain visible (filter/sort
          change). The initial-load skeleton above handles the empty case. */}
      <RefreshIndicator active={loading && data.length > 0} ariaLabel={t('grid.refreshing')} />
      {pullDistance > 0 && (
        <div
          className="flex items-center justify-center text-xs text-muted-foreground"
          style={{ height: pullDistance }}
        >
          {isRefreshing ? t('grid.refreshing') : t('grid.pullToRefresh')}
        </div>
      )}
      {gridDescription}
      {gridToolbar}
      {renderedGridContent}
      <BulkActionBar
        selectedRows={selectedRows}
        actions={effectiveBulkActions ?? []}
        actionDefs={bulkActionDefs}
        objectFields={objectSchema?.fields}
        onAction={dispatchBulkAction}
        onActionDef={dispatchBulkActionDef}
        onClearSelection={resetSelection}
        pageSize={data.length}
        totalMatching={canOfferSelectAllMatching ? resolvedTotalMatching : undefined}
        allMatchingSelected={selectAllMatching}
        onSelectAllMatching={canOfferSelectAllMatching ? () => setSelectAllMatching(true) : undefined}
      />
      {navigation.isOverlay && (
        <NavigationOverlay
          {...navigation}
          title={detailTitle}
          {...recordOverlayShellProps}
        >
          {(record) => renderRecordDetail(record)}
        </NavigationOverlay>
      )}
      {bulkDialog}
      {rowConflictDialog}
    </div>
  );
};
