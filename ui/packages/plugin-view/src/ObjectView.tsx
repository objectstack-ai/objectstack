/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectView Component
 *
 * A complete object management interface that combines multi-view data display
 * (grid, kanban, calendar, gallery, timeline, gantt, map) with ObjectForm
 * for create/edit operations.
 *
 * Features:
 * - Multi-view type rendering via SchemaRenderer
 * - Named listViews support (e.g., "All", "My Records", "Active")
 * - Navigation config for row click behavior (page/drawer/modal/none/new_window)
 * - Direct data fetching for all view types
 * - Integrated search, filter, and sort controls
 * - ViewSwitcher for toggling between view types
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type {
  ObjectViewSchema,
  ObjectGridSchema,
  ObjectFormSchema,
  DataSource,
  ViewSwitcherSchema,
  ViewType,
  NamedListView,
  ViewNavigationConfig,
  ObjectMapConfig,
  TreeViewConfig,
} from '@object-ui/types';
import { ObjectGrid } from '@object-ui/plugin-grid';
import { ObjectForm } from '@object-ui/plugin-form';
import {
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  NavigationOverlay,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  useIsMobile,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  buttonVariants,
  toast,
} from '@object-ui/components';
import { Plus } from 'lucide-react';
import { useObjectTranslation, createSafeTranslation, useDisplayLocale, pickLocalized } from '@object-ui/i18n';
// objectui#7928 — a named view's `label` is the protocol's `I18nLabel` (a plain
// string or an inline locale map) since `ObjectViewSchema.listViews` became its
// record by reference. Resolved the way `ListView` resolves its own `label`.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
import type { ListView as SpecListView } from '@objectstack/spec/ui';
import {
  buildExpandFields,
  normalizeListViewSchema,
  mergeFilterNodes,
  columnIdentity,
  convertSortToQueryParams,
  recordDelete,
  resolveAffordance,
  resolveFilterPlaceholders,
  toFilterNodeSafely,
  type FilterTokenScope,
  type SchemaLike,
} from '@object-ui/core';
import { SchemaRenderer as ImportedSchemaRenderer, useSettledSchema, notifyDataChanged, useDataInvalidation, useFilterScope } from '@object-ui/react';
import type { HandleClickModifiers } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { ViewSwitcher } from './ViewSwitcher';
import { deriveRecordSurface } from './recordSurface';
import { useStableIdentity, isStructurallyEqual } from './stableIdentity';

/**
 * SchemaRenderer from @object-ui/react, used to render sub-view schemas.
 */
const SchemaRendererComponent: React.FC<any> = ImportedSchemaRenderer;

/**
 * The `case 'map'` branch below builds an `object-map` schema by flattening
 * `viewOptions.map`'s CONTENTS to the top level — one entry per key
 * `ObjectMapConfigSchema` declares, written under the name the FLAT form uses
 * for that key. Whitelisted rather than a whole-bag spread: `style` is ALSO
 * `BaseSchema.style` (inline CSS, legal on every node), and spreading the raw
 * `map` block collapsed the two namespaces onto one key (objectui#5177). That
 * reason is unchanged, and so is its consequence: a key the declaration does
 * NOT carry never reaches the product.
 *
 * `style` IS delivered (objectui#9950) — under its flat spelling `mapStyle`,
 * NOT by widening the whitelist to let `style` through unrenamed.
 * `getMapConfig` in `ObjectMap.tsx` reads `schema.mapStyle || schema.map?.style`
 * and deliberately does NOT read a top-level `style`, because that key is the
 * base face's inline CSS (objectui#5017). `mapStyle` is itself a declared
 * member of `ObjectMapSchema`, so the flat product stays inside the declaration
 * at both ends. Before this, a view authoring `map: { style: '<url>' }` parsed
 * green, was dropped here, and the map painted the PUBLIC DEMO TILES.
 *
 * HAND-LISTED, not derived at runtime — deliberately, and only here (`plugin-
 * map`'s own `FLAT_MAP_CONFIG_KEYS` in `ObjectMap.tsx` DOES derive from
 * `ObjectMapConfigSchema.shape`, and should stay that way): this file is
 * reachable from `examples/console-starter`'s own `src/`, so it is part of the
 * import graph `vite-alias-closure.test.ts` walks. That walker resolves a bare
 * `@object-ui/*` specifier with plain `index.<ext>` conventions and cannot find
 * `@object-ui/types/zod`'s actual barrel file (`zod/index.zod.ts` — a
 * non-standard name) — a REAL runtime import of it here reproducibly fails
 * that gate (measured on objectui#5177's first PR, PR #5231, CI run
 * 32160288416), even though Vite's own alias table already resolves the
 * specifier correctly (`examples/console-starter/vite.config.ts` has carried
 * an explicit `@object-ui/types/zod` entry since PR #5156). `ObjectMap.tsx`
 * gets away with the runtime import only because nothing in
 * console-starter's graph reaches `@object-ui/plugin-map` today.
 *
 * Anti-drift is TWO mechanisms, neither of them this comment:
 * - the type below is TOTAL — a `Record` over EVERY `keyof ObjectMapConfig`,
 *   not a list of some of them — so a key added to the declaration fails
 *   `tsc` here until it is given a flat spelling. A key can no longer be
 *   left out by simply not being written down, which is how `style` was.
 * - `ObjectView.mapFlatten.test.tsx` pins this object's key set against
 *   `ObjectMapConfigSchema.shape` — imported only from that TEST file, which
 *   the alias-closure walker explicitly excludes from traversal — and asserts
 *   the RELATION (every declared key is delivered under its flat spelling).
 *   The pre-#9950 pin could not see the omission because it compared the hand
 *   list against `shape` MINUS `style`: the set it measured against was
 *   narrowed by the same subtraction the defect was made of, so it stayed
 *   green while an authored style was being discarded.
 */
export const FLAT_MAP_CONFIG_SPELLING = {
  latitudeField: 'latitudeField',
  longitudeField: 'longitudeField',
  locationField: 'locationField',
  titleField: 'titleField',
  descriptionField: 'descriptionField',
  zoom: 'zoom',
  center: 'center',
  // The one key whose flat spelling differs from its declared name — see the
  // objectui#9950 paragraph above for why it is `mapStyle` and not `style`.
  style: 'mapStyle',
} as const satisfies Record<keyof ObjectMapConfig, string>;

/**
 * The flat products of `generateViewSchema`'s `gantt` and `timeline` branches,
 * by the same mechanism as {@link FLAT_MAP_CONFIG_SPELLING}: one entry per key
 * the `@objectstack/spec` list view's block of that kind declares, under the
 * name the renderer reads it by on the node (the same name for every key).
 * objectui#6152 round 14 put them in place of the raw spreads of each block,
 * which forwarded every key a stored block carried, after the node's own keys:
 * an undeclared key reached the node, a block key named like a node key
 * (`objectName`) overrode the node's own value, and the timeline block's
 * pre-#2231 `dateField` alias landed on `ObjectTimeline`'s FLAT `dateField`
 * prop, where it bound the axis. `ListView` carries the same gantt table.
 *
 * TOTAL over the spec's own types: a key the spec adds to either block fails
 * `tsc` here until it is listed. Type-only import, so the alias-closure walker
 * the map table's docblock describes is not involved.
 */
const GANTT_CONFIG_SPELLING = {
  startDateField: 'startDateField',
  endDateField: 'endDateField',
  titleField: 'titleField',
  progressField: 'progressField',
  dependenciesField: 'dependenciesField',
  colorField: 'colorField',
  parentField: 'parentField',
  typeField: 'typeField',
  baselineStartField: 'baselineStartField',
  baselineEndField: 'baselineEndField',
  groupByField: 'groupByField',
  resourceView: 'resourceView',
  assigneeField: 'assigneeField',
  effortField: 'effortField',
  capacity: 'capacity',
  tooltipFields: 'tooltipFields',
  quickFilters: 'quickFilters',
  autoZoomToFilter: 'autoZoomToFilter',
  viewMode: 'viewMode',
  borderColorField: 'borderColorField',
  lockField: 'lockField',
  objectField: 'objectField',
  summaryExtent: 'summaryExtent',
  defaultCollapsedDepth: 'defaultCollapsedDepth',
  dependencyTypes: 'dependencyTypes',
  timeZone: 'timeZone',
  exportFileName: 'exportFileName',
  interactions: 'interactions',
  timeSegments: 'timeSegments',
} as const satisfies Record<keyof NonNullable<SpecListView['gantt']>, string>;

/** The timeline block's declared keys; see {@link GANTT_CONFIG_SPELLING}. */
const TIMELINE_CONFIG_SPELLING = {
  startDateField: 'startDateField',
  endDateField: 'endDateField',
  titleField: 'titleField',
  groupByField: 'groupByField',
  colorField: 'colorField',
  scale: 'scale',
} as const satisfies Record<keyof NonNullable<SpecListView['timeline']>, string>;

/**
 * The gallery block's declared keys; see {@link GANTT_CONFIG_SPELLING}. One
 * difference from the two tables above: the picked keys go out NESTED, as the
 * node's own `gallery` block, because that is where `ObjectGallery` reads all
 * five (`schema.gallery.KEY`, objectui#12053). The spec's block and the
 * renderer's reads are the same five keys, so this table is both.
 */
const GALLERY_CONFIG_SPELLING = {
  coverField: 'coverField',
  coverFit: 'coverFit',
  cardSize: 'cardSize',
  titleField: 'titleField',
  visibleFields: 'visibleFields',
} as const satisfies Record<keyof NonNullable<SpecListView['gallery']>, string>;

/**
 * Copy the declared keys an author actually wrote onto the flat product,
 * each under its flat spelling — the map's keys by default, another block's
 * when a branch passes its table.
 *
 * Values travel AS WRITTEN: this is transport, not a second validation of the
 * declared block — that reading belongs to `getMapConfig` in `ObjectMap.tsx`
 * and stays there (objectui#5018). Discarding an ill-typed value here would
 * reintroduce exactly the silent drop objectui#9950 closed.
 */
function pickFlatMapConfig(
  mapConfig: unknown,
  spelling: Readonly<Record<string, string>> = FLAT_MAP_CONFIG_SPELLING,
): Record<string, unknown> {
  if (!mapConfig || typeof mapConfig !== 'object') return {};
  const source = mapConfig as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(spelling)
      .filter(([declared]) => declared in source)
      .map(([declared, flat]) => [flat, source[declared]]),
  );
}

/**
 * `table.columns` as a FIELD-NAME list — the shape the non-grid field slot
 * declares (objectui#5269).
 *
 * `ObjectGridSchema.columns` is `string[] | ListColumn[]`, but the slot the
 * non-grid branch forwards into is a names slot, and its consumers treat every
 * entry as a field name — `ObjectKanban` indexes
 * the record by it (`resolveKanbanCardFields` casts straight to `string[]`).
 * Handing a `ListColumn[]` down raw would therefore arrive as a non-empty card
 * field list naming nothing, which renders WORSE than the empty one this card
 * fixes: `ObjectKanban` skips its `highlightFields` fallback whenever the list
 * is non-empty. That is the objectui#5270 failure again — a value forwarded
 * into a slot whose declared shape it does not have — and it is answered the
 * same way, at the boundary.
 *
 * `columnIdentity` is the repo's single converged reader for "which field does
 * this column entry name" (objectui#3104), and it is what `ObjectGrid` already
 * applies to the SAME `table.columns` value on the grid path (its `$select`
 * derivation) and what `ObjectTree` applies downstream. So this narrows a
 * declared union to the branch this slot can hold; it does not widen the set
 * of accepted spellings, and it keeps the two paths resolving one value the
 * same way.
 *
 * `undefined` — never `[]` — when nothing resolves, so the `||` chain falls
 * through to the deprecated `table.fields` instead of stopping on a truthy
 * empty array.
 */
function tableColumnFieldNames(columns: unknown): string[] | undefined {
  if (!Array.isArray(columns) || columns.length === 0) return undefined;
  const names = columns.map(columnIdentity).filter((n): n is string => !!n);
  return names.length > 0 ? names : undefined;
}

/**
 * A NAMED VIEW's `columns` as a field-name list — the same identity fold as
 * {@link tableColumnFieldNames}, at the two name slots a named view reaches
 * (objectui#8254).
 *
 * ⭐ WHY THIS EXISTS NOW, AND WHY IT IS NOT A TOLERANCE LAYER. The header above
 * used to justify forwarding the two view segments RAW on the ground that they
 * "declare `string[]`". That ground is what objectui#7928's option A removes:
 * the protocol's value type for `listViews` (`ObjectListViewSchema`,
 * `@objectstack/spec/ui`) declares `columns` as the SAME `string[] |
 * ListColumn[]` union `table.columns` carries — measured on this branch by
 * `__tests__/ObjectView.specShapedNamedView-8254.test.tsx`, which builds its
 * fixture by PARSING it with that schema rather than by asserting it looks
 * right. So a spec-shaped named view can hold the `ListColumn[]` half, and
 * handing it down raw is verbatim the failure the header above describes: a
 * non-empty card field list naming nothing. Narrowing a declared union to the
 * branch a slot can hold is the boundary fix objectui#5269 already ruled for
 * `table.columns`; it accepts no spelling `columnIdentity` did not already
 * accept, and the union slots on the same branches (`gridSchema.columns`, the
 * delegated `list-view` `columns`) keep taking the value raw because their
 * declared shape holds it.
 *
 * ⚠️ PRESENCE-PRESERVING, and that is the ONE way it differs from
 * {@link tableColumnFieldNames}: `[]` in, `[]` out. That sibling folds an empty
 * list to `undefined` so its `||` chain falls through to the deprecated
 * `table.fields` alias — a PRECEDENCE decision belonging to that chain. This
 * fold changes SHAPE only: an authored empty `columns` (which
 * `ObjectListViewSchema` accepts) still stops the `||` chain exactly where it
 * stops today, so no view's source of columns moves. A list whose every entry
 * resolves to no identity does collapse to `[]` — the improvement, not a
 * precedence change: `ObjectKanban` then reaches its `highlightFields`
 * fallback instead of rendering a non-empty list of nameless columns.
 */
function viewColumnFieldNames(columns: unknown): string[] | undefined {
  if (!Array.isArray(columns)) return undefined;
  return columns.map(columnIdentity).filter((n): n is string => !!n);
}

/**
 * objectui#10885 — a named view's `hiddenFields`, applied to the column
 * projection route 2 hands `ObjectGrid`.
 *
 * The protocol composes three members of a named list view: `columns`
 * projects, `hiddenFields` subtracts, `fieldOrder` orders what survives
 * (objectstack#15184 ruling B). `ObjectGrid` has no `hiddenFields` read, and
 * `object-grid` declares no such key, so relaying the member by name would put
 * a key on the grid node that nothing reads. The subtraction is therefore made
 * here, on the resolved projection, as `ListView` subtracts it for the host
 * delegation (its `effectiveFields`), except that an entry with no field
 * identity is kept: `ListView` drops such an entry whenever `hiddenFields` is
 * non-empty.
 *
 * - Only a DECLARED projection is narrowed. With no `columns` anywhere the grid
 *   derives its own defaults, and this returns `undefined` unchanged, as
 *   `ListView` does.
 * - An entry is dropped only when `columnIdentity` names a hidden field. Every
 *   other entry, and the entry's own shape, is kept.
 * - A projection that every entry leaves is kept as the empty projection the
 *   author wrote; it does not fall back to the grid's defaults.
 *
 * Generic over the whole array type because the `columns` slot is a union of
 * two array types (`string[] | ListColumn[]`): filtering keeps each entry as it
 * was, so the result has the type the input had, which the one cast states.
 */
function withoutHiddenFields<C extends readonly unknown[]>(columns: C | undefined, hidden: readonly string[] | undefined): C | undefined {
  if (!Array.isArray(columns) || !Array.isArray(hidden) || hidden.length === 0) return columns;
  const drop = new Set(hidden);
  return (columns as readonly unknown[]).filter((entry) => {
    const name = columnIdentity(entry);
    return !name || !drop.has(name);
  }) as unknown as C;
}

/**
 * objectui#10885 — a named view's `fieldOrder`, the third step of the same
 * composition: it orders what `withoutHiddenFields` left. `ObjectGrid` has no
 * `fieldOrder` read and `object-grid` declares no such key, so the order is
 * applied here, to both projection slots.
 *
 * The application is `ListView`'s own (its `effectiveFields`), step for step,
 * so both routes hand `ObjectGrid` the same order for the same view: a stable
 * sort by each entry's position in `fieldOrder`. An entry `fieldOrder` does not
 * name, or one with no field identity, sorts after the named ones and keeps its
 * place among them; a name the projection does not carry orders nothing; with
 * no projection nothing is invented.
 */
function inFieldOrder<C extends readonly unknown[]>(columns: C | undefined, order: readonly string[] | undefined): C | undefined {
  if (!Array.isArray(columns) || !Array.isArray(order) || order.length === 0) return columns;
  const rank = new Map<string, number>(order.map((name, i) => [name, i]));
  const at = (entry: unknown): number => rank.get(columnIdentity(entry) as string) ?? Infinity;
  return [...(columns as readonly unknown[])].sort((a, b) => at(a) - at(b)) as unknown as C;
}

/**
 * objectui#10885 — a named view's `exportOptions`, in the one shape the
 * `object-grid` slot holds.
 *
 * The protocol declares the member on a named view as `{ formats?, maxRecords?,
 * includeHeaders?, fileNamePrefix?, streaming? }`, and declares a bare format
 * array as its legacy spelling, which "lifts to `{ formats: [...] }` at parse"
 * (the member's own description in `@objectstack/spec`). A named view reaches
 * this component unparsed, so the bare array can arrive as written. `ObjectGrid`
 * reads `exportOptions.formats`, which an array does not have: relayed as is,
 * the grid would offer its default formats instead of the ones the author
 * listed. So the declared union is narrowed to the slot's branch here, by the
 * protocol's own lift, the way `ListView` narrows it for the host delegation.
 * It accepts no spelling the protocol does not; the node-shape fold of a
 * declared union at the boundary is the objectui#5269 / objectui#8254 pattern
 * `viewColumnFieldNames` follows.
 */
function gridExportOptions(options: NamedViewConfig['exportOptions']): ObjectGridSchema['exportOptions'] {
  if (Array.isArray(options)) return { formats: options };
  return options;
}

/**
 * objectui#10976 — the `table` members this component hands the grid it draws
 * VERBATIM, beside the ones the grid-node build below reads off `table` by
 * name (`columns` / `fields`, `filter`, `sort`,
 * `pagination` / `pageSize`, `selection` / `selectable`, `operations`, `title`,
 * `className`).
 *
 * Each is a key `ObjectGrid` reads (`schema.KEY` in `ObjectGrid.tsx`), so a
 * value an author writes on `table` reaches a read. Before this card the slot
 * TYPED every one of them and the build copied none: `table: { editable: true }`
 * type-checked and did nothing.
 *
 * Copied only when the author wrote the key — no default is injected, so a view
 * that writes none of them hands the grid exactly what it did before. Where the
 * active NAMED view declares the same member (the objectui#10885 rungs below),
 * the named view wins and `table` is the fallback: the precedence `pagination`,
 * `selection`, `filter` and `sort` already have.
 *
 * ⛔ The slot declares these keys and the by-name ones and no other grid member
 * (`ObjectGridSlotKey` in `@object-ui/types`). A key added here is added there,
 * or `object-view-slot-key-lists.test.ts` and this file's `satisfies` refuse it;
 * `ObjectView.tableSlotRelay-10976.test.tsx` pins each one reaching `ObjectGrid`.
 * ⛔ No alias: `batchActions` and `resizableColumns` are the legacy spellings of
 * `bulkActions` and `resizable`, and the slot withholds them.
 */
export const OBJECT_VIEW_TABLE_RELAY_KEYS = [
  'aggregations',
  'bulkActionDefs',
  'bulkActions',
  'conditionalFormatting',
  'editable',
  'exportOptions',
  'frozenColumns',
  'grouping',
  'label',
  'reorderableColumns',
  'resizable',
  'rowActions',
  'rowColor',
  'rowHeight',
  'searchableFields',
  'showColumnTypeIcons',
  'showPagination',
  'showSearch',
  'singleClickEdit',
] as const satisfies readonly (keyof NonNullable<ObjectViewSchema['table']>)[];

type TableRelayKey = (typeof OBJECT_VIEW_TABLE_RELAY_KEYS)[number];
type TableRelay = Partial<Pick<ObjectGridSchema, TableRelayKey>>;

/** One relayed member, copied only when the author wrote it. */
function copyAuthored<K extends TableRelayKey>(to: TableRelay, from: TableRelay, key: K): void {
  if (from[key] !== undefined) to[key] = from[key];
}

/** The relayed `table` members the author wrote, and only those. */
function authoredTableRelay(table: ObjectViewSchema['table']): TableRelay {
  const relay: TableRelay = {};
  if (!table) return relay;
  for (const key of OBJECT_VIEW_TABLE_RELAY_KEYS) copyAuthored(relay, table, key);
  return relay;
}

/**
 * One entry of `ObjectViewSchema.listViews` — the protocol's
 * `ObjectListViewSchema`, by reference (objectui#7928). Derived from the member
 * rather than named on its own, so this component reads exactly the type the
 * contract declares.
 */
type NamedViewConfig = NonNullable<ObjectViewSchema['listViews']>[string];

/**
 * The two authored filter segments this component chains, in precedence
 * order: the active view's own filter (a named `listViews` entry, else the
 * host's `views` entry), then the object-level `table.filter`.
 *
 * A third segment, the deprecated alias `table.defaultFilters`, was read as a
 * legacy rung until objectui#12030: `@objectstack/spec` 18 retired
 * `object-grid.defaultFilters` as a tombstone that refuses by name
 * (objectstack#11509), and the read went with it, as objectui#12093 said it
 * would at the pin that carries the tombstone.
 */
interface AuthoredFilterSegments {
  view: NamedListView['filter'];
  table: ObjectGridSchema['filter'];
}

/**
 * objectui#11880 item 5 — the `table` rung of the filter this component hands
 * the grid it draws: `table.filter`, unless it lowers to nothing.
 *
 * "Lowers to nothing" is the sink's own answer (`toFilterNodeSafely`: absent,
 * `[]`, `{}`, a record of nulls), not a truthiness test; such a filter hands
 * the grid no filter, as it did while the retired `table.defaultFilters` rung
 * stood behind it and was absent.
 *
 * A REFUSED `table.filter` is kept, not skipped: it reaches `ObjectGrid`, which
 * draws its malformed-filter panel, as it did before.
 */
function gridTableFilterRung(segments: AuthoredFilterSegments): ObjectGridSchema['filter'] {
  const canonical = toFilterNodeSafely(segments.table);
  if (!canonical.ok || canonical.node !== undefined) return segments.table;
  return undefined;
}

/**
 * objectui#10506 — resolve every filter placeholder in the authored filter
 * segments ONCE, through `@object-ui/core`'s shared `resolveFilterPlaceholders`,
 * against the session scope the host provides (`useFilterScope`).
 *
 * This is the one point where the segments meet, and all three doors a filter
 * leaves this component by read from its result: the non-grid `find()`, the
 * `object-grid` schema handed to `ObjectGrid`, and the `list-view` schema handed
 * to a host's `renderListView`. Before it, this component had no read of the
 * resolver at all, so `{ owner: '{current_user_id}' }` in a named view reached
 * the query as the literal token while the app-shell host resolved it.
 *
 * ⛔ Not a second resolver, and no fallback: a token the scope cannot resolve
 * is whatever `resolveFilterPlaceholders` makes of it (left intact, with one
 * warning naming it).
 *
 * The result is HELD against its inputs rather than recomputed per render.
 * `ObjectGrid` and `ListView` both key their fetch on the filter's identity, so
 * a resolved copy minted on every render would refetch on every render; and a
 * date macro such as `{now}` resolves to a new value at every call, so holding
 * against the OUTPUT (compare, keep the old reference if equal) cannot stop
 * that either. The key is the raw segments, compared by structure — a host that
 * rebuilds an equal `views` array inline must not re-resolve (objectui#6460) —
 * plus the scope's members read one by one, never the scope object's identity
 * (AGENTS.md #10). The held pair lives in state, not in a ref read during
 * render, so the value handed out is always the one React committed.
 */
function useResolvedFilterSegments(
  segments: AuthoredFilterSegments,
  scope: FilterTokenScope,
): AuthoredFilterSegments {
  const [held, setHeld] = useState(() => resolveFilterSegments(segments, scope));
  if (
    held.currentUserId !== scope.currentUserId
    || held.currentOrgId !== scope.currentOrgId
    || held.recordId !== scope.recordId
    || held.onUnresolved !== scope.onUnresolved
    || !isStructurallyEqual(held.segments, segments)
  ) {
    // React's documented "information from previous renders" shape: a set
    // during render re-renders this component at once, before any child sees
    // the discarded pass, and the re-render finds the inputs equal.
    const next = resolveFilterSegments(segments, scope);
    setHeld(next);
    return next.resolved;
  }
  return held.resolved;
}

/** One resolution, remembered with the inputs it was computed from. */
interface HeldFilterSegments {
  segments: AuthoredFilterSegments;
  currentUserId: FilterTokenScope['currentUserId'];
  currentOrgId: FilterTokenScope['currentOrgId'];
  recordId: FilterTokenScope['recordId'];
  onUnresolved: FilterTokenScope['onUnresolved'];
  resolved: AuthoredFilterSegments;
}

function resolveFilterSegments(segments: AuthoredFilterSegments, scope: FilterTokenScope): HeldFilterSegments {
  return {
    segments,
    currentUserId: scope.currentUserId,
    currentOrgId: scope.currentOrgId,
    recordId: scope.recordId,
    onUnresolved: scope.onUnresolved,
    resolved: resolveFilterPlaceholders(segments, scope),
  };
}

/**
 * Record-create verb, shared with the runtime object pages: both surfaces
 * resolve `console.objectView.new` ("New" / 新建) so the Studio grid toolbar
 * and the running app never disagree (framework#2615 P3). Falls back to
 * English when no I18nProvider is mounted (standalone usage) — via the
 * key-identity probe, not a caught throw.
 */
function useCreateVerb(): string {
  // No try/catch: `useObjectTranslation` is provider-safe (optional context
  // read + react-i18next global-instance fallback) and never throws, so the
  // key-identity probe below is the whole "no provider" path. Wrapping a hook
  // in try/catch violates rules-of-hooks — a throw after it ran would desync
  // hook order on the next render (objectui#2879, same class as #2595/#2596).
  const { t } = useObjectTranslation();
  const value = t('console.objectView.new');
  return value === 'console.objectView.new' ? 'New' : value;
}

/**
 * English fallbacks for the headings this view resolves through `t()`
 * (objectui#3459 for the split-mode record-detail heading, objectui#3462 for
 * the create/edit/view form titles — both following #3426's shape).
 *
 * Every entry must exist HERE as well as in the locale packs: a provider-less
 * host never reaches the packs, and `createSafeTranslation`'s fallback is what
 * interpolates the placeholder.
 *
 * ── Why these keys, and not new ones ──────────────────────────────────────
 * `detail.recordDetailWithLabel` is borrowed from the `detail.*` namespace
 * rather than minted as `view.recordDetail`: `NavigationOverlay` — the very
 * component that heading is handed to — already resolves that namespace, as do
 * `ListView` / `ObjectGrid` / `ObjectKanban` / `ObjectTree`, and one heading on
 * one control should not get several translations that can drift apart.
 *
 * `form.createTitle` / `form.editTitle` are reused for the same reason, and are
 * not new: all ten packs already carry them, and `app-shell` already heads the
 * PAGE-mode record form with exactly these (`RecordFormPage.tsx`,
 * `AppContent.tsx`). The drawer / modal / popover titles below are the same
 * heading on a different surface, so they resolve the same keys — minting a
 * parallel `console.objectView.*` family would have guaranteed the two spellings
 * drift (zh already distinguishes 新建 from 创建). Only the third verb,
 * `form.viewTitle`, had no sibling; it was added to all ten packs.
 *
 * Note the placeholder is `{{object}}`, not `{{label}}` — that is the variable
 * the existing `form.*Title` family declares, and the pack-vs-en placeholder
 * parity guard compares placeholder sets per key.
 *
 * `detail.recordDetailWithLabel` doubles as the probe key: under a provider
 * `t()` returns the pack's template (≠ the key) so the real translator is used;
 * with no provider the key comes back unchanged and this map supplies the
 * English.
 */
const VIEW_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'detail.recordDetailWithLabel': '{{label}} Detail',
  // Byte-for-byte the strings `getFormTitle` used to build with a template
  // literal, so an English session and every e2e spec that addresses this
  // chrome by name see no change at all.
  'form.createTitle': 'Create {{object}}',
  'form.editTitle': 'Edit {{object}}',
  'form.viewTitle': 'View {{object}}',
  // objectui#10383 — the grid's row / bulk Delete. Not new keys: these are the
  // ones the console's own list delete resolves, all present in the ten packs.
  // The `objectActions.*` rows are asked for by the shared `recordDelete` core
  // (`@object-ui/core`), which this view hands `tView`, so a provider-less host
  // reads them here. The dialog's copy is the core's too
  // (`recordDelete.confirmCopy`, objectui#11695): the title, the
  // `console.objectView.bulkDeleteConfirm` question and the Delete label;
  // `actionConfirm.cancel` is this host's own chrome, in the console's
  // `ActionConfirmDialog` shape.
  'actionConfirm.cancel': 'Cancel',
  'objectActions.deleteConfirmTitle': 'Delete {{label}} "{{name}}"?',
  'objectActions.bulkDeleteConfirmTitle': 'Delete {{count}} {{label}} records?',
  'objectActions.bulkDeleteConfirmTitle_one': 'Delete {{count}} {{label}} record?',
  'objectActions.bulkDeleteConfirmTitle_other': 'Delete {{count}} {{label}} records?',
  'objectActions.deleteConfirmButton': 'Delete',
  'objectActions.deleteConfirm': 'Are you sure you want to delete this record?',
  'console.objectView.bulkDeleteConfirm': 'Delete {{count}} selected records? This cannot be undone.',
  // Count families (objectui#11445): `fallbackT` reads a family's `_one` /
  // `_other` row for a numeric `count`, as i18next reads the `en` pack.
  'console.objectView.bulkDeleteConfirm_one': 'Delete {{count}} selected record? This cannot be undone.',
  'console.objectView.bulkDeleteConfirm_other': 'Delete {{count}} selected records? This cannot be undone.',
  'objectActions.deleteSuccess': '{{label}} deleted successfully',
  'objectActions.deleteFailed': 'Failed to delete {{label}}',
  'objectActions.bulkDeleteSuccess': 'Deleted {{count}} {{label}} records',
  'objectActions.bulkDeleteSuccess_one': 'Deleted {{count}} {{label}} record',
  'objectActions.bulkDeleteSuccess_other': 'Deleted {{count}} {{label}} records',
  'objectActions.bulkDeletePartial': '{{succeeded}} deleted, {{failed}} failed',
};

const useObjectViewTranslation = createSafeTranslation(
  VIEW_DEFAULT_TRANSLATIONS,
  'detail.recordDetailWithLabel',
);

export interface ObjectViewProps {
  /**
   * The schema configuration for the view
   */
  schema: ObjectViewSchema;

  /**
   * Data source (ObjectQL or ObjectStack adapter) — REQUIRED. This component
   * never resolves one for itself.
   *
   * This comment used to close with "If not provided, falls back to
   * SchemaRendererProvider context", one line above a declaration that has
   * been required for its whole life (objectui#7842). The measurement that
   * settled which of the two was wrong: `ObjectView` holds no context read at
   * all — no `useContext`, no `SchemaRendererContext`, and not
   * `useElementDataSource`, which is how `@object-ui/react` spells that
   * fallback for the components that genuinely have one. The value travels
   * from this prop into `useSettledSchema(schemaKey, dataSource)` (which has
   * no context read either) and into the two effects below, and every one of
   * those sites GUARDS on it instead of resolving one —
   * `if (!dataSource?.onMutation …) return;` and
   * `if (!dataSource || !schema.objectName) return;`.
   *
   * The promise was not invented, it was MISFILED. `ObjectViewRenderer`
   * (`./index.tsx`) — the renderer registered for the `object-view` and `view`
   * schema tags — is the thing that does exactly what that sentence described:
   * it reads `useContext(SchemaRendererContext)` and hands `ctx?.dataSource`
   * down to this prop. A schema-driven host therefore does get the provider's
   * adapter; a caller writing `<ObjectView …>` in TSX does not, and tsc
   * refuses the omission at the call site.
   *
   * What happens if it is absent anyway (an untyped JS host, or that
   * registered renderer with no provider mounted, which passes `null`):
   * nothing throws and nothing is fetched. `useSettledSchema` settles with
   * `def: null`, both effects return early, and the value is forwarded
   * verbatim to `ObjectGrid` / `SchemaRenderer`, whose own `dataSource` is
   * declared optional. The view renders its chrome and stays empty.
   *
   * ⛔ Making this prop optional would WIDEN a published accept set — a
   * maintainer's ruling, not a passing edit (objectui#7842). Pinned by
   * `__tests__/ObjectView.dataSourceContextFallback-7842.test.tsx`.
   */
  dataSource: DataSource;

  /**
   * Additional CSS class
   */
  className?: string;

  /**
   * Views available for the ViewSwitcher.
   * Each view defines a type (grid, kanban, calendar, etc.) and display columns/config.
   * If not provided, uses schema.listViews or falls back to default grid view.
   *
   * `sort` spells its direction key `order`, like every other sort surface in
   * the repo (`SortConfig`, `NamedListView.sort`, `ObjectGridSchema.sort`)
   * and like the shared sink `convertSortToQueryParams` reads
   * it. It used to be declared as `direction` (objectui#5293), which NO
   * consumer of THIS prop ever read: all three consumers of the resolved
   * `activeView.sort` read `order`, so a host writing `direction: 'desc'` got a
   * SILENTLY ascending list — the sink's `entry.order === 'desc'` is false for
   * a missing key, the grid built the wire string `name undefined`, and
   * `parseSchemaSort` drew an ascending arrow above it. The rename does not
   * remove a working feature; it converts that silent wrong answer into a loud
   * type error.
   *
   * The claim is scoped to those three consumers on purpose. The published
   * `toSortItems` export elsewhere in this package used to fold
   * `s.order || s.direction` for the studio inspector-draft — a different
   * surface, unreachable from this prop, which is why it was not retired with
   * this rename. It has since been retired on its own card (objectui#6011), so
   * `order` is now the only sort spelling this package reads on either surface.
   *
   * ⛔ Deliberately NOT a tolerant dual-read (`direction ?? order`) — that is
   * the tolerance layer objectui#4869 ruled against, and re-adding it here
   * would restore the very spelling drift this declaration now closes.
   */
  views?: Array<{
    id: string;
    label: string;
    type: ViewType;
    columns?: string[];
    sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
    filter?: any[];
    /**
     * Per-view `tree` config — the block the `'tree'` branch of
     * `generateViewSchema` below reads (objectui#8253, ruling batch #78,
     * option (a), maintainer 「同意」).
     *
     * ⭐ This declaration can only NARROW, and that is the whole of its value.
     * The `[key: string]: any` on the line under it already ADMITTED a `tree`
     * key of any shape, so nothing that used to be refused becomes accepted;
     * what changes is that a host writing this entry as an object LITERAL now
     * gets `parentFeild` reported as an excess property instead of stored,
     * dropped and never mentioned. That is the class-(c) defect this card was
     * filed for.
     *
     * ⛔ Declared, ⛔ not re-declared: the shape is `TreeViewConfig` in
     * `@object-ui/types`, which `plugin-tree`'s resolver imports as well. One
     * declaration, three readers.
     *
     * ⭐ And since objectui#8841 that one declaration is the PROTOCOL's:
     * `TreeViewConfig` is `NonNullable<ListView['tree']>` from
     * `@objectstack/spec/ui`, not a hand copy of it under a second name. What
     * this prop admits is therefore exactly what `@objectstack/spec` admits on
     * `ListView.tree` — including its refusal of `titleField`, which the copy
     * declared and the protocol rejects.
     *
     * ⚠️ Reach, measured on this tree and NOT claimed wider than it is: the
     * console's own call site passes `mergedViews`, built by
     * `app-shell/src/views/ObjectView.tsx` as `views.map((v: any) => …)` over
     * STORED view records, so it arrives here as `any[]` and this declaration
     * reports nothing about it. It bites a host that composes the entry inline
     * against this prop's type. Typing the stored-record path is a separate
     * change on app-shell, recorded rather than smuggled in here.
     */
    tree?: TreeViewConfig;
    [key: string]: any;
  }>;

  /**
   * The currently active view ID.
   * Used for controlled ViewSwitcher state.
   */
  activeViewId?: string;

  /**
   * Callback when the active view changes
   */
  onViewChange?: (viewId: string) => void;

  /**
   * Callback when a row is clicked (for record detail navigation)
   *
   * TWO parameters since objectui#9462, and the second is not decoration. The
   * view's own `handleRowClick` is what `ObjectGrid` hands to
   * `useNavigationOverlay`, and that hook invokes it as
   * `onRowClick(record, event)` — the modifier payload (`metaKey` / `ctrlKey` /
   * `button`) a host needs to implement Cmd/Ctrl/middle-click for itself.
   * `handleRowClick` used to forward one argument, so this prop delivered
   * nothing on the second and a host's "open in a new tab" degraded to an
   * ordinary navigation. Spelled `any` and not `HandleClickModifiers` for the
   * reason objectui#9341 measured on `ObjectKanbanSchema.onCardClick`: a host
   * that discovered the payload from the implementation annotated it
   * `React.MouseEvent`, which a narrower declaration refuses contravariantly.
   *
   * Supplying it hands the host the WHOLE decision, modifier clicks included.
   * With no handler, the view answers a Cmd/Ctrl/middle-click itself by opening
   * the record in a new browser tab (objectui#9806). A row the view made inert
   * stays inert: under `navigation.mode: 'none'`, `navigation.preventNavigation`,
   * or `operations.read: false` with no navigation config, a modifier click does
   * nothing, as a plain click does.
   */
  onRowClick?: (record: Record<string, unknown>, event?: any) => void;

  /**
   * Callback when edit is triggered on a record
   */
  onEdit?: (record: Record<string, unknown>) => void;

  /**
   * Render a custom ListView implementation for multi-view support.
   * When provided, this replaces the default view rendering for the content area.
   */
  /**
   * ADR-0053: when the host (app-shell ObjectView) already renders the view
   * switcher (ViewTabBar), set this so the inner view doesn't render its own
   * duplicate named-view tab row. Standalone consumers leave it unset.
   */
  hideNamedViewTabs?: boolean;

  renderListView?: (props: {
    schema: any;
    dataSource: DataSource;
    onEdit?: (record: Record<string, unknown>) => void;
    /**
     * The view's own `handleRowClick`, verbatim — so TWO parameters since
     * objectui#9462, for the same reason {@link ObjectViewProps.onRowClick}
     * carries them: a custom list view that has a DOM click event in hand may
     * pass it, and it reaches the host through the forward below.
     */
    onRowClick?: (record: Record<string, unknown>, event?: any) => void;
    className?: string;
    /** Current refresh counter — increment signals that a mutation occurred */
    refreshKey?: number;
    /** Same handler the built-in toolbar's "+ New" button uses — forward it
     * into the custom list view's own add-record affordance (e.g. ListView's
     * `addRecord.enabled` toolbar button) so callers can fold record creation
     * into their list's toolbar instead of the separate `showCreate` row. */
    onAddRecord?: () => void;
  }) => React.ReactNode;

  /**
   * Toolbar addon: extra elements to render in the toolbar (e.g., MetadataToggle)
   */
  toolbarAddon?: React.ReactNode;

  /**
   * Callback when the "+" create view button is clicked in ViewSwitcher.
   */
  onCreateView?: () => void;

  /**
   * Callback when a per-view action is triggered in ViewSwitcher.
   */
  onViewAction?: (action: string, viewType: ViewType) => void;
}

type FormMode = 'create' | 'edit' | 'view';

/**
 * HOST-COMPOSITION SURFACE on the `object-view` node — the keys the
 * `renderListView` delegation branch reads off the node that are deliberately
 * NOT declared members of `ObjectViewSchema`, and ⛔ not to be taught as
 * schema keys anywhere in the docs (objectui#5097).
 *
 * ## The verdict
 *
 * The delegation branch in `renderContent` below reads 30 distinct keys off
 * the object-view node through `(schema as any).K` and forwards them to the
 * host's list renderer. Three of them — `data`, `navigation`,
 * `searchableFields`, listed in
 * {@link OBJECT_VIEW_DECLARED_FORWARDED_KEYS} — are declared members of
 * `ObjectViewSchema`. The other 27, listed here, are not, and stay that way:
 * they are HOST-COMPOSITION surface, not authored surface. This constant is
 * their single home; the branch is fenced by `#region` markers so the pin in
 * `src/__tests__/objectViewHostSurface.test.tsx` fails BY NAME when a read is
 * added or removed without touching this list.
 *
 * ## The ruling that made it deliberate
 *
 * Maintainer, 2026-08-18, on objectui#5097, verbatim 「同意」: the 27 keys are
 * HOST surface, exempted with reasons — not authored surface. Basis: measured
 * reachability. The delegation branch is entered ONLY when a host passes the
 * `renderListView` prop; the registered renderer does not pass it; so the
 * schema-registration path documented to authors cannot reach these keys at
 * all, and declaring them on `ObjectViewSchema` would promise authors a
 * surface that does nothing on their path.
 *
 * ⛔ Do not declare these on `ObjectViewSchema`, and ⛔ do not delete a read as
 * a tidy-up — deleting a read is what silently blanks a stored app-shell
 * document, and it is exactly what a reader of "not authored surface" is most
 * likely to think is the clean finish. The structural follow-through (typing
 * this block as an explicit host-side prop contract, so host surface and
 * authored surface are separated in types, and retiring the `(schema as any)`
 * reads) is owned by the objectui#5043 family track, not by this exemption.
 *
 * ## Who supplies the prop — what makes "host surface" checkable
 *
 * Every in-tree non-test supplier lives in `@object-ui/app-shell`, and there
 * are TWO of them. Re-measured on `main` at `e03dfa5ea`; both were already
 * present at the ruling's base `9fbb9b52f`, which named only the first:
 *
 *   - `packages/app-shell/src/views/ObjectView.tsx:1718` — the React host
 *     defines the callback; it is passed at `:2481` and `:2524`.
 *   - `packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx:2575`
 *     — the Studio design surface, as `renderListView={renderStudioGridList}`.
 *
 * The registered renderer is `ObjectViewRenderer` (`./index.tsx:58`), which
 * renders `ObjectView` with `schema` and `dataSource` only and passes no
 * `renderListView`. It is registered twice — under `object-view`
 * (`./index.tsx:66`) and under the alias `view` (`./index.tsx:100`) — and
 * neither registration can reach this branch.
 *
 * ## What the contract says about these keys
 *
 * Nothing at all, and that is the shape of the answer here — unlike the
 * sibling `object-grid` exemption (objectui#5091, PR #5241), where the spec
 * answered `unrecognized_keys` by name. `@objectstack/spec`'s
 * `ComponentPropsMap` carries no `object-view` entry, so the repo-wide
 * `registry-inputs-spec-parity` gate — which derives its expectations FROM
 * `ComponentPropsMap` — never covers this node in either direction and is owed
 * nothing here. The node's published authoring surface is the registry
 * `inputs` list at `./index.tsx:71-86` (15 names; the alias `view` declares no
 * `inputs` at all), and none of the 27 appears on either registration.
 *
 * ## The one asymmetry — `conditionalFormatting` — RESOLVED (objectui#5248)
 *
 * As ruled on 2026-08-18, 26 of the 27 were read ONLY inside the host-only
 * branch, and `conditionalFormatting` had a SECOND read site in
 * `generateViewSchema`'s kanban branch — reachable through the REGISTERED
 * renderer, so for that one key the ruling's "the authored path cannot reach
 * it" basis was narrower than for its 26 neighbours. objectui#5097 recorded the
 * gap rather than acting on it and filed the contract question as
 * objectui#5248.
 *
 * That question is now answered, and the gap is closed. Maintainer ruling of
 * 2026-08-19 (verbatim 「全部接受」, recorded on objectui#5248): a conditional —
 * Option 2 gated on a liveness check, Option 1 (declare the key) had the check
 * found real authored usage. The liveness check came back EMPTY:
 *
 *   - objectui `content/docs/**`, `skills/**`, `examples/**`, `apps/**`:
 *     `conditionalFormatting` occurs in exactly two files, on `object-grid`
 *     (`content/docs/plugins/plugin-grid.mdx`) and on `list-view`
 *     (`skills/objectui/guides/schema-expressions.md`) — both DECLARED homes,
 *     neither an object-view node.
 *   - objectstack: no authored `object-view` node exists at all (two prose
 *     mentions repo-wide), against 54 files carrying `object-form` and 19
 *     carrying `object-grid` as the control.
 *   - No in-repo fixture or catalog schema carries both an object-view node and
 *     the key: the only files carrying both are this one, its pin test, the
 *     type declarations, app-shell's host (which reads the key into the
 *     delegated `list-view` node, not onto the object-view node) and prose.
 *
 * So the fallback read was dropped from the kanban branch (see
 * `kanbanConditionalFormatting`). Every one of the 27 is now read ONLY inside
 * the `#region` fence, and the exemption's stated basis holds for all of them
 * without exception. The pin in `objectViewHostSurface.test.tsx` asserts the
 * resolution directly: ZERO exempt keys are read outside the fence.
 */
export const OBJECT_VIEW_HOST_COMPOSITION_KEYS = [
  'addDeleteRecordsInline',
  'addRecord',
  'addRecordViaForm',
  'allowExport',
  'allowPrinting',
  'aria',
  'bulkActions',
  'clickIntoRecordDetails',
  'collapseAllByDefault',
  'color',
  'compactToolbar',
  'conditionalFormatting',
  'emptyState',
  'fieldTextColor',
  'hiddenFields',
  'inlineEdit',
  'pagination',
  'prefixField',
  'resizable',
  'rowActionDefs',
  'rowActions',
  'selection',
  'sharing',
  'showDescription',
  'showRecordCount',
  'userFilters',
  'wrapHeaders',
] as const;

/**
 * The other three keys the same branch reads through `(schema as any)`: these
 * ARE declared members of `ObjectViewSchema` (`data` via `BaseSchema`), so
 * they are authored surface and are NOT part of the objectui#5097 exemption.
 * They are listed so the pin can assert the split, not just the exempt half —
 * a read that moves from this list into the one above is a key losing its
 * declaration, and must fail loudly.
 *
 * `filterableFields` was the fourth until objectui#13118: `@objectstack/spec`
 * retires it in 18.0 (objectstack#24640, ruling C) and no per-view Filter-panel
 * whitelist replaces it, so this branch no longer forwards it from any source.
 * `ObjectViewSchema` keeps it only as the spec's slot by reference, deprecated,
 * until the pin bump that takes the retirement carries the spec's tombstone.
 */
export const OBJECT_VIEW_DECLARED_FORWARDED_KEYS = [
  'data',
  'navigation',
  'searchableFields',
] as const;

/**
 * HOST-COMPOSITION VIEW TYPES on the `object-view` node — the two
 * `generateViewSchema` branches an author cannot select, deliberately NOT
 * added to the authored view-type unions, and ⛔ not to be taught as
 * authorable `defaultViewType` / `NamedListView.type` values anywhere in the
 * docs (objectui#5321).
 *
 * ## The verdict
 *
 * `generateViewSchema` below switches on eight view types. The type an AUTHOR
 * uses to select one admits six of them: `ObjectViewSchema.defaultViewType`
 * and `NamedListView.type` (both `@object-ui/types`) are the same seven-value
 * union `'grid' | 'kanban' | 'gallery' | 'calendar' | 'timeline' | 'gantt' |
 * 'map'`, and neither spells `tree` or `chart`. The one segment that can is
 * the `views` PROP on this component, which is typed `ViewType` — and
 * `ViewType` carries both. So `currentViewType` is `tree` or `chart` only when
 * a HOST composes `ObjectView` with a `views` prop; from authored metadata
 * those two branches are unreachable, including the tree branch's own
 * `viewOptions.tree.*` config surface and the ADR-0021 dataset-bound chart
 * shape.
 *
 * ## The ruling that made it deliberate
 *
 * Maintainer, 2026-08-20, on objectui#5321, verbatim 「其他接受你的建议。」:
 * option B — `tree` and `chart` are RECORDED as host-composition-only
 * surfaces, following the objectui#5097 precedent above, rather than added to
 * the authored unions. Declaring two more authored members is a permanent
 * authoring-surface obligation with no measured pull; the exemption gets
 * revisited the day a real metadata-authoring need for tree or chart views
 * arrives.
 *
 * ## Host-only is not dead — the path is live
 *
 * Measured, not assumed: `@object-ui/app-shell`'s console passes stored view
 * records to this component as `views`, and its `CreateViewDialog` offers
 * `tree` and `chart` among the nine types a console user can create. That is
 * the path these branches serve, and it is why the icon map beside them is
 * total over `ViewType` rather than over the authored union.
 *
 * ## What holds the record honest
 *
 * The exemption is a claim about REACHABILITY, so both halves are pinned:
 *
 *   - `src/__tests__/objectViewHostSurface.test.tsx` — the record. The branch
 *     set is re-derived from the `#region` fence around the switch below, so a
 *     ninth branch (or a deleted one) fails BY NAME instead of quietly
 *     changing what this list describes; and type-level pins fail
 *     `pnpm type-check` the day either authored union grows a `tree` or
 *     `chart` member, because that is the day this record goes stale.
 *   - `src/__tests__/ObjectView.hostOnlyViewTypes.test.tsx` — the basis,
 *     measured: a host `views` prop still reaches both branches. An exemption
 *     whose reachability stops being proved is a record about nothing.
 *
 * ⛔ Do not "finish" this by deleting the branches as unreachable code. They
 * are unreachable from AUTHORED metadata only; host composition is a supported
 * path with a live consumer.
 */
export const OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES = [
  'chart',
  'tree',
] as const;

/**
 * The view types whose renderer DRAWS the rows this component's non-grid fetch
 * reads (objectui#10982). An ALLOW-list: the fetch, and its data-invalidation
 * subscription (`fetchDrawsView` in the component), run for these types and
 * for nothing else.
 *
 * Read off each `generateViewSchema` case AND the renderer it resolves to,
 * because a case alone does not decide it. The rows reach a view as the `data`
 * prop `SchemaRenderer` spreads onto the registered renderer, and:
 *
 *   - `object-kanban`, `object-calendar` and `object-map` spread that prop
 *     into their component, and `object-gallery` / `object-timeline` read it —
 *     each draws the handed array in place of its own query;
 *   - `object-gantt`'s registered wrapper hands its component the schema
 *     alone, so the chart never sees the array and queries for itself
 *     (pinned in plugin-gantt, `ObjectGantt.hostDataProp-7210.test.tsx`);
 *   - `object-tree` runs its own full query ahead of any rows it is handed
 *     (objectui#10778), and `object-chart` never reads them;
 *   - a type `generateViewSchema` has no case for (`page`, `list`, `detail`)
 *     falls through to `ObjectGrid`, which queries for itself.
 *
 * Every renderer outside the list reads the bus itself, so a read here only
 * added requests beside its own (and, for the tree, a second query of its own
 * each time the handed array changed). The list used to be a deny-list of
 * `grid` / `tree` / `chart`, which is how `gantt` and every case-less type
 * were read and re-read for rows nothing draws.
 *
 * ⛔ A new view type fetches only when it is added HERE and its case hands the
 * rows on; adding it to one without the other either draws nothing or reads
 * for nothing.
 */
const VIEW_TYPES_DRAWING_FETCHED_ROWS: ReadonlySet<string> = new Set([
  'kanban',
  'calendar',
  'gallery',
  'timeline',
  'map',
]);

/**
 * ObjectView Component
 *
 * Renders a complete object management interface with multi-view rendering
 * and integrated CRUD operations.
 *
 * @example Basic usage (grid only)
 * ```tsx
 * <ObjectView
 *   schema={{
 *     type: 'object-view',
 *     objectName: 'users',
 *     layout: 'drawer',
 *     showSearch: true,
 *     showFilters: true,
 *   }}
 *   dataSource={dataSource}
 * />
 * ```
 *
 * @example Named listViews
 * ```tsx
 * <ObjectView
 *   schema={{
 *     type: 'object-view',
 *     objectName: 'contacts',
 *     listViews: {
 *       all: { label: 'All Contacts', type: 'grid', columns: ['name', 'email', 'phone'] },
 *       board: { label: 'By Status', type: 'kanban', columns: ['name'], kanban: { groupByField: 'status', columns: ['name', 'email'] } },
 *       calendar: { label: 'Meetings', type: 'calendar', columns: ['name'], calendar: { startDateField: 'meeting_date' } },
 *     },
 *     defaultListView: 'all',
 *   }}
 *   dataSource={dataSource}
 * />
 * ```
 *
 * @example With navigation config
 * ```tsx
 * <ObjectView
 *   schema={{
 *     type: 'object-view',
 *     objectName: 'accounts',
 *     navigation: { mode: 'drawer', width: '600px' },
 *   }}
 *   dataSource={dataSource}
 * />
 * ```
 */
export const ObjectView: React.FC<ObjectViewProps> = ({
  schema,
  dataSource,
  className,
  views: viewsProp,
  activeViewId,
  onViewChange,
  onRowClick,
  onEdit: onEditProp,
  renderListView,
  hideNamedViewTabs,
  toolbarAddon,
  onCreateView,
  onViewAction,
}) => {
  const createVerb = useCreateVerb();
  // Headings this view owns: the split-mode record-detail panel (see the split
  // branch far below) and the create/edit/view form titles (`getFormTitle`).
  // Declared with the other top-level hooks so it stays above every conditional
  // return — rules-of-hooks.
  const { t: tView } = useObjectViewTranslation();
  // The UI language the `form` slot's `title` and `description` resolve against
  // (objectui#10993). Both are `ObjectFormSchema`'s `I18nLabel` members, and
  // `ObjectForm` resolves the same form's other labels against this language,
  // so the heading this view draws around the form and the form's own buttons
  // read in one language. A top-level hook for the same rules-of-hooks reason.
  const { language: uiLanguage } = useObjectTranslation();
  // The locale a named view's `I18nLabel` resolves in on the tab strip
  // (objectui#7928). A top-level hook for the same rules-of-hooks reason.
  const displayLocale = useDisplayLocale();
  // The object-schema read and the fact that it has SETTLED are ONE piece of
  // state, keyed by the object it belongs to (objectui#6419). This replaces a
  // `useState` + a render-body `objectSchemaRef.current = objectSchema` write,
  // which existed so the non-grid fetch effect below could read the schema
  // without listing it as a dependency. That bought the effect one run per
  // mount — and paid for it with the expansion, permanently: on that one run
  // the ref was still `null`, so `buildExpandFields` saw no fields and the
  // query went out with no `$expand` at all, for every non-grid view this
  // component hosts.
  //
  // Two separate states (`def` + `hasSettled`) could disagree for one commit —
  // long enough for the record query to fire against the previous object's
  // expand set — and a bare `objectSchema` cannot express "settled with
  // nothing", which is a legitimate outcome (an adapter with no
  // `getObjectSchema`, or a read that threw). `key` is compared against the
  // CURRENT object name during render, so switching objects closes the gate in
  // the same commit that changes it, not one commit later.
  //
  // Since objectui#7225 (maintainer ruling B, 2026-09-02) this is the SHARED
  // `useSettledSchema` rather than this component's hand copy of it — the
  // convergence #6482 asked for, amended from "migrate incidentally" to one
  // PR once the migration's cost was measured at zero behaviour delta. The
  // shape is unchanged because the hook was EXTRACTED from this shape.
  const schemaKey = schema.objectName ?? '';
  /**
   * Has the object schema for THIS object finished resolving? Note what this is
   * NOT: "`objectSchema` is truthy". A view whose adapter exposes no
   * `getObjectSchema`, or whose schema read failed, must still fetch its rows —
   * gating on a truthy schema would leave those views empty forever.
   */
  const { ready: objectSchemaReady, def: objectSchema } =
    useSettledSchema<Record<string, unknown>>(schemaKey, dataSource);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // P2: Auto-subscribe to DataSource mutation events for non-grid views.
  // When a DataSource implements onMutation(), ObjectView auto-refreshes
  // its own data fetch (for non-grid view types like kanban, calendar, etc.)
  // whenever a create/update/delete occurs on the same objectName.
  //
  // ListView-driven configurations already manage refreshKey via
  // form success / delete handlers. To avoid double refreshes and
  // duplicate find() calls, skip auto-subscription when renderListView is provided.
  //
  // objectui#10035 — the same write is also published on the data-invalidation
  // bus, because `ObjectGrid`, `ObjectGantt` and `ObjectChart` query for
  // themselves and read that bus, not `refreshKey` (see `renderContent`). The
  // console's `useMutationInvalidationBridge` announces every dataSource write
  // already, so there this is a duplicate raised in the SAME synchronous
  // `onMutation` dispatch — React batches the two into one render, one
  // refetch. Where no bridge is mounted (an `object-view` embedded outside the
  // console) it is the only announcement, and it is what keeps a write reaching
  // those renderers now that they are no longer remounted to show it.
  useEffect(() => {
    if (!dataSource?.onMutation || !schema.objectName) return;
    if (renderListView) return;
    const unsub = dataSource.onMutation((event: any) => {
      if (event.resource === schema.objectName) {
        setRefreshKey(prev => prev + 1);
        notifyDataChanged({
          objectName: event.resource,
          recordId: event.id != null ? String(event.id) : undefined,
        });
      }
    });
    return unsub;
  }, [dataSource, schema.objectName, renderListView]);

  // Data fetching state for non-grid views
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  // objectui#10982 — the request the rows in `data` answer, written in the same
  // block as `setData` and read only by the fetch effect below. A run that
  // issues that same request again is a RE-READ (a data-invalidation event,
  // `refreshKey`), which keeps those rows on screen until the new ones land;
  // any other run is a first load for its request and shows the placeholder.
  const drawnRequestRef = useRef<string | null>(null);

  // NOTE: this component used to carry its own filter/sort BAR — `filterValues`
  // and `sortConfig` state, a `filter-ui` schema and a `sort-ui` schema. None of
  // it was ever connected: no setter was called and neither schema was rendered,
  // so both states stayed at their initial empty value for the component's whole
  // life. It was removed rather than wired, because the real filter and sort UI
  // belongs to the renderer this component delegates to — `showFilters` and
  // `showSort` are forwarded downstream (see `baseProps` and the list-view
  // schema below) and `ListView` implements them. Wiring the
  // local copy would have produced a SECOND filter bar competing with that one.
  //
  // The dead state was not harmless: every merge path here had a branch keyed on
  // it that could never run, and those branches read as live code. Two separate
  // "bugs" reported against them during objectui#3081 were unreachable for this
  // reason — see the correction in that PR.

  // --- Named listViews ---
  const namedListViews = schema.listViews;
  const hasNamedViews = namedListViews != null && Object.keys(namedListViews).length > 0;
  const [activeNamedView, setActiveNamedView] = useState<string>(() => {
    if (schema.defaultListView && namedListViews?.[schema.defaultListView]) {
      return schema.defaultListView;
    }
    if (namedListViews) {
      const keys = Object.keys(namedListViews);
      return keys[0] || '';
    }
    return '';
  });

  // Get current named view config. Typed off `ObjectViewSchema.listViews`, the
  // protocol's `ObjectListViewSchema` by reference (objectui#7928).
  const currentNamedViewConfig: NamedViewConfig | null = useMemo(() => {
    if (!hasNamedViews || !activeNamedView) return null;
    return namedListViews![activeNamedView] || null;
  }, [hasNamedViews, activeNamedView, namedListViews]);

  // --- Multi-view type state (prop-based views) ---
  const viewsPropResolved = useMemo(() => {
    if (viewsProp && viewsProp.length > 0) return viewsProp;
    return null;
  }, [viewsProp]);

  const hasMultiView = viewsPropResolved != null && viewsPropResolved.length > 0;
  const currentActiveViewId = activeViewId || viewsPropResolved?.[0]?.id;
  const activeView = viewsPropResolved?.find(v => v.id === currentActiveViewId) || viewsPropResolved?.[0];

  /**
   * ⭐ objectui#6460 — everything the NON-GRID FETCH EFFECT below needs from the
   * active view, as ONE reference that only changes when one of those values
   * changes.
   *
   * `activeView` is an ELEMENT of the `views` prop array, so a host that builds
   * that array inline (`views={[{ id: 'cal', type: 'calendar', label: … }]}` —
   * how this component's own docs write it) hands over a fresh object every
   * time it renders. Listing `activeView` itself made the fetch effect re-run
   * once per PARENT render: measured 4 `find` calls where a hoisted array gives
   * 1, and because `ObjectView` passes `data={data}` down, each of those also
   * re-delivered a fresh row array to the child view.
   *
   * ⚠️ The three members are not interchangeable with "whatever the effect
   * touches", and objectui#6460's own body got this wrong — it said the effect
   * reads `filter` and `type`. Measured in the effect body, it reads `filter`
   * and **`sort`** (`type` reaches it only via `currentViewType`, its own
   * dependency). Dropping `sort` would stop a host that changes only a view's
   * sort from ever re-querying — a worse defect than the churn, and invisible
   * to any test written from that sentence.
   *
   * `id` is carried deliberately even though the effect does not read it: it is
   * the host's own answer to "which view is active", it is a string and so
   * cannot churn, and pinning it keeps switching views observably re-fetching
   * even between two views whose filter and sort happen to coincide. Same
   * ingredients as the display key this file already derives further down
   * (`${schema.objectName}-${activeNamedView || activeView?.id || 'default'}-…`).
   *
   * Precedence is NOT flattened here. Both values still lose to
   * `currentNamedViewConfig` at the read sites in the effect, exactly as before;
   * this only decides WHEN the effect re-runs, never which source wins.
   */
  const activeViewQueryInputs = useStableIdentity(
    activeView
      ? { id: activeView.id, filter: activeView.filter, sort: activeView.sort }
      : undefined,
  );

  // objectui#10506 — the authored filter segments, with every placeholder
  // resolved once against the host's session scope (see
  // `useResolvedFilterSegments`). The non-grid fetch, the grid schema and the
  // delegated `list-view` schema below all read THESE, never the raw segments.
  const filterScope = useFilterScope();
  const authoredFilters = useResolvedFilterSegments(
    {
      view: currentNamedViewConfig?.filter || activeViewQueryInputs?.filter,
      table: schema.table?.filter,
    },
    filterScope,
  );

  // Current view type from named view, multi-view prop, or default
  const currentViewType: string = useMemo(() => {
    if (currentNamedViewConfig?.type) return currentNamedViewConfig.type;
    if (activeView?.type) return activeView.type;
    return schema.defaultViewType || 'grid';
  }, [currentNamedViewConfig, activeView, schema.defaultViewType]);

  // Navigation config — objectui#10885: the active named view's `navigation`
  // first, then the node's. A WHOLE-OBJECT replacement, like every other member
  // read off a named view: nothing is merged key by key, and ⛔ there is no
  // `activeView` rung. Every consumer follows it: `handleRowClick` (the
  // `onRowClick` route 2 hands `ObjectGrid` and the delegation hands
  // `renderListView`, which both obey it first), `formLayout` and the
  // drawer / overlay `width`.
  const navigationConfig: ViewNavigationConfig | undefined = currentNamedViewConfig?.navigation ?? schema.navigation;

  // Permissions context, read here rather than inside the fetch effect below:
  // an effect's DEPENDENCY ARRAY is evaluated during render, so `perms` has to
  // be a binding that already exists by the time this component's render
  // reaches that effect (objectui#7429, same structural note PR #7229 /
  // PR #7428 recorded for `ListView`'s memo and `RecordDetailView`'s effect).
  const perms = usePermissions();

  // objectui#10664 — the fetch below falls back to `schema.table?.sort` for its
  // `$orderby`, and its dependency list names the two sources ahead of it but
  // not this one, so a changed table sort kept the old order. Keyed by CONTENT:
  // an equal sort in a fresh array is not a change (AGENTS.md #10).
  const tableSortKey = JSON.stringify(schema.table?.sort ?? null);

  // objectui#10887 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10623 / objectui#10778 /
  // objectui#10853 way: the nonce moves when the bus reports a change to the
  // object this fetch QUERIES (or `'*'`), and the effect below names it, so
  // the rows are re-read in place. The inner view receives them as `data`,
  // which switches off its own bus reader, and `refreshKey` moves only on
  // this view's own write and `onMutation`;
  // a page action over raw HTTP fires neither, so before this the rows were
  // re-read only when `PageView` remounted the page (objectui#10519 removes
  // that remount).
  //
  // Subscribed — and the fetch below run at all — exactly when these rows are
  // what the view draws (objectui#10982): the view type is on
  // `VIEW_TYPES_DRAWING_FETCHED_ROWS`, the allow-list read off the renderer
  // cases (see it for why `gantt`, `tree`, `chart` and a case-less type are
  // not). A host `renderListView` (its `ListView` reads the bus itself) is not
  // this effect's query either, and neither is a view with no object or no
  // adapter.
  const fetchDrawsView = !renderListView && VIEW_TYPES_DRAWING_FETCHED_ROWS.has(currentViewType);
  const invalidationNonce = useDataInvalidation(
    fetchDrawsView && dataSource ? schema.objectName || undefined : undefined,
  );

  // Fetch the rows a data-drawing view type draws (see `fetchDrawsView`).
  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      // When renderListView is provided, the custom list view (e.g. ListView)
      // handles its own data fetching — skip to avoid duplicate requests and
      // unnecessary re-renders that can cause duplicate records in child views.
      // `fetchDrawsView` is false then too, and for every view type whose
      // renderer queries for itself — the grid, and since objectui#10982 also
      // `gantt`, `tree`, `chart` and a type with no `generateViewSchema` case.
      if (!fetchDrawsView) return;
      if (!dataSource || !schema.objectName) return;

      // ⭐ objectui#6419 — the object schema GATES this query; it does not
      // refine it afterwards. The shape is `ObjectKanban`'s (objectui#6271),
      // but the measurement behind it is this component's own, because this
      // effect has five more dependencies and the kanban's numbers do not
      // transfer. Instrumented adapter, schema/find both 30ms, rows handed to
      // the child as `data={data}`:
      //
      //   before          1 find, `{$top:100}` — no `$expand`, EVER; the child
      //                   receives exactly one delivery, of raw rows.
      //   `objectSchema`  2 finds, `[{$top:100}, {$top:100,$expand:[...]}]`;
      //   in the deps     the child receives TWO deliveries, `raw` then
      //                   `expanded`.
      //   gated (here)    1 find, carrying `$expand` the first time; one
      //                   delivery, `expanded`.
      //
      // That middle row is where this component parts company with the kanban.
      // On the board the unexpanded first response was DISCARDED on arrival
      // (`isMounted` flipped false before it landed) — a wasted round trip, no
      // visible artefact. Here the ordering measured is
      // `schema:settled -> find:settled -> find:issued`: the raw rows settle
      // into `setData` BEFORE the re-run's cleanup, reach the child, and paint.
      // So an extra re-run here costs a visible two-step render — every
      // lookup / master_detail / user / tree field blank (kanban's
      // `isOpaqueId`) or a raw id for ~40ms, then swapping — which is exactly
      // the "duplicate events in child views like the calendar" the ref this
      // replaces was introduced to avoid. Gating avoids both.
      //
      // What the gate costs is one schema resolution ahead of the query, and
      // this component ALREADY issues that read unconditionally on mount
      // (measured: `getObjectSchema` calls = 1 in every regime, before and
      // after). It is one small GET, served from `MetadataCache` (5-min TTL,
      // concurrent readers coalesced onto one request) for every reader after
      // the first. Correct, expanded rows land at the same wall clock as the
      // dependency version reached them — with half the queries and no wrong
      // paint in between.
      if (!objectSchemaReady) return;

      try {
        // `mergeFilterNodes` rescues an OBJECT source: `table.defaultFilters` was
        // declared `Record<string, any>` (until objectui#6152 round 10; the
        // grid row's `ViewFilterRule` array since), and the `baseFilter.length
        // > 0` test this replaced read false for it — so a view's default filter was
        // dropped and every record came back. The grid path (ObjectGrid) always
        // assigned it directly and was unaffected, so the same view filtered
        // correctly as a grid and returned everything as a calendar/kanban/
        // gallery. It also keeps each source as its own child of the `and`
        // rather than spreading it, which is what a `ViewFilterRule[]` needs.
        // The deprecated `table.defaultFilters` alias is not read since
        // `@objectstack/spec` 18 retired it (objectui#12030).
        //
        // objectui#10506: the segments are read RESOLVED — `{current_user_id}`
        // and the other placeholders expanded once, above, through the shared
        // `resolveFilterPlaceholders` — so this query carries the real id.
        const finalFilter = mergeFilterNodes(
          authoredFilters.view || authoredFilters.table,
        );

        // objectui#4869: this was the LAST object-bound read site handing an
        // AUTHORED sort to `$orderby` unlowered — gantt / map / calendar /
        // timeline / `record:line_items` all lower through the shared sink
        // already, and so does this one now (below, `convertSortToQueryParams`).
        // ⛔ The sink must NOT be widened to accept a bare `{ field, order }` —
        // its input slot legitimately also carries `$orderby`'s own
        // `Record<field, direction>` map, in which `{ field: 'desc' }` is a
        // perfectly legal ordering by a column literally named `field`, so the
        // sink would have to GUESS. (Maintainer ruling 2026-08-22: Option A;
        // Option B — widening the shared sink — rejected on the merits.)
        //
        // objectui#5861: the chain ends at the canonical `table.sort`. The
        // legacy single-entry `table.defaultSort` that used to be lowered here
        // as a fourth branch is RETIRED under ADR-0049 — `@objectstack/spec`
        // refuses it by name on `object-grid` — and it was retired on all three
        // `ObjectView` paths at once (this fetch, the grid forwarding and the
        // delegated `mergedSort`) together with `ObjectGrid`'s own read, so no
        // path honours the key while another ignores it. A view's sort still
        // outranks `table.sort`, the same order the grid path and `mergedSort`
        // express.
        //
        // objectui#7928: a named view's `sort` is the protocol's by reference,
        // which still admits the bare string clause objectui retired
        // (objectui#8221). The value is handed on UNCHANGED and
        // `convertSortToQueryParams` refuses a string out loud; the cast only
        // restates the sink's declared input. ⛔ Never narrow, drop or lower it
        // here: that would turn the loud refusal into silence.
        const sort = (currentNamedViewConfig?.sort as ObjectGridSchema['sort']) || activeViewQueryInputs?.sort
          || schema.table?.sort;

        // Auto-inject $expand for lookup/master_detail fields. Reached only
        // with the schema resolved (the gate above), so a view whose object
        // declares lookups queries WITH its expansion the first time —
        // `objectSchema` here is `null` only when there was nothing to resolve
        // it from.
        //
        // [objectui#7429] FIELD-LEVEL SECURITY ON `$expand` — the same gate
        // objectui#7215 / PR #7229 put on the two projection sites in its
        // scope, and objectui#7230 / PR #7428 applied unchanged at four more.
        // `$select` on a denied lookup asks the server for a bare foreign key;
        // `$expand` asks it to RESOLVE the relation and return the related
        // record, the larger of the two requests.
        //
        // THIS SITE PASSES NO COLUMN LIST, which makes it the sharp one:
        // `buildExpandFields` reads an absent column list as "no column
        // restriction" and falls back to EVERY declared relation on the
        // object, denied ones included. A standalone non-grid view therefore
        // asks for the maximum possible set by default, not by configuration.
        //
        // Graded as objectui#7215 graded it, by measurement rather than
        // assumption: against ObjectStack this is defence-in-depth, because
        // `plugin-security`'s `FieldMasker.maskRecord` does
        // `delete result[field]` on every unreadable key and objectql's
        // expand path writes the resolved record back under THAT SAME KEY, so
        // one statement removes the expanded object and the bare id alike;
        // the expansion sub-read itself takes the referenced object's full
        // CRUD + RLS + FLS treatment (objectstack#7626). It is load-bearing
        // for a backend that does not strip.
        //
        // THE GATE IS ON THE HELPER'S OUTPUT, and on this site the
        // alternative is not merely unsound but unreachable: the call passes
        // `undefined`, so there is no input to gate. Gating the output also
        // gives the required ordering structurally: `buildExpandFields`
        // returns a subset of the object's DECLARED reference-bearing fields,
        // so every name judged here is declared by construction and the
        // "`checkField` answers false for an undeclared key" trap cannot be
        // reached. Pinned in `ObjectView.expandFls-7429.test.tsx`.
        //
        // Deferral matches every other gate on this path: an unanswered
        // policy filters nothing, and `perms` is in this effect's dependency
        // list, so the expansion is rebuilt the moment the answer arrives.
        const expandable = buildExpandFields((objectSchema as any)?.fields);
        const expand = !perms?.isLoaded
          ? expandable
          : expandable.filter((f) => perms.checkField(schema.objectName as string, f, 'read'));

        // ⭐ objectui#10982 — the placeholder is for a view with no answer to
        // THIS request yet: its first load, or a changed filter, sort,
        // expansion or object. A RE-READ — the same request issued again, on a
        // data-invalidation event or a `refreshKey` move — keeps the rows on
        // screen and replaces them when the new ones land. Before this every
        // run set `loading`, and `ObjectCalendar` handed rows swaps them for
        // its "Loading calendar…" placeholder while it is true, so each bus
        // event flashed the calendar (its own reader had the same flash under
        // objectui#10572). Set on EVERY run, false included, so a re-read that
        // supersedes a first load still in flight shows the rows it already
        // has rather than a placeholder that run left behind.
        //
        // A failed re-read surfaces exactly as a failed first load does: the
        // error is logged below, `loading` ends false and the rows already
        // drawn stay; nothing here swallows it.
        //
        // The request is named by the inputs the `find` below is built from —
        // the rest of it is constant — rather than by the params object, which
        // stays an inline literal so `no-unprefixed-query-params` and the
        // `QueryParams` excess-property check keep reading it.
        const request = JSON.stringify([schema.objectName, finalFilter, sort, expand]);
        setLoading(drawnRequestRef.current !== request);
        const results = await dataSource.find(schema.objectName, {
          // `mergeFilterNodes` returns a node or `undefined`; the old
          // `.length > 0` here was the second place an object filter was lost.
          $filter: finalFilter,
          // objectui#4869: lowered through the shared sink, so ONE normalized
          // shape reaches `DataSource.find` from every object-bound read site
          // rather than whichever of `$orderby`'s four declared shapes the
          // author happened to write. An adapter that implements `find` itself
          // now sees the same `Record<field, direction>` here that it already
          // sees from the other five blocks.
          $orderby: convertSortToQueryParams(sort),
          $top: 100,
          ...(expand.length > 0 ? { $expand: expand } : {}),
        });

        let items: any[] = [];
        if (Array.isArray(results)) {
          items = results;
        } else if (results && typeof results === 'object') {
          // `data` is the ONE rows member `QueryResult` (`@object-ui/types`)
          // declares, and now the only one this ladder reads. Two
          // below-the-adapter spellings were removed from it, each on its own
          // measurement: `records` (objectui#6726) and then `value`
          // (objectui#6840) — the OData spelling that
          // `ObjectStackAdapter.normalizeQueryResult` and
          // `ApiDataSource.normalizeQueryResult` both fold into `data` BELOW
          // this seam, so no producer emits it here. A sweep of the 25 `find()`
          // definition bodies reachable by this component found `value`
          // emitted 0 times against controls `data` (6) and `total` (6) drawn
          // from the same cells.
          //
          // ⚠️ That zero is SEAM-LOCAL and must not be carried elsewhere: the
          // same key is LIVE at `extractRecords`
          // (`core/src/utils/extract-records.ts`, objectui#6839), where five
          // test doubles in plugin-calendar / plugin-kanban still emit it.
          //
          // Pinned by `ObjectView.contractEnvelope-6726.test.tsx` and
          // `ObjectView.contractEnvelope-6840.test.tsx`.
          if (Array.isArray((results as any).data)) {
            items = (results as any).data;
          }
        }

        if (isMounted) {
          setData(items);
          drawnRequestRef.current = request;
        }
      } catch (err) {
        console.error('ObjectView data fetch error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    return () => { isMounted = false; };
    // `objectSchemaReady` and `objectSchema` are BOTH listed and both are load
    // bearing: `objectSchema` is `null` in two different situations — before
    // the read settles, and after it settles with nothing — and only the first
    // of those may hold the query. Listing them is what makes the gate open;
    // it is not the dependency-driven refetch this replaced, because the runs
    // before the gate opens return above without querying.
  }, [
    schema.objectName, dataSource, currentViewType, refreshKey,
    currentNamedViewConfig, activeViewQueryInputs, renderListView,
    objectSchemaReady, objectSchema, perms, authoredFilters, tableSortKey,
    invalidationNonce, fetchDrawsView,
  ]);

  // Determine layout mode. objectstack-ai/objectstack#2578: default the record surface from how heavy the
  // object is — a field-heavy object opens create/edit/detail as a full page, a
  // light one as a drawer. Mobile always pages. An explicit `schema.layout` (or
  // a per-view navigation config, handled in handleRowClick) still wins.
  const isMobile = useIsMobile();
  const layout = schema.layout || deriveRecordSurface(objectSchema, { viewport: isMobile ? 'mobile' : 'desktop' });

  // objectui#11015 — the surface create, edit and view actually open on. A
  // `page` hands the record to the host's router, so it holds only while there
  // IS one: with no `onNavigate` a page has no surface inside this component,
  // and it falls back to the drawer — the surface objectui#10975 already gave
  // create under `split` / `popover` for a page. That is the registered
  // `object-view` renderer's case, where a JSON schema cannot carry a function,
  // on a mobile viewport or a field-heavy object: `deriveRecordSurface` picks
  // `page` with no author choosing it. An explicit `layout: 'page'` without
  // `onNavigate` (the README's documented misconfiguration) takes the same
  // fallback. The three handlers, `formLayout` and `renderCreateSurface` read
  // this and never `layout`, so no two of them disagree. Pinned by
  // `ObjectView.pageSurfaceFallback-11015.test.tsx`.
  const recordSurface = layout === 'page' && !schema.onNavigate ? 'drawer' : layout;

  // Determine enabled operations. `read` is THIS view's member (the row-click
  // gate in `handleRowClick`), read off the view's own `operations`; the
  // `table.operations` fallback is the grid's block, which retired `read`
  // (objectui#6152 round 8), and the grid node below is handed the toggles
  // without it.
  const operations = schema.operations || schema.table?.operations || {
    create: true,
    read: true,
    update: true,
    delete: true,
  };

  // Handle create action. `recordSurface` is `page` only when `onNavigate` is
  // set; the second operand narrows the type and changes no outcome.
  const handleCreate = useCallback(() => {
    if (recordSurface === 'page' && schema.onNavigate) {
      schema.onNavigate('new', 'edit');
    } else {
      setFormMode('create');
      setSelectedRecord(null);
      setIsFormOpen(true);
    }
  }, [recordSurface, schema]);

  // Handle edit action
  const handleEdit = useCallback((record: Record<string, unknown>) => {
    if (onEditProp) {
      onEditProp(record);
      return;
    }
    if (recordSurface === 'page' && schema.onNavigate) {
      const recordId = record.id || record._id;
      schema.onNavigate(recordId as string | number, 'edit');
    } else {
      setFormMode('edit');
      setSelectedRecord(record);
      setIsFormOpen(true);
    }
  }, [recordSurface, schema, onEditProp]);

  // Handle view action (read a record)
  const handleView = useCallback((record: Record<string, unknown>) => {
    if (recordSurface === 'page' && schema.onNavigate) {
      const recordId = record.id || record._id;
      schema.onNavigate(recordId as string | number, 'view');
    } else {
      setFormMode('view');
      setSelectedRecord(record);
      setIsFormOpen(true);
    }
  }, [recordSurface, schema]);

  // Handle row click - respects NavigationConfig
  //
  // objectui#9462 — `event` is forwarded, not consumed. This callback is what
  // `ObjectGrid` feeds to `useNavigationOverlay` (and what a host's
  // `renderListView` receives verbatim), and `handleClick` invokes it with the
  // modifier payload; truncating to `onRowClick(record)` here meant a host
  // wired to this component's own prop never saw it.
  //
  // objectui#9806 (ruling B) — with NO host `onRowClick`, this callback reads
  // the payload itself: a Cmd / Ctrl / middle-click opens the record as a full
  // page in a new browser tab. The hook cannot do it for this component —
  // `handleClick` returns EARLY on the `onRowClick` it is handed, ahead of its
  // own modifier branch, and this component hands `handleRowClick` down
  // unconditionally — and that early return stays: it is what lets a host
  // handler (the branch just below) decide for itself.
  //
  // Two deliberate differences from the hook's branch, both read off THIS
  // component's contract rather than the hook's:
  //  - The destination is the component's own new-tab URL, the one
  //    `navigation.mode: 'new_window'` already opens — never `schema.onNavigate`,
  //    whose declared second parameter is `'view' | 'edit'` and cannot say
  //    "new tab".
  //  - A row the view made inert stays inert: `mode: 'none'` /
  //    `preventNavigation`, or `operations.read === false` with no navigation
  //    config, ignore a modifier click exactly as they ignore a plain one. A
  //    modifier click changes WHERE a record opens, never WHETHER it opens.
  //
  // ⚠️ Nothing above is remembered — it is re-derived (AGENTS.md #9) by
  // ObjectView.modifierClickNewTab-9806.test.tsx, which drives plain and
  // modifier clicks through the REAL hook, carries a control that reaches the
  // hook's own modifier branch, and pins this file's citation of it. Change
  // what a modifier click does here and that pin reds together with this
  // comment.
  const openRecordInNewTab = useCallback((record: Record<string, unknown>) => {
    const recordId = record.id || record._id;
    const url = `/${schema.objectName}/${encodeURIComponent(String(recordId))}`;
    window.open(url, '_blank');
  }, [schema.objectName]);

  const handleRowClick = useCallback((record: Record<string, unknown>, event?: any) => {
    if (onRowClick) {
      onRowClick(record, event);
      return;
    }

    const modifiers = event as HandleClickModifiers | undefined;
    const opensInNewTab = !!(
      modifiers && (modifiers.metaKey || modifiers.ctrlKey || modifiers.button === 1)
    ) && (record.id || record._id) != null;

    // Check NavigationConfig
    if (navigationConfig) {
      if (navigationConfig.mode === 'none' || navigationConfig.preventNavigation) {
        return; // Do nothing
      }
      if (navigationConfig.mode === 'new_window' || navigationConfig.openNewTab || opensInNewTab) {
        openRecordInNewTab(record);
        return;
      }
      if (navigationConfig.mode === 'drawer') {
        setFormMode('view');
        setSelectedRecord(record);
        setIsFormOpen(true);
        return;
      }
      if (navigationConfig.mode === 'modal') {
        setFormMode('view');
        setSelectedRecord(record);
        setIsFormOpen(true);
        return;
      }
      if (navigationConfig.mode === 'page') {
        const recordId = record.id || record._id;
        if (schema.onNavigate) {
          schema.onNavigate(recordId as string | number, 'view');
        }
        return;
      }
      if (navigationConfig.mode === 'split' || navigationConfig.mode === 'popover') {
        setFormMode('view');
        setSelectedRecord(record);
        setIsFormOpen(true);
        return;
      }
    }

    // Default behavior
    if (operations.read !== false) {
      if (opensInNewTab) {
        openRecordInNewTab(record);
        return;
      }
      handleView(record);
    }
  }, [onRowClick, navigationConfig, operations.read, handleView, openRecordInNewTab, schema]);

  // Handle delete / bulk delete — objectui#10383.
  //
  // `ObjectGrid` hands the row (or the selection) straight to these two and
  // performs no delete of its own: its contract is that the CONSUMER's delete
  // flow owns the confirmation, the delete, the toast and the refresh. Both
  // handlers used to ignore their argument and only bump `refreshKey`, so on
  // this path — the registered `object-view` renderer, no host list view — a
  // Delete offered by default deleted nothing and the row came back.
  //
  // They now bind to the SAME record-delete core the console's own list binds
  // to (`recordDelete` in `@object-ui/core`, which `app-shell`'s
  // `useObjectActions` registers as its `delete` handler). This host owns only
  // its confirm UI (the AlertDialog below) and the bulk question; the one-row
  // question, the delete, the toasts and when to refresh all come from
  // that core, so the two paths cannot drift. The requests are shaped the way
  // the console's are: a row as `{ recordId, record }`, a selection as
  // `{ records }`, rows without an `id` skipped first.
  //
  // The permission half needs nothing here: whether the Delete affordance is
  // offered at all is `ObjectGrid`'s verdict on both paths (`operations`, the
  // principal's `can(object, 'delete')`, the object's bucket / `userActions` /
  // API operations and the per-record explain verdict), exactly as it is for
  // the console list, which does not gate its handlers either.
  const [deleteRequest, setDeleteRequest] = useState<{
    open: boolean;
    records: Record<string, unknown>[];
    bulk: boolean;
  } | null>(null);

  const handleDelete = useCallback((record: Record<string, unknown>) => {
    if (record?.id == null) return;
    setDeleteRequest({ open: true, records: [record], bulk: false });
  }, []);

  const handleBulkDelete = useCallback((records: Record<string, unknown>[]) => {
    const valid = records.filter((r) => r?.id != null);
    if (valid.length === 0) return;
    setDeleteRequest({ open: true, records: valid, bulk: true });
  }, []);

  /**
   * A write THIS host made — a form save or a delete — reported to both
   * readers of it (objectui#10035): `refreshKey` for the rows this component
   * fetches for its non-grid views, and the data-invalidation bus for the
   * renderers that fetch for themselves (`ObjectGrid`, `ObjectGantt`,
   * `ObjectChart`). The writer declares the change, as AGENTS.md #8's
   * corollary asks, so a data source without `onMutation` still refreshes
   * them. With one, the `onMutation` subscription above has announced the
   * same write: the two notifications land in one render when React batches
   * them, and never cost more refetches than the key bumps they replace (each
   * of those remounted, and every remount fetched).
   */
  const announceOwnWrite = useCallback(() => {
    setRefreshKey(prev => prev + 1);
    if (schema.objectName) notifyDataChanged({ objectName: schema.objectName });
  }, [schema.objectName]);

  // Handle form submission
  const handleFormSuccess = useCallback(() => {
    setIsFormOpen(false);
    setSelectedRecord(null);
    announceOwnWrite();
  }, [announceOwnWrite]);

  // Handle form cancellation
  const handleFormCancel = useCallback(() => {
    setIsFormOpen(false);
    setSelectedRecord(null);
  }, []);

  // --- ViewSwitcher schema (for multi-view prop views) ---
  const viewSwitcherSchema: ViewSwitcherSchema | null = useMemo(() => {
    if (!hasMultiView || !viewsPropResolved || viewsPropResolved.length <= 1) return null;
    return {
      type: 'view-switcher' as const,
      variant: 'tabs',
      position: 'top',
      persistPreference: true,
      storageKey: `view-pref-${schema.objectName}`,
      defaultView: (activeView?.type || 'grid') as ViewType,
      activeView: (activeView?.type || 'grid') as ViewType,
      views: viewsPropResolved.map(v => {
        // objectui#5321 — TOTAL over `ViewType`, so no member can land without
        // an icon. This was `Record<string, string>`, and a member with no key
        // falls through to the `'table'` fallback below: a host-supplied
        // `tree` view was labelled with the GRID icon. objectui#2916 fixed
        // exactly that for `chart` by adding one key, and nothing recorded
        // that the set has to be COMPLETE, so `tree` stayed missing. The
        // TOTALITY is the guard for the whole class: `ViewSwitcher`'s own
        // `DEFAULT_VIEW_ICONS` — the consumer of these strings — is asserted
        // total the same way, and only this producer was partial.
        //
        // The values are the spellings `ViewSwitcher.resolveIcon` PascalCases
        // back into lucide icons, so `tree: 'list-tree'` resolves to the same
        // `ListTree` that file's `DEFAULT_VIEW_ICONS.tree` already names for
        // this view type. The `|| 'table'` fallback stays: `v.type` arrives
        // from a host prop and nothing validates it at runtime.
        //
        // objectui#5586 — the VALUES have to be names lucide still carries in
        // its runtime `icons` record, which is what `ViewSwitcher.resolveIcon`
        // reads. `chart: 'bar-chart-3'` and `gantt: 'gantt-chart'` were dropped
        // from that record while surviving as deprecated NAMED EXPORTS, so both
        // types rendered with NO icon at all while every sibling had one. The
        // compiler sees none of it: nothing in this map is a lucide symbol.
        // Measured on lucide-react 1.31.0, `chart-column` → `ChartColumn` and
        // `chart-gantt` → `ChartGantt` both resolve, and both agree with the
        // components `ViewSwitcher.DEFAULT_VIEW_ICONS` names for the same view
        // types. Every value here is pinned by `ViewSwitcher.test.tsx`.
        // `page` (`ca3942729`): keyed on the FULL `ViewType`, which
        // `@objectstack/spec@17.3.0` widened. `layout-template` is the kebab
        // spelling of the `LayoutTemplate` this map's consumer —
        // `ViewSwitcher.DEFAULT_VIEW_ICONS` — draws for the same view type, and
        // `resolveIcon` looks these strings up in lucide's runtime `icons`
        // record, where a deprecated alias resolves to no icon at all.
        //
        // objectui#9943 — the ANNOTATION is gone and the exhaustiveness is
        // asserted instead. An annotated literal is exact in BOTH directions:
        // it catches the added member (what #5321 wanted) and it also makes a
        // RETIRED member an excess property (TS2353), whose only repair is
        // deleting the row. objectstack#17063 retired the list-view kind
        // `page`, so this table went red against a spec built from objectstack
        // `main` while the `@objectstack/spec` this repository RESOLVES still
        // publishes `page` and an author can still write one. `satisfies
        // Record<string, string>` keeps the value constraint and drops the
        // exactness; `_UncoveredHostViewIcon` below puts the added-member half
        // back, so #5321's "no member can land without an icon" still holds.
        // ⛔ Deleting that assert is the regression this shape exists to
        // prevent — both directions are pinned in
        // `__tests__/ViewSwitcher.viewTypeTotalsBothLegs-9943.test.ts`.
        const iconMap = {
          kanban: 'kanban',
          calendar: 'calendar',
          map: 'map',
          gallery: 'layout-grid',
          timeline: 'activity',
          gantt: 'chart-gantt',
          grid: 'table',
          list: 'list',
          detail: 'file-text',
          chart: 'chart-column',
          tree: 'list-tree',
          page: 'layout-template',
        } satisfies Record<string, string>;

        /** `never` only while every {@link ViewType} has an icon name. */
        type _AssertNever<T extends never> = T;
        type _UncoveredHostViewIcon = _AssertNever<Exclude<ViewType, keyof typeof iconMap>>;
        return {
          type: v.type as ViewType,
          label: v.label,
          icon: iconMap[v.type] || 'table',
        };
      }),
      allowCreateView: schema.allowCreateView,
      viewActions: schema.viewActions,
    };
  }, [hasMultiView, viewsPropResolved, activeView, schema.objectName, schema.allowCreateView, schema.viewActions]);

  // Handle view type change from ViewSwitcher → map back to view ID
  const handleViewTypeChange = useCallback((viewType: ViewType) => {
    if (!viewsPropResolved) return;
    const matched = viewsPropResolved.find(v => v.type === viewType);
    if (matched && onViewChange) {
      onViewChange(matched.id);
    }
  }, [viewsPropResolved, onViewChange]);

  // Handle named view change
  const handleNamedViewChange = useCallback((viewKey: string) => {
    setActiveNamedView(viewKey);
  }, []);


  // --- Generate view component schema for non-grid views ---
  const generateViewSchema = useCallback((viewType: string): any => {
    // objectui#11013 — the host `views` entry's toolbar policy, under its
    // declared spelling `userActions`. `baseProps` below read the bare
    // `showSearch` / `showSort` / `showFilters` flags off the entry, so a view
    // declaring `userActions: { search: false }` was not heard. A stored entry
    // that still carries a bare flag is folded onto `userActions` by
    // `normalizeListViewSchema`, the fold the `list-view` relay already runs.
    const activeViewUserActions = (normalizeListViewSchema(activeView ?? {}) as {
      userActions?: { search?: boolean; sort?: boolean; filter?: boolean };
    }).userActions;
    const baseProps: Record<string, any> = {
      objectName: schema.objectName,
      // objectui#5269 — the `table` segment reads the CANONICAL key first.
      //
      // `ObjectGridSchema.columns` is the canonical spelling and `fields` is
      // its `@deprecated` alias ("@deprecated Use columns instead"), and
      // `ObjectViewSchema.table` is `Partial< Omit< ObjectGridSchema, … > >`,
      // so `table: { columns: [...] }` is the shape the type recommends. It
      // reached the grid path (which forwards `table.columns` into its own
      // `columns` slot) and stopped here: this line read the deprecated half
      // alone, so an author who wrote the canonical key on a non-grid view got
      // an empty field list from a compile-clean, semantically correct schema.
      // Same user-visible shape as objectui#5102, different mechanism — not a
      // whitelist that knows only legacy spellings, but one that disagreed
      // with itself between two rendering paths.
      //
      // Forwarding, not translation, exactly as objectui#5102 settled it: the
      // value is handed on unchanged and the two segments ahead of `table`
      // keep their precedence. Both spellings stay working; only the ORDER
      // between them is stated, canonical first.
      //
      // Reach, measured rather than assumed: of the surfaces this `baseProps`
      // feeds, `object-kanban` consumes it (via `cardFields`, below) and
      // `object-tree` consumes it (as its own `fields`). `object-gallery` /
      // `object-calendar` / `object-timeline` / `object-gantt` / `object-map`
      // read NO field list off their schema at all, so the value is inert
      // there — before this change and after it.
      //
      // The `table` segment arrives through `tableColumnFieldNames` because
      // THIS slot is a names slot and `table.columns` is a union — see that
      // function for why raw forwarding would regress the `ListColumn[]` half.
      // The delegated `list-view` slot below declares the same union, so it
      // takes the value raw; each site gets the shape its slot declares.
      //
      // objectui#8254: the NAMED-VIEW segment now goes through the same fold
      // (`viewColumnFieldNames`, presence-preserving — see its header). The
      // protocol's value type for `listViews` declares that same union, so a
      // spec-shaped named view reaches this names slot carrying the
      // `ListColumn[]` half, and this is the last place that can narrow it.
      // The `views`-prop segment beside it still declares `string[]` and is
      // the objectui#5097 host-composition surface, so it is untouched here.
      fields: viewColumnFieldNames(currentNamedViewConfig?.columns) || activeView?.columns
        || tableColumnFieldNames(schema.table?.columns) || schema.table?.fields,
      className: 'h-full w-full',
      showSearch: activeViewUserActions?.search ?? schema.showSearch ?? false,
      showSort: activeViewUserActions?.sort ?? schema.showSort ?? false,
      showFilters: activeViewUserActions?.filter ?? schema.showFilters ?? false,
      color: activeView?.color,
    };

    // Resolve type-specific options from the host's active view (the `views`
    // prop). Per @objectstack/spec, type-specific config MUST be nested under the
    // view type key.
    //
    // objectui#7928 (director ruling, comment 5856694523, Q1 A) — a NAMED view's
    // legacy `options` bag is no longer read here. The protocol refuses `options`
    // on a named view (`ObjectViewSchema.listViews` is its strict
    // `ObjectListViewSchema` by reference), so the canonical top-level blocks
    // below are the named view's only source. A stored body that still carries
    // `options.KIND` is folded onto `KIND` at the door that relays it into
    // `listViews` — `@object-ui/app-shell`'s `ViewPreview` — so it arrives here
    // already canonical. ⛔ Do not restore the read: that would re-open a
    // dialect the contract refuses. The host `views` entry keeps this rung.
    const legacyViewOptions: Record<string, any> = activeView || {};

    // ⭐ objectui#8980 — THE CANONICAL, PROTOCOL-DECLARED PLACE FOR THE EIGHT
    // VIEW-KIND BLOCKS, read here for the first time.
    //
    // The protocol carries `kanban` / `calendar` / `gallery` / `timeline` /
    // `gantt` / `map` / `chart` / `tree` at the TOP LEVEL of a list view
    // (`ObjectListViewSchema`, the declared value type of `ViewSchema.listViews`).
    // objectui read them only out of the legacy untyped `options` bag above, so
    // all eight were undeclared on `NamedListView` and an author writing the
    // shape the protocol teaches got a view that rendered as if nothing had been
    // configured. Director-seat ruling of 2026-09-13 on objectui#8980, item 2:
    // each declared member gets a read point in the same delivery.
    //
    // MERGE, not replace, and per-KIND rather than wholesale: the legacy nesting
    // stays working (stored views carry it; the pre-#2231 field aliases that
    // lived there, `groupField` / `imageField` / `dateField`, are no longer read
    // since objectui#6152 round 14), while a canonical
    // block wins key-by-key over the legacy one for the same kind. A partially
    // declared canonical block therefore does not blank its legacy neighbour.
    // ⚠️ Since objectui#7928 the legacy side is the host `views` entry only; a
    // named view's own `options` bag is folded at `ViewPreview` instead (see
    // `legacyViewOptions` above).
    //
    // ⚠️ IDENTITY IS PRESERVED WHEN NOTHING CANONICAL IS DECLARED — the `else`
    // arm hands back the very object the line above produced. That is the whole
    // population today (the keys could not be authored before this change), so
    // this change is provably inert on every existing document.
    const canonicalViewKindBlocks: Record<string, unknown> = {
      kanban: currentNamedViewConfig?.kanban,
      calendar: currentNamedViewConfig?.calendar,
      gallery: currentNamedViewConfig?.gallery,
      timeline: currentNamedViewConfig?.timeline,
      gantt: currentNamedViewConfig?.gantt,
      map: currentNamedViewConfig?.map,
      chart: currentNamedViewConfig?.chart,
      tree: currentNamedViewConfig?.tree,
    };
    const declaredKinds = Object.keys(canonicalViewKindBlocks)
      .filter((kind) => canonicalViewKindBlocks[kind] != null);
    const viewOptions: Record<string, any> = declaredKinds.length === 0
      ? legacyViewOptions
      : declaredKinds.reduce(
          (acc, kind) => ({
            ...acc,
            [kind]: { ...(legacyViewOptions[kind] ?? {}), ...(canonicalViewKindBlocks[kind] as object) },
          }),
          { ...legacyViewOptions } as Record<string, any>,
        );

    // Dev-mode warning for flat property access violations. The place it names
    // is the view's own top-level `KIND` block — the one `viewOptions[viewType]`
    // reads. ⛔ Not `options.KIND`: this component reads no `options` bag since
    // objectui#7928, and a named view refuses `options` by name, so that text
    // sent an author to a place that is ignored or refused (objectui#10868).
    //
    // ⛔ Only keys some spec per-kind block DECLARES (objectui#6152 round 15).
    // The list also named `dateField`, `groupBy`, `groupField`, `imageField` and
    // `subtitleField` and told an author to move them into the block, where
    // every door refuses them by name and no reader reads them (objectui#6152
    // rounds 14 and 15).
    if (process.env.NODE_ENV === 'development') {
        const flatKeys = ['startDateField', 'endDateField', 'locationField', 'dependenciesField',
            'progressField', 'titleField', 'latitudeField', 'longitudeField'];
        const nestedConfig = viewOptions[viewType] || {};
        const found = flatKeys.filter(k => k in viewOptions && !(k in nestedConfig));
        if (found.length > 0) {
            console.warn(
                `[Spec Compliance] The view uses flat properties ${JSON.stringify(found)}. ` +
                `Move them under its top-level ${viewType} block ({ ${viewType}: { ... } }) per @objectstack/spec protocol.`
            );
        }
    }

    // #region object-view VIEW-TYPE BRANCHES (objectui#5321)
    //
    // Every view type this component can render, and the two of them
    // (`chart`, `tree`) that no authored document can select — see
    // {@link OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES} at the top of this file.
    // The fence is load-bearing, not decoration: `objectViewHostSurface.test`
    // re-derives the branch set from it, so a ninth branch fails BY NAME
    // rather than quietly changing what that record describes.
    switch (viewType) {
      case 'kanban': {
        // Per @objectstack/spec, kanban-specific config lives under view.kanban.*
        // `groupByField` is the spec's lane key and the only spelling read here:
        // the pre-#2231 `groupField` alias retired in objectui#6152 round 14.
        // `kanban.columns` (when provided) lists the FIELDS to render on each card —
        // these are NOT lanes; lanes are derived from the groupBy field's options.
        const kanbanCfg = viewOptions.kanban || {};
        const groupBy =
          kanbanCfg.groupByField ||
          'status';
        // Card display fields: prefer explicit kanban.columns, fall back to the
        // view's outer columns. Strip out these from the spread below so they
        // don't leak into schema.columns (which the kanban component interprets
        // as LANES).
        const cardFields: string[] =
          (Array.isArray(kanbanCfg.columns) && kanbanCfg.columns.length > 0
            ? kanbanCfg.columns
            : baseProps.fields) || [];
        // ⭐ `groupBy` NEVER REACHES THE NODE (objectui#9242, maintainer ruling
        // of 2026-09-12 — decision batch #117 item 5, option B). It is a THIRD
        // spelling of the lane, and while this branch spread the rest of the
        // block AFTER its own `groupBy`, an authored `kanban.groupBy` OVERRODE
        // the lane this branch had just resolved from `groupByField`. objectui#9242
        // stripped it from that spread; objectui#6152 round 14 retired the spread.
        //
        // THE SECOND ROUTE. objectui#8365 / PR objectui#9236 closed the same
        // shape in `ListView`, but `generateViewSchema` runs precisely when no
        // host supplied `renderListView` — the authored `object-view` element —
        // so that fix does not reach here. Same distinction the `calendar`
        // branch below records for objectui#7029.
        //
        // ⚠️ ONE MEASURED DIFFERENCE FROM THE TWIN, and it is not cosmetic: the
        // lane above floors at the LITERAL `'status'`, where `ListView` floors
        // at `detectStatusField(objectDef)`. So with the stray key ALONE this
        // route answers `'status'` — measured, including against an object that
        // declares no `status` field — and the twin would answer `undefined`.
        // ⛔ Do not "align" the two by swapping in the detector: that is a
        // behaviour change on stored views and belongs on its own card.
        //
        // The contract half is NOT here and must not be duplicated here. It
        // lives in `@object-ui/types` (`zod/objectql.zod.ts`), one string
        // (`KanbanStrayGroupByRefusal`) on two routes: the `list-view` route
        // takes it through the view-level `KanbanConfig` mirror. A named view's
        // `listViews.KEY.kanban.groupBy` (what this branch serves) is refused by
        // the protocol's own strict record, naming the key; objectui#10321's
        // pointer on that door was retired by objectui#11073, because the
        // protocol's refusal is terminal since `@objectstack/spec` 17.5.0.
        // What this branch closes is the BEHAVIOUR half: a document that reaches
        // it carrying the key, whether or not it passed a validator.
        // ⚠️ NODE-LOCAL vs VIEW-LEVEL, as everywhere in this branch: `groupBy`
        // on the RETURNED node is the canonical lane key `ObjectKanban` reads.
        //
        // ⭐ objectui#6152 round 14: the rest of the block is no longer spread
        // onto the node at all. The spec's kanban block is `groupByField` /
        // `columns` / `titleField` / `summarizeField`; the first three are read
        // by name above and below, and `summarizeField` (objectui#11629) is now
        // named too. The spread that carried it also carried every undeclared
        // knob (`swimlaneField`, …) and let a block key named like a node key
        // (`objectName`) override the node's own value; `ListView`'s twin
        // retired the same spread in the same round.
        //
        // Forward conditional formatting to kanban (issue #1584) from the
        // view-level `conditionalFormatting` of the active host `views` entry
        // (`activeView`), the place a list view declares the key.
        //
        // ⛔ No `kanban.conditionalFormatting` rung (objectui#6152 round 15).
        // It used to win over the view-level rule, on the reading that
        // `ObjectKanbanSchema` declares the key. That declaration is the
        // `object-kanban` NODE's, not the list view's per-kind block: the
        // protocol's kanban block is `groupByField` / `columns` / `titleField` /
        // `summarizeField`, and every door that judges it refuses
        // `kanban.conditionalFormatting` by name (the named-view record, the
        // spec's list view and view write door, and `ListViewSchema` in both
        // nestings). A host `views` entry declares no `kanban` block at all.
        // `ListView`'s twin stopped forwarding the key in round 14, so the two
        // routes now answer it alike.
        //
        // objectui#5248 — a THIRD fallback used to sit at the end of this chain,
        // `(schema as any).conditionalFormatting`, reading the key off the
        // object-view node itself. It was the ONLY read of one of the 27
        // objectui#5097 host-composition keys outside the `#region` fence below,
        // and the only one on a path the REGISTERED renderer can reach
        // (`generateViewSchema` runs precisely when no host supplied
        // `renderListView`). That made the exemption's stated basis — "the
        // authored path cannot reach these keys" — false for this one key.
        //
        // The maintainer ruled on 2026-08-19 (verbatim 「全部接受」, recorded on
        // objectui#5248): a conditional, Option 2 gated on a liveness check.
        // The check came back EMPTY — no authored document in either repo puts
        // `conditionalFormatting` on an object-view node (objectui: it appears
        // in `content/docs` only on `object-grid`, and in `skills/` only on
        // `list-view`; objectstack: `object-view` is not authored anywhere, 2
        // prose mentions and no node, while `object-form` appears in 54 files
        // and `object-grid` in 19). So the fallback was dropped: the key is now
        // genuinely host-only, and the objectui#5097 basis holds for all 27.
        //
        // ⛔ Do not restore this fallback as a convenience. Authoring
        // kanban conditional formatting has one declared home, the view-level
        // key above (the nested one retired, objectui#6152 round 15); a top-level key
        // that nothing declares, nothing publishes in the registry `inputs` and
        // tsc could not see (BaseSchema's index signature, until objectui#8347) is
        // precisely the
        // "renderer reads it, manifest denies it" condition objectui#4648 /
        // objectui#5091 exist to close. The host `renderListView` delegation
        // below still reads and forwards the key — that half is NOT narrowed.
        const kanbanConditionalFormatting = activeView?.conditionalFormatting;
        // `groupBy` is the lane key and the ONLY one written here. This node
        // used to carry `groupField: groupBy` alongside it — a duplicate the
        // `object-kanban` renderer never read (zero `groupField` sites under
        // `packages/plugin-kanban/`, against thirteen `schema.groupBy` reads in
        // `ObjectKanban.tsx`). objectui#7322 retired the key on that node on
        // both faces — `groupField?: never` on the TS interface and a
        // `retirementTombstone()` in the zod mirror — so the write made this
        // adapter emit a node the published contract refuses BY NAME. It was
        // inert only because the generated node never reaches
        // `safeValidateSchema` (SchemaRenderer runs the structural
        // `validateSchema`); the CLI's `os check` / `os validate` do run the
        // mirror, so the same node authored by hand was already rejected.
        // ⛔ Do not restore it: the tombstone is the contract.
        //
        // ⚠️ NODE-LOCAL: the VIEW-LEVEL `kanbanCfg.groupField` alias read here
        // was a separate key, and objectui#6152 round 14 retired it.
        return {
          type: 'object-kanban',
          ...baseProps,
          groupBy,
          titleField: kanbanCfg.titleField || 'name',
          cardFields,
          ...(kanbanCfg.summarizeField ? { summarizeField: kanbanCfg.summarizeField } : {}),
          ...(kanbanConditionalFormatting ? { conditionalFormatting: kanbanConditionalFormatting } : {}),
        };
      }
      case 'calendar': {
        // objectui#7029: the SECOND route to `ObjectCalendar`. `generateViewSchema`
        // runs precisely when no host supplied `renderListView` — the authored
        // `object-view` element — so it never passes through `ListView`, and the
        // deletion this card made in app-shell + plugin-list does not reach it.
        // Left alone it would keep fabricating the same three bindings for a view
        // that declared none, which is what makes the renderer's own refusal
        // screen unreachable (it decides by asking whether a start-date binding
        // is PRESENT). Ruled on objectstack#13748: ⛔ either way no invented field
        // names — so both routes forward only what the author declared.
        //
        // ⭐ objectui#8355 — AND IT FORWARDS THE CANONICAL KEYS ONLY. The trailing
        // spread below used to carry the authored block RAW, so the retired
        // `dateField` / `endField` spellings reached the generated node without
        // this file ever naming them — the same blindness that let a text census
        // of producers come back a confident zero on the first route
        // (objectui#8651). `ListView`'s calendar branch strips them the same way.
        //
        // ⛔ STRIPPING IS ONLY THE QUIET HALF, and on its own it would make this
        // route fail CONSISTENTLY and still mutely, which is the shape the
        // ruling refuses. The loud half is the read door:
        // `@object-ui/types`' `ObjectViewSchema` refuses both spellings under
        // `listViews[*].calendar` (the protocol's strict calendar block, since
        // objectui#7928), and its check names `startDateField` / `endDateField`
        // beside that refusal. A named view's `options` bag is refused whole.
        // ⛔ Never land one half without the other.
        //
        // ⛔ Deliberately NOT folded onto the canonical keys: option A was put to
        // the director seat and refused as the end state on the first route, and
        // this route follows it rather than forking. The reads below are
        // canonical-only.
        //
        // ⭐ objectui#6152 round 14: the block's five DECLARED keys, each by name,
        // and nothing else. objectui#8355 stripped `dateField` / `endField` from
        // the trailing spread; this round retired the spread, which still carried
        // every other key a stored block held (`defaultView`, an undeclared key,
        // a block key named like a node key that overrode the node's own value).
        // `colorField` and `allDayField`, which only the spread carried, are
        // named now. `ListView`'s twin retired the same spread.
        const calendarCfg = (viewOptions.calendar || {}) as Record<string, any>;
        return {
          type: 'object-calendar',
          ...baseProps,
          ...(calendarCfg.startDateField ? { startDateField: calendarCfg.startDateField } : {}),
          ...(calendarCfg.endDateField ? { endDateField: calendarCfg.endDateField } : {}),
          ...(calendarCfg.titleField ? { titleField: calendarCfg.titleField } : {}),
          ...(calendarCfg.colorField ? { colorField: calendarCfg.colorField } : {}),
          ...(calendarCfg.allDayField ? { allDayField: calendarCfg.allDayField } : {}),
        };
      }
      case 'gallery':
        // objectui#12053 — the block goes out NESTED, as the node's own
        // `gallery`, which is the shape `ListView` already hands
        // `ObjectGallery`. `ObjectGallery` reads `coverFit`, `cardSize` and
        // `visibleFields` off `schema.gallery` and nowhere else, so the flat
        // node this branch used to build (`imageField` from `coverField`, plus
        // `titleField`) dropped those three: a view declaring
        // `coverFit: 'contain'` drew its covers cropped.
        //
        // ONE SPELLING PER KEY: no flat `imageField` or `titleField` beside the
        // block. `ObjectGallery` reads `gallery.coverField` ahead of
        // `imageField` and `gallery.titleField` ahead of `titleField`, so the
        // flat pair could only restate the nested values. The branch's own
        // `'name'` title floor moves into the block with the key it floors.
        //
        // ⛔ No raw spread of the block (objectui#6152 round 14): it carried
        // every undeclared key, and a block key named like a node key
        // (`objectName`) overrode the node's own value. The keys are picked by
        // name through `GALLERY_CONFIG_SPELLING`, the spec's declared set.
        return {
          type: 'object-gallery',
          ...baseProps,
          gallery: {
            ...pickFlatMapConfig(viewOptions.gallery, GALLERY_CONFIG_SPELLING),
            titleField: viewOptions.gallery?.titleField || 'name',
          },
        };
      case 'timeline': {
        // `04a67b9dc` (step ③): the SECOND route to `ObjectTimeline`, fixed the
        // same way objectui#7029 fixed the calendar branch above.
        // `generateViewSchema` runs precisely when no host supplied
        // `renderListView` — the authored `object-view` element — so it never
        // passes through `ListView`, and the deletion made there does not reach
        // it. Left alone it would keep flooring the axis at `'created_at'` for a
        // view that declared none, which is what makes the renderer's own
        // refusal screen unreachable (it decides by asking whether a start-date
        // binding is PRESENT). House posture, ruled 2026-09-01 (总监批 #28):
        // 日期轴永不虚构 — a date axis is never fabricated.
        //
        // ⛔ `titleField` keeps its `'name'` floor: not a date axis, and the same
        // display-name rung the gallery and kanban branches carry here.
        //
        // ⭐ objectui#6152 round 14: the block's DECLARED keys only, flat, by
        // `TIMELINE_CONFIG_SPELLING`. `startDateField` is the spec key and the
        // only start binding read here. The pre-#2231 `dateField` alias had a
        // rung, and the raw spread that followed it put a stored
        // `timeline.dateField` onto the node's FLAT `dateField`, which
        // `ObjectTimeline` reads as its own declared prop: the alias bound the
        // axis twice over. Both retired, so a stored alias binds nothing and the
        // component's refusal screen names the keys to write.
        return {
          type: 'object-timeline',
          ...baseProps,
          ...pickFlatMapConfig(viewOptions.timeline, TIMELINE_CONFIG_SPELLING),
          titleField: viewOptions.timeline?.titleField || 'name',
        };
      }
      case 'gantt':
        // `5f4514f7b`: only ever restate a binding the view actually DECLARED
        // — the same correction objectui#7029 made to the calendar branch above.
        // `startDateField` / `endDateField` used to be floored at 'start_date' /
        // 'end_date', field names no view had written and most objects do not
        // carry. `ObjectGantt.getGanttConfig` takes its flat branch as soon as
        // BOTH date props are present, so a fabricated pair short-circuited the
        // renderer's own refusal screen. ObjectGantt REFUSES an absent binding
        // (measured — it does not render empty and does not throw); pinned in
        // `plugin-gantt/src/ObjectGantt.unconfiguredRefusal-7070.test.tsx`.
        //
        // `progressField` / `dependenciesField` are NOT floored either, as of
        // objectui#7499 — the flavour-3 card `5f4514f7b` scoped out and left pinned
        // here so that whoever retired them had a place to declare it. OMIT,
        // not refuse: "no progress" and "no dependencies" are legitimate and
        // common states (unlike an absent date axis), so refusing would break
        // the common case — but `|| 'progress'` / `|| 'dependencies'` invented
        // a binding no author wrote, and its failure mode is a per-row
        // `undefined` INDISTINGUISHABLE from that legitimate absence, so a
        // misspelt key hit a same-named column silently. Omitting keeps the
        // legitimate case rendering exactly as before while a declared value
        // still passes verbatim through the declared-key copy below.
        // Deleting them cannot resurrect a config — `getGanttConfig` gates on
        // the two date fields alone, so the refusal screen stays as reachable
        // as it was (`plugin-gantt/src/ObjectGantt.unconfiguredRefusal-7070`).
        return {
          type: 'object-gantt',
          ...baseProps,
          ...(viewOptions.gantt?.startDateField
            ? { startDateField: viewOptions.gantt.startDateField }
            : {}),
          ...(viewOptions.gantt?.endDateField
            ? { endDateField: viewOptions.gantt.endDateField }
            : {}),
          // The block's DECLARED keys, where a raw spread of the whole block
          // stood until objectui#6152 round 14. See `GANTT_CONFIG_SPELLING`.
          ...pickFlatMapConfig(viewOptions.gantt, GANTT_CONFIG_SPELLING),
        };
      case 'map':
        // Whitelisted flatten (objectui#5177) — see `FLAT_MAP_CONFIG_SPELLING`,
        // which also carries `style` out as `mapStyle` (objectui#9950).
        // `viewOptions.map` is an untyped bag (the host `views` entry, merged
        // with the named view's canonical `map` block); a raw
        // spread here forwarded every key the author wrote, including `style`,
        // which `ObjectMap`'s `FlatMapConfigKeys` declares OUT of this flat form.
        //
        // ⛔ NO `locationField: … || 'location'` FLOOR (objectui#8169 — ruled
        // 2026-09-07 「同意」, option B), for the same reason the gantt branch
        // above carries no date floors: only ever restate a binding the view
        // actually DECLARED. This floor was worse than a duplicate of
        // `getMapConfig`'s own default branch — it SHADOWED half of it, forcing
        // the flat branch to return that one key with no `latitudeField` /
        // `longitudeField` beside it. Both faces moved together: the
        // component's coordinate guesses are gone, and an undeclared map now
        // renders `ObjectMap`'s "Map configuration required" refusal instead of
        // an empty map — pinned in
        // `plugin-map/src/ObjectMap.unboundRefusal-8169.test.tsx`.
        return {
          type: 'object-map',
          ...baseProps,
          ...pickFlatMapConfig(viewOptions.map),
        };
      case 'tree':
        // ⛔ HOST-COMPOSITION ONLY (objectui#5321) — see
        // {@link OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES}. `tree` is a member
        // of neither `ObjectViewSchema.defaultViewType` nor
        // `NamedListView.type`, so no authored document reaches this branch;
        // it runs only when a host passes a `views` prop. Ruled RECORDED, not
        // declared, 2026-08-20. The `viewOptions.tree.*` surface below is
        // therefore HOST config — maintained, read, and ⛔ not authoring
        // surface to teach in the docs.
        return {
          type: 'object-tree',
          ...baseProps,
          // Single-parent pointer field; auto-detected from the object's
          // `tree`/self-reference field when not specified.
          parentField: viewOptions.tree?.parentField,
          // ⛔ No `titleField` rung (objectui#6152 round 14). The spec refuses
          // `tree.titleField` by name and `TreeViewConfig` does not carry it
          // (objectui#8841); the undeclared fallback that still read it is
          // retired here, in `ListView` and in app-shell's relay alike.
          labelField: viewOptions.tree?.labelField || 'name',
          // The view's columns double as the tree-grid's flat columns.
          fields: viewOptions.tree?.fields || baseProps.fields,
          defaultExpandedDepth: viewOptions.tree?.defaultExpandedDepth,
          // ⛔ No raw spread of the block after these (objectui#6152 round 14):
          // the spec's tree block is the four keys above, and the spread only
          // added undeclared keys and let a block key named like a node key
          // override the node's own value.
        };
      case 'chart': {
        // ⛔ HOST-COMPOSITION ONLY (objectui#5321) — the same record as
        // `tree` above: `chart` is in neither authored union, so the ADR-0021
        // shape below is reachable only through a host `views` prop. Ruled
        // RECORDED, not declared, 2026-08-20.
        //
        // A chart of an ADR-0021 `dataset`, delegating to the same
        // object-chart component the dashboard uses.
        const chartCfg = viewOptions.chart || {};
        // ADR-0021 (objectstack-ai/objectstack#1890): dataset-bound chart — the single author-facing shape.
        if (chartCfg.dataset) {
          const dims: string[] = Array.isArray(chartCfg.dimensions) ? chartCfg.dimensions : [];
          const vals: string[] = Array.isArray(chartCfg.values) ? chartCfg.values : [];
          return {
            type: 'object-chart',
            dataset: chartCfg.dataset,
            dimensions: dims,
            values: vals,
            chartType: chartCfg.chartType || 'bar',
            xAxisKey: dims[0],
            series: vals.map((v: string) => ({ dataKey: v, label: v })),
            className: 'h-[400px] w-full',
          };
        }
        // ⛔ NO LEGACY INLINE AGGREGATE (objectui#6152 round 15). A block that
        // names no `dataset` used to be translated here from the pre-ADR-0021
        // axes (`xAxisField` / `categoryField`, `yAxisFields` / `valueField`,
        // `aggregation`), floored at `'name'` / `'value'` when it declared
        // none. The protocol's chart block refuses those axes by name (a named
        // view meets that refusal; a host `views` entry declares no `chart`
        // block at all), so the path retired with them, floors included — the
        // same retirement as `ListView`'s
        // `case 'chart'` and app-shell's object page. What is left is the
        // UNBOUND chart: an object-bound node that names no category, which
        // `ObjectChart` refuses on screen (objectui#8168,
        // `chart-missing-category-axis`) instead of aggregating on a name
        // nobody wrote. ⛔ Do not restore a floor here.
        return {
          type: 'object-chart',
          objectName: schema.objectName,
          chartType: chartCfg.chartType || 'bar',
          className: 'h-[400px] w-full',
        };
      }
      default:
        return null;
    }
    // #endregion object-view VIEW-TYPE BRANCHES (objectui#5321)
    // `schema.table?.columns` joins the list with the read added for
    // objectui#5269: a memo that reads a key but does not depend on it keeps
    // serving the field list the author has already replaced.
  }, [schema.objectName, schema.table?.columns, schema.table?.fields, currentNamedViewConfig, activeView]);

  // Build grid schema (default content renderer)
  //
  // objectui#5102: `table` is documented as "inherits from ObjectGridSchema",
  // but this whitelist forwarded only the DEPRECATED half of four pairs —
  // `pageSize` / `selectable` / `defaultFilters` / `defaultSort` — and dropped
  // their canonical successors `pagination` / `selection` / `filter` / `sort`
  // on the floor. An author who wrote the canonical shape the type recommends
  // got a compile-clean, semantically correct, RUNTIME-INERT view.
  //
  // ObjectGrid reads both spellings of the first two and resolves them
  // canonical-first (`schema.pagination?.pageSize ?? schema.pageSize`;
  // `if (schema.selection?.type) … else if (schema.selectable !== undefined)`),
  // so for those the fix is forwarding, not translation: emitting both slots
  // lets ObjectGrid's existing canonical-wins rule decide.
  //
  // objectui#11880 item 5: the filter pair is resolved HERE instead, and
  // handed over in `filter` alone (see `gridTableFilterRung`). ObjectGrid does
  // not read its two filter slots alike: its server export and its page reset
  // read only `filter`, so a filter riding `defaultFilters` narrowed the rows
  // on screen while the downloaded file held every record, and changing it in
  // place kept the old page. `@objectstack/spec` also retires
  // `object-grid.defaultFilters` (objectstack#11509, A-narrow), so this
  // component no longer writes it at all.
  //
  // objectui#5861: the fourth pair is no longer a pair. `defaultSort` was
  // RETIRED under ADR-0049 — `@objectstack/spec` refuses it by name on
  // `object-grid` — so it is not forwarded, ObjectGrid no longer reads it, and
  // `sort` below is the only sort slot this memo fills.
  //
  // objectui#5270: the two segments AHEAD of `table` had a second, separate
  // problem — an ARITY mismatch, not a spelling one. Both of them carry an
  // ARRAY of sort keys (`NamedListView.sort` is `Array< { field, order } >`;
  // the `views` prop declares an array too) and both were being written into
  // `defaultSort`, which was declared a SINGLE `{ field, order }`. Neither of
  // the two `defaultSort` readers ObjectGrid had at the time survived that:
  // the header reader re-wrapped the array into a nested one that parsed to
  // no arrow, and the fetch reader read `field` / `order` off the array and
  // sent the literal string `"undefined undefined"` as `$orderby`. (Both of
  // those readers are gone since objectui#5861 retired `defaultSort`.)
  //
  // So the view's sort now rides the CANONICAL slot, `ObjectGridSchema.sort`,
  // which holds the multi-key arity a view carries. That is also the shape the
  // shared sort sink accepts (`convertSortToQueryParams`, `SortConfig[]` —
  // objectui#4869, narrowed to the array alone by objectui#8221), so this
  // converges on the normalized dialect instead of introducing another.
  // Precedence: a view sort outranks `table.sort` — the same order
  // `mergedSort` and the non-grid fetch use.
  const gridSchema: ObjectGridSchema = useMemo(() => {
    // The two segments ahead of the `table` one, resolved once.
    //
    // objectui#11880 item 5: `viewFilter` rides the CANONICAL slot, `filter`,
    // as the `table` rung does when no view filter is present. Both slots
    // reach the wire through the same `toFilterNode` sink in ObjectGrid
    // (objectui#4082), so the query is unchanged; what moves is that the
    // export and the page reset, which read `filter` only, now see it.
    //
    // objectui#10506: all three filter segments are read RESOLVED (see
    // `authoredFilters`), and held while their inputs are unchanged — ObjectGrid
    // keys its fetch on `schema.filter`'s identity.
    const viewFilter = authoredFilters.view;
    // objectui#6152 round 8 — the grid's `operations` block is the row's
    // `{ create, update, delete, export }`. `read` is this view's own toggle (its
    // row-click gate, `handleRowClick`), which `ObjectGrid` never read and the
    // row refuses by name, so it stays here and is not handed on.
    const { read: _viewRowClickGate, ...gridOperations } = operations;
    // objectui#7928: see the non-grid fetch above. A retired string `sort` on a
    // named view reaches `ObjectGrid` unchanged, which refuses it out loud.
    const viewSort = (currentNamedViewConfig?.sort as ObjectGridSchema['sort']) || activeView?.sort;
    // objectui#10885 — subtracted from whichever projection wins below, and
    // what survives is put in the named view's `fieldOrder`.
    const hiddenFields = currentNamedViewConfig?.hiddenFields;
    const fieldOrder = currentNamedViewConfig?.fieldOrder;
    // objectui#10976 — the `table` members relayed verbatim, as authored.
    const tableRelay = authoredTableRelay(schema.table);

    return {
      type: 'object-grid',
      objectName: schema.objectName,
      title: schema.table?.title,
      // objectui#10976: no `description` — `ObjectGrid` has no read of it, so
      // the slot withholds it and this build no longer copies a dead value.
      // objectui#8254 — the same names-slot/union-slot split the non-grid
      // branch above makes, on the pair this memo emits together: `fields` is
      // `ObjectGridSchema.fields` (`string[]`) so the named-view segment is
      // folded to identities, and `columns` is `string[] | ListColumn[]` so it
      // takes the authored value raw. One value, two slots, each given the
      // shape it declares.
      // objectui#10885 — both slots lose the named view's `hiddenFields`
      // (see `withoutHiddenFields`), then take its `fieldOrder` (see
      // `inFieldOrder`).
      fields: inFieldOrder(withoutHiddenFields(
        viewColumnFieldNames(currentNamedViewConfig?.columns) || activeView?.columns || schema.table?.fields,
        hiddenFields,
      ), fieldOrder),
      columns: inFieldOrder(withoutHiddenFields(
        currentNamedViewConfig?.columns || activeView?.columns || schema.table?.columns,
        hiddenFields,
      ), fieldOrder),
      operations: {
        ...gridOperations,
        create: false, // Create is handled by the view's create button
      },
      // objectui#11880 item 5 — the whole filter chain in ONE slot: the active
      // view's filter (any truthy value, an empty array included, as before),
      // else the `table` rung (`gridTableFilterRung`). No `defaultFilters`:
      // ObjectGrid's export and page reset read `filter` only.
      filter: viewFilter || gridTableFilterRung(authoredFilters),
      // `sort` carries the WHOLE chain instead — view segments first, then the
      // `table` one. Same precedence as `mergedSort` and the non-grid fetch
      // express; what changes is only WHICH slot a view's sort arrives in, and
      // this is the one whose declared arity can hold it.
      sort: viewSort || schema.table?.sort,
      // ⭐ objectui#10976 — every relayed `table` member the author wrote
      // (`OBJECT_VIEW_TABLE_RELAY_KEYS`). Spread FIRST, so a named-view rung
      // below that declares the same member overrides it; each such rung falls
      // back to `tableRelay` rather than to `undefined`.
      ...tableRelay,
      // ⭐ objectui#10885 — the named view's own GRID MEMBERS, read here the
      // way the host delegation below reads them since objectui#10758: the
      // named view first, then the node's `table` (`table.pagination` and
      // `table.selection` by name, the rest through `tableRelay` since
      // objectui#10976). Each is a member the
      // protocol declares on a named view AND on `object-grid`, under the same
      // name, and `ObjectGrid` reads each one. The Studio's view preview renders
      // a stored view through this branch, so before this a stored view's
      // `rowHeight`, `pagination` and the rest were accepted and not shown.
      //
      // NAMED-VIEW FIRST, like `grouping` / `rowColor` below: ⛔ no
      // `activeView` rung (the host `views` path never fed these slots on this
      // branch). The node's `table` is each rung's fallback since objectui#10976
      // — objectui#10885 added no node read, and this card adds them as the
      // relay above. ⛔ No alias and no key `object-grid` does not declare:
      // `hiddenFields` and `fieldOrder` are applied to the projection above
      // rather than relayed.
      // `navigation` is still not relayed to `ObjectGrid`: this component
      // passes the grid its own `onRowClick`, which the grid's navigation hook
      // obeys first, and that handler reads the named view's `navigation`
      // (`navigationConfig`, objectui#10885).
      pagination: currentNamedViewConfig?.pagination ?? schema.table?.pagination,
      selection: currentNamedViewConfig?.selection ?? schema.table?.selection,
      rowHeight: currentNamedViewConfig?.rowHeight ?? tableRelay.rowHeight,
      resizable: currentNamedViewConfig?.resizable ?? tableRelay.resizable,
      searchableFields: currentNamedViewConfig?.searchableFields ?? tableRelay.searchableFields,
      // The protocol's rule `condition` is a string or the `{ dialect, source }`
      // expression wire; `ObjectGrid` hands every rule to the shared evaluator
      // (`resolveConditionalFormatting`), which reads both. No assertion: the
      // grid's declared rule type reads the named view's `condition` slot by
      // reference (objectui#10946), so the relay type-checks as written.
      conditionalFormatting: currentNamedViewConfig?.conditionalFormatting ?? tableRelay.conditionalFormatting,
      rowActions: currentNamedViewConfig?.rowActions ?? tableRelay.rowActions,
      bulkActions: currentNamedViewConfig?.bulkActions ?? tableRelay.bulkActions,
      // Same as `conditionalFormatting`: the protocol's `visible` expression
      // wire may carry `ast` alongside (or, on the installed spec, instead of)
      // `source`, and `BulkActionDef.visible` reads that slot by reference
      // (objectui#10946). It is the value the host delegation already hands
      // `ObjectGrid` through `ListView`.
      bulkActionDefs: currentNamedViewConfig?.bulkActionDefs ?? tableRelay.bulkActionDefs,
      exportOptions: gridExportOptions(currentNamedViewConfig?.exportOptions) ?? tableRelay.exportOptions,
      // objectui#10885 — the named view's `inlineEdit` is the grid's
      // `editable`. The node rung is `table.editable` since objectui#10976
      // (the relay above). Neither can widen editing past a grant: `ObjectGrid`
      // ANDs it with the object's inline-edit verdict and the principal's
      // `update` grant (`inlineEditable`), as `ListView` does on the delegation.
      editable: currentNamedViewConfig?.inlineEdit ?? tableRelay.editable,
      // ⭐ objectui#8980 — the AUTHOR-REACHABLE read point for two of the
      // seventeen. `ObjectGrid` already reads both (`schema.grouping` in its
      // group-field memo and its reference collector, `useRowColor(schema.rowColor)`),
      // and this default content renderer is where an authored `object-view`
      // with a `type: 'grid'` named view actually lands — the `renderListView`
      // delegation above runs only for a HOST (objectui#5097).
      //
      // NAMED-VIEW FIRST, then the node's `table` (objectui#10976). ⛔ No
      // `activeView` rung: the host `views` path has never fed these two slots
      // on this branch, and widening it here would be a behaviour change on a
      // surface neither card owns.
      grouping: currentNamedViewConfig?.grouping ?? tableRelay.grouping,
      rowColor: currentNamedViewConfig?.rowColor ?? tableRelay.rowColor,
      pageSize: schema.table?.pageSize,
      selectable: schema.table?.selectable,
      className: schema.table?.className,
    };
  }, [schema, operations, currentNamedViewConfig, activeView, authoredFilters]);

  // Build form schema
  const buildFormSchema = (): ObjectFormSchema => {
    // ⚠️ The assertion states the PROTOCOL, it does not convert (objectui#9511).
    // `selectedRecord` is an untyped record bag, so this was always a hand-written
    // assertion; it now asserts the one shape a record id has — a `string` — rather
    // than the wide one. ⛔ Deliberately NOT `String(...)`: the ruling puts the
    // conversion at the adapter's own boundary, in one typed place, and a reader-side
    // coercion here is exactly the option it refused.
    const recordId = selectedRecord
      ? ((selectedRecord.id || selectedRecord._id) as string | undefined)
      : undefined;

    return {
      type: 'object-form',
      objectName: schema.objectName,
      mode: formMode,
      recordId,
      title: schema.form?.title,
      description: schema.form?.description,
      fields: schema.form?.fields,
      customFields: schema.form?.customFields,
      // #2545: `sections` is the spec-aligned key (it used to be dropped
      // here); `groups` is its deprecated legacy alias, normalized to
      // sections inside ObjectForm.
      sections: schema.form?.sections,
      groups: schema.form?.groups,
      layout: schema.form?.layout,
      columns: schema.form?.columns,
      showSubmit: schema.form?.showSubmit,
      submitText: schema.form?.submitText,
      showCancel: schema.form?.showCancel,
      cancelText: schema.form?.cancelText,
      showReset: schema.form?.showReset,
      initialValues: schema.form?.initialValues,
      // framework#1894 / objectstack-ai/objectstack#2998: forward the spec-aligned structured
      // `buttons`/`defaults`; ObjectForm folds them onto the flat props above
      // (an explicitly-set flat key still wins).
      buttons: schema.form?.buttons,
      defaults: schema.form?.defaults,
      readOnly: schema.form?.readOnly || formMode === 'view',
      className: schema.form?.className,
      // Master-detail by config: a form view can declare inline child
      // collections; ObjectForm renders them as an atomic master-detail form
      // (no bespoke page). ObjectForm skips them in view mode.
      subforms: schema.form?.subforms,
      onSuccess: handleFormSuccess,
      onCancel: handleFormCancel,
    };
  };

  // Get form title based on mode.
  //
  // objectui#3462: the three verbs used to be string-built (`` `View ${label}` ``),
  // so a zh session reading a drawer opened by a row click was headed
  // "View 联系人" — an English verb glued onto a localized label. They resolve
  // `form.{create,edit,view}Title` now, which is the SAME key family `app-shell`
  // already uses for the page-mode record form, so the four surfaces cannot
  // drift. German compounds and ja/zh particle order all sit inside the
  // template, which is why this is a key and not a verb lookup + concatenation.
  //
  // Two branches stay literal on purpose:
  //   - `schema.form?.title` — the author wrote a title, so use the author's.
  //   - `default` — returns the object label alone, no verb to translate.
  // `form.title` / `form.description` are `I18nLabel` (objectui#10993): read
  // raw, a per-locale map was a React child in the drawer and modal headers.
  const formTitleText = pickLocalized(schema.form?.title, uiLanguage);
  const formDescriptionText = pickLocalized(schema.form?.description, uiLanguage);
  const getFormTitle = (): string => {
    if (formTitleText) return formTitleText;
    const objectLabel = (objectSchema?.label as string) || schema.objectName;
    switch (formMode) {
      case 'create': return tView('form.createTitle', { object: objectLabel });
      case 'edit': return tView('form.editTitle', { object: objectLabel });
      case 'view': return tView('form.viewTitle', { object: objectLabel });
      default: return objectLabel;
    }
  };

  // Determine form container width from navigation config
  const formWidthClass = useMemo(() => {
    const w = navigationConfig?.width;
    if (!w) return '';
    if (typeof w === 'number') return `max-w-[${w}px]`;
    return `max-w-[${w}]`;
  }, [navigationConfig]);

  // Render the form in a drawer: a right-hand panel on a desktop, a bottom
  // sheet on a phone (`isMobile`, the breakpoint the record surface is
  // derived on).
  //
  // objectui#11775: this used to be one vaul `Drawer` with
  // `direction="right"` on every viewport. vaul honours `direction` for the
  // slide and the drag gesture only; the shipped `DrawerContent` is the
  // upstream bottom sheet and styles itself as one whatever the direction, so
  // on a desktop the form drew as a bottom sheet pinned to the bottom-left by
  // `sm:max-w-2xl`. The desktop panel is now the right-hand `Sheet`, the
  // primitive `NavigationOverlay`'s drawer mode and `DrawerForm` already open
  // records in. The phone keeps vaul's bottom sheet, opened in vaul's own
  // default direction so its slide and drag match how it is drawn, and spans
  // the viewport like every other bottom sheet: the width classes, and an
  // authored `navigation.width`, size the side panel only.
  const renderDrawerForm = () => {
    const form = (
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <ObjectForm schema={buildFormSchema()} dataSource={dataSource} />
      </div>
    );
    if (isMobile) {
      return (
        <Drawer open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{getFormTitle()}</DrawerTitle>
              {formDescriptionText && (
                <DrawerDescription>{formDescriptionText}</DrawerDescription>
              )}
            </DrawerHeader>
            {form}
          </DrawerContent>
        </Drawer>
      );
    }
    return (
      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent
          side="right"
          className={cn('flex w-full flex-col gap-0 p-0 sm:max-w-2xl', formWidthClass)}
        >
          {/* `pr-12` keeps the title clear of the Sheet's own close button. */}
          <SheetHeader className="p-4 pr-12">
            <SheetTitle>{getFormTitle()}</SheetTitle>
            {formDescriptionText && (
              <SheetDescription>{formDescriptionText}</SheetDescription>
            )}
          </SheetHeader>
          {form}
        </SheetContent>
      </Sheet>
    );
  };

  // Render the form in a modal
  const renderModalForm = () => (
    <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
      <DialogContent className={cn('max-w-2xl max-h-[90vh] overflow-y-auto', formWidthClass)}>
        <DialogHeader>
          <DialogTitle>{getFormTitle()}</DialogTitle>
          {formDescriptionText && (
            <DialogDescription>{formDescriptionText}</DialogDescription>
          )}
        </DialogHeader>
        <ObjectForm schema={buildFormSchema()} dataSource={dataSource} />
      </DialogContent>
    </Dialog>
  );

  // The filter and sort this component hands to the renderer it delegates to.
  //
  // Both used to open with a branch keyed on the local filter/sort state — and
  // the filter one REPLACED the view's own filter with the user's rather than
  // combining them, which would have been a bug had the state ever been
  // written. It never was (see the note by the state declarations), so both
  // branches were dead. They are gone rather than corrected: the delegated
  // renderer owns the filter/sort UI and does its own combining.
  //
  // The `table` segment of the filter chain reads the canonical key first and
  // the deprecated one as its alias (objectui#5102). Both chains land on
  // `list-view`'s own `filter` / `sort` keys below, so a canonical value
  // arrives in the slot that already matches its shape.
  //
  // objectui#5861: the sort chain has no alias branch any more. It used to end
  // in the legacy single-entry `table.defaultSort`, wrapped into an array here
  // (objectui#6235) because `list-view`'s `sort` slot declares `SortConfig[]`
  // and every reader of that slot drops a bare object silently. That key is
  // now RETIRED under ADR-0049 — `@objectstack/spec` refuses it by name on
  // `object-grid` — and it was retired here in the same change as the non-grid
  // fetch above, the grid forwarding and `ObjectGrid`'s own read, so no path
  // honours it while another ignores it. ⛔ Do not bring the alias back by
  // teaching the shared sink a bare `{ field, order }`: that is the widening
  // the maintainer ruling of 2026-08-22 REJECTED (quoted with the non-grid
  // fetch above), because that slot legitimately also carries `$orderby`'s own
  // `Record<field, direction>` map.
  //
  // objectui#10506: the filter chain reads the RESOLVED segments, so the
  // delegated renderer receives real ids. The app-shell host resolves this
  // value again in its own `renderListView`; a resolved id no longer matches
  // the whole-token pattern, so that second pass changes nothing.
  const mergedFilters = authoredFilters.view
    || authoredFilters.table;

  const mergedSort = currentNamedViewConfig?.sort
    || activeView?.sort
    || schema.table?.sort;

  // --- Content renderer ---
  const renderContent = () => {
    // The view's IDENTITY — switching object, view or type is a real remount,
    // and it is the ONLY thing in the key (objectui#10035; AGENTS.md #8's
    // corollary: refresh data, don't rebuild UI). A write no longer remounts
    // any view. `kanban`, `calendar`, `gallery`, `timeline` and `map` draw
    // `data={data}`, the rows the non-grid fetch effect re-reads when
    // `refreshKey` moves or when the data-invalidation bus reports a change to
    // this object (objectui#10887), keeping them on screen meanwhile
    // (objectui#10982). `ObjectGrid`, `ObjectGantt`, `ObjectTree` and
    // `ObjectChart` query for themselves (`VIEW_TYPES_DRAWING_FETCHED_ROWS`
    // says why each is off that list) and refetch in place on the bus,
    // which every site that moves `refreshKey` also notifies
    // (`announceOwnWrite`, the `onMutation` subscription). ⛔ Do not put
    // `refreshKey` back in a key: that is the remount the corollary forbids,
    // and it throws away the view's scroll, selection, open drawers and
    // in-progress edits on every save.
    const identityKey = `${schema.objectName}-${activeNamedView || activeView?.id || 'default'}-${currentViewType}`;

    // If a custom renderListView is provided, use it
    // #region object-view HOST-COMPOSITION SURFACE (objectui#5097)
    //
    // 30 of the values assembled below are read off the object-view node with
    // `(schema as any).K`. Three are declared members of `ObjectViewSchema`;
    // the other 27 are NOT, deliberately: the maintainer ruling of 2026-08-18
    // on objectui#5097 (verbatim 「同意」) ruled them HOST-COMPOSITION surface,
    // not authored surface, because this branch is entered only when a HOST
    // passes `renderListView` and the registered renderer never does.
    //
    // ⛔ Do not declare these keys on `ObjectViewSchema`, ⛔ do not teach them
    // as schema keys in the docs, and ⛔ do not delete a read as a tidy-up — a
    // deleted read silently blanks a stored app-shell document.
    //
    // The list, the two supplier `file:line`s, the contract's (non-)verdict and
    // the now-resolved `conditionalFormatting` asymmetry (objectui#5248) live
    // with `OBJECT_VIEW_HOST_COMPOSITION_KEYS` at the top of this file. The
    // `#region` fence is load-bearing: `src/__tests__/objectViewHostSurface.test.tsx`
    // re-derives the read set from between these two markers, so adding or
    // removing a read here fails that pin BY NAME — and since objectui#5248 it
    // also fails if any exempt key is read OUTSIDE the fence, which is where
    // the author-reachable paths live.
    if (renderListView) {
      return renderListView({
        schema: {
          type: 'list-view',
          objectName: schema.objectName,
          viewType: currentViewType as any,
          // Active view's display label — ListView appends it to export
          // download filenames.
          label: currentNamedViewConfig?.label ?? activeView?.label,
          // ⭐ objectui#10758 — bucket ① of the objectui#7924 ruling: the
          // protocol members a named view declares (`ObjectListViewSchema`)
          // that this branch used to take from the host `views` entry and the
          // node only. Their rungs below now read the NAMED VIEW first, then
          // the host `views` entry, then — only where the rung already had
          // one — the node: the precedence `grouping` / `rowColor` /
          // `appearance` use. `ListView` reads each of them off the
          // `list-view` node it is handed. The named-view reads inside this
          // fence are re-derived BY NAME by `objectViewHostSurface.test.tsx`,
          // and the whole-file census by `object-view-unmirrored-keys-7779.test.ts`
          // in `@object-ui/types`; neither list is restated here.
          //
          // ⛔ No rung gained a `(schema as any)` read: the objectui#5097
          // HOST-COMPOSITION exemption stays at the 27 names the 2026-08-18
          // ruling fixed. The three rungs this card ADDED (`description`,
          // `exportOptions`, `bulkActionDefs`) are view-sourced only. ⛔ No
          // alias and no legacy spelling is read off the named view: it is
          // the protocol's strict record (objectui#7928), so each rung reads
          // the member under its one protocol name.
          description: currentNamedViewConfig?.description ?? activeView?.description,
          // Spec-canonical key (#2890) — the view configs this reads from are
          // already `columns`-keyed, so emitting `fields` here was a pure
          // canonical→legacy downgrade.
          //
          // objectui#5269: the `table` segment reads the canonical key first
          // here too. This slot is `list-view`'s `columns`, declared
          // `string[] | ListColumn[]` — the same union `table.columns` carries
          // — so the canonical value arrives in a slot already shaped to hold
          // it, and `ListView` reads it (`schema.columns`, its whole column
          // set). The deprecated `table.fields` stays a working alias.
          columns: currentNamedViewConfig?.columns || activeView?.columns
            || schema.table?.columns || schema.table?.fields,
          filter: mergedFilters,
          sort: mergedSort,
          // Propagate appearance/view-config properties for live preview.
          // objectui#7924 (ruling A′): the density is read THROUGH the fold,
          // so a stored view that still spells it `densityMode` is handed
          // down as `rowHeight`, and the retired key is never relayed by name.
          // objectui#10758: the named view's own `rowHeight` comes first, read
          // as itself — the strict record refuses `densityMode`, so there is
          // nothing on that side for the fold to map.
          rowHeight: currentNamedViewConfig?.rowHeight ?? (normalizeListViewSchema(activeView ?? {}) as { rowHeight?: string }).rowHeight,
          groupBy: activeView?.groupBy,
          groupBy2: activeView?.groupBy2,
          // objectui#8980 — the protocol declares `grouping` on a named list
          // view and `ListView` reads it (`schema.grouping`); the named view had
          // no rung here at all. Canonical source first, host `views` entry
          // second — the precedence every other pair on this branch uses.
          grouping: currentNamedViewConfig?.grouping ?? activeView?.grouping,
          // objectui#7928 — the host `views` entry only; a named view's legacy
          // `options` bag is no longer read (see `legacyViewOptions` above).
          options: activeView,
          // Toolbar policy — one vocabulary (#2890). The host node and the
          // active view may still carry the legacy bare `show*` flags, so both
          // go through `normalizeListViewSchema` (the single fold) and merge,
          // view over host. `rowHeight` above takes the same fold.
          userActions: {
            ...(normalizeListViewSchema(schema ?? {}) as { userActions?: object }).userActions,
            ...(normalizeListViewSchema(activeView ?? {}) as { userActions?: object }).userActions,
            // objectui#8980 — the named view is the most specific source, so it
            // folds in LAST. Spread rather than `??` on purpose: this slot is a
            // merge of toggle sets, not a winner-takes-all pick, and a named
            // view that toggles one action must not blank the rest.
            //
            // objectui#5144 — through the same fold as the two layers above.
            // A named view carries no `show*` flag (its strict record refuses
            // them), but it can carry the spec's `inlineEdit`, which the fold
            // turns into `userActions.editInline`. Spread raw, a host view's or
            // the node's folded `inlineEdit` outranked the named view's own,
            // the inverse of the named-first `inlineEdit` rung below. The fold
            // is handed the two members it reads into `userActions` here, by
            // name rather than the whole view, so the fence's read census
            // (`objectViewHostSurface.test.tsx`) still sees each one.
            ...(normalizeListViewSchema({
              userActions: currentNamedViewConfig?.userActions,
              inlineEdit: currentNamedViewConfig?.inlineEdit,
            }) as { userActions?: object }).userActions,
          },
          compactToolbar: currentNamedViewConfig?.compactToolbar ?? activeView?.compactToolbar ?? (schema as any).compactToolbar,
          // objectui#11013 — the host `views` entry is no longer read for
          // `allowExport`: nothing writes it onto a view (no console surface,
          // no authored view here, and the spec's view schema refuses it by
          // name). The node's value is the objectui#5097 host-composition read.
          allowExport: (schema as any).allowExport,
          exportOptions: currentNamedViewConfig?.exportOptions ?? activeView?.exportOptions,
          // Propagate display properties
          color: activeView?.color ?? (schema as any).color,
          // The spec-canonical row-colour CONFIGURATION (objectui#7218).
          // `ListView` seeds its `rowColorConfig` state from this key; the
          // bare `color` above is the legacy shorthand for the same feature
          // and was already relayed, so only the canonical spelling was
          // missing. Copied from the interface route, which has shipped
          // `rowColor: view.rowColor` next to `grouping`/`pagination` since
          // ADR-0047 (`app-shell/src/views/InterfaceListPage.tsx`).
          //
          // View-sourced ONLY, deliberately: no fallback to the same key on
          // the object-view node. Such a cast read would add a 28th name to
          // the objectui#5097 HOST-COMPOSITION exemption the 2026-08-18
          // ruling fixed at 27, which is a ruling and not a refactor.
          // `grouping` above is the precedent for a view-only rung here.
          // objectui#8980 adds the named-view rung ahead of it — still
          // VIEW-SOURCED ONLY, still no `(schema as any)` fallback, so the
          // objectui#5097 exemption stays fixed at 27 names.
          rowColor: currentNamedViewConfig?.rowColor ?? activeView?.rowColor,
          // Propagate view-config properties (Bug 4 / items 14-22)
          inlineEdit: currentNamedViewConfig?.inlineEdit ?? activeView?.inlineEdit ?? (schema as any).inlineEdit,
          // objectui#11013 — the seven renderer flags below are read off the
          // NODE only (the objectui#5097 host-composition keys). The host
          // `views` entry is a stored view row, and no producer writes any of
          // them onto one: no console surface, no view authored here, and the
          // spec's view schema refuses each by name.
          wrapHeaders: (schema as any).wrapHeaders,
          clickIntoRecordDetails: (schema as any).clickIntoRecordDetails,
          addRecordViaForm: (schema as any).addRecordViaForm,
          addDeleteRecordsInline: (schema as any).addDeleteRecordsInline,
          collapseAllByDefault: (schema as any).collapseAllByDefault,
          fieldTextColor: (schema as any).fieldTextColor,
          prefixField: (schema as any).prefixField,
          showDescription: activeView?.showDescription ?? (schema as any).showDescription,
          // ViewData source override (spec `data` key) — e.g. a gantt view on
          // inline `provider: 'value'` rows; without this pick the view's `data`
          // never reaches the renderer.
          // objectui#8980 / objectui#7928's open half: the cast on the
          // named-view config is GONE — `data` is a declared `NamedListView`
          // member now, so the read and the declaration are one fact. The
          // `activeView` and node rungs keep their casts: the host `views` entry
          // is an untyped host shape and `data` on the node is one of the 27
          // objectui#5097 host-composition keys.
          data: currentNamedViewConfig?.data ?? (activeView as any)?.data ?? (schema as any).data,
          // Propagate new spec properties (P0/P1/P2)
          navigation: currentNamedViewConfig?.navigation ?? activeView?.navigation ?? (schema as any).navigation,
          selection: currentNamedViewConfig?.selection ?? activeView?.selection ?? (schema as any).selection,
          pagination: currentNamedViewConfig?.pagination ?? activeView?.pagination ?? (schema as any).pagination,
          searchableFields: currentNamedViewConfig?.searchableFields ?? activeView?.searchableFields ?? (schema as any).searchableFields,
          resizable: currentNamedViewConfig?.resizable ?? activeView?.resizable ?? (schema as any).resizable,
          hiddenFields: currentNamedViewConfig?.hiddenFields ?? activeView?.hiddenFields ?? (schema as any).hiddenFields,
          // objectui#8980 — TWO SLOTS THAT HAD NO RUNG ON THIS BRANCH AT ALL.
          //
          // `fieldOrder` is the live third key of the protocol's
          // `columns` x `hiddenFields` x `fieldOrder` composition — objectstack#15184
          // ruling B (2026-09-11) KEPT it and ruled the composition into the
          // contract: `columns` projects, `hiddenFields` (the line above)
          // subtracts, `fieldOrder` orders what survives. `ListView` applies all
          // three in one memo; only this relay never carried the third.
          //
          // `appearance` carries `showDescription` and the ADR-0047
          // `allowedVisualizations` whitelist, both read by `ListView`.
          //
          // View-sourced only, like `grouping` / `rowColor` above: ⛔ no
          // `(schema as any)` fallback, so the objectui#5097 exemption is
          // untouched.
          fieldOrder: currentNamedViewConfig?.fieldOrder,
          appearance: currentNamedViewConfig?.appearance ?? activeView?.appearance,
          rowActions: currentNamedViewConfig?.rowActions ?? activeView?.rowActions ?? (schema as any).rowActions,
          rowActionDefs: (activeView as any)?.rowActionDefs ?? (schema as any).rowActionDefs,
          bulkActions: currentNamedViewConfig?.bulkActions ?? activeView?.bulkActions ?? (schema as any).bulkActions,
          bulkActionDefs: currentNamedViewConfig?.bulkActionDefs ?? activeView?.bulkActionDefs,
          sharing: currentNamedViewConfig?.sharing ?? activeView?.sharing ?? (schema as any).sharing,
          addRecord: currentNamedViewConfig?.addRecord ?? activeView?.addRecord ?? (schema as any).addRecord,
          conditionalFormatting: currentNamedViewConfig?.conditionalFormatting ?? activeView?.conditionalFormatting ?? (schema as any).conditionalFormatting,
          userFilters: currentNamedViewConfig?.userFilters ?? activeView?.userFilters ?? (schema as any).userFilters,
          showRecordCount: currentNamedViewConfig?.showRecordCount ?? activeView?.showRecordCount ?? (schema as any).showRecordCount,
          allowPrinting: currentNamedViewConfig?.allowPrinting ?? activeView?.allowPrinting ?? (schema as any).allowPrinting,
          emptyState: currentNamedViewConfig?.emptyState ?? activeView?.emptyState ?? (schema as any).emptyState,
          aria: currentNamedViewConfig?.aria ?? activeView?.aria ?? (schema as any).aria,
          // Propagate refresh signal so ListView re-fetches after mutations
          refreshTrigger: refreshKey,
        },
        dataSource,
        onEdit: handleEdit,
        onRowClick: handleRowClick,
        className: 'h-full',
        refreshKey,
        onAddRecord: handleCreate,
      });
    }
    // #endregion object-view HOST-COMPOSITION SURFACE (objectui#5097)

    // For non-grid views, use SchemaRenderer with generated schema
    if (currentViewType !== 'grid') {
      const viewSchema = generateViewSchema(currentViewType);
      if (viewSchema && SchemaRendererComponent) {
        return (
          <SchemaRendererComponent
            key={identityKey}
            schema={viewSchema}
            dataSource={dataSource}
            data={data}
            loading={loading}
          />
        );
      }
      // Fallback: if SchemaRenderer is not available or schema not generated
      if (!SchemaRendererComponent) {
        return (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <p>SchemaRenderer not available. Install @object-ui/react to render {currentViewType} views.</p>
          </div>
        );
      }
    }

    // Default: use ObjectGrid — keyed on identity alone; it refetches in place
    // on the data-invalidation bus (see `identityKey` above).
    return (
      <ObjectGrid
        key={identityKey}
        schema={gridSchema}
        dataSource={dataSource}
        onRowClick={handleRowClick}
        onEdit={operations.update !== false ? handleEdit : undefined}
        onDelete={operations.delete !== false ? handleDelete : undefined}
        onBulkDelete={operations.delete !== false ? handleBulkDelete : undefined}
      />
    );
  };

  // --- Named list views tabs ---
  const renderNamedViewTabs = () => {
    // ADR-0053: host owns the switcher (ViewTabBar) — don't duplicate it.
    if (hideNamedViewTabs) return null;
    if (!hasNamedViews) return null;
    const entries = Object.entries(namedListViews!);
    if (entries.length <= 1) return null;

    return (
      <Tabs value={activeNamedView} onValueChange={handleNamedViewChange} className="w-full">
        <TabsList className="w-auto">
          {entries.map(([key, view]) => (
            <TabsTrigger key={key} value={key} className="text-sm">
              {/*
                * objectui#8980 — `name` is the protocol's own identity for a
                * view, distinct from the record KEY it is filed under. It slots
                * between the two as the display fallback: a view that declares
                * one shows it instead of a synthetic key.
                *
                * ⚠️ MEASURED INERT ON THE LIVE PRODUCER, deliberately:
                * `@object-ui/app-shell`'s `applyViewItem` stamps `name: key` on
                * every composed `listViews` entry, so `view.name || key` is the
                * same string there and no existing tab label moves. It changes
                * only for an authored view whose `name` differs from its key.
                */}
              {/*
                * objectui#7928 — `label` is the protocol's `I18nLabel`, so a
                * locale map is RESOLVED here; rendered raw it threw "Objects are
                * not valid as a React child". A map with no usable entry resolves
                * to nothing and falls through to `name`, then the key.
                */}
              {resolveInlineI18nLabel(view.label, displayLocale) || view.name || key}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    );
  };

  // Render toolbar — only named view tabs; filter/sort/search is handled by ListView
  const renderToolbar = () => {
    // objectui#12082: the button is the `listNew` row of the affordance-to-grant
    // map (`resolveAffordance` in `@object-ui/core`) — the object's policy, the
    // effective operation set and the caller's create grant — on top of the
    // node's own authoring toggles, exactly as the console's list pages read it.
    // It used to read the two toggles alone, so a caller without the create
    // grant was offered a New whose form the server then refused to save. With
    // no permission provider mounted the grant reads open, as before.
    const createGranted = resolveAffordance('listNew', {
      objectSchema: objectSchema as SchemaLike | null,
      objectName: schema.objectName,
      perms,
    }).allowed;
    const showCreateButton = schema.showCreate !== false && operations.create !== false && createGranted;
    const showViewSwitcherToggle = schema.showViewSwitcher === true; // Changed: default to false (hidden)

    const namedViewTabs = renderNamedViewTabs();

    // Hide toolbar entirely if there is nothing to show
    if (!namedViewTabs && !showViewSwitcherToggle && !showCreateButton && !toolbarAddon) return null;

    return (
      <div className="flex flex-col gap-3">
        {/* Named view tabs (if any) */}
        {namedViewTabs}

        {/* ViewSwitcher + action buttons row */}
        {(showViewSwitcherToggle || showCreateButton || toolbarAddon) && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {showViewSwitcherToggle && viewSwitcherSchema && (
                <ViewSwitcher
                  schema={viewSwitcherSchema}
                  onViewChange={handleViewTypeChange}
                  onCreateView={onCreateView}
                  onViewAction={onViewAction}
                  className="overflow-x-auto"
                />
              )}
            </div>

            {/* Right side: Actions */}
            <div className="flex items-center gap-2">
              {toolbarAddon}
              {showCreateButton && (
                <Button size="sm" onClick={handleCreate}>
                  <Plus className="h-4 w-4" />
                  {createVerb}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Determine which form container to render. With no overlay `navigation` it
  // is `recordSurface`: `'page'` only with an `onNavigate`, whose handlers
  // route every verb away, and the drawer for a page with nowhere to route
  // (objectui#11015).
  const formLayout = navigationConfig?.mode === 'modal' ? 'modal'
    : navigationConfig?.mode === 'drawer' ? 'drawer'
    : navigationConfig?.mode === 'split' ? 'split'
    : navigationConfig?.mode === 'popover' ? 'popover'
    : recordSurface;

  // objectui#10975 — `split` and `popover` draw a form only beside a selected
  // record, and `handleCreate` clears it, so under either mode (the node's own
  // or the active named view's) the CREATE form opens on the surface
  // `formLayout` falls back to with no `navigation`: `recordSurface`, the modal
  // for `layout: 'modal'`, the drawer otherwise. A `page` only gets here with no
  // `onNavigate` (`handleCreate` routes it first), and `recordSurface` already
  // resolves that page to the drawer (objectui#11015). A record opened to view
  // or edit still opens beside, as before. Pinned by
  // `ObjectView.splitPopoverCreate-10975.test.tsx`.
  const renderCreateSurface = () =>
    formMode !== 'create' ? null : recordSurface === 'modal' ? renderModalForm() : renderDrawerForm();

  // Build the record detail content for NavigationOverlay (split/popover modes)
  const renderOverlayDetail = (_record: Record<string, unknown>) => (
    <div className="space-y-3">
      <ObjectForm schema={buildFormSchema()} dataSource={dataSource} />
    </div>
  );

  // Shared handler for NavigationOverlay onOpenChange — close form when overlay is dismissed
  const handleOverlayOpenChange = useCallback((open: boolean) => {
    if (!open) handleFormCancel();
  }, [handleFormCancel]);

  // Computed once so a `null` toolbar (nothing to show — no named views, no
  // view switcher, no create button, no addon) doesn't still leave behind an
  // empty `mb-4` spacer div above the content.
  const toolbar = renderToolbar();

  // The delete confirmation (objectui#10383) — this host's confirm UI, in the
  // console's `ActionConfirmDialog` shape (`actionConfirm.cancel` chrome, the
  // question as the description). Its copy — the title naming the record or
  // counting the batch, the question, and the "Delete" confirm label — and the
  // delete itself come from the shared `recordDelete` core, so this dialog
  // says what the console's says (objectui#11695); the confirm button is
  // painted destructive the way `ActionConfirmDialog` paints it. Close flips
  // `open` and KEEPS the request, so the copy does not blank during the exit
  // animation (the objectui#6034 lesson); the `open` guard on Delete is what
  // stops a click during that animation from deleting twice.
  const deleteLabel = (objectSchema?.label as string) || schema.objectName;
  const deleteCopy = deleteRequest
    ? recordDelete.confirmCopy(
        { objectName: schema.objectName, t: tView, label: deleteLabel, objectDef: objectSchema },
        deleteRequest.bulk
          ? { count: deleteRequest.records.length }
          : { record: deleteRequest.records[0] },
      )
    : null;
  const deleteConfirmDialog = (
    <AlertDialog
      open={deleteRequest?.open ?? false}
      onOpenChange={(open) => {
        if (!open) setDeleteRequest((prev) => (prev ? { ...prev, open: false } : prev));
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{deleteCopy?.title}</AlertDialogTitle>
          <AlertDialogDescription>{deleteCopy?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tView('actionConfirm.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            onClick={() => {
              if (!deleteRequest?.open) return;
              const { records, bulk } = deleteRequest;
              setDeleteRequest({ ...deleteRequest, open: false });
              void recordDelete.run(
                {
                  objectName: schema.objectName,
                  label: deleteLabel,
                  dataSource,
                  t: tView,
                  toast,
                  onRefresh: announceOwnWrite,
                },
                bulk
                  ? { params: { records } }
                  : { params: { recordId: String(records[0].id), record: records[0] } },
              );
            }}
          >
            {deleteCopy?.confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // For split mode, wrap content inside NavigationOverlay with mainContent
  if (formLayout === 'split') {
    const objectLabel = (objectSchema?.label as string) || schema.objectName;
    return (
      <div className={cn('flex flex-col h-full min-w-0 overflow-hidden', className)}>
        {(schema.title || schema.description) && (
          <div className="mb-4 shrink-0">
            {schema.title && <h2 className="text-2xl font-bold tracking-tight">{schema.title}</h2>}
            {schema.description && <p className="text-muted-foreground mt-1">{schema.description}</p>}
          </div>
        )}
        {toolbar && <div className="mb-4 shrink-0">{toolbar}</div>}
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
          {isFormOpen && selectedRecord ? (
            <NavigationOverlay
              isOpen={isFormOpen}
              selectedRecord={selectedRecord}
              mode="split"
              close={handleFormCancel}
              setIsOpen={handleOverlayOpenChange}
              width={navigationConfig?.width}
              isOverlay={true}
              /* Keyed, not string-built (objectui#3459). This value is handed
                 to `NavigationOverlay`'s `title` prop, so the overlay's own
                 `detail.recordDetail` default never applies — whatever this
                 resolves to IS the visible `h3` heading of the split panel.
                 Interpolating through `detail.recordDetailWithLabel` instead of
                 splicing the label into an English template lets each pack
                 choose its own word order (de hyphenates, ja/zh need a
                 possessive particle). English output is byte-identical
                 (`Contacts Detail`), with or without an `I18nProvider`. */
              title={tView('detail.recordDetailWithLabel', { label: objectLabel })}
              mainContent={<div className="h-full overflow-auto">{renderContent()}</div>}
            >
              {renderOverlayDetail}
            </NavigationOverlay>
          ) : (
            renderContent()
          )}
        </div>
        {renderCreateSurface()}
        {deleteConfirmDialog}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full min-w-0 overflow-hidden', className)}>
      {/* Title and description */}
      {(schema.title || schema.description) && (
        <div className="mb-4 shrink-0">
          {schema.title && (
            <h2 className="text-2xl font-bold tracking-tight">{schema.title}</h2>
          )}
          {schema.description && (
            <p className="text-muted-foreground mt-1">{schema.description}</p>
          )}
        </div>
      )}

      {/* Toolbar */}
      {toolbar && <div className="mb-4 shrink-0">{toolbar}</div>}

      {/* Content */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {renderContent()}
      </div>

      {/* Form (drawer or modal) */}
      {formLayout === 'drawer' && renderDrawerForm()}
      {formLayout === 'modal' && renderModalForm()}
      {/* Popover mode — uses NavigationOverlay Dialog fallback (no popoverTrigger) */}
      {formLayout === 'popover' && isFormOpen && selectedRecord && (
        <NavigationOverlay
          isOpen={isFormOpen}
          selectedRecord={selectedRecord}
          mode="popover"
          close={handleFormCancel}
          setIsOpen={handleOverlayOpenChange}
          width={navigationConfig?.width}
          isOverlay={true}
          title={getFormTitle()}
        >
          {renderOverlayDetail}
        </NavigationOverlay>
      )}
      {formLayout === 'popover' && renderCreateSurface()}
      {deleteConfirmDialog}
    </div>
  );
};
