/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Dashboard global-filter legacy alias (objectui#4165)
 *
 * The ADR-0089 alias-retirement pattern for the `{ preset: <name> }` spelling
 * of a `type: 'date'` global filter's declared `defaultValue`.
 *
 * Deliberately ZOD-FREE, and deliberately not in `zod/complex.zod.ts` next to
 * the schema it guards: `@object-ui/types`' main entry re-exports runtime
 * helpers, and pulling this one from a `*.zod.ts` module would drag the whole
 * zod graph into every consumer of that entry. The schema's doc block points
 * here instead.
 *
 * @module dashboard-filter-alias
 * @packageDocumentation
 */

/**
 * Is this the LEGACY `{ preset: <name> }` spelling of a date filter's declared
 * `defaultValue`?
 *
 * Deliberately exact: the single key `preset`, holding a non-empty string. The
 * documented alias is that shape and only that shape, so `{ preset, from, to }`
 * is NOT lifted — it has no canonical spelling to be lifted TO, and dropping
 * the bounds to manufacture one would lose data silently. Such a value falls
 * through to the spec's own named rejection, which is the correct loud outcome.
 */
function isLegacyPresetDefault(value: unknown): value is { preset: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as object);
  if (keys.length !== 1 || keys[0] !== 'preset') return false;
  const preset = (value as { preset: unknown }).preset;
  return typeof preset === 'string' && preset.length > 0;
}

/**
 * Lift the LEGACY `{ preset: <name> }` spelling of a `type: 'date'` filter's
 * declared `defaultValue` to the canonical bare preset NAME — the ADR-0089
 * alias-retirement pattern, applied to a value SHAPE rather than to a key
 * (objectui#4165).
 *
 * Returns the filter UNCHANGED (same reference) when there is nothing to lift,
 * so callers can use identity to detect whether an alias was present.
 *
 * ## What the alias is, and why it is only an alias
 *
 * `@objectstack/spec` 17.0.0-rc.6 put a `superRefine` on `GlobalFilterSchema`
 * holding a `type: 'date'` filter's `defaultValue` to three spellings — a
 * preset NAME (`last_7_days`), an ISO date (`2026-01-15`), or a date-macro
 * token (`{today}`) — and refusing everything else BY NAME. `{ preset: … }` is
 * not among them.
 *
 * That object form was never a spelling objectui WROTE to storage. Measured in
 * objectui#4165: `@object-ui/core`'s `normalizeDateDefault` produces it as the
 * runtime VALUE of a filter variable (`DateRangeValue`, which is what
 * `DateRangeFilter` and `buildFilterCondition` read), and no code path writes a
 * resolved filter def back into a dashboard document. The prose that used to
 * sit on `GlobalFilterSchema` claimed the opposite ("stored dashboards carry
 * that object form"), conflating declaration space with value space — that
 * conflation is what #4165 was filed about.
 *
 * It is still a real alias, because `GlobalFilterSchema` (`zod/complex.zod.ts`)
 * ACCEPTED it — `defaultValue` was widened to `z.any()` — and advertised it as
 * the on-disk form from objectstack#4115 until this change. A hand-authored or
 * AI-authored dashboard may legitimately carry it, and refusing those documents
 * outright is exactly the breakage this window exists to avoid.
 *
 * ## Why a lift and not a widened schema
 *
 * Maintainer ruling, objectui#4165, 2026-08-11 — quoted verbatim:
 *
 * > 「spec stays strict — no widening。rc.6 的 refinement 成立，bare preset
 * > NAME 是唯一 canonical spelling。」
 *
 * Two accepted spellings for one meaning is permanent contract accretion and
 * gives AI authors two forms to drift between forever. A lift converges them
 * and, unlike a widened schema, can actually be retired.
 *
 * ## Retirement window
 *
 * - **Opened**: 2026-08-11, `@object-ui/types` 17.x (objectui#4165).
 * - **Read sites that apply it** — both call THIS function, there is no second
 *   implementation:
 *   1. `resolveDashboardFilterDefs` (`@object-ui/core`, `dashboard-filters.ts`)
 *      — every stored `globalFilters` entry passes through it before anything
 *      renders, so a legacy dashboard renders identically to a canonical one;
 *   2. `DashboardDesignPage` (`@object-ui/plugin-designer`) — lifts the stored
 *      document as it enters the editable draft, so the NEXT save persists the
 *      canonical spelling. That is the rewrite half; without it the window
 *      could never close.
 * - **Observability**: read site 1 warns on the console whenever it lifts, so a
 *   surviving legacy document is visible rather than silently tolerated
 *   (ADR-0078 — nothing silently inert).
 * - **May be removed**: in the next MAJOR of `@object-ui/types` (18.0.0). At
 *   that point delete this function, its two call sites and the pins in
 *   `__tests__/report-chart-query-spec-parity.test.ts`; a document still
 *   carrying `{ preset }` then gets the spec's named rejection, which is the
 *   intended end state.
 */
export function liftLegacyGlobalFilterDefault<T>(filter: T): T {
  if (!filter || typeof filter !== 'object') return filter;
  const defaultValue = (filter as { defaultValue?: unknown }).defaultValue;
  if (!isLegacyPresetDefault(defaultValue)) return filter;
  return { ...(filter as object), defaultValue: defaultValue.preset } as T;
}

/**
 * Document-level convenience over {@link liftLegacyGlobalFilterDefault}: lift
 * every `globalFilters` entry of a stored dashboard.
 *
 * Returns the dashboard UNCHANGED (same reference) when no entry carried the
 * alias — load-bearing for the designer, where a new object identity on every
 * load would read as an edit and mark a pristine dashboard dirty.
 */
export function liftLegacyDashboardFilterDefaults<T>(dashboard: T): T {
  if (!dashboard || typeof dashboard !== 'object') return dashboard;
  const filters = (dashboard as { globalFilters?: unknown }).globalFilters;
  if (!Array.isArray(filters)) return dashboard;
  let changed = false;
  const lifted = filters.map((f) => {
    const next = liftLegacyGlobalFilterDefault(f);
    if (next !== f) changed = true;
    return next;
  });
  if (!changed) return dashboard;
  return { ...(dashboard as object), globalFilters: lifted } as T;
}

