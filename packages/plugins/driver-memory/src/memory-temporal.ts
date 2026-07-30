// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One storage form per temporal field type in the in-memory driver (#4047) —
 * the memory counterpart of ADR-0053 D-B, which gave `Field.datetime` a single
 * UTC storage form on every SQL dialect (#3912).
 *
 * # Why this has to exist
 *
 * mingo compares across JS types the way MongoDB compares across BSON types: a
 * string comparand never matches a `Date` value, in either direction, for every
 * operator including `$gte`. And a datetime column genuinely held both forms —
 * the driver's own `created_at`/`updated_at` defaults write
 * `new Date().toISOString()`, while `initialData` fixtures and direct SDK
 * callers hand it `Date` objects. A date window therefore answered with
 * whichever half matched the comparand's type, silently dropping the other.
 *
 * # The canon
 *
 * | Field type | Stored as | Why |
 * |---|---|---|
 * | `datetime` | canonical UTC ISO text (`…T…Z`, ms precision) | this store has no native instant type; ISO-8601 UTC sorts chronologically under the plain string comparison mingo performs, and it is the wire form, so it survives JSON persistence unchanged. |
 * | `date` | `YYYY-MM-DD` text | timezone-naive by ADR-0053 Phase 1 — an instant would re-couple it to a zone. |
 *
 * The rule is applied on write ({@link toStorageForms}) and to filter
 * comparands, which is the pairing that keeps the two sides from disagreeing.
 */

/**
 * The canonical UTC ISO text form of a `Field.datetime` value.
 *
 * Total by design: an input this cannot interpret is returned unchanged rather
 * than becoming `Invalid Date`, so junk keeps failing the comparison instead of
 * silently becoming a wrong instant. A bare `YYYY-MM-DD` means **midnight
 * UTC**, stated explicitly so it is never re-read in the host's local zone; the
 * whole-day reading of a bare day used as an UPPER bound is the separate,
 * operator-sensitive concern `nextUtcCalendarDay` handles (#3777/#4042) before
 * this runs.
 *
 * Mirrors `SqlDriver`'s `canonicalUtcDatetime` — same inputs, same outputs — so
 * a fixture that moves between the two backends compares identically.
 */
export function storageDatetimeValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === '') return value;
  // A bare integer (in either form) is epoch milliseconds.
  if (/^-?\d+$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s}T00:00:00.000Z`
    // Zone-naive `YYYY-MM-DD[ T]HH:MM[:SS[.fff]]` → its wall clock IS UTC.
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)
      ? `${s.replace(' ', 'T')}Z`
      : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

/**
 * Collapse a `Field.date` value to timezone-naive `YYYY-MM-DD` — a `Date` to
 * its UTC calendar day, a string to its leading date. Mirrors
 * `SqlDriver.toDateOnly`.
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
 * Put a value into the storage form of a field of `kind`. `undefined` kind —
 * a non-temporal field, or an object that was never declared — passes through:
 * the driver does not guess types from values.
 */
export function coerceTemporalValue(value: unknown, kind: TemporalFieldKind | undefined): unknown {
  if (kind === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => coerceTemporalValue(v, kind));
  return kind === 'datetime' ? storageDatetimeValue(value) : storageDateValue(value);
}

/**
 * Index the declared temporal fields of one object. Called from `syncSchema` —
 * the only place this driver is handed an object definition.
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
