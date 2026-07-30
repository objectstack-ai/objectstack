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
 * | `time` | `HH:MM:SS`, `.fff` only when non-zero | a timezone-naive wall clock (ADR-0053 D-C1); the variable width still sorts chronologically because `.` sorts below every digit. |
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

/**
 * Collapse a `Field.time` value to a canonical timezone-naive wall clock —
 * `HH:MM:SS`, extended to `HH:MM:SS.fff` exactly when the milliseconds are
 * non-zero. Mirrors `SqlDriver`'s `canonicalTimeOfDay` (ADR-0053 D-C1), so a
 * fixture that moves between the two backends compares identically.
 *
 * This driver had no time rule at all, which is the same meta-problem #3994
 * found on SQL and #4047 found here for `datetime`: with nothing normalising
 * the column, a `Date` write and a `'09:00:00'` write sat side by side, and
 * mingo's cross-type comparison meant a text bound matched no `Date` row in
 * either direction. Measured: 8 of the 9 shared time cases returned only the
 * text-written half of the fixture.
 *
 * Why variable width rather than a fixed `.000`: `.` sorts below every digit,
 * so lexicographic order — which is exactly what mingo performs on strings —
 * stays chronological across the two widths (`'14:30:00.100' < '14:30:01'`),
 * and the zero-millisecond spelling stays the `HH:MM:SS` every dialect's
 * native TIME emits.
 *
 * A `Date` / epoch-ms / full-timestamp value folds to its **UTC** time-of-day,
 * never the host's, matching the platform's instant semantics everywhere else.
 * Total: an out-of-range wall clock (`'25:00'`) or unparseable junk passes
 * through untouched rather than being silently rewritten.
 */
export function storageTimeValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return value;
    const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(s);
    if (m) {
      const [, hh, mm, ss = '00', frac] = m;
      if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return value;
      const ms = frac ? `${frac}000`.slice(0, 3) : '000';
      return ms === '000' ? `${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}.${ms}`;
    }
  }
  // Not a bare wall clock — a `Date`, epoch ms, or a full/zone-naive timestamp
  // string. Delegate to the one function that owns instants, then keep its UTC
  // time-of-day. Same delegation `canonicalTimeOfDay` performs.
  const instant = storageDatetimeValue(value);
  if (typeof instant === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)) {
    const time = instant.slice(11, 23);
    return time.endsWith('.000') ? time.slice(0, 8) : time;
  }
  return value;
}

/** Which temporal rule a declared field takes, if any. */
export type TemporalFieldKind = 'datetime' | 'date' | 'time';

/**
 * Put a value into the storage form of a field of `kind`. `undefined` kind —
 * a non-temporal field, or an object that was never declared — passes through:
 * the driver does not guess types from values.
 */
export function coerceTemporalValue(value: unknown, kind: TemporalFieldKind | undefined): unknown {
  if (kind === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => coerceTemporalValue(v, kind));
  if (kind === 'datetime') return storageDatetimeValue(value);
  if (kind === 'time') return storageTimeValue(value);
  return storageDateValue(value);
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
    else if (def?.type === 'time') out.set(name, 'time');
  }
  return out;
}
