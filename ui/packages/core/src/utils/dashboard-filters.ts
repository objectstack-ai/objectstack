/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dashboard-level filter resolution (framework#2501).
 *
 * A dashboard declares top-level filters (`globalFilters` + the built-in
 * `dateRange`). Their values live as dashboard-level variables; each widget
 * may declare which of ITS OWN fields a filter binds to via
 * `filterBindings`. At render time the dashboard broadcasts the filter
 * values into each bound widget's inline query by merging a widget-scoped
 * `FilterCondition` into the widget's own `filter`.
 *
 * Everything in this module is pure and synchronous so the binding rules
 * are unit-testable in isolation from React and the data layer.
 */

import type { DashboardComponentSchema, DashboardWidgetSchema, I18nLabel, PageVariable } from '@object-ui/types';
import { liftLegacyGlobalFilterDefault } from '@object-ui/types';
import { DATE_RANGE_PRESETS, DashboardSchema as SpecDashboardSchema, type DateRangePreset } from '@objectstack/spec/ui';
import { resolveDateMacros } from './date-macros.js';

/** Reserved filter name for the dashboard's built-in date range. */
export const DATE_RANGE_FILTER_NAME = 'dateRange';

/** Default target field for the built-in date range filter. */
const DATE_RANGE_DEFAULT_FIELD = 'created_at';

/**
 * The preset an authored `dateRange` resolves to when it omits `defaultRange`
 * (objectui#10339) — READ FROM THE SPEC, never restated here.
 *
 * `@objectstack/spec` declares `DashboardSchema.dateRange.defaultRange` with a
 * `.default(...)`, so the platform's parse of `dateRange: { field: 'created_at' }`
 * carries that preset, and a renderer that treated the omission as "no filter"
 * showed an UNFILTERED dashboard for a document the protocol says is filtered
 * (#7759 ruling 5617465269, rule 1: the read site implements every arm the spec
 * declares). The value is derived by parsing an EMPTY `dateRange` element
 * through the spec's own schema: the only keys that come back are the ones the
 * spec supplies by default, so this reads the spec's answer rather than a
 * hand-copied string that could drift from it. `allowCustomRange` is the
 * sibling default and needs no such read — it is consumed as `!== false`,
 * which already is its spec default.
 *
 * Computed on first use and cached: `DashboardSchema` is a lazy schema, and
 * forcing its construction at module load would cost every importer of
 * `@object-ui/core` for a value only a dashboard with a bare `dateRange` needs.
 */
let specDateRangeDefault: string | undefined;
function specDefaultDateRangePreset(): string | undefined {
  if (specDateRangeDefault === undefined) {
    specDateRangeDefault = SpecDashboardSchema.shape.dateRange.parse({})?.defaultRange;
  }
  return specDateRangeDefault;
}

export interface DashboardFilterDef {
  /** Stable name — the variable key and the key widgets bind against. */
  name: string;
  /** Default target field when a widget declares no explicit binding. */
  field: string;
  /**
   * The object `field` lives on, carried through from
   * @objectstack/spec's `GlobalFilterSchema.object` (`061f5e829`).
   *
   * The spec's own describe text for that key states the contract: "Object
   * whose `fields.<object>.<field>` translation-bundle entry resolves this
   * filter's field label and option labels". It was shipped on the spec side
   * and never reached a consumer here, because this builder names the keys it
   * copies and this one was not among them — so the value could not reach a
   * renderer even in principle.
   *
   * ⚠️ NOT `optionsFrom.object`, which the spec separates deliberately: that
   * one names the object dynamic OPTIONS are fetched from and may differ
   * (filtering `opportunity` by `owner` with options sourced from `user`),
   * while this one names the object whose translation bundle is keyed by
   * `field`. Reading the former for label resolution resolves against the
   * wrong object for exactly that filter.
   *
   * Like {@link DashboardFilterDef.label}, this module carries it through
   * UNRESOLVED — `@object-ui/core` is locale-free by design and the bundle
   * read belongs to the render side. Omitted entirely when the author declared
   * none, so a dashboard that never names an object resolves to a def with the
   * same key set it always had.
   */
  object?: string;
  /**
   * Display label, in @objectstack/spec's `I18nLabel` vocabulary — a plain
   * string, or an inline per-locale map (`{ en: 'Owner', 'zh-CN': '负责人' }`).
   *
   * Widened from `string` under the objectstack#5428 ruling of 2026-08-06
   * (option A): `GlobalFilterSchema.label` has been `I18nLabel` on the spec
   * side since 17.0.0-rc.6, so declaring it `string` here made this module
   * NARROWER than the contract it implements — which is exactly why the filter
   * bar's map reads were invisible to `tsc` (objectui#4163).
   *
   * This module is locale-free BY DESIGN (`@object-ui/core` is logic-only), so
   * it carries the authored vocabulary through unresolved and the RENDER side
   * collapses it to the active language. Resolving here would need a locale
   * this layer has no business knowing.
   */
  label?: string | I18nLabel;
  type: 'text' | 'select' | 'date' | 'number' | 'lookup' | 'dateRange';
  /**
   * Static options, NORMALIZED to `{ value, label }` pairs by
   * `resolveDashboardFilterDefs` — consumers always see the object form.
   *
   * The canonical authoring form is @objectstack/spec's `{ value, label }`
   * pair, and it is the ONLY one the platform accepts at publish. The
   * bare-string shorthand a STORED document may still carry is NOT lifted
   * (objectui#4356, retired on the objectstack#7917 option-② schedule): such
   * a member yields no option, and `normalizeFilterOptions` says so once. Do
   * not author one; rewrite `"X"` as `{ "value": "X", "label": "X" }`.
   *
   * The PAIR SHAPE is normalized; the label's own vocabulary is not. `label`
   * is `I18nLabel` in `GlobalFilterSchema.options[]` too, and it reaches the
   * renderer as authored — see `normalizeFilterOptions` for why collapsing it
   * here was data loss rather than normalization.
   */
  options?: Array<{ value: string; label: string | I18nLabel }>;
  optionsFrom?: {
    object: string;
    valueField: string;
    labelField?: string;
    filter?: any;
  };
  defaultValue?: any;
  /** Legacy widget-id allow-list; ignored when a widget binds explicitly. */
  targetWidgets?: string[];
  /** dateRange only — whether the UI offers a custom from/to picker. */
  allowCustomRange?: boolean;
}

/** Value shape held by a `dateRange`-typed filter variable. */
export interface DateRangeValue {
  /** One of the `DashboardSchema.dateRange.defaultRange` presets. */
  preset?: string;
  /** Custom range bounds as ISO dates (either bound may be omitted). */
  from?: string;
  to?: string;
}

/**
 * Date-range presets → date-macro token bounds. Tokens stay symbolic in the
 * generated condition; every widget renderer resolves them at query time via
 * `resolveDateMacros`, exactly like hand-authored widget filters.
 *
 * `satisfies Record<DateRangePreset, …>` is the load-bearing half of
 * objectui#4167, not decoration. `DATE_RANGE_PRESETS` below is now the spec's
 * list rather than `Object.keys` of this table, so the two could otherwise
 * drift in the one direction the spec's own comment on that const names as the
 * failure mode: a preset the SCHEMA knows and this table has no bounds for
 * "validates clean and then resolves to nothing" — it would reach the filter
 * bar's dropdown, be selected, and produce no range. The `satisfies` makes that
 * a compile error at the moment the spec adds a preset (missing key), and makes
 * a local invention a compile error too (excess key). The annotation form
 * `const PRESET_RANGES: Record<DateRangePreset, …>` would NOT do this: a string
 * index signature satisfies every literal key, so the check passes vacuously.
 */
const PRESET_RANGES = {
  today: { from: '{today}', to: '{today}' },
  yesterday: { from: '{yesterday}', to: '{yesterday}' },
  this_week: { from: '{current_week_start}', to: '{current_week_end}' },
  last_week: { from: '{last_week_start}', to: '{last_week_end}' },
  this_month: { from: '{current_month_start}', to: '{current_month_end}' },
  last_month: { from: '{last_month_start}', to: '{last_month_end}' },
  this_quarter: { from: '{current_quarter_start}', to: '{current_quarter_end}' },
  last_quarter: { from: '{last_quarter_start}', to: '{last_quarter_end}' },
  this_year: { from: '{current_year_start}', to: '{current_year_end}' },
  last_year: { from: '{last_year_start}', to: '{last_year_end}' },
  last_7_days: { from: '{7_days_ago}', to: '{today}' },
  last_30_days: { from: '{30_days_ago}', to: '{today}' },
  last_90_days: { from: '{90_days_ago}', to: '{today}' },
} satisfies Record<DateRangePreset, { from?: string; to?: string }>;

/**
 * Bounds for a preset NAME that may not be one.
 *
 * The runtime receives whatever a stored dashboard carries, so an unrecognised
 * name must warn (see `buildFilterCondition`) rather than fail to compile. That
 * read is confined here so the `satisfies` pin above stays the single place
 * deciding which names exist — an unguarded `PRESET_RANGES[someString]` would
 * have forced the table back to a `Record<string, …>` and taken the pin with it.
 */
function presetBounds(preset: string): { from?: string; to?: string } | undefined {
  return (PRESET_RANGES as Record<string, { from?: string; to?: string }>)[preset];
}

/**
 * Preset keys the filter bar offers, in display order — the spec's list,
 * RE-EXPORTED since objectui#4167 rather than derived from the local bounds
 * table (objectstack#4115).
 *
 * `@objectstack/spec` 17.0.0-rc.6 publishes `DATE_RANGE_PRESETS`, and its own
 * doc comment names this module as one of the three copies the extraction
 * (objectstack#4614) existed to collapse: "it used to exist three times —
 * inline in `dateRange.defaultRange`, as `PRESET_RANGES` in objectui's
 * `dashboard-filters`, and as a hand-written table in
 * `content/docs/ui/dashboards.mdx`". So the burn-down direction here is not a
 * judgement call, it is upstream's stated intent, and the two lists were
 * already identical in content AND display order — the copy had nothing to
 * protect.
 *
 * What stays local is the BOUNDS table above, which is the other half of
 * objectstack-ai/objectstack#4614's design ("the two vocabularies live one import apart and neither
 * restates the other's grammar"): the spec owns which presets exist, this
 * module owns what each one resolves to in date-macro tokens.
 */
export { DATE_RANGE_PRESETS };

/**
 * ISO calendar date, optionally carrying a time part — `2026-01-15`,
 * `2026-01-15T08:30:00Z`. Deliberately narrower than `Date.parse`, which
 * also accepts locale prose (`March 5, 2026`) and bare years (`2026`);
 * neither is a value the backend compares a date column against usefully.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * True when a bare string value can legitimately reach a query as a date
 * (#3151). Two spellings qualify:
 *
 *  - a **date-macro token** (`{today}`, `${current_month_start}`,
 *    `{7_days_ago}`) — it stays symbolic in the generated condition and is
 *    resolved at query time by `resolveDateMacros`, exactly like the bounds
 *    `PRESET_RANGES` emits. The check asks that resolver itself instead of
 *    restating its grammar here: one token vocabulary, no second dialect to
 *    drift — and a token it does not know is precisely the typo this guard
 *    exists to catch;
 *  - an **ISO date**, which means equality on that day (documented behaviour).
 */
function isUsableDateString(value: string): boolean {
  if (resolveDateMacros(value) !== value) return true;
  return ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** `today, yesterday, …` — quoted in every rejection so the fix is in reach. */
function presetList(): string {
  return DATE_RANGE_PRESETS.join(', ');
}

function warnDateFilter(message: string): void {
  if (typeof console !== 'undefined') console.warn(`[dashboard-filters] ${message}`);
}

/**
 * Dev-mode gate, matching `actions/actionKeys.ts` — a warning that floods a
 * production console is a warning that gets muted.
 */
const isDev = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV !==
  'production';

/**
 * Warn-once memo for the DROPPED bare-string `options` members (objectui#4356).
 *
 * Keyed by filter NAME **and** the offending values, deliberately — the same
 * reasoning `warnOnUnknownActionKeys` records for its own memo. Keying on the
 * name alone would report the first dashboard carrying a shorthand `status`
 * filter and stay silent about every other one, sending the author to fix one
 * symptom; keying on the values alone would collapse two genuinely different
 * filters that happen to share an option list. The memo is bounded by the
 * number of authored filters either way.
 *
 * This lives at module scope because `resolveDashboardFilterDefs` runs on every
 * dashboard render — per-call state would warn once per frame, which is the
 * flood the dedupe exists to prevent.
 */
const warnedShorthandOptions = new Set<string>();

/**
 * Reset the dropped-shorthand warn-once memo. Exported for tests.
 *
 * Kept through the objectui#4356 retirement: the memo it clears outlived the
 * deprecation warning, because the warning that replaced it (a member was
 * DROPPED, not lifted) dedupes on the same key for the same render-path reason.
 */
export function resetDashboardFilterWarnings(): void {
  warnedShorthandOptions.clear();
}

/**
 * Apply the ADR-0089 legacy-alias lift to ONE stored `globalFilters` entry, and
 * say so out loud when it fires (objectui#4165).
 *
 * ## The alias, at this read site
 *
 * **What it is.** `defaultValue: { preset: 'last_7_days' }` on a `type: 'date'`
 * filter. The canonical spelling is the bare preset NAME,
 * `defaultValue: 'last_7_days'` — one of the three the spec's rc.6 refinement
 * accepts (preset name / ISO date / date-macro token).
 *
 * **Why it is lifted here rather than tolerated.** Maintainer ruling on
 * objectui#4165 (2026-08-11): 「spec stays strict — no widening」. objectui's
 * `GlobalFilterSchema` now carries that refinement, so a document holding the
 * object form fails validation; lifting it BEFORE anything reads the entry
 * makes the declaration canonical by construction. The lift itself lives in
 * `@object-ui/types`' `dashboard-filter-alias.ts` (one implementation, shared
 * with the designer's rewrite-on-save path); this is one of its two call sites.
 *
 * **What it does NOT buy, measured.** It does not rescue rendering. A legacy
 * declaration already resolved correctly before #4165 and still does with this
 * call deleted — reverse-verified, only the warning below changes. The reason
 * is a coincidence worth knowing: `{ preset }` is also the runtime VALUE shape
 * `normalizeDateDefault` produces for the canonical name, and that function
 * passes non-strings through untouched. That coincidence is why the object form
 * looked harmless for so long, and how the schema's own prose drifted into
 * calling it "the on-disk form". Read this call as canonicalization plus
 * observability, not as a repair — claiming more would be claiming coverage the
 * tests in `__tests__/dashboard-filters.test.ts` do not have.
 *
 * **When it may be removed.** At the next MAJOR of `@object-ui/types` (18.0.0).
 * By then every dashboard opened in the designer has been rewritten to the bare
 * name, because `DashboardDesignPage` lifts into the editable draft and the
 * next save persists it. Delete this function and its call below together with
 * the lift itself; a document still carrying the object form then gets the
 * spec's named rejection, which is the intended end state.
 *
 * The warning is not decoration: a silent lift can never be retired, because
 * nothing would ever show that the last legacy document is gone (ADR-0078 —
 * nothing silently inert).
 */
function liftLegacyFilterDeclaration<T>(filter: T): T {
  const lifted = liftLegacyGlobalFilterDefault(filter);
  if (lifted === filter) return filter;
  const name = (filter as { name?: string; field?: string })?.name
    ?? (filter as { field?: string })?.field
    ?? '?';
  const preset = (lifted as { defaultValue?: unknown })?.defaultValue;
  warnDateFilter(
    `filter "${name}": \`defaultValue: { preset: ${JSON.stringify(preset)} }\` is a LEGACY ` +
      `spelling (objectui#4165) and was lifted to the canonical bare preset name ` +
      `${JSON.stringify(preset)}. Rewrite the stored dashboard — the object form is ` +
      `refused by @objectstack/spec and its acceptance here ends with @object-ui/types 18.`,
  );
  return lifted;
}

/**
 * Normalize a date filter's DECLARED default into the `DateRangeValue` shape
 * every date consumer in this module reads (framework#4475).
 *
 * ## Declaration space vs value space — the distinction objectui#4165 turned on
 *
 * These are two different things that share the name `defaultValue`, and
 * conflating them is what produced #4165:
 *
 *  - the **declaration** is `globalFilters[].defaultValue` in a stored
 *    dashboard. `@objectstack/spec` owns it, it is `string | number | boolean`,
 *    and since rc.6 a refinement holds a `type: 'date'` one to a preset NAME,
 *    an ISO date or a date-macro token. A bare preset name is the canonical
 *    spelling and the object form is a retiring alias (see
 *    `liftLegacyFilterDeclaration` above);
 *  - the **value** is what this function RETURNS: `DashboardFilterDef
 *    .defaultValue`, which seeds the filter variable and is read by
 *    `DateRangeFilter` (`.preset`/`.from`/`.to`) and `buildFilterCondition`.
 *    That shape is `DateRangeValue`, it is objectui-internal, the spec has no
 *    opinion about it, and for a preset it is `{ preset }`.
 *
 * So this function converts declaration → value. It is NOT a producer of stored
 * metadata: nothing writes a resolved `DashboardFilterDef` back into a
 * dashboard document (measured in #4165 — `resolveDashboardFilterDefs`' only
 * callers are `DashboardRenderer` and `DashboardWidgetInspector`, both read
 * side). Making it emit the bare name instead would therefore not change one
 * byte on disk; it would only hand `DateRangeFilter` a string it cannot read
 * and `buildFilterCondition` a value it warns-and-skips — i.e. re-open
 * framework#4475 exactly, which is why it keeps emitting `{ preset }`.
 *
 * The built-in `dateRange` declaration has always been normalized this way —
 * `schema.dateRange.defaultRange` is a preset NAME and
 * `resolveDashboardFilterDefs` lifts it to `{ preset }`. A `globalFilters`
 * entry of `type: 'date'` was passed through raw instead, and that asymmetry
 * is the whole bug: `@objectstack/spec`'s `GlobalFilterSchema.defaultValue` is
 * `string | number | boolean`, so a bare preset name is the ONLY spelling an
 * author can write, yet nothing ever mapped it. Both symptoms of Setup's
 * System Overview reading 0 across every KPI tile follow from that:
 *
 *  - `buildFilterCondition` fell through to its "a bare string date means
 *    equality on that day" branch and emitted `created_at = 'last_7_days'`,
 *    which matches no row — a query the backend answers `200 OK` with a 0;
 *  - `DateRangeFilter` reads `value.preset` / `.from` / `.to`, all `undefined`
 *    on a bare string, so the control displayed "All time" while sending that
 *    equality — the tiles looked deliberately unfiltered and merely empty.
 *
 * Only a name this module actually knows is lifted. A genuine ISO date string
 * still means equality on that day (the documented behaviour), and a number /
 * boolean / unrecognised string is left exactly as declared — an unrecognised
 * string then never reaches a query at all: `buildFilterCondition` skips it
 * with a warning rather than comparing a column against it (#3151).
 */
function normalizeDateDefault(type: DashboardFilterDef['type'], defaultValue: unknown): unknown {
  if (type !== 'date' && type !== 'dateRange') return defaultValue;
  if (typeof defaultValue !== 'string') return defaultValue;
  return defaultValue in PRESET_RANGES ? { preset: defaultValue } : defaultValue;
}

/**
 * Normalize a filter's static `options` declaration to `{ value, label }`
 * pairs — the @objectstack/spec `GlobalFilterSchema.options` form, and the
 * only form this function emits. Rendering an un-normalized option crashes
 * React, so every member that reaches a renderer passes through here.
 *
 * ## The bare-string shorthand is RETIRED (objectui#4356, objectstack#7917)
 *
 * Maintainer ruling of 2026-08-12 on objectstack#7917, verbatim 「7917 ②」:
 * option ② — **the spec stays strict; the runtime bare-string lift retires.**
 * The window closed on the maintainer's 2026-09-02 ruling, verbatim
 * 「objectstack#7917 不考虑现有数据」: Phase 2 proceeds on release cadence
 * alone, with no live-tenant survey and no migration entry.
 *
 * So `options: ['EMEA']` — which the Phase 1 build (PR #4601) lifted to
 * `{ value: 'EMEA', label: 'EMEA' }` under a deprecation warning — now yields
 * NO option. A member that is not an object is skipped, exactly as a nullish
 * member or an object with no `value` already was: a shorthand-only filter
 * resolves with no `options`, and a mixed array keeps only its object members.
 * The runtime reads the document the way the spec does, which is the end
 * state option ② named — one strict contract, no renderer dialect beside it
 * (AGENTS.md #0.1). ⛔ No lift, alias, fallback or migration returns here.
 *
 * The skip is not silent. `warnDroppedShorthandOptions` names the filter, the
 * dropped members and the rewrite, once per filter per session — ADR-0078 §4:
 * where the runtime skips an instance it emits a dev-mode diagnostic rather
 * than swallowing it, and a STORED dashboard is the one document no author-time
 * gate ever re-reads, so an empty select with nothing in the console would read
 * as "no data". What that warning must NOT do is promise a lift: the Phase 1
 * text said "still lifted here", and that sentence retired with the arm.
 *
 * ## What is normalized, and what is deliberately NOT (objectui#4032 / #4163)
 *
 * The PAIR SHAPE is normalized (`value` stringified). The LABEL's authoring
 * vocabulary is carried through untouched, because `label` is `I18nLabel` — a
 * string OR an inline per-locale map.
 *
 * This line used to read:
 *
 * ```ts
 * label: typeof label === 'string' && label ? label : String(value),
 * ```
 *
 * which looks like defensive normalization and is data loss. An option authored
 * `{ value: 'domestic', label: { en: 'Domestic', 'zh-CN': '国内' } }` normalized
 * to `label: 'domestic'` — the raw STORED VALUE — so the control lost the
 * authored text in *every* locale, English included. Nothing downstream could
 * recover it: by the time a renderer saw the def, the map was gone.
 *
 * A map is therefore preserved and the render side resolves it against the
 * active language. Anything that is neither a string nor an object is not a
 * label in any vocabulary the spec admits, and still falls back to the value.
 */
function normalizeFilterOptions(
  options: unknown,
  filterName: string,
): Array<{ value: string; label: string | I18nLabel }> | undefined {
  if (!Array.isArray(options) || options.length === 0) return undefined;
  const normalized: Array<{ value: string; label: string | I18nLabel }> = [];
  /** Every non-object member, in authored order — one warning names them all. */
  const dropped: unknown[] = [];
  for (const o of options) {
    if (o === null || o === undefined) continue;
    if (typeof o === 'object') {
      const value = (o as any).value;
      if (value === undefined || value === null) continue;
      const label = (o as any).label;
      const isMap = label !== null && typeof label === 'object' && !Array.isArray(label);
      normalized.push({
        value: String(value),
        label: (typeof label === 'string' && label) || isMap ? label : String(value),
      });
    } else {
      // The retired shorthand arm (objectui#4356): nothing is pushed for this
      // member. It is recorded for the warning and yields no option.
      dropped.push(o);
    }
  }
  if (dropped.length > 0) warnDroppedShorthandOptions(filterName, dropped);
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Say the dropped members out loud — once per offending filter per session,
 * naming the filter, the members that yielded no option, and the rewrite.
 *
 * Collected per FILTER rather than per member: a filter declaring
 * `['EMEA', 'APAC', 'AMER']` is one authoring mistake in one place, so it earns
 * one warning carrying all three values, not three warnings the author has to
 * reassemble. A MIXED array (`[{ value: 'won', … }, 'lost']`) names only the
 * dropped members — the object members rendered, and re-reporting them is noise.
 *
 * Dev-mode only and memoised, exactly as the Phase 1 deprecation warning was:
 * `resolveDashboardFilterDefs` runs on every dashboard render, and a warning
 * that floods a console is a warning that gets muted. What changed is the
 * sentence — this one reports a member that was DROPPED and promises no lift.
 */
function warnDroppedShorthandOptions(filterName: string, dropped: unknown[]): void {
  if (!isDev()) return;
  // A string is quoted so `"42"` and `42` stay distinguishable; anything else is
  // spelled as itself — `String()` rather than `JSON.stringify()`, because a
  // programmatic caller can hand this a value JSON cannot carry.
  const spelled = dropped.map((v) => (typeof v === 'string' ? JSON.stringify(v) : String(v)));
  const memo = `${filterName}:${spelled.join(',')}`;
  if (warnedShorthandOptions.has(memo)) return;
  warnedShorthandOptions.add(memo);
  const canonical = dropped
    .map((v) => `{ value: ${JSON.stringify(String(v))}, label: ${JSON.stringify(String(v))} }`)
    .join(', ');
  warnDateFilter(
    `filter "${filterName}": \`options\` members ${spelled.join(', ')} are not \`{ value, label }\` ` +
      `objects and were DROPPED — the bare-string shorthand is no longer lifted (objectui#4356), so the ` +
      `filter renders without them. Rewrite the stored dashboard to @objectstack/spec's pair form: ` +
      `[${canonical}].`,
  );
}

/**
 * Normalize a dashboard schema's filter declarations into a flat list of
 * filter definitions. The built-in `dateRange` (when declared) comes first
 * under the reserved name `"dateRange"`; each `globalFilters` entry follows,
 * named by its `name` (defaulting to `field`). Later duplicates win.
 */
export function resolveDashboardFilterDefs(
  schema: Pick<DashboardComponentSchema, 'globalFilters' | 'dateRange'>,
): DashboardFilterDef[] {
  const byName = new Map<string, DashboardFilterDef>();

  if (schema.dateRange) {
    // An omitted `defaultRange` takes the spec's declared default (#10339); an
    // explicit value — `'custom'` included — is used exactly as authored.
    const preset = schema.dateRange.defaultRange === undefined
      ? specDefaultDateRangePreset()
      : schema.dateRange.defaultRange;
    byName.set(DATE_RANGE_FILTER_NAME, {
      name: DATE_RANGE_FILTER_NAME,
      field: schema.dateRange.field || DATE_RANGE_DEFAULT_FIELD,
      type: 'dateRange',
      // 'custom' has no bounds of its own — start empty and let the user pick.
      defaultValue: preset && preset !== 'custom' ? { preset } : undefined,
      allowCustomRange: schema.dateRange.allowCustomRange,
    });
  }

  for (const raw of schema.globalFilters ?? []) {
    if (!raw?.field) continue;
    // ADR-0089 legacy-alias lift (#4165) — a stored `defaultValue: { preset }`
    // becomes the canonical bare name BEFORE anything else reads the entry, so
    // a legacy dashboard resolves to byte-identical defs. See
    // `liftLegacyFilterDeclaration` for the retirement window.
    const f = liftLegacyFilterDeclaration(raw);
    const name = f.name || f.field;
    if (byName.has(name) && typeof console !== 'undefined') {
      console.warn(`[dashboard-filters] duplicate filter name "${name}" — the later definition wins`);
    }
    const type = f.type ?? 'text';
    byName.set(name, {
      name,
      field: f.field,
      // Spread rather than assigned (`061f5e829`): every filter authored
      // before this key existed keeps the exact key set it resolved to, so
      // `'object' in def` stays the discriminator the render side branches on
      // and no consumer sees a new own-property carrying `undefined`.
      ...(typeof f.object === 'string' && f.object ? { object: f.object } : {}),
      label: f.label,
      type,
      // `name` is the identifying context the dropped-member warning needs, and
      // the local above already resolved it — nothing new is threaded through a
      // public signature for it. `normalizeFilterOptions` is module-private, so
      // widening ITS parameter list is not a contract move.
      //
      // (Deliberately not restating that local's expression here: the
      // column-identity ratchet in `__tests__/column-identity.ratchet.test.ts`
      // is a LINE-LEVEL scanner, so a comment quoting it reads as a second
      // dual read and fails the count — a false positive worth avoiding rather
      // than absorbing into the inventory, which would mask a future real one.)
      options: normalizeFilterOptions(f.options, name),
      optionsFrom: f.optionsFrom,
      // framework#4475 — same preset-name lifting the built-in `dateRange`
      // above already does; see normalizeDateDefault for why a bare string is
      // the only thing an author can declare here.
      defaultValue: normalizeDateDefault(type, f.defaultValue),
      targetWidgets: f.targetWidgets,
    });
  }

  return Array.from(byName.values());
}

/**
 * Derive `PageVariable` definitions for a dashboard's filter values so the
 * dashboard can host them in a `PageVariablesProvider` (the page/dashboard
 * variables primitive). Filter values are then also readable in widget
 * expressions as `page.<name>`.
 */
export function dashboardFilterVariableDefs(defs: DashboardFilterDef[]): PageVariable[] {
  return defs.map((def) => ({
    name: def.name,
    type: def.type === 'dateRange' ? 'object' : 'string',
    defaultValue: def.defaultValue,
  }));
}

/** True when a filter value carries no constraint. */
function isEmptyValue(def: DashboardFilterDef, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (def.type === 'dateRange' || def.type === 'date') {
    const v = value as DateRangeValue;
    if (typeof v !== 'object') return false;
    return !v.preset && !v.from && !v.to;
  }
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

/**
 * Build the operator shape (the value side of a `FilterCondition` entry) for
 * one filter's current value. Returns `undefined` when the value imposes no
 * constraint. The caller keys the result by the bound field name.
 *
 * A `date`/`dateRange` value is held to three spellings (#3151): a known
 * preset name → range bounds; a date-macro token or ISO date → equality on
 * that day; **anything else → skipped with a console warning**, never
 * silently downgraded to an equality nothing can match. That last branch is
 * the same strictness `buildWidgetScopedFilter` applies to a default binding
 * on an unknown field name, for the same reason: a query the backend answers
 * `200 OK` with zero rows is indistinguishable from "this range has no data",
 * so the typo has to be said out loud somewhere.
 */
export function buildFilterCondition(
  def: DashboardFilterDef,
  value: unknown,
): Record<string, unknown> | unknown | undefined {
  if (isEmptyValue(def, value)) return undefined;

  if (def.type === 'dateRange' || def.type === 'date') {
    const v = value as DateRangeValue;
    if (typeof v === 'object') {
      const preset = typeof v.preset === 'string' && v.preset ? v.preset : undefined;
      const range = preset ? presetBounds(preset) : undefined;
      const from = range?.from ?? v.from;
      const to = range?.to ?? v.to;
      if (preset && !range) {
        // Was already dropped here — but silently, which reads as "no data".
        warnDateFilter(
          from || to
            ? `filter "${def.name}": ignoring unknown date range preset "${preset}" — ` +
                `using the explicit from/to bounds instead; known presets: ${presetList()}`
            : `skipping filter "${def.name}": unknown date range preset "${preset}" — ` +
                `expected one of: ${presetList()}`,
        );
      }
      if (!from && !to) return undefined;
      return {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }
    if (typeof v === 'string' && !isUsableDateString(v)) {
      warnDateFilter(
        `skipping filter "${def.name}": value "${v}" is neither a known date range preset ` +
          `nor an ISO date — expected one of: ${presetList()}, an ISO date (YYYY-MM-DD), ` +
          `or a date macro such as {today}`,
      );
      return undefined;
    }
    // A bare string date (or date macro) means equality on that day.
    return value;
  }

  if (def.type === 'select' || def.type === 'lookup') {
    return Array.isArray(value) ? { $in: value } : value;
  }

  if (def.type === 'text') {
    return { $contains: value };
  }

  // number and anything else: equality.
  return value;
}

/**
 * Resolve which of the widget's fields a filter binds to.
 * Returns `undefined` when the widget is not bound to this filter.
 *
 * Precedence: explicit `filterBindings` entry (string overrides the field,
 * `false` opts out — both win over everything) → legacy `targetWidgets`
 * allow-list → the filter's own default `field`.
 */
function resolveBoundField(
  widget: Pick<DashboardWidgetSchema, 'id' | 'filterBindings'>,
  def: DashboardFilterDef,
): string | undefined {
  const binding = widget.filterBindings?.[def.name];
  if (binding === false) return undefined;
  if (typeof binding === 'string' && binding) return binding;
  if (def.targetWidgets && def.targetWidgets.length > 0) {
    if (!widget.id || !def.targetWidgets.includes(widget.id)) return undefined;
  }
  return def.field;
}

/**
 * Compute the widget-scoped `FilterCondition` for the current filter values:
 * one `{ [boundField]: condition }` entry per active, bound filter, combined
 * with `$and` when several apply. Returns `undefined` when nothing applies —
 * callers then leave the widget's own filter untouched.
 *
 * Metadata-aware default bindings (#2578 item 5): when `knownFields` is
 * provided (the widget's object field names), a DEFAULT binding whose target
 * field is not on the object is skipped with a console warning instead of
 * emitting a query the backend will empty-match or reject. An EXPLICIT
 * `filterBindings` string is always honoured — the author asked for that
 * field, so a typo surfaces as a visible (fixable) empty widget rather than
 * being silently dropped. Callers omit `knownFields` when metadata is not
 * (yet) available, preserving the previous behaviour.
 */
export function buildWidgetScopedFilter(
  widget: Pick<DashboardWidgetSchema, 'id' | 'filterBindings'>,
  defs: DashboardFilterDef[],
  values: Record<string, unknown>,
  knownFields?: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = [];

  for (const def of defs) {
    const value = values[def.name];
    if (isEmptyValue(def, value)) continue;
    const field = resolveBoundField(widget, def);
    if (!field) continue;
    const isExplicit = typeof widget.filterBindings?.[def.name] === 'string';
    if (!isExplicit && knownFields && !knownFields.has(field)) {
      if (typeof console !== 'undefined') {
        console.warn(
          `[dashboard-filters] skipping filter "${def.name}" on widget "${widget.id ?? '?'}": ` +
            `default field "${field}" does not exist on the widget's object — ` +
            `map it with filterBindings: { "${def.name}": "<field>" } or opt out with false`,
        );
      }
      continue;
    }
    const condition = buildFilterCondition(def, value);
    if (condition === undefined) continue;
    conditions.push({ [field]: condition });
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}
