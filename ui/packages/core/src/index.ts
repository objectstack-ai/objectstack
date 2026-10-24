/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export type { SchemaNode, ComponentRendererProps } from './types/index.js';
export * from './registry/Registry.js';
export * from './registry/public-blocks.js';
export * from './registry/html-tier-intrinsics.js';
export * from './registry/PluginSystem.js';
export * from './registry/PluginScopeImpl.js';
export * from './registry/WidgetRegistry.js';
export * from './validation/index.js';
export * from './builder/schema-builder.js';
// The DOM pass-through whitelist of the SDUI widget prop contract
// (objectui#4425 phase 2): a registered widget's host element receives only
// what `toDomProps` passes — everything else is consumed or dropped.
// `@object-ui/fields` executes the SAME mechanism against its own declared key
// list (`pickDomProps`), so there is one judge, not two.
export * from './utils/dom-props.js';
export * from './utils/filter-converter.js';
export * from './utils/managedBy.js';
// The affordance-to-grant map (objectui#12082): every console affordance that
// offers a write reads the grant it exercises from this one table.
export * from './utils/affordanceGrants.js';
export * from './utils/extract-records.js';
// The non-grid row ceiling (objectui#7210), homed beside the `extractRecords`
// it wraps by objectui#7508's ruling A′. `@object-ui/react` re-exports three of
// these names and keeps only the React footnote, `NonGridRowCeilingNote`.
export * from './utils/non-grid-row-ceiling.js';
// The emptiness FLOOR (objectui#8496, director seat, decision batch #86): the
// weakest common claim about "is this value empty" — `null`, `undefined`, the
// empty string, the empty array — below `plugin-detail`, `plugin-list`,
// `plugin-kanban` and `@object-ui/fields`, each of which used to spell those
// four members privately. Surfaces EXTEND it or DECLINE a member out loud; ⛔
// the floor itself never grows past the four.
export * from './utils/emptiness.js';
export * from './utils/expand-fields.js';
// The RETIREMENT gate (objectui#4914, maintainer ruling B). Homed here rather
// than in `@object-ui/fields` because `@object-ui/components` is one of its six
// consumers and `fields` depends on `components` — see the module's docblock
// for why a second copy was not an option. `@object-ui/fields` re-exports every
// name, so its published surface is unchanged.
export * from './utils/retired-field-types.js';
export * from './utils/unmaterialized-fields.js';
// [#5729] The consumer half of objectstack#10235's ruling: the SERVED
// per-column sortability projection, and the one spelling of its contract
// (`entry exists && sortable: true`). Homed beside the storage-fact set above
// because a consumer that reaches for one must be able to see the other and
// know which one the platform actually served.
export * from './utils/column-sortability.js';
export * from './utils/column-identity.js';
export * from './utils/sort-values.js';
export * from './utils/sort-query.js';
export * from './utils/resolve-view-id.js';
export * from './evaluator/index.js';
export * from './actions/index.js';
export * from './query/index.js';
export * from './adapters/index.js';
export * from './theme/index.js';
export * from './data-scope/index.js';
export * from './errors/index.js';
export * from './utils/debug.js';
export * from './utils/debug-collector.js';
export * from './utils/freeze-schema.js';
export * from './protocols/index.js';
export * from './styling/scoped-styles.js';
export * from './runtime/capabilities.js';

/**
 * @deprecated Import `composeStacks` from `@objectstack/spec` instead.
 *
 * This re-export is kept only for backward compatibility and will be removed
 * in the next major version of `@object-ui/core`.
 */
export { composeStacks } from '@objectstack/spec';
export * from './utils/drill-down.js';
export * from './utils/date-macros.js';
// Session-scoped filter placeholders ({current_user_id} / {current_org_id}),
// the record-scoped `{record_id}` (objectui#7297),
// plus `resolveFilterPlaceholders`, the single entry point every surface
// should call so no vocabulary is silently skipped (objectstack-ai/objectstack#3574).
export * from './utils/filter-tokens.js';
export * from './utils/dashboard-filters.js';
export * from './utils/merge-filters.js';
export * from './utils/compare-to.js';
export * from './utils/chart-series.js';
// "Which result column carries the measure?" — one answer for the row
// projection and the series binding alike, delegated to the spec's own
// derivation so the two cannot drift (objectui#8266).
export * from './utils/chart-measure-key.js';
// "Which result column carries the CATEGORY?" — the same move on the other
// axis, delegated to the contract's own published derivation so a relay cannot
// floor the x-axis binding on a literal the aggregate contradicts
// (objectui#8269).
export * from './utils/chart-category-key.js';
// "Which CALL does an object-bound aggregate make when its `groupBy` is the
// structured date-bucketing node?" — the same move on the REQUEST rather than
// on a result column, so the chart and the metric cannot post two different
// wires for one authored shape (objectui#8613).
export * from './utils/object-aggregate-query.js';
// The AUTHORED half of a dataset-bound chart (objectui#4229's data/presentation
// split), shared by the dashboard widget and the report's embedded chart so the
// same spec keys are lowered identically on both (objectui#4877).
export * from './utils/chart-presentation.js';
// The ONE number-display formatter (objectui#4033) — grouping policy, display
// locale and the percent convention. It lived in `@object-ui/i18n` until
// objectui#4576; it is pure, and living above `core` was what kept
// `dataset-format` below from reaching it (so the two drifted). `@object-ui/i18n`
// re-exports these names unchanged, so both import paths name the same symbol.
export * from './utils/number-display.js';
// The ONE date-display path (objectui#7178) — the same story one type over.
// It lived in `@object-ui/fields`' React barrel, which `dataset-format`
// below could not import, so a date-valued measure rendered its raw ISO
// string. `@object-ui/fields` re-exports these names unchanged.
export * from './utils/date-display.js';
// The native date/time control adapters (objectui#3127), moved down from
// `@object-ui/fields` so `@object-ui/components`' data table can share them
// instead of keeping private copies (objectui#10625). `@object-ui/fields`
// re-exports these names unchanged.
export * from './utils/native-date-value.js';
export * from './utils/dataset-format.js';
// Pivot lookup-key encoders, shared by every cross-tab renderer so the
// dashboard widget and the report renderer key their buckets identically
// (objectstack#5473 / objectstack#5665).
export * from './utils/dataset-pivot.js';
export * from './utils/record-title.js';
// The one `colorField` ladder every record view shares (objectui#7243) — the
// gantt, calendar and timeline all resolve an authored option colour here
// instead of each guessing at the raw stored value.
export * from './utils/record-color.js';
export * from './utils/export-filename.js';
export * from './utils/reference-keys.js';
// Binds a fetched record into an expression scope the way the SERVER binds it
// (a relation is its foreign key, never the expanded record) — see
// `toPredicateRecord` for why an unnormalized one gives the same predicate
// different verdicts on different surfaces.
export * from './utils/predicate-record.js';
// The field-read rule for ONE record (objectui#10594, ruling A): the row as the
// viewer may read it, which every surface that builds a display value from a
// whole row calls. It replaced module-private copies in `@object-ui/fields`,
// `@object-ui/react`, `@object-ui/app-shell` and `@object-ui/plugin-detail`.
export * from './utils/without-denied-fields.js';
// The parent-relationship condition a detail-page related list is scoped by.
// One implementation, imported by BOTH the row query and the tab-badge count
// probe — objectui#8882 is what two of them cost.
export * from './utils/parent-scope.js';
// The other half of a view's field appetite: the fields its PREDICATES read,
// which the column-derived `$select` never asked the server for.
export * from './utils/predicate-fields.js';
// The THIRD source of a view's field appetite: the fields it GROUPS BY. The
// spec's `grouping` block is a sibling of `columns`, not a subset, so a grid
// may group by a field it never shows (objectui#7179).
export * from './utils/grouping-fields.js';
export * from './utils/normalize-list-view.js';
// The ONE record-source ladder, both halves. `resolveRecordSourceConfig`
// (`ce2aaefe1`) is the PRODUCER — the ruled `data` / `staticData` /
// `objectName` ladder, hand-copied into five view plugins with no gate holding
// them together. `resolveRecordSourceObjectName` (`b041b9c0c`) is the READER
// over its output: six view plugins each spelled "the object this block is
// bound to — the resolved data config's object when it names one, else
// `objectName`" locally, and had drifted. Both are deliberately SEPARATE from
// the `normalizeListViewSchema` gap-fill above: that one answers how
// `objectName` gets POPULATED when absent (#7477 ruling B), these answer which
// object a block RESOLVES (the three-rung ladder `77cb489b4` declared). Merging them
// would override one standing ruling or the other.
// A THIRD reading ships beside them since objectui#9571:
// `recordSourceDataArmForType` answers which `data` arm a registered block TYPE
// declares, for the one consumer that cannot be handed the arm as a parameter —
// `SchemaRenderer`, which is generic over every type and holds only
// `schema.type`. Read its docblock before adding a row; it transports the call
// sites' own literals rather than re-deriving them.
export * from './utils/record-source.js';
// The single home for the VALUE fallback prettifier (a stored value becomes a
// display string when nothing resolves it). `@object-ui/fields` and
// `@object-ui/plugin-charts` each carried a byte-identical private copy;
// both now re-export this one (objectui#5444). Its docstring also records why
// it stays distinct from `humanizeFieldKey`, the KEY fallback.
export * from './utils/humanize-label.js';
