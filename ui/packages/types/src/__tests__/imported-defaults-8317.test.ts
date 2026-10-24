// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE IMPORT BOUNDARY — "this mirror authors no default, imported subschemas
 * included" (objectui#8317, director ruling, decision batch #90, 2026-09-08,
 * under the maintainer's standing delegation).
 *
 * Batch #69 (objectui#7735) ruled the principle: *a validator validates; it
 * does not write values into an author's document.* PR #8299 delivered it for
 * the 41 `.default()` call sites this repository wrote. Batch #90 ruled that
 * the principle holds for EVERY key `safeValidateSchema` answers, so the 57
 * `ZodDefault` nodes that arrived by reference from `@objectstack/spec` are
 * stripped where the spec enters this package (`../zod/imported-defaults.ts`).
 *
 * ## What this file pins, and why each half is here
 *
 * The count itself lives next door in `zod-mirror-authors-no-defaults-7735.test.ts`
 * (the graph walk that priced #8299, now a ratchet at zero). This file pins the
 * three properties that make that zero SAFE rather than merely true:
 *
 *  1. **The accept set does not move.** Measured as a live differential against
 *     the RAW spec schemas — which are importable here, so this is a permanent
 *     pin and not a throwaway measurement. `.default(v)` carries optionality as
 *     well as a value, and a naive unwrap makes an omissible key REQUIRED: a
 *     silent accept-set narrowing on a published surface, which this ruling did
 *     not authorise.
 *  2. **Nothing else changes.** Same keys, same node types, same `def.checks`
 *     at every reachable node — a walk that dropped a `.superRefine()` would
 *     make this package ACCEPT what the spec refuses, and would leave no trace
 *     in any count.
 *  3. **The boundary cannot be bypassed.** A source-level census: every
 *     `@objectstack/spec` import in `../zod/*.zod.ts` is bound through
 *     `stripImportedDefaults`. Without this, the next spec import silently
 *     re-opens the hole and only a residue count — measured on some later day —
 *     would notice.
 *
 * Every assertion below carries a control that fires. A differential whose two
 * sides are the same object, or a census that matched nothing, is green for
 * reasons that have nothing to do with the ruling.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { z } from 'zod';
import {
  AppSchema as SpecAppSchema,
  AppContextSelectorSchema as SpecAppContextSelectorSchema,
  NavigationAreaSchema as SpecNavigationAreaSchema,
  ChartTypeSchema as SpecChartTypeSchema,
  ChartAxisSchema as SpecChartAxisSchema,
  ChartSeriesSchema as SpecChartSeriesSchema,
  DashboardSchema as SpecDashboardSchema,
  DashboardWidgetSchema as SpecDashboardWidgetSchema,
  GlobalFilterSchema as SpecGlobalFilterSchema,
  GroupingConfigSchema as SpecGroupingConfigSchema,
  PageSchema as SpecPageSchema,
  PageTypeSchema as SpecPageTypeSchema,
  PageVariableSchema as SpecPageVariableSchema,
  ListViewSchema as SpecListViewSchema,
  ViewSchema as SpecViewSchema,
  KanbanConfigSchema as SpecKanbanConfigSchema,
  GanttConfigSchema as SpecGanttConfigSchema,
  CalendarConfigSchema as SpecCalendarConfigSchema,
  GalleryConfigSchema as SpecGalleryConfigSchema,
  TimelineConfigSchema as SpecTimelineConfigSchema,
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
  I18nLabelSchema as SpecI18nLabelSchema,
  ChartAggregateSchema as SpecChartAggregateSchema,
  ChartDrillDownSchema as SpecChartDrillDownSchema,
  UserFilterFieldSchema as SpecUserFilterFieldSchema,
  ViewFilterRuleSchema as SpecViewFilterRuleSchema,
  // objectui#10859 batch 2 — the `ComponentPropsMap` rows of the two public
  // blocks `objectql.zod.ts` arms.
  ObjectMetricPropsSchema as SpecObjectMetricPropsSchema,
  ObjectMasterDetailFormPropsSchema as SpecObjectMasterDetailFormPropsSchema,
  ObjectTimelinePropsSchema as SpecObjectTimelinePropsSchema,
  ObjectFormPropsSchema as SpecObjectFormPropsSchema,
  ObjectMapPropsSchema as SpecObjectMapPropsSchema,
  ObjectGanttPropsSchema as SpecObjectGanttPropsSchema,
  ObjectGridPropsSchema as SpecObjectGridPropsSchema,
  // objectui#6152 round 8 — the rows whose `filter` the flat kanban / calendar arms read.
  ObjectKanbanPropsSchema as SpecObjectKanbanPropsSchema,
  ObjectCalendarPropsSchema as SpecObjectCalendarPropsSchema,
  // objectui#11440 — the report definition the authored `report` node wraps.
  ReportSchema as SpecReportSchema,
  // objectui#6152 round 6 — the spec schemas `ObjectGridSchema`'s mirror reads.
  RowColorConfigSchema as SpecRowColorConfigSchema,
  RowHeightSchema as SpecRowHeightSchema,
  BulkActionDefSchema as SpecBulkActionDefSchema,
  BulkActionOperationSchema as SpecBulkActionOperationSchema,
  // objectui#11227 — the list view's empty-state shape `ObjectGridSchema.emptyState` reads.
  EmptyStateSchema as SpecEmptyStateSchema,
  // objectui#10872 — the `ComponentPropsMap` rows the public-block arms read.
  PageHeaderProps as SpecPageHeaderProps,
  PageTabsProps as SpecPageTabsProps,
  PageCardProps as SpecPageCardProps,
  PageAccordionProps as SpecPageAccordionProps,
  PageContainerProps as SpecPageContainerProps,
  RecordDetailsProps as SpecRecordDetailsProps,
  RecordHighlightsProps as SpecRecordHighlightsProps,
  RecordRelatedListProps as SpecRecordRelatedListProps,
  RecordPathProps as SpecRecordPathProps,
  RecordActivityProps as SpecRecordActivityProps,
  RecordChatterProps as SpecRecordChatterProps,
  RecordHistoryProps as SpecRecordHistoryProps,
  RecordQuickActionsProps as SpecRecordQuickActionsProps,
  RecordReferenceRailProps as SpecRecordReferenceRailProps,
  RecordAlertProps as SpecRecordAlertProps,
  // objectui#10872 — the row `@objectstack/spec` 17.6.0 carries.
  RecordLineItemsProps as SpecRecordLineItemsProps,
  ElementTextPropsSchema as SpecElementTextPropsSchema,
  ElementButtonPropsSchema as SpecElementButtonPropsSchema,
  // objectui#10872 batch 4 — the six rows `@objectstack/spec` 17.5.0 carries.
  ElementDefinitionListPropsSchema as SpecElementDefinitionListPropsSchema,
  ElementRepeaterPropsSchema as SpecElementRepeaterPropsSchema,
  ActionButtonPropsSchema as SpecActionButtonPropsSchema,
  ActionIconPropsSchema as SpecActionIconPropsSchema,
  ActionGroupPropsSchema as SpecActionGroupPropsSchema,
  ActionMenuPropsSchema as SpecActionMenuPropsSchema,
  // objectui#10872 batch 2 — `element:number`'s row, and the node's `dataSource`.
  ElementNumberPropsSchema as SpecElementNumberPropsSchema,
  ElementDataSourceSchema as SpecElementDataSourceSchema,
  // objectui#12197 — the product-page blocks' API binding, their `dataSource`.
  ElementApiDataSourceSchema as SpecElementApiDataSourceSchema,
  // objectui#10872 batch 8 — the node-level `responsiveStyles` every public-block arm declares.
  ResponsiveStylesSchema as SpecResponsiveStylesSchema,
  objectNavTargetExclusivity,
  navItemVisibleDataNeedsDataSource,
  checkListViewCalendarVisualization,
  checkListViewChartBinding,
  checkPageSourceCompleteness,
  checkDashboardWidgetStageOrder,
  checkDashboardWidgetMetricMeasureArity,
  checkDashboardWidgetChartMeasureArity,
  checkPageRequiresKind,
  checkPageSlotPair,
  checkPageRegionPlacement,
  checkPageDefaultPlacement,
  checkPageMainRegionWidth,
  checkPageRecordBindingPlacement,
  VIEW_METADATA_MEMBERS as SpecViewMetadataMembers,
  // objectui#12736 — the form option's spec shape: the form-view option.
  FormSelectOptionSchema as SpecFormSelectOptionSchema,
} from '@objectstack/spec/ui';
import {
  FieldSchema as SpecFieldSchema,
  SelectOptionSchema as SpecSelectOptionSchema,
  // objectui#11266 — one `ObjectFormSchema.subforms[].columns` entry.
  InlineGridColumnSchema as SpecInlineGridColumnSchema,
} from '@objectstack/spec/data';
import {
  EvaluatedExpressionInputSchema as SpecEvaluatedExpressionInputSchema,
  EvaluatedExpressionSchema as SpecEvaluatedExpressionSchema,
} from '@objectstack/spec/shared';
import { stripImportedDefaults } from '../zod/imported-defaults.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIRROR_DIR = join(HERE, '..', 'zod');

/* ── the graph reader, shared by every measurement below ──────────────────── */

interface ZodDef {
  type: string;
  shape?: Record<string, unknown>;
  options?: unknown[];
  items?: unknown[];
  element?: unknown;
  rest?: unknown;
  valueType?: unknown;
  keyType?: unknown;
  left?: unknown;
  right?: unknown;
  in?: unknown;
  out?: unknown;
  innerType?: unknown;
  checks?: unknown[];
  getter?: () => unknown;
}
const defOf = (node: unknown): ZodDef | null =>
  (node as { _zod?: { def?: ZodDef } } | null)?._zod?.def ?? null;

/** Every node reachable from `roots`, with a `lazy` getter that throws RECORDED, never skipped. */
function walk(roots: unknown[]): { nodes: Set<unknown>; lazies: number; unreachable: string[] } {
  const nodes = new Set<unknown>();
  const unreachable: string[] = [];
  const seenLazy = new Set<unknown>();
  const stack: unknown[] = [];
  let lazies = 0;
  const push = (n: unknown): void => {
    if (!n || !defOf(n) || nodes.has(n)) return;
    nodes.add(n);
    stack.push(n);
  };
  roots.forEach(push);
  while (stack.length) {
    const node = stack.pop()!;
    const def = defOf(node)!;
    if (def.type === 'lazy') {
      lazies++;
      if (!seenLazy.has(node)) {
        seenLazy.add(node);
        try { push(def.getter!()); } catch (err) { unreachable.push(String(err)); }
      }
      continue;
    }
    if (def.shape) for (const v of Object.values(def.shape)) push(v);
    if (def.options) for (const v of def.options) push(v);
    if (def.items) for (const v of def.items) push(v);
    for (const k of ['element', 'rest', 'valueType', 'keyType', 'left', 'right', 'in', 'out', 'innerType'] as const) {
      if (def[k]) push(def[k]);
    }
  }
  return { nodes, lazies, unreachable };
}

const defaultsIn = (root: unknown): number =>
  [...walk([root]).nodes].filter((n) => defOf(n)!.type === 'default').length;

/**
 * The complete population this package imports from `@objectstack/spec`,
 * re-derived from the mirrors' own import statements by the census at the
 * bottom of this file — so a symbol added there and forgotten here is a RED
 * test, not a silent hole in the differential.
 */
const IMPORTED: Array<readonly [string, z.ZodType]> = [
  ['AppSchema', SpecAppSchema],
  ['AppContextSelectorSchema', SpecAppContextSelectorSchema],
  ['NavigationAreaSchema', SpecNavigationAreaSchema],
  ['ChartTypeSchema', SpecChartTypeSchema],
  ['DashboardSchema', SpecDashboardSchema],
  ['DashboardWidgetSchema', SpecDashboardWidgetSchema],
  ['GlobalFilterSchema', SpecGlobalFilterSchema],
  ['GroupingConfigSchema', SpecGroupingConfigSchema],
  ['PageSchema', SpecPageSchema],
  ['PageTypeSchema', SpecPageTypeSchema],
  ['PageVariableSchema', SpecPageVariableSchema],
  ['ListViewSchema', SpecListViewSchema],
  ['KanbanConfigSchema', SpecKanbanConfigSchema],
  ['GanttConfigSchema', SpecGanttConfigSchema],
  ['CalendarConfigSchema', SpecCalendarConfigSchema],
  ['GalleryConfigSchema', SpecGalleryConfigSchema],
  ['TimelineConfigSchema', SpecTimelineConfigSchema],
  // objectui#11168 slice 3: `ObjectTreeSchema.tree` is the spec's tree block,
  // crossed through this boundary like the other view-config blocks above.
  ['TreeConfigSchema', SpecTreeConfigSchema],
  ['HttpMethodSubsetSchema', SpecHttpMethodSubsetSchema],
  ['HttpRequestSchema', SpecHttpRequestSchema],
  ['ViewDataSchema', SpecViewDataSchema],
  ['ListColumnSchema', SpecListColumnSchema],
  ['SelectionConfigSchema', SpecSelectionConfigSchema],
  ['PaginationConfigSchema', SpecPaginationConfigSchema],
  ['UserActionsConfigSchema', SpecUserActionsConfigSchema],
  ['AriaPropsSchema', SpecAriaPropsSchema],
  ['NavigationConfigSchema', SpecNavigationConfigSchema],
  ['I18nLabelSchema', SpecI18nLabelSchema],
  ['ChartAggregateSchema', SpecChartAggregateSchema],
  // objectui#8885: `ObjectChartSchema.drillDown` crosses this boundary.
  ['ChartDrillDownSchema', SpecChartDrillDownSchema],
  ['SelectOptionSchema', SpecSelectOptionSchema],
  // objectui#12736: `SelectOptionSchema` (the SDUI form option) now spreads the
  // spec's FORM-VIEW option and reads the object-field option above only for
  // the key set it refuses.
  ['FormSelectOptionSchema', SpecFormSelectOptionSchema],
  // objectui#8069: the form field-rule triad's blank check hands a predicate's
  // TEXT to this schema and takes its verdict and sentence (ADR-0137 D1), so
  // the crossing is measured here like every other one.
  ['EvaluatedExpressionInputSchema', SpecEvaluatedExpressionInputSchema],
  // objectui#8347: `BaseSchema.visibleWhen`'s envelope arm is this schema, by
  // reference, and its verdict is `EvaluatedExpressionInputSchema`'s above.
  ['EvaluatedExpressionSchema', SpecEvaluatedExpressionSchema],
  // objectui#7265, the @object-ui/types slice: `UserFiltersSchema.fields[]`
  // stopped being a hand copy of the spec's field shape and now derives from
  // it, so that crossing is measured here like every other one.
  ['UserFilterFieldSchema', SpecUserFilterFieldSchema],
  // objectui#9559 (ruling B): `FilterOperatorSchema` stopped being a hand-kept
  // 14-member literal and is now this rule's own `operator` member, so the
  // crossing is measured here like every other one.
  ['ViewFilterRuleSchema', SpecViewFilterRuleSchema],
  // objectui#7690: `ChartSchema.xAxis` / `ChartSchema.yAxis` reference the
  // spec's axis config object, whose `showGridLines` / `logarithmic` defaults
  // are exactly what this boundary exists to keep out of a parse output.
  // objectui#10518: `ObjectChartSchema.xAxis` / `ObjectChartSchema.yAxis`
  // cross the same boundary with the same symbol, so this one entry measures
  // all four crossings.
  ['ChartAxisSchema', SpecChartAxisSchema],
  // objectui#10770: the author arm of `ObjectChartSchema.series` is the spec's
  // series schema, whose `yAxis` / `variant` defaults are exactly what this
  // boundary exists to keep out of a parse output.
  ['ChartSeriesSchema', SpecChartSeriesSchema],
  // objectui#7928: `ObjectViewSchema.listViews` is the view container's own
  // `listViews` record, crossed through this boundary, so the container is
  // measured here like every other crossing.
  ['ViewSchema', SpecViewSchema],
  // objectui#10859 batch 2: the `object-metric` and `object-master-detail-form`
  // arms' `properties` are their `ComponentPropsMap` rows, crossed through this
  // boundary, so both rows are measured here like every other crossing.
  ['ObjectMetricPropsSchema', SpecObjectMetricPropsSchema],
  ['ObjectMasterDetailFormPropsSchema', SpecObjectMasterDetailFormPropsSchema],
  // objectui#10859 batch 3: the `object-timeline` arm's `properties` is its
  // row, crossed the same way — and unlike the two above it carries spec
  // defaults (`timeline.scale`, the `navigation` members) for the strip to remove.
  ['ObjectTimelinePropsSchema', SpecObjectTimelinePropsSchema],
  // objectui#11440: the authored `report` node's `report` wrapper is the
  // spec's report definition, crossed the same way (`reports.zod.ts`).
  ['ReportSchema', SpecReportSchema],
  // objectui#10859 batch 4: the `object-form` arm's `properties` is its row,
  // crossed the same way; `objectql.zod.ts` also reads the row's key set off the
  // crossed copy to refuse each member written flat.
  ['ObjectFormPropsSchema', SpecObjectFormPropsSchema],
  // objectui#10859 batch 5: the `object-map` arm's `properties` is its row,
  // crossed the same way, and its key set is read off the crossed copy too.
  ['ObjectMapPropsSchema', SpecObjectMapPropsSchema],
  // objectui#10859 batch 6: the `object-gantt` arm's `properties` is its row,
  // crossed the same way; the row's key set, and its `gantt` block's, are read
  // off the crossed copy too. This row carries defaults (`data`'s `api`
  // provider), so the boundary returns a rebuilt copy.
  ['ObjectGanttPropsSchema', SpecObjectGanttPropsSchema],
  // objectui#11276 (the `object-grid` batch): the `object-grid` arm's
  // `properties` is its row, crossed the same way, and `flatPropRefusals` reads
  // the row's key set off the crossed copy. This row carries defaults too
  // (`data`'s `api` provider), so the boundary returns a rebuilt copy.
  ['ObjectGridPropsSchema', SpecObjectGridPropsSchema],
  // objectui#6152 round 8: the flat `ObjectKanbanSchema` / `ObjectCalendarSchema`
  // arms read their row's `filter` member (the `ViewFilterRule` array) by
  // reference, each row crossed through this boundary.
  ['ObjectKanbanPropsSchema', SpecObjectKanbanPropsSchema],
  ['ObjectCalendarPropsSchema', SpecObjectCalendarPropsSchema],
  // objectui#6152 round 6: the flat `ObjectGridSchema` mirror reads `rowColor` /
  // `rowHeight` as the spec schemas its twin names, and one `bulkActionDefs`
  // entry's `operation` and `visible` slot, each crossed through this boundary.
  ['RowColorConfigSchema', SpecRowColorConfigSchema],
  ['RowHeightSchema', SpecRowHeightSchema],
  ['BulkActionDefSchema', SpecBulkActionDefSchema],
  ['BulkActionOperationSchema', SpecBulkActionOperationSchema],
  // objectui#11227: the flat mirror's `emptyState` is the spec's `EmptyStateSchema`
  // by reference (the same schema the `object-grid` row holds since 17.6.0),
  // crossed through this boundary.
  ['EmptyStateSchema', SpecEmptyStateSchema],
  // objectui#10872: each ADR-0080 public-block arm's `properties` is the
  // block's `ComponentPropsMap` row, crossed through this boundary, so every
  // row is measured here like every other crossing (`page:section`,
  // `page:footer` and `page:sidebar` share `PageContainerProps`, and
  // `record:discussion` reads the `record:chatter` row, so one entry each).
  ['PageHeaderProps', SpecPageHeaderProps],
  ['PageTabsProps', SpecPageTabsProps],
  ['PageCardProps', SpecPageCardProps],
  ['PageAccordionProps', SpecPageAccordionProps],
  ['PageContainerProps', SpecPageContainerProps],
  ['RecordDetailsProps', SpecRecordDetailsProps],
  ['RecordHighlightsProps', SpecRecordHighlightsProps],
  ['RecordRelatedListProps', SpecRecordRelatedListProps],
  ['RecordPathProps', SpecRecordPathProps],
  ['RecordActivityProps', SpecRecordActivityProps],
  ['RecordChatterProps', SpecRecordChatterProps],
  ['RecordHistoryProps', SpecRecordHistoryProps],
  ['RecordQuickActionsProps', SpecRecordQuickActionsProps],
  ['RecordReferenceRailProps', SpecRecordReferenceRailProps],
  ['RecordAlertProps', SpecRecordAlertProps],
  // objectui#10872: the `record:line_items` arm reads its row as its
  // `properties` bag, crossed through this boundary like every other row.
  ['RecordLineItemsProps', SpecRecordLineItemsProps],
  ['ElementTextPropsSchema', SpecElementTextPropsSchema],
  ['ElementButtonPropsSchema', SpecElementButtonPropsSchema],
  // objectui#10872 batch 4: the six held blocks' arms read their rows as their
  // `properties` bags, each crossed through this boundary like every other
  // row. None carries a default or reaches a `z.lazy`, so each strip is the
  // identity function.
  ['ElementDefinitionListPropsSchema', SpecElementDefinitionListPropsSchema],
  ['ElementRepeaterPropsSchema', SpecElementRepeaterPropsSchema],
  ['ActionButtonPropsSchema', SpecActionButtonPropsSchema],
  ['ActionIconPropsSchema', SpecActionIconPropsSchema],
  ['ActionGroupPropsSchema', SpecActionGroupPropsSchema],
  ['ActionMenuPropsSchema', SpecActionMenuPropsSchema],
  // objectui#10872 batch 2: the `element:number` arm's bag is its row (with
  // `object` made optional after the strip), and its node declares
  // `dataSource` as the spec's element binding — two crossings, measured here
  // like every other one.
  ['ElementNumberPropsSchema', SpecElementNumberPropsSchema],
  ['ElementDataSourceSchema', SpecElementDataSourceSchema],
  // objectui#12197: every product-page block arm declares its `dataSource` as
  // the spec's API binding, `ElementApiDataSourceSchema`.
  ['ElementApiDataSourceSchema', SpecElementApiDataSourceSchema],
  // objectui#10872 batch 8: every public-block arm declares the node-level
  // `responsiveStyles` as the spec's `ResponsiveStylesSchema` (one shared
  // `NODE_ENVELOPE`, which batch 9 also spread into `flex`, `object-grid` and
  // `object-chart`), crossed through this boundary like every other
  // read. It carries no default and reaches no `z.lazy`, so the strip is the
  // identity function — the row is here because the census below requires
  // every imported symbol to be measured, not because the strip does work.
  ['ResponsiveStylesSchema', SpecResponsiveStylesSchema],
  // objectui#11070: `FormFieldSchema` reads spec `FieldSchema` members by
  // reference (the field metadata a hand-authored form writes on the entry
  // itself; `FormFieldSchema.shape` lists them), and `multiple` carries the
  // spec's `.default(false)` —
  // exactly what this boundary exists to keep out of a parse output.
  ['FieldSchema', SpecFieldSchema],
  // objectui#11266: one `ObjectFormSchema.subforms[].columns` entry is the spec's
  // inline grid column, crossed through this boundary. It carries no default and
  // reaches no `z.lazy`, so the strip is the identity function: the row is here
  // because the census below requires every imported symbol to be measured.
  ['InlineGridColumnSchema', SpecInlineGridColumnSchema],
  // objectui#6152 round 12: `ListViewSchema.options` is the flattened list
  // overlay's own legacy `options` bag. The binding is `VIEW_METADATA_MEMBERS`, a
  // RECORD of member schemas (see `SCHEMA_RECORDS` below), so what crosses is the
  // bag read off it, and that is what this row measures. It carries a default
  // (the chart block's `chartType`), so the boundary returns a rebuilt copy.
  ['ViewMetadataMembers', SpecViewMetadataMembers.listOverlay.shape.options.unwrap() as unknown as z.ZodType],
] as const;

/** The subset that actually carries an imported default — where the strip does work. */
const CARRIES_DEFAULT = IMPORTED.filter(([, s]) => defaultsIn(s) > 0);
/**
 * The clean imports the walker's `lazy` arm rebuilds anyway: no default
 * anywhere below them, but a `z.lazy` is, and that arm cannot answer "was
 * anything stripped below me?" without forcing the getter, so it always
 * rebuilds (the walker docblock in `../zod/imported-defaults.ts`). The identity
 * property therefore cannot hold for these, and they are NAMED rather than
 * inferred, so the set cannot grow in silence — the lazy test below holds it
 * equal to what the graph re-derives.
 *
 * EMPTY since `@objectstack/spec` 17.5.0 (objectui#11073). It named
 * `ElementDataSourceSchema` (objectui#10872 batch 2, the `element:number` arm's
 * `dataSource`), whose `filter` reached the recursive filter clause's `z.lazy`.
 * 17.5.0 converged that `filter` on the `ViewFilterRule` array, which reaches
 * no `z.lazy`, so the schema is clean and now comes back reference-equal like
 * every other member of `CARRIES_NONE`.
 */
const REBUILT_CLEAN: ReadonlySet<string> = new Set<string>();
/** …and the complement of both, where the strip must be the identity function. */
const CARRIES_NONE = IMPORTED.filter(([n, s]) => defaultsIn(s) === 0 && !REBUILT_CLEAN.has(n));

describe('the import boundary strips every imported default (objectui#8317)', () => {
  describe('positive controls — the instruments see something', () => {
    it('the imported population is non-empty and SPLIT, so neither branch below is vacuous', () => {
      expect(IMPORTED.length).toBeGreaterThan(20);
      expect(CARRIES_DEFAULT.length, 'nothing upstream carries a default — the strip is untested').toBeGreaterThan(5);
      expect(CARRIES_NONE.length, 'everything upstream carries a default — the identity half is untested').toBeGreaterThan(1);
    });

    it('the walker reaches real graphs, with nothing lost', () => {
      const { nodes, unreachable } = walk(IMPORTED.map(([, s]) => s));
      expect(unreachable).toEqual([]);
      expect(nodes.size).toBeGreaterThan(500);
    });

    /**
     * ⛔ The spec's own objects are NOT mutated. Every other consumer in the
     * workspace imports the same module instance; a walker that patched in
     * place would strip defaults out of `@objectstack/spec` for all of them and
     * every assertion in this file would still be green.
     */
    it('the RAW spec schemas still carry their defaults after the strip has run', () => {
      for (const [name, schema] of CARRIES_DEFAULT) {
        stripImportedDefaults(schema);
        expect(defaultsIn(schema), `${name} was mutated in place`).toBeGreaterThan(0);
      }
    });
  });

  describe('the strip', () => {
    it.each(CARRIES_DEFAULT.map(([n]) => [n] as const))('%s comes back with no ZodDefault in it', (name) => {
      const [, schema] = CARRIES_DEFAULT.find(([n]) => n === name)!;
      expect(defaultsIn(stripImportedDefaults(schema))).toBe(0);
    });

    /**
     * ⭐ THE IDENTITY PROPERTY — the ruling's reversibility, made mechanical.
     *
     * Batch #90 took option A over option B partly because "the 57 strips become
     * no-ops if the spec later adopts the same principle". That is only true if
     * the boundary is the identity function on a clean subtree, so it is
     * asserted rather than asserted-about: a schema with nothing to strip comes
     * back as the very same object.
     */
    it.each(CARRIES_NONE.map(([n]) => [n] as const))('%s has nothing to strip, so it comes back REFERENCE-EQUAL', (name) => {
      const [, schema] = CARRIES_NONE.find(([n]) => n === name)!;
      expect(stripImportedDefaults(schema)).toBe(schema);
    });

    it('the walker docblock\'s `lazy` count is re-derived, not quoted', () => {
      // The `lazy` arm is the one place the identity property cannot hold: it
      // must rebuild without forcing the getter, so a clean subtree behind a
      // `z.lazy` is rebuilt anyway. The module's docblock names SIX such
      // nodes (the fourth, `ViewSchema`'s form-field group, since objectui#7928;
      // the fifth, under `FieldSchema.relatedListFilter`, since objectui#11070;
      // the sixth, the form-field group under the `object-form` row's
      // `sections[].fields[]`, since the 17.7.0 bump, objectui#11717)
      // and says the exception costs nothing extra for every owner but the
      // ones `REBUILT_CLEAN` names (objectui#10872 batch 2), because each
      // other owner sits inside a schema that is being rebuilt regardless.
      // Both halves are measured here, so a spec bump or an import that moves
      // either one is red rather than quietly making the docblock false.
      expect(walk(IMPORTED.map(([, s]) => s)).lazies).toBe(6);
      const lazyOwners = IMPORTED.filter(([, s]) => walk([s]).lazies > 0);
      expect(lazyOwners.length, 'no schema owns a lazy — the count above found them elsewhere').toBeGreaterThan(0);
      // The clean owners are exactly the named set: rebuilt (so NOT the spec's
      // object), and answering every probe as the spec does (the accept-set
      // differential below runs over every `IMPORTED` row, these included).
      expect(
        lazyOwners.filter(([, s]) => defaultsIn(s) === 0).map(([n]) => n).sort(),
        'the clean imports the `lazy` arm rebuilds moved — update `REBUILT_CLEAN` and the docblock in '
          + '`../zod/imported-defaults.ts`',
      ).toEqual([...REBUILT_CLEAN].sort());
      for (const [name, schema] of IMPORTED.filter(([n]) => REBUILT_CLEAN.has(n))) {
        expect(stripImportedDefaults(schema), `${name} came back reference-equal — it left REBUILT_CLEAN`).not.toBe(schema);
      }
      for (const [name, schema] of lazyOwners.filter(([n]) => !REBUILT_CLEAN.has(n))) {
        expect(
          defaultsIn(schema),
          `${name} reaches a z.lazy but carries no default — the lazy exception now costs a ` +
            'rebuild of an otherwise clean subtree; update the docblock in `../zod/imported-defaults.ts`',
        ).toBeGreaterThan(0);
      }
    });
  });

  /**
   * THE ACCEPT SET. Both directions on documents built from each schema's own
   * declared keys, plus the shapes an author actually writes.
   */
  describe('the accept set does not move', () => {
    const PROBES: unknown[] = [
      undefined, null, {}, [], '', 0, false, 'page',
      { bogus: 1 },
      { mode: 'page' }, { mode: 'bogus' },
      { type: 'text' }, { type: 'bogus' },
      { field: 'status' }, { fields: [{ field: 'stage' }] },
      { endpoint: '/api/x' }, { id: 'x', label: 'y' },
      { name: 'a', label: 'A' }, { pageSize: 25 }, { pageSize: 'lots' },
    ];

    it.each(IMPORTED.map(([n]) => [n] as const))('%s answers every probe exactly as the spec does', (name) => {
      const [, raw] = IMPORTED.find(([n]) => n === name)!;
      const stripped = stripImportedDefaults(raw);
      for (const probe of PROBES) {
        expect(
          stripped.safeParse(probe).success,
          `${name} disagrees with @objectstack/spec on ${JSON.stringify(probe) ?? 'undefined'} — the ` +
            'strip must remove substitution and NOTHING else (objectui#8317)',
        ).toBe(raw.safeParse(probe).success);
      }
    });

    /**
     * The half a naive unwrap breaks, stated on the shape rather than on a
     * probe list. `.default(v)` makes a member omissible; `.removeDefault()`
     * alone gives that omissibility back to a bare `ZodDefault(T)` — so every
     * member that was omissible before must still be omissible after.
     *
     * ⚠️ Omissibility is a RUNG, and zod 4.6 has two omissible rungs
     * (objectui#11073): a `.default()` member answers `optin: 'defaulted'`
     * ("absent, and something is substituted"), where zod 4.4 answered
     * `'optional'` for it. Removing the substitution is this boundary's whole
     * job, so the stripped member answers `'optional'`: a rung CHANGE that is
     * not a narrowing. What must never happen is an omissible rung becoming
     * none at all, and a `'defaulted'` rung surviving the strip.
     */
    it.each(CARRIES_DEFAULT.map(([n]) => [n] as const))('%s: no member became REQUIRED', (name) => {
      const [, raw] = CARRIES_DEFAULT.find(([n]) => n === name)!;
      const rawShape = defOf(raw)?.shape;
      if (!rawShape) return;
      const strippedShape = defOf(stripImportedDefaults(raw))!.shape!;
      const optin = (n: unknown) => (n as { _zod?: { optin?: string } })._zod?.optin;
      for (const key of Object.keys(rawShape)) {
        const before = optin(rawShape[key]);
        const after = optin(strippedShape[key]);
        expect(
          after !== undefined,
          `${name}.${key} changed omissibility — removing a default must not narrow the accept set`,
        ).toBe(before !== undefined);
        expect(
          after,
          `${name}.${key}: the strip left a substituting rung behind, or moved a rung it had no default to remove`,
        ).toBe(before === 'defaulted' ? 'optional' : before);
      }
    });
  });

  /**
   * NOTHING ELSE CHANGES. Walked in parallel so the comparison is per-node
   * rather than a summary: same node types in the same places, same keys, and
   * — the one that has no other symptom — the same `def.checks`.
   */
  describe('keys, node types and checks survive the walk', () => {
    let totalCompared = 0;

    it.each(CARRIES_DEFAULT.map(([n]) => [n] as const))('%s keeps its shape, arms and checks', (name) => {
      const [, raw] = CARRIES_DEFAULT.find(([n]) => n === name)!;
      const stripped = stripImportedDefaults(raw);
      const seen = new Set<unknown>();
      let compared = 0;
      const compare = (a: unknown, b: unknown, path: string): void => {
        const da = defOf(a); const db = defOf(b);
        if (!da || !db) { expect(!!da, `${name}${path}`).toBe(!!db); return; }
        if (seen.has(a)) return;
        seen.add(a);
        compared++;
        // The one sanctioned difference: a `ZodDefault` is replaced by what it
        // was standing in for — `.removeDefault()`'s inner type, re-wrapped in
        // an optional unless it was already omissible. Both spellings are
        // legal here; what is NOT legal is the key becoming required, and the
        // omissibility assertion above measures that directly. Everything
        // below the replacement is compared as normal.
        if (da.type === 'default') {
          expect(
            (b as { _zod?: { optin?: string } })._zod?.optin,
            `${name}${path}: the replacement for a default is not omissible — removing a default ` +
              'must never make a key required',
          ).toBe('optional');
          // `.removeDefault()` hands back the inner type. The boundary re-wraps
          // it in an optional only when it was not already omissible, so the
          // node facing `da.innerType` is either `b` itself or `b`'s inner.
          const wrapped = db.type === 'optional' && defOf(da.innerType)!.type !== 'optional';
          compare(da.innerType, wrapped ? defOf(b)!.innerType : b, `${path}<default>`);
          return;
        }
        expect(db.type, `${name}${path}: node type changed`).toBe(da.type);
        expect((da.checks ?? []).length, `${name}${path}: a check was DROPPED by the walk`).toBe((db.checks ?? []).length);
        if (da.shape) {
          expect(Object.keys(db.shape ?? {}).sort(), `${name}${path}: keys changed`).toEqual(Object.keys(da.shape).sort());
          for (const k of Object.keys(da.shape)) compare(da.shape[k], db.shape![k], `${path}.${k}`);
        }
        if (da.options) {
          expect((db.options ?? []).length, `${name}${path}: arm count changed`).toBe(da.options.length);
          da.options.forEach((o, i) => compare(o, db.options![i], `${path}|${i}`));
        }
        for (const k of ['element', 'rest', 'valueType', 'keyType', 'left', 'right', 'in', 'out', 'innerType'] as const) {
          if (da[k]) compare(da[k], db[k], `${path}<${k}>`);
        }
      };
      compare(raw, stripped, '');
      // Per-schema floor is deliberately low — `SelectionConfigSchema` is three
      // nodes and that is the whole of it. The non-vacuity that matters is the
      // AGGREGATE below, which no single small schema can satisfy alone.
      expect(compared, `${name}: the parallel walk compared nothing`).toBeGreaterThan(1);
      totalCompared += compared;
    });

    it('the parallel walk covered the whole imported population, not a corner of it', () => {
      expect(
        totalCompared,
        'the per-schema comparisons above touched almost no nodes — they are green for the wrong reason',
      ).toBeGreaterThan(500);
    });
  });

  /**
   * THE BOUNDARY CANNOT BE BYPASSED — a source census, because this is the only
   * assertion that can see an import written TOMORROW. Every VALUE read of an
   * `@objectstack/spec` binding inside a mirror must be the direct argument of
   * `stripImportedDefaults(…)`.
   *
   * Three kinds of read are declared exceptions, and they are enumerated here
   * rather than pattern-matched, so adding a fourth is an edit to this list:
   *
   *  - a value VOCABULARY — `SpecListViewTypeEnum` / `ViewKindEnum`, which
   *    unwrap the spec's own `.default('grid')` to reach its enum. A set of
   *    values cannot write a key into a parsed document. ⚠️ They read the RAW
   *    binding on purpose: `stripImportedDefaults` leaves the STATIC type
   *    unchanged, so `.removeDefault()` on the stripped member would typecheck
   *    and throw.
   *  - a TYPE position, where there is no runtime schema to strip and the
   *    declared type is unchanged by the strip anyway.
   *  - a chained REFINEMENT (objectui#8563) — a spec check FUNCTION such as
   *    `objectNavTargetExclusivity`, which a mirror mounts on its own schema.
   *    There is no Zod graph to walk and no default to remove: the whole effect
   *    of a refinement is `ctx.addIssue`, so it cannot write a value into a
   *    parsed document, which is the only thing this boundary is about.
   */
  describe('every `@objectstack/spec` value read in the mirrors goes through the boundary', () => {
    /** `<file>:<enclosing const>` for each read that is allowed to stay raw. */
    const VOCABULARY_EXCEPTIONS = new Set([
      'views.zod.ts:SpecListViewTypeEnum',
      'objectql.zod.ts:ViewKindEnum',
    ]);

    /**
     * Spec CHECK FUNCTIONS a mirror chains, keyed by binding name rather than by
     * owning const: a refinement is read inside whichever schema mounts it, and
     * the same rule may be mounted on more than one. Chaining these is the
     * POINT rather than a tolerated exception — a mirror that restated the rule
     * body instead would drift from the spec's the day the spec's own moved,
     * which is the defect objectui#8563 closed.
     *
     * Held as name → binding so the assertion below can check each entry really
     * is a function: a schema must not reach this list merely by being listed.
     */
    const REFINEMENT_EXCEPTIONS = new Map<string, unknown>([
      ['objectNavTargetExclusivity', objectNavTargetExclusivity],
      // objectui#13076: the spec's `visible`-reads-`data` rule, which `@objectstack/spec` mounts on its
      // whole navigation union; chained on `NavigationItemSchema`'s flat arm and its `doc` arm.
      ['navItemVisibleDataNeedsDataSource', navItemVisibleDataNeedsDataSource],
      // objectui#7715 (ruling B1): the spec's exported object-level checks that
      // `ListViewSchema` and `PageNodeSchema` re-attach after `specFieldsExcept`
      // rebuilt them without the spec object's own checks.
      ['checkListViewCalendarVisualization', checkListViewCalendarVisualization],
      ['checkPageSourceCompleteness', checkPageSourceCompleteness],
      // objectui#11073: the two `@objectstack/spec` 17.5.0 added to `DashboardWidgetSchema`,
      // re-attached by objectui's `DashboardWidgetSchema` under the same ruling.
      ['checkDashboardWidgetStageOrder', checkDashboardWidgetStageOrder],
      ['checkDashboardWidgetMetricMeasureArity', checkDashboardWidgetMetricMeasureArity],
      // objectui#11717: the two `@objectstack/spec` 17.7.0 checks the mirrors re-attach
      // under the same ruling — the chart measure-arity check on `DashboardWidgetSchema`
      // (objectui#11334 / objectui#11417) and the page `requires` ⇄ `kind` check on
      // `PageNodeSchema` and `PageKindNodeSchema`.
      ['checkDashboardWidgetChartMeasureArity', checkDashboardWidgetChartMeasureArity],
      ['checkPageRequiresKind', checkPageRequiresKind],
      // objectui#12030: the page slot-pair check `@objectstack/spec` 18 adds to
      // `PageSchema`, re-attached on `PageNodeSchema` and `PageKindNodeSchema`
      // under the same ruling.
      ['checkPageSlotPair', checkPageSlotPair],
      // objectui#12370's page view-data check left this list with objectui#12666: objectstack#23784
      // removed it from the spec, and no mirror attaches it.
      // objectui#12626: the two page checks `@objectstack/spec` 18.0.0-next.2 adds to
      // `PageSchema` — region placement by `template`, re-attached on `PageNodeSchema` and
      // `PageKindNodeSchema`, and `isDefault` placement, on `PageKindNodeSchema` only.
      ['checkPageRegionPlacement', checkPageRegionPlacement],
      ['checkPageDefaultPlacement', checkPageDefaultPlacement],
      // objectui#12971: the two page checks objectstack `main` adds to `PageSchema` after
      // 18.0.0-next.3 — the `main` region's `width`, re-attached on `PageNodeSchema` and
      // `PageKindNodeSchema`, and `record` binding placement, on `PageKindNodeSchema` only.
      ['checkPageMainRegionWidth', checkPageMainRegionWidth],
      ['checkPageRecordBindingPlacement', checkPageRecordBindingPlacement],
      // objectui#12670: the list view chart-binding check `@objectstack/spec` 18 carries on
      // `ListViewSchema`, attached on the authored page `list-view` node's bag
      // (`ListViewPropsBag`), whose `type` is the spec's view kind.
      ['checkListViewChartBinding', checkListViewChartBinding],
    ]);

    /**
     * Spec RECORDS OF SCHEMAS a mirror reads one member of, keyed by binding name
     * (objectui#6152 round 12). Such a binding has no Zod internals, so it cannot
     * itself be the argument of `stripImportedDefaults`; the read is accepted only
     * when the WHOLE member chain rooted at the binding is that argument
     * (`stripImportedDefaults(SpecViewMetadataMembers.listOverlay.shape.options.unwrap())`),
     * which still puts everything that crosses through the boundary. ⛔ Not a
     * route for a schema binding: the assertion below requires each entry to be a
     * non-Zod object whose every value is a schema, and a schema binding keeps the
     * one-hop `stripImportedDefaults(<binding>)` spelling.
     */
    const SCHEMA_RECORDS = new Map<string, unknown>([
      ['SpecViewMetadataMembers', SpecViewMetadataMembers],
    ]);

    const isSpecModule = (m: string): boolean =>
      m === '@objectstack/spec' || m.startsWith('@objectstack/spec/');

    interface Read { file: string; line: number; name: string; owner: string | null; wrapped: boolean; wrappedViaMember: boolean; kind: 'value' | 'type' }

    const mirrorFiles = readdirSync(MIRROR_DIR).filter((f) => f.endsWith('.zod.ts')).sort();
    const reads: Read[] = [];
    for (const file of mirrorFiles) {
      const text = readFileSync(join(MIRROR_DIR, file), 'utf8');
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const aliases = new Set<string>();
      const importRanges: [number, number][] = [];
      for (const stmt of sf.statements) {
        if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
        if (!isSpecModule(stmt.moduleSpecifier.text)) continue;
        importRanges.push([stmt.getStart(sf), stmt.getEnd()]);
        const named = stmt.importClause?.namedBindings;
        if (named && ts.isNamedImports(named)) for (const el of named.elements) aliases.add(el.name.text);
      }
      if (aliases.size === 0) continue;
      const owningConst = (n: ts.Node): string | null => {
        for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
          if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
        }
        return null;
      };
      const inTypePosition = (n: ts.Node): boolean => {
        for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
          if (ts.isTypeNode(p) || ts.isTypeQueryNode(p) || ts.isTypeAliasDeclaration(p)) return true;
        }
        return false;
      };
      const visit = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && aliases.has(n.text)) {
          const pos = n.getStart(sf);
          const inImport = importRanges.some(([a, b]) => pos >= a && pos < b);
          if (!inImport) {
            const parent = n.parent;
            const isStripCallOn = (call: ts.Node | undefined, arg: ts.Node): boolean =>
              !!call && ts.isCallExpression(call) &&
              ts.isIdentifier(call.expression) && call.expression.text === 'stripImportedDefaults' &&
              call.arguments.length === 1 && call.arguments[0] === arg;
            const wrapped = isStripCallOn(parent, n);
            // The member chain rooted at the binding (`.a.b`, `.unwrap()` calls),
            // climbed to its top; see `SCHEMA_RECORDS`.
            let chainTop: ts.Node = n;
            for (;;) {
              const up = chainTop.parent;
              if (up && ts.isPropertyAccessExpression(up) && up.expression === chainTop) { chainTop = up; continue; }
              if (up && ts.isCallExpression(up) && up.expression === chainTop) { chainTop = up; continue; }
              break;
            }
            const wrappedViaMember = chainTop !== n && isStripCallOn(chainTop.parent, chainTop);
            reads.push({
              file,
              line: sf.getLineAndCharacterOfPosition(pos).line + 1,
              name: n.text,
              owner: owningConst(n),
              wrapped,
              wrappedViaMember,
              kind: inTypePosition(n) ? 'type' : 'value',
            });
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }

    it('the census found the reads it is meant to police', () => {
      expect(reads.length, 'no `@objectstack/spec` read found in any mirror — the census is vacuous').toBeGreaterThan(40);
      expect(new Set(reads.map((r) => r.file)).size).toBeGreaterThan(4);
      expect(reads.filter((r) => r.wrapped).length, 'the census can see no wrapped read at all').toBeGreaterThan(40);
    });

    it('no value read bypasses `stripImportedDefaults`', () => {
      const offenders = reads
        .filter((r) => r.kind === 'value' && !r.wrapped)
        .filter((r) => !VOCABULARY_EXCEPTIONS.has(`${r.file}:${r.owner}`))
        .filter((r) => !REFINEMENT_EXCEPTIONS.has(r.name))
        .filter((r) => !(SCHEMA_RECORDS.has(r.name) && r.wrappedViaMember));
      expect(
        offenders.map((r) => `${r.file}:${r.line} ${r.name} (in \`${r.owner ?? '<top level>'}\`)`),
        'an `@objectstack/spec` schema crosses into a mirror without the objectui#8317 import ' +
          'boundary. Wrap it: `stripImportedDefaults(<binding>)`. ⛔ Do not exempt it — a validator ' +
          'does not write values into an author\'s document, imported subschemas included ' +
          '(decision batch #90). A read that genuinely is not a crossing (a value vocabulary) goes ' +
          'in `VOCABULARY_EXCEPTIONS` above, with the reason.',
      ).toEqual([]);
    });

    it('every declared exception still exists, and still reads a RAW binding', () => {
      // An exception nobody uses is a hole waiting for a name collision. Both of
      // these must be live, and both must be UNWRAPPED — if one were wrapped,
      // `.removeDefault()` would typecheck and throw, and this list would be
      // silently protecting nothing.
      for (const key of VOCABULARY_EXCEPTIONS) {
        const [file, owner] = key.split(':');
        const matching = reads.filter((r) => r.file === file && r.owner === owner && r.kind === 'value');
        expect(matching.length, `declared exception ${key} matches no read — delete it`).toBeGreaterThan(0);
        for (const r of matching) expect(r.wrapped, `${key} is wrapped; the exception is dead`).toBe(false);
      }
    });

    it('every declared refinement exception is a LIVE FUNCTION, not a schema in disguise', () => {
      expect(REFINEMENT_EXCEPTIONS.size, 'the list is empty — delete it rather than leave a hole').toBeGreaterThan(0);
      for (const [name, binding] of REFINEMENT_EXCEPTIONS) {
        expect(typeof binding, `${name} is not a function, so it does not belong in this list`).toBe('function');
        expect(
          '_zod' in Object(binding),
          `${name} carries Zod internals — it is a schema, and a schema crosses the boundary`,
        ).toBe(false);
        const matching = reads.filter((r) => r.name === name && r.kind === 'value');
        expect(matching.length, `declared exception ${name} matches no read — delete it`).toBeGreaterThan(0);
      }
    });

    it('every declared schema record is a RECORD of schemas, read only through a wrapped member chain', () => {
      expect(SCHEMA_RECORDS.size, 'the list is empty — delete it rather than leave a hole').toBeGreaterThan(0);
      for (const [name, binding] of SCHEMA_RECORDS) {
        expect('_zod' in Object(binding), `${name} is a schema — it crosses as \`stripImportedDefaults(${name})\``).toBe(false);
        const values = Object.values(binding as Record<string, unknown>);
        expect(values.length, `${name} holds nothing`).toBeGreaterThan(0);
        for (const v of values) expect('_zod' in Object(v), `${name} holds a value that is not a schema`).toBe(true);
        const matching = reads.filter((r) => r.name === name && r.kind === 'value');
        expect(matching.length, `declared record ${name} matches no read — delete it`).toBeGreaterThan(0);
        for (const r of matching) {
          expect(r.wrappedViaMember, `${r.file}:${r.line} reads ${name} outside \`stripImportedDefaults(${name}.…)\``).toBe(true);
        }
      }
    });

    it('every symbol the mirrors import is covered by the differential above', () => {
      const differential = new Set(IMPORTED.map(([n]) => n));
      const missing = [...new Set(reads.map((r) => r.name.replace(/^Spec/, '')))]
        .filter((n) => !differential.has(n) && !REFINEMENT_EXCEPTIONS.has(n));
      expect(
        missing,
        'a schema imported by a mirror is not in this file\'s `IMPORTED` list, so nothing measures ' +
          'whether the strip moved its accept set. Add it.',
      ).toEqual([]);
    });
  });
});
