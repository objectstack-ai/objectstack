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
 *
 * [#20176] The rule itself is `@objectstack/core`'s `temporalStorageForm` —
 * the one function `driver-sql` and the engine's per-aggregation `filter` and
 * `having` read too. This file carried a word-for-word copy of it
 * (`storageDatetimeValue` / `storageDateValue` / `storageTimeValue`, mirroring
 * `SqlDriver`'s `canonicalUtcDatetime` / `toDateOnly` / `canonicalTimeOfDay`);
 * the copies agreed shape for shape when they were lifted, so every answer
 * this driver gives is unchanged. What stays here is this driver's own half:
 * which declared fields are temporal, and that a list comparand is mapped
 * member by member.
 */

import { temporalStorageForm } from '@objectstack/core';

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
  return temporalStorageForm(value, kind);
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
