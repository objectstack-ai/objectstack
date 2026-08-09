// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { strictObject } from '../shared/strict-object';
import type { KeySetGuidance } from '../shared/suggestions.zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { DateGranularity } from '../data/query.zod';
import { DATE_MACRO_WRAPPED_RE, isDateMacroToken } from '../data/date-macros.zod';
import { ChartTypeSchema, ChartConfigSchema } from './chart.zod';
import { ActionType } from './action.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
// `AriaPropsSchema` is no longer imported here: `widgets[].aria` was retired
// (#5010). The shape itself is NOT removed — it stays live on `page.aria` /
// `page.components[].aria` and on the list view's `aria`, whose renderers
// really do apply it. (NOT on `app.aria`: that key is a `retiredKey()`
// tombstone of its own, removed in the same 17.0.0 — #6756.) See the
// tombstone below.
import { I18nLabelSchema } from './i18n.zod';
// `ResponsiveConfigSchema` is no longer imported here: `widgets[].responsive`
// was retired (#4876). The shape itself is NOT removed — it stays live on
// `page.components[].responsive` (`page.zod.ts`), whose renderer really does
// read it (objectui `useResponsiveConfig`). See the tombstone below.

/**
 * Color variant for dashboard widgets (e.g., KPI cards).
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
export const WidgetColorVariantSchema = lazySchema(() => z.enum([
  'default',
  'blue',
  'teal',
  'orange',
  'purple',
  'success',
  'warning',
  'danger',
]).describe('Widget color variant'));

/**
 * Action type for DASHBOARD HEADER action buttons.
 *
 * Named `Widget…` for history only — since #5010 its single consumer is
 * `DashboardHeaderActionSchema`. The per-widget `actionType` this was also
 * shared with was retired in 17.0.0: no renderer ever drew a per-widget button.
 *
 * `ActionType` itself, not a hand-kept subset of it. The two lists had drifted
 * apart by one member — `form` — and the disagreement was backwards: a
 * dashboard header action button dispatches through the same `ActionRunner`
 * that implements `form` (objectui's `DashboardRenderer` routes everything
 * except a raw `url` into it, deliberately, so a `flow` header action works —
 * objectstack#3528). So the narrower enum rejected at validation exactly what
 * the shared dispatcher then executes at runtime.
 *
 * Derived rather than restated: a type added to `ActionType` is dispatchable
 * from a header action the moment the runner implements it, with no second list
 * to remember.
 */
export const WidgetActionTypeSchema = lazySchema(() => ActionType.describe('Widget action type'));

/**
 * Shared history for this file (#4001).
 *
 * `DashboardWidgetSchema` has been strict since the ADR-0021 cutover, and its
 * error map says why in its own words: undeclared keys "were dropped silently
 * before strict validation, shipping inert metadata". Everything AROUND the
 * widget — the header, the filter bar, the dashboard itself — kept the posture
 * the widget was rescued from.
 */
const DASHBOARD_HISTORY =
  'Until #4001 closed this shape these were dropped silently — the dashboard still rendered, '
  + 'without whatever the key was meant to configure.';

/**
 * Dashboard Header Action Schema
 * An action button displayed in the dashboard header area.
 */
export const DashboardHeaderActionSchema = lazySchema(() => strictObject({
  surface: 'this dashboard header action',
  history: DASHBOARD_HISTORY,
  aliases: { title: 'label', text: 'label', name: 'label', url: 'actionUrl', href: 'actionUrl', link: 'actionUrl', target: 'actionUrl', type: 'actionType', kind: 'actionType' },
}, {
  /** Action label */
  label: I18nLabelSchema.describe('Action button label'),

  /** Action URL or target */
  actionUrl: z.string().describe('URL or target for the action'),

  /** Action type */
  actionType: WidgetActionTypeSchema.optional().describe('Type of action'),

  /** Icon identifier */
  icon: z.string().optional().describe('Icon identifier for the action button'),
}).describe('Dashboard header action'));

/**
 * Dashboard Header Schema
 * Structured header configuration for the dashboard.
 */
export const DashboardHeaderSchema = lazySchema(() => strictObject({
  surface: 'this dashboard header',
  history: DASHBOARD_HISTORY,
  aliases: { title: 'showTitle', description: 'showDescription', buttons: 'actions', links: 'actions' },
  guidance: {
    // The header shows the DASHBOARD's own label/description — it does not
    // carry copy of its own, which is the mistake `title:`/`subtitle:` here is.
    subtitle: 'the header renders the dashboard\'s own `label`/`description` — there is no separate header copy; toggle them with `showTitle`/`showDescription`',
  },
}, {
  /** Whether to show the dashboard title in the header */
  showTitle: z.boolean().default(true).describe('Show dashboard title in header'),

  /** Whether to show the dashboard description in the header */
  showDescription: z.boolean().default(true).describe('Show dashboard description in header'),

  /** Action buttons displayed in the header */
  actions: z.array(DashboardHeaderActionSchema).optional().describe('Header action buttons'),
}).describe('Dashboard header configuration'));

/**
 * The three key FAMILIES the widget shape rejects with a prescription rather
 * than a rename — declared as `strictObject` `guidanceSets` (#6619), which is
 * the form the shared template grew so these could stop being a hand-written
 * `$ZodErrorMap`.
 *
 * Set-keyed, not exact-keyed, and that is the whole reason the form had to
 * exist: eleven legacy analytics keys share ONE migration answer, and
 * transcribing it eleven times into `guidance` would have emitted the paragraph
 * once per key written. A set answers once per message however many of its
 * members appear.
 *
 * - **Pre-ADR-0021 inline analytics** (`object`/`categoryField`/`valueField`/
 *   `aggregate`/`rowField`/`columnField`/…): removed from the authorable spec at
 *   `@objectstack/spec` 9.0.0 (the single-form cutover). Bind a `dataset` and
 *   select `dimensions`/`values` instead.
 * - **objectui-internal props** (`component`, inline `data`): renderer-only
 *   capabilities that are intentionally not modeled server-side (framework#3251
 *   decision tree) — they must not appear on AI-authored dashboard metadata.
 * - **The #5022 drill near-key**, in all three spellings an author reaches for.
 *   A dashboard widget has NO per-widget drill configuration, by design: an
 *   ADR-0021 dataset-bound widget drills through the semantic layer, deriving
 *   the target object and filter from the clicked dataset row. Saying only
 *   "unrecognized key" here would leave the author to conclude the capability
 *   is missing, when in fact it is automatic — and would leave them guessing
 *   between two real keys on two other surfaces.
 *
 * ⚠️ The three used to be an if/else chain, so exactly ONE fired even when a
 * widget carried keys from two families and the other prescription was silently
 * dropped. Declared as sets they all fire, one bullet each, in declaration
 * order — the one deliberate behaviour change in this fold (#6619).
 */
const WIDGET_GUIDANCE_SETS = [
  {
    name: 'LEGACY_WIDGET_ANALYTICS_KEYS',
    keys: [
      'object', 'categoryField', 'categoryGranularity', 'valueField', 'aggregate',
      'aggregation', 'rowField', 'columnField', 'xAxisField', 'yAxisFields', 'measures',
    ],
    prescription:
      'The pre-ADR-0021 inline analytics shape (`object` + `categoryField` + '
      + '`valueField` + `aggregate`, pivot `rowField`/`columnField`) was removed — '
      + 'bind a `dataset` and select `dimensions` + `values` by name. Renderer-only '
      + 'settings belong under `options`.',
  },
  {
    name: 'QUARANTINED_WIDGET_KEYS',
    keys: ['component', 'data'],
    prescription:
      '`component` and inline `data` are objectui-internal renderer capabilities, '
      + 'not part of the author-facing dashboard spec (framework#3251).',
  },
  {
    name: 'WIDGET_DRILL_NEAR_KEYS',
    keys: ['drillDown', 'drilldown', 'drill'],
    prescription:
      'Drill-through on a dashboard is AUTOMATIC and not configurable per widget: '
      + 'a dataset-bound widget derives the drill target and filter from the dataset row '
      + 'that was clicked, and a `table`/`pivot` widget is the one to reach for when you '
      + 'want the detail to be clickable (`metric`/`chart` render the aggregate only). '
      + 'The two configurable drills live elsewhere and neither is a widget key: '
      + '`drillDown` (camelCase, a config object) is the react-tier `<ObjectChart drillDown={…}>` '
      + 'prop — `ChartDrillDownSchema`; `drilldown` (all lowercase, a boolean) is '
      + '`ReportSchema.drilldown` (ADR-0021 D2, on by default).',
  },
] as const satisfies readonly KeySetGuidance[];

/**
 * The widget's own history sentence — the explanatory clause emitted LAST,
 * after both fix channels (#5955 / #6416). Distinct from `DASHBOARD_HISTORY`:
 * the widget has been strict since the ADR-0021 cutover, so it says what
 * happened before THAT, in its own words.
 */
const WIDGET_HISTORY =
  'Undeclared top-level keys were dropped silently before strict validation, '
  + 'shipping inert metadata; a stale or mis-layered key is now a loud parse error.';

/**
 * Widget `options` — the renderer-extras escape hatch, with the keys that
 * reach the ANALYTICS QUERY declared explicitly (framework#3588).
 *
 * The bag stays open (`passthrough`): presentation-only settings the renderer
 * understands — `icon`, `trend`, `columns`, `striped`, `density`, … — are
 * carried through untouched and are none of the spec's business. What the
 * declared keys below buy is a real contract for the four that are NOT
 * presentation-only: they change the SQL the dataset query compiles to, so a
 * typo (`sortDirection`, `granularity`) is now an author-time type error
 * instead of an option that reads as if it works and silently does nothing.
 *
 * The dashboard/report renderer lowers these into the `DatasetSelection` it
 * posts (`dateGranularity`, `order`, `limit`); see the field docs on
 * `DatasetSelection` in `contracts/analytics-service.ts` for their exact
 * runtime semantics and precedence.
 */
export const DashboardWidgetOptionsSchema = lazySchema(() => z.object({
  /**
   * Bucket this widget's selected DATE dimensions (e.g. group a daily
   * `close_date` into months for a trend line). Overrides the dataset
   * dimension's own `dateGranularity` default for this widget only.
   */
  dateGranularity: DateGranularity.optional()
    .describe('Bucket selected date dimensions (day/week/month/quarter/year)'),

  /**
   * Order rows by this dimension or measure name — must be one this widget
   * actually selects (a `dimensions` entry or a `values` entry).
   */
  sortBy: z.string().optional().describe('Dimension/measure name to order by'),

  /** Sort direction for `sortBy` (default ascending). */
  sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort direction for sortBy'),

  /**
   * Max rows to render. Applied AFTER ordering, so a "top 10" needs `sortBy`
   * to be meaningful; without one the runtime orders by the selected
   * dimensions so the truncated window is at least deterministic.
   */
  limit: z.number().int().positive().optional().describe('Max rows (applied after ordering)'),

  /**
   * Explicit category order for ordered-sequence charts — `funnel` / `pyramid`
   * stages above all. Values are the dimension's STORED values (e.g.
   * `['qualification', 'needs_analysis', 'proposal', 'negotiation']`), not
   * display labels. Omit to let the renderer fall back to the dimension
   * field's own picklist option order, which is the pipeline order an author
   * already declared on the object.
   */
  stageOrder: z.array(z.union([z.string(), z.number(), z.boolean()])).optional()
    .describe('Explicit category order for funnel/pyramid stages (stored values)'),
}).passthrough().describe('Widget configuration — declared query keys + open renderer extras'));

// ── `compareTo` convergence prescriptions (#5011) ────────────────────────────
//
// Declared with `//` rather than `/** */` on purpose (the `CRYPTO_HASH_RETIRED`
// house style in `data/hook-body.zod.ts`): build-docs lifts JSDoc onto the
// reference page, and a retirement prescription is an upgrade note, not a doc
// for a shape that still exists.
//
// `{ offset }` promised a shift by an explicit duration. Nothing on the ADR-0021
// dataset path could run it: the executor's comparison contract is
// `{ kind, dimension? }` and there is no `offset` concept anywhere in it, so a
// forwarded `{ offset }` reached `dataset-executor.ts` with `dimension:
// undefined` and threw. It ran only on the legacy inline chart path. Rather than
// implement calendar-offset arithmetic (whose month-length and leap-year corner
// cases are a silent-wrong-window bug farm) the arm retires: `'1y'` already has
// an exact equivalent, and the rest are expressible as a kind plus the window
// the widget's own `filter` resolves to.
const COMPARE_TO_OFFSET_RETIRED =
  '`dashboard.widgets[].compareTo.offset` was removed in @objectstack/spec 17.0.0 (#5011, '
  + 'ADR-0049 enforce-or-remove) — the analytics executor never had an `offset` concept, so on the '
  + 'ADR-0021 dataset path this arm did not shift a window, it threw '
  + '(`compareTo requires a timeDimension "undefined"`) and took the whole widget down with it. '
  + "Write the kind instead: `compareTo: { kind: 'previousPeriod' }` for the equal-length window "
  + "immediately before, `compareTo: { kind: 'previousYear' }` for the same window a calendar year "
  + "back — `{ offset: '1y' }` is exactly `previousYear`. For any other duration "
  + "(`'7d'`, `'1M'`, …) there is no faithful one-key rewrite: state the window you want on the "
  + "widget's own `filter` and compare it with `previousPeriod`, which shifts by whatever length "
  + 'that window resolves to. '
  + 'Run `os migrate meta --from 16` to rewrite the `1y` case automatically; the other durations '
  + 'are reported for you to re-state.';

// The two string arms. They parsed, and on a dataset widget they then did
// NOTHING — DatasetWidget dropped them deliberately, because forwarding one made
// the executor throw. The value survives the rewrite verbatim; only its
// container changes, which is what makes this a mechanical conversion.
const COMPARE_TO_STRING_RETIRED = (kind: 'previousPeriod' | 'previousYear') =>
  `\`dashboard.widgets[].compareTo: '${kind}'\` (the bare string form) was removed in `
  + '@objectstack/spec 17.0.0 (#5011) — the ADR-0021 dataset renderer silently DROPPED it, so the '
  + 'widget rendered its base numbers with the comparison the author asked for quietly absent. '
  + `Write \`compareTo: { kind: '${kind}' }\` instead — same comparison, spelled the way the `
  + 'analytics executor actually reads it (`DatasetSelection.compareTo`). Add `dimension` only '
  + 'when the selection has more than one dated time dimension; with one, the executor resolves '
  + 'it. Run `os migrate meta --from 16` to rewrite it automatically.';

// ── Per-widget action button prescriptions (#5010) ───────────────────────────
//
// `//` rather than `/** */` deliberately, per the `COMPARE_TO_*` block above:
// build-docs lifts JSDoc onto the reference page, and an upgrade note is not a
// doc for a shape that still exists.
//
// The three keys read as one affordance ("give this widget its own button"), so
// they share one prescription and name each other — an author who removes only
// `actionUrl` should learn in the same breath that its two companions are gone
// too, rather than hitting three parse errors in three edit rounds.
const WIDGET_ACTION_RETIRED = (key: 'actionUrl' | 'actionType' | 'actionIcon') =>
  `\`dashboard.widgets[].${key}\` was removed in @objectstack/spec 17.0.0 (#5010, `
  + 'ADR-0049 enforce-or-remove) — a dashboard widget has NO action button, and never had one. '
  + 'No renderer draws per-widget chrome for it: every action the dashboard dispatches comes from '
  + '`header.actions[]`. The three keys `actionUrl` / `actionType` / `actionIcon` went together; '
  + 'delete all three. '
  + 'Put the affordance on the dashboard header instead — '
  + "`header: { actions: [{ label, actionUrl, actionType, icon }] }` — which IS dispatched "
  + '(`DashboardHeaderAction`, same vocabulary, and `icon` is the header spelling of '
  + '`actionIcon`). For a per-ROW affordance, the widget to reach for is a `table`/`pivot` '
  + 'bound to a dataset: its rows are clickable and drill through the semantic layer. '
  + 'Run `os migrate meta --from 16` to rewrite it automatically.';

/**
 * Dashboard Widget Schema
 * A single component on the dashboard grid.
 *
 * Strict since the ADR-0021 cutover; since #6619 strict through the SHARED
 * `strictObject` template rather than a hand-written `$ZodErrorMap`. The three
 * prescriptions are unchanged in wording ({@link WIDGET_GUIDANCE_SETS}); what
 * the fold adds is the rename channel the bespoke map never had — `titel`,
 * `datset`, `dimension`, `option` now resolve to the declared key instead of
 * being echoed back with nothing but the history sentence.
 */
export const DashboardWidgetSchema = lazySchema(() => strictObject({
  surface: 'this dashboard widget',
  history: WIDGET_HISTORY,
  guidanceSets: WIDGET_GUIDANCE_SETS,
}, {
  /** Unique widget identifier (snake_case, used for targetWidgets references) */
  id: SnakeCaseIdentifierSchema.describe('Unique widget identifier (snake_case)'),

  /** Widget Title */
  title: I18nLabelSchema.optional().describe('Widget title'),

  /** Widget Description (displayed below the title) */
  description: I18nLabelSchema.optional().describe('Widget description text below the header'),
  
  /** Visualization Type */
  type: ChartTypeSchema.default('metric').describe('Visualization type'),
  
  /** Chart Configuration */
  chartConfig: ChartConfigSchema.optional().describe('Chart visualization configuration'),

  /** Color variant for the widget (e.g., KPI card accent color) */
  colorVariant: WidgetColorVariantSchema.optional().describe('Widget color variant for theming'),

  /**
   * Runtime capability gate — widget is hidden when the named object is
   * not registered in the runtime's SchemaRegistry. Mirrors
   * `NavigationItem.requiresObject` so cloud-only widgets (e.g. those
   * keyed on `sys_app` / `sys_package_installation`) silently disappear
   * in single-environment runtimes instead of rendering a 404 error.
   * Set explicitly to the dataset's base object when the widget should be
   * gated on that object's availability.
   */
  requiresObject: z.string().optional().describe('Hide the widget unless the named object is registered'),

  /**
   * Runtime capability gate — widget is hidden when the named kernel
   * service is not registered. Mirrors `NavigationItem.requiresService`.
   */
  requiresService: z.string().optional().describe('Hide the widget unless the named kernel service is registered'),

  // `actionUrl` / `actionType` / `actionIcon` REMOVED (#5010, ADR-0049 D2):
  // the three keys described a per-widget header action BUTTON that no renderer
  // has ever drawn. Re-measured 2026-08-04 against objectui@91757a7: all 14
  // `actionUrl` reads in `DashboardRenderer.tsx` are scoped to
  // `schema.header.actions[]` (a `DashboardHeaderAction`, a different schema);
  // `actionIcon` has zero references in either repo outside this declaration.
  // The one consumer of the pair was `packages/lint`'s reference-integrity rule,
  // which failed builds when a NEVER-RENDERED button pointed at a missing
  // action — its widget branch goes with the keys, in this same change.
  actionUrl: retiredKey(WIDGET_ACTION_RETIRED('actionUrl')),
  actionType: retiredKey(WIDGET_ACTION_RETIRED('actionType')),
  actionIcon: retiredKey(WIDGET_ACTION_RETIRED('actionIcon')),

  /** Presentation-scope filter (MongoDB-style), ANDed into the dataset query as `runtimeFilter`. */
  filter: FilterConditionSchema.optional().describe('Presentation-scope filter (runtimeFilter)'),

  /**
   * Period-over-period comparison window.
   *
   * When set, the runtime runs a second query against a shifted time window
   * and attaches a `<measure>__compare` column per selected measure; metric
   * widgets show a secondary value + arrow, chart widgets render a
   * muted/dashed overlay series.
   *
   * - `kind: 'previousPeriod'` — the equal-length window immediately before
   *   the resolved one.
   * - `kind: 'previousYear'` — the same window shifted back one calendar year.
   * - `dimension` — OPTIONAL. Which time dimension's window to shift; omit it
   *   and the executor resolves it (see below).
   *
   * ## Why this shape (#5011)
   *
   * This is a **thin projection of `DatasetSelection.compareTo`**
   * (`contracts/analytics-service.ts`) — the one comparison contract the
   * analytics executor actually implements. Until #5011 the widget declared a
   * different vocabulary from the executor and the two never met: the two
   * string arms were dropped on the floor by the dataset renderer (a
   * comparison silently absent from a widget whose author had asked for one)
   * and `{ offset }` was forwarded verbatim into a contract with no `offset`
   * in it, so the executor threw `compareTo requires a timeDimension
   * "undefined"` and the whole widget errored. Every arm was broken on the
   * ADR-0021 dataset path — the path this spec calls the single author-facing
   * analytics shape — while all three worked on the legacy inline chart path.
   * Same key, two fates, the failing one blessed.
   *
   * Converging on the executor's own words makes `declared = enforced` true by
   * construction rather than by vigilance: there is no widget-side vocabulary
   * left to drift. It also leaves the slot union-free, which matters more than
   * it looks — a union collapses into one bare `Invalid input` on the wire
   * (#5014), so every curated message this campaign puts inside a union arm is
   * written for a reader who never receives it. A plain strict object's errors
   * reach the author.
   *
   * ## Resolving `dimension`
   *
   * Omit it and the EXECUTOR resolves it, by its own criterion: the selection's
   * time dimensions that carry a `dateRange`. Exactly one candidate is used;
   * zero or several is a loud error naming what it found. That rule lives in
   * `dataset-executor.ts` — deliberately at the producer of the comparison, not
   * as a renderer-side guess, so every caller gets the same answer or the same
   * error (PD #12).
   *
   * `{ offset: '7d' | '1M' | '1y' }` was REMOVED in the same change; see
   * `COMPARE_TO_OFFSET_RETIRED` below.
   */
  compareTo: strictObject({
    surface: 'this comparison window',
    history: DASHBOARD_HISTORY,
    // Near-misses for the two live keys. The `kind` entries are not invented:
    // #5042 curated `type`/`mode` here as guidance ("the comparison KIND is the
    // union itself, not a key"), i.e. it had already measured that authors
    // reach for those words on this slot. Now that `kind` IS the key, the same
    // claim becomes a faithful rename. The `dimension` entries name the
    // neighbouring vocabulary for "which date column": `dateRange.field` on the
    // dashboard filter bar and `timeDimensions[].dimension` on the wire.
    aliases: {
      type: 'kind',
      mode: 'kind',
      field: 'dimension',
      dateField: 'dimension',
      timeDimension: 'dimension',
    },
    guidance: {
      // The retired `{ offset }` arm and every word #5042 measured authors
      // spelling it with. All resolve to one prescription: an explicit-duration
      // shift has no executor behind it and never had one.
      offset: COMPARE_TO_OFFSET_RETIRED,
      period: COMPARE_TO_OFFSET_RETIRED,
      duration: COMPARE_TO_OFFSET_RETIRED,
      interval: COMPARE_TO_OFFSET_RETIRED,
      shift: COMPARE_TO_OFFSET_RETIRED,
      delta: COMPARE_TO_OFFSET_RETIRED,
      by: COMPARE_TO_OFFSET_RETIRED,
      amount: COMPARE_TO_OFFSET_RETIRED,
      value: COMPARE_TO_OFFSET_RETIRED,
      // Two real slots one level up, both easy to reach for from in here.
      granularity: 'a comparison window carries no granularity — it shifts a window, it does not bucket one. Date bucketing is `options.dateGranularity` on this widget (or the DATASET dimension\'s own `dateGranularity` default), and the comparison pass reuses whatever the primary pass resolved.',
      filter: '`filter` is the widget\'s own presentation-scope key, one level up — `compareTo` shifts whatever window that filter already resolves to. Move it out of `compareTo`.',
    },
    // The two spellings that really were legal until #5011 — and, being the
    // documented ones, overwhelmingly the shape an upgrading source carries.
    retiredForms: {
      previousPeriod: COMPARE_TO_STRING_RETIRED('previousPeriod'),
      previousYear: COMPARE_TO_STRING_RETIRED('previousYear'),
    },
  }, {
    /**
     * Which comparison window to run — the executor's own two kinds
     * (`DatasetCompareTo.kind`).
     */
    kind: z.enum(['previousPeriod', 'previousYear'])
      .describe('Comparison window: previousPeriod (equal-length, immediately before) or previousYear (−1 calendar year)'),
    /**
     * The time dimension (by name) whose window is shifted. Omit it when the
     * selection has exactly one dated time dimension — the executor resolves it
     * and errors loudly, listing the candidates, when the choice is ambiguous
     * or there is nothing dated to shift.
     */
    dimension: z.string().optional()
      .describe('Time dimension to shift; omit when the selection has exactly one dated time dimension'),
  }).optional().describe('Period-over-period comparison window ({ kind, dimension? })'),

  /**
   * ADR-0021 — the semantic-layer `dataset` this widget binds to. The widget
   * selects the dataset's dimensions/measures BY NAME; the dataset owns the base
   * object, allowed joins, intrinsic filter, dimensions, and measures,
   * so numbers stay consistent across every surface. This is the single
   * author-facing analytics shape (the legacy inline `object` + `categoryField`
   * + `valueField` + `aggregate` query was removed in the single-form cutover).
   */
  dataset: SnakeCaseIdentifierSchema.describe('Dataset name to bind (ADR-0021)'),
  /** Dimension names (from the dataset) for X / group / split. */
  dimensions: z.array(z.string()).optional().describe('Dimension names — X/group/split'),
  /** Measure names (from the dataset) for the value axis. */
  values: z.array(z.string()).min(1).describe('Measure names — Y (at least one)'),

  /**
   * Layout Position (React-Grid-Layout style)
   * x: column (0-11)
   * y: row
   * w: width (1-12)
   * h: height
   *
   * OPTIONAL — when omitted, the renderer auto-flows the widget into the grid
   * (DashboardGridLayout falls back to `x: (i % 4) * 3, y: Math.floor(i/4) * 4,
   * w: 3, h: 4`). The Studio dashboard designer adds widgets WITHOUT a layout
   * and relies on this auto-flow; requiring `layout` here made every
   * designer-authored dashboard fail validation (422 on draft save, Publish
   * disabled) even though it rendered correctly. Authors may still pin an
   * explicit grid position; absence means "auto-place".
   */
  layout: strictObject({
    surface: 'this widget layout box',
    history: DASHBOARD_HISTORY,
    // React-Grid-Layout's own vocabulary is the competing contract here, and it
    // is the one an author (or an LLM) will already know: RGL declares
    // `minW`/`maxW`/`minH`/`maxH`/`static`/`isDraggable`/`isResizable` beside
    // the same four letters. The renderer reads ONLY `{x, y, w, h}` (and
    // auto-flows when the box is absent), so the rest are named rather than
    // suggested — a rename would map a real RGL constraint onto an unrelated
    // position key.
    aliases: {
      col: 'x',
      column: 'x',
      left: 'x',
      row: 'y',
      top: 'y',
      width: 'w',
      cols: 'w',
      colSpan: 'w',
      height: 'h',
      rows: 'h',
      rowSpan: 'h',
    },
    guidance: {
      minW: 'a widget layout box is exactly `{ x, y, w, h }`. React-Grid-Layout\'s size CONSTRAINTS (`minW`/`maxW`/`minH`/`maxH`) are not part of the metadata contract — the dashboard grid sizes by `columns` + `gap` on the dashboard and this box on the widget.',
      maxW: 'a widget layout box is exactly `{ x, y, w, h }`. React-Grid-Layout\'s size CONSTRAINTS (`minW`/`maxW`/`minH`/`maxH`) are not part of the metadata contract — the dashboard grid sizes by `columns` + `gap` on the dashboard and this box on the widget.',
      minH: 'a widget layout box is exactly `{ x, y, w, h }`. React-Grid-Layout\'s size CONSTRAINTS (`minW`/`maxW`/`minH`/`maxH`) are not part of the metadata contract — the dashboard grid sizes by `columns` + `gap` on the dashboard and this box on the widget.',
      maxH: 'a widget layout box is exactly `{ x, y, w, h }`. React-Grid-Layout\'s size CONSTRAINTS (`minW`/`maxW`/`minH`/`maxH`) are not part of the metadata contract — the dashboard grid sizes by `columns` + `gap` on the dashboard and this box on the widget.',
      static: 'a widget layout box is exactly `{ x, y, w, h }`. React-Grid-Layout\'s interaction flags (`static`/`isDraggable`/`isResizable`) are the DESIGNER\'s runtime state, not authored metadata — omit the box entirely to let the grid auto-flow the widget.',
      isDraggable: 'a widget layout box is exactly `{ x, y, w, h }`. React-Grid-Layout\'s interaction flags (`static`/`isDraggable`/`isResizable`) are the DESIGNER\'s runtime state, not authored metadata — omit the box entirely to let the grid auto-flow the widget.',
      isResizable: 'a widget layout box is exactly `{ x, y, w, h }`. React-Grid-Layout\'s interaction flags (`static`/`isDraggable`/`isResizable`) are the DESIGNER\'s runtime state, not authored metadata — omit the box entirely to let the grid auto-flow the widget.',
      i: 'React-Grid-Layout keys an item by `i`; this box does not carry an id — the widget\'s own `id` (one level up) is the key. Remove it.',
    },
  }, {
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }).optional().describe('Grid layout position (auto-flowed when omitted)'),
  
  /** Widget specific options (colors, legend, etc.) — see {@link DashboardWidgetOptionsSchema}. */
  options: DashboardWidgetOptionsSchema.optional().describe('Widget specific configuration'),

  /**
   * Per-widget bindings from a dashboard-level filter (referenced by its
   * `name`, or the reserved name `"dateRange"` for the built-in date range)
   * to one of THIS widget's fields (framework#2501):
   * - string → apply the filter to that field (e.g. `{ dateRange: 'signed_at' }`)
   * - false  → opt this widget out of that filter
   * - absent → default binding: the filter's own `field`
   *   (dateRange: `dateRange.field ?? 'created_at'`)
   */
  filterBindings: z.record(z.string(), z.union([z.string(), z.literal(false)])).optional()
    .describe("Per-widget dashboard-filter bindings: filter name → this widget's field, or false to opt out"),

  /**
   * Rule ids of build diagnostics intentionally suppressed on this widget
   * (e.g. `'table-count-only'` when a single-row summary table is deliberate).
   * Consumed by `objectstack build` / `objectstack lint`; no runtime effect.
   */
  suppressWarnings: z.array(z.string()).optional().describe('Build diagnostic rule ids suppressed on this widget'),

  // `responsive` REMOVED (#4876): authorable and inert, exactly like the
  // same-named `view.responsive` retired four days earlier (#3896 close-out).
  // No objectui code read `widget.responsive` — DashboardRenderer /
  // DashboardEditor / plugin-designer mention it only in comments, and the one
  // real per-breakpoint consumer (`useResponsiveConfig`) is fed by
  // `page.components[].responsive`, not by a widget. It escaped the #3896 sweep
  // through a liveness-ledger drill gap, not on evidence: `dashboard.json`
  // declares no `children` on `widgets`, so no widget-level key has ever been
  // classified (#4956). The shared `ResponsiveConfigSchema` survives untouched
  // via `page.zod.ts` — only this embed goes.
  responsive: retiredKey(
    '`dashboard.widgets[].responsive` was removed in @objectstack/spec 17.0.0 (#4876, ADR-0049 D2) — ' +
    'no renderer ever read it, so per-widget breakpoint overrides were never applied: the value ' +
    'parsed, validated, and then did nothing. The dashboard grid reflows by its own layout rules ' +
    '(`columns` + `gap` on the dashboard, the `layout` box on each widget). Delete the key. ' +
    'The shared `ResponsiveConfig` shape is NOT gone — it stays live on `page.components[].responsive`, ' +
    'which objectui `useResponsiveConfig` really does read; move the layout there if you need ' +
    'breakpoint behaviour today. ' +
    'Run `os migrate meta --from 16` to rewrite it automatically.',
  ),

  // `aria` REMOVED (#5010, ADR-0049 D2): the same "false compliance" the
  // dashboard-level `aria` was retired for in the #3896 close-out (see the
  // tombstone on `DashboardSchema` below) — declared ARIA attributes never
  // reached the DOM, so a dashboard could claim accessibility work that had
  // measurably not happened. Call graph closed by hand across both repos
  // 2026-08-04: no consumer of `widget.aria` anywhere. The `aria-*` attributes
  // in `DashboardRenderer` / `DatasetWidget` are the renderer's OWN DOM props,
  // and objectui's single `.aria` read (`plugin-view/ObjectView.tsx:989`) is a
  // `view`'s. The shared `AriaPropsSchema` is untouched — it stays live on
  // `page.aria` / `page.components[].aria` and on the list view's `aria`,
  // which really are applied (`action.aria` carries the shape too, but the
  // ledger grades that one PARTIAL). It is NOT live on `app.aria`: that key
  // is a `retiredKey()` tombstone removed in the same 17.0.0 by the 2026-06
  // app liveness audit, and `os migrate meta --from 16` strips it — so the
  // "lift it up to the app" repair this note used to imply was a dead end
  // that also lost the block (#6756).
  aria: retiredKey(
    '`dashboard.widgets[].aria` was removed in @objectstack/spec 17.0.0 (#5010, ADR-0049 D2) — ' +
    'no renderer ever applied it, so ARIA attributes declared on a widget silently did not reach ' +
    'the DOM: the key promised accessibility compliance it did not deliver. This is the same ' +
    'removal the dashboard-level `aria` got in 17.0.0 (#3896). Delete the key. The dashboard ' +
    'renderer emits its own `aria-*` attributes for the widget grid; author a `title` (and ' +
    '`description`) on the widget instead — those ARE what the renderer labels the card with. ' +
    'The shared `AriaProps` shape is NOT gone: it stays live on `page.aria`, ' +
    '`page.components[].aria` and the list view `aria`. ' +
    'Run `os migrate meta --from 16` to remove it automatically.',
  ),
  // ADR-0021 single-form: every widget binds a `dataset` and selects `values`
  // (both required above) — there is no inline-query shape to disambiguate.
  //
  // ADR-0021 endpoint (framework#3251, protocol 16 `step16`): `strictObject`
  // rejects undeclared top-level keys instead of silently stripping them. A
  // hallucinated or legacy key is a deterministic author-time error (CI) rather
  // than a silent no-op a human reviewer would miss. `options` stays the
  // free-form escape hatch for renderer-specific extras.
}));

/**
 * Dashboard date-range presets — the named windows a dashboard date filter may
 * select, in the display order the filter bar offers them.
 *
 * **This is the vocabulary's single source of truth (#4614).** It used to exist
 * three times: inline in `dateRange.defaultRange` below, as `PRESET_RANGES` in
 * objectui's `dashboard-filters` (the module that maps each name to its
 * date-macro bounds), and as a hand-written table in
 * `content/docs/ui/dashboards.mdx`. Three copies of one enum drift in the
 * direction nobody notices: a name the renderer knows but the schema does not is
 * rejected from metadata that would have rendered, and a name the schema knows
 * but the renderer does not validates clean and then resolves to nothing.
 *
 * Each preset resolves to a pair of date-macro token bounds at query time (see
 * `DATE_MACRO_TOKENS` in `../data/date-macros.zod`). That is why the two
 * vocabularies live one import apart and neither restates the other's grammar.
 */
export const DATE_RANGE_PRESETS = [
  'today',        'yesterday',
  'this_week',    'last_week',
  'this_month',   'last_month',
  'this_quarter', 'last_quarter',
  'this_year',    'last_year',
  'last_7_days',  'last_30_days', 'last_90_days',
] as const;

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

/**
 * What `dashboard.dateRange.defaultRange` accepts: every preset, plus the
 * `custom` sentinel.
 *
 * `custom` is deliberately NOT a member of {@link DATE_RANGE_PRESETS} — it names
 * no window. It means "open the from/to picker with no preset applied", so it
 * carries no bounds and resolves to no range. That distinction is load-bearing
 * in both directions: `defaultRange: 'custom'` is a legitimate dashboard
 * declaration, while a `globalFilters` date filter defaulting to `'custom'` is
 * not — a bare filter value gives the sentinel no from/to to hand over. The
 * `superRefine` on {@link GlobalFilterSchema} therefore checks the presets
 * alone, and this list exists so `defaultRange`'s accepted set is left exactly
 * as it was by the extraction.
 */
export const DATE_RANGE_DEFAULT_RANGES = [...DATE_RANGE_PRESETS, 'custom'] as const;

export type DateRangeDefaultRange = (typeof DATE_RANGE_DEFAULT_RANGES)[number];

/**
 * ISO calendar date, optionally carrying a time part — `2026-01-15`,
 * `2026-01-15T08:30:00Z`. Deliberately narrower than `Date.parse`, which also
 * accepts locale prose (`March 5, 2026`) and bare years (`2026`); neither is a
 * value a backend compares a date column against usefully.
 *
 * Mirrors the accepted set of objectui's `isUsableDateString`, so this schema
 * never rejects a spelling the renderer resolves correctly.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** True for `'{today}'` / `'${30_days_ago}'` — a wrapped, KNOWN macro token. */
function isDateMacroPlaceholder(value: string): boolean {
  const m = value.match(DATE_MACRO_WRAPPED_RE);
  return !!m && isDateMacroToken(m[1]);
}

/**
 * Dynamic options binding for global filters.
 * Allows dropdown options to be fetched from an object at runtime.
 */
export const GlobalFilterOptionsFromSchema = lazySchema(() => strictObject({
  surface: 'this dynamic filter option source',
  history: DASHBOARD_HISTORY,
  aliases: { objectName: 'object', from: 'object', source: 'object', value: 'valueField', label: 'labelField', text: 'labelField', where: 'filter', criteria: 'filter' },
}, {
  /** Source object name to fetch options from */
  object: z.string().describe('Source object name'),

  /** Field to use as option value */
  valueField: z.string().describe('Field to use as option value'),

  /** Field to use as option label */
  labelField: z.string().describe('Field to use as option label'),

  /** Optional filter to apply when fetching options */
  filter: FilterConditionSchema.optional().describe('Filter to apply to source object'),
}).describe('Dynamic filter options from object'));

/**
 * Global Filter Schema
 * Defines a single global filter control for the dashboard filter bar.
 */
export const GlobalFilterSchema = lazySchema(() => strictObject({
  surface: 'this global filter',
  history: DASHBOARD_HISTORY,
  aliases: { key: 'name', variable: 'name', fieldName: 'field', title: 'label', inputType: 'type', control: 'type', choices: 'options', values: 'options', source: 'optionsFrom', dataSource: 'optionsFrom', optionsSource: 'optionsFrom', default: 'defaultValue', widgets: 'targetWidgets', appliesTo: 'targetWidgets' },
  guidance: {
    // The binding runs the other way: a widget opts in/out via `filterBindings`.
    // `targetWidgets` exists, but only for `scope: 'widget'`.
    filterBindings: 'a widget declares its own binding — `filterBindings` lives on the WIDGET and maps this filter\'s `name` to one of that widget\'s fields (or `false` to opt out)',
  },
}, {
  /**
   * Stable filter name (framework#2501) — the dashboard-variable key under
   * which the filter's value is published (readable in widget expressions as
   * `page.<name>`) and the key widgets reference in `filterBindings`.
   * Defaults to `field`. The name `"dateRange"` is reserved for the built-in
   * dashboard date range.
   */
  name: z.string().optional().describe('Stable filter name (variable key); defaults to field'),

  /** Field name to filter on */
  field: z.string().describe('Field name to filter on'),

  /** Display label for the filter */
  label: I18nLabelSchema.optional().describe('Display label for the filter'),

  /** Filter input type */
  type: z.enum(['text', 'select', 'date', 'number', 'lookup']).optional().describe('Filter input type'),

  /** Static options for select/lookup filters */
  options: z.array(strictObject({
    surface: 'this filter option',
    history: DASHBOARD_HISTORY,
    aliases: { key: 'value', id: 'value', text: 'label', title: 'label', name: 'label' },
  }, {
    value: z.union([z.string(), z.number(), z.boolean()]).describe('Option value'),
    label: I18nLabelSchema,
  })).optional().describe('Static filter options'),

  /** Dynamic data binding for filter options */
  optionsFrom: GlobalFilterOptionsFromSchema.optional().describe('Dynamic filter options from object'),

  /** Default filter value */
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Default filter value'),

  /** Filter application scope */
  scope: z.enum(['dashboard', 'widget']).default('dashboard').describe('Filter application scope'),

  /** Widget IDs to apply this filter to (when scope is widget) */
  targetWidgets: z.array(z.string()).optional().describe('Widget IDs to apply this filter to'),
}).superRefine((filter, ctx) => {
  // #4614 — a date filter's `defaultValue` is checked against the vocabulary
  // that can actually resolve it.
  //
  // Why this filter type and not the built-in `dateRange`: `dateRange`'s
  // `defaultRange` has always been an enum, so a typo there was already an
  // author-time error. A `globalFilters` entry of `type: 'date'` was the
  // asymmetric half — `defaultValue` is `string | number | boolean`, so a bare
  // preset name is the ONLY spelling available, and nothing checked it. An
  // unknown name then failed SILENTLY and late: the renderer cannot lift it to a
  // range, falls through to "a bare string date means equality on that day", and
  // emits `created_at = 'last_7_dayz'` — a condition no row matches, which the
  // backend answers `200 OK` with a zero. Every tile reads 0 and the filter bar
  // shows "All time", so the dashboard looks deliberately empty rather than
  // misconfigured. That is the failure this moves to parse time.
  if (filter.type !== 'date' || filter.defaultValue === undefined) return;

  const value = filter.defaultValue;
  if (
    typeof value === 'string' &&
    ((DATE_RANGE_PRESETS as readonly string[]).includes(value) ||
      isDateMacroPlaceholder(value) ||
      ISO_DATE_RE.test(value))
  ) {
    return;
  }

  ctx.addIssue({
    code: 'custom',
    path: ['defaultValue'],
    message:
      `${JSON.stringify(value)} is not a value a \`type: 'date'\` filter can resolve. ` +
      'Use one of three spellings: a preset name (' +
      DATE_RANGE_PRESETS.join(', ') +
      '); an ISO date such as `2026-01-15` or `2026-01-15T08:30:00Z`, meaning that ' +
      'day exactly; or a date-macro token such as `{today}` or `{30_days_ago}` ' +
      '(the full vocabulary is `DATE_MACRO_TOKENS` in `@objectstack/spec/data`). ' +
      "`custom` is not among them — it is a `dateRange.defaultRange` sentinel that " +
      'carries no bounds of its own.',
  });
}));

/**
 * Dashboard Schema
 * Represents a page containing multiple visualizations.
 * 
 * @example Sales Executive Dashboard (ADR-0021: widgets bind a `dataset` and
 * select `dimensions`/`values` BY NAME — each metric/measure is defined once in
 * `defineDataset`, never inline on the widget)
 * {
 *   name: "sales_overview",
 *   label: "Sales Executive Overview",
 *   widgets: [
 *     {
 *       title: "Total Pipe",
 *       type: "metric",
 *       dataset: "opportunity_metrics",
 *       values: ["amount_sum"],
 *       layout: { x: 0, y: 0, w: 3, h: 2 }
 *     },
 *     {
 *       title: "Revenue by Region",
 *       type: "bar",
 *       dataset: "order_metrics",
 *       dimensions: ["region"],
 *       values: ["total_sum"],
 *       layout: { x: 3, y: 0, w: 6, h: 4 }
 *     }
 *   ]
 * }
 */
export const DashboardSchema = lazySchema(() => strictObject({
  surface: 'this dashboard',
  history: DASHBOARD_HISTORY,
  aliases: {
    title: 'label', displayName: 'label',
    charts: 'widgets', components: 'widgets', cards: 'widgets', tiles: 'widgets',
    filters: 'globalFilters', globalFilter: 'globalFilters',
    grid: 'columns', columnCount: 'columns',
    spacing: 'gap',
    refresh: 'refreshInterval', autoRefresh: 'refreshInterval', pollInterval: 'refreshInterval',
    dateFilter: 'dateRange', timeRange: 'dateRange',
  },
  guidance: {
    // Widget layout is per-widget; a dashboard-level `layout` reads like a
    // template selector, which does not exist here.
    layout: 'a dashboard has no layout template — each widget carries its own `layout: { x, y, w, h }`, and a widget with none is auto-flowed into the grid',
    theme: 'dashboards do not carry a theme — presentation-only widget settings go under that widget\'s `options`',
  },
}, {
  /** Machine name */
  name: SnakeCaseIdentifierSchema.describe('Dashboard unique name'),
  
  /** Display label */
  label: I18nLabelSchema.describe('Dashboard label'),
  
  /** Description */
  description: I18nLabelSchema.optional().describe('Dashboard description'),

  /** Structured header configuration */
  header: DashboardHeaderSchema.optional().describe('Dashboard header configuration'),
  
  /** Collection of widgets */
  widgets: z.array(DashboardWidgetSchema).describe('Widgets to display'),

  /** Grid column count — defaults to 12 for a standard 12-column grid */
  columns: z.number().int().min(1).max(24).optional().describe('Number of grid columns (default 12)'),

  /** Grid gap in Tailwind spacing units (e.g. 4 = 1rem) */
  gap: z.number().int().min(0).optional().describe('Grid gap in Tailwind spacing units'),

  /** Auto-refresh */
  refreshInterval: z.number().optional().describe('Auto-refresh interval in seconds'),

  /** Dashboard Date Range (Global time filter) */
  dateRange: strictObject({
    surface: 'this dashboard date range',
    history: DASHBOARD_HISTORY,
    aliases: { dateField: 'field', fieldName: 'field', preset: 'defaultRange', range: 'defaultRange', default: 'defaultRange', allowCustom: 'allowCustomRange', custom: 'allowCustomRange' },
  }, {
    field: z.string().optional().describe('Default date field name for time-based filtering'),
    defaultRange: z.enum(DATE_RANGE_DEFAULT_RANGES).default('this_month').describe('Default date range preset'),
    allowCustomRange: z.boolean().default(true).describe('Allow users to pick a custom date range'),
  }).optional().describe('Global dashboard date range filter configuration'),

  /** Global Filters */
  globalFilters: z.array(GlobalFilterSchema).optional().describe('Global filters that apply to all widgets in the dashboard'),

  // `aria` / `performance` REMOVED (#3896 audit close-out): authorable and
  // inert — no DashboardRenderer path applied either (ledger: dead; the
  // report twins were removed in the report-liveness close-out).
  aria: retiredKey(
    '`dashboard.aria` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — no ' +
    'dashboard renderer ever applied it, so declared ARIA attributes silently did not reach ' +
    'the DOM. Delete the key.',
  ),
  performance: retiredKey(
    '`dashboard.performance` was removed in @objectstack/spec 17.0.0 (#3896 audit ' +
    'close-out) — no renderer or runtime read it; dashboard performance tuning was never ' +
    'implemented. Delete the key.',
  ),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this dashboard.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}));

export type Dashboard = z.input<typeof DashboardSchema>;
/** Post-parse shape of {@link Dashboard} — defaults applied, transforms run (ADR-0122). */
export type DashboardParsed = z.infer<typeof DashboardSchema>;
export type DashboardWidget = z.input<typeof DashboardWidgetSchema>;
/** Post-parse shape of {@link DashboardWidget} — defaults applied, transforms run (ADR-0122). */
export type DashboardWidgetParsed = z.infer<typeof DashboardWidgetSchema>;
export type DashboardWidgetOptions = z.input<typeof DashboardWidgetOptionsSchema>;
export type DashboardHeader = z.input<typeof DashboardHeaderSchema>;
/** Post-parse shape of {@link DashboardHeader} — defaults applied, transforms run (ADR-0122). */
export type DashboardHeaderParsed = z.infer<typeof DashboardHeaderSchema>;
export type DashboardHeaderAction = z.input<typeof DashboardHeaderActionSchema>;
export type WidgetColorVariant = z.input<typeof WidgetColorVariantSchema>;
export type WidgetActionType = z.input<typeof WidgetActionTypeSchema>;
export type GlobalFilter = z.input<typeof GlobalFilterSchema>;
/** Post-parse shape of {@link GlobalFilter} — defaults applied, transforms run (ADR-0122). */
export type GlobalFilterParsed = z.infer<typeof GlobalFilterSchema>;
export type GlobalFilterOptionsFrom = z.input<typeof GlobalFilterOptionsFromSchema>;

/**
 * Dashboard Factory Helper
 */
export const Dashboard = {
  create: (config: z.input<typeof DashboardSchema>): Dashboard => DashboardSchema.parse(config),
} as const;
