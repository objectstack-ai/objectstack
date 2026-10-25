// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useDatasetDimensionLabels — the analytics label net for dataset-bound
 * REPORTS (objectui#4330), now a RE-EXPORT of the shared hook (objectui#4389).
 *
 * ## What this is
 *
 * The `{dimension → {value|authoredLabel → displayLabel}}` map every surface in
 * `DatasetReportRenderer` relabels its rows through. It is the SAME channel the
 * dashboard's `DatasetWidget` uses, not a report-side dialect — the resolution
 * walk, the option localization and the map construction are all the shared
 * `@object-ui/core` helpers PR #4324 landed:
 *
 *   `resolveDimensionFieldMeta` → `localizeFieldOptions` / `buildDimensionLabelMap`
 *   → `relabelDimensions` (applied by the caller)
 *
 * and the translator is `useSafeFieldLabel().fieldOptionLabel`, i.e.
 * `{ns}.fieldOptions.<object>.<field>.<value>` — the one convention list and
 * form surfaces already translate select options through. Nothing here decides
 * what a label IS; it only carries the object metadata to the helpers that do.
 *
 * ## Why this file is now three lines (objectui#4389)
 *
 * It used to hold a report-local COPY of the React glue — the context read, the
 * locale-free state, the effect, the memo — because `packages/core` was held by
 * objectui#4040 tranche 5 while #4330 was in flight and that card's surface was
 * the two plugin packages. `DatasetWidget` carried the same shape. The
 * duplication was filed as objectui#4389 and is retired here.
 *
 * The glue did NOT land in `@object-ui/core` as the card originally proposed:
 * that home was disproven by measurement and retired in the card's PM RULING #2
 * — `SchemaRendererContext` is defined in `@object-ui/react`, which depends on
 * core, so core importing it back is a cycle, and core is React-free by
 * declaration, by content, and by AGENTS.md §3. What could legally move into
 * core did (`loadDimensionFieldMeta`, `deriveDimensionLabelMaps`,
 * `dimensionOptionTranslator` — all pure); the React wiring lives once in
 * `@object-ui/react`, which both plugins already depend on.
 *
 * This file stays as the import path so `DatasetReportRenderer`'s three call
 * sites are untouched, and so this rationale keeps a home next to its consumer.
 *
 * ## Why the read is issued at all (the #4263 boundary, amended by #4330)
 *
 * A dataset report renders SERVER-RESOLVED rows (ADR-0021: a local select
 * dimension arrives carrying the object's AUTHORED English option label) and
 * used to load no object metadata whatever, which is exactly why PR #4324
 * carried no change to this package. With no option list on the client there is
 * nothing for the locale bundle to translate against, so a zh-CN report read
 * `Domestic` beside a related list reading 国内. The read is what closes that.
 *
 * It is not gated on "the dimension is a select", because select-ness is not
 * observable before the read: the spec's `DatasetDimension.type` enum is
 * `string|number|date|boolean|lookup` (no `select` member), and a select column
 * arrives on the wire typed `'string'`. The gate lands on the read's OUTPUT
 * instead, where it is exact — `resolveDimensionFieldMeta` returns an entry
 * only for a terminal field that actually carries `options`, so a
 * text/number/date/lookup dimension yields no map and `relabelDimensions`
 * returns the caller's rows by identity.
 *
 * ## The two properties this surface INHERITS rather than restates
 *
 * Both are bug fixes, and both used to be written out here as well as in the
 * dashboard — which is the drift objectui#4389 closed:
 *
 * - the read rides the host's AUTHENTICATED `apiFetch` (objectui#4121);
 * - the fetched metadata stays LOCALE-FREE in state (objectui#4030 / PR #4324),
 *   so a language switch re-labels in place instead of re-fetching.
 *
 * They are pinned once, at the shared hook, in
 * `packages/react/src/hooks/__tests__/useDatasetDimensionLabels.test.tsx`.
 *
 * ## `useDatasetDimensionMeta` (objectui#4906)
 *
 * The locale-free half alone, re-exported for the ONE report surface that
 * derives more from the resolved field metadata than label maps: the embedded
 * chart's per-category option COLOURS (`buildOptionColorMap`) and its declared
 * picklist ORDER (`buildCategoryOrder`, framework#3588) — the same two
 * derivations `DatasetWidget` already runs off this exact hook for its own
 * chart-only needs (see that hook's own doc comment). `DatasetReportChart` was
 * the one call site when objectui#4906 added it; since objectui#12243 the flat
 * table and the matrix read it too, for each select dimension's declared ORDER,
 * and derive their label maps from that same read, so no surface in
 * `DatasetReportRenderer` calls the label-only {@link useDatasetDimensionLabels}.
 */

export {
  useDatasetDimensionLabels,
  useDatasetDimensionMeta,
  type DimensionLabelMaps,
  type DatasetDimensionMeta,
} from '@object-ui/react';
