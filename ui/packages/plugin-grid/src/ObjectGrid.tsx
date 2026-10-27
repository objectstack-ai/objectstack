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
import type { ObjectGridSchema, DataSource, DependsOnInput, ListColumn, ViewData, TableSortItem, DataTableSchema, ListViewExportFormat, RecordNavigateAction } from '@object-ui/types';
import { isSystemManagedField, normalizeTableColumnType } from '@object-ui/types';
import { parseFilterAST, resolveFieldScale, type FilterCondition } from '@objectstack/spec/data';
import { SchemaRenderer, useDataScope, useNavigationOverlay, useAction, useSafeFieldLabel, usePredicateScope, useCapabilityGate, useDataInvalidation, notifyDataChanged, useMetadata } from '@object-ui/react';
// objectui#8920 — the grid reaches a cell renderer through THIS module and
// nowhere else. `getCellRenderer` / `resolveCellRendererType` are deliberately
// NOT imported here: six sites spelling the resolve three different ways is
// what dropped a `format`-hinted column's renderer, and one shared owner is
// what stops a seventh site picking a convention of its own.
import { resolveGridCellRendering, gridCellRendererForFixedKey, linkCellRenderer, BADGE_PREFIX_RENDERER_KEY } from './cellRendererResolution';
import { isMaskedGridColumn, isWithheldGridColumn } from './maskedColumn';
import { formatCurrency, formatCompactCurrency, formatDate, formatDateTime, formatRelativeDate, formatPercent, percentCellScale, humanizeLabel, getBadgeColorClasses, getBadgeHexAppearance, FieldEditWidget, hasFieldEditWidget, DISCRETE_EDIT_TYPES, coerceToSafeValue, MaskedCellRenderer, withKnownObjects, RICH_TEXT_FIELD_TYPES } from '@object-ui/fields';
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
import { stateMachineNextValues, isFieldInlineEditable } from './inline-edit-options';
import {
  Badge, Button, NavigationOverlay, EmptyValue,
  legacyRecordDrawerWidthKey, recordOverlayWidthStorageKey, useOverlayAnchor,
  Popover, PopoverContent, PopoverTrigger,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  RefreshIndicator,
  DataEmptyState, EmptyStateLink, resolveIcon,
  HorizontalOverflowBox, PINNED_RIGHT_SEAM_SHADOW_CLASSES,
  toast,
} from '@object-ui/components';
import { usePullToRefresh } from '@object-ui/mobile';
import { resolveConditionalFormatting, resolveDependsOnFields, isDeadlineSettled, leadWithNameField, declaredNameField, buildExpandFields, buildExportFileName, columnIdentity, collectPredicateFieldRefs, collectGroupingFieldRefs, listViewPredicates, resolveAffordance, resolveFieldAffordance, type SchemaLike, isProjectableField, isExpandableFieldType, isUnmaterializedFieldType, readObjectSortability, isPlatformSortableField, filterPlatformSortableSort, filterRefusalSubject, FilterOperatorError, convertSortToQueryParams, normalizeSortEntries, type QuerySortEntry, resolveRecordSourceConfig, resolveRecordSourceObjectName, partitionRowsByPredicate, buildCategoryOrder, buildCategoryRank, toDisplayDate } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import {
  RECORD_OVERLAY_DEFAULT_WIDTH,
  RecordDetailPanel,
  ConcurrentUpdateDialog,
  isConcurrentUpdateError,
  useDetailTranslation,
  type ConcurrentUpdateConflict,
} from '@object-ui/plugin-detail';
import { ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Download, Rows2, Rows3, Rows4, AlignJustify, Type, Hash, Calendar, CheckSquare, User, Tag, Clock, Loader2 } from 'lucide-react';
import { useRowColor } from './useRowColor';
import { useGroupedDataInOptionOrder, usableGroupingFields, type GroupOptionRanks, type ServerGroupSource } from './useGroupedData';
import { groupSearchOf, useServerGroupHeaders, useServerGroupRows, type ServerGroupLeaf } from './useServerGrouping';
import { GroupRow } from './GroupRow';
import { useScopedColumnSummary } from './useColumnSummary';
import { useWholeSetSummary } from './useWholeSetSummary';
import { resolveRowCrudAffordances, resolveRowRecordCrudAffordance } from './rowCrudAffordances';
import { useRecordCrudVerdicts } from './hooks/useRecordCrudVerdicts';
import { resolveLegacyRowActions } from './resolveLegacyRowActions';
import { applyRelationalMeta } from './relationalMetaKeys';
import { resolveBulkActions, resolvePromotedBulkParams } from './resolveBulkActions';
import { partitionBulkRows } from './bulkEligibility';
import { resolvesToDataColumn } from './columnSpellingDiagnostics';
import { RowActionMenu, formatActionLabel, planRowActionMenu } from './components/RowActionMenu';
import { BulkActionBar } from './components/BulkActionBar';
import { BulkActionDialog } from './components/BulkActionDialog';
import type { BulkResult } from './hooks/useBulkExecutor';
import type { BulkActionDef } from '@object-ui/types';
import { findParamsSignature } from './objectGridQuery';
import { type ObjectGridColumn, type ObjectGridColumnDraft, isChipFieldType, normalizeColumns, resolveColumnLabel } from './objectGridColumns';
import { LinkCell, recordPointerFace, rowRecordId } from './objectGridLinkCell';
import { useGridTranslation } from './objectGridTranslations';
import { DEFAULT_DISPLAY_PAGE_SIZE, DEFAULT_SELECTION_TYPE, type RowHeightMode, resolvePageSize, resolveRowHeightMode } from './objectGridDefaults';
import { type BatchSaveOutcome, OCC_TOKEN_FIELD, type RowConflictChoice, type WrittenRowVersion, rowVersionOf, rowVersionToSend } from './objectGridRowVersion';
import { type ObjectGridColumnState, type ObjectGridExternalPaginationProps, type ObjectGridFooterSummary } from './objectGridProps';
import { FooterSummaryReport } from './objectGridFooterSummaryReport';
import { useObjectGridDiagnostics } from './objectGridDiagnostics';
import { useObjectGridQueryInputs } from './objectGridQueryInputs';
import { useObjectGridGroupingDecisions } from './objectGridGroupingDecisions';
export type { RetiredListColumnKey, ObjectGridColumnHolds, ObjectGridColumnDraft, ObjectGridColumn } from './objectGridColumns';
export type { ObjectGridColumnState, ObjectGridFooterSummary, ObjectGridExternalPaginationProps } from './objectGridProps';

/**
 * A declared `sort` → the `"field order"` join string THIS block sends as
 * `$orderby` (objectui#8973).
 *
 * ⚠️ Read the split before editing either half. WHICH entries survive and what
 * a missing `order` means is `normalizeSortEntries`' decision — the governed
 * one in `@object-ui/core`, shared with `convertSortToQueryParams` and every
 * sibling block. Only the JOIN is this block's, because only this block sends
 * a join string: the sink's `{field: direction}` map is route B on
 * objectui#8767, declined by the maintainer 2026-09-10 pending a card that
 * measures the server contract and both readers. So the operation with two
 * copies (the normalization) has one implementation, and the shape the
 * declination protects does not move.
 *
 * What this closes: the arms below used to interpolate every key
 * unconditionally, so an entry missing `field` or `order` reached the wire as
 * the literal text `undefined`. `$orderby: 'name undefined'` is not a
 * degraded ordering — `normalizeSortNodes` (`@objectstack/metadata-protocol`,
 * the one normalizer every server ingress funnels through) reads `undefined`
 * as a direction that is "neither 'asc' nor 'desc'" and answers
 * `400 INVALID_QUERY`.
 *
 * @returns `undefined` when nothing orderable survives, so the caller omits
 * `$orderby` entirely instead of sending `""` — the same correction
 * `toFilterNode` already made for `$filter: {}` on the filter leg above.
 */
function toOrderByClause(sort: QuerySortEntry[] | undefined | null): string | undefined {
  const ordered = normalizeSortEntries(sort);
  if (!ordered) return undefined;
  return ordered.map((s) => `${s.field} ${s.order}`).join(', ');
}

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


/**
 * [objectui#13234] The face a date-family CELL paints, for one grouping field:
 * the renderer key from the cells' one shared resolve
 * (`resolveGridCellRendering`), and the object field's `format`, which is the
 * `format` the cell's field metadata carries.
 */
interface TemporalGroupFace {
  rendererType: 'date' | 'datetime';
  format?: string;
}

/**
 * [objectui#13234] A `date` / `datetime` group's key, drawn as the grid's cell
 * draws the same value. `undefined` for a key the cell has no face for (empty
 * or unparsable), so the band keeps the group's own label: "(empty)" for an
 * empty key, the stored text otherwise.
 *
 * The formatting CALLS are the cells' own, with the cells' arguments:
 * `DateCellRenderer` in a grid column (`inGridColumn`, objectstack#25884)
 * paints `formatDate(value, format || undefined, …)`, the absolute default
 * face when no `format` is declared;
 * `DateTimeCellRenderer` paints `formatRelativeDate` for `'relative'`, the
 * compact face for no format and for `'short'`, and `formatDateTime` with the
 * authored word otherwise (the compact face's string is the cell's two halves
 * joined by the one space the cell draws between them). No date is formatted
 * here. The face SELECTION is the one part those renderers do not export, and
 * it is restated here only: `groupDateHeading-13234.test.tsx` holds every
 * heading to the cell under it for every face, so a move on either side turns
 * it red.
 *
 * A heading names a DAY, not one row's deadline, so it reads the face's
 * neutral phrase: `dueLike`'s "Overdue" wording and red are a per-row verdict
 * (`settledWhen` is judged per row), and the rows of one group can judge it
 * differently.
 */
function temporalGroupHeading(
  face: TemporalGroupFace,
  key: unknown,
  locale: string | undefined,
): string | undefined {
  if (typeof key !== 'string' && typeof key !== 'number') return undefined;
  // The cells' floor: every falsy scalar is empty, the numeric epoch included.
  if (!key) return undefined;
  // The cells' validity guard, the shared parse step.
  if (isNaN(toDisplayDate(key).getTime())) return undefined;
  if (face.rendererType === 'date') return formatDate(key, face.format || undefined, { locale });
  // A `datetime` cell renders an INSTANT, from the engine's parse.
  const instant = new Date(key);
  const style = !face.format || face.format === 'short' ? 'compact' : face.format;
  return style === 'relative'
    ? formatRelativeDate(instant, { locale })
    : formatDateTime(instant, { style, locale });
}

export const ObjectGrid: React.FC<ObjectGridComponentProps> = ({
  schema,
  dataSource,
  onEdit,
  onDelete,
  rowOperations,
  rowAdornment,
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

  // Sync internal rowHeightMode when schema.rowHeight prop changes (e.g., parent ListView density toggle).
  // Routed through the same resolver as the seed above: this is the component's
  // second entry point for an author-supplied `rowHeight`, and one resolver at
  // every entry is what keeps the answer single (objectui#4443).
  React.useEffect(() => {
    if (!schema.rowHeight) return;
    const next = resolveRowHeightMode(schema.rowHeight);
    if (next !== rowHeightMode) {
      setRowHeightMode(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.rowHeight]);

  // Column state persistence (order and widths)
  const columnStorageKey = React.useMemo(() => {
    return schema.id
      ? `grid-columns-${schema.objectName}-${schema.id}`
      : `grid-columns-${schema.objectName}`;
  }, [schema.objectName, schema.id]);

  /**
   * NON-AUTHOR SURFACE — `columnState` is deliberately absent from
   * `GRID_QUERY_INPUTS` (`index.tsx`), by the maintainer ruling of 2026-08-18
   * on objectui#5091. The cast reads in this block are therefore DELIBERATELY
   * unlisted, not missed.
   *
   * It is the USER-STATE persistence payload, not authoring surface: the host
   * hands in whatever the user last saved (app-shell's `ObjectView` reads it
   * off the user's own list state, then off the view def) and stores their
   * drags back on that state (`persistListColumnState` there; `saveColumnState`
   * below is the outbound half). Publishing it would put
   * column widths and order in the designer panel and in the generated
   * `sdui-intrinsics.d.ts` — i.e. bless hand-authoring a payload the product
   * writes on the user's behalf.
   *
   * The contract says the same thing independently: `ComponentPropsMap
   * ['object-grid']` (`@objectstack/spec@17`) is a `strictObject` and rejects
   * `columnState` BY NAME (`unrecognized_keys`), so an author who took the
   * offer could not save the document. Both halves — unlisted here, rejected
   * there — are pinned by `__tests__/gridNonAuthorKeys.test.tsx`, together with
   * the reads themselves, so this exemption cannot decay into a silent drop.
   */
  const [columnState, setColumnState] = useState<ObjectGridColumnState>(() => {
    // Priority: 1) externally provided (e.g. persisted view override),
    // 2) localStorage (per-browser fallback), 3) empty.
    const fromProps = (schema as any).columnState;
    if (fromProps && typeof fromProps === 'object') return fromProps;
    try {
      const saved = localStorage.getItem(columnStorageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Sync when external columnState changes (e.g. switching views, reload pulls
  // a saved override from the server). Wrapped in a stable string key to
  // avoid re-renders when the parent passes a fresh-but-equal object.
  // Non-author surface, same ruling as the seed above (objectui#5091): these
  // two reads are the host's inbound channel, never an authored key.
  const externalColumnStateKey = React.useMemo(
    () => JSON.stringify((schema as any).columnState ?? null),
    [(schema as any).columnState]
  );
  React.useEffect(() => {
    const fromProps = (schema as any).columnState;
    if (fromProps && typeof fromProps === 'object') {
      setColumnState(fromProps);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalColumnStateKey]);

  const saveColumnState = useCallback((state: typeof columnState) => {
    setColumnState(state);
    try {
      localStorage.setItem(columnStorageKey, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to persist column state:', e);
    }
    // Notify the host so it can persist the layout (the console stores it on
    // the signed-in user's own list state).
    if (typeof onColumnStateChange === 'function') {
      try { onColumnStateChange(state); } catch (e) { console.warn('onColumnStateChange threw:', e); }
    }
  }, [columnStorageKey, onColumnStateChange]);

  const handlePullRefresh = useCallback(async () => {
    setRefreshKey(k => k + 1);
  }, []);

  const { ref: pullRef, isRefreshing, pullDistance } = usePullToRefresh<HTMLDivElement>({
    onRefresh: handlePullRefresh,
    enabled: !!dataSource && !!schema.objectName,
  });

  // Activate the mobile card view below the 768px app mobile breakpoint so
  // phones and tablet-portrait never need to side-scroll a wide grid.
  useEffect(() => {
    const checkWidth = () => setUseCardView(window.innerWidth < 768);
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

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

  // objectui#10035 — the refresh input this grid had none of, so a host could
  // show it a write only by remounting it (AGENTS.md #8's corollary: refresh
  // data, don't rebuild UI). The nonce moves when the data-invalidation bus
  // reports a change to the object this grid FETCHES, and the load effect below
  // names it, so the rows are re-read in place — the table stays mounted
  // (`RefreshIndicator`, not the skeleton), and with it selection, scroll,
  // column state and any open inline edit. Subscribed only when the grid
  // fetches for itself: rows a host handed down (`data`, `bind`, an inline
  // `value` set) are the host's to refresh, and a nonce there would only
  // re-render for nothing.
  const invalidationNonce = useDataInvalidation(hasInlineData ? undefined : objectName);

  // --- Unified async data loading effect ---
  // Combines schema fetch + data fetch into a single async flow with AbortController.
  // This avoids the fragile "chained effects" pattern where Effect 1 sets objectSchema,
  // triggering Effect 2 to call fetchData — a pattern prone to infinite loops when
  // fetchData's reference is unstable.
  useEffect(() => {
    if (hasInlineData) return;
    // A refused `schema.filter` never reaches the wire (objectui#9050). The
    // malformed-filter branch in the render shows it instead; this guard is
    // what keeps "no filter node" from being read as "no filter" by the query
    // built below.
    if (schemaFilterRefusal) return;

    let cancelled = false;

    const loadSchemaAndData = async () => {
      setLoading(true);
      setError(null);
      try {
        // --- Step 1: Resolve object schema ---
        let resolvedSchema: any = null;
        const cols = normalizeColumns(schemaColumns) || schemaFields;

        if (objectName && dataSource) {
          // Always fetch full schema for field type metadata (enables rich type-aware rendering)
          if (typeof dataSource.getObjectSchema === 'function') {
            const schemaData = await dataSource.getObjectSchema(objectName);
            if (cancelled) return;
            resolvedSchema = schemaData;
          } else {
            resolvedSchema = { name: objectName, fields: {} };
          }
        } else if (cols && objectName) {
          // Fallback: minimal schema stub when no dataSource available
          resolvedSchema = { name: objectName, fields: {} };
        } else if (!objectName) {
          throw new Error('Object name required for data fetching');
        } else {
          throw new Error('DataSource required');
        }

        if (!cancelled) {
          setObjectSchema(resolvedSchema);
        }

        // --- Step 2: Fetch data ---
        // [objectui#10881] A grouping this data source cannot count is refused
        // before any row is asked for; the render names the missing member.
        if (groupingNeedsHeaderQuery) return;
        if (dataSource && objectName) {
          // [objectui#7179] The fields the view GROUPS BY. `grouping` is a
          // sibling of `columns` in the spec, not a subset of it, so a grid may
          // legitimately group by a field it never shows — and until this
          // harvest existed, `$select` (built from `columns` alone) never asked
          // for it, so every row carried `undefined` and `useGroupedData`
          // labelled ONE group `(empty)` holding every record.
          //
          // Raw here, GATED at each of its two use sites below, because the two
          // sites need different gates: the projection has to intersect with
          // the declared fields (an unknown `$select` key ZEROES the list on
          // backends that reject rather than ignore it), while `$expand` is
          // gated structurally by `buildExpandFields` itself.
          const groupingFieldRefs = collectGroupingFieldRefs(schema.grouping);
          const getSelectFields = () => {
            // Always include 'id' so row click / navigation handlers can resolve
            // the record key — without it `record.id` is undefined and the
            // primary-field link silently no-ops.
            // Both halves used to resolve identity differently — the probe was
            // name-first while the projection below read `c.field` alone — so a
            // legacy `{name}` column was projected as `undefined` while the
            // probe happily saw its name (#3104). One reader now, both halves.
            const ensureId = (list: any[]): any[] => {
              const names = list.map((f: any) => columnIdentity(f));
              return names.includes('id') ? list : ['id', ...list];
            };
            // [objectui#6898] FIELD-LEVEL SECURITY ON THE PROJECTION — the FETCH
            // half of the gap objectui#6799 closed on the RENDER half.
            //
            // objectui#6799 made `generateColumns()` drop a column naming a
            // declared field the principal cannot read. That is what reaches the
            // SCREEN. This is what goes on the WIRE: without this gate the same
            // field name is still handed to the server in `$select`, so a
            // backend that does not enforce FLS on the projection would return
            // the value into `data` with no column on screen to reveal it.
            //
            // ⭐ MEASURED, not assumed (the escalation gate this card was graded
            // on). ObjectStack's own server DOES enforce it — but on the RECORD,
            // not on the projection. `plugin-security`'s read middleware runs
            // `FieldMasker.maskResults`, whose `maskRecord` DELETES an unreadable
            // key from every returned row, and `predicate-guard.ts` says in terms
            // that the projection is deliberately NOT guarded because "selecting
            // a hidden field is harmless because FieldMasker strips it from the
            // result". Pinned end-to-end over real HTTP by objectstack's
            // `showcase-fls-read-mask-strip.dogfood.test.ts`: an explicit
            // `?select=name,<denied>` answers 200 with the denied key ABSENT.
            // So against ObjectStack this gate is defence-in-depth (p2), exactly
            // as triage graded it — it is NOT load-bearing for that backend, and
            // this comment is what stops a future reader from concluding it is.
            // It becomes load-bearing for any other backend, which is the same
            // argument the objectui#6723 / objectui#6799 rulings accepted: the
            // invariant must not rest on every future backend having enforced it.
            //
            // ⭐ THE DECLARED-KEY LIMIT IS THE SAME ONE, AND THE CARD IS RIGHT
            // THAT THE REASONING DOES NOT TRANSFER AUTOMATICALLY — it has to be
            // re-derived here, and it lands in the same place. On the render path
            // an undeclared key is a legitimate derived / host-joined column. In
            // a `$select` an undeclared key is what the host asked the SERVER
            // for, so the question is genuinely different. It resolves the same
            // way for a reason that is about `checkField`, not about drawing:
            // `checkField` answers FALSE for a field the policy has never heard
            // of, so judging an undeclared key is not a stricter reading of this
            // rule — it is a different, wrong one, and it would strip a host's
            // derived or joined column out of its own query. Undeclared ⇒ not
            // this gate's business, on both halves.
            //
            // ⛔ NAVIGATION IS PRESERVED STRUCTURALLY, NOT BY A SPECIAL CASE:
            // every call below composes `ensureId(...)` AFTER this gate, so `id`
            // is re-added even in the pathological case where a policy marks it
            // unreadable. A gate that filtered `id` out last would break row
            // click / navigation for everyone — the naive-filter failure the
            // card names by name. Keeping the restoration in the composition
            // rather than in a branch here means it cannot drift out of one arm.
            //
            // Keyed on `objectName` (the object actually being FETCHED —
            // `dataConfig.object` when a data block names one) rather than the
            // render half's `schema.objectName`: the projection is judged against
            // whatever object the server is about to read.
            const passesProjectionGate = (entry: unknown): boolean => {
              // Not loaded ⇒ nothing to ask yet; never filter on an unanswered
              // policy. Same deferral as the render half — and the fetch effect
              // re-runs on `perms.isLoaded` so the projection is rebuilt the
              // moment the answer arrives (without that dep this gate would be
              // dead on the first, and usually only, fetch).
              if (!perms?.isLoaded || !objectName) return true;
              const fieldName = columnIdentity(entry);
              // No readable identity ⇒ nothing to ask the policy about.
              if (!fieldName) return true;
              // Undeclared ⇒ host-joined / derived / platform column ⇒ see above.
              // `hasOwnProperty` rather than a truthiness read so an inherited
              // name (`constructor`, `toString`) cannot be mistaken for a
              // declared field and dropped out of the query.
              if (!Object.prototype.hasOwnProperty.call(resolvedSchema?.fields ?? {}, fieldName)) return true;
              return perms.checkField(objectName, fieldName, 'read');
            };
            // Fields the view's PREDICATES read but no column shows
            // (objectui#3501). Without them the projection asks the
            // server for everything except the field a row action is gated on,
            // and CEL faults on the absent key (`No such key`) rather than
            // reading it as null — which fail-closed hides the button for
            // everyone, with nothing pointing at the projection. Kept to fields
            // the object actually declares: an unknown key in `$select` is not
            // ignored by every backend, and a typo'd predicate must not be able
            // to zero the list.
            const declared = resolvedSchema?.fields;
            const predicateFields = declared
              ? collectPredicateFieldRefs(listViewPredicates({
                  conditionalFormatting: schema.conditionalFormatting as unknown[] | undefined,
                  // NON-AUTHOR SURFACE, same ruling as the seed above
                  // (objectui#5091, maintainer 2026-08-19): this cast read is
                  // deliberate, not a missed manifest entry. It is the SECOND
                  // of the key's two read sites and the one with teeth — a def
                  // gated on `record.<field>` puts that field in `$select`, so
                  // deleting this read would leave the predicate's operand out
                  // of the payload and CEL would fault on the absent key
                  // (objectui#3501, the whole reason this harvest exists).
                  // Pinned by `__tests__/gridNonAuthorKeys.test.tsx`.
                  rowActionDefs: (schema as any).rowActionDefs,
                  bulkActionDefs: (schema as any).bulkActionDefs,
                  objectActions: (resolvedSchema as any)?.actions,
                  // KEY COLLISION — `userActions` names TWO different blocks,
                  // and only the OBJECT's is interpretable here. This read is
                  // therefore `resolvedSchema`-only; it must never regain a
                  // `(schema as any).userActions ??` left operand. Maintainer
                  // ruling of 2026-08-20 on objectui#5240 (Q1=A), on these
                  // measurements against `@objectstack/spec@17.0.0`:
                  //
                  //   - VIEW-level `userActions` is TOOLBAR POLICY —
                  //     `UserActionsConfigSchema` (`sort`, `search`, `filter`,
                  //     `refresh`, `rowHeight`, `addRecordForm`, `editInline`,
                  //     `buttons`), which REJECTS `edit` BY NAME
                  //     (`unrecognized_keys`). `ListViewSchema` accepts it, so
                  //     it is spec-legal and really authored: `react/src/
                  //     spec-bridge/bridges/list-view.ts` copies it onto the
                  //     `object-grid` node this component receives as `schema`,
                  //     and `app-shell/src/views/ObjectView.tsx` builds one
                  //     unconditionally. It is NOT an unwritten key.
                  //   - OBJECT-level `userActions` is the CRUD-PREDICATE block
                  //     (`edit` / `delete` / `create` carrying `visibleWhen` /
                  //     `disabledWhen`, objectui#2614) — what
                  //     `resolveRowCrudAffordances` consumes above, and the only
                  //     shape `listViewPredicates` can read: its loop skips
                  //     every non-object value, so a toolbar block yields ZERO
                  //     predicates.
                  //
                  // Read view-first, a legitimately authored toolbar block
                  // therefore SHADOWED the object's CRUD predicates and dropped
                  // their operands from `$select`; CEL then faults `No such
                  // key`, fails CLOSED, and the row Edit/Delete button vanishes
                  // for everyone with nothing pointing at the projection
                  // (objectui#3501 — the whole reason this harvest exists).
                  // Both halves of the collision, and this read itself, are
                  // pinned by `__tests__/gridNonAuthorKeys.test.tsx`.
                  userActions: (resolvedSchema as any)?.userActions,
                })).filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  // [objectui#6898] A predicate operand the principal cannot read
                  // is dropped from the projection too. This costs nothing that
                  // was working: against ObjectStack the server already DELETES
                  // that key from every row (measured above), so the operand was
                  // never arriving and the CEL predicate was already faulting
                  // `No such key` and failing CLOSED. Dropping it from `$select`
                  // changes what we ASK for, not what we got. Against a
                  // non-enforcing backend it converts "the button works, and the
                  // denied value sits in memory" into "the button hides" — which
                  // is the correct direction for a predicate gated on a field
                  // this principal may not read.
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#7179] The GROUPING fields, through the SAME two gates
            // the predicate operands take, for the same two measured reasons.
            //
            // `isProjectableField` first: a `grouping.fields[]` entry is
            // SPECULATIVE in exactly the sense that gate exists for. Its
            // `field` is a bare `z.ZodString` and this card's whole premise is
            // that it is NOT among the columns, so nothing has validated it.
            // Some backends answer an unknown `$select` key with an EMPTY
            // RESULT SET rather than ignoring it (the cloud multi-tenant
            // runtime does exactly that), so an unguarded union would trade
            // this card's bug — one `(empty)` group holding all the rows — for
            // a strictly worse one: NO rows, equally silently. The current bug
            // at least shows the data.
            //
            // `passesProjectionGate` second (objectui#6898): a grouping field
            // names a field just as capable of being denied as a column is, and
            // this is the half that goes on the WIRE. Gating here rather than
            // after the union is what keeps that card closed.
            const groupingFields = declared
              ? groupingFieldRefs
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#12292] The row's concurrency token. An inline-editable
            // grid's default save sends it as `If-Match` (`rowVersionOf`), so
            // every row has to carry it. A projection built from the columns
            // left it off each row no column showed it on, and the save went
            // out with no token at all. The same two gates as the harvests
            // above: a platform column, and one this principal may read.
            const concurrencyFields = carriesConcurrencyToken && declared
              ? [OCC_TOKEN_FIELD]
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#12393] The ROW COLOUR's field. `useRowColor` paints a
            // row from `row[rowColor.field]`, and the spec sets no column
            // requirement on that field, so a grid tinted by a field no column
            // shows fetched rows without it and painted nothing, with no error.
            // `ListView`'s harvest gained this arm in objectui#12376, but a
            // grouped grid owns its fetch (`gridOwnsGroupedFetch`) and so does
            // a standalone `object-grid`: this projection is the one their rows
            // arrive through. The same two gates as the harvests above: a field
            // the object declares (or a platform column), and one this
            // principal may read.
            const rowColorFields = rowColorField && declared
              ? [rowColorField]
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#11815] A shown DECLARED deadline's `settledWhen`
            // operands. The predicate reads the row exactly as a row action's
            // gate does, so a grid showing only Title and Due fetched rows
            // without `status`, CEL faulted `No such key`, and a done row's
            // deadline still read overdue. The same two gates as the harvests
            // above.
            const shownColumns = (schemaFields ?? (Array.isArray(schemaColumns) ? schemaColumns : [])) as unknown[];
            const deadlineFields = declared
              ? collectPredicateFieldRefs(
                  shownColumns
                    .map((entry) => (declared as Record<string, { dueLike?: unknown; settledWhen?: unknown } | undefined>)[columnIdentity(entry) ?? ''])
                    .filter((def) => def?.dueLike === true && def.settledWhen != null)
                    .map((def) => def!.settledWhen),
                )
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#13036] A shown `referenceVia` pointer column's TYPE
            // half. `recordPointerFace` resolves the record through
            // `resolveRecordPointer` (objectui#12608), which reads the sibling
            // off the ROW and answers null when it is absent, so a grid whose
            // columns show the id half but not its sibling fetched rows
            // without it and drew the raw record id. `ListView`'s harvest
            // carries the same arm; this is the projection a grouped grid that
            // owns its fetch (`gridOwnsGroupedFetch`) and a standalone
            // `object-grid` send. Asked of the columns this projection keeps (a
            // pointer the principal may not read is not drawn), then the same
            // two gates as the harvests above: a sibling the principal may not
            // read is not asked, and that row keeps the stored text.
            const referenceViaFields = declared
              ? shownColumns
                  .filter(passesProjectionGate)
                  .map((entry) => (declared as Record<string, { referenceVia?: unknown } | undefined>)[columnIdentity(entry) ?? '']?.referenceVia)
                  .filter((f): f is string => typeof f === 'string' && f !== '')
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#13214] A shown column's DECLARED `dependsOn` siblings.
            // A faced column reads them off the ROW (`dependentValues={row}`):
            // the `recipient-picker` face names a stored id by the row's
            // `recipient_type`, and draws the stored text when it is absent.
            // So a grid showing `recipient_id` but not `recipient_type` fetched
            // rows without the kind and drew the raw user id. Driven by the
            // declaration alone: every sibling the field names, nothing mapped
            // by name here. Asked of the columns this projection keeps and the
            // grid draws: a column the principal may not read, or one authored
            // `hidden: true`, pulls nothing. Then the same two gates as the
            // harvests above: a sibling the object does not declare is never
            // sent, and one the principal may not read is never asked.
            const dependsOnFields = declared
              ? shownColumns
                  .filter((entry) => !(entry && typeof entry === 'object' && (entry as { hidden?: unknown }).hidden === true))
                  .filter(passesProjectionGate)
                  .flatMap((entry) => resolveDependsOnFields(
                    (declared as Record<string, { dependsOn?: DependsOnInput } | undefined>)[columnIdentity(entry) ?? '']?.dependsOn,
                  ))
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#13107] The object's DECLARED name field. The bulk
            // confirm step names each affected record from the row this
            // projection fetched (`getRecordDisplayName`, ADR-0079), so a
            // `nameField` no column shows arrived absent and the step listed
            // another text field in its place (a contact's job title). Asked
            // by name whatever its type: the server serves a formula field
            // like any other. Fetched, never drawn: it joins the projection,
            // not the columns. The same two gates as the harvests above.
            const declaredName = declaredNameField(resolvedSchema);
            const nameFields = declared && typeof declaredName === 'string' && declaredName !== ''
              ? [declaredName]
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // A UNION, never an append: a grouping field that IS also a column
            // must not produce a duplicate `$select` entry.
            const extraFields = [...predicateFields, ...groupingFields, ...concurrencyFields, ...rowColorFields, ...deadlineFields, ...referenceViaFields, ...dependsOnFields, ...nameFields];
            const withHarvestedFields = (list: any[]): any[] => {
              if (extraFields.length === 0) return list;
              const names = new Set(list.map((f: any) => columnIdentity(f)));
              const seen = new Set<string>();
              const extra = extraFields.filter(
                (f) => !names.has(f) && !seen.has(f) && (seen.add(f), true),
              );
              return extra.length > 0 ? [...list, ...extra] : list;
            };
            // [objectui#11105] ONE projection for BOTH branches: gate, then read
            // each entry's field NAME through `columnIdentity`, then drop the
            // entries that have none. Only names go on the wire.
            //
            // The `schemaFields` branch used to return its entries UNMAPPED,
            // and `ListView` hands its effective column entries to the grid as
            // `fields` AND `columns` alike. So a view whose columns are objects
            // (`{ field, width }`) put the objects themselves into `$select`,
            // which the adapter's `join(',')` serialized as `[object Object]`.
            // Harmless while grouped grids got inline rows; since the grid
            // groups on the server (objectui#7189) every group's row page
            // carries this `$select`, and a server that refuses unknown select
            // keys answered INVALID_FIELD in every group. For a `fields` entry
            // that is already a name, `columnIdentity` hands it back unchanged.
            const projectFieldNames = (entries: unknown[]): string[] =>
              entries
                .filter(passesProjectionGate)
                .map((entry) => columnIdentity(entry))
                .filter((v): v is string => !!v);
            if (schemaFields) {
              return withHarvestedFields(ensureId(projectFieldNames(schemaFields as unknown[])));
            }
            if (schemaColumns && Array.isArray(schemaColumns)) {
              return withHarvestedFields(ensureId(projectFieldNames(schemaColumns)));
            }
            return undefined;
          };

          const params: any = {
            $select: getSelectFields(),
            $top: fetchWindow,
            $skip: (serverPage - 1) * fetchWindow,
          };

          // The block's declared `filter` input, already lowered to an AST at
          // the read point above. `undefined` means "no filter declared" —
          // including a declared-but-empty array, which `toFilterNode` folds
          // away so an empty `$filter` never goes out. The `Array.isArray` guard
          // this replaces predates the lowering and was itself a silent drop:
          // it read false for the MongoDB-style object shape, so such a filter
          // went missing and the grid answered with every record.
          if (schemaFilter !== undefined) {
            params.$filter = schemaFilter;
          }

          // Sort. A column-header click (objectui#3106) replaces the view's
          // declared sort for the whole collection — which is what makes the
          // arrow in the header true of the list rather than of this page.
          // The `SortNode[]` form goes out rather than the `"field order"`
          // string: it is the shape the server names in its own error messages,
          // and it survives a field name containing a space.
          if (headerSort && headerSort.length > 0) {
            params.$orderby = headerSort.map((s) => ({ field: s.field, order: s.order }));
          } else if (schemaSort) {
            if (typeof schemaSort === 'string') {
              // objectui#8767 — the legacy string `sort` clause is RETIRED
              // (objectui#8221, decision batch #77) and is REFUSED here rather
              // than lowered. This block owns a PRIVATE lowering, so #8758's
              // narrowing of the shared sink never reached it: a bare
              // `object-grid` went on honouring a spelling `object-view`
              // already refuses — one key meaning two things depending on which
              // block you are on, which is the per-block divergence the #8221
              // ruling declined by name.
              //
              // The refusal is #8758's OWN, not a second one: calling the
              // shared sink on this arm reports the retired spelling once per
              // spelling and answers `undefined`, so the query carries no
              // `$orderby`. Its return value is deliberately unused — the wire
              // shape stays this block's, and the array arm below is untouched
              // (with it the export path). The header-arrow reader
              // `parseSchemaSort` was left parsing the string HERE, and read
              // this same key more widely than this refusal until objectui#8961
              // narrowed it to the declared array; the two now agree. Routing
              // the whole key through the sink is still a different card: it
              // would send the sink's `{field: direction}` map where every grid
              // today sends a `"field order"` string.
              //
              // Read through `unknown`, exactly as the sink does: types are
              // erased, so the array-only `ObjectGridSchema.sort` declaration
              // cannot stop a string arriving from authored JSON, a stored
              // `sys_metadata` row or an `as any` bag.
              convertSortToQueryParams(schemaSort as unknown as QuerySortEntry[]);
            } else if (Array.isArray(schemaSort)) {
              // objectui#8973 — normalize before joining. Every key used to be
              // interpolated unconditionally, so `[{ field: 'name' }]` went out
              // as `'name undefined'` and `[]` as `''`. The join, and only the
              // join, stays this block's (see {@link toOrderByClause}).
              const orderBy = toOrderByClause(schemaSort as unknown as QuerySortEntry[]);
              if (orderBy !== undefined) {
                params.$orderby = orderBy;
              }
            }
          }
          // objectui#5861 — there is no third arm. The legacy single-entry
          // `defaultSort` was retired under ADR-0049: `@objectstack/spec`
          // refuses it by name on `object-grid` (since 17.3.0), so this chain
          // reads `sort` alone, and the header reader below reads the same key
          // the same way.

          // Search (objectui#3118). The term the toolbar box holds is a question
          // about the collection, so it goes to the server rather than to a
          // `.filter()` over the window we happen to be holding. Per ADR-0061 the
          // client sends only the term; the server resolves which fields it
          // matches from the object's metadata. `$searchFields` goes along only
          // when the view declared `searchableFields` — it can narrow that
          // server-resolved set, never widen it — which is exactly what the
          // ListView toolbar sends.
          const trimmedSearch = querySearchTerm.trim();
          if (trimmedSearch) {
            params.$search = trimmedSearch;
            if (schema.searchableFields && schema.searchableFields.length > 0) {
              params.$searchFields = schema.searchableFields;
            }
          }

          // Auto-inject $expand for lookup/master_detail fields
          //
          // [objectui#7179] The grouping fields ride along. `$select` alone
          // fetches a lookup as its BARE FOREIGN KEY, so a grid grouped by a
          // lookup would bucket by raw id ("8UY9zHWBfjYjYor4") instead of by
          // name — better than one `(empty)` bucket, still not right, and the
          // identical failure `expandFields` in `plugin-list` already records
          // for kanban. No `isProjectableField` gate is needed on THIS half:
          // `buildExpandFields` returns a subset of the object's declared
          // reference-bearing fields, so an unknown or non-relational grouping
          // field is dropped structurally and cannot reach the query.
          //
          // Only augment when a column list actually narrows the expansion —
          // with no columns, `buildExpandFields` already expands every relation
          // and the grouping fields are covered by that superset. Passing an
          // array here unconditionally would NARROW that case to the grouping
          // fields alone.
          //
          // [objectui#7215] FIELD-LEVEL SECURITY ON `$expand` — the half
          // objectui#6898 left open. That card gated `$select`, which asks for
          // a denied lookup's BARE FOREIGN KEY; `$expand` asks the server to
          // RESOLVE the same field and hand back the related record, so the
          // larger of the two disclosures was the ungated one.
          //
          // Graded the same way #6898 was, and by measurement rather than
          // assumption: against ObjectStack this is defence-in-depth, because
          // `plugin-security`'s `FieldMasker.maskRecord` does `delete
          // result[field]` on every unreadable key and objectql's expand path
          // writes the resolved record back under THAT SAME KEY
          // (`record[fieldName] = recordMap.get(...)`), so one statement
          // deletes the expanded object and the bare id alike. It is
          // load-bearing for a backend that does not strip.
          //
          // ⭐ THE GATE GOES ON THE OUTPUT, NOT ON THE COLUMN LIST, and both
          // reasons are measured (`__tests__/expandFls-7215.test.tsx` pins
          // each):
          //
          //  - `buildExpandFields` reads an EMPTY column list as "no column
          //    restriction" and falls back to every declared relation, so
          //    filtering its INPUT would WIDEN a view whose only relational
          //    column is denied from that one field to all of them;
          //  - the no-columns case passes `undefined`, so it has no input to
          //    gate at all — and it is the case that expands the most.
          //
          // Gating the output also satisfies, structurally, the ordering the
          // `$select` gate above spells out by hand (intersect with the
          // DECLARED fields first, ask `checkField` only about survivors):
          // `buildExpandFields` returns a subset of the object's declared
          // reference-bearing fields, so every name judged here is declared by
          // construction and the "`checkField` answers false for an undeclared
          // key" trap is unreachable. That is why this gate is SHORTER than
          // `passesProjectionGate` rather than a copy of it — no undeclared-key
          // arm, and no identity read, because these are resolved root names
          // rather than column entries.
          //
          // Deferral is the same as every other gate on this path: an
          // unanswered policy filters nothing, and the effect re-runs on
          // `perms.isLoaded`, so the expansion is rebuilt the moment the answer
          // arrives.
          const expandReadable = (fieldName: string): boolean => {
            if (!perms?.isLoaded || !objectName) return true;
            return perms.checkField(objectName, fieldName, 'read');
          };
          const expandColumns = schemaColumns ?? schemaFields;
          const expand = buildExpandFields(
            resolvedSchema?.fields,
            expandColumns ? [...(expandColumns as any[]), ...groupingFieldRefs] : undefined,
          ).filter(expandReadable);
          if (expand.length > 0) {
            params.$expand = expand;
          }

          // [objectui#7189] Server-grouped: no flat window is fetched. The
          // query is resolved here all the same — every gate above applies to
          // each group's rows exactly as it would to the flat page — and each
          // group's row page supplies its own filter and window.
          if (serverGroupedFetch) {
            const { $top: _top, $skip: _skip, ...groupQuery } = params;
            setGroupRowQuery(groupQuery);
            lastFindParamsRef.current = { ...groupQuery };
            setSelectAllMatching(false);
            return;
          }

          const result = await dataSource.find(objectName, params);
          if (cancelled) return;
          setData(result.data || []);
          // Capture total matching count + the params we used, so the bulk
          // selection banner can offer "Select all N matching" and the
          // dispatcher can re-issue the query to expand selection.
          const totalFromResult = (result as { total?: number }).total;
          setTotalMatching(typeof totalFromResult === 'number' ? totalFromResult : undefined);
          lastFindParamsRef.current = { ...params };
          // Reset cross-page flag whenever the underlying query changes.
          setSelectAllMatching(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadSchemaAndData();

    return () => {
      cancelled = true;
    };
  // `perms.isLoaded` (objectui#6898): the projection is FLS-gated above, and
  // `/me/permissions` resolves asynchronously — on the first render it is still
  // `false`, so the gate defers and the first request goes out ungated. Without
  // this dep nothing would ever rebuild it and the gate would be dead on the
  // only fetch most grids make. The boolean, not `perms` itself: it flips
  // false -> true exactly once, so this costs at most one refetch, where the
  // context object's identity would re-fetch the grid on every render.
  // `PermissionProvider` reports `true` synchronously and the no-provider
  // default stays `false` forever, so neither of those pays anything.
  // `groupingProjectionKey` (objectui#7179): the grouping fields are part of
  // the projection now, and grouping is RUNTIME-MUTABLE (the toolbar popover
  // rewrites it), so without this dep switching the grouping field would leave
  // the query asking for the OLD one and the new grouping would read
  // `undefined` on every row — the very `(empty)` bucket this card fixes,
  // reachable a second way.
  // `invalidationNonce` (objectui#10035): a write to this object, reported on
  // the data-invalidation bus — see its declaration above.
  // `groupingNeedsHeaderQuery` (objectui#10881): it flips when the object's
  // types land and show the only grouping key masked, and the flat fetch it
  // withheld must then go out.
  // `predicateProjectionKey` and `searchFieldsKey` (objectui#10689): the
  // harvested predicate operands and the `$searchFields` this query sends, each
  // a string compared by value — see their declarations above.
  // `carriesConcurrencyToken` (objectui#12292): a boolean, so turning inline
  // edit on re-reads the rows WITH their token — see its declaration above.
  // `rowColorField` (objectui#12393): a string, so a rule naming a new field
  // re-reads the rows with it — see its declaration above.
  }, [objectName, schemaFields, schemaColumns, schemaFilter, schemaFilterRefusal, schemaSort, headerSort, querySearchTerm, schemaPagination, schemaPageSize, serverPage, fetchWindow, dataSource, hasInlineData, dataConfig, refreshKey, perms.isLoaded, groupingProjectionKey, predicateProjectionKey, searchFieldsKey, invalidationNonce, serverGroupedFetch, groupingNeedsHeaderQuery, carriesConcurrencyToken, rowColorField]);

  // The same reset, for the path the loader above never runs on (objectui#4501
  // clause 2). "All N matching are selected" is a claim about ONE query, so it
  // must not survive that query changing — the loader drops it in place (three
  // lines up, next to its `lastFindParamsRef` write), and under a host-driven
  // fetch the host's params changing is the identical signal. Without this a
  // user could escalate, change the filter in the host's toolbar, and keep an
  // escalation that now reads against a match set they never saw.
  //
  // Keyed on the CONTENT signature, not the prop's identity: a host re-render
  // that rebuilds an equal object is not a query change, and dropping the
  // escalation on one would make the affordance unusable.
  const hostFindParamsKey = React.useMemo(
    () => findParamsSignature(hostFindParams),
    [hostFindParams],
  );
  React.useEffect(() => {
    setSelectAllMatching(false);
  }, [hostFindParamsKey]);

  // Reset to page 1 whenever the query itself changes (object / filter / sort /
  // search), so we never request a page index that no longer exists for the new
  // result set (e.g. applying a filter while sitting on page 5 of the old
  // query). A new search term is the sharpest case of this: 3075 rows can
  // become 2, and "page 5" of that is nothing at all.
  React.useEffect(() => {
    setServerPage(1);
  }, [objectName, schemaFilter, schemaSort, headerSort, querySearchTerm]);

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

  // objectui#9299 item 3 — `popover` anchors to the ROW the user clicked. The
  // grid reaches `handleClick` from several places that carry no DOM event
  // (`DataTable`'s own row handler, `LinkCell.onActivate`), so the anchor is
  // recorded by a capture listener on this component's container.
  const { anchorRef, anchorCaptureProps } = useOverlayAnchor();

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

  // --- Grouping support ---
  // Build a per-field value formatter so group headers display the human
  // readable label for select/boolean fields rather than the raw value
  // (e.g. "In Progress" instead of "in_progress", "Yes" instead of "true").
  // A select value's label is the OBJECT FIELD's option label (objectui#11544).
  const groupValueFormatter = React.useMemo(() => {
    // [objectui#7217] ONE normalized entry list, shared with the
    // `useGroupedDataInOptionOrder` call below. Reading `grouping.fields` raw here threw
    // `TypeError: Cannot read properties of null (reading 'field')` on a null
    // hole — the whole grid gone, during render, before any projection was
    // built. `usableGroupingFields` admits exactly the entries
    // `collectGroupingFieldRefs` harvests into the projection, so the grid can
    // never group by an entry the query never asked for.
    const groupingFields = usableGroupingFields(schema.grouping?.fields);
    if (!groupingFields.length) return undefined;

    // Per-field { value -> label } lookup, plus a per-field type so we can
    // handle booleans / dates / users without dedicated option lists.
    const lookup = new Map<string, { type?: string; options?: Map<string, string> }>();

    for (const gf of groupingFields) {
      const fieldName = gf.field;
      const objectDefField = objectFields?.[fieldName];
      // The authored column for this field may respell its TYPE — `type` is a
      // declared `ListColumn` member, and it is how a `"true"` / `"false"` text
      // value reads Yes / No. It never supplies the value LABELS
      // (objectui#11544): `options` is not a `ListColumn` member, and the
      // strict `ListColumnSchema` refuses it at publish, so the labels come
      // from the object field's `options` only. The lookup is typed as
      // `ListColumn` so a read of an undeclared column member does not compile.
      const cols: ReadonlyArray<string | ListColumn> = normalizeColumns(schema.columns) ?? [];
      const colOverride = cols.find(
        (c): c is ListColumn => typeof c === 'object' && c !== null && c.field === fieldName,
      );

      const type = colOverride?.type || objectDefField?.type;
      const rawOptions = objectDefField?.options;

      const optionsMap = new Map<string, string>();
      if (Array.isArray(rawOptions) && rawOptions.length > 0) {
        const translated = schema.objectName
          ? translateOptions(schema.objectName, fieldName, rawOptions)
          : rawOptions;
        for (const opt of translated) {
          if (opt && opt.value !== undefined && opt.value !== null) {
            const label = (opt as any).label;
            optionsMap.set(String(opt.value), label != null ? String(label) : String(opt.value));
          }
        }
      }

      lookup.set(fieldName, {
        type: type || undefined,
        options: optionsMap.size > 0 ? optionsMap : undefined,
      });
    }

    return (field: string, value: any): string | undefined => {
      const meta = lookup.get(field);
      if (!meta) return undefined;
      // Select / multi-select: resolve from options map first.
      if (meta.options) {
        const label = meta.options.get(String(value));
        if (label !== undefined) return label;
      }
      // Boolean fields: render as Yes/No. We use the toolbar i18n bundle so
      // grids without an objectName still produce a readable label — the same
      // `grid.yes`/`grid.no` keys the boolean cell renderer and the bulk-action
      // dialog use, passed as `defaultValue` (a bare string second argument is
      // read as an options object, so the fallback never applied).
      if (meta.type === 'boolean' || typeof value === 'boolean') {
        if (value === true || value === 'true') return t('grid.yes', { defaultValue: 'Yes' });
        if (value === false || value === 'false') return t('grid.no', { defaultValue: 'No' });
      }
      return undefined;
    };
  }, [schema.grouping, schema.columns, schema.objectName, objectFields, translateOptions, t]);

  // [objectui#13234] Per grouping field whose cell paints a date-family face,
  // that face; `temporalGroupHeading` draws the field's group headings through
  // it. The type is the one `groupValueFormatter` reads (the authored column's
  // `type` over the object field's), taken through the cells' one shared
  // resolve, so a heading is drawn as a date exactly when the cell under it is.
  //
  // ⚠️ Drawn at the band (`groupBandsOf`), NOT returned from
  // `groupValueFormatter`: the grouping hook ORDERS groups by the label that
  // formatter returns, and a stored day sorts in calendar order only as the
  // stored string ("Aug 1" < "Oct 1" < "Sep 1" alphabetically). The group keeps
  // the stored key as its label, so its order and count are what they were;
  // only the text in its band changes.
  const temporalGroupFaces = React.useMemo(() => {
    const faces = new Map<string, TemporalGroupFace>();
    const cols: ReadonlyArray<string | ListColumn> = normalizeColumns(schema.columns) ?? [];
    for (const gf of usableGroupingFields(schema.grouping?.fields)) {
      const objectDefField = objectFields?.[gf.field];
      const colOverride = cols.find(
        (c): c is ListColumn => typeof c === 'object' && c !== null && c.field === gf.field,
      );
      const { rendererType } = resolveGridCellRendering({
        type: colOverride?.type || objectDefField?.type,
        format: objectDefField?.format,
        widget: objectDefField?.widget,
      });
      if (rendererType === 'date' || rendererType === 'datetime') {
        faces.set(gf.field, { rendererType, format: objectDefField?.format || undefined });
      }
    }
    return faces;
  }, [schema.grouping, schema.columns, objectFields]);

  const groupingForRender = groupingRefusesNothing || !schema.grouping
    ? schema.grouping
    : { ...schema.grouping, fields: unmaskedGroupingFields };
  // [objectui#7189] The entries the SERVER groups by: the render grouping less
  // any key this principal may not read (see `groupingKeyReadable`). Keyed on
  // the names, so a host rebuilding `grouping` every render re-asks nothing.
  // [objectstack#25786] A level's `orderBy` rides along — the header query
  // compiles its `min` / `max` column from it — under the same read gate: an
  // `orderBy` this principal may not read is dropped, and the level orders by
  // its own key, since the header row would carry that field's value and the
  // group order would disclose it.
  const serverGroupingKey = serverGroupedFetch
    ? JSON.stringify(
      usableGroupingFields(groupingForRender?.fields)
        .filter((gf) => groupingKeyReadable(gf.field))
        .map((gf) => [
          gf.field,
          gf.order ?? null,
          gf.collapsed ?? null,
          gf.orderBy && groupingKeyReadable(gf.orderBy) ? gf.orderBy : null,
        ]),
    )
    : '[]';
  const serverGroupingFields = React.useMemo(
    () => (JSON.parse(serverGroupingKey) as Array<[string, 'asc' | 'desc' | null, boolean | null, string | null]>)
      .map(([field, order, collapsed, orderBy]) => ({
        field,
        ...(order ? { order } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
        ...(collapsed !== null ? { collapsed } : {}),
      })),
    [serverGroupingKey],
  );
  // The view's composed filter as ONE `FilterCondition` — what both compiled
  // queries take, so the header numbers and the rows they head answer the
  // same question. Lowered from the AST the flat fetch would have sent; a
  // filter that does not lower is refused, never dropped (dropping it would
  // group the unfiltered object).
  const groupRowQueryKey = JSON.stringify(groupRowQuery);
  const groupWhere = React.useMemo((): { where?: FilterCondition; error?: Error } => {
    const query = JSON.parse(groupRowQueryKey) as Record<string, unknown> | null;
    const ast = query?.$filter;
    if (ast === undefined || ast === null) return {};
    try {
      const where = parseFilterAST(ast);
      if (where === undefined) {
        return { error: new Error(`[ObjectGrid] The view filter could not be lowered for server-side grouping: ${JSON.stringify(ast)}`) };
      }
      return { where };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error(String(err)) };
    }
  }, [groupRowQueryKey]);
  const groupReloadKey = `${refreshKey}:${invalidationNonce}`;
  const groupHeaders = useServerGroupHeaders({
    enabled: serverGroupedFetch && !objectTypesPending && groupRowQuery !== null && !groupWhere.error,
    dataSource,
    objectName,
    fields: serverGroupingFields,
    where: groupWhere.where,
    // [objectui#11021] The search term, off the same resolved query every
    // group's row page is asked with: one pair on both queries.
    ...groupSearchOf(groupRowQuery),
    aggregations: schema.aggregations,
    objectFields,
    reloadKey: groupReloadKey,
  });
  // Keyed on the hook's STATE values (a stable identity React promises), so
  // the group tree is rebuilt when the server answers, not on every render.
  const groupHeaderRows = groupHeaders.headers;
  const groupKeyLabels = groupHeaders.keyLabels;
  const serverGroupSource: ServerGroupSource | undefined = React.useMemo(
    () => (serverGroupedFetch ? { headers: groupHeaderRows ?? [], keyLabels: groupKeyLabels } : undefined),
    [serverGroupedFetch, groupHeaderRows, groupKeyLabels],
  );

  // [objectui#11809] Each grouping field's DECLARED option order: the object
  // field's `options` read through core's `buildCategoryOrder` /
  // `buildCategoryRank`, the same reading the dashboard's category axis and
  // the funnel use. A select field's groups then follow the order the author
  // declared (Backlog → To Do → In Progress …), as the Kanban lanes do, rather
  // than the order of their labels; empty and undeclared values sit last. A
  // field with no options keeps label order. Keyed on the order itself (a
  // string), not on `schema.grouping`, which a host rebuilds every render.
  const groupOptionOrderKey = JSON.stringify(
    usableGroupingFields(schema.grouping?.fields).flatMap((gf) => {
      const order = buildCategoryOrder(objectFields?.[gf.field]?.options);
      return order ? [[gf.field, order]] : [];
    }),
  );
  const groupOptionRanks = React.useMemo((): GroupOptionRanks | undefined => {
    const ranks = new Map<string, ReadonlyMap<string, number>>();
    for (const [field, order] of JSON.parse(groupOptionOrderKey) as Array<[string, string[]]>) {
      const rank = buildCategoryRank(order);
      if (rank) ranks.set(field, rank);
    }
    return ranks.size > 0 ? ranks : undefined;
  }, [groupOptionOrderKey]);

  const { groups, isGrouped, toggleGroup } = useGroupedDataInOptionOrder(
    serverGroupedFetch
      ? (schema.grouping ? { ...schema.grouping, fields: serverGroupingFields } : undefined)
      : groupingForRender,
    data,
    schema.aggregations,
    groupValueFormatter,
    serverGroupSource,
    groupOptionRanks,
  );

  // Reset grouped pagination to page 1 whenever the grouping config, page size
  // or the underlying data changes (e.g. switching grouping field, reload).
  const groupingKey = React.useMemo(
    () => JSON.stringify(schema.grouping ?? null),
    [schema.grouping],
  );
  React.useEffect(() => {
    setGroupedPage(1);
  }, [groupingKey, groupedPageSize, refreshKey]);

  // [objectui#7189] The open LEAF groups on the current page of groups — the
  // only ones whose rows are on screen, and so the only ones whose rows are
  // asked for. A collapsed group costs no row query at all.
  const serverGroupLeaves: ServerGroupLeaf[] = [];
  if (serverGroupedFetch) {
    const groupPages = Math.max(1, Math.ceil(groups.length / groupedPageSize));
    const onPage = Math.min(groupedPage, groupPages);
    const collectOpenLeaves = (group: typeof groups[number]) => {
      if (group.collapsed) return;
      if (group.subgroups.length === 0) serverGroupLeaves.push({ key: group.key, keyValues: group.keyValues });
      else group.subgroups.forEach(collectOpenLeaves);
    };
    groups.slice((onPage - 1) * groupedPageSize, onPage * groupedPageSize).forEach(collectOpenLeaves);
  }
  const groupRows = useServerGroupRows({
    enabled: serverGroupedFetch && !!groupHeaders.headers,
    dataSource,
    objectName,
    fields: serverGroupingFields,
    where: groupWhere.where,
    baseParams: groupRowQuery,
    pageSize: serverPageSize,
    leaves: serverGroupLeaves,
    reloadKey: groupReloadKey,
  });
  // The rows in hand are the open groups' pages: what everything else that
  // reads `data` (column inference, the client export, selection) sees.
  const serverLeafKeys = JSON.stringify(serverGroupLeaves.map((leaf) => leaf.key));
  useEffect(() => {
    if (!serverGroupedFetch) return;
    const keys = JSON.parse(serverLeafKeys) as string[];
    setData(keys.flatMap((key) => groupRows.pages[key]?.rows ?? []));
  }, [serverGroupedFetch, serverLeafKeys, groupRows.pages]);
  // …and the match total is the QUERY's: the top-level group counts summed.
  const serverGroupTotal = serverGroupedFetch && groupHeaders.headers
    ? (groupHeaders.headers[0] ?? []).reduce((sum, row) => sum + (Number(row.count) || 0), 0)
    : undefined;
  useEffect(() => {
    if (serverGroupTotal !== undefined) setTotalMatching(serverGroupTotal);
  }, [serverGroupTotal]);

  // The query the cross-page fan-out would replay — from whichever side owns the
  // fetch (objectui#4501). ONE value, read by the fan-out AND by the affordance
  // gate below, so the offer and the thing it promises can never disagree —
  // and by the footer, whose whole-set figures are this same query's
  // (objectui#12081 item 3). Declared here, above the footer's hook, rather
  // than beside the fan-out: hooks run before the component's early returns.
  //
  // `hasInlineData` is exactly the data loader's own guard (`if (hasInlineData)
  // return`), which makes it the precise test for "this grid did not issue the
  // query behind the rows on screen". In that case `lastFindParamsRef` is not
  // merely empty, it is WRONG — either never written, or left over from an
  // earlier own-fetch — so the host's `findParams` is the only admissible
  // source, and there is deliberately no fallback to the ref and no `?? {}`
  // default: replaying `{}` is what asked the server for the whole object and
  // fed up to 5000 unmatched records to bulk delete.
  const bulkFanoutParams: Record<string, unknown> | null = hasInlineData
    ? (hostFindParams ?? null)
    : (lastFindParamsRef.current ?? null);

  // The real match total, from whichever side owns the fetch — ONE derived
  // value with ONE answer (objectui#4464). The pager has always read it this
  // way; the cross-page "Select all N matching" affordance read the raw
  // `totalMatching` STATE instead, whose only writer is this component's own
  // data loader. Under a host that fetches the rows itself (ListView passing
  // `manualPagination` + `rowCount`, i.e. the console) that loader never runs,
  // so the state stayed `undefined` and `BulkActionBar`'s gate was permanently
  // false while the pager, two lines away, showed the correct page count off
  // the very number the bar needed.
  //
  // Every consumer reads this const — the pager's `rowCount`, both
  // `BulkActionBar` sites, and the footer's whole-set read, which checks the
  // count it is answered against this one (objectui#12081 item 3). Do NOT
  // re-spell the conditional at a second consumption site: two copies of the
  // fallback is exactly how one of them gets missed again (this defect, and
  // #4138 before it).
  //
  // This answers HOW MANY match, and `canOfferSelectAllMatching` (objectui#4501)
  // independently answers WHETHER the escalation may be offered at all. The two
  // compose and neither substitutes for the other: the bar sites read this total
  // only *through* that floor, so a host with a real `rowCount` but no
  // `findParams` still gets no offer — a number to display is not a query to
  // replay. The floor also subsumes the `singleSelection` suppression that used
  // to be spelled at these sites (`!singleSelection` is its first conjunct).
  const resolvedTotalMatching = externalManualPagination ? hostRowCount : totalMatching;

  // --- Column summary support ---
  const summaryColumns = React.useMemo(() => {
    const cols = normalizeColumns(schema.columns);
    if (cols && cols.length > 0 && typeof cols[0] === 'object') {
      return cols as ListColumn[];
    }
    return undefined;
  }, [schema.columns]);
  // [objectui#12081 item 3] Whether the rows the footer reads ARE the set it
  // is drawn beside. Under server paging they are one page of it: a host
  // (`ListView`) hands this grid one window with the set's `rowCount`, or this
  // grid's own loader asked for one page of `fetchWindow` rows. Rows handed in
  // without a declared page are the set, and so is a first page that holds
  // every match. Only the flat table draws the footer, so a grouped grid asks
  // nothing.
  const footerRowsAreTheSet = externalManualPagination
    ? (hostRowCount as number) <= data.length
    : hasInlineData || (serverPage === 1 && (typeof totalMatching === 'number'
      ? totalMatching <= data.length
      : data.length < fetchWindow));
  const wholeSetSummary = useWholeSetSummary({
    enabled: !footerRowsAreTheSet && !isGrouped && !serverGroupedFetch && data.length > 0,
    dataSource,
    objectName,
    columns: summaryColumns,
    findParams: bulkFanoutParams,
    count: resolvedTotalMatching,
    reloadKey: String(refreshKey),
  });
  const { summaries, hasSummary } = useScopedColumnSummary(
    summaryColumns,
    data,
    objectSchema?.fields,
    footerRowsAreTheSet ? 'rows' : (wholeSetSummary.status === 'answered' ? 'whole' : 'page'),
    wholeSetSummary.row,
  );

  // The authored-input diagnostics (`columns`, `bulkActionDefs`, page size),
  // three `console.warn` effects, run here in hook order (`./objectGridDiagnostics`).
  useObjectGridDiagnostics(schema);

  const generateColumns = useCallback((): ObjectGridColumnDraft[] => {
    // objectui#11815 — the host's verdict on a declared deadline's
    // `settledWhen` for ONE row, handed to the cell as `deadlineSettled`. The
    // one helper in `@object-ui/core`, with the scope and relation collapse
    // this grid's conditional formatting uses; a field that is not a declared
    // deadline answers `false` before any predicate runs.
    //
    // objectstack#25884 — every column cell built below also carries
    // `inGridColumn`, so a `date` field with no declared `format` reads in
    // one absolute face down the column (`CellRendererProps.inGridColumn`).
    // The record panel and the mobile card's slots draw their cells without
    // it, outside this function.
    const settledFor = (field: unknown, row: Record<string, unknown> | undefined): boolean =>
      isDeadlineSettled(field as Parameters<typeof isDeadlineSettled>[0], row, { scope: predicateScope, fields: objectFields });
    // Map field type to column header icon (Airtable-style)
    const getTypeIcon = (fieldType: string | null): React.ReactNode => {
      if (!fieldType) return <Type className="h-3.5 w-3.5" />;
      const iconMap: Record<string, React.ReactNode> = {
        text: <Type className="h-3.5 w-3.5" />,
        number: <Hash className="h-3.5 w-3.5" />,
        currency: <Hash className="h-3.5 w-3.5" />,
        percent: <Hash className="h-3.5 w-3.5" />,
        date: <Calendar className="h-3.5 w-3.5" />,
        datetime: <Clock className="h-3.5 w-3.5" />,
        boolean: <CheckSquare className="h-3.5 w-3.5" />,
        user: <User className="h-3.5 w-3.5" />,
        select: <Tag className="h-3.5 w-3.5" />,
      };
      return iconMap[fieldType] || <Type className="h-3.5 w-3.5" />;
    };

    // Auto-infer column type from field name and data values (Airtable-style)
    const inferColumnType = (col: ListColumn): string | null => {
      if (col.type) return col.type; // Explicit type takes priority

      const fieldLower = col.field.toLowerCase();

      // Infer boolean fields
      const booleanFields = ['completed', 'is_completed', 'done', 'active', 'enabled', 'archived'];
      if (booleanFields.some(f => fieldLower === f || fieldLower === `is_${f}`)) {
        return 'boolean';
      }

      // Infer datetime fields (fields with time component: created_time, modified_time, *_at patterns)
      const datetimePatterns = ['created_time', 'modified_time', 'updated_time', 'created_at', 'updated_at', 'modified_at', 'last_login', 'logged_at'];
      if (datetimePatterns.some(p => fieldLower === p || fieldLower.endsWith(`_${p}`))) {
        return 'datetime';
      }

      // Infer date fields from name patterns
      const datePatterns = ['date', 'due', 'created', 'updated', 'deadline', 'start', 'end', 'expires'];
      if (datePatterns.some(p => fieldLower.includes(p))) {
        // Verify with data: check if sample values look like dates
        if (data.length > 0) {
          const sample = data.find(row => row[col.field] != null)?.[col.field];
          if (typeof sample === 'string' && !isNaN(Date.parse(sample))) {
            return 'date';
          }
        }
        return 'date';
      }

      // Infer percent fields from name patterns
      const percentFields = ['probability', 'percent', 'percentage', 'completion', 'progress', 'rate'];
      if (percentFields.some(f => fieldLower.includes(f))) {
        if (data.length > 0) {
          const sample = data.find(row => row[col.field] != null)?.[col.field];
          if (typeof sample === 'number') {
            return 'percent';
          }
        }
      }

      // Infer select/badge fields (status, priority, category, etc.)
      const selectFields = ['status', 'priority', 'category', 'stage', 'type', 'severity', 'level'];
      if (selectFields.some(f => fieldLower.includes(f))) {
        if (data.length > 0) {
          const uniqueValues = new Set(data.map(row => row[col.field]).filter(Boolean));
          if (uniqueValues.size > 0 && uniqueValues.size <= 10) {
            return 'select';
          }
        }
      }

      // Infer user/assignee fields
      const userFields = ['assignee', 'owner', 'author', 'reporter', 'creator', 'user'];
      if (userFields.some(f => fieldLower.includes(f))) {
        return 'user';
      }

      // Infer currency/amount fields
      const currencyFields = ['amount', 'price', 'total', 'revenue', 'cost', 'budget', 'salary'];
      if (currencyFields.some(f => fieldLower.includes(f))) {
        if (data.length > 0) {
          const sample = data.find(row => row[col.field] != null)?.[col.field];
          if (typeof sample === 'number') {
            return 'currency';
          }
        }
      }

      // Fallback: detect ISO date strings in data values (catch-all for unmatched field names)
      if (data.length > 0) {
        const sample = data.find(row => row[col.field] != null)?.[col.field];
        if (typeof sample === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(sample)) {
          return 'datetime';
        }
      }

      return null;
    };

    // Use normalized columns (support both new and legacy)
    const cols = normalizeColumns(schemaColumns);
    
    if (cols) {
      // FLS on the AUTHORED `columns` path (objectui#6799 — maintainer ruling
      // 2026-08-30, inheriting objectui#6723's 2026-08-29 reasoning verbatim).
      //
      // This was the LAST of `generateColumns()`'s three default paths that did
      // not re-apply field-level security. The object-schema path always did;
      // the inline-data path does as of objectui#6723. Leaving this one out was
      // the worst of the three to leave, because it is the MOST REACHABLE:
      // objectui#6723's path needs a host to hand rows down, while this one runs
      // whether the grid fetches its own rows or not. Three paths of one
      // function, two checking and one not, is a bypass around the field gate
      // rather than an inconsistency.
      //
      // ⭐ THE LIMIT IS LOAD-BEARING, NOT AN OPTIMISATION — and it bites harder
      // here than on the inline-data path. Only keys the OBJECT DECLARES are
      // judged; everything else passes through untouched. A `ListColumn` carries
      // `label` / `link` / `action` / `prefix` / `width`, so a column whose
      // `field` the object does not declare is not a mistake — it is a
      // legitimate authored derived or host-joined column (`computed_score`, a
      // flattened `account.name`), and deleting it would destroy authoring work.
      // `checkField` answers `false` for a field the policy has never heard of,
      // so asking it about a derived key is not a stricter reading of the same
      // rule — it is a different, wrong one. `hasOwnProperty` rather than a
      // truthiness read so an inherited name (`constructor`, `toString`) cannot
      // be mistaken for a declared field.
      //
      // ⛔ THE JUDGED KEY IS READ THROUGH `columnIdentity`, NEVER OFF A BARE
      // STRING (the ruling says so by name). `columnIdentity` folds the three
      // authored identity spellings — `'salary'`, `{ field: 'salary' }` and the
      // legacy `{ name: 'salary' }` — which is why ONE predicate serves both
      // arms below. A gate reading `col.field` directly would find no identity
      // on the legacy spelling and wave a denied declared field straight
      // through. `resolvesToDataColumn` keeps owning its own decisions and runs
      // first: this gate narrows what survives, it never resurrects a hidden or
      // unresolvable column.
      //
      // Redundant through `ListView`, which filters its own `effectiveFields`
      // through this same gate before forwarding them as `columns` — and that
      // redundancy IS the point: the invariant must not rest on every future
      // host having read the docs. Measured in-repo hosts that do NOT filter
      // first: `ObjectView`, `ObjectManager`, `FieldDesigner`. Pinned in
      // `authoredColumnsFls-6799.test.tsx`.
      const passesFieldGate = (entry: unknown): boolean => {
        if (!perms?.isLoaded || !schema.objectName) return true;
        const fieldName = columnIdentity(entry);
        // No readable identity ⇒ nothing to ask the policy about.
        if (!fieldName) return true;
        // Undeclared ⇒ host-joined / derived ⇒ not this gate's business.
        if (!Object.prototype.hasOwnProperty.call(objectFields ?? {}, fieldName)) return true;
        return perms.checkField(schema.objectName, fieldName, 'read');
      };
      // ObjectStack's DECLARED column spelling is the only one read
      // (objectui#5068). `ObjectGridSchema.columns` is `string[] | ListColumn[]`,
      // and `ListColumnSchema` in `@objectstack/spec/ui` is a STRICT object:
      // `field` is required, `accessorKey` / `header` are refused BY NAME with
      // `unrecognized_keys`. A branch here used to accept that refused spelling
      // anyway — it sniffed `columns[0]` for an `accessorKey` and synthesized a
      // `ListColumn` from it — so one key had two spellings, one the schema
      // admits and one only the runtime did. That second de-facto contract is
      // what AGENTS.md #0.1 forbids, and objectui#3951 already settled the
      // shape of the fix for this defect family: unify at the PRODUCER, no
      // consumer-side tolerance alias. The one in-repo producer that spoke it,
      // `bridgeListView` in `@object-ui/react`, was migrated in the same PR.
      //
      // The `columns[0]` sniff goes with it. Column identity is a per-column
      // property, and the filter below is the one place that judges it: a
      // mis-spelled column is now dropped alone, where the sniff let the FIRST
      // entry decide the fate of the whole array (a declared column standing
      // behind an undeclared one was lost with it; the reverse order threw).
      //
      // `accessorKey` keeps its job on the way OUT — it is the data-table
      // adapter's key, which `@object-ui/core` deliberately holds outside the
      // metadata identity fold (`TABLE_ADAPTER_COLUMN_KEY`) and which this
      // component still writes below. Metadata vocabulary in, adapter
      // vocabulary out, one translation.
      if (cols.length > 0 && typeof cols[0] === 'object' && cols[0] !== null) {
        // The drop decision lives in `resolvesToDataColumn`
        // (`columnSpellingDiagnostics.ts`) so the diagnostic that reports a
        // dropped column cannot drift from the filter that drops it — one
        // predicate, two readers (objectui#5349). Semantics unchanged:
        // `col?.field && typeof col.field === 'string' && !col.hidden`.
        return (cols as ListColumn[])
          .filter((col) => resolvesToDataColumn(col))
          .filter((col) => passesFieldGate(col))
          .map((col, colIndex) => {
            // The column's own `label` is the spec's "Display label override"
            // (`ListColumnSchema`), so when the author wrote one it IS the
            // header, and the field-label lookup is not consulted
            // (objectui#12110 item 1). It used to be handed to that lookup as
            // its FALLBACK, so any bundle translating the field — which a
            // deployed app's bundle does for every field — replaced the
            // override with the field's label.
            //
            // With no override, fall back to the SCHEMA FIELD's label before
            // prettifying the machine name — otherwise a column declared as bare
            // { field } shows an English name-derived header (e.g. "Request
            // title") even when the field has a localized label (e.g. "申请标题")
            // on a non-English app.
            const authoredHeader = resolveColumnLabel(col.label, uiLanguage);
            const rawHeader = resolveColumnLabel(objectFields?.[col.field]?.label, uiLanguage)
              || col.field.charAt(0).toUpperCase() + col.field.slice(1).replace(/_/g, ' ');
            const header = authoredHeader
              || (schema.objectName ? resolveFieldLabel(schema.objectName, col.field, rawHeader) : rawHeader);

            // Build custom cell renderer based on column configuration
            let cellRenderer: ((value: any, row: any) => React.ReactNode) | undefined;

            // Type-based cell renderer: explicit col type > objectDef type > heuristic inference.
            // Format hints (e.g. `text` + `format: 'phone'`) promote to the
            // richer renderer (PhoneCellRenderer) via the grid's one shared
            // resolve, `./cellRendererResolution` (objectui#8920).
            const objectDefField = objectFields?.[col.field];
            // objectui#10657 — an untyped column while the object's field types
            // are unknown is WITHHELD: drawn as the mask, never as text, and
            // flagged masked (`isWithheldGridColumn`). No type is inferred for
            // it — a heuristic guess from the name or the values is exactly
            // how a credential field ended up drawn as text.
            const withheld = isWithheldGridColumn(col.type, objectTypesPending);
            // ⭐ ANNOTATED, and the annotation is load-bearing (objectui#6004).
            // `objectSchema` is `useState<any>`, so `objectDefField?.type` is
            // `any` — and an `any` SPREAD into an object literal collapses the
            // WHOLE literal to `any`, which silently un-checks every other key
            // in it. Measured: without this annotation the emit below infers
            // `any[]`, and `ObjectGridColumnDraft` cannot bite on any member. Naming
            // the producer vocabulary here stops `any` at this one boundary.
            const baseInferredType: string | null = withheld
              ? null
              : col.type || objectDefField?.type || inferColumnType({ field: col.field }) || null;
            // objectui#6458 — the column-level `format` read is RETIRED. The
            // object-field fallback below is now the only road, which is what
            // every measured author already used.
            const formatHint = objectDefField?.format;
            // Both answers, from the one shared resolve (objectui#8920):
            // `baseInferredType` is the DECLARED type the inline editor reads,
            // `inferredType` the renderer key it promotes to.
            // The `widget` hint promotes the same way (objectui#12613): an
            // `object-ref` / `recipient-picker` text column draws the label of
            // what it references, through the cell its widget names.
            const { rendererType: inferredType, Renderer } = resolveGridCellRendering({
              type: baseInferredType,
              format: formatHint,
              widget: objectDefField?.widget,
            });
            const CellRenderer = withheld ? MaskedCellRenderer : inferredType ? Renderer : null;

            // Build field metadata for cell renderers with objectDef enrichment
            const fieldMeta: Record<string, any> = { name: col.field, type: inferredType || 'text' };
            // Merge objectDef field properties (options with colors, currency, precision, etc.)
            if (objectDefField) {
              // The label the header above prints — `header`, resolved once
              // (objectui#11689). A face that names its own column (the
              // boolean face's checkbox, by its accessible name) reads
              // `field.label`, so
              // handing it the authored label made a translated header sit
              // over a cell naming the column in the authored language. Handed
              // where the authored label used to be, so an unlabelled field
              // keeps the face's own fallback.
              if (objectDefField.label) fieldMeta.label = header;
              if (objectDefField.currency) fieldMeta.currency = objectDefField.currency;
              // objectui#10354 — `currencyConfig` is the spec's one fixed-currency
              // spelling (a field key `currency` is refused by name), so a
              // JPY-fixed field reaches the cell only through it. Copied
              // VERBATIM: the cell's `resolveFieldCurrency` owns what it means,
              // `currencyMode` included, so this bag holds no second opinion.
              // Dropped, the cell fell through to the tenant currency while the
              // metric tile and every whole-def cell read the field's own.
              if (objectDefField.currencyConfig) fieldMeta.currencyConfig = objectDefField.currencyConfig;
              if (objectDefField.precision !== undefined) fieldMeta.precision = objectDefField.precision;
              if ((objectDefField as any).scale !== undefined) (fieldMeta as any).scale = (objectDefField as any).scale;
              // objectui#11026 — the author's digit-grouping hint rides beside
              // `scale`, its heuristic fallback: dropped here, the cell never
              // sees it and a `useGrouping: false` year still reads `2,026`.
              if (objectDefField.useGrouping !== undefined) fieldMeta.useGrouping = objectDefField.useGrouping;
              // objectui#11475 — a percent field's declared `max` is its STORAGE
              // statement (`percentScaleOf`: a fraction unless `max` is above
              // 1), which the percent cell now reads instead of guessing from
              // the value. Dropped here, a whole-stored `50` (`max: 100`) would
              // read `5000%` in this cell.
              if (objectDefField.max !== undefined) fieldMeta.max = objectDefField.max;
              if (objectDefField.format) fieldMeta.format = objectDefField.format;
              // objectui#11815 — the deadline declaration rides on every
              // builder: `dueLike` is what the date cells paint from, and
              // `settledWhen` is what `isDeadlineSettled` judges per row.
              // Dropped here, a declared deadline never read overdue.
              if (objectDefField.dueLike !== undefined) fieldMeta.dueLike = objectDefField.dueLike;
              if (objectDefField.settledWhen !== undefined) fieldMeta.settledWhen = objectDefField.settledWhen;
              if (objectDefField.options) fieldMeta.options = translateOptions(schema.objectName, col.field, objectDefField.options);
            }
            // Preserve relational metadata (reference, displayField, …) so
            // lookup CELLS resolve ids to names. ⛔ Not the inline picker — that
            // reads the schema def directly, see `renderCellEditor` (objectui#7154).
            applyRelationalMeta(fieldMeta, objectDefField as any);
            // Auto-generate options from data for inferred select without existing options
            if (inferredType === 'select' && !fieldMeta.options) {
              const uniqueValues = Array.from(new Set(data.map(row => row[col.field]).filter(Boolean)));
              fieldMeta.options = uniqueValues.map(v => ({ value: v, label: humanizeLabel(String(v)) }));
            }
            // Honor metadata-defined appearance only — the objectDef FIELD's
            // `appearance`, which since objectui#6458 is the only road (the
            // column-level read is retired). When unset, the cell renders its
            // default badge style — same as detail / form views.
            const explicitAppearance = objectDefField?.appearance;
            if (explicitAppearance != null) {
              fieldMeta.appearance = explicitAppearance;
            }

            // Auto-link primary field (first column) to record detail (Airtable-style)
            const isPrimaryField = colIndex === 0 && !col.link && !col.action;
            const isLinked = col.link || isPrimaryField;
            // The face the value takes INSIDE the link: never an anchor of its
            // own (objectui#11817, `linkCellRenderer`).
            const LinkContentRenderer = linkCellRenderer(inferredType, CellRenderer);
            // A `referenceVia` pointer column draws the record it names
            // (objectui#12608); `null` per row falls through to the faces below.
            const pointerFace = withheld ? null : recordPointerFace(col.field, baseInferredType, objectDefField, dataSource);

            if ((col.link && col.action) || (isPrimaryField && col.action)) {
              // Both link and action: link takes priority for navigation, action executes on secondary interaction
              cellRenderer = (value: any, row: any) => {
                const displayContent = pointerFace?.(row) ?? (LinkContentRenderer
                  ? <LinkContentRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />
                  : (value != null && value !== '' ? String(value) : <EmptyValue />));
                return (
                  <LinkCell
                    testId={isPrimaryField ? 'primary-field-link' : 'link-cell'}
                    onActivate={() => navigation.handleClick(row)}
                    objectName={schema.objectName}
                    recordId={rowRecordId(row)}
                    wrap={col.wrap}
                  >
                    {displayContent}
                  </LinkCell>
                );
              };
            } else if (isLinked) {
              // Link column: clicking navigates to the record detail
              cellRenderer = (value: any, row: any) => {
                const displayContent = pointerFace?.(row) ?? (LinkContentRenderer
                  ? <LinkContentRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />
                  : (value != null && value !== '' ? String(value) : <EmptyValue />));
                return (
                  <LinkCell
                    testId={isPrimaryField ? 'primary-field-link' : 'link-cell'}
                    onActivate={() => navigation.handleClick(row)}
                    objectName={schema.objectName}
                    recordId={rowRecordId(row)}
                    wrap={col.wrap}
                  >
                    {displayContent}
                  </LinkCell>
                );
              };
            } else if (col.action) {
              // Action column: render as action button
              cellRenderer = (value: any, row: any) => {
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    data-testid="action-cell"
                    onClick={(e) => {
                      e.stopPropagation();
                      executeAction({
                        type: col.action!,
                        params: { record: row, field: col.field, value },
                      });
                    }}
                  >
                    {formatActionLabel(col.action!)}
                  </Button>
                );
              };
            } else if (CellRenderer) {
              // Type-only cell renderer (no link/action). The row rides as
              // `dependentValues` for a cell whose value only means something
              // beside a sibling column (objectui#12613).
              cellRenderer = (value: any, row: any) => (
                pointerFace?.(row) ?? <CellRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />
              );
            } else {
              // Default renderer with empty value handling
              cellRenderer = (value: any) => (
                value != null && value !== ''
                  ? <span>{String(value)}</span>
                  : <EmptyValue />
              );
            }

            // Wrap with prefix compound cell renderer (Airtable-style: [Badge] Text in same cell)
            // `prefix` needs NO cast: `ListColumn` DECLARES it (objectui#6458).
            // The cast was pure noise, and it cost twice — it made a declared,
            // schema-admitted key look exactly like the four genuinely undeclared
            // reads around it, and it threw away `ColumnPrefix`'s own typing, so
            // `prefixConfig.field` was `any` at every use below.
            //
            // ⭐ The four undeclared reads that used to sit in this branch —
            // `format`, `options`, `appearance`, `essential` — are RETIRED
            // (objectui#6458, maintainer ruling 2026-08-28, "B on all four").
            // `ListColumnSchema` is a strict object that refuses all four at
            // publish, so honouring them here was the `declared != enforced`
            // split AGENTS.md #0.1 exists to stop. The retirement route (rather
            // than declaring them on `@objectstack/spec`) follows the standing
            // zero-authors rule: a key with no measured authors is retired at
            // once, with no deprecation window. Re-measured on this ref before
            // the deletion — zero authored occurrences of any of the four on a
            // column across `examples/` and `apps/`.
            //
            // ⚠️ Retired for want of authors, NOT forbidden forever. If a real
            // request for semantic mobile-column control arrives, the declare
            // route reopens — objectstack#12715 is the precedent (removed while
            // unenforced, re-introduced once demand and enforcement met). What
            // is forbidden is the third road: a renderer-side tolerance for a
            // key the schema refuses. `columnReadBoundary-6458.test.ts` now
            // bounds this branch's undeclared cast reads to the EMPTY SET, so a
            // new one goes red on arrival instead of accreting quietly.
            const prefixConfig = col.prefix;
            if (prefixConfig?.field) {
              const baseCellRenderer = cellRenderer;
              // ⭐ The one site whose contract is NOT "declared type + format
              // hint": a FIXED registry key for the badge, owned by this
              // component rather than by the prefixed field (objectui#8920).
              // Named and routed through the same module so it reads as the
              // declared exception it is, not as a fifth silent convention.
              const PrefixRenderer = prefixConfig.type === 'badge' ? gridCellRendererForFixedKey(BADGE_PREFIX_RENDERER_KEY) : null;
              cellRenderer = (value: any, row: any) => {
                const prefixValue = row[prefixConfig.field];
                const prefixEl = prefixValue != null && prefixValue !== ''
                  ? PrefixRenderer
                    ? <PrefixRenderer value={prefixValue} field={{ name: prefixConfig.field, type: BADGE_PREFIX_RENDERER_KEY } as any} />
                    : <span className="text-muted-foreground text-xs mr-1.5">{String(prefixValue)}</span>
                  : null;
                return (
                  <span className="flex items-center gap-1.5">
                    {prefixEl}
                    {baseCellRenderer(value, row)}
                  </span>
                );
              };
            }

            // Auto-infer alignment from field type if not explicitly set
            const numericTypes = ['number', 'currency', 'percent'];
            const effectiveType = inferredType || col.type;
            const inferredAlign = col.align || (effectiveType && numericTypes.includes(effectiveType) ? 'right' as const : undefined);

            // Determine if column should be hidden on mobile
            const isEssential = colIndex === 0;

            return {
              header,
              accessorKey: col.field,
              // Forward the resolved (base) field type so the inline editor can
              // pick a type-aware control. Use baseInferredType (date/number/...)
              // rather than the renderer type so e.g. `date` stays `date`.
              ...(baseInferredType && { type: baseInferredType }),
              ...(schema.showColumnTypeIcons && { headerIcon: getTypeIcon(inferredType) }),
              ...(!isEssential && { className: 'hidden sm:table-cell' }),
              ...(col.width && { width: col.width }),
              ...(inferredAlign && { align: inferredAlign }),
              sortable: col.sortable !== false,
              ...(col.resizable !== undefined && { resizable: col.resizable }),
              ...(cellRenderer && { cell: cellRenderer }),
              ...(col.pinned && { pinned: col.pinned }),
              // objectui#6650 (maintainer ruling 2026-09-02, Option B). The hop
              // objectui#5453 deleted, returning WITH a reader:
              // `data-table.tsx` renders a `wrap: true` cell
              // `whitespace-normal break-words` instead of `truncate`. Spelled
              // `!== undefined` rather than truthy so an explicit `wrap: false`
              // is forwarded as the author wrote it and reaches the consumer as
              // a decision, not as an absence.
              ...(col.wrap !== undefined && { wrap: col.wrap }),
            };
          });
      }
      
      // String array format - enrich with objectDef field metadata for type-aware rendering
      return (cols as string[])
        .filter((fieldName) => typeof fieldName === 'string' && fieldName.trim().length > 0)
        .filter((fieldName) => passesFieldGate(fieldName))
        .map((fieldName, colIndex) => {
          const fieldDef = objectFields?.[fieldName];
          // objectui#10657 — a bare field name carries no type of its own, so
          // while the object's field types are unknown it is WITHHELD (see
          // path A): the mask, no inferred type.
          const withheld = isWithheldGridColumn(undefined, objectTypesPending);
          const rawFieldLabel = fieldDef?.label;
          const rawHeader = rawFieldLabel || fieldName.charAt(0).toUpperCase() + fieldName.slice(1).replace(/_/g, ' ');
          const header = schema.objectName ? resolveFieldLabel(schema.objectName, fieldName, rawHeader) : rawHeader;

          // TWO resolves, two names (objectui#8920). "Resolve type" here means
          // objectDef type > heuristic inference — WHICH TYPE THE FIELD HAS,
          // and that is `declaredType`. The published second step, WHICH
          // RENDERER THE TYPE MAPS TO, is `rendererType`; this path used to
          // skip it entirely, so a `text` + `format: 'phone'` column got
          // `TextCellRenderer` and the hint vanished with no diagnostic.
          // A local called `resolvedType` holding only the FIRST answer is the
          // trap that hid that for four of the six sites.
          //
          // The `string | null` annotation path A's `baseInferredType` needs
          // (objectui#6004: `fieldDef` is `any`, and an `any` reaching the
          // `...(declaredType && { type: declaredType })` spread below
          // collapses the emit literal) now lives on `GridCellRendering`'s
          // members — it moved into the helper's return type, it did not go
          // away.
          const { declaredType, rendererType, Renderer } = resolveGridCellRendering({
            type: withheld ? null : fieldDef?.type || inferColumnType({ field: fieldName }),
            format: fieldDef?.format,
            widget: fieldDef?.widget,
          });
          const CellRenderer = withheld ? MaskedCellRenderer : rendererType ? Renderer : null;

          // Build field metadata with objectDef enrichment
          const fieldMeta: Record<string, any> = { name: fieldName, type: rendererType || 'text' };
          if (fieldDef) {
            // The header's label, as path A hands it (objectui#11689).
            if (fieldDef.label) fieldMeta.label = header;
            if (fieldDef.currency) fieldMeta.currency = fieldDef.currency;
            // Verbatim, as the ListColumn path copies it (objectui#10354).
            if (fieldDef.currencyConfig) fieldMeta.currencyConfig = fieldDef.currencyConfig;
            if (fieldDef.precision !== undefined) fieldMeta.precision = fieldDef.precision;
            if ((fieldDef as any).scale !== undefined) fieldMeta.scale = (fieldDef as any).scale;
            // Beside `scale`, as path A copies it (objectui#11026).
            if (fieldDef.useGrouping !== undefined) fieldMeta.useGrouping = fieldDef.useGrouping;
            // The percent storage statement, as path A copies it (objectui#11475).
            if (fieldDef.max !== undefined) fieldMeta.max = fieldDef.max;
            if (fieldDef.format) fieldMeta.format = fieldDef.format;
            // The deadline declaration, as path A copies it (objectui#11815).
            if (fieldDef.dueLike !== undefined) fieldMeta.dueLike = fieldDef.dueLike;
            if (fieldDef.settledWhen !== undefined) fieldMeta.settledWhen = fieldDef.settledWhen;
            if (fieldDef.options) fieldMeta.options = translateOptions(schema.objectName, fieldName, fieldDef.options);
          }
          // Preserve relational metadata (reference, displayField, …) so
          // lookup CELLS resolve ids to names. ⛔ Not the inline picker — that
          // reads the schema def directly, see `renderCellEditor` (objectui#7154).
          applyRelationalMeta(fieldMeta, fieldDef as any);
          // Auto-generate select options from data when no options defined
          if (rendererType === 'select' && !fieldMeta.options) {
            const uniqueValues = Array.from(new Set(data.map(row => row[fieldName]).filter(Boolean)));
            fieldMeta.options = uniqueValues.map((v: any) => ({ value: v, label: humanizeLabel(String(v)) }));
          }
          if ((rendererType === 'select' || rendererType === 'status') && (fieldDef as any)?.appearance != null) {
            fieldMeta.appearance = (fieldDef as any).appearance;
          }

          const numericTypes = ['number', 'currency', 'percent'];
          const inferredAlign = rendererType && numericTypes.includes(rendererType) ? 'right' as const : undefined;

          // Auto-link primary field (first column) to record detail
          const isPrimaryField = colIndex === 0;
          let cellRenderer: ((value: any, row?: any) => React.ReactNode) | undefined;

          // The face the value takes inside the link (objectui#11817).
          const LinkContentRenderer = linkCellRenderer(rendererType, CellRenderer);
          // A `referenceVia` pointer column (objectui#12608), as path A.
          const pointerFace = withheld ? null : recordPointerFace(fieldName, declaredType, fieldDef, dataSource);

          if (isPrimaryField && LinkContentRenderer) {
            cellRenderer = (value: any, row: any) => {
              const displayContent = pointerFace?.(row) ?? <LinkContentRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />;
              return (
                <LinkCell
                  testId="primary-field-link"
                  onActivate={() => navigation.handleClick(row)}
                  objectName={schema.objectName}
                  recordId={rowRecordId(row)}
                >
                  {displayContent}
                </LinkCell>
              );
            };
          } else if (isPrimaryField) {
            cellRenderer = (value: any, row: any) => (
              <LinkCell
                testId="primary-field-link"
                onActivate={() => navigation.handleClick(row)}
                objectName={schema.objectName}
                recordId={rowRecordId(row)}
              >
                {value != null && value !== '' ? String(value) : <EmptyValue />}
              </LinkCell>
            );
          } else if (CellRenderer) {
            cellRenderer = (value: any, row: any) => pointerFace?.(row) ?? <CellRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />;
          }

          return {
            header,
            accessorKey: fieldName,
            // Forward the DECLARED type for the type-aware inline editor — the
            // renderer key would make a `format`-hinted text column edit as a
            // phone/currency control it never declared. Path A forwards
            // `baseInferredType` for exactly this reason (objectui#8920).
            ...(declaredType && { type: declaredType }),
            ...(schema.showColumnTypeIcons && rendererType && { headerIcon: getTypeIcon(rendererType) }),
            ...(inferredAlign && { align: inferredAlign }),
            ...(cellRenderer && { cell: cellRenderer }),
            sortable: fieldDef?.sortable !== false,
          };
        });
    }

    // Legacy support: use 'fields' if columns not provided.
    //
    // ⭐ THE ORDER OF THIS PATH AND THE OBJECT-SCHEMA PATH BELOW IS
    // LOAD-BEARING (objectui#6677).
    //
    // `hasInlineData` is `dataConfig.provider === 'value'`, and `dataConfig` is
    // built as `provider: 'value'` from the `data` PROP before anything else.
    // So this path is taken by EVERY grid whose rows were handed down instead
    // of fetched — which is every object-bound grid reached through a fetching
    // host (`ListView`, `ObjectView`, …). It used to return unconditionally
    // whenever rows were present, which made the object-schema path below
    // unreachable for all of them: the branch that knows the object was the one
    // that never ran. Measured, same page / source / object, one variable:
    // grid-fetches rendered the policy's 5 columns, host-fetches rendered 10 —
    // the payload's keys, including `id` (`hidden: true`) and the four audit
    // columns (`system`), exactly what the policy exists to exclude.
    //
    // The yield is as NARROW as the defect. Only the ROW-KEY FALLBACK
    // (`Object.keys(inlineData[0])`) is wrong for an object-bound grid, so only
    // that is given up, and only once there is a policy to give it up TO:
    //
    //   - `schemaFields` present ⇒ this path keeps it. An authored projection
    //     is the author's contract, and the schema path would silently drop a
    //     name the object does not declare (`if (!field) return;`) — a host may
    //     legitimately join or derive keys. `!schemaFields` is exactly the
    //     condition under which the `||` below reaches for the row keys, so the
    //     gate and the fallback cannot drift apart.
    //   - `objectSchema` still `null` ⇒ this path keeps it. ⚠️ Gating on
    //     `objectName` ALONE is the trap: the schema arrives from an async
    //     fetch, so `objectSchema` is null on first paint and the grid would
    //     fall straight through to `if (!objectSchema) return []` and render an
    //     empty header row before flipping — a worse defect than this one. It
    //     is also the graceful fallback when the schema fetch fails or the data
    //     source has no `getObjectSchema`: the row keys stay the answer instead
    //     of the grid going blank.
    //
    // Both are pinned in `hostFetchedDefaultColumns-6677.test.tsx`, together
    // with the case this file's own comment calls the right one for this path:
    // inline data with no object behind it at all.
    const rowKeysWouldOutrankSchemaPolicy = !schemaFields && !!objectName && !!objectSchema;
    if (hasInlineData && !rowKeysWouldOutrankSchemaPolicy) {
      const inlineData = dataConfig?.provider === 'value' ? dataConfig.items as any[] : [];
      if (inlineData.length > 0) {
        // FLS on the inline-data path (objectui#6723 — maintainer ruling
        // 2026-08-29: the NARROW defence-in-depth fix, not a convergence).
        //
        // The object-schema path below re-applies field-level security to the
        // columns it derives; this path did not. So whether an object-bound
        // grid re-checked FLS depended on WHO FETCHED THE ROWS: same object,
        // same authored projection, rows the grid fetched went through the
        // gate and rows a host handed down did not. That is the asymmetry, and
        // a security invariant may not be decided by the data's provenance.
        //
        // ⭐ THE LIMIT IS LOAD-BEARING, NOT AN OPTIMISATION. Only keys the
        // OBJECT DECLARES are judged; everything else passes through
        // untouched. A host may legitimately join or derive columns
        // (`computed_score`, a flattened `account.name`), and keeping those is
        // this path's whole reason to exist — the object-schema path drops
        // them outright (`if (!field) return;`). Judging an undeclared key
        // would silently drop derived columns, which is the failure
        // objectui#6723's own analysis warned about and which the ruling
        // refuses by name. `checkField` answers `false` for a field the
        // policy has never heard of, so asking it about a derived key is not
        // a stricter reading of the same rule — it is a different, wrong one.
        //
        // Redundant through `ListView`, which filters its own `effectiveFields`
        // through this same gate before forwarding (its source says so), and
        // that redundancy IS the point: the invariant must not rest on every
        // future host having read the docs. Pinned as a byte-for-byte no-op on
        // that path in `inlineDataFls-6723.test.tsx`.
        const fieldsToShow = (schemaFields || Object.keys(inlineData[0])).filter((fieldName) => {
          if (!perms?.isLoaded || !schema.objectName) return true;
          // Undeclared ⇒ host-joined / derived ⇒ not this gate's business.
          // `hasOwnProperty` rather than a truthiness read so an inherited
          // name (`constructor`, `toString`) cannot be mistaken for a declared
          // field and dropped.
          if (!Object.prototype.hasOwnProperty.call(objectFields ?? {}, fieldName)) return true;
          return perms.checkField(schema.objectName, fieldName, 'read');
        });
        return fieldsToShow.map((fieldName) => {
          const fieldDef = objectFields?.[fieldName];
          // objectui#10657 — a row key carries no type of its own, so while
          // the object's field types are unknown it is WITHHELD (see path A):
          // the mask, no inferred type. This is the path a host-fetched grid
          // with no authored columns paints first.
          const withheld = isWithheldGridColumn(undefined, objectTypesPending);
          // The same two resolves as path B, through the same shared owner
          // (objectui#8920) — and the same objectui#6004 annotation, now
          // carried by `GridCellRendering`'s `string | null` members.
          const { declaredType, rendererType, Renderer } = resolveGridCellRendering({
            type: withheld ? null : fieldDef?.type || inferColumnType({ field: fieldName }),
            format: fieldDef?.format,
            widget: fieldDef?.widget,
          });
          const CellRenderer = withheld ? MaskedCellRenderer : rendererType ? Renderer : null;
          const header = fieldDef?.label || fieldName.charAt(0).toUpperCase() + fieldName.slice(1).replace(/_/g, ' ');

          // Build field metadata with objectDef enrichment
          const fieldMeta: Record<string, any> = { name: fieldName, type: rendererType || 'text' };
          if (fieldDef) {
            // The header's label, as path A hands it (objectui#11689).
            if (fieldDef.label) fieldMeta.label = header;
            if (fieldDef.currency) fieldMeta.currency = fieldDef.currency;
            // Verbatim, as the ListColumn path copies it (objectui#10354).
            if (fieldDef.currencyConfig) fieldMeta.currencyConfig = fieldDef.currencyConfig;
            if (fieldDef.precision !== undefined) fieldMeta.precision = fieldDef.precision;
            if ((fieldDef as any).scale !== undefined) fieldMeta.scale = (fieldDef as any).scale;
            // Beside `scale`, as path A copies it (objectui#11026).
            if (fieldDef.useGrouping !== undefined) fieldMeta.useGrouping = fieldDef.useGrouping;
            // The percent storage statement, as path A copies it (objectui#11475).
            if (fieldDef.max !== undefined) fieldMeta.max = fieldDef.max;
            if (fieldDef.format) fieldMeta.format = fieldDef.format;
            // The deadline declaration, as path A copies it (objectui#11815).
            if (fieldDef.dueLike !== undefined) fieldMeta.dueLike = fieldDef.dueLike;
            if (fieldDef.settledWhen !== undefined) fieldMeta.settledWhen = fieldDef.settledWhen;
            if (fieldDef.options) fieldMeta.options = translateOptions(schema.objectName, fieldName, fieldDef.options);
          }
          // Preserve relational metadata (reference, displayField, …) so
          // lookup CELLS resolve ids to names. ⛔ Not the inline picker — that
          // reads the schema def directly, see `renderCellEditor` (objectui#7154).
          applyRelationalMeta(fieldMeta, fieldDef as any);
          // Auto-generate select options from data when no options defined
          if (rendererType === 'select' && !fieldMeta.options) {
            const uniqueValues = Array.from(new Set(data.map(row => row[fieldName]).filter(Boolean)));
            fieldMeta.options = uniqueValues.map((v: any) => ({ value: v, label: humanizeLabel(String(v)) }));
          }
          if ((rendererType === 'select' || rendererType === 'status') && (fieldDef as any)?.appearance != null) {
            fieldMeta.appearance = (fieldDef as any).appearance;
          }

          const numericTypes = ['number', 'currency', 'percent'];
          const inferredAlign = rendererType && numericTypes.includes(rendererType) ? 'right' as const : undefined;
          // A `referenceVia` pointer column (objectui#12608), as path A.
          const pointerFace = withheld ? null : recordPointerFace(fieldName, declaredType, fieldDef, dataSource);

          return {
            header,
            accessorKey: fieldName,
            // Forward the DECLARED type for the type-aware inline editor — the
            // renderer key would make a `format`-hinted text column edit as a
            // phone/currency control it never declared. Path A forwards
            // `baseInferredType` for exactly this reason (objectui#8920).
            ...(declaredType && { type: declaredType }),
            ...(schema.showColumnTypeIcons && rendererType && { headerIcon: getTypeIcon(rendererType) }),
            ...(inferredAlign && { align: inferredAlign }),
            ...(CellRenderer && {
              cell: (value: any, row: any) => pointerFace?.(row) ?? <CellRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />,
            }),
            sortable: fieldDef?.sortable !== false,
          };
        });
      }
    }

    if (!objectSchema) return [];

    const generatedColumns: ObjectGridColumnDraft[] = [];
    // Default columns priority (when schema doesn't specify columns):
    //   1. The object's `highlightFields` semantic role (ADR-0085).
    //   2. Otherwise, all schema fields with system-managed fields pushed to the end.
    //
    // Also drop fields that are platform-managed identifiers/audit columns or
    // marked `hidden: true`/`readonly: true` so default list views show only
    // the business fields users actually care about. Callers can still opt-in
    // to system columns by passing an explicit `fields` / `columns` prop.
    //
    // "System-managed" is decided by `isSystemManagedField`, which branches on
    // the framework's `field.system` flag (single source of truth stamped by
    // `applySystemFields`) — this is what keeps the injected, non-readonly
    // `owner_id` from leading the auto-derived columns, and covers any future
    // injected field without editing a name list here.
    const highlightFields: string[] | undefined = (objectSchema as any)?.highlightFields;
    const allFieldNames = Object.keys(objectSchema.fields || {});
    let fieldsToShow: string[];
    if (schemaFields) {
      fieldsToShow = schemaFields;
    } else if (highlightFields?.length) {
      // Lead with the object's name field (objectui#7245). `highlightFields` is
      // ADR-0085's "most important fields" role, not a column list — the detail
      // highlight strip, its first consumer, deliberately drops the title field
      // because the page H1 above it already shows one. A grid has no H1, so a
      // declared list like `["status", "industry", "annual_revenue"]` left rows
      // with nothing to tell them apart. `leadWithNameField` is the shared
      // helper the two app-shell synthesis faces use, so all three agree.
      //
      // Only the SYNTHESIZED branch. `schemaFields` above is author-declared and
      // is never reordered — that would be the renderer second-guessing metadata
      // (AGENTS.md Commandment #0.1).
      fieldsToShow = leadWithNameField(
        objectSchema,
        highlightFields.filter((n) => objectSchema.fields?.[n]),
      );
    } else {
      // No name-field lead here, and that is measured, not an oversight: this
      // branch takes EVERY visible field with no cap, so — unlike the two
      // app-shell faces, which slice to 5 / 6 — the name field cannot fall off
      // the end. It is already present; only its position could differ, and a
      // row that carries its name column somewhere is still identifiable. The
      // objectui#7245 defect is "no name column at all", which is unreachable
      // from here.
      //
      // Drop hidden + readonly system-managed fields, then push the remaining
      // system/audit/ownership columns (e.g. the injected, editable `owner_id`)
      // to the end as a fallback so business fields lead.
      const visibleFields = allFieldNames.filter((n) => {
        const f = objectSchema.fields?.[n];
        if (!f) return false;
        if (f.hidden) return false;
        // Drop readonly bookkeeping columns (created_at/by, updated_at/by, …).
        if (f.readonly && isSystemManagedField(n, f)) return false;
        return true;
      });
      fieldsToShow = [
        ...visibleFields.filter((n) => !isSystemManagedField(n, objectSchema.fields?.[n])),
        ...visibleFields.filter((n) => isSystemManagedField(n, objectSchema.fields?.[n])),
      ];
    }

    fieldsToShow.forEach((fieldName) => {
      const field = objectSchema.fields?.[fieldName];
      if (!field) return;

      // FLS: drop columns the current user cannot read (server-resolved
      // /me/permissions via checkField — the schema itself carries no
      // per-caller permission bits, objectstack#3661). Same gate ListView
      // applies to its auto-derived columns.
      if (perms?.isLoaded && schema.objectName
        && !perms.checkField(schema.objectName, fieldName, 'read')) return;

      // Annotated for the same reason as paths A-C (objectui#6004): `field` is
      // `any`, so these values have to be named before they reach a spread
      // below — the naming now lives on `GridCellRendering`'s `string | null`
      // members. `fieldType` is the DECLARED type the emit forwards to the
      // inline editor; the renderer comes from the `format`-promoted key, which
      // this path used to skip (objectui#8920).
      const { declaredType: fieldType, rendererType, Renderer: CellRenderer } = resolveGridCellRendering(field);
      const numericTypes = ['number', 'currency', 'percent'];
      const translatedField = field.options
        ? { ...field, options: translateOptions(schema.objectName, fieldName, field.options) }
        : field;
      const header = schema.objectName ? resolveFieldLabel(schema.objectName, fieldName, field.label || fieldName) : field.label || fieldName;
      // The face is handed the header's label, as paths A-C hand it
      // (objectui#11689).
      const fieldForCell: any = field.label ? { ...translatedField, label: header } : translatedField;
      // A `referenceVia` pointer column (objectui#12608), as path A.
      const pointerFace = recordPointerFace(fieldName, fieldType, field, dataSource);
      generatedColumns.push({
        header,
        accessorKey: fieldName,
        // Forward the field type for the type-aware inline editor.
        ...(fieldType && { type: fieldType }),
        // Aligned on the RENDERER key, like paths A-C: a `text` column with
        // `format: 'currency'` renders as currency, so it aligns as currency.
        ...(!!rendererType && numericTypes.includes(rendererType) && { align: 'right' as const }),
        cell: (value: any, row: any) => pointerFace?.(row) ?? <CellRenderer value={value} field={fieldForCell} dependentValues={row} deadlineSettled={settledFor(fieldForCell, row)} inGridColumn />,
        sortable: field.sortable !== false,
      });
    });

    return generatedColumns;
  }, [objectSchema, objectFields, objectTypesPending, schemaFields, schemaColumns, dataConfig, hasInlineData, objectName, navigation.handleClick, executeAction, data, resolveFieldLabel, translateOptions, schema.objectName, perms, uiLanguage, dataSource, predicateScope]);

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

  const columns: ObjectGridColumn[] = generateColumns().map((col): ObjectGridColumnDraft => {
    // Enrich each column with its field type so the data-table's type-aware
    // inline editor can pick the matching control (dropdown for select,
    // checkbox for boolean) the form uses, instead of a plain text box.
    // Additive: never overrides a type a path already set.
    //
    // ⭐ THE `options` KEY RETIRED HERE (objectui#6004). This pass also used to
    // write `next.options = translateOptions(…)`, and nothing read it. Measured
    // read sets, comments stripped: `data-table.tsx` reads no column-level
    // `options` at all — its select/boolean editors are not hand-rolled there,
    // they come from the host through `renderCellEditor`, and THIS component's
    // `renderCellEditor` (below) rebuilds the field from
    // `objectSchema.fields[ctx.column.accessorKey]` rather than from the column.
    // So the write had no reader on either side of the seam.
    //
    // Retiring it is behaviour-preserving because the value still has its own
    // road to every consumer that wants it — that check is part of the rule,
    // not an aside: cell renderers read translated options off the `fieldMeta`
    // built inside `generateColumns()`, and the inline editor reads them off
    // the object schema. Neither ever consulted `col.options`.
    // ⛔ THE `!col` GUARD IS KEPT ON PURPOSE — do not delete it as dead code.
    //
    // `ObjectGridColumnDraft` forbids null, so by the types this branch is
    // unreachable, and that is exactly the reasoning that would remove it. The
    // reason it stays is that this producer's type guarantee has been untrue in
    // practice, repeatedly: objectui#6004 measured FIVE separate `any` leaks
    // that defeated this boundary, one of them (`const generatedColumns:
    // any[]`) INSIDE `generateColumns()` itself, where it left a whole emit
    // path unchecked even after the return was annotated. Each was invisible
    // until someone measured it.
    //
    // So this is defence in depth BEHIND the typing, not a substitute for it —
    // the tombstones and the removed casts are the primary guard. Deleting this
    // line converts a tolerated null into a throw, which is how the protection
    // would be lost a second time for a perfectly good reason.
    if (!col || col.accessorKey === '_actions') return col;
    const fieldDef = objectFields?.[col.accessorKey];
    if (!fieldDef) return col;
    const next: ObjectGridColumnDraft = { ...col };
    if (next.type == null && fieldDef.type) next.type = fieldDef.type;
    // Read-only / computed / binary fields are not value-editable in place —
    // mark the column so the data-table never opens an editor (otherwise it
    // falls back to a plain text box for e.g. a Formula or File cell). Only
    // force `false`; leave editable unset otherwise so the grid-level flag wins.
    //
    // [objectui#12103] …and neither is a field THIS CALLER may not write: the
    // field question of the `listInlineEdit` row of the affordance-to-grant map,
    // the same `write` question an edit form asks (`fieldWriteGate`). A field
    // the permission set marks `editable: false`, or the owner field without
    // the transfer grant, keeps a read cell while the rest of the row edits;
    // before, its editor opened and the save answered 403. `inlineEditable`
    // above stays the object-level verdict for the whole grid — this only
    // narrows one column. With no `objectName`, or no provider mounted, nothing
    // is asked and the column is untouched.
    if (
      next.editable !== false &&
      (!isFieldInlineEditable(fieldDef) ||
        (!!objectName && !resolveFieldAffordance('listInlineEdit', perms, objectName, col.accessorKey)))
    ) {
      next.editable = false;
    }
    return next;
  })
    // ⭐ THE EMIT SEAM (`fc62bb490`, maintainer ruling 2026-08-25, Option B).
    //
    // Every column this component hands to `data-table` passes through here, so
    // it is the one place that can guarantee `TableColumn.type` only ever holds
    // a value that type DECLARES. Five paths above write `type`: the four
    // column literals inside `generateColumns()` and the `fieldDef.type`
    // enrichment in the map above — all of them forward an OBJECT SCHEMA's
    // field type verbatim, whose vocabulary is `@objectstack/spec`'s `FieldType`
    // (49 values, only 7 of them members of the declared union). That verbatim
    // forwarding is why the renderer had to read this key through an `as any`.
    //
    // ⛔ Deliberately a SEPARATE pass, not folded into the map above: that map
    // early-returns for `_actions` and for any column whose `accessorKey` has no
    // `fieldDef`, and a heuristic `inferColumnType()` type (`select`, `user`)
    // rides out on exactly those columns. Normalizing there would miss them.
    //
    // An out-of-union type drops the `type` KEY — never the column. See
    // `normalizeTableColumnType` for why absence beats folding onto `'text'`.
    //
    // This pass is also where the draft becomes the real thing: `type` is the
    // one member whose vocabulary differs between `ObjectGridColumnDraft` (producer
    // spelling) and `ObjectGridColumn` (what the slot declares), so the fold and the
    // type transition are the same step (objectui#6004).
    .map((col): ObjectGridColumn => {
      // ⛔ Kept on purpose, same reason as the `!col` guard in the enrichment
      // map above (objectui#6004) — unreachable by type, retained because this
      // producer's types have not held in practice. Destructuring a null below
      // would throw where the pre-#6004 code passed it through.
      if (!col) return col;
      const { type: producerType, ...draft } = col;
      // ⭐ THE MASKED FLAG (objectui#10583) — stamped HERE, before the fold,
      // because the fold is exactly what erases the answer: `password` and
      // `secret` are not `TableColumnType` members, so `normalizeTableColumnType`
      // drops them and `data-table` could never tell a masked column from a
      // text one. It also must not ask the question itself — it cannot import
      // `@object-ui/fields` — so this producer asks `isMaskedFieldType()` (via
      // `isMaskedGridColumn`) and the table obeys the flag: no Ctrl+C / Cmd+C
      // copy, no `title` tooltip, no column in its CSV export, no inline edit.
      //
      // Every path that writes `type` is covered for the same reason the fold
      // is: all four `generateColumns()` literals and the enrichment map above
      // pass through this pass. The object-declared type is read beside the
      // producer's for the narrow-only union — path A forwards a VIEW-authored
      // type ahead of the object's, and `type: 'text'` over a `secret` column
      // must keep the flag. Written only when true, so every unmasked column
      // reaches the table byte-identical to before.
      //
      // objectui#10657 — the third argument: while the object's field types
      // are unknown, a column with no type of its own is WITHHELD, and so
      // flagged. `generateColumns()` gave it no inferred type and a mask for a
      // cell; this is where every table path learns to withhold it as well.
      const masked = isMaskedGridColumn(producerType, objectFields?.[col.accessorKey]?.type, objectTypesPending);
      // objectui#12708 — THE CHIP FLAG, stamped here for the same reason as
      // the masked one: the fold below drops `select` and its kin (they are
      // not `TableColumnType` members), so `data-table` could not tell a chip
      // column from a text one. It floors a chip column at its widest drawn
      // chip. Written only when true, so every other column is unchanged.
      const chips = !masked && isChipFieldType(producerType ?? objectFields?.[col.accessorKey]?.type);
      // objectui#13377 — THE FOREIGN-KEY FLAG, for the same reason again: the
      // fold drops `lookup` / `master_detail` / `tree` / `user`, so `data-table`
      // could not tell that the raw value its cell `title` shows is the
      // referenced record's id. Read from the same type as the chip flag (the
      // authored one first), the one the cell is drawn by: a view that authors
      // `type: 'text'` over a lookup draws the id as text, and keeps the
      // tooltip. A masked column already carries none. Written only when true.
      const foreignKey = !masked && isExpandableFieldType({ type: producerType ?? objectFields?.[col.accessorKey]?.type });
      const rest = masked
        ? { ...draft, masked: true }
        : { ...draft, ...(chips ? { chips: true } : {}), ...(foreignKey ? { foreignKey: true } : {}) };
      if (producerType == null) return rest;
      const normalized = normalizeTableColumnType(producerType);
      if (normalized === undefined) return rest;
      return { ...rest, type: normalized };
    });

  // Apply persisted column order and widths
  let persistedColumns = [...columns];
  
  // Apply saved widths.
  //
  // ⭐ THE KEY IS `width` (objectui#6457). This stamp used to write `size`,
  // and `size` is a key nothing downstream consumes: `TableColumn`
  // (`@object-ui/types` `data-display.ts`) declares `width`, and `data-table`
  // resolves a column's width at all four of its sites as
  // `columnWidths[accessorKey] || col.width || autoSizedWidths[accessorKey]`
  // — zero column-level `size` reads. So a user's resize was written to
  // localStorage, read back into `columnState.widths`, stamped onto the column
  // here, and then dropped at the last hop; the width was never restored on the
  // ungrouped path.
  //
  // The grouped path is the control that identified `width` as the right fix
  // rather than teaching `data-table` a second key: `groupedColumnWidths` below
  // reads the SAME `columnState.widths` and stamps `width`, and it works.
  //
  // ⛔ Do not re-widen this callback to `(col: any)`. That cast is what let
  // the wrong key through a boundary which has DECLARED the right one since
  // objectui#6004 — `ObjectGridColumn` is `TableColumn & …`, so with the
  // callback typed, a stray `size` here is a compile error instead of a silent,
  // user-visible drop. Typed, this defect class cannot come back by hand.
  if (columnState.widths) {
    persistedColumns = persistedColumns.map((col): ObjectGridColumn => {
      const savedWidth = columnState.widths?.[col.accessorKey];
      if (savedWidth) {
        return { ...col, width: savedWidth };
      }
      return col;
    });
  }
  
  // Apply saved order
  if (columnState.order && columnState.order.length > 0) {
    const orderMap = new Map(columnState.order.map((key: string, i: number) => [key, i]));
    persistedColumns.sort((a: any, b: any) => {
      const orderA = orderMap.get(a.accessorKey) ?? Infinity;
      const orderB = orderMap.get(b.accessorKey) ?? Infinity;
      return orderA - orderB;
    });
  }

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
  const rowActionDefsGated = (resolvedRowActionDefs as any[]).filter((d) => mayInvokeRowAction(d?.requiredPermissions));
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
      cell: (_value: any, row: any) => {
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
        return (
          <RowActionMenu
            row={row}
            rowActions={customRowActions}
            rowActionDefs={resolvedRowActionDefs as any[]}
            objectFields={objectSchema?.fields}
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
            maxInlineActions={maxInlineRowActions}
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
            canEdit={rowVerdicts.canEdit}
            canDelete={rowVerdicts.canDelete}
            editPredicates={editPredicates}
            deletePredicates={deletePredicates}
            onEdit={onEdit}
            onDelete={onDelete}
            onAction={(action, r) => {
              void executeAction({ type: action, params: { record: r } }).then(res => {
                // A successful row action typically mutated this record; refresh
                // so the grid reflects the server state (same rationale as bulk).
                if (res?.success) setRefreshKey(k => k + 1);
              });
            }}
            onActionDef={(def, r) => {
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
            }}
          />
        );
      },
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
  // IS the visible heading of the drawer/modal/split/popover. Interpolating
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
   * The shell-side props every one of this component's three
   * `NavigationOverlay` call sites shares (objectui#9299).
   *
   * Spelled once because three copies of a set like this is how two of them
   * end up carrying a `popoverAnchorRef` and the third silently keeps falling
   * back to the `Dialog` the ruling closed.
   *
   * - `popoverAnchorRef` (item 3): the row the user clicked. Before this card
   *   NO renderer passed an anchor, so `popover` degraded to a `Dialog` on all
   *   five surfaces — measured, not inferred.
   * - `storageKey` / `legacyStorageKey` (item 4): one drag-resize
   *   implementation, one key per object across every view type, and a width
   *   persisted under the retired `objectui.drawerWidth.OBJECT` carries over.
   * - `width`: an unauthored width lands on the ruled default (objectui#6584)
   *   rather than on the shell's own `42rem` floor.
   */
  const recordOverlayShellProps = {
    popoverAnchorRef: anchorRef,
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
    // `ObjectGrid` already honoured all four `navigation.mode` values through
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
  if (useCardView && data.length > 0 && !isGrouped) {
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
        <div className="space-y-2 p-2" {...anchorCaptureProps}>
          {data.map((row, idx) => {
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
          })}
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

  // Both branches fill the remaining height (flex-1 + min-h-0) so the
  // BulkActionBar rendered *after* gridContent stays inside the flex column
  // and remains visible; otherwise an h-full table pushes the bar past the
  // bottom of an overflow-hidden ancestor and clips it.
  const gridContent = isGrouped ? (
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

  // For split mode, wrap the grid in the ResizablePanelGroup.
  //
  // ⭐ objectui#9299, MEASURED WHILE REPAIRING THIS CARD and repaired here.
  // This branch used to be entered on the authored mode alone, and the shell's
  // split branch opens `if (!isOpen || !mainContent) return null` — so a grid
  // authored `split` rendered NOTHING until a record was selected, and a record
  // could never be selected because there was no grid to click. Same defect
  // class as the `ObjectTree` blank the card names, on the renderer the card
  // calls correct; the card's measurement read only that `mainContent` is
  // PASSED here, never that the closed state renders. Ruling item 2 requires
  // `split` to work on all five, so the guard joins the open state.
  if (
    navigation.isOverlay
    && navigation.mode === 'split'
    && navigation.isOpen
    && navigation.selectedRecord
  ) {
    return (
      <>
        <NavigationOverlay
          {...navigation}
          title={detailTitle}
          {...recordOverlayShellProps}
          mainContent={
            <div className="flex flex-col h-full">
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
            </div>
          }
        >
          {(record) => renderRecordDetail(record)}
        </NavigationOverlay>
        {bulkDialog}
        {rowConflictDialog}
      </>
    );
  }

  return (
    <div ref={pullRef} className="relative h-full flex flex-col" {...anchorCaptureProps}>
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
