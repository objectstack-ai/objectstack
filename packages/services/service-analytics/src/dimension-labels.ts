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
   */
  fetchRecordLabels(targetObject: string, ids: unknown[]): Promise<Map<unknown, string>>;
}

const LOOKUP_TYPES = new Set(['lookup', 'master_detail']);

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
 */
export async function resolveDimensionLabels(
  baseObject: string,
  dims: Array<{ name: string; field: string; type?: string; dateGranularity?: DateGranularity | string }>,
  rows: Record<string, unknown>[],
  deps: DimensionLabelDeps,
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
      const labelById = await deps.fetchRecordLabels(meta.reference, ids);
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
