/**
 * Unconsumed dashboard-widget `options` keys (objectui#5709), ported into this
 * copy in lockstep (objectstack#12810).
 *
 * `@objectstack/spec`'s `DashboardWidgetOptionsSchema` ends in `.passthrough()`
 * ("declared query keys + open renderer extras"), so ANY key parses, validates
 * and lints cleanly — including one no renderer reads. That is how a showcase
 * dashboard shipped `options: { invert: true }` on a gauge with a comment
 * saying what it was believed to do, and rendered the un-inverted measure with
 * no diagnostic anywhere (objectui#5709). The 2026-08-23 maintainer ruling:
 * open extras stay open — they just stop being SILENT. A key that reaches no
 * renderer draws a WARNING naming the consumed set. Not an error: no gate
 * weakening and no new red gates were ruled.
 *
 * ## LOCKSTEP — what is byte-equal here and what deliberately is not
 *
 * Two copies of this parser exist: objectui's `packages/sdui-parser` and this
 * hoisted `@objectstack/sdui-parser`. The invariant they owe each other is that
 * both agree on the accepted grammar AND on diagnostic codes — if they drift,
 * the save gate and the renderer speak different dialects and a page can save
 * clean and render inert, or the reverse (objectstack#12719, objectstack#12810).
 *
 * Everything from the `import` line below to end of file is a byte-equal port of
 * objectui's `src/dashboard-widget-options.ts` SAVE FOR ONE TOKEN, called out
 * at the site itself: the emitted `code` is spelled as an inline literal here
 * and as the constant there, because this repo runs a vocabulary gate objectui
 * does not. The emitted `code`, `severity`, `message` and the whole census
 * scope are identical, and `__tests__/dashboard-widget-options.test.ts`
 * re-derives that rather than trusting it — including an explicit pin that the
 * literal equals `UNCONSUMED_WIDGET_OPTION`. Change these functions only
 * together with the objectui copy.
 *
 * THIS HEADER is the one deliberate divergence, and it has to be: objectui's
 * header cites the maintenance machinery that derives the census — its
 * `DatasetWidget.tsx` / `DashboardRenderer.tsx` read sites, its
 * `plugin-dashboard.mdx` claim and its two census tests. NONE of those files
 * exists in this repo (measured: no dashboard renderer package here at all), so
 * copying those sentences would ship claims this checkout cannot support and
 * nothing here would ever notice them going false. What follows instead states
 * where each half of the census is derivable, and from what.
 *
 * ## The accepted set, and where each half is authoritative
 *
 * The spec REQUIRES `dataset` on every widget (`DashboardWidgetSchema`, this
 * repo: `packages/spec/src/ui/dashboard.zod.ts`), and both of objectui's
 * dashboard surfaces route a dataset-bound widget to `DatasetWidget`. On that —
 * the only spec-legal — path the renderer-consumed `options` keys are exactly
 * the five the spec DECLARES:
 *
 *   dateGranularity, sortBy, sortOrder, limit   (query-affecting, framework#3588)
 *   stageOrder                                  (funnel/pyramid stage order)
 *
 * plus ONE undeclared key with a real read site:
 *
 *   description — the metric-card sub-caption channel. `translateDashboard`
 *   OVERLAYS the `widgets.{id}.subCaption` translation onto this key, and that
 *   pipeline lives IN THIS REPO: `packages/spec/src/system/i18n-resolver.ts`
 *   documents `WidgetLike.options` as "the renderer-extras bag …
 *   `translateDashboard` writes exactly one key into it — `description`"
 *   (objectstack#5428 item 4, objectstack#7862). Warning on a key the
 *   platform's own translation pipeline writes would be a false positive on
 *   legal metadata, so it is in the accepted set even though the dataset-bound
 *   render path does not currently display it.
 *
 * Notably NOT consumed on the path a widget really renders through:
 * `thresholds` and `format`. Both were widely believed to work; both draw this
 * warning, which is the point. Their closure claims are objectui's to derive —
 * `thresholds` by a repo-wide read-site scan there, `format` by the bounded
 * claim that the dataset-bound path formats from the MEASURE's own metadata —
 * and they are NOT restated here as claims about this repo, which has no
 * renderer to make them about.
 *
 * ## The drift risk that lives on THIS side
 *
 * The spec whose `.passthrough()` this reasons about ships from this repo. So
 * the one way this list can go stale HERE is a new DECLARED key landing in
 * `DashboardWidgetOptionsSchema` without landing in the array below: the key
 * would be spec-legal, renderer-consumed on the objectui side, and warned about
 * here — a false positive on legal metadata. `@objectstack/sdui-parser` takes
 * no dependency on `@objectstack/spec` (it is dependency-free and hoistable by
 * design), so that cross-check is not mechanized in this copy; the census test
 * next door pins the array and names the spec file to re-read when it moves.
 *
 * ## Scope — where the warning deliberately does NOT fire
 *
 *   - Widgets WITHOUT `dataset`: the legacy inline forms (`options.data`
 *     arrays, `provider: 'object'` bags) consume a much larger, spread-shaped
 *     key set, whose true reach is each child component's prop surface. That
 *     form is spec-illegal today (`dataset` is required) and its census would be
 *     the unmaintainable one; skipping it keeps every warning this module emits
 *     a statement about the path the widget actually renders through.
 *   - Widgets in the legacy COMPONENT format (`widget.component`): `options`
 *     is not part of that contract.
 *   - Widgets carrying the spec's own escape hatch
 *     `suppressWarnings: ['unconsumed-widget-option']` — the spec models
 *     per-widget diagnostic suppression (`DashboardWidgetSchema.suppressWarnings`,
 *     "Build diagnostic rule ids suppressed on this widget"), so an author with
 *     a genuine out-of-band consumer can say so in metadata.
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
 * dataset-bound path, plus the sub-caption convention key. Alphabetical; the
 * warning message prints it verbatim. Derivation and evidence: file header.
 */
export const CONSUMED_WIDGET_OPTION_KEYS: readonly string[] = [
  'dateGranularity',
  'description',
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
        // DIVERGENCE FROM OBJECTUI, and the only one below this file's header:
        // objectui writes `code: UNCONSUMED_WIDGET_OPTION` here. This repo runs
        // `check:dispatcher-error-vocabulary`, whose `objlitconst` shape reads
        // the SCREAMING_SNAKE constant NAME at a `code:` position and then must
        // reduce it to a literal — and its literal grammar is
        // `[A-Za-z][A-Za-z0-9_]*`, which a KEBAB-case value cannot satisfy. So
        // the constant form is reported as an unresolvable code constant, and
        // that finding cannot be declared away. `unconsumed-widget-option` is a
        // parser DIAGNOSTIC code, not an ADR-0112 wire code, and an inline
        // quoted literal is the form both vocabulary gates already accept for
        // the six sibling diagnostic codes in `validate.ts`
        // (`unknown-component`, `unknown-prop`, `not-a-container`,
        // `inert-expression`, `type-mismatch`, `invalid-enum`). The emitted
        // VALUE is unchanged, and the test next door pins it equal to
        // `UNCONSUMED_WIDGET_OPTION` so the two spellings cannot drift apart.
        code: 'unconsumed-widget-option',
        message:
          `<${node.type}> widget "${label}" (${widgetType}): options.${key} reaches no renderer — ` +
          `dashboard widget renderers read only: ${CONSUMED_WIDGET_OPTION_KEYS.join(', ')}`,
        tag: node.type,
      });
    }
  });
  return diagnostics;
}
