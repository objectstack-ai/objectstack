/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - ObjectQL Component Zod Validators
 * 
 * Zod validation schemas for ObjectQL-specific components.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/objectql
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  ListViewSchema as SpecListViewSchema,
  GanttConfigSchema as SpecGanttConfigSchema,
  GalleryConfigSchema as SpecGalleryConfigSchema,
  GroupingConfigSchema as SpecGroupingConfigSchema,
  // objectui#11168 slice 3 — the `object-tree` element's `tree` block, by
  // reference (`ObjectTreeSchema.tree` below).
  TreeConfigSchema as SpecTreeConfigSchema,
  HttpMethodSubsetSchema as SpecHttpMethodSubsetSchema,
  HttpRequestSchema as SpecHttpRequestSchema,
  ViewDataSchema as SpecViewDataSchema,
  ListColumnSchema as SpecListColumnSchema,
  SelectionConfigSchema as SpecSelectionConfigSchema,
  PaginationConfigSchema as SpecPaginationConfigSchema,
  UserActionsConfigSchema as SpecUserActionsConfigSchema,
  AriaPropsSchema as SpecAriaPropsSchema,
  NavigationConfigSchema as SpecNavigationConfigSchema,
  ChartAggregateSchema as SpecChartAggregateSchema,
  ChartDrillDownSchema as SpecChartDrillDownSchema,
  I18nLabelSchema as SpecI18nLabelSchema,
  DashboardWidgetSchema as SpecDashboardWidgetSchema,
  ChartAxisSchema as SpecChartAxisSchema,
  ChartSeriesSchema as SpecChartSeriesSchema,
  ChartTypeSchema as SpecChartTypeSchema,
  UserFilterFieldSchema as SpecUserFilterFieldSchema,
  // objectui#7928 — the spec's view CONTAINER, read for ONE slot: its
  // `listViews` record (`ObjectViewSchema.listViews` below, by reference).
  ViewSchema as SpecViewSchema,
  // objectui#10859 (batches 2 to 6) — the `ComponentPropsMap` rows of the
  // ADR-0080 public blocks this module arms, each read as its arm's
  // `properties` bag, by reference (`ObjectQLPublicBlockComponentSchema` below).
  ObjectMetricPropsSchema as SpecObjectMetricPropsSchema,
  ObjectMasterDetailFormPropsSchema as SpecObjectMasterDetailFormPropsSchema,
  ObjectTimelinePropsSchema as SpecObjectTimelinePropsSchema,
  ObjectFormPropsSchema as SpecObjectFormPropsSchema,
  ObjectMapPropsSchema as SpecObjectMapPropsSchema,
  ObjectGanttPropsSchema as SpecObjectGanttPropsSchema,
  // objectui#11276 — the `object-grid` row, read as the authored arm's
  // `properties` bag, by reference (`ObjectGridBlockSchema` below).
  ObjectGridPropsSchema as SpecObjectGridPropsSchema,
  // objectui#6152 round 8 — the `object-kanban` and `object-calendar` rows, read
  // for ONE member each: the flat arms' `filter`, by reference.
  ObjectKanbanPropsSchema as SpecObjectKanbanPropsSchema,
  ObjectCalendarPropsSchema as SpecObjectCalendarPropsSchema,
  // objectui#6152 round 6 — the spec schemas `ObjectGridSchema`'s TypeScript twin
  // declares itself aligned with, read by reference for the members it mirrors
  // (`rowColor`, `rowHeight`, and the `operation` / `visible` members of one
  // `bulkActionDefs` entry).
  RowColorConfigSchema as SpecRowColorConfigSchema,
  RowHeightSchema as SpecRowHeightSchema,
  BulkActionDefSchema as SpecBulkActionDefSchema,
  BulkActionOperationSchema as SpecBulkActionOperationSchema,
  // objectui#11070 — the per-element data binding (`PageComponentSchema.dataSource`)
  // the object-bound arms below declare as `dataSource`, by reference.
  ElementDataSourceSchema as SpecElementDataSourceSchema,
  // objectui#11227 — the list view's empty-state shape, which the spec's
  // `object-grid` row holds by reference since 17.6.0; `ObjectGridSchema.emptyState`
  // below takes it by reference too.
  EmptyStateSchema as SpecEmptyStateSchema,
  // objectui#6152 round 12 — the view write door's members, read for ONE member:
  // the flattened list overlay's legacy `options` bag (`ListViewOptionsBag`
  // below, by reference). The bag's own schema is module-private in the spec.
  VIEW_METADATA_MEMBERS as SpecViewMetadataMembers,
  checkListViewCalendarVisualization,
  // objectui#12670 — the spec list view's chart-binding check. On the flat
  // `ListViewSchema` the view kind is objectui's `viewType`, so it is not
  // attachable there; in the authored `list-view` node's bag the kind is the
  // spec's own `type`, so `ListViewPropsBag` below attaches it.
  checkListViewChartBinding,
} from '@objectstack/spec/ui';
// objectui#11266 — one inline master-detail grid column, the closed shape
// `@objectstack/spec` 17.6.0 judges `FormViewSchema.subforms[].columns` by
// (objectstack#20927); `ObjectFormSchema.subforms[].columns` below takes it by
// reference.
import { InlineGridColumnSchema as SpecInlineGridColumnSchema } from '@objectstack/spec/data';
import { BaseSchema, specFieldsExcept } from './base.zod.js';
import { aliasKeyRefusal, handlerKeyRefusal, neitherContentChannelGuidance, retirementTombstone } from './tombstone.zod.js';
import { DataTableSchema, DrillDownConfigSchema, PivotTableSchema } from './data-display.zod.js';
// The kanban CARD vocabulary has one authority (`./complex.zod.ts`); the
// `object-kanban` lane below reads it rather than restating it (objectui#8913).
import { KanbanCardSchema } from './complex.zod.js';
import { ViewSwitcherSchema } from './views.zod.js';
import { stripImportedDefaults } from './imported-defaults.js';
import { ExpressionWireSchema } from './expression.zod.js';
import { dataSourceSuppliesObject, flatPropRefusals, NODE_ENVELOPE, propsBag } from './public-blocks.zod.js';

/**
 * ⭐ THE IMPORT BOUNDARY (objectui#8317, decision batch #90, 2026-09-08).
 *
 * **This mirror authors no default, imported subschemas included.** Batch #69
 * (objectui#7735) ruled that a validator validates and does not write values
 * into an author's document; batch #90 ruled that this holds for EVERY key
 * `safeValidateSchema` answers, not only the sites this repository wrote. So a
 * schema arriving from `@objectstack/spec` crosses into a mirror shape only
 * through `stripImportedDefaults`, which removes each reachable `ZodDefault`
 * with `.removeDefault()` and keeps the key omissible. Keys, types, checks and
 * the accept set are untouched, and a subtree carrying no default comes back
 * reference-equal — so this is a no-op the day the spec adopts the same
 * principle.
 *
 * ⛔ Spelled at every crossing rather than once per file, deliberately: a local
 * `const Spec… = stripImportedDefaults(…)` would put the spec's provenance one
 * hop away from every declaration that reads it, and `check:spec-symbols`
 * (rule 1) reads exactly one hop — a mirror export under a spec-owned name has
 * to show the spec binding in its OWN initializer. The verbosity is the
 * provenance.
 *
 * ⚠️ A read that is NOT a crossing stays unwrapped and is declared as such: a
 * value VOCABULARY (`./views.zod.ts`'s `SpecListViewTypeEnum` and
 * `./objectql.zod.ts`'s `ViewKindEnum`, which unwrap the spec's own
 * `.default('grid')` to reach its enum) and a TYPE position — neither puts a
 * default into a parsed document. `../__tests__/imported-defaults-8317.test.ts`
 * re-derives that exception list from the source rather than trusting this
 * paragraph, and fails if an entry stops matching a real read.
 */


/**
 * HTTP Method Schema — `@objectstack/spec/ui` schema re-exported by reference
 * (issue #2231; formerly a hand-written mirror).
 *
 * The spec renamed the 5-value subset to `HttpMethodSubsetSchema` in
 * 17.0.0-rc.5 (objectstack#5832) to stop it colliding with the 7-value
 * `HttpMethod` in the published JSON Schema. The runtime domain is unchanged,
 * so this repo keeps exporting it under the `HttpMethodSchema` name — following
 * the rename WITHOUT changing cross-package semantics (`48132f7e6`).
 */
export const HttpMethodSchema = stripImportedDefaults(SpecHttpMethodSubsetSchema);

/**
 * HTTP Request Schema — `@objectstack/spec/ui` schema re-exported by reference
 * (issue #2231; formerly a hand-written mirror). Differences vs the old mirror:
 * `body` is the spec's `z.unknown()` (a superset of the old record/string/FormData/
 * Blob union). `method` is declared and accepted but NOT defaulted on parse:
 * the spec's `.default('GET')` is stripped at the import boundary above, so a
 * request that omits `method` comes back without it.
 */
export const HttpRequestSchema = stripImportedDefaults(SpecHttpRequestSchema);

/**
 * View Data Source Schema — `@objectstack/spec/ui` schema re-exported by reference
 * (issue #2231; formerly a hand-written mirror that had drifted behind the spec's
 * fourth `provider: 'schema'` variant for schema-bound forms).
 */
export const ViewDataSchema = stripImportedDefaults(SpecViewDataSchema);

/**
 * List Column Schema — `@objectstack/spec/ui` schema re-exported by reference
 * (issue #2231).
 *
 * This used to `.extend()` the spec with two objectui-only fields, each carrying
 * a note to promote it upstream rather than grow the extension. spec v17 did
 * exactly that (objectui#2231): `summary` is now the spec's
 * `union([ColumnSummarySchema, ColumnSummaryConfigSchema])` — the same enum ∪
 * `{ type, field }` form `useColumnSummary` in `@object-ui/plugin-grid` reads —
 * and `prefix` is the spec's `ColumnPrefixSchema`. With both upstream the
 * extension collapses to the plain re-export it always said it would become.
 *
 * The spec declares `prefix.type` with a `.default('text')`. That default is
 * stripped at the import boundary above, so the key is declared and accepted but
 * NOT defaulted on parse: a column omitting `prefix.type` comes back without it,
 * and a renderer reading it cannot assume a value is present.
 */
export const ListColumnSchema = stripImportedDefaults(SpecListColumnSchema);

/**
 * Selection Config Schema — `@objectstack/spec/ui` schema re-exported by reference
 * (issue #2231; formerly a hand-written mirror). `type` is declared and accepted
 * but NOT defaulted on parse: the spec's `.default('none')` is stripped at the
 * import boundary above, so an omitted `type` stays omitted.
 */
export const SelectionConfigSchema = stripImportedDefaults(SpecSelectionConfigSchema);

/**
 * Pagination Config Schema — `@objectstack/spec/ui` schema re-exported by reference
 * (issue #2231; formerly a hand-written mirror). `pageSize` is the spec's
 * positive-int, declared and accepted but NOT defaulted on parse: the spec's
 * `.default(25)` is stripped at the import boundary above, so an omitted
 * `pageSize` stays omitted.
 */
export const PaginationConfigSchema = stripImportedDefaults(SpecPaginationConfigSchema);

/**
 * Sort Config Schema
 */
export const SortConfigSchema = z.object({
  field: z.string().describe('Field to sort by'),
  order: z.enum(['asc', 'desc']).describe('Sort order'),
});

/**
 * The spec's OBJECT arm of `exportOptions`, as a SHAPE, reached without restating
 * its keys (objectui#7762).
 *
 * `ListViewExportOptionsSchema` is internal to the spec bundle and NOT a public
 * export (measured, not assumed, by `../__tests__/export-options-spec-parity.test.ts`).
 * The exported `ListViewSchema.shape.exportOptions` is the whole contract, but it is a
 * TWO-ARM union: the legacy bare format array — which LIFTS to `{ formats }` at parse —
 * and the strict five-key object. `ListViewSchema` below binds that union by reference
 * and is right to: `list-view` reads both spellings. `object-grid` does not, so this
 * peels the object arm out and leaves the lifting arm behind.
 *
 * Peeled rather than restated on purpose: a local copy of the five keys is a third
 * copy of one contract, and the copy is what drifts (the lesson `objectql.ts`'s
 * `ListViewExportOptions` docblock already records for the TypeScript face). Every
 * member here is the spec's own schema object, so `'pdf'` and a sixth key stay refused
 * with the spec's own messages and a spec-side change moves this member with it.
 *
 * The TYPE is derived by the same two steps at the TYPE level (`unwrap` then the arm with a
 * `shape`), so the authoring face keeps the spec's per-member types — a `z.ZodRawShape`
 * annotation here would erase them and collapse `z.input` of every member to `unknown`,
 * which the mirror-parity drift ledger reports as `exportOptions` NARROWER than declared.
 *
 * THROWS at module load if the spec stops exposing an object arm. That is the intended
 * failure: the alternative is a member that silently stops being the spec's, which is
 * the class of defect this whole file exists to make visible.
 */
type SpecExportOptionsUnion = ReturnType< typeof SpecListViewSchema.shape.exportOptions.unwrap >;
/** The object arm, statically: the one union member exposing a `shape` (the other is the lift's pipe). */
type SpecExportOptionsObjectArm = Extract< SpecExportOptionsUnion['options'][number], { shape: unknown } >;
type SpecExportOptionsShape = SpecExportOptionsObjectArm['shape'];

const SPEC_EXPORT_OPTIONS_OBJECT_SHAPE: SpecExportOptionsShape = ((): SpecExportOptionsShape => {
  type Peelable = {
    unwrap?: () => Peelable;
    options?: readonly Peelable[];
    shape?: SpecExportOptionsShape;
  };
  let cur = stripImportedDefaults(SpecListViewSchema).shape.exportOptions as unknown as Peelable;
  for (let i = 0; i < 5 && cur && !cur.options && typeof cur.unwrap === 'function'; i++) {
    cur = cur.unwrap();
  }
  const arm = cur.options?.find((o) => o.shape);
  if (!arm?.shape) {
    // Short on purpose: this string SHIPS (the console's `framework` chunk), while the
    // docblock above it — which carries the rationale and the remedy — is stripped by the
    // production minifier. It still names the moved spec symbol, the member that depends on
    // it, and the card, which is what a diagnostic has to do.
    throw new Error(
      '@object-ui/types: no object arm on `ListViewSchema.shape.exportOptions`; ' +
        '`ObjectGridSchema.exportOptions` binds it by reference (objectui#7762).',
    );
  }
  return arm.shape;
})();

/**
 * ONE string, BOTH author-facing channels — the `.describe()` metadata generated docs
 * publish, and the parse-time issue message an author who writes the wrong shape reads.
 * The house discipline of `./tombstone.zod.ts`: two channels that cannot drift apart
 * because there is only one string.
 *
 * The refusal it carries is objectui#7762's ruling. `ObjectGrid.tsx` reads
 * `schema.exportOptions?.formats` and nothing else, so a bare format array authored on
 * an `object-grid` node used to validate green through `BaseSchema`'s `.passthrough()`
 * and then lose SILENTLY to the `['csv', 'json']` default — no render-time error, warning
 * or console line (only the parser tier's `type-mismatch` warning noticed it), with the
 * export button still shown. Refusing it by name is that silent
 * no-op made loud; nothing that renders today stops rendering.
 */
const OBJECT_GRID_EXPORT_OPTIONS_GUIDANCE =
  'Export configuration for the grid toolbar menu — the OBJECT form only: ' +
  '`{ formats, maxRecords, includeHeaders, fileNamePrefix, streaming }`. A bare format ' +
  'array is the `list-view` spelling and is NOT read here: `object-grid` reads ' +
  '`exportOptions.formats`, so an array is silently dropped for the csv/json ' +
  'default. Write `{ "formats": ["csv", "xlsx"] }` instead.';

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `ObjectGridSchema`. */
const OBJECT_GRID_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-grid',
  'its `any`-typed registration hands the node to `ObjectGrid`, which reads it as `ObjectGridSchema`',
  'the records of `objectName` as a data grid, shaped by `columns`, `filter`, `sort`, `grouping` and `selection`',
);

/**
 * objectui#11068 — ONE string per retired key, for both author-facing channels
 * (`retirementTombstone()` writes it into `.describe()` and the parse message).
 */
const OBJECT_GRID_ROW_SPEC_ACTIONS_RETIRED =
  'RETIRED (objectui#11068, ADR-0049) — `rowSpecActions` was a second spelling of `rowActions`, and nothing '
  + 'ever read it, so an authored list drew no row-menu entry. Rename the key to `rowActions`.';
const OBJECT_GRID_BULK_SPEC_ACTIONS_RETIRED =
  'RETIRED (objectui#11068, ADR-0049) — `bulkSpecActions` was a second spelling of `bulkActions`, and nothing '
  + 'ever read it, so an authored list offered no bulk action. Rename the key to `bulkActions`.';
const OBJECT_GRID_NAME_RETIRED =
  'RETIRED on `object-grid` (objectui#11068, ADR-0049) — a grid has no `name`: it is not a form field, and '
  + 'nothing read the key. Write `id` for the node\'s identity (it also scopes the saved column layout) and '
  + '`label` for the grid\'s caption.';
const OBJECT_GRID_PLACEHOLDER_RETIRED =
  'RETIRED on `object-grid` (objectui#11068, ADR-0049) — a grid is not an input, and nothing read '
  + '`placeholder`. The text the grid shows when it has no rows is `emptyState: { message }`.';
const OBJECT_GRID_SHOW_FILTERS_RETIRED =
  'RETIRED on `object-grid` (objectui#11068, ADR-0049) — the grid has no filter UI, and nothing read '
  + '`showFilters`, so an authored value drew nothing. The filter builder is the `list-view` toolbar\'s: '
  + 'author a `list-view` and switch the builder with its `userActions.filter`. To narrow the rows this '
  + 'grid fetches, write `filter`.';
/**
 * objectui#6152 round 7 — the same one-string shape for `resizableColumns`, retired
 * with `ObjectGrid`'s fallback read of it. It names `properties.resizable` because an
 * AUTHORED `object-grid` takes its props in the spec row's `properties` bag
 * (objectui#11276); a node composed in code writes `resizable` on the node, and the
 * hoist makes the two spellings one key.
 */
const OBJECT_GRID_RESIZABLE_COLUMNS_RETIRED =
  'RETIRED (objectui#6152, ADR-0049) — `resizableColumns` was the legacy second spelling of `resizable`, '
  + 'read only when `resizable` was absent, and `ObjectGrid` no longer reads it, so an authored value would '
  + 'draw nothing; `@objectstack/spec` 17.7.0 refuses it by name on `object-grid` too. Rename the key to '
  + '`resizable` — on an authored node, `properties.resizable`: '
  + '`{ "type": "object-grid", "properties": { "resizable": false } }`.';

/**
 * objectui#11070 — ONE `.describe()` string for every object-bound arm that declares
 * the spec's per-element binding as `dataSource` (by reference to
 * `ElementDataSourceSchema`, spelled inline at each crossing — see `./imported-defaults.ts`
 * on why the crossing itself is never parked in a const). Each of these blocks' registrations
 * is gate-wrapped (`elementDataSourceBlock`), which is what publishes the key as an authored
 * input (objectui#6678); the reads are reasoned on the TypeScript twin of `ObjectGridSchema`.
 */
const ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION =
  'Per-element data binding — `@objectstack/spec` `ElementDataSourceSchema`, the OBJECT binding '
  + '`PageComponentSchema.dataSource` declares beside its API binding (`ElementApiDataSourceSchema`, which this arm does not admit), by reference: { object, view?, filter?, sort?, limit? } '
  + 'describing WHAT this block queries. Metadata, never the data-source adapter (the host injects that; '
  + '`SchemaRenderer` strips this key from the props it spreads so it cannot shadow the adapter).';

/**
 * objectui#11117 — ONE `.describe()` string for the `objectName` member of the
 * gate-wrapped arms whose ONLY rung it is (`object-grid`, `list-view`): optional
 * as a member, required by `requireRecordSource` unless the node's binding names
 * the object. The ladder arms (`object-map`, `object-gantt`, `object-calendar`,
 * `object-kanban`) name the binding in their own rung descriptions.
 */
const OBJECT_NAME_BINDING_WAIVER_DESCRIPTION =
  'ObjectQL object name — required unless the node\'s `dataSource.object` names the object, which '
  + '`ElementDataSourceGate` lands here before the renderer reads the node. A node with neither is refused '
  + 'here, keyed `RECORD_SOURCE_REQUIRED`.';

/**
 * The protocol's own conditional-formatting rule: `ListViewSchema.conditionalFormatting[]`'s
 * element, read BY REFERENCE through the import boundary — a strict `{ condition, style }`
 * object. Both rules this module declares `.extend()` it: `ConditionalFormattingRuleSchema`
 * below (the grid's and the list view's, objectui#11533) and
 * `KanbanConditionalFormattingRuleSchema` (objectui#11522). Declared here, above the grid's
 * mirror, because that mirror reads it at module load (objectui#6152 round 6). The boundary
 * walker is memoised, so every read of this element is the same object.
 */
const SpecListViewRuleSchema = stripImportedDefaults(SpecListViewSchema).shape.conditionalFormatting.unwrap().element;

/**
 * The `condition` of a spec-shape conditional-formatting rule, `{ condition, style }`:
 * the zod twin of `SpecConditionalFormattingRule.condition` (`../objectql.ts`), read by
 * both rules in this module (`ConditionalFormattingRuleSchema` right below, which the
 * grid's and the list view's `conditionalFormatting` share, and
 * `KanbanConditionalFormattingRuleSchema`), objectui#10946. It sits above the grid's
 * mirror because that mirror reads it at module load (objectui#6152 round 6).
 *
 * Two arms, and their ORDER is the point:
 *
 *  - `z.string()` FIRST, the member's pre-existing declaration. A string condition
 *    parses exactly as it always did. It is not canonicalized into an envelope, and
 *    `''` is still accepted. The spec's own slot does both of those things to a string
 *    (its string arm is a `min(1)` pipe into `{ dialect: 'cel', source }`), so reading
 *    the slot alone would have narrowed this validator and rewritten its parse output.
 *  - The protocol's own slot schema, `ListViewSchema.conditionalFormatting[].condition`,
 *    BY REFERENCE, for everything that is not a string: the `{ dialect, source }`
 *    envelope `objectstack build` emits, judged by the spec's rule for it. The installed
 *    spec takes `source` or `ast`; spec `main` requires a non-blank `source`. Whichever
 *    line is installed is what this arm enforces, with no local copy to drift.
 *
 * The union's `z.input` is the TS member's type, `string` plus the spec slot's input,
 * so the two faces admit the same values by construction.
 */
const SpecRuleConditionSchema = z.union([
  z.string(),
  SpecListViewRuleSchema.shape.condition,
]);

/**
 * The guidance a retired `object-grid` / `list-view` rule key is refused with
 * (objectui#11533), as `kanbanRuleKeyRetired` below does for `object-kanban`
 * (objectui#11522).
 *
 * `native` keys are the native `{ field, operator, value }` comparison;
 * `expression` is that dialect's template predicate; `colour` keys are a colour
 * written at the TOP LEVEL of a rule — on the native comparison, beside an
 * `expression`, or beside a CEL `condition` (the "flat CEL" rule). Each message
 * names the key, the retirement and the one spelling that replaces it.
 */
function gridRuleKeyRetired(key: string, kind: 'native' | 'expression' | 'colour'): string {
  const lead =
    kind === 'native'
      ? `\`${key}\` belongs to the native rule dialect \`{ field, operator, value }\`, `
      : kind === 'expression'
        ? '`expression` is the template predicate of the native rule dialect, '
        : `\`${key}\` is a colour written at the top level of the rule, `;
  const into = key === 'textColor' ? '`style: { color }`' : `\`style: { ${key} }\``;
  const respell =
    kind === 'native'
      ? 'Respell `{ field: \'priority\', operator: \'equals\', value: \'high\', backgroundColor: \'#fee2e2\' }` as '
        + '`{ condition: "record.priority == \'high\'", style: { backgroundColor: \'#fee2e2\' } }` '
        + '(`not_equals` is `!=`, `greater_than` is `>`, `less_than` is `<`, `contains` is `.contains(…)`, '
        + '`in` is `record.f in [ … ]`).'
      : kind === 'expression'
        ? 'Write the predicate as the rule\'s `condition`, in CEL over `record.*` with no `${…}` wrapper: '
          + '`{ expression: \'${record.amount > 1000}\', backgroundColor: \'#fee2e2\' }` is '
          + '`{ condition: \'record.amount > 1000\', style: { backgroundColor: \'#fee2e2\' } }`.'
        : `Move the colour into the rule's CSS map: ${into}.`;
  return (
    lead
    + 'which `conditionalFormatting` on `object-grid` and `list-view` no longer accepts: RETIRED (objectui#11533), '
    + 'with no alias window. A rule is `{ condition, style }` — a CEL `condition` over `record.*` and a CSS '
    + '`style` map, the rule `@objectstack/spec`\'s `ListViewSchema.conditionalFormatting` declares. '
    + respell
  );
}

/**
 * objectui#11533 — ONE `conditionalFormatting` rule dialect for the grid and the
 * list view, the spec list view's `{ condition, style }`; the native dialect is
 * refused BY NAME (triage ruling 5965301211: retire, as objectui#11522 ruled for
 * the kanban board, not widen).
 *
 * Module-private and shared, so the list view's member and the grid's member are
 * one declaration (objectui#6152 round 6 hoisted it out of `ListViewSchema` when
 * the grid's mirror took the same member). Through the grid's mirror it also
 * judges the `object-view` `table` slot.
 *
 * The rule is the protocol's own element ({@link SpecListViewRuleSchema}),
 * `.extend()`-ed, so it inherits that element's strictness (an undeclared key is
 * refused with the spec's own "Unrecognized key(s) on this conditional formatting
 * rule" message) and its `style` map, and moves with the installed spec. Two
 * things are layered on top, and only two:
 *
 *   - `condition` is `SpecRuleConditionSchema`, so a string condition is not
 *     canonicalized into an envelope and `''` is still accepted, exactly as
 *     before (objectui#10946);
 *   - the retired keys are DECLARED and unwritable (`retirementTombstone()`), so
 *     each is refused at its own path with the remedy instead of being one more
 *     unrecognized key: the native comparison's `field` / `operator` / `value`,
 *     its template predicate `expression`, and the three top-level colour keys
 *     the shared resolver would otherwise still paint with — `backgroundColor`,
 *     `borderColor`, `textColor`. `z.input` of each is `undefined`, which is the
 *     TS twin's `?: never`.
 *
 * Before this, the member was a union of the native comparison
 * (`{ field, operator, value, backgroundColor?, textColor?, borderColor?,
 * expression? }`) and a loose `{ condition, style }` object, under a "broader
 * than spec, migration deferred" note on the list view.
 *
 * ⚠️ Stored stock is not authoring: `resolveConditionalFormatting`
 * (`@object-ui/core`) keeps every arm as a compatibility read, so a grid or list
 * view STORED with a native rule still paints — nothing on the render path parses
 * against this schema. The TS twin is `ConditionalFormattingRule`
 * (`../objectql.ts`); the two faces are pinned equal in
 * `../__tests__/grid-list-view-conditional-formatting-11533.test.ts`.
 */
const ConditionalFormattingRuleSchema = SpecListViewRuleSchema.extend({
  condition: SpecRuleConditionSchema,
  field: retirementTombstone(gridRuleKeyRetired('field', 'native')),
  operator: retirementTombstone(gridRuleKeyRetired('operator', 'native')),
  value: retirementTombstone(gridRuleKeyRetired('value', 'native')),
  expression: retirementTombstone(gridRuleKeyRetired('expression', 'expression')),
  backgroundColor: retirementTombstone(gridRuleKeyRetired('backgroundColor', 'colour')),
  borderColor: retirementTombstone(gridRuleKeyRetired('borderColor', 'colour')),
  textColor: retirementTombstone(gridRuleKeyRetired('textColor', 'colour')),
});

/**
 * objectui#6152 round 6 — one entry of `ObjectGridSchema.aggregations`, restating
 * the interface's inline entry member for member: the field and the function the
 * grouped grid's header query compiles (`summaryColumnsOf` in
 * `@object-ui/plugin-grid`'s `useServerGrouping.ts`). ⚠️ Not the spec's
 * `ChartAggregateFunctionSchema`, which has no `count_distinct`. Strict, so a
 * misspelt member is named instead of the header number silently not drawing.
 */
const ObjectGridAggregationSchema = z.strictObject({
  field: z.string().describe('Field the group header aggregates'),
  type: z.enum(['sum', 'count', 'avg', 'min', 'max', 'count_distinct']).describe('Aggregate function'),
});

/**
 * objectui#6152 round 8 — the two `operations` members `@objectstack/spec` 17.7.0
 * refuses on `object-grid`, retired here with a remedy that also serves the
 * `object-view` `table` slot built from this mirror. `ObjectView` reads `read`
 * off the VIEW's own `operations` (its row-click gate), falling back to
 * `table.operations` only when the view declares none, so the remedy for an
 * inert row names the view node rather than "delete the key" alone.
 */
const OBJECT_GRID_OPERATIONS_READ_RETIRED =
  'RETIRED on `object-grid` (objectui#6152, ADR-0049) — `operations.read` has no reader on a grid: it always lists '
  + 'the records it is bound to, so the toggle toggled nothing, and `@objectstack/spec` 17.7.0 refuses it by name. '
  + 'Delete the key. On an `object-view`, whether a row click opens the record is the VIEW\'s own: write '
  + '`navigation: { mode: \'none\' }` (or `operations: { read: false }`) on the `object-view` node, not inside `table`.';
const OBJECT_GRID_OPERATIONS_IMPORT_RETIRED =
  'RETIRED on `object-grid` (objectui#6152, ADR-0049) — `operations.import` has no reader: the grid draws no '
  + 'import affordance, so the toggle toggled nothing, and `@objectstack/spec` 17.7.0 refuses it by name. '
  + 'Delete the key.';

/**
 * `ObjectGridSchema.operations` — the `object-grid` row's own strict
 * `{ create?, update?, delete?, export? }` block BY REFERENCE (`@objectstack/spec`
 * 17.7.0), the four toggles `ObjectGrid` reads, with the spec's own descriptions and
 * its own refusal of an unknown member (`creat: false` is named, not dropped).
 *
 * objectui#6152 round 8: round 6 restated the interface's six toggles here,
 * `read` and `import` among them, which nothing reads and the row now refuses. The
 * two are declared and unwritable (`retirementTombstone()`), on the
 * `ConditionalFormattingRuleSchema` precedent above: `.extend()` keeps the row's
 * strictness and its unknown-key message, and each retired key is refused at its
 * own path with the remedy. `z.input` of each is `undefined`, which is the TS
 * twin's `?: never`.
 */
const ObjectGridOperationsSchema = stripImportedDefaults(SpecObjectGridPropsSchema).shape.operations.unwrap().extend({
  read: retirementTombstone(OBJECT_GRID_OPERATIONS_READ_RETIRED),
  import: retirementTombstone(OBJECT_GRID_OPERATIONS_IMPORT_RETIRED),
});

/**
 * objectui#6152 round 6 — one entry of a `bulkActionDefs` entry's `params`,
 * restating `BulkActionParam` (`../objectql.ts`) member for member. LOOSE, because
 * the interface is: its catch-all forwards widget configuration to the field
 * renderer as-is, and each `options` entry is open for the same reason.
 *
 * ⚠️ Wider than the protocol's `BulkActionParamSchema`, which is strict and takes
 * `type` from a closed vocabulary. The mirror follows its TypeScript twin, which
 * is the parity this file's ledgers hold; a narrowing of the twin is its own
 * question.
 */
const ObjectGridBulkActionParamSchema = z.looseObject({
  name: z.string(),
  label: z.string().optional(),
  help: z.string().optional(),
  type: z.string(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  options: z.array(z.looseObject({
    label: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })).optional(),
  object: z.string().optional(),
  multiple: z.boolean().optional(),
  labelField: z.string().optional(),
  placeholder: z.string().optional(),
});

/**
 * objectui#6152 round 6 — one entry of `ObjectGridSchema.bulkActionDefs`,
 * restating `BulkActionDef` (`../objectql.ts`) member for member. Strict: the
 * interface declares no catch-all.
 *
 * Two members are the protocol's own, BY REFERENCE, as the interface takes them:
 * `operation` is the spec's `BulkActionOperationSchema`, and `visible`'s second arm
 * is the spec's `bulkActionDefs[].visible` slot beside objectui's
 * `ExpressionWireSchema`. ⚠️ The entry is NOT the spec's `BulkActionDefSchema` by
 * reference: measured against the twin, that schema is narrower on `params` (a
 * strict entry with a closed `type`) and on `visible` (no `ExpressionWire` arm), so
 * binding it would refuse values the twin declares — a `KnownDrift` row this ledger
 * does not take. `actionDef` is the member `resolveBulkActions` fills when a def is
 * promoted from an object action; the twin declares it, so the mirror does.
 */
const ObjectGridBulkActionDefSchema = z.strictObject({
  name: z.string(),
  label: z.string().optional(),
  icon: z.string().optional(),
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost', 'outline']).optional(),
  operation: stripImportedDefaults(SpecBulkActionOperationSchema),
  patch: z.record(z.string(), z.unknown()).optional(),
  params: z.array(ObjectGridBulkActionParamSchema).optional(),
  // The twin's two arms (objectui#13183): a string, or the `template` envelope a
  // parsed def carries once the spec makes the slot a template slot (objectstack#24947).
  confirmText: z.union([z.string(), z.object({ dialect: z.literal('template').optional(), source: z.string().optional() })]).optional(),
  confirmLabel: z.string().optional(),
  visible: z.union([ExpressionWireSchema, stripImportedDefaults(SpecBulkActionDefSchema).shape.visible]).optional(),
  requiredPermissions: z.array(z.string()).optional(),
  maxRecords: z.number().optional(),
  batchSize: z.number().optional(),
  execution: z.enum(['perRecord', 'aggregate']).optional(),
  actionDef: z.record(z.string(), z.unknown()).optional(),
});

/**
 * ObjectGrid Schema
 *
 * ## No longer an authoring arm (objectui#11276)
 *
 * This mirror is the node as `ObjectGrid` reads it: after `SchemaRenderer` has
 * hoisted the node's `properties` bag onto it, or as code composes it
 * (`ObjectView`, `ListView`, the designers). It is also what the `object-view`
 * `table` slot below is built from. It left `ObjectQLComponentSchema`, and so
 * `AnyComponentSchema`: the AUTHORED `object-grid` node is armed by
 * `ObjectGridBlockSchema` below, whose `properties` is the spec's
 * `ComponentPropsMap['object-grid']` row. It stays exported and paired with
 * its TypeScript twin.
 */
export const ObjectGridSchema = BaseSchema.extend({
  type: z.literal('object-grid'),
  // objectui#10872 batch 9 — the node-level `responsiveStyles` the spec's
  // `PageComponentSchema` declares, from the ONE fragment the public blocks
  // spread (`NODE_ENVELOPE`). A producer writes it on `object-grid` nodes, and
  // `SchemaRenderer` compiles it on every node. The TS twin declares it too.
  ...NODE_ENVELOPE,
  // objectui#11117 — OPTIONAL as a member, REQUIRED by the refinement at the end
  // unless the node's `dataSource.object` names the object: the registration is
  // gate-wrapped, and `ElementDataSourceGate` lands the binding's `object` here.
  objectName: z.string().optional().describe(OBJECT_NAME_BINDING_WAIVER_DESCRIPTION),
  // objectui#11070 — the spec's per-element binding, by reference, as
  // `public-blocks.zod.ts`'s `element:number` arm already declares it. The
  // registered renderer reads it off the node through `ElementDataSourceGate`,
  // and every gate-wrapped registration publishes it as an authored input
  // (objectui#6678); the reasoning is on the TS twin's member.
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  data: ViewDataSchema.optional().describe('Data source configuration'),
  columns: z.union([z.array(z.string()), z.array(ListColumnSchema)]).optional().describe('Columns configuration'),
  // objectui#6152 round 8 — the `object-grid` row's own `filter` member BY
  // REFERENCE: the `ViewFilterRule` array, with the row's refusal of the
  // MongoDB-style record and the AST tuple array. It was `z.array(z.any())`, so
  // the `object-view` `table` slot built from this mirror accepted both. The read
  // is wider on purpose: `ObjectGrid` lowers an AST array a host composes at
  // runtime, which is not an authored shape (see the TS twin's member).
  filter: stripImportedDefaults(SpecObjectGridPropsSchema).shape.filter,
  sort: z.array(SortConfigSchema).optional().describe('Sort configuration (array only; the legacy string clause is retired — objectui#8221)'),
  searchableFields: z.array(z.string()).optional().describe('Searchable fields'),
  resizable: z.boolean().optional().describe('Enable column resizing'),
  showColumnTypeIcons: z.boolean().optional().describe('Show column type icons (T/Tag/Calendar) in headers. Off by default — type is usually obvious from cell content; the icons add visual noise.'),
  selection: SelectionConfigSchema.optional().describe('Selection configuration'),
  pagination: PaginationConfigSchema.optional().describe('Pagination configuration'),
  bulkActions: z.array(z.string()).optional().describe('Bulk action identifiers (spec-canonical key; batchActions is the legacy alias)'),
  // `exportOptions` — the spec's OBJECT arm, BY REFERENCE, with the bare array refused
  // by name (objectui#7762). ⛔ NOT `SpecListViewSchema.shape.exportOptions` itself:
  // that reference is the two-arm union whose first arm LIFTS a bare array to
  // `{ formats }`, so binding it would make this mirror ACCEPT AND LIFT — the opposite
  // of the named refusal ruled for this node. The strictness is the arm's own
  // (`catchall: never`, measured), so a sixth key keeps zod's own `unrecognized_keys`
  // message naming it, and a retired `'pdf'` keeps the spec's migration prescription:
  // only the `invalid_type` message is local, and only it names the object form.
  exportOptions: z
    .strictObject(SPEC_EXPORT_OPTIONS_OBJECT_SHAPE, {
      error: (issue) => (issue.code === 'invalid_type' ? OBJECT_GRID_EXPORT_OPTIONS_GUIDANCE : undefined),
    })
    .optional()
    .describe(OBJECT_GRID_EXPORT_OPTIONS_GUIDANCE),

  // Legacy fields
  fields: z.array(z.string()).optional(),
  staticData: z.array(z.any()).optional(),
  selectable: z.union([z.boolean(), z.enum(['single', 'multiple'])]).optional(),
  pageSize: z.number().optional(),
  showSearch: z.boolean().optional(),
  showPagination: z.boolean().optional(),
  // objectui#5861 — RETIRED under ADR-0049, in lockstep with the `?: never`
  // twin on the interface. `@objectstack/spec` refuses this key BY NAME on
  // `object-grid` (a retired-key tombstone since 17.3.0), and no renderer in
  // this repo reads it any more, so a declared-but-ignored member here would
  // parse green and draw an unsorted grid. A tombstone rather than a deletion:
  // `BaseSchema` is `.passthrough()`, so an undeclared key is KEPT unexamined,
  // not refused.
  defaultSort: retirementTombstone(
    'RETIRED (objectui#5861, ADR-0049) — `defaultSort` was the legacy single-entry spelling of `sort`, '
    + 'and nothing reads it any more; the upstream protocol refuses it by name on `object-grid`. '
    + 'Rename the key to `sort` and wrap the value in an array: `sort: [{ field, order }]`.',
  ),
  // The `object-grid` row's own `defaultFilters` member BY REFERENCE. Since
  // `@objectstack/spec` 18 it is a retired-key tombstone (objectstack#11509) that
  // refuses every value by name, so this mirror and the `object-view` `table`
  // slot built from it refuse it too, and neither `ObjectGrid` nor `ObjectView`
  // reads it (objectui#12030; see the TS twin's member). Through 17.x it was the
  // SAME `ViewFilterRule` array as `filter` above (objectui#6152 round 10).
  defaultFilters: stripImportedDefaults(SpecObjectGridPropsSchema).shape.defaultFilters,
  // objectui#6152 round 7 — RETIRED under ADR-0049, in lockstep with the `?: never`
  // twin on the interface. `@objectstack/spec` 17.7.0 (objectstack#21445) refuses
  // this key BY NAME on `object-grid` (a retired-key tombstone in the row that
  // judges the authored `properties` bag), and `ObjectGrid` dropped its
  // `resizable ?? resizableColumns` fallback in the same change, so a declared
  // member here would parse green and draw nothing. A tombstone rather than a
  // deletion, as for `defaultSort`: `BaseSchema` is `.passthrough()`, so an
  // undeclared key is KEPT unexamined, not refused. The `object-view` `table`
  // slot below keeps its own refusal of the key, which overrides this member
  // there, as it does for the five objectui#11068 retired.
  resizableColumns: retirementTombstone(OBJECT_GRID_RESIZABLE_COLUMNS_RETIRED),
  // The legacy caption/export-title fallback — `ObjectGrid.tsx` draws it at
  // exactly two sites, the export file name's `viewLabel` and the table
  // `caption`, each resolving `label` first and this key only when `label`
  // resolves to nothing — and the interface has declared it `@deprecated` all
  // along. Mirrored under objectui#6639's census-directed ruling (2026-08-29,
  // declare branch: authored `object-grid.title` nodes exist, so the key is
  // declared rather than the read retired). Typed, not `z.any()` — serializable
  // metadata, the #6424 family form: the gain is the typed refusal, since the
  // `.passthrough()` base was already admitting ANY `title` unexamined.
  // objectui#10993 (batch 4): the type is the spec's `I18nLabelSchema` BY
  // REFERENCE, the row's own type for this key, so the inline locale map both
  // read sites resolve since batch 3 parses; a number, or a map entry that is
  // not a string, is still refused at the key. Was `z.string()`, which refused
  // the map the contract accepts.
  title: stripImportedDefaults(SpecI18nLabelSchema).optional().describe('DEPRECATED, write label instead: legacy caption/export-file-title fallback, read only when label resolves to nothing. @objectstack/spec I18nLabel, a plain string or an inline locale map'),
  // ⭐ objectui#9739 (maintainer ruling 2026-09-18, letter C) — the mirror stops
  // accepting a key the upstream protocol refuses BY NAME, and says so.
  //
  // What this key was: a scan artefact. The line it replaces carried its own
  // provenance in a trailing comment — "Missing in previous TS scan but common"
  // — so the gap was noticed at authoring time, written down, and then measured
  // by nothing. objectui#9729 measured it four ways and every one read zero: no
  // render path consumes it (a byte ruler drew the same `object-grid` document
  // twice, with the filter surface off AND on, and the bytes were identical —
  // `ObjectGrid.operatorsInert-9729.test.tsx`, lit control included), no doc or
  // example in this repo writes it, the block's author vocabulary never listed
  // it, and `@objectstack/spec` refuses it.
  //
  // Why `operations` is the remedy named here, and not a guess: the pinned
  // upstream (`@objectstack/spec` 17.4.0, `ObjectGridPropsSchema`) is a
  // `strictObject`, and parsing `{ objectName, operators }` through it returns
  // `unrecognized_keys` whose message prescribes the rename in the protocol's
  // own words — "Did you mean `operators` → `operations`?" — while the same
  // document spelled `operations` parses green. The twin `ObjectGridSchema`
  // interface declares `operations` too (the `{ create, update, delete, export }`
  // affordance toggles). ⇒ the correct spelling is MEASURED upstream, not
  // inherited from this comment; `object-grid-operators-tombstone-9739.test.ts`
  // re-derives both halves against the installed package.
  //
  // ⛔ NOT declared on the TypeScript twin — the ruling says so in as many
  // words. `ObjectGridSchema` extends `BaseSchema`, whose index signature
  // absorbed an authored `operators` as `any` until objectui#8347 (that face
  // now refuses it as an undeclared key); adding a `?: never` half would
  // write the misspelling INTO the published interface, which is the ruling's
  // letter A and was refused.
  operators: retirementTombstone(
    'RETIRED (objectui#9739, ADR-0049) — `operators` is not a key of this component; you meant `operations`. '
    + 'The upstream protocol refuses `operators` by name on `object-grid` and prescribes that rename itself; '
    + 'nothing in this renderer ever read the key, so an authored value parsed green and drew nothing. '
    + '`operations` is the affordance toggle object ({ create, update, delete, export }).',
  ),
  rowActions: z.array(z.string()).optional().describe(
    'Names of actions offered on each row\'s menu. `edit` and `delete` are canonical: they select the grid\'s generic Edit / Delete entries; '
    + 'any other name is a custom action resolved against the object\'s declared actions. '
    + '`operations` is the CEILING: `operations.update: false` (or `delete: false`), or a member a declared `operations` block does not name, '
    + 'withholds that generic entry whatever this list says. Inside that ceiling a declared list NARROWS: the generic Edit / Delete are offered '
    + 'only for the canonical names it carries, so `[]` or a list naming only custom actions offers neither. '
    + 'Omit `rowActions` to keep the default generic entries.',
  ),
  batchActions: z.array(z.string()).optional(),
  // objectui#11068 — RETIRED under ADR-0049, in lockstep with the `?: never`
  // twins on the interface. `rowSpecActions` / `bulkSpecActions` were second
  // spellings of `rowActions` / `bulkActions` that nothing ever read; `name` and
  // `placeholder` are `BaseSchema` members with no meaning on a grid (a grid is
  // neither a form field nor an input), and `ObjectGrid` never read either. A
  // tombstone rather than a deletion, as for `defaultSort`: `BaseSchema` is
  // `.passthrough()` (and declares `name` / `placeholder` itself), so without a
  // member here the key would be KEPT unexamined, not refused.
  //
  // `showFilters` followed on triage's retriage answer: the grid has no filter
  // UI, and the one filter surface objectui draws is the `list-view` toolbar's
  // builder (`userActions.filter`), so honouring the key here would have built a
  // second one. The upstream `object-grid` row does not declare it either. An
  // `object-view`'s or a `list-view`'s own `showFilters` is a different member,
  // read by its own renderer, and is untouched.
  rowSpecActions: retirementTombstone(OBJECT_GRID_ROW_SPEC_ACTIONS_RETIRED),
  bulkSpecActions: retirementTombstone(OBJECT_GRID_BULK_SPEC_ACTIONS_RETIRED),
  name: retirementTombstone(OBJECT_GRID_NAME_RETIRED),
  placeholder: retirementTombstone(OBJECT_GRID_PLACEHOLDER_RETIRED),
  showFilters: retirementTombstone(OBJECT_GRID_SHOW_FILTERS_RETIRED),
  // objectui#11068 — read by `ObjectGrid`, which draws it in place of an empty
  // table. objectui#11227 — the spec's `EmptyStateSchema` BY REFERENCE, ⛔ not a
  // second shape: the spec's `object-grid` row (17.6.0) declares this member as
  // that very schema, so the twin follows the spec. It is strict, so a misspelt
  // `description` / `text` for `message` is still named instead of drawing
  // nothing; `title` and `message` are `I18nLabel` (a plain string or an inline
  // locale map, which `ObjectGrid` resolves against the display locale), and
  // `icon` is a string. Mirrored by the interface's `SpecEmptyState`.
  emptyState: stripImportedDefaults(SpecEmptyStateSchema)
    .optional()
    .describe('What the grid draws instead of an empty table: `{ title, message, icon, link }`, the spec EmptyState by reference'),
  editable: z.boolean().optional(),
  keyboardNavigation: z.boolean().optional(),
  frozenColumns: z.number().optional(),
  // ⭐ objectui#6152 round 6 — ten members the TypeScript twin declared and this
  // mirror never did, each measured READ by `ObjectGrid` (a type-checker census of
  // the reads, and a runtime probe through the real registry that varied one key at
  // a time) and each a member of the spec's `ComponentPropsMap['object-grid']` row.
  // That row now judges the AUTHORED node's `properties` bag
  // (`ObjectGridBlockSchema` below, objectui#11276), where it types seven of the ten
  // as `unknown`; this mirror is the node `ObjectGrid` reads after the hoist and
  // the source of the `object-view` `table` slot, so each member takes the type the
  // twin declares. Where the twin takes a spec schema by name, the member is that
  // schema BY REFERENCE (`grouping`, `navigation`, `rowColor`, `rowHeight`) or the
  // row's own member (`reorderableColumns`, `singleClickEdit`), and
  // `conditionalFormatting` is the spec list view's own rule BY REFERENCE (the shared
  // `ConditionalFormattingRuleSchema` above, objectui#11533); the rest restate the
  // twin's local shapes, except `operations`, which round 8 moved onto the row's own
  // block with `read` / `import` retired (`ObjectGridOperationsSchema` above).
  // ⛔ `resizableColumns`, the eleventh, was never mirrored:
  // objectui#6152 round 7 RETIRED it (the tombstone above, beside `defaultFilters`).
  aggregations: z.array(ObjectGridAggregationSchema).optional().describe('Per-group aggregations drawn in each group header, e.g. [{ field: "amount", type: "sum" }]'),
  bulkActionDefs: z.array(ObjectGridBulkActionDefSchema).optional().describe('Rich bulk action definitions; each opens the bulk action dialog (params, confirm, progress) for the selected rows'),
  conditionalFormatting: z.array(ConditionalFormattingRuleSchema).optional().describe('Conditional formatting rules for row styling — `[{ condition, style }]`, the rules a list view declares: the first rule whose CEL `condition` holds applies its CSS `style` map to the row'),
  grouping: stripImportedDefaults(SpecGroupingConfigSchema).optional().describe('Row grouping: the spec GroupingConfig, by reference'),
  navigation: stripImportedDefaults(SpecNavigationConfigSchema).optional().describe('Row-click navigation: the spec NavigationConfig, by reference'),
  operations: ObjectGridOperationsSchema.optional().describe('Built-in operation toggles { create, update, delete, export }; a declared block replaces the default (`read` / `import` are retired, objectui#6152)'),
  reorderableColumns: stripImportedDefaults(SpecObjectGridPropsSchema).shape.reorderableColumns,
  rowColor: stripImportedDefaults(SpecRowColorConfigSchema).optional().describe('Row colour rules: the spec RowColorConfig, by reference'),
  rowHeight: stripImportedDefaults(SpecRowHeightSchema).optional().describe('Row height preset: the spec RowHeight, by reference'),
  singleClickEdit: stripImportedDefaults(SpecObjectGridPropsSchema).shape.singleClickEdit,
  // ⭐ `8d50bc2bf` — one key the REGISTERED `object-grid` renderer reads off
  // the authored document while this arm declared none. `BaseSchema` is
  // `.passthrough()`, so an undeclared key is NOT refused: it stops being
  // judged and the value is KEPT. `{ "type": "object-grid", "objectName": "a",
  // "onNavigate": { "action": "toast" } }` therefore parsed GREEN and that
  // action object was handed to `useNavigationOverlay`, which CALLS it as
  // `onNavigate(recordId, view)`.
  //
  // ⛔ Disposition MEASURED, not patterned. `'retired'` publishes "no renderer
  // reads this key" — FALSE here: `ObjectGrid` reads it (`onNavigate:
  // onNavigate ?? schema.onNavigate` into its `useNavigationOverlay` call —
  // the node key is the fallback behind the component prop, objectui#9547) and
  // `gridNonAuthorKeys.test.tsx` pins the read firing on a row click from a
  // SCHEMA-supplied function. So `'runtime-slot'`, and the channel is the one
  // the maintainer's 2026-08-19 ruling on objectui#5234 (option C) preserved on
  // purpose: the key stays DECLARED on `ObjectGridSchema` for programmatic
  // callers and stays OFF the authoring surface (`GRID_QUERY_INPUTS`).
  //
  // ⚠️ Measured and reported rather than smoothed: NO in-repo host builds an
  // `object-grid` node carrying this key today — the nine siblings the read
  // site's own comment names (`onRowClick`, `onRowSelect`, …) travel
  // `ObjectGridComponentProps` instead. The slot is nonetheless real and
  // exercised: the TypeScript face declares it, the renderer reads and runs it,
  // and the pin supplies it. What is absent is an in-repo SUPPLIER, not the
  // channel.
  //
  // ⭐ This arm and `@objectstack/spec` now say the same thing in two places:
  // `ComponentPropsMap['object-grid']` is a `strictObject` that already
  // rejected `onNavigate` by name (`unrecognized_keys`), while this mirror
  // accepted and KEPT it. The refusal message points at the node-type spelling.
  onNavigate: handlerKeyRefusal('onNavigate', 'runtime-slot', 'Record navigation handler'),
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(OBJECT_GRID_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_GRID_NEITHER_CHANNEL),
  // objectui#11117 — `objectName`'s requiredness, with the spec's binding waiver:
  // the shared refinement (`requireRecordSource`, beside `ObjectMapSchema`; a
  // hoisted function declaration) with this arm's one rung.
}).superRefine(...requireRecordSource('object-grid', ['objectName']));

/**
 * The prescription an author gets when a record id arrives as a number.
 *
 * ⚠️ Declared file-locally in each of the three mirrors that carry a record id
 * rather than shared from one module, and PINNED BY CONTENT — not by line — in
 * `../__tests__/authorable-record-id-string-9511.test.ts`, which asserts that
 * every one of the three refusals names the quoted form. So this text drifting
 * out of one mirror turns that pin red instead of going quiet.
 */
const RECORD_ID_IS_A_STRING_GUIDANCE =
  "A record id is a string on every boundary (objectui#9511): write it quoted \u2014 42 becomes '42'. "
  + 'A backend whose primary keys are numeric converts at its OWN adapter boundary, in one typed '
  + 'place, so every author, every caller and every adapter sees one shape.';

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `ObjectFormSchema`. */
const OBJECT_FORM_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-form',
  'its `any`-typed registration hands the node to `ObjectForm`, which reads it as `ObjectFormSchema` and assembles every `form` node it renders key by key, never copying either channel',
  'a form over `objectName` built from `fields` / `sections` / `customFields`, in the declared `mode` and `formType`',
);

/**
 * objectui#6152 round 1 — one entry of `ObjectFormSchema.sections`, restating the
 * local `ObjectFormSection` interface (`../objectql.ts`) member for member. Not
 * exported, so it is judged through the `sections` key of the registered
 * `ObjectFormSchema` pair rather than as a pair of its own.
 *
 * ⚠️ A `fields` entry is `z.any()`, the precedent this mirror already set for
 * `customFields`: the declared entry is `string | SpecFormFieldInput |
 * FormField` (the spec's form-view `{ field }` entry joined it in
 * objectui#11615), and
 * `FormFieldSchema` (`./form.zod.ts`) carries its own `KnownDrift` (`validation`)
 * and `UnmirroredDeclared` (`field`) rows, so binding it here would import that
 * drift into this pair. So every SECTION-level member is judged, and a field
 * entry is not judged on this key at all — stated here rather than implied by a
 * string arm that an `any` arm beside it would make decorative.
 */
const ObjectFormSectionEntrySchema = z.object({
  name: z.string().optional().describe('Section identifier'),
  label: z.string().optional().describe('Section label'),
  description: z.string().optional().describe('Section description'),
  collapsible: z.boolean().optional().describe('Whether the section can be collapsed (dropped on a wizard step)'),
  collapsed: z.boolean().optional().describe('Whether the section starts collapsed (dropped on a wizard step)'),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional().describe('Field columns in this section'),
  pane: z.enum(['primary', 'secondary']).optional().describe('Split-form panel this section renders in (split forms only)'),
  fields: z.array(z.any()).optional().describe('Field names or inline field configurations; the other way to declare members is `group`'),
  group: z.string().optional().describe('Key of a declared object field group whose members and presentation this section inherits'),
  visibleWhen: z
    .union([z.string(), z.object({ dialect: z.string().optional(), source: z.string() })])
    .optional()
    .describe('Predicate gating the whole section: a bare string or the { dialect?, source } envelope'),
});

/** objectui#6152 round 1 — one flat button toggle inside `ObjectFormSchema.buttons`. */
const ObjectFormButtonToggleSchema = z.object({
  show: z.boolean().optional().describe('Show this button'),
  label: z.string().optional().describe('Button label'),
});

/**
 * ObjectForm Schema — the zod mirror of the TypeScript `ObjectFormSchema`
 * (`../objectql.ts`): the `object-form` node as `ObjectForm` READS it, after
 * `SchemaRenderer` has hoisted the `properties` bag onto the node, and as code
 * composes it (`ObjectView`, `RecordFormPage`, `ScreenView`, the plugin-form
 * variants). The object-view `form` slot below is built from it.
 *
 * ⚠️ NOT an arm of `AnyComponentSchema` since objectui#10859 batch 4. An
 * AUTHORED `object-form` node takes its props in the spec's `properties` bag,
 * judged by `ObjectFormBlockSchema` below, which refuses each prop written
 * flat on the node by name and names its bag member. This mirror stays
 * published and paired with its TypeScript twin in the parity census, because
 * the twin stays the renderer's reading; it no longer answers for authored
 * documents.
 */
export const ObjectFormSchema = BaseSchema.extend({
  type: z.literal('object-form'),
  // objectui#11070 — the spec's per-element binding, by reference; see
  // `ObjectGridSchema.dataSource` above.
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  objectName: z.string().describe('ObjectQL object name'),
  mode: z.enum(['create', 'edit', 'view']).describe('Form mode'),
  recordId: z
    .string({ error: (issue) => (issue.code === 'invalid_type' ? RECORD_ID_IS_A_STRING_GUIDANCE : undefined) })
    .optional()
    .describe('Record ID \u2014 a string, never a number (objectui#9511)'),
  // `title`, `description`, `submitText`, `cancelText` and `successMessage` are
  // the spec's `I18nLabel` BY REFERENCE, as `ComponentPropsMap['object-form']`
  // declares them: a plain string or an inline per-locale map. `ObjectForm`
  // resolves all seven of the row's `I18nLabel` members with `pickLocalized`
  // against the active UI language, above its `formType` fork (objectui#10993).
  // This mirror used to narrow the five it declares to `z.string()`, refusing a
  // map the row and the renderer both accept. The row's other two, `nextText`
  // and `prevText`, stayed unmirrored until objectui#6152 round 1 declared them
  // below, by the same reference.
  title: stripImportedDefaults(SpecI18nLabelSchema).optional()
    .describe('Form title: the drawer and modal heading. @objectstack/spec I18nLabel, a plain string or an inline locale map'),
  description: stripImportedDefaults(SpecI18nLabelSchema).optional()
    .describe('Form description: the drawer and modal subtitle. @objectstack/spec I18nLabel, a plain string or an inline locale map'),
  fields: z.array(z.string()).optional().describe('Included fields'),
  customFields: z.array(z.any()).optional().describe('Custom field configs'),
  initialData: z.record(z.string(), z.any()).optional().describe('Initial data'),
  groups: z.array(z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    fields: z.array(z.string()),
    collapsible: z.boolean().optional(),
    defaultCollapsed: z.boolean().optional(),
  })).optional().describe('Field groups'),
  // objectui#11168 slice 3 (objectui#7759 group C): the row's own enum, by
  // reference — `inline` and `grid` are retired by `@objectstack/spec` 17.5.0
  // (objectstack#20221) and rendered byte-identical to `vertical` on every
  // layout, so this face refuses them as the authored bag already did.
  layout: stripImportedDefaults(SpecObjectFormPropsSchema).shape.layout
    .describe('Label placement: vertical (the default) or horizontal — the spec row\'s enum, by reference'),
  columns: z.number().optional().describe('Number of columns the fields are laid out in (1-4)'),
  showSubmit: z.boolean().optional().describe('Show submit button'),
  submitText: stripImportedDefaults(SpecI18nLabelSchema).optional()
    .describe('Submit button text. @objectstack/spec I18nLabel, a plain string or an inline locale map'),
  successMessage: stripImportedDefaults(SpecI18nLabelSchema).optional()
    .describe('Success toast text after create/update when no onSuccess handler is given. @objectstack/spec I18nLabel, a plain string or an inline locale map'),
  navigateOnSuccess: z.string().optional().describe('DEPRECATED, write submitBehavior instead: navigate here after success (relative path only; {id}/{recordId} interpolated and URL-escaped); precedes the toast'),
  resetOnSuccess: z.boolean().optional().describe('Reset the form after a successful create for another entry'),
  submitBehavior: z.union([
    z.object({ kind: z.literal('thank-you'), title: z.string().optional(), message: z.string().optional() }),
    z.object({ kind: z.literal('redirect'), url: z.string(), delayMs: z.number().optional() }),
    z.object({ kind: z.literal('continue') }),
    z.object({ kind: z.literal('next-record') }),
  ]).optional().describe('Declarative post-submit behavior; takes precedence over successMessage/navigateOnSuccess/resetOnSuccess'),
  showCancel: z.boolean().optional().describe('Show cancel button'),
  cancelText: stripImportedDefaults(SpecI18nLabelSchema).optional()
    .describe('Cancel button text. @objectstack/spec I18nLabel, a plain string or an inline locale map'),
  showReset: z.boolean().optional().describe('Show reset button'),
  initialValues: z.record(z.string(), z.any()).optional().describe('Initial values'),
  readOnly: z.boolean().optional().describe('Read-only mode'),
  // ⭐ objectui#6152 round 1 — members the TypeScript twin declared and this
  // mirror had never heard of, so the strict authoring face refused each one
  // although `tsc` invited it (objectui#5250's M3 class (iii)). Every one below
  // is READ by a shipped renderer: `ObjectForm` (`plugin-form`) reads the variant
  // keys off its schema (`schema.formType`, `schema.sections`,
  // `schema.defaultTab`, `schema.showStepIndicator`, `schema.drawerSide`, …), and
  // `buttons` / `defaults` / `subforms` through casts in the same file
  // (`foldFormButtons`, `(schema as any).subforms`) after `ObjectView`,
  // `RecordFormPage` and `ScreenView` relay them from an object's form view. So
  // each is DECLARED here, shaped as the twin declares it; `nextText` /
  // `prevText` are the spec's `I18nLabel` by reference because the twin takes
  // that type from the spec. `buttons`, `defaults` and `subforms` are members of
  // the spec's `FormViewSchema` and not of its `ComponentPropsMap['object-form']`;
  // every other key below is a member of `ComponentPropsMap['object-form']`.
  //
  // ⛔ Two keys of the same ledger entry are NOT here, on purpose:
  // `submitHandler` (a function slot — objectui#6182 rules the handler-string
  // dialect out, so it is never mirrored as a string) and `open` (a boolean that
  // only in-code hosts write). Their routes are open on objectui#6152, and the
  // pair's `UnmirroredDeclared` entry keeps both.
  formType: z.enum(['simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal']).optional()
    .describe('Form variant: simple (default), tabbed, wizard, split, drawer or modal'),
  sections: z.array(ObjectFormSectionEntrySchema).optional()
    .describe('Form sections: tabs of a tabbed form, steps of a wizard (array order is step order), groups of a simple form'),
  defaultTab: z.string().optional().describe('Initially active tab (section name); tabbed forms only'),
  tabPosition: z.enum(['top', 'bottom', 'left', 'right']).optional().describe('Tab strip position; tabbed forms only'),
  allowSkip: z.boolean().optional().describe('Let the user enter any wizard step (navigation freedom, not a validation exemption); wizard forms only'),
  showStepIndicator: z.boolean().optional().describe('Show the wizard step indicator; wizard forms only'),
  nextText: stripImportedDefaults(SpecI18nLabelSchema).optional()
    .describe('Next-step button label; wizard forms only. @objectstack/spec I18nLabel, a plain string or an inline locale map'),
  prevText: stripImportedDefaults(SpecI18nLabelSchema).optional()
    .describe('Previous-step button label; wizard forms only. @objectstack/spec I18nLabel, a plain string or an inline locale map'),
  splitDirection: z.enum(['horizontal', 'vertical']).optional().describe('Split panel direction; split forms only'),
  splitSize: z.number().optional().describe('Size of the first panel as a percentage; split forms only'),
  splitResizable: z.boolean().optional().describe('Whether the split panels can be resized; split forms only'),
  drawerSide: z.enum(['top', 'bottom', 'left', 'right']).optional().describe('Drawer slide-in side; drawer forms only'),
  drawerWidth: z.string().optional().describe('Drawer width as a CSS value; drawer forms only'),
  modalSize: z.enum(['sm', 'default', 'lg', 'xl', 'full']).optional().describe('Modal dialog size; modal forms only'),
  modalCloseButton: z.boolean().optional().describe('Show the modal header close button; modal forms only'),
  mobile: z.object({
    stickyActions: z.boolean().optional().describe('Pin Submit/Cancel to the bottom of the viewport on mobile'),
    stepper: z.union([z.boolean(), z.literal('auto')]).optional().describe('One-field-at-a-time stepper on small screens: true, false or auto'),
    stepperMinFields: z.number().optional().describe('Field-count threshold for stepper auto'),
    stepperFieldsPerStep: z.number().optional().describe('Fields shown per stepper step'),
    fullscreenLongText: z.boolean().optional().describe('Offer a fullscreen editor for textarea and rich-text fields'),
  }).optional().describe('Mobile-only form behaviour; every option is opt-in'),
  buttons: z.object({
    submit: ObjectFormButtonToggleSchema.optional(),
    cancel: ObjectFormButtonToggleSchema.optional(),
    reset: ObjectFormButtonToggleSchema.optional(),
  }).optional().describe('Structured submit/cancel/reset visibility and labels; folded onto the flat keys, which win when set'),
  defaults: z.record(z.string(), z.any()).optional()
    .describe('Create-mode initial values keyed by field name; folded into initialValues, which wins when set'),
  subforms: z.array(z.object({
    childObject: z.string().describe('Child object name'),
    relationshipField: z.string().optional().describe('Foreign-key field on the child (derived from metadata when omitted)'),
    // objectui#11266 — each column is the spec's `InlineGridColumnSchema`, by
    // reference: the schema `@objectstack/spec` 17.6.0 holds
    // `FormViewSchema.subforms[].columns` to, so `objectui validate` and
    // `os validate` give one verdict on a column. It refuses an undeclared key
    // by name, and a `scale` on a column that DECLARES `type: 'currency'`.
    // ⛔ It cannot see a `scale` on an identity-only column (`{ name, scale }`)
    // whose child field is a currency: that takes the child object's fields,
    // which are not in the document judged here. `defineStack` refuses it at
    // publish, and `plugin-form`'s `hydrateColumns` reports it at render.
    columns: z.array(stripImportedDefaults(SpecInlineGridColumnSchema)).optional()
      .describe('Grid columns for the child rows (derived from metadata when omitted). @objectstack/spec InlineGridColumn, by reference'),
    amountField: z.string().optional(),
    totalField: z.string().optional(),
    title: z.string().optional(),
    addLabel: z.string().optional(),
    minRows: z.number().optional(),
    maxRows: z.number().optional(),
  })).optional().describe('Inline child collections: renders a master-detail form persisted in one transaction'),
  // ⭐ `8d50bc2bf` — five keys the REGISTERED `object-form` renderer reads off
  // the authored document while this arm declared none of them. `BaseSchema` is
  // `.passthrough()`, so an undeclared key is NOT refused: it stops being
  // judged and the value is KEPT. `{ "type": "object-form", "objectName": "a",
  // "mode": "create", "onSuccess": { "action": "toast" } }` therefore parsed
  // GREEN and that action object was forwarded onto the child node whose
  // renderer CALLS it.
  //
  // ⛔ The disposition is MEASURED PER KEY, never applied as a pattern.
  // `'retired'` publishes "no renderer reads this key, so nothing could ever
  // run it" — FALSE for all five: `plugin-form`'s `ObjectForm` reads every one
  // off `schema.*` and forwards it into the variant it renders. So each is a
  // `'runtime-slot'`, and each was carried by finding the path a host actually
  // supplies it through — the `object-form` NODE a host builds in TypeScript,
  // `ObjectFormComponentProps` declaring only `schema` / `dataSource` /
  // `className`:
  //
  //   - `onSuccess`     forwarded as `onSuccess: schema.onSuccess`; supplied by
  //                     `AppContent`, `RecordFormPage`, `ScreenView`,
  //                     `FlowRunner` and `useActionModal` (`@object-ui/app-shell`),
  //                     `ObjectManager` / `FieldDesigner` (`@object-ui/plugin-designer`),
  //                     `MasterDetailForm` and `EmbeddableForm` (`@object-ui/plugin-form`),
  //                     and `plugin-view`'s `ObjectView`.
  //   - `onCancel`      the same builders, one line below their `onSuccess`.
  //   - `onOpenChange`  the MODAL/DRAWER arm's open-state slot; supplied by
  //                     `AppContent` (`if (!open) closeRecordForm()`) and by
  //                     `ObjectManager` / `FieldDesigner` (`handleFormClose`).
  //   - `onError`       supplied by `MasterDetailForm`, beside its `onSuccess`.
  //   - `onStepChange`  ⚠️ a DIFFERENT reading from its four siblings, and the
  //                     reason four of them are not evidence for the fifth: NO
  //                     in-repo host supplies this key. `ObjectForm` forwards it
  //                     onto the wizard node (`onStepChange: schema.onStepChange`)
  //                     and `WizardForm` CALLS it (`schema.onStepChange(step)`),
  //                     so the channel is wired end to end and a host that fills
  //                     it is run — what is absent is an in-repo supplier, not
  //                     the channel. `'retired'` would still be false: the read
  //                     and the call are both there.
  onCancel: handlerKeyRefusal('onCancel', 'runtime-slot', 'Cancel handler'),
  onError: handlerKeyRefusal('onError', 'runtime-slot', 'Submit error handler'),
  onOpenChange: handlerKeyRefusal('onOpenChange', 'runtime-slot', 'Modal/drawer open-state handler'),
  onStepChange: handlerKeyRefusal('onStepChange', 'runtime-slot', 'Wizard step change handler'),
  onSuccess: handlerKeyRefusal('onSuccess', 'runtime-slot', 'Submit success handler'),
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(OBJECT_FORM_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_FORM_NEITHER_CHANNEL),
});

/**
 * objectui#10976 — the `ObjectGridSchema` members an `object-view`'s `table`
 * slot WITHHOLDS, each refused BY NAME inside the slot.
 *
 * The slot relays to the grid only what `ObjectView` hands it (the keys it
 * reads off `table` by name, and `OBJECT_VIEW_TABLE_RELAY_KEYS` in
 * `@object-ui/plugin-view`). Every other grid member used to be declared here
 * too — the slot was `ObjectGridSchema` minus `type` and `objectName` — so a
 * document writing `table: { emptyState: … }` parsed green and drew nothing.
 * The TypeScript twin (`ObjectGridSlotKey` in `../objectql.ts`) withholds the
 * same set; `object-view-slot-key-lists.test.ts` holds the two to one list.
 *
 * ⛔ A tombstone, not an `.omit()`: `BaseSchema` is `.passthrough()`, so an
 * omitted key would be KEPT unexamined, and the slot would accept silently
 * what the TypeScript face refuses. Three of the tombstones `ObjectGridSchema`
 * itself declares (`body`, `children`, `defaultSort`) are inherited unchanged;
 * the five it retired later (`name`, `placeholder`, `rowSpecActions`,
 * `bulkSpecActions`, `showFilters`, objectui#11068) are overridden below by this
 * slot's own refusal, and so is `resizableColumns`, which the slot withheld as
 * a legacy alias before objectui#6152 round 7 retired it on the grid itself.
 */
const tableKeyRefusal = (key: string, why: string) =>
  retirementTombstone(
    `NOT A TABLE KEY (objectui#10976) — \`table.${key}\` is not one of the grid keys an object-view `
    + `hands the grid it draws, so it reached nothing: ${why}`,
  );
const TABLE_KEY_UNREAD = '`ObjectGrid` has no read of it.';
// objectui#11068 — `ObjectGrid` honours these on its own node, and the view does
// not hand them on: that card enforced them without widening this slot
// (`description` and `emptyState` first, `keyboardNavigation` with its build).
const TABLE_KEY_NOT_RELAYED =
  '`ObjectGrid` honours it on an `object-grid` node, but the view does not hand it to the grid it draws.';
const TABLE_KEY_RECORD_SOURCE =
  'the view\'s grid lists the records of the view\'s own `objectName`, and `table` does not re-point that record source.';
const TABLE_KEY_ROW_CLICK =
  'the view hands its grid its own row-click handler, which the grid obeys first. '
  + 'Write `navigation` / `onNavigate` on the object-view node itself.';
const TABLE_KEY_NODE_LEVEL =
  'the view draws its grid as a component, not as a schema node, so no renderer applies a node-level key to it. '
  + 'A node-level key belongs on the object-view node itself.';

const OBJECT_VIEW_TABLE_WITHHELD = {
  ariaLabel: tableKeyRefusal('ariaLabel', TABLE_KEY_NODE_LEVEL),
  batchActions: tableKeyRefusal('batchActions', 'it is the legacy alias of `bulkActions`. Write `bulkActions`.'),
  bind: tableKeyRefusal('bind', TABLE_KEY_RECORD_SOURCE),
  bulkSpecActions: tableKeyRefusal('bulkSpecActions', `${TABLE_KEY_UNREAD} Write \`bulkActions\`.`),
  data: tableKeyRefusal('data', TABLE_KEY_RECORD_SOURCE),
  // objectui#11070 declared the per-element binding on `ObjectGridSchema`; on
  // the view's grid it is one more record source the view owns.
  dataSource: tableKeyRefusal('dataSource', TABLE_KEY_RECORD_SOURCE),
  description: tableKeyRefusal('description', `${TABLE_KEY_NOT_RELAYED} Write \`description\` on the object-view node itself.`),
  disabled: tableKeyRefusal('disabled', TABLE_KEY_NODE_LEVEL),
  disabledOn: tableKeyRefusal('disabledOn', TABLE_KEY_NODE_LEVEL),
  emptyState: tableKeyRefusal('emptyState', TABLE_KEY_NOT_RELAYED),
  hidden: tableKeyRefusal('hidden', TABLE_KEY_NODE_LEVEL),
  hiddenOn: tableKeyRefusal('hiddenOn', TABLE_KEY_NODE_LEVEL),
  id: tableKeyRefusal('id', 'the view fixes its grid\'s identity, as it fixes `type` and `objectName`.'),
  keyboardNavigation: tableKeyRefusal('keyboardNavigation', TABLE_KEY_NOT_RELAYED),
  name: tableKeyRefusal('name', TABLE_KEY_UNREAD),
  navigation: tableKeyRefusal('navigation', TABLE_KEY_ROW_CLICK),
  onNavigate: tableKeyRefusal('onNavigate', TABLE_KEY_ROW_CLICK),
  placeholder: tableKeyRefusal('placeholder', TABLE_KEY_UNREAD),
  resizableColumns: tableKeyRefusal('resizableColumns', 'it is the legacy alias of `resizable`. Write `resizable`.'),
  // objectui#10872 batch 9 declared the node-level `responsiveStyles` on
  // `ObjectGridSchema`; the view draws its grid as a component, so nothing
  // compiles it inside `table`. Without this row the slot would have gained it.
  // Its own reason, not `TABLE_KEY_NODE_LEVEL`: that one sends the key to the
  // object-view node, whose arm does not declare `responsiveStyles`, so the
  // strict face would refuse it there too.
  responsiveStyles: tableKeyRefusal(
    'responsiveStyles',
    'the view draws its grid as a component, not as a schema node, so nothing compiles a `responsiveStyles` map '
    + 'written here. Delete it.',
  ),
  rowSpecActions: tableKeyRefusal('rowSpecActions', `${TABLE_KEY_UNREAD} Write \`rowActions\`.`),
  showFilters: tableKeyRefusal('showFilters', TABLE_KEY_UNREAD),
  staticData: tableKeyRefusal('staticData', TABLE_KEY_RECORD_SOURCE),
  style: tableKeyRefusal('style', TABLE_KEY_NODE_LEVEL),
  testId: tableKeyRefusal('testId', TABLE_KEY_NODE_LEVEL),
  visible: tableKeyRefusal('visible', TABLE_KEY_NODE_LEVEL),
  visibleOn: tableKeyRefusal('visibleOn', TABLE_KEY_NODE_LEVEL),
  visibleWhen: tableKeyRefusal('visibleWhen', TABLE_KEY_NODE_LEVEL),
};

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `ObjectViewSchema`. */
const OBJECT_VIEW_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-view',
  'its `any`-typed registration hands the node to `ObjectView`, which reads it as `ObjectViewSchema` and delegates each sub-view to an `object-*` node it assembles key by key, every one of which reads neither channel',
  'the object’s views — `listViews`, `defaultViewType`, `table`, `form` — under its own toolbar',
);

/**
 * ObjectView Schema
 *
 * Ten keys the `ObjectViewSchema` interface (`../objectql.ts`) declared and this
 * mirror never did — objectui#7279's `UnmirroredDeclared` reading — were closed
 * nine-for-ten by objectui#7779 under the maintainer's ruling B (2026-09-06:
 * liveness first, then mirror-or-retire per key). Every reading below was taken
 * on the `object-view` NODE renderer, `packages/plugin-view/src/ObjectView.tsx`
 * (registered by `plugin-view/src/index.tsx`), with `schema.objectName` /
 * `schema.layout` as the positive controls of the same `schema.KEY` query:
 *
 *   - `navigation`, `searchableFields`, `filterableFields` — the spec models
 *     all three on `ListViewSchema` (`@objectstack/spec/ui`), so they are the
 *     spec's own slots BY REFERENCE (`SpecListViewSchema.shape.*`), never a
 *     local restatement: the declaration already imports the spec's
 *     `NavigationConfig` for `ViewNavigationConfig`, and a literal restating it
 *     is the drift this repo keeps paying for (objectui#4588). The pin asserts
 *     identity against the spec schema, so a spec-side change moves them.
 *     `filterableFields` is read no longer (objectui#13118: the spec retires
 *     it); its slot stays by reference, on both faces, so the spec's
 *     tombstone arrives with the pin bump.
 *   - `allowCreateView`, `viewActions` — READ: the renderer forwards both
 *     verbatim into the `view-switcher` node it composes
 *     (`allowCreateView: schema.allowCreateView`, `viewActions: schema.viewActions`,
 *     then `ViewSwitcher.tsx` reads `schema.allowCreateView` / `schema.viewActions`),
 *     so they are that sibling mirror's slots by reference
 *     (`ViewSwitcherSchema.shape.*`, `./views.zod.ts`) — one shape, two nodes.
 *   - `defaultViewType` (READ: `schema.defaultViewType || 'grid'`),
 *     `defaultListView` (READ: `namedListViews?.[schema.defaultListView]`),
 *     `showViewSwitcher` (READ: `schema.showViewSwitcher === true`) — local
 *     literals matching the declaration. `defaultViewType` is the declaration's
 *     SEVEN-value union on purpose, not the spec's view-kind enum: `chart` and
 *     `tree` are host-composition-only on this node (objectui#5321) and the
 *     `NamedListView.type` twin spells the same seven.
 *   - `viewTabBar` — RETIRED (`retirementTombstone()` below; `?: never` on the
 *     TS face). ZERO reads of the key on the node: the tab-bar UX config
 *     (`ViewTabBarConfig`, still exported) is the `config` PROP of the
 *     `ViewTabBar` component, composed by the host (`@object-ui/app-shell`),
 *     and `plugin-view`'s own `ObjectView` never renders that bar (ADR-0053:
 *     the host owns the switcher). The 2026-07 audit
 *     (`docs/audits/2026-07-objectview-detailview-schema.md`) had already
 *     measured it dead since introduction.
 *   - `listViews` — MIRRORED BY REFERENCE (objectui#7928): the spec's own
 *     `ViewSchema.shape.listViews`, a record of the STRICT
 *     `ObjectListViewSchema`. It was the tenth key, left in the parity ledger
 *     on ruling B's fallback clause because neither value type could be
 *     mirrored without a loss; the maintainer's ruling A (objectui#7928,
 *     comment 5565628927, 「同意」) chose the spec value, staged behind two
 *     cards that removed both losses first: objectui#8254 made the renderer
 *     honour a spec-shaped named view, and objectui#8255 made every document
 *     teach one. ⇒ a named view now needs `columns`, takes `filter` as
 *     `{ field, operator, value }` rules, and is refused `unrecognized_keys`
 *     for any key the protocol does not declare there.
 *
 *     ⚠️ `options` — the one key the renderer still read that the protocol
 *     does not declare on this shape — is REFUSED with the rest (director
 *     ruling, objectui#7928 comment 5856694523, Q1 A). The legacy per-kind bag
 *     stays legal where the protocol declares it, a STORED list overlay
 *     (objectstack#20051), and is folded onto the top-level kind block at the
 *     one door that relays a stored body into this record,
 *     `@object-ui/app-shell`'s `ViewPreview`. `plugin-view` no longer reads
 *     `options` off a named view. ⛔ Never re-admit it here: the canonical
 *     `KIND` block is the only spelling this surface teaches.
 */
export const ObjectViewSchema = BaseSchema.extend({
  type: z.literal('object-view'),
  objectName: z.string().describe('ObjectQL object name'),
  title: z.string().optional().describe('View title'),
  description: z.string().optional().describe('View description'),
  layout: z.enum(['drawer', 'modal', 'page']).optional().describe('Layout mode'),
  defaultViewType: z.enum(['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'map']).optional().describe('Default list view type (grid unless a named view sets its own type)'),
  defaultListView: z.string().optional().describe('Key of the listViews entry shown first'),
  // Spec slot by reference (objectui#7928) — `z.record(z.string(),
  // ObjectListViewSchema).optional()`, the container's own named-view record.
  // The value type, and why `options` is refused, are in the docblock above.
  listViews: stripImportedDefaults(SpecViewSchema).shape.listViews,
  // Spec slot by reference (objectui#7779) — `NavigationConfigSchema.optional()`,
  // the same object `ListViewSchema` derives its `navigation` from.
  navigation: stripImportedDefaults(SpecListViewSchema).shape.navigation,
  // objectui#10976 — the grid keys `ObjectView` hands its grid; every other
  // grid member is refused by name (`OBJECT_VIEW_TABLE_WITHHELD` above).
  table: z
    // Rebuilt from the grid's `.shape` onto `BaseSchema` rather than `.omit()`ed off
    // `ObjectGridSchema` itself: zod 4 refuses `.omit()` on an object carrying a
    // refinement, and the grid carries its record-source one since objectui#11117.
    // Same shape, same `.passthrough()`, and none of the grid's checks — the slot
    // omits `objectName` anyway, because the view supplies it.
    .lazy(() => BaseSchema.extend(ObjectGridSchema.shape).omit({ type: true, objectName: true }).extend(OBJECT_VIEW_TABLE_WITHHELD).partial())
    .optional()
    .describe('Table config'),
  form: z.lazy(() => ObjectFormSchema.omit({ type: true, objectName: true, mode: true }).partial()).optional().describe('Form config'),
  // Spec slots by reference (objectui#7779) — `array(string).optional()` on
  // both; the spec's own description marks `filterableFields` a legacy
  // shorthand for `userFilters.fields`. ⚠️ `filterableFields` is read by nothing
  // since objectui#13118: `@objectstack/spec` 18 retires it (objectstack#24640,
  // ruling C). This reference stays, because it is what carries the spec's own
  // `retiredKey()` tombstone in on the pin bump that takes the retirement; the
  // TypeScript face reads the same slot by reference, so both faces flip there.
  searchableFields: stripImportedDefaults(SpecListViewSchema).shape.searchableFields,
  filterableFields: stripImportedDefaults(SpecListViewSchema).shape.filterableFields,
  showSearch: z.boolean().optional().describe('Show search'),
  showFilters: z.boolean().optional().describe('Show filters'),
  showSort: z.boolean().optional().describe('Show sort controls'),
  showCreate: z.boolean().optional().describe('Show create button'),
  showRefresh: z.boolean().optional().describe('Show refresh button'),
  showViewSwitcher: z.boolean().optional().describe('Show the view-type switcher toggle (hidden unless true)'),
  operations: z.object({
    create: z.boolean().optional(),
    read: z.boolean().optional(),
    update: z.boolean().optional(),
    delete: z.boolean().optional(),
  }).optional().describe('Enabled operations'),
  viewTabBar: retirementTombstone(
    'RETIRED (objectui#7779) — `viewTabBar` was never read off the object-view node: the tab-bar UX config ' +
    '(`ViewTabBarConfig`) is the `config` PROP of the `ViewTabBar` component, composed by the host ' +
    '(`@object-ui/app-shell`), not authored metadata (ADR-0053: the host owns the switcher). Remove the key.',
  ),
  // Sibling slots by reference (objectui#7779): the renderer forwards both
  // verbatim into the `view-switcher` node it composes.
  allowCreateView: ViewSwitcherSchema.shape.allowCreateView,
  viewActions: ViewSwitcherSchema.shape.viewActions,
  // ⭐ `8d50bc2bf` — one key the REGISTERED `object-view` renderer reads off
  // the authored document while this arm declared none. `BaseSchema` is
  // `.passthrough()`, so an undeclared key is NOT refused: it stops being
  // judged and the value is KEPT, then reaches four call sites in
  // `plugin-view`'s `ObjectView` that INVOKE it —
  // `schema.onNavigate('new', 'edit')` on create, and the record id with
  // `'edit'` / `'view'` on the other three.
  //
  // ⛔ Disposition MEASURED. `'retired'` publishes "no renderer reads this key"
  // — FALSE against four live reads. `'runtime-slot'`, and the supplier is
  // named: `@object-ui/app-shell`'s `ObjectView` builds the `object-view` node
  // in TypeScript and puts `onNavigate: (recordId, mode) => …` on it, the same
  // two-parameter shape the declaration carries. The value travels the node,
  // which is the TypeScript face, never `safeParse`.
  //
  // ⚠️ Same key NAME as `ObjectGridSchema.onNavigate` above, a DIFFERENT
  // signature (`mode: 'view' | 'edit'` rather than the grid's
  // `action: RecordNavigateAction`, objectui#9547) and a different supplier.
  // Judged separately for that reason.
  onNavigate: handlerKeyRefusal('onNavigate', 'runtime-slot', 'Record navigation handler'),
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(OBJECT_VIEW_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_VIEW_NEITHER_CHANNEL),
});
// objectui#8355 / objectui#10321's named-view pointers were retired here (objectui#11073):
// the protocol's refusal inside a named view is terminal since `@objectstack/spec` 17.5.0,
// so they could no longer run. See the RETIRED note below `CalendarNodeDateAliasRefusals`.

/**
 * User Filters — field-level filter option
 */
const UserFilterOptionSchema = z.object({
  label: z.string().describe('Option display label'),
  value: z.union([z.string(), z.number(), z.boolean()]).describe('Option value'),
  color: z.string().optional().describe('Option badge color'),
});

/**
 * User Filters — field-level filter definition, DERIVED from the spec's
 * `UserFilterFieldSchema` (objectui#7265, the `@object-ui/types` slice).
 *
 * This was a hand-written copy under the spec's own export name — the fork
 * class `check:spec-symbols` exists to stop, and the reason the name sat in
 * that gate's ledger. `field`, `type`, `showCount` and `defaultValues` now
 * flow in from `@objectstack/spec/ui` by reference, so the day the protocol
 * grows a key or a control type this mirror tracks it instead of drifting.
 *
 * Measured against the RESOLVED pin, `@objectstack/spec@17.4.0` — byte-identical
 * is a statement about a version, not a property: the two shapes already agreed
 * on all four of those members, the `type` enum included (the same five control
 * types). So the derivation is not a change of behaviour, it is the same shape
 * with provenance.
 *
 * TWO divergences are kept, each confined to the member that carries it:
 *
 *   1. `label` stays a plain string. The spec widened it to an i18n union
 *      (`string | I18nLabel`), and this key is rendered as a React CHILD by
 *      `@object-ui/plugin-list`'s `UserFilters` — the filter badge reads
 *      `f.label || f.field` straight into JSX. A record arriving there is not
 *      a label in another language, it is "Objects are not valid as a React
 *      child". Localisation on this surface goes through that component's own
 *      resolver (`i18n.fieldLabel`), not through an authored record.
 *   2. `options[]` keeps this package's {@link UserFilterOptionSchema}, for the
 *      same reason on its own `label` (`opt.label` is rendered the same way).
 *
 * `.strip()` restores this lane's posture. The spec's shape is `.strict()`, and
 * inheriting that here would turn a key an author writes today into a 422
 * instead of a silent strip — a protocol decision about the userFilters
 * surface, not a side effect a derivation may make on its own. Left as it was,
 * deliberately: see the note on {@link UserFiltersSchema}.
 *
 * Both divergences and the derivation itself are pinned by
 * `../__tests__/spec-symbol-parity.test.ts`.
 */
const UserFilterFieldSchema = stripImportedDefaults(SpecUserFilterFieldSchema)
  .extend({
    label: z.string().optional().describe('Display label'),
    options: z.array(UserFilterOptionSchema).optional().describe('Static options'),
  })
  .strip();

/**
 * User Filters — tab preset rule: `{ field, operator, value }`, the same
 * predicate shape used by every other filter in the protocol.
 */
const UserFilterTabRuleSchema = z.object({
  field: z.string().describe('Field name to filter on'),
  operator: z.string().describe('Filter operator (equals, not_equals, contains, in, greater_than, less_than, …)'),
  value: z.any().optional().describe('Filter value'),
});

/**
 * User Filters — tab preset definition (tabs mode).
 *
 * Canonical shape: `{ name, label, icon?, filter, isDefault? }`. The legacy
 * `{ id, filters, default }` fields stay optional (normalized at runtime by
 * `normalizeTabPresets`) so older metadata keeps validating, but new authoring
 * — by AI or the Studio tabs editor — emits the canonical form.
 */
const UserFilterTabSchema = z
  .object({
    name: z.string().optional().describe('Unique tab identifier (snake_case)'),
    label: z.string().describe('Tab display label'),
    filter: z.array(UserFilterTabRuleSchema).optional().describe('Filter rules applied when this tab is active'),
    icon: z.string().optional().describe('Lucide icon name'),
    isDefault: z.boolean().optional().describe('Whether this tab is active by default'),

    /** @deprecated use `name` */
    id: z.string().optional().describe('@deprecated use name'),
    /** @deprecated use `filter` */
    filters: z.array(z.union([z.array(z.any()), z.string()])).optional().describe('@deprecated use filter'),
    /** @deprecated use `isDefault` */
    default: z.boolean().optional().describe('@deprecated use isDefault'),
  })
  .refine((t) => Boolean(t.name || t.id), { message: 'tab requires a name' });

/**
 * User Filters Configuration Schema (Airtable Interfaces-style).
 *
 * ⚠️ A DECLARED DIALECT of the spec's `UserFiltersSchema`, not a copy of it, and
 * not derivable from it (objectui#7265, the `@object-ui/types` slice). The
 * waiver and its reason live in `check:spec-symbols`' ALLOW map, where the gate
 * can fail if it ever stops excusing a real divergence; the three divergences
 * it excuses are measured against `@objectstack/spec@17.4.0` and are:
 *
 *   1. `element` is REQUIRED here and admits only `dropdown | tabs`. The spec
 *      defaults it to `dropdown` and keeps `toggle` in ITS enum so shipped
 *      configs keep rendering (ADR-0047 3.4a); ADR-0053 makes `toggle`
 *      unauthorable on this side — see the key's own note below.
 *   2. `tabs` carries THIS package's legacy preset dialect. The spec's slot is
 *      `ViewTabSchema`, which is `.strict()`, requires `name`, and therefore
 *      rejects the `{ id, filters, default }` documents this schema still
 *      accepts and `normalizeTabPresets` (`@object-ui/plugin-list`) still
 *      normalises at runtime. Binding the spec's slot would 422 metadata that
 *      renders today.
 *   3. The shape STRIPS unknown keys where the spec's is `.strict()`. Closing
 *      it is a protocol decision about this surface — the spec's own
 *      `UserFiltersSchema` header records what closing a shape costs when a key
 *      an author was right to write is not declared — and is deliberately not
 *      taken as a side effect of a burn-down.
 *
 * Pinned by `../__tests__/spec-symbol-parity.test.ts`, which asserts each
 * divergence in BOTH directions, so the waiver goes red rather than quiet on
 * the day the spec (or this package) closes the gap.
 */
const UserFiltersSchema = z.object({
  // AUTHORING contract (ADR-0053): `toggle` is deliberately not authorable —
  // new configs can only write dropdown/tabs. The RENDERER still honors
  // stored `toggle` metadata (spec ADR-0047 §3.4a keeps it in ITS enum "so
  // existing configs keep rendering") — see plugin-list `UserFilters`.
  element: z.enum(['dropdown', 'tabs']).describe('UI element type'),
  fields: z.array(UserFilterFieldSchema).optional().describe('Field-level filters'),
  tabs: z.array(UserFilterTabSchema).optional().describe('Named filter presets'),
  allowAddTab: z.boolean().optional().describe('Allow adding new tabs'),
  showAllRecords: z.boolean().optional().describe('Show All records tab'),
});

/**
 * ListView Schema — derived from `@objectstack/spec/ui` `ListViewSchema` (issue #2231).
 *
 * Spec-owned fields flow in **by reference** (see the `.extend()` on the declaration) so they auto-track
 * the protocol instead of being re-typed here; the drift-guard test
 * (`__tests__/list-view-spec-parity.test.ts`) fails if the spec grows a field objectui
 * has not triaged. objectui-only / legacy fields are declared locally on top via
 * `.extend()` (the final extend wins, so these override anything imported):
 *   - component envelope: `type: 'list-view'` discriminator + `objectName` binding;
 *   - legacy vocabulary kept for back-compat: `viewType` (renamed spec `type`),
 *     `fields`/`columns`, `filters`, the `show*` toolbar flags, `densityMode`, `color`, …;
 *   - configs whose objectui shape is intentionally broader than spec's (migration
 *     deferred): `userFilters`, `sharing`, `aria`
 *     (`exportOptions` left this list with objectui#6956 — it is the spec field by reference;
 *     `conditionalFormatting` left it with objectui#11533 — it is the spec list view's own
 *     `{ condition, style }` rule by reference, with the native dialect refused by name).
 *
 * The per-view-type configs (`kanban`/`calendar`/`gantt`/`gallery`/`timeline`) are no
 * longer forks: they derive from the spec configs below, keeping only `calendar.defaultView`
 * (no spec counterpart) and four deprecated aliases for the pre-#2231 vocabulary.
 *
 * Migrating the remaining legacy vocabulary to the spec-canonical keys (`type`/`columns`/
 * `filter`/`userActions`) is deferred — see #2231.
 *
 * ## The `ListView` component's props, not the authored page node (objectui#12670)
 *
 * This mirror is the node as the `ListView` component reads it — its `schema`
 * prop, as `ObjectView` and the app-shell list pages compose it, and as
 * `ListViewBlock` hands it over. It left `ObjectQLComponentSchema`, and so
 * `AnyComponentSchema`: the AUTHORED page `list-view` node is armed by
 * `ListViewBlockSchema`, whose `properties` bag is this mirror's own members
 * with the list kind as `type` and `objectName` / `viewType` refused by name
 * (ruling C on objectstack-ai/objectstack#22444). It stays exported, and its
 * TypeScript twin stays `ListViewInferred & ListViewRuntimeProps`.
 */
// Spec view-config keys objectui overrides locally: the component envelope
// (name/label/description → BaseSchema), the discriminator/renamed/relaxed keys
// (type/columns), and the configs redeclared below. EVERY other spec key flows
// in by reference at the declaration — see `SPEC_FIELDS` there.
const LIST_VIEW_LOCAL_OVERRIDES = [
  'type',
  'columns',
  'name',
  'label',
  'description',
  'userFilters',
  'userActions',
  'aria',
  'conditionalFormatting',
  'exportOptions',
  'kanban',
  'calendar',
  'gallery',
  'timeline',
] as const;

// ── Per-view-type configs: the list view's four blocks, BY REFERENCE ─────────
// (objectui#6152 round 11; the derivation itself dates from issue #2231.)
//
// `kanban`, `calendar`, `gallery` and `timeline` below are each the
// `@objectstack/spec` `ListViewSchema` slot of that name, unwrapped from its
// `optional`: the ROW's own member, as round 9 took the `object-calendar` row's
// container. The slot is a STRICT object, so an undeclared key is refused with
// the spec's own `unrecognized_keys` and the spec's own message. It is not the
// named `KanbanConfigSchema` / … object, but it holds the same member objects and
// the same error map, so the two give one verdict today; taking the ROW means a
// spec that ever gives the list view a block of its own is followed without an
// edit. ⛔ No member is hand-copied here, and ⛔ no block ends `.passthrough()`.
//
// What objectui adds is REFUSALS, each by name with the canonical remedy, and
// nothing that widens: the pre-#2231 aliases `kanban.groupField` /
// `kanban.cardFields` / `gallery.imageField` / `timeline.dateField`, the
// objectui-only `calendar.defaultView` (the spec has no such member on this
// block), and the three earlier arms (`kanban.groupBy`, objectui#8365;
// `calendar.dateField` / `endField`, objectui#8355). The spec slot refuses every
// one of them already; the arm keeps a message that names what to write instead.
// Since objectui#6152 round 12 the legacy `options` bag nests these same four
// blocks (`ListViewOptionsBag` below), so each arm gives one message in both
// nestings.
//
// `.partial()` stays on KANBAN and TIMELINE only, for a MEASURED reason: app-shell
// installs derived defaults on a `list-view` node's declared slots that leave out
// a member the spec requires. `defaultKanbanFromObject` gives `{ groupByField }`
// without `columns` (`InterfaceListPage`, `ObjectDataPage`), and
// `InterfaceListPage`'s timeline default reuses `defaultCalendarFromObject`, so it
// carries `startDateField` without `titleField`. Calendar takes the slot's
// required `startDateField` (no producer leaves it out), and the gallery slot
// requires nothing.
//
// ⚠️ THE READERS MOVED SECOND, in their own round (objectui#6152 round 14, on the
// census of round 13 and the seat's answer to it). Until then
// `normalizeListViewSchema` (`@object-ui/core`) folded the four aliases onto their
// canonical keys, `ListView` lifted `calendar.defaultView` onto the calendar it
// built, and its kanban and calendar branches spread the rest of the block onto
// the generated node, so a view stored before the spec closed these slots still
// rendered as written. Since that round no renderer reads a key these four blocks
// refuse: the render path still parses nothing, so such a stored view renders,
// but without what the refused key used to bind (the lane, the cards, the cover,
// the timeline axis fall to their defaults or to the refusal screens). This
// mirror is the door an author meets (`safeValidateSchema`, `objectui validate`,
// and the TypeScript face derived from it), and its messages name the key to
// write instead.
//
// ⚠️ THE MEASUREMENT THIS RESTS ON was taken once and is not re-derived by any
// instrument (AGENTS.md #9): the census on objectui#6152 (round 11) read no
// writer of any of these keys on the declared slots, across the authored corpus,
// app-shell's producers and the spec-driven view designer; only test fixtures
// wrote them. The verdict-equality pin is
// `../__tests__/list-view-blocks-by-reference-6152.test.ts`.
//
// `gantt` needs no local schema at all: the spec config already covers every field
// the renderer reads, so it flows in with the rest of the imported spec fields.
// It used to cover them by being `.passthrough()` for renderer-ahead knobs;
// objectstack#15469 closed that window and DECLARED the ten it was carrying, so
// today the coverage is by declaration (objectui#7845).

/**
 * The detail every pre-#2231 alias arm on these four blocks publishes, after
 * `aliasKeyRefusal`'s lead (which is the spec's own lead, so an author meets one
 * remedy on both faces). ONE builder, so the four messages cannot drift apart.
 */
const listViewBlockAliasDetail = (alias: string, canonical: string, meaning: string) =>
  `\`${alias}\` is the pre-#2231 objectui spelling of ${meaning}, refused on this list-view block since `
  + `objectui#6152 (round 11). \`@objectstack/spec\` judges the block as a strict object whose only spelling `
  + `is \`${canonical}\`, and refuses \`${alias}\` there. The renderer no longer reads it either (round 14), `
  + `so a view that already carries it renders without that binding; write \`${canonical}\`.`;

/** `kanban.groupField` / `kanban.cardFields` — the two pre-#2231 kanban aliases. */
const KanbanBlockAliasRefusals = {
  groupField: aliasKeyRefusal('groupField', 'groupByField', 'this kanban configuration',
    listViewBlockAliasDetail('groupField', 'groupByField', 'the lane field')),
  cardFields: aliasKeyRefusal('cardFields', 'columns', 'this kanban configuration',
    listViewBlockAliasDetail('cardFields', 'columns', 'the fields shown on each card')),
};

/** `gallery.imageField` — the pre-#2231 cover alias. */
const GalleryImageFieldRefusal = aliasKeyRefusal('imageField', 'coverField', 'this gallery configuration',
  listViewBlockAliasDetail('imageField', 'coverField', 'the cover field'));

/**
 * `timeline.dateField` — the pre-#2231 start alias. It names `startDateField`,
 * as the calendar arms below do and for their reason: every objectui read site
 * folds this spelling onto the START. (The spec's own refusal names both ends,
 * because the spelling does not say which one it binds.)
 */
const TimelineDateFieldRefusal = aliasKeyRefusal('dateField', 'startDateField', 'this timeline configuration',
  listViewBlockAliasDetail('dateField', 'startDateField', 'the timeline start date'));

/**
 * `calendar.defaultView` on a LIST VIEW's calendar block — not an alias of
 * anything, so it names no canonical key on this block. The lead is the spec's
 * own lead for an unrecognized key.
 */
const CalendarBlockDefaultViewRefusal = retirementTombstone(
  'Unrecognized key(s) on this calendar configuration: `defaultView`. `@objectstack/spec` has no '
  + '`defaultView` member on a list view\'s calendar block, so the spec refuses it there, and since '
  + 'objectui#6152 (round 11) this package does too. The initial view mode is a member of the '
  + '`object-calendar` element (its flat `defaultView`), not of a list view\'s calendar block. The list '
  + 'view no longer lifts it onto the calendar it builds (round 14), so a view that already carries it '
  + 'opens on the calendar\'s own default view.',
);

// ALIAS REFUSAL — THE READ DOOR FOR A STORED VIEW'S KANBAN CONFIG
// (objectui#8365, maintainer ruling of 2026-09-12, decision batch #117 item 5:
// option B, 「8365 同意」).
//
// `groupBy` is a THIRD spelling of the lane the spec names `groupByField` and
// this mirror's own `groupField` aliased. It was never declared here — and
// because this object ended `.passthrough()` (until objectui#6152 round 11), an
// undeclared key was not dropped, it was KEPT. That was the whole defect: the surviving key rode the
// bag into `ListView`'s kanban branch, whose `...restKanban` spread lands
// AFTER its own `groupBy: laneField`, so an authored `kanban.groupBy`
// OVERRODE the lane the branch had just resolved from `groupByField`.
// Measured on the card's distinguishing fixture, not reasoned:
// `options.kanban = { groupBy: 'LANE_FROM_STRAY_GROUPBY' }` against
// `kanban = { groupByField: 'LANE_FROM_CANONICAL' }` produced
// `node.groupBy === 'LANE_FROM_STRAY_GROUPBY'`.
//
// ⛔ HONOURING IT AS A DECLARED ALIAS IS NOT AVAILABLE. `@objectstack/spec`'s
// `KanbanConfigSchema` is a `strictObject` of exactly
// `columns` / `groupByField` / `summarizeField` and refuses `groupBy` BY NAME.
// Re-measured at implementation time on the version this tree pins
// (17.4.0 — the card measured 17.3.0), with BOTH controls firing: a lit
// control (`zzzBogusKey` alongside a valid `groupByField`) draws
// `unrecognized_keys` naming the bogus key, and a dark control
// (`groupByField` alone) draws none. Upstream knows the SIBLING alias by name
// — probing `groupField` answers "Did you mean `groupField` → `groupByField`?"
// — and knows nothing at all about `groupBy`, which it refuses as a plain
// unrecognized key. Legalising it is a spec change on its own objectstack
// card, ⛔ never a renderer-side widening (AGENTS.md #0.1).
//
// ⇒ the key is DECLARED and unwritable, so it is refused BY NAME instead of
// riding the passthrough in silence, and this mirror stops being more
// permissive than the protocol it mirrors. The lead sentence is the one the
// spec's own `strictObject({ aliases })` answers with (surface noun quoted
// verbatim from the measurement above), so an author meets ONE remedy on both
// faces. `z.input` is `undefined`, so the inferred TypeScript face carries
// `groupBy?: never` and `tsc` refuses it at the authoring site too.
//
// ⛔ NOT A FOLD onto `groupByField`. A fold is only honest where the canonical
// key is the READER's first limb; here the reader's first limb IS canonical
// (`groupByField || detectStatusField(...)` since objectui#6152 round 14), so
// folding the alias in would re-create the very override this refusal closes.
// `groupBy` is modelled nowhere and folds nowhere, and since that round the
// `groupField` / `cardFields` aliases above fold nowhere either.
//
// ⚠️ NODE-LOCAL vs VIEW-LEVEL, the distinction this file has to keep straight:
// this arm is the VIEW-LEVEL `kanban` config. `groupBy` on the generated
// `object-kanban` NODE is the live, canonical lane key that `ObjectKanban`
// reads — untouched, and deliberately so.
const KanbanStrayGroupByRefusal = aliasKeyRefusal(
  'groupBy',
  'groupByField',
  'this kanban configuration',
  '`groupBy` is the lane key of the generated `object-kanban` NODE, not of the view-level '
  + 'kanban configuration (objectui#8365). `@objectstack/spec`\'s `KanbanConfigSchema` is a '
  + 'strict object of `columns` / `groupByField` / `summarizeField` and refuses `groupBy` by '
  + 'name. Write `groupByField`. This '
  + 'package, by contrast, accepted the key green until this refusal: it passed '
  + '`safeValidateSchema` in either nesting, kept by this object\'s `.passthrough()` or by the '
  + 'untyped legacy `options` bag, and reached `ListView`\'s kanban branch, where it OVERRODE the '
  + 'lane that branch had already resolved from `groupByField` — the board grouped by the stray '
  + 'key, and nothing said so. That branch now drops the key, so it is refused here instead of '
  + 'being kept and then ignored.',
);

/**
 * WHERE THIS ARM IS INSTALLED — TWO ROUTES, THREE NESTINGS, ONE STRING.
 *
 * `ListView` merges `{ ...schema.options?.kanban, ...schema.kanban }` before it
 * reads anything, so a stored view can carry the stray key under EITHER. The
 * declared `kanban` slot takes this arm as a DECLARED MEMBER (`invalid_type` at
 * `kanban.groupBy`, and `groupBy?: never` on the inferred TypeScript face).
 * The legacy `options` bag takes the SAME block since objectui#6152 round 12
 * (`ListViewOptionsBag` below), so the arm is a declared member there too
 * (`invalid_type` at `options.kanban.groupBy`). Until that round the bag was a
 * record that could declare no member, and the arm rode it as a `custom` check.
 *
 * The second route is a named view on an `object-view` document, whose
 * `listViews` is the protocol's strict record by reference (objectui#7928), so
 * nothing `ListViewSchema` declares reaches it, and it has ONE nesting: the
 * record refuses a named view's `options` bag whole (`unrecognized_keys` naming
 * `options`), and `generateViewSchema` no longer reads that bag. The `kanban`
 * block there is refused by the protocol alone (`unrecognized_keys` at
 * `listViews.KEY.kanban`, naming `groupBy`): objectui#10321's pointer on that
 * door was retired by objectui#11073, because the protocol's refusal is terminal
 * since `@objectstack/spec` 17.5.0 and the pointer could no longer run.
 *
 * ⚠️ Covering the legacy nesting is not optional politeness: the retired
 * producer (`app-shell`'s `kanbanViewOptions`, objectui#8213) wrote into
 * `options.kanban`, so that is where the stored views this ruling is ABOUT carry
 * the key. Refusing only the declared nesting would leave exactly that
 * population re-grouped in silence — option A, which the ruling did not take.
 *
 * ⛔ Every channel takes ONE string, read off this arm's own `.description`,
 * so the message an author meets at the key cannot depend on which of those
 * three nestings they wrote it in.
 */

// The list view's kanban slot by reference (objectui#6152 round 11), `.partial()`
// for app-shell's derived `{ groupByField }` default. See the note above the blocks.
const KanbanConfig = stripImportedDefaults(SpecListViewSchema).shape.kanban.unwrap().partial().extend({
  // ⭐ Named refusals only. Each message has ONE source, declared above.
  groupField: KanbanBlockAliasRefusals.groupField,
  cardFields: KanbanBlockAliasRefusals.cardFields,
  // objectui#8365.
  groupBy: KanbanStrayGroupByRefusal,
});

/**
 * THE TWO PRE-#2231 CALENDAR DATE ALIASES — DECLARED REFUSALS, BOTH FACES
 * (objectui#8355, director-seat ruling of 2026-09-16, class-1 self-adjudication:
 * "retire the aliases at both faces, now").
 *
 * `dateField` and `endField` are legacy objectui spellings of the calendar date
 * axis the protocol spells `startDateField` / `endDateField`. Neither was ever a
 * MEMBER of a calendar shape here: they rode `.passthrough()` on the two blocks
 * below and `BaseSchema`'s own `.passthrough()` on the node, so an authored
 * value was KEPT unexamined, flattened onto the generated `object-calendar` node
 * by `ListView`'s calendar branch, and read by `ObjectCalendar`'s alias ladder.
 *
 * THE REFUSAL IS THE HALF THAT MAKES THE LADDER REMOVABLE, and the ruling says
 * so in as many words. An earlier attempt (recorded on objectui#8651) removed
 * the ladder while the producer kept spreading the alias, so the same documents
 * stopped drawing and nothing said why — they fell through to `ObjectCalendar`'s
 * generic "Calendar configuration required" screen, which names the canonical
 * keys and says nothing about the key the author actually wrote. The tombstone
 * is what turns that silence into a by-name refusal at the authoring door.
 * ⛔ Do not remove one half without the other.
 *
 * ⚠️ THE CANONICAL TARGET IS objectui's, AND UPSTREAM ANSWERS DIFFERENTLY — but
 * ⛔ NOT BECAUSE IT HOLDS A CONTRARY ALIAS ENTRY. This paragraph said "upstream's
 * alias table points this spelling at the END of the event" and that was WRONG
 * about the protocol; the corrected mechanism, re-derived by RUNNING
 * `@objectstack/spec` 17.4.0 (the version in the lockfile then) rather than
 * reading it — RE-RUN on 17.5.0 (objectui#11073), whose answer moved, as the
 * last bullet says, RE-RUN on 17.6.0 (objectui#11438), on 17.7.0 (objectui#11717),
 * and again on the installed 18.1.0 (objectui#12030, objectui#12370, objectui#12626, objectui#12873, objectui#12971, objectui#13261, objectui#13440), each of which answers
 * every bullet below as 17.5.0 did:
 *
 *   - `CalendarConfigSchema`'s `strictObject` options carry `surface` and
 *     `history` and NOTHING ELSE. There is no `aliases` entry, so upstream holds
 *     no opinion at all about either spelling. ⭐ Lit control that the option
 *     exists and is simply unused here: `GanttQuickFilterSchema`'s nested option
 *     object, in that same generated module, DOES pass
 *     `aliases: { text: 'label', title: 'label', … }`.
 *   - the hint an author sees comes from `findClosestMatches` — a Levenshtein
 *     near-miss suggester the refusal formatter falls back to, budgeted
 *     `max(2, floor(key.length / 3))`. MEASURED against the four known keys:
 *     `dateField` (length 9, budget 3) resolves to `endDateField`, which is 3
 *     edits away, while `startDateField` is 5 and therefore out of budget;
 *     `endField` (length 8, budget 2) reaches nothing, which is why it draws no
 *     hint — and neither does a nonsense control key. ⭐ Positive control that
 *     the suggester is alive and correct for what it is for: a genuine one-char
 *     typo of the canonical key resolves to `startDateField`.
 *   - ON 17.5.0 THAT HINT IS GONE. The formatter now asks an opposite-pole
 *     question before the suggester: `dateField` sits between
 *     `startDateField` and `endDateField`, so the refusal names BOTH ("does
 *     not say which end of the range it binds … Write the one you mean") and
 *     prescribes neither. `endField` still draws no hint, and a one-char typo
 *     still resolves by distance (`titleFeld` → `titleField`) — all three
 *     measured on 17.5.0, again on 17.6.0 (objectui#11438), on 17.7.0
 *     (objectui#11717), and again on the installed 18.1.0 (objectui#12030, objectui#12370, objectui#12626, objectui#12873, objectui#12971, objectui#13261, objectui#13440).
 *
 * ⇒ through 17.4.0 a generic typo-distance suggester picked the wrong sibling.
 * It was not a declaration, it contradicted no declaration, and ⛔ no upstream
 * text says `dateField` means the end of an event.
 *
 * The author-facing hazard was real all the same: an author who copied that
 * hint wrote `endDateField` and bound the END of an event to the date they
 * meant as the START — accepted by every layer, wrong on screen. Every objectui read site
 * folded this spelling onto the START until objectui#6152 round 14 retired them: the
 * ladder this card retires did, `normalizeListViewSchema`'s `timeline` fold did,
 * `resolveTimelineDateBinding` documented it as "the pre-#2231 alias for
 * `startDateField`", and this package
 * published "Deprecated alias for startDateField" on `TimelineConfig` for
 * releases (until objectui#6152 round 11 refused it there, naming the same key).
 * So these arms name `startDateField`. The remedy upstream needed was
 * a formatter answer that keeps the suggester from speaking for `dateField`;
 * 17.5.0's opposite-pole prescription is that answer (it declines to guess an
 * end, where these arms name one because objectui's own alias history does).
 * `endField` still draws nothing upstream. ⛔ Neither is fixed here — it is
 * upstream's formatter.
 *
 * ONE detail STEM, four installed arms, plus ONE consequence clause PER KEY.
 * ⚠️ The per-key split is not tidiness: the two spellings fail DIFFERENTLY when
 * left unrefused (see the clauses below), so a single shared consequence made
 * the `endField` arms publish something that does not happen. The surface noun
 * is quoted verbatim from the measurement above, which is what makes this face
 * and the protocol's answer alike.
 */
const CALENDAR_DATE_ALIAS_STEM =
  '`dateField` and `endField` are the pre-#2231 objectui spellings of the calendar date axis, '
  + 'retired at both faces by objectui#8355. `@objectstack/spec` spells the axis `startDateField` '
  + 'and `endDateField` only. ⚠️ This package accepted BOTH legacy spellings green until that '
  + 'retirement — they rode a `.passthrough()` straight through `safeValidateSchema` into '
  + '`ListView`\'s calendar branch, which flattened them onto the generated `object-calendar` node '
  + 'where the renderer\'s alias ladder read them. That ladder is gone, so the key is refused here '
  + 'instead of being kept and then ignored. ';

/**
 * WHERE THE AUTHORED VALUE LANDS, which is what decides the consequence clause.
 *
 *   - `'binding'` — the value reaches `ObjectCalendar` as a FLAT member of the
 *     node. Every producer-fed surface is this: the view-level `calendar` block
 *     and its legacy `options.calendar` twin, a named view's two nestings, and
 *     the flat node face itself.
 *   - `'container'` — the `object-calendar` element's OWN `calendar` container,
 *     which `getCalendarConfig` reads FIRST and returns WHOLE rather than
 *     lifting member by member.
 */
type CalendarAliasSurfaceKind = 'binding' | 'container';

/**
 * The consequence clause, PER KEY **and** PER SURFACE KIND.
 *
 * ⚠️ TWO ROUNDS OF THIS CARD PUT A FALSE SENTENCE IN AN AUTHOR'S HANDS, and
 * both times the sentence was true somewhere and installed somewhere else.
 * Round 2 split it per KEY after one clause published the `dateField` outcome on
 * the `endField` arms; this is the per-SURFACE split, after the `dateField`
 * clause turned out to be false on the container it was also installed on. ⇒ the
 * way out is measuring every surface an arm is installed on, ⛔ not writing the
 * prose more carefully. Re-measure this table when an arm is installed anywhere
 * new.
 *
 * MEASURED on the head renderer, each row rendered and read, with both controls
 * in the same pass (a canonical binding DRAWS; no binding at all REFUSES, so a
 * "does not refuse" reading is never vacuous):
 *
 *   | authored                                  | screen                         |
 *   | ----------------------------------------- | ------------------------------ |
 *   | flat `dateField` alone                    | "Calendar configuration req…"  |
 *   | `calendar: { dateField, titleField }`     | DRAWS, every record unscheduled|
 *   | `calendar: { startDateField, endField }`  | DRAWS, event end dropped       |
 *   | `calendar: { startDateField }`  (CONTROL) | DRAWS                          |
 *   | no binding at all               (CONTROL) | "Calendar configuration req…"  |
 *
 * The container row is the one that broke the shared clause: `getCalendarConfig`
 * returns `schema.calendar` WHOLE, so the config is not null, the refusal screen
 * is never reached, and the calendar mounts with zero placeable events.
 * `endField` reads the same on both kinds, so it keeps ONE clause — ⛔ not
 * duplicated for symmetry's sake.
 */
const CALENDAR_DATE_ALIAS_CONSEQUENCE: Record<
  'dateField' | 'endField',
  Record<CalendarAliasSurfaceKind, string>
> = {
  dateField: {
    // Quotes the refusal screen's FIRST clause only — the one objectui#8170 kept.
    // Its second clause was rewritten there, so a whole-screen quote goes false
    // the next time that copy moves (objectui#10030).
    binding:
      'Write `startDateField` for the event start. Kept rather than refused, an authored '
      + '`dateField` binds nothing: the calendar falls through to "Calendar configuration required", '
      + 'a screen that names the canonical keys and never the key you wrote.',
    container:
      'Write `startDateField` for the event start. Kept rather than refused, an authored '
      + '`dateField` fails without even reaching that refusal screen: this container is read WHOLE, '
      + 'so the calendar still mounts and simply places nothing — every record ends up under '
      + '"Unscheduled" with no date to draw it on.',
  },
  endField: {
    binding:
      'Write `endDateField` for the event end. Kept rather than refused, an authored `endField` '
      + 'fails even more quietly than its sibling: a calendar that also carries a start binding '
      + 'still DRAWS, and only the end of every event is silently dropped.',
    container:
      'Write `endDateField` for the event end. Kept rather than refused, an authored `endField` '
      + 'fails even more quietly than its sibling: a calendar that also carries a start binding '
      + 'still DRAWS, and only the end of every event is silently dropped.',
  },
};

/** The composed guidance one arm publishes, for one spelling, on one surface. */
const calendarAliasDetail = (alias: 'dateField' | 'endField', surface: CalendarAliasSurfaceKind) =>
  CALENDAR_DATE_ALIAS_STEM + CALENDAR_DATE_ALIAS_CONSEQUENCE[alias][surface];

/**
 * The two arms as a VIEW-level calendar block wears them — the list view's
 * `calendar:` block below, its legacy `options.calendar` twin, and a named
 * view's two nestings on `ObjectViewSchema`. Every one of those is producer-fed,
 * so the authored value reaches the renderer as a flat node binding.
 */
const CalendarBlockDateAliasRefusals = {
  dateField: aliasKeyRefusal('dateField', 'startDateField', 'this calendar configuration', calendarAliasDetail('dateField', 'binding')),
  endField: aliasKeyRefusal('endField', 'endDateField', 'this calendar configuration', calendarAliasDetail('endField', 'binding')),
};

/**
 * The same two arms as the `object-calendar` ELEMENT'S OWN `calendar` CONTAINER
 * wears them. ⚠️ Same surface noun as the view-level block above and a DIFFERENT
 * consequence, which is the whole reason this is a third group rather than a
 * reuse: `getCalendarConfig` reads this container FIRST and returns it WHOLE, so
 * a retired spelling here never reaches the refusal screen the view-level
 * clause names. Measured — see the consequence table.
 */
const CalendarContainerDateAliasRefusals = {
  dateField: aliasKeyRefusal('dateField', 'startDateField', 'this calendar configuration', calendarAliasDetail('dateField', 'container')),
  endField: aliasKeyRefusal('endField', 'endDateField', 'this calendar configuration', calendarAliasDetail('endField', 'container')),
};

/**
 * The same two arms as the `object-calendar` NODE wears them. This is the FLAT
 * spelling `ListView` used to flatten the block into, and where the retired
 * ladder actually read — a binding surface, so it takes the binding clause; only
 * the surface noun differs from the view-level group.
 */
const CalendarNodeDateAliasRefusals = {
  dateField: aliasKeyRefusal('dateField', 'startDateField', 'this object-calendar node', calendarAliasDetail('dateField', 'binding')),
  endField: aliasKeyRefusal('endField', 'endDateField', 'this object-calendar node', calendarAliasDetail('endField', 'binding')),
};

/**
 * RETIRED (objectui#11073): the named-view by-name pointers of objectui#8355
 * (`calendar.dateField` / `calendar.endField`) and objectui#10321
 * (`kanban.groupBy`) on `ObjectViewSchema`.
 *
 * They were `superRefine` checks with `when: () => true` that read the
 * protocol's `unrecognized_keys` refusal inside a named view's `calendar` /
 * `kanban` block and added objectui's pointer at the key. `@objectstack/spec`
 * 17.5.0 makes that refusal TERMINAL (its closed objects mark `unrecognized_keys`
 * `continue: false`), and zod skips even a `when`-guarded check once the parse is
 * explicitly aborted, so the checks could no longer run on the documents they
 * existed for. The document is still refused, by the protocol, at
 * `listViews.KEY.calendar` / `listViews.KEY.kanban`, naming the key (for
 * `dateField` the protocol's own text also says which end of the range it
 * cannot tell apart). The `list-view` route keeps objectui's pointers
 * (`CalendarBlockDateAliasRefusals`, `KanbanStrayGroupByRefusal`): nothing there
 * aborts before them. Seat ruling Q2 → A on objectui#11073, under the
 * maintainer's principle that the protocol governs (objectui#8934).
 */

// The list view's calendar slot by reference (objectui#6152 round 11), with its
// required `startDateField`: no producer leaves it out. See the note above the blocks.
const CalendarConfig = stripImportedDefaults(SpecListViewSchema).shape.calendar.unwrap().extend({
  // ⭐ Named refusals only. Each message has ONE source, declared above.
  // `defaultView` was an objectui-only extension until objectui#6152 round 11;
  // the spec has no such member on this block.
  defaultView: CalendarBlockDefaultViewRefusal,
  // objectui#8355.
  dateField: CalendarBlockDateAliasRefusals.dateField,
  endField: CalendarBlockDateAliasRefusals.endField,
});

/**
 * The `object-calendar` ELEMENT's configuration container — a DIFFERENT contract
 * from {@link CalendarConfig} above, which is a list VIEW's calendar block, and
 * the reason the two are not one const (objectui#8651).
 *
 * ⭐ BY REFERENCE since objectui#6152 round 9: this IS the `object-calendar`
 * row's own `calendar` member (`ComponentPropsMap['object-calendar'].calendar`,
 * unwrapped from its `optional`), extended by nothing but objectui's two named
 * alias refusals below. Through `@objectstack/spec` 17.6.0 the spec supplied no
 * shape here — the slot was `z.unknown().optional()` — so the member list was
 * objectui's own. 17.7.0 types the slot (objectstack#21464 stage 2,
 * `7d674dfc`) as a strict copy of the list view's calendar block: the same five
 * member objects `CalendarConfigSchema` holds, with `startDateField` REQUIRED and
 * every other key refused by the spec's own `unrecognized_keys` diagnostic.
 *
 * Taken from the ROW, not from `CalendarConfigSchema`, although today the two
 * give the same verdict on every input: the row is the contract this element is
 * judged by, so if the spec ever gives the element a block of its own this
 * declaration follows without an edit. `.extend()` keeps the slot's strictness
 * and its unknown-key message. The verdict-equality pin over a set of inputs,
 * and the measurement of the slot itself, are in
 * `../__tests__/object-calendar-container-by-reference-6152.test.ts`.
 *
 * What following the slot narrowed. Until this round the container was
 * `CalendarConfigSchema` `.partial()` + `.passthrough()`, so it admitted two
 * things the slot refuses, the direction objectui#8327's triage ruling forbids:
 *
 *   - an unexamined KEY (`calendar.defaultView`, a misspelling such as
 *     `calendar.startDate`), now refused with the spec's `unrecognized_keys`;
 *   - a block WITHOUT `startDateField` (`calendar: { titleField }`), now refused
 *     at `calendar.startDateField`.
 *
 * Neither cost a reader. `getCalendarConfig` (`plugin-calendar/src/ObjectCalendar.tsx`)
 * returns this block WHOLE and the events pass reads the five members only, so
 * an extra key was dropped unread, and a block without a start binding mounted
 * a calendar that placed nothing. The same test file's corpus census re-derives,
 * on every run, that each authored container still parses.
 *
 * `defaultView` is not a member of either block. This ELEMENT seeds its view
 * state from the FLAT `defaultView` member of this schema and never looks inside
 * the container, so the slot's refusal here costs nothing. A list VIEW's block
 * refuses it by name since objectui#6152 round 11, and since round 14 `ListView`
 * no longer lifts a stored one onto the node it builds.
 */
const ObjectCalendarBlockConfigSchema = stripImportedDefaults(SpecObjectCalendarPropsSchema).shape.calendar.unwrap().extend({
  // ⭐ objectui#8355 — the same two spellings the view-level block above refuses,
  // and deliberately NOT the same string: `getCalendarConfig` reads this
  // container FIRST and returns it WHOLE, so a retired spelling here never
  // reaches the refusal screen the view-level clause names — it mounts a
  // calendar that places nothing. Measured per surface; see the consequence
  // table. Leaving this nesting silent is the half-measure the objectui#8365
  // precedent names and refuses.
  //
  // The strict slot refuses both spellings already, as unrecognized keys. These
  // arms keep the by-name message, which names the canonical key and the
  // consequence at the key's own path; that message is why they stay.
  dateField: CalendarContainerDateAliasRefusals.dateField,
  endField: CalendarContainerDateAliasRefusals.endField,
});

/**
 * The inferred twin of {@link ObjectCalendarBlockConfigSchema}, exported so the
 * TS face of `ObjectCalendarSchema.calendar` can DERIVE from this mirror rather
 * than re-spell it. Two faces, one declaration — the same construction
 * `ListViewSchema` already uses through `ListViewInferred`.
 */
export type ObjectCalendarBlockConfig = z.infer<typeof ObjectCalendarBlockConfigSchema>;

// The list view's gallery slot by reference (objectui#6152 round 11). The slot
// requires no member, so there is nothing for `.partial()` to relax.
const GalleryConfig = stripImportedDefaults(SpecListViewSchema).shape.gallery.unwrap().extend({
  // ⭐ Named refusal only, declared above.
  imageField: GalleryImageFieldRefusal,
});

// The list view's timeline slot by reference (objectui#6152 round 11), `.partial()`
// for `InterfaceListPage`'s derived timeline default, which carries no `titleField`.
const TimelineConfig = stripImportedDefaults(SpecListViewSchema).shape.timeline.unwrap().partial().extend({
  // ⭐ Named refusal only, declared above.
  dateField: TimelineDateFieldRefusal,
});

/**
 * THE LEGACY `options` BAG, BY REFERENCE (objectui#6152 round 12).
 *
 * `@objectstack/spec`'s authoring `ListViewSchema` declares no `options`. The
 * bag's one home is the flattened LIST OVERLAY on the view write door
 * (`VIEW_METADATA_MEMBERS.listOverlay`, the door objectui#10380 ruled A on): a
 * strict object of the eight kinds that name a block, each kind judged by its
 * own list-view slot with every key optional
 * (`ListViewShapeSchema.shape.KIND.unwrap().partial()`), because the renderer
 * reads the bag as a per-key UNDERLAY of the top-level block. objectui#8327
 * forbids accepting what that door refuses, so this is that member's own
 * `options`, unwrapped from its `optional`: the bag's closed key set, and its
 * unknown-key message, which names `options.grid` with the spec's guidance (a
 * grid has no per-kind block). ⛔ No member is hand-copied here.
 *
 * What objectui changes is the same as on the top-level blocks, and only that:
 * `kanban`, `calendar`, `gallery` and `timeline` are this file's round-11
 * blocks, so each named refusal arm (`kanban.groupField` / `cardFields` /
 * `groupBy`, `calendar.defaultView` / `dateField` / `endField`,
 * `gallery.imageField`, `timeline.dateField`) gives ONE message in both
 * nestings, as `invalid_type` at the key's own path. `.partial()` makes the
 * calendar's required `startDateField` optional here, as the bag does; the
 * other three blocks require nothing on this face already. `gantt`, `map`,
 * `chart` and `tree` stay the spec's own, as the top-level blocks of those
 * names do. `stripImportedDefaults` keeps a parse from writing the slots'
 * defaults (the chart block's `chartType`) into a bag that did not carry them.
 *
 * ⚠️ THE READERS MOVED SECOND (objectui#6152 round 14). `ListView` still merges
 * each `options.KIND` under the top-level block, but it reads each kind's
 * declared keys only: the alias rungs, the `options.grid` spread and the spreads
 * of the rest of a block onto the node it builds are retired. `chart` followed
 * in round 15: its legacy axes (`xAxisField` / `categoryField`, `yAxisFields` /
 * `valueField`, `aggregation`) are read by no route, so a chart block that names
 * no `dataset` binds nothing and `ObjectChart` refuses it on screen. The render path
 * parses nothing, so a row stored before the view write door judged the bag
 * (`@objectstack/spec` 17.5.0) still renders, without what a refused key used to
 * bind. This mirror is the door an author meets. The writers moved with it in
 * round 12: app-shell's relay writes `kanban.columns` and no `gallery.imageField`
 * or `timeline.descriptionField` (`ObjectView.tsx`), and the `@object-ui/plugin-list`
 * README authors the top-level blocks instead of the bag.
 *
 * ⚠️ THE MEASUREMENT THIS RESTS ON was taken once and is not re-derived by any
 * instrument (AGENTS.md #9): the census on objectui#6152 (round 12, report
 * 6070437445) read no other writer of a key this bag refuses, across the authored
 * corpus, app-shell's producers and the view designer; only test fixtures wrote
 * one. The verdict-equality pin is `../__tests__/list-view-options-bag-6152.test.ts`.
 */
const ListViewOptionsBag = stripImportedDefaults(SpecViewMetadataMembers.listOverlay.shape.options.unwrap()).extend({
  kanban: KanbanConfig.optional(),
  calendar: CalendarConfig.partial().optional(),
  gallery: GalleryConfig.optional(),
  timeline: TimelineConfig.optional(),
});

// View-kind enum reused from spec (unwrap its `.default('grid')`) so it cannot drift.
const ViewKindEnum = SpecListViewSchema.shape.type.removeDefault();

/**
 * User Actions — `@objectstack/spec/ui`'s `UserActionsConfigSchema`, mirrored
 * BY REFERENCE (objectui#8992).
 *
 * The spec documents this object as "which interactive actions are available to
 * users in the view toolbar — each boolean toggles the corresponding toolbar
 * element on/off". Grouping, column visibility and row coloring are the same
 * kind of toggle as `rowHeight` (objectui's old `showDensity`), each named
 * after the config key it gates (`grouping`, `hiddenFields`, `rowColor`).
 *
 * This read `stripImportedDefaults(Spec).extend({ group, hideFields, rowColor })`
 * for as long as the protocol declared none of the three while
 * `normalizeListViewSchema` folded objectui's legacy `showGroup` /
 * `showHideFields` / `showColor` onto them. The protocol declares all three
 * now — the maintainer ruled option A on objectui#5435 (2026-08-22) and the
 * spec adopted them in 17.3.0 — so the extension collapses, exactly as its own
 * note said it would. A redundant local extension is how two faces start to
 * drift.
 *
 * ⛔ AN UNDECLARED KEY IS REFUSED HERE, BY NAME (`unrecognized_keys`, one
 * issue, the key named) — it is NOT dropped. The note this replaces claimed
 * the opposite: "`UserActionsConfigSchema` is NOT `.strict()`, so ... an author
 * writing `userActions: { group: false }` had it silently stripped — valid on
 * parse, no effect at render". That was false at every published 17.x —
 * measured by parsing a one-undeclared-key document against the published
 * artifacts of 17.0.0, 17.2.0, 17.3.0 and the resolved 17.4.0, each of which
 * refuses and names the key. Silent-tolerance prose in front of a
 * loud-rejection runtime is the worst direction for a comment to be wrong in:
 * it tells an author — human or AI — that a config which will FAIL the save
 * gate is harmless. `__tests__/user-actions-mirror-8992.test.ts` pins the
 * refusal so this paragraph cannot rot back into the one it replaced.
 *
 * ⚠️ The three keys are VERSION-BORNE from here on. `@object-ui/types` declares
 * `@objectstack/spec: ^17.3.0`, and that floor is load-bearing for them: 17.2.0
 * declares 8 keys, 17.3.0 declares 11. The extension used to carry the three
 * locally whatever version resolved; it no longer does.
 */
export const UserActionsSchema = stripImportedDefaults(SpecUserActionsConfigSchema);

/**
 * The refusal text for a view filter on a dataset-bound `chart` view, per
 * written key. Its last sentence is the remedy ruling 5825582592 wrote, and the
 * pin asserts it.
 */
const datasetChartViewFilterRefusal = (key: 'filter' | 'filters'): string =>
  `\`${key}\` is refused on a \`chart\` view bound to a semantic \`dataset\`: ` +
  'the chart queries the dataset, not the list object, so a view filter here is never applied ' +
  'and the chart would draw unfiltered totals. Remove it — ' +
  "a dataset chart's scope is written in the dataset.";

/**
 * objectui#10327 — a view filter on a `chart` view bound to a semantic
 * `dataset` is REFUSED at authoring (ruling 5825582592, letter A: a dataset
 * chart takes its scope from the dataset).
 *
 * ## Why
 *
 * `ListView`'s `case 'chart'` builds the dataset shape's `object-chart` node
 * with NO `filter`: `ObjectChart` hands `queryDataset` the dimensions and the
 * measures and nothing else, and a dataset's field namespace need not be the
 * list object's, so the list's filter has no door into that query. The ruling
 * refused the mapping that would build one (option B). An authored filter here
 * was accepted and silently dropped, and the chart drew unfiltered totals that
 * read as filtered ones. At runtime the toolbar withholds its filter controls
 * on such a view (`ListView`'s `datasetChartOnScreen`).
 *
 * ## Why here, on objectui's face — the location the ruling left to the dev
 *
 * Both operand keys are the spec's own, imported by reference below: `filter`,
 * and the `chart` block (`ListChartConfigSchema`, whose `dataset` is required).
 * The CONDITION is not: on this node the view kind rides as objectui's
 * `viewType` (the spec's `type` is spent here on the component discriminator),
 * and two objectui-owned spellings reach the same render branch — the legacy
 * `filters` alias (folded into `filter` by `normalizeListViewSchema`) and the
 * legacy `options.chart` bag (read by `resolveListChartBinding` when no `chart`
 * block is declared). A spec-door check reads none of the three; that is the
 * reason `checkListViewPageMount` was not attachable here (objectui#7715). So
 * this node's refusal is objectui's. A stored `view` row spelled `type: 'chart'`
 * passes the SPEC's door, which is a second door and not this one.
 *
 * ## What it judges — the runtime's own reading, one leg each
 *
 *   - view kind: `viewType === 'chart'`, the value `ListView`'s `currentView`
 *     starts from;
 *   - binding: the effective chart block — `chart` WHOLESALE, else
 *     `options.chart`, `resolveListChartBinding`'s precedence — names a
 *     `dataset`;
 *   - filter: `filter`, and the legacy `filters`, each a non-empty array. An
 *     empty array is no filter and passes.
 *
 * One `custom` issue per written filter key, at that key. ⛔ Not judged: a view
 * of another kind that only OFFERS a switch to a dataset chart
 * (`appearance.allowedVisualizations`). Its filter scopes the view it is
 * authored on, so refusing it would refuse a working grid.
 */
function checkListViewDatasetChartFilter(
  view: { viewType?: unknown; chart?: unknown; options?: unknown; filter?: unknown; filters?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (view.viewType !== 'chart') return;
  const legacyBag = view.options && typeof view.options === 'object'
    ? (view.options as Record<string, unknown>).chart
    : undefined;
  const block = view.chart || legacyBag;
  if (!block || typeof block !== 'object' || !(block as Record<string, unknown>).dataset) return;
  for (const key of ['filter', 'filters'] as const) {
    const written = view[key];
    if (!Array.isArray(written) || written.length === 0) continue;
    ctx.addIssue({ code: 'custom', path: [key], message: datasetChartViewFilterRefusal(key), input: written });
  }
}

/** objectui#9256 (family-D re-measure): ONE refusal string for both content channels of `ListViewSchema`. */
const LIST_VIEW_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'list-view',
  'its registration (`plugin-list:list-view`) reads the node as `ListViewSchema` itself',
  'the records of `objectName` in the visualization `viewType` names, shaped by `columns`, `filter`, '
    + '`sort` and `options`',
);

export const ListViewSchema = BaseSchema
  // Spec-owned fields by reference. `specFieldsExcept` reads the spec object's
  // `.shape` rather than calling `.omit()`, which zod 4 refuses on a schema
  // carrying a refinement (objectui#3063); `.partial()` inside it guarantees no
  // *future* spec field can become required and silently invalidate stored
  // objectui payloads. The spec binding sits in this initializer on purpose —
  // that is what makes the derivation visible to
  // `scripts/check-spec-symbol-derivation.mjs` instead of hidden one hop away.
  //
  // Imported here: data, filter, sort, searchableFields,
  // filterableFields, resizable, striped, bordered, compactToolbar, selection, navigation,
  // pagination, chart, tree, rowHeight, grouping, rowColor, hiddenFields, fieldOrder,
  // rowActions, bulkActions, bulkActionDefs, virtualScroll, inlineEdit, userActions,
  // appearance, tabs, addRecord, showRecordCount, allowPrinting, emptyState, responsive,
  // performance.
  //
  // `striped`, `bordered` and `virtualScroll` are in that list because the spec
  // pin still carries them, NOT because objectui offers them: objectstack#7176
  // retired all three (maintainer-ruled 2026-08-10) after measuring every
  // objectui reader as pass-through — no renderer ever applied one. objectui's
  // own declarations and the forwarding chain came out with objectui#4649; what
  // is left here is the by-reference import, which is exactly what must stay.
  // It carries the spec's `retiredKey()` tombstones in on the GA bump, so an
  // author writing one gets a rejection from the protocol rather than silence.
  // Do NOT add them to LIST_VIEW_LOCAL_OVERRIDES to "clean this up" — that
  // excludes the tombstone and hands the key back to `BaseSchema`'s
  // passthrough, turning a loud rejection into a silently-accepted dead key.
  // Re-forwarding needs an implementation card filed first (the ruling's text).
  .extend(specFieldsExcept(stripImportedDefaults(SpecListViewSchema).shape, LIST_VIEW_LOCAL_OVERRIDES).shape)
  .extend({
    // Component discriminator — load-bearing for the ObjectQLComponentSchema union.
    type: z.literal('list-view'),
    // objectui#11070 — the spec's per-element binding, by reference; see
    // `ObjectGridSchema.dataSource`. The spec's `ListViewSchema` declares no
    // `dataSource`, so this is a node-level member of objectui's arm, and the
    // TS `ListViewSchema` inherits it through `ListViewInferred`.
    dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
      .optional()
      .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
    // objectui-only object binding (spec binds via data.provider:'object'; migration deferred).
    // objectui#11117 — OPTIONAL as a member, REQUIRED by the record-source
    // refinement at the end of the chain unless the node's `dataSource.object`
    // names the object (the registration is gate-wrapped; see `ObjectGridSchema`).
    objectName: z.string().optional().describe(OBJECT_NAME_BINDING_WAIVER_DESCRIPTION),
    // Renamed spec `type` (view-kind); enum imported from spec so it can't drift.
    viewType: ViewKindEnum.optional().describe('View Type'),
    // Relaxed spec `columns` (spec requires it) + legacy `fields` alias for string[] columns.
    columns: z.union([z.array(z.string()), z.array(ListColumnSchema)]).optional().describe('Columns definition'),
    // Legacy alias for `columns`, still accepted because stored view metadata
    // carries it. NO renderer reads it: `normalizeListViewSchema`
    // (`@object-ui/core`) folds it into `columns` at the ListView boundary
    // (#2890). Producers must emit `columns`.
    fields: z.array(z.string()).optional().describe('Legacy alias for string[] columns'),
    // Legacy alias for the spec's `filter`, still accepted because stored view
    // metadata carries it. NO renderer reads it: `normalizeListViewSchema`
    // (`@object-ui/core`) folds it into `filter` at the ListView boundary
    // (#2890). Note both keys carry an ObjectQL FilterNode array at runtime,
    // even though `filter` is typed from the spec as `ViewFilterRule[]`.
    filters: z.array(z.union([z.array(z.any()), z.string()])).optional().describe('Filter conditions (legacy)'),
    // Legacy toolbar visibility flags (spec-canonical is `userActions`; runtime dual-reads).
    showSearch: z.boolean().optional().describe('Show search in toolbar'),
    showSort: z.boolean().optional().describe('Show sort controls in toolbar'),
    showFilters: z.boolean().optional().describe('Show filter controls in toolbar'),
    showHideFields: z.boolean().optional().describe('Show hide-fields button in toolbar'),
    showGroup: z.boolean().optional().describe('Show group button in toolbar'),
    showColor: z.boolean().optional().describe('Show color button in toolbar'),
    showDensity: z.boolean().optional().describe('Show density/row-height button in toolbar'),
    showDescription: z.boolean().optional().describe('Show field descriptions'),
    allowExport: z.boolean().optional().describe('Allow data export'),
    // Legacy alias for the spec's `rowHeight`, still accepted because stored
    // view metadata carries it. NO renderer reads it: `normalizeListViewSchema`
    // (`@object-ui/core`) folds it into `rowHeight` at the ListView boundary
    // (#2890). Note the vocabularies differ in size — three densities widen
    // onto the spec's five row heights.
    densityMode: z.enum(['compact', 'comfortable', 'spacious']).optional().describe('Density mode'),
    color: z.string().optional().describe('Color field for row/card coloring'),
    fieldTextColor: z.string().optional().describe('Field for custom text color'),
    prefixField: z.string().optional().describe('Prefix field before title'),
    wrapHeaders: z.boolean().optional().describe('Wrap column headers'),
    clickIntoRecordDetails: z.boolean().optional().describe('Navigate to detail on row click'),
    addRecordViaForm: z.boolean().optional().describe('Add records via form dialog'),
    addDeleteRecordsInline: z.boolean().optional().describe('Enable inline add/delete'),
    collapseAllByDefault: z.boolean().optional().describe('Collapse all groups by default'),
    // THE LEGACY BAG, by reference since objectui#6152 round 12: the list
    // overlay's own `options`, with the four round-11 blocks' named refusals
    // (objectui#8365 `kanban.groupBy`, objectui#8355 `calendar.dateField` /
    // `endField` among them). See {@link ListViewOptionsBag}.
    options: ListViewOptionsBag.optional().describe('Component overrides (legacy)'),
    operations: z.object({
      create: z.boolean().optional(),
      read: z.boolean().optional(),
      update: z.boolean().optional(),
      delete: z.boolean().optional(),
      export: z.boolean().optional(),
      import: z.boolean().optional(),
    }).optional().describe('Enabled operations'),
    // ── Local overrides: objectui shapes are intentionally broader than spec (deferred) ──
    userFilters: UserFiltersSchema.optional().describe('User filters configuration (accepts legacy tab shapes)'),
    // Spec `userActions` + the three toolbar toggles it does not model yet (#2890).
    userActions: UserActionsSchema.optional().describe('User action toggles for the view toolbar'),
    // `sharing` is the spec's `ViewSharingSchema`, imported by reference above.
    // The legacy `{ visibility, enabled }` pair folds into it at the ListView
    // boundary (#2890) — see `normalizeListViewSchema`.
    // ARIA — the spec's `AriaPropsSchema` (`ariaLabel` / `ariaDescribedBy` /
    // `role`) plus `live`, which has no spec counterpart. The legacy
    // `{ label, describedBy }` spellings fold into the canonical ones at the
    // ListView boundary (#2890).
    aria: stripImportedDefaults(SpecAriaPropsSchema).extend({
      live: z.enum(['polite', 'assertive', 'off']).optional()
        .describe('aria-live politeness for the list region (objectui-only — promote rather than grow this extension)'),
    }).optional().describe('ARIA attributes'),
    // NOT broader than spec since objectui#11533: the spec list view's own
    // `{ condition, style }` rule, by reference, with the native dialect's keys
    // refused by name — the one rule declaration `ObjectGridSchema` shares
    // (objectui#6152 round 6). Still a local override because the rule keeps
    // objectui's string `condition` arm and names the retired keys.
    conditionalFormatting: z.array(ConditionalFormattingRuleSchema).optional().describe('Conditional formatting rules'),
    // `exportOptions` — the spec's own field, BY REFERENCE (objectui#6956).
    //
    // `ListViewExportOptionsSchema` is internal to the spec bundle (not a public
    // export — measured by `__tests__/export-options-spec-parity.test.ts`), but
    // the enclosing `ListViewSchema.shape.exportOptions` IS a live export, and it
    // is the whole contract: a two-branch union of the bare format array (the
    // legacy spelling, lifted to `{ formats }` at parse) and the STRICT five-key
    // object (`formats` / `maxRecords` / `includeHeaders` / `fileNamePrefix` /
    // `streaming`), with `'pdf'` refused in both spellings under an
    // `os migrate meta --from 16` prescription (objectstack#8010).
    //
    // This member used to restate a pre-objectstack-ai/objectstack#8010 shape — `'pdf'` accepted in both
    // branches, no `streaming`, a non-strict object — so `ListViewInferred`
    // (`z.input` of this schema, and through it the `ListViewSchema` TYPE the
    // ListView renderer is written against) disagreed with its sibling
    // `ObjectGridSchema['exportOptions']`, and the renderer could only read
    // `streaming` through `as any`. Binding the spec field by reference makes
    // the two faces one contract again and keeps the description the spec
    // wrote. The bare array stays admissible on the INPUT type on purpose:
    // nothing on the render path parses, so a stored array reaches `ListView`
    // un-lifted and its `resolvedExportOptions` fold is load-bearing
    // (objectui#4535 item 4).
    exportOptions: stripImportedDefaults(SpecListViewSchema).shape.exportOptions,
    // Per-view-type configs — spec-derived (see the definitions above #2231).
    // `gantt` is NOT here: it flows in from the spec fields unmodified.
    kanban: KanbanConfig.optional().describe('Kanban-specific configuration'),
    calendar: CalendarConfig.optional().describe('Calendar-specific configuration'),
    gallery: GalleryConfig.optional().describe('Gallery-specific configuration'),
    timeline: TimelineConfig.optional().describe('Timeline-specific configuration'),
    // ⭐ `f1cd29032` — the five keys the REGISTERED `list-view` renderer reads
    // off the authored document while this arm declared none. `BaseSchema` is
    // `.passthrough()`, so an undeclared key is NOT refused: it stops being
    // judged and the value is KEPT. `SchemaRenderer` then spreads every
    // non-metadata top-level key of the node into the component props bag (the
    // rest element of its `= evaluatedSchema` destructure, commented there as
    // "Spread non-metadata schema properties as props"), so an authored
    // `onAddRecord: { action: 'toast' }` arrives as `props.onAddRecord` and
    // `ListView`'s add-record button calls it — a plain object invoked as a
    // function, at click.
    //
    // ⛔ DISPOSITION MEASURED PER KEY, never read off the group. `'retired'`
    // publishes "no renderer reads this key"; all five are read AND invoked, so
    // it would have published a false sentence for every one of them. They are
    // `'runtime-slot'` — and the TypeScript channel each one names is NOT the
    // same face, which is the split this slice turned on:
    //
    //   `onNavigate` · `onDensityChange`  read off the NODE (`schema.onX`, into
    //     `useNavigationOverlay` and `useDensityMode`) and declared on
    //     `ListViewRuntimeProps` (`../objectql.ts`), which is intersected into
    //     the `ListViewSchema` TYPE precisely so a host can put a function
    //     there. `@object-ui/app-shell`'s `ObjectView` builds a
    //     `const fullSchema: ListViewSchema` node carrying `onDensityChange`;
    //     `onNavigate` has no in-repo supplier on a `list-view` node, yet the
    //     channel is wired end to end and the read still fires.
    //   `onAddRecord` · `onBulkAction` · `onPageSizeChange`  read off the PROPS
    //     bag (`props.onX`). TWO supply paths reach that bag and both are live:
    //     a React host passes the prop to the component — `ListViewProps`
    //     (`@object-ui/plugin-list`) declares all three by name, and
    //     `StudioDesignSurface` supplies `onAddRecord` that way — or a host
    //     builds the NODE and `SchemaRenderer` spreads it in. The second path
    //     was typed only by `BaseSchema`'s index signature, so this slice
    //     declares the three on `ListViewRuntimeProps` as well, which is the
    //     same repair objectui#9344's slice made on `ObjectGallerySchema` for
    //     the same spread. `onBulkAction` / `onPageSizeChange` have no in-repo
    //     supplier and are still read and still invoked.
    //
    // ⚠️ Unlike the plain `interface X extends BaseSchema` arms this card
    // drained before it, THIS arm feeds its own TypeScript face:
    // `ListViewInferred` is `z.input` of this schema and `ListViewSchema`
    // intersects it with `ListViewRuntimeProps`. A refusal arm's `z.input` is
    // `never | undefined`, and `undefined & ((…) => void) | undefined)` is
    // `undefined` — so declaring these five here ANNIHILATES the two runtime
    // declarations unless the intersection gives the runtime half precedence.
    // It now does; see `ListViewAuthored` in `../objectql.ts`, which is what
    // keeps `'runtime-slot'`'s promise ("the TypeScript twin stays callable")
    // true on this face. ⛔ Do not collapse that back to a bare intersection.
    onAddRecord: handlerKeyRefusal('onAddRecord', 'runtime-slot', 'Add-record handler'),
    onBulkAction: handlerKeyRefusal('onBulkAction', 'runtime-slot', 'Bulk action handler'),
    onDensityChange: handlerKeyRefusal('onDensityChange', 'runtime-slot', 'Row density change handler'),
    onNavigate: handlerKeyRefusal('onNavigate', 'runtime-slot', 'Record navigation handler'),
    onPageSizeChange: handlerKeyRefusal('onPageSizeChange', 'runtime-slot', 'Page size change handler'),
    // objectui#9256 (family-D re-measure): the renderer reads NEITHER content channel, so both are
    // refused by name here as on the TypeScript twin, each kept a MEMBER.
    body: retirementTombstone(LIST_VIEW_NEITHER_CHANNEL),
    children: retirementTombstone(LIST_VIEW_NEITHER_CHANNEL),
    // ⚠️ This arm feeds its own TypeScript face (`ListViewInferred` below), so these two members are
    // what put `body?: undefined` / `children?: undefined` on `ListViewSchema`; there is no separate
    // `?: never` pair to keep in step.
  })
  // ⭐ THE SPEC'S OBJECT-LEVEL CHECKS, re-attached (objectui#7715, ruling B1).
  //
  // `specFieldsExcept` above rebuilds a fresh object from the spec's `.shape`,
  // so it carries the spec's FIELDS and drops every check the spec attached to
  // the OBJECT. The spec exports each such check as a named function
  // (objectstack#16489) precisely so a mirror can attach the one the spec runs
  // instead of restating it. The spec's `ListViewSchema` carries two; each is
  // judged by whether this node carries the fields the check reads:
  //
  //   `checkListViewCalendarVisualization` — ATTACHED. It reads
  //     `appearance.allowedVisualizations` (a spec field, by reference) and only
  //     whether `calendar` is PRESENT; the local `CalendarConfig` override keeps
  //     `calendar` omissible, so "absent" means the same thing on both faces and
  //     the refusal is the spec's own, message included.
  //   `checkListViewPageMount` — NOT ATTACHABLE. It reads `type`, and on this
  //     node `type` is the component discriminator `'list-view'`; the spec's view
  //     kind rides as `viewType`. Attached as-is it would refuse EVERY `pageName`,
  //     a valid page mount included, and its remedy tells the author to write
  //     `type: 'page'`, which this node's literal refuses. The spec kind it binds
  //     is retired upstream (objectstack#17063 — see `UNDRAWABLE_VIEW_KINDS` in
  //     `@object-ui/core`), so no adapter is written for it here.
  //
  // `__tests__/spec-object-refinements-7715.test.ts` re-derives that split from
  // the spec object's own check count, so a check the spec adds to this object
  // later reddens there instead of being dropped here in silence.
  .superRefine(checkListViewCalendarVisualization)
  // objectui's OWN object-level check, not a spec one: see its doc above.
  .superRefine(checkListViewDatasetChartFilter)
  // objectui#11117 — `objectName`'s requiredness, with the spec's binding
  // waiver: the shared refinement `requireRecordSource` (beside
  // `ObjectMapSchema`), with this arm's one rung.
  .superRefine(...requireRecordSource('list-view', ['objectName']));

/**
 * TS type for the ListView component node (spec-derived; issue #2231).
 * The hand-written `interface ListViewSchema` in `../objectql.ts` is now an alias of
 * this type intersected with the non-serializable runtime-only props.
 *
 * `z.input`, not `z.infer` (framework#4074): this type describes the SDUI JSON as
 * AUTHORED and as the renderer actually RECEIVES it. The spec sub-schemas that flow
 * in (`userActions`, `tabs`→`ViewTab`, `sharing`, …) carry `.default()`s, so their
 * `z.infer` output makes those fields required — but nothing on the render path
 * runs `.parse()` to apply them: `normalizeListViewSchema` (`@object-ui/core`)
 * deliberately applies no defaults ("an absent flag stays absent", its test suite).
 * Typing the surface as parsed output therefore rejected valid authored metadata
 * (`userActions: { sort: true }`, a tab without `pinned`/`visible`) while promising
 * renderers defaults that never arrive. The output type of a spec parse belongs to
 * whoever actually parses; this surface is input on both sides.
 */
export type ListViewInferred = z.input<typeof ListViewSchema>;

/**
 * Object Map Configuration Schema — the runtime half of `ObjectMapConfig`
 * (`objectql.ts`).
 *
 * NOT named `MapConfigSchema`: `@objectstack/spec/automation` exports that name
 * for an unrelated automation concept, and `check:spec-symbols` refuses a local
 * declaration under a spec export's name.
 *
 * Lifted out of `plugin-map/src/ObjectMap.tsx`, where it was package-private,
 * so the declared authoring face and the validation the renderer performs are
 * ONE schema rather than two that can drift (objectui#5018). `ObjectMap`
 * imports this exact object; it no longer declares its own.
 *
 * ## `.strict()` — an undeclared key is REFUSED, not stripped (objectui#5157)
 *
 * The TypeScript twin `ObjectMapConfig` is a closed interface, so a misspelled
 * key (`latitudeFieId`) was a compile error for a typed author and nothing at
 * all for untyped metadata: this object stripped it and parsed clean, and
 * nothing named it: the card's typo drew the generic "Map configuration
 * required" refusal (objectui#8169), which names the key the author meant, not
 * the one they wrote. Closing the block makes all three faces
 * one accept set, as ruled on objectui#5157 (letter A, carrying the earlier
 * "the `map` block only" ruling):
 *
 *  - runtime: `ObjectMap`'s `safeParse` of the block now fails, so the
 *    component still renders and `console.warn`s the issue, which names the key;
 *  - validate: `ObjectMapSchema.map` is this object, so `safeValidateSchema`
 *    (and `objectui validate` with it) refuses the node with an
 *    `unrecognized_keys` issue at `map`;
 *  - `.shape` is untouched, so `ObjectMap`'s `FLAT_MAP_CONFIG_KEYS` (derived
 *    from it) and the view flatten whitelists (hand-listed, pinned against it)
 *    see the same keys as before.
 *
 * ⛔ The map block ONLY. Whether other component sub-block schemas close the
 * same way is a separate decision the ruling kept out of this card.
 */
export const ObjectMapConfigSchema = z.object({
  latitudeField: z.string().optional().describe('Field containing latitude'),
  longitudeField: z.string().optional().describe('Field containing longitude'),
  locationField: z.string().optional().describe('Field with a combined location value'),
  titleField: z.string().optional().describe('Field used as the marker title'),
  descriptionField: z.string().optional().describe('Field used as the marker description'),
  zoom: z.number().optional().describe('Zoom level (1-20); declaring it opts out of the auto-fit'),
  center: z.tuple([z.number(), z.number()]).optional().describe('Center [lat, lng]; declaring it opts out of the auto-fit'),
  style: z.string().optional().describe('MapLibre style URL/spec (overrides the public demo default)'),
}).strict();

/**
 * `77cb489b4` — the record-source refinement `ObjectMapSchema`,
 * `ObjectGanttSchema` and `ObjectCalendarSchema` below share — and, since
 * objectui#11117, every gate-wrapped arm with a record-source requirement:
 * `ObjectKanbanSchema` with its own rung list, and `ObjectGridSchema` and
 * `ListViewSchema` with `objectName` alone (see the last section).
 *
 * Those renderers resolve their records from ONE of three keys, in this order:
 * `data`, `staticData` (inline rows, wrapped into a `{ provider: 'value' }`
 * config) or `objectName` (the bound object) — the shared ladder
 * `resolveRecordSourceConfig` in `@object-ui/core`, which
 * `plugin-map/src/ObjectMap.tsx` reaches through its local `getDataConfig`
 * wrapper and `plugin-gantt/src/ObjectGantt.tsx` calls directly: `data`, then
 * `staticData`, then `objectName`, else `null`. Both mirrors
 * used to REQUIRE `objectName` alone, so a document authored on `staticData`
 * (6 of the 20 catalog entries measured for the 2026-09-02 ruling) drew correctly and was
 * refused by `safeValidateSchema` — `declared !== enforced`, with the corpus
 * on the right side. `objectName` is optional on both members now, and this
 * refinement carries the requirement the renderers actually have: with none of
 * the three present the ladder returns `null` and nothing is drawn.
 *
 * Presence is `!== undefined` — the ruling's wording ("at least one of `data`,
 * `staticData`, `objectName` is present"), NOT the renderers' truthiness: an
 * empty `objectName: ''` validated before this card and still does, so the
 * accept set only WIDENS. The one document shape refused here (none of the
 * three) was refused before too, when `objectName` was required. Maintainer
 * ruling recorded 2026-09-02 (director seat, summon #8, decision batch #8).
 *
 * The issue carries `params.code` so a consumer can key off the finding rather
 * than string-match the message — the shape `FormFieldSchema`'s refinement in
 * `form.zod.ts` uses; zod's own `code` is `custom` for every refinement. The
 * path is the ROOT (`[]`): no single key is at fault when all three are absent,
 * and blaming `objectName` would re-teach the requiredness this card removes.
 *
 * Deliberately a `function`, not an `export const`: the parity census in
 * `__tests__/zod-mirror-parity.test.ts` reads `^export const` out of this
 * directory and would demand a registered TS counterpart for it.
 *
 * ⭐ WHAT `data` MEANS IS NOT SHARED, only its PRESENCE is (objectui#9239).
 * This refinement asks one question — is any rung declared? — and `!==
 * undefined` answers it whatever the value's kind, so the three members reach
 * it from two different arms:
 *
 *  - `object-map` / `object-gantt` — `data` is a spec `ViewData` PROVIDER BLOCK
 *    (`{ provider, … }`), the source the block will FETCH FROM. On the flat
 *    mirrors the member is this file's own `ViewDataSchema.optional()`; on the
 *    authored arms (`ObjectMapBlockSchema` and `ObjectGanttBlockSchema` below,
 *    objectui#10859 batches 5 and 6) it is the `data` member of the block's
 *    `ComponentPropsMap` row, the spec's `ViewData`, by reference.
 *  - `object-calendar` — `data` is an ARRAY of PRE-FETCHED RECORDS, drawn in
 *    place of the block's own query, NOT a source to fetch from.
 *    `ComponentPropsMap['object-calendar'].data` is `z.array(z.unknown())
 *    .optional()` on `@objectstack/spec` 17.4.0 and the renderer honours that
 *    arm alone since objectui#8348 (the shared ladder, called on the `'array'`
 *    arm — ⛔ the arm is the citation, not the call shape, which has moved);
 *    objectui#9239 brought this file's member onto it.
 *
 * ⛔ So do not read the message below as promising a fetchable source: on the
 * calendar, declaring `data` means handing the block rows it already has.
 *
 * ## The node's `dataSource` binding is a record source on every arm (objectui#11117)
 *
 * Every arm that installs this refinement is gate-wrapped: its registration is
 * `elementDataSourceBlock`, so `ElementDataSourceGate` (`@object-ui/react`)
 * lands a binding's `object` on `objectName` before the renderer reads the
 * node. A node whose `dataSource.object` names an object therefore HAS a
 * record source although it writes none of the rungs, and the spec accepts it:
 * the `ComponentPropsMap` rows its props gate judges for these blocks require
 * no object key (`list-view` has no row). So the binding counts here, on the
 * predicate the gate and the runtime both use: `dataSourceSuppliesObject`
 * from `./public-blocks.zod.ts`, the ONE copy. A NON-EMPTY string name only — `dataSource: { object: '' }`
 * supplies nothing, because `isElementDataSourceConfig` refuses it and the
 * gate then lands nothing on the node.
 *
 * ONE refinement for every gate-wrapped arm with a record-source requirement,
 * parameterised by the arm's own rung list, because the ladders genuinely
 * differ (`object-kanban` has `bind` and no `staticData`; `object-grid` and
 * `list-view` have `objectName` alone). What every arm shares is what this
 * function owns: presence as `!== undefined` on the rungs, the binding as the
 * last rung, the issue keyed `RECORD_SOURCE_REQUIRED`, and the message,
 * which names the binding as a remedy beside the rungs. The issue sits at the
 * ROOT when the arm has several rungs (no single key is at fault, as above),
 * and at the rung itself when it has one — `objectName` on `object-grid` and
 * `list-view`, the path the required member reported at, so a consumer that
 * locates the refusal by path (`objectui validate` prints it) still finds it
 * there.
 *
 * ⚠️ It returns the refinement AND its params, spread into `.superRefine()`,
 * because `when: () => true` is load-bearing: zod skips a refinement once an
 * earlier issue aborts the parse, and on `object-grid` and `list-view` this
 * refinement replaces a required member, whose `invalid_type` was reported
 * BESIDE every other issue on the node. Without it, a node with no object and
 * a bad `columns` would report only the `columns`. So the body reads the raw
 * input defensively — the node may be anything when it runs.
 *
 * ## `at: 'properties'` — the same rule, read where an AUTHORED block writes it
 *
 * objectui#10859 batch 5 moved the authored `object-map` arm into the spec's
 * `properties` bag (`ObjectMapBlockSchema` below), so on that arm the three
 * rungs are read INSIDE the bag: `SchemaRenderer` hoists them onto the node
 * before the renderer resolves its ladder. That arm counts the node's
 * `dataSource` binding as a source too, on the same `dataSourceSuppliesObject`
 * predicate as every other arm (the section above): the registration is
 * `elementDataSourceBlock`-wrapped, and `ElementDataSourceGate` lands the
 * binding's `object` on `objectName` before `ObjectMap` runs; the spec row keeps
 * its own `objectName` optional for exactly that reason. The default (`'node'`)
 * reads the rungs on the node, as the flat arms always have. objectui#10859
 * batch 6 moved the authored `object-gantt` arm the same way
 * (`ObjectGanttBlockSchema` below), with the same three rungs and the same
 * binding: its registration is `elementDataSourceBlock`-wrapped too.
 * objectui#12670 armed the authored page `list-view` node the same way
 * (`ListViewBlockSchema` below) with ONE rung, `data`, the spec list view's own
 * data source: `properties.objectName` is refused there by name, not counted.
 * The flat `ListViewSchema` keeps its `objectName` rung as the `ListView`
 * component's props.
 *
 * The two sections met in one merge (objectui#11117 merging objectui#10859
 * batch 5). Batch 5 counted the bag arm's binding by PRESENCE (`dataSource !==
 * undefined`); it now counts a NON-EMPTY `dataSource.object`, so the bag arm
 * refuses `dataSource: { object: '' }` with no rung, as every flat arm does
 * and as the runtime does: `isElementDataSourceConfig` refuses that binding and
 * the gate lands nothing, so the map has no record source. The bag arm also
 * gains `when: () => true` with the rest.
 */
const RECORD_SOURCE_KEYS = ['data', 'staticData', 'objectName'] as const;
type RecordSourceRung = 'bind' | 'data' | 'staticData' | 'objectName';
/**
 * `binding: 'not-read'` — for an arm whose registration is NOT gate-wrapped
 * (objectui#11168 slice 3, `object-tree`). No `ElementDataSourceGate` lands a
 * `dataSource.object` on that renderer's `objectName`, so the binding is not a
 * record source there: counting it would accept a node that draws nothing, and
 * naming it in the message would prescribe a write the renderer drops.
 */
function requireRecordSource(
  type:
    | 'object-map' | 'object-gantt' | 'object-calendar' | 'object-kanban' | 'object-grid' | 'list-view' | 'object-tree'
    | 'object-pivot' | 'embeddable-form',
  rungs: readonly RecordSourceRung[],
  at: 'node' | 'properties' = 'node',
  bindingRung: 'counts' | 'not-read' = 'counts',
) {
  const spell = (key: RecordSourceRung) => (at === 'properties' ? `properties.${key}` : key);
  const named = rungs.map((key) => `\`${spell(key)}\``);
  const declare = named.length === 1 ? named[0] : `one of ${named.slice(0, -1).join(', ')} or ${named[named.length - 1]}`;
  // In the bag the rungs are `properties.KEY`, while the binding stays on the NODE, so that
  // message says whose `dataSource` it means.
  const binding = at === 'properties'
    ? 'name the object in the node\'s `dataSource` binding (`dataSource.object`)'
    : 'name the object in `dataSource.object`';
  const message = bindingRung === 'counts'
    ? `\`${type}\` has no record source: declare ${declare}, or ${binding}`
    : `\`${type}\` has no record source: declare ${declare}`;
  const path = rungs.length === 1 ? (at === 'properties' ? ['properties', rungs[0]] : [rungs[0]]) : [];
  const refinement = (node: unknown, ctx: z.core.$RefinementCtx): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const bag = (node as { properties?: unknown }).properties;
    const holder = at === 'node' ? node : bag && typeof bag === 'object' && !Array.isArray(bag) ? bag : {};
    if (rungs.some((key) => (holder as Partial<Record<RecordSourceRung, unknown>>)[key] !== undefined)) return;
    if (bindingRung === 'counts' && dataSourceSuppliesObject(node)) return;
    ctx.addIssue({
      code: 'custom',
      // A FRESH array per issue (objectui#5250). zod copies an added issue
      // shallowly and then prefixes its `path` in place as the issue climbs out
      // of an array slot or an object key, so handing over `path` itself let the
      // first refusal reported from inside a container rewrite this arm's path
      // for every refusal after it, for the life of the module.
      path: [...path],
      params: { code: 'RECORD_SOURCE_REQUIRED' },
      message,
    });
  };
  return [refinement, { when: () => true }] as const;
}

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `ObjectMapSchema`. */
const OBJECT_MAP_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-map',
  'its `any`-typed registration hands the node to `ObjectMap`, which reads it as `ObjectMapSchema`',
  'the records of `objectName` as markers placed by `latitudeField` / `longitudeField` or `locationField`',
);

/**
 * ObjectMap Schema
 *
 * Mirrors the `ObjectMapSchema` interface in `objectql.ts` key for key. Every
 * key has a read site in `plugin-map/src/ObjectMap.tsx`; the FLAT spelling of
 * the `map` block's keys is the ObjectView/ListView flatten product and stays
 * out of this declaration (maintainer ruling on objectui#5018, 2026-08-17) —
 * except `locationField` / `titleField`, which were published before the
 * ruling and stay for compatibility.
 *
 * `objectName` is OPTIONAL and the member ends in `requireRecordSource`
 * (`77cb489b4`): `getDataConfig` reads `data`, then `staticData`, then
 * `objectName`, so a map authored on inline rows never reads the object name —
 * three catalog entries drew correctly and were refused here. Requiredness
 * moved to the refinement above, which is where the renderer actually has it.
 *
 * ## No longer an authoring arm (objectui#10859, batch 5)
 *
 * This mirror is the node as `ObjectMap` reads it: after `SchemaRenderer` has
 * hoisted the node's `properties` bag onto it, or as code composes it
 * (`ObjectView` / `ListView` flattening a stored map view). It left
 * `ObjectQLComponentSchema`, and so `AnyComponentSchema`: the AUTHORED
 * `object-map` node is armed by `ObjectMapBlockSchema` below, whose
 * `properties` is the spec's `ComponentPropsMap['object-map']` row. It stays
 * exported and paired with its TypeScript twin.
 */
export const ObjectMapSchema = BaseSchema.extend({
  type: z.literal('object-map'),
  // objectui#11070 — the spec's per-element binding, by reference; this block's
  // registration is gate-wrapped. See `ObjectGridSchema.dataSource`.
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  objectName: z.string().optional().describe('ObjectQL object name — the THIRD record source getDataConfig resolves, after data and staticData; one of the three must be present, unless the node\'s dataSource.object names the object, which ElementDataSourceGate lands here (objectui#11117)'),
  data: ViewDataSchema.optional().describe('Data source configuration — read FIRST by getDataConfig'),
  staticData: z.array(z.any()).optional().describe('Inline records — read SECOND by getDataConfig, wrapped into a { provider: value } config'),
  // objectui#6152 round 10 — the `object-map` row's own `filter` member BY
  // REFERENCE: the `ViewFilterRule` array, with the row's refusal of the
  // MongoDB-style record and the AST tuple array. It was `z.array(z.any())`. This
  // mirror is not an authoring arm (the authored node's `properties` IS the row),
  // so no authored door moves; the read stays wider (see the TS twin's member).
  filter: stripImportedDefaults(SpecObjectMapPropsSchema).shape.filter,
  sort: z.array(SortConfigSchema).optional().describe('Sort configuration, forwarded as $orderby (array only; the legacy string clause is retired — objectui#8221)'),
  map: ObjectMapConfigSchema.optional().describe('Map configuration (the author face)'),
  enableClustering: z.boolean().optional().describe('Group nearby markers into clusters'),
  navigation: stripImportedDefaults(SpecNavigationConfigSchema).optional().describe('Record navigation behaviour (drawer/dialog/page)'),
  locationField: z.string().optional().describe('Location field (internal flat form; prefer map.locationField)'),
  titleField: z.string().optional().describe('Title field (internal flat form; prefer map.titleField)'),
  mapStyle: z.string().optional().describe('MapLibre style URL/spec (overrides the public demo default)'),
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(OBJECT_MAP_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_MAP_NEITHER_CHANNEL),
}).superRefine(...requireRecordSource('object-map', RECORD_SOURCE_KEYS));

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `ObjectTreeSchema`. */
const OBJECT_TREE_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-tree',
  'its `any`-typed registration hands the node to `ObjectTree`, which reads it as `ObjectTreeSchema`; the `children` it reads belong to the record hierarchy it builds, not to this node',
  'the records of `objectName` as a hierarchy linked by `parentField` and labelled by `labelField`',
);

/**
 * ObjectTree (tree-grid) Schema
 *
 * objectui#11168 slice 3 aligned this mirror with the `object-tree` row
 * `@objectstack/spec` 17.5.0 declares, member by member, each by measurement
 * on `ObjectTree`:
 *
 *   - `objectName` is OPTIONAL and the member ends in `requireRecordSource`, as
 *     on `ObjectMapSchema` / `ObjectGanttSchema`: the renderer resolves its
 *     record source through the shared ladder (`data`, then `staticData`, then
 *     `objectName`), so a tree on inline rows never reads the object name.
 *     Required, this face refused a `staticData`-only tree that draws — and
 *     `objectui validate` prints exactly this face's verdict. The binding is
 *     NOT a rung here: the tree's registration is not gate-wrapped, so a
 *     `dataSource.object` reaches no `objectName`.
 *   - `data`, `staticData`, `tree` and `navigation` are declared, each read by
 *     the renderer. `tree` and `navigation` take the spec's own schemas by
 *     reference, so this face cannot fork from the row.
 *
 * The flat `parentField` / `labelField` / `fields` / `defaultExpandedDepth`
 * below stay as they were: the renderer still reads them, ahead of the `tree`
 * block's members of the same name. The spec row does not declare them.
 */
export const ObjectTreeSchema = BaseSchema.extend({
  type: z.literal('object-tree'),
  objectName: z.string().optional().describe('ObjectQL object name — the THIRD record source resolveRecordSourceConfig resolves, after data and staticData; one of the three must be present'),
  data: ViewDataSchema.optional().describe('Data source configuration — read FIRST by resolveRecordSourceConfig; the value and object providers draw rows, the schema provider draws none on the tree'),
  staticData: z.array(z.any()).optional().describe('Inline records — read SECOND by resolveRecordSourceConfig, wrapped into a { provider: value } config'),
  tree: stripImportedDefaults(SpecTreeConfigSchema).optional().describe('Tree field configuration (parentField, labelField, fields, defaultExpandedDepth) — the spec TreeConfig, by reference'),
  navigation: stripImportedDefaults(SpecNavigationConfigSchema).optional().describe('Row-click navigation — the spec NavigationConfig, by reference; an absent key opens nothing on a standalone tree'),
  // objectui#9549 — declared in step with the twin in `../objectql.ts`
  // (`QueryParams['$filter']`), spelled exactly as `ObjectGallerySchema.filter`
  // below spells it (objectui#9309): the two arms of that slot, ARRAY FIRST.
  // Before this the key rode `.passthrough()` unjudged, so a string or number
  // parsed clean while the renderer forwarded it into `$filter`.
  filter: z.union([
    z.array(z.any()),
    z.record(z.string(), z.any()),
  ]).optional().describe('Query filter, forwarded as $filter with its context tokens ({current_user_id}, {current_org_id}, date macros) resolved first. FilterArray (the spec array sugar) OR the ObjectQL $filter object — the two arms of QueryParams[$filter]'),
  parentField: z.string().optional().describe('Single-parent pointer field (auto-detected when omitted)'),
  labelField: z.string().optional().describe('Field rendered indented in the first column'),
  fields: z.array(z.string()).optional().describe('Additional flat columns'),
  defaultExpandedDepth: z.number().optional().describe('Default expansion depth (0 = roots only)'),
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(OBJECT_TREE_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_TREE_NEITHER_CHANNEL),
}).superRefine(...requireRecordSource('object-tree', RECORD_SOURCE_KEYS, 'node', 'not-read'));

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `ObjectGanttSchema`. */
const OBJECT_GANTT_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-gantt',
  'its `any`-typed registration hands the node to `ObjectGantt`, which reads it as `ObjectGanttSchema`',
  'the records of `objectName` as bars from `startDateField` to `endDateField`',
);

/**
 * ObjectGantt Schema
 *
 * `objectName` is OPTIONAL and the member ends in `requireRecordSource`
 * (`77cb489b4`): the shared record-source ladder `resolveRecordSourceConfig`
 * (`@object-ui/core`, called by `plugin-gantt/src/ObjectGantt.tsx`) reads
 * `data`, then `staticData`, then `objectName`, so a gantt authored on inline
 * rows never reads the object name — three catalog entries drew correctly and
 * were refused here. `data` is declared for the first time in the same stroke:
 * it is the FIRST read of that resolver and was undeclared on both faces
 * (surviving on `BaseSchema`'s index signature), which would have left the
 * refinement naming a key this mirror had never heard of. It is spelled exactly
 * as `ObjectMapSchema.data` above, so the two members' record sources cannot
 * fork.
 *
 * ## No longer an authoring arm (objectui#10859, batch 6)
 *
 * This mirror is the node as `ObjectGantt` reads it: after `SchemaRenderer`
 * has hoisted the node's `properties` bag onto it, or as code composes it
 * (`ObjectView` / `ListView` flattening a stored gantt view, which also write
 * the flat `GanttConfig` keys and the `search` pair below). It left
 * `ObjectQLComponentSchema`, and so `AnyComponentSchema`: the AUTHORED
 * `object-gantt` node is armed by `ObjectGanttBlockSchema` below, whose
 * `properties` is the spec's `ComponentPropsMap['object-gantt']` row. It stays
 * exported and paired with its TypeScript twin.
 */
export const ObjectGanttSchema = BaseSchema.extend({
  type: z.literal('object-gantt'),
  // objectui#11070 — the spec's per-element binding, by reference; this block's
  // registration is gate-wrapped. See `ObjectGridSchema.dataSource`.
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  objectName: z.string().optional().describe('ObjectQL object name — the THIRD record source resolveRecordSourceConfig resolves, after data and staticData; one of the three must be present, unless the node\'s dataSource.object names the object, which ElementDataSourceGate lands here (objectui#11117)'),
  data: ViewDataSchema.optional().describe('Data source configuration — read FIRST by resolveRecordSourceConfig'),
  startDateField: z.string().optional().describe('Start date field'),
  endDateField: z.string().optional().describe('End date field'),
  titleField: z.string().optional().describe('Title field'),
  // The legacy singular alias. Kept accepted — `getGanttConfig`'s flat branch
  // reads `dependenciesField || dependencyField` — but no longer declared as an
  // equal of the canonical key: same treatment `KanbanConfig` above gives
  // `groupField`/`cardFields`, so this adopts the ruled idiom rather than a
  // second spelling of "deprecated". The canonical `dependenciesField` is
  // declared below, BY REFERENCE to the spec (objectui#6470).
  /** @deprecated legacy alias for the spec's `dependenciesField` */
  dependencyField: z.string().optional().describe('Deprecated alias for dependenciesField'),
  progressField: z.string().optional().describe('Progress field'),
  // DERIVED from the spec's `GanttConfigSchema.shape.viewMode` (an optional
  // enum, deliberately WITHOUT a default) so the member list cannot drift
  // (objectui#5074). Absence semantics are load-bearing: an omitted `viewMode`
  // lets a persisted layout seed the timeline granularity before the
  // renderer's 'day' fallback — do NOT add `.default('day')` here.
  viewMode: stripImportedDefaults(SpecGanttConfigSchema).shape.viewMode.describe(
    'Initial timeline granularity, honoured by both renderer branches; when omitted, a persisted layout may seed it'
  ),
  // objectui#5903 — ten keys `ObjectGantt` reads and this mirror did not
  // declare. They were reachable only through `(schema as any).K`, so nothing
  // connected the read to a declaration. Mirrored here at the SAME requiredness
  // as `../objectql.ts` (all optional) so the zod-mirror-parity ratchet stays at
  // zero drift for this pair. `label` is NOT among them: `BaseSchema` already
  // declares it, so that read only needed its cast dropped.
  //
  // What declaring buys under `.passthrough()`: an undeclared key is still waved
  // through (objectui#5155's structural ceiling), but a DECLARED key is now
  // type-validated — `readOnly: 'yes'` is refused where it used to parse green.
  skipWeekends: z.boolean().optional().describe('Skip weekends in duration / auto-schedule math (working calendar)'),
  holidays: z.array(z.string()).optional().describe("Non-working dates for the working calendar, ISO 'yyyy-mm-dd' calendar days read on the chart's own calendar"),
  persistLayout: z.boolean().optional().describe('Opt OUT of layout persistence — only an explicit false disables it'),
  viewName: z.string().optional().describe("Layout-persistence scope; storage key is `objectName:viewName` (default 'default')"),
  navigation: stripImportedDefaults(SpecNavigationConfigSchema).optional().describe('Record navigation behaviour on task click (drawer/dialog/page)'),
  markers: z
    .array(
      z.object({
        date: z.string().describe('Marker position, ISO date or datetime string'),
        label: z.string().optional().describe('Text drawn against the line'),
        color: z.string().optional().describe('Line colour — any CSS colour'),
      })
    )
    .optional()
    .describe('Extra vertical reference lines drawn like the Today marker'),
  criticalPath: z.boolean().optional().describe('Seed the critical-path highlight ON (toolbar toggle stays available)'),
  showBaselines: z.boolean().optional().describe('Render planned-vs-actual baseline bars — defaults ON, only an explicit false disables'),
  readOnly: z.boolean().optional().describe('Disable every write path and lock the record drawer'),
  mobileReadOnly: z.boolean().optional().describe('Auto read-only on narrow viewports — defaults ON, only an explicit false disables'),
  // objectui#6051 — the FLATTENED `GanttConfig` face. `getGanttConfig` builds its
  // config from these top-level keys when the node carries no `gantt` block and
  // `startDateField` / `endDateField` are both present — the block OUTRANKS this
  // face (objectui#6469); nothing declared them, on either side,
  // because `BaseSchema`'s index signature admitted them untyped. Mirrored at the
  // SAME requiredness as `../objectql.ts` (all optional) so the zod-mirror-parity
  // ratchet stays at zero drift for this pair.
  //
  // The spec-modelled members are taken from `SpecGanttConfigSchema.shape` by
  // reference, exactly as `viewMode` above is, so the vocabulary cannot fork.
  colorField: stripImportedDefaults(SpecGanttConfigSchema).shape.colorField,
  dependenciesField: stripImportedDefaults(SpecGanttConfigSchema).shape.dependenciesField,
  parentField: stripImportedDefaults(SpecGanttConfigSchema).shape.parentField,
  typeField: stripImportedDefaults(SpecGanttConfigSchema).shape.typeField,
  tooltipFields: stripImportedDefaults(SpecGanttConfigSchema).shape.tooltipFields,
  baselineStartField: stripImportedDefaults(SpecGanttConfigSchema).shape.baselineStartField,
  baselineEndField: stripImportedDefaults(SpecGanttConfigSchema).shape.baselineEndField,
  groupByField: stripImportedDefaults(SpecGanttConfigSchema).shape.groupByField,
  resourceView: stripImportedDefaults(SpecGanttConfigSchema).shape.resourceView,
  assigneeField: stripImportedDefaults(SpecGanttConfigSchema).shape.assigneeField,
  effortField: stripImportedDefaults(SpecGanttConfigSchema).shape.effortField,
  capacity: stripImportedDefaults(SpecGanttConfigSchema).shape.capacity,
  quickFilters: stripImportedDefaults(SpecGanttConfigSchema).shape.quickFilters,
  autoZoomToFilter: stripImportedDefaults(SpecGanttConfigSchema).shape.autoZoomToFilter,
  // …and the ten that used to be a SECOND declaration here. objectui read them
  // through `GanttConfigSchema`'s then-open `.passthrough()` window and had to
  // model them locally (`GanttConfigExtensionFields`, objectui#6051/#6475);
  // objectstack#15469 closed the window and declared all ten upstream, so they
  // arrive by reference like every member above and the local field map is
  // retired (objectui#7845). Compared member for member before deleting: the
  // spec's declarations cover the same keys, the same `interactions`
  // (move/resize/progress/link) and `timeSegments` (dayStart/bands/showMidnight)
  // sub-shapes and the same band members, with strictly fuller describes — the
  // local copy carried no describe, alias or member the spec's lacks.
  borderColorField: stripImportedDefaults(SpecGanttConfigSchema).shape.borderColorField,
  lockField: stripImportedDefaults(SpecGanttConfigSchema).shape.lockField,
  objectField: stripImportedDefaults(SpecGanttConfigSchema).shape.objectField,
  summaryExtent: stripImportedDefaults(SpecGanttConfigSchema).shape.summaryExtent,
  defaultCollapsedDepth: stripImportedDefaults(SpecGanttConfigSchema).shape.defaultCollapsedDepth,
  dependencyTypes: stripImportedDefaults(SpecGanttConfigSchema).shape.dependencyTypes,
  timeZone: stripImportedDefaults(SpecGanttConfigSchema).shape.timeZone,
  exportFileName: stripImportedDefaults(SpecGanttConfigSchema).shape.exportFileName,
  interactions: stripImportedDefaults(SpecGanttConfigSchema).shape.interactions,
  timeSegments: stripImportedDefaults(SpecGanttConfigSchema).shape.timeSegments,
  // `gantt` — the BLOCK face `getGanttConfig`'s FIRST branch reads and prefers
  // (objectui#6469 ruled block-over-flat) — objectui#6475. It is now
  // `SpecGanttConfigSchema` itself, the same vocabulary the flat face above
  // derives from key by key, so the two authoring faces cannot fork. The
  // `.extend(GanttConfigExtensionFields)` this used to carry is gone with the
  // field map (objectui#7845): the spec declares those ten itself.
  //
  // This is the one entry among the 28 that NARROWS rather than merely names: a
  // `gantt` block previously rode through `.passthrough()` entirely unvalidated;
  // now it is PARSED against the spec's `GanttConfigSchema`, which REQUIRES
  // `startDateField`/`endDateField`/`titleField`. This mirror reached the CLI's
  // `validate` through `AnyComponentSchema` → `safeValidateSchema` (until
  // objectui#10859 batch 6; the authored node's block is now the spec row's own
  // `gantt` member, judged in `ObjectGanttBlockSchema`'s bag with the same
  // trio), so a block missing the trio moved from "accepted, then warned about
  // at runtime" to "refused at authoring time" — a `declared = enforced` restoration, not
  // new requiredness: the renderer already fed the block to
  // `GanttConfigSchema.safeParse` and logged `[ObjectGantt] Invalid gantt
  // configuration` on failure. Maintainer ruling, objectui#6475 (2026-08-27),
  // Option A: enforce as-is, no warning window (excluded by the startup-stage
  // no-gradualism rule, objectstack#12668 — no named external-user evidence).
  gantt: stripImportedDefaults(SpecGanttConfigSchema).optional().describe(
    'Nested gantt config block — the authoring face, and the winner over the flattened top-level keys whenever present'
  ),
  // The query/data keys the fetch path reads. They were declared on
  // `ObjectGridSchema` — what `ObjectGanttProps.schema` used to be typed as before
  // objectui#5903 retyped it to `ObjectGanttSchema` — so they need declaring here.
  staticData: z.array(z.any()).optional().describe('Inline records, wrapped into a { provider: value } data config — read SECOND by resolveRecordSourceConfig'),
  // objectui#6152 round 10 — the `object-gantt` row's own `filter` member BY
  // REFERENCE: the `ViewFilterRule` array, with the row's refusal of the
  // MongoDB-style record and the AST tuple array. It was `z.array(z.any())`. This
  // mirror is not an authoring arm (the authored node's `properties` IS the row),
  // so no authored door moves; the read stays wider (see the TS twin's member).
  filter: stripImportedDefaults(SpecObjectGanttPropsSchema).shape.filter,
  sort: z.array(SortConfigSchema).optional().describe('Sort configuration, forwarded as $orderby (array only; the legacy string clause is retired — objectui#8221)'),
  // objectui#10250 — the full-text pair the record query carries, declared in
  // step with the twin in `../objectql.ts`. ListView's toolbar Search writes
  // both onto a gantt node, because the chart queries for itself.
  search: z.string().optional().describe('Full-text search term, forwarded as $search (the server resolves the matched fields, ADR-0061)'),
  searchableFields: z.array(z.string()).optional().describe('Narrows the fields `search` matches, forwarded as $searchFields alongside a term'),
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(OBJECT_GANTT_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_GANTT_NEITHER_CHANNEL),
}).superRefine(...requireRecordSource('object-gantt', RECORD_SOURCE_KEYS));

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `ObjectCalendarSchema`. */
const OBJECT_CALENDAR_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-calendar',
  'its `any`-typed registration hands the node to `ObjectCalendar`, which reads it as `ObjectCalendarSchema`',
  'the records of `objectName` as events from `startDateField` to `endDateField`',
);

/**
 * objectui#8831 — ONE description for the five FLAT field-name members of
 * `ObjectCalendarSchema`, so the five cannot teach five different things.
 *
 * The flat spelling is read, not authored. `@objectstack/spec` refuses all five
 * at this element and its diagnostic names the canonical form,
 * `calendar: { startDateField, endDateField, titleField, colorField, allDayField }`
 * (one key per concept, its Prime Directive #12). The members stay declared
 * because the renderer reads them: `ObjectView` and `ListView` emit this
 * spelling on the node they build, and `getCalendarConfig` falls back to it
 * when the node has no `calendar` block. ⛔ Declared is not a licence to author
 * it; the description says where the key is written instead.
 */
function objectCalendarFlatField(what: string, key: string): string {
  return `${what} — FLAT spelling, read but not authored: the runtime handoff ObjectView/ListView emit, read by getCalendarConfig only when the node has no calendar block. Author calendar.${key} instead; the spec refuses the flat key on object-calendar (Prime Directive #12)`;
}

/**
 * ObjectCalendar Schema
 *
 * `objectName` is OPTIONAL and the member ends in `requireRecordSource`
 * (objectui#7313, the `77cb489b4` shape): the renderer resolves its records
 * through the shared ladder (`resolveRecordSourceConfig` in
 * `@object-ui/core`, `plugin-calendar/src/ObjectCalendar.tsx`) — `data`, then
 * `staticData`, then `objectName` — so a calendar authored on inline rows never
 * reads the object name, and the two static-data examples the plugin page
 * documents drew correctly and were refused here. `data` and `staticData` are
 * declared for the first time in the same stroke: they are the FIRST and SECOND
 * reads of that resolver and were undeclared on both faces (surviving on
 * `BaseSchema`'s index signature and on `.passthrough()`), which would have
 * left the refinement naming keys this mirror had never heard of. Both are
 * spelled exactly as `ObjectGanttSchema` above spells them, so the members'
 * record sources cannot fork.
 */
export const ObjectCalendarSchema = BaseSchema.extend({
  type: z.literal('object-calendar'),
  // objectui#11070 — the spec's per-element binding, by reference; this block's
  // registration is gate-wrapped. See `ObjectGridSchema.dataSource`.
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  objectName: z.string().optional().describe('ObjectQL object name — the THIRD record source resolveRecordSourceConfig resolves, after data and staticData; one of the three must be present (objectui#7313), unless the node\'s dataSource.object names the object, which ElementDataSourceGate lands here (objectui#11117)'),
  // objectui#9239 — the ARRAY arm, mirroring `ComponentPropsMap['object-calendar'].data`
  // on `@objectstack/spec` (`z.array(z.unknown()).optional()`, "Pre-fetched
  // records — skips the internal fetch"). ⛔ NOT `ViewDataSchema`: this member
  // declared the provider BLOCK until that card while the protocol declared an
  // array, so `safeValidateSchema` returned a green verdict for a document the
  // protocol, `os validate`, the save gate and (since objectui#8348) the
  // renderer all refuse. Maintainer ruling, decision batch #83 (2026-09-08),
  // verbatim 「8348 以协议为准」, and the standing lane arbiter 「以 objectstack
  // 协议为准，文档应该以实际实现为准。协议不正确的应该先修改协议」.
  //
  // ⛔ `ObjectMapSchema.data` / `ObjectGanttSchema.data` above are NOT following:
  // neither block has a `ComponentPropsMap` row, so the published row governing
  // them is this file's own `ViewDataSchema.optional()` and it stays.
  //
  // Mirrored at the SAME requiredness as `../objectql.ts` (both optional) so the
  // zod-mirror-parity ratchet stays at zero drift for this pair, and at the same
  // TYPE: the TS face derives `SpecObjectCalendarProps['data']`, whose input is
  // `unknown[]`, which is exactly what `z.array(z.unknown())` infers here.
  data: z.array(z.unknown()).optional().describe('Pre-fetched records — an ARRAY, drawn in place of the calendar\'s own query; read FIRST by the record-source ladder. Mirrors ComponentPropsMap[\'object-calendar\'].data — the { provider, items } config object is refused by kind on this block (objectui#9239, ruling objectui#8348)'),
  staticData: z.array(z.any()).optional().describe('Inline records, wrapped into a { provider: value } data config — read SECOND by resolveRecordSourceConfig'),
  // objectui#8651 — the configuration container the SPEC declares for this
  // element (`ComponentPropsMap['object-calendar'].calendar`), which this
  // package's registration `inputs` already publishes and which
  // `ObjectCalendar.tsx`'s `getCalendarConfig` reads FIRST, ahead of the flat
  // members below. Neither published face of this package named it: it rode
  // `BaseSchema`'s `.passthrough()` here and its `[key: string]: any` on the TS
  // side — admitted, never examined — so `calendar: 42` and
  // `calendar: { startDateField: 42 }` both parsed green and then produced a
  // calendar that drew nothing.
  //
  // The exit is the mechanical one triage ruled for this family (objectui#8327,
  // comment 5619610246): the key IS declared by `@objectstack/spec`, so this
  // mirror aligns to it rather than forking the contract. Mirrored at the SAME
  // requiredness as `../objectql.ts` (both optional) so the zod-mirror-parity
  // ratchet stays at zero drift for this pair, exactly as the `filter`/`sort`
  // and `colorField`/`allDayField` pairs below.
  //
  // objectui#8831 — this container is the AUTHORED spelling of the five
  // field-name keys. `ComponentPropsMap['object-calendar']` refuses them FLAT
  // and its own diagnostic prescribes
  // `calendar: { startDateField, endDateField, titleField, colorField, allDayField }`,
  // so this description names the container as the place to write them, and
  // the five flat members below describe themselves as the runtime handoff.
  //
  // objectui#6152 round 9 — the container's SHAPE is the row's own slot now,
  // by reference: strict, `startDateField` required (see
  // `ObjectCalendarBlockConfigSchema` above). The `calendar` key itself stays
  // optional on both faces, as before.
  calendar: ObjectCalendarBlockConfigSchema.optional().describe('Calendar configuration container, and the AUTHORED spelling of the five field-name keys: startDateField (required), endDateField, titleField, colorField, allDayField; any other key is refused, as ComponentPropsMap[\'object-calendar\'].calendar refuses it. Read FIRST by getCalendarConfig, ahead of the flat members, which are the runtime handoff and not a second authorable spelling'),
  startDateField: z.string().optional().describe(objectCalendarFlatField('Start date field', 'startDateField')),
  endDateField: z.string().optional().describe(objectCalendarFlatField('End date field', 'endDateField')),
  // ⭐ objectui#8355 — the FLAT spelling the retired ladder actually read, and
  // the one position where an unrefused alias is worst: `BaseSchema` ends
  // `.passthrough()`, so the key was KEPT, carried into the renderer, and — with
  // the ladder gone — ignored. Declared and unwritable, it is refused BY NAME
  // instead. `z.input` is `undefined`, so `../objectql.ts` carries the matching
  // `?: never` twin and `tsc` refuses the key at the authoring site too.
  dateField: CalendarNodeDateAliasRefusals.dateField,
  endField: CalendarNodeDateAliasRefusals.endField,
  titleField: z.string().optional().describe(objectCalendarFlatField('Title field', 'titleField')),
  // objectui#8466 — the last two members of the FLAT field-name face, which
  // `ObjectCalendar.tsx`'s `getCalendarConfig` reads bare off the node. When
  // that card landed, `plugin-calendar/README.md` taught them as authorable;
  // since objectui#8831 it teaches the `calendar` container instead, and the
  // flat members stay declared because the renderer still reads them. Neither
  // published face of this package named them: they rode `BaseSchema`'s
  // `[key: string]: any` on the TS side and its `.passthrough()` here —
  // admitted, never examined, so a misspelling left the calendar silently
  // colourless while every published gate passed.
  //
  // Mirrored at the SAME requiredness as `../objectql.ts` (both optional) so
  // the zod-mirror-parity ratchet stays at zero drift for this pair, exactly as
  // the `filter`/`sort` pair above.
  //
  // ⛔ Neither key is added to `plugin-calendar`'s registration `inputs`, and
  // that asymmetry is deliberate: `ComponentPropsMap['object-calendar']`
  // refuses all five flat keys with `unrecognized_keys`, so declaring them
  // THERE would redden the FORWARD direction of
  // `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`.
  // `titleField`/`startDateField`/`endDateField` have shipped declared here, and
  // absent from `inputs`, for releases. What the five declarations record is a
  // READ, not an authoring lane (objectui#8831): `ObjectView`/`ListView` emit
  // this spelling on the node they build, and `getCalendarConfig` falls back to
  // it only when the node carries no `calendar` block.
  colorField: z.string().optional().describe(objectCalendarFlatField('Field carrying the per-record event colour — a CSS colour or a semantic palette name', 'colorField')),
  allDayField: z.string().optional().describe(objectCalendarFlatField('Field carrying the all-day flag, LOAD-BEARING since objectui#8026', 'allDayField')),
  defaultView: z.enum(['month', 'week', 'day']).optional().describe("Default view — 'month' | 'week' | 'day', the renderer's rendered set ('agenda' was retired)"),
  // objectui#8174 — the two query keys `ObjectCalendar.tsx` lowers onto its own
  // `dataSource.find` (`$filter: schema.filter`,
  // `$orderby: convertSortToQueryParams(schema.sort)`). The spec declares both
  // on `ComponentPropsMap['object-calendar']` and the plugin's registration
  // `inputs` publishes both, but neither published face of THIS package named
  // them: they rode `BaseSchema`'s `.passthrough()` here and its
  // `[key: string]: any` on the TS side. Spelled as `ObjectGanttSchema` above
  // spelled them then (`filter` has since moved to the row, objectui#6152 round
  // 8, below), and mirrored at the SAME requiredness as `../objectql.ts` (both
  // optional) so the zod-mirror-parity ratchet stays at zero drift for this pair.
  //
  // What declaring buys under `.passthrough()` is NOT capped by objectui#7927's
  // index-signature ceiling: that ceiling is about a MISSPELLED key, which
  // stays admitted either way. A DECLARED key is now VALUE-validated, and this
  // mirror reaches `safeValidateSchema` through `AnyComponentSchema` and so
  // reaches the CLI's `validate` — `sort: 'name asc'`, the string
  // clause objectui#8221 retired, moves from "parses green here, then silently
  // dropped by `convertSortToQueryParams` at runtime" to "refused at authoring
  // time".
  //
  // objectui#6152 round 8 — `filter` is no longer spelled as the gantt's: it is
  // the `object-calendar` row's own member BY REFERENCE, the `ViewFilterRule`
  // array, with the row's refusal of the MongoDB-style record and the AST tuple
  // array (`z.array(z.any())` admitted both). The TS twin takes the same member.
  filter: stripImportedDefaults(SpecObjectCalendarPropsSchema).shape.filter,
  sort: z.array(SortConfigSchema).optional().describe('Sort configuration, forwarded as $orderby (array only; the legacy string clause is retired — objectui#8221)'),
  // objectui#8652 — ruling B, verbatim 「B」: `navigation` is declared on the
  // platform element schema first (`ComponentPropsMap['object-calendar']`,
  // `@objectstack/spec` 17.5.0), then mirrored here BY REFERENCE, spelled as
  // the gantt and map arms above spell it. Until this card it rode
  // `BaseSchema`'s `.passthrough()`: `navigation: { mode: 'not-a-mode' }`
  // parsed green here while the spec's own element schema refused it. The
  // import-boundary strip keeps the spec's `mode: 'page'` default out of a
  // parsed document, so the renderer's own `{ mode: 'drawer' }` fallback for
  // an ABSENT key still applies (objectui#8317). Mirrored at the SAME
  // requiredness as `../objectql.ts` (optional), so the zod-mirror-parity
  // ratchet stays at zero drift for this pair.
  navigation: stripImportedDefaults(SpecNavigationConfigSchema).optional().describe('Event-click navigation behaviour (drawer/modal/split/popover/page/new_window/none), the same block ListViewSchema.navigation declares; the renderer defaults an absent key to a drawer'),
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(OBJECT_CALENDAR_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_CALENDAR_NEITHER_CHANNEL),
}).superRefine(...requireRecordSource('object-calendar', RECORD_SOURCE_KEYS));

/**
 * ObjectKanban Schema
 */
/**
 * The guidance a retired kanban rule key is refused with (objectui#11522).
 *
 * `native` keys belong to the native `{ field, operator, value }` comparison;
 * `colour` keys are a colour written at the TOP LEVEL of a rule — beside a CEL
 * `condition` (the "flat CEL" rule) or on the native comparison. Each message
 * names the key, the retirement and the one spelling that replaces it.
 */
function kanbanRuleKeyRetired(key: string, kind: 'native' | 'colour'): string {
  const lead =
    kind === 'native'
      ? `\`${key}\` belongs to the native kanban rule dialect \`{ field, operator, value, backgroundColor, borderColor }\`, `
      : `\`${key}\` is a colour written at the top level of the rule, `;
  const into = key === 'textColor' ? '`style: { color }`' : `\`style: { ${key} }\``;
  return (
    lead
    + 'which `object-kanban`\'s `conditionalFormatting` no longer accepts: RETIRED (objectui#11522), with no alias window. '
    + 'A rule is `{ condition, style }` — a CEL `condition` over `record.*` and a CSS `style` map, the rule '
    + '`@objectstack/spec`\'s `ListViewSchema.conditionalFormatting` declares. '
    + (kind === 'native'
      ? 'Respell `{ field: \'priority\', operator: \'equals\', value: \'high\', backgroundColor: \'#fee2e2\' }` as '
        + '`{ condition: "record.priority == \'high\'", style: { backgroundColor: \'#fee2e2\' } }` '
        + '(`not_equals` is `!=`, `contains` is `.contains(…)`, `in` is `record.f in [ … ]`).'
      : `Move the colour into the rule's CSS map: ${into}.`)
  );
}

// objectui#11522 — `object-kanban`'s `conditionalFormatting` speaks ONE rule
// dialect, the spec list view's `{ condition, style }`, and refuses the two it
// used to take BY NAME (triage ruling 5963861071: retire, not widen).
//
// The rule is the protocol's own: `ListViewSchema.conditionalFormatting[]`'s
// element, read BY REFERENCE through the import boundary and `.extend()`-ed —
// so it inherits that element's strictness (an undeclared key is refused with
// the spec's own "Unrecognized key(s) on this conditional formatting rule"
// message) and its `style` map, and moves with the installed spec. Two things
// are layered on top, and only two:
//
//   - `condition` is `SpecRuleConditionSchema`, the list view's and the grid's
//     own condition (objectui#10946): the spec slot by reference behind a
//     `z.string()` arm, so a string condition is not canonicalized into an
//     envelope and `''` is still accepted — the kanban rule judges a condition
//     exactly as the list view's `{ condition, style }` rule does.
//   - the retired keys are DECLARED and unwritable (`retirementTombstone()`),
//     so each is refused at its own path with the remedy instead of being one
//     more unrecognized key: the native comparison's `field` / `operator` /
//     `value`, and the three top-level colour keys the shared resolver
//     (`resolveConditionalFormatting`) would otherwise still paint with —
//     `backgroundColor` and `borderColor` (the native rule's, and the flat CEL
//     rule's), and `textColor`. `z.input` of each is `undefined`, which is the
//     TS twin's `?: never`.
//
// Before this, the member was a union of the native comparison and the spec
// shape (#1584), exported by objectui#7664 for the since-retired `'kanban'`
// arm. ⚠️ The shared resolver is NOT narrowed: since objectui#11533 no authored
// rule declares the native arms (the grid's and the list view's rule,
// `ConditionalFormattingRuleSchema` above, retired them too), but a rule STORED
// in that dialect still reaches the resolver, which keeps every arm as a
// compatibility read — so the board itself still paints whatever a relay hands
// it. What retired is the AUTHORED kanban member. Its TS twin is
// `KanbanConditionalFormattingRule` (`../objectql.ts`); the two faces are
// pinned equal in `../__tests__/kanban-conditional-formatting.test.ts`. The
// element it extends, `SpecListViewRuleSchema`, is declared above the grid's
// mirror, which reads it first.
export const KanbanConditionalFormattingRuleSchema = SpecListViewRuleSchema.extend({
  condition: SpecRuleConditionSchema.describe('CEL predicate evaluated against the card record'),
  field: retirementTombstone(kanbanRuleKeyRetired('field', 'native')),
  operator: retirementTombstone(kanbanRuleKeyRetired('operator', 'native')),
  value: retirementTombstone(kanbanRuleKeyRetired('value', 'native')),
  backgroundColor: retirementTombstone(kanbanRuleKeyRetired('backgroundColor', 'colour')),
  borderColor: retirementTombstone(kanbanRuleKeyRetired('borderColor', 'colour')),
  textColor: retirementTombstone(kanbanRuleKeyRetired('textColor', 'colour')),
});

/**
 * The `object-kanban` board has a record source — at least one of `bind`,
 * `data`, `objectName` is present (objectui#7780), or the node's
 * `dataSource.object` names the object (objectui#11117).
 *
 * ⚠️ `requireRecordSource` above, with THIS board's rung list — not the
 * `object-map` / `object-gantt` / `object-calendar` one. Those rungs are
 * `data` (a `ViewData` PROVIDER BLOCK) → `staticData` → `objectName`, resolved
 * by the shared `resolveRecordSourceConfig` in `@object-ui/core`. This board
 * walks a DIFFERENT ladder in `plugin-kanban/src/ObjectKanban.tsx`: the
 * pre-fetched `data` PROP → `useDataScope(schema.bind)` → the inline ROW ARRAY
 * on `schema.data` → a fetch keyed by `schema.objectName`
 * (`rawData = external || boundData || schema.data || fetchedData`, the fetch
 * gated on `schema.objectName && !boundData && !schema.data`). It has NO
 * `staticData` rung and it HAS a `bind` rung, so the two key sets are neither
 * equal nor nested and one key list cannot serve both — which is why
 * `requireRecordSource` takes the rung list per arm (objectui#11117) rather
 * than this board carrying a hand copy of the predicate, as it did until then.
 * objectui#7651 (ruled B, closed `not_planned`) refuses giving this board the
 * shared RUNTIME ladder; this refinement describes the ladder that is already
 * there rather than adding one. The binding rung is the gate's, not the
 * board's: `ElementDataSourceGate` lands `dataSource.object` on `objectName`
 * before `ObjectKanban` reads the node, so the fetch rung is what it feeds.
 *
 * The pre-fetched `data` PROP is NOT a key here: it is a React prop
 * (`ObjectKanbanComponentProps.data`, passed by a parent such as `ListView`),
 * not something an author writes on the node, so it can neither be declared
 * nor required.
 *
 * `bind` and `data` are `BaseSchema` members on BOTH faces — declared once, on
 * the base, as optional members (`base.zod.ts` here, `../base.ts` there) and
 * INHERITED by this member rather than restated on it. So this refinement names
 * no key its own mirror has never heard of, the property objectui#7313 had to
 * buy by declaring `data` / `staticData` first, and it names no key this
 * member re-declares — `base-bind-declared.test.ts` (objectui#6357) keeps the
 * `bind` declaration single, and the identity assertion in
 * `__tests__/object-kanban-record-source-7780.test.ts` keeps both inherited.
 *
 * Presence is `!== undefined`, matching the sibling predicate's wording rather
 * than the renderer's truthiness: `objectName: ''` validated before this card
 * and still does, so the accept set only WIDENS. The one shape refused here
 * (none of the three present) was refused before too, when `objectName` was
 * required — see the before/after table in
 * `__tests__/object-kanban-record-source-7780.test.ts`.
 *
 * ⛔ `groupBy` is NOT a rung: a record source and a lane key are different
 * questions (objectui#7322, PR #7774; `groupBy` itself is optional since
 * objectui#8990). The `dataSource` json fragment in
 * `content/docs/utilities/data-objectstack.mdx` — `{ type, dataSource }`, no
 * `groupBy` and none of the three rungs — parses since objectui#11117, on the
 * binding rung.
 *
 * Carries `params.code` so a consumer keys off the finding rather than
 * string-matching the message, and reports at the ROOT path (`[]`): no single
 * key is at fault when all three are absent, and blaming `objectName` would
 * re-teach the requiredness this card removes.
 *
 * The rung list is a private `const` and the refinement is
 * `requireRecordSource`, a `function`: the parity census in
 * `__tests__/zod-mirror-parity.test.ts` reads `^export const` out of this
 * directory and would demand a registered TS counterpart for either.
 */
/**
 * The `object-kanban` SWIMLANE element (objectui#8913) — the mirror half of
 * `ObjectKanbanSchema.columns` in `../objectql.ts`, whose docblock carries the
 * measurements. Private on purpose: it publishes no new symbol, so the
 * `zod-mirror-parity` census (which pairs `^export const` mirrors with a TS
 * declaration) has nothing new to register, exactly as `requireRecordSource`
 * is a `function` for the same reason.
 *
 * ⭐ Both arms, because `@objectstack/spec` admits both. Its
 * `ObjectKanbanPropsSchema.columns` is `z.array(z.unknown()).optional()` and
 * states the shape in its `describe` prose — "{ id, title } per `groupBy`
 * value, or bare value strings". Admitting only the object arm would make this
 * repository NARROWER than the protocol, which the maintainer principle in
 * force forbids (2026-09-09, verbatim, untranslated):
 * 「我们的项目以 objectstack 协议为准，文档应该以实际实现为准。协议不正确的应该先修改协议。」
 *
 * ⛔ Both arms WHOLE, not per element: `columns` is a UNION OF TWO ARRAYS, and
 * a MIXED array is refused. objectui#8913's first cut spelled it
 * `z.array(z.union([...]))` and so admitted a mix. `effectiveColumns` dispatches
 * on `columns[0]` alone, so an object-first mix pushes every string element
 * through the object branch and a string-first mix is ignored whole; measured
 * on the real bucketer with `[{ id: 'done', title: 'Done' }, 'todo']` the lanes
 * are `done:r2, undefined:, __uncolumned__:r1` — a blank lane whose own keys
 * are `["0","1","2","3","cards"]` and the `todo` record in "Uncategorized".
 * The protocol names no mixed example. A declaration that admits a shape the
 * renderer mishandles is the defect this card removes, so it is refused here.
 *
 * ⭐ The STRING arm is REACHABLE since objectui#8990. The renderer's string
 * branch returns only under `if (!schema.groupBy)`, and `groupBy` was required
 * on this face — so objectui#8913 admitted the arm (refusing it would have
 * been a second narrowing) while recording that nothing could reach it.
 * objectui#8990 made `groupBy` OPTIONAL, and a `groupBy`-less board with
 * `columns: ['todo', 'doing']` now parses AND draws those two lanes, titled by
 * the RAW strings rather than the picklist labels a grouped board would show.
 * ⚠️ Reachable is not populated — a lane-less board holds zero cards, because
 * `bucketCardsIntoColumns` returns before distributing records when there is
 * no lane key.
 *
 * ⛔ NOT `KanbanColumnSchema`, whose `cards` is REQUIRED: that mirror is the
 * RUNTIME lane (`bucketCardsIntoColumns` fills `cards` before `KanbanImpl`
 * sees it), and requiring it here would refuse the protocol's own
 * gate-validated `{ id, title }` example, the lanes the renderer materializes
 * from a picklist, and this repository's own typed board fixtures. `cards` is
 * therefore optional and the two mirrors stay separate rather than one being
 * derived from the other — the faces genuinely differ, and a derivation would
 * make a future edit to the retired arm's lane silently move this one.
 *
 * `cards` reuses `KanbanCardSchema` (`./complex.zod.ts`) rather than restating
 * it: the card vocabulary has one authority, and reaching it is what restores
 * the judging `240b80f31` established — a lane card with no `title` is refused again.
 */
const ObjectKanbanLaneSchema = z.object({
  id: z.string().describe('Lane id — matched against the groupBy value. STRING only, and the narrowing stands on its own: until objectui#8993 the bucketer built knownIds from the raw col.id and compared it with Object.keys(groups), which are strings, so a numeric id bucketed every card TWICE; the sweep now keys membership the way the injection always did'),
  title: z.string().describe('Lane heading, localized against the groupBy picklist option labels'),
  cards: z.array(KanbanCardSchema).optional().describe('Cards this lane carries — a STATIC board only; an object-bound board buckets records into the lane by groupBy'),
  limit: z.number().optional().describe('WIP limit — the card count at which the lane warns; never reaches the query'),
  className: z.string().optional().describe('Lane class name'),
  collapsed: z.boolean().optional().describe('Whether the lane renders collapsed — narrowed to a title spine with its cards withheld, and reopenable by the viewer; the authored value is the initial state'),
});

const KANBAN_RECORD_SOURCE_KEYS = ['bind', 'data', 'objectName'] as const;

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `ObjectKanbanSchema`. */
const OBJECT_KANBAN_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-kanban',
  'its `any`-typed registration hands the node to `ObjectKanban`, which reads it as `ObjectKanbanSchema`',
  'the records of `objectName` as lanes grouped by `groupBy`, with `cardFields` on each card',
);

// objectui#7322 — `groupBy` and `limit` are the keys `ObjectKanban.tsx` reads
// (thirteen `schema.groupBy` sites; the row cap lowered into the query as
// `$top: resolveRowLimit(schema.limit, DEFAULT_KANBAN_FETCH_BATCH_SIZE)`, re-spelled by
// objectui#9925); until this card neither was declared and both rode
// `BaseSchema`'s `.passthrough()` unexamined, while the REQUIRED `groupField`
// had zero read sites. `groupField` is now a `retirementTombstone()` — still
// a member, so the parity ratchet's key sets stay equal and an authored value
// is refused BY NAME rather than stripped — and it is node-local: the
// VIEW-LEVEL alias `KanbanConfig.groupField` above is live and untouched.
export const ObjectKanbanSchema = BaseSchema.extend({
  type: z.literal('object-kanban'),
  // objectui#11070 — the spec's per-element binding, by reference; see
  // `ObjectGridSchema.dataSource`.
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  objectName: z.string().optional().describe('ObjectQL object name — the LAST rung of the board ladder, after the pre-fetched data prop, bind and the inline row array on data; one of bind, data, objectName must be present (objectui#7780), unless the node\'s dataSource.object names the object, which ElementDataSourceGate lands here (objectui#11117)'),
  // objectui#8990 — OPTIONAL, mirroring `@objectstack/spec`
  // (`ObjectKanbanPropsSchema.groupBy` is `z.string().optional()`). Required
  // here until this card, so this validator refused a document the protocol
  // accepts — including this repo's own documented `{ type, dataSource }`
  // board (`content/docs/utilities/data-objectstack.mdx`) and the node
  // `plugin-list/src/ListView.tsx` generates when a view declares no lane
  // field (`groupBy: laneField`, `laneField = … || undefined`). Requiredness
  // is the ONLY thing that moved; the measured behaviour of a lane-less board
  // (lanes drawn, ZERO cards, moves inert) is reasoned on the TS twin.
  groupBy: z.string().optional().describe('Field whose value places a record in a lane — the lane key the object-kanban renderer reads (ObjectKanban.tsx, thirteen sites). Optional, as @objectstack/spec declares it: a board with no lane key renders its declared lanes and holds no cards, since the bucketer needs a key to distribute records'),
  groupField: retirementTombstone('RETIRED (objectui#7322) — `groupField` is not read by the object-kanban renderer; author `groupBy`. (The view-level `kanban.groupField` alias is unaffected.)'),
  // objectui#8913 — the lane vocabulary the renderer reads and neither face
  // named. Mirrors `../objectql.ts` member for member; the element union, the
  // optional `cards` and the reason this is not `KanbanColumnSchema` are
  // reasoned on `ObjectKanbanLaneSchema` above and on the TS twin.
  columns: z.union([z.array(z.string()), z.array(ObjectKanbanLaneSchema)]).optional()
    .describe('Swimlane definitions — EITHER an array of { id, title } lanes per groupBy value OR an array of bare value strings; NOT a field projection (the fields drawn on a card are cardFields), and not a mix of the two, which the renderer cannot dispatch'),
  limit: z.number().int().positive().optional().describe('Row cap — the most records the board fetches, sent as a real $top on the query; default 100 (DEFAULT_KANBAN_FETCH_BATCH_SIZE)'),
  // objectui#8174 — the query key `ObjectKanban.tsx` lowers onto its own
  // `dataSource.find` (`$filter: schema.filter`), alongside the `$top` that
  // `limit` above feeds. Same position `groupBy` and `limit` were in before
  // objectui#7322: declared by the spec (`ComponentPropsMap['object-kanban']`)
  // and by the plugin's registration `inputs`, read by the renderer, and named
  // by neither published face of this package. Spelled as `ObjectGanttSchema`
  // above spelled it then (it has since moved to the row, objectui#6152 round 8,
  // below), and mirrored at the SAME requiredness as `../objectql.ts` (optional)
  // so the zod-mirror-parity ratchet stays at zero drift for this pair.
  //
  // ⚠️ No `sort` twin here: the spec's `object-kanban` entry declares no
  // top-level `sort`. `ObjectKanban.tsx` reads `schema.sort` only as the
  // `ElementDataSourceGate` carrier for the binding's `dataSource.sort`
  // (objectui#10068). Only `ObjectCalendarSchema` above carries both.
  //
  // objectui#6152 round 8 — no longer spelled as the gantt's: the
  // `object-kanban` row's own `filter` member BY REFERENCE, the `ViewFilterRule`
  // array, with the row's refusal of the MongoDB-style record and the AST tuple
  // array (`z.array(z.any())` admitted both), as `ObjectCalendarSchema` takes its own.
  filter: stripImportedDefaults(SpecObjectKanbanPropsSchema).shape.filter,
  // objectui#9606 — the CANONICAL card-title spelling, declared beside the
  // legacy alias below exactly as `@objectstack/spec` declares the pair on
  // `ObjectKanbanPropsSchema` (`cardTitle` first, `titleField` as its fallback).
  // Until this card `cardTitle` was the ONLY one of the two this mirror did not
  // name: it rode `BaseSchema`'s `.passthrough()` unjudged, so
  // `safeValidateSchema({ type: 'object-kanban', … cardTitle: 42 })` succeeded
  // AND KEPT the `42`, which `resolveKanbanTitleField` then returned as a record
  // field name — while the protocol's own `ObjectKanbanPropsSchema` refused the
  // same document. The key authors are told to prefer was the unjudged one.
  //
  // ⛔ `titleField` is NOT retired here (director seat, batch #150 item 3,
  // letter 1): a mirror may not be narrower than the spec it mirrors, and the
  // spec still declares the alias. Retiring it starts in `@objectstack/spec`.
  //
  // Mirrored at the SAME requiredness as `../objectql.ts` (optional), so the two
  // faces accept and refuse the same documents, and the describe text is the
  // spec's own, carried over rather than paraphrased.
  //
  // ⚠️ The zod-mirror-parity ratchet is NOT what holds that pair together, and
  // this comment claimed it was until the claim was measured: declare the key
  // here, delete the twin's member, and `type-check` still exits 0. The ratchet
  // measures declared-but-unmirrored and has no operator for the reverse
  // (objectui#9711). The twin's member is defended instead by the
  // `@ts-expect-error` row in
  // `../__tests__/object-kanban-card-title-9606.test.ts`.
  cardTitle: z.string().optional().describe('Field rendered as each card title — the canonical spelling; `titleField` beside it is the legacy fallback, and the board reads `cardTitle || titleField`'),
  titleField: z.string().optional().describe('Title field'),
  cardFields: z.array(z.string()).optional().describe('Card fields'),
  // objectui#11355 — declared on both faces, as `@objectstack/spec`'s
  // `ComponentPropsMap['object-kanban']` row declares it (an optional string).
  // Until then `.passthrough()` kept an authored value unjudged.
  swimlaneField: z.string().optional().describe('Record field that splits the board into horizontal swimlanes, across the groupBy columns; when absent the board falls back to grouping.fields[0].field'),
  // objectui#11216 — `swimlaneField`'s fallback, declared as the spec's
  // `ComponentPropsMap['object-kanban']` row declares it: the list view's own
  // `GroupingConfigSchema`, BY REFERENCE, spelled as `ObjectGridSchema.grouping`
  // spells it. Until this card the key was undeclared here, so the strict face
  // refused a well-formed config by name while the tolerant face kept any value
  // unjudged — including the padded field name, bare string, empty `fields`
  // list and undeclared inner key the spec row refuses. The import-boundary
  // strip keeps the spec's `order` / `collapsed` defaults out of a parsed
  // document. `ObjectKanban` reads `fields[0].field` and nothing else, which the
  // registration's input description states.
  grouping: stripImportedDefaults(SpecGroupingConfigSchema).optional().describe('Swimlane fallback: the spec GroupingConfig, by reference. The board reads grouping.fields[0].field as the swimlane field when swimlaneField is absent; every other position is inert on this board'),
  // objectui#8285 — RETIRED on this arm (ruling B, director seat decision batch
  // #91, 2026-09-08), aligned with `@objectstack/spec` 17.5.0, whose
  // `ComponentPropsMap['object-kanban']` tombstones the same key. A tombstone
  // rather than a deleted member for the reason `groupField` above gives:
  // `BaseSchema` ends `.passthrough()`, so a deleted member is KEPT. The TS
  // twin in `../objectql.ts` carries the reading.
  quickAdd: retirementTombstone(
    '`quickAdd` is RETIRED on `object-kanban` (objectui#8285) — this board offers no inline ' +
      'record creation. The Quick Add control is gated on BOTH `quickAdd` and an `onQuickAdd` ' +
      'handler, which is a host-supplied function no JSON document can carry, and the board ' +
      'supplies none of its own, so the key never drew anything here; `@objectstack/spec` ' +
      'retired it from `object-kanban` too. Delete the key. The Quick Add pair still works on ' +
      'the `KanbanRenderer` component of `@object-ui/plugin-kanban`, which a React host mounts ' +
      'directly and hands `onQuickAdd` to.',
  ),
  coverImageField: z.string().optional().describe('Field name for cover image on cards'),
  // objectui#8801 — RETIRED on this arm (ADR-0049; director seat, class-1
  // self-adjudication of 2026-09-16, letter A). Zero read sites under
  // `@object-ui/plugin-kanban`, and both channels a key can travel WITHOUT
  // being named terminate before any sink: `ObjectKanban` discards its rest
  // props (`void _props;`), and `KanbanRenderer` names every key it forwards
  // to the lazy board. The TS twin in `../objectql.ts` carries the full
  // reading, including why the remedy is a deletion rather than a rename.
  //
  // A tombstone rather than a deleted member because `BaseSchema` ends
  // `.passthrough()`: dropping the key would KEEP an authored value instead
  // of refusing it, trading one silent no-op for another, and would also move
  // this mirror's key set away from the declaration's for the parity ratchet.
  allowCollapse: retirementTombstone(
    '`allowCollapse` is RETIRED (objectui#8801, ADR-0049) — it was declared on both faces of the ' +
      '`object-kanban` arm and read by NO registered board, so an authored `true` validated green ' +
      "and collapsed nothing. `@objectstack/spec`'s `ComponentPropsMap['object-kanban']` never " +
      'declared the key and refuses it by name at publish, so a document carrying it was already ' +
      'being rejected whole. Lane collapse is `KanbanColumn.collapsed`’s — a PER-LANE member — not ' +
      'a board-level authored toggle: write it on the lane you want collapsed, inside `columns`, and ' +
      'the board honours it (objectui#9628). SWIMLANE collapse stays the VIEWER’s: `KanbanImpl` ' +
      'collapses a swimlane row when its header is clicked and persists that per `swimlaneField`. ' +
      'Delete the key; there is no board-level replacement to rename it to.',
  ),
  conditionalFormatting: z.array(KanbanConditionalFormattingRuleSchema).optional().describe('Card conditional formatting rules'),
  // objectui#8652 — ruling B, verbatim 「B」: `navigation` is declared on the
  // platform element schema first (`ComponentPropsMap['object-kanban']`,
  // `@objectstack/spec` 17.5.0), then mirrored here BY REFERENCE, spelled as
  // the gantt and map arms above spell it. Until this card it rode
  // `BaseSchema`'s `.passthrough()`: `navigation: { mode: 'not-a-mode' }`
  // parsed green here while the spec's own element schema refused it. The
  // import-boundary strip keeps the spec's `mode: 'page'` default out of a
  // parsed document, so the renderer's own `{ mode: 'drawer' }` fallback for
  // an ABSENT key still applies (objectui#8317). Mirrored at the SAME
  // requiredness as `../objectql.ts` (optional), so the zod-mirror-parity
  // ratchet stays at zero drift for this pair.
  navigation: stripImportedDefaults(SpecNavigationConfigSchema).optional().describe('Card-click navigation behaviour (drawer/modal/split/popover/page/new_window/none), the same block ListViewSchema.navigation declares; the renderer defaults an absent key to a drawer'),
  // ── `5a41ce733` — the three handler keys `KanbanRenderer` reads off the
  // document this arm judges, MEASURED one at a time (director seat ruling of
  // 2026-09-07, decision batch #69: the arm a `type` selects is the contract
  // for what renders under it, and a registered renderer may not read a key the
  // arm does not declare).
  //
  // Until here they were declared by NOTHING. `BaseSchema` is `.passthrough()`,
  // so an authored `onCardClick: { action: 'toast' }` was not refused — it
  // stopped being judged, the value was KEPT, and it was handed to a call site
  // expecting a function. That is objectui#7664's measured transition; the
  // three sat on the bare `kanban` arm as objectui#6124 RUNTIME SLOTS until
  // objectui#8802 retired that arm, and the surviving `object-kanban` face
  // inherited the reads without the declarations.
  //
  // ⛔ The three do NOT share a disposition, and sharing one because they share
  // a prefix is the error this ruling forbids. The per-key channel readings and
  // the drive that separates them are in `@object-ui/plugin-kanban`'s
  // `__tests__/handlerKeyDispositionsMeasured-7804.test.tsx`; the twin
  // docblocks in `../objectql.ts` carry the reasons member by member.
  //
  // ⚠️ The three do NOT share a disposition, and they never did. `onCardClick`
  // is a RUNTIME SLOT, whose function value reaches the board on this face.
  // `onCardMove` is a TOMBSTONE, and reading it as a slot because it shares the
  // prefix is the error batch #69 forbids. Its authored value was measured to
  // reach NOTHING here — `ObjectKanban` substitutes its own `handleCardMove` and
  // declares no `onCardMove` React prop — which is the `'retired'` disposition.
  //
  // ⭐ It could not be spelled until objectui#9342 (the ruling recorded on PR
  // objectui#9338) moved the READ. `check:handler-key-reads` REFUSES a
  // tombstone while a renderer still reads the key off the document, printing
  // `declares it RETIRED, but a renderer still reads it` — a tombstone "has no
  // read site BY CONSTRUCTION". `KanbanRenderer` now takes `onCardMove` as an
  // explicit React prop, a sibling of its `schema`, which is the objectui#7742
  // remedy this same file already applied to `objectFields`; it narrows a
  // published component's props, so it is a ruling and not a repair, and the
  // change carries `needs:contract-review` on its own merits.
  //
  // ⭐ `onQuickAdd` is a TOMBSTONE too, since objectui#11234, completing ruling B
  // of decision batch #91 (objectui#8285). It was a runtime slot: the function
  // reached the board by identity, and on this element was never called,
  // because its partner `quickAdd` is retired here. The same gate refused the
  // tombstone while `KanbanRenderer` read the key off the document
  // `ObjectKanban` handed it. So `ObjectKanban` now renders the internal
  // `KanbanBoardCore`, which takes the Quick Add pair only as explicit props,
  // and it supplies neither. The exported `KanbanRenderer` keeps the pair for a
  // React host.
  onCardClick: handlerKeyRefusal('onCardClick', 'runtime-slot', 'Card click handler'),
  onCardMove: handlerKeyRefusal('onCardMove', 'retired', 'Card move handler'),
  onQuickAdd: handlerKeyRefusal('onQuickAdd', 'retired', 'Quick Add handler'),
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(OBJECT_KANBAN_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_KANBAN_NEITHER_CHANNEL),
}).superRefine(...requireRecordSource('object-kanban', KANBAN_RECORD_SOURCE_KEYS));

/**
 * The message for an `ObjectChartSchema.yAxis` that is not a list
 * (objectui#10518) — the remedy names the spec's own spelling, the one-entry
 * list the showcase producer writes. Applied to the array's own `invalid_type`
 * only, so an issue INSIDE an entry keeps the spec's wording (including its
 * alias hint, e.g. `logScale` → `logarithmic`).
 */
const OBJECT_CHART_Y_AXIS_IS_A_LIST_GUIDANCE =
  '`yAxis` on an `object-chart` is `@objectstack/spec`\'s ARRAY of axis objects — write '
  + '`yAxis: [{ field: \'task_count\', stepSize: 1 }]`, one entry per value axis (a second entry declares '
  + 'the right-hand axis). A single axis object or a bare column name is not a member of the protocol.';

/**
 * The remedy for an `ObjectChartSchema.xAxis` that is not an object
 * (objectui#10518) — the spec's own spelling, the `{ field }` form the
 * showcase `renewals-pipeline` page writes on this node.
 */
const OBJECT_CHART_X_AXIS_IS_AN_OBJECT_GUIDANCE =
  '`xAxis` on an `object-chart` is `@objectstack/spec`\'s axis OBJECT — write `xAxis: { field: \'status\' }` '
  + '(plus `title`, `format`, … as the spec declares them). A bare column name or a list is not a member of '
  + 'the protocol on this node: the bare-string spelling is an alias of `xAxisKey` on the `chart` node only.';

/**
 * The message for a refused `ObjectChartSchema.xAxis` (objectui#10518).
 *
 * `xAxis` here is ONLY the spec's axis object: no string arm and no fold. The
 * objectui#7113 bare-string alias of `xAxisKey` is a ruling scoped to
 * `ChartSchema` (seat decision on objectui#10518, option A), and the spec's
 * `ChartConfigSchema.xAxis` — the `ObjectChart` react block's schema — has no
 * string arm either.
 *
 * Why the member below is a two-arm union whose second arm is `z.never()`: the
 * spec's object answers a string with a bare "expected object", and zod runs a
 * ONE-option union as its option, so a single-arm union's error hook never
 * fires. `z.never()` admits nothing and adds nothing to the inferred type; what
 * it buys is that every refusal becomes one `invalid_union` at `xAxis`, worded
 * here — the shape `ChartSchema.xAxis` already reports (`chartXAxisUnionError`
 * in `data-display.zod.ts`):
 *
 *   - an OBJECT can only have meant the axis object, and that arm's issues are
 *     surfaced with their paths (`xAxis.min: …`), in the spec's own words — the
 *     alias hint included;
 *   - anything else — a bare column name, a list, a number — gets the remedy.
 *
 * It is a MESSAGE, not an accept: the issue stays `invalid_union` at `xAxis`,
 * and nothing that was refused is admitted.
 */
function objectChartXAxisError(issue: z.core.$ZodRawIssue): string | undefined {
  if (issue.code !== 'invalid_union') return undefined;
  const input = issue.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return OBJECT_CHART_X_AXIS_IS_AN_OBJECT_GUIDANCE;
  // Arm order is the union's: [axis object, never].
  const axisArm = issue.errors[0] ?? [];
  const detail = axisArm
    .map((i) => `${['xAxis', ...i.path.map(String)].join('.')}: ${i.message}`)
    .join('; ');
  return `\`xAxis\` is not a valid \`@objectstack/spec\` axis object — ${detail || 'Invalid input'}`;
}

/**
 * The chart-family floor on an `object-chart` node (objectui#10770).
 *
 * Two keys carry the family. The metadata tier writes `chartType`. The react
 * tier's `<ObjectChart>` author writes the spec's `type`, which the react-page
 * wrapper parks as `specType`, because `type` is this node's discriminator.
 * Either one is enough, so both members are optional. This refinement keeps
 * the floor that `chartType`'s required flag used to carry: a node that names
 * no family is refused, as it was before. Only which key may carry the family
 * widened. The path stays on `chartType`, so the diagnostic lands where it
 * always did.
 */
function requireObjectChartFamily(
  schema: { chartType?: unknown; specType?: unknown },
  ctx: z.core.$RefinementCtx,
): void {
  if (schema.chartType !== undefined || schema.specType !== undefined) return;
  ctx.addIssue({
    code: 'custom',
    path: ['chartType'],
    message:
      '`object-chart` names no chart family: write `chartType` on a metadata node. On the react tier, '
      + '`<ObjectChart type="bar">` arrives here as `specType`.',
  });
}

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `ObjectChartSchema`. */
const OBJECT_CHART_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-chart',
  'its `any`-typed registration hands the node to `ObjectChart`, which reads it as `ObjectChartSchema`',
  'a chart of `objectName` (or inline `data`) drawn by `chartType` from `aggregate` / `series`',
);

/**
 * The chart families `ObjectChartSchema.chartType` declares (objectui#11513):
 * the installed `@objectstack/spec` `ChartTypeSchema`'s families that
 * plugin-charts draws as a chart, in the spec's own order.
 *
 * Picked out of the spec's enum BY REFERENCE (`.extract`), so a family the
 * spec drops fails here when the module loads, and a family the spec adds is
 * not declared until something draws it. The spec's other families stay
 * undeclared because this block draws no chart of them: the single-value
 * families (`gauge`, `solid-gauge`, `metric`, `kpi`, `bullet`) render one
 * row's number, and the tabular ones (`table`, `pivot`) a notice.
 * `object-metric`, `object-data-table` and `object-pivot` are the blocks that
 * draw those.
 *
 * The TS twin (`../objectql.ts`) is the same set, `Extract`ed from the spec's
 * `ChartType`. `../__tests__/object-chart-families-11513.test.ts` holds both
 * faces to this set and to the spec, and plugin-charts'
 * `object-chart-declared-families-11513.test.tsx` renders every spec family
 * through the real `SchemaRenderer` and holds the declared set to the families
 * that draw a chart.
 */
const OBJECT_CHART_FAMILIES = [
  'bar', 'horizontal-bar', 'column',
  'line', 'area',
  'pie', 'donut', 'funnel',
  'scatter',
  'treemap', 'sankey',
  'combo',
  'radar',
] as const;

/** The refusal an undeclared `chartType` meets; it names the declared set. */
const OBJECT_CHART_FAMILY_REFUSAL =
  `\`chartType\` on an \`object-chart\` is one of ${OBJECT_CHART_FAMILIES.join(', ')} (objectui#11513): `
  + 'the `@objectstack/spec` chart families this chart block draws. The spec\'s single-value and tabular '
  + 'families draw no chart here: write a single number as an `object-metric`, rows as an '
  + '`object-data-table`, a cross-tab as an `object-pivot`.';

/**
 * ObjectChart Schema
 */
export const ObjectChartSchema = BaseSchema.extend({
  type: z.literal('object-chart'),
  // objectui#10872 batch 9 — the node-level `responsiveStyles`, from the same
  // `NODE_ENVELOPE` fragment as `ObjectGridSchema` above. A producer writes
  // it on `object-chart` nodes. The TS twin declares it too.
  ...NODE_ENVELOPE,
  // objectui#11070 — the spec's per-element binding, by reference, as on the
  // other gate-wrapped arms (see `ObjectGridSchema.dataSource`). The
  // registration is `elementDataSourceBlock`-wrapped, so
  // `ElementDataSourceGate` reads it off the node and lands its `object` on
  // `objectName`. A NODE-level key: `OBJECT_CHART_NODE_LEVEL_KEYS` below keeps
  // it out of the authored `properties` bag.
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  // Legacy inline path (objectName + aggregate). Optional now that a chart may
  // instead bind to a semantic-layer dataset (ADR-0021, objectstack-ai/objectstack#1890).
  objectName: z.string().optional().describe('ObjectQL object name (legacy inline path)'),
  // ── objectui#10770: the chart family, on either tier's key ──
  //
  // `chartType` is the metadata tier's spelling. `specType` is where the
  // react-page wrapper parks a react-tier author's `type`, and its value domain
  // is the spec's own `ChartTypeSchema`, by reference, because that is what
  // `ChartConfigSchema.type` declares. Both are optional, and
  // `requireObjectChartFamily` (the `.superRefine` at the end) requires one of
  // them. The TS twin in `../objectql.ts` carries the ground.
  //
  // objectui#11513: `chartType` takes the spec's families plugin-charts draws,
  // `OBJECT_CHART_FAMILIES` above, out of the spec's own enum. It declared
  // eight until then, while the dashboard composes this node with every series
  // family the renderer draws.
  chartType: stripImportedDefaults(SpecChartTypeSchema)
    .extract(OBJECT_CHART_FAMILIES, { error: OBJECT_CHART_FAMILY_REFUSAL })
    .optional()
    .describe(`Chart type — the metadata tier's spelling of the chart family: one of ${OBJECT_CHART_FAMILIES.join(', ')}, the @objectstack/spec ChartType families plugin-charts draws. One of chartType or specType is required`),
  specType: stripImportedDefaults(SpecChartTypeSchema).optional()
    .describe('The react tier\'s chart family: the author\'s `type` on <ObjectChart>, parked here by the react-page wrapper because `type` is this node\'s discriminator. @objectstack/spec ChartType, by reference. chartType wins when a node writes both'),
  // ── objectui#10608: three list-view spellings, RETIRED on this node ──
  //
  // `xAxisField` / `yAxisFields` / `aggregation` are the LIST-VIEW chart
  // block's pre-ADR-0021 vocabulary, which every list-view door refuses and no
  // list-view relay reads since objectui#6152 round 15; no `object-chart`
  // reader consumes the three either. Kept
  // declared and unwritable (ADR-0049): `BaseSchema` is `.passthrough()`, so a
  // deleted arm would KEEP an authored value in silence instead of refusing it.
  // Each refusal names the spec spelling as its remedy. The TS twin in
  // `../objectql.ts` carries the ground; the pin is
  // `../__tests__/object-chart-legacy-axis-keys-retired-10608.test.ts`.
  xAxisField: retirementTombstone(
    'RETIRED (objectui#10608, ADR-0049) — no `object-chart` reader consumes `xAxisField`: '
    + 'a node written with it draws no category axis. Write the spec\'s '
    + '`xAxis: { field: \'status\' }` instead; on the inline `objectName` path the category is `aggregate.groupBy`.',
  ),
  yAxisFields: retirementTombstone(
    'RETIRED (objectui#10608, ADR-0049) — no `object-chart` reader consumes `yAxisFields`: '
    + 'a node written with it plots no series. Write the spec\'s '
    + '`yAxis: [{ field: \'amount\' }]` instead, one entry per value axis; on the inline `objectName` path the '
    + 'measure is `aggregate.field`, and a dataset-bound chart selects `values` by name.',
  ),
  aggregation: retirementTombstone(
    'RETIRED (objectui#10608, ADR-0049) — no `object-chart` reader consumes `aggregation`: '
    + 'a node written with it aggregates nothing. Write the spec\'s '
    + '`aggregate: { field, function, groupBy }` instead, `function` one of `count`, `sum`, `avg`, `min`, '
    + '`max`; a dataset-bound chart takes its aggregation from the dataset\'s measures.',
  ),
  // ADR-0021 semantic-layer binding: dimensions/measures selected BY NAME from a
  // dataset, queried via the governed queryDataset path.
  dataset: z.string().optional().describe('Semantic-layer dataset name (ADR-0021)'),
  dimensions: z.array(z.string()).optional().describe('Dataset dimension names'),
  values: z.array(z.string()).optional().describe('Dataset measure names'),
  // ── objectui#7946: the four keys the producers write and the renderer reads ──
  //
  // Declared on BOTH published copies by the 2026-09-09 ruling (option A), with
  // value types derived from `ChartRendererProps` / `ObjectChart.tsx`'s reads
  // and NOT copied from any producer's literal. `../objectql.ts`'s docblock
  // carries the per-key AUTHORABLE / INTERNAL verdict and its ground; the short
  // form is repeated in each `.describe()` because that string is what an
  // author-facing tool renders.
  //
  // ⭐ Where the SPEC already owns the shape, the binding is BY REFERENCE and
  // the local spelling is a defect, not a style: see `aggregate` below. A
  // near-copy publishes a second dialect of one key, and — because a local
  // `z.object` strips where the spec's `strictObject` refuses — the copy is
  // quietly the more permissive of the two.
  //
  // Declaring an INTERNAL key here is not a promotion. `BaseSchema` is
  // `.passthrough()`, so `xAxisKey` and `series` already rode through this
  // mirror unexamined; what changes is that their VALUES are checked. Leaving
  // them undeclared would instead have put them in `zod-mirror-parity`'s
  // `UnmirroredDeclared` ledger — which that file calls a real defect in the
  // pair, not a neutral state. (`series` is only half internal since
  // objectui#10770: see its own comment below.)
  // BOTH `filter` arms are live and both are measured — see the twin docblock in
  // `../objectql.ts`. The array arm is the spec's published `FilterArray` and
  // the registry `inputs` spelling; the record arm is the ObjectQL `$filter`
  // object the drill-down spread requires and the in-repo corpus authors.
  // ⚠️ Narrowing to one arm is a decision local to THIS node — the six sibling
  // `object-*` widgets are already array-only — and it is blocked on the
  // drill-down spread, which mis-composes the array arm into index keys.
  filter: z.union([
    z.array(z.any()),
    z.record(z.string(), z.any()),
  ]).optional().describe('AUTHORABLE — query filter, forwarded as $filter on both query legs with its context tokens ({current_user_id}, {current_org_id}, date macros) resolved first, then spread into the drill-down filter. FilterArray (the spec/react-blocks and registry-inputs spelling) OR the ObjectQL $filter object'),
  // ⛔ `aggregate` is the SPEC's own schema, never a local near-copy. The first
  // cut of objectui#7946 spelled it as a local `z.object` with all three members
  // optional; zod 4 objects are STRIP-postured, so
  // `{ groupby: 'stage', function: 'count' }` parsed clean and dropped the
  // mis-cased key silently — the failure `ChartAggregateSchema`'s own
  // `strictObject` posture exists to prevent, reintroduced by the copy. Bound by
  // reference the strict posture and the requiredness come with it, and the
  // authoring door here and at the react-page publish gate are one shape.
  aggregate: stripImportedDefaults(SpecChartAggregateSchema).optional()
    .describe('AUTHORABLE — inline aggregation for the legacy objectName path. @objectstack/spec ChartAggregateSchema ({ field?, function, groupBy }), the same schema the react-page publish gate parses: function and groupBy are REQUIRED, field is optional because only count counts rows rather than a column, and unknown keys are refused rather than dropped'),
  xAxisKey: z.string().optional().describe('INTERNAL (relay-composed) — the category column the renderer binds the x axis to. Authors write the spec xAxis: { field }; all five producers compute this key'),
  // ── objectui#10770: `series` is TWO arms, one verdict each ──
  //
  // Arm 1 is the spec's `ChartSeriesSchema` BY REFERENCE: the AUTHOR arm
  // (`{ name }`). The react tier's `<ObjectChart series={…}>` publishes it, the
  // react-page wrapper forwards it onto this node untouched, and the showcase
  // `renewals-pipeline` page writes it. The strict refusal is the spec's too,
  // so `dataKey` on this arm is refused by name.
  //
  // Arm 2 is the INTERNAL arm (`{ dataKey }`), unchanged: the `{ dataKey }` arm
  // of `ChartRendererProps.schema.series`, WITHOUT that arm's per-series `type`
  // (objectui#8086), deliberately (objectui#10584). Widening it waits for a
  // named producer that writes `type` on a `{ dataKey }` entry of this node.
  //
  // An entry matching neither arm (no `name` and no `dataKey`) is refused;
  // `normalizeChartSchema` would drop it from the chart. Arm order puts the
  // author arm first. The TS twin in `../objectql.ts` carries the ground.
  series: z.array(z.union([
    stripImportedDefaults(SpecChartSeriesSchema),
    z.object({
      dataKey: z.string().describe('Result column this series plots'),
      label: z.string().optional().describe('Series display label'),
      variant: z.enum(['current', 'comparison']).optional().describe('Comparison overlays render muted'),
      opacity: z.number().optional().describe('Series opacity override (0-1)'),
      dashArray: z.string().optional().describe('SVG stroke-dasharray override'),
      chartType: z.enum(['bar', 'line', 'area']).optional().describe('Per-series family override (combo charts)'),
      stack: z.string().optional().describe('Stack identifier to group series'),
      yAxis: z.enum(['left', 'right']).optional().describe('Bind to a specific Y axis'),
      color: z.string().optional().describe('Series color (hex/rgb/token)'),
    }),
  ])).optional().describe("Plotted series, each entry ONE of two arms. AUTHORABLE: @objectstack/spec ChartSeriesSchema, by reference (the { name } arm the react tier's <ObjectChart series> publishes; strict, refuses dataKey by name; per-series family override is type). INTERNAL (relay-composed): the renderer's { dataKey } arm, as ChartRendererProps declares it minus that arm's per-series type, which this copy does not declare; its per-series family override is chartType (bar | line | area). An entry with neither name nor dataKey is refused. normalizeChartSchema is the one translation"),
  // Colors are overloaded kanban-style: a string[] is the positional palette
  // (applied per category in order; fallback only), while a Record<value,color>
  // is an explicit value→color map. A select/lookup dimension's option colors —
  // and any explicit map — take precedence over the positional palette per
  // category, so health green/red/yellow paints semantically.
  colors: z.union([
    z.array(z.string()),
    z.record(z.string(), z.string()),
  ]).optional().describe('Positional palette (string[]) OR a value→color map ({ value: color }, kanban-style). Select/lookup option colors and explicit maps win over the palette per category.'),
  // ── objectui#8885: three more keys `ObjectChart.tsx` reads that neither
  // published copy of this shape declared. Each is the SPEC's own schema at the
  // crossing, never a local near-copy — see the TS twin in `../objectql.ts` for
  // the per-key measurement.
  //
  // ⚠️ The keys ABOVE (`filter` / `aggregate` / `xAxisKey` / `series` /
  // `colors`) are objectui#7946's and were ruled on separately; this card swept
  // none of them in, and that card swept none of these three in. The two census
  // pins record the split — `../__tests__/object-chart-undeclared-keys-8885.test.ts`
  // and `../__tests__/widget-schema-anchors-7946.test.ts` each ledger the other
  // card's keys BY NAME and assert only that each is STILL READ, never that it
  // is still undeclared, which is why the landing order of the two never
  // mattered.
  drillDown: stripImportedDefaults(SpecChartDrillDownSchema).optional()
    .describe('Segment drill config — @objectstack/spec ChartDrillDownSchema ({ enabled?, filter?, title?, target?: drawer | dialog | navigate, columns?, maxRows? }). Present = on; {} is enough. NOT the wider DrillDownConfig: a chart reads neither `mode` nor `report`.'),
  title: stripImportedDefaults(SpecI18nLabelSchema).optional()
    .describe('Chart heading, and the drill drawer heading fallback. @objectstack/spec I18nLabel — a plain string or an inline locale map, the union `normalizeChartSchema`’s `label()` resolves. Not a BaseSchema member.'),
  // Strip-then-slot, the objectui#7779 idiom `ObjectViewSchema` above uses:
  // the boundary is applied to the whole imported schema and the slot is taken
  // off the RESULT, so the crossing is visible to the objectui#8317 census in
  // the position it reads (`stripImportedDefaults(<binding>)`).
  compareTo: stripImportedDefaults(SpecDashboardWidgetSchema).shape.compareTo
    .describe('Period-over-period comparison directive, forwarded verbatim from the dashboard widget key of the same name — bound BY REFERENCE to `DashboardWidgetSchema.shape.compareTo` so the producer and this consumer cannot drift into two dialects.'),
  // ── objectui#10518: the two axes, as `@objectstack/spec`'s axis config —
  // ONE object for `xAxis`, a LIST for `yAxis` — the `object-chart` sibling of
  // objectui#7690, under the same ruling (5809510046, branch 2 — declare),
  // which triage reused for this node.
  //
  // Three readings, each taken rather than assumed (the TS twin in
  // `../objectql.ts` carries them in full):
  //   - the spec DECLARES both keys on this node: its `REACT_BLOCKS` entry for
  //     the `ObjectChart` react block has `schemaType: 'object-chart'` and
  //     `schema: ChartConfigSchema`, and lists `xAxis` / `yAxis` among its
  //     `dataProps`; `ChartConfigSchema.xAxis` is ONE `ChartAxisSchema` and
  //     `ChartConfigSchema.yAxis` an ARRAY of them;
  //   - the node RENDERS them: `ObjectChart` spreads the node into the schema
  //     it hands `ChartRenderer`, whose `normalizeChartSchema` reads the spec's
  //     axis keys (tied to them from the renderer's side by
  //     `normalizeChartSchema.specAxisKeys-7690.test.ts`);
  //   - real producers WRITE them: the objectstack showcase command-center
  //     page's dataset-bound `object-chart` authors `yAxis: [{ field, stepSize: 1 }]`
  //     to pin integer ticks on a count axis, and its `renewals-pipeline` page
  //     writes `xAxis: { field }` on the `ObjectChart` react block.
  //
  // Until here both keys rode `BaseSchema`'s `.passthrough()` — kept, read and
  // UNCHECKED — so `yAxis: [{ field: 'n', stepSize: 'big' }]` and
  // `xAxis: { field: 'n', min: 'zero' }` parsed green.
  //
  // BY REFERENCE, not restated: the key set, the value domains and the strict
  // refusal are the spec's. `stripImportedDefaults` keeps the spec's two
  // `.default()`s out of the parse output, exactly as on `ChartSchema`.
  // Only the spec's shapes are members: a bare column name, a list or any
  // other non-object on `xAxis`, and a single object or a bare column name on
  // `yAxis`, are refused, each with its remedy (the liveness read on
  // objectui#10518, a one-time reading, found no producer on this node writing
  // any of them). Of those, `normalizeChartSchema` honours the bare string on
  // `xAxis` and both `yAxis` shapes as tolerances; a list on `xAxis` names no
  // category there. ⛔ No string arm and no fold on `xAxis`: see
  // `objectChartXAxisError` above.
  xAxis: z
    .union([stripImportedDefaults(SpecChartAxisSchema), z.never()], { error: objectChartXAxisError })
    .optional()
    .describe(
      'AUTHORABLE — category (x) axis: ONE @objectstack/spec ChartAxis object, by reference (field required, strict). '
      + 'Its field names the category column when neither aggregate.groupBy nor xAxisKey does. A bare column name or a list is refused.',
    ),
  yAxis: z
    .array(stripImportedDefaults(SpecChartAxisSchema), {
      error: (issue) => (issue.code === 'invalid_type' ? OBJECT_CHART_Y_AXIS_IS_A_LIST_GUIDANCE : undefined),
    })
    .optional()
    .describe(
      'AUTHORABLE — value (y) axes: an ARRAY of @objectstack/spec ChartAxis objects, by reference (field required, strict). '
      + 'The first entry is the primary axis; a second entry declares the right-hand axis.',
    ),
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(OBJECT_CHART_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_CHART_NEITHER_CHANNEL),
}).superRefine(requireObjectChartFamily);

/* ── The authored `object-chart` node: its props in the `properties` bag ─── */

/**
 * The node-level keys of `ObjectChartSchema` above: everything the node base
 * declares (`BaseSchema`, `type` and the two content channels among them), the
 * node envelope (`NODE_ENVELOPE`), and the per-element `dataSource` binding,
 * which the spec's `PageComponentSchema` declares on the node beside
 * `properties` (objectui#11070), as `ObjectFormBlockSchema` and
 * `ObjectMapBlockSchema` carry it. The chart's OWN members are the rest of the
 * mirror's shape, and they are what the bag below holds (objectui#11276). Read
 * off the declarations, not transcribed, so a key `BaseSchema` or the envelope
 * gains stays at node level the day it lands.
 */
const OBJECT_CHART_NODE_LEVEL_KEYS = Object.fromEntries(
  [...Object.keys(BaseSchema.shape), ...Object.keys(NODE_ENVELOPE), 'dataSource'].map((key) => [key, true]),
) as { [K in keyof typeof BaseSchema.shape | keyof typeof NODE_ENVELOPE | 'dataSource']: true };

/**
 * The `object-chart` props bag (objectui#11276): the flat mirror's own members,
 * BY REFERENCE.
 *
 * ⛔ `@objectstack/spec` has no `ComponentPropsMap['object-chart']` row, and none
 * is invented here. The spec's `PageComponentSchema` types every `properties`
 * bag as an open record and judges a bag only through a row, so for this type
 * the spec accepts any bag at all. The bag's members are therefore objectui's
 * own: every member `ObjectChartSchema` declares beyond the node-level keys
 * above, each the SAME schema object the mirror holds (its value checks, its
 * spec bindings — `aggregate`, `series`, `drillDown`, `xAxis`, `yAxis` — and
 * its objectui#10608 retirement tombstones). Nothing is restated, so the bag
 * and the post-hoist mirror cannot drift apart.
 *
 * ⭐ Built from the mirror's SHAPE, not with `.omit()` on the mirror: zod
 * refuses `.pick()` / `.omit()` on an object carrying a refinement, and the
 * mirror carries the chart-family floor. That floor is a NODE rule, so the bag
 * object deliberately carries no check of its own; the arm below re-applies the
 * same floor one layer down (`requireObjectChartFamilyInBag`).
 *
 * The bag keeps the mirror's posture, `.passthrough()` (`BaseSchema`'s), so a
 * key the chart does not declare is judged in the bag exactly as it was judged
 * on the flat node: unjudged by the tolerant face, refused by name by the
 * strict authoring face, which closes every object it walks.
 */
const ObjectChartPropsBag = z.looseObject(ObjectChartSchema.shape).omit(OBJECT_CHART_NODE_LEVEL_KEYS);

/**
 * The chart-family floor of {@link requireObjectChartFamily}, read in the bag
 * (objectui#11276): an authored `object-chart` names its family as
 * `properties.chartType` (or `properties.specType`). A node with no bag, or a
 * bag naming neither, is refused at `properties.chartType`, as the flat mirror
 * refuses a node naming neither key.
 */
function requireObjectChartFamilyInBag(
  node: { properties?: unknown },
  ctx: z.core.$RefinementCtx,
): void {
  const bag = node.properties;
  const family = bag !== null && typeof bag === 'object' && !Array.isArray(bag)
    ? (bag as { chartType?: unknown; specType?: unknown })
    : {};
  if (family.chartType !== undefined || family.specType !== undefined) return;
  ctx.addIssue({
    code: 'custom',
    path: ['properties', 'chartType'],
    message:
      '`object-chart` names no chart family: write `properties.chartType` — '
      + '`{ "type": "object-chart", "properties": { "chartType": "bar", … } }` (objectui#11276).',
  });
}

/**
 * The ONE refusal detail every `object-chart` prop written flat on the node
 * gets (objectui#11276). `aliasKeyRefusal` puts the key and its bag member in
 * front of it: "Did you mean `chartType` → `properties.chartType`?".
 */
const OBJECT_CHART_FLAT_PROP =
  'An `object-chart` node takes its props in its `properties` bag: write `{ "type": "object-chart", '
  + '"properties": { "chartType": "bar", "dataset": "…", "dimensions": ["…"], "values": ["…"] } }` '
  + '(objectui#11276). `@objectstack/spec`\'s own page component refuses a prop written on the node as '
  + 'mis-layered (ADR-0089 D3a), so this face and `os validate` agree. The spec has no '
  + '`ComponentPropsMap[\'object-chart\']` row, so the bag\'s members are `ObjectChartSchema`\'s own. Moving it '
  + 'changes nothing at render time: `SchemaRenderer` hoists every `properties` key onto the node before '
  + '`ObjectChart` reads it.';

/** A member of the `object-chart` bag — a TYPE position. */
type ObjectChartBagKey = keyof typeof ObjectChartPropsBag.shape;

/**
 * One by-name refusal per member of the bag, keyed by the bag's own key set —
 * read off the bag, not transcribed, so a member the mirror gains is refused
 * flat the day it lands and the list cannot fall behind.
 */
const OBJECT_CHART_FLAT_PROP_REFUSALS = Object.fromEntries(
  Object.keys(ObjectChartPropsBag.shape).map((key) => [
    key,
    aliasKeyRefusal(key, `properties.${key}`, 'this `object-chart` node', OBJECT_CHART_FLAT_PROP),
  ]),
) as { [K in ObjectChartBagKey]-?: ReturnType<typeof aliasKeyRefusal> };

/**
 * `object-chart` — the AUTHORED node: its props in the `properties` bag
 * (objectui#11276, the `object-chart` batch of triage's routing call A).
 *
 * ## Why the arm moved to the bag
 *
 * `@objectstack/spec`'s strict `PageComponentSchema` refuses a prop written on
 * a page component itself as mis-layered (ADR-0089 D3a), for every component
 * type: `properties` is the only home of a component's own props. This union
 * used to arm the node with the flat `ObjectChartSchema` above, so `objectui
 * validate` refused the spec-shaped document — the objectstack showcase's
 * command-center charts, `{ type: 'object-chart', responsiveStyles,
 * properties: { dataset, dimensions, values, chartType, colors, yAxis } }` —
 * and accepted the flat one `os validate` refuses. Triage's answer on
 * objectui#11276 is this arm: "the `properties` bag is the contract on these
 * three arms too", released for `object-chart` first.
 *
 * It is the construct `ObjectFormBlockSchema` and `ObjectMapBlockSchema` use
 * (objectui#10859, batches 4 and 5) — `BaseSchema` + the `type` literal +
 * `NODE_ENVELOPE` + `properties` through `propsBag` + one `aliasKeyRefusal`
 * per bag member — with ONE difference, stated rather than hidden: ⛔ there is
 * no spec row to read. `ComponentPropsMap` carries no `object-chart` row, so
 * the bag is `ObjectChartPropsBag` above, the flat mirror's own members by
 * reference, and its description says so instead of naming a row.
 *
 * ## The flat spelling is refused by name
 *
 * Every member of the bag written FLAT on the node is refused on both faces,
 * with a message naming its bag member (`OBJECT_CHART_FLAT_PROP_REFUSALS`
 * above). The three list-view spellings objectui#10608 retired
 * (`xAxisField`, `yAxisFields`, `aggregation`) are the exception: written flat
 * they keep the flat mirror's own retirement tombstones (the same objects, by
 * reference), whose remedy is the spec spelling rather than a bag member that
 * is itself retired. In the bag they are refused by the same tombstones.
 * `BaseSchema`'s keys stay on the node, as on every arm. A key the chart does
 * not declare is left as every arm leaves an undeclared key: unjudged by the
 * tolerant face, refused by the strict one.
 *
 * ## The chart family, `dataSource` and the content channels
 *
 * The flat mirror's chart-family floor (objectui#10770) stays on the authored
 * node, read in the bag (`requireObjectChartFamilyInBag`). The registration is
 * `elementDataSourceBlock`-wrapped, so `dataSource` is the spec's
 * `ElementDataSourceSchema` by reference, on the NODE beside the bag, as on
 * `ObjectFormBlockSchema` and `ObjectMapBlockSchema` (objectui#11070; it is
 * one of `OBJECT_CHART_NODE_LEVEL_KEYS`, so it is not a bag member and is not
 * refused flat). Neither content channel is read, so both are refused with
 * the objectui#9256 string the flat mirror uses.
 *
 * ## What did not move
 *
 * The TypeScript `ObjectChartSchema` and its zod mirror above stay published:
 * they are the node as `ObjectChart` reads it after `SchemaRenderer` hoists the
 * bag, and as code composes it — `ObjectView`, `ListView`, the dashboard
 * renderers and the react-page wrapper all build a flat `object-chart` node.
 * Those keep working, because `SchemaRenderer` reads both spellings and no
 * composed node passes through `safeValidateSchema`.
 */
export const ObjectChartBlockSchema = BaseSchema.extend({
  type: z.literal('object-chart'),
  ...NODE_ENVELOPE,
  properties: propsBag(
    'object-chart',
    ObjectChartPropsBag,
    'The `object-chart` props bag — the members `ObjectChartSchema` declares beyond the node-level keys, '
      + 'by reference. `@objectstack/spec` has no `ComponentPropsMap[\'object-chart\']` row, so these are '
      + 'objectui\'s own members (objectui#11276). The chart family is required here: `chartType` (or `specType`).',
  ),
  // objectui#11070 — the node's binding, the flat mirror's own member by
  // reference (the spec's `ElementDataSourceSchema`).
  dataSource: ObjectChartSchema.shape.dataSource,
  ...OBJECT_CHART_FLAT_PROP_REFUSALS,
  // objectui#10608: the three retired list-view spellings keep their retirement
  // when written flat — the flat mirror's own tombstones, by reference.
  xAxisField: ObjectChartSchema.shape.xAxisField,
  yAxisFields: ObjectChartSchema.shape.yAxisFields,
  aggregation: ObjectChartSchema.shape.aggregation,
  // objectui#9256: the renderer reads NEITHER content channel, so both are
  // refused by name — the flat mirror's own members, by reference.
  body: ObjectChartSchema.shape.body,
  children: ObjectChartSchema.shape.children,
}).superRefine(requireObjectChartFamilyInBag);

/**
 * ObjectGallery Schema (objectui#6576)
 *
 * Mirrors the `ObjectGallerySchema` interface in `objectql.ts` key for key;
 * every key has a read site in `plugin-list/src/ObjectGallery.tsx`. `gallery`,
 * `navigation` and `grouping` are the spec's own schemas by reference, which is
 * how the TS declaration types them.
 */
export const ObjectGallerySchema = BaseSchema.extend({
  type: z.literal('object-gallery'),
  objectName: z.string().optional().describe('ObjectQL object name'),
  // ⭐ NARROWED from `z.unknown()` (objectui#9309), in step with the twin
  // declaration in `../objectql.ts`, which is now `QueryParams['$filter']` —
  // the destination this key's own description names. `z.unknown()` left the
  // runtime door wider than the type: `filter: 'stage=won'` and `filter: 42`
  // parsed clean here while `tsc` refused them one file over, which is the
  // two-dialects-of-one-key shape AGENTS.md #0.1 forbids.
  // ⚠️ It also sat in `zod-mirror-parity`'s DOCUMENTED BLIND SPOT: that file's
  // `Unconstrained< T >` excludes an `unknown` mirror slot from the
  // `WiderThanDeclared` comparison by definition, so nothing would have
  // reported the split. Measured, not assumed — see the ledger note there.
  // Spelled as the two arms `QueryParams['$filter']` resolves to, in the
  // ARRAY-FIRST order `ObjectChartSchema.filter` above already uses: a
  // `z.record` arm placed first would have to be trusted to refuse an array,
  // and the ordering is the cheaper guarantee.
  filter: z.union([
    z.array(z.any()),
    z.record(z.string(), z.any()),
  ]).optional().describe('Query filter, forwarded as $filter with its context tokens ({current_user_id}, {current_org_id}, date macros) resolved first. FilterArray (the spec array sugar) OR the ObjectQL $filter object — the two arms of QueryParams[$filter]'),
  data: z.array(z.record(z.string(), z.unknown())).optional().describe('Inline records'),
  gallery: stripImportedDefaults(SpecGalleryConfigSchema).optional().describe('Gallery configuration (@objectstack/spec GalleryConfig)'),
  navigation: stripImportedDefaults(SpecNavigationConfigSchema).optional().describe('Record navigation behaviour (drawer/dialog/page)'),
  grouping: stripImportedDefaults(SpecGroupingConfigSchema).optional().describe('Grouping configuration for sectioned display'),
  imageField: z.string().optional().describe('DEPRECATED — use gallery.coverField'),
  titleField: z.string().optional().describe('DEPRECATED — use gallery.titleField'),
  // ⭐ `8d50bc2bf` — two keys the REGISTERED `object-gallery` renderer reads
  // off the authored document while this arm declared neither. `BaseSchema` is
  // `.passthrough()`, so an undeclared key is NOT refused: it stops being
  // judged and the value is KEPT, and `SchemaRenderer` then spreads it into the
  // component's props bag (`createElement` spreading `...componentProps`), where
  // `ObjectGallery` reads `props.onRowClick ?? props.onCardClick` and hands the
  // winner to `useNavigationOverlay` as the function it CALLS on a card click.
  // `{ "type": "object-gallery", "onCardClick": { "action": "toast" } }`
  // therefore parsed GREEN and put that action object where a function is run.
  //
  // ⚠️ The channel is the PROPS half of the runtime slot, not the `schema.*`
  // half, which is why the read census finds both at one line. It is still the
  // same defect: the key travels the authored NODE to get there.
  //
  // ⛔ Disposition MEASURED PER KEY. `'retired'` publishes "no renderer reads
  // this key" — FALSE for both.
  //
  //   - `onRowClick`   two in-repo suppliers, each putting it on the
  //                    `object-gallery` node it builds: `ListView`
  //                    (`onRowClick: navigation.handleClick`, from the
  //                    `baseProps` every child view receives) and
  //                    `RelatedList`'s mobile branch (its own React prop).
  //   - `onCardClick`  ⚠️ a DIFFERENT reading from its sibling: NO in-repo host
  //                    supplies it. It is the second arm of the `??` above, the
  //                    spelling a host may use instead, declared on
  //                    `ObjectGalleryProps` with its own doc. The slot is real —
  //                    declared on the props interface, read at two sites, run
  //                    through the hook — but what is absent is an in-repo
  //                    SUPPLIER, not the channel.
  onCardClick: handlerKeyRefusal('onCardClick', 'runtime-slot', 'Card click handler'),
  onRowClick: handlerKeyRefusal('onRowClick', 'runtime-slot', 'Row/item click handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `object-gallery` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `bind`, `className`, `data`, `filter`, `gallery`, `grouping`, '
    + '`imageField`, `navigation`, `objectName`, `titleField`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `object-gallery` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `bind`, `className`, `data`, `filter`, `gallery`, `grouping`, '
    + '`imageField`, `navigation`, `objectName`, `titleField`.',
  ),
});

/**
 * ObjectDataTable Schema (objectui#6576 / objectui#6914)
 *
 * Mirrors the `ObjectDataTableSchema` interface in `objectql.ts`. One key
 * follows the parity ledger's discipline rather than the literal shape, one
 * used to, and one is retired:
 *
 *   - `onRowClick` is a RUNTIME SLOT — a host-supplied function the widget
 *     forwards into `data-table` — so the mirror refuses it BY NAME
 *     (`handlerKeyRefusal`, the objectui#6124 shape) while the TS twin stays
 *     callable; `KnownDrift` in `zod-mirror-parity.test.ts` records the
 *     divergence.
 *   - `drillDown` is mirrored through `DrillDownConfigSchema`
 *     (`data-display.zod.ts`, objectui#7352). objectui#6576 declared the key
 *     and left it unmirrored — minting the mirror was a new export outside
 *     that ruling — so `UnmirroredDeclared` carried it, as it had carried
 *     `ChartSchema.drillDown` since objectui#6058; both entries left the
 *     ledger with that mirror. Since objectui#10685 it is this block's OWN
 *     drill shape, the twin of `ObjectDataTableDrillDownConfig`: the shared
 *     mirror extended so that `filter`, `maxRows` and `report` are refused by
 *     name and `target` takes `'drawer'` or `'dialog'` only.
 *   - `dataProvider` is a RETIREMENT TOMBSTONE (objectui#7353), `?: never` on
 *     the TS twin: refused by name, pointing at `objectName`. Deleting it
 *     instead would leave an authored value KEPT unchecked, because
 *     `BaseSchema` is `.passthrough()`.
 */
export const ObjectDataTableSchema = BaseSchema.extend({
  type: z.literal('object-data-table'),
  objectName: z.string().optional().describe('ObjectQL object name'),
  dataProvider: retirementTombstone(
    'REFUSED (objectui#7353, ADR-0049) — `object-data-table` does not read `dataProvider`. The dashboard '
    + 'producers used to copy the widget provider config onto the node here, beside `objectName`, and nothing '
    + 'read it. Write `objectName` — the key the widget fetches through.',
  ),
  filter: z.any().optional().describe('Query filter, resolved through the filter scope and forwarded as $filter'),
  data: z.array(z.any()).optional().describe('Inline rows'),
  columns: z.array(z.any()).optional().describe('Column definitions (names or column objects)'),
  searchable: z.boolean().optional().describe('Forwarded to the rendered data-table'),
  pagination: z.boolean().optional().describe('Forwarded to the rendered data-table'),
  // objectui#11348 — forwarded to the rendered `data-table` through the widget's
  // node spread, and read there, so it is declared on both faces at once. The
  // member is `DataTableSchema`'s own, by reference; the describe names the hop.
  pageSize: DataTableSchema.shape.pageSize.describe('Forwarded to the rendered data-table'),
  // objectui#10685 — this block's OWN drill shape, the twin of
  // `ObjectDataTableDrillDownConfig` (`../data-display.ts`). A row drills to the
  // one record it already is, so the three members that configure a drilled
  // record LIST have nothing to act on, and `'navigate'` (the object's list
  // page) is the wrong destination for one record. `retirementTombstone` is the
  // repo's one declared-and-refused mechanism; here it refuses per block, not a
  // retirement: the shared mirror keeps all three keys for the blocks that read
  // them. `enabled`, `mode`, `title` and `columns` parse exactly as the shared
  // mirror parses them.
  drillDown: DrillDownConfigSchema.extend({
    filter: retirementTombstone(
      'REFUSED on `object-data-table` (objectui#10685) — `drillDown.filter` scopes a drilled record list, and '
      + 'this block drills to the one record its row already is, so there is no list to filter. A drill `filter` '
      + 'applies on `object-chart` and `object-pivot`. Delete the key.',
    ),
    maxRows: retirementTombstone(
      'REFUSED on `object-data-table` (objectui#10685) — `drillDown.maxRows` caps a drilled record list, and '
      + 'this block drills to the one record its row already is. It applies on `object-chart`, `object-pivot` '
      + 'and `object-metric`, whose drill lists page by it. Delete the key.',
    ),
    report: retirementTombstone(
      'REFUSED on `object-data-table` (objectui#10685) — `drillDown.report` replaces a drilled record list with '
      + 'a report, and this block drills to the one record its row already is. It applies on `object-pivot` and '
      + '`object-metric`, whose drill drawer renders it. Delete the key.',
    ),
    target: z.enum(['drawer', 'dialog'], {
      error: '`drillDown.target` on `object-data-table` is `\'drawer\'` or `\'dialog\'` (objectui#10685). '
        + '`\'navigate\'` is refused here: it opens the object\'s full list page, and this block\'s row opens one '
        + 'record. `\'navigate\'` applies on `object-chart`, `object-pivot` and `object-metric`.',
    }).optional().describe(
      "Where the record drill lands: 'drawer' (default) or 'dialog'. 'navigate' is refused on this block (objectui#10685)",
    ),
  }).optional().describe(
    'Drill-to-record: clicking a row opens that record in a detail drawer (DashboardRenderer defaults object-backed table widgets to { enabled: true, mode: record }). '
    + 'This block\'s own drill shape: filter, maxRows and report are refused by name, and target is drawer or dialog (objectui#10685)',
  ),
  onRowClick: handlerKeyRefusal('onRowClick', 'runtime-slot', 'Row click handler (overrides drill-to-record)'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `object-data-table` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `bind`, `columns`, `data`, `drillDown`, `filter`, `objectName`, '
    + '`onRowClick`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `object-data-table` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `bind`, `columns`, `data`, `drillDown`, `filter`, `objectName`, '
    + '`onRowClick`.',
  ),
});

/**
 * ObjectQL Component Schema Union
 *
 * The members of the TS union in `../objectql.ts`, in the same order, less
 * `ObjectGridSchema`, `ObjectFormSchema`, `ObjectMapSchema`,
 * `ObjectChartSchema` and `ObjectGanttSchema` (see the last five paragraphs).
 * `ObjectGallerySchema` and `ObjectDataTableSchema` joined in objectui#7363:
 * PR #7355 (objectui#6576) minted both mirrors and deliberately did not extend
 * this union, so `AnyComponentSchema` — and `validateSchema` /
 * `safeValidateSchema` / `objectui validate` with it — had NO arm for an
 * `object-gallery` or `object-data-table` node. Such a document was refused as
 * matching no arm, exactly as before the mirrors existed, and a wrong-typed
 * declared key on it (`searchable: 'yes'`) could never be diagnosed by name.
 * Both nodes render (`plugin-list` registers `object-gallery`, `plugin-dashboard`
 * registers `object-data-table`); this is the validating face catching up with
 * the rendering one. The behaviour pin is `__tests__/objectql-union-arms-7363.test.ts`.
 *
 * `z.discriminatedUnion`, not `z.union` (objectui#8498) — see the same note on
 * `crud.zod.ts#CRUDComponentSchema` for both reasons. All twelve arms already
 * declared a distinct `type` literal, so ⛔ no document changes verdict; what
 * changes is that a refusal now carries ONE arm's diagnosis instead of twelve.
 *
 * ⚠️ ELEVEN since objectui#10859 batch 4: `ObjectFormSchema` left this union.
 * The TypeScript union still carries its twin, which is the node as `ObjectForm`
 * reads it after the `properties` hoist; the authored `object-form` node is
 * armed by `ObjectFormBlockSchema` in `ObjectQLPublicBlockComponentSchema`
 * below, from its spec row.
 *
 * ⚠️ TEN since objectui#10859 batch 5: `ObjectMapSchema` left it the same way,
 * for the same reason. Its TypeScript twin is the node as `ObjectMap` reads it,
 * and the authored `object-map` node is armed by `ObjectMapBlockSchema` below.
 *
 * ⚠️ NINE since objectui#11276: `ObjectChartSchema` left it the same way. Its
 * TypeScript twin is the node as `ObjectChart` reads it, and the authored
 * `object-chart` node is armed by `ObjectChartBlockSchema` above, whose bag is
 * the mirror's own members (the spec has no row for this type).
 *
 * ⚠️ EIGHT since objectui#10859 batch 6: `ObjectGanttSchema` left it the same
 * way. Its TypeScript twin is the node as `ObjectGantt` reads it, and the
 * authored `object-gantt` node is armed by `ObjectGanttBlockSchema` below, from
 * its spec row.
 *
 * ⚠️ SEVEN since objectui#11276's `object-grid` batch: `ObjectGridSchema` left
 * it the same way. Its TypeScript twin is the node as `ObjectGrid` reads it,
 * the mirror still builds the `object-view` `table` slot, and the authored
 * `object-grid` node is armed by `ObjectGridBlockSchema` below, from its spec
 * row.
 *
 * ⚠️ SIX since objectui#12670: `ListViewSchema` left it the same way. It stays
 * the `ListView` component's props, and its TypeScript twin stays in the
 * TypeScript union; the authored page `list-view` node is armed by
 * `ListViewBlockSchema` below, its bag the mirror's own members (the spec has no
 * row for this type), with `objectName` / `viewType` refused by name (ruling C on
 * objectstack-ai/objectstack#22444).
 */
const ObjectQLComponentSchemaInferred = z.discriminatedUnion('type', [
  ObjectViewSchema,
  ObjectTreeSchema,
  ObjectCalendarSchema,
  ObjectKanbanSchema,
  ObjectGallerySchema,
  ObjectDataTableSchema,
]);

/**
 * The TYPE of {@link ObjectQLComponentSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface ObjectQLComponentZodType extends ObjectQLComponentSchemaInferredType {
  options: ObjectQLComponentSchemaInferredType['options'];
}
type ObjectQLComponentSchemaInferredType = typeof ObjectQLComponentSchemaInferred;

/** The union above, typed by its named {@link ObjectQLComponentZodType}. */
export const ObjectQLComponentSchema: ObjectQLComponentZodType = ObjectQLComponentSchemaInferred;

/* ── ADR-0080 public blocks of this family, armed from their spec rows ───── */

// The `properties` member of each block below is `propsBag` from
// `./public-blocks.zod.ts` — the one helper every public-block arm uses
// (objectui#10872), imported rather than restated.

/** objectui#9256 (public-block slice): ONE refusal string for both content channels of `object-metric`. */
const OBJECT_METRIC_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-metric',
  'its registration (`plugin-dashboard:object-metric`) hands the node to `ObjectMetricBlock`, which resolves its '
    + '`dataSource` binding and renders `ObjectMetricWidget`, whose props are named keys and never a child list',
  'one aggregated number over `objectName`, computed by `aggregate` and scoped by `filter`',
);

/**
 * `object-metric` — `ComponentPropsMap['object-metric']` (objectui#10859,
 * batch 2).
 *
 * ## Why it is armed here, and from what
 *
 * `object-metric` is registered by `@object-ui/plugin-dashboard`
 * (`ObjectMetricBlock`, which renders `ObjectMetricWidget`), curated by
 * ADR-0080 as a public block (`PUBLIC_BLOCKS` in `@object-ui/core`) and
 * declared by the spec — and until this arm `AnyComponentSchema` carried none
 * for it, so `safeValidateSchema` and `objectui validate` refused every
 * document naming it with `invalid_union` at `type`.
 *
 * `@object-ui/types` has no TypeScript declaration of this node: the spec's
 * row is the one published declaration of what it takes. (The widget's React
 * props, `ObjectMetricWidgetProps`, describe the component after the node is
 * resolved — a translator function and a React-node icon among them — and are
 * not a document shape.) So the arm is built the way `./public-blocks.zod.ts`
 * builds every arm whose declaration is a `ComponentPropsMap` row
 * (objectui#10872): `BaseSchema` + the `type` literal + `properties`, which IS
 * the row, by reference through the objectui#8317 import boundary. Members,
 * value types, strictness and the spec's own refusals all arrive from the
 * spec; nothing is restated, so nothing can drift.
 *
 * ## Where the props live
 *
 * The bag is the spelling the platform's authored documents use — every
 * `object-metric` the objectstack showcase ships is `{ type, properties }` —
 * and the one the page designer writes; `SchemaRenderer` hoists it onto the
 * node before `ObjectMetricBlock` runs. A member of the row written FLAT on the
 * node is refused by name on both faces, naming its bag member, exactly as on
 * the public blocks next door (`flatPropRefusals`, objectui#10872 batch 10;
 * triage's answer A there made the bag the contract for the whole family).
 * `description`, a `BaseSchema` key the row also declares, is refused flat the
 * same way; `label` stays on the node, where the spec's page component
 * declares a `label` of its own. A composed flat node keeps rendering —
 * `DashboardRenderer` builds one — because `SchemaRenderer` reads both
 * spellings and no composed node passes through `safeValidateSchema`.
 *
 * ## `dataSource` (the node's binding)
 *
 * `ObjectMetricBlock` is `elementDataSourceBlock`-wrapped and reads the node's
 * `dataSource` through `ElementDataSourceGate`. That key is the spec's
 * `PageComponentSchema.dataSource`, not a props-row member, so it is declared
 * as the spec's `ElementDataSourceSchema`, by reference — the construct the
 * module's other gate-wrapped arms use (objectui#11070). Without it the strict
 * authoring face refused a spec-valid bound node by name (objectui#10859,
 * batch 3). `object-master-detail-form` below declares it the same way.
 *
 * ## The content channels (objectui#9256)
 *
 * The renderer reads NEITHER content channel, so the arm declares `children`
 * as a by-name refusal and restates `body` with the same guidance — as the
 * public blocks in `./public-blocks.zod.ts` do, and for the same reason:
 * `BaseSchema` already refuses `body`, but names `children` as the remedy.
 * Both stay MEMBERS. `object-master-detail-form` below does the same.
 */
export const ObjectMetricBlockSchema = BaseSchema.extend({
  type: z.literal('object-metric'),
  ...NODE_ENVELOPE,
  // objectui#10872 batch 10: a row member written flat on the node is refused by name, toward `properties.KEY`.
  ...flatPropRefusals('object-metric', stripImportedDefaults(SpecObjectMetricPropsSchema)),
  properties: propsBag('object-metric', stripImportedDefaults(SpecObjectMetricPropsSchema)),
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  // objectui#9256: the renderer reads NEITHER content channel, so both are refused by name, each
  // kept a MEMBER.
  body: retirementTombstone(OBJECT_METRIC_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_METRIC_NEITHER_CHANNEL),
});

/** objectui#9256 (public-block slice): ONE refusal string for both content channels of `object-master-detail-form`. */
const OBJECT_MASTER_DETAIL_FORM_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-master-detail-form',
  'its registration (`plugin-form:object-master-detail-form`) hands the node to `MasterDetailFormRenderer`, '
    + 'which resolves its `dataSource` binding and renders `MasterDetailForm`; that form builds its parent '
    + '`object-form` node key by key and reads no child list',
  'a parent form over `objectName` with an editable grid for each `details` entry',
);

/**
 * `object-master-detail-form` — `ComponentPropsMap['object-master-detail-form']`,
 * plus the three handler keys its renderer reads off the node (objectui#10859,
 * batch 2).
 *
 * Registered by `@object-ui/plugin-form` (`MasterDetailFormRenderer`, which
 * renders `MasterDetailForm`), curated by ADR-0080 and declared by the spec,
 * with no arm until this one. Built exactly as `ObjectMetricBlockSchema` above
 * is, and for the same reason: the spec row is the published declaration of
 * the node's props, and the objectstack showcase's master-detail page authors
 * `{ type, properties }`.
 *
 * ⚠️ `@object-ui/plugin-form` also exports `MasterDetailFormSchema`, the type
 * of `MasterDetailForm`'s `schema` prop: the node as the renderer reads it
 * after the `properties` hoist. It is not restated here: it carries three host
 * callbacks and an optional `type`, and it is the renderer's reading rather
 * than the authored document shape. It types `title`, `submitText` and
 * `cancelText` as the row's `I18nLabel` (objectui#10935; pinned by
 * `assertionLabelMembersAreI18nLabel` in plugin-form's
 * `MasterDetailForm.i18nLabels.test.tsx`), and where it and the spec row still
 * disagree — it requires `objectName` and `details`, while the row keeps both
 * keys optional — the spec is the contract this validator answers to.
 *
 * `onSuccess`, `onError` and `onCancel` are not props the spec declares: they
 * are the host callbacks `ObjectForm`, `DrawerForm` and `ModalForm` hand
 * `MasterDetailForm`, which calls each one off the node. So each is a RUNTIME
 * SLOT (objectui#6124): refused by name when authored, because JSON has no
 * function value, rather than left to `.passthrough()` to keep an authored
 * value and hand it to a call site.
 *
 * `dataSource` is declared as on `ObjectMetricBlockSchema` above:
 * `MasterDetailFormRenderer` is `elementDataSourceBlock`-wrapped and reads the
 * node's binding through `ElementDataSourceGate`.
 */
export const ObjectMasterDetailFormBlockSchema = BaseSchema.extend({
  type: z.literal('object-master-detail-form'),
  ...NODE_ENVELOPE,
  // objectui#10872 batch 10: a row member written flat on the node is refused by name, toward `properties.KEY`.
  ...flatPropRefusals('object-master-detail-form', stripImportedDefaults(SpecObjectMasterDetailFormPropsSchema)),
  properties: propsBag(
    'object-master-detail-form',
    stripImportedDefaults(SpecObjectMasterDetailFormPropsSchema),
  ),
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  onSuccess: handlerKeyRefusal('onSuccess', 'runtime-slot', 'Called with the saved parent record after a successful save'),
  onError: handlerKeyRefusal('onError', 'runtime-slot', 'Called after a refused save, for bookkeeping only'),
  onCancel: handlerKeyRefusal('onCancel', 'runtime-slot', 'Cancel button callback'),
  // objectui#9256: the renderer reads NEITHER content channel, so both are refused by name, each
  // kept a MEMBER.
  body: retirementTombstone(OBJECT_MASTER_DETAIL_FORM_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_MASTER_DETAIL_FORM_NEITHER_CHANNEL),
});

/** objectui#9256 (public-block slice): ONE refusal string for both content channels of `object-timeline`. */
const OBJECT_TIMELINE_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-timeline',
  'its registration (`plugin-timeline:object-timeline`) hands the node through `ElementDataSourceGate` to '
    + '`ObjectTimeline`, which fetches or takes its rows and draws them with `TimelineRenderer`; neither reads a '
    + 'child list',
  'one rail of records from `objectName` (or the node\'s `dataSource`), laid out by `variant` from the fields '
    + 'the nested `timeline` config names',
);

/**
 * `object-timeline` — `ComponentPropsMap['object-timeline']`, plus the node's
 * `dataSource` binding (objectui#10859, batch 3).
 *
 * ## Why it is armed here, and from what
 *
 * `object-timeline` is registered by `@object-ui/plugin-timeline`
 * (`ObjectTimelineRenderer`, which renders `ObjectTimeline`), curated by
 * ADR-0080 as a public block (`PUBLIC_BLOCKS` in `@object-ui/core`), and
 * declared by the spec since `@objectstack/spec` 17.5.0 — and until this arm
 * `AnyComponentSchema` carried none for it, so `safeValidateSchema` and
 * `objectui validate` refused every document naming it with `invalid_union`
 * at `type`.
 *
 * `@object-ui/types` has no TypeScript declaration of this node (the plugin's
 * `ObjectTimelineProps` are the component's React props, host callbacks
 * among them, not a document shape), so the arm is built exactly as
 * `ObjectMetricBlockSchema` above is: `BaseSchema` + the `type` literal +
 * `properties`, which IS the row, by reference through the objectui#8317
 * import boundary. Unlike the two rows above, this one carries spec defaults
 * (`timeline.scale`, the `navigation` members), so the boundary hands back a
 * rebuilt copy with every default removed and every key still omissible:
 * this face judges the bag and writes nothing into it.
 *
 * ## Where the props live
 *
 * In the bag, as on its neighbours above: `SchemaRenderer` hoists
 * `properties` onto the node before the renderer runs, so the spec's
 * `{ type, properties }` document renders what the flat one does. A member of
 * the row written FLAT on the node is refused by name on both faces, naming its
 * bag member (`flatPropRefusals`, objectui#10872 batch 10), `data` among them,
 * though `BaseSchema` declares a `data` of its own; a composed flat node, the
 * one `ListView` hands over, keeps rendering because `SchemaRenderer` reads
 * both spellings and no composed node passes through `safeValidateSchema`. Inside
 * the bag, the row itself leaves out the flat field spellings beside
 * `timeline` (`titleField`, `startDateField` and their siblings) and `scale`:
 * the spec's record for the row calls them the runtime handoff `ListView`
 * composes, not a second authoring spelling, so the bag refuses them by name.
 *
 * ## `dataSource` (the node's binding)
 *
 * The registration is wrapped in `elementDataSourceBlock`, so the node reaches
 * `ObjectTimeline` through `ElementDataSourceGate`, which reads the node's
 * `dataSource` and maps its `object`, `filter`, `sort` and `limit` onto the
 * fetch. That key is not a props-row member: it is the spec's
 * `PageComponentSchema.dataSource`, so it is declared as the spec's
 * `ElementDataSourceSchema`, by reference — as `object-grid` and the other
 * gate-wrapped arms of this module declare it (objectui#11070), and as
 * `element:number` does beside its own row.
 *
 * ## The content channels (objectui#9256)
 *
 * Neither `ObjectTimeline` nor the renderer it composes reads a content
 * channel, so the arm refuses `children` by name and restates `body` with the
 * same guidance, both kept MEMBERS — as the two arms above do.
 */
export const ObjectTimelineBlockSchema = BaseSchema.extend({
  type: z.literal('object-timeline'),
  ...NODE_ENVELOPE,
  // objectui#10872 batch 10: a row member written flat on the node is refused by name, toward `properties.KEY`.
  ...flatPropRefusals('object-timeline', stripImportedDefaults(SpecObjectTimelinePropsSchema)),
  properties: propsBag('object-timeline', stripImportedDefaults(SpecObjectTimelinePropsSchema)),
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  // objectui#9256: the renderer reads NEITHER content channel, so both are refused by name, each
  // kept a MEMBER.
  body: retirementTombstone(OBJECT_TIMELINE_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_TIMELINE_NEITHER_CHANNEL),
});

/**
 * The ONE refusal detail every `object-form` prop written flat on the node
 * gets (objectui#10859, batch 4). `aliasKeyRefusal` puts the key and its bag
 * member in front of it: "Did you mean `mode` → `properties.mode`?".
 */
const OBJECT_FORM_FLAT_PROP =
  'An `object-form` node takes its props in its `properties` bag, where `@objectstack/spec`\'s '
  + '`ComponentPropsMap[\'object-form\']` row declares them: write `{ "type": "object-form", "properties": '
  + '{ "objectName": "…", "mode": "create" } }` (objectui#10859). The spec\'s own page component refuses a prop '
  + 'written on the node as mis-layered (ADR-0089 D3a), so this face and `os validate` agree. Moving it changes '
  + 'nothing at render time: `SchemaRenderer` hoists every `properties` key onto the node before `ObjectForm` '
  + 'reads it.';

/** A member of the spec's `object-form` row — a TYPE position, so no boundary crossing. */
type ObjectFormRowKey = keyof z.input<typeof SpecObjectFormPropsSchema>;

/**
 * One by-name refusal per member of the spec's `object-form` row, keyed by the
 * row's own key set — read off the row, not transcribed, so a member the spec
 * adds is refused flat the day it lands and the list cannot fall behind.
 */
const OBJECT_FORM_FLAT_PROP_REFUSALS = Object.fromEntries(
  Object.keys(stripImportedDefaults(SpecObjectFormPropsSchema).shape).map((key) => [
    key,
    aliasKeyRefusal(key, `properties.${key}`, 'this `object-form` node', OBJECT_FORM_FLAT_PROP),
  ]),
) as { [K in ObjectFormRowKey]-?: ReturnType<typeof aliasKeyRefusal> };

/**
 * `object-form` — `ComponentPropsMap['object-form']`, plus the node's
 * `dataSource` binding and the five handler keys its renderer reads off the
 * node (objectui#10859, batch 4).
 *
 * ## Why the arm moved to the bag
 *
 * The spec's row is the published declaration of an authored `object-form`
 * node's props, and the spec's strict `PageComponentSchema` refuses a prop
 * written on the node itself as mis-layered (ADR-0089 D3a). This union used
 * to arm the node with the flat `ObjectFormSchema` above, so `objectui
 * validate` refused the spec-shaped document — the objectstack showcase's
 * wizard page among them — and accepted the flat one `os validate` refuses.
 * The seat's answer at PR objectui#11248's ACCEPT, inherited from
 * objectui#10872's triage answer A, is this arm: "The `properties` bag is the
 * contract".
 *
 * So it is built exactly as `ObjectMetricBlockSchema` above is: `BaseSchema` +
 * the `type` literal + `properties`, which IS the row, by reference through
 * the objectui#8317 import boundary. The row carries no spec default, so the
 * boundary hands back the export itself.
 *
 * ## The flat spelling is refused by name
 *
 * Every member of the row written FLAT on the node is refused on both faces,
 * with a message naming its bag member (`OBJECT_FORM_FLAT_PROP_REFUSALS`
 * above). The flat spelling is the one this node was taught in, so an author
 * meets the remedy rather than a bare `unrecognized_keys` — which, since
 * objectui#10872 batch 10, is also what the blocks above give a flat row member
 * (`flatPropRefusals`, the shared helper; this arm keeps its own map and
 * message). `description` is also a `BaseSchema` key; here the
 * refusal overrides it, because the form's description is the row's member.
 * A key the row does not declare (`buttons`, `defaults`, `subforms`, `groups`)
 * is left as every arm leaves an undeclared key: unjudged by the tolerant face,
 * refused by the strict one.
 *
 * ## What did not move
 *
 * The TypeScript `ObjectFormSchema` and its zod mirror above stay published:
 * they are the node as `ObjectForm` reads it after the hoist, and as code
 * composes it. A runtime composer that builds a flat `object-form` node keeps
 * working, because `SchemaRenderer` reads both spellings and no composed node
 * passes through `safeValidateSchema` (`SchemaRenderer` runs `@object-ui/core`'s
 * structural `validateSchema`).
 *
 * ## The handler keys, `dataSource` and the content channels
 *
 * `ObjectForm` reads `onSuccess`, `onCancel`, `onError`, `onOpenChange` and
 * `onStepChange` off the node it is handed, so each is declared here exactly as
 * the flat mirror declares it: an objectui#6124 RUNTIME SLOT, refused by name.
 * The registration is `elementDataSourceBlock`-wrapped, so `dataSource` is the
 * spec's `ElementDataSourceSchema` by reference, as on the arms above. Neither
 * content channel is read, so both are refused with the objectui#9256 string
 * the flat mirror uses.
 */
export const ObjectFormBlockSchema = BaseSchema.extend({
  type: z.literal('object-form'),
  ...NODE_ENVELOPE,
  properties: propsBag('object-form', stripImportedDefaults(SpecObjectFormPropsSchema)),
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  ...OBJECT_FORM_FLAT_PROP_REFUSALS,
  onCancel: handlerKeyRefusal('onCancel', 'runtime-slot', 'Cancel handler'),
  onError: handlerKeyRefusal('onError', 'runtime-slot', 'Submit error handler'),
  onOpenChange: handlerKeyRefusal('onOpenChange', 'runtime-slot', 'Modal/drawer open-state handler'),
  onStepChange: handlerKeyRefusal('onStepChange', 'runtime-slot', 'Wizard step change handler'),
  onSuccess: handlerKeyRefusal('onSuccess', 'runtime-slot', 'Submit success handler'),
  // objectui#9256: the renderer reads NEITHER content channel, so both are refused by name, each
  // kept a MEMBER.
  body: retirementTombstone(OBJECT_FORM_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_FORM_NEITHER_CHANNEL),
});

/**
 * The ONE refusal detail every `object-map` prop written flat on the node
 * gets (objectui#10859, batch 5). `aliasKeyRefusal` puts the key and its bag
 * member in front of it: "Did you mean `objectName` → `properties.objectName`?".
 */
const OBJECT_MAP_FLAT_PROP =
  'An `object-map` node takes its props in its `properties` bag, where `@objectstack/spec`\'s '
  + '`ComponentPropsMap[\'object-map\']` row declares them: write `{ "type": "object-map", "properties": '
  + '{ "objectName": "…", "map": { "latitudeField": "…", "longitudeField": "…" } } }` (objectui#10859). The '
  + 'spec\'s own page component refuses a prop written on the node as mis-layered (ADR-0089 D3a), so this face '
  + 'and `os validate` agree. Moving it changes nothing at render time: `SchemaRenderer` hoists every '
  + '`properties` key onto the node before `ObjectMap` reads it.';

/** A member of the spec's `object-map` row — a TYPE position, so no boundary crossing. */
type ObjectMapRowKey = keyof z.input<typeof SpecObjectMapPropsSchema>;

/**
 * One by-name refusal per member of the spec's `object-map` row, keyed by the
 * row's own key set — read off the row, not transcribed, so a member the spec
 * adds is refused flat the day it lands and the list cannot fall behind.
 */
const OBJECT_MAP_FLAT_PROP_REFUSALS = Object.fromEntries(
  Object.keys(stripImportedDefaults(SpecObjectMapPropsSchema).shape).map((key) => [
    key,
    aliasKeyRefusal(key, `properties.${key}`, 'this `object-map` node', OBJECT_MAP_FLAT_PROP),
  ]),
) as { [K in ObjectMapRowKey]-?: ReturnType<typeof aliasKeyRefusal> };

/**
 * `object-map` — `ComponentPropsMap['object-map']`, plus the node's
 * `dataSource` binding (objectui#10859, batch 5).
 *
 * ## Why the arm moved to the bag
 *
 * The spec's row is the published declaration of an authored `object-map`
 * node's props, and the spec's strict `PageComponentSchema` refuses a prop
 * written on the node itself as mis-layered (ADR-0089 D3a). This union used
 * to arm the node with the flat `ObjectMapSchema` above, so `objectui
 * validate` refused the spec-shaped `{ type, properties }` document (its
 * record-source refinement found no source on the node) and accepted the flat
 * one `os validate` refuses. The seat's answer at PR objectui#11248's ACCEPT,
 * inherited from objectui#10872's triage answer A, is this arm: "The
 * `properties` bag is the contract". `ObjectFormBlockSchema` above is the same
 * move for `object-form` (batch 4).
 *
 * So it is built exactly as `ObjectMetricBlockSchema` above is: `BaseSchema` +
 * the `type` literal + `properties`, which IS the row, by reference through
 * the objectui#8317 import boundary. The row carries no spec default, so the
 * boundary hands back the export itself. The row is strict and carries the
 * spec's own refusals: a flat `map`-config key written in the bag
 * (`properties.latitudeField`) is refused there with the spec's wrong-layer
 * prescription, and `properties.filters` with the alias's.
 *
 * ## The flat spelling is refused by name
 *
 * Every member of the row written FLAT on the node is refused on both faces,
 * with a message naming its bag member (`OBJECT_MAP_FLAT_PROP_REFUSALS`
 * above). `data` is also a `BaseSchema` key; here the refusal overrides it,
 * because the map's `data` is the row's member. The flat mirror's two
 * remaining compatibility members, `locationField` and `titleField`, are
 * refused too: their bag home is the row's `map` block, so the remedy names
 * `properties.map.KEY`. A flat key neither the row nor the mirror declares
 * (`latitudeField` and the other flat `map`-config spellings) is left as every
 * arm leaves an undeclared key: unjudged by the tolerant face, refused by the
 * strict one.
 *
 * ## The record source, `dataSource` and the content channels
 *
 * The record-source rule the flat mirror carries (`77cb489b4`, the maintainer
 * ruling recorded 2026-09-02) stays on the authored node, read in the bag:
 * `requireRecordSource(…, 'properties')` asks for one of `properties.data`,
 * `properties.staticData` or `properties.objectName`, or the node's
 * `dataSource` binding naming its object (a non-empty `dataSource.object`, the
 * predicate every gate-wrapped arm shares since objectui#11117), which
 * `ElementDataSourceGate` lands on `objectName` (the registration is
 * `elementDataSourceBlock`-wrapped). ⚠️ The spec row is
 * looser here: it keeps all three optional and adds no such rule, so a node
 * with no source and no binding passes the spec's own page component and is
 * refused by this arm, as the flat mirror refused it. The binding itself is
 * the spec's `ElementDataSourceSchema` by reference, as on the arms above.
 * Neither content channel is read, so both are refused with the objectui#9256
 * string the flat mirror uses.
 *
 * ## What did not move
 *
 * The TypeScript `ObjectMapSchema` and its zod mirror above stay published:
 * they are the node as `ObjectMap` reads it after the hoist, and as
 * `ObjectView` / `ListView` compose it when they flatten a stored map view. A
 * composed flat node keeps working, because `SchemaRenderer` reads both
 * spellings and no composed node passes through `safeValidateSchema`.
 */
export const ObjectMapBlockSchema = BaseSchema.extend({
  type: z.literal('object-map'),
  ...NODE_ENVELOPE,
  properties: propsBag('object-map', stripImportedDefaults(SpecObjectMapPropsSchema)),
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  ...OBJECT_MAP_FLAT_PROP_REFUSALS,
  locationField: aliasKeyRefusal(
    'locationField',
    'properties.map.locationField',
    'this `object-map` node',
    OBJECT_MAP_FLAT_PROP,
  ),
  titleField: aliasKeyRefusal('titleField', 'properties.map.titleField', 'this `object-map` node', OBJECT_MAP_FLAT_PROP),
  // objectui#9256: the renderer reads NEITHER content channel, so both are refused by name, each
  // kept a MEMBER.
  body: retirementTombstone(OBJECT_MAP_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_MAP_NEITHER_CHANNEL),
}).superRefine(...requireRecordSource('object-map', RECORD_SOURCE_KEYS, 'properties'));

/**
 * The ONE refusal detail every `object-gantt` prop written flat on the node
 * gets (objectui#10859, batch 6). `aliasKeyRefusal` puts the key and its bag
 * member in front of it: "Did you mean `objectName` → `properties.objectName`?".
 */
const OBJECT_GANTT_FLAT_PROP =
  'An `object-gantt` node takes its props in its `properties` bag, where `@objectstack/spec`\'s '
  + '`ComponentPropsMap[\'object-gantt\']` row declares them, and its field mapping in the bag\'s `gantt` block: '
  + 'write `{ "type": "object-gantt", "properties": { "objectName": "…", "gantt": { "startDateField": "…", '
  + '"endDateField": "…", "titleField": "…" } } }` (objectui#10859). The spec\'s own page component refuses a prop '
  + 'written on the node as mis-layered (ADR-0089 D3a), so this face and `os validate` agree. Moving it changes '
  + 'nothing at render time: `SchemaRenderer` hoists every `properties` key onto the node before `ObjectGantt` '
  + 'reads it.';

/** A member of the spec's `object-gantt` row — a TYPE position, so no boundary crossing. */
type ObjectGanttRowKey = keyof z.input<typeof SpecObjectGanttPropsSchema>;

/**
 * The one row member that is ALSO a node-level key of the spec's
 * `PageComponentSchema` (its display `label`), so a `label` written on the node
 * is not mis-layered: the spec's page component accepts it, and `BaseSchema`
 * keeps declaring it here. Every other member of the row written on the node
 * is refused by the spec's page component as an unrecognized key, and by the
 * refusals below. `object-gantt-properties-bag-10859-b6.test.ts` re-derives
 * this split from the installed spec, member by member.
 */
type ObjectGanttNodeLevelRowKey = 'label';
const OBJECT_GANTT_NODE_LEVEL_ROW_KEYS: readonly ObjectGanttNodeLevelRowKey[] = ['label'];

/**
 * One by-name refusal per member of the spec's `object-gantt` row, keyed by the
 * row's own key set — read off the row, not transcribed, so a member the spec
 * adds is refused flat the day it lands and the list cannot fall behind — less
 * the node-level `label` above.
 */
const OBJECT_GANTT_FLAT_PROP_REFUSALS = Object.fromEntries(
  Object.keys(stripImportedDefaults(SpecObjectGanttPropsSchema).shape)
    .filter((key) => !(OBJECT_GANTT_NODE_LEVEL_ROW_KEYS as readonly string[]).includes(key))
    .map((key) => [
      key,
      aliasKeyRefusal(key, `properties.${key}`, 'this `object-gantt` node', OBJECT_GANTT_FLAT_PROP),
    ]),
) as { [K in Exclude<ObjectGanttRowKey, ObjectGanttNodeLevelRowKey>]-?: ReturnType<typeof aliasKeyRefusal> };

/** A member of the row's `gantt` block — a TYPE position, so no boundary crossing. */
type ObjectGanttConfigKey = keyof NonNullable<z.input<typeof SpecObjectGanttPropsSchema>['gantt']>;

/**
 * The flat mirror's `GanttConfig` members (`startDateField`, `viewMode`,
 * `colorField`, … — the flatten product `getGanttConfig` reads when a node has
 * no `gantt` block) and its legacy alias `dependencyField`, each refused by name
 * when written on the authored node and pointed at its home, the bag's `gantt`
 * block: `properties.gantt.KEY` (`dependencyField` at the canonical
 * `properties.gantt.dependenciesField`). The key set is the row's own `gantt`
 * member, read off the crossed row, so it is the block the remedy names.
 */
const OBJECT_GANTT_FLAT_CONFIG_REFUSALS = {
  ...(Object.fromEntries(
    Object.keys(
      (stripImportedDefaults(SpecObjectGanttPropsSchema).shape.gantt as unknown as {
        unwrap(): { shape: Record<string, unknown> };
      }).unwrap().shape,
    ).map((key) => [
      key,
      aliasKeyRefusal(key, `properties.gantt.${key}`, 'this `object-gantt` node', OBJECT_GANTT_FLAT_PROP),
    ]),
  ) as { [K in ObjectGanttConfigKey]-?: ReturnType<typeof aliasKeyRefusal> }),
  dependencyField: aliasKeyRefusal(
    'dependencyField',
    'properties.gantt.dependenciesField',
    'this `object-gantt` node',
    OBJECT_GANTT_FLAT_PROP,
  ),
};

/**
 * `object-gantt` — `ComponentPropsMap['object-gantt']`, plus the node's
 * `dataSource` binding (objectui#10859, batch 6).
 *
 * ## Why the arm moved to the bag
 *
 * The spec's row is the published declaration of an authored `object-gantt`
 * node's props, and the spec's strict `PageComponentSchema` refuses a prop
 * written on the node itself as mis-layered (ADR-0089 D3a). This union used
 * to arm the node with the flat `ObjectGanttSchema` above, so `objectui
 * validate` refused the spec-shaped `{ type, properties }` document (its
 * record-source refinement found no source on the node) and accepted the flat
 * one `os validate` refuses. The seat's answer at PR objectui#11248's ACCEPT,
 * inherited from objectui#10872's triage answer A, is this arm: "The
 * `properties` bag is the contract". `ObjectMapBlockSchema` above is the same
 * move for `object-map` (batch 5).
 *
 * So it is built exactly as `ObjectTimelineBlockSchema` above is: `BaseSchema`
 * + the `type` literal + `properties`, which IS the row, by reference through
 * the objectui#8317 import boundary. Like that row, this one carries spec
 * defaults (inside `data`'s `api` provider), so the boundary hands back a
 * rebuilt copy with every default removed and every key still omissible. The
 * row is strict and carries the spec's own refusals: a flat `GanttConfig` key
 * written in the bag (`properties.startDateField`) is refused there with the
 * spec's prescription to move it into `gantt`, and so are the `search` pair
 * and `title`, which the row deliberately leaves out.
 *
 * ## The flat spelling is refused by name
 *
 * Every member of the row written FLAT on the node is refused on both faces,
 * with a message naming its bag member (`OBJECT_GANTT_FLAT_PROP_REFUSALS`
 * above). `data` is also a `BaseSchema` key; here the refusal overrides it,
 * because the gantt's `data` is the row's member. `label` is the one row member
 * that stays: the spec's page component declares a node-level `label` of its
 * own, so a `label` on the node is not mis-layered, and it keeps `BaseSchema`'s
 * member. The flat mirror's `GanttConfig` members and its `dependencyField`
 * alias are refused too, pointed at the bag's `gantt` block
 * (`OBJECT_GANTT_FLAT_CONFIG_REFUSALS` above). A flat key neither the row nor
 * that block declares — the mirror's `search` / `searchableFields`, which a
 * list view writes onto the node it composes, among them — is left as every
 * arm leaves an undeclared key: unjudged by the tolerant face, refused by the
 * strict one.
 *
 * ## The record source, `dataSource` and the content channels
 *
 * The record-source rule the flat mirror carries (`77cb489b4`, the maintainer
 * ruling recorded 2026-09-02) stays on the authored node, read in the bag, as
 * on `ObjectMapBlockSchema`: `requireRecordSource(…, 'properties')` asks for
 * one of `properties.data`, `properties.staticData` or
 * `properties.objectName`, or the node's `dataSource` binding naming its object
 * (a non-empty `dataSource.object`), which `ElementDataSourceGate` lands on
 * `objectName` (the registration is `elementDataSourceBlock`-wrapped). So a
 * node bound only through `dataSource` parses. ⚠️ The spec row is looser here:
 * it keeps all three optional and adds no such rule, so a node with no source
 * and no binding passes the spec's own page component and is refused by this
 * arm, as the flat mirror refused it. The binding itself is the spec's
 * `ElementDataSourceSchema` by reference, as on the arms above. Neither content
 * channel is read, so both are refused with the objectui#9256 string the flat
 * mirror uses.
 *
 * ## What did not move
 *
 * The TypeScript `ObjectGanttSchema` and its zod mirror above stay published:
 * they are the node as `ObjectGantt` reads it after the hoist, and as
 * `ObjectView` / `ListView` compose it when they flatten a stored gantt view. A
 * composed flat node keeps working, because `SchemaRenderer` reads both
 * spellings and no composed node passes through `safeValidateSchema`.
 */
export const ObjectGanttBlockSchema = BaseSchema.extend({
  type: z.literal('object-gantt'),
  ...NODE_ENVELOPE,
  properties: propsBag('object-gantt', stripImportedDefaults(SpecObjectGanttPropsSchema)),
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  ...OBJECT_GANTT_FLAT_PROP_REFUSALS,
  ...OBJECT_GANTT_FLAT_CONFIG_REFUSALS,
  // objectui#9256: the renderer reads NEITHER content channel, so both are refused by name, each
  // kept a MEMBER.
  body: retirementTombstone(OBJECT_GANTT_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_GANTT_NEITHER_CHANNEL),
}).superRefine(...requireRecordSource('object-gantt', RECORD_SOURCE_KEYS, 'properties'));

/**
 * `object-grid` — `ComponentPropsMap['object-grid']`, plus the node's
 * `dataSource` binding (objectui#11276, the `object-grid` batch of triage's
 * routing call A).
 *
 * ## Why the arm moved to the bag
 *
 * `@objectstack/spec`'s strict `PageComponentSchema` refuses a prop written on
 * a page component itself as mis-layered (ADR-0089 D3a), for every component
 * type: `properties` is the only home of a component's own props. This union
 * used to arm the node with the flat `ObjectGridSchema` above, so `objectui
 * validate` refused the spec-shaped document — the objectstack showcase's work
 * queues, `{ type: 'object-grid', properties: { objectName, columns, filter } }`
 * (its record-source refinement found no source on the node, and the strict
 * face named `properties` as an unrecognized key) — and accepted the flat one
 * `os validate` refuses. Triage's answer on objectui#11276 is this arm: "A
 * block schema takes the `properties` bag, while the flat mirror keeps the
 * `object-view` table slot."
 *
 * It is the construct `ObjectFormBlockSchema`, `ObjectMapBlockSchema` and
 * `ObjectGanttBlockSchema` use (objectui#10859, batches 4 to 6): `BaseSchema` +
 * the `type` literal + `NODE_ENVELOPE` + `properties`, which IS the spec's row,
 * by reference through the objectui#8317 import boundary. The row carries spec
 * defaults (inside `data`'s `api` provider), so the boundary hands back a
 * rebuilt copy with every default removed and every key still omissible. The
 * row is strict and carries the spec's own refusals and prescriptions: an
 * undeclared key in the bag is refused there, `properties.operators` with the
 * spec's "Did you mean `operators` → `operations`?", and the record form of
 * `filter` with the spec's ViewFilterRule prescription.
 *
 * ## The flat spelling is refused by name
 *
 * Every member of the row written FLAT on the node is refused on both faces,
 * with a message naming its bag member — `flatPropRefusals`, the shared helper
 * the `object-metric`, `object-master-detail-form` and `object-timeline` arms
 * above spread, read off the row's own key set. It already encodes the two
 * exceptions this row needs: `label` is a node-level key of the spec's page
 * component too (its display label), so a `label` on the node is not
 * mis-layered and keeps `BaseSchema`'s member; and `defaultSort` is a member
 * the row itself retires, so written flat it gets the row's own retirement.
 * `data` is also a `BaseSchema` key; here the refusal overrides it, because the
 * grid's `data` is the row's member.
 *
 * The flat mirror's own retirements that are not row members keep their
 * tombstones when written flat — the mirror's members, by reference:
 * `operators` (objectui#9739), and `rowSpecActions`, `bulkSpecActions`, `name`,
 * `placeholder`, `showFilters` (objectui#11068). `name` and `placeholder` are
 * `BaseSchema` keys, so without the tombstone they would parse again. In the
 * bag the row refuses each of them. `onNavigate`, which `ObjectGrid` reads off
 * the node, is declared exactly as the mirror declares it, an objectui#6124
 * runtime slot. A flat
 * key neither the row nor those declare — the mirror's `emptyState` and
 * `keyboardNavigation` among them — is left as every arm leaves an undeclared
 * key: unjudged by the tolerant face, refused by the strict one; the row
 * refuses both inside the bag too.
 *
 * ## The record source, `dataSource` and the content channels
 *
 * The flat mirror's record-source rule (objectui#11117: `objectName`, or the
 * node's binding naming the object) stays on the authored node, read in the
 * bag, as on `ObjectMapBlockSchema`: `requireRecordSource(…, 'properties')`
 * asks for `properties.objectName`, or the node's `dataSource` binding naming
 * its object (a non-empty `dataSource.object`), which `ElementDataSourceGate`
 * lands on `objectName` (the registration is `elementDataSourceBlock`-wrapped).
 * ⚠️ The spec row is looser here: it keeps `objectName` optional and adds no
 * such rule, so a node with no source passes the spec's own page component and
 * is refused by this arm, as the flat mirror refused it. The binding itself is
 * the spec's `ElementDataSourceSchema` by reference, as on the arms above.
 * Neither content channel is read, so both are refused with the objectui#9256
 * string the flat mirror uses.
 *
 * ## What did not move
 *
 * The TypeScript `ObjectGridSchema` and its zod mirror above stay published:
 * they are the node as `ObjectGrid` reads it after the hoist, and as code
 * composes it (`ObjectView`, `ListView`, the designers). The mirror also keeps
 * building the `object-view` `table` slot. A composed flat node keeps working,
 * because `SchemaRenderer` reads both spellings and no composed node passes
 * through `safeValidateSchema`.
 */
export const ObjectGridBlockSchema = BaseSchema.extend({
  type: z.literal('object-grid'),
  ...NODE_ENVELOPE,
  // A row member written flat on the node is refused by name, toward `properties.KEY`.
  ...flatPropRefusals('object-grid', stripImportedDefaults(SpecObjectGridPropsSchema)),
  properties: propsBag('object-grid', stripImportedDefaults(SpecObjectGridPropsSchema)),
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  // The flat mirror's retirements of keys the row does not declare: its own
  // tombstones, by reference, so their remedies stay the ones it published.
  operators: ObjectGridSchema.shape.operators,
  rowSpecActions: ObjectGridSchema.shape.rowSpecActions,
  bulkSpecActions: ObjectGridSchema.shape.bulkSpecActions,
  name: ObjectGridSchema.shape.name,
  placeholder: ObjectGridSchema.shape.placeholder,
  showFilters: ObjectGridSchema.shape.showFilters,
  // objectui#6124: `ObjectGrid` reads `onNavigate` off the node, so it is
  // declared exactly as the flat mirror declares it: a RUNTIME SLOT, refused by
  // name. Spelled as the helper call, as `ObjectFormBlockSchema` spells its five,
  // so `check:handler-key-reads` reads the disposition off this arm.
  onNavigate: handlerKeyRefusal('onNavigate', 'runtime-slot', 'Record navigation handler'),
  // objectui#9256: the renderer reads NEITHER content channel, so both are
  // refused by name — the flat mirror's own members, by reference.
  body: ObjectGridSchema.shape.body,
  children: ObjectGridSchema.shape.children,
}).superRefine(...requireRecordSource('object-grid', ['objectName'], 'properties'));

/**
 * objectui#11440 — `object-pivot`'s drill shape, the zod twin of
 * `ObjectPivotDrillDownConfig` (`../data-display.ts`): the shared
 * {@link DrillDownConfigSchema} with `mode` refused by name (objectui#10685).
 * Every click point on a pivot is an aggregated bucket, so it always drills
 * through to the records behind the value; there is no row to open as a record.
 */
const ObjectPivotDrillDownSchema = DrillDownConfigSchema.extend({
  mode: retirementTombstone(
    'REFUSED on `object-pivot` (objectui#10685) — `drillDown.mode` chooses drill-to-record for a clicked ROW, '
    + 'and every click point on a pivot is an aggregated bucket (a cell, a header or a total), so a pivot always '
    + 'drills through to the records behind the clicked value. `mode` applies on `object-data-table`, whose row '
    + 'click reads it. Delete the key.',
  ),
});

/**
 * objectui#11440 — the `object-pivot` props bag, built from the block's
 * registration `inputs` (`@object-ui/plugin-dashboard`). `@objectstack/spec`
 * has no `ComponentPropsMap['object-pivot']` row, so these are objectui's own
 * members. The cross-tab members are the `pivot` mirror's own
 * ({@link PivotTableSchema}), by reference; `objectName` and `filter` are the
 * two the object block adds, and `drillDown` is this block's drill shape
 * above, which the registration publishes as an input since the same change
 * (the `pivot` refusal of `drillDown` names this block as where a pivot drill
 * is authored, objectui#10932).
 *
 * Not declared, because the registration publishes neither: `data` (inline
 * rows — the `pivot` node's job) and `columnColors`. `dataProvider` is declared
 * as the retirement the block's TypeScript prop type already spells
 * (objectui#7353).
 *
 * `.passthrough()` like the other bags of objectui's own members
 * (`object-chart`, `flex`): a key the block does not declare is unjudged by the
 * tolerant face and refused by name by the strict one.
 */
const ObjectPivotPropsBag = z.looseObject({
  objectName: z.string().optional().describe(OBJECT_NAME_BINDING_WAIVER_DESCRIPTION),
  title: PivotTableSchema.shape.title,
  rowField: PivotTableSchema.shape.rowField,
  columnField: PivotTableSchema.shape.columnField,
  valueField: PivotTableSchema.shape.valueField,
  aggregation: PivotTableSchema.shape.aggregation,
  showRowTotals: PivotTableSchema.shape.showRowTotals,
  showColumnTotals: PivotTableSchema.shape.showColumnTotals,
  format: PivotTableSchema.shape.format,
  filter: z
    .array(z.unknown())
    .optional()
    .describe(
      'Query filter, forwarded as $filter with its context tokens ({current_user_id}, {current_org_id}) resolved '
      + 'first; a drill composes it with the clicked cell. A FilterArray — the registration publishes `filter` as an array.',
    ),
  drillDown: ObjectPivotDrillDownSchema.optional().describe(
    'Click-through config that opens the records behind a cell, header or total (drawer / dialog / navigate, or an '
    + 'analytical report). `mode` is refused: a pivot always drills through (objectui#10685)',
  ),
  // objectui#7353 — the twin of `ObjectPivotTable`'s `dataProvider?: never`, as
  // `ObjectDataTableSchema` declares it: refused by name, pointing at `objectName`.
  dataProvider: retirementTombstone(
    'REFUSED (objectui#7353, ADR-0049) — `object-pivot` does not read `dataProvider`. The dashboard producers used '
    + 'to copy the widget provider config onto the node beside `objectName`, and nothing read it. Write '
    + '`objectName` — the key the block fetches through.',
  ),
});

/**
 * The ONE refusal detail every `object-pivot` prop written flat on the node
 * gets (objectui#11440). `aliasKeyRefusal` puts the key and its bag member in
 * front of it: "Did you mean `rowField` → `properties.rowField`?".
 */
const OBJECT_PIVOT_FLAT_PROP =
  'An `object-pivot` node takes its props in its `properties` bag: write `{ "type": "object-pivot", '
  + '"properties": { "objectName": "…", "rowField": "…", "columnField": "…", "valueField": "…" } }` '
  + '(objectui#11440). `@objectstack/spec`\'s own page component refuses a prop written on the node as '
  + 'mis-layered (ADR-0089 D3a), so this face and `os validate` agree. The spec has no '
  + '`ComponentPropsMap[\'object-pivot\']` row, so the bag\'s members are the registration\'s own inputs. Moving '
  + 'it changes nothing at render time: `SchemaRenderer` hoists every `properties` key onto the node before '
  + '`ObjectPivotTable` reads it.';

/** objectui#11440 / objectui#9256: ONE refusal string for both content channels of `ObjectPivotBlockSchema`. */
const OBJECT_PIVOT_NEITHER_CHANNEL =
  'REFUSED (objectui#9256, ADR-0049) — `object-pivot` reads NEITHER content channel: its registration hands the '
  + 'node through `ElementDataSourceGate` to `ObjectPivotTable`, which reads no `children` or `body` (nor does '
  + 'the `PivotTable` it renders), and `SchemaRenderer` strips both out of the props bag it spreads. An authored '
  + 'value would render NOTHING — no render-time error or warning and no element; only the parser tier\'s '
  + '`not-a-container` warning (objectui#9910) noticed it (the registration declares no `children` input). What '
  + 'it renders instead: a cross-tab of the records of `properties.objectName` — '
  + '`rowField` down, `columnField` across, `valueField` aggregated by `aggregation`.';

/**
 * `object-pivot` — the AUTHORED node (objectui#11440, under the seat ruling
 * `5945530142` on objectui#10859: "Passes the criterion").
 *
 * ## The defect this closes
 *
 * `@object-ui/plugin-dashboard` registers `object-pivot` (`ObjectPivotBlock`),
 * ADR-0080 curates it in `PUBLIC_BLOCKS` Tier A, and no arm claimed it, so
 * `safeValidateSchema`, and `objectui validate` with it, refused every
 * document naming it with `invalid_union` at `type`.
 *
 * ## The construct
 *
 * The public-block construct of this module, the one `object-chart` uses for a
 * block with no spec row: `BaseSchema` + the `type` literal + `NODE_ENVELOPE` +
 * `properties` through `propsBag` + `flatPropRefusals` over the bag, so a
 * member written FLAT on the node is refused by name toward `properties.KEY`
 * (objectui#10872's triage answer A: the bag is the contract on a public
 * block). The bag ({@link ObjectPivotPropsBag}) is built from the
 * registration's `inputs`. The cross-tab members `rowField`, `columnField` and
 * `valueField` are required there, so the bag is required here; `objectName`
 * is required unless the node's `dataSource.object` names the object, because
 * the registration is `elementDataSourceBlock`-wrapped and the gate lands the
 * binding's object on `objectName` (`requireRecordSource`, keyed
 * `RECORD_SOURCE_REQUIRED`). `dataSource` is the spec's
 * `ElementDataSourceSchema` on the node, by reference, as on the other
 * gate-wrapped arms here.
 *
 * Neither content channel is read, so both are refused by name (objectui#9256).
 */
export const ObjectPivotBlockSchema = BaseSchema.extend({
  type: z.literal('object-pivot'),
  ...NODE_ENVELOPE,
  ...flatPropRefusals('object-pivot', ObjectPivotPropsBag, OBJECT_PIVOT_FLAT_PROP),
  properties: ObjectPivotPropsBag.describe(
    'The `object-pivot` props bag — the block\'s registration inputs (`objectName`, `title`, `rowField`, '
      + '`columnField`, `valueField`, `aggregation`, `showRowTotals`, `showColumnTotals`, `filter`, `format`, '
      + '`drillDown`). `@objectstack/spec` has no `ComponentPropsMap[\'object-pivot\']` row, so these are '
      + 'objectui\'s own members (objectui#11440).',
  ),
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  body: retirementTombstone(OBJECT_PIVOT_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_PIVOT_NEITHER_CHANNEL),
}).superRefine(...requireRecordSource('object-pivot', ['objectName'], 'properties'));

/**
 * objectui#11440 — the `embeddable-form` props bag: exactly the block's
 * registration `inputs` (`@object-ui/plugin-form`). `@objectstack/spec` has no
 * `ComponentPropsMap['embeddable-form']` row, so these are objectui's own
 * members, each typed as `EmbeddableFormConfig` (`@object-ui/plugin-form`)
 * types it. `formId` is required there, so the bag is required on the node;
 * `objectName` is required unless the node's `dataSource.object` names the
 * object (the registration is gate-wrapped).
 *
 * The component reads more of its config than the registration publishes
 * (`branding`, `thankYouPage`, the anti-spam keys and others). Those are not
 * declared: the registration is the published surface, and nothing teaches
 * them as JSON.
 */
const EmbeddableFormPropsBag = z.looseObject({
  formId: z.string().describe('The form\'s identifier — submissions are recorded against it'),
  objectName: z.string().optional().describe(OBJECT_NAME_BINDING_WAIVER_DESCRIPTION),
  title: z.string().optional().describe('Form title, drawn above the fields'),
  description: z.string().optional().describe('Instructions drawn under the title'),
  fields: z
    .array(z.string())
    .optional()
    .describe('Bare field names to show, in order, each looked up in the object schema'),
  allowMultiple: z.boolean().optional().describe('Let one visitor submit more than once'),
});

/**
 * The ONE refusal detail every `embeddable-form` prop written flat on the node
 * gets (objectui#11440).
 */
const EMBEDDABLE_FORM_FLAT_PROP =
  'An `embeddable-form` node takes its props in its `properties` bag: write `{ "type": "embeddable-form", '
  + '"properties": { "formId": "…", "objectName": "…" } }` (objectui#11440). `@objectstack/spec`\'s own page '
  + 'component refuses a prop written on the node as mis-layered (ADR-0089 D3a), so this face and `os validate` '
  + 'agree. The spec has no `ComponentPropsMap[\'embeddable-form\']` row, so the bag\'s members are the '
  + 'registration\'s own inputs. Moving it changes nothing at render time: `SchemaRenderer` hoists every '
  + '`properties` key onto the node before `EmbeddableForm` reads it.';

/** objectui#11440 / objectui#9256: ONE refusal string for both content channels of `EmbeddableFormBlockSchema`. */
const EMBEDDABLE_FORM_NEITHER_CHANNEL =
  'REFUSED (objectui#9256, ADR-0049) — `embeddable-form` reads NEITHER content channel: its registration hands '
  + 'the node through `ElementDataSourceGate` to `EmbeddableForm` as its `config`, which reads no `children` or '
  + '`body`, and `SchemaRenderer` strips both out of the props bag it spreads. An authored value would render '
  + 'NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning '
  + '(objectui#9910) noticed it (the registration declares no `children` input). What it renders instead: a '
  + 'standalone public form over `properties.objectName`, its fields from '
  + 'the object schema (or `properties.fields`).';

/**
 * `embeddable-form` — the AUTHORED node (objectui#11440, under the seat ruling
 * `5945530142` on objectui#10859: "Passes the criterion").
 *
 * `@object-ui/plugin-form` registers it (`EmbeddableFormRenderer`), ADR-0080
 * curates it in `PUBLIC_BLOCKS` Tier A, and no arm claimed it, so every
 * document naming it was refused with `invalid_union` at `type`. Built as
 * {@link ObjectPivotBlockSchema} above: the bag is the contract, a member
 * written flat is refused by name toward `properties.KEY`, `dataSource` is the
 * spec's binding on the node, and neither content channel is read.
 */
export const EmbeddableFormBlockSchema = BaseSchema.extend({
  type: z.literal('embeddable-form'),
  ...NODE_ENVELOPE,
  ...flatPropRefusals('embeddable-form', EmbeddableFormPropsBag, EMBEDDABLE_FORM_FLAT_PROP),
  properties: EmbeddableFormPropsBag.describe(
    'The `embeddable-form` props bag — the block\'s registration inputs (`formId`, `objectName`, `title`, '
      + '`description`, `fields`, `allowMultiple`). `@objectstack/spec` has no '
      + '`ComponentPropsMap[\'embeddable-form\']` row, so these are objectui\'s own members (objectui#11440).',
  ),
  dataSource: stripImportedDefaults(SpecElementDataSourceSchema)
    .optional()
    .describe(ELEMENT_DATA_SOURCE_BINDING_DESCRIPTION),
  body: retirementTombstone(EMBEDDABLE_FORM_NEITHER_CHANNEL),
  children: retirementTombstone(EMBEDDABLE_FORM_NEITHER_CHANNEL),
}).superRefine(...requireRecordSource('embeddable-form', ['objectName'], 'properties'));

/* ── The authored `list-view` node: its props in the `properties` bag ────── */

/**
 * The keys of `ListViewSchema` above that stay on the NODE of an authored
 * `list-view` (objectui#12670): every key `BaseSchema` declares that
 * `@objectstack/spec`'s `ListViewSchema` does not (`id`, `className`, `visible`,
 * the content channels and the rest of the node base), and the node's
 * `dataSource` binding, which the spec's `PageComponentSchema` declares beside
 * `properties` (objectui#11070). Read off the two declarations, not
 * transcribed: a key the node base gains stays on the node the day it lands,
 * and a key the spec's list view shares with the node base (`type`, `name`,
 * `label`, `description`, `data`) stays a list view member, in the bag.
 */
const LIST_VIEW_NODE_LEVEL_KEYS = Object.fromEntries(
  [
    ...Object.keys(BaseSchema.shape).filter((key) => !(key in stripImportedDefaults(SpecListViewSchema).shape)),
    'dataSource',
  ].map((key) => [key, true]),
) as {
  [K in Exclude<keyof typeof BaseSchema.shape, keyof z.input<typeof SpecListViewSchema>> | 'dataSource']: true;
};

/**
 * The ONE refusal detail a page `list-view` node's `objectName` gets, flat or in
 * `properties` (objectui#12670). `aliasKeyRefusal` puts the key and what to
 * write instead in front of it: "Did you mean `objectName` → `properties.data`?".
 */
const LIST_VIEW_PAGE_OBJECT_NAME_RETIRED =
  'A page `list-view` node names its object the way `@objectstack/spec`\'s list view does, in its `data` '
  + 'source: write `{ "type": "list-view", "properties": { "data": { "provider": "object", "object": "…" } } }`, '
  + 'or name the object in the node\'s `dataSource` binding (`dataSource.object`). `objectName` is retired on a '
  + 'page `list-view` node, flat or in `properties`, with no second spelling (ruling C on '
  + 'objectstack-ai/objectstack#22444), as the react layer retired it on `ListView` '
  + '(objectstack-ai/objectstack#14791).';

/** The same for a page `list-view` node's `viewType`: "Did you mean `viewType` → `properties.type`?". */
const LIST_VIEW_PAGE_VIEW_TYPE_RETIRED =
  'A page `list-view` node states its list kind the way `@objectstack/spec`\'s list view does, as `type`, and '
  + 'in `properties`, because the node\'s own `type` is the registry key `list-view`: write `{ "type": '
  + '"list-view", "properties": { "type": "kanban", … } }`. `viewType` is retired on a page `list-view` node, '
  + 'flat or in `properties`, with no second spelling (ruling C on objectstack-ai/objectstack#22444), as the '
  + 'react layer retired it on `ListView` (objectstack-ai/objectstack#14791).';

/**
 * objectui#10327's dataset-chart filter refusal, read in the bag: there the
 * view kind is the spec's own `type`, which `checkListViewDatasetChartFilter`
 * reads as `viewType` on the flat mirror. The same check, the same messages.
 */
function checkListViewBagDatasetChartFilter(
  bag: { type?: unknown; chart?: unknown; options?: unknown; filter?: unknown; filters?: unknown },
  ctx: z.RefinementCtx,
): void {
  checkListViewDatasetChartFilter({ ...bag, viewType: bag.type }, ctx);
}

/**
 * The `list-view` props bag (objectui#12670): the list view's members, BY
 * REFERENCE — every member `ListViewSchema` above declares beyond the
 * node-level keys, each the SAME schema object the mirror holds.
 *
 * ⛔ `@objectstack/spec` has no `ComponentPropsMap['list-view']` row at the
 * resolved version, and none is invented here (ruling C puts that row in the
 * spec, after this face moves). So the bag is built the way `object-chart`'s is
 * ({@link ObjectChartPropsBag}): from the flat mirror's shape. The mirror's
 * members ARE the spec's list view members by reference (`specFieldsExcept`
 * over the spec's `ListViewSchema`), with objectui's local overrides on top —
 * `columns` optional, the `kanban` / `calendar` / `gallery` / `timeline` blocks
 * with their named refusals, the legacy `options` bag, the toolbar flags. One
 * list view therefore has one set of property names wherever it is embedded,
 * as ruling C says: the bag accepts what the `ListView` component's
 * `ListViewSchema` props accept, except the two spellings the ruling renames.
 * ⛔ Not the spec's `ListViewSchema` verbatim: it requires `columns` (and a
 * kanban block's `columns`), which the ruling's option A, declined, would have
 * reported on every real page node.
 *
 * Three members differ from the mirror, each the ruling's:
 *
 *   - `type` is the list kind, the spec's own view-kind enum (grid, kanban,
 *     calendar, …) by reference. On the node, `type` is the registry key; in
 *     the bag it means what it means on the spec's list view.
 *   - `objectName` and `viewType` are refused by name, with what to write
 *     instead: `properties.data` and `properties.type`. ⛔ No fallback
 *     acceptance and no second spelling.
 *
 * The spec's two object-level list view checks are attached, both by
 * reference: `checkListViewCalendarVisualization`, as on the flat mirror, and
 * `checkListViewChartBinding`, which the flat mirror cannot attach (its view
 * kind is `viewType`) and the bag can, because its `type` is the spec's. So is
 * objectui's own dataset-chart filter refusal, read in the bag
 * ({@link checkListViewBagDatasetChartFilter}).
 *
 * The bag keeps the mirror's posture, `.passthrough()` (`BaseSchema`'s), so a
 * key the list view does not declare is judged in the bag exactly as it was on
 * the flat node: unjudged by the tolerant face, refused by name by the strict
 * authoring face, which closes every object it walks.
 */
const ListViewPropsBag = z
  .looseObject(ListViewSchema.shape)
  .omit(LIST_VIEW_NODE_LEVEL_KEYS)
  .extend({
    type: ViewKindEnum.optional().describe(
      'The list kind — `@objectstack/spec`\'s list view `type` (grid, kanban, gallery, calendar, timeline, gantt, '
        + 'map, chart, tree), by reference. Absent, the list is a grid, or the kind of the saved view the node\'s '
        + '`dataSource.view` names.',
    ),
    objectName: aliasKeyRefusal('objectName', 'properties.data', 'a page `list-view` node', LIST_VIEW_PAGE_OBJECT_NAME_RETIRED),
    viewType: aliasKeyRefusal('viewType', 'properties.type', 'a page `list-view` node', LIST_VIEW_PAGE_VIEW_TYPE_RETIRED),
  })
  .superRefine(checkListViewCalendarVisualization)
  .superRefine(checkListViewChartBinding)
  .superRefine(checkListViewBagDatasetChartFilter);

/**
 * The ONE refusal detail every list view member written flat on a page
 * `list-view` node gets (objectui#12670). `aliasKeyRefusal` puts the key and
 * its bag member in front of it: "Did you mean `columns` → `properties.columns`?".
 */
const LIST_VIEW_FLAT_PROP =
  'A page `list-view` node takes its props in its `properties` bag: write `{ "type": "list-view", '
  + '"properties": { "data": { "provider": "object", "object": "…" }, "type": "grid", "columns": ["…"] } }` '
  + '(objectui#12670). `@objectstack/spec`\'s own page component refuses a prop written on the node as '
  + 'mis-layered (ADR-0089 D3a), so this face and `os validate` agree. The spec has no '
  + '`ComponentPropsMap[\'list-view\']` row, so the bag\'s members are `ListViewSchema`\'s own, the list view\'s '
  + 'members by reference. Moving it changes nothing at render time: `SchemaRenderer` hoists each `properties` '
  + 'key but `type` and `id` onto the node before the list renderer reads it.';

/** objectui#12670 / objectui#9256: ONE refusal string for both content channels of `ListViewBlockSchema`. */
const LIST_VIEW_BLOCK_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'list-view',
  'its registration (`plugin-list:list-view`) hands the node, its `properties` hoisted, to `ListViewBlock`, '
    + 'which renders `ListView`',
  'the records of `properties.data` in the list kind `properties.type` names, shaped by `columns`, `filter`, '
    + '`sort` and `options`',
);

/**
 * `list-view` — the AUTHORED page node: its props in the `properties` bag
 * (objectui#12670, ruling C on objectstack-ai/objectstack#22444, triage's
 * option A).
 *
 * ## The defect this closes
 *
 * Ruling C converges the page carrier on the spec spelling: a page `list-view`
 * node names its object with `data: { provider: 'object', object }` (or the
 * node's `dataSource` binding) and its kind with `type`, in `properties`
 * because the node's own `type` is the registry key. This union used to arm
 * the node with the flat `ListViewSchema` above, the `ListView` component's
 * props, so `objectui validate` refused the ruled node (its record-source
 * refinement found no `objectName`, and the strict face named `properties` as
 * an unrecognized key) and accepted the retired flat `objectName` /
 * `viewType` one. The authoring door steered an author, human or AI, from the
 * ruled spelling back to the retired one.
 *
 * ## The construct
 *
 * The one `ObjectMapBlockSchema` and `ObjectChartBlockSchema` use: `BaseSchema`
 * + the `type` literal + `NODE_ENVELOPE` + `properties` through `propsBag` +
 * `flatPropRefusals` over the bag, so a list view member written FLAT on the
 * node is refused by name toward `properties.KEY`. The bag is
 * {@link ListViewPropsBag}, the flat mirror's own members by reference, as on
 * `object-chart`, because the spec has no row for this type. A member the
 * spec's page component also declares on the node (`label`, `aria`,
 * `responsive`) is not refused flat: `flatPropRefusals` leaves those alone, so
 * `label` keeps `BaseSchema`'s member, and the other two are left as every arm
 * leaves them. `objectName` and `viewType` are refused by name in both positions with the
 * same message, which names `properties.data` and `properties.type`: in the bag
 * they are retired members, so the flat refusal takes the bag's own member
 * (`flatPropRefusals` hands a retired member through).
 *
 * The five handler keys `ListView` reads are declared as the flat mirror
 * declares them: RUNTIME SLOTS, refused by name, so a flat one is not pointed
 * at a bag member. Spelled as the helper calls, as `ObjectGridBlockSchema`
 * spells its `onNavigate`, so `check:handler-key-reads` reads the disposition
 * off this arm.
 *
 * ## The record source, `dataSource` and the content channels
 *
 * `requireRecordSource(…, 'properties')` with one rung, `data`: the node needs
 * `properties.data` (an `object` provider names the object, a `value` provider
 * carries the rows), or the node's `dataSource` binding naming its object (a
 * non-empty `dataSource.object`, the predicate every gate-wrapped arm shares
 * since objectui#11117): the registration is `elementDataSourceBlock`-wrapped,
 * and `ElementDataSourceGate` lands the binding's object before `ListView`
 * runs. `properties.objectName` is NOT a rung: it is refused. Presence is
 * `!== undefined`, as on every arm (the maintainer ruling recorded
 * 2026-09-02). `dataSource` is the flat mirror's own member, the spec's
 * `ElementDataSourceSchema` by reference. Neither content channel is read, so
 * both are refused by name (objectui#9256).
 *
 * ## What did not move
 *
 * The flat `ListViewSchema` above and its TypeScript `ListViewSchema` stay
 * published as the `ListView` component's props: the node as the component
 * reads it, and as `ObjectView` and the app-shell list pages compose it. It is
 * no longer an arm of `AnyComponentSchema`. A composed node never passes
 * through `safeValidateSchema`.
 */
export const ListViewBlockSchema = BaseSchema.extend({
  type: z.literal('list-view'),
  ...NODE_ENVELOPE,
  // A list view member written flat on the node is refused by name, toward `properties.KEY`.
  ...flatPropRefusals('list-view', ListViewPropsBag, LIST_VIEW_FLAT_PROP),
  properties: propsBag(
    'list-view',
    ListViewPropsBag,
    'The `list-view` props bag — the members `ListViewSchema` declares beyond the node-level keys, by reference, '
      + 'with `type` as the list kind (`@objectstack/spec`\'s list view `type`) and `objectName` / `viewType` '
      + 'refused by name. `@objectstack/spec` has no `ComponentPropsMap[\'list-view\']` row (objectui#12670).',
  ),
  // objectui#11070 — the node's binding, the flat mirror's own member by
  // reference (the spec's `ElementDataSourceSchema`).
  dataSource: ListViewSchema.shape.dataSource,
  // The runtime slots `ListView` reads, declared as the flat mirror declares them.
  onAddRecord: handlerKeyRefusal('onAddRecord', 'runtime-slot', 'Add-record handler'),
  onBulkAction: handlerKeyRefusal('onBulkAction', 'runtime-slot', 'Bulk action handler'),
  onDensityChange: handlerKeyRefusal('onDensityChange', 'runtime-slot', 'Row density change handler'),
  onNavigate: handlerKeyRefusal('onNavigate', 'runtime-slot', 'Record navigation handler'),
  onPageSizeChange: handlerKeyRefusal('onPageSizeChange', 'runtime-slot', 'Page size change handler'),
  // objectui#9256: the renderer reads NEITHER content channel, so both are refused by name, each
  // kept a MEMBER.
  body: retirementTombstone(LIST_VIEW_BLOCK_NEITHER_CHANNEL),
  children: retirementTombstone(LIST_VIEW_BLOCK_NEITHER_CHANNEL),
}).superRefine(...requireRecordSource('list-view', ['data'], 'properties'));

/**
 * The public blocks above, as one arm of `AnyComponentSchema`
 * (objectui#10859, batches 2 to 6).
 *
 * A union of its own rather than more members of `ObjectQLComponentSchema`,
 * deliberately: that union mirrors the TypeScript union in `../objectql.ts`
 * member for member, and the authored node of each block here is declared by
 * the spec row its `properties` member reads, not there. `object-form`,
 * `object-map` and `object-gantt` are the spec-row arms with a member there:
 * each TypeScript twin is the node as its renderer reads it after the hoist,
 * not the authored document (batches 4 to 6).
 *
 * `object-chart` joined in objectui#11276, the one arm here with NO spec row:
 * `ComponentPropsMap` carries no `object-chart` entry, so its bag is the flat
 * `ObjectChartSchema` mirror's own members by reference, and its TypeScript
 * twin is likewise the node as `ObjectChart` reads it after the hoist.
 *
 * `object-grid` joined in objectui#11276's next batch, a spec-row arm like
 * `object-form`: its TypeScript twin is the node as `ObjectGrid` reads it after
 * the hoist, and its flat mirror keeps building the `object-view` `table` slot.
 *
 * `object-pivot` and `embeddable-form` joined in objectui#11440, two more arms
 * with NO spec row and, unlike `object-chart`, no flat mirror either: each bag
 * is built from the block's registration `inputs`, and no TypeScript
 * declaration in this package restates the node.
 *
 * `list-view` joined in objectui#12670, a no-row arm like `object-chart`: its
 * bag is the flat `ListViewSchema` mirror's own members by reference, and that
 * mirror, with its TypeScript twin, stays the `ListView` component's props.
 *
 * Each arm also spreads `NODE_ENVELOPE` from `./public-blocks.zod.ts`,
 * the node-level `responsiveStyles` every public block declares by reference to
 * the spec's `PageComponentSchema` (objectui#10872 batch 8) — the same one
 * declaration, not a copy of it. `ObjectGridSchema` and `ObjectChartSchema`
 * above spread it too (objectui#10872 batch 9).
 */
const ObjectQLPublicBlockComponentSchemaInferred = z.discriminatedUnion('type', [
  ObjectMetricBlockSchema,
  ObjectMasterDetailFormBlockSchema,
  ObjectTimelineBlockSchema,
  ObjectFormBlockSchema,
  ObjectMapBlockSchema,
  ObjectChartBlockSchema,
  ObjectGanttBlockSchema,
  ObjectGridBlockSchema,
  // objectui#11440 — two Tier A public blocks with no spec row; bags from their registration inputs.
  ObjectPivotBlockSchema,
  EmbeddableFormBlockSchema,
  // objectui#12670 — the authored page `list-view` node; its bag is the flat mirror's own members.
  ListViewBlockSchema,
]);

/**
 * The TYPE of {@link ObjectQLPublicBlockComponentSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface ObjectQLPublicBlockComponentZodType extends ObjectQLPublicBlockComponentSchemaInferredType {
  options: ObjectQLPublicBlockComponentSchemaInferredType['options'];
}
type ObjectQLPublicBlockComponentSchemaInferredType = typeof ObjectQLPublicBlockComponentSchemaInferred;

/** The union above, typed by its named {@link ObjectQLPublicBlockComponentZodType}. */
export const ObjectQLPublicBlockComponentSchema: ObjectQLPublicBlockComponentZodType = ObjectQLPublicBlockComponentSchemaInferred;
