// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Dimension display-label resolution (ADR-0021).
 *
 * Analytics groups by the raw stored value of a dimension field. For two field
 * kinds that value is NOT human-readable:
 *
 *  - **select** — grouped by the stored option `value` (e.g. `backlog`), but the
 *    user-facing text is the option `label` (e.g. `Backlog`).
 *  - **the reference class** (`REFERENCE_VALUE_TYPES`: `lookup`,
 *    `master_detail`, `user`, `tree`) — grouped by the foreign-key `id` (e.g.
 *    `8eqtuKI4G9IhUsPS`), but the user-facing text is the related record's
 *    display field (its name/title). All four store an id and all four resolve
 *    the same way (#16390); a `user` dimension's target is `sys_user`, whether
 *    the field spells `reference` out or leaves it to the type.
 *
 * `resolveDimensionLabels` post-processes the result rows IN PLACE, replacing the
 * raw value at `row[dimension.name]` with its display label when one is found.
 * Unresolved values are left untouched so an orphaned id still renders as itself
 * rather than blanking out. Date / number / plain-string dimensions are no-ops.
 *
 * The resolution LOGIC lives here (and is unit-tested); the low-level capabilities
 * — reading an object's field map, fetching id→label pairs, and translating a
 * select option's label (#16773) — are injected via {@link DimensionLabelDeps}
 * so this module stays free of any engine OR i18n dependency: a select option's
 * label is looked up in a translation bundle by the SAME translator the
 * object-metadata REST endpoint uses (`translateObject`, `@objectstack/spec/system`),
 * called from the plugin bridge (`plugin.ts`) — not reimplemented here, so
 * there stays exactly ONE copy of "translate a select option label".
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import { referenceTargetOf } from '@objectstack/spec/data';

/** The minimal field shape this resolver needs. */
export interface FieldMetaLite {
  type?: string;
  /**
   * The referenced object's name, for a member of the reference class
   * (`lookup` / `master_detail` / `user` / `tree`). Optional even for one of
   * those: a `user` field's target is fixed by the TYPE, so `referenceTargetOf`
   * supplies `sys_user` when the field omits it.
   */
  reference?: string;
  /** Select options — the value→label source. */
  options?: Array<{ value: unknown; label?: string }>;
}

/** Capabilities the resolver needs from the runtime (injected by the plugin). */
export interface DimensionLabelDeps {
  /** Return the field map for an object, or `undefined` if unknown. */
  getObjectFields(objectName: string): Record<string, FieldMetaLite> | undefined;
  /**
   * Fetch a map of `id → display label` for the given ids of a target object.
   * The implementation chooses the target's display field. Returning an empty
   * map (e.g. no display field, no data access) leaves the ids unresolved.
   *
   * `scope` (ADR-0021 D-C, #3602) is the TARGET object's own read scope — the
   * RLS/tenant `FilterCondition` the implementation must AND into the label
   * lookup so this never reveals a related record the target object's RLS would
   * hide. The label lookup is a per-record read (`group by id`) dressed as an
   * aggregate; without the scope it leaks display names whenever the referenced
   * object is more restricted than the base object whose rows carry the id.
   * `undefined` means "no scope for this object" (global table / unrestricted
   * caller) — the same contract as the read-scope provider.
   *
   * `context` is the request's ExecutionContext — the SECOND belt on the same
   * read (#3602). `scope` is the analytics layer's own predicate; forwarding the
   * context lets the ENGINE's middleware chain scope this per-record read
   * itself, so it stays scoped even if a caller ever reaches this hook without
   * a resolved `scope`. Implementations bridging to an ObjectQL engine MUST
   * forward it; a bridge with nowhere to put it may ignore it.
   */
  fetchRecordLabels(
    targetObject: string,
    ids: unknown[],
    scope?: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<Map<unknown, string>>;
  /**
   * Translate a `select` field's authored `options[]` into `locale` (#16773).
   *
   * A select option's `label` (`SelectOptionSchema.label`, `packages/spec`) is
   * a PLAIN string — never an inline `I18nLabel` map — so its translation, if
   * any, lives in an i18n TRANSLATION BUNDLE keyed
   * `objects.<object>.fields.<field>.options.<value>`, the same address
   * `translateObject` (`@objectstack/spec/system`) resolves for
   * `GET /meta/object/:name` (the object-metadata REST endpoint the console's
   * list/kanban/grid renderers already read their translated option labels
   * from). This hook is how that SAME translator reaches an analytics
   * dimension's option labels too — implemented once, in the plugin bridge
   * (`plugin.ts`), by calling `translateObject` itself; nothing here
   * reimplements the lookup.
   *
   * Optional, and `undefined` (no i18n service registered, or nothing for
   * this object/field/locale) means "no translation available" — the caller
   * then falls back to the field's own authored `options[].label`, exactly
   * the pre-existing (locale-blind) behaviour. `locale` is threaded PER CALL,
   * never captured when `DimensionLabelDeps` is built, because one instance
   * is reused across every request.
   */
  translateSelectOptions?(
    objectName: string,
    fieldName: string,
    options: Array<{ value: unknown; label?: string }>,
    locale: string | undefined,
  ): Array<{ value: unknown; label?: string }> | undefined;
}

/**
 * Resolve the TARGET object's read scope for a label lookup (#3602). Returns the
 * object's RLS/tenant `FilterCondition`, `null`/`undefined` when the object is
 * unscoped, or a rejected promise when the scope cannot be resolved — in which
 * case the resolver fails CLOSED (skips that dimension's labels) rather than
 * fetching unscoped names.
 */
export type LabelScopeResolver = (
  targetObject: string,
) => Promise<Record<string, unknown> | null | undefined> | Record<string, unknown> | null | undefined;

/**
 * The object a reference-typed dimension field points at, or `undefined` when
 * the field is not one (#16390).
 *
 * Delegates to spec's `referenceTargetOf` — the declared SINGLE arbiter of
 * "what does this field expand into" — so this module reads the reference class
 * from the one place that defines it (`REFERENCE_VALUE_TYPES`: `lookup`,
 * `master_detail`, `user`, `tree`) instead of restating a subset of it. Two
 * things follow that a hand-written `type in {lookup, master_detail} &&
 * field.reference` test got wrong:
 *
 *  - a `user` dimension (and a `tree` one) grouped by a stored FK id used to
 *    render that raw id where every sibling member rendered a name — the axis
 *    of any "by person" chart was a column of user ids;
 *  - a `user` field authored WITHOUT `reference` still names a target, because
 *    `sys_user` is a CONSTANT OF THE TYPE that `referenceTargetOf` materializes.
 *    Requiring the author to restate it is precisely the disagreement between
 *    two readers of one field that arbiter exists to end.
 */
function referenceLabelTarget(meta: FieldMetaLite | undefined): string | undefined {
  return meta ? referenceTargetOf(meta) : undefined;
}

/**
 * Sort-key label resolution for `DatasetSelection.order` (#3680).
 *
 * The executor sorts the assembled grid BEFORE `queryDataset` rewrites stored
 * dimension values into display labels, so an order key naming a `select` or
 * reference-class dimension used to sort by the stored value / FK id —
 * an order that presents as arbitrary once the labels render. This hook hands
 * the executor JUST the value→label mapping for such a dimension so it can sort
 * by what the user will actually read, while the rows keep their raw values
 * (drill metadata depends on them) and ordering + windowing stay one adjacent
 * step. The executor stays engine-free: it sees this interface, never the
 * engine behind it.
 */
export interface OrderLabelResolver {
  /**
   * Whether the dimension's stored value differs from the label it renders as
   * (`select` options, or a reference-class FK id — `lookup`/`master_detail`/
   * `user`/`tree`). Synchronous — the
   * executor consults it when deciding whether the window may be pushed into
   * SQL, before any query runs.
   */
  isLabelBearing(dimension: string): boolean;
  /**
   * Map the given raw stored values of one dimension to display labels.
   * Values missing from the map sort by their raw form — the same thing the
   * user will see rendered for them.
   */
  resolveLabels(dimension: string, values: unknown[]): Promise<Map<unknown, string> | undefined>;
}

/**
 * Build the executor's {@link OrderLabelResolver} from the dataset's dimension
 * list and the injected label capabilities. Mirrors the classification in
 * {@link resolveDimensionLabels}: a dimension is label-bearing when its field
 * carries select `options` or belongs to the reference class and names a target.
 *
 * - `select` resolves from field metadata — no query at all.
 * - a reference dimension costs ONE batched id→name read over the distinct
 *   grouped values, scoped to the REFERENCED object's own RLS (#3602). Fail
 *   closed: an unresolvable scope degrades to sorting by the stored id rather
 *   than fetching unscoped — consistent with the display pass, which renders
 *   the raw id in that case too.
 */
export function createOrderLabelResolver(
  baseObject: string,
  dims: Array<{ name: string; field: string }>,
  deps: DimensionLabelDeps,
  resolveScope?: LabelScopeResolver,
  context?: ExecutionContext,
): OrderLabelResolver {
  const dimByName = new Map(dims.map((d) => [d.name, d]));
  const metaFor = (dimension: string): FieldMetaLite | undefined => {
    const dim = dimByName.get(dimension);
    return dim ? deps.getObjectFields(baseObject)?.[dim.field] : undefined;
  };
  return {
    isLabelBearing(dimension) {
      const meta = metaFor(dimension);
      if (!meta) return false;
      if (Array.isArray(meta.options) && meta.options.length > 0) return true;
      return !!referenceLabelTarget(meta);
    },
    async resolveLabels(dimension, values) {
      const meta = metaFor(dimension);
      if (!meta) return undefined;
      if (Array.isArray(meta.options) && meta.options.length > 0) {
        const labelByValue = new Map<unknown, string>();
        for (const opt of meta.options) {
          if (opt && opt.label != null) labelByValue.set(opt.value, String(opt.label));
        }
        return labelByValue;
      }
      const target = referenceLabelTarget(meta);
      if (target) {
        let scope: Record<string, unknown> | null | undefined;
        if (resolveScope) {
          try {
            scope = await resolveScope(target);
          } catch {
            return undefined;
          }
        }
        return deps.fetchRecordLabels(target, values, scope ?? undefined, context);
      }
      return undefined;
    },
  };
}

/**
 * Wrap a {@link DimensionLabelDeps} so repeated `fetchRecordLabels` calls
 * within ONE request fetch each id at most once. A selection that sorts by a
 * lookup dimension resolves labels twice — once PRE-window for the sort keys
 * (#3680, over the full grid's ids), once post-window for display (a subset of
 * the same ids) — so with this cache the display pass costs no extra query.
 *
 * Per-request only: entries are keyed by target object alone, which is safe
 * because an object's read scope is constant within one request. Never share
 * an instance across requests.
 */
export function withLabelFetchCache(deps: DimensionLabelDeps): DimensionLabelDeps {
  // Per target object: id → label, with `null` marking "fetched, no label"
  // (RLS-hidden or orphaned) so unresolvable ids are not re-fetched every call.
  const cache = new Map<string, Map<unknown, string | null>>();
  return {
    getObjectFields: (objectName) => deps.getObjectFields(objectName),
    async fetchRecordLabels(targetObject, ids, scope, context) {
      let known = cache.get(targetObject);
      if (!known) {
        known = new Map();
        cache.set(targetObject, known);
      }
      const missing = ids.filter((id) => !known.has(id));
      if (missing.length > 0) {
        const fetched = await deps.fetchRecordLabels(targetObject, missing, scope, context);
        for (const id of missing) known.set(id, fetched.get(id) ?? null);
      }
      const out = new Map<unknown, string>();
      for (const id of ids) {
        const label = known.get(id);
        if (label != null) out.set(id, label);
      }
      return out;
    },
    // #16773 — passed straight through: nothing here is id-keyed request
    // state to cache, and dropping the capability at this wrapper (as an
    // earlier version of this fix did) silently disabled it for every real
    // `AnalyticsService.queryDataset` call, which always wraps `labelResolver`
    // in this cache (`analytics-service.ts`) — only a hand-rolled `deps()` in
    // a unit test bypasses it, which is exactly why that gap did not show up
    // until the end-to-end test below was added.
    translateSelectOptions: deps.translateSelectOptions
      ? (objectName, fieldName, options, locale) =>
          deps.translateSelectOptions!(objectName, fieldName, options, locale)
      : undefined,
  };
}

/** Date-dimension granularity (mirrors the dataset `dateGranularity` enum). */
export type DateGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Format a raw date value (epoch-ms number, numeric string, ISO string, or
 * Date) to a human, sort-stable bucket label per granularity. Returns the input
 * unchanged when it isn't a parseable date, so a non-date value never blanks.
 *
 *   year    → "2026"
 *   quarter → "2026-Q2"
 *   month   → "2026-04"
 *   week    → "2026-04-13" (ISO date of the bucket)
 *   day     → "2026-04-15"
 *
 * Intentionally UTC-only (ADR-0053 Phase 2): timezone bucketing happens
 * upstream in `bucketDate` / `bucketDateValue`, so by the time a value reaches
 * here it is *already* the reference-zone bucket (often a label string like
 * "2026-Q2"). Re-applying a timezone here would shift an already-correct
 * `YYYY-MM-DD` day bucket by a day — this is a pure, idempotent re-labeler.
 */
export function formatDateBucket(value: unknown, granularity?: DateGranularity | string): unknown {
  if (value == null || value instanceof Date === false) {
    if (typeof value !== 'number' && typeof value !== 'string') return value;
  }
  // A YEAR bucket's canonical key IS the bare year ("2026" / 2026) — which the
  // epoch heuristic below would read as 2026 milliseconds and relabel "1970".
  // Being idempotent over already-formatted bucket keys is this function's whole
  // contract, and every other granularity's key already survives the round trip
  // ("2026-Q2", "2026-07", "2026-07-15" all fail the pure-digit test); only the
  // year key collides with it. Recognised before parsing, for both the string
  // and numeric forms drivers return.
  if (granularity === 'year') {
    const y = typeof value === 'number' ? value : Number(String(value).trim());
    if (Number.isInteger(y) && y >= 1000 && y <= 9999) return String(y);
  }
  let d: Date;
  if (value instanceof Date) d = value;
  else if (typeof value === 'number') d = new Date(value);
  else {
    const s = String(value).trim();
    // Pure-digit strings are epoch millis (or seconds); otherwise let Date parse ISO.
    d = /^\d+$/.test(s) ? new Date(Number(s) < 1e12 ? Number(s) * 1000 : Number(s)) : new Date(s);
  }
  if (Number.isNaN(d.getTime())) return value;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-11
  switch (granularity) {
    case 'year': return String(y);
    case 'quarter': return `${y}-Q${Math.floor(m / 3) + 1}`;
    case 'month': return `${y}-${pad(m + 1)}`;
    case 'week':
    case 'day':
    default: return `${y}-${pad(m + 1)}-${pad(d.getUTCDate())}`;
  }
}

/**
 * Replace raw dimension values with display labels, in place.
 *
 * @param baseObject - the dataset's base object (where the dimension fields live)
 * @param dims - selected dimensions as `{ name, field, type?, dateGranularity? }`
 *   (row key = `name`)
 * @param rows - result rows, mutated in place
 * @param deps - injected runtime capabilities
 * @param resolveScope - (ADR-0021 D-C, #3602) resolves the referenced object's
 *   own read scope for a reference-class dimension's label fetch. When it
 *   throws, that dimension's labels are SKIPPED (fail-closed — the raw id renders
 *   instead) rather than fetched unscoped. Omit when no read-scope provider is
 *   configured (labels then fetch unscoped, as before — no security in play).
 * @param context - the request's ExecutionContext, forwarded to
 *   {@link DimensionLabelDeps.fetchRecordLabels} so the engine's own middleware
 *   scopes the per-record label read too — the second belt beside `resolveScope`
 *   (#3602)
 */
export async function resolveDimensionLabels(
  baseObject: string,
  dims: Array<{ name: string; field: string; type?: string; dateGranularity?: DateGranularity | string }>,
  rows: Record<string, unknown>[],
  deps: DimensionLabelDeps,
  resolveScope?: LabelScopeResolver,
  context?: ExecutionContext,
): Promise<void> {
  if (!rows.length || !dims.length) return;
  const fields = deps.getObjectFields(baseObject);
  if (!fields) return;

  for (const dim of dims) {
    const meta = fields[dim.field];

    // ── date: epoch / ISO → human bucket label ────────────────────────
    // A date dimension's grouped value is a raw timestamp (or a bucket start);
    // either way it must render as a readable date, not epoch millis.
    if (dim.type === 'date' || (meta && meta.type === 'date')) {
      for (const row of rows) {
        const formatted = formatDateBucket(row[dim.name], dim.dateGranularity);
        if (formatted != null) row[dim.name] = formatted;
      }
      continue;
    }

    if (!meta) continue;

    // ── select: value → option label ──────────────────────────────────
    if (Array.isArray(meta.options) && meta.options.length > 0) {
      // #16773 — the field's own `options[].label` is the AUTHORED (usually
      // English) text; consult the i18n translation bundle for this request's
      // locale first, via the SAME translator `GET /meta/object/:name` uses,
      // and fall back to the authored label when no translation is available
      // (no i18n service configured, nothing for this locale, or the option's
      // value carries no bundle entry at all).
      const translated = deps.translateSelectOptions?.(baseObject, dim.field, meta.options, context?.locale);
      const options = translated ?? meta.options;
      const labelByValue = new Map<unknown, string>();
      for (const opt of options) {
        if (opt && opt.label != null) labelByValue.set(opt.value, String(opt.label));
      }
      if (labelByValue.size === 0) continue;
      for (const row of rows) {
        const raw = row[dim.name];
        const label = labelByValue.get(raw);
        if (label != null) row[dim.name] = label;
      }
      continue;
    }

    // ── reference class: id → related record display name ──────────────
    // lookup / master_detail / user / tree — one declared class, one reading
    // (#16390). `referenceLabelTarget` names the referenced object.
    const target = referenceLabelTarget(meta);
    if (target) {
      const ids = Array.from(
        new Set(rows.map((r) => r[dim.name]).filter((v) => v != null)),
      );
      if (ids.length === 0) continue;
      // #3602 — the label lookup reads the REFERENCED object by id. Scope it to
      // that object's own RLS so it never surfaces a related record the target's
      // RLS would hide (leak fires when the referenced object is stricter than
      // the base). Fail closed: if the scope can't be resolved, skip this
      // dimension's labels (raw id renders) rather than fetch unscoped.
      // #16390 — this is the belt that makes resolving a `user` dimension safe:
      // turning a user id into a name IS a read of `sys_user`, and it travels
      // the SAME scoped path every other member of the class travels.
      let scope: Record<string, unknown> | null | undefined;
      if (resolveScope) {
        try {
          scope = await resolveScope(target);
        } catch {
          continue;
        }
      }
      const labelById = await deps.fetchRecordLabels(target, ids, scope ?? undefined, context);
      if (!labelById || labelById.size === 0) continue;
      for (const row of rows) {
        const label = labelById.get(row[dim.name]);
        if (label != null) row[dim.name] = label;
      }
    }
  }
}

/**
 * Pick the display field for an object from its field map, by convention:
 * an explicit `name`/`title`/`label` field, else the first text-like field.
 * Returns `undefined` when nothing suitable exists.
 */
export function pickDisplayField(
  fields: Record<string, FieldMetaLite> | undefined,
): string | undefined {
  if (!fields) return undefined;
  for (const preferred of ['name', 'title', 'label']) {
    if (fields[preferred]) return preferred;
  }
  for (const [name, meta] of Object.entries(fields)) {
    if (meta.type === 'text' || meta.type === 'string') return name;
  }
  return undefined;
}
