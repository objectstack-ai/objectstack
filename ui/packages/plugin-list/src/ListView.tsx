/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Button, Input, Popover, PopoverContent, PopoverTrigger, FilterBuilder, SortBuilder, NavigationOverlay, GroupingEditor, RefreshIndicator, DataErrorState, resolveIcon, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@object-ui/components';
import type { SortItem } from '@object-ui/components';
import { Search, Funnel, ArrowUpDown, X, EyeOff, Pencil, Group, Paintbrush, Download, Rows4, Rows3, Rows2, Share2, Printer, Plus, Trash2, CheckSquare, AlertTriangle, ShieldAlert, RotateCw, Loader2, Info } from 'lucide-react';
import type { FilterBuilderRowGroup } from '@object-ui/components';
import { VALUELESS_FILTER_BUILDER_OPERATORS, isFilterValueComplete } from '@object-ui/components';
import { ViewSwitcherDropdown } from './ViewSwitcher';
import { ListEmptyState, hasDeclaredFilter } from './ListEmptyState';
import { ListViewCompactHeader, ListViewCompactRows } from './ListViewCompact';
import { ViewSettingsPopover } from './components/ViewSettingsPopover';
import { UserFilters } from './UserFilters';
import {
  calendarWindowCovers,
  calendarWindowFilter,
  calendarWindowFor,
  fetchCalendarWindow,
  initialCalendarWindow,
  type CalendarVisibleRange,
  type CalendarWindow,
} from './calendarWindow';
import { SchemaRenderer, useNavigationOverlay, classifyLoadError, usePredicateScope, useDataInvalidation, useFilterScope, useResolvedFilter, NonGridRowCeilingNote } from '@object-ui/react';
import type { LoadErrorKind } from '@object-ui/react';
import { useDensityMode, resolveInlineAriaProps } from '@object-ui/react';
import type { DependsOnInput, ListViewSchema, ObjectMapConfig } from '@object-ui/types';
import { detectStatusField, isSystemManagedField } from '@object-ui/types';
import { usePullToRefresh } from '@object-ui/mobile';
import { type ListViewVisualization, resolveConditionalFormatting, buildExpandFields, buildExportFileName, resolveAffordance, type SchemaLike, partitionRowsByPredicate, normalizeListViewSchema, isListViewVisualization, rowHeightToDensityMode, mergeFilterNodes, FilterOperatorError, columnIdentity, collectPredicateFieldRefs, collectGroupingFieldRefs, listViewPredicates, PLATFORM_RECORD_COLUMNS, EXPANDABLE_FIELD_TYPES, UNMATERIALIZED_FIELD_TYPES, readObjectSortability, isPlatformSortableField, filterPlatformSortableSort, applyNonGridRowCeiling, type NonGridCeilingResult, resolveNameField, declaredNameField, resolveDependsOnFields, GANTT_CONFIG_SPELLING } from '@object-ui/core';
import { useObjectLabel, useSafeFieldLabel, createSafeTranslation, useDisplayLocale, pickLocalized } from '@object-ui/i18n';
// Two resolvers, two vocabularies — the repo spells the distinction into the
// NAMES (objectui#4167). `resolveInlineI18nLabel` is the spec's own
// `resolveI18nLabel`: it resolves the INLINE per-locale map
// (`{ en: …, 'zh-CN': … }`) that `@objectstack/spec` 17.0.0-rc.6 folded into
// `I18nLabel`, which is what the nested `aria` bag carries. It does NOT accept
// objectui's keyed `{ key, defaultValue, params }` ref — that vocabulary lives
// on the FLAT `schema.ariaLabel` and is resolved by `SchemaRenderer` instead
// (objectui#5134).
import { resolveI18nLabel as resolveInlineI18nLabel, normalizeFilterOperator, PaginationConfigSchema } from '@objectstack/spec/ui';
import type { GroupingConfig } from '@objectstack/spec/ui';
import { resolveInjectedSystemColumns, resolveSearchFieldResolution, type SearchFieldMeta } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';
import { usePermissions } from '@object-ui/permissions';
import { RecordDetailPanel } from '@object-ui/plugin-detail';

/**
 * The `case 'map'` branch below builds an `object-map` schema by flattening
 * `schema.options.map`'s CONTENTS to the top level — one entry per key
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
 * - `ListView.mapFlatten.test.tsx` pins this object's key set against
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
 * Copy the declared keys an author actually wrote onto the flat product,
 * each under its flat spelling — the map's keys by default, the gantt's when
 * that branch passes `GANTT_CONFIG_SPELLING` (`@object-ui/core`, one copy
 * shared with `plugin-view`'s `ObjectView`, objectui#13458).
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
 * The effective map configuration for a list view: the spec's VIEW-LEVEL `map`
 * block merged OVER the legacy `options.map` bag, per key.
 *
 * `map` is `ListMapConfigSchema` (objectstack#9340, consumable here since the
 * `@objectstack/spec` 17.1.0 pin) — a strict, seven-key block that flows into
 * this package's own `ListViewSchema` by reference (it is not in
 * `LIST_VIEW_LOCAL_OVERRIDES`, so `specFieldsExcept` imports it). It was
 * authorable and validated but never read: `case 'map'` forwarded only
 * `schema.options?.map`, so declaring it changed nothing at runtime
 * (objectui#5042).
 *
 * PRECEDENCE — the view-level block wins, per key. Both halves of that are the
 * convention already set by every sibling visualization in this file, not a new
 * rule: `kanban`, `calendar`, `gallery`, `timeline` and `gantt` each spread
 * `schema.options?.<kind>` FIRST and `schema.<kind>` LAST, which is a per-key
 * override in the view-level block's favour. (`tree` and `chart` also put the
 * view-level block first, but with `||` — whole-block replacement rather than a
 * merge. The direction is unanimous across all seven; only the granularity
 * differs, and this follows the five that merge, which are also the five that
 * flatten config into props the way the map branch does.)
 *
 * Both sides go through the same whitelist, so the typed block cannot
 * reintroduce the `style` namespace collision that objectui#5177 closed.
 *
 * NOT a second validation of the seven keys — that reading belongs to
 * `getMapConfig` in `ObjectMap.tsx` and stays there (objectui#5018). This is
 * the whitelist-flatten that already existed, applied to one more source.
 */
function resolveListMapConfig(schema: { map?: unknown; options?: { map?: unknown } }): Record<string, unknown> {
  return {
    ...pickFlatMapConfig(schema.options?.map),
    ...pickFlatMapConfig(schema.map),
  };
}

/**
 * What a list view's `chart` block binds to — resolved ONCE, for both readers.
 *
 * `case 'chart'` below routes on `shape` and reads the fields; the capability
 * gate in `availableViews` reads `resolves`. One function, because the gate's
 * question ("is this chart offerable?") is the render branch's own question
 * ("can I bind this block?") and a second copy of it drifts (objectui#7544;
 * the same class of drift objectui#7495 tracks elsewhere).
 *
 * The gate had NO chart check at all before #7544: `chart` entered `resolvable`
 * only via the "always allow switching back to the schema viewType" leg, so a
 * `grid` view declaring a complete block and whitelisting `['grid', 'chart']`
 * had its own `appearance.allowedVisualizations` filtered to nothing and fell
 * back to `['grid']` (ADR-0047, whitelist ∩ resolvable). Same shape and same
 * fix as `map`'s (objectui#5042, `resolveListMapConfig` above).
 *
 * PRECEDENCE is the render branch's existing one, not a new rule: the
 * view-level block replaces the legacy `options.chart` bag WHOLESALE (`||`) —
 * `chart` and `tree` are the two visualizations in this file that replace
 * rather than merge, and the gate inherits whichever the renderer uses so the
 * two can never judge different configs.
 *
 * `resolves` is the "renders from names the AUTHOR wrote" question: an ADR-0021
 * (objectstack-ai/objectstack#1890) `dataset` with at least one measure in
 * `values`. The dimensions are what it plots BY, and a block may legitimately
 * declare none (a single aggregate), so they are not required here.
 *
 * ⛔ THERE IS NO SECOND SHAPE (objectui#6152 round 15). The pre-ADR-0021 inline
 * axes (`xAxisField` / `categoryField`, `yAxisFields` / `valueField`,
 * `aggregation`) were the legacy leg of this resolver, read in both nestings;
 * every door refuses them by name (the spec's `ListChartConfigSchema` is a
 * strict object of `chartType` / `dataset` / `dimensions` / `values`, and the
 * bag is that block's own partial), so the leg and its `'name'` / `'value'`
 * floors retired with the render path they fed. A block that names no
 * `dataset` is `'unbound'`: the gate never offers a switch into it, and a view
 * whose `viewType` forces it reaches `case 'chart'`'s unbound node, which
 * `ObjectChart` refuses on screen (objectui#8168) instead of plotting a binding
 * nobody wrote.
 */
interface ListChartBinding {
  /** The effective chart block — view-level `chart`, else the `options.chart` bag. */
  config: Record<string, any>;
  /** `'dataset'` when the block names an ADR-0021 `dataset`, else `'unbound'`. */
  shape: 'dataset' | 'unbound';
  /** Whether the block declares everything its shape needs to plot authored names. */
  resolves: boolean;
  /** ADR-0021 semantic dataset, as authored. */
  dataset?: any;
  dimensions: string[];
  values: string[];
}

function resolveListChartBinding(schema: { chart?: unknown; options?: { chart?: unknown } }): ListChartBinding {
  const config: Record<string, any> = (schema.chart || schema.options?.chart || {}) as Record<string, any>;

  if (config.dataset) {
    const dimensions: string[] = Array.isArray(config.dimensions) ? config.dimensions : [];
    const values: string[] = Array.isArray(config.values) ? config.values : [];
    return { config, shape: 'dataset', resolves: values.length > 0, dataset: config.dataset, dimensions, values };
  }

  return { config, shape: 'unbound', resolves: false, dimensions: [], values: [] };
}

/**
 * The list view's props.
 *
 * ## Why there is no `[key: string]: any` here (objectui#4528)
 *
 * There used to be one, and it erased this entire interface. A string index
 * signature puts `string` into `keyof Props`, so `'ref' extends keyof Props` is
 * always true and React's `PropsWithoutRef` takes its `Omit` branch — and
 * `Omit` over a type carrying a string index signature keeps ONLY the index
 * signature. Every declared property below was dropped from the resolved type.
 * Measured on the pre-fix source:
 * `keyof React.ComponentProps< typeof ListView >` was `string | number`, and
 * `React.ComponentProps< typeof ListView >['onRowClick']` was `any`, while this
 * interface went on declaring `(record: Record< string, unknown >) => void`.
 *
 * The same trap, in `packages/components`, is objectui#4422 / PR #4438; this is
 * the sweep of the two packages that issue left unswept.
 *
 * ## The props that were only ever reachable through it
 *
 * `ListView` reads several props it never declared, because the index signature
 * was answering for them — `dataSource`, `onAddRecord`, `onBulkAction`,
 * `onPageSizeChange` are read directly, and `onEdit` / `onDelete` /
 * `onBulkDelete` ride the `{...props}` forward into the active view component
 * (`ObjectGrid` declares all three). They are declared by name below, at the
 * type each one actually lands on, rather than left to an index signature that
 * types them `any` and erases everything around them.
 */
export interface ListViewProps {
  schema: ListViewSchema;
  className?: string;
  /**
   * Data-source adapter. Read directly (`dataSource.find`,
   * `dataSource.getObjectSchema`, `dataSource.onMutation`) and forwarded to the
   * active view component. Typed `any` deliberately: that is what it resolved
   * to before objectui#4528, so declaring it changes what is DECLARED without
   * changing what any call site is held to. Narrowing it to a real adapter type
   * is a separate change with its own consumer sweep.
   */
  dataSource?: any;
  onViewChange?: (view: ListViewVisualization) => void;
  /**
   * Fires with the advanced-filter group the toolbar's `FilterBuilder` emitted.
   *
   * `FilterBuilderRowGroup` because that is what the one call site actually passes: the
   * builder's own `onChange` value, handed straight through beside
   * `setCurrentFilters` — itself `React.useState<FilterBuilderRowGroup>`. Deliberately NOT
   * the filter AST `normalizeFilters` / `buildEffectiveFilter` speak: those run
   * later, on the query-building path, and nothing they produce reaches this
   * callback. A host receives the BUILDER's group verbatim, which is what lets
   * it round-trip back in through `initialFilters`.
   */
  onFilterChange?: (filters: FilterBuilderRowGroup) => void;
  /**
   * Fires with the view's sort after a builder edit, a header click or a
   * "reset to the view's default".
   *
   * `SortItem[]` because every emit crosses exactly one boundary —
   * `emitSortChange` — and both of its legs carry that element type: the array
   * passed in, and `filterPlatformSortableSort`'s return, which is generic in
   * the element (readonly T[] in, T[] out) and so preserves whatever it is
   * given. Normalized-vs-raw therefore does not move the TYPE here; it only
   * decides whether platform-unsortable entries are still present (#6455).
   */
  onSortChange?: (sort: SortItem[]) => void;
  /**
   * Fires with the grouping after a user edit in either grouping editor: the
   * toolbar's Group panel (a level added, changed or removed, or Clear) and the
   * compact toolbar's settings popover. `undefined` when the grouping is
   * cleared.
   *
   * The value is the spec's `GroupingConfig`, the shape `schema.grouping`
   * takes, so a host hands it back through `schema.grouping` unchanged
   * (objectui#11860). Not fired when the list re-reads a changed
   * `schema.grouping` or `groupBy`: that value came from the host.
   */
  onGroupingChange?: (grouping: GroupingConfig | undefined) => void;
  onSearchChange?: (search: string) => void;
  /** Called when the user toggles fields via the Hide Fields popover. */
  onHiddenFieldsChange?: (hidden: string[]) => void;
  /**
   * Called when the user toggles inline record editing. Wiring it is also what
   * offers the wide toolbar's toggle. The toggle switches the grid's edit MODE,
   * which `ListView` keeps in its own state. A host should not persist it into
   * the view's `inlineEdit`: that key is the author's permission, and it folds
   * into `userActions.editInline` (objectui#5144).
   */
  onInlineEditChange?: (next: boolean) => void;
  /** Called when the user resizes/reorders columns in the underlying grid. */
  onColumnStateChange?: (state: { order?: string[]; widths?: Record<string, number> }) => void;
  /**
   * Callback when a row/item is clicked (overrides NavigationConfig).
   *
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
  onRowClick?: (record: Record<string, unknown>, event?: any) => void;
  /** Show view type switcher (Grid/Kanban/etc). Default: false (view type is fixed) */
  showViewSwitcher?: boolean;
  /** Initial user-filter selections to restore (field → values; `_tab` for the active preset). */
  userFilterSelections?: Record<string, Array<string | number | boolean>>;
  /** Fires with the raw user-filter selections whenever the user changes them. */
  onUserFilterSelectionsChange?: (selections: Record<string, Array<string | number | boolean>>) => void;
  /**
   * Initial advanced-filter (FilterBuilder) group to restore at mount, e.g.
   * from a per-user localStorage cache. Read once by the lazy initializer —
   * later prop changes don't override in-flight user edits, so hosts remount
   * (via `key`) when they need to swap the restored value (view switch).
   */
  initialFilters?: FilterBuilderRowGroup;
  /** Initial search term to restore at mount (same one-shot semantics as `initialFilters`). */
  initialSearchTerm?: string;
  /** Called when the user asks for a new record (toolbar "+ New" and the empty-state CTA). */
  onAddRecord?: () => void;
  /** Called with a non-delete bulk action key and the currently selected rows. */
  onBulkAction?: (action: string, records: any[]) => void;
  /** Called when the user picks a different page size in the pager. */
  onPageSizeChange?: (pageSize: number) => void;
  /**
   * Row-level affordances forwarded to the active view component. `ObjectGrid`
   * declares all three with exactly these signatures; they are named here so the
   * hosts that pass them (`ObjectView`, `StudioDesignSurface`) are held to a
   * contract instead of to an index signature.
   */
  onEdit?: (record: any) => void;
  onDelete?: (record: any) => void;
  onBulkDelete?: (records: any[]) => void;
  /**
   * A host-drawn node rendered FIRST in the toolbar row's left group, before
   * the user filters, in a `min-w-0 flex-1` wrapper: it takes the width the
   * right-hand tool cluster leaves (objectui#12440). The console passes its
   * saved-view `ViewTabBar` here, so the view tabs and Filter · Sort ·
   * Display · Search share one row.
   *
   * A HOST prop on the React component, never a schema key: it is a React
   * node a host composes, nothing an author writes, and the list view's own
   * `tabs` key is retired from the protocol (objectui#11073). It is
   * destructured by name so it never rides the `{...props}` forward into the
   * active view component. Absent ⇒ the toolbar row is exactly what it was.
   *
   * A host that passes it carries the view's DESCRIPTION too (objectui#12528):
   * the console's `ViewTabBar` draws it as the active tab's tooltip and ▾ menu
   * header, so the list draws none. Without it the list draws the description
   * itself, as an info control at the start of the toolbar row — never as a
   * row of its own, so the toolbar sits at one height with or without one.
   */
  toolbarLeading?: React.ReactNode;
  /**
   * Whether the grid opens with row numbers in its leading cell — the opening
   * state of the Display control's session-only switch, and what its "Reset to
   * view default" returns to. Default `true`. A HOST prop, never a schema key:
   * the console's Setup app opens its lists without them (objectui#12606), a
   * posture of the console, not of the view.
   */
  defaultRowNumbers?: boolean;
  /**
   * A host-drawn node beside each row's title in the grid (objectui#13330),
   * handed to `ObjectGrid`'s `rowAdornment`: the cell of the object's declared
   * name field when a column shows it, else the first shown column, and the
   * card's title in the card view. Called with the row record; `null` draws
   * nothing. The console's Users list on a managed environment marks a user
   * who holds nothing beyond the baseline with it.
   *
   * A HOST prop, never a schema key: a React node a host composes, nothing an
   * author writes. Only the grid is handed it; the other visualizations and
   * the compact posture draw no title cell to put it beside, and draw none.
   * Absent ⇒ every row is exactly what it was.
   */
  rowAdornment?: (record: Record<string, unknown>) => React.ReactNode;
  /**
   * The VIEW'S OWN hidden fields and row height, for a host that lays the
   * user's own preference over them in `schema` (objectui#12949). The Display
   * control's trigger count and its "Reset to view default" compare these two
   * settings against this value rather than against `schema`, and the reset
   * hands it back through the same doors the controls write through
   * (`onHiddenFieldsChange`, `schema.onDensityChange`), so the user's
   * preference follows.
   *
   * When it is passed, its members are the whole baseline: an absent
   * `hiddenFields` means the view hides nothing, an absent `rowHeight` means
   * the view's default density. Absent ⇒ `schema` is the view's own, exactly
   * as before. A HOST prop, never a schema key: it is the host's split of one
   * composed value into its two sources, nothing an author writes.
   */
  viewDefaults?: Pick<ListViewSchema, 'hiddenFields' | 'rowHeight'>;
  /**
   * Draw the COMPACT posture (objectui#12703): a header with the list's title
   * and record count over two-line rows (the view's first visible column, its
   * second muted below), and none of the toolbar, view tabs, row-number column,
   * pager or record-count bar. The `list-view` page block passes it when the
   * page region it sits in is narrower than half the page
   * (`usePageRegionPosture` from `@object-ui/components`).
   *
   * A HOST prop, never a schema key: the posture is measured by the page
   * renderer, never authored, and `@objectstack/spec` declares no key for it.
   * It applies to a paged grid, the view that draws the rows this component
   * fetches a page of; any other kind (a board, a calendar, a grouped grid)
   * keeps its full rendering. Absent ⇒ the full list, exactly as before.
   */
  compact?: boolean;
}

// Helper to convert FilterBuilder group to ObjectStack AST.
// Accepts both the FilterBuilder vocabulary (camelCase) and the
// @objectstack/spec ViewFilterRule vocabulary (snake_case).

/**
 * The shared value-less set, re-keyed by the spelling
 * `normalizeFilterOperator` folds each member to — the lookup table
 * `convertFilterGroupToAST` reads (objectui#9359).
 *
 * DERIVED, never a second literal: a hand-kept canonical copy beside the
 * exported set is exactly how the two would come to disagree, and the
 * disagreement is invisible — a filter the panel shows and the query does not
 * carry.
 *
 * Why it exists here instead of the export being widened: the exported set
 * states a fact about what the BUILDER'S DROPDOWN draws, and its members are
 * that dropdown's own camelCase ids. Two other layers read it — this function
 * (what the live grid QUERIES) and `app-shell`'s `foldFilterGroupToSpecRules`
 * (what a saved view PERSISTS, already documented as this set PLUS the
 * canonical spellings only that layer sees). Folding the canonical spellings
 * INTO the export would make that layer's deliberate compensation redundant by
 * side effect, in a file nobody is editing. The defect was never a set missing
 * members; it was a reader that forgot to normalize its input, so the reader is
 * what is repaired. Same shape the sibling repair used at the builder's own
 * value-input gate (objectui#9302).
 *
 * `exists` / `notExists` fold to themselves — the spec's vocabulary has no
 * existence operator and `VIEW_FILTER_OPERATOR_ALIASES` deliberately has no row
 * for either — so this set is the same SIZE as the one it derives from.
 */
const VALUELESS_FILTER_BUILDER_OPERATORS_CANONICAL: ReadonlySet<string> = new Set(
  [...VALUELESS_FILTER_BUILDER_OPERATORS].map(op => String(normalizeFilterOperator(op))),
);

/**
 * Is this row COMPLETE without a value — asked of whichever spelling the row
 * actually carries (objectui#9359).
 *
 * The two halves of one predicate used to speak different vocabularies. The
 * value-less short-circuit did a raw `has()` on the exported set's camelCase
 * ids, while the completeness test it falls through to
 * (`isFilterValueComplete`) DOES fold, through this same
 * `normalizeFilterOperator`, to decide arity. So a row spelled `is_null` — the
 * spec's canonical form, which is what `foldFilterGroupToSpecRules` persists
 * and what any spec-side producer emits — missed the short-circuit, landed on
 * `scalar`, had its `value: ''` read as an unfinished row and was DROPPED. The
 * function returned `[]`, the grid queried with no filter at all, and every
 * record came back while the panel showed a filter applied. Silent.
 *
 * That is the same failure objectui#4744 repaired for the dropdown's own
 * spellings — recorded in the exported set's docblock — reached by the other
 * vocabulary. Folding here is one more site joining a fold this file already
 * performs (`mapOperator` already matches case- and underscore-insensitively,
 * and `isFilterValueComplete` folds through the spec's map) rather than a new
 * dialect.
 */
function isValuelessFilterOperator(operator: string): boolean {
  return VALUELESS_FILTER_BUILDER_OPERATORS_CANONICAL.has(String(normalizeFilterOperator(operator)));
}

/**
 * Filter-builder / view operator → filter-AST operator.
 *
 * Every value returned must be a member of the spec's `VALID_AST_OPERATORS`
 * (`@objectstack/spec/data`). That set gates `isFilterAST()`, and a filter it
 * rejects is passed through unconverted and then silently DROPPED by driver-sql
 * — an unfiltered result set with no error (objectstack#3948). Pinned by
 * `filter-operator-ast-parity.test.ts`.
 *
 * Exported for that test. @internal
 */
export function mapOperator(op: string) {
  // The spec's alias table carries the same operator in up to four spellings
  // (`not_equals`, `notEquals`, `notequals`, `ne`), and stored view metadata
  // holds all of them — `saveMeta` persists the authored body verbatim, so the
  // spec's own normalization never reaches the row. Matching them case- and
  // underscore-insensitively collapses that whole class instead of enumerating
  // it: a switch listing spellings by hand had already missed eight.
  switch (op.toLowerCase().replace(/[_\s]/g, '')) {
    case 'equals': case 'eq': return '=';
    case 'notequals': case 'ne': case 'neq': return '!=';
    case 'contains': return 'contains';
    // Canonical in `VIEW_FILTER_OPERATORS` as of @objectstack/spec 17.1.0
    // (objectui#5328), and an explicit arm rather than a `default` fall-through
    // even though the emitted spelling is identical: `icontains` is its own
    // member of `VALID_AST_OPERATORS`, so the raw passthrough happens to be
    // accepted today, and relying on that is the exact slack this file's own
    // header records as how it stopped discriminating in #3641.
    case 'icontains': return 'icontains';
    case 'notcontains': return 'notcontains';
    case 'startswith': return 'startswith';
    case 'endswith': return 'endswith';
    case 'greaterthan': case 'gt': return '>';
    case 'greaterorequal': case 'greaterthanorequal': case 'gte': return '>=';
    case 'lessthan': case 'lt': return '<';
    case 'lessorequal': case 'lessthanorequal': case 'lte': return '<=';
    case 'in': return 'in';
    // `nin`, not `'not in'`: the spaced spelling is in no spec vocabulary, so
    // `isFilterAST()` rejected it and driver-sql skipped the filter entirely.
    // The array case never reached the wire (normalizeFilterCondition expands
    // it below), but a non-array value escaped as an unfiltered query.
    case 'notin': case 'nin': return 'nin';
    // Canonical `VIEW_FILTER_OPERATORS` members with no AST counterpart; the
    // gap here is what returned unfiltered rows for a stored date filter.
    case 'before': return '<';
    case 'after': return '>';
    case 'between': return 'between';
    case 'isnull': return 'isnull';
    case 'isnotnull': return 'isnotnull';
    // objectui#10813 — the empty pair, which the spec lowers to its ONE
    // 「is empty」 operator, `$empty` (objectstack#20446), expanded by the
    // column's declared type on the server. It used to be answered by two arms
    // in `convertFilterGroupToAST` as an equality to `null` — a null-only test
    // that never counted `''` or `[]`, while the SAME rule saved into the view
    // (`foldFilterGroupToSpecRules` persists `is_empty`) ran as `$empty`: one
    // panel, two record sets, depending on whether the view had been saved.
    case 'isempty': return 'isempty';
    case 'isnotempty': return 'isnotempty';
    default: return op;
  }
}

/**
 * Opt-in `FilterBuilder` operators the list toolbar offers — deliberately NONE
 * (objectui#4736).
 *
 * `OPT_IN_OPERATORS` in `@object-ui/components` withholds the operator ids that
 * only the MongoDB-style criteria dialect can carry. This toolbar persists into
 * the other two, and into BOTH of them at once:
 *
 *   - the array/triplet filter AST, via `mapOperator` above, for the live grid;
 *   - `ViewFilterRule[]`, via app-shell's `foldFilterGroupToSpecRules`, when the
 *     user saves the panel's group as a view.
 *
 * Neither vocabulary has a case-insensitive contains or an existence operator,
 * so this surface opts into nothing. Named and passed explicitly rather than
 * omitted at the call site: this constant is the handle
 * `list-offered-operator-expressible-parity.test.ts` reads to compute what the
 * toolbar actually offers, and an inline `extraOperators` added later would
 * otherwise widen the dropdown without the parity test noticing.
 *
 * @internal exported for that test
 */
export const LIST_VIEW_EXTRA_OPERATORS: readonly string[] = [];

/** Every not-in spelling this normalizer expands. See the note at the call site. */
const NOT_IN_SPELLINGS = new Set(['nin', 'not_in', 'notIn', 'notin', 'not in']);

/**
 * Normalize a single filter condition: convert `in`/not-in operators
 * into backend-compatible `or`/`and` of equality conditions.
 * E.g., ['status', 'in', ['a','b']] → ['or', ['status','=','a'], ['status','=','b']]
 */
export function normalizeFilterCondition(condition: any[]): any[] {
  if (!Array.isArray(condition) || condition.length < 3) return condition;

  const [field, op, value] = condition;

  // Recurse into logical groups
  if (typeof field === 'string' && (field === 'and' || field === 'or')) {
    return [field, ...condition.slice(1).map((c: any) =>
      Array.isArray(c) ? normalizeFilterCondition(c) : c
    )];
  }

  if (op === 'in' && Array.isArray(value)) {
    if (value.length === 0) return [];
    if (value.length === 1) return [field, '=', value[0]];
    return ['or', ...value.map((v: any) => [field, '=', v])];
  }

  // `nin` is what mapOperator now emits; the rest are spellings an external
  // caller may still pass, since this function is part of plugin-list's public
  // surface. Accepting all of them keeps the expansion working either way.
  if (NOT_IN_SPELLINGS.has(op) && Array.isArray(value)) {
    if (value.length === 0) return [];
    if (value.length === 1) return [field, '!=', value[0]];
    return ['and', ...value.map((v: any) => [field, '!=', v])];
  }

  return condition;
}

/**
 * Normalize a view's `sort` declaration to SortItem[]. @objectstack/spec
 * ListViewSchema.sort is `string | Array<{ field, order }>` — the TOP-LEVEL
 * value may be a bare string ("name desc"); array entries may be strings
 * (legacy "field desc") or `{ field, order }` objects. Calling `.map` on the
 * bare-string form threw "schema.sort.map is not a function" and crashed the
 * list (spec/renderer shape-mismatch audit, objectui#2578 follow-up).
 */
export function parseSortConfig(sort: unknown): SortItem[] {
  const entries = typeof sort === 'string' ? [sort] : Array.isArray(sort) ? sort : [];
  const items: SortItem[] = [];
  for (const s of entries) {
    if (typeof s === 'string') {
      const parts = s.trim().split(/\s+/);
      if (!parts[0]) continue;
      items.push({
        id: crypto.randomUUID(),
        field: parts[0],
        order: (parts[1]?.toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
      });
    } else if (s && typeof s === 'object' && typeof (s as any).field === 'string') {
      items.push({
        id: crypto.randomUUID(),
        field: (s as any).field,
        order: ((s as any).order as 'asc' | 'desc') || 'asc',
      });
    }
  }
  return items;
}

/**
 * Format an action identifier string into a human-readable label.
 * e.g., 'send_email' → 'Send Email'
 */
function formatActionLabel(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Resolve the spec `AddRecordConfigSchema.position` (`ui/view.zod.ts`:
 * `top | bottom | both`) to the two render slots. A binary ternary used to
 * collapse `both` to `top`, so the bottom button never rendered (#2941).
 *
 * An absent or unrecognized value keeps this renderer's historical `top`
 * placement. (The spec's own default is `bottom`; spec-parsed metadata
 * arrives with it materialized, but raw stored JSON predating the spec
 * default relied on `top` — moving it is a UX change out of scope here.)
 *
 * Exported for the spec-parity test, which fails the moment the spec's
 * position vocabulary and this mapping drift in either direction.
 */
export function resolveAddRecordPlacement(position: unknown): { top: boolean; bottom: boolean } {
  switch (position) {
    case 'bottom':
      return { top: false, bottom: true };
    case 'both':
      return { top: true, bottom: true };
    case 'top':
    default:
      return { top: true, bottom: false };
  }
}

/**
 * The date axis a timeline view renders on.
 *
 * ONE resolution, consumed by both read-sites that decide the timeline's fate:
 * the capability gate (may this view offer the Timeline visualization?) and the
 * timeline render branch (which field does it bucket by?). Those two used to
 * carry separate, unequal source lists, and the gate was the wider of the pair —
 * it accepted `options.calendar.startDateField` as a timeline-resolvable axis
 * while the render branch never read calendar config at all. A view that binds
 * its dates under `calendar` therefore got the Timeline option offered and then
 * bucketed every record into "No date" (objectui#3129), which is exactly the
 * shape the report isolated: the same fields render fine in Calendar and Gantt.
 *
 * A calendar binding IS a legitimate timeline axis in this product, not a
 * lenient fallback bolted on here: the capability gate has always said so, and
 * `InterfaceListPage` derives a timeline's default binding from the very same
 * `defaultCalendarFromObject` helper it uses for calendars. What was missing is
 * that one of the two read-sites never honoured the promise the other made.
 *
 * Both nestings are read at each level: the spec-authored `schema.timeline` /
 * `schema.calendar` and the legacy `schema.options.*` twin that app-shell's
 * object pages still emit. Each by its spec key only. The pre-#2231 `dateField`
 * alias for `startDateField` had a rung here until objectui#6152 round 14
 * retired it: every list-view door refuses it by name on all four blocks, and
 * the calendar branch already ignored it (objectui#8355), so one stored row
 * could draw a Timeline on a key its Calendar dropped.
 *
 * Exported for the regression suite, which pins each authoring shape.
 */
export function resolveTimelineDateBinding(schema: any): {
  startDateField?: string;
  endDateField?: string;
  titleField?: string;
} {
  const sources = [
    schema?.timeline,
    schema?.options?.timeline,
    schema?.calendar,
    schema?.options?.calendar,
  ];
  const pick = (read: (src: any) => unknown): string | undefined => {
    for (const src of sources) {
      if (!src) continue;
      const value = read(src);
      if (typeof value === 'string' && value) return value;
    }
    return undefined;
  };
  return {
    startDateField: pick((s) => s.startDateField),
    endDateField: pick((s) => s.endDateField),
    titleField: pick((s) => s.titleField),
  };
}

/**
 * Normalize an array of filter conditions, expanding `in`/`not in` operators
 * and ensuring consistent AST structure.
 */
export function normalizeFilters(filters: any[]): any[] {
  if (!Array.isArray(filters) || filters.length === 0) return [];
  return filters
    .map(f => Array.isArray(f) ? normalizeFilterCondition(f) : f)
    .filter(f => Array.isArray(f) && f.length > 0);
}

/**
 * Merge the three filter sources a list can have — the view's own `filter`, the
 * filter-panel group, and the per-field user filters — into one AST node.
 *
 * ONE definition on purpose. The data fetch and the export used to carry
 * verbatim copies of this, and those two decide, respectively, **what the user
 * sees** and **what they download**. Two copies that must agree, where a
 * divergence is a file that silently disagrees with the screen — the same shape
 * of bug that had already bitten the adapter, whose duplicated filter-shape
 * check drifted apart unnoticed (#3072).
 *
 * Returns `undefined` when nothing is active, so callers can skip `$filter`
 * entirely rather than sending an empty array.
 *
 * A MongoDB-style object `schema.filter` used to be dropped here (`.length` is
 * `undefined` on an object, so the guard read false) and the list returned every
 * record. An earlier version of this comment called that unreachable, on the
 * grounds that nothing in the repo hands a list view an object filter. That was
 * wrong: `ObjectView` passes `mergedFilters` straight into this schema's
 * `filter`, and its last fallback was `table.defaultFilters`, declared
 * `Record<string, any>` (retired since objectui#12030; `table.filter` takes
 * the same object). `toFilterNode` now converts it instead.
 */
export function buildEffectiveFilter(
  baseFilter: unknown,
  currentFilters: FilterBuilderRowGroup,
  userFilterConditions: any[],
): any[] | Record<string, any> | undefined {
  const userFilter = convertFilterGroupToAST(currentFilters);
  return mergeFilterNodes(
    baseFilter,
    userFilter.length > 0 ? userFilter : undefined,
    // Normalize the per-field conditions (expands `in` into an `or` of `=`),
    // each of which is already its own node.
    ...normalizeFilters(userFilterConditions),
  );
}

/**
 * What `ListView` applies in place of a held user filter it withholds
 * (`appliedFilters` / `appliedUserFilterConditions`, objectui#10512). Module
 * constants, so every render hands the fetch effect the same identity.
 */
const WITHHELD_FILTER_GROUP: FilterBuilderRowGroup = { id: 'root', logic: 'and', conditions: [] };
const WITHHELD_USER_FILTER_CONDITIONS: unknown[] = [];

export function convertFilterGroupToAST(group: FilterBuilderRowGroup): any[] {
  if (!group || !group.conditions || group.conditions.length === 0) return [];

  const conditions = group.conditions
    .filter(c => {
      // A value-less OPERATOR is complete without a value — the builder draws
      // no value input for it, so "no value" is the row's finished state
      // (objectui#4744). Read from `@object-ui/components`, which is the thing
      // that decides it; the two-operator literal that used to stand here
      // listed `isEmpty`/`isNotEmpty` only, so a fresh `Is null` row — seeded
      // `value: ''` by `addCondition`, and left that way because the operator
      // dropdown preserves `value` — was dropped as unfinished. The grid then
      // applied NO filter while the panel showed one.
      //
      // Read through `isValuelessFilterOperator`, which folds the row's
      // spelling before the lookup (objectui#9359): the set's members are the
      // dropdown's camelCase ids, so a stored `is_null` — the canonical form a
      // saved view carries — used to miss this short-circuit entirely and be
      // dropped by the completeness test below, which folds. Same silent
      // outcome as the #4744 defect, reached by the other vocabulary.
      if (isValuelessFilterOperator(c.operator)) return true;
      // Skip incomplete rows (no value entered yet). Emitting `[field, op, '']`
      // would be a silently-wrong filter (matches only empty) rather than
      // "no filter", excluding all rows. Matches groupToCondition in
      // datasetFilterCondition.ts (#1964).
      //
      // Read from `@object-ui/components` rather than spelled out here
      // (objectstack#8815): the local predicate this replaces was blind to the
      // operator's ARITY, so a `between` row with one bound typed
      // (`["2024-01-01", ""]` — an array of length 2) counted as complete and
      // this function emitted a range with an empty end. The server refuses
      // that outright (`400 INVALID_FILTER`) and the whole view fails to load,
      // so the row the user half-filled took down the rows they had already
      // filtered. The builder decides when one of its rows is finished; this
      // asks it.
      return isFilterValueComplete(c.operator, c.value);
    })
    .map(c => {
      // objectui#10813 — `is_empty` / `is_not_empty` no longer have arms of
      // their own here. They were answered as `[field, '=' | '!=', null]`, a
      // null test; they now take the value-less path below like `is_null`, and
      // `mapOperator` emits the spec's `isempty` / `isnotempty`, which the
      // spec lowers to `$empty` — the same operator a saved view's `is_empty`
      // rule already ran as. The fold objectui#9359 added for those two arms
      // lives on in `isValuelessFilterOperator` and in `mapOperator`'s
      // case- and underscore-insensitive match, so every spelling of the pair
      // still lands on one node.
      //
      // A value-less row's third slot is emitted as `null` rather than as
      // whatever `c.value` still holds: the operator dropdown PRESERVES the
      // previous operator's value, so an `Is null` row can carry a leftover
      // `'abc'` the user can no longer see or edit. The spec's own lowering
      // (`convertComparison`, `@objectstack/spec/data`) ignores the third slot
      // for `isnull`/`isnotnull` — it emits `{ [field]: { $null: true|false } }`
      // — so `null` is inert on the wire and keeps the emission a function of
      // the operator alone. The spec discards the slot for `isempty` /
      // `isnotempty` too (`parseFilterAST(['x', 'isempty', null])` is
      // `{ x: { $empty: true } }`).
      // The same fold as the short-circuit above (objectui#9359): a row kept
      // BECAUSE it is value-less must also be EMITTED as value-less, or the
      // canonical spelling would carry its stale `value` into the third slot
      // while the camelCase one carried `null` — one operator, two nodes.
      // `mapOperator` already collapses case and underscores, so `is_null`
      // lands on the same `isnull` its dropdown twin does.
      if (isValuelessFilterOperator(c.operator)) {
        return [c.field, mapOperator(c.operator), null];
      }
      return [c.field, mapOperator(c.operator), c.value];
    });

  // Normalize in/not-in conditions for backend compatibility
  const normalized = normalizeFilters(conditions);
  if (normalized.length === 0) return [];
  if (normalized.length === 1) return normalized[0];
  
  return [group.logic, ...normalized];
}

/**
 * Evaluate conditional formatting rules against a record.
 * Returns a CSSProperties object for the first matching rule, or empty object.
 * Supports all three historical rule shapes (spec `{ condition, style }`,
 * ObjectUI `{ expression, … }`, native `{ field, operator, value, … }`).
 *
 * Thin wrapper over `@object-ui/core`'s `resolveConditionalFormatting`, which
 * evaluates every predicate on the canonical CEL engine (with a legacy-dialect
 * fallback) so a list view speaks the same expression dialect the server does
 * (issue #1584 / ADR-0058). Kept exported for back-compat with consumers that
 * evaluate formatting outside the ListView component.
 *
 * @param scope  Extra top-level scope (the host predicate scope) bound
 *               alongside the row, so `features.*` / `current_user.*`
 *               conditions resolve as they do on grid rows / kanban cards.
 * @param fields The object's field definitions, so a rule comparing a relation
 *               field sees the stored foreign key rather than the record
 *               `$expand` substituted for it (see `toPredicateRecord`).
 */
export function evaluateConditionalFormatting(
  record: Record<string, unknown>,
  rules?: ListViewSchema['conditionalFormatting'],
  scope?: Record<string, unknown>,
  fields?: unknown,
): React.CSSProperties {
  return resolveConditionalFormatting(record, rules as any, scope, fields as never) as React.CSSProperties;
}

// Default English translations for fallback when I18nProvider is not available.
//
// Every row whose key the `en` pack also defines must stay byte-identical to it,
// or the same control is labelled one way here and another in the console.
// Enforced since objectui#4401 by
// `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx`.
//
// Exported for that gate — the same reason
// `DETAIL_DEFAULT_TRANSLATIONS` and `COLLAB_DEFAULT_TRANSLATIONS` are exported
// from their packages. The gate cannot live in `@object-ui/i18n` (that would
// invert the dependency, see `gantt-count-interpolation-4157.test.ts`), so it
// reads this map from downstream instead of parsing this file's text.
export const LIST_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'list.recordCount': '{{count}} records',
  'list.recordCount_one': '{{count}} record',
  'list.recordCount_other': '{{count}} records',
  'list.noItems': 'No items found',
  'list.noItemsMessage': 'There are no records to display. Try adjusting your filters or adding new data.',
  // First-run (truly empty, no filter/search) vs filtered-to-empty. Showing
  // "adjust your filters" to a brand-new user with nothing to adjust is wrong.
  'list.firstRunTitle': 'Nothing here yet',
  'list.firstRunMessage': 'Create your first record to get started.',
  'list.noMatches': 'No matching records',
  'list.noMatchesMessage': 'No records match your current filters or search. Try adjusting or clearing them.',
  // Emptied by the VIEW's own declared filter, with no user filter or search
  // applied (objectui#11687): the "your filters" wording above would name
  // filters the user never set.
  'list.viewFilterNoMatchesMessage': 'No records match this view’s filter.',
  'list.loading': 'Loading records…',
  // Load FAILED (network / server error) — distinct from empty. Offer retry.
  'list.loadErrorTitle': 'Couldn\u2019t load records',
  'list.loadErrorMessage': 'Something went wrong while loading this data. Check your connection and try again.',
  // Load DENIED — the server answered, with a 403/401. Blaming the network
  // here sends users chasing connectivity ghosts.
  'list.loadErrorForbiddenTitle': 'You don’t have access',
  'list.loadErrorForbiddenMessage': 'You don’t have permission to view these records. Contact your administrator if you think you should have access.',
  'list.loadErrorUnauthorizedTitle': 'Sign in required',
  'list.loadErrorUnauthorizedMessage': 'Your session has expired or you are signed out. Sign in again to view these records.',
  // Load REJECTED — the server answered 400: the request itself is malformed
  // (usually a stored filter it cannot parse). Retrying resends the same bad
  // request, so the copy points at the filter instead of the network.
  'list.loadErrorRejectedTitle': 'This view’s query was rejected',
  'list.loadErrorRejectedMessage': 'The server could not process this view’s filter or query options. Clearing the filters usually fixes it; if the view is saved this way, an administrator needs to correct it.',
  // Load DENIED BY THE OBJECT — the server answered 404 `OBJECT_API_DISABLED`
  // or 405 `OBJECT_API_METHOD_NOT_ALLOWED`. This is not "no records", not a
  // permission grant anyone can give, and not something a retry can change:
  // the object's `enable` block withholds the API, for every user, permanently.
  // Say that, because the alternative reads as an empty list (objectui#4408).
  'list.loadErrorApiDisabledTitle': 'This object isn’t available through the API',
  'list.loadErrorApiDisabledMessage': 'This page can’t load its records because the object is not exposed through the API. That is a setting on the object itself, not a permission — an administrator has to enable API access for it before this page can work.',
  'list.retry': 'Retry',
  // objectui#10881 — the refusal of a grouped grid over a data source that
  // cannot answer the group header query. Borrowed from the `grid.*`
  // namespace: `ObjectGrid` refuses with the same sentence, and one refusal
  // should not get two translations that can drift apart.
  'grid.grouping.needsHeaderQuery':
    'This view is grouped, but its data source does not implement queryGroupHeaders, so the groups cannot be counted. Remove the grouping to show the records.',
  // The bare NOUN, for the search button's tooltip. It is deliberately NOT the
  // input placeholder: that is `table.search` below (objectui#4375).
  'list.search': 'Search',
  // Placeholder of the search popover's input. Borrowed from the `table.*`
  // namespace rather than minted as `list.searchPlaceholder`, on the same
  // reasoning as `detail.recordDetail` below: `table.search` is already THE
  // search-input placeholder key in this repo — `data-table`, `RecordPickerDialog`
  // and `PeoplePicker` all render it — and one control should not get two
  // translations that can drift apart in a locale.
  //
  // Until objectui#4375 this read `t('list.search') + '...'`, so the ellipsis was
  // a literal concatenated in code: it stayed ASCII in all ten locales (on a
  // screen where objectui#3878 had converged everything else on U+2026), and no
  // pack could opt out of it — sharpest in `ar`, which got a left-to-right run
  // appended to right-to-left text. As a pack value the ellipsis is the ar
  // pack's own (`بحث…`) and the bidi algorithm places it at the logical end.
  //
  // Byte-identical to `en`, like every entry here — a provider-less host renders
  // THIS copy, so a divergence would make the two paths disagree on one control.
  'table.search': 'Search…',
  'list.filter': 'Filter',
  'list.filterRecords': 'Filter Records',
  // The Filter trigger's accessible name while filters are active: its
  // `aria-label` replaces the count badge in the name, so the count rides
  // here (objectui#12500). A count family, like `list.recordCount`.
  'list.filterActive': 'Filter, {{count}} active',
  'list.filterActive_one': 'Filter, {{count}} active',
  'list.filterActive_other': 'Filter, {{count}} active',
  'list.sort': 'Sort',
  'list.sortRecords': 'Sort Records',
  'list.sortByIdSuffix': '(by ID)',
  // objectui#12528 — the one line under the sort rows while the current sort
  // names a linked column (shown with the `(by ID)` suffix above).
  'list.sortRelationalPicked': 'A linked column sorts by the stored ID, not the name shown.',
  // objectui#4294 — the remedy sentence must match `en`'s byte for byte. It is
  // this copy, not the pack, that renders on a provider-less host (and in this
  // package's own tests), so a pack-only reword would leave the old advice —
  // "add a formula field" — on the exact surface the card is about.
  //
  // That byte-identity is no longer hand-held: objectui#4401 generalized
  // #3440's collaboration gate to this table, so a pack-only reword now fails
  // in `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx`. (What
  // #4294 recorded here — that `check:i18n-keys` judges inline
  // `t(key, { defaultValue })` options and never a `createSafeTranslation`
  // table — is still true of that script; it is simply no longer the only
  // thing looking.)
  'list.sortRelationalHint':
    'Columns that link to another record are not listed: they can only be sorted by the stored ID, not by the name shown in the cell. To sort by that name, denormalize it onto this object as a stored field, written when the source changes, and sort by that. Not a formula field: it is virtual, so no column is stored for it and the server refuses to sort by one.',
  // objectui#4396 — the sort popover's reset action. Read bare
  // (`t('list.resetSortToDefault')`, no inline `defaultValue`), so before this
  // row a provider-less host rendered the raw key as the menu item's label.
  'list.resetSortToDefault': 'Reset to view default',
  'list.group': 'Group',
  'list.groupBy': 'Group By',
  'list.export': 'Export',
  'list.exportAs': 'Export as {{format}}',
  'list.color': 'Color',
  'list.rowColor': 'Row Color',
  'list.colorByField': 'Color by field',
  'list.clear': 'Clear',
  'list.none': 'None',
  'list.hideFields': 'Hide fields',
  'list.showAll': 'Show all',
  'list.pullToRefresh': 'Pull to refresh',
  'list.refresh': 'Refresh',
  'list.refreshing': 'Refreshing…',
  'list.dataLimitReached': 'Showing first {{limit}} records. More data may be available.',
  'list.addRecord': 'Add record',
  'list.tabs': 'Tabs',
  'list.allRecords': 'All Records',
  'list.share': 'Share',
  'list.print': 'Print',
  // objectui#4462 — the Print button's tooltip/aria sentence. Borrowed from
  // `common.*` (like the `table.*`/`grid.*`/`detail.*` rows here) because the
  // identical sentence labels the report viewer's Print button and the
  // dashboard's print action: one control semantic, one translation. Byte-
  // identical to `en.common.printDialogHint` — enforced by
  // `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx`.
  'common.printDialogHint': 'Opens your browser’s print dialog (not a PDF export)',
  'list.hideFieldsTitle': 'Hide Fields',
  'table.rowsPerPage': 'Rows per page',
  'grid.toolbar.densityMode': 'Density',
  'grid.toolbar.densityCompact': 'Compact',
  'grid.toolbar.densityComfortable': 'Comfortable',
  'grid.toolbar.densitySpacious': 'Spacious',
  'grid.toolbar.densityCycleHint': '{{label}} (click to cycle)',
  'grid.toolbar.densityCycleShortHint': 'Click to cycle',
  // The toolbar's Display control (objectui#12423).
  'list.display': 'Display',
  'list.layout': 'Layout',
  'list.rowNumbers': 'Row numbers',
  'list.resetToViewDefault': 'Reset to view default',
  // Heading of the record-detail overlay this view opens when a child view's
  // row is clicked (objectui#3426). Borrowed from the `detail.*` namespace
  // rather than minted as `list.recordDetail`: `NavigationOverlay` already
  // resolves `detail.recordDetail` for hosts that pass no title, and one
  // heading on one control should not get two translations that can drift
  // apart. Both entries must exist HERE too — a provider-less host (a
  // standalone list, this package's own tests) never reaches the locale packs.
  'detail.recordDetail': 'Record Detail',
  'detail.recordDetailWithLabel': '{{label}} Detail',
};

/**
 * Safe wrapper for useObjectTranslation that falls back to English defaults
 * when I18nProvider is not available (e.g., standalone usage outside console).
 *
 * Delegates to `@object-ui/i18n`'s `createSafeTranslation`. The local copy
 * this replaced wrapped the hook in try/catch — the very thing the comment on
 * `useListViewObjectLabel` below warns against (objectui#2879).
 *
 * Exported for this package's `ObjectGallery` only (objectui#12217), which
 * draws `ListEmptyState`'s `list.*` copy when no `ListView` is around it; the
 * package barrel does not re-export it.
 */
export const useListViewTranslation = createSafeTranslation(
  LIST_DEFAULT_TRANSLATIONS,
  'list.recordCount',
);

/**
 * Thin selector over useObjectLabel. The underlying hook is provider-safe
 * (optional context + global i18n fallback), so no try/catch — wrapping a
 * hook call in try/catch violates rules-of-hooks: a throw after other hooks
 * ran would desync hook order on the next render (same fix as
 * fields#useFieldLabel, objectui#2595).
 */
function useListFieldLabel() {
  const { fieldLabel, actionLabel, objectLabel } = useObjectLabel();
  return { fieldLabel, actionLabel, objectLabel };
}

/**
 * The page size a PAGED list falls back to when no usable one is declared: the
 * flat grid view, which this component pages on the server (`paginate`), so
 * the window it fetches is the page on screen and the size it hands the child
 * grid's pager (objectui#9853, ruling 5824040487, structure B: "page size"
 * means one page only where there is a pager).
 *
 * READ from `@objectstack/spec`, not restated, the same read `ObjectGrid`
 * makes: the protocol's pagination config declares `pageSize` with a default,
 * and parsing an empty config is the spec's own way of saying what an
 * undeclared member means. ⚠️ There is no local number behind the read: if a
 * future spec stops declaring a positive default, this throws at module load
 * rather than substituting a number nobody declared.
 */
function readSpecDisplayPageSize(): number {
  const declared: unknown = PaginationConfigSchema.parse({}).pageSize;
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared <= 0) {
    throw new Error(
      '[ObjectUI] ListView: @objectstack/spec no longer declares a positive default '
      + `for pagination.pageSize (read ${String(declared)}); a paged list has no display `
      + 'page size to fall back to.',
    );
  }
  return declared;
}
const DEFAULT_LIST_DISPLAY_PAGE_SIZE = readSpecDisplayPageSize();

/**
 * The `$top` of the ONE unpaged fetch a list view makes when no usable page
 * size is declared: every view this component does not page on the server
 * (`paginate` is false), which is every kind but the flat grid, plus a grouped
 * grid's window. Those views have no pager, so rows past this number are not
 * reachable at all (`dataLimitReached` says so).
 *
 * A fetch batch, ⛔ not a page size (objectui#9853, ruling 5824040487,
 * structure B): its value is kept, and it does not follow the display default,
 * so no view silently loses reachable records when the protocol's page size
 * moves. A DECLARED `pagination.pageSize` still sizes this fetch on every
 * view but a windowed calendar; only the undeclared fallback is split by kind.
 * A calendar with a start date bound walks its visible days in steps of this
 * batch whatever page size is declared, so a declared size no longer sizes its
 * fetch (`calendarWindowed`, objectui#12081).
 *
 * Exported for pins that assert "the fetch batch" rather than its value
 * (objectui#9853, ruling record 5909000462); the package index does not
 * re-export it.
 */
export const DEFAULT_LIST_FETCH_BATCH_SIZE = 100;

/**
 * The view's kanban block, as the board branch reads it: the spec's block over
 * the legacy `options.kanban` bag, per key (objectui#10380). One reading for the
 * branch and for `kanbanLanesPaged`, so the lane the board is built on and the
 * lane its query is gated on are one answer.
 */
function kanbanBlockOf(schema: ListViewSchema): Record<string, any> {
  return { ...((schema.options as any)?.kanban || {}), ...((schema as any).kanban || {}) };
}

/**
 * The board's lane field: the block's `groupByField`, else the object's
 * declared lifecycle (ADR-0085 `stageField`, through the shared detector).
 */
function kanbanLaneFieldOf(schema: ListViewSchema, objectDef: unknown): string | undefined {
  return kanbanBlockOf(schema).groupByField || detectStatusField(objectDef as any) || undefined;
}

/**
 * How many of the view's columns a card carries when the kanban block names
 * no card fields of its own (objectui#12619).
 */
export const KANBAN_VIEW_CARD_FIELD_COUNT = 2;

/**
 * The card fields a board takes from the VIEW's columns (objectui#12619): the
 * first {@link KANBAN_VIEW_CARD_FIELD_COUNT} that are not the card's title,
 * its lane or its owner, by field name.
 *
 * The board used to be handed the view's columns whole, as entries — and a
 * view's columns are `{ field }` objects as often as names, which the card
 * reads as field names, so a card over `[{ field: 'name' }, { field:
 * 'account' }, …]` drew nothing below its title. Names only, here, through the
 * same `columnIdentity` the grid and this view's `$select` read a column by.
 * The kanban block's own `columns` is the author's card list and is not cut.
 */
function kanbanCardFieldsFromView(columns: readonly unknown[], skip: ReadonlyArray<string | undefined>): string[] {
  const skipped = new Set(skip.filter((name): name is string => !!name));
  const out: string[] = [];
  for (const column of columns) {
    const name = columnIdentity(column);
    if (!name || skipped.has(name) || out.includes(name)) continue;
    out.push(name);
    if (out.length === KANBAN_VIEW_CARD_FIELD_COUNT) break;
  }
  return out;
}

/**
 * The record field holding a record's owner, when the object has one
 * (objectui#12619) — the board shows the owner's avatar off it. Read from the
 * spec's own declaration, never guessed: `resolveInjectedSystemColumns` answers
 * whether the object's ownership model gives its records an owner, and
 * `SystemFieldName.OWNER_ID` names the field the platform injects for it. The
 * object definition has to declare that field too, or there is nothing to read.
 */
/**
 * Does a `search` on this object resolve to at least one field? (objectui#12966)
 *
 * The platform refuses a non-blank `search` over an object whose resolved
 * search set is empty with `400 INVALID_FIELD` (`param: 'search'`) — a
 * junction object of two lookups and a composed formula title is the common
 * shape — so the toolbar does not offer a quick-search box there.
 *
 * The answer is the spec's `resolveSearchFieldResolution`, run over the inputs
 * the engine gives it: the object's field map with every `internal: true`
 * field left out (the engine never scans one) and the OBJECT's declared
 * `searchableFields`. ⛔ No second list of searchable types lives here.
 * `displayField` is not passed: it orders the auto-default set and never
 * changes its membership. The record pickers ask the same question through
 * `@object-ui/fields`' `objectResolvesSearch`, which is this function's twin.
 *
 * The VIEW's `searchableFields` is not an input: the toolbar sends it as the
 * `$searchFields` override, which the server intersects with the set resolved
 * here and refuses outside it, so it narrows a non-empty set and can never make
 * an empty one searchable.
 *
 * `undefined` = the schema is not known (none, or no field map): the toolbar
 * keeps the box, as it did before.
 */
function objectResolvesSearch(objectDef: unknown): boolean | undefined {
  if (!objectDef || typeof objectDef !== 'object') return undefined;
  const def = objectDef as { fields?: unknown; searchableFields?: unknown };
  const raw = def.fields;
  if (!raw || typeof raw !== 'object') return undefined;
  // Keyed by name or an array of named definitions — the two shapes this file
  // already reads `objectDef.fields` in.
  const entries: Array<[unknown, unknown]> = Array.isArray(raw)
    ? raw.map((f) => [(f as { name?: unknown } | null)?.name, f])
    : Object.entries(raw as Record<string, unknown>);
  const fields: Record<string, SearchFieldMeta> = {};
  for (const [name, meta] of entries) {
    if (typeof name !== 'string' || !meta || typeof meta !== 'object') continue;
    if ((meta as { internal?: unknown }).internal === true) continue;
    fields[name] = meta as SearchFieldMeta;
  }
  const searchableFields = Array.isArray(def.searchableFields)
    ? def.searchableFields.filter((f): f is string => typeof f === 'string')
    : undefined;
  return resolveSearchFieldResolution({ fields, searchableFields }).allowed.length > 0;
}

function kanbanOwnerFieldOf(objectDef: any): string | undefined {
  if (!objectDef || typeof objectDef !== 'object') return undefined;
  if (!resolveInjectedSystemColumns(objectDef).owner) return undefined;
  return objectDef.fields?.[SystemFieldName.OWNER_ID] ? SystemFieldName.OWNER_ID : undefined;
}

/**
 * The rows of one `find` answer, in every envelope this view's fetch accepts: a
 * bare array, or an object carrying `data`, `records` or `value`. One reader
 * for the single window and for the calendar's date-window walk
 * (objectui#12081), so the two accept the same answers.
 */
function readListRows(results: unknown): any[] {
  if (Array.isArray(results)) return results;
  if (results && typeof results === 'object') {
    if (Array.isArray((results as any).data)) return (results as any).data;
    if (Array.isArray((results as any).records)) return (results as any).records;
    if (Array.isArray((results as any).value)) return (results as any).value;
  }
  return [];
}

/**
 * What the contract admits as a page size. The spec's view pagination config
 * declares the member a POSITIVE INTEGER with a default, and the spec's own
 * suite pins the refusals under the names `should reject zero pageSize` and
 * `should reject negative pageSize`; the `limit` that this package's
 * `ElementDataSourceMapping` lowers `pagination.pageSize` into is declared
 * positive as well. So `0` is not a spelling whose meaning this renderer may
 * choose — it is a value the contract already refuses.
 */
function isUsablePageSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The ONE resolver for this view's page size, for the reason objectui#9853
 * gave when it landed the same shape on `ObjectGrid`: one resolver at every
 * entry is what keeps the answer single.
 *
 * Before objectui#9897 this was a bare `??` chain, and `??` rejects only
 * `null` and `undefined` — so an authored `pageSize: 0` was not nullish and
 * survived as a real page size, reaching every consumer of the resolved value.
 * Measured in this renderer over a twelve-row fixture rather than inferred:
 * `$top: 0` went out on the wire, the data source was asked for nothing,
 * nothing came back, and the view drew its EMPTY STATE — the child grid never
 * rendered at all, so there was no table, no record-count bar and no pager,
 * and nothing on screen named the cause. A negative goes out the same way
 * (`$top: -10`). A non-integer is worse than silent: `25.5` reached the wire,
 * became the child grid's page size, and turning the page asked for a
 * fractional `$skip`.
 *
 * Picks by PRECEDENCE first — a size chosen at runtime through the
 * rows-per-page control outranks the authored one — and validates the winner
 * once. The `??` here is deliberate and is not the defect: it picks by
 * PRESENCE, so an explicit `0` is SEEN by the guard instead of being skipped
 * by falsiness. Skipping it is what a `||` would do, and quietly substituting
 * a number the author never wrote is the quieter half of this same defect.
 *
 * ⚠️ The refusal is FAIL-SOFT on purpose. Throwing would take out the whole
 * list over one declaration, which is a worse outcome than the defect. The
 * value is dropped, this view's own default is used, and
 * `describeRefusedPageSize` states it once through the channel this component
 * already uses for "you declared it, the renderer dropped it". ⛔ Not a silent
 * clamp: without the loud half this is a substitution the author cannot see.
 */
function resolvePageSize(chosen: unknown, authored: unknown, fallback: number): number {
  const candidate = chosen ?? authored;
  return isUsablePageSize(candidate) ? candidate : fallback;
}

/**
 * The diagnostic half. `null` means "nothing to say" — an absent key is not a
 * mistake, and a usable page size is not either, so the message is CONDITIONAL
 * and the silence controls in the pin are what keep it from being an always-on
 * marker that states nothing.
 *
 * ⛔ NOT a second guard: the predicate lives once, in `isUsablePageSize`, and
 * this reads it. Two predicates would be free to drift, and the drift would be
 * invisible — a value refused by one and admitted by the other.
 */
function describeRefusedPageSize(
  chosen: unknown,
  authored: unknown,
  objectName: unknown,
  paged: boolean,
): string | null {
  const candidate = chosen ?? authored;
  if (candidate === undefined || candidate === null) return null;
  if (isUsablePageSize(candidate)) return null;
  const where =
    typeof objectName === 'string' && objectName ? `list-view on ${objectName}` : 'list-view';
  const fellBackTo = paged
    ? `its default page size (${DEFAULT_LIST_DISPLAY_PAGE_SIZE})`
    : `its default fetch batch (${DEFAULT_LIST_FETCH_BATCH_SIZE}), since this view does not page`;
  return (
    `[ObjectUI] ListView pagination: ${where} declared pageSize: ${String(candidate)}, `
    + 'which is not a positive integer. A page size must be a positive integer '
    + '(the spec refuses zero and negative values), so it was ignored and this '
    + `list fell back to ${fellBackTo}.`
  );
}

/**
 * Field-level READ for the field lists the toolbar offers: the Filter panel's
 * (`filterFields`, objectui#11925), the Sort picker's (`sortFields`,
 * objectui#11943), and since objectui#11984 the list the hide-fields popover,
 * the Group editor and the Row color select share (`allFields`, which the
 * compact toolbar's View settings popover reads too) and the user-filter
 * chips (`filterElements`). The first two lists used to disagree:
 * objectui#11925 wrote this predicate inside the filter memo, so the sort
 * picker never asked it. It now lives once, here, and every list calls it.
 * Which lists exist is re-derived by the enumeration pin in
 * `ListView.fieldListRead-11984.test.tsx`, not by this comment.
 *
 * It is the same call the column gate (`effectiveFields`) makes,
 * `perms.checkField(objectName, field, 'read')`, behind the same gate: until
 * the permission answer has loaded, or with no object to ask about, it answers
 * true. An unanswered policy filters nothing, exactly as the columns defer.
 *
 * A plain function of the permission value and the object name rather than a
 * hook. Every memo that calls it already depends on those two, so none depends
 * on a function's identity (AGENTS.md #10).
 */
function canReadField(
  perms: ReturnType<typeof usePermissions>,
  objectName: string | undefined,
  field: string,
): boolean {
  return !perms?.isLoaded || !objectName || perms.checkField(objectName, field, 'read');
}

/** The item a value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — the toolbar's "Color by field" and the record-count bar's
 * rows-per-page selector, drawn with the shared `Select`, the control the rest
 * of the console picks with. Both used to be browser-native `<select>`
 * elements. What a pick writes is unchanged: `onPick` receives the picked
 * option's own value, the string the native control's `change` carried, and
 * each caller turns it into what it wrote before. Re-picking the current
 * option writes nothing, as it did there.
 *
 * "Color by field" is the twin of `ViewSettingsPopover`'s `ColorFieldPicker`
 * (the compact toolbar's copy of this popover, whose header asks the two to
 * stay in step), and it draws an outside value and "None" the same way:
 *
 * - Items carry their option's INDEX, not its value: "None" is the option whose
 *   value is `''`, which `SelectItem` refuses.
 * - A value none of the options carries gets an item of its own, labelled with
 *   the value, so the trigger shows what the view holds. The native control
 *   showed its first option there. Picking that item writes nothing.
 */
function ListOptionPicker({
  value,
  options,
  onPick,
  className,
  testId,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  className: string;
  testId: string;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the view's own value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger className={className} data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Imperative handle exposed by ListView via React.forwardRef.
 * Allows parent components to trigger a data refresh programmatically.
 *
 * @example
 * ```tsx
 * const listRef = React.useRef<ListViewHandle>(null);
 * <ListView ref={listRef} schema={schema} />
 * // After a mutation:
 * listRef.current?.refresh();
 * ```
 */
export interface ListViewHandle {
  /** Force the ListView to re-fetch data from the DataSource */
  refresh(): void;
}

export const ListView = React.forwardRef<ListViewHandle, ListViewProps>(({
  schema: propSchema,
  className,
  onViewChange,
  onFilterChange,
  onSortChange,
  onGroupingChange,
  onSearchChange,
  onHiddenFieldsChange,
  onInlineEditChange,
  onColumnStateChange,
  onRowClick,
  showViewSwitcher: showViewSwitcherProp,
  userFilterSelections,
  onUserFilterSelectionsChange,
  initialFilters,
  initialSearchTerm,
  toolbarLeading,
  defaultRowNumbers = true,
  rowAdornment,
  compact = false,
  viewDefaults,
  ...props
}: ListViewProps & { [key: string]: any }, ref) => {
  // The switcher can be enabled either by the host component (prop) or by
  // the schema itself (ADR-0047 — ObjectView/InterfaceListPage stamp it on
  // the schema when appearance.allowedVisualizations whitelists >1 type).
  const showViewSwitcher = showViewSwitcherProp ?? (propSchema as any)?.showViewSwitcher ?? false;
  // i18n support for record count and other labels
  const { t } = useListViewTranslation();
  const { fieldLabel: resolveFieldLabel, actionLabel: resolveActionLabel, objectLabel: resolveObjectLabel } = useListFieldLabel();
  const { translateOptions } = useSafeFieldLabel();
  // The audience's BCP-47 tag (tenant locale → UI language → `en`), used below
  // to resolve the inline locale map the nested `aria` bag admits.
  const displayLocale = useDisplayLocale();

  // Canonicalize the view vocabulary ONCE, here, before anything reads it
  // (#2890): the legacy `fields` folds into the spec's `columns`, and `viewType`
  // is defaulted to a RENDERABLE kind. Nothing on this path parses the schema
  // through zod, so this call site — not `ListViewSchema` — is what guarantees
  // the fold runs. See `normalizeListViewSchema` for why the legacy key is
  // dropped rather than dual-read.
  // Perf: the normalizer returns propSchema by reference when there is nothing
  // to fold, so downstream useMemos keep a stable dependency identity on the
  // already-canonical path (the common case).
  const schema = React.useMemo(() => normalizeListViewSchema(propSchema), [propSchema]);

  // objectui#10607 — the node's own `filter`, with every placeholder resolved
  // once against the host's session scope and held (see
  // `useResolvedFilter` in `@object-ui/react`). The fetch, the page-reset signature, the
  // self-querying views, the child view's node, the export and the empty-state
  // copy below all read THIS, never the raw `schema.filter`.
  const filterScope = useFilterScope();
  const authoredFilter = useResolvedFilter(schema.filter, filterScope);

  // Convenience: resolve field label with schema.objectName pre-bound
  const tFieldLabel = React.useCallback(
    (fieldName: string, fallback: string) =>
      schema.objectName ? resolveFieldLabel(schema.objectName, fieldName, fallback) : fallback,
    [schema.objectName, resolveFieldLabel],
  );

  // Convenience: resolve action label with schema.objectName pre-bound.
  // Falls back to title-casing the action key when no i18n resource is found,
  // matching the previous local `formatActionLabel` helper.
  const tActionLabel = React.useCallback(
    (actionName: string) => {
      const fallback = formatActionLabel(actionName);
      if (schema.objectName && typeof resolveActionLabel === 'function') {
        return resolveActionLabel(schema.objectName, actionName, fallback);
      }
      return fallback;
    },
    [schema.objectName, resolveActionLabel],
  );

  // Declared ahead of `toolbarFlags`, which reads it: which view is ON SCREEN
  // decides whether a filter control has anything to reach (objectui#10327).
  const [currentView, setCurrentView] = React.useState<ListViewVisualization>(
    (schema.viewType as ListViewVisualization)
  );

  /**
   * Is the view on screen a `chart` bound to a semantic `dataset`?
   * (objectui#10327, ruling 5825582592, letter A.)
   *
   * Such a chart takes its scope FROM THE DATASET. Its node (`case 'chart'`,
   * the `'dataset'` shape) carries no `filter`: `ObjectChart` hands
   * `queryDataset` the dimensions and measures and nothing else, and a dataset's
   * field namespace need not be the list object's, so the list's filter has no
   * door into that query. The ruling refused the mapping that would build one
   * (option B). Both filter controls this toolbar offers therefore reach
   * nothing drawn on this view:
   *
   *   - the Filter builder (`showFilters` below);
   *   - the `UserFilters` chips (`showUserFilters` below). They feed the SAME
   *     effective filter (`buildEffectiveFilter`), whose only reader here is
   *     this component's own fetch of the list object's rows — the record-count
   *     bar, never the chart.
   *
   * So neither is offered on this view. The authored half — a view `filter` on
   * a dataset chart — is refused at authoring by `@object-ui/types`'
   * `ListViewSchema`.
   *
   * Two readers, one answer: the toolbar flags below, and the APPLIED user
   * filter (`appliedFilters` / `appliedUserFilterConditions`, objectui#10512).
   * A group the host restores at mount, or one set on a grid before a switch,
   * therefore does not go on narrowing this component's fetch — and with it the
   * record-count bar — with no control on screen to show or clear it. ⛔ The
   * held state itself is kept: switching back to a view that offers the
   * controls applies it again. The view's own `schema.filter` is not the
   * user's filter and stays applied.
   *
   * Asked of `resolveListChartBinding`, the SAME resolver `case 'chart'` routes
   * on, so the toolbar and the render branch cannot disagree about the shape.
   * A primitive, so the memo below keys on the answer, not on an identity
   * (AGENTS.md #10). ⛔ The `'unbound'` chart keeps both controls: its node
   * carries the effective filter (objectui#10250), and `ObjectChart` refuses
   * it on screen (objectui#8168). The object-bound chart that used to draw
   * here retired with the legacy axes (objectui#6152 round 15).
   */
  const datasetChartOnScreen =
    currentView === 'chart' && resolveListChartBinding(schema).shape === 'dataset';

  /**
   * Is the view on screen one whose own query carries no search term?
   * (objectui#10326, ruling 5825585515, letter A.)
   *
   * `tree` and `chart` draw what they query for themselves, and neither query
   * has a search channel: `ObjectTree`'s object-provider `find` sends
   * `$filter`, `$top` and `$expand`; `ObjectChart`'s queries — the aggregate
   * (`field`, `function`, `groupBy`, `filter`), its `find` fallback and the
   * dataset query — take no term. A typed term changed only this component's
   * own fetch — the record-count bar and the export — and nothing drawn. The
   * ruling withholds the control instead of widening either query (option B).
   *
   * Every chart binding: the dataset shape carries no term either.
   *
   * Two readers, one answer: `showSearch` below, and the APPLIED term
   * (`searchTerm`, after the toolbar flags). A term restored at mount or
   * carried across a view switch therefore does not go on narrowing this
   * component's fetch with no control on screen to show or clear it. ⛔ The
   * typed term itself is kept: switching back to a view that draws the
   * fetched rows applies it again.
   */
  const searchlessViewOnScreen = currentView === 'tree' || currentView === 'chart';

  // The object definition, read from the data source below ("Fetch object
  // definition"). Declared here because the toolbar's search decision reads it.
  const [objectDef, setObjectDef] = React.useState<any>(null);
  const [objectDefLoaded, setObjectDefLoaded] = React.useState(false);

  /**
   * objectui#12966 — the object's `search` resolves to no field, so the server
   * refuses any term with `400 INVALID_FIELD`: no quick-search box, and a term
   * restored at mount or carried across a view switch is not applied, for the
   * same two-readers reason as `searchlessViewOnScreen` above. Decided only
   * from the definition (`objectResolvesSearch`); a definition the data source
   * cannot serve keeps the box, as before.
   *
   * Until the definition is read the box is drawn, as before the card. On a
   * searchless object it is withdrawn when the read lands; the list is in its
   * loading state for that read anyway, since the data fetch waits on it.
   */
  const searchlessObject = React.useMemo(
    () => objectResolvesSearch(objectDef) === false,
    [objectDef],
  );

  // Resolve toolbar visibility flags: userActions overrides showX flags
  const toolbarFlags = React.useMemo(() => {
    // Every toolbar toggle reads from `userActions` (#2890). The legacy bare
    // `show*` flags are folded into it by `normalizeListViewSchema` above, so
    // there is no dual-read here — one vocabulary, one place.
    //
    // The DEFAULTS are per-toggle and deliberately asymmetric, matching what
    // these flags have always done: the four view-shaping affordances plus
    // grouping are on unless turned off; column visibility and row coloring are
    // off unless turned on. (`hideFields`/`rowColor` default OFF is objectui's
    // historical behavior, kept deliberately — flipping it would grow two
    // buttons on every existing view.)
    //
    // This is the VIEW half of a NAME COLLISION, and the right half here:
    // `userActions` on a VIEW is toolbar policy (`UserActionsConfigSchema`),
    // while `userActions` on an OBJECT is the CRUD-predicate block
    // (`edit`/`delete`/`create` with `visibleWhen`/`disabledWhen`). So this
    // read stays `schema`-only and must never gain an
    // `?? (objectDef as any)?.userActions` fallback: the object block carries
    // no toolbar key, and the mirrored mistake — reading VIEW-first where only
    // the object block is interpretable — is exactly what the `$select`
    // predicate harvest below was fixed for (objectui#5398, the sibling of
    // objectui#5240). Pinned by `__tests__/ListView.userActionsCollision.test.tsx`.
    const ua = schema.userActions as Record<string, boolean | undefined> | undefined;
    const addRecordEnabled = schema.addRecord?.enabled === true && ua?.addRecordForm !== false;
    const addRecordPlacement = resolveAddRecordPlacement(schema.addRecord?.position);
    return {
      // Not offered on `tree` or `chart`: see `searchlessViewOnScreen`.
      // Nor on an object whose search resolves to no field: see `searchlessObject`.
      showSearch: ua?.search !== false && !searchlessViewOnScreen && !searchlessObject,
      showSort: ua?.sort !== false,
      // Not offered on a dataset-bound chart: see `datasetChartOnScreen`.
      showFilters: ua?.filter !== false && !datasetChartOnScreen,
      showUserFilters: !datasetChartOnScreen,
      showRefresh: ua?.refresh !== false,
      showDensity: ua?.rowHeight !== false,
      showGroup: ua?.group !== false,
      showHideFields: ua?.hideFields === true,
      showColor: ua?.rowColor === true,
      // The bundled "Display" form is the default (objectui#12423): the bar
      // keeps Filter, Sort, Display and Search. `compactToolbar: false` is the
      // way back to one toolbar button per control.
      compactToolbar: schema.compactToolbar !== false,
      // Position-independent switch (empty-state CTA) + the two placement
      // slots. `position: 'both'` renders both buttons — it used to collapse
      // to `top` through a binary ternary (#2941).
      showAddRecord: addRecordEnabled,
      showAddRecordTop: addRecordEnabled && addRecordPlacement.top,
      showAddRecordBottom: addRecordEnabled && addRecordPlacement.bottom,
    };
  }, [schema.userActions, schema.compactToolbar, schema.addRecord, datasetChartOnScreen, searchlessViewOnScreen, searchlessObject]);

  // What the user typed, or what the host restored at mount.
  const [searchInput, setSearchInput] = React.useState(() => initialSearchTerm ?? '');
  // The term this component APPLIES — its fetch, the export, the Search
  // trigger. Empty on a view whose own query carries no term
  // (`searchlessViewOnScreen`, objectui#10326). A primitive, so each list that
  // names it re-runs on a switch into or out of such a view and on nothing else.
  const searchTerm = searchlessViewOnScreen || searchlessObject ? '' : searchInput;
  const [showSearchPopover, setShowSearchPopover] = React.useState(false);
  
  // Sort State
  const [showSort, setShowSort] = React.useState(false);
  const [currentSort, setCurrentSort] = React.useState<SortItem[]>(() =>
    parseSortConfig(schema.sort),
  );

  // Sync when parent schema.sort changes (view switch / reload pulls a
  // saved override). Compare by stringified payload to avoid render loops.
  const schemaSortKey = React.useMemo(
    () => JSON.stringify(schema.sort || []),
    [schema.sort]
  );
  React.useEffect(() => {
    setCurrentSort(parseSortConfig(schema.sort));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaSortKey]);

  /**
   * The view's DECLARED sort, for the "reset to default" affordance
   * (objectui#4243).
   *
   * One click on a column header replaces the whole sort array with that one
   * column, so a view shipping a two-level default lost it for the rest of the
   * session — the declared `sort` acted as an initial value with no way back
   * short of a page reload.
   *
   * Read through `parseSortConfig(schema.sort)` — THE resolver the initial
   * state and the view-switch effect above already use, not a re-derivation:
   * "what did this view declare" must have exactly one answer, or the reset
   * button and the first render could disagree about it.
   */
  const declaredSort = React.useMemo(
    () => parseSortConfig(schema.sort),
    // Keyed on the same stringified payload as the effect above; `schema.sort`
    // is a fresh array identity on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schemaSortKey],
  );

  // Compared by (field, order) IN ORDER — never by `id`, which `parseSortConfig`
  // mints fresh from `crypto.randomUUID()` on every call, so an id comparison
  // would report "differs" against the view's own declared sort.
  const sortDiffersFromDeclared = React.useMemo(() => {
    if (currentSort.length !== declaredSort.length) return true;
    return currentSort.some(
      (item, i) => item.field !== declaredSort[i].field || item.order !== declaredSort[i].order,
    );
  }, [currentSort, declaredSort]);

  const [showFilters, setShowFilters] = React.useState(false);

  const [currentFilters, setCurrentFilters] = React.useState<FilterBuilderRowGroup>(() =>
    initialFilters && Array.isArray(initialFilters.conditions)
      ? initialFilters
      : {
          id: 'root',
          logic: 'and',
          conditions: []
        }
  );

  // Data State
  const dataSource = props.dataSource;
  const [data, setData] = React.useState<any[]>([]);
  // Load failure (network / server error) is distinct from "empty": we must
  // not tell a user to "create your first record" when the fetch actually
  // failed. Captured here so the render can show a retryable error panel.
  const [loadError, setLoadError] = React.useState<string | null>(null);
  // What KIND of failure `loadError` is — drives which error panel copy shows.
  // Classified by the shared `classifyLoadError` (`@object-ui/react`,
  // objectui#4693 — lifted from this file so `RecordAttachmentsPanel` can
  // reuse the same "api-disabled is retry-invariant" verdict).
  const [loadErrorKind, setLoadErrorKind] = React.useState<LoadErrorKind>('network');
  // objectui#12966 — the failure is the server refusing this request's search
  // term (`INVALID_FIELD` on a request that carried `$search`). The panel then
  // shows the server's own sentence, which names the object and the remedies,
  // instead of the generic "query was rejected" copy.
  const [loadErrorIsSearchRefusal, setLoadErrorIsSearchRefusal] = React.useState(false);
  // Start in loading state when we will fetch from a dataSource so the empty
  // state doesn't flash before the first effect runs. Inline data (schema.data
  // as an array or a `value` provider) starts as not-loading.
  const [loading, setLoading] = React.useState<boolean>(() => {
    if (Array.isArray(schema.data)) return false;
    if (
      schema.data &&
      typeof schema.data === 'object' &&
      (schema.data as any).provider === 'value' &&
      Array.isArray((schema.data as any).items)
    ) {
      return false;
    }
    return true;
  });
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [dataLimitReached, setDataLimitReached] = React.useState(false);

  // --- P1: Imperative refresh API ---
  React.useImperativeHandle(ref, () => ({
    refresh: () => setRefreshKey(k => k + 1),
  }), []);

  // --- P2: Auto-subscribe to DataSource mutation events ---
  // Refetch whenever the bound object is mutated through the DataSource. This
  // is the ONLY refresh signal for inline-edit "Save All": ObjectGrid persists
  // those edits by calling dataSource.update() directly, with no form-success
  // handler to bump an external refreshTrigger — so subscribing even when
  // `refreshTrigger` is provided is required, not redundant. Form/delete flows
  // also bump refreshTrigger; the extra refetch that produces is harmless
  // because find() coalesces concurrent identical reads into one round-trip.
  React.useEffect(() => {
    if (!dataSource?.onMutation || !schema.objectName) return;
    const unsub = dataSource.onMutation((event: any) => {
      if (event.resource === schema.objectName) {
        setRefreshKey(k => k + 1);
      }
    });
    return unsub;
  }, [dataSource, schema.objectName]);

  // Dynamic page size state (wired from pageSizeOptions selector)
  const [dynamicPageSize, setDynamicPageSize] = React.useState<number | undefined>(undefined);
  const authoredPageSize = schema.pagination?.pageSize;

  // --- Server-side pagination (objectstack-ai/objectstack#2212) ---
  // ListView owns the fetch, so it owns paging too: it requests one window at a
  // time ($skip = (page-1)*size) and reads the real match `total` from the
  // result. That total + page controls are handed DOWN to the flat grid view so
  // its existing (single) DataTable pager becomes server-driven — records past
  // the first window are reachable, and we never stack a second pager on top.
  const [serverPage, setServerPage] = React.useState(1);
  /**
   * The match total the LAST fetch reported, exactly as it came back
   * (objectui#7394). Read through the derived `serverTotal` below, never
   * directly: this is the server's answer about the QUERY, while `serverTotal`
   * is the answer about the SURFACE, and keeping the two apart is what lets the
   * fetch effect stop depending on which visualization is on screen.
   */
  const [fetchedTotal, setFetchedTotal] = React.useState<number | null>(null);
  // The params of the last successful fetch — the query behind the window this
  // view is currently showing (objectui#4501). Handed DOWN with that window, in
  // the same block as `rowCount`/`page`: whoever renders the rows may need to
  // re-issue the query (the grid's cross-page "select all N matching" fans out
  // over the whole match set), and this view is the only side that knows what it
  // asked for. Held in state rather than a ref so a consumer re-renders when the
  // query moves, and written only inside the stale-request guard below, so it is
  // always the query that produced the rows on screen.
  const [lastFindParams, setLastFindParams] = React.useState<Record<string, unknown> | null>(null);

  // Grouping state (initialized from schema, user can add/remove via popover).
  // Supports three input shapes from the schema:
  //   1. Spec-compliant `grouping: { fields: [...] }` (preferred — supports
  //      arbitrary nesting depth).
  //   2. Shorthand `groupBy: 'fieldname'` written by the view config UI for
  //      the primary group.
  //   3. Optional `groupBy2: 'fieldname'` for a secondary (nested) group,
  //      enabling Airtable-style two-level grouping from the visual editor.
  // Any combination of (2) + (3) is normalized into a multi-level
  // GroupingConfig so the renderer honors grouping configured visually.
  const initialGroupingConfig = React.useMemo(() => {
    if (schema.grouping?.fields?.length) return schema.grouping;
    const primary = typeof schema.groupBy === 'string' ? schema.groupBy.trim() : '';
    const secondary = typeof schema.groupBy2 === 'string' ? schema.groupBy2.trim() : '';
    const fields: Array<{ field: string; order: 'asc'; collapsed: boolean }> = [];
    if (primary) fields.push({ field: primary, order: 'asc', collapsed: false });
    if (secondary && secondary !== primary) {
      fields.push({ field: secondary, order: 'asc', collapsed: false });
    }
    return fields.length > 0 ? { fields } : undefined;
  }, [schema.grouping, schema.groupBy, schema.groupBy2]);
  const [groupingConfig, setGroupingConfig] = React.useState(initialGroupingConfig);
  const [showGroupPopover, setShowGroupPopover] = React.useState(false);
  // The one door a USER's grouping edit goes through, from both editors, so
  // the host hears of it (objectui#11860). The re-sync below sets the state
  // directly: a schema delta is the host's own value, not news to report.
  const changeGrouping = React.useCallback((next: GroupingConfig | undefined) => {
    setGroupingConfig(next);
    onGroupingChange?.(next);
  }, [onGroupingChange]);

  // Re-sync grouping when the underlying schema-driven config changes (e.g. the
  // user edits `groupBy` in the view designer). User-driven changes via the
  // popover keep the latest interaction since this only fires on schema deltas.
  const lastSchemaGroupingRef = React.useRef(initialGroupingConfig);
  React.useEffect(() => {
    if (lastSchemaGroupingRef.current !== initialGroupingConfig) {
      lastSchemaGroupingRef.current = initialGroupingConfig;
      setGroupingConfig(initialGroupingConfig);
    }
  }, [initialGroupingConfig]);

  /**
   * Does THIS surface page server-side, and where does its window start?
   * (objectui#7394)
   *
   * Window the request only for the flat grid view. Grouped grids and the
   * visual views (kanban/calendar/gantt/gallery) consume the whole batch, so
   * they keep their single-window fetch and in-memory handling.
   *
   * ⭐ Hoisted out of the fetch effect DELIBERATELY, and the position is the
   * whole point rather than tidying. `currentView` used to be named in that
   * effect's dependency list, so every visualization switch re-issued the
   * query — and the query does not read `currentView`. It reads this `skip`,
   * which is the ONLY way the current visualization reaches the wire. At page
   * 1 that number is 0 on both sides of a grid/kanban switch, so the re-issued
   * request was byte-for-byte the one already on screen: the duplicate
   * `GET /api/v1/data/…` this card measured. Keying the effect on `fetchSkip`
   * keeps every re-fetch that changes the window (turning the page, leaving a
   * paged grid from page 3) and drops the ones that change nothing.
   *
   * `serverTotal` is derived here for the same reason. It used to be LATCHED
   * at fetch time as `paginate ? knownTotal : null`, which is a statement about
   * the render that wrote it — so it could only stay true by re-fetching on
   * every switch. Derived, it answers for the render that READS it, and the
   * values every consumer sees are the ones they saw before.
   */
  const paginate = currentView === 'grid' && !(groupingConfig?.fields?.length);
  // [objectui#9897] Through the resolver rather than a bare `??` chain. This
  // value is resolved ONCE and then feeds six consumers — the `$top` window,
  // the `$skip` step that turns the page, the has-more gate behind the
  // "showing first N" cap, the page size handed down to the child grid, the
  // record cap printed in that banner, and the rows-per-page control's own
  // displayed value. `??` rejects only null/undefined, so one refused
  // declaration used to reach all six.
  //
  // [objectui#9853] Undeclared, what it falls back to depends on whether this
  // surface pages (structure B): a paged surface falls back to the display
  // default the spec declares, and an unpaged one to the fetch batch. So with
  // no declared size, switching between the paged grid and an unpaged kind
  // moves the window and re-issues the fetch, where a declared size keeps one
  // window across the switch (objectui#7394).
  const effectivePageSize = resolvePageSize(
    dynamicPageSize,
    authoredPageSize,
    paginate ? DEFAULT_LIST_DISPLAY_PAGE_SIZE : DEFAULT_LIST_FETCH_BATCH_SIZE,
  );

  // [objectui#9897] The loud half, on the channel this component already uses
  // for "you declared it, the renderer dropped it". Keyed on the declaration
  // (and on which fallback it names), so it is one warning per declaration
  // rather than one per render.
  React.useEffect(() => {
    const message = describeRefusedPageSize(dynamicPageSize, authoredPageSize, schema.objectName, paginate);
    if (message) console.warn(message);
  }, [dynamicPageSize, authoredPageSize, schema.objectName, paginate]);

  const fetchSkip = paginate ? (serverPage - 1) * effectivePageSize : 0;
  const serverTotal = paginate ? fetchedTotal : null;

  // Row color state (initialized from schema, user can configure via popover)
  const [rowColorConfig, setRowColorConfig] = React.useState(schema.rowColor);
  const [showColorPopover, setShowColorPopover] = React.useState(false);

  // Bulk action state
  const [selectedRows, setSelectedRows] = React.useState<any[]>([]);

  // Request counter for debounce — only the latest request writes data
  const fetchRequestIdRef = React.useRef(0);


  // User Filters State (Airtable Interfaces-style)
  const [userFilterConditions, setUserFilterConditions] = React.useState<any[]>([]);

  // The user filter this component APPLIES — its fetch, the export, the node of
  // a view that queries for itself, the empty-state copy. Empty while a
  // dataset-bound chart is on screen (`datasetChartOnScreen`, objectui#10512).
  // The held `currentFilters` / `userFilterConditions` stay as they are, for
  // the controls and for the host's storage. Each is swapped only when it holds
  // something, so a switch with nothing held hands the fetch effect the
  // identities it already had and re-issues no query (objectui#7394).
  const appliedFilters =
    datasetChartOnScreen && currentFilters.conditions && currentFilters.conditions.length > 0
      ? WITHHELD_FILTER_GROUP
      : currentFilters;
  const appliedUserFilterConditions =
    datasetChartOnScreen && userFilterConditions.length > 0
      ? WITHHELD_USER_FILTER_CONDITIONS
      : userFilterConditions;

  // User filters render ONLY when explicitly configured (ADR-0047 §data
  // mode): saved list views already act as the preset switcher, so an
  // unconfigured view keeps a clean toolbar instead of growing auto-derived
  // dropdowns. When a config asks for dropdown/toggle elements without
  // naming fields, fill the field list from objectDef select-like fields so
  // authors can write `userFilters: { element: 'dropdown' }` as shorthand.
  const resolvedUserFilters = React.useMemo<ListViewSchema['userFilters'] | undefined>(() => {
    const configured = schema.userFilters;
    if (!configured) return undefined;
    if (configured.element === 'tabs') return configured;
    if (configured.fields && configured.fields.length > 0) return configured;
    if (!objectDef?.fields) return configured;

    const FILTERABLE_FIELD_TYPES = new Set(['select', 'multi-select', 'boolean']);
    const derivedFields: NonNullable<NonNullable<ListViewSchema['userFilters']>['fields']> = [];

    const fieldsEntries: Array<[string, any]> = Array.isArray(objectDef.fields)
      ? objectDef.fields.map((f: any) => [f.name, f])
      : Object.entries(objectDef.fields);

    for (const [key, field] of fieldsEntries) {
      // Include fields with a filterable type, or fields that have options without an explicit type
      if (FILTERABLE_FIELD_TYPES.has(field.type) || (field.options && !field.type)) {
        derivedFields.push({
          field: key,
          label: tFieldLabel(key, field.label || key),
          type: field.type === 'boolean' ? 'boolean' : field.type === 'multi-select' ? 'multi-select' : 'select',
        });
      }
    }

    if (derivedFields.length === 0) return configured;

    return { ...configured, fields: derivedFields };
  }, [schema.userFilters, objectDef, tFieldLabel]);
  // The chips the toolbar renders are `filterElements`, which asks the field
  // read; it is declared below `perms` (objectui#11984).

  // Hidden Fields State (initialized from schema)
  const [hiddenFields, setHiddenFields] = React.useState<Set<string>>(
    () => new Set(schema.hiddenFields || [])
  );
  // Sync when parent schema changes (e.g. switching between views, reload
  // pulls a saved override). Wrapped in JSON to avoid Set identity churn.
  const schemaHiddenKey = React.useMemo(
    () => JSON.stringify(schema.hiddenFields || []),
    [schema.hiddenFields]
  );
  React.useEffect(() => {
    setHiddenFields(new Set(schema.hiddenFields || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaHiddenKey]);

  // Setter that also notifies parent for persistence (debounced upstream).
  const updateHiddenFields = React.useCallback(
    (next: Set<string>) => {
      setHiddenFields(next);
      onHiddenFieldsChange?.(Array.from(next));
    },
    [onHiddenFieldsChange]
  );
  const [showHideFields, setShowHideFields] = React.useState(false);

  // Inline-edit MODE: session state, seeded from the view's `inlineEdit` on each
  // load (objectui#5144, ruling E). The toolbar toggle flips it here and reports
  // it through `onInlineEditChange`. The console writes nothing back, because
  // `inlineEdit` is the author's permission key, so the mode is not remembered
  // across loads. Whether the toggle is offered at all is `inlineEditOffered`
  // below.
  const [inlineEdit, setInlineEdit] = React.useState<boolean>(() => !!schema.inlineEdit);
  React.useEffect(() => {
    setInlineEdit(!!schema.inlineEdit);
  }, [schema.inlineEdit]);
  // Setter that also notifies the host.
  const updateInlineEdit = React.useCallback(
    (next: boolean) => {
      setInlineEdit(next);
      onInlineEditChange?.(next);
    },
    [onInlineEditChange]
  );

  // Row numbers on the grid's leading cell — the Display control's switch
  // (objectui#12423). Session-only and in memory: nothing stores it, and it
  // opens on the host's `defaultRowNumbers` (on unless a host says otherwise)
  // with every list.
  const [rowNumbers, setRowNumbers] = React.useState(defaultRowNumbers);

  // objectui#12528 — the grid's column summaries, drawn at the right of the
  // record-count row instead of a second footer row of the grid's own. The
  // grid reports them through its `onColumnSummaryChange` host channel (by
  // content, `null` when it draws none), and draws no summary row itself.
  const [gridSummaries, setGridSummaries] = React.useState<
    ReadonlyArray<{ key: string; header: string; label: string }> | null
  >(null);

  // Export State
  const [showExport, setShowExport] = React.useState(false);
  // Server-streamed export (xlsx / type-aware csv|json) in-flight + last error.
  const [exportBusy, setExportBusy] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

  // Object-level export permission gate. Default-allow: export stays enabled
  // unless `allowExport === false` or `operations.export === false`, AND — when
  // the server hands down an effective API operation set for this object
  // (/me/permissions `apiOperations`, objectstack#3391) — unless it excludes `export`.
  // Missing effective set (unrestricted object / old backend / no provider)
  // keeps the current behavior. The frontend consumes the effective set the
  // server resolved; it never reads the raw `apiMethods`.
  const affordancePerms = usePermissions();
  const { getObjectApiOperations } = affordancePerms;
  const effectiveApiOps = schema.objectName ? getObjectApiOperations(schema.objectName) : undefined;
  const exportPermitted =
    schema.allowExport !== false &&
    schema.operations?.export !== false &&
    (effectiveApiOps ? effectiveApiOps.includes('export') : true);

  // [objectstack#3720] Bulk-action gate for the NON-grid views (kanban / calendar /
  // gallery / …), whose bulk bar this component renders itself — the grid path
  // delegates to ObjectGrid, which gates its own. A declared `bulkActions`
  // entry is a WIRING declaration, not a permission grant, so the built-in
  // `delete` is dropped unless the object's resolved delete affordance allows
  // it: the ADR-0103 bucket lock ∧ `userActions.delete` ∧ the server's
  // effective API operation set (objectstack#3391). Custom action ids pass through
  // untouched — they route through the action runner with their own gates.
  // [#4096] ∧ the CURRENT PRINCIPAL's `allowDelete` — the three layers above
  // all describe the OBJECT, so without this the most destructive entry on a
  // kanban/gallery board stayed visible for an account with no delete grant.
  // `can()` answers `true` with no `PermissionProvider` (standalone embeds).
  // [objectui#12082] The four layers are the `listBulkDelete` row of the
  // affordance-to-grant map, resolved by `resolveAffordance` from
  // `@object-ui/core` — the one verdict every console affordance reads.
  const bulkDeleteVerdict = React.useMemo(
    () => resolveAffordance('listBulkDelete', { objectSchema: objectDef as SchemaLike, objectName: schema.objectName, perms: affordancePerms }),
    [objectDef, schema.objectName, affordancePerms],
  );
  const permittedBulkActions = React.useMemo(() => {
    const declared = schema.bulkActions;
    if (!declared || declared.length === 0) return declared;
    if (bulkDeleteVerdict.allowed) return declared;
    return declared.filter((a: unknown) => String(a).toLowerCase() !== 'delete');
  }, [schema.bulkActions, bulkDeleteVerdict]);

  /**
   * [objectui#4420] The PER-RECORD half of the same key, for the same bar.
   *
   * `permittedBulkActions` above reads `userActions.delete` as a BOOLEAN — the
   * object-level verdict — and that is all it ever read. Since objectui#2614
   * the key also accepts `{ enabled?, visibleWhen?, disabledWhen? }`, whose
   * `visibleWhen` gates the affordance **per record**; the row kebab has
   * honoured it since, and this bar did not. Tick only a record the predicate
   * excludes and the bar still offered the red Delete — the same declared key
   * meaning two different things on two surfaces.
   *
   * ## What was ruled (maintainer, 2026-08-17 — behaviour 1 of three)
   *
   * Filter the operation and report the skipped. The bar evaluates
   * `visibleWhen` once per selected record, Delete runs over the allowed
   * SUBSET, and the excluded records are reported rather than silently
   * dropped. Two rejected alternatives, restated because each is a way to
   * misread this code: the button is **never hidden or disabled** by the
   * predicate (behaviour 2 — one stray tick would disable the whole bar), and
   * the predicate is **not** declared out of scope for set operations
   * (behaviour 3 — the key must not mean different things on two surfaces).
   * A selection where EVERY row is excluded therefore still renders the
   * button; what the user gets is a legible refusal, not an absence.
   *
   * ## Why `evalRowPredicate`, never `useRowPredicate`
   *
   * A bulk gate evaluates N records in a LOOP, and React forbids a hook per
   * iteration. `partitionRowsByPredicate` is that loop — the shared,
   * fail-closed fold in `@object-ui/core` that the grid's own bulk bar reads
   * through `partitionBulkRows`, so the two bars cannot drift on what
   * "eligible" means.
   *
   * ## Why `objectDef`, and only the built-in `delete`
   *
   * The predicates come off the OBJECT's `userActions` block (the CRUD
   * predicate vocabulary), never the VIEW's `schema.userActions` (toolbar
   * policy) — the same name collision `toolbarFlags` above is pinned against.
   * Only the built-in `delete` entry is filtered: custom action ids route
   * through the action runner carrying their own gates, exactly as the
   * object-level gate above leaves them alone.
   */
  // The predicate envelope rides the SAME `listBulkDelete` verdict
  // (objectui#12082): surfaced only when the bar's Delete itself is allowed,
  // which is the only case the bar offers Delete in.
  const deleteVisibleWhen = bulkDeleteVerdict.predicates?.visibleWhen;
  const predicateScope = usePredicateScope();
  const bulkDeleteEligibility = React.useMemo(
    () => partitionRowsByPredicate(deleteVisibleWhen as never, selectedRows as Array<Record<string, unknown>>, {
      scope: predicateScope,
      fields: objectDef?.fields,
      label: 'delete',
    }),
    [deleteVisibleWhen, selectedRows, predicateScope, objectDef],
  );

  /**
   * [#4647] Is the grid toolbar's inline-edit toggle offered at all?
   *
   * Two gaps closed together, because both end at this one render condition.
   *
   * ## Gap 1 — the permission gate
   *
   * The toggle used to render on the sole conditions "grid view", "the host
   * wired `onInlineEditChange`" and "not the compact toolbar" — and every host
   * passes that callback unconditionally. It was the ONE affordance on this
   * toolbar with no permission check: New and Import are hidden for an account
   * without the grant, the bulk-delete entry directly above ANDs
   * `can(obj, 'delete')`, and inline edit alone stayed available to a read-only
   * principal, who could flip it, edit cells and press "Save all" to earn a
   * server 403. No data ever landed (the server gate is solid), but the UI
   * walked the user through a round-trip guaranteed to fail.
   *
   * The gate is `permittedBulkActions`' verbatim, with the operation moved from
   * `delete` to `update`: the object's resolved affordance — ADR-0103 bucket ∧
   * `userActions.edit` ∧ the server's effective API operations (objectstack#3391) — AND
   * the CURRENT PRINCIPAL's grant (#4096). The first half is spelled
   * `isObjectInlineEditable`, which IS
   * `resolveEffectiveCrudAffordances(...).edit` under the name that says what
   * this surface is asking; it is the same helper the record body's
   * double-click/pencil affordances read, so a list and a record page cannot
   * disagree about whether an object's rows are editable in place.
   *
   * `can()` answers `true` with no `PermissionProvider`, so standalone embeds
   * and the Studio designer keep today's behavior — the same fail-open the
   * bulk gate above relies on.
   *
   * ## Gap 2 — the declared `userActions.editInline`, with the spec's default
   *
   * `ListViewSchema.userActions.editInline` defaults to `true`: a list view is
   * editable in place by default, under the gate above, and
   * `editInline: false` is the opt-out (the maintainer's v18 ruling,
   * objectstack#22605, which flipped the earlier `.default(false)`). It is read
   * here with that default (`!== false`), so a view that declares nothing is
   * offered inline editing wherever the gate admits the principal. The ADR-0047
   * interface page reads the same default.
   *
   * A view's `inlineEdit` reaches this read through the fold, not around it
   * (objectui#5144). `normalizeListViewSchema` folds a boolean `inlineEdit`
   * into `userActions.editInline` when the view declares no `editInline` of its
   * own. So:
   *  - a view with `inlineEdit: true` offers the toggle;
   *  - a view with `inlineEdit: false` reads off;
   *  - an explicit `editInline` wins over `inlineEdit`, either way;
   *  - a view with neither key offers the toggle and opens out of edit mode.
   *
   * Both keys are the author's permission. This gate decides whether the toggle
   * is offered. Whether the grid is in edit mode is the `inlineEdit` state above:
   * session state, seeded from the view's `inlineEdit` on each load, and flipped
   * by the toggle. The console no longer persists the toggle into the view
   * (objectui#5144, ruling E). That write made the toggle one-way, because
   * switching it off stored `inlineEdit: false`, which this gate then read as
   * "not offered". A view with `editInline: true` and no `inlineEdit` offers the
   * toggle and opens out of edit mode, the same as a view with neither key.
   *
   * ⚠️ A list that is read-only by nature declares
   * `userActions.editInline: false`. Two costs are recorded with the
   * objectui#5144 ruling. The edit mode is not remembered across loads. A view
   * or overlay that already stores `inlineEdit: false`, written by the old
   * toggle, still reads off; that is existing data, it is not migrated, and
   * declaring `userActions.editInline: true` brings the toggle back.
   */
  const inlineEditOffered = React.useMemo(() => {
    if ((schema.userActions as Record<string, boolean | undefined> | undefined)?.editInline === false) {
      return false;
    }
    // [objectui#12082] The `listInlineEdit` row of the affordance-to-grant map:
    // the same conjunction, read from the one table.
    return resolveAffordance('listInlineEdit', { objectSchema: objectDef as SchemaLike, objectName: schema.objectName, perms: affordancePerms }).allowed;
  }, [schema.userActions, schema.objectName, objectDef, affordancePerms]);

  /**
   * Whether the rows this list fetches must carry their concurrency token
   * (objectui#12292): exactly when the grid it hands them to is editable in
   * place — the same expression as that grid's `editable` below. The grid's
   * save sends each row's `updated_at` as `If-Match`, so the fetch projects it;
   * turning the mode on re-reads the rows with it.
   */
  const rowsCarryConcurrencyToken = inlineEdit && inlineEditOffered;

  // Normalize exportOptions: support both ObjectUI object format and spec string[] format
  const resolvedExportOptions = React.useMemo(() => {
    if (!schema.exportOptions) return undefined;
    // Spec format: simple string[] like ['csv', 'xlsx']
    if (Array.isArray(schema.exportOptions)) {
      return { formats: schema.exportOptions };
    }
    // ObjectUI format: already an object
    return schema.exportOptions;
  }, [schema.exportOptions]);

  // Formats this list can actually deliver (objectui#2942): the server stream
  // handles csv/xlsx/json, the client fallback only csv/json, and pdf is no
  // export format (a printable document is a page that declares `print` —
  // objectstack#8346). Declared-but-dead
  // formats used to render as menu items whose click did nothing; now they're
  // dropped from the menu (with a one-time warning for the app author).
  // Annotated `string[]` rather than inferred: `resolvedExportOptions.formats`
  // is the spec's literal union, so the inferred element type made the
  // `exportableFormats.includes(f)` below (whose `f` is a plain `string`) a
  // TS2345. Only visible since objectui#4528 gave this render function a real
  // `schema` type — the index signature used to resolve it to `any`.
  const exportableFormats = React.useMemo<string[]>(() => {
    const declared = resolvedExportOptions?.formats || ['csv', 'json'];
    const serverAvailable = typeof dataSource?.exportDownload === 'function'
      && !!schema.objectName
      && resolvedExportOptions?.streaming !== false;
    const supported = serverAvailable ? ['csv', 'xlsx', 'json'] : ['csv', 'json'];
    return declared.filter((f: string) => supported.includes(f));
  }, [resolvedExportOptions, dataSource, schema.objectName]);
  React.useEffect(() => {
    const declared = resolvedExportOptions?.formats;
    if (!declared) return;
    const dropped = declared.filter((f: string) => !exportableFormats.includes(f));
    if (dropped.length > 0) {
      console.warn(`[ObjectUI] ListView export: unsupported format(s) hidden from the menu: ${dropped.join(', ')}`);
    }
  }, [resolvedExportOptions, exportableFormats]);

  // Toolbar density, resolved from the spec-canonical `rowHeight` (#2890). The
  // legacy `densityMode` is folded into it by `normalizeListViewSchema` above —
  // it used to be read FIRST here, so a view carrying both rendered the legacy
  // value, backwards from every other pair's canonical-wins precedence.
  //
  // `rowHeightToDensityMode` answers only for the five spec row heights and
  // abstains for anything else (#4440), so an off-spec value lands on the same
  // `'compact'` an ABSENT `rowHeight` has always landed on — which is also
  // `ObjectGrid`'s own default (`schema.rowHeight ?? 'compact'`). Do NOT drop
  // the `??` and let `undefined` reach `useDensityMode`: its parameter default
  // is `'comfortable'`, so the coercion #4440 retired would simply reappear one
  // frame lower, and the two surfaces would disagree again.
  const resolvedDensity = React.useMemo(
    () => rowHeightToDensityMode(schema.rowHeight) ?? 'compact',
    [schema.rowHeight],
  );
  const density = useDensityMode(resolvedDensity, {
    onChange: schema.onDensityChange,
  });

  // ── Gallery card density ────────────────────────────────────────────
  // Separate from the table `density.mode` (which controls rowHeight) —
  // the gallery uses 3 column counts mapped to `GalleryConfig.cardSize`
  // (small/medium/large). Persisted per-object so users can keep
  // Accounts compact while leaving Products comfortable.
  type GalleryCardSize = 'small' | 'medium' | 'large';
  const galleryDensityKey = React.useMemo(
    () => `objectui:gallery:density:${schema.objectName ?? 'default'}`,
    [schema.objectName],
  );
  const [galleryCardSize, setGalleryCardSize] = React.useState<GalleryCardSize>(() => {
    if (typeof window === 'undefined') return (schema.gallery?.cardSize as GalleryCardSize) ?? 'medium';
    try {
      const v = window.localStorage.getItem(galleryDensityKey);
      if (v === 'small' || v === 'medium' || v === 'large') return v;
    } catch { /* private mode — fall through */ }
    return (schema.gallery?.cardSize as GalleryCardSize) ?? 'medium';
  });
  const cycleGalleryDensity = React.useCallback(() => {
    setGalleryCardSize((prev) => {
      const next: GalleryCardSize = prev === 'large' ? 'medium' : prev === 'medium' ? 'small' : 'large';
      try { window.localStorage.setItem(galleryDensityKey, next); } catch { /* ignore */ }
      return next;
    });
  }, [galleryDensityKey]);

  const handlePullRefresh = React.useCallback(async () => {
    setRefreshKey(k => k + 1);
  }, []);

  const { ref: pullRef, isRefreshing, pullDistance } = usePullToRefresh<HTMLDivElement>({
    onRefresh: handlePullRefresh,
    enabled: !!dataSource && !!schema.objectName,
  });

  const storageKey = React.useMemo(() => {
    return schema.id 
      ? `listview-${schema.objectName}-${schema.id}-view`
      : `listview-${schema.objectName}-view`;
  }, [schema.objectName, schema.id]);

  // Fetch object definition
  React.useEffect(() => {
    let isMounted = true;
    // Reset loaded flag so data fetch waits for the new schema
    setObjectDefLoaded(false);
    setObjectDef(null);
    const fetchObjectDef = async () => {
      if (!dataSource || !schema.objectName) {
        setObjectDefLoaded(true);
        return;
      }
      if (typeof dataSource.getObjectSchema !== 'function') {
        setObjectDefLoaded(true);
        return;
      }
      try {
        const def = await dataSource.getObjectSchema(schema.objectName);
        if (isMounted) {
          setObjectDef(def);
        }
      } catch (err) {
        console.warn("Failed to fetch object schema for ListView:", err);
      } finally {
        if (isMounted) {
          setObjectDefLoaded(true);
        }
      }
    };
    fetchObjectDef();
    return () => { isMounted = false; };
  }, [schema.objectName, dataSource]);

  // Permissions context — must be read before the `$expand` memo below AND
  // before the data-fetch effect, so both can FLS-gate what they ask the server
  // for (preventing it from returning denied fields). Also feeds the column-list
  // gate further down the file.
  //
  // ⚠️ The position is load-bearing, not cosmetic: `useMemo` runs its callback
  // DURING the render that declares it, so a memo above this line that read
  // `perms` would hit the temporal dead zone and throw
  // `Cannot access 'perms' before initialization` — not a stale value, a crash.
  const perms = usePermissions();

  // Auto-compute $expand fields from objectDef (lookup / master_detail).
  //
  // Important: include not only the user-declared `schema.columns` (table
  // columns) but also the runtime fields used by alternate view types
  // (kanban columns, calendar startDateField, gallery coverField, etc.).
  // Otherwise a kanban whose card shows `account` would request
  // `?select=...,account,...` but never `populate=account`, so the server
  // returns the bare FK ID instead of the expanded record. This is why
  // list view shows "Initech Solutions" but kanban used to show
  // "8UY9zHWBfjYjYor4" for the same field.
  const expandFields = React.useMemo(() => {
    const baseColumns = Array.isArray(schema.columns)
      ? (schema.columns as any[])
          .map((f) => columnIdentity(f))
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
      : [];
    const collected = new Set<string>(baseColumns);
    const collectViewFields = (v: any) => {
      if (!v) return;
      const candidates = [
        // The blocks' spec keys only. The pre-#2231 aliases and the undeclared
        // knobs this list also named (`groupField`, `groupBy`, `cardTitle`,
        // `dateField`, `endField`, `imageField`, `swimlaneField`, `valueField`,
        // `cardFields`) left with the readers that honoured them
        // (objectui#6152 round 14): nothing draws them any more, so fetching
        // them would only widen the query.
        v.groupByField,
        v.summarizeField,
        v.titleField,
        v.startDateField, v.endDateField,
        v.colorField, v.allDayField,
        v.coverField,
        // The map's coordinate bindings (objectui#10370). Its title rides
        // `titleField` above; an expanded lookup there resolves to the related
        // record's display name.
        //
        // ⛔ NOT `descriptionField`, which the `$select` twin below does
        // collect. `ObjectMap` renders the marker description as a React
        // child, so an EXPANDED lookup there (an object) throws "Objects are
        // not valid as a React child" when the marker is clicked, where a bare
        // id renders as text — measured on objectui#10370. That crash is
        // already reachable wherever every relation is expanded (a column-less
        // list, `ObjectMap`'s own fetch); this collector must not add a route.
        v.locationField, v.latitudeField, v.longitudeField,
        // Spec `columns` = the fields shown on each kanban card.
        // ⛔ No timeline chip-field list (the retired `metaFields`) is
        // collected: the spec declares none, and the timeline no longer reads
        // one (objectui#10222).
        ...(Array.isArray(v.columns) ? v.columns : []),
        ...(Array.isArray(v.visibleFields) ? v.visibleFields : []),
      ];
      for (const f of candidates) {
        if (typeof f === 'string' && f) collected.add(f);
      }
    };
    collectViewFields((schema as any).kanban);
    collectViewFields((schema as any).options?.kanban);
    collectViewFields((schema as any).calendar);
    collectViewFields((schema as any).options?.calendar);
    collectViewFields((schema as any).gallery);
    collectViewFields((schema as any).options?.gallery);
    collectViewFields((schema as any).timeline);
    collectViewFields((schema as any).options?.timeline);
    collectViewFields((schema as any).gantt);
    collectViewFields((schema as any).options?.gantt);
    // [objectui#10370] The map, read through the resolver its render branch
    // and capability gate share — see the `$select` twin below for why the
    // resolver rather than the two blocks one at a time. A coordinate or title
    // binding that names a lookup is then expanded, the row shape `ObjectMap`'s
    // own fetch and a column-less list already deliver: both expand every
    // relation. The description binding is left out on purpose (see the
    // candidate list above).
    collectViewFields(resolveListMapConfig(schema));
    // [objectui#7179] The GRID's grouping block, which this collector had no
    // arm for: it reads `groupByField` (kanban / gantt / timeline) but the grid
    // groups through `grouping.fields[]`, a different key with a different
    // shape. Without this, a grid grouped by a LOOKUP gets the field into
    // `$select` but never into `populate`, so every row carries the bare
    // foreign key and the groups bucket by raw id instead of by name — the
    // exact failure the comment above this memo records for kanban
    // ("list view shows 'Initech Solutions' but kanban used to show
    // '8UY9zHWBfjYjYor4'"). Better than one `(empty)` bucket, still wrong.
    //
    // Unguarded AGAINST UNKNOWN KEYS is safe here, and here only:
    // `buildExpandFields` returns a subset of the object's declared
    // reference-bearing fields, so a grouping field the object does not have —
    // or has as a non-relation — is dropped structurally. The `$select` half
    // below needs a real gate for that, and takes one. It is NOT unguarded
    // against FLS: that gate is on this helper's OUTPUT, below (objectui#7215),
    // where every route into the expand list — columns, view bindings and this
    // grouping union alike — passes through it exactly once.
    for (const f of collectGroupingFieldRefs(groupingConfig)) collected.add(f);
    const augmented = collected.size > 0 ? Array.from(collected) : undefined;
    const expandable = buildExpandFields(objectDef?.fields, augmented);
    // [objectui#7215] FIELD-LEVEL SECURITY ON `$expand`, the half objectui#6898
    // left open on both projection sites. `$select` on a denied lookup asks for
    // its BARE FOREIGN KEY; `$expand` asks the server to RESOLVE it and return
    // the related record, so the larger disclosure was the ungated one.
    //
    // ON THIS SITE IT ALSO REOPENED `$select`, which is not a second defect but
    // the measured reach of this one: the projection below gates the columns
    // (`rawCols.filter(c => perms.checkField(...))`) and then adds these roots
    // back unconditionally — `for (const e of expandFields) required.add(e)`,
    // on the ground that they are "known-valid because `buildExpandFields()`
    // derived them from the object schema". Valid, yes; READABLE, never asked.
    // A denied lookup column walked straight back through that union, so
    // objectui#6898's gate was being defeated here by the expand roots rather
    // than by its own filter. Gating at this single point closes both halves.
    //
    // ⭐ THE GATE GOES ON THE OUTPUT, NOT ON `augmented`, for two measured
    // reasons (`__tests__/ListView.expandFls-7215.test.tsx` pins both):
    // `buildExpandFields` reads an EMPTY column list as "no column restriction"
    // and falls back to every declared relation, so gating its INPUT would
    // WIDEN a view whose collected columns are all denied from one expansion to
    // all of them; and the no-columns case passes `undefined`, which has no
    // input to gate at all. Gating the output also gives the required ordering
    // structurally — this helper returns a subset of the object's DECLARED
    // reference-bearing fields, so every name judged here is declared and the
    // "`checkField` answers false for an undeclared key" trap is unreachable.
    //
    // An unanswered policy filters nothing, exactly as the `$select` gate
    // defers; `perms` is in the dep list so the expansion is rebuilt the moment
    // the answer arrives, and the fetch effect already depends on `perms` too.
    if (!perms?.isLoaded || !schema.objectName) return expandable;
    return expandable.filter((f) => perms.checkField(schema.objectName!, f, 'read'));
  }, [
    objectDef?.fields,
    groupingConfig,
    schema.columns,
    (schema as any).kanban,
    (schema as any).calendar,
    (schema as any).gallery,
    (schema as any).timeline,
    (schema as any).gantt,
    schema.map,
    (schema as any).options,
    perms,
    schema.objectName,
  ]);

  /**
   * Does a GROUPED grid query for itself? (objectui#7189, maintainer ruling A)
   *
   * Grouping on a list view is server-side: the set of groups and every number
   * in a group header are properties of the query, and the rows inside a
   * group are paged. This component's fetch is one window (`$top:
   * effectivePageSize`), and a grid handed that window as `data` can only
   * group the window — measured on 186 rows in five units of 86/61/31/7/1 with
   * `$top: 100`: two headers (86, 14) or five page slices (31/31/30/7/1), by
   * row order alone, every row past the window unreachable, and nothing on
   * screen saying so. So when the data source can answer the group header
   * query (`queryGroupHeaders`), the grid is handed NO rows: it asks the server
   * for its groups and pages each group's rows itself, with the SAME effective
   * filter this component would have sent (see `selfQueryFilter` below).
   *
   * A toolbar search included (objectui#11021). The header query takes
   * ADR-0061 `search` / `searchFields` beside `where`, and the grid sends the
   * term on it and on every group's row query as one pair, so the groups and
   * their counts are the searched rows'. The grid is handed this component's
   * term as `search`, and the view's `searchableFields` on its node — the pair
   * this component's own fetch sends as `$search` / `$searchFields`.
   */
  const gridOwnsGroupedFetch =
    currentView === 'grid' &&
    (groupingConfig?.fields?.length ?? 0) > 0 &&
    !Array.isArray(schema.data) &&
    (schema.data as any)?.provider !== 'value' &&
    !!schema.objectName &&
    typeof dataSource?.queryGroupHeaders === 'function';

  /**
   * Is a GROUPED grid refused here? (objectui#10881, maintainer ruling F)
   *
   * The other half of `gridOwnsGroupedFetch`: a grouped grid over a data
   * source that cannot answer the group header query. This component would
   * fetch one window and hand it down as `data`, and the grid takes rows it
   * is handed as the whole set — it would group the window as if nothing
   * were withheld, page-slice counts and missing groups included, and it
   * cannot tell. So the refusal is made HERE, before a grid is mounted: the
   * same sentence the grid refuses with, no window fetched
   * (`groupingNeedsHeaderQuery` stands the fetch effect down), and no
   * record-count bar.
   *
   * Only where THIS component fetches: rows handed in whole (`schema.data` as
   * an array, or a `value` provider) are grouped where they are, exactly. The
   * grouping counts the entries the grid would group by
   * (`collectGroupingFieldRefs`: a named `field`), not the raw array, so a
   * grouping of empty holes refuses nothing. A toolbar search does not lift
   * the refusal: the data source cannot answer the header query either way.
   */
  const groupingNeedsHeaderQuery =
    currentView === 'grid' &&
    collectGroupingFieldRefs(groupingConfig).length > 0 &&
    !Array.isArray(schema.data) &&
    (schema.data as { provider?: unknown } | undefined)?.provider !== 'value' &&
    !!schema.objectName &&
    !!dataSource &&
    typeof dataSource.queryGroupHeaders !== 'function';

  /**
   * Does the surface rendered below draw the rows THIS component fetched?
   *
   * objectui#7210. The record-count bar at the foot of this component reports
   * this component's own paged query — `data.length` (or `serverTotal`), the
   * `dataLimitReached` warning that goes with `$top: effectivePageSize`, and a
   * rows-per-page selector that re-issues it. It is the only paging disclosure
   * on the screen, so a reader takes it as describing whatever is drawn above
   * it.
   *
   * On `gantt` that reading is false, and the bar is then worse than no bar.
   * MEASURED rather than inferred: the registered `object-gantt` renderer
   * (`plugin-gantt/src/index.tsx`) resolves to
   * `< ObjectGantt schema={bound} dataSource={dataSource} / >` and forwards no
   * other prop — unlike `object-grid` / `object-kanban` / `object-calendar` /
   * `object-map` / `object-tree`, whose wrappers all spread `{...props}`. The
   * `data` handed to the SchemaRenderer below therefore never reaches the
   * chart, `ObjectGantt.reload` issues its OWN query, and that query carries no
   * `$top` at all. Harness: 18 rows, `pagination.pageSize: 6` — the chart drew
   * 18 rows while this bar read "6 records · Showing first 6 records. More data
   * may be available." The same harness on `grid` ("18 records", the server
   * total, no warning) and on `kanban` ("6 records …", and the board really is
   * drawing those 6) is why this is scoped to `gantt` alone: everywhere else
   * the bar is telling the truth and must keep telling it.
   *
   * ⛔ The correction is NOT to forward `data` to the chart. That would cap a
   * gantt at one page, turning a complete schedule into a quietly truncated one
   * that still looks like a schedule. Whether a non-grid view may fetch
   * unbounded is an open maintainer decision (objectui#7210, half 2) — this
   * line is correct whichever way that lands, which is why it did not wait for
   * it.
   *
   * ⛔ Nor does suppressing the bar make this component's query dead: `data`
   * still gates the loading skeleton and the load-error panel (so it decides
   * whether the chart mounts at all), feeds `UserFilters`' option counts, and
   * is what the client-side CSV/JSON export writes out. Measured with the paged
   * response delayed: while it was in flight the skeleton was up and the chart
   * had 0 rows, though its own unbounded response had already arrived.
   *
   * objectui#7189 adds the second surface that draws rows it queried itself: a
   * grouped grid grouping on the server (`gridOwnsGroupedFetch`). Its group
   * headers carry the true counts and every group pages its own rows, so this
   * bar's "N records · Showing first N" would describe a window it never drew.
   * objectui#10881 adds the refused grouped grid (`groupingNeedsHeaderQuery`),
   * which draws no rows at all. objectui#12619 adds the board that pages its
   * own lanes (`kanbanLanesPaged`); the footer shows the view's total for it
   * instead (`boardRecordCountShown`).
   */
  /**
   * Does the board query its own lanes? (objectui#12619)
   *
   * A board under this view used to draw this component's window — on a view
   * declaring `pagination.pageSize: 25`, the grid's first 25 rows — bucketed
   * into lanes on the client. Measured on HotCRM's 45 opportunities: 25 cards,
   * the closed columns at 0, and the footer's "Showing first 25 records". A
   * lane is a query of its own, so the board is handed NO rows: it asks each
   * lane for its first page and its count (`lanePaging` on `ObjectKanban`),
   * under the same effective filter, search and sort this component would have
   * sent. The window this component still fetches feeds what it always fed
   * besides the board — the empty state, the export, the filter option counts —
   * and its total is the record count the footer shows for the board.
   *
   * Only where the lanes are known before the query — the lane field's options
   * in the object definition — and with no swimlane grouping, because those
   * are the boards that page their lanes; any other board keeps the window, as
   * before. Only where THIS component fetches: rows handed in whole stay whole.
   */
  const kanbanLaneField = currentView === 'kanban' ? kanbanLaneFieldOf(schema, objectDef) : undefined;
  const kanbanLaneOptions: unknown = kanbanLaneField ? objectDef?.fields?.[kanbanLaneField]?.options : undefined;
  const kanbanLanesPaged =
    !!kanbanLaneField &&
    Array.isArray(kanbanLaneOptions) &&
    kanbanLaneOptions.length > 0 &&
    !(groupingConfig?.fields?.length) &&
    !Array.isArray(schema.data) &&
    (schema.data as any)?.provider !== 'value' &&
    !!schema.objectName &&
    typeof dataSource?.find === 'function';

  const surfaceDrawsFetchedRows =
    currentView !== 'gantt' && !gridOwnsGroupedFetch && !groupingNeedsHeaderQuery && !kanbanLanesPaged;

  // objectui#10572 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10494 way: the nonce moves when a
  // write to the object this list QUERIES is declared, and the fetch effect
  // below names it, so the rows are re-read in place (`RefreshIndicator` over
  // the current rows, no remount). A page action over raw HTTP fires no
  // `onMutation`, so the subscription above cannot see it; the bus can.
  // Subscribed only when the list fetches for itself — inline rows are not
  // this effect's query.
  const listFetchesForItself =
    !Array.isArray(schema.data) && (schema.data as any)?.provider !== 'value';
  const invalidationNonce = useDataInvalidation(listFetchesForItself ? schema.objectName || undefined : undefined);

  /**
   * The calendar's date bindings, for the fetch effect's window
   * (objectui#12081): the same two reads the calendar branch below makes for
   * the node it hands the calendar, so the window is on the field the calendar
   * draws by. Declared bindings only (objectui#7029): an undeclared one stays
   * absent. ⚠️ Change one pair, change both.
   */
  const calendarStartField: string | undefined =
    schema.calendar?.startDateField || schema.options?.calendar?.startDateField || undefined;
  const calendarEndField: string | undefined =
    schema.calendar?.endDateField || schema.options?.calendar?.endDateField || undefined;

  /**
   * Does this view fetch a DATE WINDOW for the calendar it hosts?
   * (objectui#12081 item 2.)
   *
   * A hosted calendar draws the rows this component fetched. That fetch used
   * to be the one unpaged window every non-grid kind gets — the first
   * `DEFAULT_LIST_FETCH_BATCH_SIZE` records of the object, with no date
   * condition — so a month holding more than one batch drew whichever records
   * came first and never the rest (objectstack-ai/hotclm#87: 122 contracts, up
   * to 22 never drawn), with this view's "Showing first 100 records" as the only
   * sign. Now the fetch selects the days the calendar draws, on its start field
   * (and end field, where one is bound), and walks them in fetch-batch steps up
   * to the platform's non-grid ceiling (objectui#7210, ruling a′), whose
   * footnote this view draws under the calendar when it bites. ⛔ No bigger
   * `$top`: the step stays the batch (objectui#9853).
   *
   * Only where this component fetches, and only with a start binding: without
   * one the calendar draws its refusal (objectui#7029), and there is no field
   * to window on.
   *
   * The window comes from the calendar, which alone knows the days it draws:
   * `ObjectCalendar` reports them through `onVisibleRangeChange`. Until it
   * does, the window covers any month grid today can open on
   * (`initialCalendarWindow`), so the first fetch does not wait for the
   * calendar to mount and the calendar's first report falls inside it.
   */
  const calendarWindowed = currentView === 'calendar' && listFetchesForItself && !!calendarStartField;
  // The window this view fetches for the calendar, and whether its last fetch
  // stopped at the ceiling: a truncated window is asked again for a narrower
  // range even when it covers it, since the narrower one may fit.
  const [heldCalendarWindow, setHeldCalendarWindow] = React.useState<{ window: CalendarWindow; truncated: boolean }>(
    () => ({ window: initialCalendarWindow(), truncated: false }),
  );
  const calendarWindow = heldCalendarWindow.window;
  // The ceiling result of the last window fetch, for the footnote.
  const [calendarCeiling, setCalendarCeiling] = React.useState<NonGridCeilingResult | null>(null);
  // The host callback the calendar reports its days through. A `useState`
  // initialiser, so its identity is React's guarantee rather than a memo's
  // (AGENTS.md #10); it reads only a setter. A range the held window already
  // covers moves nothing, so the calendar's first report, a view change inside
  // the month or the phone's switch to the day view asks for nothing.
  const [handleCalendarVisibleRange] = React.useState(() => (range: CalendarVisibleRange) => {
    const next = calendarWindowFor(range);
    setHeldCalendarWindow((held) =>
      calendarWindowCovers(held.window, next) && !held.truncated ? held : { window: next, truncated: false },
    );
  });
  // Leaving the calendar drops its window: the view pane is keyed on
  // `currentView`, so a calendar shown again is a new one, opening on today.
  // Adjusted during render, when the view changes, rather than in an effect, so
  // a calendar shown again never fetches the window the last one was left on.
  const [calendarWindowForView, setCalendarWindowForView] = React.useState(currentView);
  if (calendarWindowForView !== currentView) {
    setCalendarWindowForView(currentView);
    if (currentView !== 'calendar') {
      setHeldCalendarWindow({ window: initialCalendarWindow(), truncated: false });
      setCalendarCeiling(null);
    }
  }
  // The window as the fetch effect's dependency: a string, compared by value,
  // and empty when this view is not windowing, so the window of a calendar
  // that is not on screen re-runs nothing.
  const calendarWindowKey = calendarWindowed ? `${calendarWindow.from}/${calendarWindow.to}` : '';

  // objectui#10689 — the fetch effect's dep on the three view-level PREDICATE
  // carriers its projection harvests (objectui#3501), as a CONTENT key over the
  // operand NAMES alone: the shape `plugin-grid`'s `predicateProjectionKey`
  // takes for the grid's own load effect.
  //
  // The effect below reads `conditionalFormatting`, `rowActionDefs` and
  // `bulkActionDefs` through `listViewPredicates` and adds each operand to
  // `$select`, but none of the three was a dependency. So a rule added to a
  // mounted list never had its operand fetched: the rows kept arriving without
  // the field, and the rule, which reads it, never matched.
  //
  // Names ONLY: a rule's style, or an action's label, is a render-time concern
  // the projection cannot see, so changing it costs no round trip. The same
  // harvest over the same three inputs as the effect's; the object-level
  // `actions` / `userActions` it adds come from `objectDef`, not from the view,
  // and are outside this key. The `rowActionDefs` cast is
  // the NON-AUTHOR SURFACE exemption stated at the effect's own read of that
  // key. `__tests__/ListView.harvestInputsFetchKey-10689.test.tsx` pins each
  // input.
  const conditionalFormattingRaw = schema.conditionalFormatting as readonly unknown[] | undefined;
  const rowActionDefsRaw = (schema as { rowActionDefs?: readonly unknown[] }).rowActionDefs;
  const bulkActionDefsRaw = (schema as { bulkActionDefs?: readonly unknown[] }).bulkActionDefs;
  const predicateProjectionKey = React.useMemo(
    () => JSON.stringify(collectPredicateFieldRefs(listViewPredicates({
      conditionalFormatting: conditionalFormattingRaw,
      rowActionDefs: rowActionDefsRaw,
      bulkActionDefs: bulkActionDefsRaw,
    }))),
    [conditionalFormattingRaw, rowActionDefsRaw, bulkActionDefsRaw],
  );

  // Fetch data effect — supports schema.data (ViewDataSchema) provider modes
  React.useEffect(() => {
    let isMounted = true;
    const requestId = ++fetchRequestIdRef.current;

    // Check for inline data via schema.data provider: 'value'
    if (schema.data && typeof schema.data === 'object' && !Array.isArray(schema.data)) {
      const dataConfig = schema.data as any;
      if (dataConfig.provider === 'value' && Array.isArray(dataConfig.items)) {
        let items = dataConfig.items;
        if (searchTerm) {
          const q = searchTerm.toLowerCase();
          items = items.filter((row: any) =>
            Object.values(row).some(
              (v) => v != null && String(v).toLowerCase().includes(q),
            ),
          );
        }
        setData(items);
        setLoading(false);
        setDataLimitReached(false);
        return;
      }
    }
    // Also support schema.data as a plain array (shorthand for value provider)
    if (Array.isArray(schema.data)) {
      let items = schema.data as any[];
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        items = items.filter((row: any) =>
          Object.values(row).some(
            (v) => v != null && String(v).toLowerCase().includes(q),
          ),
        );
      }
      setData(items);
      setLoading(false);
      setDataLimitReached(false);
      return;
    }

    // [objectui#10881] A grouped grid this data source cannot count is refused
    // before it is mounted (`groupingNeedsHeaderQuery`), so no window is
    // fetched for it, and none held: the rows of an earlier query would
    // otherwise still feed the filter option counts and the client export.
    if (groupingNeedsHeaderQuery) {
      setData([]);
      setLoading(false);
      setDataLimitReached(false);
      return;
    }

    // Wait for objectDef to load before fetching data so that $expand is computed
    if (!objectDefLoaded) return;
    
    const fetchData = async () => {
      if (!dataSource || !schema.objectName) {
        // No way to fetch — clear the loading state so the empty state
        // (or downstream view) can render instead of an indefinite skeleton.
        setLoading(false);
        return;
      }
      
      setLoading(true);
      setLoadError(null);
      setLoadErrorIsSearchRefusal(false);
      // [objectui#10384] Set when this result clamps the pager (see below).
      // The window it moves to is already being fetched, so loading stays on:
      // settling it here would paint the empty window — and with it the
      // first-run empty state — for one frame before the clamped rows arrive.
      let clampedToPage: number | null = null;
      try {
        // Construct filter — shared with the export path so the file a user
        // downloads is built from the same three sources as the rows on screen.
        const finalFilter = buildEffectiveFilter(authoredFilter, appliedFilters, appliedUserFilterConditions);

        // Convert sort to query format
        // Use array format to ensure order is preserved (Object keys are not guaranteed ordered)
        const sort: any = currentSort.length > 0
          ? currentSort
              .filter(item => item.field) // Ensure field is selected
              .map(item => ({ field: item.field, order: item.order }))
          : undefined;

        // Build a $select projection from the columns the listview actually
        // shows (plus required relational keys). This trims server payload
        // significantly for wide objects.
        //
        // FLS: also drop columns the current user cannot read. Sending a
        // denied field in $select would leak the value at the server
        // boundary even though the UI hides it — server-side trust must
        // never be defeated by what the client requests.
        const selectFields = (() => {
          const rawCols = Array.isArray(schema.columns)
            ? (schema.columns as any[])
                .map(f => columnIdentity(f))
                .filter((v): v is string => typeof v === 'string' && v.length > 0)
            : [];
          // [objectui#10275] "Is there a projection?" is asked of the AUTHORED
          // columns, never of what survived the FLS gate below — the rule
          // `hasAuthoredColumns` applies to what the grid draws. No authored
          // column ⇒ no `$select`, as before. An authored list that FLS EMPTIES
          // used to land here too, so the request carried no `$select` key and
          // asked for every field, the denied ones included: an emptied list
          // read as "no restriction", the widening objectui#7215 measured on
          // `$expand`. It now falls through and projects to `id` plus the
          // routes below, each already FLS-gated as it enters (the `$expand`
          // roots, the view bindings, the grouping fields, the row predicates'
          // operands; the platform columns excepted, for the reason stated at
          // `addSpeculative`) — the shape `ObjectGrid` (`ensureId([])` keeps
          // `['id']`) and `RelatedList` (objectui#10186) send.
          if (rawCols.length === 0) return undefined;
          const cols = (perms?.isLoaded && schema.objectName)
            ? rawCols.filter(c => perms.checkField(schema.objectName!, c, 'read'))
            : rawCols;
          // Don't speculatively add `_id` / `name` — some backends reject
          // unknown select keys with an empty result set rather than
          // ignoring them. Stick to the user-requested columns plus the
          // expanded relation roots (which we know are valid because
          // buildExpandFields() derived them from the object schema).
          const required = new Set<string>(['id']);
          for (const c of cols) required.add(c);
          for (const e of expandFields) required.add(e);

          // Real fields of the object, used to gate the SPECULATIVE
          // view-binding fields below. The comment above is the tell: "some
          // backends reject unknown select keys with an empty result set
          // rather than ignoring them" — the cloud multi-tenant runtime does
          // exactly that, so a single unknown column in $select silently
          // zeroes the whole list (an AI-built `product` view auto-requesting
          // `status`/`due_date`/`image` then looks like "no data exists").
          // The user-declared `cols` and `expandFields` are already
          // known-valid (perms.checkField / buildExpandFields derived them
          // from the schema); only the auto-included view-binding fields are
          // unsafe. When the object schema isn't loaded yet we can't
          // validate, so we keep the prior permissive behavior (the data
          // fetch waits for objectDefLoaded, so this is virtually never hit).
          const knownObjectFields = (() => {
            const f = objectDef?.fields;
            if (!f) return null;
            const names = Array.isArray(f)
              ? (f as any[]).map(x => x?.name).filter((n): n is string => typeof n === 'string')
              : Object.keys(f);
            const s = new Set<string>(names);
            s.add('id'); s.add('created_at'); s.add('updated_at');
            return s;
          })();
          // [objectui#7216] TWO gates, asked in this order and of this
          // population — they answer unrelated questions and neither
          // substitutes for the other:
          //
          //   1. KNOWN-FIELD gate (above) — keeps an UNKNOWN key out, because
          //      some backends answer an unknown `$select` key with an EMPTY
          //      result set rather than ignoring it.
          //   2. FLS gate (here) — keeps a KNOWN BUT DENIED key out, because
          //      sending it leaks the value at the server boundary even though
          //      the UI hides it (objectui#6898).
          //
          // A field can be perfectly well-declared and still denied; that is
          // the case this helper did not handle. The user-declared `cols` are
          // FLS-filtered a few lines up, so every OTHER route into `$select`
          // was gated and this one — the auto-included view bindings, the
          // predicate refs, the grouping fields — was not.
          //
          // ⚠️ ORDER IS LOAD-BEARING (objectui#7179's shape): intersect against
          // the declared fields FIRST, ask `checkField` only about the
          // survivors. `checkField` answers **false for an undeclared key**, so
          // asking it first would drop derived and computed bindings that are
          // not real object fields — and would be the REASON they were dropped,
          // which is a different and much worse failure than the known-field
          // gate declining them.
          //
          // ⚠️ The platform columns are carved out for the same reason they are
          // carved out of `addPredicateField`: every object CARRIES them and
          // none DECLARES them, so no field policy mentions them and
          // `checkField` answers false for every one. Without the carve-out a
          // calendar bound to `created_at` would go blank for everybody.
          const addSpeculative = (f: unknown) => {
            if (typeof f !== 'string' || !f) return;
            if (knownObjectFields && !knownObjectFields.has(f)) return;
            if (perms?.isLoaded && schema.objectName
                && knownObjectFields?.has(f)
                && !PLATFORM_RECORD_COLUMNS.has(f)
                && !perms.checkField(schema.objectName, f, 'read')) return;
            required.add(f);
          };
          // Predicate refs take the same guard, widened by the platform columns
          // every object carries but no object DECLARES (`owner_id` and the
          // audit FKs) — `record.owner_id == os.user.id` is the commonest
          // ownership gate there is, and `knownObjectFields` alone drops it.
          const addPredicateField = (f: string) => {
            if (PLATFORM_RECORD_COLUMNS.has(f)) required.add(f);
            else addSpeculative(f);
          };

          // View-specific runtime fields. Each non-grid view binds to one
          // or more record fields (groupBy for kanban, dates for calendar/
          // timeline/gantt, image/title for gallery). Without these in the
          // projection the view renders correctly-shaped records but with
          // blank values — e.g. a kanban grouped by `industry` puts every
          // card into the implicit "no value" column. Added via
          // addSpeculative so a binding naming a field this object lacks is
          // dropped instead of poisoning the query.
          const collectViewFields = (v: any) => {
            if (!v) return;
            const candidates = [
              // The blocks' spec keys only, as in the `expandFields` twin
              // (objectui#6152 round 14 retired the aliases and knobs there).
              v.groupByField,
              v.summarizeField,
              v.titleField,
              v.startDateField, v.endDateField,
              v.colorField, v.allDayField,
              v.coverField,
              // The map's row reads (objectui#10370): `ObjectMap` places a
              // marker from `locationField` or the `latitudeField` +
              // `longitudeField` pair (`extractCoordinates`) and shows
              // `descriptionField` under it. Its title rides `titleField` above.
              // The `expandFields` twin collects all of these but the
              // description, for the reason stated there.
              v.locationField, v.latitudeField, v.longitudeField,
              v.descriptionField,
              // Spec `columns` = the fields shown on each kanban card.
              // ⛔ No timeline chip-field list (the retired `metaFields`) is
              // collected: the spec declares none, and the timeline no longer
              // reads one (objectui#10222).
              ...(Array.isArray(v.columns) ? v.columns : []),
              ...(Array.isArray(v.visibleFields) ? v.visibleFields : []),
            ];
            for (const f of candidates) addSpeculative(f);
          };
          collectViewFields(schema.kanban);
          collectViewFields(schema.options?.kanban);
          collectViewFields(schema.calendar);
          collectViewFields(schema.options?.calendar);
          collectViewFields(schema.gallery);
          collectViewFields(schema.options?.gallery);
          collectViewFields(schema.timeline);
          collectViewFields(schema.options?.timeline);
          // Timeline plugin shows status / priority chips inline. Auto-include
          // them for every timeline view so views like `task_timeline`
          // ({ columns: ['subject', 'status'] }) still get priority badges out
          // of the box. Gated through addSpeculative: only added when the
          // object actually has these fields (a `product` with no
          // status/priority must not get them, or the list goes empty).
          //
          // Unconditional on purpose (objectui#10222, ruling batch #223 item
          // 5b, letter A): this used to be skipped when the block carried an
          // undeclared `metaFields` list, which the spec refuses and the
          // timeline no longer reads. The chips are always the built-in pair
          // now, so their values are always fetched.
          {
            const tCfg = schema.timeline ?? schema.options?.timeline;
            if (tCfg) {
              addSpeculative('status');
              addSpeculative('priority');
            }
          }
          collectViewFields(schema.gantt);
          collectViewFields(schema.options?.gantt);
          // [objectui#10370] The MAP's bindings, which this collector had no
          // arm for: a map view whose columns omit its location field asked
          // for `id` plus those columns, and on a backend that honours
          // `$select` every row arrived without coordinates — a map with no
          // markers, no error, no warning.
          //
          // Read through `resolveListMapConfig`, the resolver `case 'map'` and
          // the capability gate already share, not through `schema.map` and
          // `schema.options?.map` one at a time: it reads both of those, per
          // key with the view-level block winning, so the projection asks for
          // exactly the bindings the markers are drawn from. A bag value the
          // block shadows is read by nothing and is not requested. A top-level
          // `locationField` is no spelling at all — the spec's list view
          // refuses it by name and no map branch reads it — so it stays out.
          //
          // Through `addSpeculative`, like every binding here: a location field
          // the principal may not read is never requested, and a name the
          // object does not declare is never sent.
          collectViewFields(resolveListMapConfig(schema));

          // The fields the view's PREDICATES read (objectui#3501).
          // `$select` was built from the COLUMNS alone, so a row action gated on
          // `record.owner` while the view shows Title / Status asked the server
          // for everything except `owner` — and an absent key is a CEL FAULT
          // (`No such key`), not a null, which fail-closed hides the button for
          // everyone. Routed through addSpeculative for the same reason the view
          // bindings are: a typo'd predicate must not put an unknown column in
          // `$select` and zero the whole list.
          // [objectui#7179] The GRID's grouping fields. `collectViewFields`
          // above covers every OTHER view kind's grouping — they all spell it
          // `groupByField`, a plain string — but the grid spells it
          // `grouping.fields[]`, so it had no arm here and its projection was
          // built from `columns` alone. The measured symptom: one group
          // labelled `(empty)` holding every row, no error, no warning.
          //
          // Through `addSpeculative` for the reason stated at its definition,
          // which applies to a `grouping.fields[]` entry more sharply than to
          // anything else routed through it: this card's whole premise is that
          // the grouping field is NOT a column, so it has never been through
          // column validation, and `GroupingFieldSchema.field` is a bare
          // string. Unioned unguarded on a backend that rejects unknown
          // `$select` keys with an empty result set, it would turn one
          // `(empty)` group holding 186 rows into ZERO rows, just as silently.
          //
          // FLS-gated on top (objectui#6898): the grid half of this same fix
          // takes `passesProjectionGate`, and a grouping field can name a
          // denied field exactly as a column can.
          //
          // [objectui#7216] That FLS check used to live in an `addGroupingField`
          // wrapper right here. It now lives INSIDE `addSpeculative`, with a
          // byte-identical predicate, because every OTHER caller of that helper
          // needed the same gate and gating them one call site at a time is how
          // this asymmetry arose in the first place. The wrapper is gone rather
          // than left as a duplicate: two spellings of one gate is the shape
          // that lets them drift. `ListView.speculativeFls-7216.test.tsx` PIN 9
          // pins this path through the moved gate — plugin-list had no FLS pin
          // for grouping before it.
          for (const f of collectGroupingFieldRefs(groupingConfig)) addSpeculative(f);

          // [objectui#12376] The ROW COLOUR's field, which this harvest had no
          // arm for. `useRowColor` looks each row's `row[field]` up in the
          // `colors` map, and the spec's `rowColor.field` sets no column
          // requirement — so a list tinted by a field that is not a column
          // fetched rows without it and painted nothing, with no error.
          //
          // Read from `rowColorConfig`, the state a pick in the toolbar's
          // Color section replaces, not from `schema.rowColor`: the projection
          // follows the colour the list actually draws. ⛔ It is not in this
          // effect's dependency list on purpose: both Color pickers (the
          // toolbar's and `ViewSettingsPopover`'s) offer the COLUMNS only
          // (`allFields`), which every request already carries, so a pick
          // needs no new request; the next one simply reads the current rule.
          // Through
          // `addSpeculative`, like every binding here: a field the viewer may
          // not read is never requested (`offeredRowColorConfig` withholds the
          // whole rule from that viewer too), and a name the object does not
          // declare is never sent.
          addSpeculative(rowColorConfig?.field);

          // [objectui#11815] A shown DECLARED deadline's `settledWhen`
          // operands. The cells judge `isDeadlineSettled` against the row
          // they draw, and an absent key is a CEL fault (`No such key`), not
          // a null — so a list showing Title and Due but not `status` fetched
          // rows without it, and a done row's deadline still read overdue.
          // Asked of the columns that survived the FLS gate (`cols`): a
          // deadline the viewer may not read is not drawn, so nothing judges
          // it. Through `addSpeculative`, like every binding here: an operand
          // the viewer may not read is never requested, and that row's
          // deadline then stays unsettled (it fails toward overdue).
          const deadlineDefs = objectDef?.fields as Record<string, { dueLike?: unknown; settledWhen?: unknown } | undefined> | undefined;
          for (const f of collectPredicateFieldRefs(
            cols
              .map((c) => deadlineDefs?.[c])
              .filter((def) => def?.dueLike === true && def.settledWhen != null)
              .map((def) => def!.settledWhen),
          )) addSpeculative(f);

          // [objectui#13036] A shown `referenceVia` pointer column's TYPE
          // half. The grid draws such a column through `resolveRecordPointer`
          // (objectui#12608), which reads the sibling the field names off the
          // ROW and answers null when it is absent, so a list whose columns
          // show the id half but not its sibling fetched rows without it and
          // drew the raw record id. Asked of the columns that survived the
          // FLS gate (`cols`): a pointer the viewer may not read is not drawn.
          // Through `addSpeculative`, like every binding here: a sibling the
          // viewer may not read is never requested (that row keeps the stored
          // text, the half-addressed control), and a name the object does not
          // declare is never sent. `ObjectGrid`'s `getSelectFields` carries the
          // same arm for the fetch a grouped grid owns.
          const pointerDefs = objectDef?.fields as Record<string, { referenceVia?: unknown } | undefined> | undefined;
          for (const c of cols) addSpeculative(pointerDefs?.[c]?.referenceVia);

          // [objectui#13214] A shown column's DECLARED `dependsOn` siblings.
          // A faced column reads them off the ROW (`dependentValues={row}`):
          // the `recipient-picker` face names a stored id by the row's
          // `recipient_type`, and draws the stored text when it is absent. So
          // a list showing `recipient_id` but not `recipient_type` fetched
          // rows without the kind and drew the raw user id. Driven by the
          // declaration alone: every sibling the field names, nothing mapped
          // by name here. Asked of the columns that survived the FLS gate
          // (`cols`) and that the grid draws: a column authored `hidden: true`
          // pulls nothing. Through `addSpeculative`, like every binding here:
          // a sibling the viewer may not read is never requested, and a name
          // the object does not declare is never sent. `ObjectGrid`'s
          // `getSelectFields` carries the same arm for the fetch a grouped
          // grid owns.
          const hiddenColumns = new Set(
            (Array.isArray(schema.columns) ? (schema.columns as unknown[]) : [])
              .filter((c) => !!c && typeof c === 'object' && (c as { hidden?: unknown }).hidden === true)
              .map((c) => columnIdentity(c)),
          );
          const dependsOnDefs = objectDef?.fields as Record<string, { dependsOn?: DependsOnInput } | undefined> | undefined;
          for (const c of cols) {
            if (hiddenColumns.has(c)) continue;
            for (const f of resolveDependsOnFields(dependsOnDefs?.[c]?.dependsOn)) addSpeculative(f);
          }

          // [objectui#13116] The object's DECLARED name field. The bulk
          // confirm step names each affected record from the rows this fetch
          // hands the grid (`BulkActionDialog`, objectui#13107), so a
          // `nameField` no column shows arrived absent and the step fell to
          // the `Record #ID` floor. Read through `declaredNameField`, the
          // resolver's single spelling of the pointer, and asked by name
          // whatever its type: the server serves a formula field like any
          // other. Fetched, never drawn: it joins the projection, not the
          // columns. Through `addSpeculative`, like every binding here: a name
          // field the viewer may not read is never requested, and a pointer
          // the object does not declare is never sent. `ObjectGrid`'s
          // `getSelectFields` carries the same arm for the fetch a grouped
          // grid owns.
          addSpeculative(declaredNameField(objectDef));

          for (const f of collectPredicateFieldRefs(listViewPredicates({
            conditionalFormatting: schema.conditionalFormatting as unknown[] | undefined,
            /**
             * NON-AUTHOR SURFACE, cast on purpose — objectui#5091's 2026-08-19
             * ruling, extended to this reader by objectui#8653 item 2.
             *
             * `rowActionDefs` is PRODUCER-DERIVED, not authored: `app-shell`'s
             * `ObjectView` builds it from `objectDef.actions` filtered by
             * `locations.includes('list_item')` and writes it onto a
             * `fullSchema: ListViewSchema`; `plugin-view`'s `ObjectView`
             * composes the same key onto a `list-view` node. `@objectstack/spec/ui`
             * REFUSES it by name on both the list and the grid surface, and
             * `@object-ui/types` declares it on neither mirror — which is why
             * the read is a cast and ⛔ why declaring it would publish a key
             * the save gate rejects.
             *
             * ⛔ DO NOT delete this read to "tidy up" an unexplained cast. The
             * defs carry `visible` / `disabled` CELs and `recordIdField`, and
             * this is the harvest that puts their operands into `$select`.
             * Dropping it returns a row whose predicate operand was never
             * selected — objectui#3501's fail-closed CEL fault (`No such key`)
             * arriving with a success receipt. Pinned by name in
             * `__tests__/listViewNonAuthorKeys-8653.test.tsx` §4 SITE 2; the
             * declared sibling `bulkActionDefs` is that pin's control.
             */
            rowActionDefs: (schema as any).rowActionDefs,
            bulkActionDefs: (schema as any).bulkActionDefs,
            objectActions: (objectDef as any)?.actions,
            // KEY COLLISION — `userActions` names TWO different blocks, and
            // only the OBJECT's is interpretable here. This read is therefore
            // `objectDef`-only; it must never regain a
            // `(schema as any).userActions ??` left operand. Maintainer ruling
            // of 2026-08-20 on objectui#5240 (Q1=A), whose `plugin-grid` half
            // landed as objectui#5426 — this is the sibling read site named in
            // that ruling (objectui#5398), carrying the same shape and the same
            // reason on purpose rather than a second spelling of one fix. The
            // measurements, re-taken here against `@objectstack/spec@17.0.0`:
            //
            //   - VIEW-level `userActions` is TOOLBAR POLICY —
            //     `UserActionsConfigSchema` (`sort`, `search`, `filter`,
            //     `refresh`, `rowHeight`, `addRecordForm`, `editInline`,
            //     `buttons`), which REJECTS `edit` BY NAME
            //     (`unrecognized_keys`). `ListViewSchema` accepts it, so it is
            //     spec-legal and really authored — it is the very block
            //     `toolbarFlags` and `inlineEditOffered` read above, and
            //     `normalizeListViewSchema` MANUFACTURES one from a legacy
            //     `show*` view that never wrote the key at all.
            //   - OBJECT-level `userActions` is the CRUD-PREDICATE block
            //     (`edit` / `delete` / `create` carrying `visibleWhen` /
            //     `disabledWhen`, objectui#2614) — what
            //     `resolveEffectiveCrudAffordances` / `isObjectInlineEditable`
            //     consume off `objectDef` above, and the only shape
            //     `listViewPredicates` can read: its loop skips every
            //     non-object value, so a toolbar block yields ZERO predicates.
            //
            // Read view-first, a legitimately authored toolbar block therefore
            // SHADOWED the object's CRUD predicates and dropped their operands
            // from `$select`; CEL then faults `No such key`, fails CLOSED, and
            // the row Edit/Delete button vanishes for everyone with nothing
            // pointing at the projection (objectui#3501 — the whole reason this
            // harvest exists, stated six lines up).
            //
            // On THIS component the shadowing was TOTAL rather than occasional:
            // `app-shell/src/views/ObjectView.tsx` builds the `userActions` it
            // hands down as an object literal of two spreads, so the left
            // operand was `{}` at worst — never nullish, so `??` never fell
            // through and the object's CRUD block was never reached AT ALL on
            // that path.
            //
            // Pinned by `__tests__/ListView.userActionsCollision.test.tsx`.
            userActions: (objectDef as any)?.userActions,
          }))) addPredicateField(f);

          // [objectui#12292] The rows' concurrency token, which the grid's
          // inline-edit save sends as `If-Match`. A projection built from the
          // columns left it off every row no column showed it on, and that
          // save went out with no token. It is a platform column, admitted by
          // the same rule as a predicate operand.
          if (rowsCarryConcurrencyToken) addPredicateField('updated_at');

          return Array.from(required);
        })();

        // [objectui#12081] A hosted calendar's fetch is its date window (see
        // `calendarWindowed`): the window's node joins the effective filter
        // under one `and`, so every view filter, panel filter, user filter and
        // search still narrows it.
        const calendarWindowNode = calendarWindowed && calendarStartField
          ? calendarWindowFilter(calendarWindow, calendarStartField, calendarEndField)
          : undefined;
        const queryFilter = calendarWindowNode ? mergeFilterNodes(finalFilter, calendarWindowNode) : finalFilter;

        // Only send $filter when there is one. Sending an empty array results in
        // `?filter=%5B%5D` which is wasted bandwidth and can defeat server-side
        // query parsing/caching. `buildEffectiveFilter` returns a non-empty AST
        // or `undefined`, so this is the whole test.
        const hasFilter = queryFilter !== undefined;

        // `fetchSkip` is resolved at render (see its definition) and named in
        // this effect's dependency list, so what reaches the wire and what
        // re-runs this effect are the same number — there is no second
        // spelling free to drift from it.
        const skip = fetchSkip;

        // Hoisted out of the `find` call so the exact params that produced this
        // window can be handed down with it (objectui#4501). One object, one
        // query — a second literal reconstructed for the consumer would be a
        // copy free to drift from what was actually asked.
        const findParams: Record<string, unknown> = {
           ...(hasFilter ? { $filter: queryFilter } : {}),
           $orderby: sort,
           // [objectui#12081] The calendar's window is walked in fetch-batch
           // steps, so its first request asks for the batch; the walk sets
           // each later step's `$top` and `$skip` itself.
           $top: calendarWindowNode ? DEFAULT_LIST_FETCH_BATCH_SIZE : effectivePageSize,
           ...(skip > 0 ? { $skip: skip } : {}),
           ...(selectFields ? { $select: selectFields } : {}),
           ...(expandFields.length > 0 ? { $expand: expandFields } : {}),
           ...(searchTerm ? {
             $search: searchTerm,
             ...(schema.searchableFields && schema.searchableFields.length > 0
               ? { $searchFields: schema.searchableFields }
               : {}),
           } : {}),
        };

        // Stale request guard: only apply the latest request's results
        const isCurrentRequest = () => isMounted && requestId === fetchRequestIdRef.current;

        let results: unknown;
        let items: any[];
        // [objectui#12081] The calendar's date window, walked to its end or to
        // the platform ceiling (objectui#7210, ruling a′). The walk returns the
        // probe row past the ceiling, and `applyNonGridRowCeiling` cuts it off
        // and says whether it had to, for the footnote under the calendar.
        let windowCeiling: NonGridCeilingResult | null = null;
        if (calendarWindowNode) {
          const objectName = schema.objectName;
          const walked = await fetchCalendarWindow(
            (params) => dataSource.find(objectName, params),
            findParams,
            DEFAULT_LIST_FETCH_BATCH_SIZE,
            readListRows,
            isCurrentRequest,
          );
          if (walked === null) return;
          windowCeiling = applyNonGridRowCeiling(walked);
          results = walked;
          items = windowCeiling.rows;
        } else {
          results = await dataSource.find(schema.objectName, findParams);
          if (!isCurrentRequest()) return;
          items = readListRows(results);
        }

        setData(items);
        if (windowCeiling) {
          const truncated = windowCeiling.truncated;
          setHeldCalendarWindow((held) => (held.truncated === truncated ? held : { ...held, truncated }));
        }
        setCalendarCeiling(windowCeiling);

        // Capture the real match total (objectstack-ai/objectstack#2212: findData now returns it).
        // With a known total the grid pages server-side, so the "showing first N"
        // cap warning no longer applies; without one we fall back to the old
        // single-window behaviour and keep the warning.
        // `total` only — the ONE count member `QueryResult` declares. The
        // `count` arm that used to sit behind it is gone on a measured zero
        // (objectui#6917): no `find()` producer in the repo emits `count`.
        const rawTotal = (results && typeof results === 'object')
          ? (results as any).total
          : undefined;
        const knownTotal = typeof rawTotal === 'number' ? rawTotal : null;
        // RAW, not gated on the surface: `serverTotal` applies that gate at
        // render (objectui#7394), so this effect no longer has to re-run just
        // because a different visualization is now drawing the same rows.
        setFetchedTotal(knownTotal);
        // [objectui#10384] Clamp the pager after a write empties this window.
        // `pageResetSignature` below deliberately leaves the refresh inputs out
        // (a write must not throw the user back to page 1), so a refetch that
        // lands on a page the data no longer reaches — every row of the last
        // page bulk-deleted, or a concurrent deleter — used to stay there with
        // zero rows and the FIRST-RUN empty state over an object that still
        // has records on earlier pages. The clamp lives HERE, on the result,
        // because only the result knows the page is now past the end.
        //
        // It fires only when this window came back empty past the first page
        // AND the server's total puts the last page strictly below the one
        // requested; it then moves `serverPage` there, which moves `fetchSkip`
        // and re-runs this effect once. It cannot loop: each firing strictly
        // lowers the page and the target is floored at 1, so the chain ends
        // at the first window the total says is reachable. A server whose
        // total disagrees with its own empty window (total still reaching this
        // page) gets no clamp, which is the other half of that guarantee.
        // Without a numeric total the grid is never handed a pager (the
        // `serverTotal != null` gate on the handoff), so no page past 1 is
        // reachable to clamp from.
        if (skip > 0 && items.length === 0 && knownTotal !== null) {
          const lastReachablePage = Math.max(1, Math.ceil(knownTotal / effectivePageSize));
          const requestedPage = Math.floor(skip / effectivePageSize) + 1;
          if (lastReachablePage < requestedPage) {
            clampedToPage = lastReachablePage;
            setServerPage(lastReachablePage);
          }
        }
        // Past the stale-request guard, so this is the query behind the rows
        // that were just set — never an in-flight one that lost the race.
        setLastFindParams(findParams);
        // Saturation of the window THIS request carried, and nothing else.
        // The "…but the real total is known, so nothing is hidden" half of the
        // old expression moved to the banner's own render gate below, for the
        // same reason `serverTotal` did (objectui#7394).
        // A calendar's window is walked to its end, so it hides no reachable
        // row behind a batch: when the ceiling stops it, the a′ footnote says
        // so instead (objectui#12081).
        setDataLimitReached(!calendarWindowNode && items.length >= effectivePageSize);
      } catch (err) {
        // Only log + surface errors from the latest request. A failed fetch is
        // NOT an empty result — record it so the render shows an error panel
        // (with retry) rather than "Create your first record".
        if (requestId === fetchRequestIdRef.current) {
          console.error("ListView data fetch error:", err);
          setData([]);
          setLoadError((err as any)?.message ? String((err as any).message) : String(err ?? 'Unknown error'));
          setLoadErrorKind(classifyLoadError(err));
          setLoadErrorIsSearchRefusal(
            // `searchTerm` is what put `$search` on this request's params.
            !!searchTerm && (err as { code?: unknown } | null)?.code === 'INVALID_FIELD',
          );
        }
      } finally {
        if (isMounted && requestId === fetchRequestIdRef.current && clampedToPage === null) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => { isMounted = false; };
    // objectui#6697 — this effect names the `expandFields` memo's INPUTS, not
    // the memo's OUTPUT. `useMemo` is a pure optimisation, not a correctness
    // dependency: React may discard the cache and recompute even when the
    // deps compare equal, and `buildExpandFields` hands back a FRESH array on
    // every call, so naming `expandFields` here re-issued the whole
    // `dataSource.find` on a discard alone. Its inputs are all props and
    // state, which a discard cannot move — so the effect is discard-immune
    // WITHOUT losing a single re-run it used to have.
    //
    // ⚠️ A value key over `expandFields` (`JSON.stringify(...)`) is NOT the
    // route here, and this is the measured reason: `buildExpandFields`
    // collapses the whole collected set down to the relation roots, so the
    // key it produces is not content-equivalent to what this effect reads —
    // the body builds `$select` from `schema.columns` and the view bindings
    // too. It also DEFEATS objectui#4567's live-dependency pin, which drives
    // "+ Add field" on the Studio grid: that appends an unpublished field, so
    // the producer's `gridColumns` rebuilds with EQUAL content and only a new
    // identity, and a value key cannot see it. objectui#4567 ruled that
    // "ListView's by-identity dependency is correct for a real column change"
    // and put the stabilisation at the PRODUCER; naming the props keeps that
    // ruling intact.
    //
    // The sibling re-keys in this fix take the other route on purpose:
    // `RelatedList`'s memos are keyed on exactly one primitive each, and
    // `PageTabsRenderer`'s probe memo is keyed on another MEMO's output
    // (`items`), which is not discard-immune. Key on the nearest
    // discard-immune thing — props/state where they are the memo's inputs, a
    // value key where they are not.
    //
    // objectui#7394 — `currentView` is NOT named below, and `fetchSkip` is.
    // The query this effect builds never reads the visualization; it reads the
    // WINDOW, and `fetchSkip` is where the visualization reaches that window.
    // Naming `currentView` therefore re-issued an identical `find` on every
    // switch — measured in a browser as two byte-identical
    // `GET /api/v1/data/showcase_task?top=100&select=…` round trips for one
    // board. `groupingConfig` stays named: it changes the projection the
    // effect asks for, so it moves the request itself.
    //
    // ⭐ TWO names left this list, not one: `serverPage` went with
    // `currentView`, and that is the SAME removal rather than a second,
    // undescribed change. `fetchSkip` is defined above as the exact expression
    // this effect used to compute inline — `paginate ? (serverPage - 1) *
    // effectivePageSize : 0` — so the page, the page size and whether this
    // surface pages at all are folded into the one number the query carries,
    // and the effect names that number instead of its three operands.
    // `serverPage` is untouched everywhere else; the pager still reads it, and
    // `__tests__/ListView.serverPagination.test.tsx` is what re-derives that
    // turning the page still refetches with the `$skip` it moved to.
    //
    // ⚠️ One consequence follows from the DEFINITION and is deliberate, and
    // nothing in the suite re-derives it, which is why it is spelled out here
    // rather than left to be inferred from a green run: on a surface where
    // `paginate` is false, `fetchSkip` is pinned at 0, so a `serverPage` change
    // under it moves nothing and no longer re-runs this effect. The reachable
    // instance is the page-reset effect below snapping a grid back to page 1 as
    // the user leaves it for a board — a second identical request under the old
    // list. Read it as a claim about this definition, ⛔ not as a measured one.
    //
    // objectui#10881 — `groupingNeedsHeaderQuery` is named because it flips
    // this effect between fetching and standing down. It reads `currentView`, so leaving a refused grouped grid for a
    // board re-runs this effect once, and that run is the board's fetch.
    //
    // objectui#10689 — `predicateProjectionKey` is the harvested predicate
    // operands, a string compared by value; see its declaration above.
    //
    // objectui#12081 — `calendarWindowKey` is the hosted calendar's date
    // window, a string compared by value and empty on every other view, so it
    // re-runs this effect when the calendar moves to days the held window does
    // not cover, and on a switch into or out of a windowed calendar — the one
    // switch whose query changes — and on nothing else (objectui#7394).
    //
    // ⚠️ The directive below governs the NEXT LINE. Anything written between it
    // and the dependency array detaches it from the array and turns it into an
    // unused directive — which `eslint .` reports as an ERROR, and which also
    // silently un-suppresses nothing, because the finding it was suppressing
    // simply moves elsewhere. Add prose ABOVE this point, never below it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.objectName, schema.data, dataSource, authoredFilter, effectivePageSize, currentSort, appliedFilters, appliedUserFilterConditions, refreshKey, searchTerm, schema.searchableFields, schema.columns, (schema as any).kanban, (schema as any).calendar, (schema as any).gallery, (schema as any).timeline, (schema as any).gantt, schema.map, (schema as any).options, objectDef?.fields, objectDefLoaded, schema.refreshTrigger, perms, fetchSkip, groupingConfig, predicateProjectionKey, invalidationNonce, groupingNeedsHeaderQuery, calendarWindowKey, rowsCarryConcurrencyToken]); // Re-fetch on filter/sort/search/refreshTrigger/perms/window change; `rowsCarryConcurrencyToken` (objectui#12292) re-reads the rows with their token when inline edit turns on

  // Any change to the result-defining inputs (object, filters, sort, search,
  // grouping, page size) invalidates the current page number — snap back to
  // page 1 so the user never lands on a now-out-of-range window. We compare by
  // VALUE via a JSON signature (not effect deps): ListView re-initializes sort/
  // grouping references during mount, which would otherwise reset the page out
  // from under a user who just turned it. serverPage is deliberately NOT part of
  // the signature, so turning the page never triggers a reset.
  const pageResetSignature = JSON.stringify([
    schema.objectName, authoredFilter, effectivePageSize, currentSort,
    appliedFilters, appliedUserFilterConditions, searchTerm, currentView, groupingConfig,
  ]);
  const prevPageResetSignature = React.useRef(pageResetSignature);
  React.useEffect(() => {
    if (prevPageResetSignature.current !== pageResetSignature) {
      prevPageResetSignature.current = pageResetSignature;
      setServerPage(1);
    }
  }, [pageResetSignature]);

  // Available view types based on schema configuration
  const availableViews = React.useMemo(() => {
    // Capability-resolvable types: a visualization is only offered when its
    // required field bindings resolve (ADR-0047) — kanban needs a groupBy,
    // calendar a start date, etc. `grid` always renders.
    const resolvable: ListViewVisualization[] = ['grid'];

    // Check for Kanban capabilities (spec config takes precedence)
    //
    // Both nestings, by the spec key. The `options.kanban` bag was once asked
    // for the LEGACY `groupField` only, so a producer writing the SPEC key into
    // the bag was invisible here while rendering perfectly — objectui#5042
    // (`map`) and objectui#7544 (`chart`) a third time: the gate and the seam
    // must answer one question (objectui#8193). The `groupField` alias rungs
    // retired with the render branch's (objectui#6152 round 14), so the gate
    // still asks exactly what the branch below reads.
    if (schema.kanban?.groupByField || schema.options?.kanban?.groupByField) {
      resolvable.push('kanban');
    }

    // Check for Gallery capabilities (spec config takes precedence)
    //
    // Both nestings, by the spec's `coverField` (the bag's rung is objectui#6152
    // round 12, the objectui#8193 repair a fourth time). The `imageField` alias
    // rungs retired with the render branch's (objectui#6152 round 14).
    if (schema.gallery?.coverField || schema.options?.gallery?.coverField) {
      resolvable.push('gallery');
    }

    // Check for Calendar capabilities (spec config takes precedence)
    if (schema.calendar?.startDateField || schema.options?.calendar?.startDateField) {
      resolvable.push('calendar');
    }

    // Check for Timeline capabilities — the SAME resolution the render branch
    // buckets by, so the switcher can never offer a Timeline the renderer then
    // fails to bind (objectui#3129).
    if (resolveTimelineDateBinding(schema).startDateField) {
      resolvable.push('timeline');
    }

    // Check for Gantt capabilities (spec config takes precedence)
    if (schema.gantt?.startDateField || schema.options?.gantt?.startDateField) {
      resolvable.push('gantt');
    }

    // Check for Map capabilities (spec config takes precedence)
    //
    // Asked of the SAME merged config the render branch forwards
    // (`resolveListMapConfig`), not of `options.map` alone: the gate and the
    // seam must answer one question, or a view that binds its coordinates in
    // the view-level `map` block renders fine but is filtered out of
    // `allowedVisualizations` below — whitelist ∩ resolvable — and falls back
    // to `['grid']`. That is what made the spec block inert for the SWITCHER
    // even where the forward alone would have been enough (objectui#5042).
    // Sharing the resolver also means a split binding (`latitudeField` on the
    // block, `longitudeField` in the bag) is judged the way it will render.
    const mapConfig = resolveListMapConfig(schema);
    if (mapConfig.locationField || (mapConfig.latitudeField && mapConfig.longitudeField)) {
      resolvable.push('map');
    }

    // Check for Tree capabilities — a self-referencing parent pointer.
    if ((schema as any).tree?.parentField || schema.options?.tree?.parentField || schema.viewType === 'tree') {
      resolvable.push('tree');
    }

    // Check for Chart capabilities — asked of `resolveListChartBinding`, the
    // SAME resolver `case 'chart'` routes on, so the gate and the renderer can
    // never disagree about what a usable chart block is (objectui#7544). There
    // was no check here at all: a declared, whitelisted `chart:` block was
    // filtered out of the author's own whitelist and the view fell back to
    // `['grid']` — `map`'s objectui#5042 one visualization over.
    if (resolveListChartBinding(schema).resolves) {
      resolvable.push('chart');
    }

    // Always allow switching back to the viewType defined in schema — but only
    // when it names a visualization this renderer actually draws.
    //
    // The membership test was a nine-name literal array (`ca3942729`), a copy
    // of `LIST_VIEW_KINDS` in `@object-ui/core` that nothing compared against
    // it. `isListViewVisualization` IS that map's own predicate, so the gate and
    // the seam answer one question — the same rule the kanban/chart rungs above
    // were rewritten for (objectui#5042, objectui#7544). A spec-valid but
    // undrawable kind (`page`) must NOT be pushed here: offering a switch into
    // a branch that falls through to `grid` is the silent downgrade wearing a
    // button.
    if (schema.viewType && !resolvable.includes(schema.viewType as ListViewVisualization) &&
       isListViewVisualization(schema.viewType)) {
      resolvable.push(schema.viewType);
    }

    // appearance.allowedVisualizations is the author whitelist (ADR-0047):
    // effective options = whitelist ∩ resolvable. Types whose bindings don't
    // resolve are hidden even when whitelisted — a kanban without a groupBy
    // field renders garbage, so it must not be offered.
    const whitelist = schema.appearance?.allowedVisualizations;
    if (Array.isArray(whitelist) && whitelist.length > 0) {
      const filtered = whitelist.filter((v: any) => resolvable.includes(v)) as ListViewVisualization[];
      return filtered.length > 0 ? filtered : (['grid'] as ListViewVisualization[]);
    }

    return resolvable;
  }, [schema.options, schema.viewType, schema.kanban, schema.calendar, schema.gantt, schema.gallery, schema.timeline, schema.map, (schema as any).tree, (schema as any).chart, schema.appearance?.allowedVisualizations]);

  /**
   * Whether the visualization switcher is actually WORTH drawing (objectui#7547).
   *
   * `showViewSwitcher` is the author's intent, and both faces that stamp it —
   * `app-shell/ObjectView` and `app-shell/InterfaceListPage` — compute it from
   * the LENGTH of `appearance.allowedVisualizations`, which is the whitelist
   * BEFORE this component intersects it with `availableViews` above. Those two
   * numbers are not the same number: a view whitelisting `['grid', 'timeline']`
   * with no timeline block whitelists two and resolves one, so the toolbar drew
   * switcher chrome — border, dropdown affordance and separator — around a
   * single Grid entry that cannot switch to anything.
   *
   * Neither face can compute this: `availableViews` is the whitelist ∩ the
   * capability gate, and the gate lives here. So the predicate is applied at
   * the one site that holds both halves, which also means it covers BOTH doors
   * at once and cannot drift from the list the dropdown is handed.
   *
   * ⚠️ NOT a second policy layer. An author who whitelists two RESOLVABLE types
   * still gets the switcher, and an author who whitelists none still gets none;
   * the only views this changes are the ones whose chrome offered no choice.
   */
  const viewSwitcherOffered = showViewSwitcher && availableViews.length > 1;

  // Sync view from props
  React.useEffect(() => {
     if (schema.viewType) {
        setCurrentView(schema.viewType as ListViewVisualization);
     }
  }, [schema.viewType]);

  // Load saved view preference (DISABLED: interfering with schema-defined views)
  /*
  React.useEffect(() => {
    try {
      const savedView = localStorage.getItem(storageKey);
      if (savedView && ['grid', 'kanban', 'calendar', 'timeline', 'gantt', 'map', 'gallery'].includes(savedView) && availableViews.includes(savedView as ListViewVisualization)) {
        setCurrentView(savedView as ListViewVisualization);
      }
    } catch (error) {
      console.warn('Failed to load view preference from localStorage:', error);
    }
  }, [storageKey, availableViews]);
  */

  const handleViewChange = React.useCallback((view: ListViewVisualization) => {
    setCurrentView(view);
    try {
      localStorage.setItem(storageKey, view);
    } catch (error) {
      console.warn('Failed to save view preference to localStorage:', error);
    }
    onViewChange?.(view);
  }, [storageKey, onViewChange]);

  const handleSearchChange = React.useCallback((value: string) => {
    setSearchInput(value);
    onSearchChange?.(value);
  }, [onSearchChange]);

  // --- NavigationConfig support ---
  // No assertion, deliberately. `schema.navigation` is the spec-derived
  // `ListViewSchema['navigation']` and the hook's `NavigationConfig` is now the
  // spec's authored config verbatim — `mode` optional and all (objectui#4550).
  // Two spellings of one spec object, so they simply agree.
  //
  // This call carried `as NavigationConfig | undefined` from objectui#4528
  // until then. That cast bridged nothing real: the alias re-declared `mode` as
  // required while the hook it fronts defaults it (`navigation?.mode ?? 'page'`),
  // so the cast's only job was to get a valid value past an over-tight type.
  // objectui#4550 fixed that at the producer, which deleted the reason for the
  // cast — and a cast kept past its reason is how the next reader learns the
  // wrong thing about the contract. Neither the cast nor its removal touches
  // the runtime value.
  const navigation = useNavigationOverlay({
    navigation: schema.navigation,
    objectName: schema.objectName,
    onNavigate: schema.onNavigate,
    onRowClick,
  });

  // Heading of the record-detail overlay rendered at the bottom of this file.
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
  // `LIST_DEFAULT_TRANSLATIONS`.
  //
  // `label` is an `I18nLabel`, so it is a string OR an inline locale map, and
  // the map has to be resolved BEFORE it reaches the interpolation options
  // (`c1006ed8e`): `createSafeTranslation`'s options bag is a record of
  // `unknown`, so a raw map is accepted without a diagnostic and both
  // interpolators stringify it — the heading read `[object Object] Detail`.
  // This is the same resolution the view label and the nested `aria` bag
  // already do on this component's `displayLocale`.
  //
  // Resolve BEFORE the truthiness test, not inside the branch:
  // `resolveInlineI18nLabel` answers `undefined` for a map with no usable
  // entry and `''` for an empty entry, and both have to fall through to the
  // `objectName` branch the way a missing label always did. Testing the raw
  // `schema.label` cannot do that, because every object is truthy.
  const resolvedDetailLabel = resolveInlineI18nLabel(schema.label, displayLocale);
  const detailTitle = resolvedDetailLabel
    ? t('detail.recordDetailWithLabel', { label: resolvedDetailLabel })
    : schema.objectName
      ? t('detail.recordDetailWithLabel', {
          label: schema.objectName.charAt(0).toUpperCase() + schema.objectName.slice(1),
        })
      : t('detail.recordDetail');

  // The columns this view draws: the declared columns, minus the ones the user
  // may not read (`perms.checkField(objectName, field, 'read')`, skipped until
  // the permission answer loads or when there is no object name), minus the
  // hidden ones, in `fieldOrder`. Every child view receives it as `fields`, and
  // the grid also as `columns` when the author declared any. The kanban card
  // fields and the tree fields fall back to it, and the export's columns are
  // built from it. The Filter panel reads it only to order its list.
  //
  // The other field lists are not built from it, and each asks the same read
  // itself. The `$select` projection in the data-fetch effect filters the
  // declared columns with the same call; `perms` is read before that effect so
  // it can. The Filter panel's list, the Sort picker's list, the list the
  // hide-fields popover, the Group editor and the Row color select share
  // (`allFields`), and the user-filter chips (`filterElements`) ask through
  // `canReadField` (objectui#11925, objectui#11943, objectui#11984). Two
  // exceptions keep a field the current state already names: the Sort picker
  // lists it disabled, so its row can be removed but no other row and no "Add
  // sort" can choose it; a user-filter chip whose field a held selection names
  // stays, so that selection can be cleared.
  const effectiveFields = React.useMemo(() => {
    // Defensive: `columns` is `string[] | ListColumn[]`, but metadata is
    // user-authored — anything non-array degrades to "no declared columns".
    let fields: any[] = Array.isArray(schema.columns) ? (schema.columns as any[]) : [];

    // FLS: drop columns the current user cannot read.
    if (perms?.isLoaded && schema.objectName) {
      fields = fields.filter((f: any) => {
        const fieldName = columnIdentity(f);
        if (!fieldName) return true;
        return perms.checkField(schema.objectName!, fieldName, 'read');
      });
    }

    // Remove hidden fields
    if (hiddenFields.size > 0) {
      fields = fields.filter((f: any) => {
        const fieldName = columnIdentity(f);
        return fieldName != null && !hiddenFields.has(fieldName);
      });
    }

    // Apply field order
    if (schema.fieldOrder && schema.fieldOrder.length > 0) {
      const orderMap = new Map<string, number>(schema.fieldOrder.map((f: any, i: number) => [f as string, i]));
      fields = [...fields].sort((a: any, b: any) => {
        const orderA: number = orderMap.get(columnIdentity(a) as string) ?? Infinity;
        const orderB: number = orderMap.get(columnIdentity(b) as string) ?? Infinity;
        return orderA - orderB;
      });
    }
    
    return fields;
  }, [schema.columns, schema.objectName, hiddenFields, schema.fieldOrder, perms]);

  /**
   * Did the AUTHOR declare a column projection at all? (objectui#6598)
   *
   * `effectiveFields` is `[]` in two situations the child grid cannot tell
   * apart, and sending the same empty array for both is what produced this
   * issue's headline symptom: `<list-view objectName="opportunity" />` on an
   * html-kind page rendered the row count, the toolbar and the index column —
   * and not one data column, with no diagnostic anywhere.
   *
   *   1. The author declared none (`columns` absent, or `[]`). `ObjectGrid`
   *      derives defaults from the object schema for exactly this case
   *      ("Default columns priority (when schema doesn't specify columns)"),
   *      and `normalizeColumns` already reads an empty `columns` as unauthored
   *      — the same rule `ElementDataSourceGate`'s precedence table states.
   *      But that derivation is gated on `schema.fields` being ABSENT, and an
   *      empty array is truthy, so the `fields: []` this component sent read as
   *      "show exactly these zero columns" and the defaults never ran.
   *      Single-variable measurement: a bare `<object-grid objectName="…" />`
   *      on the same tier, same data source, renders four default columns; the
   *      same object behind `<list-view>` renders none.
   *   2. The author declared some and the gates above removed them all — FLS
   *      denied every one, or every one is hidden. That case must KEEP sending
   *      the empty projection. Falling through to the grid's defaults there
   *      would show fields the author never asked for.
   *
   *      ⭐ THE REASON CHANGED; THE PREDICATE DID NOT (objectui#6799). This
   *      clause used to end "…and `ObjectGrid` re-applies FLS only on the
   *      DERIVED path, not on the explicit-columns one — so widening here would
   *      be a widening past the field gate." That is no longer true. As of
   *      objectui#6799 the grid re-applies FLS on ALL THREE of its default
   *      paths, the authored `columns` one included, so a fall-through here no
   *      longer escapes the field gate. The predicate stays exactly as it is
   *      for the half of the sentence that never depended on the grid: an empty
   *      projection is the AUTHOR's projection after filtering, and handing the
   *      grid "unauthored" would replace it with the object's default columns —
   *      fields the author never declared. FLS-checked now, but still not what
   *      was authored. AUTHORING INTENT is what this predicate protects, and
   *      that was always the load-bearing half.
   *
   * Hence the question is about the AUTHORED value and never about what
   * survived filtering.
   */
  const hasAuthoredColumns = React.useMemo(
    () => Array.isArray(schema.columns) && schema.columns.length > 0,
    [schema.columns],
  );

  /**
   * The filter a SELF-QUERYING view queries with — `gantt` (objectui#10037),
   * `tree` and `chart` (objectui#10250).
   *
   * Most views draw the rows this component fetched, so the toolbar's Filter
   * control and the `UserFilters` chips reach them through `data`. Three views
   * run their OWN query from the node's `filter` instead, and a node carrying
   * only the authored `schema.filter` left both controls on screen, changing
   * this component's fetch and nothing the user could see:
   *
   *   - `gantt`: the registered `object-gantt` renderer forwards no host prop
   *     (`plugin-gantt/src/ObjectGantt.hostDataProp-7210.test.tsx` pins that)
   *     and `ObjectGantt.reload` hands
   *     `schema.filter` to `$filter`;
   *   - `tree`: `ObjectTree`'s object-provider branch runs its own `find` with
   *     `$filter: schema.filter`, and it runs BEFORE its host-`data` branch;
   *   - `chart` (the `'unbound'` shape, objectui#6152 round 15): `ObjectChart`
   *     reads no host rows, and the only query it runs before refusing the
   *     node takes `schema.filter`.
   *
   * Each of those nodes therefore carries the SAME effective filter this
   * component's own fetch sends (`buildEffectiveFilter`: authored filter AND
   * toolbar group AND chips), and each renderer hands it to its query
   * unchanged.
   *
   * ⭐ Stable for an equal payload, and keyed on the payload — not on a memo
   * identity (AGENTS.md #10). `ObjectGantt`'s reload effect and `ObjectTree`'s
   * record effect both list `schema.filter` as a dependency, so a fresh array
   * for a byte-identical filter would refetch the view on every density toggle
   * or discarded memo. The ref below hands back the previous object whenever
   * the serialised filter is unchanged. (`ObjectChart` keys its fetch on the
   * serialised filter already; it gets the same value for one rule.)
   *
   * ⚠️ A filter `buildEffectiveFilter` refuses (a `FilterOperatorError`) is
   * NOT turned into "no filter" here — that would widen the view to every row.
   * The node keeps the last filter it was handed (or, before any, the authored
   * one, exactly what it carried before objectui#10037), and this component's
   * own fetch, which throws the same refusal inside its load `try`, raises the
   * load-error panel that replaces the view.
   */
  const selfQueryFilterRef = React.useRef<{ key: string; value: unknown } | null>(null);
  let selfQueryFilter: unknown = authoredFilter;
  if (currentView === 'gantt' || currentView === 'tree' || currentView === 'chart' || gridOwnsGroupedFetch || kanbanLanesPaged) {
    try {
      const value = buildEffectiveFilter(authoredFilter, appliedFilters, appliedUserFilterConditions);
      const key = JSON.stringify(value ?? null);
      const cached = selfQueryFilterRef.current;
      if (cached && cached.key === key) {
        selfQueryFilter = cached.value;
      } else {
        selfQueryFilterRef.current = { key, value };
        selfQueryFilter = value;
      }
    } catch (error) {
      if (!(error instanceof FilterOperatorError)) throw error;
      selfQueryFilter = selfQueryFilterRef.current ? selfQueryFilterRef.current.value : authoredFilter;
    }
  }

  /**
   * The toolbar Search term the GANTT CHART queries with (objectui#10250).
   *
   * Same seam as `selfQueryFilter` above, other control: this component's own
   * fetch sends `$search` (and, when the view declares `searchableFields`,
   * `$searchFields`), and the chart — which queries for itself — never saw the
   * term. The gantt node carries it as `search`, which `ObjectGantt.reload`
   * sends as `$search` together with the node's `searchableFields`.
   *
   * Gantt-only, and a primitive: the memo below lists it as a dependency, so
   * scoping it keeps a keystroke from rebuilding every other view's node, and
   * a string compares by value, so an unchanged term rebuilds nothing.
   * ⛔ `tree` and `chart` are not handed a term: neither renderer has a search
   * channel in its own query today, so a key written onto their nodes would be
   * accepted and read by nothing. The toolbar does not offer Search on them
   * either (`searchlessViewOnScreen`, objectui#10326).
   */
  const ganttSearchTerm = currentView === 'gantt' ? searchTerm : '';

  // Generate the appropriate view component schema
  //
  // Typed `any` OPENLY, and the type did not change: these nodes are built at
  // runtime from a stored view, their `type` picked by a runtime switch, so
  // they are not `DeclaredNode` literals (`@object-ui/types` `base.ts`), and
  // `plugin-view`'s `generateViewSchema` states the same `any` for the same
  // reason. Until objectui#6152 round 14 this memo was `any` by INFERENCE: the
  // tree branch spread an untyped block (`...treeCfg`), and one `any` member
  // made the whole union `any`. That spread is retired, so the annotation now
  // says what the inference used to.
  const viewComponentSchema = React.useMemo((): any => {
    const densityRowHeight = density.mode === 'compact'
      ? 'compact'
      : density.mode === 'spacious'
        ? 'tall'
        : 'medium';
    const baseProps = {
      objectName: schema.objectName,
      fields: effectiveFields,
      // Spec-canonical `filter` (#2890). Every child view — ObjectGrid,
      // ObjectGallery, ObjectKanban, ObjectCalendar, ObjectGantt, ObjectMap,
      // ObjectTree, ObjectChart — reads `schema.filter`; ListView was the only
      // surface speaking `filters`, so a child that fetches its own rows (the
      // chart branch below, and any of these rendered standalone) never saw the
      // view's base filter at all.
      filter: authoredFilter,
      sort: currentSort,
      className: "h-full w-full",
      // Disable internal controls that clash with ListView toolbar
      showSearch: false,
      // Pass navigation click handler to child views
      onRowClick: navigation.handleClick,
      // Forward density to child views (overrides schema.rowHeight at runtime)
      rowHeight: densityRowHeight,
      // Suppress child grid's own row-height toggle since ListView toolbar controls it
      hideRowHeightToggle: true,
      // Forward column-state callback (resize/reorder) so a parent can
      // persist user adjustments alongside the view definition.
      ...(onColumnStateChange ? { onColumnStateChange } : {}),
      // Hydrate child grid with previously persisted column state.
      ...(schema.columnState ? { columnState: schema.columnState } : {}),
    };

    switch (currentView) {
      // `default` deliberately shares the grid branch: an unrecognized
      // viewType must degrade to a working table, never to a typeless schema
      // (SchemaRenderer shows those as a red "Unknown component type" box).
      default:
      case 'grid':
        return {
          type: 'object-grid',
          ...baseProps,
          // Unauthored ⇒ hand the grid NO projection, so its default-columns
          // derivation runs (see `hasAuthoredColumns`). `fields` has to be
          // cleared with it: it rides in on `baseProps`, and it is the key the
          // derivation is gated on.
          ...(hasAuthoredColumns
            ? { columns: effectiveFields }
            : { fields: undefined, columns: undefined }),
          ...(schema.conditionalFormatting ? { conditionalFormatting: schema.conditionalFormatting } : {}),
          // [#4647] The MODE, not just its toggle. Gating only the toggle would
          // leave the issue's own consequence reachable by a different door: a
          // stored view carrying `inlineEdit: true` (authored, or left by the
          // console's old toggle) drops a read-only principal straight into editable cells
          // with no toggle to press, and "Save all" still earns the 403. The
          // toggle can only ever be the cheapest entrance to this state; the
          // state is what needs the grant.
          editable: inlineEdit && inlineEditOffered,
          ...(schema.wrapHeaders != null ? { wrapHeaders: schema.wrapHeaders } : {}),
          ...(schema.resizable != null ? { resizable: schema.resizable } : {}),
          ...(schema.selection ? { selection: schema.selection } : {}),
          ...(schema.pagination ? { pagination: schema.pagination } : {}),
          ...(groupingConfig ? { grouping: groupingConfig } : {}),
          // objectui#7189 — a grid grouping on the server runs its own query,
          // so it carries the effective filter. See `gridOwnsGroupedFetch`.
          // objectui#11021 — and the fields the toolbar term may match, when
          // the view declares them; the term itself is a host prop (below).
          ...(gridOwnsGroupedFetch
            ? {
                filter: selfQueryFilter,
                ...(schema.searchableFields && schema.searchableFields.length > 0
                  ? { searchableFields: schema.searchableFields }
                  : {}),
              }
            : {}),
          ...(rowColorConfig ? { rowColor: rowColorConfig } : {}),
          ...(schema.rowActions ? { rowActions: schema.rowActions } : {}),
          /**
           * The RELAY half of the same non-author surface documented at the
           * `listViewPredicates` call above (objectui#5091, extended here by
           * objectui#8653 item 2). Undeclared on `ListViewSchema` — hence the
           * cast — but DECLARED one node down: `DataTableSchema.rowActionDefs`
           * is what `object-grid` hands `RowActionMenu`.
           *
           * ⛔ DO NOT delete this read. `baseProps` above is an explicit
           * picklist, so this line is the ONLY way the host's composed row
           * actions reach the row menu; dropping it removes the menu with no
           * type error, no lint finding and no test failure anywhere else in
           * the tree. Pinned by name in
           * `__tests__/listViewNonAuthorKeys-8653.test.tsx` §4 SITE 1, with
           * the declared `bulkActionDefs` below as that pin's control.
           */
          ...((schema as any).rowActionDefs ? { rowActionDefs: (schema as any).rowActionDefs } : {}),
          ...(schema.bulkActions ? { batchActions: schema.bulkActions } : {}),
          ...((schema as any).bulkActionDefs ? { bulkActionDefs: (schema as any).bulkActionDefs } : {}),
          // ⛔ No `options.grid` spread (objectui#6152 round 14). A grid has no
          // per-kind block: the spec's list-overlay bag and `ListViewSchema.options`
          // refuse `options.grid` (round 12), and the raw spread that still put
          // its keys onto this node, after the node's own, is retired with the
          // other legacy readers. A grid's settings are top-level keys of the view.
        };
      case 'kanban': {
        // The spec's lane field is `groupByField`, the only spelling read here
        // (the pre-#2231 `groupField` alias retired in objectui#6152 round 14).
        // ADR-0085: without it, fall back to the object's declared
        // lifecycle (`stageField`, incl. strict-false suppression) via the shared
        // detector — mirrors ObjectView's default so both entry paths agree.
        // objectDef loads async: until it lands this stays undefined and the board
        // re-derives lanes once it does.
        const kanbanCfg = kanbanBlockOf(schema);
        // ⭐ THE BLOCK'S DECLARED KEYS ONLY (objectui#6152 round 14). The spec's
        // kanban block is `groupByField` / `columns` / `titleField` /
        // `summarizeField`, each read by name below. This branch used to read
        // the pre-#2231 `groupField` / `cardFields` aliases as well and to spread
        // the REST of the block onto the node after its own keys, so an undeclared
        // knob (`swimlaneField`, …) reached `ObjectKanban` and a block key named
        // like a node key (`objectName`) overrode the node's own value. Every
        // list-view door refuses those keys, so both retired; the `groupBy` the
        // rest once carried is the objectui#8365 case, closed the same way.
        //
        // `columns` is the spec's list of fields shown on each card.
        // ObjectKanban's own `columns` prop is its LANES, so it goes out as
        // `cardFields` (mirrors plugin-view's adapter).
        const { columns: kanbanCardColumns, titleField, summarizeField } = kanbanCfg as Record<string, any>;
        const laneField = kanbanLaneFieldOf(schema, objectDef);
        // objectui#12619 — the card fields: the block's own `columns` when
        // the author named some (the spec's card-field key, every one of
        // them), else the view's first columns past the title, the lane and
        // the owner, by name (`kanbanCardFieldsFromView`).
        const cardFields =
          Array.isArray(kanbanCardColumns) && kanbanCardColumns.length > 0
            ? kanbanCardColumns
            : kanbanCardFieldsFromView(effectiveFields, [
                titleField,
                resolveNameField(objectDef),
                laneField,
                kanbanOwnerFieldOf(objectDef),
              ]);
        // `groupBy` is the lane key and the ONLY one written here. This node
        // used to carry `groupField: laneField` alongside it — a duplicate the
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
        // ⚠️ NODE-LOCAL: the VIEW-LEVEL `groupField` alias read here was a
        // separate key, and objectui#6152 round 14 retired it.
        return {
          type: 'object-kanban',
          ...baseProps,
          groupBy: laneField,
          ...(titleField ? { titleField } : {}),
          cardFields,
          ...(groupingConfig ? { grouping: groupingConfig } : {}),
          // objectui#11629: the board sums this field at the top of each lane.
          ...(summarizeField ? { summarizeField } : {}),
          // objectui#12619 — a board that pages its own lanes queries with the
          // EFFECTIVE filter, as every view that queries for itself does
          // (`selfQueryFilter`): the toolbar Filter and the chips reach its
          // lanes only here. See `kanbanLanesPaged`.
          ...(kanbanLanesPaged ? { filter: selfQueryFilter } : {}),
        };
      }
      case 'calendar': {
        // objectui#7029: only ever restate a binding the view actually
        // DECLARED. These two keys used to be floored at 'start_date' /
        // 'end_date' — field names no view had written and most objects do not
        // carry. `ObjectCalendar` decides whether it has a usable configuration
        // by asking whether a start-date binding is present, so a fabricated
        // one short-circuited its own refusal screen and every record landed on
        // today. The `titleField` rung next door has always been conditional;
        // these two now match it, and the whole branch matches the sibling
        // faces that never invent (`resolveTimelineDateBinding` above,
        // app-shell's `calendarViewOptions` / `defaultCalendarFromObject`).
        // ⚠️ The fetch windows on these same two reads, made again at component
        // scope as `calendarStartField` / `calendarEndField` (objectui#12081):
        // change one pair, change both.
        const startDateField =
          schema.calendar?.startDateField || schema.options?.calendar?.startDateField;
        const endDateField =
          schema.calendar?.endDateField || schema.options?.calendar?.endDateField;
        const titleField =
          schema.calendar?.titleField || schema.options?.calendar?.titleField;
        // ⭐ THIS BRANCH FORWARDS THE BLOCK'S DECLARED KEYS ONLY. It used to end
        // with two raw spreads of the authored block, which is how `dateField` /
        // `endField` reached the generated `object-calendar` node WITHOUT this
        // file ever naming them — and why a text census of producers came back a
        // confident zero (objectui#8651 records that census and its two holes).
        // objectui#8355 (director seat 2026-09-16) destructured those two out of
        // the spread; objectui#6152 round 14 retired the spread itself, with the
        // `defaultView` lift beside it. The spec's calendar block is the five keys
        // read by name here, so `colorField` and `allDayField` (which only the
        // spread carried) are now named too, and nothing else reaches the node:
        // not an undeclared key, and not a block key named like a node key.
        // `defaultView` is a member of the `object-calendar` element, not of a
        // list view's calendar block, so the calendar opens on its own default.
        //
        // ⛔ STRIPPING IS ONLY THE QUIET HALF. The loud half is the read door:
        // `@object-ui/types` declares both spellings as `aliasKeyRefusal()` arms
        // on the view-level calendar block, on the legacy `options.calendar`
        // nesting and on the flat node face, so an author meets a by-name
        // refusal naming `startDateField` / `endDateField` instead of a calendar
        // that silently stops binding. Removing one half without the other is
        // what broke a live authoring path once already.
        //
        // ⛔ Deliberately NOT folded onto the canonical keys. Option A
        // (normalise here) was put to the director seat and REFUSED as the end
        // state: it keeps a second spelling alive at the producer, which is the
        // lenient alias AGENTS.md #0.1 names. The reads are canonical-only, so a
        // fold would re-create the dialect this closes.
        const colorField =
          schema.calendar?.colorField || schema.options?.calendar?.colorField;
        const allDayField =
          schema.calendar?.allDayField || schema.options?.calendar?.allDayField;
        return {
          type: 'object-calendar',
          ...baseProps,
          ...(startDateField ? { startDateField } : {}),
          ...(endDateField ? { endDateField } : {}),
          ...(titleField ? { titleField } : {}),
          ...(colorField ? { colorField } : {}),
          ...(allDayField ? { allDayField } : {}),
          // objectui#12081 — the days the calendar draws come back here, and
          // this view's fetch windows on them (`calendarWindowed`). Handed only
          // where this view windows: elsewhere nothing would read the report.
          ...(calendarWindowed ? { onVisibleRangeChange: handleCalendarVisibleRange } : {}),
        };
      }
      case 'gallery': {
        // Merge spec config over legacy options into nested gallery prop
        const mergedGallery = {
          ...(schema.options?.gallery || {}),
          ...(schema.gallery || {}),
          // User's runtime override from the toolbar density button wins
          // over schema defaults. Persisted to localStorage in ListView.
          cardSize: galleryCardSize,
        };
        return {
          type: 'object-gallery',
          ...baseProps,
          // Nested gallery config (spec-compliant, used by ObjectGallery). Its
          // `coverField` is the cover binding: `ObjectGallery` reads it ahead
          // of any flat prop. ⛔ No flat `imageField` (objectui#6152 round 14):
          // its first rung restated this nested `coverField` and the other two
          // read the pre-#2231 `imageField` alias, which every list-view door
          // refuses by name.
          gallery: Object.keys(mergedGallery).length > 0 ? mergedGallery : undefined,
          // Deprecated top-level prop for backward compat
          titleField: schema.gallery?.titleField || schema.options?.gallery?.titleField || 'name',
          ...(groupingConfig ? { grouping: groupingConfig } : {}),
        };
      }
      case 'timeline': {
        // Merge spec config over legacy options into nested timeline prop
        const mergedTimeline = {
          ...(schema.options?.timeline || {}),
          ...(schema.timeline || {}),
        };
        // The one resolution the capability gate above also uses (objectui#3129).
        const dateBinding = resolveTimelineDateBinding(schema);
        // The resolved axis has to appear on the NESTED config too, not just on
        // the flat prop: `ObjectTimeline` prefers `timeline.startDateField` over
        // `schema.startDateField`, so a timeline config object that exists but
        // carries no date key (app-shell emits one for every object view) would
        // otherwise mask a binding resolved from elsewhere.
        const resolvedTimeline = {
          ...mergedTimeline,
          ...(dateBinding.startDateField ? { startDateField: dateBinding.startDateField } : {}),
          ...(dateBinding.endDateField ? { endDateField: dateBinding.endDateField } : {}),
        };
        return {
          type: 'object-timeline',
          ...baseProps,
          // Nested timeline config (spec-compliant, used by ObjectTimeline)
          timeline: Object.keys(resolvedTimeline).length > 0 ? resolvedTimeline : undefined,
          // Deprecated top-level props for backward compat.
          //
          // `04a67b9dc` (step ③) — house posture, entered on the maintainer's
          // ruling of 2026-09-01 (总监批 #28): 日期轴永不虚构 — a date axis is
          // never fabricated. The two lines of prose that used to sit here
          // ("`created_at` stays the last resort for a view that declares no
          // date axis anywhere") were not an oversight, they stated a decision —
          // and that decision is what the ruling explicitly replaced. It was a
          // second, de-facto contract held at ONE face, on the very literal
          // objectui#3129 retired at the app-shell face, so the product held two
          // documented and opposite postures on one field name.
          //
          // `ObjectTimeline` reads this FLAT prop at the tail of its resolver
          // chain, so a floor here answered "the axis is bound" for every view
          // and made its refusal screen (objectui#7459, step ① of the same
          // ruling) unreachable from this route. Worse, the axis it invented was
          // never FETCHED: the `$select` projection is collected from the
          // DECLARED `timeline` / `options.timeline` blocks above, never from
          // this prop — so an undeclared view rendered a timeline bound to a
          // column the query had not requested and bucketed every record into
          // "No date". Absent is now absent, and the renderer says which keys to
          // declare instead.
          //
          // ⛔ `titleField` is NOT a date axis and keeps its floor — the same
          // display-name rung the gallery and gantt branches carry here, and
          // `timelineViewOptions` carries at app-shell.
          ...(dateBinding.startDateField ? { startDateField: dateBinding.startDateField } : {}),
          titleField: dateBinding.titleField || 'name',
          ...(dateBinding.endDateField ? { endDateField: dateBinding.endDateField } : {}),
          ...(schema.timeline?.groupByField ? { groupByField: schema.timeline.groupByField } : {}),
          ...(schema.timeline?.colorField ? { colorField: schema.timeline.colorField } : {}),
          ...(schema.timeline?.scale ? { scale: schema.timeline.scale } : {}),
        };
      }
      case 'gantt': {
        // `5f4514f7b`: only ever restate a binding the view actually DECLARED
        // — the same correction objectui#7029 made to the calendar branch above,
        // which fenced this one out and reported it separately. These two keys
        // used to be floored at 'start_date' / 'end_date', field names no view
        // had written and most objects do not carry. `ObjectGantt.getGanttConfig`
        // takes its flat branch as soon as BOTH date props are present, so a
        // fabricated pair short-circuited the renderer's own refusal screen and
        // produced a plausible, fully wrong chart instead. MEASURED first, since
        // #7029's mechanic is only correct where a refusal path exists:
        // ObjectGantt REFUSES an absent binding (it does not render empty and
        // does not throw) — pinned in
        // `plugin-gantt/src/ObjectGantt.unconfiguredRefusal-7070.test.tsx`.
        //
        // `progressField` / `dependenciesField` are NOT floored either, as of
        // objectui#7499 — the flavour-3 card `5f4514f7b` scoped out and left pinned
        // here so that whoever retired them had a place to declare it. This is
        // that declaration. The remedy is OMIT, not refuse, and the two differ:
        //
        //   - REFUSING would be wrong. Unlike a date axis, "no progress" and
        //     "no dependencies" are legitimate and common states — most gantt
        //     rows have neither — so an absent key must keep rendering exactly
        //     as it does today. That is why the date-axis conclusion (refuse)
        //     must NOT be imported here, and the 2026-09-01 ruling forbids importing it.
        //   - FABRICATING was also wrong. `|| 'progress'` / `|| 'dependencies'`
        //     manufactured a binding the author never wrote. Its failure is a
        //     per-row `undefined`, indistinguishable from the legitimate case
        //     above — so an author who spelled the key differently got a silent
        //     accidental hit on a same-named column, with no diagnostic.
        //
        // Omitting satisfies both: a declared value still reaches the renderer
        // verbatim through the declared-key copy below (which always had the
        // last word over these lines anyway — the floor was all they ever
        // contributed), and an undeclared one arrives as an ABSENT key rather
        // than a fabricated name. Deleting them cannot resurrect a
        // config: `getGanttConfig` gates on the two date fields alone, so the
        // refusal screen stays exactly as reachable as it was (pinned in
        // `plugin-gantt/src/ObjectGantt.unconfiguredRefusal-7070.test.tsx`).
        const startDateField = schema.gantt?.startDateField || schema.options?.gantt?.startDateField;
        const endDateField = schema.gantt?.endDateField || schema.options?.gantt?.endDateField;
        return {
          type: 'object-gantt',
          ...baseProps,
          // objectui#10037 — the EFFECTIVE filter, not the authored one: the
          // chart queries for itself, so this key is the only way the
          // toolbar's Filter control and the `UserFilters` chips reach it.
          // See `selfQueryFilter` above.
          filter: selfQueryFilter,
          // objectui#10250 — the toolbar Search term, by the same door and for
          // the same reason; `searchableFields` rides with it exactly as it
          // rides with this component's own `$search`. Absent keys, not
          // present-and-empty, when there is no term. See `ganttSearchTerm`.
          ...(ganttSearchTerm
            ? {
                search: ganttSearchTerm,
                ...(schema.searchableFields && schema.searchableFields.length > 0
                  ? { searchableFields: schema.searchableFields }
                  : {}),
              }
            : {}),
          // objectui#7334 — the view-level `navigation` the author wrote.
          //
          // `ObjectGantt` owns a record drawer of its own and resolves
          // `const navConfig = schema.navigation ?? { mode: 'drawer' }`, then
          // classifies four overlay modes (`drawer`/`modal`/`split`/`popover`)
          // to decide whether to suppress the host's `onRowClick`. Nothing put
          // `navigation` on the node it receives, so that `??` was the ONLY
          // branch ever taken: a view authoring `navigation: { mode: 'page' }`
          // got a drawer, with no diagnostic. The component knows four modes
          // and was only ever handed the default.
          //
          // ⭐ ON THE BRANCH, NOT ON `baseProps`, and that is a measurement
          // rather than a preference. SEVEN other child views read
          // `schema.navigation` for themselves, each at its own
          // `useNavigationOverlay` call — `ObjectGrid`, `ObjectGallery`,
          // `ObjectKanban`, `ObjectCalendar`, `ObjectMap`, `ObjectTimeline`,
          // `ObjectTree` (⛔ cited by symbol, not by line: objectui#8875). And
          // every one of them ALSO receives `onRowClick:
          // navigation.handleClick` from `baseProps`, which
          // `useNavigationOverlay` gives FULL priority over any `navigation` it
          // is handed. So putting the key on `baseProps` would deliver it to
          // seven views in two broken ways at once:
          //
          //   - six of them (grid, gallery, kanban, map, timeline, tree) pass
          //     `onRowClick` UNCONDITIONALLY, so the authored config would
          //     arrive and then be outranked — declared, delivered, and STILL
          //     not enforced, which is this card's own defect relocated;
          //   - calendar alone mirrors gantt's `navIsOverlay ? undefined :
          //     onRowClick`, so it would genuinely CHANGE BEHAVIOUR: today its
          //     `navConfig` is always the `{ mode: 'drawer' }` fallback and it
          //     suppresses the host handler; fed an authored `page` it would
          //     stop suppressing and defer to ListView's overlay instead.
          //
          // That is two sources of truth for one question. `gantt` is the only
          // branch where forwarding settles the question rather than splitting
          // it: its wrapper drops host props entirely (objectui#7210 /
          // objectui#7222), so the schema path is the only live carrier and
          // `onRowClick` is not there to outrank anything.
          //
          // Conditional, not `navigation: schema.navigation` — an ABSENT key,
          // not present-and-undefined, the same distinction the two non-axis
          // keys below are omitted for. It is what keeps the `?? { mode:
          // 'drawer' }` fallback reachable for a view that authored nothing.
          //
          // ⛔ This is route A only. Forwarding host PROPS to the chart is
          // objectui#7210 half 2's scope and collides with objectui#7333.
          ...(schema.navigation ? { navigation: schema.navigation } : {}),
          // ViewData pass-through: a view authored with a `data` provider
          // block (`object` / `value`) must reach ObjectGantt, whose
          // getDataConfig prefers schema.data over the objectName fallback.
          ...(schema.data ? { data: schema.data } : {}),
          ...(startDateField ? { startDateField } : {}),
          ...(endDateField ? { endDateField } : {}),
          ...(schema.gantt?.titleField ? { titleField: schema.gantt.titleField } : {}),
          // The block's DECLARED keys, bag under block per key, exactly as the
          // two raw spreads this replaces merged them (objectui#6152 round 14).
          // See `GANTT_CONFIG_SPELLING` for what the spreads let through.
          ...pickFlatMapConfig({ ...(schema.options?.gantt || {}), ...(schema.gantt || {}) }, GANTT_CONFIG_SPELLING),
        };
      }
      case 'map': {
        // Whitelisted flatten (objectui#5177) — see `FLAT_MAP_CONFIG_SPELLING`,
        // which also carries `style` out as `mapStyle` (objectui#9950).
        // `schema.options.map` is an untyped bag; a raw spread here forwarded
        // every key the author wrote, including `style`, which `ObjectMap`'s
        // `FlatMapConfigKeys` declares OUT of this flat form.
        //
        // The spec's view-level `map` block merges over that bag — see
        // `resolveListMapConfig` for the precedence and its sibling evidence.
        //
        // Emitted in the FLAT form, deliberately, exactly as before: a nested
        // `map` key would win OUTRIGHT at `getMapConfig` (objectui#5018), which
        // would turn this per-key merge into whole-block replacement of the bag
        // and would trip `warnOnShadowedFlatMapKeys`. That precedence rule is
        // written around the flatten product — "neither flattener emits a `map`
        // key at all" — and this branch keeps that true.
        //
        // No camera is synthesized here: `pickFlatMapConfig` copies only keys
        // the author actually wrote, so an undeclared `zoom`/`center` stays
        // absent and `ObjectMap` still fits the camera to the queried records
        // (objectui#5000, objectui#4941).
        //
        // ⛔ NO `locationField: … || 'location'` FLOOR (objectui#8169 — ruled
        // 2026-09-07 「同意」, option B; the same correction `5f4514f7b` made
        // to the gantt date axes and objectui#7029 to the calendar). It stood
        // here as a duplicate of `getMapConfig`'s own default branch, and its
        // real effect was to SHADOW half of it: the floor forced the flat
        // branch, which returned that one key and no `latitudeField` /
        // `longitudeField`, so an undeclared view invented ONE name where the
        // component would have invented three. Both faces moved in one change:
        // the component's guesses are gone too, and an unbound map now renders
        // its "Map configuration required" refusal instead of an empty one.
        // ⇒ deleting this floor no longer widens anything — it is what makes
        // the refusal reachable from a list view at all.
        const mapConfig = resolveListMapConfig(schema);
        return {
          type: 'object-map',
          ...baseProps,
          ...mapConfig,
        };
      }
      case 'tree': {
        // Self-referencing tree-grid. Config lives under view.tree.* (direct)
        // or options.tree.* (app-shell object pages). parentField auto-detects
        // from the object's tree/self-reference field when omitted.
        const treeCfg = (schema as any).tree || schema.options?.tree || {};
        return {
          type: 'object-tree',
          ...baseProps,
          // objectui#10250 — the EFFECTIVE filter: `ObjectTree`'s object
          // provider runs its own `find` from this key before it looks at the
          // `data` handed down, so the toolbar Filter and the chips reach the
          // tree only here. See `selfQueryFilter` above.
          filter: selfQueryFilter,
          // The spec's tree block is these four keys, each read by name.
          // objectui#6152 round 14 retired the undeclared `titleField` label
          // rung (the spec refuses it by name, objectui#8841) and the raw
          // `...treeCfg` spread after them, which forwarded every other key a
          // stored block carried and let a block key named like a node key
          // override the node's own value.
          parentField: treeCfg.parentField,
          labelField: treeCfg.labelField || 'name',
          fields: treeCfg.fields || effectiveFields,
          defaultExpandedDepth: treeCfg.defaultExpandedDepth,
        };
      }
      case 'chart': {
        // A `chart` list view renders a chart of an ADR-0021 `dataset`,
        // delegating to the same object-chart component the dashboard uses.
        // Read through `resolveListChartBinding` — the one source the capability
        // gate in `availableViews` also asks (objectui#7544). The routing and
        // the precedence below are its answers, not a second reading of the
        // block.
        const chartBinding = resolveListChartBinding(schema);
        const chartCfg = chartBinding.config;
        // ADR-0021 (objectstack-ai/objectstack#1890): the single author-facing shape binds to a semantic
        // `dataset` and selects dimensions/measures BY NAME, so the chart runs
        // through the governed queryDataset path (numbers consistent everywhere).
        //
        // ⛔ NO `filter` on this node, deliberately (objectui#10327, ruling
        // 5825582592, letter A): a dataset chart takes its scope from the
        // dataset. The list's filter addresses the LIST OBJECT's fields and a
        // dataset's namespace need not be that object's, so forwarding it here
        // would be the list-object → dataset mapping the ruling refused
        // (option B). The toolbar withholds its filter controls on this view
        // (`datasetChartOnScreen`), and `ListViewSchema` refuses an authored
        // view filter on it.
        if (chartBinding.shape === 'dataset') {
          const dims: string[] = chartBinding.dimensions;
          const vals: string[] = chartBinding.values;
          return {
            type: 'object-chart',
            dataset: chartBinding.dataset,
            dimensions: dims,
            values: vals,
            chartType: chartCfg.chartType || 'bar',
            xAxisKey: dims[0],
            series: vals.map((v: string) => ({ dataKey: v, label: v })),
            className: 'h-[400px] w-full',
          };
        }
        // ⛔ NO LEGACY INLINE AGGREGATE (objectui#6152 round 15). A block that
        // names no `dataset` used to be translated from the pre-ADR-0021 axes
        // (`xAxisField` / `categoryField`, `yAxisFields` / `valueField`,
        // `aggregation`) into an `aggregate`, floored at `'name'` / `'value'`
        // when it declared none. Every door refuses those axes by name, so that
        // render path retired with them, floors included (the remainder of
        // objectui#7547). What is left is the UNBOUND chart — reached only
        // through a `viewType` that forces it, since the gate never offers it:
        // an object-bound node that names no category, which `ObjectChart`
        // refuses on screen (objectui#8168, `chart-missing-category-axis`)
        // instead of aggregating on a name nobody wrote. It still carries the
        // effective filter (objectui#10250), which is all it hands a query.
        // ⛔ Do not restore a floor here: that is the binding nobody wrote.
        return {
          type: 'object-chart',
          objectName: schema.objectName,
          chartType: chartCfg.chartType || 'bar',
          filter: selfQueryFilter,
          className: 'h-[400px] w-full',
        };
      }
    }
  // objectDef is in the deps because the kanban default lane field derives
  // from it (ADR-0085 stageField) and it loads async — without it the board
  // would keep the null-def result forever.
  // `inlineEditOffered` joins the deps for #4647: the permission verdict lands
  // asynchronously (`/me/permissions`) and `objectDef` loads into state, so a
  // grid schema built before either resolved must be rebuilt when they do —
  // otherwise `editable` keeps the pre-verdict answer for the session.
  }, [currentView, schema, authoredFilter, currentSort, effectiveFields, hasAuthoredColumns, groupingConfig, rowColorConfig, navigation.handleClick, density.mode, galleryCardSize, inlineEdit, inlineEditOffered, objectDef, selfQueryFilter, ganttSearchTerm, gridOwnsGroupedFetch, calendarWindowed, handleCalendarVisibleRange, kanbanLanesPaged]);

  const hasFilters = currentFilters.conditions && currentFilters.conditions.length > 0;

  /**
   * Every field this view can name, before any per-builder rule narrows it.
   *
   * Was `filterFields` — the whitelist used to be applied inside this memo, so
   * `filterableFields` was the ONLY base set either builder could see, and the
   * sort picker inherited a whitelist authored for filtering (objectui#4243).
   * The two narrowings now sit downstream of it, one per builder.
   */
  const candidateFields = React.useMemo(() => {
    let fields: Array<{ value: string; label: string; type: string; options?: any; referenceTo?: string; displayField?: string }>;

    // Translate select-field option labels through the i18n resolver.
    // fieldDef.options may be an array of { value, label } or a keyed object;
    // we normalize to array form so FilterBuilder's value-pickers show
    // localized option labels (e.g. 网站 instead of "Web").
    const buildOptions = (key: string, raw: any): any[] | undefined => {
      if (!raw) return undefined;
      const arr: Array<{ value: any; label: string; [k: string]: any }> = Array.isArray(raw)
        ? raw.map((o: any) => ({
            value: o?.value ?? o,
            label: o?.label ?? String(o?.value ?? o),
            ...(o && typeof o === 'object' ? o : {}),
          }))
        : Object.entries(raw as Record<string, any>).map(([value, meta]) => ({
            value,
            label: (meta as any)?.label || value,
            ...(meta as any),
          }));
      return schema.objectName ? translateOptions(schema.objectName, key, arr) : arr;
    };

    if (!objectDef?.fields) {
        // Fallback to the declared columns if objectDef not loaded yet
        fields = (Array.isArray(schema.columns) ? (schema.columns as any[]) : [])
          .flatMap((f: any) => {
           if (typeof f === 'string') return [{ value: f, label: f, type: 'text' }];
           // A column with no resolvable identity cannot be filtered or sorted
           // on — it used to become an option keyed `undefined`. Drop it.
           const fieldName = columnIdentity(f);
           if (!fieldName) return [];
           return [{
              value: fieldName,
              // The label falls back to the identity, not to the raw `name`:
              // after #3104 a legacy `name` mirrors the identity anyway, and
              // reading it here would resurrect the second spelling.
              label: tFieldLabel(fieldName, f.label || fieldName),
              type: f.type || 'text',
              // objectui#7531 (ruled): a list column declares no relational target; it comes from the object definition once loaded.
              // objectui#10547 (same ruling): nor select options — `ListColumnSchema` refuses `options` with `unrecognized_keys`; they come from the object definition once loaded.
           }];
        });
    } else {
        fields = Object.entries(objectDef.fields).map(([key, field]: [string, any]) => ({
            value: key,
            label: tFieldLabel(key, field.label || key),
            type: field.type || 'text',
            options: buildOptions(key, field.options),
            // ⚠️ objectui#6837 half 2: the READ narrows to `reference` (the only
            // spelling the protocol declares — `FieldSchema` refuses `reference_to`
            // by name). The EMITTED key is unchanged: it is what this emit's TARGET
            // contract declares, and renaming it would be a separate change.
            // Target contract here: this file's own local filter-field descriptor,
            // which spells it camelCase `referenceTo`.
            // ⚠️ The SIBLING branch above (the `schema.columns` fallback) is NOT
            // narrowed: it reads a list-view COLUMN, and the spec's `ListColumnSchema`
            // declares neither `reference` nor `reference_to` — measured, both refused
            // with no rename hint. That is a different question and is filed, not
            // answered here.
            referenceTo: field.reference,
            // objectui#10545 — the display field is read in the DECLARED spelling
            // and only in it. `objectDef` is
            // `dataSource.getObjectSchema(schema.objectName)`, the object-schema
            // def, and `FieldSchema` declares `displayField`; it refuses
            // `display_field` (renaming it to `displayField`) and
            // `reference_field` (pointing at `referenceVia`, a different key)
            // with `unrecognized_keys`. This is the single spelling `plugin-grid`'s
            // copy set reads (`RELATIONAL_META_READ_SET`, objectui#7155), and it
            // supersedes the objectui#7642 census KEEP, which held only while
            // this chain had no `displayField` leg. A stored pre-strict
            // `display_field` is folded onto `displayField` once, at ingestion
            // (`normalizeSchemaReferenceKeys`, objectui#7650), never here.
            //
            // No id column is read: `FieldSchema` declares none for a lookup (it
            // refuses `idField` and `id_field` alike), so the filter's value
            // picker keys the lookup by its own `id` default, and `plugin-grid`'s
            // copy set copies no id column either.
            displayField: field.displayField,
        }));
    }

    return fields;
  }, [objectDef, schema.columns, schema.objectName, tFieldLabel, translateOptions]);

  /**
   * The FILTER builder's candidates, in the order its field list draws them.
   *
   * Membership: every field the user may read, minus the fields the object
   * marks `hidden: true` — the list `@objectstack/spec` prescribes for the
   * Filter panel. There is no per-view whitelist: the spec retired the list
   * view's `filterableFields` in 18.0 (objectstack#24640, maintainer ruling C)
   * and no key replaces it, so objectui#13118 removed the branch that read it
   * here. A stored view that still carries the key gets this same list; the
   * spec's own conversion drops the key from stored and authored views. A
   * curated end-user filter bar is a different control, `userFilters`.
   *
   * objectui#11810 — the object definition is served with the injected system
   * columns FIRST, and this list used to be that map verbatim: the builder's
   * field list led with Organization, Created By, Owner …, and "Add filter"
   * (which seeds a row on the list's first entry) started every condition on
   * the HIDDEN `organization_id`. Now:
   *
   *   - a field the definition marks `hidden: true` (`organization_id`,
   *     `owning_business_unit_id`, the `__search` companion) is not offered —
   *     unless a condition the panel already holds filters on it, which would
   *     otherwise draw a BLANK field trigger (a filter restored from the
   *     per-user cache, saved back when "Add filter" still defaulted to
   *     Organization);
   *   - the order is this view's columns, in the order the grid shows them
   *     (`effectiveFields`), then every other business field, then the system
   *     fields (the shared `isSystemManagedField`, which reads the spec's
   *     `system` flag), then a hidden field kept by the rule above; within a
   *     tier the definition's own order holds.
   *
   * So "Add filter" starts on the view's first visible column — no default is
   * chosen here or in the builder beyond "the first entry of this list".
   *
   * objectui#11925 — field-level read security, asked with the SAME call the
   * columns use (`perms.checkField(objectName, field, 'read')`, behind the same
   * `isLoaded` gate as `effectiveFields`): a field the user may not read is
   * never offered, whatever else would keep it — not a held condition.
   * Before this the list was built from the
   * object definition and the declared columns with no read check, so a field
   * the grid had dropped could still be picked here, and the two field lists
   * drifted. Both candidate sources pass through this one gate, the
   * definition's fields and the declared-columns fallback alike. An
   * unanswered policy filters nothing, exactly as the column gate defers.
   * The predicate is `canReadField`, which the Sort picker shares
   * (objectui#11943).
   */
  const filterFields = React.useMemo(() => {
    const defs: Record<string, { hidden?: unknown; system?: boolean } | undefined> | undefined = objectDef?.fields;
    const isHidden = (name: string) => defs?.[name]?.hidden === true;
    const held = new Set((currentFilters.conditions ?? []).map((c) => c.field));
    const columnRank = new Map<string, number>();
    for (const column of effectiveFields) {
      const name = columnIdentity(column);
      if (name && !columnRank.has(name)) columnRank.set(name, columnRank.size);
    }
    // 0: a column of this view · 1: another business field · 2: a system
    // field · 3: a hidden field kept only because a held condition names it.
    const tierOf = (name: string) =>
      isHidden(name) ? 3 : columnRank.has(name) ? 0 : isSystemManagedField(name, defs?.[name]) ? 2 : 1;
    return candidateFields
      .filter((f) => canReadField(perms, schema.objectName, f.value))
      .filter((f) => !isHidden(f.value) || held.has(f.value))
      .map((field, index) => ({ field, index, tier: tierOf(field.value) }))
      .sort((a, b) =>
        a.tier - b.tier ||
        (a.tier === 0 ? columnRank.get(a.field.value)! - columnRank.get(b.field.value)! : a.index - b.index),
      )
      .map(({ field }) => field);
  }, [candidateFields, currentFilters.conditions, effectiveFields, objectDef, schema.objectName, perms]);

  // Sort candidates: ALL fields the view can name, minus the ones the sort
  // cannot honestly reach (objectui#4243 — previously ⊂ filter candidates).
  //
  // The base set used to be `filterFields`, so `filterableFields` doubled as
  // the sort whitelist: a field meant to be sortable but not offered as a
  // filter condition could not be expressed, and a view was free to DECLARE a
  // sort on a field this picker then refused to list — the declared sort
  // worked on load, while its rows rendered blank and the user could neither
  // reproduce nor modify it. The whitelist was a FILTER contract (retired since
  // objectui#13118, with the spec's own retirement of the key); sortability is
  // a separate question, answered by the two rules below.
  //

  // This view's sort becomes a server `$orderby` on the FLAT field name, and a
  // relational field stores a foreign-key id — so "sort by Owner" orders the
  // whole collection by `rec_7f3…` while the column shows names. It reads as
  // "sorting is broken", with nothing saying the key is something else. The
  // server cannot sort by the related record's name without a join
  // (objectstack#4256 settled that it won't), so the honest move is to stop
  // offering the illusion: relational fields leave the picker, and the hint
  // below points at the supported alternative (a stored field that
  // denormalizes the name onto this object, written when the source changes).
  //
  // Second rule — THE PLATFORM SAYS which field names it will order by
  // (objectstack#10235 ruling A, consumed here via #5729's landed spelling in
  // `@object-ui/core`). `isPlatformSortableField` is the contract: an entry
  // must EXIST in the served projection and say `sortable: true`. Absence is a
  // refusal — an unknown name, a dotted path, an unprovisioned audit column —
  // never a default of `true`. Withheld silently, so the relational hint below
  // stays strictly about relations, which is what its sentence describes.
  //
  // This picker used to re-derive that verdict from the field's TYPE, reading
  // `UNMATERIALIZED_FIELD_TYPES` (#3950 consolidated the local copy into core).
  // The two agree about `formula` — the platform computes its own projection
  // from the same `@objectstack/spec` storage fact — which is exactly why the
  // drift went unnoticed: they part company on everything the projection
  // encodes as ABSENCE, and on any verdict the runtime doors add later, where
  // a type read answers `sortable` and the platform answers `400 INVALID_SORT`.
  // One judgement, served; not a fourth copy of it drifting apart.
  //
  // NO SIGNAL SERVED (`undefined`) is a different question from "nothing is
  // sortable": a deployment older than objectstack#10235, an inline/mock data
  // source, or `objectDef` not yet loaded. That branch keeps the type read as a
  // compatibility floor — behaviour identical to before this card — and is
  // meant to be deleted when the supported floor passes that release.
  //
  // Exception (both rules): a field the CURRENT sort already uses stays listed
  // — relational ones flagged as ordering by ID — so opening this popover on a
  // view that was authored (or saved before this change) with such a sort
  // neither renders a blank row nor silently drops that sort on the next edit.
  // For a platform-refused field that exception is the only way to REMOVE the
  // offending row, since the sort it names is one the server refuses outright.
  //
  // Field-level read (objectui#11943) is asked before either rule, through
  // `canReadField`, the predicate the Filter panel's list uses. A field the
  // user may not read is not offered: the server answers a sort on it with a
  // 403, and the list blanks to its no-access state. A dropped field does not
  // raise the relational hint either; the hint explains a missing relation the
  // user could otherwise read. The in-use exception covers this rule too: a
  // field the current sort already names (a stored or URL sort) stays listed,
  // so its row is not blank and can be removed.
  //
  // An entry the exception alone keeps is listed REMOVABLE ONLY
  // (objectui#11943): it carries `disabled`, which `SortBuilder` renders as an
  // unavailable option. Its own row still shows its label and can be changed
  // to another field or removed, but no row's dropdown offers it as a choice
  // and "Add sort" never seeds it. That holds for each reason the exception
  // keeps a field: unreadable, relational, or refused by the platform (or by
  // the type read when no projection is served). A field the two rules list
  // anyway carries no flag, whether or not the sort names it.
  //
  // ONE read of the served projection, for BOTH legs below — the list this
  // picker renders, and the sort it emits for a host to persist. Read twice,
  // the two copies could answer differently about the same field on the same
  // render, which is the drift `isPlatformSortableField` was consolidated to
  // end. `undefined` stays "no signal served", never "nothing is sortable".
  const platformSortability = React.useMemo(
    () => readObjectSortability(objectDef),
    [objectDef],
  );

  const { sortFields, sortHasRelationalField, sortPicksRelationalField } = React.useMemo(() => {
    const inUse = new Set(currentSort.map((item) => item.field).filter(Boolean));
    let excluded = false;
    // objectui#12528 — the current sort names a relational field (a stored or
    // URL sort; the picker never offers one), so the list IS sorted by the
    // stored ID: said in one line under the rows, only while it is true.
    let picked = false;
    const fields: Array<{ value: string; label: string; disabled?: boolean }> = [];
    for (const field of candidateFields) {
      const readable = canReadField(perms, schema.objectName, field.value);
      if (!readable && !inUse.has(field.value)) continue;
      const relational = EXPANDABLE_FIELD_TYPES.has(field.type);
      const platformSortable = platformSortability
        ? isPlatformSortableField(platformSortability, field.value)
        : !UNMATERIALIZED_FIELD_TYPES.has(field.type);
      if (readable && !relational && platformSortable) {
        fields.push({ value: field.value, label: field.label });
        continue;
      }
      if (inUse.has(field.value)) {
        if (relational) picked = true;
        // Listed only because the current sort names it: `disabled`, so its
        // own row shows it and can drop it, and nothing can choose it anew.
        fields.push({
          value: field.value,
          label: relational ? `${field.label} ${t('list.sortByIdSuffix')}` : field.label,
          disabled: true,
        });
        continue;
      }
      if (relational) excluded = true;
    }
    return { sortFields: fields, sortHasRelationalField: excluded, sortPicksRelationalField: picked };
  }, [candidateFields, currentSort, t, platformSortability, perms, schema.objectName]);

  /**
   * [#6455] THE persist boundary: what this picker LISTS is not what it
   * PERSISTS.
   *
   * The exception just above deliberately keeps a platform-refused field
   * listed while the CURRENT sort names it — it is the only way a user can
   * REMOVE a sort the server refuses outright. But the picker used to render
   * and emit from the SAME array, so any OTHER edit in the popover — adding a
   * second key, flipping a direction — re-emitted the refused entry, and the
   * host's `onSortChange` stored it (then through `persistViewPatch({ sort })`,
   * the toolbar's view write, retired in objectui#12504; today on the user's
   * own list state): a personalization write storing a column the platform
   * answers `400 INVALID_SORT` for, written by a user who never touched that
   * row.
   *
   * So the two legs part company HERE, at the one boundary every emit crosses,
   * exactly as #5729 parted them at the grid seam (`ObjectGrid`'s
   * `manualSort` / `manualOnSortChange` pair). The refused entry stays in
   * `currentSort` — listed, removable, and still the order this list asks the
   * server for — while no write ever carries it. Removing it persists the
   * removal; a sort with nothing refused in it is emitted unchanged.
   *
   * Every `onSortChange` in this component goes through here rather than each
   * call site filtering for itself: a builder edit, a header click and a
   * "reset to default" are three doors onto ONE stored `sort`, and a filter
   * spelled three times is a filter one new door can be added without.
   *
   * Only under a served projection: with no signal there is no verdict to
   * filter by, and the pre-objectstack#10235 behaviour stands unchanged.
   */
  const emitSortChange = React.useCallback((next: SortItem[]) => {
    if (!onSortChange) return;
    onSortChange(
      platformSortability
        ? filterPlatformSortableSort(next, platformSortability)
        : next,
    );
  }, [onSortChange, platformSortability]);

  /**
   * A column-header sort from the child grid (#3106).
   *
   * It lands in `currentSort` — the same state the toolbar's sort builder
   * writes — so it becomes a server `$orderby` over the whole collection and
   * the two controls can never disagree about what the list is sorted by. The
   * table hands back `{field, order}`; `SortItem` carries an `id` for the
   * builder's React keys, so one is minted here exactly as `parseSortConfig`
   * does when reading a view's declared sort.
   *
   * The page goes back to 1: a new order makes "page 5" a different set of
   * rows, and staying there would show a slice of an ordering the user has not
   * seen the start of. `onSortChange` fires so a host persists this the same
   * way it persists a builder edit — a header sort is not a lesser sort.
   */
  const handleHeaderSort = React.useCallback((next: Array<{ field: string; order: 'asc' | 'desc' }>) => {
    const items: SortItem[] = next.map((s) => ({
      id: crypto.randomUUID(),
      field: s.field,
      order: s.order,
    }));
    setCurrentSort(items);
    setServerPage(1);
    emitSortChange(items);
  }, [emitSortChange]);

  /**
   * "Reset to the view's default sort" (objectui#4243) — the way back the
   * header click above does not leave.
   *
   * It restores the declared array WHOLE: multi-level, in declared order.
   * Clearing the sort would not put the view back, and rebuilding it by hand
   * is what the card reports as impossible. Deliberately the SIBLING of
   * `handleHeaderSort`, not a special case of it — same `currentSort`, same
   * page reset (a different order makes "page 5" a different set of rows), and
   * the same `onSortChange` notification, so a host persists a reset exactly
   * as it persists a header click or a builder edit.
   *
   * The header click's own semantics are untouched by this: it still replaces
   * the whole array. The ruling adds a way back; it does not change the click.
   */
  const handleResetSort = React.useCallback(() => {
    const restored = parseSortConfig(schema.sort);
    setCurrentSort(restored);
    setServerPage(1);
    emitSortChange(restored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaSortKey, emitSortChange]);

  // Export handler
  const handleExport = React.useCallback((format: 'csv' | 'xlsx' | 'json' | 'pdf') => {
    // Object-level export permission gate. Default-allow.
    if (!exportPermitted) return;
    const exportConfig = resolvedExportOptions;
    const maxRecords = exportConfig?.maxRecords || 0;
    const includeHeaders = exportConfig?.includeHeaders !== false;
    // Download filename: `<配置前缀|对象中文标签|API名>-<视图名>-<日期时间>.<ext>`,
    // e.g. `合同-进行中-20260714-153045.xlsx`. The translated object label
    // (client i18n override → server-translated objectDef.label) beats the raw
    // API name; a configured exportOptions.fileNamePrefix beats both (and
    // suppresses the view label).
    const translatedLabel = objectDef?.label && objectDef?.name && typeof resolveObjectLabel === 'function'
      ? resolveObjectLabel(objectDef)
      : objectDef?.label;
    const fileNameFor = (ext: string) => buildExportFileName(ext, {
      prefix: exportConfig?.fileNamePrefix,
      label: translatedLabel,
      objectName: schema.objectName,
      /**
       * The view's own label, resolved against the display locale — `label` is
       * `string | I18nLabel` (the spec's INLINE locale map) and `viewLabel` is
       * `string`, so the map has to be resolved before it gets here. Same
       * resolver, same argument order as `ObjectGrid`'s twin site.
       *
       * ⛔ NO legacy `title` arm. This read used to be
       * `schema.label || (schema as any).title`, and objectui#8653 item 1
       * retired the second operand — the objectui#7129 route, as taken for
       * `DashboardComponentSchema.title` at `5d0876c5c` — on two
       * measurements:
       *
       *   - `@objectstack/spec/ui`'s `ListViewSchema` REFUSES `title` BY NAME
       *     (`unrecognized_keys: ['title']`) while `ObjectGridPropsSchema`
       *     ACCEPTS it. `packages/types` mirrors the spec rather than ruling
       *     over it, so declaring `title` on `ListViewSchema` would make this
       *     repo accept what the platform save gate rejects. That asymmetry is
       *     also why objectui#6639 could take the DECLARE branch one package
       *     over and this site could not.
       *   - a parse-based census of `apps/ examples/ content/ packages/` found
       *     ZERO `list-view` nodes authoring `title`, so no author loses a
       *     filename to the retirement. Over that same corpus the instrument
       *     reports THREE `object-grid` nodes carrying the key: TWO AUTHORED,
       *     both in `content/docs/api/schema-reference.md`, plus one that is
       *     not authored at all — `plugin-view`'s `ObjectView` composes
       *     `title: schema.table?.title` onto a grid node it builds, so that
       *     third hit is a producer writing the key, not an author declaring
       *     it. Say "authored" or the two numbers disagree.
       *
       * ⭐ The `as any` was also laundering a defect of its own: `X || any`
       * collapses the whole expression to `any`, so a locale-map `label`
       * reached `sanitizeFileNameBase` UNRESOLVED and exported as
       * `[object Object]`. Both halves are pinned in
       * `__tests__/listViewNonAuthorKeys-8653.test.tsx` §3, which reads the
       * download anchor rather than re-implementing the filename.
       */
      viewLabel: resolveInlineI18nLabel(schema.label, displayLocale),
    });

    // Server-streamed path: csv / xlsx / json via dataSource.exportDownload.
    // XLSX is server-only; type-aware value formatting, field resolution and
    // permission enforcement all happen server-side. Mirrors the active view's
    // filter + SEARCH + sort so the exported file matches what the user sees.
    //
    // The search half was missing, and this comment asserted the match anyway:
    // exporting during a search downloaded the unsearched superset. The client
    // fallback below was always right (it serializes `data`, already searched);
    // only this path was wrong, and it is the one that handles xlsx.
    const serverEligible = (format === 'csv' || format === 'xlsx' || format === 'json')
      && typeof dataSource?.exportDownload === 'function'
      && !!schema.objectName
      && exportConfig?.streaming !== false;
    if (serverEligible) {
      const fields = effectiveFields
        .map((f: any) => columnIdentity(f))
        .filter(Boolean) as string[];

      const sort = currentSort.length > 0
        ? currentSort
            .filter(item => item.field)
            .map(item => ({ field: item.field, direction: item.order as 'asc' | 'desc' }))
        : undefined;

      setExportError(null);
      setExportBusy(true);
      void (async () => {
        try {
          // The same three filter sources as the data fetch, from the same
          // function — built INSIDE this `try` (objectui#10789). The lowering
          // refuses a malformed filter with a `FilterOperatorError`, and built
          // before it, the refusal threw out of the Export click uncaught: no
          // file, no message. Here it lands in the catch below, which names it
          // in the toolbar the way the data fetch's own `try` names it in the
          // load-error panel — and nothing is exported unfiltered.
          const finalFilter = buildEffectiveFilter(authoredFilter, appliedFilters, appliedUserFilterConditions);
          const blob = await dataSource!.exportDownload!(schema.objectName!, {
            format: format as 'csv' | 'xlsx' | 'json',
            fields: fields.length ? fields : undefined,
            filter: finalFilter,
            // The other half of what the list is showing. Without it an export
            // taken during a search returned the UNSEARCHED superset — more rows
            // than the screen, in a file that looks authoritative. Needs a server
            // with objectstack#4230; older ones ignore it and behave as before.
            ...(searchTerm ? {
              search: searchTerm,
              ...(schema.searchableFields && schema.searchableFields.length > 0
                ? { searchFields: schema.searchableFields }
                : {}),
            } : {}),
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
          console.error('ListView export failed:', err);
          setExportError(err instanceof Error ? err.message : String(err));
        } finally {
          setExportBusy(false);
        }
      })();
      return;
    }

    // Client-side fallback (csv / json only).
    const exportData = maxRecords > 0 ? data.slice(0, maxRecords) : data;

    if (format === 'csv') {
      const fields = effectiveFields.map((f: any) => columnIdentity(f)).filter(Boolean) as string[];
      const rows: string[] = [];
      if (includeHeaders) {
        rows.push(fields.join(','));
      }
      exportData.forEach(record => {
        rows.push(fields.map((f: string) => {
          const val = record[f];
          // Type-safe serialization: handle arrays, objects, null/undefined
          let str: string;
          if (val == null) {
            str = '';
          } else if (Array.isArray(val)) {
            str = val.map(v =>
              (v != null && typeof v === 'object') ? JSON.stringify(v) : String(v ?? ''),
            ).join('; ');
          } else if (typeof val === 'object') {
            str = JSON.stringify(val);
          } else {
            str = String(val);
          }
          // Escape CSV special characters
          const needsQuoting = str.includes(',') || str.includes('"')
            || str.includes('\n') || str.includes('\r');
          return needsQuoting ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(','));
      });
      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameFor('csv');
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === 'json') {
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameFor('json');
      a.click();
      URL.revokeObjectURL(url);
    }
    setShowExport(false);
    // `searchTerm` / `searchableFields` belong here: the export now narrows by
    // the active search, so a stale closure would export the wrong row set.
  }, [data, effectiveFields, resolvedExportOptions, schema.objectName, authoredFilter, schema.searchableFields, exportPermitted, dataSource, appliedFilters, appliedUserFilterConditions, currentSort, searchTerm, objectDef, resolveObjectLabel]);

  // All available fields for hide/show (with i18n)
  //
  // objectui#11984 — this one list is what the hide-fields popover, the Group
  // editor and the Row color select offer, in the toolbar and in the compact
  // toolbar's View settings popover alike, so the field read is asked here,
  // once, through `canReadField`: a column the caller may not read is offered
  // by none of them. Until the permission answer loads, nothing is withheld,
  // as the column gate defers. A grouping level that already names a withheld
  // field still shows: `GroupingEditor` mounts a value its options do not
  // carry as its own entry, labelled with the field name, so the level can be
  // removed, and no other level or "Add group field" offers it.
  const allFields = React.useMemo(() => {
    return (Array.isArray(schema.columns) ? (schema.columns as any[]) : []).flatMap((f: any) => {
      if (typeof f === 'string') {
        if (!canReadField(perms, schema.objectName, f)) return [];
        return [{ name: f, label: tFieldLabel(f, f) }];
      }
      // `name` here is this popover's OWN key (it drives `hiddenFields`), which
      // is why it keeps that shape — but the value is the column identity, so
      // hiding a column and projecting it now agree (#3104).
      const name = columnIdentity(f);
      // No resolvable identity → nothing to hide or show; it used to render a
      // checkbox keyed `undefined` that could never match a column.
      if (!name || !canReadField(perms, schema.objectName, name)) return [];
      return [{ name, label: tFieldLabel(name, f.label || name) }];
    });
  }, [schema.columns, tFieldLabel, perms, schema.objectName]);

  // objectui#11984 — what the two hide-fields lists (the toolbar popover and
  // the View settings section) are handed of `hiddenFields`. An entry naming a
  // field the caller may not read is WITHHELD from them: not listed, not
  // counted in their badges, not cleared by their "Show all", and put back by
  // every write they make, so the stored list keeps it. Hiding such a column
  // changes nothing for this caller, since the column gate already drops it,
  // and a "Show all" that cleared it would rewrite the view for its other
  // viewers through an entry this caller was never shown. With nothing
  // withheld (full read, or no answer loaded yet) both are exactly
  // `hiddenFields` and `updateHiddenFields`. Plain per-render values, not
  // memos (AGENTS.md #10).
  const withheldHiddenFields = [...hiddenFields].filter((name) => !canReadField(perms, schema.objectName, name));
  const offeredHiddenFields = withheldHiddenFields.length === 0
    ? hiddenFields
    : new Set([...hiddenFields].filter((name) => !withheldHiddenFields.includes(name)));
  const updateOfferedHiddenFields = (next: Set<string>) =>
    updateHiddenFields(withheldHiddenFields.length === 0 ? next : new Set([...next, ...withheldHiddenFields]));

  // objectui#11984 — a row-color rule on a field the caller may not read is
  // withheld from both Row color selects the same way: they show "None" with
  // no Clear, and the trigger is not marked active. The rule itself stays in
  // `rowColorConfig`, which only a pick in those selects ever replaces. It
  // colors nothing for this caller: their fetch does not ask for a field they
  // may not read and the server masks it out of their rows, so the rows carry
  // no value to color by.
  const offeredRowColorConfig =
    rowColorConfig && canReadField(perms, schema.objectName, rowColorConfig.field) ? rowColorConfig : undefined;

  /**
   * objectui#12423 — what the Display control counts on its trigger and what
   * its "Reset to view default" hands back: each setting it offers whose value
   * differs from the VIEW'S OWN. For most settings that is the value this list
   * was handed in `schema`.
   *
   * objectui#12949 — hidden fields and density are the exception wherever a
   * host persists them as the USER'S preference (the console, since
   * objectui#12474): it lays that preference over the view's value in
   * `schema`, so `schema` there is the user's own choice, and a comparison
   * against it reads "nothing to reset" straight after a reload. Such a host
   * hands the view's own value in `viewDefaults`, and these two settings
   * compare against that; the reset writes it through the controls' doors, so
   * the user's preference follows. Without `viewDefaults`, `schema` is the
   * view's own. Plain per-render values, never memo identities (AGENTS.md #10).
   */
  const authoredGalleryCardSize: GalleryCardSize = (schema.gallery?.cardSize as GalleryCardSize | undefined) ?? 'medium';
  const viewDefaultHiddenFields = viewDefaults ? viewDefaults.hiddenFields : schema.hiddenFields;
  // The same resolution `resolvedDensity` applies to `schema.rowHeight`.
  const viewDefaultDensity = viewDefaults
    ? rowHeightToDensityMode(viewDefaults.rowHeight) ?? 'compact'
    : resolvedDensity;
  const sortedNames = (names: Iterable<string> | undefined) => JSON.stringify([...(names ?? [])].sort());
  const displayDeviation = {
    layout: viewSwitcherOffered && !!schema.viewType && currentView !== schema.viewType,
    group: toolbarFlags.showGroup
      && JSON.stringify(groupingConfig?.fields ?? []) !== JSON.stringify(initialGroupingConfig?.fields ?? []),
    color: toolbarFlags.showColor && (rowColorConfig?.field ?? '') !== (schema.rowColor?.field ?? ''),
    hiddenFields: toolbarFlags.showHideFields && sortedNames(hiddenFields) !== sortedNames(viewDefaultHiddenFields),
    density: toolbarFlags.showDensity && (currentView === 'gallery'
      ? galleryCardSize !== authoredGalleryCardSize
      : density.mode !== viewDefaultDensity),
    rowNumbers: currentView === 'grid' && rowNumbers !== defaultRowNumbers,
    inlineEdit: currentView === 'grid' && inlineEditOffered && inlineEdit !== !!schema.inlineEdit,
  };
  const displayChangedCount = Object.values(displayDeviation).filter(Boolean).length;
  /** Every setting back to the view's own, each through the door its control writes through. */
  const resetDisplayToViewDefault = () => {
    if (displayDeviation.layout) handleViewChange(schema.viewType as ListViewVisualization);
    if (displayDeviation.group) changeGrouping(initialGroupingConfig);
    if (displayDeviation.color) setRowColorConfig(schema.rowColor);
    if (displayDeviation.hiddenFields) updateHiddenFields(new Set(viewDefaultHiddenFields || []));
    if (displayDeviation.density) {
      if (currentView === 'gallery') {
        setGalleryCardSize(authoredGalleryCardSize);
        try { window.localStorage.setItem(galleryDensityKey, authoredGalleryCardSize); } catch { /* private mode */ }
      } else {
        density.setMode(viewDefaultDensity);
      }
    }
    if (displayDeviation.rowNumbers) setRowNumbers(defaultRowNumbers);
    if (displayDeviation.inlineEdit) updateInlineEdit(!!schema.inlineEdit);
  };

  /**
   * The user-filter chips the toolbar renders (ADR-0053: `userFilters`, dropdown
   * or tabs, is the sole page filter control).
   *
   * objectui#11984 — the dropdown and toggle chips are a field list too, whether
   * the author named the fields or `resolvedUserFilters` derived them from the
   * object definition, so each asks `canReadField`. A chip on a field the caller
   * may not read is dropped: a value chosen on it is a filter the server refuses
   * with 403, and the list blanks. The exception is a chip whose field a held
   * selection already names, the applied user filter or a selection the host
   * restored (`userFilterSelections`): it stays, so the filter it holds can be
   * cleared, as the Sort picker keeps a field its current sort names. The
   * preset tabs carry filters, not a field list, and pass through unchanged.
   */
  const filterElements = React.useMemo(() => {
    if (!resolvedUserFilters?.fields?.length) return resolvedUserFilters;
    const held = new Set(Object.keys(userFilterSelections ?? {}).filter((field) => userFilterSelections?.[field]?.length));
    for (const condition of userFilterConditions) if (Array.isArray(condition)) held.add(condition[0]);
    return {
      ...resolvedUserFilters,
      fields: resolvedUserFilters.fields.filter((f) => held.has(f.field) || canReadField(perms, schema.objectName, f.field)),
    };
  }, [resolvedUserFilters, userFilterConditions, userFilterSelections, perms, schema.objectName]);

  /**
   * The list region's ARIA attributes, read through the ONE reader of the
   * nested bag (objectui#11083).
   *
   * The NESTED bag is the spec's `AriaPropsSchema`, whose `ariaLabel` is
   * `I18nLabel`: a plain string **or** an inline locale map
   * (`{ en: 'Accounts', 'zh-CN': '客户' }`). `resolveInlineAriaProps` from
   * `@object-ui/react` maps its three keys (`ariaLabel`, `ariaDescribedBy`,
   * `role`) and resolves the label against the display locale, so this
   * component keeps no mapping of its own. A key that resolves to nothing is
   * left out: no accessible name beats a garbage one. This read site once spread
   * the label with `as string`, so a map reached the DOM as
   * `aria-label="[object Object]"` (objectui#5134).
   *
   * What stays here is only what is this view's own:
   *   - the default role, `region`, when the author declares none;
   *   - `aria.live`, the one key objectui's `ListViewSchema` adds to the spec's
   *     bag (`.extend({ live })`, kept by objectui#2890). The shared reader does
   *     not read it, because the spec's shape does not declare it.
   *
   * ⚠️ The FLAT `schema.ariaLabel` is a different vocabulary — objectui's
   * keyed `{ key, defaultValue?, params? }` ref, resolved by `SchemaRenderer`'s
   * `resolveKeyedI18nLabel` — and is deliberately NOT touched here. Neither
   * resolver accepts the other's shape.
   */
  const regionAria = resolveInlineAriaProps(schema.aria, displayLocale);

  /**
   * The view's description, resolved — not type-tested (objectui#7199).
   *
   * `ListViewSchema.description` is `I18nLabel`, the same vocabulary as the
   * sibling `label`: a plain string **or** an inline locale map
   * (`{ en: 'Open work only', 'zh-CN': '仅未完成' }`). This read site used to
   * be `typeof schema.description === 'string' ? schema.description : ''`,
   * which is not a resolution — it is a type test that answers the empty
   * string for every map an author is entitled to write. So a locale-map
   * description rendered as a blank strip in EVERY locale, which is the same
   * silent-blank symptom as the dropped relay one layer up, reached by a
   * second route.
   *
   * `pickLocalized` is the spelling a TEXT NODE wants (`''` on a miss) — the
   * same helper `TabBar.tsx` resolves the sibling `label` with, one component
   * tree away. The attribute next door deliberately uses the spec's resolver
   * instead, for its `undefined`; the two agree limb for limb, pinned by
   * `i18nLabel-resolver-parity.test.ts` in this package.
   *
   * Guarding on the RESOLVED text rather than on `schema.description` is what
   * keeps a map with no usable entry from drawing an info control with no
   * text (once an empty strip, objectui#12528): the raw value is a truthy
   * object, its resolution is `''`.
   */
  const viewDescription = pickLocalized(schema.description, displayLocale);

  // objectui#12440 — the host's leading toolbar node. `null`, `undefined` and
  // `false` draw nothing in React, so they draw no wrapper either: a host that
  // passes one of them gets today's row.
  const hasToolbarLeading = toolbarLeading != null && toolbarLeading !== false;

  // objectui#12528 — the description no longer takes a row above the toolbar
  // (it moved the toolbar down by a line on the views that have one). A host
  // tab strip carries it on the active tab (see `toolbarLeading`); without one
  // — the console below `sm`, any other host — it is this info control's
  // tooltip and accessible name, inside the toolbar row's own height.
  // `appearance.showDescription: false` still shows it nowhere.
  const showDescriptionInfo =
    !!viewDescription && schema.appearance?.showDescription !== false && !hasToolbarLeading;

  // objectui#12528 — the footer row's two halves. The summaries only ever come
  // from the grid (`gridSummaries`), so they are read only while it is the view
  // on screen; the row draws for either half, so `showRecordCount: false` does
  // not take the summaries down with the count.
  const recordCountShown =
    !loading && data.length > 0 && surfaceDrawsFetchedRows && schema.showRecordCount !== false;
  // objectui#12619 — a board that pages its own lanes draws every record of the
  // view, a page per lane at a time, so the footer counts the VIEW: the total
  // this component's own query answered, which is the sum of the board's lane
  // counts. No "Showing first N" line: the board is not a window. Without a
  // total the footer says nothing rather than count its own window.
  const boardRecordCountShown =
    kanbanLanesPaged && !loading && data.length > 0 && typeof fetchedTotal === 'number' && schema.showRecordCount !== false;
  const footerSummaryText =
    currentView === 'grid' && gridSummaries && gridSummaries.length > 0
      ? gridSummaries.map((s) => `${s.header}: ${s.label}`).join(' · ')
      : '';

  // objectui#12703 — the compact posture a narrow page region asks for (the
  // `compact` host prop). Only over a paged grid that draws the rows this
  // component fetched: there the rows ARE the list, and two lines each say
  // what a grid row said. A board, a calendar or a grouped grid keeps its own
  // rendering, because its structure is its meaning.
  const compactPosture = compact && paginate && surfaceDrawsFetchedRows;
  const compactTitle = compactPosture
    ? (resolveInlineI18nLabel(schema.label, displayLocale)
      || (objectDef?.label && objectDef?.name && typeof resolveObjectLabel === 'function'
        ? resolveObjectLabel(objectDef)
        : objectDef?.label)
      || undefined)
    : undefined;
  // The count the full list's footer would print: the server's total, or the
  // rows in hand when the whole result is in memory.
  const compactCount = compactPosture && !loading && !loadError ? (serverTotal ?? data.length) : null;

  return (
    <div
      ref={pullRef}
      className={cn('flex flex-col h-full bg-background relative min-w-0 overflow-hidden', className)}
      {...regionAria}
      role={regionAria.role ?? 'region'}
      {...(schema.aria?.live ? { 'aria-live': schema.aria.live } : {})}
      aria-busy={loading || undefined}
      data-state={loading ? 'loading' : 'idle'}
    >
      {pullDistance > 0 && (
        <div
          className="flex items-center justify-center text-xs text-muted-foreground"
          style={{ height: pullDistance }}
        >
          {isRefreshing ? t('list.refreshing') : t('list.pullToRefresh')}
        </div>
      )}

      {/* objectui#12703 — the compact posture's header stands where the
          toolbar stands: the list's title and its record count. */}
      {compactPosture && (
        <ListViewCompactHeader
          title={typeof compactTitle === 'string' ? compactTitle : undefined}
          count={compactCount}
          countLabel={compactCount != null ? t('list.recordCount', { count: compactCount }) : undefined}
        />
      )}

      {/* Unified toolbar — Tabs + UserFilters (left) + Tool buttons (right) on one row.
          The right-hand cluster is wrapped in a single rounded pill container
          with vertical dividers (Linear / Notion style) so utility buttons
          read as one segmented control rather than a loose bag of icons.
          Not in the compact posture (objectui#12703). */}
      {!compactPosture && (
      <div className="border-b px-2 sm:px-4 py-1.5 flex items-center justify-between gap-1 sm:gap-2 bg-background">
        {/* With a host's leading node the left group grows (`flex-1`) so that
            node's `flex-1` wrapper has the width the tool cluster leaves —
            a width-fitted tab strip folds whatever does not fit
            (objectui#12440). Without one, the group is unchanged. */}
        <div className={hasToolbarLeading ? 'flex flex-1 items-center gap-2 overflow-x-auto min-w-0' : 'flex items-center gap-2 overflow-x-auto min-w-0'}>
          {showDescriptionInfo && (
            <span
              role="img"
              tabIndex={0}
              title={viewDescription}
              aria-label={viewDescription}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="view-description-info"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
          {hasToolbarLeading && (
            <div className="flex min-w-0 flex-1 items-center" data-testid="list-toolbar-leading">
              {toolbarLeading}
            </div>
          )}
          {/* User Filters — filter elements (dropdown chips / preset tabs /
              toggles). Mutually exclusive with view tabs above, so at most
              one filter element group ever renders here. On mobile we keep
              them visible (single line, scrollable) to match the Airtable
              Interface pattern. Withheld on a dataset-bound chart, which they
              cannot reach (`datasetChartOnScreen`, objectui#10327). */}
          {filterElements && toolbarFlags.showUserFilters && (
              <div className="shrink-0 min-w-0 overflow-x-auto" data-testid="user-filters">
                <UserFilters
                  config={filterElements}
                  objectDef={objectDef}
                  objectDefPending={!objectDefLoaded}
                  data={data}
                  onFilterChange={setUserFilterConditions}
                  maxVisible={3}
                  initialSelections={userFilterSelections}
                  onSelectionsChange={onUserFilterSelectionsChange}
                />
              </div>
          )}
        </div>

        {/* `data-print-hide`: the tool cluster is pure interaction (print,
            share, export, filter, sort, density, search) and reads as clutter
            on paper. The RULE lives in the shared print sheet
            (`@object-ui/app-shell/styles.css`, objectui#4462) — this is only
            the marker it needs, because the cluster carries no stable
            selector of its own and its Tailwind class string is not
            distinguishable from a content div's. The left half of the toolbar
            (view tabs + active filter chips) deliberately still prints: it
            says WHICH slice of the data is on the page. */}
        <div className="flex items-center gap-0 shrink-0 rounded-lg border border-border bg-muted/40 p-0.5 shadow-sm" data-print-hide>
          {/* Visualization switcher — compact dropdown (Airtable-style
              "List ▾"), first slot of the right tool cluster so the whole
              toolbar stays a single row. The Display form carries it as its
              Layout row instead (objectui#12423). */}
          {viewSwitcherOffered && !toolbarFlags.compactToolbar && (
            <>
              <ViewSwitcherDropdown
                currentView={currentView}
                availableViews={availableViews}
                onViewChange={handleViewChange}
              />
              <div className="h-4 w-px bg-border/60 mx-0.5" />
            </>
          )}
          {/* Inline edit — toggle record editing for this (grid) view, for the
              session (objectui#5144, ruling E). Reported via onInlineEditChange.
              [#4647] `inlineEditOffered` carries BOTH the `can(obj,'update')`
              permission gate this affordance was missing and the declared
              `userActions.editInline` switch — see its definition above. */}
          {currentView === 'grid' && onInlineEditChange && !toolbarFlags.compactToolbar && inlineEditOffered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateInlineEdit(!inlineEdit)}
              // A toggle button announces its state (objectui#11816): the
              // `text-primary` tint below was the mode's only signal.
              aria-pressed={inlineEdit}
              className={cn(
                "hidden sm:inline-flex h-7 px-2 text-muted-foreground hover:text-primary text-xs transition-colors duration-150",
                inlineEdit && "text-primary"
              )}
              title={t('list.inlineEditLabel', { defaultValue: 'Edit records inline (click a cell to edit)' })}
              data-testid="toolbar-inline-edit-toggle"
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              <span className="hidden sm:inline">{t('list.inlineEditShort', { defaultValue: 'Edit inline' })}</span>
            </Button>
          )}
          {/* Hide Fields — hidden on mobile (collapsed into ViewSettingsPopover) */}
          {toolbarFlags.showHideFields && !toolbarFlags.compactToolbar && (
          <Popover open={showHideFields} onOpenChange={setShowHideFields}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "hidden sm:inline-flex h-7 px-2 text-muted-foreground hover:text-primary text-xs transition-colors duration-150",
                  offeredHiddenFields.size > 0 && "text-primary"
                )}
              >
                <EyeOff className="h-3.5 w-3.5 mr-1.5" />
                <span className="hidden sm:inline">{t('list.hideFields')}</span>
                {offeredHiddenFields.size > 0 && (
                  <span className="ml-1 flex h-4 min-w-[16px] items-center justify-center text-[10px] font-medium text-muted-foreground tabular-nums">
                    {offeredHiddenFields.size}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="font-medium text-sm">{t('list.hideFieldsTitle')}</h4>
                  {offeredHiddenFields.size > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => updateOfferedHiddenFields(new Set())}>
                      {t('list.showAll')}
                    </Button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {allFields.map((field: any) => (
                    <label key={field.name} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!offeredHiddenFields.has(field.name)}
                        onChange={() => {
                          const next = new Set(offeredHiddenFields);
                          if (next.has(field.name)) {
                            next.delete(field.name);
                          } else {
                            next.add(field.name);
                          }
                          updateOfferedHiddenFields(next);
                        }}
                        className="rounded border-input"
                      />
                      <span className="truncate">{field.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
          )}

          {/* --- Separator: Hide Fields | Data Manipulation --- */}
          {toolbarFlags.showHideFields && !toolbarFlags.compactToolbar && (toolbarFlags.showFilters || toolbarFlags.showSort || toolbarFlags.showGroup) && (
            <div className="hidden sm:block h-5 w-px bg-border/50 mx-1 shrink-0" />
          )}

          {/* Filter — universal advanced filter builder.
              Always shown when enabled. The left-side quick-filter chips
              (filterElements) are predefined named filters; the
              right-side Popover is a free-form field-by-field builder that
              can express filters the chips cannot. They serve different
              purposes and must coexist. */}
          {toolbarFlags.showFilters && (
          <Popover open={showFilters} onOpenChange={setShowFilters}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 min-w-7 gap-1 px-1.5 text-muted-foreground hover:text-primary text-xs transition-colors duration-150",
                  hasFilters && "text-foreground font-medium"
                )}
                data-testid="toolbar-filter-trigger"
                // Filter, Sort and Display are icon buttons at every width
                // (objectui#12695), so the name rides on `aria-label` and
                // `title` — with the active-filter count, which the badge
                // would otherwise be alone in carrying (objectui#12500).
                aria-label={hasFilters
                  ? t('list.filterActive', { count: currentFilters.conditions?.length || 0 })
                  : t('list.filter')}
                title={t('list.filter')}
              >
                <Funnel className="h-3.5 w-3.5" />
                {hasFilters && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center text-[10px] font-medium text-muted-foreground tabular-nums">
                    {currentFilters.conditions?.length || 0}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[calc(100vw-2rem)] sm:w-[600px] max-w-[600px] p-3 sm:p-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="font-medium text-sm">{t('list.filterRecords')}</h4>
                </div>
                <FilterBuilder
                  fields={filterFields}
                  value={currentFilters}
                  extraOperators={LIST_VIEW_EXTRA_OPERATORS}
                  onChange={(newFilters) => {
                    setCurrentFilters(newFilters);
                    if (onFilterChange) onFilterChange(newFilters);
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>
          )}

          {/* Group — hidden on mobile (collapsed into ViewSettingsPopover) */}
          {toolbarFlags.showGroup && !toolbarFlags.compactToolbar && (
          <Popover open={showGroupPopover} onOpenChange={setShowGroupPopover}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "hidden sm:inline-flex h-7 px-2 text-muted-foreground hover:text-primary text-xs transition-colors duration-150",
                  groupingConfig && "text-foreground font-medium"
                )}
              >
                <Group className="h-3.5 w-3.5 mr-1.5" />
                <span className="hidden sm:inline">{t('list.group')}</span>
                {groupingConfig && groupingConfig.fields?.length > 0 && (
                  <span className="ml-1 flex h-4 min-w-[16px] items-center justify-center text-[10px] font-medium text-muted-foreground tabular-nums">
                    {groupingConfig.fields.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="font-medium text-sm">{t('list.groupBy')}</h4>
                  {groupingConfig && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => changeGrouping(undefined)} data-testid="clear-grouping">
                      {t('list.clear')}
                    </Button>
                  )}
                </div>
                <div data-testid="group-field-list">
                  <GroupingEditor
                    value={groupingConfig as any}
                    fieldOptions={allFields.map((f: any) => ({ value: f.name, label: f.label || f.name }))}
                    maxLevels={3}
                    labels={{
                      addGroup: t('list.addGroup', { defaultValue: 'Add group field' }),
                      collapseTitle: t('list.collapsedByDefault', { defaultValue: 'Collapsed by default' }),
                      removeTitle: t('list.removeGroup', { defaultValue: 'Remove' }),
                    }}
                    onChange={changeGrouping}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>
          )}

          {/* Sort — desktop only. Mobile relies on the (typically pre-sorted)
              default view; users who need ad-hoc sorting switch to desktop. */}
          {toolbarFlags.showSort && (
          <Popover open={showSort} onOpenChange={setShowSort}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "hidden sm:inline-flex h-7 min-w-7 gap-1 px-1.5 text-muted-foreground hover:text-primary text-xs transition-colors duration-150",
                  currentSort.length > 0 && "text-foreground font-medium"
                )}
                data-testid="toolbar-sort-trigger"
                // Icon-only (objectui#12695): no visible label carries the
                // name, so `aria-label` and `title` do.
                aria-label={t('list.sort')}
                title={t('list.sort')}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                {currentSort.length > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center text-[10px] font-medium text-muted-foreground tabular-nums">
                    {currentSort.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[calc(100vw-2rem)] sm:w-[600px] max-w-[600px] p-3 sm:p-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <div className="flex items-center gap-1">
                    <h4 className="font-medium text-sm">{t('list.sortRecords')}</h4>
                    {/* objectui#12528 — the note on why linked columns are not
                        listed, as this control's tooltip and accessible name
                        beside the field list, instead of a standing paragraph
                        that took about half the popover on every open. Drawn
                        under the paragraph's own condition: a relational field
                        was left out. */}
                    {sortHasRelationalField && (
                      <span
                        role="img"
                        tabIndex={0}
                        title={t('list.sortRelationalHint')}
                        aria-label={t('list.sortRelationalHint')}
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="sort-relational-info"
                      >
                        <Info className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                  {/* Reset to the view's declared sort (objectui#4243).
                      Rendered only when the view DECLARES one: with nothing
                      declared there is no default to return to, and a control
                      under this label that merely cleared the sort would be a
                      second, differently-named way to do what removing the
                      rows already does. Disabled — not hidden — while the
                      active sort already equals the declared one, so the
                      affordance stays discoverable and says "you are at the
                      default" instead of vanishing. */}
                  {declaredSort.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
                      disabled={!sortDiffersFromDeclared}
                      onClick={handleResetSort}
                      data-testid="sort-reset-default"
                    >
                      {t('list.resetSortToDefault')}
                    </Button>
                  )}
                </div>
                <SortBuilder
                  fields={sortFields}
                  value={currentSort}
                  onChange={(newSort) => {
                    // `setCurrentSort` takes the array WHOLE (the in-use
                    // exception depends on it); `emitSortChange` is what the
                    // host persists. See the boundary's docblock above.
                    setCurrentSort(newSort);
                    emitSortChange(newSort);
                  }}
                />
                {sortPicksRelationalField && (
                  <p className="truncate text-xs text-muted-foreground" data-testid="sort-relational-picked">
                    {t('list.sortRelationalPicked')}
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>
          )}

          {/* --- Separator: Data Manipulation | Appearance --- */}
          {!toolbarFlags.compactToolbar && (toolbarFlags.showFilters || toolbarFlags.showSort || toolbarFlags.showGroup) && (toolbarFlags.showColor || toolbarFlags.showDensity) && (
            <div className="hidden sm:block h-5 w-px bg-border/50 mx-1 shrink-0" />
          )}

          {/* Color — hidden on mobile (collapsed into ViewSettingsPopover) */}
          {toolbarFlags.showColor && !toolbarFlags.compactToolbar && (
          <Popover open={showColorPopover} onOpenChange={setShowColorPopover}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "hidden sm:inline-flex h-7 px-2 text-muted-foreground hover:text-primary text-xs transition-colors duration-150",
                  offeredRowColorConfig && "text-foreground font-medium"
                )}
              >
                <Paintbrush className="h-3.5 w-3.5 mr-1.5" />
                <span className="hidden sm:inline">{t('list.color')}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="font-medium text-sm">{t('list.rowColor')}</h4>
                  {offeredRowColorConfig && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setRowColorConfig(undefined)} data-testid="clear-row-color">
                      {t('list.clear')}
                    </Button>
                  )}
                </div>
                <div className="space-y-2" data-testid="color-field-list">
                  <label className="text-xs text-muted-foreground">{t('list.colorByField')}</label>
                  {/* The value is the OFFERED rule's field: a rule on a field
                      the caller may not read reaches this picker as `''`
                      ("None"), so its outside-value item can never name that
                      field (objectui#11984). */}
                  <ListOptionPicker
                    className="h-8 rounded px-2 text-xs"
                    testId="color-field-select"
                    value={offeredRowColorConfig?.field || ''}
                    options={[
                      { value: '', label: t('list.none') },
                      ...allFields.map((field: any) => ({ value: field.name, label: field.label })),
                    ]}
                    onPick={(field) => {
                      if (!field) {
                        setRowColorConfig(undefined);
                      } else {
                        setRowColorConfig({ field, colors: offeredRowColorConfig?.colors || {} });
                      }
                    }}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>
          )}

          {/* Row Height / Density Mode — table-style density (rowHeight) */}
          {toolbarFlags.showDensity && !toolbarFlags.compactToolbar && currentView !== 'gallery' && (() => {
            const DensityIcon = density.mode === 'compact' ? Rows4 : density.mode === 'comfortable' ? Rows3 : Rows2;
            const modeLabel =
              density.mode === 'compact'
                ? t('grid.toolbar.densityCompact', { defaultValue: 'Compact' })
                : density.mode === 'comfortable'
                  ? t('grid.toolbar.densityComfortable', { defaultValue: 'Comfortable' })
                  : t('grid.toolbar.densitySpacious', { defaultValue: 'Spacious' });
            const densityLabel = t('grid.toolbar.densityMode', { defaultValue: 'Density' });
            const ariaLabel = `${densityLabel}: ${modeLabel}`;
            const titleLabel = t('grid.toolbar.densityCycleHint', {
              defaultValue: '{{label}} (click to cycle)',
              label: ariaLabel,
            });
            return (
              <Button
                variant="ghost"
                size="sm"
                aria-label={ariaLabel}
                className={cn(
                  "hidden sm:inline-flex h-7 w-7 p-0 text-muted-foreground hover:text-primary transition-colors duration-150",
                  density.mode !== 'compact' && "text-foreground font-medium"
                )}
                onClick={density.cycle}
                title={titleLabel}
              >
                <DensityIcon className="h-3.5 w-3.5" />
              </Button>
            );
          })()}

          {/* Gallery card density — same toolbar slot, only when gallery view is active */}
          {toolbarFlags.showDensity && !toolbarFlags.compactToolbar && currentView === 'gallery' && (() => {
            const GalleryDensityIcon = galleryCardSize === 'small' ? Rows4 : galleryCardSize === 'medium' ? Rows3 : Rows2;
            const modeLabel =
              galleryCardSize === 'small'
                ? t('grid.toolbar.densityCompact', { defaultValue: 'Compact' })
                : galleryCardSize === 'medium'
                  ? t('grid.toolbar.densityComfortable', { defaultValue: 'Comfortable' })
                  : t('grid.toolbar.densitySpacious', { defaultValue: 'Spacious' });
            const densityLabel = t('grid.toolbar.densityMode', { defaultValue: 'Density' });
            const ariaLabel = `${densityLabel}: ${modeLabel}`;
            const titleLabel = t('grid.toolbar.densityCycleHint', {
              defaultValue: '{{label}} (click to cycle)',
              label: ariaLabel,
            });
            return (
              <Button
                variant="ghost"
                size="sm"
                aria-label={ariaLabel}
                className={cn(
                  "hidden sm:inline-flex h-7 w-7 p-0 text-muted-foreground hover:text-primary transition-colors duration-150",
                  galleryCardSize !== 'small' && "text-foreground font-medium",
                )}
                onClick={cycleGalleryDensity}
                title={titleLabel}
              >
                <GalleryDensityIcon className="h-3.5 w-3.5" />
              </Button>
            );
          })()}

          {/* Display (objectui#12423) — the default form of this cluster:
              Layout, Group, Color, Hide fields, Density, Row numbers and Edit
              inline in one panel, with Reset / Refresh / Export in its footer.
              Every control writes through the same door as its wide-form
              button above; the panel adds no storage of its own. Drawn on
              mobile too (icon only): Refresh and Export live in it. */}
          {toolbarFlags.compactToolbar && (
            viewSwitcherOffered || toolbarFlags.showGroup || toolbarFlags.showColor || toolbarFlags.showDensity
            || toolbarFlags.showHideFields || currentView === 'grid' || toolbarFlags.showRefresh
            || (resolvedExportOptions && exportPermitted && exportableFormats.length > 0)
          ) && (
            <ViewSettingsPopover
              t={t as any}
              allFields={allFields as any}
              layout={viewSwitcherOffered ? (closeMenu) => (
                <ViewSwitcherDropdown
                  currentView={currentView}
                  availableViews={availableViews}
                  onViewChange={(view) => {
                    // Choosing a layout completes the choice: Display closes
                    // (objectui#12621).
                    closeMenu();
                    handleViewChange(view);
                  }}
                />
              ) : undefined}
              showGroup={toolbarFlags.showGroup}
              groupingConfig={groupingConfig}
              setGroupingConfig={changeGrouping}
              showColor={toolbarFlags.showColor}
              rowColorConfig={offeredRowColorConfig}
              setRowColorConfig={setRowColorConfig}
              showDensity={toolbarFlags.showDensity}
              density={currentView === 'gallery'
                ? {
                    mode: galleryCardSize === 'small' ? 'compact' : galleryCardSize === 'medium' ? 'comfortable' : 'spacious',
                    cycle: cycleGalleryDensity,
                  }
                : density as any}
              showHideFields={toolbarFlags.showHideFields}
              hiddenFields={offeredHiddenFields}
              updateHiddenFields={updateOfferedHiddenFields}
              rowNumbers={rowNumbers}
              setRowNumbers={currentView === 'grid' ? setRowNumbers : undefined}
              /* [#4647] The Display panel's inline-edit entry — the SECOND
                 render site for this affordance, and the one with no gate at
                 all: it never even required `onInlineEditChange`. Same
                 `inlineEditOffered` verdict as the wide toolbar's toggle, or a
                 read-only principal would keep the entry here after losing it
                 there. */
              showInlineEdit={currentView === 'grid' && inlineEditOffered}
              inlineEdit={inlineEdit}
              setInlineEdit={updateInlineEdit}
              changedCount={displayChangedCount}
              onReset={resetDisplayToViewDefault}
              onRefresh={toolbarFlags.showRefresh ? () => setRefreshKey(k => k + 1) : undefined}
              refreshing={loading}
              exportFormats={resolvedExportOptions && exportPermitted && exportableFormats.length > 0 ? exportableFormats : undefined}
              onExport={(format) => handleExport(format as 'csv' | 'xlsx' | 'json' | 'pdf')}
              exportBusy={exportBusy}
              exportError={exportError}
            />
          )}

          {/* --- Separator: Appearance | Export (wide form) --- */}
          {!toolbarFlags.compactToolbar && (toolbarFlags.showColor || toolbarFlags.showDensity) && resolvedExportOptions && exportPermitted && exportableFormats.length > 0 && (
            <div className="h-5 w-px bg-border/50 mx-1 shrink-0" />
          )}

          {/* Refresh — re-fetch the current view from the backend without a full page
              reload. Filters / sort / pagination / search all live in component state,
              so bumping refreshKey re-queries while preserving the view. In the wide
              form a bar button (mobile + desktop); in the Display form it sits in
              the panel's footer. */}
          {toolbarFlags.showRefresh && !toolbarFlags.compactToolbar && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-primary transition-colors duration-150"
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={loading}
              title={t('list.refresh')}
              aria-label={t('list.refresh')}
              data-testid="refresh-button"
            >
              <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          )}

          {/* Export — wide form only; the Display form's footer carries it. */}
          {!toolbarFlags.compactToolbar && resolvedExportOptions && exportPermitted && exportableFormats.length > 0 && (
            <Popover open={showExport} onOpenChange={setShowExport}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-muted-foreground hover:text-primary text-xs transition-colors duration-150"
                  aria-label={t('list.export')}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  <span className="hidden sm:inline">{t('list.export')}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-48 p-2">
                <div className="space-y-1">
                  {exportableFormats.map((format: any) => (
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
                      {t('list.exportAs', { format: format.toUpperCase() })}
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

          {/* Share — supports both ObjectUI visibility model and spec personal/collaborative model */}
          {schema.sharing?.type && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-primary text-xs transition-colors duration-150"
              title={`Sharing: ${schema.sharing.type}`}
              data-testid="share-button"
            >
              <Share2 className="h-3.5 w-3.5 mr-1.5" />
              <span className="hidden sm:inline">{t('list.share')}</span>
            </Button>
          )}

          {/* Print — hands off to the browser's own print dialog against the
              shared `@media print` sheet in `@object-ui/app-shell/styles.css`.
              It is NOT a PDF export: a list export produces no documents, and
              a printable document is a page that declares `print`
              (objectstack#8346). It was being accepted against "export
              PDF" requirements precisely because nothing said so
              (objectui#4462). `aria-label` + `title` carry that sentence —
              same two-attribute shape as the density button below. */}
          {schema.allowPrinting && (() => {
            const printHint = t('common.printDialogHint');
            return (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-primary text-xs transition-colors duration-150"
                onClick={() => window.print()}
                aria-label={`${t('list.print')}: ${printHint}`}
                title={printHint}
                data-testid="print-button"
              >
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                <span className="hidden sm:inline">{t('list.print')}</span>
              </Button>
            );
          })()}

          {/* --- Separator: Print/Share/Export | Search --- */}
          {(() => {
            const hasLeftSideItems = schema.allowPrinting || !!schema.sharing?.type
              || (!toolbarFlags.compactToolbar && resolvedExportOptions && exportPermitted && exportableFormats.length > 0);
            return toolbarFlags.showSearch && hasLeftSideItems ? (
              <div className="h-5 w-px bg-border/50 mx-1 shrink-0" />
            ) : null;
          })()}

          {/* Search (icon button + popover) — desktop only. The global
              top-bar search (⌘K) is already prominent on mobile, so an
              additional list-scoped search popover would be redundant chrome.
              Filter remains the primary way to narrow data on phones. */}
          {toolbarFlags.showSearch && (
            <Popover open={showSearchPopover} onOpenChange={setShowSearchPopover}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "hidden sm:inline-flex h-7 text-muted-foreground hover:text-primary text-xs transition-colors duration-150",
                    searchTerm ? "px-2 text-foreground font-medium" : "w-7 p-0"
                  )}
                  data-testid="search-icon-button"
                  title={searchTerm ? `${t('list.search')}: ${searchTerm}` : t('list.search')}
                  // An icon-only button names itself (objectui#12450), the same
                  // two-attribute shape as Refresh: `title` alone is a tooltip,
                  // and with a keyword the button's text was the bare keyword.
                  aria-label={searchTerm ? `${t('list.search')}: ${searchTerm}` : t('list.search')}
                >
                  <Search className="h-3.5 w-3.5" />
                  {/* Persisted keyword restored from storage keeps filtering after
                      navigation while the popover starts closed — surface it on the
                      trigger so the active search is visible without opening it. */}
                  {searchTerm && (
                    <span
                      className="ml-1.5 max-w-[8rem] truncate text-[11px]"
                      data-testid="search-active-keyword"
                    >
                      {searchTerm}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[calc(100vw-2rem)] sm:w-64 p-2" data-testid="search-popover">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder={t('table.search')}
                    value={searchTerm}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-7 h-8 text-xs"
                    autoFocus
                  />
                  {searchTerm && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-0.5 top-1/2 -translate-y-1/2 h-5 w-5 p-0 hover:bg-muted-foreground/20"
                      onClick={() => handleSearchChange('')}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Add Record (top position) */}
          {toolbarFlags.showAddRecordTop && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-primary text-xs transition-colors duration-150"
              data-testid="add-record-button"
              aria-label={t('list.addRecord')}
              onClick={() => props.onAddRecord?.()}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              <span className="hidden sm:inline">{t('list.addRecord')}</span>
            </Button>
          )}
        </div>
      </div>
      )}


      {/* Filters Panel - Removed as it is now in Popover */}

      {/* View Content */}
      <div key={currentView} className="flex-1 min-h-0 bg-background relative overflow-hidden animate-in fade-in-0 duration-200">
        {/* Re-fetch indicator: thin top progress bar shown when refreshing
            existing data (filter/sort/search change). Skipped during the
            initial load — the full skeleton below handles that case. */}
        <RefreshIndicator active={loading && data.length > 0} ariaLabel={t('list.refreshing')} />
        {/* Empty state is rendered here ONLY for tabular/list-like views.
            Structural views (kanban/calendar/gallery/gantt/timeline/map) own
            their own empty rendering so their column/lane/grid structure
            stays visible — otherwise users see a generic "No items found"
            on Task Board / Calendar etc. even though the view exists. */}
        {/* Loading state — shown when fetching with no data yet. Rendered at
            the ListView level so every inner view (grid/kanban/calendar/...)
            gets a consistent indicator instead of momentarily showing an
            empty state on slow networks. */}
        {/* objectui#10881 — a grouped grid this data source cannot count is
            refused before it is mounted, with the grid's own sentence (see
            `groupingNeedsHeaderQuery`). No Retry: the verdict is a property
            of the data source, so a retry re-reaches the same refusal. The
            toolbar stays, and removing the grouping there lifts it. */}
        {groupingNeedsHeaderQuery ? (
          <DataErrorState
            role="alert"
            data-testid="list-grouping-needs-header-query"
            className="h-full min-h-[200px] p-8 gap-1 [&>h3]:text-lg [&>h3]:font-medium [&>h3]:text-foreground [&>p]:max-w-md"
            icon={<AlertTriangle className="h-12 w-12 text-destructive/60" />}
            iconWrapperClassName="mb-3"
            title={t('list.loadErrorTitle')}
            message={t('grid.grouping.needsHeaderQuery')}
          />
        ) : loadError && data.length === 0 ? (
          <DataErrorState
            // This panel IS the load failure, and since objectui#7143 it is
            // rendered by the component named for that — `DataErrorState` —
            // rather than borrowing `DataEmptyState` for its layout. The two
            // primitives share a layout and differ by declared role, so the
            // migration moved no pixels: the only rendered changes are two
            // `data-slot` renames — this node's, from `data-empty-state` to
            // `data-error-state`, and the icon wrapper's to match.
            //
            // `role="alert"` stays spelled out here, as objectui#7132 left it.
            // It is now the primitive's own default rather than an override, and
            // it is kept at the call site on purpose: this panel must announce a
            // 403 or an outage as an alert whatever the component it is drawn
            // with, and that property is pinned against THIS call site.
            role="alert"
            data-testid="list-error-state"
            data-error-kind={loadErrorKind}
            className="h-full min-h-[200px] p-8 gap-1 [&>h3]:text-lg [&>h3]:font-medium [&>h3]:text-foreground [&>p]:max-w-md"
            icon={loadErrorKind === 'network'
              ? <AlertTriangle className="h-12 w-12 text-destructive/60" />
              : <ShieldAlert className="h-12 w-12 text-destructive/60" />}
            iconWrapperClassName="mb-3"
            title={t(
              loadErrorKind === 'api-disabled' ? 'list.loadErrorApiDisabledTitle'
                : loadErrorKind === 'forbidden' ? 'list.loadErrorForbiddenTitle'
                  : loadErrorKind === 'unauthorized' ? 'list.loadErrorUnauthorizedTitle'
                    : loadErrorKind === 'rejected' ? 'list.loadErrorRejectedTitle'
                      : 'list.loadErrorTitle',
            )}
            // A refused search term shows the server's sentence: it names the
            // object and the two remedies, and clearing the term (the toolbar
            // box stays) is the reader's way out (objectui#12966).
            message={loadErrorIsSearchRefusal ? loadError : t(
              loadErrorKind === 'api-disabled' ? 'list.loadErrorApiDisabledMessage'
                : loadErrorKind === 'forbidden' ? 'list.loadErrorForbiddenMessage'
                  : loadErrorKind === 'unauthorized' ? 'list.loadErrorUnauthorizedMessage'
                    : loadErrorKind === 'rejected' ? 'list.loadErrorRejectedMessage'
                      : 'list.loadErrorMessage',
            )}
          >
            {/* The retry control rides `children`, not `onRetry`: the built-in
                button carries neither this `data-testid` nor the RotateCw glyph,
                and `children` renders at the identical position `action` did on
                the empty state. `DataErrorState` grew three icon props for this
                migration and no fourth — an `action` prop would be a second
                spelling of an affordance it already has. */}
            {loadErrorKind === 'api-disabled' ? null : (
              // No Retry for an `enable`-block denial. The verdict is a pure
              // function of the object's metadata, so every retry re-fetches
              // the identical refusal — offering the button is the same wrong
              // advice as "check your connection", just spelled as a control.
              <Button
                variant="outline"
                size="sm"
                data-testid="list-error-retry"
                onClick={() => setRefreshKey((k) => k + 1)}
              >
                <RotateCw className="h-4 w-4 mr-1.5" />
                {t('list.retry')}
              </Button>
            )}
          </DataErrorState>
        ) : loading && data.length === 0 && !calendarWindowed ? (
          // [objectui#12081] Not over a windowed calendar: the calendar holds
          // the date it shows, and this panel would unmount it, so a refetch
          // after moving to an empty month would reopen it on today. It draws
          // its own loading state from the `loading` it is handed below.
          <div
            className="flex flex-col h-full min-h-[200px] p-4 gap-2"
            data-testid="list-loading"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="sr-only">{t('list.loading')}</span>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-9 rounded bg-muted/60 animate-pulse"
                style={{ opacity: Math.max(0.25, 1 - i * 0.12) }}
              />
            ))}
          </div>
        ) : !loading && data.length === 0 && (currentView === 'grid' || currentView === 'gallery') ? (
          // objectui#12217 — the gallery draws the grid's empty state, through
          // the one shared component: the authored `emptyState`, resolved
          // against the display locale, otherwise the localized `list.*` copy.
          // It used to hand the empty list to `ObjectGallery`, which drew a
          // hard-coded English line and never read the view's `emptyState`.
          <ListEmptyState
            title={schema.emptyState?.title}
            message={schema.emptyState?.message}
            // objectui#5935: the authored name is normalised through the ONE
            // icon seam. This site once had its own inline `split('-')` and no
            // rename map, so `home` and every snake_case spelling fell through
            // to the fallback here while resolving elsewhere. What an
            // unresolvable name draws is the empty state's own decision.
            icon={resolveIcon(schema.emptyState?.icon)}
            // objectui#12270 — the authored `{ label, url }` link, followed
            // through the action runner by the one shared `EmptyStateLink`.
            link={schema.emptyState?.link}
            hasBaseFilter={hasDeclaredFilter(authoredFilter)}
            // The USER's query (objectui#11687): the search box, the
            // user-filter chips, the filter panel's own conditions. The view's
            // declared `filter` is `hasBaseFilter`, not this.
            hasUserQuery={
              !!(searchTerm && searchTerm.trim()) ||
              (Array.isArray(appliedUserFilterConditions) && appliedUserFilterConditions.length > 0) ||
              (Array.isArray(appliedFilters?.conditions) && appliedFilters.conditions.length > 0)
            }
            onAddRecord={toolbarFlags.showAddRecord ? () => props.onAddRecord?.() : undefined}
            t={t}
            displayLocale={displayLocale}
          />
        ) : compactPosture ? (
          // objectui#12703 — the compact posture's rows, in place of the grid:
          // no row-number column, no header row, no pager.
          <ListViewCompactRows
            rows={data}
            fields={effectiveFields}
            objectName={schema.objectName}
            objectDef={objectDef}
            onRowClick={navigation.handleClick}
          />
        ) : (
          <SchemaRenderer
            schema={viewComponentSchema}
            {...props}
            {...(gridOwnsGroupedFetch || kanbanLanesPaged
              // Withheld, not dropped. See `gridOwnsGroupedFetch` for the
              // grouped grid, which a window of rows would turn back into
              // page-scoped grouping (objectui#7189), and `kanbanLanesPaged`
              // for the board, which it would turn back into a board of one
              // page (objectui#12619).
              ? {}
              : { data })}
            {...(kanbanLanesPaged
              // objectui#12619 — the board pages its own lanes: it is handed
              // the toolbar term to query with and this component's refresh
              // signal (the Refresh button, a host's `refreshTrigger`), host
              // props both, never node keys.
              ? {
                  lanePaging: {
                    search: searchTerm,
                    ...(schema.searchableFields && schema.searchableFields.length > 0
                      ? { searchFields: schema.searchableFields }
                      : {}),
                    reloadKey: `${refreshKey}:${String(schema.refreshTrigger ?? '')}`,
                  },
                }
              : {})}
            {...(viewComponentSchema.type === 'object-kanban' && kanbanOwnerFieldOf(objectDef)
              // objectui#12619 — the owner field the object declares, for the
              // avatar on each card (a host prop; the board guesses none).
              ? { ownerField: kanbanOwnerFieldOf(objectDef) }
              : {})}
            {...(gridOwnsGroupedFetch
              // objectui#11021 — the grid that groups on the server queries for
              // itself, so it is handed the toolbar term to query with (an
              // empty one too: the term is this component's, never the grid's).
              ? { search: searchTerm }
              : {})}
            {...(viewComponentSchema.type === 'object-grid' && objectDef?.fields
              // objectui#10657 — the grid is handed the rows this component
              // fetched, so they paint before the grid's own read of the
              // object definition settles; until then an untyped column over a
              // `password` / `secret` field has no type, and the grid can only
              // withhold it. This component read that definition BEFORE its
              // rows (the data fetch waits for `objectDefLoaded`), so it hands
              // the field catalogue down with them and the grid has no window
              // at all. `objectFields` is the host channel for the catalogue
              // (decision batch #70): `SchemaRenderer` refuses an AUTHORED
              // one, and this React prop is not authored. Only the grid reads
              // it, so only the grid is handed it.
              ? { objectFields: objectDef.fields }
              : {})}
            {...(viewComponentSchema.type === 'object-grid'
              // objectui#12423 — the Display control's Row numbers switch, on
              // the grid's host channel (a React prop, never a node key).
              // objectui#12528 — and the column summaries, drawn in the
              // record-count row below rather than in a row of the grid's own.
              ? { showRowNumbers: rowNumbers, onColumnSummaryChange: setGridSummaries }
              : {})}
            {...(viewComponentSchema.type === 'object-grid' && rowAdornment
              // objectui#13330 — the host's node beside each row's title, on
              // the grid's host channel (a React prop, never a node key).
              ? { rowAdornment }
              : {})}
            // [objectui#12081] A windowed calendar keeps drawing while the
            // next window loads (the refresh bar above says so), and shows its
            // own loading state only when it has nothing to draw.
            loading={calendarWindowed ? loading && data.length === 0 : loading}
            onRowSelect={setSelectedRows}
            {...(paginate && serverTotal != null
              ? {
                  // Drive the flat grid's single (DataTable) pager from the
                  // server: it renders THIS window as the current page, the real
                  // total sets the page count, and turning the page asks ListView
                  // to refetch the next window. One pager, server-backed (objectstack-ai/objectstack#2212).
                  manualPagination: true,
                  rowCount: serverTotal,
                  page: serverPage,
                  pageSize: effectivePageSize,
                  onPageChange: (p: number) => setServerPage(p),
                  onPageSizeChange: (n: number) => { setDynamicPageSize(n); setServerPage(1); },
                  // …and its sort from the same place (#3106). The column
                  // headers and the toolbar's sort builder are two controls over
                  // ONE `currentSort`, so a header click is a shortcut into the
                  // builder rather than a second, page-local sort with its own
                  // rules. That is what makes "priority of a header sort vs. the
                  // saved view's sort" a non-question: there is one sort.
                  sort: currentSort,
                  onSortChange: handleHeaderSort,
                  // …and the query itself (objectui#4501). The grid's
                  // cross-page "select all N matching" re-issues it to collect
                  // the whole match set; on this path the grid never ran a
                  // fetch, so without this it had no query to replay and asked
                  // the server for the unfiltered object. Handed down here
                  // rather than anywhere else because this block IS the
                  // handoff: the window, its total, its page — and what was
                  // asked to get them.
                  findParams: lastFindParams,
                }
              : {})}
          />
        )}
      </div>

      {/* objectui#12081 — the hosted calendar's window stopped at the platform
          ceiling (objectui#7210, ruling a′): it draws the first N, and this
          says so, with both numbers. Under the calendar, as the chart's
          footnote sits under the chart (objectui#7148); renders nothing when
          the window fit. */}
      {calendarWindowed && calendarCeiling && <NonGridRowCeilingNote result={calendarCeiling} />}

      {/* Add Record (bottom position) */}
      {toolbarFlags.showAddRecordBottom && !compactPosture && (
        <div className="border-t px-2 sm:px-4 py-1 bg-background shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground hover:text-primary text-xs transition-colors duration-150"
            data-testid="add-record-button"
            aria-label={t('list.addRecord')}
            onClick={() => props.onAddRecord?.()}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            <span className="hidden sm:inline">{t('list.addRecord')}</span>
          </Button>
        </div>
      )}

      {/* Bulk Actions Bar — skip for grid view since ObjectGrid renders its own BulkActionBar */}
      {permittedBulkActions && permittedBulkActions.length > 0 && selectedRows.length > 0 && currentView !== 'grid' && (
        <div
          className="border-t border-primary/30 px-4 py-2 flex items-center gap-2 text-xs bg-primary/10 text-foreground shrink-0 shadow-sm"
          role="region"
          aria-label="Bulk actions"
          data-testid="bulk-actions-bar"
        >
          <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-medium">
            {selectedRows.length} {selectedRows.length === 1 ? 'item' : 'items'} selected
          </span>
          <div className="flex items-center gap-1.5 ml-3">
            {permittedBulkActions.map((action: any) => {
              const actionStr = String(action).toLowerCase();
              const isDestructive = actionStr.includes('delete') || actionStr.includes('remove') || actionStr.includes('destroy');
              const Icon = isDestructive ? Trash2 : null;
              // [objectui#4420] The built-in `delete` runs over the ALLOWED
              // SUBSET — the records `userActions.delete.visibleWhen` admits —
              // never the raw tick list. The button itself is untouched by the
              // predicate (ruled: never hidden, never disabled); what shrinks
              // is what it acts on, and the notice below owns up to it. Only
              // the canonical `delete` is filtered: every other id routes
              // through the action runner with its own gates.
              const rowsForAction = actionStr === 'delete'
                ? (bulkDeleteEligibility.eligible as any[])
                : selectedRows;
              return (
                <Button
                  key={action}
                  variant={isDestructive ? 'destructive' : 'outline'}
                  size="sm"
                  className="h-7 px-2.5 text-xs gap-1.5"
                  onClick={() => props.onBulkAction?.(action, rowsForAction)}
                  data-testid={`bulk-action-${action}`}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {tActionLabel(action)}
                </Button>
              );
            })}
          </div>
          {/* [objectui#4420] The report half of the ruling, on the surface that
              has one. This bar dispatches straight through `onBulkAction` — it
              never opens `BulkActionDialog`, so there is no confirm step to
              carry the grid's `bulk-skipped-notice`; the bar states it up
              front instead, which also makes the all-excluded case a legible
              refusal BEFORE the click rather than a dead press. Same testid as
              the dialog's slot: one name for one fact, whichever surface says
              it. */}
          {bulkDeleteEligibility.skipped > 0
            && permittedBulkActions.some((a: any) => String(a).toLowerCase() === 'delete') && (
            <span
              className="text-muted-foreground ml-3"
              data-testid="bulk-skipped-notice"
            >
              {/* The grid dialog's own key, deliberately: this is the same
                  sentence about the same fact, already translated in every
                  locale pack. A `list.*` alias would be a second spelling of
                  one string — ten packs to keep in step for no new meaning. */}
              {t('grid.bulk.skippedIneligible', {
                count: bulkDeleteEligibility.skipped,
                defaultValue: `${bulkDeleteEligibility.skipped} selected record(s) are not eligible for this action and will be skipped.`,
              })}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs ml-auto gap-1"
            onClick={() => setSelectedRows([])}
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        </div>
      )}

      {/* Record count status bar (Airtable-style). One footer row
          (objectui#12528): the count at the left, the grid's column summaries
          at the right of the same row, truncated with the full text as their
          tooltip when they do not fit. */}
      {/* The compact posture prints its count in its header (objectui#12703). */}
      {!compactPosture && (recordCountShown || boardRecordCountShown || footerSummaryText) && (
        <div
          className="border-t px-4 py-2 flex items-center gap-3 text-xs text-muted-foreground bg-background shrink-0"
          data-testid="record-count-bar"
        >
          {boardRecordCountShown && (
          <span className="shrink-0 font-medium text-foreground/80">
            {t('list.recordCount', { count: fetchedTotal })}
          </span>
          )}
          {recordCountShown && (
          <span className="shrink-0 font-medium text-foreground/80">
            {/* Under server pagination `data` is only the current page, so the
                honest record count is the server's grand total (#586). When the
                whole result set is in memory, serverTotal is null and data.length
                already IS the total. */}
            {/* One count family (objectui#11445): i18next picks the CLDR slot. */}
            {t('list.recordCount', { count: serverTotal ?? data.length })}
          </span>
          )}
          {/* The cap warning is about rows the user CANNOT REACH. A paged grid
              with a known total can reach them all through its pager, so the
              warning stays off there — the gate the fetch used to apply when it
              wrote this flag (objectui#7394). */}
          {recordCountShown && dataLimitReached && !(paginate && serverTotal != null) && (
            <span className="text-amber-600" data-testid="data-limit-warning">
              {t('list.dataLimitReached', { limit: effectivePageSize })}
            </span>
          )}
          {/* Grid view delegates the rows-per-page selector to the DataTable's
              own server-driven pager (ObjectGrid passes pagination.pageSizeOptions
              straight through). Rendering a second selector here produced a
              duplicate control, so for grid we suppress it and only keep this
              fallback selector for pager-less views (gallery/kanban/calendar).
              It is the shared `Select` (objectui#11865): a size in force that
              is not one of the options shows as itself, not as the first one. */}
          {/* Not on a windowed calendar either (objectui#12081): its fetch walks
              the date window in fetch batches, so a page size changes nothing
              it draws. */}
          {/* Nor on a board that pages its own lanes (objectui#12619): each
              lane asks its own page, so a page size changes nothing it draws. */}
          {currentView !== 'grid' && !calendarWindowed && !kanbanLanesPaged && schema.pagination?.pageSizeOptions && schema.pagination.pageSizeOptions.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span>{t('table.rowsPerPage', { defaultValue: 'Rows per page' })}</span>
              <ListOptionPicker
                className="h-7 w-[72px] px-2 text-xs"
                testId="page-size-selector"
                value={String(effectivePageSize)}
                options={schema.pagination.pageSizeOptions.map((size: any) => ({ value: String(size), label: String(size) }))}
                onPick={(size) => {
                  const newSize = Number(size);
                  setDynamicPageSize(newSize);
                  if (props.onPageSizeChange) props.onPageSizeChange(newSize);
                }}
              />
            </div>
          )}
          {footerSummaryText && (
            <span
              className="ml-auto min-w-0 truncate text-right font-medium"
              title={footerSummaryText}
              data-testid="record-count-summaries"
            >
              {footerSummaryText}
            </span>
          )}
        </div>
      )}

      {/* Navigation Overlay (drawer/modal/popover) */}
      {navigation.isOverlay && (
        <NavigationOverlay
          {...navigation}
          title={detailTitle}
        >
          {(record) => {
            // objectui#13458 — the same payload the grid, tree, kanban, calendar
            // and gantt overlays mount, in place of a raw key/value dump: declared
            // labels, typed widgets, `hidden` honoured, the object's field order.
            // Read-only, as on the grid and the tree: capability is handler
            // presence, and this view hands the panel no write path.
            const recordId = record.id ?? record._id;
            if (schema.objectName && (typeof recordId === 'string' || typeof recordId === 'number')) {
              return (
                <div className="px-6 pt-6 pb-6">
                  <RecordDetailPanel
                    record={record}
                    objectName={schema.objectName}
                    recordId={recordId}
                    dataSource={dataSource}
                    objectSchema={objectDef}
                    onClose={navigation.close}
                  />
                </div>
              );
            }
            // No addressable record (inline rows with no object name or id): the
            // panel needs both, so the plain reading of the row is the answer.
            return (
              <div className="space-y-3">
                {Object.entries(record).map(([key, value]) => (
                  <div key={key} className="flex flex-col">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm">{String(value ?? '—')}</span>
                  </div>
                ))}
              </div>
            );
          }}
        </NavigationOverlay>
      )}
    </div>
  );
});

ListView.displayName = 'ListView';