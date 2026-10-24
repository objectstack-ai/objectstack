/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - ObjectQL Component Schemas
 * 
 * Type definitions for ObjectQL-specific components.
 * These schemas enable building ObjectQL-aware interfaces directly from object metadata.
 * 
 * Now aligned with @objectstack/spec view.zod schema for better interoperability.
 * 
 * @module objectql
 * @packageDocumentation
 */

import type { BaseSchema } from './base.js';
// `KanbanCard` is the kanban CARD vocabulary, declared once in `./complex.ts`
// and read here by `ObjectKanbanSchema.columns` (objectui#8913) so the two
// kanban faces judge a card the same way. Type-only: no runtime edge.
import type { KanbanCard } from './complex.js';
import type { DataTableSchema, ObjectDataTableDrillDownConfig } from './data-display.js';
// `QueryParams` is the destination `ObjectGallerySchema.filter`'s own docblock
// names — the value is forwarded into that slot, context tokens resolved — so the declaration
// is an INDEXED ACCESS on it rather than a copy of its arms (objectui#9309).
// Type-only: no runtime edge, and `./data.ts` imports nothing from here, so
// this adds no cycle in either direction.
import type { QueryParams } from './data.js';
import type { BulkActionOperation } from '@objectstack/spec/ui';
// objectui#11070 — the per-element binding `dataSource` declares, by reference.
import type { ElementDataSource } from '@objectstack/spec/ui';
// objectui#10872 batch 9 — the per-breakpoint style maps `responsiveStyles` declares
// on `ObjectGridSchema` and `ObjectChartSchema`, by reference.
import type { ResponsiveStyles as SpecResponsiveStyles } from '@objectstack/spec/ui';
// objectui#11266 — one `ObjectFormSchema.subforms[].columns` entry, by reference:
// the spec's `InlineGridColumn` (its `z.input`, the authoring face), which the zod
// twin judges with the spec's own `InlineGridColumnSchema`. Type-only.
import type { InlineGridColumn as SpecInlineGridColumn } from '@objectstack/spec/data';
// objectui#11615 — the form view's `{ field }` section entry, by reference: the
// spec's `FormFieldInput` (the authoring face of `FormFieldSchema`, the arm the
// spec's `FormSectionSchema.fields` takes beside a bare name). Type-only.
import type { FormFieldInput as SpecFormFieldInput } from '@objectstack/spec/ui';
// objectui#7928 — `ObjectViewSchema.listViews` is the protocol's record of this
// schema, BY REFERENCE. The spec publishes a TS type for `ListView` and none for
// the object-scoped `ObjectListView`, so the member reads it as `z.input` (the
// authoring face: the mirror strips every imported default). Type-only.
import type { ObjectListViewSchema as SpecObjectListViewSchema } from '@objectstack/spec/ui';
import type { z } from 'zod';
// objectui#10946 — `BulkActionDef.visible` names the ONE objectui spelling of the
// predicate wire instead of restating its union inline. Type-only, and
// `./expression.ts` imports nothing, so this adds no cycle.
import type { ExpressionWire } from './expression.js';
import type { FormField } from './form.js';
// ListView type is now derived from the zod schema (issue #2231) — see ListViewSchema below.
import type { ListViewInferred, ObjectCalendarBlockConfig } from './zod/objectql.zod.js';

/**
 * The type of {@link ObjectCalendarSchema.calendar}, re-exported so the
 * published member has a NAME an importer can write (objectui#8651).
 *
 * ⛔ Spelled with its `from` clause deliberately: a re-export with no module
 * specifier is judged as its own declaration by
 * `scripts/check-spec-symbol-derivation.mjs`, which is the same reason
 * `plugin-calendar`'s deprecated aliases carry theirs.
 *
 * Without this the member was typed by a name no consumer could reach — exactly
 * the "measurably unreachable" property objectui#8651 removed from that
 * plugin's local `CalendarSchema`, and it must not come back one layer over.
 */
export type { ObjectCalendarBlockConfig } from './zod/objectql.zod.js';

// ============================================================================
// Spec-Canonical Types — imported from @objectstack/spec/ui
// Rule: "Never Redefine Types. ALWAYS import them."
// ============================================================================

/**
 * HTTP Method for API requests
 * Canonical definition from @objectstack/spec/ui.
 *
 * The spec renamed this export twice. `HttpMethod` used to name two DIFFERENT
 * types depending on the entry point — the 7-value enum on `./shared` / `./api`
 * (which adds `HEAD` / `OPTIONS`) and the 5-value UI subset on `./ui`. 17.0.0
 * split them as `HttpMethodType` (objectstack#4691); 17.0.0-rc.5 renamed that
 * again to `HttpMethodSubset` (objectstack#5832, objectstack `795b6e1aa`), because
 * `schemaNameFromExportKey` strips the `Schema` suffix and both enums published
 * as `shared/HttpMethod` — the later write won, so the emitted JSON Schema and
 * reference page described only the 5-value one.
 *
 * The 5-value RUNTIME domain is unchanged by either rename; we alias it back to
 * `HttpMethod` so `@object-ui/types`' public surface stays verbatim identical.
 * Do NOT re-point this at the spec's bare `HttpMethod`: that is the 7-value
 * enum, and `ApiDataSource` means the 5-value one. Widening it would let
 * `method: 'HEAD'` compile and then throw in `HttpRequestSchema.parse()`.
 */
export type { HttpMethodSubset as HttpMethod } from '@objectstack/spec/ui';

/**
 * HTTP Request Configuration (the shape `ApiDataSource` is constructed with).
 * Canonical definition from @objectstack/spec/ui.
 */
export type { HttpRequest } from '@objectstack/spec/ui';

/**
 * View Data Source Configuration
 * Canonical definition from @objectstack/spec/ui.
 *
 * The modes a view binds:
 * 1. 'object': Standard Protocol - Auto-connects to ObjectStack Metadata and Data APIs
 * 2. 'value': Static Data - Hardcoded data array
 *
 * The view-level 'api' mode is retired in @objectstack/spec (objectstack#23082):
 * a metadata-declared API call is the page element's `dataSource` binding, and
 * nothing in objectui reads a view's 'api' block (objectui#12325).
 */
export type { ViewData } from '@objectstack/spec/ui';

/**
 * List Column Configuration
 * Canonical definition from @objectstack/spec/ui.
 */
export type { ListColumn } from '@objectstack/spec/ui';

/**
 * Selection Configuration
 * Canonical definition from @objectstack/spec/ui.
 */
export type { SelectionConfig } from '@objectstack/spec/ui';

/**
 * Pagination Configuration
 * Canonical definition from @objectstack/spec/ui.
 */
export type { PaginationConfig } from '@objectstack/spec/ui';

// Import spec types for local use in interfaces below
import type {
  ViewData,
  ListColumn,
  SelectionConfig,
  PaginationConfig,
  GroupingConfig,
  RowColorConfig,
  GalleryConfig,
  NavigationConfig,
  ChartAggregate,
  GanttConfig as SpecGanttConfig,
  // objectui#8980 — the protocol's OWN authored type for a list view
  // (`z.input<typeof ListViewSchema>`, published under this name). One member
  // of `NamedListView` indexes it; see that member for why it cannot take its
  // type from this package's mirror like the other sixteen.
  ListView as SpecListView,
  CalendarConfig as SpecCalendarConfig,
  // objectui#11168 slice 3 — the `object-tree` element's `tree` block, so
  // `ObjectTreeSchema.tree` below takes the protocol's own type. Aliased for
  // the reason `SpecGanttConfig` above is.
  TreeConfig as SpecTreeConfig,
  // objectui#9239 — `ComponentPropsMap['object-calendar']`'s author state, so
  // `ObjectCalendarSchema.data` below DERIVES the protocol's `data` row rather
  // than re-spelling it. Aliased because the bare name is the protocol's, and a
  // local symbol under a `@objectstack/spec` export's name reads to the next
  // agent as the spec's own definition (`pnpm check:spec-symbols`).
  ObjectCalendarProps as SpecObjectCalendarProps,
  // objectui#11168 slice 3 — `ComponentPropsMap['object-form']`'s author state,
  // so `ObjectFormSchema.layout` takes the row's own enum by reference.
  ObjectFormProps as SpecObjectFormProps,
  // objectui#6152 round 8 — `ComponentPropsMap['object-grid']`'s author state,
  // so `ObjectGridSchema.operations` and `.filter` take the row's own members
  // by reference. Aliased for the reason `SpecObjectCalendarProps` above is.
  ObjectGridProps as SpecObjectGridProps,
  // objectui#6152 round 10 — `ComponentPropsMap['object-gantt']` /
  // `['object-map']`'s author states, so the flat `ObjectGanttSchema.filter` /
  // `ObjectMapSchema.filter` take their rows' own member by reference. Aliased
  // for the reason `SpecObjectCalendarProps` above is (`ObjectGanttProps` is
  // also `plugin-gantt`'s own component props name).
  ObjectGanttProps as SpecObjectGanttProps,
  ObjectMapProps as SpecObjectMapProps,
  // objectui#11355 — `ComponentPropsMap['object-kanban']`'s author state, so
  // `ObjectKanbanSchema.swimlaneField` takes the row's own type by reference.
  ObjectKanbanProps as SpecObjectKanbanProps,
  // objectui#11227 — the list view's empty-state shape, which the spec's
  // `object-grid` row holds by reference since 17.6.0 (`EmptyStateSchema`):
  // `ObjectGridSchema.emptyState` below takes the protocol's own authored type.
  // Aliased for the reason `SpecObjectCalendarProps` above is.
  EmptyState as SpecEmptyState,
  ChartDrillDown,
  I18nLabel,
  DashboardWidget as SpecDashboardWidget,
  // objectui#10518 — the spec's axis config object: the type of
  // `ObjectChartSchema.xAxis` and the element type of `ObjectChartSchema.yAxis`.
  // Aliased for the reason `SpecGanttConfig` above is.
  ChartAxis as SpecChartAxis,
  // objectui#10770 — the react tier's `<ObjectChart>` author arm: the spec's
  // `{ name }` series entry (the author arm of `ObjectChartSchema.series`) and
  // its chart family (`ObjectChartSchema.specType`). Aliased for the same reason.
  ChartSeries as SpecChartSeries,
  ChartType as SpecChartType,
} from '@objectstack/spec/ui';

/**
 * A list view's `timeline` block, as the list view hands it to `ObjectTimeline`
 * (`@object-ui/plugin-timeline`, the nested `schema.timeline` prop).
 *
 * ONE declaration since objectui#6152 round 12 (seat answer Q2 → B): this is
 * {@link ListViewSchema}'s own `timeline` member, which round 11 made the
 * `@objectstack/spec` list-view slot by reference: strict, `.partial()` (the
 * list-view route can hand over a block without `titleField` or
 * `startDateField`), with the pre-#2231 `dateField` refused by name (write
 * `startDateField`). It was a hand-written intersection of the spec's
 * `TimelineConfig` with `dateField?: string` and a string index signature of
 * `any`, through which nothing read a key.
 *
 * ⛔ `ListViewGalleryConfig`, its sibling, is RETIRED (seat answer Q3 → A): it
 * had no consumer and no element row in the spec. Write the spec's
 * `GalleryConfig`, which this package re-exports.
 */
export type ListViewTimelineConfig = NonNullable<ListViewSchema['timeline']>;

/**
 * Kanban Configuration
 * Canonical definition from @objectstack/spec/ui (KanbanConfigSchema).
 *
 * A RE-EXPORT since objectui#4167, not a copy. The three keys the copy spelled
 * out (`groupByField` / `summarizeField` / `columns`) were the spec's three
 * exactly, and `KanbanConfigSchema` is `$strict`, so there was never a
 * divergence to preserve — only a second declaration under the spec's own name
 * for the next agent to read as canonical (objectstack#4115). The zod side has
 * derived from the spec all along (`zod/objectql.zod.ts`, which since
 * objectui#6152 round 11 takes the list view's own `kanban` slot by reference and
 * refuses the `groupField` / `cardFields` legacy aliases by name); this alias is
 * now bound to the same source.
 */
export type { KanbanConfig } from '@objectstack/spec/ui';

/**
 * Calendar Configuration
 * Canonical definition from @objectstack/spec/ui (CalendarConfigSchema).
 *
 * A RE-EXPORT since objectui#4167, for the same reason as `KanbanConfig` above:
 * the copy's four keys were the spec's four, on a `$strict` schema.
 */
export type { CalendarConfig } from '@objectstack/spec/ui';

/**
 * Gantt Configuration — the spec's `GanttConfigSchema`, plus objectui's one
 * remaining display-only extension.
 *
 * DERIVED since objectui#4167, and the copy it replaces was carrying two false
 * claims of exactly the kind objectstack#4115 was filed about:
 *
 *  - it declared SIX keys and called itself "canonical", while rc.6's
 *    `GanttConfigSchema` declares seventeen. The eleven it never mentioned —
 *    `parentField`, `typeField`, `baselineStartField`, `baselineEndField`,
 *    `groupByField`, `resourceView`, `assigneeField`, `effortField`,
 *    `capacity`, `quickFilters`, `autoZoomToFilter` — are not hypothetical
 *    upstream additions: `plugin-gantt/src/ObjectGantt.tsx` reads every one of
 *    them, through a local `GanttConfigEx` intersection that re-declared them
 *    because this type did not;
 *  - the `tooltipFields` comment said "not part of the upstream
 *    GanttConfigSchema". It is, as of rc.6, so the key now arrives from the
 *    spec and the note is gone with it.
 *
 * ⚠️ THE LOOSENESS THIS PARAGRAPH USED TO REST ON IS GONE. `GanttConfigSchema`
 * was `$loose` upstream, so a key the spec did not declare passed its parse
 * instead of being rejected, and the members intersected below were legal
 * metadata riding that window. objectstack#15469 CLOSED it: the schema is a
 * `strictObject`, an undeclared key is refused by name, and the ten keys objectui
 * read through the window — `timeSegments` among them — are DECLARED upstream
 * with describes. So the members below no longer extend the spec's vocabulary;
 * they restate part of it, and `SpecGanttConfig` already carries every one.
 *
 * ⛔ Do not read this block as an extension point. Writing an undeclared sub-key
 * into `timeSegments` (or any member here) is refused at parse now, where it
 * used to pass — the prose said the opposite until objectui#7845 corrected it.
 */
export type GanttConfig = SpecGanttConfig & {
  /**
   * Shift segmentation (班次/排班分段). ObjectUI display extension — not part of the
   * upstream GanttConfigSchema. When set, the day-mode timeline splits each
   * 排班日 (shift-day starting at `dayStart`, default '00:00') into the configured
   * time bands (白班 | 夜班…): a two-tier header (date over band), per-band tints,
   * and drag/resize snapping to band boundaries. No shift concept is hardcoded —
   * bands are pure config. Off by default. Example:
   * `{ dayStart: '08:00', bands: [
   *     { key: 'day', label: '白班', start: '08:00', end: '20:00' },
   *     { key: 'night', label: '夜班', start: '20:00', end: '08:00' } ] }`.
   */
  timeSegments?: {
    /** Clock time the shift-day begins, 'HH:mm' (24h). Defaults to '00:00'. */
    dayStart?: string;
    /** Ordered bands covering the 24h shift-day, beginning at `dayStart`. */
    bands: Array<{
      /** Stable id (e.g. 'day'/'night'); defaults to `band{index}`. */
      key?: string;
      /** Display label (白班 / 夜班). */
      label: string;
      /** Band start, 'HH:mm'. */
      start: string;
      /** Band end, 'HH:mm'; when `end <= start` the band crosses midnight. */
      end: string;
      /** Optional accent color (any CSS color) for the column tint. */
      color?: string;
    }>;
    /**
     * Draw the dashed calendar-midnight (日历午夜 0:00) cue inside cross-midnight
     * bands. Defaults to `true`; set `false` to hide it.
     */
    showMidnight?: boolean;
  };
  // ── objectui's own extensions, lifted out of `plugin-gantt` (objectui#6051) ──
  //
  // The nine members below were declared ONLY in `plugin-gantt`'s package-private
  // `GanttConfigEx` intersection — the type `getGanttConfig` casts the `gantt`
  // block to. `ObjectGantt` honours every one of them on BOTH authoring faces
  // (the `gantt: { … }` block AND the flattened top-level spelling declared on
  // `ObjectGanttSchema`), and a type that lives inside the plugin can be
  // referenced by neither declaration — so the vocabulary is lifted here rather
  // than restated, and the two faces derive from ONE source that cannot fork.
  //
  // Like `timeSegments` above, each of the nine is now DECLARED by the spec —
  // objectstack#15469 closed `GanttConfigSchema` and modelled them, so they are
  // no longer objectui-only metadata riding a `$loose` parse. They stay written
  // out here for their prose; the vocabulary itself is the spec's.
  /**
   * Record field marking a node as view-only (truthy → locked). A locked
   * row's bar can't be dragged/resized, its progress can't be dragged, no
   * dependency can be drawn from it, and its inline-edit / context-menu
   * edit+delete are hidden — but clicking it (open drawer / jump) still works.
   * Independent of the global `readOnly`; use to freeze individual levels (e.g.
   * work orders) while siblings stay editable. Maps to `GanttTask.locked`.
   */
  lockField?: string;
  /**
   * Record field carrying the row's OBJECT API NAME. Mixed-object
   * trees (one source serving parent-object rows beside child-object rows)
   * need the detail drawer and its full-page link to follow each row's REAL
   * object — otherwise a child row's `→` link builds a URL under the view's bound
   * object and 404s. Empty/missing value → falls back to the bound object.
   */
  objectField?: string;
  /**
   * How a summary bar's span is computed. `'children'` (default)
   * rolls the bar up from its children — min start / max end / duration-weighted
   * progress — and IGNORES the record's own dates. `'self'` renders the bar from
   * the record's OWN start/end/progress, falling back to rollup
   * only for records without dates (e.g. pure grouping levels). Use `'self'`
   * when the parent's schedule is authoritative — e.g. a shift plan whose
   * work-order children are locked history: under rollup, dragging the plan
   * persists its own dates but the bar snaps back to the children's extent on
   * refetch.
   */
  summaryExtent?: 'children' | 'self';
  /**
   * Auto-collapse tree nodes at/below this 0-indexed depth on first render.
   * Roots are depth 0. Every node at depth `>= defaultCollapsedDepth`
   * with children starts folded; the user can still expand them. Example: a
   * project→product→production-plan→work-order tree uses
   * `defaultCollapsedDepth: 2` so every production plan (and its work orders)
   * starts collapsed. Forwarded to `GanttView`.
   */
  defaultCollapsedDepth?: number;
  /**
   * Record field carrying a per-task alert stroke color: any CSS color or
   * semantic palette name (red/orange/…). When present the bar keeps its fill
   * but gets an outline + halo in that color — e.g. red for overdue, orange for
   * due-soon — typically a server-computed alert field. Empty/null → no stroke.
   * Maps to `GanttTask.borderColor`.
   */
  borderColorField?: string;
  /**
   * Whether the backing store persists dependency link TYPES (fs/ss/ff/sf).
   * Default true. Set false when dependencies are bare predecessor ids
   * (predecessor ids only) — the link menu hides the type switcher (a switch would be
   * silently reverted on refetch) and drag-created links are always FS.
   * Forwarded to `GanttView`.
   */
  dependencyTypes?: boolean;
  /**
   * Business time zone, IANA name like 'Asia/Shanghai'. Renders the
   * chart's calendar — shift bands, day columns, snapping, today line, date
   * labels — in this zone's wall time for every viewer, instead of the
   * browser's zone (which misplaces shift bands for viewers elsewhere). A
   * `datetime` value stays a real instant: a drag writes it back as one. A
   * `date` value is a calendar day, not an instant: the chart draws it from
   * that day's midnight in this zone's calendar, and a drag writes back the day
   * it was dropped on there, `YYYY-MM-DD` (objectui#10866), on a DST change of
   * this zone or the viewer's too. Where no instant is drawn at that midnight
   * (for example, this zone's clocks change at 00:00 that day), the day is
   * drawn from the first instant after it, still on that day.
   * Forwarded to `GanttView`.
   */
  timeZone?: string;
  /**
   * Base name for exported PNG/PDF files, e.g. the view's display
   * label — the host's view schema often reaches this component stripped of
   * `label`, so views declare it here. Falls back to the object schema label,
   * then the object API name. A timestamp suffix is always appended.
   */
  exportFileName?: string;
  /**
   * Per-interaction switches: `move` / `resize` / `progress` / `link`,
   * each defaulting to true. Metadata-drivable so a view can e.g. allow bar
   * moves but pin durations (`{ resize: false }`) or keep the dependency UI
   * read-only (`{ link: false }`). They only narrow what `readOnly` / row locks
   * already allow. Forwarded to `GanttView`.
   */
  interactions?: {
    /** Bar / subtree dragging (move along the timeline). */
    move?: boolean;
    /** Edge resize grips (change duration). */
    resize?: boolean;
    /** The progress drag handle. */
    progress?: boolean;
    /** Dependency UI: drag-to-link dots AND the create/delete menu entries. */
    link?: boolean;
  };
};

/**
 * Sort Configuration
 */
export interface SortConfig {
  /** Field to sort by */
  field: string;
  /** Sort order */
  order: 'asc' | 'desc';
}

// ============================================================================
// QuickFilter Types — Dual-format support
// ============================================================================


// ============================================================================
// ConditionalFormatting Types — ONE dialect, the spec list view's { condition, style }
// ============================================================================

/**
 * One entry of a named view's `conditionalFormatting`, as the protocol declares
 * it: `@objectstack/spec/ui`'s `ObjectListViewSchema`, read on its authoring
 * (`z.input`) face BY REFERENCE, the same way `ObjectViewSchema.listViews`
 * reads the whole named view (objectui#7928). Module-private: it exists so
 * {@link SpecConditionalFormattingRule} can index the protocol's own slot type
 * rather than restate it (objectui#10946).
 */
type SpecNamedViewConditionalFormattingRule = NonNullable<
  z.input<typeof SpecObjectListViewSchema>['conditionalFormatting']
>[number];

/**
 * Spec-format ConditionalFormatting rule (from @objectstack/spec).
 * Uses a predicate with a style map.
 * Evaluated at runtime by `@object-ui/core`'s `resolveConditionalFormatting`.
 */
export interface SpecConditionalFormattingRule {
  /**
   * The predicate that gates the rule: a bare string (e.g. `"record.status == 'overdue'"`,
   * or a template such as `"${data.amount > 1000}"`), or the expression envelope the
   * protocol declares for this slot, `{ dialect, source }` (the form `objectstack build`
   * emits for every authored predicate).
   *
   * objectui#10946: the member is the protocol's own slot type, indexed BY REFERENCE from
   * {@link SpecNamedViewConditionalFormattingRule}, so it admits whatever the INSTALLED
   * spec's `conditionalFormatting[].condition` admits and moves with it on a spec bump.
   * Before this it was `string` alone, narrower than both the protocol and the evaluator
   * (`resolveConditionalFormatting` hands the condition to `evalRowPredicate`, which reads
   * the envelope), so every relay of a named view's rules into a grid needed an assertion.
   * The explicit `string` arm is the pre-existing declaration, kept first so a string
   * condition stays legal whatever a future spec does to its slot.
   *
   * ⚠️ The two spec lines differ on the envelope, and this member follows the installed one.
   * The published `ExpressionInputSchema` slot makes `source` optional (the persistence
   * contract: `source` OR `ast`); spec `main` narrows the slot to
   * `EvaluatedExpressionInputSchema`, which requires a non-blank `source`. No engine evaluates
   * `ast` today, so an `ast`-only envelope is answered as an evaluation fault: the rule does
   * not match, and the fault is warned once. The zod twin is `SpecRuleConditionSchema` in
   * `./zod/objectql.zod.ts`.
   */
  condition: string | SpecNamedViewConditionalFormattingRule['condition'];
  /** Style map to apply when condition matches (e.g., { backgroundColor: '#fee2e2', color: '#991b1b' }) */
  style: Record<string, string>;
}

/**
 * One `conditionalFormatting` rule on `object-grid` ({@link ObjectGridSchema}) and
 * `list-view` — ONE dialect, the spec list view's `{ condition, style }`: a CEL
 * `condition` over the row's `record.*` and a CSS `style` map, first matching rule
 * wins (objectui#11533).
 *
 * It IS {@link SpecConditionalFormattingRule}, the protocol's rule by reference (its
 * `condition` indexes `ObjectListViewSchema`'s own slot, objectui#10946), plus the
 * retired keys declared `?: never`, so each is refused BY NAME:
 *
 *   - the native comparison `{ field, operator, value }` and its template predicate
 *     `expression` (the `ObjectUIConditionalFormattingRule` interface that declared
 *     them is gone), and
 *   - a colour written at the TOP LEVEL of a rule — `backgroundColor`, `borderColor`,
 *     `textColor`. A colour belongs inside `style` (`textColor` is `style.color`).
 *
 * Retired, not widened, with no alias window (triage ruling 5965301211 on
 * objectui#11533, as objectui#11522 ruled for {@link KanbanConditionalFormattingRule}).
 * `@objectstack/spec` declares the list view's member as this rule and types the
 * `object-grid` row's member by reference to it.
 *
 * Respelling: `{ field: 'priority', operator: 'equals', value: 'high',
 * backgroundColor: '#fee2e2' }` is `{ condition: "record.priority == 'high'",
 * style: { backgroundColor: '#fee2e2' } }`.
 *
 * ⚠️ What did NOT narrow: the shared evaluator. `@object-ui/core`'s
 * `resolveConditionalFormatting` types its own input (`ConditionalFormattingRuleLike`)
 * and still reads every arm, as a compatibility read for rules already STORED in the
 * native dialect; nothing on the render path parses a stored view against this type's
 * zod twin, so such a view still paints. A `{ condition, style }` rule paints exactly
 * as it did before.
 *
 * The zod twin is the module-private `ConditionalFormattingRuleSchema` in
 * `./zod/objectql.zod.ts`, each retired key a `retirementTombstone()` there.
 */
export interface ConditionalFormattingRule extends SpecConditionalFormattingRule {
  /** @deprecated RETIRED (objectui#11533) — the native rule dialect. Write `condition` as CEL over `record.*`. */
  field?: never;
  /** @deprecated RETIRED (objectui#11533) — the native rule dialect. Write `condition` as CEL over `record.*`. */
  operator?: never;
  /** @deprecated RETIRED (objectui#11533) — the native rule dialect. Write `condition` as CEL over `record.*`. */
  value?: never;
  /** @deprecated RETIRED (objectui#11533) — the native template predicate. Write it as `condition`, CEL over `record.*`. */
  expression?: never;
  /** @deprecated RETIRED (objectui#11533) — a top-level colour. Write `style: { backgroundColor }`. */
  backgroundColor?: never;
  /** @deprecated RETIRED (objectui#11533) — a top-level colour. Write `style: { borderColor }`. */
  borderColor?: never;
  /** @deprecated RETIRED (objectui#11533) — a top-level colour. Write `style: { color }`. */
  textColor?: never;
}

/**
 * Parameter declaration for a bulk action. Rendered as a single field in the
 * BulkActionDialog params step. Mirrors a minimal FormField shape so existing
 * field widgets (text/number/select/lookup/boolean/date) can render it.
 */
export interface BulkActionParam {
  /** Parameter name — passed to the runtime handler as params[name]. */
  name: string;
  /** Human-readable label (i18n-resolved upstream). */
  label?: string;
  /** Optional help text shown beneath the field. */
  help?: string;
  /**
   * Field widget type — one of the standard FieldWidget names.
   * Common values: 'text' | 'number' | 'select' | 'lookup' | 'boolean' | 'date' | 'datetime' | 'textarea'.
   */
  type: string;
  /** Whether the param is required to enable the Confirm button. */
  required?: boolean;
  /** Default value applied when the dialog opens. */
  default?: unknown;
  /**
   * Static options for select-style fields.
   *
   * The ENTRY is open for the same reason this interface is (see the catch-all
   * at the bottom): `bulkParamToField` spreads each entry into the field
   * metadata it hands the widget (`{ ...o, value: String(o.value) }`), so every
   * extra key survives, and the option widgets read `color` / `icon` /
   * `disabled` / `visibleWhen` beyond the declared pair (`SelectOptionMetadata`
   * in `./field-types` declares them; `@object-ui/fields` reads them). While
   * this entry was closed, the type was the ONLY layer rejecting a configuration
   * the renderer honours — `@objectstack/spec`'s `BulkActionParamSchema` makes
   * the same entry `.passthrough()` (objectstack#4001) — and an author (an AI
   * author especially) trusts the type absolutely (objectui#3309).
   *
   * Structurally identical to `@object-ui/core`'s `ActionParamOption`
   * (`fbc23e094`), deliberately restated inline rather than imported: this
   * package is the protocol layer and takes no workspace dependency.
   *
   * Naming the two keys this layer itself uses and passing the rest through is
   * NOT an invitation to author new option keys — the authoring gate is the
   * spec's `SelectOptionSchema`, and it is strict.
   */
  options?: Array<{
    label: string;
    value: string | number | boolean;
    /** Extra option config forwarded to the field widget as-is (see above). */
    [key: string]: unknown;
  }>;
  /** For lookup widgets — the related object name (e.g. 'user'). */
  object?: string;
  /**
   * For `select` / `lookup` widgets — allow picking multiple values. The param
   * value becomes a string array and is written to the patch as-is (matching a
   * multi-value backend field, e.g. a multi-user `executors`). Defaults to
   * single-select.
   */
  multiple?: boolean;
  /**
   * For `lookup` widgets — the related-object field used as the option label
   * (defaults to name/full_name/email/id in that order).
   */
  labelField?: string;
  /** Placeholder text. */
  placeholder?: string;
  /**
   * Catch-all for extra widget-specific configuration (min/max/step/format/...).
   * Forwarded to the underlying field renderer as-is.
   */
  [key: string]: unknown;
}

/**
 * Bulk action operation kind. Determines which `dataSource` method the executor
 * calls per batch. `custom` defers entirely to `onComplete` event handlers and
 * is intended for callouts (notify/export/...) that don't mutate records —
 * UNLESS the def carries {@link BulkActionDef.actionDef}, in which case the
 * executor dispatches that action through the action runner: once per record by
 * default, or once for the whole selection when the def opts into
 * {@link BulkActionDef.execution} `'aggregate'` (objectui#3139).
 *
 * Spec-owned since 17.0.0-rc.2 (`@objectstack/spec/ui` exports the identical
 * `'update' | 'delete' | 'custom'` union); re-exported so consumers keep this
 * import path. (Imported at the top of this module — BulkActionDef below
 * references it.)
 */
export type { BulkActionOperation };

/**
 * One entry of a named view's `bulkActionDefs`, as the protocol declares it:
 * `@objectstack/spec/ui`'s `ObjectListViewSchema`, read on its authoring
 * (`z.input`) face BY REFERENCE, like
 * {@link SpecNamedViewConditionalFormattingRule}. Module-private: it exists so
 * {@link BulkActionDef.visible} can index the protocol's own slot type rather
 * than restate it (objectui#10946).
 */
type SpecNamedViewBulkActionDef = NonNullable<
  z.input<typeof SpecObjectListViewSchema>['bulkActionDefs']
>[number];

/**
 * Rich, schema-driven definition of a bulk action.
 *
 * The grid renders one button per def in the BulkActionBar. Clicking it opens
 * the BulkActionDialog: params form → confirm → progress → result. The executor
 * batches selected records via `dataSource.bulk(resource, op, items)` — or, for
 * a def derived from an object action ({@link BulkActionDef.actionDef}),
 * dispatches that action once per record through the action runner.
 *
 * Two sources feed the bar (folded by `resolveBulkActions` in plugin-grid):
 * defs authored inline in the view JSON, and the view's `bulkActions: string[]`
 * names — each resolved against `objectDef.actions` and promoted to that def
 * when it matches one. Naming the action in the view is the only way to declare
 * a bulk action: spec 17 retired `action.bulkEnabled` as a tombstone and
 * prescribes exactly this. Names that match nothing still render as by-name
 * buttons, since a consumer may have registered a runner handler under one.
 */
export interface BulkActionDef {
  /** Stable identifier — also used as the action key in audit logs. */
  name: string;
  /** Human-readable label shown on the button + dialog header. */
  label?: string;
  /** Lucide icon name (e.g. 'user-check', 'trash'); falls back to a generic icon. */
  icon?: string;
  /** Visual treatment of the action button. */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  /** Operation kind — drives how the executor mutates records. */
  operation: BulkActionOperation;
  /**
   * For `operation: 'update'`, a static patch applied to every selected record
   * (merged AFTER user-supplied params). Allows declaring fixed-value mass
   * updates without exposing them in the params form.
   */
  patch?: Record<string, unknown>;
  /**
   * Parameters collected from the user before execution. Empty/undefined →
   * dialog skips the params step and jumps straight to confirm.
   */
  params?: BulkActionParam[];
  /**
   * Confirmation text shown above the affected-record summary.
   *
   * Two arms, because the protocol is moving this slot to ADR-0032's
   * `template` dialect (objectstack#24798, landed by objectstack#24947): there
   * a bare string is shorthand for `{ dialect: 'template', source }`, and a
   * parsed definition (what `os compile` serializes) carries the envelope. The
   * installed spec still types the slot as a plain string, so both arms reach
   * the renderer during the move. Read it through plugin-grid's
   * `bulkConfirmTextSource`, never as a React child: the envelope arm is an
   * object.
   *
   * The envelope's `source` is optional, as on the protocol's `Expression`:
   * a parsed slot may carry its `ast` instead, and the reader then falls back
   * to the default sentence. Typed `source: string`, the slot refused the
   * spec's own envelope type wherever a named view's `bulkActionDefs` reach
   * `ObjectGridSchema` (objectstack#25438).
   */
  confirmText?: string | { dialect?: 'template'; source?: string };
  /** Custom Confirm button label (default: "Run"). */
  confirmLabel?: string;
  /**
   * Permission / feature gate predicate — hides the button when it evaluates
   * falsy. Accepts a bare CEL string or the `{ dialect, source }` envelope
   * `objectstack build` emits, so a def derived from an object action can
   * forward `action.visible` untouched.
   *
   * Two arms, both read by reference rather than restated (objectui#10946):
   * {@link ExpressionWire}, objectui's one spelling of the predicate wire (what
   * this member declared before, then as an inline union), and the protocol's
   * own `bulkActionDefs[].visible` slot type from
   * {@link SpecNamedViewBulkActionDef}. The second arm is what the member
   * lacked: on the installed spec that slot's envelope makes `source` optional
   * and may carry `ast` and `meta`, so a named view's defs could not be relayed
   * into a grid without an assertion. Spec `main` narrows the slot to require a
   * non-blank `source`, and this arm follows the installed line. An `ast`-only
   * envelope carries no `source` to evaluate, so it is not a declared gate: the
   * selection bar asks the action family's one "declared?" definition, as the
   * row menu and the toolbars do, and every selected record qualifies. A blank
   * `source` or a whitespace-only string is no gate either, reported once
   * (objectui#11322).
   */
  visible?: ExpressionWire | SpecNamedViewBulkActionDef['visible'];
  /**
   * Capability gate — the UI half of ADR-0066 D4's `requiredPermissions`
   * contract, carried here so the selection bar reaches the SAME verdict as the
   * other three action surfaces (list toolbar / record header / row kebab).
   *
   * Semantics are `ActionSchema.requiredPermissions` verbatim: an empty or
   * absent declaration always passes, several entries are AND-ed, and a host
   * that never published the caller's capabilities fails OPEN (the server is
   * the authority). Populated by `resolveBulkActions` when a def is promoted
   * from an object action, and honoured by `BulkActionBar` via
   * `useCapabilityGate` — without it, an action hidden in the row kebab
   * reappeared in the bulk bar the moment a row was selected (objectui#3492).
   */
  requiredPermissions?: string[];
  /** Max records the action will operate on; selection above this is blocked. */
  maxRecords?: number;
  /** Batch size for the executor loop (default: 200). */
  batchSize?: number;
  /**
   * How a `custom` def with {@link BulkActionDef.actionDef} dispatches over the
   * selection (objectui#3139).
   *
   * - `'perRecord'` (default, and the only pre-17.1 semantics): one runner
   *   dispatch per selected record, with the row attached as `_rowRecord`.
   * - `'aggregate'`: ONE dispatch for the entire selection. The executor
   *   injects `params._selectedIds: string[]` (every selected record id) and
   *   publishes the full records as `context.selectedRecords`, so the server
   *   can produce a single aggregate artifact (zip of QR codes, merged PDF,
   *   batch print job…). Result semantics are all-or-nothing: the one call
   *   covers the whole selection, so per-row retry is unavailable — a total
   *   failure keeps the selection for a whole-run re-run.
   *
   * Ignored for `operation: 'update' | 'delete'` (their bulk fast-path already
   * aggregates per batch) and for a `custom` def without `actionDef` (nothing
   * to dispatch). In aggregate mode `batchSize` does not apply — the whole
   * selection is one call; `maxRecords` still gates it.
   */
  execution?: 'perRecord' | 'aggregate';
  /**
   * Source object `ActionDef` when this entry was PROMOTED from a
   * `bulkActions: ['<name>']` entry resolved against `objectDef.actions`
   * (objectui#3002) — or attached by `resolveBulkActions` when an authored def
   * with `execution: 'aggregate'` names a declared object action (#3139).
   *
   * Presence of this key changes what `operation: 'custom'` means: instead of
   * a per-row no-op, the executor dispatches THIS action through the action
   * runner once per selected record, with the row attached as `_rowRecord` so
   * `recordIdParam` injection works exactly as it does for a `list_item` row
   * action — or once for the whole selection under `execution: 'aggregate'`.
   * Params and confirmation are collected once by the BulkActionDialog
   * and handed to the runner as values, so it never re-prompts per record.
   */
  actionDef?: Record<string, unknown>;
}

/**
 * Export formats a list view may offer (objectui#4535).
 *
 * `'pdf'` is NOT here: the value left the spec's format enum in
 * `@objectstack/spec` 17.0.0 (objectstack#8010), where declaring it is now a
 * parse-time refusal carrying a migration prescription. It was never
 * renderable on this side either — no ObjectUI export path has ever produced a
 * PDF, so a declared `'pdf'` only ever reached the user as a console line. A
 * list export does not produce documents: to let users print a list as shown,
 * set the view's `allowPrinting`; a printable document (an invoice, a delivery
 * order, a letter) is a page that declares `print` — its paper, margins and
 * running header and footer — with its blocks in `regions` (objectstack#8346,
 * ruling B′).
 * `'xlsx'` is delivered by the server stream alone; the client fallback path
 * produces `'csv'` and `'json'`.
 */
export type ListViewExportFormat = 'csv' | 'xlsx' | 'json';

/**
 * Export options for a list view — the object form of `exportOptions`.
 *
 * **This key set is the spec's, and it is exactly what `ObjectGrid` reads.**
 * It mirrors `ListViewExportOptionsSchema` in `@objectstack/spec` 17.0.0
 * (`packages/spec/src/ui/view.zod.ts`, added by objectstack#8010 /
 * objectstack#8324): `formats`, `maxRecords`, `includeHeaders`,
 * `fileNamePrefix`, `streaming`. Upstream derived those five keys FROM this
 * renderer's reads, so the two are one contract read from either end:
 *
 * - a sixth key declared here is capability surface with no reader — the
 *   compile-time key-set assertion in `objectql.exportOptions.test.ts` reds;
 * - a sixth key READ by `ObjectGrid` without being declared here recreates the
 *   undeclared-but-read defect objectstack#8010 closed — the source scan in
 *   `plugin-grid`'s `ObjectGrid.exportOptionsKeys.test.ts` reds.
 *
 * NOTE (objectui#4535): this restates the five keys rather than deriving them
 * from the spec symbol, and the reason is no longer the pin. objectui now
 * installs `@objectstack/spec@17.2.0`, which DOES carry the object form — the
 * bare format array lifts to `{ formats: [...] }` at parse and `'pdf'` is gone
 * from the enum. What is missing is the SYMBOL: `ListViewExportOptionsSchema`
 * is internal to the spec bundle and not among the package's public exports, so
 * there is nothing to import. Only the enclosing `ListViewSchema` is exported,
 * and its `exportOptions` is the two-branch union (legacy-array lift ∪ object),
 * whose `z.infer` is a union — not this interface.
 *
 * So the mirror is restated but not unchecked: `export-options-spec-parity.test.ts`
 * reads the object branch out of the INSTALLED spec at test time and asserts
 * this key set, the format enum and the strictness against it. Prose claiming
 * alignment is what went false last time; that test is what makes the claim
 * falsifiable. When upstream exports the symbol, derive from it and delete the
 * restatement — the shape below is already the spec's, so nothing else moves.
 */
export interface ListViewExportOptions {
  /**
   * Formats offered in the export menu (default: `['csv', 'json']`).
   * XLSX is delivered by the server stream only.
   */
  formats?: ListViewExportFormat[];
  /** Maximum number of records to export; 0 or absent = unlimited. */
  maxRecords?: number;
  /** Include column headers in the exported file (default true). */
  includeHeaders?: boolean;
  /**
   * Download file name prefix — replaces the object label and suppresses the
   * view label in the generated file name.
   */
  fileNamePrefix?: string;
  /**
   * Set false to force the client-side export path (csv/json only) instead of
   * the server stream.
   */
  streaming?: boolean;
}

/**
 * ObjectGrid Schema
 * A specialized grid component that automatically fetches and displays data from ObjectQL objects.
 * Implements the grid view type from @objectstack/spec view.zod ListView schema.
 * 
 * Features:
 * - Traditional table/grid with CRUD operations
 * - Search, filters, pagination
 * - Column resizing, sorting
 * - Row selection
 * - Inline editing support
 *
 * ## What this type describes (objectui#11276)
 *
 * The `object-grid` node as `ObjectGrid` READS it: after `SchemaRenderer` has
 * hoisted the node's `properties` bag onto it, or as code composes it —
 * `ObjectView` and `ListView` building a grid view, the designers' previews, a
 * host mounting `<ObjectGrid schema={…}>`. That is why `objectName` is
 * required here and why its members sit flat on the node. The `object-view`
 * `table` slot (`ObjectGridSlotKey`) is built from it too.
 *
 * It is NOT the shape of an AUTHORED `object-grid` document. An authored node
 * takes its props in the spec's `properties` bag, whose members are
 * `@objectstack/spec`'s `ComponentPropsMap['object-grid']` row
 * (`ObjectGridProps`): `{ type: 'object-grid', properties: { objectName,
 * columns, … } }`, because the spec's page component refuses a prop written on
 * the node itself (ADR-0089 D3a). `ObjectGridBlockSchema`
 * (`./zod/objectql.zod.ts`) judges it, and refuses a prop written flat on the
 * node by name. `SchemaRenderer` reads both spellings, so a node built in code
 * keeps its flat keys.
 */
export interface ObjectGridSchema extends BaseSchema {
  type: 'object-grid';

  /**
   * Per-breakpoint scoped style maps (ADR-0065): `@objectstack/spec`'s
   * `ResponsiveStyles`, the type `PageComponentSchema.responsiveStyles`
   * declares, by reference (objectui#10872 batch 9). `SchemaRenderer` compiles
   * it to CSS scoped to this node and adds the scope class to the node's
   * `className`, which `ObjectGrid` forwards. A producer writes it on
   * `object-grid` nodes (the objectstack showcase; the reading is recorded on
   * objectui#10872). Same declaration on {@link ObjectChartSchema}; the zod
   * mirror spreads the public blocks' fragment (`NODE_ENVELOPE`).
   */
  responsiveStyles?: SpecResponsiveStyles;

  /**
   * Per-element data binding — `@objectstack/spec`'s `ElementDataSource`
   * (`PageComponentSchema.dataSource`), by reference: `{ object, view?,
   * filter?, sort?, limit? }` describing WHAT this block queries
   * (objectui#11070).
   *
   * ⚠️ Metadata, ⛔ NOT the data-source ADAPTER. The two share a name and are
   * different things: the adapter is injected by the host
   * (`SchemaRendererProvider`) and reaches the component as a React prop,
   * while this is authored JSON. `SchemaRenderer` strips `dataSource` from the
   * props it spreads (objectstack#5576) so the binding can never shadow the
   * adapter, and the registered renderer reads it off the NODE through
   * `ElementDataSourceGate` (`@object-ui/react`), which lands `object` on
   * `objectName` and composes a named saved `view` with the binding's own
   * keys. Every gate-wrapped registration already PUBLISHES this key as an
   * authored input (objectui#6678, `ELEMENT_DATA_SOURCE_INPUT` in
   * `@object-ui/core`); this member is that declaration on the schema faces,
   * which the strict authoring face refused until it was written. Same
   * declaration on {@link ObjectFormSchema}, {@link ObjectKanbanSchema},
   * {@link ObjectGanttSchema}, {@link ObjectMapSchema},
   * {@link ObjectCalendarSchema}, {@link ObjectChartSchema} and
   * `ListViewSchema` (derived from its zod mirror; its absence from
   * `@object-ui/app-shell`'s relay census is declared there, objectui#7559).
   */
  dataSource?: ElementDataSource;

  /**
   * RETIRED on this node (objectui#11068, ADR-0049) — a grid has no `name`.
   *
   * `BaseSchema.name` is a form-field name; a grid is not a form field, and
   * `ObjectGrid` never read the key, so an authored value drew nothing. The two
   * things an author reaching for it can mean each have their own member:
   * the node's identity is `id` (it also scopes the saved column layout), and
   * the words shown for the grid are `label`.
   *
   * `?: never`, not a deletion — the same convention as `children` below:
   * {@link BaseSchema} declares the key for every node, so deleting the
   * restatement would hand the key back to the base member and it would
   * type-check again. Lockstep with the Zod twin (`zod/objectql.zod.ts`,
   * `retirementTombstone()`).
   *
   * @deprecated RETIRED (objectui#11068) — write `id` for identity, `label`
   * for the grid's caption.
   */
  name?: never;

  /**
   * RETIRED on this node (objectui#11068, ADR-0049) — a grid is not an input.
   *
   * `BaseSchema.placeholder` is the hint text of an input control. `ObjectGrid`
   * never read the key, so an authored value drew nothing. The text a grid
   * shows when it has no rows is {@link ObjectGridSchema.emptyState}.
   *
   * @deprecated RETIRED (objectui#11068) — write `emptyState: { message }` for
   * the text shown when the grid has no rows.
   */
  placeholder?: never;

  /**
   * Display label override.
   *
   * `string | I18nLabel` — the spec's INLINE locale map, resolved against a
   * BCP-47 display locale by `resolveI18nLabel(label, locale)`. Plain `string`
   * until objectui#9092: a NARROWING override of `BaseSchema.label`, which
   * objectui#4580's revised Q1 ruling (option A) widened. The mirror
   * (`zod/objectql.zod.ts`'s `ObjectGridSchema`) never restates the key, so it
   * inherits the zod `BaseSchema`'s `I18nLabelSchema` and accepted the map all
   * along while `tsc` refused it.
   *
   * ⚠️ NOT the KEYED `{ key, defaultValue?, params? }` vocabulary that
   * {@link BaseSchema.ariaLabel} carries; the two are structurally confusable
   * and neither resolver accepts the other's shape.
   */
  label?: string | I18nLabel;
  
  /**
   * ObjectQL object name (e.g., 'users', 'accounts', 'contacts')
   * Used when data provider is 'object' or not specified
   *
   * ⚠️ REQUIRED on this face, OPTIONAL on the zod mirror (objectui#11117). The
   * registration is gate-wrapped, so `ElementDataSourceGate` lands a binding's
   * `object` here before `ObjectGrid` reads the node, and the mirror accepts
   * `{ type: 'object-grid', dataSource: { object: 'product' } }` — the binding
   * the docs teach and the spec accepts — refusing only a node with neither
   * (`requireRecordSource`, keyed `RECORD_SOURCE_REQUIRED`). This member stays
   * `string` because `ObjectGrid` reads it as one after the gate has run
   * (`translateOptions(schema.objectName, …)` in `@object-ui/plugin-grid`),
   * so making it optional is a renderer-typing change outside that card. The
   * difference is recorded in `zod-mirror-parity.test.ts`'s
   * `WiderThanDeclared` ledger, which reddens when the two faces agree again.
   */
  objectName: string;

  /**
   * Data Source Configuration
   * Aligned with @objectstack/spec ViewDataSchema
   * If not provided, defaults to { provider: 'object', object: objectName }
   */
  data?: ViewData;
  
  /**
   * Columns Configuration
   * Can be either:
   * - Array of field names (simple): ['name', 'email', 'status']
   * - Array of ListColumn objects (enhanced): [{ field: 'name', label: 'Full Name', width: 200 }]
   */
  columns?: string[] | ListColumn[];

  /**
   * Base query filter — the protocol's `ViewFilterRule` array,
   * `[{ field, operator, value }, ...]`, taken BY REFERENCE from the
   * `object-grid` row (`ComponentPropsMap['object-grid'].filter`), which
   * refuses the MongoDB-style record and the AST tuple array by name.
   * `ObjectGrid` lowers it through `@object-ui/core`'s `toFilterNode` onto
   * `$filter`.
   *
   * objectui#6152 round 8: this was `any[]`, so a tuple array such as
   * `[['status', '=', 'open']]` type-checked here while the protocol refused
   * it. ⚠️ What did NOT narrow is the read: `toFilterNode` still lowers an AST
   * array, because hosts compose one onto the node at runtime (a grouped
   * `ListView` grid, `ElementDataSourceGate`'s merged binding) through their
   * own untyped copies. That value is not a shape an author writes, so this
   * face does not publish it (the objectui#10199 split, as
   * `RecordRelatedListComponentProps.filter` makes it).
   */
  filter?: SpecObjectGridProps['filter'];

  /**
   * Sort Configuration
   *
   * `[{ field: 'name', order: 'desc' }]` — BOTH keys are required, here and on
   * the zod mirror, and `@objectstack/spec`'s `SortItemSchema` refuses an entry
   * that omits `order` (`invalid_value` at `0.order`, measured on
   * `@objectstack/spec@17.4.0`). ⚠️ This sentence used to read "`order` is
   * optional and means `'asc'`", two lines above a declaration that requires it
   * — an author who followed it wrote metadata the spec rejects (objectui#8973).
   * What IS true of a missing `order` is a RUNTIME tolerance, not a
   * declaration: `normalizeSortEntries` defaults it to `'asc'` rather than
   * dropping the key, because types are erased and the entry still has to mean
   * something when it arrives. The legacy string clause (`"name desc"`) is RETIRED
   * (objectui#8221, decision batch #77): the array is the only spelling this
   * key's declared input publishes (`type: 'array'`) and the only one
   * `convertSortToQueryParams` lowers.
   */
  sort?: SortConfig[];
  
  /**
   * Fields enabled for search
   * Defines which fields are searchable when using the search box
   */
  searchableFields?: string[];
  
  /**
   * Enable column resizing
   * Allows users to drag column borders to resize
   */
  resizable?: boolean;

  /**
   * Enable column reordering
   * Allows users to drag columns to reorder
   */
  reorderableColumns?: boolean;

  /**
   * Show column type icons (T / Tag / Calendar / Hash) in column headers.
   * Off by default — type is usually obvious from cell content; the icons
   * add visual noise that competes with column labels.
   * @default false
   */
  showColumnTypeIcons?: boolean;
  
  /**
   * Row Selection Configuration
   * Aligned with @objectstack/spec SelectionConfigSchema
   */
  selection?: SelectionConfig;
  
  /**
   * Pagination Configuration
   * Aligned with @objectstack/spec PaginationConfigSchema
   */
  pagination?: PaginationConfig;
  
  /**
   * Custom CSS class
   */
  className?: string;
  
  // ===== LEGACY FIELDS (for backward compatibility) =====
  // These fields are deprecated but maintained for backward compatibility
  // They will be mapped to the new structure internally
  
  /**
   * @deprecated Use columns instead
   * Legacy field names to display
   */
  fields?: string[];
  
  /**
   * @deprecated Use data with provider: 'value' instead
   * Legacy inline data support
   */
  staticData?: any[];
  
  /**
   * @deprecated Use selection.type instead
   * Legacy selection mode
   */
  selectable?: boolean | 'single' | 'multiple';
  
  /**
   * @deprecated Use pagination.pageSize instead
   * Legacy page size
   */
  pageSize?: number;
  
  /**
   * @deprecated Use searchableFields instead
   * Legacy search toggle
   */
  showSearch?: boolean;
  
  /**
   * RETIRED on this node (objectui#11068, ADR-0049) — the grid has no filter UI.
   *
   * `ObjectGrid` never read the key, so an authored value drew nothing. The one
   * filter surface objectui draws is the `list-view` toolbar's filter builder,
   * switched by the list view's `userActions.filter`; honouring the key
   * here would have built a second one, and the upstream protocol's
   * `object-grid` row does not declare it. The rows this grid fetches are
   * narrowed by {@link ObjectGridSchema.filter}.
   *
   * `?: never`, not a deletion — the convention of `rowSpecActions` below:
   * without a member, the key would fall to {@link BaseSchema}'s index
   * signature and type-check again. Lockstep with the Zod twin
   * (`zod/objectql.zod.ts`, `retirementTombstone()`). An `object-view`'s own
   * {@link ObjectViewSchema.showFilters} is a different member, read by
   * `ObjectView`, and is unaffected.
   *
   * @deprecated RETIRED (objectui#11068) — author a `list-view` and switch its
   * filter builder with `userActions.filter`; write `filter` to narrow this
   * grid's rows.
   */
  showFilters?: never;

  /**
   * @deprecated Use pagination config instead
   * Legacy pagination toggle
   */
  showPagination?: boolean;
  
  /**
   * RETIRED (objectui#5861, ADR-0049) — the legacy single-entry spelling of
   * {@link ObjectGridSchema.sort}. `@objectstack/spec` 17.3.0 converted
   * `ObjectGridProps.defaultSort` to a retired-key tombstone, so the protocol
   * refuses an authored value by name; the renderers no longer read it either
   * (`ObjectGrid`'s fetch arm and header reader, and `ObjectView`'s three
   * `table` paths all dropped the read together).
   *
   * `?: never`, not a deletion — this package's tombstone convention (see
   * `ObjectViewSchema.viewTabBar`): {@link BaseSchema}'s `[key: string]: any`
   * absorbed a deleted member until objectui#8347, and a deletion is still
   * refused only on a fresh literal, so the retired spelling would type-check
   * green through a widened value and do nothing. Lockstep with the Zod twin (`zod/objectql.zod.ts`,
   * `retirementTombstone()`).
   *
   * @deprecated RETIRED (objectui#5861) — write `sort: [{ field, order }]`
   * instead (rename the key and wrap the value in an array).
   */
  defaultSort?: never;

  /**
   * RETIRED: the legacy base-filter fallback. `@objectstack/spec` 18 tombstones
   * `object-grid.defaultFilters` (objectstack#11509) and refuses it by name, so
   * this member, taken BY REFERENCE from the row
   * (`ComponentPropsMap['object-grid'].defaultFilters`), types no value an author
   * can write, and neither `ObjectGrid` nor `ObjectView` reads it since
   * objectui#12030. A value that still reaches the slot at runtime is ignored.
   * Write {@link ObjectGridSchema.filter}: the same `ViewFilterRule` array,
   * `[{ field, operator, value }, ...]`.
   *
   * @deprecated Retired — use `filter`, the same rule array; this key is not read.
   */
  defaultFilters?: SpecObjectGridProps['defaultFilters'];
  
  /**
   * RETIRED (objectui#6152 round 7, ADR-0049) — the legacy second spelling of
   * {@link ObjectGridSchema.resizable}, read only when `resizable` was absent.
   * `@objectstack/spec` 17.7.0 (objectstack#21445) converted
   * `ComponentPropsMap['object-grid'].resizableColumns` to a retired-key
   * tombstone, so the protocol refuses an authored value by name, written flat
   * on the node or in its `properties` bag; and `ObjectGrid` no longer reads it
   * (its `resizable ?? resizableColumns` fallback went in the same change).
   *
   * `?: never`, not a deletion — this package's tombstone convention (see
   * `defaultSort` above): a deletion is refused only on a fresh literal, so the
   * retired spelling would type-check green through a widened value and do
   * nothing. Lockstep with the Zod twin (`zod/objectql.zod.ts`,
   * `retirementTombstone()`).
   *
   * @deprecated RETIRED (objectui#6152) — write `resizable` instead (on an
   * authored node, `properties.resizable`).
   */
  resizableColumns?: never;
  
  /**
   * @deprecated Use label instead
   * Legacy title field — the caption/export-file-title fallback. `ObjectGrid.tsx`
   * draws it at exactly two sites, the export file name's `viewLabel` and the
   * table `caption`, each spelled
   * `resolveInlineI18nLabel(schema.label, displayLocale) || resolveInlineI18nLabel(schema.title, displayLocale)`,
   * so only when `label` resolves to nothing.
   *
   * `I18nLabel` — the spec's own type for this key
   * (`ComponentPropsMap['object-grid'].title`, "Fallback for `label`"): a plain
   * string or an inline per-locale map, resolved against the display locale the
   * way `label` is (objectui#10993 batch 3 taught both sites). Typed `string`
   * until objectui#10993 (batch 4), a NARROWING on both faces of this schema:
   * the contract and the renderer took the map while `tsc` and the zod mirror
   * refused it.
   *
   * Kept DECLARED — not retired — by objectui#6639's census-directed maintainer
   * ruling (2026-08-29, declare branch): authored `object-grid.title` nodes exist
   * (both confirmed hits are in `content/docs/api/schema-reference.md`'s
   * examples), so dropping the read would silently cost those nodes their
   * caption. Mirrored in `zod/objectql.zod.ts` and paired off the
   * `UnmirroredDeclared` ledger in `__tests__/zod-mirror-parity.test.ts` by the
   * same card — the #6424 family form.
   */
  title?: I18nLabel;

  /**
   * One line of help text drawn above the grid, in muted type — the same
   * treatment `list-view` gives a view's description.
   *
   * `string | I18nLabel` — the spec's INLINE locale map, resolved against the
   * display locale by `resolveI18nLabel(label, locale)`, as `label` is. Plain
   * `string` until objectui#9092: a NARROWING override of
   * `BaseSchema.description`, which objectui#4580's revised Q1 ruling
   * (option A) widened. The mirror (`zod/objectql.zod.ts`'s `ObjectGridSchema`)
   * never restates the key, so it inherits the zod `BaseSchema`'s
   * `I18nLabelSchema`.
   *
   * Read by `ObjectGrid` since objectui#11068. Before it, nothing drew the key
   * and it carried `@deprecated`; that ADR-0049 liveness question was answered
   * by honouring it. A map with no entry for any locale draws no line.
   */
  description?: string | I18nLabel;
  
  /**
   * Built-in affordance toggles — the protocol's strict
   * `{ create?, update?, delete?, export? }` block, taken BY REFERENCE from
   * the `object-grid` row (`ComponentPropsMap['object-grid'].operations`,
   * declared by `@objectstack/spec` 17.7.0). The four members are the four
   * `ObjectGrid` reads:
   *
   *   - `create` offers the add-record row (the create permission gates it too);
   *   - `update` / `delete` are the CEILING over {@link rowActions}: `false`
   *     withholds the row menu's generic Edit (or Delete) entry whatever
   *     `rowActions` says;
   *   - `export: false` withholds the export button that {@link exportOptions}
   *     enables; absent, export stays offered.
   *
   * A declared block REPLACES the default rather than merging under it, so an
   * `update` / `delete` the block does not name is withheld too; omit the whole
   * block to keep the default (Edit / Delete offered wherever the host wires
   * `onEdit` / `onDelete`).
   *
   * objectui#6152 round 8 retired `read` and `import` (the protocol refuses
   * both by name): no `object-grid` code reads either. `?: never` is this
   * package's tombstone convention (see {@link defaultSort}), in lockstep with
   * the zod twin's `retirementTombstone()` arms.
   */
  operations?: NonNullable<SpecObjectGridProps['operations']> & {
    /**
     * @deprecated RETIRED (objectui#6152 round 8) — `object-grid` has no reader
     * of `operations.read`: the grid always lists the records it is bound to.
     * Delete the key. On an `object-view`, whether a row click opens the record
     * is the view's own: write `navigation: { mode: 'none' }` (or
     * `operations: { read: false }`) on the `object-view` node, not in `table`.
     */
    read?: never;
    /**
     * @deprecated RETIRED (objectui#6152 round 8) — `object-grid` draws no
     * import affordance, so `operations.import` toggled nothing. Delete the key.
     */
    import?: never;
  };

  /**
   * Custom row actions
   * NOTE: This is ObjectUI-specific and not part of @objectstack/spec
   *
   * `'edit'` and `'delete'` are canonical: they select the row menu's generic
   * Edit / Delete entries; any other name is a custom action resolved against
   * the object's declared actions. {@link operations} is the CEILING: a
   * `rowActions` entry cannot offer what `operations` withholds. Inside that
   * ceiling a declared list NARROWS: the generic Edit / Delete are offered only
   * for the canonical names it carries, so `[]` or a list naming only custom
   * actions offers neither. Omit `rowActions` to keep the default generic
   * entries.
   */
  rowActions?: string[];
  
  /**
   * Custom batch actions
   * NOTE: This is ObjectUI-specific and not part of @objectstack/spec.
   * Legacy alias of `bulkActions` — prefer `bulkActions`. When both are
   * set, `batchActions` wins (preserved for backward compatibility).
   */
  batchActions?: string[];

  /**
   * Bulk action identifiers (action names from ActionSchema).
   * Aligned with @objectstack/spec ListViewSchema.bulkActions — the
   * canonical key; `batchActions` is the legacy ObjectUI alias.
   */
  bulkActions?: string[];
  
  /**
   * Enable inline cell editing (Grid mode)
   * When true, cells become editable on double-click or Enter key
   * NOTE: This is ObjectUI-specific and not part of @objectstack/spec
   * @default false
   */
  editable?: boolean;

  /**
   * Enable single-click editing mode
   * When true with editable, clicking a cell enters edit mode (instead of double-click)
   *
   * `ObjectGrid` reads it as `schema.singleClickEdit ?? true`, so an absent key
   * means single-click editing, as the spec's `object-grid` row says ("default true
   * when editable"). This comment read `@default false` until objectui#6152 round 6,
   * which mirrored the key and measured the default through the real registry.
   * @default true
   */
  singleClickEdit?: boolean;
  
  /**
   * Grouping Configuration (Airtable-style)
   * Groups rows by specified fields with collapsible sections.
   * Aligned with @objectstack/spec GroupingConfigSchema.
   */
  grouping?: GroupingConfig;

  /**
   * Per-group aggregations to display in group headers (e.g. SUM(amount) per region).
   * ObjectUI-specific (not in @objectstack/spec for ObjectGrid; sourced from the
   * Report protocol when ObjectGrid is rendered as a Summary report body).
   * @example [{ field: 'amount', type: 'sum' }, { field: 'id', type: 'count_distinct' }]
   */
  aggregations?: Array<{
    field: string;
    type: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'count_distinct';
  }>;

  /**
   * Row Color Configuration (Airtable-style)
   * Colors rows based on field values.
   * Aligned with @objectstack/spec RowColorConfigSchema.
   */
  rowColor?: RowColorConfig;

  /**
   * Arrow-key cell navigation on the WAI-ARIA grid pattern (objectui#11068).
   * A member of the spec's `object-grid` row (`ComponentPropsMap['object-grid']`)
   * since `@objectstack/spec` 17.6.0 (objectstack#20694).
   *
   * On, the grid's data cells are ONE Tab stop between them, a roving focus:
   * arrow keys move it one cell, Home / End to the ends of the row, Ctrl+Home /
   * Ctrl+End to the ends of the page, Enter still opens an editable cell, and an
   * edit ended with Enter or Escape hands focus back to its cell. Off, every data
   * cell is its own Tab stop, as it always was. A widget a cell renders (the
   * record link, a row's action menu, a selection checkbox) keeps its own stop
   * either way.
   *
   * `ObjectGrid` reads it as `schema.keyboardNavigation ?? inlineEditable`, where
   * `inlineEditable` is the authored `editable` AND the viewer's write verdict on
   * the object — the one value the grid's inline editing itself obeys. So a grid
   * that renders editable has it on, a grid that renders read-only keeps its Tab
   * behaviour unless this is `true`, and `false` turns it off on an editable grid.
   * @default true when the grid renders editable
   */
  keyboardNavigation?: boolean;
  
  /**
   * Number of columns to freeze (left-pin)
   * Useful for keeping certain columns visible while scrolling
   * NOTE: This is ObjectUI-specific and not part of @objectstack/spec
   * @default 0
   */
  frozenColumns?: number;

  /**
   * Row height preset for the grid.
   * Controls the density of grid rows.
   * Aligned with @objectstack/spec RowHeight enum.
   * @default 'compact'
   */
  rowHeight?: 'compact' | 'short' | 'medium' | 'tall' | 'extra_tall';

  /**
   * Export options configuration for exporting grid data.
   * See {@link ListViewExportOptions} — the key set is the spec's, and the one
   * that `ObjectGrid` reads.
   */
  exportOptions?: ListViewExportOptions;

  /**
   * Navigation configuration for row click behavior.
   * Controls how record detail is displayed when a row is clicked.
   * Aligned with @objectstack/spec ListView.navigation.
   */
  navigation?: ViewNavigationConfig;

  /**
   * Called for page-level navigation with the record id and a
   * {@link RecordNavigateAction} — a navigation-MODE token from a closed
   * vocabulary: `'view'` opens the record page, `'new_window'` opens it in a
   * new browser tab.
   *
   * PROGRAMMATIC ONLY — not authoring surface. Deliberately absent from
   * `GRID_QUERY_INPUTS` (`@object-ui/plugin-grid`'s `index.tsx`), so the
   * manifest, the designer panel and the generated `sdui-intrinsics.d.ts` do
   * not offer it; maintainer ruling of 2026-08-19 on objectui#5234.
   *
   * The reason is the value, not the declaration: this is a FUNCTION VALUE and
   * a schema is a SERIALISABLE DOCUMENT. `(recordId, action) => void` cannot
   * survive a metadata round-trip whatever declares it, so no author writing
   * JSON or YAML — and no AI emitting a schema document — can express this
   * key. Writing it into a stored document does nothing at all.
   *
   * Programmatic callers should prefer `ObjectGridComponentProps`
   * (`@object-ui/plugin-grid`), which declares ten callbacks: this one, as a
   * prop since objectui#9547 — and the prop wins when both are supplied — and
   * the nine siblings `onRowClick`, `onRowSelect`, `onCellChange`,
   * `onRowSave`, `onBatchSave`, `onEdit`, `onDelete`, `onBulkDelete`,
   * `onAddRecord`, which live and only live there, for exactly this reason.
   *
   * The declaration is kept rather than removed: with the key explicitly
   * published, removing it is a breaking public type change plus a deprecation
   * cycle, for zero measured harm. The exemption comment at the read site
   * (`plugin-grid/src/ObjectGrid.tsx`) carries the same statement, and both are
   * pinned by `plugin-grid/src/__tests__/gridNonAuthorKeys.test.tsx`.
   *
   * RUNTIME SLOT (objectui#6124, declared by `8d50bc2bf`) — the zod twin now
   * refuses this key BY NAME instead of letting `BaseSchema.passthrough()`
   * accept and KEEP an authored value that reaches `useNavigationOverlay` and
   * is CALLED. That closes the gap the ruling above left open on this face:
   * "not offered" was true of the manifest and the designer panel, but the
   * validator still said yes. The two faces now agree, and they agree with
   * `@objectstack/spec`, whose `strictObject` already refused the key.
   *
   * ⚠️ No host in this repository builds an `object-grid` node carrying it —
   * measured, and reported rather than smoothed over. The slot is nonetheless
   * real: the renderer reads and runs it, and the pin named above supplies it
   * from a schema and asserts the call. What is absent is a supplier, not the
   * channel, so `'retired'` ("no renderer reads this key") would be false.
   */
  onNavigate?: (recordId: string | number, action: RecordNavigateAction) => void;

  /**
   * Conditional formatting rules for row styling — `[{ condition, style }]`, the rule
   * @objectstack/spec's `ListViewSchema.conditionalFormatting` declares: the first rule
   * whose CEL `condition` holds applies its CSS `style` map to the row. The native
   * `{ field, operator, value }` rule, its `expression` and a top-level colour are
   * retired and refused by name (objectui#11533); see {@link ConditionalFormattingRule}.
   */
  conditionalFormatting?: ConditionalFormattingRule[];

  /**
   * RETIRED (objectui#11068, ADR-0049) — a second spelling of
   * {@link ObjectGridSchema.rowActions}.
   *
   * It was declared beside `rowActions` with the same meaning (action names
   * for the row menu) and nothing ever read it, so an authored list drew no
   * menu entry. `rowActions` is the spelling `ObjectGrid` reads and the one
   * the upstream protocol's `object-grid` row declares; honouring this key as
   * well would have made one fact writable two ways (AGENTS.md #0.1).
   *
   * @deprecated RETIRED (objectui#11068) — rename the key to `rowActions`.
   */
  rowSpecActions?: never;

  /**
   * RETIRED (objectui#11068, ADR-0049) — a second spelling of
   * {@link ObjectGridSchema.bulkActions}, for the same reason as
   * `rowSpecActions` above.
   *
   * @deprecated RETIRED (objectui#11068) — rename the key to `bulkActions`.
   */
  bulkSpecActions?: never;

  /**
   * Rich bulk action definitions. When provided, takes precedence over
   * `bulkActions` (the string-id list) by opening a BulkActionDialog that
   * collects params, confirms, and executes via dataSource.bulk(...) with
   * progress + result reporting.
   */
  bulkActionDefs?: BulkActionDef[];

  /**
   * What the grid draws instead of an empty table (objectui#11068).
   *
   * Read by `ObjectGrid` when it has no rows to draw — nothing is loading, it
   * holds no record (no group, when grouped), and no search term typed into
   * its own server-side search box is what emptied it. The grid then draws
   * this empty state in place of the table: the Lucide icon named by `icon`,
   * the `title`, and the `message` below it. A member left out keeps the
   * grid's own default: the shared empty-state glyph, the table's
   * "No results found" heading, and no message line. It is text only, as the
   * table's own empty row is: an empty table draws no add-record row either.
   *
   * A search that finds nothing is NOT this state: the table stays, with its
   * own "no results" row, so the search box that emptied it stays reachable.
   * Leave the key out and nothing changes — the table draws its own empty row.
   *
   * The protocol's own empty-state type, ⛔ not a second shape (objectui#11227):
   * `@objectstack/spec` 17.6.0 declares `emptyState` on its `object-grid` row
   * by reference to the list view's `EmptyStateSchema`, so the grid and
   * `ListViewSchema` share one shape. `title` and `message` are `I18nLabel` —
   * a plain string or an inline locale map — and `ObjectGrid` resolves each
   * against the display locale, as it resolves `label` and `description`; a
   * map with no usable entry keeps that member's default. `icon` stays a
   * string. The Zod twin takes the same schema by reference, so it refuses an
   * unknown member as the spec does.
   */
  emptyState?: SpecEmptyState;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-grid` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its refusal
   * names `children` as the remedy, which this node does not read either. The
   * member is restated here so both faces point at what the node renders
   * instead.
   *
   * @deprecated Not a channel `object-grid` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-grid` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep: no `body` /
   * `children` read is filed under this declaration, while the same instrument
   * does see it as the receiver of the keys the renderer reads. The
   * registration hop, `ObjectGridRenderer` (`packages/plugin-grid`), is
   * `any`-typed and hands the node to `ObjectGrid`, which reads it as this
   * type. `SchemaRenderer` strips both keys out of the props bag it spreads,
   * so neither reaches the component by another route, and the registration
   * declares no `children` slot (objectui#9910).
   *
   * What it renders instead: the records of `objectName` as a data grid,
   * shaped by `columns`, `filter`, `sort`, `grouping`, `selection` and the
   * rest of this declaration.
   *
   * @deprecated Not a channel `object-grid` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Form Section Configuration
 * Aligns with @objectstack/spec FormSection
 */
export interface ObjectFormSection {
  /**
   * Section identifier
   */
  name?: string;
  
  /**
   * Section label
   */
  label?: string;
  
  /**
   * Section description
   */
  description?: string;
  
  /**
   * Whether the section can be collapsed
   *
   * Wizard boundary (objectstack#13622 D2, ruled 2026-08-31): wizard steps do
   * not collapse — the wizard shows exactly the current step. On a
   * `formType: 'wizard'` form the renderer drops this key (ObjectForm's
   * wizard map rebuilds each step key by key and does not copy it), and
   * `@objectstack/spec` refuses an authored `true` on a wizard step at parse.
   * An authored `false` stays accepted everywhere: it declares exactly the
   * behavior a wizard delivers.
   * @default false
   */
  collapsible?: boolean;

  /**
   * Whether the section is initially collapsed
   *
   * Same wizard boundary as {@link collapsible}: dropped by the wizard route,
   * and `true` is refused on a wizard step at the spec door.
   * @default false
   */
  collapsed?: boolean;
  
  /**
   * Number of columns for field layout
   * @default 1
   */
  columns?: 1 | 2 | 3 | 4;

  /**
   * Which panel of a split form this section renders in. Aligns with
   * @objectstack/spec FormSection.pane (split forms only — the spec rejects the
   * key on other form types at parse). Explicit per-section placement, so
   * reordering sections never silently moves them across the divider.
   * Omitted → the legacy positional rule: first section 'primary', every
   * other section 'secondary'.
   */
  pane?: 'primary' | 'secondary';

  /**
   * The section's fields, in order. Each entry is one of three shapes, the
   * three `buildSectionFields` (`@object-ui/plugin-form`) draws on every
   * `formType`:
   *
   * - a field NAME, resolved against the object schema;
   * - the form view's `{ field, … }` entry — `@objectstack/spec`'s
   *   `FormFieldInput`, by reference (objectui#11615): `field` names an object
   *   field and every other key overrides that field's generated definition;
   * - an inline runtime {@link FormField} keyed by `name`, drawn as it stands
   *   with no object schema needed.
   *
   * On the default (`simple`) form the first two shapes resolve against the
   * form's parent field pool — top-level `fields` when it is given, else the
   * object's fields, plus `customFields` — and a name the pool does not hold is
   * dropped (with a warning when the object declares it: `fields` and
   * `sections` intersect, objectui#9884). An inline `FormField` names nothing
   * to resolve, so it is drawn whatever the pool holds, as on every other
   * `formType` (objectui#11615).
   *
   * OPTIONAL since objectui#7051, and optional ONLY in the sense that
   * {@link group} is the other way to declare the same fact —
   * `@objectstack/spec`'s `FormSectionSchema` refuses a section carrying
   * neither ("A section must declare its members exactly one way") and refuses
   * one carrying both. It was required here while no form-section renderer
   * read `group`, so this type refused the exact shape the spec declares and a
   * TypeScript author could not write the group-reference form at all.
   */
  fields?: (string | SpecFormFieldInput | FormField)[];

  /**
   * Reference a declared field GROUP instead of enumerating members
   * (`@objectstack/spec` 17.3.0, objectstack#13855, ADR-0085 §5).
   *
   * `{ group: 'contact_info' }` inherits the object's `fieldGroups` entry with
   * that key: its members (every field pointing at it, in declaration order)
   * and its own presentation (label, description, collapse) both, assembled by
   * `deriveFieldGroupLayout` — the single assembler this repo never
   * re-implements.
   *
   * Mutually exclusive with {@link fields}, and refused beside every key the
   * group itself declares (`name`, `label`, `description`, `collapsible`,
   * `collapsed`, `visibleWhen`) — the spec grants no override semantics, so a
   * restated key would be a second writable spelling of one fact. What a
   * section keeps beside `group` is how THIS form lays it out: `columns` and
   * `pane`. Refused outright on a wizard step (`formType: 'wizard'`), which
   * has no slot for a group's `collapse` or `visibleWhen`.
   *
   * The aliases `fieldGroup` / `groupKey` are NOT accepted spellings: the spec
   * refuses them as unrecognized keys with a "did you mean `group`" hint, so
   * they are deliberately absent here too.
   */
  group?: string;

  /**
   * Conditional visibility for the SECTION HEADER, as an authored predicate.
   * Aligns with @objectstack/spec FormSection.visibleWhen (ADR-0089) — the same
   * canonical `@object-ui/core` engine and record scope every other
   * `visibleWhen` surface uses, so one authored predicate text means one thing
   * everywhere (#6010). A broken predicate fails OPEN (the header renders).
   *
   * Scope: this gates the WHOLE section (objectui#6236, maintainer ruling
   * 2026-08-27). The plugin-form layouts stamp the membership claim
   * (`FormField.fields`, the FormFieldTab shape) onto the `section-divider`
   * row they synthesize, and the renderer then hides heading and claimed
   * fields together on a FALSE predicate — matching the console renderer
   * (`apps/console/src/components/FormPage.tsx`), which drops the whole
   * section element. Hidden fields skip client-side validation (a user is
   * never blocked by an error pointing at a control they cannot see) and
   * their values still submit — visibility decides what is DRAWN and nothing
   * else (the console precedent, 2026-08-22 after #5594). Derived
   * `fieldGroups` sections carry no predicate slot, so their groups are
   * always drawn.
   *
   * Wizard boundary (objectstack#13622 D2, ruled 2026-08-31): wizard steps
   * carry NO predicate slot — steps are entered in array order behind the
   * step gate, never conditionally. On a `formType: 'wizard'` form the
   * renderer drops this key (and reports the drop via console.warn — see
   * `sectionPredicateUnsupportedWarning` in @object-ui/plugin-form), the
   * wizard's own step type (`WizardStepConfig`) rejects it at compile time
   * (objectui#6237's ruled split), and `@objectstack/spec` refuses it on a
   * wizard step at parse. Put the predicate on the fields inside the step —
   * field-level `visibleWhen` is evaluated on every layout. A step-level
   * predicate is a future contract of its own, tracked in objectui#6237.
   */
  visibleWhen?: string | { dialect?: string; source: string };

  /**
   * What a {@link visibleWhen} that cannot be evaluated (a parse error, an
   * unbound field or root, an evaluation error) does to the section:
   * `'hidden'` hides it whole, header and members; `'shown'` or absent draws
   * it, which is the fail-open default every other predicate slot keeps.
   *
   * ⛔ Not an authoring key. It is a runtime hand-off that names the fault
   * direction the predicate's ORIGIN declares, and only the field-group
   * derivation writes it: `deriveFieldGroupSections` (`@object-ui/plugin-form`)
   * stamps `'hidden'` beside the predicate it copies off an object's
   * `fieldGroups` entry, because `@objectstack/spec` declares
   * `ObjectFieldGroupSchema.visibleWhen` fail-closed ("else hidden
   * (fail-closed)"). An authored form-view section's own `visibleWhen` is
   * declared to fault OPEN (`FormSectionSchema.visibleWhen`), and on the form
   * both predicates arrive in the same slot, so the direction has to travel
   * with the predicate rather than be read off the slot (objectui#13055). The
   * spec's strict `FormSectionSchema` refuses this key in authored metadata.
   *
   * Every layout that rebuilds a section key by key carries it next to
   * `visibleWhen` (pinned by `sectionFaultCarry-13055` in
   * `@object-ui/plugin-form`), down to the `section-divider` row
   * ({@link FormField.visibleWhenFault}) or the tab
   * ({@link FormFieldTab.visibleWhenFault}) the form renderer evaluates.
   */
  visibleWhenFault?: 'hidden' | 'shown';

  // `className` / `gridClassName` are deliberately NOT declared here
  // (objectui#7200 — the declared-but-inert remainder of objectstack#13626,
  // maintainer ruling 2026-09-01: "retire the reads … Declaring the keys was
  // weighed and not adopted: it would formally invite free Tailwind strings
  // into authored metadata, the exact class the boundary exists to keep out").
  // This is the AUTHORED-metadata section type; `@objectstack/spec`'s
  // `FormSectionSchema` is a strictObject with neither key, and the renderer
  // reads neither off an authored section. An annotated literal carrying one
  // now fails at the authoring site instead of type-checking into a no-op.
  //
  // The per-layout config types in @object-ui/plugin-form
  // (`ModalFormSectionConfig`, `SplitFormSectionConfig`, TabbedForm's
  // `FormSectionConfig`, `WizardStepConfig`, `DrawerFormSectionConfig`) keep
  // their own members: those are read for programmatic React mounts, which the
  // authorable boundary does not govern. Pinned at the type level in
  // `__tests__/object-form-section-style-keys-undeclared.test.ts`; the
  // behavioural half (an authored string never reaches the DOM) stays in
  // plugin-form's `__tests__/sectionStyleKeysRetired-13626.test.tsx`.
}

/**
 * ObjectForm Schema
 * A smart form component that generates forms from ObjectQL object schemas.
 * It automatically creates form fields based on object metadata.
 * 
 * Supports multiple form variants aligned with @objectstack/spec FormView:
 * - `simple`  – Flat field list (default)
 * - `tabbed`  – Fields organized in tabs
 * - `wizard`  – Multi-step form with navigation
 * - `split`   – Side-by-side panels (reserved)
 * - `drawer`  – Slide-out form panel (reserved)
 * - `modal`   – Dialog-based form (reserved)
 */

/**
 * Declarative post-submit behavior — aligned with `@objectstack/spec`'s
 * `FormView.submitBehavior`. Lets metadata-only forms (which can't pass an
 * `onSuccess` function) declare what happens after a successful create/update.
 */
export type SubmitBehavior =
  | { kind: 'thank-you'; title?: string; message?: string }
  | { kind: 'redirect'; url: string; delayMs?: number }
  | { kind: 'continue' }
  | { kind: 'next-record' };

/**
 * Key taxonomy (#2545 — spec `FormViewSchema` alignment):
 *
 * - **[spec-aligned]** — same name & semantics as `@objectstack/spec`
 *   `FormViewSchema` (`title`, `description`, `layout`, `columns`, `sections`,
 *   `defaultTab`, `tabPosition`, `allowSkip`, `showStepIndicator`,
 *   `splitDirection`/`splitSize`/`splitResizable`, `drawerSide`/`drawerWidth`,
 *   `modalSize`, `subforms`, `submitBehavior`; `formType` ↔ spec `type`).
 * - **[ObjectUI extension]** — serializable renderer extras with no spec
 *   backing yet (button visibility/labels, `className`, `initialValues`,
 *   `fields`/`customFields`, …). Candidates for upstreaming are tracked in
 *   #2545; until then they are sanctioned, documented extensions.
 * - **[runtime-only]** — non-serializable runtime concerns that never belong
 *   in view metadata (`mode`, `recordId`, `open`, callbacks, …).
 *
 * ## What this type describes (objectui#10859, batch 4)
 *
 * The `object-form` node as `ObjectForm` READS it: after `SchemaRenderer` has
 * hoisted the node's `properties` bag onto it, or as code composes it
 * (`ObjectView`, `RecordFormPage`, `ScreenView`, the plugin-form variants, a
 * host mounting `<ObjectForm schema={…}>`). That is why its identity keys are
 * required here and why it carries host callbacks.
 *
 * It is NOT the shape of an AUTHORED `object-form` document. An authored node
 * takes its props in the spec's `properties` bag, whose members are
 * `@objectstack/spec`'s `ComponentPropsMap['object-form']` row
 * (`ObjectFormProps`): `{ type: 'object-form', properties: { objectName, mode,
 * … } }`. `ObjectFormBlockSchema` (`./zod/objectql.zod.ts`) judges it, and
 * refuses a prop written flat on the node by name. `SchemaRenderer` reads both
 * spellings, so a node built in code keeps its flat keys.
 */
export interface ObjectFormSchema extends BaseSchema {
  type: 'object-form';

  /**
   * Per-element data binding — the spec's `ElementDataSource`, by reference
   * (objectui#11070). A form honours its `object` (it edits one record, so
   * there is no collection query to filter or page). Metadata, ⛔ not the
   * adapter: see {@link ObjectGridSchema.dataSource}.
   */
  dataSource?: ElementDataSource;
  
  /**
   * Form variant type.
   * Aligns with @objectstack/spec FormView.type
   * 
   * - `simple`  – Standard flat form (default)
   * - `tabbed`  – Sections as tabs
   * - `wizard`  – Multi-step wizard with progress indicator
   * - `split`   – Side-by-side panel layout (reserved)
   * - `drawer`  – Slide-out form (reserved)
   * - `modal`   – Dialog form (reserved)
   *
   * @default 'simple'
   */
  formType?: 'simple' | 'tabbed' | 'wizard' | 'split' | 'drawer' | 'modal';
  
  /**
   * ObjectQL object name (e.g., 'users', 'accounts', 'contacts')
   */
  objectName: string;
  
  /**
   * Form mode
   */
  mode: 'create' | 'edit' | 'view';
  
  /**
   * Record ID (required for edit/view modes). A record id is a `string` on every
   * boundary (objectui#9511) — a numeric primary key is converted at the
   * adapter's own boundary, so an authored `42` is refused with `'42'`
   * prescribed.
   */
  recordId?: string;
  
  /**
   * Optional title for the form — the heading of the drawer and modal
   * presentations.
   *
   * `title`, `description`, `submitText`, `cancelText`, `nextText`, `prevText`
   * and `successMessage` are the spec's `I18nLabel`, as
   * `ComponentPropsMap['object-form']` in `@objectstack/spec` declares them: a
   * plain string or an inline per-locale map such as
   * `{ en: 'Save order', 'zh-CN': '保存订单' }`. `ObjectForm` resolves all seven
   * with `pickLocalized` against the active UI language
   * (`useObjectTranslation().language`) once, above the `formType` fork, so every
   * presentation receives a string (objectui#10993).
   */
  title?: I18nLabel;

  /**
   * Optional description — the subtitle of the drawer and modal presentations.
   * `I18nLabel`; see `title`.
   */
  description?: I18nLabel;

  /**
   * Field names to include in the form
   * If not specified, uses all editable fields from object schema
   */
  fields?: string[];
  
  /**
   * Custom field configurations
   * Overrides auto-generated fields for specific fields.
   * When used with inline field definitions (without dataSource), this becomes the primary field source.
   */
  customFields?: FormField[];
  
  /**
   * Inline initial data for demo/static forms
   * When provided along with customFields (or inline field definitions), the form can work without a data source.
   * Useful for documentation examples and prototyping.
   */
  initialData?: Record<string, any>;
  
  /**
   * Form sections for organized layout.
   * Used by tabbed/wizard/simple forms to group fields.
   * Aligns with @objectstack/spec FormView.sections
   *
   * Wizard semantics (objectstack#13622, ruled 2026-08-31): on a
   * `formType: 'wizard'` form the sections ARE the steps — there is no
   * `steps` key — and array order is step order (no `order` key; reordering
   * the array reorders the wizard). A wizard with absent or empty `sections`
   * is refused by `@objectstack/spec` at parse for authored form views; this
   * renderer's own fallback for that shape (rendering as a plain simple
   * form) is only reachable by programmatic SDUI callers, which do not pass
   * the spec door.
   */
  sections?: ObjectFormSection[];
  
  /**
   * Field groups for organized layout.
   *
   * @deprecated Legacy alias of {@link sections} — `@objectstack/spec`
   * FormViewSchema defines `groups` as "Legacy support → alias to sections",
   * and the form renderer only consumes `sections`. Consumers (spec-bridge,
   * ObjectForm) normalize `groups` into `sections` when `sections` is absent;
   * new metadata should declare `sections` directly. Note the legacy shape
   * differs from {@link ObjectFormSection}: `title`→`label`,
   * `defaultCollapsed`→`collapsed`.
   */
  groups?: Array<{
    title?: string;
    description?: string;
    fields: string[];
    collapsible?: boolean;
    defaultCollapsed?: boolean;
  }>;
  
  /**
   * Label placement — `@objectstack/spec`'s `object-form` row's own enum, by
   * reference:
   * - `vertical`   – label above field (default)
   * - `horizontal` – label and field in a row
   *
   * ⛔ `inline` and `grid` are RETIRED (objectui#11168 slice 3, objectui#7759
   * group C). The spec refuses both since 17.5.0 (objectstack#20221), and
   * measured through the real `SchemaRenderer` both rendered byte-identical to
   * `vertical` — every layout folded them away.
   *
   * @default 'vertical'
   */
  layout?: SpecObjectFormProps['layout'];
  
  /**
   * Number of columns the fields are laid out in (1-4). Independent of
   * `layout`: the form body is one grid at this width.
   */
  columns?: number;
  
  /**
   * Default active tab (section name). Only used when formType is 'tabbed'.
   */
  defaultTab?: string;
  
  /**
   * Tab position. Only used when formType is 'tabbed'.
   * @default 'top'
   */
  tabPosition?: 'top' | 'bottom' | 'left' | 'right';
  
  /**
   * Allow skipping steps. Only used when formType is 'wizard'.
   *
   * This is navigation freedom, NOT a validation exemption (objectstack#13622
   * D4, ruled 2026-08-31): the default (absent/`false`) is the step gate —
   * the next step opens only after the current step's form submits and
   * validates — and `true` merely lets the user enter any step. Either way
   * the final submit re-checks every step's declared field set and returns
   * the user to the first step with an outstanding required field.
   * @default false
   */
  allowSkip?: boolean;
  
  /**
   * Show step indicator. Only used when formType is 'wizard'.
   * @default true
   */
  showStepIndicator?: boolean;
  
  /**
   * Text for Next button. Only used when formType is 'wizard'.
   * `I18nLabel`; see `title`.
   * @default 'Next'
   */
  nextText?: I18nLabel;
  
  /**
   * Text for Previous button. Only used when formType is 'wizard'.
   * `I18nLabel`; see `title`.
   * @default 'Back'
   */
  prevText?: I18nLabel;
  
  /**
   * Called when wizard step changes. Only used when formType is 'wizard'.
   *
   * RUNTIME SLOT (objectui#6124, declared by `8d50bc2bf`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is READ and RUN by the registered renderer.
   * The read: `ObjectForm` forwards it onto the wizard node it builds
   * (`onStepChange: schema.onStepChange`) and `WizardForm` calls
   * `schema.onStepChange(step)`.
   *
   * ⚠️ Its supplier is NOT the one its four siblings have, and the difference
   * was measured rather than inferred: NO host in this repository fills this
   * key. The channel is nonetheless wired end to end — forwarded, then called —
   * so a host that fills it is run, and `'retired'` ("no renderer reads this
   * key") would be false. What is absent is a supplier, not the channel.
   */
  onStepChange?: (step: number) => void;
  
  /**
   * Show submit button
   * @default true
   */
  showSubmit?: boolean;
  
  /**
   * Submit button text. `I18nLabel`; see `title`.
   */
  submitText?: I18nLabel;

  /**
   * Declarative success toast text shown after a successful create/update when
   * no `onSuccess` function handler is supplied (metadata-only pages cannot
   * pass a function). Falls back to 'Created' / 'Saved'. `I18nLabel`; see
   * `title`.
   */
  successMessage?: I18nLabel;

  /**
   * Navigate here after a successful create/update (declarative; falls back to
   * a toast). Takes precedence over `successMessage`.
   *
   * The value is a RELATIVE path only — an absolute URL is refused even when it
   * is same-origin — and it supports `{id}`/`{recordId}` interpolation from the
   * saved record, URL-escaped when the destination is built. A refused
   * destination is reported on the success toast rather than silently dropped.
   *
   * @deprecated Write `submitBehavior` instead — it is the one ruled shape for
   * post-submit behaviour, it already takes precedence over this key, and it
   * carries the richer `{{record.field_name}}` interpolation. This key keeps
   * working for forms that already declare it (maintainer ruling, 2026-08-17,
   * objectui#5034).
   */
  navigateOnSuccess?: string;

  /**
   * Reset the form after a successful create so the user can enter another.
   * Ignored when `navigateOnSuccess` or `submitBehavior` is set.
   */
  resetOnSuccess?: boolean;

  /**
   * Declarative post-submit behavior aligned with `@objectstack/spec`'s
   * `FormView.submitBehavior`. When present, takes precedence over
   * `successMessage` / `navigateOnSuccess` / `resetOnSuccess`.
   */
  submitBehavior?: SubmitBehavior;

  /**
   * Show cancel button
   * @default true
   */
  showCancel?: boolean;
  
  /**
   * Cancel button text. `I18nLabel`; see `title`.
   */
  cancelText?: I18nLabel;
  
  /**
   * Show reset button
   * @default false
   */
  showReset?: boolean;
  
  /**
   * Initial values (for create mode)
   *
   * @deprecated Prefer the spec-aligned {@link defaults}. Kept as back-compat:
   * ObjectForm folds `defaults` into this at render, and an explicitly-set
   * `initialValues` still wins.
   */
  initialValues?: Record<string, any>;

  /**
   * Structured, spec-aligned form action-button config — the authoring surface
   * for submit/cancel/reset visibility + labels, mirroring `@objectstack/spec`
   * `FormViewSchema.buttons` (framework#1894 / objectstack-ai/objectstack#2998). ObjectForm normalizes
   * this down onto the flat `showSubmit`/`submitText`/`showCancel`/`cancelText`/
   * `showReset` props at render, so prefer this over those flat keys (which
   * remain only as deprecated back-compat). An explicitly-set flat key wins.
   */
  buttons?: {
    submit?: { show?: boolean; label?: string };
    cancel?: { show?: boolean; label?: string };
    reset?: { show?: boolean; label?: string };
  };

  /**
   * Create-mode initial field values, keyed by field machine name — the
   * spec-aligned alias of the deprecated flat {@link initialValues}, mirroring
   * `@objectstack/spec` `FormViewSchema.defaults` (framework#1894 / objectstack-ai/objectstack#2998).
   * ObjectForm folds this into `initialValues` at render.
   */
  defaults?: Record<string, any>;

  /**
   * Callback on successful submission
   *
   * RUNTIME SLOT (objectui#6124, declared by `8d50bc2bf`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is READ and RUN by the registered renderer.
   * The read: `ObjectForm` forwards it onto every variant node it builds
   * (`onSuccess: schema.onSuccess`). Supplied by hosts that build the
   * `object-form` node in TypeScript — `AppContent`, `RecordFormPage`,
   * `ScreenView`, `FlowRunner` and `useActionModal` in `@object-ui/app-shell`,
   * `ObjectManager` / `FieldDesigner` in `@object-ui/plugin-designer`,
   * `MasterDetailForm` / `EmbeddableForm` in `@object-ui/plugin-form`, and
   * `plugin-view`'s `ObjectView`. `ObjectFormComponentProps` declares only
   * `schema`, `dataSource` and `className`, so the NODE is the channel.
   */
  onSuccess?: (data: any) => void | Promise<void>;

  /**
   * Override persistence. When supplied, the form validates and hands the
   * collected values to this handler INSTEAD of calling dataSource.create /
   * dataSource.update — the host owns the write (e.g. MasterDetailForm batching
   * the parent + child line items into one atomic server transaction). The
   * returned record is passed on to `onSuccess`.
   *
   * In `edit` mode, for a record the form read itself, every layout — the
   * simple form, `tabbed`, `wizard`, `split`, `modal` and `drawer`, and a
   * simple form that the mobile `stepper` option routes through the wizard —
   * hands over what the form would have written (objectui#10156,
   * objectui#10563): the fields that differ from the record it read, or the
   * full sanitized payload when nothing changed — every value except the ones
   * the form never writes (server-owned, computed, read-only, refused by
   * field-level security, or unknown to the object). A field whose sameness
   * cannot be settled counts as changed, so it is handed over.
   */
  submitHandler?: (values: Record<string, any>) => any | Promise<any>;

  /**
   * Inline child collections (master-detail). When present, the form renders as
   * a master-detail form: the object's own fields on top, then an editable grid
   * per child collection, persisted together in one atomic transaction. Each
   * entry needs only `childObject` — the relationship FK and grid columns are
   * derived from the child object's metadata (override with
   * `relationshipField` / `columns`). This lets a regular form view declare
   * master-detail without a bespoke page.
   *
   * A `columns` entry is the spec's `InlineGridColumn` (objectui#11266): an
   * object keyed by `name`, never a bare field-name string. The minimal entry is
   * `{ name: 'quantity' }`; a column that declares no `type` takes its label,
   * type and the rest from the child object's field.
   */
  subforms?: Array<{
    childObject: string;
    relationshipField?: string;
    columns?: SpecInlineGridColumn[];
    amountField?: string;
    totalField?: string;
    title?: string;
    addLabel?: string;
    minRows?: number;
    maxRows?: number;
  }>;

  /**
   * Callback on error
   *
   * RUNTIME SLOT (objectui#6124, declared by `8d50bc2bf`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is READ and RUN by the registered renderer.
   * The read: `ObjectForm` forwards it onto the master-detail node
   * (`onError: schema.onError`). Supplied by `MasterDetailForm`
   * (`@object-ui/plugin-form`), beside its {@link onSuccess}.
   */
  onError?: (error: Error) => void;

  /**
   * Callback on cancel
   *
   * RUNTIME SLOT (objectui#6124, declared by `8d50bc2bf`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is READ and RUN by the registered renderer.
   * The read: `ObjectForm` forwards it onto every variant node it builds
   * (`onCancel: schema.onCancel`). Supplied by the same hosts as
   * {@link onSuccess}, one line below their `onSuccess`.
   */
  onCancel?: () => void;
  
  /**
   * Read-only mode
   * @default false
   */
  readOnly?: boolean;
  
  /**
   * Custom CSS class
   */
  className?: string;

  // ─── Split Form Props ──────────────────────────────────
  
  /**
   * Split panel direction. Only used when formType is 'split'.
   * @default 'horizontal'
   */
  splitDirection?: 'horizontal' | 'vertical';
  
  /**
   * Size of the left/top panel in the split layout (percentage 1-99).
   * Only used when formType is 'split'.
   * @default 50
   */
  splitSize?: number;
  
  /**
   * Whether the split panels can be resized. Only used when formType is 'split'.
   * @default true
   */
  splitResizable?: boolean;

  // ─── Drawer Form Props ─────────────────────────────────
  
  /**
   * Whether the drawer is open. Only used when formType is 'drawer'.
   * @default true
   */
  open?: boolean;
  
  /**
   * Callback when open state changes. Only used when formType is 'drawer'.
   *
   * RUNTIME SLOT (objectui#6124, declared by `8d50bc2bf`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is READ and RUN by the registered renderer.
   * The read: `ObjectForm` forwards it onto the drawer / modal node
   * (`onOpenChange: schema.onOpenChange`). Supplied by `AppContent`
   * (`if (!open) closeRecordForm()`) in `@object-ui/app-shell` and by
   * `ObjectManager` / `FieldDesigner` (`handleFormClose`) in
   * `@object-ui/plugin-designer`.
   */
  onOpenChange?: (open: boolean) => void;
  
  /**
   * Drawer slide-in side. Only used when formType is 'drawer'.
   * @default 'right'
   */
  drawerSide?: 'top' | 'bottom' | 'left' | 'right';
  
  /**
   * Drawer width (CSS value). Only used when formType is 'drawer'.
   * @default '50%'
   */
  drawerWidth?: string;

  // ─── Modal Form Props ──────────────────────────────────
  
  /**
   * Modal dialog size. Only used when formType is 'modal'.
   * @default 'default'
   */
  modalSize?: 'sm' | 'default' | 'lg' | 'xl' | 'full';
  
  /**
   * Whether to show a close button in the modal header. Only used when formType is 'modal'.
   * @default true
   */
  modalCloseButton?: boolean;

  // ─── Mobile UX (round 3) ────────────────────────────────

  /**
   * Mobile-specific form behavior. All options are opt-in; on desktop the
   * form renders unchanged. `auto` values activate only when the viewport
   * matches `(max-width: 767px)`.
   *
   * @example
   * ```ts
   * mobile: {
   *   stickyActions: true,        // pin Submit/Cancel to the bottom of the viewport
   *   stepper: 'auto',            // long forms render one field at a time on phones
   *   stepperMinFields: 8,        // … but only past this many fields
   *   fullscreenLongText: true,   // textarea/rich-text get an "expand" button
   * }
   * ```
   */
  mobile?: {
    /** Render Submit/Cancel as a sticky bottom action bar on mobile. */
    stickyActions?: boolean;
    /**
     * One-field-at-a-time stepper on small screens.
     * - `false` (default): never use the stepper.
     * - `true`: always use it on mobile.
     * - `'auto'`: only when the form has > `stepperMinFields` fields.
     */
    stepper?: boolean | 'auto';
    /** Threshold for `stepper: 'auto'`. @default 8 */
    stepperMinFields?: number;
    /** How many fields to show per step when stepper is active. @default 1 */
    stepperFieldsPerStep?: number;
    /** Show a fullscreen-edit affordance for textarea / rich-text fields. */
    fullscreenLongText?: boolean;
  };
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-form` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its refusal
   * names `children` as the remedy, which this node does not read either. The
   * member is restated here so both faces point at what the node renders
   * instead.
   *
   * @deprecated Not a channel `object-form` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-form` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep: no `body` /
   * `children` read is filed under this declaration, while the same instrument
   * does see it as the receiver of the keys the renderer reads. The
   * registration hop, `ObjectFormRenderer` (`packages/plugin-form`), is
   * `any`-typed and hands the node to `ObjectForm`, which reads it as this
   * type. `SchemaRenderer` strips both keys out of the props bag it spreads,
   * so neither reaches the component by another route, and the registration
   * declares no `children` slot (objectui#9910).
   *
   * The `form` node `ObjectForm` renders DOES draw `children`, and that is
   * exactly why this was checked rather than assumed: every `form` node the
   * package builds is assembled key by key, and none copies this node's own
   * channels into it.
   *
   * What it renders instead: a form over `objectName` built from `fields` /
   * `sections` / `customFields`, in the `mode` and `formType` declared here.
   *
   * @deprecated Not a channel `object-form` reads — nothing renders it.
   */
  children?: never;
}

/**
 * The `ObjectGridSchema` keys a view's `table` slot carries: the members
 * `ObjectView` hands the grid it draws, and nothing else (objectui#10976). The
 * count is not written here — `src/__tests__/object-view-slot-key-lists.test.ts`
 * re-derives it through the checker (AGENTS.md #9).
 *
 * The list is three groups:
 *
 *   - the keys `ObjectView` reads off `table` BY NAME when it builds the grid
 *     node: `columns` / `fields`, `filter`, `sort`, `pagination` / `pageSize`,
 *     `selection` / `selectable`, `operations`, `title` and `className`. The
 *     slot still declares `defaultFilters`, typed by the `object-grid` row's
 *     retired-key tombstone, and nothing reads it (objectui#12030);
 *   - the keys it RELAYS verbatim, `OBJECT_VIEW_TABLE_RELAY_KEYS` in
 *     `@object-ui/plugin-view`'s `ObjectView.tsx` — each one a key
 *     `ObjectGrid` reads, so a value written here reaches a read. Where the
 *     active named view declares the same member, the named view wins;
 *   - three of the retirement tombstones `ObjectGridSchema` declares (`body`,
 *     `children`, `defaultSort`, each `?: never`). They type nothing: they keep
 *     the named refusal, and its guidance, on this face too. The five the grid
 *     retired later (`name`, `placeholder`, `rowSpecActions`,
 *     `bulkSpecActions`, `showFilters`, objectui#11068) are withheld instead,
 *     below — the slot refuses each of them by name either way.
 *
 * ⛔ Every other `ObjectGridSchema` member is WITHHELD, because on the view's
 * grid it reached nothing: `ObjectGrid` has no read of it (the five
 * tombstones just named); `ObjectGrid` reads it on its own node but the view
 * does not hand it on (`emptyState`, `description` — honoured by the grid
 * since objectui#11068, and kept off this slot by that card's ruling, which
 * enforced them without widening it — and `keyboardNavigation`, read since
 * that card's build; a view's grid takes the key's default, on exactly when
 * it renders editable);
 * the view owns it (the record source
 * `data` / `staticData` / `bind`, and since objectui#11070 the binding
 * `dataSource`; the row click `navigation` / `onNavigate`;
 * the grid's `id`); the view draws the grid as a component rather than a
 * schema node, so the node-level `BaseSchema` keys have no renderer to apply
 * them (`style`, `testId`, `ariaLabel`, `hidden` / `hiddenOn`,
 * `visible` / `visibleOn` / `visibleWhen`, `disabled` / `disabledOn`); or it
 * is the legacy alias of a relayed key (`batchActions` for `bulkActions`,
 * `resizableColumns` for `resizable`). Before objectui#10976 the slot typed
 * all of them, so `table: { emptyState: … }` type-checked and did nothing.
 * The zod twin (`zod/objectql.zod.ts`, `ObjectViewSchema.table`) refuses each
 * withheld key by name, and the pin below holds the two faces to one list.
 *
 * ⚠️ This is an explicit list, and NOT an `Omit` of `ObjectGridSchema`,
 * because `Omit` collapsed here (objectui#6269). `Omit<T, K>` is
 * `Pick<T, Exclude<keyof T, K>>`, and `keyof T` on a type carrying a string
 * index signature is `string | number` — the literal member names are ABSORBED.
 * `ObjectGridSchema` inherited `BaseSchema`'s `[key: string]: any`
 * (objectui#5155) until objectui#8347, so the `Omit` rebuilt a type holding the index signature and
 * none of the named members: measured through the checker at objectui#6269,
 * `Omit<ObjectGridSchema, 'type' | 'objectName'>` declared 0 properties. The
 * slot accepted anything (`table: { colunms: 3 }` type-checked), offered no
 * editor completion, and the doc comment promised an inheritance it did not
 * deliver. `Pick` with LITERAL keys never computes `keyof T`, so it cannot
 * collapse the same way.
 *
 * 🔒 The duplicate-list hazard — a member added to `ObjectGridSchema` and
 * placed in neither this list nor the withheld set — is pinned by
 * `src/__tests__/object-view-slot-key-lists.test.ts`, which recomputes the
 * source schema's declared members through the TypeScript checker and requires
 * this list to equal them minus the identity keys and minus its withheld set.
 * A new grid member therefore turns it red until it is relayed (here and in
 * `OBJECT_VIEW_TABLE_RELAY_KEYS`) or withheld (there and on the zod twin).
 *
 * 🗑️ objectui#8347 removed `BaseSchema`'s root index signature (the #5155 phase
 * this waited for), so `Omit` no longer collapses here, and this list may be
 * spelled as an `Omit` of the identity keys and the withheld set. The pin stays: what it guards now is that every
 * grid member is classified, which an `Omit` does not do by itself.
 */
type ObjectGridSlotKey =
  | 'aggregations'
  | 'body'
  | 'bulkActionDefs'
  | 'bulkActions'
  | 'children'
  | 'className'
  | 'columns'
  | 'conditionalFormatting'
  | 'defaultFilters'
  | 'defaultSort'
  | 'editable'
  | 'exportOptions'
  | 'fields'
  | 'filter'
  | 'frozenColumns'
  | 'grouping'
  | 'label'
  | 'operations'
  | 'pageSize'
  | 'pagination'
  | 'reorderableColumns'
  | 'resizable'
  | 'rowActions'
  | 'rowColor'
  | 'rowHeight'
  | 'searchableFields'
  | 'selectable'
  | 'selection'
  | 'showColumnTypeIcons'
  | 'showPagination'
  | 'showSearch'
  | 'singleClickEdit'
  | 'sort'
  | 'title';

/**
 * The `ObjectFormSchema` keys a view's `form` slot may carry: every member
 * `ObjectFormSchema` declares, minus the identity keys the view itself fixes
 * (`type`, `objectName`, `mode`). The count is not written here —
 * `src/__tests__/object-view-slot-key-lists.test.ts` re-derives it (AGENTS.md
 * #9).
 *
 * Same `Omit` collapse and same pin as `ObjectGridSlotKey` above — see its
 * comment. Unlike that list, this one withholds nothing but the identity keys,
 * so its removal condition is the original one, and objectui#8347 met it by
 * removing `BaseSchema`'s root index signature (the #5155 phase it waited for):
 * this list and its half of the pin are removable in favour of
 * `Omit<ObjectFormSchema, 'type' | 'objectName' | 'mode'>`.
 * Measured before the objectui#6269 fix: that `Omit` declared 0 of
 * `ObjectFormSchema`'s 67 members.
 */
type ObjectFormSlotKey =
  | 'allowSkip'
  | 'ariaLabel'
  | 'bind'
  | 'body'
  | 'buttons'
  | 'cancelText'
  | 'children'
  | 'className'
  | 'columns'
  | 'customFields'
  | 'data'
  // objectui#11070 — joins with `ObjectFormSchema.dataSource`. This slot
  // withholds nothing but the identity keys (above), so it carries the binding
  // as it carries `bind` and `data`; `ObjectView` relays neither to its form.
  | 'dataSource'
  | 'defaultTab'
  | 'defaults'
  | 'description'
  | 'disabled'
  | 'disabledOn'
  | 'drawerSide'
  | 'drawerWidth'
  | 'fields'
  | 'formType'
  | 'groups'
  | 'hidden'
  | 'hiddenOn'
  | 'id'
  | 'initialData'
  | 'initialValues'
  | 'label'
  | 'layout'
  | 'mobile'
  | 'modalCloseButton'
  | 'modalSize'
  | 'name'
  | 'navigateOnSuccess'
  | 'nextText'
  | 'onCancel'
  | 'onError'
  | 'onOpenChange'
  | 'onStepChange'
  | 'onSuccess'
  | 'open'
  | 'placeholder'
  | 'prevText'
  | 'readOnly'
  | 'recordId'
  | 'resetOnSuccess'
  | 'sections'
  | 'showCancel'
  | 'showReset'
  | 'showStepIndicator'
  | 'showSubmit'
  | 'splitDirection'
  | 'splitResizable'
  | 'splitSize'
  | 'style'
  | 'subforms'
  | 'submitBehavior'
  | 'submitHandler'
  | 'submitText'
  | 'successMessage'
  | 'tabPosition'
  | 'testId'
  | 'title'
  | 'visible'
  | 'visibleOn'
  | 'visibleWhen';

/**
 * ObjectView Schema
 * A complete object management interface combining ObjectGrid and ObjectForm.
 * Provides list view with search, filters, and integrated create/edit dialogs.
 */
export interface ObjectViewSchema extends BaseSchema {
  type: 'object-view';
  
  /**
   * ObjectQL object name (e.g., 'users', 'accounts', 'contacts')
   */
  objectName: string;
  
  /**
   * Optional title for the view
   */
  title?: string;
  
  /**
   * Optional description
   */
  description?: string;
  
  /**
   * Layout mode for create/edit operations
   * - drawer: Side drawer (default, recommended for forms)
   * - modal: Center modal dialog
   * - page: Navigate to separate page (requires onNavigate handler)
   * @default 'drawer'
   */
  layout?: 'drawer' | 'modal' | 'page';
  
  /**
   * Default list view type
   * @default 'grid'
   */
  defaultViewType?: 'grid' | 'kanban' | 'gallery' | 'calendar' | 'timeline' | 'gantt' | 'map';
  
  /**
   * Named list views (e.g., "All Records", "My Records", "Active").
   *
   * The protocol's own slot BY REFERENCE (objectui#7928, ruling A): the value is
   * `@objectstack/spec/ui`'s `ObjectListViewSchema`, the value type of
   * `ViewSchema.listViews`. A named view therefore needs `columns`, takes
   * `filter` as `{ field, operator, value }` rules and declares each view kind's
   * config in the top-level block of that kind (`kanban`, `calendar`, …).
   * ⛔ The legacy `options` bag is not a member: a stored body that carries one
   * is folded onto the top-level blocks by `@object-ui/app-shell`'s
   * `ViewPreview` before it reaches this record. `NamedListView` is no longer
   * this member's type, and its retirement follows objectui#7924.
   */
  listViews?: Record<string, z.input<typeof SpecObjectListViewSchema>>;
  
  /**
   * Default named list view to display
   */
  defaultListView?: string;
  
  /**
   * Navigation config for row/item click behavior.
   * Aligned with @objectstack/spec ListView.navigation.
   */
  navigation?: ViewNavigationConfig;
  
  /**
   * Table/Grid configuration.
   *
   * The `ObjectGridSchema` members this view hands the grid it draws — the
   * keys it reads off `table` by name and the ones it relays verbatim — and no
   * other (objectui#10976). A grid member the view does not honour is withheld,
   * so writing it here is a type error rather than a silent no-op. See
   * `ObjectGridSlotKey` for the three groups, the withheld set, and why the
   * key list is spelled out instead of `Omit`-ed (objectui#6269).
   */
  table?: Partial<Pick<ObjectGridSchema, ObjectGridSlotKey>>;
  
  /**
   * Form configuration.
   *
   * Every `ObjectFormSchema` member except the identity keys this view already
   * fixes (`type`, `objectName`, `mode`) — see `ObjectFormSlotKey` for why the
   * key list is spelled out instead of `Omit`-ed (objectui#6269).
   */
  form?: Partial<Pick<ObjectFormSchema, ObjectFormSlotKey>>;
  
  /**
   * Fields that support text search
   */
  searchableFields?: string[];
  
  /**
   * RETIRED (objectui#13118) — the Filter panel's per-view field whitelist.
   * `@objectstack/spec` retires the list view's `filterableFields` in 18.0
   * (objectstack#24640, maintainer ruling C), and no per-view whitelist
   * replaces it: the Filter panel offers every field the user may read, minus
   * the fields the object marks `hidden: true`. Nothing in objectui reads the
   * key, on this node or on a named view.
   *
   * Typed BY REFERENCE to the list view's spec-derived slot, ⛔ not as a local
   * `?: never` tombstone yet: the Zod twin is the spec's own slot by reference
   * (`zod/objectql.zod.ts`), and this package's spec pin predates the
   * retirement, so a local tombstone would make the two faces disagree on the
   * `object-view` arm — the drift `node-recursion-point-8344.test.ts` refuses
   * to ledger. Both faces read the same slot, so the pin bump that takes the
   * retirement carries the spec's `retiredKey()` tombstone onto both at once,
   * and the key is refused by name from then on.
   *
   * @deprecated RETIRED (objectui#13118) — delete the key. For a curated
   * end-user filter bar, author `userFilters` on the named list view.
   */
  filterableFields?: ListViewSchema['filterableFields'];
  
  /**
   * Show search box
   * @default true
   */
  showSearch?: boolean;
  
  /**
   * Show filters
   * @default true
   */
  showFilters?: boolean;
  
  /**
   * Show sort controls
   * @default true
   */
  showSort?: boolean;
  
  /**
   * Show create button
   * @default true
   */
  showCreate?: boolean;
  
  /**
   * Show refresh button
   * @default true
   */
  showRefresh?: boolean;
  
  /**
   * Show view switcher (for multi-view)
   * When false (default), view type is fixed at creation in ViewConfigPanel
   * @default false
   */
  showViewSwitcher?: boolean;
  
  /**
   * Enable/disable built-in operations
   */
  operations?: {
    create?: boolean;
    read?: boolean;
    update?: boolean;
    delete?: boolean;
  };
  
  /**
   * Callback when navigating to detail page (page layout mode)
   *
   * RUNTIME SLOT (objectui#6124, declared by `8d50bc2bf`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is READ and RUN by the registered renderer.
   * The read: `plugin-view`'s `ObjectView` invokes it at four sites —
   * `schema.onNavigate('new', 'edit')` on create, and the record id with
   * `'edit'` / `'view'` on the other three. Supplied by
   * `@object-ui/app-shell`'s `ObjectView`, which builds the `object-view` node
   * in TypeScript and puts `onNavigate: (recordId, mode) => …` on it.
   *
   * ⚠️ Shares a key NAME with `ObjectGridSchema.onNavigate` and nothing else:
   * different second parameter, different supplier, judged separately.
   */
  onNavigate?: (recordId: string | number, mode: 'view' | 'edit') => void;
  
  /**
   * Custom CSS class
   */
  className?: string;

  /**
   * RETIRED (objectui#7779) — the tab-bar config key this node's renderer never
   * read. `packages/plugin-view/src/ObjectView.tsx` reads `schema.objectName`,
   * `schema.layout`, `schema.defaultViewType`, `schema.allowCreateView` and
   * `schema.viewActions` off the node and `schema.viewTabBar` never; the
   * repo-wide census (2026-09-06, on `6a9ee323`) finds the key in no source
   * file outside this package — only in two doc tables that listed it as
   * authorable. The tab-bar UX config ({@link ViewTabBarConfig}, still
   * exported) is the `config` PROP of the `ViewTabBar` component, composed by
   * the host (`@object-ui/app-shell`), not authored metadata: `plugin-view`'s
   * own `ObjectView` renders no tab bar at all (ADR-0053 — the host owns the
   * switcher). The 2026-07 audit
   * (`docs/audits/2026-07-objectview-detailview-schema.md`) had measured it
   * "dead since introduction". Maintainer ruling B on objectui#7779
   * (2026-09-06): a key nothing reads is retired, not mirrored.
   *
   * `?: never` is this package's tombstone convention (see
   * `ObjectKanbanSchema.groupField`, objectui#7322), and it is load-bearing
   * rather than decorative: {@link BaseSchema} carried `[key: string]: any`
   * until objectui#8347, and a deletion is still refused only on a fresh
   * literal, so DELETING this member would let the retired spelling type-check
   * green through a widened value and go on doing nothing. Keeping the key declared as `never` is what makes
   * the retirement audible at the authoring boundary. Lockstep with the Zod
   * twin (`zod/objectql.zod.ts`, `retirementTombstone()`): both halves or
   * neither. Absent stays valid on both, so a node that never wrote the key is
   * untouched.
   *
   * @deprecated RETIRED (objectui#7779) — remove the key; pass `config` to
   * `ViewTabBar` from the host instead.
   */
  viewTabBar?: never;

  /**
   * Show "+" button in ViewSwitcher to create a new view.
   * Typically gated on admin permission.
   */
  allowCreateView?: boolean;

  /**
   * Per-view action icons shown in ViewSwitcher (e.g., share, settings, duplicate, delete).
   */
  viewActions?: Array<{
    type: 'share' | 'settings' | 'duplicate' | 'delete';
    icon?: string;
  }>;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-view` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its refusal
   * names `children` as the remedy, which this node does not read either. The
   * member is restated here so both faces point at what the node renders
   * instead.
   *
   * @deprecated Not a channel `object-view` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-view` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep: no `body` /
   * `children` read is filed under this declaration, while the same instrument
   * does see it as the receiver of the keys the renderer reads. The
   * registration hop, `ObjectViewRenderer` (`packages/plugin-view`), is
   * `any`-typed and hands the node to `ObjectView`, which reads it as this
   * type. `SchemaRenderer` strips both keys out of the props bag it spreads,
   * so neither reaches the component by another route, and the registration
   * declares no `children` slot (objectui#9910).
   *
   * It delegates each sub-view to a node it assembles from named keys, never
   * by spreading this node, and every type it can generate — `object-kanban`,
   * `object-calendar`, `object-gallery`, `object-timeline`, `object-gantt`,
   * `object-map`, `object-tree`, `object-chart` — reads neither channel
   * either.
   *
   * What it renders instead: the object's views — `listViews`,
   * `defaultViewType`, `table`, `form` — under its own toolbar.
   *
   * @deprecated Not a channel `object-view` reads — nothing renders it.
   */
  children?: never;
}

/**
 * View Tab Bar Configuration
 * Controls the UX of the view tab bar (inline add, context menu, overflow, indicators).
 */
export interface ViewTabBarConfig {
  /** Show inline "+" button to create new views @default true */
  showAddButton?: boolean;
  /** Allow inline renaming by double-clicking tab @default true */
  inlineRename?: boolean;
  /** Show context menu on right-click @default true */
  contextMenu?: boolean;
  /** Allow drag-reorder of view tabs @default false */
  reorderable?: boolean;
  /**
   * An optional CAP on the visible tabs. How many show is derived from the
   * strip's width; this caps that count, and the rest fold into the "More"
   * dropdown either way. No default: unset, the width alone decides
   * (objectui#12423).
   */
  maxVisibleTabs?: number;
  /**
   * @deprecated Draws nothing since objectui#12423: the tab bar no longer
   * marks a view's filter or sort (the toolbar's Filter and Sort counts say
   * it for the open view). Kept so an existing caller still compiles.
   */
  showIndicators?: boolean;
  /** Show "Save as View" when filters differ from saved @default true */
  showSaveAsView?: boolean;
  /** Show pinned views section @default true */
  showPinnedSection?: boolean;
  /** Group tabs by personal/shared @default false */
  showVisibilityGroups?: boolean;
}

/**
 * Named List View Definition — objectui's own hand-written named-view shape.
 *
 * No member of this package's contract is typed by it: since objectui#7928,
 * `ObjectViewSchema.listViews` is the protocol's `ObjectListViewSchema` by
 * reference (see that member), and the pins
 * `_ListViewsIsNoLongerTheLocalRecord` / `_ListViewsIsTheSpecRecord` in
 * `__tests__/object-view-unmirrored-keys-7779.test.ts` hold that. It stays
 * exported from `@object-ui/types`; whether it is retired or narrowed follows
 * objectui#7924.
 */
export interface NamedListView {
  /** View display label */
  label: string;
  
  /** View type (grid, kanban, etc.) */
  type?: 'grid' | 'kanban' | 'gallery' | 'calendar' | 'timeline' | 'gantt' | 'map';
  
  /** Columns/fields to display */
  columns?: string[];
  
  /** Filter conditions */
  filter?: any[];
  
  /** Sort configuration */
  sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
  
  /** Type-specific options (kanban groupField, calendar startDateField, etc.) */
  options?: Record<string, any>;

  /* ── objectui#7924 — RETIRED on the authoring face (director-seat ruling,
   * bucket ② A and bucket ③) ────────────────────────────────────────────────
   *
   * Each member below is a `?: never` tombstone: a TypeScript author who writes
   * it fails to compile, and the message points at the canonical key. The
   * member is KEPT rather than deleted so the refusal is BY NAME — a deleted
   * member would fall through to nothing and read as a generic excess-property
   * error with no pointer.
   *
   * ⚠️ Only the AUTHORING face changes. Stored view documents that still carry
   * a legacy spelling keep parsing: `normalizeListViewSchema`
   * (`@object-ui/core`) folds the eight `show*` spellings onto `userActions` /
   * `appearance` at runtime, and that fold stays until the next major cleanup.
   * Hosts that read a stored view through a loose type are unaffected.
   *
   * ⛔ No alias mapping is created for any of them. The census that partitions
   * every member of this interface — and asserts which ones are tombstones — is
   * `__tests__/object-view-unmirrored-keys-7779.test.ts`.
   */

  /** @deprecated RETIRED (objectui#7924) — author `userActions.search` instead. Not a protocol key on a view. */
  showSearch?: never;

  /** @deprecated RETIRED (objectui#7924) — author `userActions.sort` instead. Not a protocol key on a view. */
  showSort?: never;

  /** @deprecated RETIRED (objectui#7924) — author `userActions.filter` instead. Not a protocol key on a view. */
  showFilters?: never;

  /** @deprecated RETIRED (objectui#7924) — author `userActions.hideFields` instead. Not a protocol key on a view. */
  showHideFields?: never;

  /** @deprecated RETIRED (objectui#7924) — author `userActions.group` instead. Not a protocol key on a view. */
  showGroup?: never;

  /** @deprecated RETIRED (objectui#7924) — author `userActions.rowColor` instead. Not a protocol key on a view. */
  showColor?: never;

  /** @deprecated RETIRED (objectui#7924) — author `userActions.rowHeight` instead. Not a protocol key on a view. */
  showDensity?: never;

  /**
   * Collapse the toolbar's settings into the single "Display" popover: the
   * bar keeps Filter, Sort, Display and Search, and Display carries the
   * layout switcher, Group, Color, Hide fields, Density, Row numbers, Edit
   * inline, Refresh and Export. On unless a view writes `false`, which keeps
   * one toolbar button per control (objectui#12423).
   * @default true
   */
  compactToolbar?: boolean;

  /**
   * @deprecated RETIRED (objectui#11013) — the protocol declares no
   * `allowExport` on a view, and no relay reads it off one any more. Whether a
   * list offers export is the host's call, made on the `list-view` node
   * (`ListView` gates its export control on that node's
   * `schema.allowExport !== false`); which formats a view offers is its
   * `exportOptions.formats`.
   *
   * Kept declared by ruling A on objectui#7924 while both relays of a view read
   * it into the `list-view` node. objectui#11013 (ruling 甲 on
   * objectstack#20051, and the seat's disposition on objectstack#20456: no
   * producer, no declared spelling) removed both reads, since no console
   * surface writes the key onto a view and the spec's view schema refuses it by
   * name. Tombstoned rather than deleted so the refusal is by name.
   */
  allowExport?: never;

  /**
   * @deprecated RETIRED (objectui#7924) — the protocol declares no `color` on a
   * view. The likely intent is the row-colour CONFIGURATION `rowColor`
   * (`{ field }`, declared below). ⚠️ Not `userActions.rowColor`: that is the
   * boolean toggle for the toolbar's colour panel.
   */
  color?: never;

  /** Enable inline editing @default false */
  inlineEdit?: boolean;

  /** @deprecated RETIRED (objectui#7924) — the protocol declares no `wrapHeaders` on a view, and no renderer acts on it. */
  wrapHeaders?: never;

  /** @deprecated RETIRED (objectui#7924) — the protocol declares no `clickIntoRecordDetails`; row-click behaviour is `navigation`. */
  clickIntoRecordDetails?: never;

  /** @deprecated RETIRED (objectui#7924) — the protocol declares no `addRecordViaForm`; the likely intent is the `userActions.addRecordForm` toggle (with `addRecord` configuring creation). */
  addRecordViaForm?: never;

  /** @deprecated RETIRED (objectui#7924) — the protocol declares no `addDeleteRecordsInline`, and no renderer acts on it. */
  addDeleteRecordsInline?: never;

  /** @deprecated RETIRED (objectui#7924) — the protocol declares no `collapseAllByDefault`, and no renderer acts on it. */
  collapseAllByDefault?: never;

  /** @deprecated RETIRED (objectui#7924) — the protocol declares no `fieldTextColor`, and no renderer acts on it. */
  fieldTextColor?: never;

  /** @deprecated RETIRED (objectui#7924) — the protocol declares no `prefixField`, and no renderer acts on it. */
  prefixField?: never;

  /** View description */
  description?: string;

  /** @deprecated RETIRED (objectui#7924) — author `appearance.showDescription` instead. Not a protocol key on a view. */
  showDescription?: never;

  /** Navigation configuration for row click behavior */
  navigation?: ViewNavigationConfig;

  /** Row selection mode */
  selection?: SelectionConfig;

  /** Pagination configuration */
  pagination?: PaginationConfig;

  /** Fields that support text search */
  searchableFields?: string[];

  /**
   * @deprecated RETIRED (objectui#13118) — `@objectstack/spec` retires it in
   * 18.0 (objectstack#24640, ruling C), and no per-view Filter-panel whitelist
   * replaces it: delete the key, and for a curated end-user filter bar author
   * `userFilters`. The Filter panel offers every field the user may read,
   * minus the fields the object marks `hidden: true`.
   */
  filterableFields?: never;

  /** Allow column resizing @default false */
  resizable?: boolean;

  /**
   * @deprecated RETIRED (objectui#7924) — author top-level `rowHeight` instead.
   * Not a protocol key on a view: the protocol's name for row density is
   * `rowHeight`, and `densityMode` was objectui's legacy spelling of it.
   * ⚠️ Not `userActions.rowHeight`: that is the boolean toggle for the
   * toolbar's density control. A stored view that still carries this key keeps
   * rendering: `normalizeListViewSchema` (`@object-ui/core`) folds it onto
   * `rowHeight` through `DENSITY_MODE_TO_ROW_HEIGHT`, and both relays of a
   * named view read the density through that fold rather than by this name.
   */
  densityMode?: never;

  /**
   * Row height for list/grid view rows.
   * Aligned with @objectstack/spec RowHeight enum.
   */
  rowHeight?: 'compact' | 'short' | 'medium' | 'tall' | 'extra_tall';

  /** Fields to hide from the current view */
  hiddenFields?: string[];

  /**
   * Export options configuration — the same object form the grid reads, so a
   * saved view and a directly-authored grid cannot declare different export
   * surfaces (objectui#4535). See {@link ListViewExportOptions}.
   */
  exportOptions?: ListViewExportOptions;

  /** Row action identifiers */
  rowActions?: string[];

  /** Bulk action identifiers */
  bulkActions?: string[];

  /** Rich bulk action definitions — see BulkActionDef. */
  bulkActionDefs?: BulkActionDef[];

  /** View sharing configuration */
  sharing?: {
    visibility?: 'private' | 'team' | 'organization' | 'public';
    enabled?: boolean;
  };

  /** Add record configuration */
  addRecord?: {
    enabled?: boolean;
    position?: string;
    mode?: string;
    formView?: string;
  };

  /** Conditional formatting rules — `{ condition, style }` only since objectui#11533
   * (see {@link ConditionalFormattingRule}); the native rule dialect is refused by name. */
  conditionalFormatting?: ConditionalFormattingRule[];

  /**
   * User Filters Configuration (Airtable Interfaces-style).
   * Reuses the ListViewSchema.userFilters type to keep both definitions in parity.
   *
   * Supports three display modes configured by `element`:
   * - 'dropdown': Each field renders as a dropdown selector badge
   * - 'tabs': Named filter presets rendered as a tab bar
   */
  userFilters?: ListViewSchema['userFilters'];

  /** Show total record count @default false */
  showRecordCount?: boolean;

  /** Allow printing the view @default false */
  allowPrinting?: boolean;

  /**
   * Empty state configuration — the type of {@link ListViewSchema}'s own
   * `emptyState`, indexed rather than restated, as the objectui#8980 members
   * below are (objectui#11227). That member is the protocol's `EmptyStateSchema`
   * by reference, so `title` and `message` are `I18nLabel` — a plain string or
   * an inline locale map — and `ListView`, which this view is forwarded into,
   * resolves each against the display locale. This member said plain `string`
   * until then, narrower than the protocol on both.
   */
  emptyState?: ListViewSchema['emptyState'];

  /** ARIA attributes for accessibility */
  aria?: {
    label?: string;
    describedBy?: string;
    live?: 'polite' | 'assertive' | 'off';
  };

  /* ── objectui#8980 — the SEVENTEEN members the protocol declares on this very
   * surface and this interface did not ───────────────────────────────────────
   *
   * Director-seat class-one adjudication of 2026-09-13 (objectui#8980), under
   * the maintainer's standing principle — quoted verbatim, deliberately
   * untranslated, because a translated ruling is a second ruling:
   *
   *   「我们的项目以 objectstack 协议为准，文档应该以实际实现为准。协议不正确的应该先修改协议。」
   *
   * The value type of an entry in `ViewSchema.listViews` / `ObjectSchema.listViews`
   * is the protocol's `ObjectListViewSchema` (`@objectstack/spec/ui`, built from
   * `ListViewShapeSchema`). Re-measured on this tree against the resolved
   * `@objectstack/spec@17.4.0`: that shape carries 50 keys, 22 of which this
   * interface did not declare, 5 of those 22 being the protocol's own
   * `retiredKey()` tombstones (`bordered` `performance` `responsive` `striped`
   * `virtualScroll` — each refuses a plausible value with a message naming the
   * 17.0.0 removal). 22 − 5 = the seventeen below. objectui was NARROWER than
   * the protocol on every one of them, which is the direction the principle
   * forbids; the remedy is to catch up, ⛔ not to declare-and-ignore (ADR-0049),
   * so each member here has a READ POINT landing in the same change.
   *
   * ⭐ TYPES ARE TAKEN FROM THE PROTOCOL, ⛔ never restated. Sixteen of the
   * seventeen index {@link ListViewSchema} — this package's own spec-derived
   * `list-view` node type, whose members arrive from `SpecListViewSchema.shape`
   * by reference (`zod/objectql.zod.ts`, `specFieldsExcept`). That is the
   * derivation this interface already uses one member up (`userFilters`), and
   * it buys a second property the relay needs: `ObjectView` forwards a named
   * view INTO a `list-view` node, so the two faces are provably the same type
   * for every key that crosses. `name` is the exception and says so on its own
   * line.
   *
   * ⚠️ WHAT IS NOT CLAIMED HERE. Declaring a key is not the same as the renderer
   * having behaviour to attach to it. Three of the seventeen are reported with
   * their measurement on objectui#8980 rather than wired, exactly as the
   * ruling's item 2 requires — `tabs` and `pageName` have no reader on this
   * surface at all, and `chart` / `tree` are read but only reachable through a
   * host `views` prop (objectui#5321). ⛔ None of them may be dropped from the
   * type on that basis: the report is the evidence a protocol card would need.
   *
   * The 19 legacy spellings this interface declared BEYOND the protocol were
   * objectui#7924's remedy (ruling item 4) — ⛔ not touched by that card. It
   * retired seventeen of them as tombstones, `densityMode` last (ruling A′,
   * once both of its relays read through the fold). `allowExport` stayed
   * declared because it was read, until objectui#11013 removed both reads and
   * retired it as the eighteenth; `options` stays declared (objectui#7928,
   * Q2 (i)).
   */

  /**
   * Internal view name (lowercase snake_case) — the protocol's own identity for
   * this view, distinct from the record KEY it is filed under in `listViews`.
   *
   * ⭐ THE ONE MEMBER NOT DERIVED FROM {@link ListViewSchema}, and the reason is
   * a measurement: `name` sits in that mirror's `LIST_VIEW_LOCAL_OVERRIDES`, so
   * on the `list-view` node it resolves through `BaseSchema.name` — the
   * COMPONENT name slot, a different contract that happens to share a spelling.
   * Indexing the protocol's own published authored type keeps this member
   * tracking `SnakeCaseIdentifierSchema` rather than that neighbour.
   *
   * `ListView` rather than the object-scoped `ObjectListView`: the protocol
   * publishes a TS type for the first and not the second, and the two shapes
   * differ ONLY in `userFilters` (`ObjectListViewSchema` omits and re-extends
   * that one key). `name` is the same declaration on both, straight off
   * `ListViewShapeSchema`.
   *
   * LIVE, and written by a producer today: `@object-ui/app-shell`'s
   * `mergeViewsIntoObjects` stamps `name: key` onto every composed `listViews`
   * entry (`applyViewItem`), and its primary-view promotion matches on it — so
   * this key has been travelling on this surface undeclared.
   */
  name?: SpecListView['name'];

  /**
   * Data source configuration (defaults to the `object` provider).
   *
   * objectui#7928's open half, answered by ruling item 2: DECLARE it. The
   * renderer already read this key off a named view through an `as any` cast on
   * the named-view config; that cast is gone in the same change, so the read and
   * the declaration are now one fact.
   */
  data?: ListViewSchema['data'];

  /** Explicit field display order — the live third key of the protocol's
   * `columns` × `hiddenFields` × `fieldOrder` composition (objectstack#15184
   * ruling B, 2026-09-11: `columns` projects, `hiddenFields` subtracts,
   * `fieldOrder` orders what survives). `ListView` reads it. */
  fieldOrder?: ListViewSchema['fieldOrder'];

  /** Grouping configuration. Read by `ListView` and by `ObjectGrid`. */
  grouping?: ListViewSchema['grouping'];

  /** Row colouring configuration — the spec-canonical form of the legacy bare
   * `color` shorthand two dozen lines up. Read by `ListView` and `ObjectGrid`. */
  rowColor?: ListViewSchema['rowColor'];

  /** User action toggles for the view toolbar — the protocol's canonical home
   * for seven of the eight legacy `show*` spellings, which objectui#7924
   * retired to `?: never` tombstones above (`showDescription`, the eighth, is
   * `appearance.showDescription`). */
  userActions?: ListViewSchema['userActions'];

  /** Appearance and visualization configuration (`showDescription`,
   * `allowedVisualizations`). Read by `ListView`. */
  appearance?: ListViewSchema['appearance'];

  /**
   * @deprecated RETIRED (objectui#11073) — the protocol removed the list view's
   * own `tabs` in `@objectstack/spec` 17.5.0 (ADR-0049 enforce-or-remove): no
   * renderer ever mounted a tab bar for it. Move each tab to a named view under
   * the object's `listViews` (the tab's `name` becomes the entry's key, its
   * `label` the entry's `label`, its `filter` joins that entry's `filter`);
   * every `listViews` entry renders as a tab in the saved-view switcher.
   *
   * Declared until then as a protocol member objectui read nowhere (objectui#8980,
   * "declared inert"); the seat's Q4 ruling on objectui#11073 retired it here
   * once its premise, "the protocol declares it", was falsified.
   */
  tabs?: never;

  /**
   * @deprecated RETIRED (objectui#11073) — the protocol removed `pageName` with
   * `type: 'page'` in `@objectstack/spec` 17.5.0 (ADR-0049 enforce-or-remove):
   * the page mount was never built. To put a published page in front of users,
   * give the app a navigation item with `type: 'page'` and its `pageName` — a
   * different key on a different surface.
   *
   * Declared until then as a protocol member objectui read nowhere (objectui#8980,
   * "declared inert"); the seat's Q4 ruling on objectui#11073 retired it here
   * once its premise, "the protocol declares it", was falsified.
   */
  pageName?: never;

  /* ── The eight view-KIND configuration blocks ──────────────────────────────
   * The protocol carries each at the TOP LEVEL of a list view. objectui read
   * them only out of the legacy untyped `options` bag
   * (`options.kanban`, `options.calendar`, …), which is why none of the eight
   * was declared. `ObjectView.generateViewSchema` now resolves the canonical
   * top-level block first and merges the legacy nesting under it, so both
   * spellings work and the declared one wins key-by-key; each block reaches the
   * renderer `ObjectView` already dispatches to for that `type`.
   *
   * The four with local refusals (`kanban` `calendar` `gallery` `timeline`)
   * index this package's mirror deliberately: since objectui#6152 round 11 each is
   * the spec's own list-view slot by reference, strict, `.partial()` on `kanban`
   * and `timeline` only, with the pre-#2231 aliases (`groupField`, `cardFields`,
   * `imageField`, `dateField`) and the list-view `calendar.defaultView` refused by
   * name. `gantt` `map` `chart` `tree` arrive in that mirror straight from
   * `SpecListViewSchema.shape`.
   */

  /** Kanban board configuration. Consumed by `ObjectKanban` (`@object-ui/plugin-kanban`). */
  kanban?: ListViewSchema['kanban'];

  /** Calendar configuration. Consumed by `ObjectCalendar` (`@object-ui/plugin-calendar`). */
  calendar?: ListViewSchema['calendar'];

  /** Gallery configuration. Consumed by `ObjectGallery` (`@object-ui/plugin-gallery`). */
  gallery?: ListViewSchema['gallery'];

  /** Timeline configuration. Consumed by `ObjectTimeline` (`@object-ui/plugin-timeline`). */
  timeline?: ListViewSchema['timeline'];

  /** Gantt configuration. Consumed by `ObjectGantt` (`@object-ui/plugin-gantt`). */
  gantt?: ListViewSchema['gantt'];

  /** Map configuration. Consumed by `ObjectMap` (`@object-ui/plugin-map`). */
  map?: ListViewSchema['map'];

  /**
   * Chart configuration. Consumed by `ObjectChart` (`@object-ui/plugin-charts`).
   *
   * ⚠️ REACHABILITY, measured and REPORTED on objectui#8980: `chart` is not a
   * member of this interface's `type` union — objectui#5321 ruled the branch
   * HOST-COMPOSITION ONLY — so a named view reaches it only when it declares no
   * `type` of its own and a host `views` entry selects `chart`. The read is
   * real; the authored route to it is not. ⛔ Not a reason to drop the member.
   */
  chart?: ListViewSchema['chart'];

  /**
   * Tree configuration. Consumed by `ObjectTree` (`@object-ui/plugin-tree`).
   *
   * ⚠️ Same reachability reading as `chart` above (objectui#5321), reported on
   * objectui#8980 with it.
   */
  tree?: ListViewSchema['tree'];

  /**
   * The audience gate — `@objectstack/spec` 18's one list-view capability key
   * (objectstack#22611, ruling A): a list of capabilities, ALL required, with
   * the app / navigation-item / action meaning. Taken from the protocol by
   * reference through {@link ListViewSchema}, whose member is the spec slot
   * (`specFieldsExcept`), so the two faces are one type (objectui#12341).
   *
   * ⭐ THE SERVER ENFORCES IT, and that is the whole enforcement: objectstack
   * PR #22731 lists only the views a caller may open on `GET /meta/view`,
   * answers a by-name read the caller cannot open with `403
   * PERMISSION_DENIED`, and prunes an object's `listViews` the same way
   * (ADR-0106 D4's metadata-reader class excepted). The console surfaces that
   * refusal (objectui#12112).
   *
   * ⛔ No renderer reads it, by design: a second, client-side gate would be a
   * second answer to a question the server already answered. The census in
   * `__tests__/object-view-unmirrored-keys-7779.test.ts` holds it in its own
   * SERVER-ENFORCED bucket, ⛔ not in bucket ① ("implementation owed").
   * `sharing` above is ownership and locking, ⛔ not audience.
   */
  requiredPermissions?: ListViewSchema['requiredPermissions'];
}

/**
 * Navigation configuration for row/item click behavior — the spec's
 * `NavigationConfig`, under this package's older local name.
 *
 * This used to be a hand-written interface mirroring the spec's six keys, and
 * it had drifted on exactly one of them: it required `mode`, under a doc
 * comment that itself said `@default 'page'` (objectui#4588). The spec declares
 * `mode: NavigationModeSchema.default('page')`
 * (`@objectstack/spec` `ui/view.zod.ts` `NavigationConfigSchema`), and a
 * `.default()` lands on the AUTHORING side as `| undefined` — which is why the
 * spec publishes its own type as `z.input< typeof NavigationConfigSchema >`.
 * So `navigation: { openNewTab: true }` is legal authored metadata that lets
 * the mode default (to `'page'`, the mode `openNewTab` applies to), and the
 * hand copy refused it.
 *
 * `index.ts` already re-exports that same spec type under its own name
 * (`NavigationConfig`), so this package published two disagreeing spellings of
 * one spec object. They are one type now. Per this file's rule above —
 * "Never Redefine Types. ALWAYS import them." — the per-key documentation lives
 * with the schema in the spec rather than being restated here, so there is no
 * third place to keep the `'page'` default in sync.
 *
 * objectui#4550 / PR objectui#4586 made the same collapse for
 * `@object-ui/react`'s `NavigationConfig`.
 */
export type ViewNavigationConfig = NavigationConfig;

/**
 * The second argument of the record-navigation `onNavigate` callback on the
 * list channel: a navigation-MODE token from a CLOSED vocabulary. `'view'`
 * opens the record page, `'new_window'` opens it in a new browser tab.
 *
 * One type, four faces (objectui#9547, maintainer ruling C of 2026-09-18):
 * `ObjectGridSchema.onNavigate` and `ListViewRuntimeProps.onNavigate` here,
 * `UseNavigationOverlayOptions.onNavigate` in `@object-ui/react` — the hook
 * whose click handler is the one producer of this value — and
 * `ObjectGridComponentProps.onNavigate` in `@object-ui/plugin-grid`. The
 * hook's own calls are typed against this union, so emitting any other token
 * is a compile error there rather than a branch a host silently misses.
 *
 * Written out here, not imported: `@objectstack/spec` (17.5.0 on) publishes
 * this vocabulary only as TEXT — the `type` string of the `onNavigate` row in
 * the react-tier `ListView` entry of `REACT_BLOCKS`,
 * `(recordId, action: 'view' | 'new_window') => void` — and exports no
 * TypeScript type to derive from. `plugin-grid`'s
 * `__tests__/onNavigateProp-9547.test.tsx` reads that row and fails when the
 * two vocabularies part.
 *
 * ⛔ Not `'edit'`: no branch of the hook emits it
 * (objectstack#19057 dropped it from the catalogue). ⛔ Not `string`: the slot
 * is closed, and an open type defers every misspelt mode to runtime.
 * ⚠️ `ObjectViewSchema.onNavigate` is a different channel with its own
 * vocabulary (`mode: 'view' | 'edit'`, invoked by `plugin-view`'s
 * `ObjectView`) and does not use this type.
 */
export type RecordNavigateAction = 'view' | 'new_window';

/**
 * ListView component node — DERIVED from the zod `ListViewSchema` (issue #2231), which
 * itself derives from `@objectstack/spec/ui` `ListViewSchema`. Spec-owned fields are
 * imported by the schema rather than re-typed here, so this type can no longer drift from
 * the protocol. The former hand-written interface (~470 lines mirroring the spec by hand)
 * is replaced by this alias. Non-serializable runtime-only props (callbacks, refresh
 * trigger) are intersected in via {@link ListViewRuntimeProps} — they cannot live in the
 * zod/JSON-schema.
 *
 * Legacy objectui vocabulary (`viewType`/`fields`/`filters`/`show*`/`densityMode`/…) and
 * the broader-than-spec configs (`userFilters`/`sharing`/`aria`/
 * `exportOptions`/`kanban`/`calendar`/`gantt`/`gallery`/`timeline`) remain as sanctioned
 * local `.extend()`s on the schema; migration to the spec-canonical keys is deferred (#2231).
 * `conditionalFormatting` is a local `.extend()` too but no longer broader than spec: it is
 * the spec list view's own `{ condition, style }` rule, the native dialect refused by name
 * (objectui#11533, {@link ConditionalFormattingRule}).
 */
export type ListViewSchema = ListViewAuthored & ListViewRuntimeProps;

/**
 * The zod-derived AUTHORING half of {@link ListViewSchema}, with every key
 * {@link ListViewRuntimeProps} declares removed so the intersection cannot
 * annihilate those declarations (`f1cd29032`).
 *
 * ## Why this is not `ListViewInferred` directly
 *
 * The mirror now declares `onNavigate` / `onDensityChange` (and three sibling
 * handler keys) as `handlerKeyRefusal` arms, because a registered renderer
 * reads them off the authored document and `BaseSchema.passthrough()` was
 * KEEPING an authored value. A refusal arm's `z.input` is `never | undefined`,
 * and an intersection ANDs the two halves per key:
 *
 *     (never | undefined) & (((recordId, action?) => void) | undefined)
 *       === undefined
 *
 * Measured on this tree before the precedence was written: `ListViewSchema`'s
 * `onNavigate` and `onDensityChange` resolved to `undefined`, down from the
 * function types `ListViewRuntimeProps` declares — and NOTHING went red,
 * because `undefined` is assignable to every optional callback parameter the
 * reads hand it. That is the silent form of the defect: a `'runtime-slot'`
 * disposition promises "the TypeScript twin stays callable", and a bare
 * intersection quietly makes it a lie while every gate stays green.
 *
 * ## Why a key-remapped mapped type and ⛔ not `Omit`
 *
 * `ListViewInferred` carries a string index signature (`BaseSchema` is
 * passthrough), so `keyof` it is `string | number` and
 * `Omit<ListViewInferred, keyof ListViewRuntimeProps>` keeps ONLY that index
 * signature — every declared member is erased. Measured the same way:
 * under `Omit`, `objectName` resolved to `unknown` instead of `string`. It is
 * the same trap `ListViewProps` in `@object-ui/plugin-list` documents for
 * `PropsWithoutRef`, and it is why this is a homomorphic mapped type with an
 * `as` clause: that form drops the named members it is asked to drop and
 * carries the index signature through untouched.
 *
 * This states the precedence the {@link ListViewSchema} docblock always
 * claimed — runtime-only props "cannot live in the zod/JSON-schema" — instead
 * of leaving it true only for as long as the mirror happened to declare none
 * of them. Adding a key to {@link ListViewRuntimeProps} is what takes it off
 * the authoring half; the pair is asserted in
 * `__tests__/list-view-handler-slots-7804.test.ts`.
 */
type ListViewAuthored = {
  [K in keyof ListViewInferred as K extends keyof ListViewRuntimeProps ? never : K]: ListViewInferred[K];
};

/**
 * Non-serializable runtime-only props for the ListView component. These never belong in
 * the zod schema — functions and imperative refresh triggers are not serialisable view
 * metadata — so they are kept separate and intersected into {@link ListViewSchema}.
 */
export interface ListViewRuntimeProps {
  /**
   * Called for page-level navigation with the record id and a
   * {@link RecordNavigateAction} — a navigation-MODE token from a closed
   * vocabulary: `'view'` opens the record page, `'new_window'` opens it in a
   * new browser tab.
   */
  onNavigate?: (recordId: string | number, action: RecordNavigateAction) => void;

  /**
   * Callback fired when the user toggles row density/height via the toolbar. Lets the host
   * persist the choice (the console keeps it as the signed-in user's own list state). Without
   * it the toggle is local-only.
   */
  onDensityChange?: (mode: 'compact' | 'comfortable' | 'spacious') => void;

  /**
   * External refresh trigger. Increment this value to force the ListView to re-fetch data.
   * Used by parent components (e.g. ObjectView) to signal that a mutation occurred.
   */
  refreshTrigger?: number;

  /**
   * ⭐ The three slots below are declared here by `f1cd29032`, and the reason is
   * the one objectui#9344's slice already measured on `ObjectGallerySchema`: a key
   * that reaches the renderer through `SchemaRenderer`'s props spread is on the
   * TypeScript face whether or not anyone declared it — `BaseSchema`'s index
   * signature was typing all three `unknown`, which is a declaration nobody wrote
   * and nobody can read.
   *
   * `ListView` reads them off its PROPS bag (`props.onAddRecord`, not
   * `schema.onAddRecord`), and there are two supply paths into that bag, both
   * live: a React host renders the component and passes the prop directly — the
   * `ListViewProps` interface in `@object-ui/plugin-list` declares all three by
   * name for exactly that — or a host builds the NODE in TypeScript and
   * `SchemaRenderer` spreads every non-metadata top-level key into the props it
   * creates the component with. This declaration is the second path's contract.
   * Declaring it is what keeps the `'runtime-slot'` disposition on the matching
   * zod arms true: JSON cannot author a function, so the mirror refuses the key
   * by name, while a programmatic host goes on supplying one HERE.
   *
   * ⚠️ Signatures match `ListViewProps` deliberately, `any` included. A host that
   * discovered the payload from the implementation annotated its own handler
   * against that interface, and a narrower declaration here refuses such a host
   * CONTRAVARIANTLY — the reading objectui#9341 took on
   * `ObjectKanbanSchema.onCardClick` and the reason `ListViewProps.onRowClick`
   * carries the same spelling.
   */

  /** Called when the user asks for a new record (toolbar "+ New" and the empty-state CTA). */
  onAddRecord?: () => void;

  /** Called with a non-delete bulk action key and the currently selected rows. */
  onBulkAction?: (action: string, records: any[]) => void;

  /** Called when the user picks a different page size in the pager. */
  onPageSizeChange?: (pageSize: number) => void;
}

/**
 * Object Map Configuration — the AUTHOR-FACING shape of an `object-map`'s
 * type-specific configuration, carried under `ObjectMapSchema.map`.
 *
 * ONE declaration, two consumers: this interface is what a TypeScript author
 * writes, and `ObjectMapConfigSchema` (`zod/objectql.zod.ts`) is what `ObjectMap`
 * validates the authored block against at runtime. They are kept as a pair
 * here, in `@object-ui/types`, precisely so the declared face and the runtime
 * validation cannot drift — before objectui#5018 the zod lived package-private
 * inside `plugin-map/src/ObjectMap.tsx` and the declared face did not exist at
 * all, so a misspelled `latitudeFieId` reached the renderer unchallenged by
 * either layer and painted an empty map.
 *
 * The FLAT top-level spelling of these same keys (`schema.latitudeField`, …)
 * is deliberately NOT declared here: it is the internal product of ObjectView /
 * ListView flattening `options.map` into the component schema, not an authoring
 * surface (maintainer ruling on objectui#5018, 2026-08-17). Authors write the
 * `map` block; when both are present, the block wins.
 */
export interface ObjectMapConfig {
  /** Field containing latitude value */
  latitudeField?: string;
  /** Field containing longitude value */
  longitudeField?: string;
  /** Field with a combined location (`"lat,lng"`, `[lat, lng]` or `{ lat, lng }`) */
  locationField?: string;
  /** Field to use for the marker title/label */
  titleField?: string;
  /** Field to use for the marker description */
  descriptionField?: string;
  /**
   * Zoom level (1-20). Declaring it opts the view OUT of fitting the camera to
   * its records — the declaration wins (objectui#4941).
   */
  zoom?: number;
  /**
   * Center coordinates `[lat, lng]` — latitude first, as documented and as the
   * `map` block has always been read. Declaring it opts the view OUT of fitting
   * the camera to its records.
   */
  center?: [number, number];
  /** MapLibre style URL/spec (overrides the public demo default) */
  style?: string;
}

/**
 * ObjectMap Component Schema
 *
 * Every key here has a read site in `plugin-map/src/ObjectMap.tsx`; nothing is
 * declared that the renderer does not consume (objectui#5018 — the card exists
 * because the reverse was true, and a declared-but-unread key re-creates the
 * same defect pointing the other way).
 *
 * ## What this type describes (objectui#10859, batch 5)
 *
 * The `object-map` node as `ObjectMap` READS it: after `SchemaRenderer` has
 * hoisted the node's `properties` bag onto it, or as code composes it
 * (`ObjectView` and `ListView` flattening a stored map view, a host mounting
 * `<ObjectMap schema={…}>`). That is why it still carries the flat
 * `locationField` / `titleField` the flatten produces.
 *
 * It is NOT the shape of an AUTHORED `object-map` document. An authored node
 * takes its props in the spec's `properties` bag, whose members are
 * `@objectstack/spec`'s `ComponentPropsMap['object-map']` row
 * (`ObjectMapProps`): `{ type: 'object-map', properties: { objectName, map:
 * { latitudeField, longitudeField }, … } }`. `ObjectMapBlockSchema`
 * (`./zod/objectql.zod.ts`) judges it, and refuses a prop written flat on the
 * node by name. `SchemaRenderer` reads both spellings, so a node built in code
 * keeps its flat keys.
 */
export interface ObjectMapSchema extends BaseSchema {
  type: 'object-map';
  /**
   * Per-element data binding — the spec's `ElementDataSource`, by reference
   * (objectui#11070). This block's registration is gate-wrapped
   * (`elementDataSourceBlock`), so `ElementDataSourceGate` reads the binding
   * off the node and lands its `object` on `objectName`. Metadata, ⛔ not the
   * adapter: see {@link ObjectGridSchema.dataSource}.
   */
  dataSource?: ElementDataSource;
  /**
   * ObjectQL object name — the THIRD record source `getDataConfig` resolves,
   * after {@link ObjectMapSchema.data} and {@link ObjectMapSchema.staticData}
   * (`plugin-map/src/ObjectMap.tsx`).
   *
   * Optional since `77cb489b4`: a map authored on inline rows never reads
   * this key, and requiring it refused three catalog entries that draw
   * correctly. The requirement the renderer really has — at least one of
   * `data`, `staticData`, `objectName` present, or the node's `dataSource.object`
   * naming the object, which `ElementDataSourceGate` lands on this key
   * (objectui#11117) — lives on the mirror as a refinement
   * (`requireRecordSource` in `zod/objectql.zod.ts`), so the published
   * declaration and the published validator say the same thing.
   */
  objectName?: string;
  /**
   * Data source configuration. Read FIRST by `getDataConfig`, ahead of
   * `staticData` / `objectName`.
   */
  data?: ViewData;
  /** Inline records, wrapped into a `{ provider: 'value' }` data config; read SECOND */
  staticData?: any[];
  /**
   * Query filter — the protocol's `ViewFilterRule` array,
   * `[{ field, operator, value }, ...]`, taken BY REFERENCE from the `object-map`
   * row (`ComponentPropsMap['object-map'].filter`), which refuses the
   * MongoDB-style record and the AST tuple array by name. Forwarded as `$filter`
   * with its context tokens (`{current_user_id}`, `{current_org_id}`, the date
   * macros) resolved first through `@object-ui/core`'s `resolveFilterPlaceholders`
   * (objectui#10666).
   *
   * objectui#6152 round 10: this was `any[]`, so a tuple array type-checked here
   * while the row refused it. ⚠️ What did NOT narrow is the read: `ObjectMap`
   * still forwards an AST a host composes at runtime (`ElementDataSourceGate`'s
   * merged binding), which is not a shape an author writes, so this face does
   * not publish it (the objectui#10199 split, as {@link ObjectGridSchema.filter}
   * makes it).
   */
  filter?: SpecObjectMapProps['filter'];
  /** Sort configuration, forwarded as `$orderby`. Array only — the legacy string clause is retired (objectui#8221). */
  sort?: SortConfig[];
  /**
   * Map configuration — the author face. See `ObjectMapConfig`.
   *
   * Named `ObjectMapConfig`, not `MapConfig`: `@objectstack/spec/automation`
   * already owns `MapConfig` / `MapConfigSchema` for an unrelated automation
   * concept, and `check:spec-symbols` (rightly) refuses a local declaration
   * under a spec export's name — a colliding name is read by the next agent as
   * the spec's own definition.
   */
  map?: ObjectMapConfig;
  /**
   * Group nearby markers into clusters. Clustering also engages automatically
   * past 100 markers; the `enableClustering` prop overrides this key.
   */
  enableClustering?: boolean;
  /**
   * Record navigation behaviour (drawer / dialog / page).
   * Aligned with @objectstack/spec ListView.navigation.
   */
  navigation?: ViewNavigationConfig;
  /**
   * Field containing location data (or lat/long pair).
   *
   * INTERNAL FORM. This is the flat spelling ObjectView / ListView produce when
   * they flatten `options.map`; it predates the `map` block and stays declared
   * only so that already-published authoring keeps type-checking. New authoring
   * belongs in `map.locationField`, which wins when both are present
   * (objectui#5018).
   */
  locationField?: string;
  /**
   * Field for marker title. INTERNAL FORM — see `locationField`; prefer
   * `map.titleField`.
   */
  titleField?: string;
  /**
   * MapLibre style URL/spec. Overrides the default demo style
   * (`https://demotiles.maplibre.org/style.json`), which is a public demo
   * server unsuited for production use. Named `mapStyle` (not `style`) to
   * avoid colliding with `BaseSchema.style` (inline CSS properties).
   */
  mapStyle?: string;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-map` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its refusal
   * names `children` as the remedy, which this node does not read either. The
   * member is restated here so both faces point at what the node renders
   * instead.
   *
   * @deprecated Not a channel `object-map` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-map` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep: no `body` /
   * `children` read is filed under this declaration, while the same instrument
   * does see it as the receiver of the keys the renderer reads. The
   * registration hop, `ObjectMapRenderer` (`packages/plugin-map`), is
   * `any`-typed and hands the node to `ObjectMap`, which reads it as this
   * type. `SchemaRenderer` strips both keys out of the props bag it spreads,
   * so neither reaches the component by another route, and the registration
   * declares no `children` slot (objectui#9910).
   *
   * What it renders instead: the records of `objectName` as markers placed by
   * `latitudeField` / `longitudeField` or `locationField`.
   *
   * @deprecated Not a channel `object-map` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Object Tree (tree-grid) Component Schema
 *
 * Renders a self-referencing object as an indented, expand/collapse tree-grid.
 * Flat records are nested via a single-parent pointer field (`parentField`).
 */
export interface ObjectTreeSchema extends BaseSchema {
  type: 'object-tree';
  /**
   * ObjectQL object name — the THIRD record source `resolveRecordSourceConfig`
   * reads, after {@link ObjectTreeSchema.data} and
   * {@link ObjectTreeSchema.staticData}.
   *
   * OPTIONAL since objectui#11168 slice 3, as on {@link ObjectMapSchema} and
   * {@link ObjectGanttSchema}: a tree on inline rows never reads it, and the
   * zod twin's `requireRecordSource` refinement is where "one of the three" is
   * enforced. ⚠️ The node's `dataSource` binding is NOT a fourth rung here —
   * this block's registration is not gate-wrapped, so nothing lands a binding's
   * object on this key.
   */
  objectName?: string;
  /**
   * Data source configuration — read FIRST by `resolveRecordSourceConfig`, so a
   * tree carrying one never reaches `staticData` or `objectName`. The `value`
   * provider draws its `items` and the `object` provider queries its `object`;
   * the `api` and `schema` providers draw no rows on the tree (objectui#11168
   * slice 3, measured). A bare array here is not a record source
   * (objectui#8348).
   */
  data?: ViewData;
  /** Inline records, wrapped into a `{ provider: 'value' }` data config; read SECOND */
  staticData?: any[];
  /**
   * The tree's field configuration — the spec's `TreeConfig`, by reference
   * (objectui#11168 slice 3; the `tree` DECLARE verdict `ObjectTree.schemaTyped-8655`
   * recorded as owed). Its four members are the four below; where both are
   * written, the flat key on the node outranks the member of the same name
   * (`getTreeConfig`).
   */
  tree?: SpecTreeConfig;
  /**
   * Row-click navigation — the spec's `NavigationConfig`, the same block
   * `ListViewSchema.navigation` declares (objectui#11168 slice 3, the tree arm
   * of objectui#8652's ruling 「B」). An absent key opens nothing on a tree no
   * parent view navigates for; see the registration description for each mode.
   */
  navigation?: ViewNavigationConfig;
  /**
   * Query filter, forwarded as `$filter` on the tree's own fetch, with its
   * context tokens (`{current_user_id}`, `{current_org_id}`, the date macros) resolved first through `@object-ui/core`'s `resolveFilterPlaceholders` (objectui#10666).
   *
   * Typed as that DESTINATION by an indexed access on {@link QueryParams}, the
   * shape objectui#9309 settled for {@link ObjectGallerySchema.filter}, so the
   * declaration cannot drift away from the slot it is forwarded into
   * (objectui#9549). The key was already delivered and read before it was
   * declared: `ListView` puts `filter` on the `baseProps` every child view
   * receives, and `ObjectTree` sends it as `$filter`. Until this
   * declaration the value survived only on `BaseSchema`'s index signature, so
   * declaring it NARROWS: `filter: 'stage=won'` and `filter: 42` are compile
   * errors now.
   *
   * ⛔ It is a query filter and nothing else. The renderer used to also read
   * `filter.tree` as a stash for the tree block; that second dialect had no
   * author and was removed in the same change. The tree block is `tree`.
   *
   * ⛔ Do not re-spell the arms here — what `QueryParams['$filter']` resolves to
   * is stated once, in `./data.ts`.
   */
  filter?: QueryParams['$filter'];
  /**
   * Field holding the parent record reference (single-parent pointer).
   * When omitted, the renderer auto-detects the object's `tree`/self-reference field.
   */
  parentField?: string;
  /** Field rendered (indented) in the tree's first column. Defaults to `name`. */
  labelField?: string;
  /** Additional fields rendered as flat columns alongside the label. */
  fields?: string[];
  /**
   * Default expansion depth (0 = roots only). When omitted, all nodes expand.
   */
  defaultExpandedDepth?: number;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-tree` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its refusal
   * names `children` as the remedy, which this node does not read either. The
   * member is restated here so both faces point at what the node renders
   * instead.
   *
   * @deprecated Not a channel `object-tree` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-tree` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep: no `body` /
   * `children` read is filed under this declaration, while the same instrument
   * does see it as the receiver of the keys the renderer reads. The
   * registration hop, `ObjectTreeRenderer` (`packages/plugin-tree`), is
   * `any`-typed and hands the node to `ObjectTree`, which reads it as this
   * type. `SchemaRenderer` strips both keys out of the props bag it spreads,
   * so neither reaches the component by another route, and the registration
   * declares no `children` slot (objectui#9910).
   *
   * `ObjectTree` does read a `children` — on the `TreeNode` hierarchy it
   * builds from the fetched records, never on this node.
   *
   * What it renders instead: the records of `objectName` as a hierarchy linked
   * by `parentField` and labelled by `labelField`.
   *
   * @deprecated Not a channel `object-tree` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Object Gantt Component Schema
 *
 * ## What this type describes (objectui#10859, batch 6)
 *
 * The `object-gantt` node as `ObjectGantt` READS it: after `SchemaRenderer` has
 * hoisted the node's `properties` bag onto it, or as code composes it
 * (`ObjectView` and `ListView` flattening a stored gantt view, a host mounting
 * `<ObjectGantt schema={…}>`). That is why it still carries the flat
 * `GanttConfig` keys (`startDateField`, `viewMode`, …) and the `search` pair
 * the composers write.
 *
 * It is NOT the shape of an AUTHORED `object-gantt` document. An authored node
 * takes its props in the spec's `properties` bag, whose members are
 * `@objectstack/spec`'s `ComponentPropsMap['object-gantt']` row
 * (`ObjectGanttProps`), with its field mapping in the bag's `gantt` block:
 * `{ type: 'object-gantt', properties: { objectName, gantt: { startDateField,
 * endDateField, titleField }, … } }`. `ObjectGanttBlockSchema`
 * (`./zod/objectql.zod.ts`) judges it, and refuses a prop written flat on the
 * node by name. `SchemaRenderer` reads both spellings, so a node built in code
 * keeps its flat keys.
 */
export interface ObjectGanttSchema extends BaseSchema {
  type: 'object-gantt';
  /**
   * Per-element data binding — the spec's `ElementDataSource`, by reference
   * (objectui#11070). This block's registration is gate-wrapped
   * (`elementDataSourceBlock`), so `ElementDataSourceGate` reads the binding
   * off the node and lands its `object` on `objectName`. Metadata, ⛔ not the
   * adapter: see {@link ObjectGridSchema.dataSource}.
   */
  dataSource?: ElementDataSource;
  /**
   * ObjectQL object name — the THIRD record source `resolveRecordSourceConfig`
   * (`@object-ui/core`) resolves, after {@link ObjectGanttSchema.data} and
   * {@link ObjectGanttSchema.staticData} (called by `plugin-gantt/src/ObjectGantt.tsx`).
   *
   * Optional since `77cb489b4`: a gantt authored on inline rows never reads
   * this key, and requiring it refused three catalog entries that draw
   * correctly. The requirement the renderer really has — at least one of
   * `data`, `staticData`, `objectName` present, or the node's `dataSource.object`
   * naming the object, which `ElementDataSourceGate` lands on this key
   * (objectui#11117) — lives on the mirror as a refinement
   * (`requireRecordSource` in `zod/objectql.zod.ts`), so the published
   * declaration and the published validator say the same thing.
   */
  objectName?: string;
  /**
   * Data source configuration. Read FIRST by `resolveRecordSourceConfig`
   * (`@object-ui/core`), which returns it verbatim when it is on the block's
   * declared arm — ahead of `staticData` / `objectName`.
   *
   * Declared by `77cb489b4`, in the same stroke as the mirror's `data`: until
   * then the read landed on `BaseSchema`'s index signature on this side and
   * on `.passthrough()` on the mirror's, so the record source the resolver
   * prefers was the one neither face named. Same type as
   * {@link ObjectMapSchema.data}.
   */
  data?: ViewData;
  /** Field for task start date */
  startDateField?: string;
  /** Field for task end date */
  endDateField?: string;
  /** Field for task title/name */
  titleField?: string;
  /**
   * Field for task dependencies.
   *
   * @deprecated Legacy alias — author {@link ObjectGanttSchema.dependenciesField}
   * instead. The plural is the spec's spelling (`@objectstack/spec`
   * `GanttConfigSchema.dependenciesField`); this singular has NO spec
   * counterpart. It is pre-spec objectui vocabulary, and until objectui#6051 it
   * was the ONLY dependencies spelling this interface declared — so for the whole
   * time the alias existed the published type taught the non-spec key and hid the
   * canonical one. That is what this tag exists to correct: the two were declared
   * as equals, and a reader had no way to learn which one to write.
   *
   * Still accepted, deliberately. `getGanttConfig`'s flat branch reads
   * `dependenciesField || dependencyField`, so metadata already written against
   * this key renders unchanged and the canonical key wins wherever both carry a
   * value. Deprecating is NOT removing: dropping the alias would narrow the
   * accept set of a published surface, which is a separate enforce-or-remove
   * decision (objectui#6470) and not something this marker takes.
   */
  dependencyField?: string;
  /** Field for progress (0-100) */
  progressField?: string;
  /**
   * Initial timeline granularity, honoured by BOTH renderer branches (the
   * timeline and the resource-workload grid). DERIVED from the spec's
   * `GanttConfigSchema.viewMode` member so the member list cannot drift
   * (objectui#5074).
   *
   * Deliberately NO default: an omitted `viewMode` lets a persisted layout
   * (保存布局, `persistLayoutKey`) seed the granularity before the renderer's
   * `'day'` fallback. A default here would arrive downstream as an explicit
   * author choice and defeat that seeding.
   */
  viewMode?: SpecGanttConfig['viewMode'];
  /**
   * Skip weekends in duration / auto-schedule math (objectui#5903).
   *
   * When true (or when `holidays` is non-empty) `ObjectGantt` builds a
   * `WorkingCalendar` and `GanttView` measures durations, cascades and the
   * critical path in WORKING days — weekends are stepped over rather than
   * consumed. Read at `plugin-gantt/src/ObjectGantt.tsx` (`workingCalendar`).
   *
   * Declared here rather than derived: the spec's `GanttConfigSchema` models no
   * working-calendar member, so this is objectui's own display extension — the
   * same standing `timeSegments` has on {@link GanttConfig}.
   */
  skipWeekends?: boolean;
  /**
   * Non-working dates for the same working calendar as {@link skipWeekends} —
   * ISO `yyyy-mm-dd` calendar days, e.g. `['2024-06-05']`, read on the chart's
   * own calendar (the viewer's, or the business `timeZone`'s when one is set),
   * as its day columns are (objectui#10866). Non-empty enables the working
   * calendar on its own. Read at `ObjectGantt.tsx` (`workingCalendar`).
   */
  holidays?: string[];
  /**
   * Opt OUT of layout persistence. `false` disables it; any other value (and
   * omission) keeps it on, which is why this is not spelled as an enable flag.
   *
   * `GanttView` persists its column/zoom snapshot and `ObjectGantt` persists the
   * quick-filter chips under a sibling localStorage key, both derived from
   * `persistLayoutKey`. Read at `ObjectGantt.tsx` (`persistLayoutKey`).
   */
  persistLayout?: boolean;
  /**
   * Layout-persistence scope. Distinguishes two gantts bound to the SAME object
   * so they keep separate saved layouts; the storage key is
   * `objectName:viewName` and defaults to `objectName:default`. Read at
   * `ObjectGantt.tsx` (`persistLayoutKey`).
   */
  viewName?: string;
  /**
   * Record navigation behaviour when a bar is clicked (drawer / dialog / page).
   * Defaults to an inline right-side drawer; set `{ mode: 'page' }` to route to
   * the standalone detail page instead. Read at `ObjectGantt.tsx`
   * (`navConfig`).
   *
   * The spec owns the member list — `mode`, `view`, `preventNavigation`,
   * `openNewTab`, `size`, `width` — and its schema REFUSES anything else. In
   * particular there is no `basePath`: the package README shows one, and no read
   * site in this repo consumes it (filed separately). Do not restate the
   * vocabulary here; that is the drift this derivation exists to prevent.
   *
   * Same spec type as {@link ObjectGridSchema.navigation} and
   * {@link ObjectViewSchema.navigation} — aligned with `@objectstack/spec`
   * `ListView.navigation` rather than restated, so the vocabulary cannot fork.
   */
  navigation?: ViewNavigationConfig;
  /**
   * Extra vertical reference lines drawn like the Today marker (deadline,
   * sprint boundary, release…). Forwarded to `GanttView`'s `markers` prop and
   * read at `ObjectGantt.tsx`.
   *
   * `date` is declared as a STRING here, not `Date | string` like the runtime
   * `GanttMarker` this feeds: a schema is serialisable authored metadata and a
   * `Date` instance cannot survive JSON. The renderer keeps accepting both,
   * because a narrower authoring surface is assignable to the wider prop.
   */
  markers?: Array<{
    /** Marker position, ISO date or datetime string (e.g. `'2024-06-05'`). */
    date: string;
    /** Text drawn against the line. */
    label?: string;
    /** Line colour — any CSS colour. */
    color?: string;
  }>;
  /**
   * Start with the critical-path highlight enabled. The toolbar toggle stays
   * available either way — this only seeds its initial state. Read at
   * `ObjectGantt.tsx` (`criticalPathDefault`).
   */
  criticalPath?: boolean;
  /**
   * Render planned-vs-actual baseline bars when tasks carry baseline dates.
   * Defaults to ON — only an explicit `false` turns them off, which is why the
   * read site compares against `false` rather than coercing. Read at
   * `ObjectGantt.tsx`.
   */
  showBaselines?: boolean;
  /**
   * Read-only mode. Disables every write path — bar drag / resize / progress
   * handle, inline edit, delete, dependency-link drag, row reorder,
   * auto-schedule and the Undo/Redo buttons — and locks the record drawer.
   * Clicking a task and switching granularity still work. Read at
   * `ObjectGantt.tsx` (`readOnly`, and the drawer's `recLocked`).
   */
  readOnly?: boolean;
  /**
   * Auto-enter read-only mode on narrow viewports (< 640px) so touch users get
   * a scrollable thumbnail instead of error-prone drag editing. Defaults to ON;
   * only an explicit `false` turns it off. Independent of (and OR-combined
   * with) {@link readOnly}. Read at `ObjectGantt.tsx`.
   */
  mobileReadOnly?: boolean;

  // ── The flattened `GanttConfig` face (objectui#6051) ────────────────────────
  //
  // `getGanttConfig` (`plugin-gantt/src/ObjectGantt.tsx`) has two branches. The
  // `gantt` block wins whenever it is present (objectui#6469); this flat face is
  // read only when there is no block, and then only when `startDateField` AND
  // `endDateField` are both present at the TOP LEVEL. The keys of the flat branch
  // were declared by neither
  // this interface nor `ObjectGridSchema`: they were reachable only through
  // `BaseSchema`'s `[key: string]: any`, so `schema.colorField` type-checked as
  // `any` with no cast anywhere to grep for. That is why the census behind this
  // card is an AST enumeration and not a compile-and-observe — an index signature
  // swallows exactly the evidence a type annotation would have produced.
  //
  // Every member below is DERIVED from {@link GanttConfig}, the same type the
  // `gantt` block carries, so the flat spelling cannot drift from the block
  // spelling. All are optional, matching the renderer: the flat branch reads each
  // key bare and forwards `undefined` unchanged.
  //
  // ⚠️ WHICH face wins was NOT decided by objectui#6051, which declared these keys.
  // It was settled afterwards by objectui#6469, inheriting the maintainer ruling on
  // objectui#5018 (2026-08-17) that `plugin-map` shipped in PR #5156: the BLOCK
  // wins, taken whole, and the shadowed flat keys are named in a dev-mode warning
  // instead of being dropped silently. So a node carrying both spellings renders
  // the `gantt` block's values — the reverse of the pre-#6469 order.

  /**
   * Record field carrying the bar's FILL colour: any CSS colour or a semantic
   * palette name (red/orange/…), typically a server-computed status colour.
   * When it is unset — or when the record's value is empty — the bar falls back
   * to the record's own `status`/`state`/`priority`/`severity` value, so the
   * timeline tells the same colour story as list/kanban. With neither, bars
   * take the platform default blue.
   */
  colorField?: GanttConfig['colorField'];
  /** Per-task alert stroke colour field. See {@link GanttConfig.borderColorField}. */
  borderColorField?: GanttConfig['borderColorField'];
  /**
   * Record field holding this task's predecessors. The CANONICAL spelling — the
   * flat branch reads `dependenciesField || dependencyField`, so the singular
   * {@link ObjectGanttSchema.dependencyField} above stays accepted as the legacy
   * alias and this one wins. That alias is `@deprecated` (objectui#6470): still
   * read, no longer taught.
   */
  dependenciesField?: GanttConfig['dependenciesField'];
  /**
   * Record field holding this row's PARENT id — the single-parent pointer the
   * task tree is built from: indentation, expand/collapse and summary rollup
   * all follow it. An empty value, or one naming no loaded row, renders that
   * row as a root. Leave unset for a flat chart; `groupByField` is the
   * alternative, bucketing leaves under synthesized rows instead of a
   * record-declared hierarchy.
   */
  parentField?: GanttConfig['parentField'];
  /** Record field mapping onto a node kind (task/summary/milestone/group). */
  typeField?: GanttConfig['typeField'];
  /** Record field marking a row view-only. See {@link GanttConfig.lockField}. */
  lockField?: GanttConfig['lockField'];
  /** Record field carrying the row's own object API name (mixed-object trees). */
  objectField?: GanttConfig['objectField'];
  /** How a summary bar's span is computed. See {@link GanttConfig.summaryExtent}. */
  summaryExtent?: GanttConfig['summaryExtent'];
  /** Auto-collapse depth on first render. See {@link GanttConfig.defaultCollapsedDepth}. */
  defaultCollapsedDepth?: GanttConfig['defaultCollapsedDepth'];
  /**
   * Extra record fields listed as label/value rows in a bar's hover tooltip, in
   * the order given. Each entry is a field name (dot-paths allowed) or
   * `{ field, label }` to set the label explicitly; otherwise the label comes
   * from the object schema, falling back to a humanized field name, and the
   * value is formatted by field type the way a list cell would render it. A row
   * whose value is empty is DROPPED rather than dashed, so a mixed-object tree
   * can list the union of every level's fields here. Any surviving rows replace
   * the tooltip's default date · duration · progress line.
   */
  tooltipFields?: GanttConfig['tooltipFields'];
  /** Baseline (planned) start field → planned-vs-actual reference bars. */
  baselineStartField?: GanttConfig['baselineStartField'];
  /** Baseline (planned) end field → planned-vs-actual reference bars. */
  baselineEndField?: GanttConfig['baselineEndField'];
  /** Dynamic group-by field, replacing the parent hierarchy. */
  groupByField?: GanttConfig['groupByField'];
  /** Render the per-resource load histogram instead of the timeline grid. */
  resourceView?: GanttConfig['resourceView'];
  /** Record field the resource view buckets by. Required for {@link resourceView}. */
  assigneeField?: GanttConfig['assigneeField'];
  /** Record field carrying each task's load units (default 1). */
  effortField?: GanttConfig['effortField'];
  /** Per-resource capacity ceiling (default 1); loads above it flag overload. */
  capacity?: GanttConfig['capacity'];
  /**
   * Quick-filter dropdowns rendered above the chart — a row of multi-selects,
   * each narrowing the visible bars by one record field. A dimension's options
   * resolve from the object schema (a select's options, or the referenced
   * records for a lookup), so the dropdown offers that field's full domain
   * rather than only the values present in the loaded page; declare `options`
   * on the dimension to override that with a fixed list.
   */
  quickFilters?: GanttConfig['quickFilters'];
  /** Recompute the timeline range when filtering (default true). */
  autoZoomToFilter?: GanttConfig['autoZoomToFilter'];
  /** Shift segmentation for the day-mode timeline. See {@link GanttConfig.timeSegments}. */
  timeSegments?: GanttConfig['timeSegments'];
  /** Per-interaction switches. See {@link GanttConfig.interactions}. */
  interactions?: GanttConfig['interactions'];
  /** Base name for exported PNG/PDF files. See {@link GanttConfig.exportFileName}. */
  exportFileName?: GanttConfig['exportFileName'];
  /** Business time zone (IANA name) the calendar renders in. */
  timeZone?: GanttConfig['timeZone'];
  /** Whether the store persists dependency link TYPES (fs/ss/ff/sf). */
  dependencyTypes?: GanttConfig['dependencyTypes'];

  // ── The BLOCK face (the `ObjectGridSchema`-style shape, objectui#6475) ──────
  //
  // `getGanttConfig`'s FIRST branch (`plugin-gantt/src/ObjectGantt.tsx`) reads
  // this and wins whenever present (objectui#6469 ruled block-over-flat). It was
  // the 28th and last undeclared key of the objectui#6051 census — the one key
  // whose VALUES get stricter on declaration rather than merely gaining a name:
  // it had no mirror entry at all, so a block rode through `.passthrough()`
  // entirely unvalidated. Declaring it as {@link GanttConfig} means it is now
  // PARSED, and `GanttConfig` derives from the spec's `GanttConfigSchema`, which
  // REQUIRES `startDateField`, `endDateField` and `titleField`. Because
  // `ObjectGanttSchema`'s zod mirror was a member of `AnyComponentSchema`, that
  // reached `safeValidateSchema` and therefore the CLI's `validate` command: a
  // block missing one of the three moved from "accepted, then warned about at
  // runtime" to "refused at authoring time". Since objectui#10859 batch 6 the
  // authored node's block is judged inside its `properties` bag, as the spec
  // row's own `gantt` member (`ObjectGanttBlockSchema`), with the same three
  // required.
  //
  // This is a `declared = enforced` restoration, not new requiredness: the
  // renderer already fed the block to `GanttConfigSchema.safeParse` and logged
  // `[ObjectGantt] Invalid gantt configuration` on failure — the trio was already
  // required for the block to actually work, just silently. Maintainer ruling,
  // objectui#6475 (2026-08-27), Option A: declare as-is, spec requiredness
  // enforces immediately, no warning window (excluded by the startup-stage
  // no-gradualism rule, objectstack#12668 — no named external-user evidence).
  gantt?: GanttConfig;

  // ── The query/data keys the fetch path reads (objectui#6051) ────────────────
  //
  // These are NOT gantt config: they are the read the component issues. They were
  // declared on `ObjectGridSchema`, which is what `ObjectGanttProps.schema` used
  // to be typed as — objectui#5903 retyped that prop to this interface, which is
  // correct and is why they now have to be declared HERE. `plugin-gantt`'s
  // registry mapping (`OBJECT_GANTT_DATA_SOURCE` in `index.tsx`) names `filter`
  // and `sort` as the two keys the element data-source binding maps onto.
  /** Inline records, wrapped into a `{ provider: 'value' }` config by `resolveRecordSourceConfig`. */
  staticData?: any[];
  /**
   * Query filter — the protocol's `ViewFilterRule` array,
   * `[{ field, operator, value }, ...]`, taken BY REFERENCE from the
   * `object-gantt` row (`ComponentPropsMap['object-gantt'].filter`), which refuses
   * the MongoDB-style record and the AST tuple array by name. Forwarded as
   * `$filter` with its context tokens (`{current_user_id}`, `{current_org_id}`,
   * the date macros) resolved first through `@object-ui/core`'s
   * `resolveFilterPlaceholders` (objectui#10666).
   *
   * objectui#6152 round 10: this was `any[]`, so a tuple array type-checked here
   * while the row refused it. ⚠️ What did NOT narrow is the read: `ObjectGantt`
   * still forwards an AST a host composes at runtime (`ElementDataSourceGate`'s
   * merged binding, `ListView`'s effective filter), which is not a shape an
   * author writes, so this face does not publish it (the objectui#10199 split, as
   * {@link ObjectGridSchema.filter} makes it).
   */
  filter?: SpecObjectGanttProps['filter'];
  /** Sort configuration, forwarded as `$orderby` via `convertSortToQueryParams`. Array only — the legacy string clause is retired (objectui#8221). */
  sort?: SortConfig[];
  /**
   * Full-text search term, forwarded as `$search` (objectui#10250). The server
   * resolves which fields it matches from the object's metadata (ADR-0061).
   * `ListView` writes it from its toolbar Search box: the chart runs its own
   * query, so without this key the box changed the list's fetch and nothing
   * drawn.
   */
  search?: string;
  /**
   * Narrows the fields {@link ObjectGanttSchema.search} matches, forwarded as
   * `$searchFields` — and only alongside a term, as a list's own query sends
   * it. Same key and meaning as {@link ObjectGridSchema.searchableFields}.
   */
  searchableFields?: string[];
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-gantt` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its refusal
   * names `children` as the remedy, which this node does not read either. The
   * member is restated here so both faces point at what the node renders
   * instead.
   *
   * @deprecated Not a channel `object-gantt` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-gantt` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep: no `body` /
   * `children` read is filed under this declaration, while the same instrument
   * does see it as the receiver of the keys the renderer reads. The
   * registration hop, `ObjectGanttRenderer` (`packages/plugin-gantt`), is
   * `any`-typed and hands the node to `ObjectGantt`, which reads it as this
   * type. `SchemaRenderer` strips both keys out of the props bag it spreads,
   * so neither reaches the component by another route, and the registration
   * declares no `children` slot (objectui#9910).
   *
   * What it renders instead: the records of `objectName` as bars from
   * `startDateField` to `endDateField`.
   *
   * @deprecated Not a channel `object-gantt` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Object Calendar Component Schema
 */
export interface ObjectCalendarSchema extends BaseSchema {
  type: 'object-calendar';
  /**
   * Per-element data binding — the spec's `ElementDataSource`, by reference
   * (objectui#11070). This block's registration is gate-wrapped
   * (`elementDataSourceBlock`), so `ElementDataSourceGate` reads the binding
   * off the node and lands its `object` on `objectName`. Metadata, ⛔ not the
   * adapter: see {@link ObjectGridSchema.dataSource}.
   */
  dataSource?: ElementDataSource;
  /**
   * ObjectQL object name — the THIRD record source `resolveRecordSourceConfig`
   * (`@object-ui/core`) resolves, after {@link ObjectCalendarSchema.data} and
   * {@link ObjectCalendarSchema.staticData} (called by `plugin-calendar/src/ObjectCalendar.tsx`).
   *
   * Optional since objectui#7313 (the `77cb489b4` shape): a calendar authored
   * on inline rows never reads this key, and requiring it refused the two
   * documented static-data examples that draw correctly. The requirement the
   * renderer really has — at least one of
   * `data`, `staticData`, `objectName` present, or the node's `dataSource.object`
   * naming the object, which `ElementDataSourceGate` lands on this key
   * (objectui#11117) — lives on the mirror as a refinement
   * (`requireRecordSource` in `zod/objectql.zod.ts`), so the published
   * declaration and the published validator say the same thing.
   */
  objectName?: string;
  /**
   * PRE-FETCHED RECORDS — an ARRAY, drawn in place of the calendar's own query.
   * Read FIRST by the shared record-source ladder in `@object-ui/core`, on the
   * `'array'` arm, ahead of `staticData` / `objectName`. ⛔ The ladder's ARM is
   * the citation; its first argument is not, because that is a call SHAPE and
   * it has already moved once — objectui#8651 now passes the three members the
   * ladder documents itself as reading, one by one.
   *
   * Declared by objectui#7313, in the same stroke as the mirror's `data`: until
   * then the read landed on `BaseSchema`'s index signature on this side and
   * on `.passthrough()` on the mirror's, so the record source the resolver
   * prefers was the one neither face named.
   *
   * ⛔ NOT `ViewData`, and NOT the same type as {@link ObjectMapSchema.data} —
   * that is what objectui#9239 changed here, and it is a BREAKING NARROWING of
   * a published authoring type. Until it, both published faces of this package
   * declared the `{ provider, items }` PROVIDER BLOCK on this key while the
   * protocol declared an array, so an author validating against
   * `@object-ui/types` got a green verdict for metadata `os validate`, the save
   * gate and (since objectui#8348) the renderer all refuse — `declared !==
   * enforced` with the declaration on the wrong side, the shape AGENTS.md #0.1
   * exists to prevent. Maintainer ruling, decision batch #83 (2026-09-08),
   * verbatim: 「8348 以协议为准」.
   *
   * DERIVED from the protocol's own row rather than re-spelled, so this key
   * cannot drift from it a second time: `ComponentPropsMap['object-calendar']`
   * (the spec's own `ObjectCalendarPropsSchema`) declares
   * `z.array(z.unknown()).optional()`, described *"Pre-fetched records — skips
   * the internal fetch"*.
   * MEASURED on the installed artifact at `@objectstack/spec` 18.1.0 — the
   * version this repository's `pnpm-lock.yaml` resolves — through the published
   * `@objectstack/spec/ui` entry point: the provider block returns
   * `success=false` with `expected: 'array'` at `path: ['data']`, the array
   * returns `success=true`. The same reading is written down, per block, in
   * `packages/core/src/utils/record-source.ts`.
   *
   * ⛔ The sibling blocks are NOT following: `object-map` and `object-gantt`
   * have no `ComponentPropsMap` row at all, so the published row that governs
   * them is this package's own `ObjectMapSchema.data` / `ObjectGanttSchema.data`
   * — `ViewData` on both, deliberately kept.
   */
  data?: SpecObjectCalendarProps['data'];
  /** Inline records, wrapped into a `{ provider: 'value' }` config by `resolveRecordSourceConfig`. */
  staticData?: any[];
  /**
   * The configuration container, and the FIRST thing this element's renderer
   * reads: `plugin-calendar/src/ObjectCalendar.tsx`'s `getCalendarConfig`
   * returns this block whole when it is present, and only falls through to the
   * flat members below when it is not.
   *
   * ⭐ This is where the five field-name keys are AUTHORED (objectui#8831):
   * `calendar: { startDateField, endDateField, titleField, colorField, allDayField }`.
   * `ComponentPropsMap['object-calendar']` refuses the same five written flat on
   * the node, and its diagnostic prescribes exactly this block (one key per
   * concept, the spec's Prime Directive #12). The flat members below are the
   * runtime handoff, declared because the renderer reads them, not a second
   * spelling to write.
   *
   * `@objectstack/spec` declares the KEY and, since 17.7.0, its SHAPE:
   * `ComponentPropsMap['object-calendar'].calendar` is a strict copy of the list
   * view's calendar block (objectstack#21464 stage 2), five members with
   * `startDateField` required. This package's registration `inputs` publishes
   * the key, so authors are offered it. Through 17.6.0 the slot was
   * `z.unknown().optional()`, and both published faces of THIS package stayed
   * silent about the key until objectui#8651, which is the objectui#6914 class:
   * the value rode {@link BaseSchema}'s `[key: string]: any` here and
   * `.passthrough()` on the mirror, admitted and never examined. `calendar: 42`
   * type-checked, parsed green, and drew an empty calendar.
   *
   * DERIVED from the mirror rather than re-spelled, so the two faces cannot
   * fork — the same construction {@link ListViewSchema} uses through
   * `ListViewInferred`. Since objectui#6152 round 9 the mirror is the row's own
   * slot BY REFERENCE, plus the two by-name alias refusals (objectui#8355), so
   * this type is closed: `startDateField` is required, the four others are
   * optional, and a fresh literal carrying any other key is a compile error, as
   * the spec refuses it at parse. Until that round the mirror was `.partial()`
   * and `.passthrough()`, so this type carried an index signature and an
   * optional `startDateField`, and admitted both shapes the slot refuses.
   *
   * ⛔ `defaultView` is NOT a member of this container (nor, since objectui#6152
   * round 11, of a list VIEW's calendar block): this renderer seeds its view state from
   * {@link ObjectCalendarSchema.defaultView}, the FLAT member below, and never
   * looks inside here, and the slot does not declare it either. Written inside
   * the block, it is refused; write it flat.
   */
  calendar?: ObjectCalendarBlockConfig;
  /**
   * Field for event start — the FLAT spelling, READ BUT NOT AUTHORED
   * (objectui#8831). Write `calendar.startDateField` instead.
   *
   * This is the runtime handoff: `ObjectView` and `ListView` emit the five
   * field-name keys flat on the `object-calendar` node they build, and
   * `getCalendarConfig` reads them only when the node carries no
   * {@link ObjectCalendarSchema.calendar} block. `@objectstack/spec` refuses
   * the same five at this element with `unrecognized_keys`, and its diagnostic
   * names the {@link ObjectCalendarSchema.calendar} block as the place to write
   * them (one key per concept, its Prime Directive #12). The five stay declared
   * here because the renderer reads them; a declaration records that read, it
   * is not a second authoring spelling.
   */
  startDateField?: string;
  /**
   * Field for event end — the FLAT spelling, read but not authored. Write
   * `calendar.endDateField`; see {@link ObjectCalendarSchema.startDateField}.
   */
  endDateField?: string;
  /**
   * ⛔ RETIRED (objectui#8355, director ruling of 2026-09-16) — `dateField` was
   * the pre-#2231 objectui spelling of {@link ObjectCalendarSchema.startDateField}
   * and is refused BY NAME on both faces: `?: never` here, an
   * `aliasKeyRefusal()` arm on the zod mirror (`zod/objectql.zod.ts`). Write
   * `startDateField`.
   *
   * ⚠️ It is a TOMBSTONE, not a deletion, and the difference is the whole
   * ruling. `BaseSchema` is `.passthrough()` on the mirror (and carried
   * `[key: string]: any` on this face until objectui#8347), so a DELETED key is
   * not refused there — it is KEPT, unexamined, and then ignored now that `ObjectCalendar`'s alias ladder
   * is gone. Silent is the failure mode an earlier attempt shipped
   * (objectui#8651 records it); declared-and-unwritable is what makes the same
   * document fail loudly instead.
   */
  dateField?: never;
  /**
   * ⛔ RETIRED (objectui#8355) — the pre-#2231 spelling of
   * {@link ObjectCalendarSchema.endDateField}, refused by name for the reason
   * spelled out on {@link ObjectCalendarSchema.dateField} above. Write
   * `endDateField`.
   *
   * ⚠️ This one degraded even more quietly than its sibling before the
   * retirement: the node still resolved through `startDateField`, so the
   * calendar drew, and only the end binding went missing.
   */
  endField?: never;
  /**
   * Field for event title — the FLAT spelling, read but not authored. Write
   * `calendar.titleField`; see {@link ObjectCalendarSchema.startDateField}.
   */
  titleField?: string;
  /**
   * Record field carrying the event's colour — the FLAT spelling, read but not
   * authored: write `calendar.colorField`, and see
   * {@link ObjectCalendarSchema.startDateField} for why the flat member stays
   * declared.
   *
   * The value is any CSS colour or a semantic palette name, typically a
   * server-computed status colour. Resolved PER
   * RECORD by `plugin-calendar/src/ObjectCalendar.tsx`, which falls back to the
   * record's own `color` value and then to the platform default, so an authored
   * value that never arrives is invisible rather than loud.
   *
   * DERIVED from {@link CalendarConfig}, the same type the `calendar` block
   * carries, so the flat spelling cannot drift from the block spelling. That is
   * verbatim the pattern objectui#6051 established for
   * {@link ObjectGanttSchema.colorField} — the same key name, the same
   * mechanism, on this same file — and the reason this member is an indexed
   * access rather than a fresh `string`.
   *
   * Undeclared here until objectui#8466, so an authored value reached the
   * renderer only through {@link BaseSchema}'s `[key: string]: any` — admitted,
   * never examined — while `plugin-calendar/README.md` taught it as authorable.
   */
  colorField?: SpecCalendarConfig['colorField'];
  /**
   * Record field carrying the all-day flag — the FLAT spelling, read but not
   * authored: write `calendar.allDayField`, and see
   * {@link ObjectCalendarSchema.startDateField} for why the flat member stays
   * declared.
   *
   * LOAD-BEARING since objectui#8026:
   * the events pass in `plugin-calendar/src/ObjectCalendar.tsx` reads it and a
   * change to the key genuinely changes what is drawn. It is also in
   * that component's `getCalendarConfig` memo dependency list, which is what
   * makes the change reach the screen.
   *
   * Through `@objectstack/spec` 17.4.0 this key was objectui-LOCAL in both
   * positions: `CalendarConfigSchema` was a `strictObject` of exactly
   * `startDateField`, `endDateField`, `titleField` and `colorField`, and
   * answered `allDayField` and a nonsense key with the identical
   * `unrecognized_keys` diagnostic (objectui#8651). Since 17.5.0 that schema
   * declares `allDayField` too, so `calendar.allDayField` is a spec key like its
   * four neighbours (objectui#11073). This flat member is still typed `string`
   * rather than derived from {@link CalendarConfig}; the two types are equal.
   *
   * ⛔ Declaring it widens NO accept set, which is why Commandment #0.1 is not
   * engaged. Measured on spec 17.3.0: `ComponentPropsMap['object-calendar']`
   * refuses ALL FIVE flat field-name keys with `unrecognized_keys` — including
   * {@link ObjectCalendarSchema.titleField},
   * {@link ObjectCalendarSchema.startDateField} and
   * {@link ObjectCalendarSchema.endDateField} above, which have shipped
   * DECLARED for releases. This key is the fifth member of that flat handoff,
   * not a new dialect. And under `BaseSchema`'s
   * index signature the value was already `any`, so declaring only NARROWED.
   *
   * ⭐ Nor is it a new precedent: {@link CalendarViewSchema} — a sibling
   * calendar interface in the same plugin, whose OWN renderer
   * (`plugin-calendar/src/calendar-view-renderer.tsx`) reads the same five flat
   * keys — has shipped all five declared, `allDayField` included, on both
   * faces. Two interfaces, two renderers, one flat vocabulary: this interface
   * was the odd one out, not the pioneer, and the pin keeps that shared
   * vocabulary from drifting apart.
   */
  allDayField?: string;
  /**
   * Default view mode — the renderer's rendered set. `'agenda'` was retired
   * (`ed8df3e50`, following `b55a34647`): `CalendarView` renders no agenda view,
   * and the enforcement points read only these three values.
   */
  defaultView?: 'month' | 'week' | 'day';
  /**
   * Query filter — the protocol's `ViewFilterRule` array,
   * `[{ field, operator, value }, ...]`, forwarded as `$filter` on the
   * calendar's own fetch — `plugin-calendar/src/ObjectCalendar.tsx` holds it
   * through `useResolvedFilter` (`@object-ui/react`), with its
   * context tokens (`{current_user_id}`, `{current_org_id}`, the date macros) resolved first through `@object-ui/core`'s `resolveFilterPlaceholders` (objectui#10666),
   * and reads the held value at the `dataSource.find` call and again in that
   * effect's dependency list. The data adapter lowers the rule array.
   *
   * Undeclared here until objectui#8174, so an authored value reached the
   * renderer only through {@link BaseSchema}'s `[key: string]: any` — admitted,
   * never examined. That is verbatim the reasoning objectui#7322 used to move
   * `ObjectKanbanSchema.groupBy` into its interface, and this is the same
   * situation one key over: `@objectstack/spec` declares it
   * (`ComponentPropsMap['object-calendar']`), the plugin's registration
   * `inputs` declares it, the renderer reads it — this declaration face was the
   * only one that stayed silent.
   *
   * objectui#6152 round 8: the type is the row's own member BY REFERENCE
   * (`ComponentPropsMap['object-calendar'].filter`, which refuses the
   * MongoDB-style record and the AST tuple array by name). It was `any[]`,
   * spelled as {@link ObjectGanttSchema.filter} is, so a tuple array
   * type-checked here while the protocol refused it. The renderer adds nothing
   * to the value and subtracts nothing, so an AST array a host composes at
   * runtime (`ElementDataSourceGate`'s merged binding) still reaches the wire:
   * that value is not a shape an author writes, and this face does not
   * publish it (the objectui#10199 split).
   */
  filter?: SpecObjectCalendarProps['filter'];
  /**
   * Sort configuration, forwarded as `$orderby` via `convertSortToQueryParams`
   * (`plugin-calendar/src/ObjectCalendar.tsx`, the same `dataSource.find` call
   * as {@link filter} and the same effect dependency list).
   *
   * Array only — the legacy string clause is retired (objectui#8221), and
   * declaring the member is what makes that retirement audible HERE. Undeclared,
   * `sort: 'name asc'` type-checked green on {@link BaseSchema}'s index
   * signature, parsed green through the mirror's `.passthrough()`, and was then
   * DROPPED at runtime: `convertSortToQueryParams` (`@object-ui/core`,
   * `utils/sort-query.ts`) no longer admits a string in its signature and
   * returns `undefined` for one after reporting the retired spelling. So the
   * calendar rendered unsorted with nothing refusing the node.
   *
   * Spelled exactly as {@link ObjectGanttSchema.sort}, so the two views' sort
   * vocabularies cannot fork.
   */
  sort?: SortConfig[];
  /**
   * Event-click navigation — what a click on an event opens (an overlay mode,
   * the record page, a new tab, or nothing), with the overlay `size` and the
   * `openNewTab` / `preventNavigation` flags. Read by `ObjectCalendar` (its
   * `navConfig`), which hands it to `useNavigationOverlay`.
   *
   * DECLARED by objectui#8652, the objectui half of the maintainer ruling on
   * that card, verbatim 「B」: declare `navigation` on the platform element
   * schema first, then mirror it here. `@objectstack/spec` 17.5.0 is the
   * release whose `ComponentPropsMap['object-calendar']` declares it, so this
   * member follows the installed spec rather than leading it. Before it, the
   * renderer read the key through an `as any` cast — the one objectui#8651
   * left standing for this card — and the zod mirror kept any value through
   * `.passthrough()`, admitted and never examined.
   *
   * Same spec type as {@link ObjectGridSchema.navigation} and
   * {@link ObjectGanttSchema.navigation} — aligned with `@objectstack/spec`
   * `NavigationConfig` rather than restated, so the vocabulary cannot fork.
   *
   * ⚠️ The default when the key is ABSENT is the renderer's `{ mode: 'drawer' }`,
   * not the spec's `mode` default: it is documented, not declared, so a parsed
   * calendar carries the key only when the author wrote it. When the resolved
   * mode is an overlay, the calendar's own overlay wins over a parent's
   * `onRowClick` / `onEventClick`. The members are pinned where the calendar
   * reads them, in `plugin-calendar`'s `calendarNavigationMembers-8652` test.
   */
  navigation?: ViewNavigationConfig;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-calendar` reads
   * NEITHER content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its refusal
   * names `children` as the remedy, which this node does not read either. The
   * member is restated here so both faces point at what the node renders
   * instead.
   *
   * @deprecated Not a channel `object-calendar` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-calendar` reads
   * NEITHER content channel, so an authored child list here rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep: no `body` /
   * `children` read is filed under this declaration, while the same instrument
   * does see it as the receiver of the keys the renderer reads. The
   * registration hop, `ObjectCalendarRenderer` (`packages/plugin-calendar`),
   * is `any`-typed and hands the node to `ObjectCalendar`, which reads it as
   * this type. `SchemaRenderer` strips both keys out of the props bag it
   * spreads, so neither reaches the component by another route, and the
   * registration declares no `children` slot (objectui#9910).
   *
   * What it renders instead: the records of `objectName` as events from
   * `startDateField` to `endDateField`.
   *
   * @deprecated Not a channel `object-calendar` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Object Kanban Component Schema
 */
export interface ObjectKanbanSchema extends BaseSchema {
  type: 'object-kanban';
  /**
   * Per-element data binding — the spec's `ElementDataSource`, by reference
   * (objectui#11070). The board honours its `object` and `filter`, and its
   * `sort` is where the board's ordering is authored — the spec refuses a
   * top-level `sort` on this node (see {@link ObjectKanbanSchema.filter}).
   * Metadata, ⛔ not the adapter: see {@link ObjectGridSchema.dataSource}.
   */
  dataSource?: ElementDataSource;
  /**
   * ObjectQL object name — the LAST rung of this board's record-source ladder,
   * and the only one that names an object.
   *
   * `packages/plugin-kanban/src/ObjectKanban.tsx` resolves its rows in four
   * steps: the `data` PROP a parent pre-fetched (`hasExternalData`), then
   * {@link BaseSchema.bind} through `useDataScope(schema.bind)`, then the
   * inline rows on {@link BaseSchema.data}, and only then a fetch keyed by this
   * member — `rawData = external || boundData || schema.data || fetchedData`,
   * with the fetch itself gated on `schema.objectName && !boundData &&
   * !schema.data`. So a board authored on `bind` or on inline rows never reads
   * this key, and every read of it is guarded (`schema.objectName ?? ''`,
   * `if (!schema.objectName) return`, `schema.objectName || ''`).
   *
   * Optional since objectui#7780. It was REQUIRED, so a `bind`-only or
   * `data`-only board — which renders correctly today — was refused by both
   * published faces and could not be annotated with its own type. The
   * requirement the renderer really has, at least one of `bind`, `data`,
   * `objectName` present, or the node's `dataSource.object` naming the object,
   * which `ElementDataSourceGate` lands on this key (objectui#11117), lives on
   * the mirror as a refinement (`requireRecordSource` in
   * `zod/objectql.zod.ts`, with this board's own rung list), so the published
   * declaration and the published validator say the same thing.
   *
   * ⚠️ This is NOT the `object-map` / `object-gantt` / `object-calendar` ladder,
   * and the renderer shares no code with it; only the mirror's refinement is
   * shared, taking each arm's rungs as an argument. Those three resolve through
   * `resolveRecordSourceConfig` over `data` (a {@link ViewData} PROVIDER BLOCK)
   * → `staticData` → `objectName`, and their mirror members end in
   * `requireRecordSource`. This board has NO `staticData` rung, its `data` is a
   * RAW ROW ARRAY read directly, and it has a `bind` rung the other three do
   * not walk. objectui#7651 (ruled B, closed `not_planned`) refuses building
   * the shared ladder here — see `KanbanSchema.data` in `./complex.ts`, whose
   * epitaph records it. Nothing below adds a rung; this member's requiredness
   * is the only thing objectui#7780 moved.
   */
  objectName?: string;
  /**
   * Field whose value places a record in a lane (e.g. `status`).
   *
   * The lane key the `object-kanban` renderer actually reads —
   * `packages/plugin-kanban/src/ObjectKanban.tsx` reads `schema.groupBy` at
   * thirteen sites, in three clusters: the `effectiveColumns` memo (its
   * `localizeColumn` guard, its bare-string branch, its picklist branch and its
   * from-data branch), `persistCardMove`, and the `handleCardMove` callback —
   * plus their effect deps.
   *
   * ⚠️ Anchored by SYMBOL, deliberately. The docblock this replaces carried six
   * bare line addresses into that file and EVERY ONE had rotted by the time this
   * card re-derived them — the same reads now sit some 370 lines lower. The
   * numbers are not restated here even as history: a literal address in prose is
   * the thing that rots, and `check:new-cross-file-line-citations` says the same
   * in its own words — shifting an already-false address by a hunk delta only
   * moves a wrong pointer somewhere else. Undeclared here until
   * objectui#7322, so an authored value reached the renderer only through
   * {@link BaseSchema}'s `[key: string]: any` — admitted, never examined.
   *
   * OPTIONAL since objectui#8990, matching `@objectstack/spec`, which declares
   * `groupBy: z.string().optional()` on `ObjectKanbanPropsSchema`
   * (`packages/spec/src/ui/component.zod.ts`, read at objectstack
   * `eabdd66f45f402eba0f8404a8a9de4a501fc83a6`). It was REQUIRED here on both
   * faces, so this package REFUSED A DOCUMENT THE PROTOCOL ACCEPTS — the one
   * direction the maintainer principle in force forbids (2026-09-09, recorded
   * verbatim and untranslated):
   * 「我们的项目以 objectstack 协议为准，文档应该以实际实现为准。协议不正确的应该先修改协议。」
   *
   * ## The requiredness was refuted by the corpus, not just by the protocol
   *
   * objectui#7322 justified it as "every documented and tested `object-kanban`
   * node authors this key". Two lane-less producers were excluded from that
   * count at objectui#7780 and neither has gone away:
   *
   *   1. `content/docs/utilities/data-objectstack.mdx` documents an
   *      `object-kanban` node that is exactly `{ type, dataSource }` — no
   *      `groupBy`. ⚠️ WEAKER THAN IT LOOKS, and the limit is worth stating: that
   *      fragment was STILL refused after this card, at `RECORD_SOURCE_REQUIRED`
   *      — `dataSource` was not a rung of this ladder — so it was evidence that a
   *      lane-less board is a DOCUMENTED AUTHORING, not a document this card
   *      admitted. It parses since objectui#11117, which counted the node's
   *      binding as a record source, as `ElementDataSourceGate` already did.
   *   2. `packages/plugin-list/src/ListView.tsx` GENERATES the node with
   *      `groupBy: laneField`, where
   *      `laneField = groupByField || groupField || detectStatusField(objectDef) || undefined`.
   *      ⭐ This is the load-bearing one, and it is stronger than the explicit
   *      `|| undefined` alone suggests: `objectDef` loads ASYNCHRONOUSLY, so
   *      `laneField` is `undefined` on EVERY load until it lands — transiently
   *      for every list-view kanban — and PERSISTENTLY in two cases from
   *      `detectStatusField` (`packages/types/src/record-semantics.ts`): the
   *      object declares no `stageField` role AND carries no field named
   *      `status` / `stage` / `state` / `phase` and none typed `status`/`stage`;
   *      or it sets `stageField: false`, which suppresses detection outright
   *      (ADR-0085 — a status-shaped field that is not a linear flow). The
   *      renderer serves that node and both published faces refused it.
   *
   * ⇒ Evidence 2 carries this on its own; evidence 1 supports the authoring
   * shape, not the accept set. Same shape as {@link objectName} (objectui#7780):
   * a key the renderer guards at every read, declared REQUIRED, refusing boards
   * that render today.
   *
   * ## What a lane-less board actually does — MEASURED, not argued
   *
   * The `if (!schema.groupBy)` branches are defensive early-returns and the
   * board degrades rather than breaking. Rendered through `SchemaRenderer` with
   * a real `dataSource` (pinned in
   * `plugin-kanban/src/__tests__/laneLessBoard-8990.test.tsx`):
   *
   *   - no `groupBy`, no `columns` -> `effectiveColumns` falls past all three
   *     of its `schema.groupBy &&` guards and returns `[]`: an empty board, no
   *     lanes, no crash.
   *   - no `groupBy`, bare-string `columns` -> the lanes are DRAWN, titled by
   *     the raw strings (see {@link columns}); this is the arm this card
   *     unlocks.
   *   - EVERY lane-less board holds ZERO cards, whatever its `columns`.
   *     `bucketCardsIntoColumns` opens with `if (!data || !groupBy ||
   *     !Array.isArray(data)) return columns.map(...)`, so with no lane key the
   *     records are never distributed. A lane-less board is lane HEADINGS, not
   *     a populated board — which is the honest rendering of "no field places
   *     these records", and is why relaxing this key is not a licence to author
   *     it away.
   *   - card moves are inert, by the same guards: `persistCardMove` and the
   *     `handleCardMove` callback both open `if (!groupBy) return`, so nothing
   *     is written back.
   *
   * ⇒ The widening admits documents that RENDER; it does not admit documents
   * that crash. ⛔ It is NOT an invitation to omit the key: a board that groups
   * by nothing shows no cards.
   *
   * ## ⛔ What this does NOT reach — objectui#8993
   *
   * `bucketCardsIntoColumns`'s double-bucketing of a non-string lane id lives
   * AFTER that `!groupBy` early return (the `knownIds` set and the
   * `__uncolumned__` lane below it). A lane-less board returns before reaching
   * it, and the picklist-materialised lanes whose ids come straight from
   * `opt.value` are built under `if (schema.groupBy && ...)` — a branch a
   * lane-less board cannot enter. So objectui#8993's reachable set is UNCHANGED
   * by this card — admitting documents cannot shrink it, and none of the
   * documents newly admitted can reach the defect. ⛔ Not "narrowed": the
   * containment is that nothing was widened. Measured both ways in the pin file
   * above.
   */
  groupBy?: string;
  /**
   * RETIRED (objectui#7322) — the lane key this node's renderer never read.
   * `ObjectKanban.tsx` reads {@link groupBy} thirteen times and `groupField`
   * never, so a node authored from the old declaration validated, compiled,
   * and rendered a board that grouped nothing, with no diagnostic on either
   * face. Author {@link groupBy}.
   *
   * `?: never` is this package's tombstone convention (see
   * `TimelineSchema.timeScale`, objectui#6355), and it is load-bearing rather
   * than decorative: {@link BaseSchema} carried `[key: string]: any` until
   * objectui#8347, and a deletion is still refused only on a fresh literal, so
   * DELETING this member would let the retired spelling type-check green
   * through a widened value and go on doing nothing. Keeping the key declared as `never` is what makes the
   * retirement audible at the authoring boundary. Lockstep with the Zod twin
   * (`zod/objectql.zod.ts`, `retirementTombstone()`): both halves or neither.
   * Absent stays valid on both, so a node that never wrote the key is untouched.
   *
   * ⚠️ NODE-LOCAL, and a different refusal. The VIEW-LEVEL kanban config refuses
   * `groupField` by name too since objectui#6152 round 11, naming `groupByField`,
   * but its READERS stay: `packages/core/src/utils/normalize-list-view.ts` still
   * folds a stored one forward, and `plugin-list`'s `ListView` and `plugin-view`'s
   * `ObjectView` still read it. On the `object-kanban` node nothing reads it.
   *
   * @deprecated RETIRED (objectui#7322) — author `groupBy` instead.
   */
  groupField?: never;
  /**
   * Swimlane definitions — the lanes the board draws, NOT a field projection
   * (the fields drawn on a card are {@link cardFields}).
   *
   * Declared here by objectui#8913. Until then this key rode
   * {@link BaseSchema}'s `[key: string]: any` on this face: the renderer read
   * it at three sites while neither published face of this package named it,
   * so `columns: "todo"`, `columns: [42]` and a lane card with no `title` all
   * parsed green. Declaring on a face that carries an index signature (as this
   * one did until objectui#8347) can only NARROW — it adds validation where there was none — and that is
   * the whole of what this member does.
   *
   * ⚠️ Narrowing is not licence to bless whatever the protocol's literal
   * `z.unknown()` would take: a shape the RENDERER mishandles must not be
   * declared valid, or the declaration becomes a promise nothing keeps. Two
   * such shapes were caught in contract review and are refused here — a
   * numeric lane id (see {@link id}) and a mixed array (see below).
   *
   * ## ⭐ TWO ARRAY SHAPES, not a union per element — and the shape is the
   * protocol's, not this repository's
   *
   * `@objectstack/spec` declares this key on `ObjectKanbanPropsSchema`
   * (`packages/spec/src/ui/component.zod.ts`, read at objectstack
   * `eabdd66f45f402eba0f8404a8a9de4a501fc83a6`) as
   * `z.array(z.unknown()).optional()` whose `describe` states the shape in
   * prose: "Swimlane definitions ({ id, title } per `groupBy` value, or bare
   * value strings) — NOT a field projection". Both arms are admitted here
   * WHOLE, per the maintainer principle in force (2026-09-09, recorded verbatim
   * and untranslated):
   * 「我们的项目以 objectstack 协议为准，文档应该以实际实现为准。协议不正确的应该先修改协议。」
   *
   * ⛔ What is NOT admitted is a MIXED array, and objectui#8913's first cut
   * admitted one by spelling this as an array of a per-element union. The
   * protocol's "or" reads as two array shapes, it names no mixed example, and
   * the renderer cannot serve one: `effectiveColumns` dispatches on
   * `columns[0]` ALONE (`plugin-kanban/src/ObjectKanban.tsx`), so an
   * object-first mix sends every string element down the object branch and a
   * string-first mix is ignored whole. Measured on the real bucketer with
   * `[{ id: 'done', title: 'Done' }, 'todo']`: lanes come back
   * `done:r2, undefined:, __uncolumned__:r1` — a blank lane whose own keys are
   * `["0","1","2","3","cards"]` (the string spread character by character) and
   * the `todo` record in "Uncategorized" rather than its lane. Admitting a
   * shape whose only outcome is a broken board is the declared-but-not-honoured
   * defect this card exists to remove, one layer up. If a later ruling reads
   * the protocol's prose as a per-element union, that is an
   * `@objectstack/spec` card and this member follows it.
   *
   * ## ⛔ Why this is NOT `KanbanColumn[]`, which is what the card proposed
   *
   * {@link KanbanColumn} requires `cards`. It is the RUNTIME lane shape — what
   * `bucketCardsIntoColumns` produces and what `KanbanImpl` consumes (the one
   * board since objectui#8932 deleted `KanbanEnhanced`), with `cards` always
   * filled — and using it as the AUTHORING
   * element would refuse three live shapes, each measured rather than argued:
   *
   *   1. the protocol's own gate-validated example
   *      (`content/docs/protocol/objectui/layout-dsl.mdx`, under an
   *      `os:check-yaml PageComponentSchema` fence) authors three lanes as
   *      `{ id, title }` with no `cards`;
   *   2. the renderer never requires `cards` — `bucketCardsIntoColumns` reads
   *      `col.cards || []` on both of its legs, and the lanes it materializes
   *      from a picklist or from the data carry no `cards` at all;
   *   3. this repository's own typed corpus authors `columns: [{ id, title }]`
   *      under `satisfies ObjectKanbanSchema` in several `plugin-kanban` board
   *      tests.
   *
   * ⇒ `cards` is OPTIONAL on the authoring arm. A lane that carries it is a
   * static board's lane and its cards are judged; a lane that does not is a
   * swimlane and receives its cards from the record source.
   *
   * ## The member set is the READ set
   *
   * `id` / `title` / `cards` / `limit` / `className` / `collapsed` are exactly
   * the lane members the board reads, counted when there were two board
   * implementations off `KanbanImpl`, `KanbanEnhanced`, `useCrossSwimlaneMove`,
   * `useQuickAddReorder` and `bucketCardsIntoColumns`. Their VALUE types come
   * from those read sites too — see {@link id} for the one this card had to
   * correct. objectui#8932 later deleted `KanbanEnhanced`; `KanbanImpl` alone
   * still reads all six members.
   *
   * ## ⭐ The bare-string arm is REACHABLE since objectui#8990
   *
   * The `object-kanban` renderer honours a bare-string lane list only when no
   * `groupBy` is authored (`ObjectKanban.tsx`, the `effectiveColumns` memo:
   * the string branch returns only under `if (!schema.groupBy)`). While
   * {@link groupBy} was REQUIRED, no document that passed this schema could
   * reach that branch, and objectui#8913 admitted the arm anyway — refusing it
   * would have made objectui narrower than the protocol — recording it as
   * inert. objectui#8990 made {@link groupBy} OPTIONAL, which is what makes the
   * arm reachable BY A SCHEMA-VALID DOCUMENT: a `groupBy`-less board with
   * `columns: ['todo', 'doing']` now parses AND draws those two lanes, titled by
   * the raw strings.
   *
   * ⚠️ The qualifier is load-bearing, and matches {@link groupBy}'s. The RENDERER
   * never consulted this package's validator — `SchemaRenderer` runs core's
   * structural `validateSchema`, which carries no kanban rule — so the string
   * branch was always live for a document that reached it WITHOUT passing the
   * published faces (`ListView.tsx`'s generated node; any host not running
   * `os check`). What the requiredness prevented was a document being valid AND
   * getting there. ⛔ Do not restate this as "the arm was dead code".
   *
   * ⚠️ RAW strings, not localized labels, and the difference is the arm's
   * signature. The string branch returns `{ id: val, title: val }` and never
   * calls `localizeColumn`; the picklist branch a GROUPED board takes returns
   * the option LABELS. Measured on one object whose `status` options are
   * `todo -> 'To Do'` / `doing -> 'Doing'`: lane-less draws `todo` / `doing`,
   * the grouped control draws `To Do` / `Doing`.
   *
   * ⚠️ Reachable is not populated: every lane-less board holds ZERO cards,
   * because `bucketCardsIntoColumns` early-returns before distributing records
   * when there is no lane key. See {@link groupBy} for the full measured vector.
   * Pinned in `plugin-kanban/src/__tests__/laneLessBoard-8990.test.tsx`.
   *
   * ⚠️ An undeclared lane key is ACCEPTED AND DROPPED from the parsed output,
   * not refused — the lane arm is a plain (non-passthrough) object, the same
   * posture {@link KanbanColumn}'s mirror carries. That is the TOLERANT face's
   * posture: the strict authoring twin refuses the same key by name. The
   * `color` tombstone that mirror holds is deliberately NOT carried here: it
   * retired with the `kanban` arm (objectui#7664) and refusing a key BY NAME on
   * this face is a separate decision, not part of this declaration.
   *
   * Pinned in `./__tests__/object-kanban-columns-declared-8913.test.ts`.
   */
  columns?:
    | string[]
    | Array<{
        /**
         * Lane id, matched against the `groupBy` value.
         *
         * STRING only. objectui#8913's first cut admitted a number here on the
         * reading that "the renderer coerces with `String(col.id)`" — TRUE at
         * the i18n lookup in `localizeColumn`, and FALSE, at the time, where
         * lane membership is decided: `bucketCardsIntoColumns` built its
         * `knownIds` set from the RAW `col.id` and compared it against
         * `Object.keys(groups)`, which are always strings. Measured by calling
         * the real function with lanes `{ id: 1 }, { id: 2 }` and records
         * `status: 1` / `status: '2'`: `1:r1, 2:r2, __uncolumned__:r1+r2` —
         * every card rendered TWICE, once in its lane and once in
         * "Uncategorized"; the string control was a clean `one:r1`.
         * objectui#8993 repaired that sweep, so the two decisions now use one
         * key spelling — the narrowing stays because the retired arm
         * ({@link KanbanColumn.id}) and its mirror are `string` too and one
         * declared type per lane id beats two, not because the renderer is
         * still broken.
         */
        id: string;
        /** Lane heading; localized against the `groupBy` picklist's option labels. */
        title: string;
        /**
         * Cards this lane carries. Present on a STATIC board only: an
         * object-bound board's cards arrive from the record source and are
         * bucketed into the lane by `groupBy`.
         */
        cards?: KanbanCard[];
        /** WIP limit — the card count at which the lane warns. Never reaches the query. */
        limit?: number;
        className?: string;
        /**
         * Whether the lane renders collapsed — narrowed to a title spine with
         * its cards withheld, and reopenable by the viewer, who then owns the
         * state for the session. Honoured on both of the registered board's
         * layouts since objectui#9628; see {@link KanbanColumn.collapsed}.
         */
        collapsed?: boolean;
      }>;
  /**
   * Row cap — the most records the board fetches, sent as a real `$top` on
   * the query (`packages/plugin-kanban/src/ObjectKanban.tsx`,
   * `$top: resolveRowLimit(schema.limit, DEFAULT_KANBAN_FETCH_BATCH_SIZE)`; objectui#4025,
   * re-spelled by objectui#9925, which refuses a non-positive cap rather than
   * forwarding it). The board renders every fetched record into a lane and
   * offers no pagination, so this is the author's window on the object rather
   * than a page size. A bound `dataSource` (its own `limit`, or the named
   * view's `pagination.pageSize`) sets it too. Undeclared until objectui#7322.
   *
   * @default 100 — `DEFAULT_KANBAN_FETCH_BATCH_SIZE`
   */
  limit?: number;
  /**
   * Query filter — the protocol's `ViewFilterRule` array,
   * `[{ field, operator, value }, ...]`, forwarded as `$filter` on the board's
   * own fetch — `plugin-kanban/src/ObjectKanban.tsx` holds it through
   * `useResolvedFilter` (`@object-ui/react`), with its
   * context tokens (`{current_user_id}`, `{current_org_id}`, the date macros) resolved first through `@object-ui/core`'s `resolveFilterPlaceholders` (objectui#10666),
   * and reads the held value at the `dataSource.find` call, alongside the
   * `$top` that {@link limit} feeds, and again in that effect's dependency list.
   *
   * Undeclared here until objectui#8174, so an authored value reached the
   * renderer only through {@link BaseSchema}'s `[key: string]: any` — admitted,
   * never examined. That is verbatim the reasoning objectui#7322 used to move
   * {@link groupBy} and {@link limit} into this interface; this is the same
   * situation one key over. `@objectstack/spec` declares it
   * (`ComponentPropsMap['object-kanban']`), the plugin's registration `inputs`
   * declares it, the renderer reads it — this declaration face was the only one
   * that stayed silent.
   *
   * objectui#6152 round 8: the type is the row's own member BY REFERENCE
   * (`ComponentPropsMap['object-kanban'].filter`, which refuses the
   * MongoDB-style record and the AST tuple array by name), as
   * {@link ObjectCalendarSchema.filter}'s is. It was `any[]`, spelled as
   * {@link ObjectGanttSchema.filter} is, so a tuple array type-checked here
   * while the protocol refused it. The board adds nothing to the value and
   * subtracts nothing, so an AST array a host composes at runtime
   * (`ElementDataSourceGate`'s merged binding) still reaches the wire, where
   * the data adapter lowers either form: that value is not a shape an author
   * writes, and this face does not publish it (the objectui#10199 split).
   *
   * ⚠️ There is deliberately NO `sort` twin on this interface: the spec's
   * `object-kanban` entry declares no top-level `sort` (and refuses one). The
   * board's ordering is authored on the per-element binding instead —
   * `dataSource.sort`, which `ElementDataSourceGate` hands to `ObjectKanban` as
   * `schema.sort` and the fetch lowers onto `$orderby` (objectui#10068). That
   * read is the gate's carrier, not an authoring key. Only
   * {@link ObjectCalendarSchema} declares both keys.
   */
  filter?: SpecObjectKanbanProps['filter'];
  /**
   * The record field rendered as each card's title — the CANONICAL spelling of
   * the one card-title choice this board reads two ways
   * (`cardTitle || titleField`), and the spelling `@objectstack/spec`,
   * `plugin-kanban`'s registration `inputs` and this repository's own root
   * README all tell authors to prefer.
   *
   * Undeclared on BOTH published faces of this arm until objectui#9606, while
   * its legacy alias {@link titleField} beside it was declared — so the key
   * authors are told to use was the one neither face judged. It reached the
   * renderer through {@link BaseSchema}'s `[key: string]: any` and the zod
   * mirror's `.passthrough()`: `cardTitle: 42` validated GREEN and kept the
   * `42`, which `resolveKanbanTitleField` returns as a record field name, while
   * the protocol's `ObjectKanbanPropsSchema` refused the same document.
   *
   * ⛔ Declaring it does NOT retire {@link titleField} (director seat, batch
   * #150 item 3, letter 1): a mirror cannot be narrower than the spec it
   * mirrors, and `@objectstack/spec` still declares the alias. If the alias is
   * ever retired, that starts in the spec on its own card.
   *
   * Optional here and optional in the zod mirror, so the two faces accept and
   * refuse the same documents. ⚠️ That agreement is NOT held by the
   * zod-mirror-parity ratchet, and this comment said it was until the claim was
   * measured: with the key on the mirror and this member deleted, `type-check`
   * exits 0, including the `tsc -p tsconfig.test.json` leg that judges the
   * ratchet. The ratchet has `UnmirroredDeclaredKeys` for declared-but-unmirrored
   * and no counterpart for the reverse — one direction closed by name, its
   * reverse left open (objectui#9711).
   *
   * What this member buys, measured: {@link BaseSchema}'s `[key: string]: any`
   * admitted `cardTitle: 42` in a typed corpus until objectui#8347, and with the
   * member declared `tsc` refuses it. The `@ts-expect-error` row in
   * `__tests__/object-kanban-card-title-9606.test.ts` guards the member's TYPE;
   * it no longer catches a deletion, because since objectui#8347 a deleted
   * member's `42` is refused as an undeclared key and the directive stays used.
   */
  cardTitle?: string;
  /** Field for card title */
  titleField?: string;
  /** Fields to display on card */
  cardFields?: string[];
  /**
   * The record field that splits the board into horizontal swimlanes, across
   * the `groupBy` columns.
   *
   * `@objectstack/spec` declares it on this block
   * (`ComponentPropsMap['object-kanban'].swimlaneField`, an optional string),
   * so the type is that row's, by reference. `ObjectKanban` reads it, and the
   * registration publishes it as an input.
   *
   * Undeclared on both faces of this package until objectui#11355, so the read
   * reached it only through {@link BaseSchema}'s index signature. The same read
   * falls back to `grouping.fields[0].field` when this key is absent; see
   * {@link ObjectKanbanSchema.grouping}.
   */
  swimlaneField?: SpecObjectKanbanProps['swimlaneField'];
  /**
   * The FALLBACK source of {@link ObjectKanbanSchema.swimlaneField}:
   * `ObjectKanban` reads `grouping.fields[0].field` when no `swimlaneField` is
   * authored, and reads nothing else inside the block.
   *
   * `@objectstack/spec` types this key on the `object-kanban` row as the list
   * view's own `GroupingConfigSchema`, by reference, so the type is the spec's
   * `GroupingConfig` — the one `ObjectGridSchema.grouping` takes — and the zod
   * mirror takes the same schema by reference (objectui#11216). Undeclared on
   * both faces until then, so the read reached it only through
   * {@link BaseSchema}'s index signature, and the strict authoring face refused
   * a well-formed config by name.
   */
  grouping?: GroupingConfig;

  /**
   * RETIRED (objectui#8285, ruling B of the director seat's decision batch #91,
   * 2026-09-08) — this element offers no inline record creation, so the key has
   * nothing to switch on. Refused by name on both faces of this package, as
   * `@objectstack/spec` 17.5.0 refuses it (`ComponentPropsMap['object-kanban']`
   * tombstones the same key).
   *
   * ## Why it never did anything on this element
   *
   * The Quick Add control is gated on BOTH `quickAdd` and an `onQuickAdd`
   * handler, and that handler is a host-supplied function no JSON document can
   * carry; `ObjectKanban` supplies none of its own. So an authored
   * `quickAdd: true` parsed green and drew nothing. The ruling chose to retire
   * the key rather than grow a record-creation write path on the board, and
   * `ObjectKanban` now stops forwarding the key as well, so the refusal is not
   * only a validator's opinion.
   *
   * ## Where the control still works
   *
   * On `KanbanRenderer`, exported from `@object-ui/plugin-kanban`: a React host
   * that mounts that component directly passes `quickAdd` and `onQuickAdd` on
   * its `schema`, and the pair reaches the board unchanged. No node type key
   * resolves to that component since the `kanban-ui` tag retired
   * (objectui#8257), so this is a host capability, not a document one.
   *
   * A tombstone rather than a deleted member because `BaseSchema` carried an
   * index signature when this was written: a deleted member would type as
   * `any` and be KEPT, not refused. Since objectui#8347 a deletion is refused
   * on a fresh literal, but a widened value still carries the key silently. Pinned in `__tests__/object-kanban-quick-add-retired-8285.test.ts`.
   *
   * @deprecated Not part of this contract — delete the key.
   */
  quickAdd?: never;

  /**
   * Field name to use as cover image on cards.
   * The field value should be a URL string or file object with a `url` property.
   */
  coverImageField?: string;

  /**
   * RETIRED (objectui#8801, ADR-0049 enforce-or-remove; director seat, class-1
   * self-adjudication of 2026-09-16, letter A). An authored `allowCollapse` was
   * accepted by BOTH published faces of this arm and collapsed nothing.
   *
   * ## The protocol row is what decides it
   *
   * `@objectstack/spec`'s `ComponentPropsMap['object-kanban']` —
   * `ObjectKanbanPropsSchema` — has never declared the key, and the token
   * occurs nowhere in the installed package's published sources (re-measured
   * against the pinned install, with `groupBy` and `coverImageField` firing as
   * controls in the same pass). That schema is a `strictObject`, so the
   * PLATFORM already refuses an authored `allowCollapse` by name at publish
   * while this declaration said yes: `tsc` agreed, and the document was
   * rejected whole. This tombstone is what makes `tsc` say the same thing.
   *
   * ## Zero read sites, and both unnamed channels terminate
   *
   * `@object-ui/plugin-kanban` names the token in ZERO files, and that zero is
   * a reading rather than a dead grep because live sibling keys fire as
   * controls on the same instrument and the same run — `groupBy`,
   * `conditionalFormatting` and `coverImageField`. (`quickAdd` stood in this
   * list until it was retired on this element too, objectui#8285.)
   *
   * ⛔ Their per-key counts are deliberately NOT written here (AGENTS.md #9).
   * A figure in prose is derived once and re-derived never: the four that used
   * to stand in this paragraph had already drifted by the time they landed, and
   * a reader who spot-checked them would have confirmed a number the population
   * underneath had already moved out from under. Point at the instrument
   * instead — the walk re-runs on every test run, as the `it` named
   * "`@object-ui/plugin-kanban` names it in ZERO files, with controls firing in
   * the same pass" in
   * `packages/types/src/__tests__/object-kanban-allow-collapse-retired-8801.test.ts`.
   * The ZERO above is that test's own assertion rather than a remembered
   * reading, which is why it stays here while the control counts do not.
   *
   * A source grep alone cannot answer the inertness question, because a
   * renderer may consume a key it never names; both such channels were traced
   * to their ends:
   *
   *   - the PROP channel — `SchemaRenderer` spreads every non-metadata key as a
   *     React prop, `ObjectKanbanRenderer` destructures `schema` and forwards
   *     its rest into `ObjectKanban`, whose first statement after its own
   *     destructure is `void _props;`. The rest is discarded and never spread
   *     onward.
   *   - the SCHEMA channel — the key does ride `ObjectKanban`'s `{ ...schema }`
   *     spread into `effectiveSchema`, which reaches the internal
   *     `KanbanBoardCore` (the board `KanbanRenderer` also renders, since
   *     objectui#11234); that component NAMES every key it hands to the lazy
   *     board. An unnamed key stops there.
   *
   * ## Where collapse actually lives, so the remedy is not a second fiction
   *
   * Lane collapse is {@link KanbanColumn.collapsed}'s — a PER-LANE member, not
   * a board-level authored toggle: it is written on the lane the author wants
   * collapsed, inside `columns`, and the board THIS arm renders honours it on
   * both of its layouts since objectui#9628 — the lane starts collapsed and the
   * viewer can open it again.
   *
   * ⚠️ When this key retired that per-lane member was itself
   * declared-but-unhonoured on the registered board, read only by
   * `KanbanEnhanced`, which is referenced by no registration since the
   * `kanban-enhanced` node key retired (objectui#8257); objectui#9628 repaired
   * that at the reader rather than by retiring a second key. The distinction
   * this key's retirement rests on is unchanged either way: per-LANE collapse
   * is the author's to declare, while SWIMLANE collapse is the VIEWER's alone
   * — `KanbanImpl` collapses a swimlane row when its header button is clicked
   * and persists that set per `swimlaneField` under the storage key
   * `objectui:kanban-collapsed:` + that field, and no authored key reaches it.
   *
   * ⇒ delete the key; there is no board-level replacement to rename it to, and
   * nothing that worked stops working.
   *
   * ## Why a tombstone rather than a plain deletion
   *
   * {@link BaseSchema}'s mirror ends `.passthrough()` (and the interface carried
   * `[key: string]: any` until objectui#8347), so a deleted member is KEPT, not
   * refused, on the zod face — one silent no-op traded for another. The member therefore stays declared and
   * unwritable on both faces, paired with a `retirementTombstone()` on the zod
   * twin so the value is refused BY NAME instead of stripped, which is also
   * what keeps the two faces' key sets equal for the parity ratchet.
   *
   * ⚠️ The sibling `kanban` arm's same-spelled key is NOT this one and its
   * retirement did not reach here. Batch #70 tombstoned `allowCollapse` on
   * `KanbanSchema`, and objectui#8802 then removed that arm whole — those
   * refusals were arm-scoped by construction, so a `type: "object-kanban"`
   * document went on being accepted. This is the decision for this arm.
   *
   * @deprecated Not part of this contract — the value was accepted and dropped.
   */
  allowCollapse?: never;

  /**
   * Conditional formatting rules for card colouring, each `{ condition, style }`
   * evaluated against the card's own record; the first matching rule styles
   * the card. The native `{ field, operator, value }` rule and a top-level
   * colour key are refused by name (objectui#11522) — see
   * {@link KanbanConditionalFormattingRule}.
   */
  conditionalFormatting?: KanbanConditionalFormattingRule[];

  /**
   * Card-click navigation — what a click on a card opens (an overlay mode, the
   * record page, a new tab, or nothing), with the overlay `size` and the
   * `openNewTab` / `preventNavigation` flags. Read by `ObjectKanban` (its
   * `navConfig`), which hands it to `useNavigationOverlay`.
   *
   * DECLARED by objectui#8652, the objectui half of the maintainer ruling on
   * that card, verbatim 「B」: declare `navigation` on the platform element
   * schema first, then mirror it here. `@objectstack/spec` 17.5.0 is the
   * release whose `ComponentPropsMap['object-kanban']` declares it, so this
   * member follows the installed spec rather than leading it. Before it, the
   * renderer's read compiled only through {@link BaseSchema}'s
   * `[key: string]: any`, and the zod mirror kept any value through
   * `.passthrough()` — admitted, never examined — so `navigation: { mode:
   * 'not-a-mode' }` passed both published faces of this package.
   *
   * Same spec type as {@link ObjectGridSchema.navigation} and
   * {@link ObjectGanttSchema.navigation} — aligned with `@objectstack/spec`
   * `NavigationConfig` rather than restated, so the vocabulary cannot fork.
   *
   * ⚠️ The default when the key is ABSENT is the renderer's `{ mode: 'drawer' }`,
   * not the spec's `mode` default: it is documented, not declared, so a parsed
   * board carries the key only when the author wrote it. A click handler from a
   * parent view (`onRowClick`, or {@link ObjectKanbanSchema.onCardClick})
   * outranks this key outright. The members are pinned where the board reads
   * them, in `plugin-kanban`'s `kanbanNavigationMembers-8652` test.
   */
  navigation?: ViewNavigationConfig;

  /**
   * Card click handler.
   *
   * RUNTIME SLOT (objectui#6124 shape; declared by `5a41ce733`) — a
   * host-supplied function, NOT authorable metadata: JSON has no function
   * value, so the zod twin refuses this key by name and points at the node-type
   * spelling. Kept callable here because the function REACHES the board and
   * RUNS: `SchemaRenderer` spreads every non-metadata schema key as a React
   * prop, `ObjectKanbanComponentProps` declares an `onCardClick` prop, and
   * `ObjectKanban` forwards that prop into `useNavigationOverlay` as its
   * `onRowClick` — where `handleClick` gives it FULL PRIORITY and calls it.
   *
   * ⭐ CORRECTED, NOT QUIETLY EDITED (objectui#9341). This paragraph used to
   * end "and `ObjectKanban`'s own click wrapper calls it", which was true and
   * was ALSO the defect: the wrapper called the authored function a SECOND
   * time, on top of the `handleClick` call above, so one card click ran it
   * twice. The wrapper's call is gone; the CHANNEL and every word of the
   * argument below survive, because the prop still reaches the hook and the
   * hook still runs it. Only the identity of the call SITE moved.
   *
   * ⚠️ It is NOT the function the board implementation receives — `ObjectKanban`
   * substitutes its own wrapper on the schema it hands down, because that
   * wrapper also owns the record-detail overlay. Reachability here is the PROP
   * channel, and that is the whole difference between this key and the sibling
   * `onCardMove` BELOW, which is a tombstone: "the wrapper overrides it" is true
   * of both and separates neither. `onCardMove` has no prop channel on this
   * element — `ObjectKanban` declares no such prop and discards its rest
   * parameter — so an authored one reaches nothing, which is the `'retired'`
   * reading objectui#9342 landed once `KanbanRenderer`'s read had moved off the
   * document and onto an explicit React prop.
   *
   * ⚠️ TWO PARAMETERS since objectui#9341, and the second is what the surviving
   * channel actually delivers: `handleClick` forwards `onRowClick(record,
   * event)` so a host can implement Cmd/Ctrl/middle-click. The call this
   * declaration used to describe — one argument — is the one that was deleted;
   * declaring one here would have described only the dropped call.
   *
   * ⛔ `event` is `any` rather than `HandleClickModifiers`, and that is a
   * MEASURED constraint, not a shortcut: that interface lives in
   * `@object-ui/react`, which depends on THIS package and which this package's
   * manifest does not name in any dependency field — so naming it here is a
   * phantom dependency (`check:phantom-deps`) and closes a cycle. Re-declaring its three fields inline would
   * put a second copy of one contract on a published face. `event?: any` is the
   * spelling `BaseSchema`'s own `onClick` / `onChange` / `onSubmit` already use
   * for exactly this situation, one file over. What actually arrives is the DOM
   * click event `KanbanImpl` forwards, typed `React.MouseEvent` there.
   */
  onCardClick?: (card: any, event?: any) => void;

  /**
   * RETIRED (objectui#6124, ADR-0049; landed by objectui#9342 on the ruling
   * recorded on PR objectui#9338) — JSON has no function value, and on this
   * element an authored `onCardMove` reached NOTHING even as a programmatic
   * value. `ObjectKanban` substitutes its own `handleCardMove` on the schema it
   * hands down — that wrapper owns the optimistic write, the required-fields
   * dialog and the objectui#4138 rollback — and declares no `onCardMove` React
   * prop, so neither channel delivered. Measured by driving the handler the
   * board was actually handed, with `onCardClick` as the lit control on the
   * same document and the same render.
   *
   * ⚠️ RETIRED, not a RUNTIME SLOT, and the two are not interchangeable here.
   * A slot keeps this member callable, which would publish a key the
   * object-bound board DROPS — the resolution this package's `quickAdd`
   * carve-out forbids in as many words. The sibling `onCardClick` above IS a
   * slot because its function reaches the board through a React prop this
   * element declares; `onCardMove` has no such prop.
   *
   * Where the mover lives now: `KanbanRendererProps.onCardMove`, an explicit
   * React prop of `@object-ui/plugin-kanban`'s `KanbanRenderer`, a sibling of
   * its `schema` — the objectui#7742 remedy `objectFields` took one card
   * earlier. Until that read moved, `check:handler-key-reads` refused this very
   * tombstone, because a tombstone "has no read site BY CONSTRUCTION".
   *
   * @deprecated Not part of this contract — the value was accepted and dropped.
   */
  onCardMove?: never;

  /**
   * RETIRED (objectui#11234, completing ruling B of the director seat's
   * decision batch #91 on objectui#8285) — this element offers no inline record
   * creation, so the Quick Add handler has nothing to switch on. Refused by name
   * on both faces: `?: never` here, `handlerKeyRefusal(…, 'retired', …)` on the
   * zod twin.
   *
   * ## Why it was a runtime slot, and why it no longer is
   *
   * It was a RUNTIME SLOT (objectui#6124 shape; declared by `5a41ce733`): a
   * host-supplied function rode `ObjectKanban`'s schema spread and reached the
   * board implementation BY IDENTITY. On this element that switched nothing on.
   * The Quick Add control is gated on BOTH halves of a pair, and the other half,
   * `quickAdd`, is RETIRED here (objectui#8285). So a function supplied here
   * reached the board and was never called. A TypeScript host or an AI writing
   * the key compiled and got nothing, which is the "declared = enforced" gap.
   *
   * `check:handler-key-reads` refuses a tombstone while a renderer still reads
   * the key off the document. So objectui#11234 moved the read first:
   * `ObjectKanban` renders an internal board that takes the Quick Add pair only
   * as explicit props, and it supplies neither half. No renderer on the
   * `object-kanban` path reads this key any more.
   *
   * ## Where the pair still works
   *
   * On `KanbanRenderer`, exported from `@object-ui/plugin-kanban`: a React host
   * that mounts that component directly passes `quickAdd` and `onQuickAdd` on
   * its `schema`, and the control calls the host's function. That component
   * keeps both keys on its own props, unchanged. No node type key resolves to it
   * since the `kanban-ui` tag retired (objectui#8257), so this is a host
   * capability, not a document one.
   *
   * ⚠️ RETIRED, not a RUNTIME SLOT, and the two are not interchangeable here:
   * a slot keeps this member callable, which publishes a key the object-bound
   * board never calls. That is the `onCardMove` reading beside it, for the same
   * reason. Pinned in `__tests__/object-kanban-on-quick-add-retired-11234.test.ts`.
   *
   * @deprecated Not part of this contract — delete the key. To offer Quick
   * Add, mount `KanbanRenderer` and pass the pair on its `schema`.
   */
  onQuickAdd?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-kanban` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its refusal
   * names `children` as the remedy, which this node does not read either. The
   * member is restated here so both faces point at what the node renders
   * instead.
   *
   * @deprecated Not a channel `object-kanban` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-kanban` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep: no `body` /
   * `children` read is filed under this declaration, while the same instrument
   * does see it as the receiver of the keys the renderer reads. The
   * registration hop, `ObjectKanbanRenderer` (`packages/plugin-kanban`), is
   * `any`-typed and hands the node to `ObjectKanban`, which reads it as this
   * type. `SchemaRenderer` strips both keys out of the props bag it spreads,
   * so neither reaches the component by another route, and the registration
   * declares no `children` slot (objectui#9910).
   *
   * What it renders instead: the records of `objectName` as lanes grouped by
   * `groupBy`, with `cardFields` on each card.
   *
   * @deprecated Not a channel `object-kanban` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Conditional formatting rule for Kanban cards — ONE dialect, the spec list
 * view's `{ condition, style }`: a CEL `condition` over the card's `record.*`
 * and a CSS `style` map, first matching rule wins (objectui#11522).
 *
 * It IS {@link SpecConditionalFormattingRule}, the protocol's rule by reference
 * (its `condition` indexes `ObjectListViewSchema`'s own slot, objectui#10946),
 * plus the retired keys declared `?: never`, so each is refused BY NAME:
 *
 *   - the native comparison `{ field, operator, value, backgroundColor,
 *     borderColor }` (#1584 accepted it beside the spec shape; the
 *     `KanbanNativeConditionalFormattingRule` interface that declared it is
 *     gone), and
 *   - a colour written at the TOP LEVEL of a rule — `backgroundColor`,
 *     `borderColor`, `textColor` — including the "flat CEL" rule
 *     `{ condition, backgroundColor }`. A colour belongs inside `style`
 *     (`textColor` is `style.color`).
 *
 * Retired, not widened, with no alias window (triage ruling 5963861071 on
 * objectui#11522; the producer census it rests on is recorded on that card and
 * its pull request, not here). `@objectstack/spec` types `object-kanban`'s
 * member by reference to the list view's, which refuses both.
 *
 * Respelling: `{ field: 'priority', operator: 'equals', value: 'high',
 * backgroundColor: '#fee2e2' }` is `{ condition: "record.priority == 'high'",
 * style: { backgroundColor: '#fee2e2' } }`.
 *
 * ⚠️ What did NOT narrow: the shared evaluator. `@object-ui/core`'s
 * `resolveConditionalFormatting` still reads every arm, as a compatibility read
 * for rules already STORED in the native dialect — since objectui#11533 the
 * grid's and the list view's {@link ConditionalFormattingRule} retires them on
 * the authoring face too; the board paints whatever a relay hands it. A
 * `{ condition, style }` rule paints a card exactly as it did before.
 *
 * The zod twin is `KanbanConditionalFormattingRuleSchema` in
 * `./zod/objectql.zod.ts`, each retired key a `retirementTombstone()` there.
 */
export interface KanbanConditionalFormattingRule extends SpecConditionalFormattingRule {
  /** @deprecated RETIRED (objectui#11522) — the native rule dialect. Write `condition` as CEL over `record.*`. */
  field?: never;
  /** @deprecated RETIRED (objectui#11522) — the native rule dialect. Write `condition` as CEL over `record.*`. */
  operator?: never;
  /** @deprecated RETIRED (objectui#11522) — the native rule dialect. Write `condition` as CEL over `record.*`. */
  value?: never;
  /** @deprecated RETIRED (objectui#11522) — a top-level colour. Write `style: { backgroundColor }`. */
  backgroundColor?: never;
  /** @deprecated RETIRED (objectui#11522) — a top-level colour. Write `style: { borderColor }`. */
  borderColor?: never;
  /** @deprecated RETIRED (objectui#11522) — a top-level colour. Write `style: { color }`. */
  textColor?: never;
}

/**
 * Object Chart Component Schema — the node `plugin-charts`' `ObjectChart`
 * renders (registered as `object-chart`) and, since objectui#7946, the anchor
 * of the published `ObjectChartProps.schema`.
 *
 * Until that card this shape anchored NOTHING: `ObjectChart` was published as
 * `(props: any)`, so every `schema={{ … }}` literal handed to it was checked
 * against nothing at all, and four keys its producers write and its renderer
 * reads — `xAxisKey`, `series`, `aggregate`, `filter` — were declared on
 * neither this interface nor its zod mirror. They rode `BaseSchema`'s
 * `[key: string]: any` / `.passthrough()` and arrived UNVALIDATED.
 *
 * ## AUTHORABLE vs INTERNAL, per key (objectui#7946, ADR-0049)
 *
 * The four keys added by that card do NOT share one verdict, and the ruling
 * asked for the reading rather than the assumption:
 *
 *   - `aggregate` — AUTHORABLE, and declared BY REFERENCE as the spec's own
 *     `ChartAggregate`. `ChartAggregateSchema` calls itself "Inline aggregation
 *     for an OBJECT-bound chart", names its carrier as the react tier's
 *     `<ObjectChart objectName aggregate={…}>` (ADR-0081), and objectstack#5020
 *     wired the publish gate (`validate-react-page-props.ts` calls
 *     `ChartAggregateSchema.safeParse()`). This component's registry `inputs`
 *     advertises it too. Because the spec already owns the shape, the ONLY
 *     defensible declaration here is that same symbol: two dialects on one
 *     published key is the drift this whole card exists to close, and the
 *     member doc records what the first cut's local near-copy published.
 *   - `filter` — AUTHORABLE. The spec spells the carrier literally
 *     (`ChartAggregateSchema`'s own guidance: "`filter` is a prop on the chart
 *     itself (`<ObjectChart filter={…}>`)"), declares `ObjectChart.filter` as a
 *     `FilterArray` in its react-blocks prop table, and this component's
 *     registry `inputs` advertises `{ name: 'filter', type: 'array' }`.
 *   - `xAxisKey` — INTERNAL (relay-composed). `ChartRendererProps` calls it
 *     "Internal binding. Authors write the spec `xAxis: { field }`", and that
 *     spec object ({@link ObjectChartSchema.xAxis}) is the author-facing
 *     spelling ON THIS NODE. All five producers COMPUTE it (`dims[0]`,
 *     `chartCategoryKey(...)`), none forwards an authored value, and it is
 *     absent from the registry `inputs`.
 *   - `series` — TWO ARMS, one verdict each (objectui#10770 corrected the
 *     INTERNAL-only verdict this bullet carried). The `{ dataKey }` arm is
 *     INTERNAL: the renderer's own contract, which the five relays compose
 *     from something else. The `{ name }` arm is AUTHORABLE, and it is the
 *     spec's `ChartSeries` by reference. The react tier's `<ObjectChart>`
 *     publishes `series` in that shape (its react-blocks entry's `schema` is
 *     `ChartConfigSchema`), and the react-page wrapper forwards the authored
 *     array onto this node untouched. That makes the wrapper a sixth producer,
 *     and the one the earlier verdict missed. The spec's `ChartSeriesSchema`
 *     refuses `dataKey` by name (`dataKey` → `name`), so the two arms cannot
 *     be mistaken for each other.
 *
 * `xAxisKey` and the `{ dataKey }` arm are still declared HERE and on the
 * mirror: they are read and written today, and `BaseSchema` is
 * `.passthrough()`, so leaving them undeclared does not make them
 * unauthorable. It only means an `xAxisKey: 42` rides through unchecked.
 * Declaring buys the VALUE check without minting new authorable vocabulary,
 * and the descriptions say which is which.
 *
 * ## The three keys objectui#8885 declared, and why each is bound to the spec
 *
 * `ObjectChart.tsx` reads `drillDown`, `title` and `compareTo` off `schema`,
 * and until objectui#8885 neither published copy of this shape mentioned any of
 * them — the objectui#6914 class (a key read behind a cast, declared on neither
 * published face). They rode `BaseSchema`'s `[key: string]: any` /
 * `.passthrough()` and arrived UNVALIDATED, while two independent declarations
 * already pointed at `drillDown`: this component's registry `inputs` advertise
 * it to the designer palette, and `@objectstack/spec` publishes
 * `ChartDrillDownSchema` for exactly this carrier.
 *
 * ⛔ None of the three is re-declared locally. Each binds to the spec symbol
 * that already owns it, per this file's standing rule ("Never Redefine Types.
 * ALWAYS import them.") — a local near-copy is the fork `check:spec-symbols`
 * exists to stop, and the one that would drift the day the protocol moves:
 *
 *   - `drillDown` → `ChartDrillDown` (`ChartDrillDownSchema`), which the spec
 *     documents as the `ObjectChart` react-tier prop by name.
 *   - `title` → `I18nLabel`, the union the spec's own `ChartConfigSchema.title`
 *     carries and that this package's `normalizeChartSchema` already resolves.
 *   - `compareTo` → `SpecDashboardWidget['compareTo']`, bound BY REFERENCE to
 *     the producer's own declaration (see the member doc).
 *
 * ## The ceiling, stated rather than assumed (objectui#5155)
 *
 * While `BaseSchema` carried `[key: string]: any`, declaring a key bought it
 * its declared TYPE — `xAxisKey: 42` and `title: 42` are both refused now — but
 * did NOT buy rejection of a MISSPELLING: `xAxisKy: 'x'` and `drillDwn: {}`
 * still compiled, exactly as they did on `ObjectGallerySchema` (objectui#6576).
 * objectui#8347 removed the signature, so a misspelling in a fresh literal is
 * refused now. ONE ceiling, two cards, and each pinned it with its own
 * counter-probe, flipped by objectui#8347:
 * `__tests__/widget-schema-anchors-7946.test.ts` and
 * `__tests__/object-chart-undeclared-keys-8885.test.ts`.
 *
 * ## Two cards ruled on this shape, and neither ruled for the other
 *
 * All eight keys above are declared, but they arrived under two separate
 * rulings — objectui#7946 (`filter`, `aggregate`, `xAxisKey`, `series`,
 * `colors`) and objectui#8885 (`drillDown`, `title`, `compareTo`) — and each
 * card measured only its own. Neither swept the other's keys in, so neither
 * took a disposition on the other's behalf.
 *
 * ⭐ Both census pins were written to survive that, and it is why landing order
 * did not matter: each ledgers the OTHER card's keys by name and asserts only
 * that each is STILL READ, never that it is still undeclared. So declaring a
 * ledgered key does not redden its ledger — dropping the READ does.
 *
 * ## A third card, and a channel neither census sees (objectui#10518)
 *
 * `xAxis` and `yAxis` (see the members) are read by NO `schema.KEY`
 * expression in `ObjectChart.tsx`: the component spreads the node into the
 * schema it hands `ChartRenderer`, and `normalizeChartSchema` reads them there.
 * Both census pins above read `schema.KEY` off that one file, so neither lists
 * them — as reads or as exceptions — and neither was moved. Their pin is
 * `__tests__/object-chart-axis-config-10518.test.ts`; the render path was
 * measured once with a real registry probe, recorded on the card's PR.
 *
 * ## Three list-view spellings, RETIRED on this node (objectui#10608, ADR-0049)
 *
 * `xAxisField`, `yAxisFields` and `aggregation` are the LIST-VIEW chart
 * block's pre-ADR-0021 vocabulary (`chart.xAxisField` and its siblings on a
 * `chart` list view). The list-view relays used to translate that block into
 * `aggregate` / `xAxisKey` / `series` before they composed this node, so on
 * this node the three were declared and read by nothing: a node written with
 * them drew no category axis and no series. Each is now a `?: never` tombstone whose zod
 * twin refuses it by name with the spec spelling as the remedy — `xAxis:
 * { field }`, `yAxis: [{ field }]`, `aggregate: { field, function, groupBy }`.
 * The measurement and the producer census are on the card's PR; the pin is
 * `__tests__/object-chart-legacy-axis-keys-retired-10608.test.ts`.
 *
 * The LIST-VIEW carriers are a different node, and nothing here touches them.
 * They no longer read these names either: every list-view door refuses them,
 * and the list-view relays' legacy chart path retired in objectui#6152 round 15.
 *
 * ## The react tier's node, and the two chart-family keys (objectui#10770)
 *
 * The react tier's `<ObjectChart>` block becomes this node too. Its spec
 * react-blocks entry has `schemaType: 'object-chart'` and
 * `schema: ChartConfigSchema`, so its author writes the spec's `type` and
 * `series: [{ name }]`. `type` is also the SDUI envelope's discriminator, so
 * the react-page wrapper parks the author's value beside it as
 * {@link specType} (objectui#2880), and `normalizeChartSchema` reads it back.
 * Until objectui#10770 this face refused that node twice: `chartType` was
 * required, and every `series` entry needed `dataKey`.
 *
 * The metadata tier still writes the family as {@link chartType}. So both keys
 * are optional here, and the zod mirror's refinement requires ONE of them.
 * That is the floor `chartType`'s required flag used to carry, so a node that
 * names no family is still refused. An interface cannot say "one of two", so
 * this TS face does not express that floor: a ceiling, stated rather than
 * assumed.
 *
 * Whether a user ever met the old refusal was measured once, on
 * objectui#10770's PR, and nothing re-derives it: no render, publish or
 * `objectui validate` path ran this schema on the wrapper's node. The defect
 * was on the contract face, not on a door.
 *
 * ## What this type describes (objectui#11276)
 *
 * The `object-chart` node as `ObjectChart` READS it: after `SchemaRenderer`
 * has hoisted the node's `properties` bag onto it, or as code composes it —
 * `ObjectView` and `ListView` building a chart view, the dashboard renderers
 * building a widget, the react-page wrapper building the `<ObjectChart>`
 * block, a host mounting `<ObjectChart schema={…}>`. That is why its members
 * sit flat on the node.
 *
 * It is NOT the shape of an AUTHORED `object-chart` document. An authored node
 * takes its props in the `properties` bag: `{ type: 'object-chart',
 * properties: { chartType, dataset, dimensions, values, … } }`, because
 * `@objectstack/spec`'s page component refuses a prop written on the node
 * itself (ADR-0089 D3a). `ObjectChartBlockSchema` (`./zod/objectql.zod.ts`)
 * judges it and refuses a prop written flat on the node by name. The spec has
 * no `ComponentPropsMap['object-chart']` row, so that bag's members are this
 * type's own members, read off its zod mirror by reference. `SchemaRenderer`
 * reads both spellings, so a node built in code keeps its flat keys.
 */
export interface ObjectChartSchema extends BaseSchema {
  type: 'object-chart';
  /**
   * Per-breakpoint scoped style maps (ADR-0065): `@objectstack/spec`'s
   * `ResponsiveStyles`, by reference (objectui#10872 batch 9). The same
   * declaration as {@link ObjectGridSchema.responsiveStyles}; a producer writes
   * it on `object-chart` nodes (the objectstack showcase).
   */
  responsiveStyles?: SpecResponsiveStyles;
  /**
   * Per-element data binding — the spec's `ElementDataSource`, by reference
   * (objectui#11070). This block's registration is gate-wrapped
   * (`elementDataSourceBlock`), so `ElementDataSourceGate` reads the binding
   * off the node and lands its `object` on {@link objectName}. Metadata, ⛔ not
   * the adapter: see {@link ObjectGridSchema.dataSource}. It stays on the node
   * on the authored spelling too, beside the `properties` bag, as the spec's
   * `PageComponentSchema.dataSource` does. The react-page wrapper no longer
   * writes the host adapter under this key (objectui#11070, round 2), which is
   * what kept the binding undeclared here.
   */
  dataSource?: ElementDataSource;
  /** ObjectQL object name (legacy inline path; optional under ADR-0021 dataset binding) */
  objectName?: string;
  /** Chart type: the `@objectstack/spec` chart families plugin-charts draws
   *  (objectui#11513), `Extract`ed from the spec's `ChartType` by reference.
   *  The spec's single-value families (`gauge`, `solid-gauge`, `metric`,
   *  `kpi`, `bullet`) and tabular ones (`table`, `pivot`) are not declared:
   *  this block renders one row's number or a notice for them, not a chart.
   *  The zod mirror picks the same set out of the spec's enum
   *  (`OBJECT_CHART_FAMILIES`), and the objectui#11513 pins hold the two faces
   *  to each other and to what renders.
   *
   *  The metadata tier's spelling of the chart family. OPTIONAL since
   *  objectui#10770, because a react-tier node carries the family as
   *  {@link specType} instead. The zod mirror requires one of the two, and
   *  `normalizeChartSchema` reads this one first when a node writes both. */
  chartType?: Extract<
    SpecChartType,
    | 'bar' | 'horizontal-bar' | 'column'
    | 'line' | 'area'
    | 'pie' | 'donut' | 'funnel'
    | 'scatter'
    | 'treemap' | 'sankey'
    | 'combo'
    | 'radar'
  >;
  /**
   * The react tier's chart family: the author's `type` on `<ObjectChart>`,
   * parked here by the react-page wrapper because `type` is this node's
   * discriminator (objectui#2880). The spec's react-blocks index describes
   * that parking in its own comments, and `normalizeChartSchema` reads the
   * value after {@link chartType}.
   *
   * ⛔ `ChartType` from `@objectstack/spec/ui` BY REFERENCE: it is the value
   * domain of `ChartConfigSchema.type`, the shape the react-blocks entry
   * publishes for the author's `type`. A local enum would be a second dialect
   * of one key.
   */
  specType?: SpecChartType;
  /**
   * RETIRED (objectui#10608, ADR-0049) — no `object-chart` reader consumes
   * `xAxisField`. Write the spec's {@link xAxis} object,
   * `xAxis: { field: 'status' }`; on the inline `objectName` path the category
   * is `aggregate.groupBy`.
   *
   * A tombstone rather than a deletion: the mirror's `.passthrough()` would
   * otherwise KEEP an authored value in silence, and so did `BaseSchema`'s
   * index signature until objectui#8347 (a widened value still would).
   *
   * @deprecated Not a key this node reads. Write `xAxis: { field }`.
   */
  xAxisField?: never;
  /**
   * RETIRED (objectui#10608, ADR-0049) — no `object-chart` reader consumes
   * `yAxisFields`. Write the spec's {@link yAxis} list,
   * `yAxis: [{ field: 'amount' }]` — one entry per value axis, and each entry's
   * `field` is a plotted column when no `series` is written. On the inline
   * `objectName` path the measure is `aggregate.field`; a dataset-bound chart
   * selects {@link values} by name.
   *
   * @deprecated Not a key this node reads. Write `yAxis: [{ field }]`.
   */
  yAxisFields?: never;
  /**
   * RETIRED (objectui#10608, ADR-0049) — no `object-chart` reader consumes
   * `aggregation`. Write the spec's {@link aggregate},
   * `aggregate: { field, function, groupBy }`, whose `function` is the spec's
   * own vocabulary; a dataset-bound chart takes its aggregation from the
   * dataset's measures.
   *
   * @deprecated Not a key this node reads. Write `aggregate: { field, function, groupBy }`.
   */
  aggregation?: never;
  /** Semantic-layer dataset name (ADR-0021, objectstack-ai/objectstack#1890) */
  dataset?: string;
  /** Dataset dimension names */
  dimensions?: string[];
  /** Dataset measure names */
  values?: string[];
  /**
   * AUTHORABLE — query filter, forwarded as `$filter` on both query legs
   * (`ds.aggregate` and `ds.find`) with its context tokens (`{current_user_id}`,
   * `{current_org_id}`, the date macros) resolved first through
   * `@object-ui/core`'s `resolveFilterPlaceholders`, and conjoined with the click context
   * to scope a drill-down.
   *
   * ⚠️ BOTH shapes, and the union is measured rather than tidied. The array arm
   * is what `@objectstack/spec` publishes for this prop (`ObjectChart.filter`
   * is a `FilterArray` in its react-blocks table) and what this component's
   * registry `inputs` advertises (`{ name: 'filter', type: 'array' }`) — it is
   * the spelling {@link ObjectGanttSchema.filter} and
   * {@link ObjectKanbanSchema.filter} carry. The RECORD arm is what the reads
   * require: the in-repo corpus authors the ObjectQL object form
   * (`{ close_date: { $gte, $lte } }`) against fakes that read it that way, and
   * both arms travel to `ds.aggregate` / `ds.find` as `$filter`, resolved.
   * Declaring only the array arm would have refused live, working charts.
   *
   * ⚠️ Narrowing to ONE arm is a decision LOCAL TO THIS NODE, not a
   * cross-widget one — an earlier draft of this docblock said the opposite and
   * the census refutes it. ⛔ The census is no longer WRITTEN DOWN here, and
   * that is objectui#9309's doing on both halves of what used to stand in this
   * spot. This paragraph stated a sibling count and called this key the only
   * `object-*` `filter` with a record arm; {@link ObjectGallerySchema.filter}
   * is now `QueryParams['$filter']`, which HAS a record arm, and one of the
   * counted siblings was `NamedListView` — the named-view interface, not a
   * view schema at all. Read the population off the instrument that re-derives
   * it on every run, `__tests__/object-gallery-filter-9309.test.ts`, which
   * charges every `filter` declaration in this file to its owning interface
   * through the parser; ⛔ do not copy its table back into prose here
   * (AGENTS.md #9). So there is no fleet-wide convention to renegotiate — what
   * is unresolved is
   * only this component's own two-armed read, and objectui#7946 declares the
   * accept set it measured rather than picking an arm without a ruling.
   *
   * ⭐ The composition that blocked narrowing is FIXED (objectui#8944). The
   * drill-down used to compose this value by SPREADING it into an object
   * literal, which mis-composed the array arm into index keys (`{ 0: […] }`)
   * instead of conditions, so an authored `FilterArray` was silently dropped
   * from the drilled query. `ObjectChart` now composes through
   * `composeDrillFilter` (`@object-ui/core`), which routes both arms into the
   * repo's single filter sink — so the array arm survives the drill, and the
   * read that forced the record arm to be declared is gone.
   *
   * ⇒ What remains before this node can narrow to the spec's array-only
   * `FilterArray` is a DEPRECATION, not a defect: live charts author the object
   * form today, and narrowing stops them compiling. That migration is its own
   * card; this docblock no longer names a bug as the blocker.
   *
   * What this declaration buys today is that `filter: 'stage=won'` and
   * `filter: 42` are compile errors, where before they were not.
   */
  filter?: any[] | Record<string, any>;
  /**
   * AUTHORABLE — inline aggregation for the legacy `objectName` path.
   *
   * ⛔ `ChartAggregate` from `@objectstack/spec/ui` BY REFERENCE, never a local
   * near-copy — this file's standing rule ("Never Redefine Types. ALWAYS import
   * them.") and the fork `check:spec-symbols` exists to stop.
   *
   * The first cut of objectui#7946 declared it as a local copy with all three
   * members OPTIONAL, reasoning from this renderer's accept set (every read is
   * guarded: `if (schema.aggregate)`, `schema.aggregate?.groupBy`,
   * `aggregateValueKey`). What that PUBLISHES is a different thing, and the
   * contract review measured it:
   *
   *   - the TS face advertised `aggregate: {}` and `{ field: 'amount' }` as
   *     legal authoring, which `ChartAggregateSchema` refuses;
   *   - the zod mirror's local `z.object` is strip-postured, so
   *     `{ groupby: 'stage', function: 'count' }` parsed CLEAN and dropped the
   *     mis-cased key silently — the exact failure the spec's own
   *     `strictObject` history text was written to prevent;
   *   - no typed in-tree producer needed the relaxation: every live forward of
   *     this key is `any` (`DashboardRenderer`'s `(widget as any).data`,
   *     app-shell's `viewDef: any`).
   *
   * ⭐ And the cost is asymmetric — declaring the spec's requiredness now is
   * free, tightening it later is a `major` on a published package. So the
   * authoring door and this declaration are ONE shape: `function` and `groupBy`
   * required, `field` optional (only `count` counts rows rather than a column),
   * and the structured `groupBy` arm naming its `field`.
   *
   * The RENDERER's accept set is wider than this and stays wider on purpose —
   * `ObjectChart.tsx` guards every read and draws an explicit refusal screen for
   * an aggregate that names no category (objectui#8168), because untyped
   * producers still hand it documents this declaration refuses. That refusal is
   * what the narrower door costs at runtime; it is not a reason to advertise the
   * wider shape as authorable.
   *
   * `groupBy` is the category axis — a bare field name, or the structured
   * date-bucketing node the engine takes. `alias`, when present, is the column
   * the projected group value lands under, which is what `ObjectChart.tsx`'s
   * `aggregateGroupByKey` (`gb.alias || gb.field`) resolves.
   */
  aggregate?: ChartAggregate;
  /**
   * INTERNAL (relay-composed) — the category column the renderer binds the x
   * axis to. Authors write the spec's {@link xAxis} object below, whose `field`
   * `normalizeChartSchema` resolves (the retired {@link xAxisField} above is
   * refused); the five producers of an `object-chart` node compute this key.
   *
   * Typed `string` from `ChartRendererProps.schema.xAxisKey`, the read this
   * value ends at.
   */
  xAxisKey?: string;
  /**
   * The plotted series. Each entry is ONE of two arms (objectui#10770), and
   * `normalizeChartSchema` is the one translation between them.
   *
   * **The `{ name }` arm: AUTHORABLE, the spec's `ChartSeries` BY REFERENCE.**
   * The react tier's `<ObjectChart series={…}>` publishes this shape (its
   * react-blocks entry's `schema` is `ChartConfigSchema`), and the react-page
   * wrapper forwards the authored array onto this node untouched. The named
   * producer is the objectstack showcase `renewals-pipeline` page, which
   * writes `series={[{ name: 'total', label: 'Invoice value' }]}`. ⛔ Never a
   * local near-copy: the key set, the value domains and the strict refusal
   * are the spec's, and a spec bump moves them here with it. The spec refuses
   * `dataKey` on this arm by name (`dataKey` → `name`), and a per-series
   * family override is its `type`.
   *
   * **The `{ dataKey }` arm: INTERNAL (relay-composed).** This is the
   * renderer's own contract, which the five relays compose from something
   * else. Its type is `ChartRendererProps.schema.series`' internal arm, which
   * is the read this value ends at (the ruling on objectui#7946 asked for the
   * reads rather than a copy of any producer's literal). It carries every
   * member of that arm EXCEPT the per-series `type` the arm gained under
   * objectui#8086.
   *
   * ⛔ That omission is deliberate, not a lag (objectui#10584). Taking `type`
   * up widens a published accept set, and that waits for a named producer
   * that writes `type` on a `{ dataKey }` entry of an `object-chart` node;
   * none was named. Until one is, the per-series family override on this arm
   * is `chartType`, the renderer-internal spelling of `type`, which wins when
   * an entry writes both. A `type` written on this arm anyway is NOT refused
   * on a literal typed by this interface: the `{ name }` arm declares `type`,
   * and excess-property checking on this union accepts a key that either arm
   * declares when its value fits that declaration, so
   * `{ dataKey: 'amount', type: 'line' }` compiles. The zod mirror's element
   * for this arm is a plain `z.object`, which strips it: it parses clean and
   * is dropped. The mirror's `.describe()` names the same omission, because
   * that string is what an author-facing tool renders.
   *
   * An entry with neither `name` nor `dataKey` matches no arm and is refused;
   * `normalizeChartSchema` would drop it from the chart.
   */
  series?: Array<SpecChartSeries | {
    dataKey: string;
    label?: string;
    variant?: 'current' | 'comparison';
    opacity?: number;
    dashArray?: string;
    chartType?: 'bar' | 'line' | 'area';
    stack?: string;
    yAxis?: 'left' | 'right';
    color?: string;
  }>;
  /**
   * Positional palette (`string[]`) OR a value→color map
   * (`{ value: color }`, kanban-style). Select/lookup option colors and
   * explicit maps win over the palette per category.
   *
   * The zod mirror has declared this since objectui#3913; this interface did
   * not, and nothing ratchets the mirror-declares-more direction — so the two
   * published copies of one shape disagreed silently until objectui#7946.
   */
  colors?: string[] | Record<string, string>;
  /**
   * AUTHORABLE — segment drill-down. Clicking a bar / slice / point opens the
   * underlying records, filtered by the clicked category, in a drawer
   * (default), a dialog, or the object's full list page. Absent means OFF; `{}`
   * is enough to turn it on.
   *
   * ⛔ `ChartDrillDown` from `@objectstack/spec/ui`, NOT this repo's wider
   * {@link DrillDownConfig}, and the difference is measured rather than
   * stylistic. The spec type is the CHART subset — `enabled` / `filter` /
   * `title` / `target` / `columns` / `maxRows`, all six of which
   * `ObjectChart.tsx` reads — while `DrillDownConfig` additionally carries
   * `mode` and `report` for the table / pivot / metric widgets, which this
   * component reads NEITHER of. Declaring the wider type here would advertise
   * two keys that are accepted and then dropped, which is the authoring bait
   * objectui#3354 removed from `DrillDownConfig` itself.
   *
   * ⚠️ The `target: 'navigate'` arm is live on BOTH faces AT THIS PACKAGE'S
   * DECLARED FLOOR, so nothing here is owed a floor bump: the floor is
   * `@objectstack/spec` `^17.3.0` (`packages/types/package.json`), and
   * `ChartDrillDownSchema.target` already reads
   * `z.enum(['drawer', 'dialog', 'navigate'])` at the published 17.3.0 — and at
   * 17.2.0 before it — after objectstack#5435 widened the union that
   * objectui#3382 had implemented. ⛔ Cite the FLOOR here, never the version the
   * lockfile happens to resolve: a range dependency guarantees the floor, and
   * this sentence previously named 17.4.0 for no better reason than that the
   * tree was resolving 17.4.0 that day.
   *
   * ⇒ What is left is an unmade decision about the DESIGNER PALETTE, not a
   * protocol gap. The `description` on this component's registry `inputs` still
   * lists two arms, and `packages/plugin-charts/src/index.test.ts` pins that
   * withholding BY NAME. Widening an advertised authoring vocabulary is a shape
   * decision, not the prose this round is allowed to touch — see this card's
   * acceptance notes for the named successor. (The prose in `ObjectChart.tsx`
   * that once claimed the protocol itself was narrower is already corrected;
   * objectui#7946's rework round fixed it, so ⛔ do not repeat that half of the
   * claim.)
   */
  drillDown?: ChartDrillDown;
  /**
   * AUTHORABLE — the chart's heading, and the drill drawer's heading fallback.
   *
   * Two read sites, and ⛔ they do NOT jointly require the union — ONE of them
   * does, and the other's CALLER narrows it before the helper ever sees it:
   *
   *   - `normalizeChartSchema`'s `label()` takes this value as `unknown` and
   *     resolves BOTH arms itself, picking the first string out of a locale map.
   *     ⭐ This is the read that requires the union: declaring `string` alone
   *     would refuse a locale-map `title` that works today.
   *   - `ObjectChart.tsx` passes it to `resolveDrillTitle` as the drill drawer's
   *     heading fallback, and that helper's `fallback` parameter is a plain
   *     `string` (`@object-ui/core`'s `utils/drill-down.ts`). It never sees the
   *     map arm: the call site pre-resolves through `pickLocalized(schema.title,
   *     language)` first, which objectui#7946's rework round added precisely so
   *     the map arm could not reach a heading as an object.
   *
   * `I18nLabel` is exactly that union and is what `@objectstack/spec`'s own
   * `ChartConfigSchema.title` carries — and the spec's `REACT_BLOCKS` entry for
   * `ObjectChart` lists `title` among its `dataProps`, so this is a key the
   * platform's authoring surface already offers.
   *
   * ⚠️ NOT a `BaseSchema` member — `title` there belongs to `HTMLAttributes`,
   * not to the node shape — so before objectui#8885 it rode the index signature
   * as `any` and a `title: 42` reached `label()` unchecked.
   */
  title?: I18nLabel;
  /**
   * INTERNAL (relay-composed) — the period-over-period comparison directive.
   * When present the chart runs a second, time-shifted query and overlays the
   * previous window as `__comparison` series.
   *
   * Bound BY REFERENCE to `SpecDashboardWidget['compareTo']` because that is
   * literally where the value comes from: `DashboardRenderer` composes this
   * node with `compareTo: widget.compareTo`, forwarding the dashboard widget's
   * own key verbatim. Binding to the producer's declaration is what keeps the
   * two from drifting into a second dialect; the shape it resolves to is the
   * converged `{ kind, dimension? }` (objectstack#5011), which the renderer
   * side projects as `CompareToConfig` in `@object-ui/core` and the analytics
   * contract publishes as `DatasetCompareTo`.
   *
   * INTERNAL rather than authorable: no producer in this repo puts it on an
   * `object-chart` node an author wrote, this component's registry `inputs` do
   * not advertise it, and `dimension` is deliberately never read on this path
   * (the executor resolves it, so a renderer that guessed would trade a loud
   * error for a quietly wrong window). Declaring it mints no new authorable
   * vocabulary — the key is already authorable ON THE WIDGET — and buys the
   * value check that `.passthrough()` was skipping.
   */
  compareTo?: SpecDashboardWidget['compareTo'];
  /**
   * AUTHORABLE — the category (x) axis: ONE `@objectstack/spec` axis CONFIG
   * object, the type of `ChartConfigSchema.xAxis`. Its `field` names the
   * category column when neither `aggregate.groupBy` nor {@link xAxisKey} does
   * (`resolveChartCategoryField`'s order); its other keys are presentation.
   *
   * Declared by objectui#10518 beside {@link yAxis}, for the same three reasons
   * (see that member): the spec's `ObjectChart` react block lists `xAxis` in its
   * `dataProps` with `ChartConfigSchema` as its schema; `normalizeChartSchema`
   * reads every spec axis key off the object; and a real producer writes it —
   * the objectstack showcase `renewals-pipeline` page's `xAxis: { field }`.
   *
   * ⛔ The object ONLY. There is no `string` arm and no fold onto
   * {@link xAxisKey} (seat decision on objectui#10518, option A): the bare
   * string is objectui#7113's alias on `ChartSchema` alone, the spec's
   * `ChartConfigSchema.xAxis` has no string arm, and no producer on this node
   * writes one. The renderer still TOLERATES a bare string — that is
   * `normalizeChartSchema`'s, untouched — but it does not compile here and the
   * mirror refuses it, as it refuses a list, with the `{ field }` remedy.
   */
  xAxis?: SpecChartAxis;
  /**
   * AUTHORABLE — the value (y) axes: an ARRAY of `@objectstack/spec`'s axis
   * CONFIG objects, the type of `ChartConfigSchema.yAxis`. The first entry is
   * the primary axis; a second entry declares the right-hand axis a series
   * binds to.
   *
   * Declared by objectui#10518, the `object-chart` sibling of objectui#7690
   * (ruling 5809510046, branch 2 — declare), for three measured reasons:
   *
   *   - the spec declares the key ON THIS NODE: its `REACT_BLOCKS` entry for
   *     `<ObjectChart>` carries `schemaType: 'object-chart'` and
   *     `schema: ChartConfigSchema`, and lists `yAxis` among its `dataProps`;
   *   - the node renders it: `ObjectChart` spreads the node into the schema it
   *     hands `ChartRenderer`, and `normalizeChartSchema` reads every spec axis
   *     key off each entry — so the type IS the spec's `ChartAxis`, not a
   *     restatement of it;
   *   - a real producer writes it: the objectstack showcase command-center
   *     page's dataset-bound `object-chart` authors
   *     `yAxis: [{ field, stepSize: 1 }]` to pin integer ticks on a count axis.
   *
   * Until then the list survived only on `BaseSchema`'s index signature: read
   * by the renderer, checked by nothing. Only the spec's list is a member — a
   * single axis object or a bare column name, which the normalizer tolerates,
   * is refused by the mirror and does not compile here.
   *
   * The list-view spelling {@link yAxisFields} above is RETIRED on this node
   * (objectui#10608): this list is the one author-facing value-axis spelling.
   */
  yAxis?: SpecChartAxis[];
  /**
   * HOST-COMPOSED, runtime-only (objectui#11355, the seat's ruling A: an
   * undeclared key follows the implementation, and the docs follow it). Pass
   * `false` for a deterministic render with no entrance animation; omitted,
   * the chart animates.
   *
   * Code writes it, not documents. On this node the producers are the
   * dashboard renderers (`DashboardRenderer`, `DashboardGridLayout`), which set
   * it `false` on the `object-chart` nodes they build for a widget; `ObjectChart`
   * spreads the node into the schema it hands `ChartRenderer`, which honours it.
   * `DatasetWidget` and `DatasetReportRenderer` write the same flag onto bare
   * `chart` nodes, which `ChartRenderer` renders directly (plugin-charts'
   * `index.tsx` gives it the bare `chart` key and registers `ObjectChartBlock`
   * as `view:chart` only). `ChartRenderer`'s own `schema` prop declares the
   * flag there, so those writes do not go through this type.
   *
   * ⛔ Declared on this TypeScript face only. The zod mirror has no member for
   * it, so it is not offered as an authored key, and `zod-mirror-parity` files
   * it as runtime-only with this reason.
   */
  isAnimationActive?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-chart` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its refusal
   * names `children` as the remedy, which this node does not read either. The
   * member is restated here so both faces point at what the node renders
   * instead.
   *
   * @deprecated Not a channel `object-chart` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-chart` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep: no `body` /
   * `children` read is filed under this declaration, while the same instrument
   * does see it as the receiver of the keys the renderer reads. The
   * registration hop, `ObjectChartBlock` (`packages/plugin-charts`), is
   * `any`-typed and hands the node to `ObjectChart`, which reads it as this
   * type. `SchemaRenderer` strips both keys out of the props bag it spreads,
   * so neither reaches the component by another route, and the registration
   * declares no `children` slot (objectui#9910).
   *
   * What it renders instead: a chart of `objectName` (or inline `data`) drawn
   * by `chartType` from `aggregate` / `series`.
   *
   * @deprecated Not a channel `object-chart` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Object Gallery Component Schema (objectui#6576)
 *
 * The node `plugin-list`'s `ObjectGallery` renders — registered as
 * `object-gallery` — and the anchor of the published `ObjectGalleryProps.schema`.
 * Minted by the 2026-08-31 ruling on objectui#6576 (option A): the prop type
 * used to declare this shape as a hand-rolled inline literal with no
 * `BaseSchema` in its ancestry, so every base member had to be hand-copied in
 * (`bind`, `className` were) and a real base key such as `visibleWhen` was a
 * compile error. Anchoring here WIDENS that published accept set to every
 * `BaseSchema` member and makes `type` required.
 *
 * Every key below has a read site in `plugin-list/src/ObjectGallery.tsx` (the
 * read census is pinned in `__tests__/widget-schema-anchors-6576.test.ts`);
 * `bind` and `className` are inherited, not restated.
 */
export interface ObjectGallerySchema extends BaseSchema {
  type: 'object-gallery';
  /** ObjectQL object name; omitted when the records arrive through `bind` or `data` */
  objectName?: string;
  /**
   * Query filter, forwarded as `$filter` with its
   * context tokens (`{current_user_id}`, `{current_org_id}`, the date macros) resolved first through `@object-ui/core`'s `resolveFilterPlaceholders` (objectui#10666).
   *
   * Typed as the DESTINATION the sentence above names, by an indexed access on
   * {@link QueryParams} rather than a copy of its arms, so the declaration
   * cannot drift away from the slot it is forwarded into (objectui#9309).
   *
   * It was `unknown` until then, which promised a destination it did not type:
   * the docblock mandated a verbatim forward and the compiler refused it, so
   * the only way through was an assertion at the call site — the shape that
   * teaches casting, and the opposite of the repo's own direction (AGENTS.md
   * #0.1: fix the declaration, do not widen the consumer). `unknown` is the
   * widest type there is, so this is a NARROWING of the published accept set:
   * `filter: 'stage=won'` and `filter: 42` are compile errors now, where
   * before they compiled and the downstream assertion un-checked them again.
   *
   * ⛔ Do not re-spell the arms here. What `QueryParams['$filter']` resolves to
   * is stated once, in `./data.ts`, next to the readers that honour it; a copy
   * in this docblock would be a second dialect of one key the moment that slot
   * moves.
   */
  filter?: QueryParams['$filter'];
  /** Inline records — rendered ahead of a fetch when present */
  data?: Record<string, unknown>[];
  /** Gallery configuration — aligned with @objectstack/spec `GalleryConfig` */
  gallery?: GalleryConfig;
  /** Navigation config for item click behavior */
  navigation?: ViewNavigationConfig;
  /** Grouping configuration for sectioned display */
  grouping?: GroupingConfig;
  /** @deprecated Use `gallery.coverField` instead */
  imageField?: string;
  /** @deprecated Use `gallery.titleField` instead */
  titleField?: string;
  /**
   * Card click handler.
   *
   * RUNTIME SLOT (objectui#6124, declared by `8d50bc2bf`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is READ and RUN by the registered renderer.
   *
   * ⭐ Its channel is the PROPS half of the slot, not the `schema.*` half: this
   * key was declared on `ObjectGalleryProps` (`@object-ui/plugin-list`) and
   * nowhere on this node, while `SchemaRenderer` spreads an authored node's
   * leftover keys into the very props bag `ObjectGallery` reads
   * (`props.onRowClick ?? props.onCardClick`, handed to `useNavigationOverlay`
   * as the function it calls on a card click). So an authored value DID reach
   * the renderer through a face that never declared it. Declaring it here
   * NARROWS: the key was already admitted, untyped, by `BaseSchema`'s index
   * signature.
   *
   * ⚠️ No host in this repository supplies this spelling — it is the second arm
   * of that `??`, the name a host may use instead of {@link onRowClick}.
   * Measured and reported rather than smoothed: what is absent is a supplier,
   * not the channel.
   */
  onCardClick?: (record: Record<string, unknown>, event?: any) => void;
  /**
   * Row/item click handler — overrides {@link navigation}.
   *
   * RUNTIME SLOT (objectui#6124, declared by `8d50bc2bf`) — a host-supplied
   * function, NOT authorable metadata: JSON has no function value, so the zod
   * twin refuses this key by name and points at the node-type spelling. Kept
   * callable here because it is READ and RUN by the registered renderer, on the
   * same `props.onRowClick ?? props.onCardClick` line as {@link onCardClick}.
   *
   * Supplied by two in-repo hosts, each putting it on the `object-gallery` node
   * it builds: `ListView` (`onRowClick: navigation.handleClick`, from the
   * `baseProps` every child view receives) and `RelatedList`'s mobile branch
   * (its own React prop of this name).
   *
   * TWO parameters, matching `ObjectGalleryProps.onRowClick`: the second is the
   * modifier payload a host needs for Cmd/Ctrl/middle-click, and it is spelled
   * `any` for the reason objectui#9341 measured — `HandleClickModifiers` lives
   * in `@object-ui/react`, which the published twins here may not name.
   */
  onRowClick?: (record: Record<string, unknown>, event?: any) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-gallery` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `bind`, `className`, `data`, `filter`, `gallery`, `grouping`, `imageField`,
   * `navigation`, `objectName`, `titleField` (in
   * `packages/plugin-list/src/ObjectGallery.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `object-gallery` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-gallery` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `bind`, `className`, `data`, `filter`, `gallery`, `grouping`, `imageField`,
   * `navigation`, `objectName`, `titleField` (in
   * `packages/plugin-list/src/ObjectGallery.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `object-gallery` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Object Data Table Component Schema (objectui#6576 / objectui#6914)
 *
 * The node `plugin-dashboard`'s `ObjectDataTable` renders — registered as
 * `object-data-table` — and the anchor of `ObjectDataTableProps.schema`. That
 * prop type used to be a hand-rolled inline literal carrying its own
 * `[key: string]: any`, which is how it drifted: the widget read `drillDown`
 * and `onRowClick` behind casts and declared neither (objectui#6914). Both are
 * declared here with the types measured where they were declared before
 * (`DrillDownConfig` on `ChartSchema` / `PivotTableSchema`, `onRowClick` on
 * `DataTableSchema`), and the literal's index signature is gone — a NARROWING
 * of a prop type the plugin index does not export.
 *
 * `bind` and `className` are inherited from `BaseSchema`, not restated. The
 * widget spreads this node into the `data-table` it renders (overwriting
 * `type`, `data`, `columns` and `onRowClick`), so `searchable` / `pagination`
 * reach `DataTableSchema` unchanged.
 */
export interface ObjectDataTableSchema extends BaseSchema {
  type: 'object-data-table';
  /** ObjectQL object name; omitted when the rows arrive through `bind` or `data` */
  objectName?: string;
  /**
   * RETIRED (objectui#7353, ADR-0049 remove arm, ruling 5809008870) — write
   * `objectName`, the key the widget fetches through.
   *
   * This member carried the dashboard widget's provider config
   * (`{ provider, object }`), copied onto the node beside `objectName` by both
   * dashboard producers and read by nothing. The producers no longer write it
   * and no reader was added.
   *
   * A `?: never` tombstone, not a plain deletion: this carrier survives the
   * retirement and extends {@link BaseSchema} (`.passthrough()` on the zod
   * mirror, and `[key: string]: any` here until objectui#8347; a widened value
   * still skips the excess-property check), so a deleted member would be
   * absorbed silently at any value — the silent no-op the retirement exists to end.
   * Licensed by prong 1 of the discriminator (objectui#5941, #7526, in its
   * amended form, `5f8190c8c`): it steers authors to the named live replacement,
   * `objectName`. The zod mirror refuses the key by name with that guidance.
   *
   * @deprecated Not read by `object-data-table` — write `objectName`.
   */
  dataProvider?: never;
  /** Query filter, resolved through the filter scope and forwarded as `$filter` */
  filter?: any;
  /** Inline rows — rendered ahead of a fetch when non-empty */
  data?: any[];
  /** Column definitions (names or column objects), normalized by the widget */
  columns?: any[];
  /** Forwarded to the rendered `data-table` */
  searchable?: boolean;
  /** Forwarded to the rendered `data-table` */
  pagination?: boolean;
  /**
   * Forwarded to the rendered `data-table` (objectui#11348): rows per page,
   * typed by reference to {@link DataTableSchema}'s own member.
   *
   * The widget spreads this node into the `data-table` it renders, and that
   * node reads `pageSize`, so the key was honoured all along and declared on
   * neither face. `plugin-dashboard`'s drill-down drawer writes it on the node it
   * builds, from its `maxRows`; the drilled list's row count depends on it.
   * No spec row reaches `object-data-table`, so the declaration follows the
   * implementation (the objectui#11347 `list.title` ruling's governing text).
   * The zod mirror declares the same member, so no parity row opens.
   */
  pageSize?: DataTableSchema['pageSize'];
  /**
   * Drill-to-record: clicking a row opens that record in a detail drawer.
   * `DashboardRenderer` defaults object-backed table widgets to `{ enabled: true }`.
   *
   * This block's own drill shape, not the shared `DrillDownConfig`
   * (objectui#10685): `filter`, `maxRows` and `report` are refused by name,
   * because a row drills to the one record it already is and there is no
   * drilled list for them to act on, and `target` is `'drawer'` or `'dialog'`,
   * because `'navigate'` opens the object's list page. The zod mirror's
   * `drillDown` refuses the same members.
   */
  drillDown?: ObjectDataTableDrillDownConfig;
  /**
   * Row click handler — a RUNTIME SLOT a React host supplies through this
   * interface, never through authored JSON (objectui#6124; the zod mirror
   * refuses the key by name). When present it overrides drill-to-record.
   *
   * TWO parameters since objectui#9799, catching up to the `DataTableSchema`
   * twin objectui#9462 widened one hop further in. `ObjectDataTable`
   * (`packages/plugin-dashboard/src/ObjectDataTable.tsx`) forwards this slot
   * onto the `data-table` node it renders, and the forwarding line reads, in
   * full:
   * `onRowClick: schema.onRowClick ?? (recordDrillEnabled ? handleRowClick : undefined)`
   * ⚠️ Quoted whole because the gate is load-bearing for how it is read, not for
   * whether it applies: a host's handler is the FIRST operand of that `??` and
   * reaches the node whatever `recordDrillEnabled` says — the gate only chooses
   * the FALLBACK. That node's renderer calls the slot as
   * `schema.onRowClick(row, e)`, so the payload `useNavigationOverlay`'s
   * `handleClick` reads (`metaKey` / `ctrlKey` / `button`) has been arriving
   * here ever since objectui#9462 repaired that call; until this card the
   * declaration denied a second argument the runtime was already passing.
   * ⛔ Nothing about the runtime call moved with this widening — it is a
   * declaration catching up to a call, in one direction only.
   *
   * OPTIONAL, and spelled `any`, for the two reasons objectui#9341 measured on
   * `ObjectKanbanSchema.onCardClick`: optional so an existing one-parameter
   * host handler is still accepted (source compatibility holds in BOTH
   * directions, pinned by `object-data-table-row-click-arity-9799.test.ts`),
   * and `any` rather than `HandleClickModifiers` because that interface lives
   * in `@object-ui/react`, which depends on THIS package — naming it here is a
   * phantom dependency that closes a cycle.
   */
  onRowClick?: (row: any, event?: any) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-data-table` reads
   * NEITHER content channel: no renderer read consumes `body` or `children` for
   * this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `bind`, `columns`, `data`, `drillDown`, `filter`, `objectName`,
   * `onRowClick` (in `packages/plugin-dashboard/src/ObjectDataTable.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `object-data-table` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-data-table` reads
   * NEITHER content channel: no renderer read consumes `body` or `children` for
   * this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `bind`, `columns`, `data`, `drillDown`, `filter`, `objectName`,
   * `onRowClick` (in `packages/plugin-dashboard/src/ObjectDataTable.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `object-data-table` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Union type of all ObjectQL component schemas
 *
 * `ObjectGallerySchema` and `ObjectDataTableSchema` joined in objectui#7363.
 * PR #7355 (objectui#6576) minted both beside the other members and left this
 * union alone, so `Extract< ObjectQLComponentSchema, { type: 'object-gallery' } >`
 * was `never` and — through the zod twin in `zod/objectql.zod.ts`, which then
 * carried the same twelve members — `AnyComponentSchema` had no arm for either
 * node. The zod twin carries eleven since objectui#10859 batch 4: the authored
 * `object-form` node is armed from its spec row by `ObjectFormBlockSchema`,
 * and `ObjectFormSchema` here is the node as `ObjectForm` reads it. It carries
 * ten since batch 5, for the same reason: the authored `object-map` node is
 * armed by `ObjectMapBlockSchema`, and `ObjectMapSchema` here is the node as
 * `ObjectMap` reads it. It carries nine since objectui#11276: the authored
 * `object-chart` node is armed by `ObjectChartBlockSchema`, and
 * `ObjectChartSchema` here is the node as `ObjectChart` reads it. It carries
 * eight since objectui#10859 batch 6: the authored `object-gantt` node is armed
 * by `ObjectGanttBlockSchema`, and `ObjectGanttSchema` here is the node as
 * `ObjectGantt` reads it. It carries seven since objectui#11276's `object-grid`
 * batch: the authored `object-grid` node is armed by `ObjectGridBlockSchema`,
 * and `ObjectGridSchema` here is the node as `ObjectGrid` reads it. It carries
 * six since objectui#12670: the authored page `list-view` node is armed by
 * `ListViewBlockSchema`, and `ListViewSchema` here is the `ListView`
 * component's props.
 */
export type ObjectQLComponentSchema =
  | ObjectGridSchema
  | ObjectFormSchema
  | ObjectViewSchema
  | ObjectMapSchema
  | ObjectTreeSchema
  | ObjectGanttSchema
  | ObjectCalendarSchema
  | ObjectKanbanSchema
  | ObjectChartSchema
  | ObjectGallerySchema
  | ObjectDataTableSchema
  | ListViewSchema;
