/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ComponentInput, ListViewVisualization } from '@object-ui/core';
import { ListView } from './ListView';
import { ListViewBlock } from './ListViewBlock';
import { ViewSwitcher } from './ViewSwitcher';
import { ObjectGallery } from './ObjectGallery';

export { ListView, ListViewBlock, ViewSwitcher, ObjectGallery };
export { ViewSwitcherDropdown } from './ViewSwitcher';
export { TabBar, TabBarSelect } from './components/TabBar';
export type { TabBarProps, ViewTab } from './components/TabBar';
export { UserFilters } from './UserFilters';
export type { UserFiltersProps } from './UserFilters';
export { evaluateConditionalFormatting, normalizeFilterCondition, normalizeFilters } from './ListView';
// The provider-less fallback table, exported so objectui#4401's mirror gate can
// compare it against the `en` pack from a package that depends on both.
export { LIST_DEFAULT_TRANSLATIONS } from './ListView';
export type { ListViewProps, ListViewHandle } from './ListView';
export type { ObjectGalleryProps } from './ObjectGallery';
// The switcher's views are `@object-ui/core`'s `ListViewVisualization`. This
// barrel no longer re-exports them as `ViewType`, the name `@object-ui/types`
// gives the wider view-type vocabulary (objectui#6349, batch 7). Its props are
// `ListViewSwitcherProps`, because `@object-ui/plugin-view` publishes
// `ViewSwitcherProps` for a different switcher (objectui#6349, batch 8).
export type { ListViewSwitcherProps } from './ViewSwitcher';

/**
 * Registry entry point for `<ListView>`. Both bridges it carries — the
 * schema-renderer context onto the `dataSource` PROP (#3144), and the spec's
 * `PageComponentSchema.dataSource` BINDING onto the props `ListView` reads
 * (objectstack#5576) — are documented on {@link ListViewBlock}.
 */
/**
 * Designer label per visualization, and the `type` enum options both
 * registrations below are built from.
 *
 * A total `Record<ListViewVisualization, string>` (`ca3942729`). The two
 * registrations each carried their own seven-entry `{ label, value }` literal,
 * compared against nothing — so both had drifted, missing `chart` and `tree`,
 * which `ListView` has drawn for releases. Deriving the options from one total
 * record means the designer offers exactly what the renderer draws, and the
 * next visualization the spec adds fails the build HERE instead of quietly
 * going unofferable.
 *
 * ⚠️ `page` is absent by construction, not by omission: {@link ListViewVisualization}
 * excludes it because the spec models `type: 'page'` as a published page mounted
 * through `pageName` rather than a visualization. A designer picker cannot offer
 * it without also binding that page.
 */
const VIEW_TYPE_LABELS: Record<ListViewVisualization, string> = {
  grid: 'Grid',
  kanban: 'Kanban',
  gallery: 'Gallery',
  calendar: 'Calendar',
  timeline: 'Timeline',
  gantt: 'Gantt',
  map: 'Map',
  chart: 'Chart',
  tree: 'Tree',
};

const VIEW_TYPE_OPTIONS = Object.entries(VIEW_TYPE_LABELS).map(([value, label]) => ({ label, value }));

const ListViewRenderer = ListViewBlock;

/**
 * The record-source and kind inputs both registrations below publish, spelled
 * once so the two cannot drift.
 *
 * A page `list-view` node is written in `@objectstack/spec`'s list view
 * spelling, `data` and `type` (objectstack-ai/objectstack#22444, ruling C;
 * objectui#12099): one list view has one set of property names wherever it is
 * embedded. `objectName` and `viewType` are not published and not read on this
 * node; `ListViewBlock` says what happens to a node that still carries them.
 *
 * `data` is not required (objectui#11605): the node's `dataSource` binding can
 * name the object instead. Without either, the list shows a hint naming
 * `data.object` instead of an empty list.
 */
const LIST_VIEW_DATA_INPUT: ComponentInput = {
  name: 'data',
  type: 'object',
  description:
    'Where this list\'s records come from, the spec\'s `ViewData`: `{ provider: \'object\', object }` lists that object\'s records, and `{ provider: \'value\', items }` hands the list its rows. Not required: the node\'s `dataSource` binding can name the object instead, and `dataSource.object` outranks this key. With neither, the list shows a hint naming `data.object` instead of an empty list.',
} as const;

/**
 * The list kind. On a metadata page it is written `properties.type`, because
 * the node's own `type` is the registry key and stays `list-view`.
 */
const LIST_VIEW_TYPE_INPUT: ComponentInput = {
  name: 'type',
  type: 'enum',
  enum: VIEW_TYPE_OPTIONS,
  description:
    'The list kind, the spec\'s list view `type`. Absent, a bound saved view\'s kind applies, else a grid. On a metadata page it is written `properties.type`; the node\'s own `type` stays `list-view`.',
} as const;

/**
 * The keys a page `list-view` node is written in, spelled once for both
 * registrations below.
 *
 * Every key here is a key of the `list-view` row of `@objectstack/spec`'s
 * `ComponentPropsMap` (objectstack-ai/objectstack#22444), which is the list
 * view's own `ListViewSchema`, and each one is published because the renderer
 * was measured to honour it on a page node: authored in the node's
 * `properties`, rendered through `SchemaRenderer` and this registration, and
 * asserted at what it draws, what it queries or what it hands the view that
 * draws it (`__tests__/ListViewBlock.specInputs-13047.test.tsx`,
 * objectui#13047). The member shapes are the spec's, named in each
 * description; the spec row is the judge of values.
 *
 * Two keys of the row are NOT here, by the same measurement: `name` (read
 * by nothing on a page node) and `sharing` (draws a Share button that does
 * nothing: the spec declares no action for it). So is `filterableFields`, which
 * `@objectstack/spec` retires in 18.0 (objectstack#24640, ruling C): no
 * per-view Filter-panel whitelist replaces it, and the list reads it nowhere
 * since objectui#13118. The console's repo-wide parity gate
 * (`apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`) records
 * each with its reason. `requiredPermissions` was among them until
 * `ListViewBlock` honoured it on a page node (objectui#13074,
 * `__tests__/ListViewBlock.inertKeys-13074.test.tsx`), and so was `addRecord`
 * until the console's page host served the create its Add button opens
 * (objectui#13089, `PageView.listViewAddRecord-13089.test.tsx` in
 * `@object-ui/app-shell`).
 *
 * `data` is NOT required (objectui#11605): the page compile reads this list,
 * so `required: true` would refuse a node bound by `dataSource.object`, which
 * the renderer accepts. A node with neither gets the "no object named" hint
 * `ListViewBlock` draws.
 */
const LIST_VIEW_INPUTS: ComponentInput[] = [
  LIST_VIEW_DATA_INPUT,
  LIST_VIEW_TYPE_INPUT,
  // ── the query ─────────────────────────────────────────────────────────────
  {
    name: 'columns',
    type: 'array',
    description:
      'The fields the list shows, in order: field names (`["name", "stage"]`) or the spec\'s `ListColumn` objects. They are also the query\'s `$select`. Optional on a page node: a node bound to a saved view through `dataSource.view` draws that view\'s columns.',
  },
  {
    name: 'filter',
    type: 'array',
    description: 'The base query filter, the spec\'s `ViewFilterRule` array `[{ field, operator, value }]`, lowered to `$filter`.',
  },
  {
    name: 'sort',
    type: 'array',
    description: 'The initial sort order, `[{ field, order }]`, lowered to `$orderby` in the order written.',
  },
  {
    name: 'pagination',
    type: 'object',
    description:
      'The spec\'s pagination config, `{ pageSize, pageSizeOptions }`: `pageSize` caps each query (`$top`), and `pageSizeOptions` offers those sizes to the user.',
  },
  {
    name: 'searchableFields',
    type: 'array',
    of: 'string',
    description: 'The field names the toolbar search box searches. A term typed into the box is sent with these fields only.',
  },
  // ── identity ──────────────────────────────────────────────────────────────
  {
    name: 'label',
    type: ['string', 'object'],
    description:
      'The list\'s label: it names the exported file and heads the record-detail overlay. A plain string, or an inline per-locale map (`{ en: "Open tasks", "zh-CN": "未完成任务" }`) resolved against the display locale.',
  },
  {
    name: 'description',
    type: ['string', 'object'],
    description:
      'One line about the list, drawn as the toolbar\'s info control (its tooltip and accessible name). A plain string, or an inline per-locale map resolved against the display locale. `appearance.showDescription: false` hides it.',
  },
  // ── the audience ──────────────────────────────────────────────────────────
  {
    name: 'requiredPermissions',
    type: 'array',
    of: 'string',
    description:
      'Capabilities the viewer must ALL hold to see this list, the names permission sets grant through `systemPermissions`. A viewer missing one sees an insufficient-permissions notice in place of the list, and no records are queried. Absent or empty: no gate.',
  },
  // ── the toolbar ───────────────────────────────────────────────────────────
  {
    name: 'userFilters',
    type: 'object',
    description:
      'The quick-filter bar above the list, the spec\'s `UserFilters` config: `{ element: "dropdown" | "toggle" | "tabs", fields | tabs }`. Each filter narrows the query.',
  },
  {
    name: 'userActions',
    type: 'object',
    description:
      'Which toolbar controls the user gets, the spec\'s `UserActionsConfig` of per-control toggles: a control set to `false` (for example `sort: false`) is taken off the toolbar, and the controls it does not name stay.',
  },
  {
    name: 'addRecord',
    type: 'object',
    description:
      'The Add button, the spec\'s `AddRecordConfig`. The spec row declares `enabled` default `true` and `position` default `"bottom"`; the renderer does not apply those defaults: it draws the button only for an explicit `enabled: true`, and places an absent `position` at the top (objectui#13099 owns that gap). `position` places it: `"top"` (the toolbar), `"bottom"` (under the list) or `"both"`. A click opens the create form for the listed object, the one the object list\'s New opens: the record-form overlay, or the full-page create for an object whose `editMode` is `page`. The button is withheld for a viewer who may not create, or whose create the object greys, and on a host that serves no create. `mode` and `formView` are not read. `userActions.addRecordForm: false` also takes the button off.',
  },
  {
    name: 'compactToolbar',
    type: 'boolean',
    description:
      'Gather the grouping, row colour, density and hide-fields controls into one Display form. On by default; `false` draws one toolbar button per control.',
  },
  {
    name: 'appearance',
    type: 'object',
    description:
      'The spec\'s appearance config, `{ showDescription, allowedVisualizations }`. `showDescription: false` hides the description. `allowedVisualizations` narrows the kinds a view switcher offers, and a page node draws no switcher, so on a page it changes nothing: the node\'s `type` is the kind drawn.',
  },
  {
    name: 'exportOptions',
    type: 'object',
    description:
      'The export menu, `{ formats, maxRecords, includeHeaders, fileNamePrefix, streaming }`. Declaring it offers the export on the toolbar, in the listed formats; `fileNamePrefix` names the file.',
  },
  { name: 'allowPrinting', type: 'boolean', description: 'Draw a Print button that opens the browser\'s print dialog for the list.' },
  {
    name: 'showRecordCount',
    type: 'boolean',
    description: 'The record count in the list\'s footer. On by default; `false` takes it off.',
  },
  {
    name: 'emptyState',
    type: 'object',
    description:
      'What the list draws when no record comes back, the spec\'s `EmptyState`: `{ title, message, icon, link }`. `title`, `message` and the link\'s `label` each take a plain string or an inline per-locale map.',
  },
  // ── the grid ──────────────────────────────────────────────────────────────
  {
    name: 'hiddenFields',
    type: 'array',
    of: 'string',
    description: 'Field names taken out of `columns`. A name `columns` does not show takes nothing out.',
  },
  {
    name: 'fieldOrder',
    type: 'array',
    of: 'string',
    description:
      'Field names that order the columns left after `hiddenFields`. A column not listed comes after every listed one; a listed name that is not a column orders nothing.',
  },
  {
    name: 'rowHeight',
    type: 'enum',
    enum: ['compact', 'short', 'medium', 'tall', 'extra_tall'],
    description: 'Row density. Absent, rows are `compact`.',
  },
  { name: 'resizable', type: 'boolean', description: 'Let users drag column borders to resize the grid\'s columns.' },
  {
    name: 'selection',
    type: 'object',
    description: 'Row selection, `{ type: "none" | "single" | "multiple" }`.',
  },
  {
    name: 'navigation',
    type: 'object',
    description:
      'What clicking a row does, the spec\'s `NavigationConfig`: `{ mode: "page" | "drawer" | "modal" | "split" | "popover" | "new_window" | "none", … }`. An overlay mode opens the record over the list, headed by the list\'s `label`.',
  },
  {
    name: 'grouping',
    type: 'object',
    description: 'Group the rows, `{ fields: [{ field, order, collapsed }] }`. The groups and their header counts come from the server.',
  },
  {
    name: 'rowColor',
    type: 'object',
    description: 'Colour whole rows by a field\'s value, `{ field, colors: { VALUE: COLOR } }`.',
  },
  {
    name: 'conditionalFormatting',
    type: 'array',
    of: 'object',
    description:
      'Row style rules, each `{ condition, style }`: a CEL `condition` over the row\'s `record.*` and a CSS `style` map. The first rule that matches styles the row.',
  },
  {
    name: 'inlineEdit',
    type: 'boolean',
    description: 'Open the grid in inline-edit mode, for users who may update the object.',
  },
  {
    name: 'rowActions',
    type: 'array',
    of: 'string',
    description: 'Names of the actions offered on each row\'s menu.',
  },
  {
    name: 'bulkActions',
    type: 'array',
    of: 'string',
    description: 'Names of the actions offered once rows are selected. Needs a multi-row `selection`.',
  },
  {
    name: 'bulkActionDefs',
    type: 'array',
    of: 'object',
    description:
      'Full bulk-action definitions, the spec\'s `BulkActionDef`: a mass update (`operation: "update"` with a `patch`) or delete, or a named action run once for the whole selection.',
  },
  // ── each kind's own block ─────────────────────────────────────────────────
  {
    name: 'options',
    type: 'object',
    description:
      'Per-kind settings, `{ kanban, calendar, gantt, gallery, timeline, map, tree, chart }`, each judged by that kind\'s own block. The top-level block of the same name is the canonical spelling.',
  },
  {
    name: 'kanban',
    type: 'object',
    description:
      'The board, the spec\'s kanban block: `{ groupByField, columns, titleField, summarizeField }`. `groupByField` is the lane field and `columns` the fields on each card.',
  },
  {
    name: 'calendar',
    type: 'object',
    description: 'The calendar, `{ startDateField, endDateField, titleField, colorField, allDayField }`.',
  },
  {
    name: 'gantt',
    type: 'object',
    description:
      'The gantt chart, `{ startDateField, endDateField, titleField, progressField, dependenciesField }`. Both date fields are needed to draw it.',
  },
  {
    name: 'gallery',
    type: 'object',
    description: 'The gallery, `{ coverField, titleField, visibleFields, cardSize, … }`.',
  },
  {
    name: 'timeline',
    type: 'object',
    description: 'The timeline, `{ startDateField, endDateField, titleField, groupByField, colorField, scale }`.',
  },
  {
    name: 'map',
    type: 'object',
    description: 'The map, `{ locationField }` or `{ latitudeField, longitudeField }`, with `titleField`, `zoom` and `center`.',
  },
  {
    name: 'tree',
    type: 'object',
    description: 'The tree, `{ parentField, labelField, fields, defaultExpandedDepth }`.',
  },
  {
    name: 'chart',
    type: 'object',
    description:
      'The chart a `type: "chart"` list draws, bound to an ADR-0021 dataset: `{ dataset, values, dimensions, chartType }`. There is no default binding.',
  },
];

// Register ListView component
ComponentRegistry.register('list-view', ListViewRenderer, {
  namespace: 'plugin-list',
  label: 'List View',
  category: 'Views',
  icon: 'LayoutList',
  inputs: LIST_VIEW_INPUTS.map((input) => ({ ...input })),
  // No `type` default: an absent kind IS the default (the spec's list view
  // `type` defaults to `grid`), and leaving it absent lets a bound saved view's
  // kind apply. A `type` here would also be the registry key's name to any
  // reader that spreads these onto a node.
  defaultProps: {
    data: { provider: 'object', object: '' },
    columns: [],
    filter: [],
    sort: [],
    options: {},
  }
});

// Alias for generic view, exposed only as `view:list`.
//
// `skipFallback` is required: the bare `list` key belongs to the bullet/numbered
// list DISPLAY primitive (`ui:list` in @object-ui/components), used by page
// schemas like `{ type: 'list', items: [...] }`. Without skipFallback this alias
// clobbered the bare key, so a hand-authored bullet list resolved to the
// data-bound ListView (which needs an object to list) instead. Object list VIEWS
// are rendered via `type: 'list-view'`, never the bare `list` lookup, so the
// data view loses nothing by yielding the bare key.
ComponentRegistry.register('list', ListViewRenderer, {
  namespace: 'view',
  skipFallback: true,
  category: 'view',
  label: 'List',
  icon: 'LayoutList',
  // Same renderer, therefore the same declared surface as `list-view` above.
  inputs: LIST_VIEW_INPUTS.map((input) => ({ ...input })),
});
