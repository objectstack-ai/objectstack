/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry, elementDataSourceBlock, type ComponentInput } from '@object-ui/core';
import {
  ElementDataSourceGate,
  noDataSourceMessage,
  useResolvedDataSource,
  type ElementDataSourceMapping,
} from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import type { DataSource } from '@object-ui/types';
import { ObjectGrid } from './ObjectGrid';
import { VirtualGrid } from './VirtualGrid';
import { ImportWizard } from './ImportWizard';

export { ObjectGrid, VirtualGrid, ImportWizard };
// Spreadsheet parsers (pure functions; ExcelJS lazy-loads inside) — exported
// for the chat-native attachment flow (cloud#797 WS3): the AI build panel
// parses an attached Excel/CSV client-side and briefs the agent with the
// headers + sample rows instead of dropping the file.
export { parseSpreadsheetFile, parseClipboardTable, inferColumnType } from './importParsers';
export { InlineEditing } from './InlineEditing';
export { useRowColor } from './useRowColor';
export { useGroupedData } from './useGroupedData';
export { GroupRow } from './GroupRow';
export { RowActionMenu, formatActionLabel } from './components/RowActionMenu';
export { BulkActionBar } from './components/BulkActionBar';
export { useCellClipboard } from './useCellClipboard';
export { useGradientColor } from './useGradientColor';
export { useGroupReorder } from './useGroupReorder';
export { useColumnSummary } from './useColumnSummary';
export { FormulaBar } from './FormulaBar';
export { SplitPaneGrid } from './SplitPaneGrid';
export type { ObjectGridComponentProps, ObjectGridExternalPaginationProps, ObjectGridColumnState, ObjectGridRowOperations, ObjectGridFooterSummary } from './ObjectGrid';

/**
 * @deprecated Use `ObjectGridComponentProps`. Renamed in objectui#4650 because
 * `@objectstack/spec/ui` owns `ObjectGridProps` from 17.0.0, where it means the
 * AUTHORED props document of the `object-grid` element — not this component's
 * props. The alias denotes the SAME type and is kept only so existing importers
 * keep compiling.
 */
export type { ObjectGridComponentProps as ObjectGridProps } from './ObjectGrid';
export type { VirtualGridProps, VirtualGridColumn } from './VirtualGrid';
export type { InlineEditingProps } from './InlineEditing';
export type { ImportWizardProps, ImportResult } from './ImportWizard';
export type { GroupEntry, UseGroupedDataResult, AggregationType, GroupAggregationConfig, AggregationResult } from './useGroupedData';
export type { GroupRowProps } from './GroupRow';
export type { RowActionMenuProps } from './components/RowActionMenu';
export type { BulkActionBarProps } from './components/BulkActionBar';
export type { CellRange, UseCellClipboardOptions, UseCellClipboardResult } from './useCellClipboard';
export type { GradientStop, UseGradientColorOptions } from './useGradientColor';
export type { UseGroupReorderOptions, UseGroupReorderResult } from './useGroupReorder';
export type { ColumnSummarySetting, ColumnSummaryType, ColumnSummaryResult } from './useColumnSummary';
export type { FormulaBarProps } from './FormulaBar';
export type { SplitPaneGridProps } from './SplitPaneGrid';

/**
 * The keys `ObjectGrid` reads for its own query — every one of them, which makes
 * this the only block where the spec's binding maps across without a gap.
 * `columns` is a FIELD list here (so a saved view's columns belong on it), the
 * filter and sort reach `$filter` / `$orderby` (the filter via `toFilterNode`,
 * the repo's single lowering hop before the wire — it passes the AST this gate
 * composes through untouched), and the row cap is read as `pagination.pageSize`
 * (`ObjectGrid.tsx`, `serverPageSize`).
 */
const OBJECT_GRID_DATA_SOURCE: ElementDataSourceMapping = {
  columns: true,
  filter: true,
  sort: true,
  limit: 'pagination.pageSize',
};

/**
 * Whether THIS grid placement can only draw rows by querying — i.e. whether a
 * missing adapter is a defect rather than a legitimate configuration
 * (objectui#5378 item 2, the `requiresDataSource` contract).
 *
 * Every escape hatch `ObjectGrid` itself honours is enumerated here, and the
 * list is the reason this predicate lives at the call site rather than in the
 * gate. `getDataConfig` folds a `ViewData` with `provider: 'value'` and the
 * legacy `staticData` into inline rows and never reaches the fetch effect;
 * `bind` resolves rows from the surrounding data scope; and a HOST that owns
 * the fetch — `plugin-list`'s `ListView` is the one in this repo — hands the
 * window down as a `data` REACT PROP, which is why the prop is read here too.
 * The PROP is tested with `Array.isArray` because that is the exact test
 * `ObjectGrid` applies to it (`passedData && Array.isArray(…)`), and never with
 * `'data' in props`, which would be true of shapes this block cannot draw from
 * and would wave through a grid that really has nowhere to look.
 *
 * ## ⛔ A bare `data` ARRAY on the SCHEMA is NOT one of them (objectui#9580)
 *
 * It was on this list until objectui#9580, by which point it described a
 * carrier that had been retired on both sides. objectui#8348 (「8348 以协议为准」,
 * decision batch #83) retired the bare-array shorthand at the shared
 * record-source ladder — this block's published `data` row is the `ViewData`
 * OBJECT arm — and objectui#9571 (ruling objectui#8348 Q2-C, batch #136 item 3,
 * maintainer 「同意」) retired the second carrier, so `SchemaRenderer` no longer
 * spreads an authored `data` as a React prop for a block on that arm.
 *
 * ⇒ an authored array draws NOTHING, and while this line stood it also told
 * the gate that this placement needed no adapter — so the author got the empty
 * shell objectui#5378 item 2 exists to replace, with the one diagnostic that
 * addresses exactly this silent. The `__DEV__` warn-once objectui#9571 added at
 * the strip site does not reach a production build, which is where this gate
 * speaks. ⛔ Restoring the CARRIER is not the repair and was ruled out twice
 * (objectui#8348, objectui#9571); what moves here is only what the gate SAYS.
 * Pinned in `__tests__/gridNeedsDataSourceBareArray-9580.test.tsx`.
 *
 * `objectName` is required last: a grid with no object named it is a different
 * defect with a different answer, and "no data source" would be the wrong
 * address for it.
 */
const gridNeedsDataSource = (schema: any, hostRows: unknown): boolean => {
  if (Array.isArray(hostRows)) return false;
  if (schema?.bind != null) return false;
  if (schema?.data?.provider === 'value') return false;
  if (schema?.staticData != null) return false;
  return typeof schema?.objectName === 'string' && schema.objectName.length > 0;
};

// Register object-grid component
export const ObjectGridRenderer: React.FC<{ schema: any; [key: string]: any }> = elementDataSourceBlock(({ schema, ...props }) => {
  // ONE resolution rule for the whole family (objectui#5378): an explicit
  // adapter first, the `SchemaRendererProvider` context second.
  //
  // This used to be `useSchemaContext() || {}`, and that hook THROWS without a
  // provider — the `|| {}` could never catch it. So the exact case this card is
  // about, an author who never wired a provider, surfaced as `SchemaRenderer`'s
  // error boundary saying «Component "object-grid" failed to render» over a
  // React hook message that names neither the data source nor the fix. The
  // adapter was ALSO already reaching `ObjectGrid` as a prop whenever a provider
  // happened to exist, because `{...props}` is spread last; pulling it out here
  // makes that precedence explicit and identical to `detail-view`'s, instead of
  // an accident of spread order that a reordering could silently reverse.
  const { dataSource: dataSourceProp, ...rest } = props;
  const dataSource = useResolvedDataSource<DataSource>(dataSourceProp);
  // The spec's `PageComponentSchema.dataSource` binding (objectstack#6953).
  // Nothing here used to map `dataSource.object` onto the `objectName` this
  // block requires, so a page that declared the binding the spec documents —
  // and no separate `objectName` — rendered an empty grid: no object, no query,
  // no error. The gate maps it and reports an unresolvable `view` instead of
  // quietly widening the query to the object's full scope.
  // objectui#12920 — the unresolvable-view panel's title reads the bundle.
  const { t } = useObjectTranslation();
  return (
    <ElementDataSourceGate
      schema={schema}
      mapping={OBJECT_GRID_DATA_SOURCE}
      dataSource={dataSource}
      testId="object-grid"
      errorTitle={t('element.grid.sourceUnresolved', {
        defaultValue: 'This grid’s data source could not be resolved',
      })}
      requiresDataSource={gridNeedsDataSource(schema, (rest as { data?: unknown }).data)}
      noDataSourceMessage={noDataSourceMessage('object-grid', schema?.objectName)}
    >
      {(bound) => <ObjectGrid schema={bound} {...rest} dataSource={dataSource} />}
    </ElementDataSourceGate>
  );
});

/**
 * The authoring surface for this block's query filter, in ONE spelling.
 *
 * It used to be published as plural `filters` while `ObjectGrid` read singular
 * `schema.filter` and nothing anywhere read `schema.filters` (objectui#4041).
 * Both halves were silent: `sdui-parser`'s save gate walks a node's props
 * against these `inputs`, so `filters` was accepted and then dropped by the
 * renderer — an author (very often an AI author) writing the published word got
 * an unfiltered full-table answer with no error — while the spelling that
 * actually works was reported as `unknown-prop`. The published vocabulary and
 * the runtime read pointed at opposite keys.
 *
 * Resolved toward the implementation (maintainer ruling 2026-08-10, option A):
 * the declaration is singular `filter`, aligned three ways — with the renderer's
 * read point (`ObjectGrid.tsx`, `schema.filter`), with the sibling `list-view`
 * block (`plugin-list/src/index.tsx`, `{ name: 'filter', … }`), and with the
 * spec's own `filter` vocabulary. The plural is DELETED rather than taught to
 * the renderer: it has zero read points on any ref, so no working in-the-wild
 * usage depends on it, and reading it too would harden a misspelling into a
 * second de-facto contract (AGENTS.md #0.1).
 *
 * Shared by both registrations below so the alias cannot drift from the block.
 *
 * ## The rest of the surface (objectui#4648)
 *
 * Everything after `filter` was declared by the maintainer ruling of 2026-08-16
 * on objectui#4648 (option B + carve-out). These are NOT new capabilities — every
 * one of them is read by `ObjectGrid` today, and until this landed an author who
 * wrote one got `unknown-prop` from `sdui-parser` on a key that works, while the
 * designer panel and the generated `sdui-intrinsics.d.ts` denied it existed.
 * Publishing them is what makes the manifest, the `.d.ts`, the designer and the
 * renderer finally agree.
 *
 * TEN keys `@objectstack/spec` 17.0.0 GA also declared are deliberately NOT here
 * — this block's own `@deprecated` legacy spellings (`fields`, `staticData`,
 * `selectable`, `pageSize`, `showSearch`, `showPagination`, `defaultSort`,
 * `defaultFilters`, `resizableColumns`, `title` — all tagged `@deprecated` in
 * `ObjectGridSchema`, `packages/types/src/objectql.ts`). The renderer reads
 * the ones not since retired as back-compat fallbacks (`defaultSort`,
 * `resizableColumns` and, from `@objectstack/spec` 18, `defaultFilters` are not
 * read), but publishing a deprecated alias as NEW
 * authoring surface would harden it into a second dialect (AGENTS.md #0.1), so
 * each gets a cited exemption in the console parity gate instead. Their canonical
 * spellings — `columns`, `data`, `selection`, `pagination`, `searchableFields`,
 * `sort`, `filter`, `resizable`, `label` — are all declared here, and each
 * description below says so, so the exemption teaches rather than merely omits.
 *
 * `defaultSort` is the exception and is no longer a fallback at all: spec 17.3.0
 * turned it into a retired-key tombstone the protocol refuses by name, and
 * objectui#5861 removed every renderer read of it (ADR-0049 enforce-or-remove).
 * It stays off this list because the contract refuses it, not by exemption.
 * `resizableColumns` followed the same way: spec 17.7.0 tombstoned it
 * (objectstack#21445), and objectui#6152 round 7 removed `ObjectGrid`'s
 * `resizable ?? resizableColumns` read, so `resizable` is its only spelling.
 *
 * ## `description`, `emptyState` and `keyboardNavigation`: the 17.6.0 keys
 *
 * `@objectstack/spec` 17.6.0 adds three keys to the `object-grid` row
 * (objectstack#20694). `description` and `emptyState` are published below
 * (objectui#11227): `ObjectGrid` has read both since objectui#11068, and until
 * the row declared them this list could not. `keyboardNavigation` joined the
 * list WITH its reader, objectui#11068's build: `ObjectGrid` resolves it
 * (default: on when the grid renders editable) and `data-table` moves a roving
 * focus across its cells with the arrow keys. It was held off this list until
 * then, because this list is what the renderer reads, not what the row allows.
 * The row still marks it `[EXPERIMENTAL — not enforced]`; that marker is the
 * spec's to drop, and no reader here depends on it.
 *
 * ## `data` declares the CONTRACT's shape, not the shortcut's (objectui#5090)
 *
 * The key landed above with `type: 'array'`, labelled "Static Data" and described
 * as inline rows — which is the shape of `staticData`, the very alias the
 * carve-out above refuses to publish, not the shape of `data`. The contract is
 * `ObjectGridSchema.data?: ViewData` (`packages/types/src/objectql.ts`), and
 * `ViewData` is the spec's discriminated union on `provider` — four strict object
 * arms (`object` / `api` / `value` / `schema`), none of them an array. So the
 * declaration published a shape `tsc` rejects (`TS2322`) and `ViewDataSchema`
 * refuses, while the one form that satisfies both — `{ provider: 'value', items:
 * [...] }` — drew `type-mismatch` from this repo's own save gate, because
 * `checkType`'s `'array'` arm accepts only arrays. The platform contradicted
 * itself on the only legal write: objectui#4041's shape again, one field over.
 *
 * `ObjectGrid`'s renderer does still accept a bare array (`getDataConfig` folds
 * it to `{ provider: 'value', items }`), and that tolerance is deliberately left
 * alone here — it is objectui#5068's family, and declaring an arm for it would
 * publish a shape the contract rejects, which is precisely the carve-out's own
 * reasoning. An array `data` therefore has the same standing as `staticData`:
 * read as back-compat, not advertised as authoring surface.
 */
const GRID_QUERY_INPUTS: ComponentInput[] = [
  // NOT required, as on the spec row (objectui#11605): `ComponentPropsMap
  // ['object-grid']` leaves `objectName` optional "because the component-level
  // `dataSource` binding can supply the object instead", and the gate above
  // lands `dataSource.object` here. The page compile reads this list, so
  // `required: true` refused a bound node the row and the renderer accept. A
  // node with neither is answered by `ObjectGrid`'s own "object name required"
  // error, unchanged.
  {
    name: 'objectName',
    type: 'string',
    description:
      'Object this grid lists. Not required: the node\'s `dataSource` binding can name the object instead, and `dataSource.object` lands on this key, outranking an authored value. With neither, and no inline `data` rows, the grid shows an error saying an object name is required and fetches nothing.',
  },
  { name: 'columns', type: 'array', description: 'Columns to show, either field names (`["name", "email"]`) or column objects (`[{ field: "name", label: "Full Name", width: 200 }]`). The canonical spelling — the deprecated `fields` is only read when this is absent.' },
  { name: 'filter', type: 'array', description: 'Base query filter — the `ViewFilterRule` array `[{ field, operator, value }, ...]`, lowered to `$filter`. The canonical spelling — the retired `defaultFilters` is not read (`@objectstack/spec` 18 refuses it by name).' },
  // ── identity ──────────────────────────────────────────────────────────────
  // `label` is an `I18nLabel` in the spec row (`ComponentPropsMap['object-grid']`),
  // and every read of it in `ObjectGrid` (the table caption, the export title,
  // the record-detail overlay heading) resolves a map with the spec's
  // `resolveI18nLabel` against `useDisplayLocale()`. So both arms are declared,
  // as `ComponentInput.type` prescribes for a key whose render site resolves the
  // map: a `'string'`-only declaration made the manifest gate report
  // `type-mismatch` on a legal map (objectui#10993). The render is pinned by
  // `ObjectGrid.labelI18nLabel-10993.test.tsx`, the manifest by the console's
  // `i18nLabelInputsManifest-10993.test.ts`.
  {
    name: 'label',
    type: ['string', 'object'],
    description:
      'Grid label, used as the table caption, as the export file title and in the record-detail overlay heading. The canonical spelling — the deprecated `title` is only read when this is absent. Accepts either a plain string or an inline per-locale map (`{ en: "Accounts", "zh-CN": "客户" }`) — the `I18nLabel` union the contract admits on this key — and the grid resolves the map against the display locale (the workspace\'s regional default when one is configured, otherwise the active UI language), falling back through base language, a region-qualified sibling, `default`, then `en`, and finally to any remaining entry.',
  },
  // `description` (objectui#11068 honoured it; objectui#11227 publishes it now
  // that the spec row declares it, at 17.6.0) is an `I18nLabel` in the row too,
  // and `ObjectGrid` resolves it with the same resolver as `label`, so both arms
  // are declared for the same reason. The render is pinned by
  // `ObjectGrid.declaredKeys-11068.test.tsx`, the manifest by the console's
  // `i18nLabelInputsManifest-10993.test.ts`.
  {
    name: 'description',
    type: ['string', 'object'],
    description:
      'One line of help text drawn above the grid\'s rows, in muted type. Accepts either a plain string or an inline per-locale map (`{ en: "Everyone you work with", "zh-CN": "你的所有联系人" }`) — the `I18nLabel` union the contract admits on this key — resolved against the display locale the way `label` is. A map with no usable entry draws no line.',
  },
  // ── query shaping ─────────────────────────────────────────────────────────
  { name: 'sort', type: 'array', description: 'Initial sort order, `[{ field, order }]`. The only sort spelling this block reads — the retired single-sort `defaultSort` is refused by the protocol and ignored by the renderer.' },
  { name: 'pagination', type: 'object', description: 'Pagination config, `{ pageSize, pageSizeOptions, … }`. Presence enables paging with the object\'s settings, and an explicit off wins — the deprecated flat `showPagination: false` turns paging off even beside this object, because this object declares no off switch of its own. Prefer it over the deprecated flat `pageSize` / `showPagination` pair.' },
  { name: 'searchableFields', type: 'array', of: 'string', description: 'Fields the toolbar search box queries. A non-empty list is what enables search — prefer it over the deprecated boolean `showSearch`, which cannot say WHICH fields to search.' },
  { name: 'data', type: 'object', description: 'Data source configuration — a `ViewData` object discriminated by `provider`: `{ provider: "object", object }` (what an omitted `data` falls back to, using `objectName`), `{ provider: "value", items: [...] }` for inline rows that bypass the object query, or `{ provider: "schema", schemaId }`. The canonical spelling — the deprecated `staticData` is the array-only shortcut for the `value` provider, so inline rows go under `items` here rather than in a bare array.' },
  // ── presentation ──────────────────────────────────────────────────────────
  { name: 'rowHeight', type: 'enum', enum: ['compact', 'short', 'medium', 'tall', 'extra_tall'], description: 'Row density. An unrecognised value falls back to `compact` rather than erroring.' },
  { name: 'frozenColumns', type: 'number', description: 'How many leading columns stay pinned while the grid scrolls horizontally.' },
  { name: 'resizable', type: 'boolean', description: 'Let users drag column borders to resize. On by default. The only spelling — the legacy `resizableColumns` is retired and refused by name (objectui#6152).' },
  { name: 'reorderableColumns', type: 'boolean', description: 'Let users drag columns into a different order.' },
  { name: 'showColumnTypeIcons', type: 'boolean', description: 'Show a field-type icon in each column header. Off by default — the type is usually obvious from the cell content, and the icons compete with the column labels.' },
  { name: 'rowColor', type: 'object', description: 'Rules that colour whole rows from a field value.' },
  { name: 'conditionalFormatting', type: 'array', description: 'Row style rules, each `{ condition, style }` — a CEL `condition` over the row’s own `record.*` and a CSS `style` map, the rule a list view declares. The first matching rule styles that row. The native `{ field, operator, value }` rule, its `expression`, and a colour written beside `condition` instead of inside `style` are retired (objectui#11533).' },
  // `emptyState` (objectui#11068 honoured it; objectui#11227 publishes it now
  // that the spec row declares it, at 17.6.0, as the list view's own
  // `EmptyStateSchema`). Its `title` and `message` are `I18nLabel` members that
  // `ObjectGrid` resolves against the display locale. The members are pinned by
  // `ObjectGrid.emptyStateI18nLabel-11227.test.tsx`; its `link` (objectui#12270)
  // by `ObjectGrid.emptyStateLink-12270.test.tsx`.
  { name: 'emptyState', type: 'object', description: 'What the grid draws in place of an empty table, `{ title, message, icon, link }`: a Lucide `icon` name, a `title` (default: the table\'s own "No results found"), a `message` (default: none) and one `link: { label, url }` the user follows (default: none) — an in-app path, or an `http(s)://` or `mailto:` address, opened as a `url` action opens it. `title`, `message` and the link\'s `label` each accept a plain string or an inline per-locale map, resolved against the display locale. Not drawn when a term typed into the grid\'s own server-side search box is what emptied it — the table and its search box stay, so the term can be cleared. Leave it out and an empty grid draws the table\'s own empty row.' },
  // ── grouping and roll-ups ─────────────────────────────────────────────────
  { name: 'grouping', type: 'object', description: 'Group rows by one or more fields into collapsible sections.' },
  { name: 'aggregations', type: 'array', description: 'Per-group roll-ups shown in group headers, `[{ field, type: "sum" | "count" | "avg" | "min" | "max" | "count_distinct" }]`. Needs `grouping` to have anything to roll up.' },
  // ── selection and actions ─────────────────────────────────────────────────
  { name: 'selection', type: 'object', description: 'Selection config, `{ type: "none" | "single" | "multiple" }`. Presence enables selection — an object with no `type` selects multiple rows — and an explicit off wins: `type: "none"` turns selection off even beside a declared `bulkActions`. The canonical spelling — the deprecated boolean/string `selectable` is only read when this is absent.' },
  { name: 'rowActions', type: 'array', description: 'Names of actions offered on each row’s menu.' },
  { name: 'bulkActions', type: 'array', description: 'Names of actions offered once rows are selected. Needs a multi-row `selection` to be reachable.' },
  { name: 'batchActions', type: 'array', description: 'Legacy alias of `bulkActions`, and the one the renderer reads FIRST when both are set. Prefer `bulkActions` in new schemas.' },
  { name: 'bulkActionDefs', type: 'array', description: 'Full inline bulk-action definitions, for actions that are not named entries in the object’s action set. Use `bulkActions` when the action already exists.' },
  // ── behaviour ─────────────────────────────────────────────────────────────
  { name: 'editable', type: 'boolean', description: 'Enable inline cell editing (double-click or Enter opens a cell).' },
  { name: 'singleClickEdit', type: 'boolean', description: 'With `editable`, a single click opens the cell instead of a double-click. Has no effect on a non-editable grid.' },
  // `keyboardNavigation` (objectui#11068's build; the row declares it since
  // 17.6.0). The behaviour is `data-table`'s and is pinned there
  // (`data-table-keyboard-navigation-11068.test.tsx`); the default and the
  // relay are `ObjectGrid`'s (`ObjectGrid.keyboardNavigation-11068.test.tsx`).
  { name: 'keyboardNavigation', type: 'boolean', description: 'Arrow-key cell navigation on the WAI-ARIA grid pattern: the grid\'s data cells take one place in the Tab order instead of one each (a link or button inside a cell keeps its own), and the arrow keys move focus between them (Home / End to the ends of the row, Ctrl+Home / Ctrl+End to the ends of the page). Enter still opens an editable cell, and an edit ended with Enter or Escape returns focus to its cell. Defaults to on when the grid renders editable; a read-only grid keeps every cell its own Tab stop unless this is `true`, and `false` turns it off on an editable grid.' },
  { name: 'navigation', type: 'object', description: 'What a row click does, `{ mode: "page" | "drawer" | "modal" | "split" | "none", … }`.' },
  { name: 'operations', type: 'object', description: 'Toggles for the built-in affordances, `{ create, update, delete, export }`, e.g. `{ delete: false }`. A declared block replaces the default, so an `update` / `delete` it does not name is withheld.' },
  { name: 'exportOptions', type: 'object', description: 'Export config, `{ formats, maxRecords, includeHeaders, fileNamePrefix, streaming }`. `streaming` (default true) picks server-side streaming vs browser-side assembly for the export — a behaviour fork, not decoration; set it to `false` to force browser-side assembly. Needs `operations.export` to be reachable from the toolbar.' },
];

ComponentRegistry.register('object-grid', ObjectGridRenderer, {
  namespace: 'plugin-grid',
  label: 'Object Grid',
  category: 'plugin',
  inputs: GRID_QUERY_INPUTS.map((i) => ({ ...i })),
});

// Alias for view namespace - this allows using { type: 'view:grid' } in schemas
// which is semantically meaningful for data display components.
// `skipFallback` keeps this from also claiming the bare `grid` key, which
// belongs to the @object-ui/components layout grid (issue: object-grid was
// shadowing the layout container, so `{type:'grid'}` 404'd needing objectName).
ComponentRegistry.register('grid', ObjectGridRenderer, {
  namespace: 'view',
  skipFallback: true,
  label: 'Data Grid',
  category: 'view',
  // Same renderer, therefore the same declared surface — see GRID_QUERY_INPUTS.
  inputs: GRID_QUERY_INPUTS.map((i) => ({ ...i })),
});

/**
 * ⛔ The `import-wizard` node type key is RETIRED (objectui#10859 batch 8, phase 2b,
 * the seat's ruling on that card, by the objectui#10393 / objectui#8760 route).
 * The React export stays (the ruling's words): `ImportWizard` is still exported
 * from this package, and app-shell mounts it directly (`ObjectView`'s import
 * flow, `ExcelImportBar`).
 *
 * ## What was here, and why it went
 *
 * `ComponentRegistry.register('import-wizard', ImportWizardRenderer, {
 * namespace: 'plugin-grid', ... })` — a renderer reading `objectName` /
 * `objectLabel` / `fields` and the context `dataSource` into `ImportWizard`.
 * It stored both `plugin-grid:import-wizard` and the bare `import-wizard` fallback.
 * No `@object-ui/types` arm claims it, so `objectui validate` refused a node
 * authored `type: 'import-wizard'` at `type` while the registry mounted it.
 *
 * ## Why unregistering is the whole retirement
 *
 * Nothing wrote the node: 0 producers in source, docs, examples, the catalog
 * or objectstack, and 0 runtime emission, re-measured for phase 2b. The ruling's
 * criterion answered no for a NODE: the mainstream ships import as a setup
 * tool, not an authorable block. The README and `plugin-grid.mdx` key-table
 * rows went in the same change.
 */

// Note: 'grid' type is handled by @object-ui/components Grid layout component
// This plugin only handles 'object-grid' which integrates with ObjectQL/ObjectStack
