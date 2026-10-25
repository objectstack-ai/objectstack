/**
 * ObjectUI — unconsumed dashboard-widget `options` keys (`8d58f46b4`)
 *
 * `@objectstack/spec`'s `DashboardWidgetOptionsSchema` ends in `.passthrough()`
 * ("declared query keys + open renderer extras"), so ANY key parses, validates
 * and lints cleanly — including one no renderer reads. That is how a showcase
 * dashboard shipped `options: { invert: true }` on a gauge with a comment
 * saying what it was believed to do, and rendered the un-inverted measure with
 * no diagnostic anywhere (`8d58f46b4`). The 2026-08-23 maintainer ruling:
 * open extras stay open — they just stop being SILENT. A key that reaches no
 * renderer draws a WARNING naming the consumed set. Not an error: no gate
 * weakening and no new red gates were ruled.
 *
 * ## The census (measured on origin/main @ 8689166f6, spec 17.1.0)
 *
 * The spec REQUIRES `dataset` on every widget (`DashboardWidgetSchema` —
 * re-read for objectui#7293 against the PUBLISHED `@objectstack/spec@17.4.0`,
 * whose required keys are exactly `id` / `dataset` / `values`), and
 * both dashboard surfaces route a dataset-bound widget to `DatasetWidget`
 * (`DashboardRenderer.tsx` renders `<DatasetWidget>` when `widget.dataset` is
 * set; `DashboardGridLayout.tsx` mirrors the fork, objectui#4614). On that —
 * the only spec-legal — path, the renderer-consumed `options` keys are exactly
 * the five the spec DECLARES, all read as direct `options.<key>` accesses in
 * `packages/plugin-dashboard/src/DatasetWidget.tsx`:
 *
 *   dateGranularity, sortBy, sortOrder, limit   (query-affecting, framework#3588)
 *   stageOrder                                  (funnel/pyramid stage order)
 *
 * and nothing else. ⛔ Not `description`: it was the metric-card sub-caption
 * (objectui#4032 item 4, objectui#7293), read by `DatasetWidget.tsx`'s metric
 * branch and a resolver both dashboard surfaces called, and fed by the
 * server's `translateDashboard` overlay of the `widgets.{id}.subCaption`
 * translation. The spec never declared it. objectui#11389 (ruling C, which
 * reverses objectstack#5428 item 4) retires it at both ends: objectstack
 * first, in `@objectstack/spec` 17.7.0 (the overlay is gone and the
 * translation key is a tombstone), then the readers here. So an authored
 * `options.description` reaches no renderer and draws this warning like any
 * other unconsumed key. A widget keeps one authored description,
 * `widget.description`, the card-header subtitle, which is not an `options`
 * key and is not judged here.
 *
 * Notably NOT consumed on the path a widget really renders through:
 * `thresholds` and `format`. Both were widely believed to work; both draw this
 * warning, which is the point. They are NOT the same kind of claim, and since
 * the 2026-08-25 maintainer ruling (batch adjudication close-out, decision B1 —
 * a closure claim must be BOUNDED or DERIVABLE, and a claim written in two
 * places is single-sourced) they are written separately (objectui#6186):
 *
 *   `thresholds` — zero read sites repo-wide. This paragraph is the CANONICAL
 *     statement of that closure claim. `content/docs/plugins/plugin-dashboard.mdx`
 *     used to assert it a second time in its own words; two copies of one
 *     closure claim drift apart independently and neither knows when the other
 *     stopped being true, so the page now POINTS here rather than restating it.
 *     Single-sourcing is what makes this copy load-bearing, so it is DERIVED
 *     rather than trusted:
 *     `scripts/__tests__/unconsumed-widget-option-claim-6186.test.ts` re-scans
 *     every JS/TS file git tracks for an access to a key of that name and fails
 *     if one appears. Land a renderer that reads it and this module goes red in
 *     the same run.
 *   `format` — not read ON THE DATASET-BOUND PATH; the value is formatted with
 *     the MEASURE's own metadata (`measureField(...).format`, from the dataset
 *     definition), not from the widget's bag. Deliberately a BOUNDED claim and
 *     not a repo-wide one: `format` is a live key in other vocabularies, so a
 *     repo-wide scan would red on a TRUE claim — and an assertion that reds on
 *     legitimate code gets deleted by the next person who hits it, which puts
 *     the claim back where it started. Leg 2 of
 *     `__tests__/dashboard-widget-options-census.test.ts` derives exactly this
 *     bound: the DatasetWidget read set is the declared set, and neither
 *     `format` nor `thresholds` is in it. That absence is asserted in its OWN
 *     right rather than riding on an equality whose right-hand side can grow.
 *
 * ## Scope — where the warning deliberately does NOT fire
 *
 *   - Widgets WITHOUT `dataset`: the legacy inline forms (`options.data`
 *     arrays, `provider: 'object'` bags) consume a much larger, spread-shaped
 *     key set (`{ ...options }` into `metric` / `object-metric` /
 *     `data-table` / …), whose true reach is each child component's prop
 *     surface. That form is spec-illegal today (`dataset` is required) and its
 *     census would be the unmaintainable one; skipping it keeps every warning
 *     this module emits a statement about the path the widget actually renders
 *     through.
 *   - Widgets in the legacy COMPONENT format (`widget.component`): `options`
 *     is not part of that contract.
 *   - Widgets carrying the spec's own escape hatch
 *     `suppressWarnings: ['unconsumed-widget-option']` — the spec models
 *     per-widget diagnostic suppression (`DashboardWidgetSchema`), so an
 *     author with a genuine out-of-band consumer can say so in metadata.
 *
 * ## Maintenance — how this list stays true
 *
 * `__tests__/dashboard-widget-options-census.test.ts` re-runs the census on
 * every test run: it re-derives the five declared keys from the installed
 * `@objectstack/spec`, re-extracts the `options.<key>` reads from
 * `DatasetWidget.tsx` source text (and fails loudly if that file gains a
 * consumption shape the extractor cannot see — a spread, a destructuring, a
 * computed access), re-checks that the retired sub-caption key has no read
 * site left in `plugin-dashboard`, and trips on any NEW
 * file in `packages/*\/src` or `apps/*\/src` that starts reading
 * `widget.options`. A renderer change that adds or removes a consumed key
 * fails that test until this list is updated — the cost of keeping this
 * warning honest is editing ONE array below plus re-reading the census notes.
 */
import type { Diagnostic, SchemaElement } from './types.js';

/** The diagnostic `code` — also the id `suppressWarnings` suppresses. */
export const UNCONSUMED_WIDGET_OPTION = 'unconsumed-widget-option';

/**
 * Component types that host a dashboard `widgets` array. Both resolve to the
 * surfaces measured by the census above (`DashboardRenderer`,
 * `DashboardGridLayout`), which share one dispatch (`widgetDispatch.ts`).
 */
export const DASHBOARD_WIDGET_HOST_TYPES: ReadonlySet<string> = new Set([
  'dashboard',
  'dashboard-grid',
]);

/**
 * The accepted set: every `options` key with a renderer read site on the
 * dataset-bound path, which is exactly the set the spec declares.
 * Alphabetical; the warning message prints it verbatim. Derivation and
 * evidence: file header.
 */
export const CONSUMED_WIDGET_OPTION_KEYS: readonly string[] = [
  'dateGranularity',
  'limit',
  'sortBy',
  'sortOrder',
  'stageOrder',
];

const CONSUMED = new Set<string>(CONSUMED_WIDGET_OPTION_KEYS);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The parser's deferred-expression marker — opaque here, never evaluated. */
const isExpr = (v: unknown): boolean => isPlainObject(v) && '$expr' in v;

/**
 * Diagnostics for `options` keys no renderer consumes, over one dashboard-host
 * node's `widgets` array. Pure and shallow by design: it never descends into
 * `children` (the caller's walk owns that) and answers `[]` for every shape
 * outside its census — see the scope notes in the file header.
 */
export function checkDashboardWidgetOptions(node: SchemaElement): Diagnostic[] {
  if (!DASHBOARD_WIDGET_HOST_TYPES.has(node.type)) return [];
  const widgets = (node as Record<string, unknown>).widgets;
  if (!Array.isArray(widgets)) return [];

  const diagnostics: Diagnostic[] = [];
  widgets.forEach((widget, index) => {
    if (!isPlainObject(widget) || isExpr(widget)) return;
    // Legacy component format: `options` is not part of that contract.
    if (widget.component !== undefined) return;
    // Only the dataset-bound (spec-legal) path is censused — see file header.
    if (widget.dataset === undefined || widget.dataset === null || widget.dataset === '') return;
    const options = widget.options;
    if (!isPlainObject(options) || isExpr(options)) return;
    if (
      Array.isArray(widget.suppressWarnings) &&
      widget.suppressWarnings.includes(UNCONSUMED_WIDGET_OPTION)
    ) {
      return;
    }
    const label = typeof widget.id === 'string' && widget.id !== '' ? widget.id : `#${index}`;
    const widgetType = typeof widget.type === 'string' && widget.type !== '' ? widget.type : 'widget';
    for (const key of Object.keys(options)) {
      if (CONSUMED.has(key)) continue;
      diagnostics.push({
        severity: 'warning',
        code: UNCONSUMED_WIDGET_OPTION,
        message:
          `<${node.type}> widget "${label}" (${widgetType}): options.${key} reaches no renderer — ` +
          `dashboard widget renderers read only: ${CONSUMED_WIDGET_OPTION_KEYS.join(', ')}`,
        tag: node.type,
      });
    }
  });
  return diagnostics;
}
