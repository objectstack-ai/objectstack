// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One storage form per temporal field type on MongoDB (#4047) — the mongo
 * counterpart of ADR-0053 D-B, which gave `Field.datetime` a single UTC storage
 * form on every SQL dialect (#3912).
 *
 * # Why this has to exist
 *
 * MongoDB compares across BSON types by **type bracket**, not by value: a
 * `String` comparand never matches a `Date` field, in either direction, for
 * every operator including `$gte`. So a collection whose datetime column held
 * both forms — and every collection did, because the driver's own
 * `created_at`/`updated_at` defaults bind `new Date()` while every REST/JSON
 * write and every relative-date token arrives as an ISO string — answered a
 * date window with whichever half happened to match the comparand's type, and
 * frequently with nothing at all. That is strictly worse than #3777's "loses
 * the final day": the dashboard's default window returned empty.
 *
 * # The canon
 *
 * | Field type | Stored as | Why |
 * |---|---|---|
 * | `datetime` | BSON `Date` | the dialect's native instant — indexable, range-queryable, timezone-unambiguous. The `timestamptz` of this driver. |
 * | `date` | `YYYY-MM-DD` text | timezone-naive by ADR-0053 Phase 1. A BSON Date would invent a midnight instant and re-couple it to a zone. |
 * | `time` | `HH:MM:SS[.fff]` text | same reasoning (#3994). |
 *
 * Write and filter must apply the SAME rule, or the halves disagree again —
 * which is why {@link storageDatetimeValue} is the one function both call.
 */

/**
 * The BSON storage form of a `Field.datetime` value: a `Date` at the instant
 * the input denotes.
 *
 * Total by design — an input this cannot interpret is returned unchanged rather
 * than turned into `Invalid Date`, so unparseable junk keeps failing the
 * comparison instead of silently becoming a wrong instant (the same totality
 * `canonicalUtcDatetime` keeps on the SQL side).
 *
 * A bare `YYYY-MM-DD` means **midnight UTC**, stated explicitly so it cannot be
 * re-read as midnight in the server's local zone. The whole-day reading of a
 * bare day used as an UPPER bound is a separate, operator-sensitive concern
 * handled before this by `nextUtcCalendarDay` (#3777/#4042) — this function
 * only converts FORM.
 */
export function storageDatetimeValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value; // already the storage form
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d;
  }
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === '') return value;
  // A bare integer (in either form) is epoch milliseconds.
  if (/^-?\d+$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? value : d;
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s}T00:00:00.000Z`
    // Zone-naive `YYYY-MM-DD[ T]HH:MM[:SS[.fff]]` → its wall clock IS UTC, the
    // same rule the SQL drivers apply to `CURRENT_TIMESTAMP`-written rows.
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)
      ? `${s.replace(' ', 'T')}Z`
      : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : value;
}

/**
 * Collapse a `Field.date` value to timezone-naive `YYYY-MM-DD` text — a `Date`
 * to its UTC calendar day, a string to its leading date. Mirrors
 * `SqlDriver.toDateOnly` so both backends agree on what a date *is*.
 */
export function storageDateValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return value;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  }
  return value;
}

/** Which temporal rule a declared field takes, if any. */
export type TemporalFieldKind = 'datetime' | 'date';

/**
 * Resolves the temporal kind of `field` on the object being queried, or
 * `undefined` when the object was never declared (an ad-hoc collection) or the
 * field is not temporal. An absent resolver means "coerce nothing" — the
 * pre-#4047 behaviour, which is what keeps `translateFilter` usable as the
 * standalone shape translator it is exported as.
 */
export type TemporalFieldKindResolver = (field: string) => TemporalFieldKind | undefined;

/**
 * Put a value into the storage form of `field`. Non-temporal fields and
 * undeclared objects pass through untouched.
 */
export function coerceTemporalValue(
  value: unknown,
  kind: TemporalFieldKind | undefined,
): unknown {
  if (kind === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => coerceTemporalValue(v, kind));
  return kind === 'datetime' ? storageDatetimeValue(value) : storageDateValue(value);
}

/**
 * Index the declared temporal fields of one object, for
 * {@link TemporalFieldKindResolver}. Called from `syncSchema`, the only place a
 * driver is handed an object definition.
 */
export function indexTemporalFields(
  fields: Record<string, { type?: string }> | undefined,
): Map<string, TemporalFieldKind> {
  const out = new Map<string, TemporalFieldKind>();
  for (const [name, def] of Object.entries(fields ?? {})) {
    if (def?.type === 'datetime') out.set(name, 'datetime');
    else if (def?.type === 'date') out.set(name, 'date');
  }
  return out;
}
