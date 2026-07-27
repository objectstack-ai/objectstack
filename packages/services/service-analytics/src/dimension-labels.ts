// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Dimension display-label resolution (ADR-0021).
 *
 * Analytics groups by the raw stored value of a dimension field. For two field
 * kinds that value is NOT human-readable:
 *
 *  - **select** — grouped by the stored option `value` (e.g. `backlog`), but the
 *    user-facing text is the option `label` (e.g. `Backlog`).
 *  - **lookup / master_detail** — grouped by the foreign-key `id` (e.g.
 *    `8eqtuKI4G9IhUsPS`), but the user-facing text is the related record's
 *    display field (its name/title).
 *
 * `resolveDimensionLabels` post-processes the result rows IN PLACE, replacing the
 * raw value at `row[dimension.name]` with its display label when one is found.
 * Unresolved values are left untouched so an orphaned id still renders as itself
 * rather than blanking out. Date / number / plain-string dimensions are no-ops.
 *
 * The resolution LOGIC lives here (and is unit-tested); the low-level capabilities
 * — reading an object's field map and fetching id→label pairs — are injected via
 * {@link DimensionLabelDeps} so this module stays free of any engine dependency.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';

/** The minimal field shape this resolver needs. */
export interface FieldMetaLite {
  type?: string;
  /** Lookup / master_detail target object name. */
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

const LOOKUP_TYPES = new Set(['lookup', 'master_detail']);

/**
 * Sort-key label resolution for `DatasetSelection.order` (#3680).
 *
 * The executor sorts the assembled grid BEFORE `queryDataset` rewrites stored
 * dimension values into display labels, so an order key naming a `select` or
 * `lookup`/`master_detail` dimension used to sort by the stored value / FK id —
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
   * (`select` options, `lookup`/`master_detail` FK ids). Synchronous — the
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
 * carries select `options` or is a lookup/master_detail with a `reference`.
 *
 * - `select` resolves from field metadata — no query at all.
 * - `lookup`/`master_detail` costs ONE batched id→name read over the distinct
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
      return !!(meta.type && LOOKUP_TYPES.has(meta.type) && meta.reference);
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
      if (meta.type && LOOKUP_TYPES.has(meta.type) && meta.reference) {
        let scope: Record<string, unknown> | null | undefined;
        if (resolveScope) {
          try {
            scope = await resolveScope(meta.reference);
          } catch {
            return undefined;
          }
        }
        return deps.fetchRecordLabels(meta.reference, values, scope ?? undefined, context);
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
 *   own read scope for a lookup/master_detail dimension's label fetch. When it
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
      const labelByValue = new Map<unknown, string>();
      for (const opt of meta.options) {
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

    // ── lookup / master_detail: id → related record display name ───────
    if (meta.type && LOOKUP_TYPES.has(meta.type) && meta.reference) {
      const ids = Array.from(
        new Set(rows.map((r) => r[dim.name]).filter((v) => v != null)),
      );
      if (ids.length === 0) continue;
      // #3602 — the label lookup reads the REFERENCED object by id. Scope it to
      // that object's own RLS so it never surfaces a related record the target's
      // RLS would hide (leak fires when the referenced object is stricter than
      // the base). Fail closed: if the scope can't be resolved, skip this
      // dimension's labels (raw id renders) rather than fetch unscoped.
      let scope: Record<string, unknown> | null | undefined;
      if (resolveScope) {
        try {
          scope = await resolveScope(meta.reference);
        } catch {
          continue;
        }
      }
      const labelById = await deps.fetchRecordLabels(meta.reference, ids, scope ?? undefined, context);
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
