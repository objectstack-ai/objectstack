// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25778] The per-row operand of a dataset DURATION measure —
 * `duration: { from, to, unit }` (`DatasetMeasureDurationSchema`,
 * `@objectstack/spec/ui`) — on the native-SQL strategy, the one face that
 * answers it.
 *
 * A duration measure aggregates, per group, the time between two `datetime`
 * columns of the same row: `to − from`, in the declared unit. ADR-0021 holds
 * the author to names (no expression, no SQL), so the difference is spelled
 * here, once per dialect, over the storage form each SQL driver writes:
 *
 * | dialect | a `datetime` column holds | seconds from `from` to `to` |
 * |---|---|---|
 * | `sqlite` | canonical UTC ISO-8601 TEXT | `ROUND((julianday(to) - julianday(from)) * 86400000) / 1000` |
 * | `postgres` | `timestamptz` | `EXTRACT(EPOCH FROM (to - from))`, as double precision |
 * | `mysql` | `DATETIME(3)`, the UTC wall clock | `TIMESTAMPDIFF(MICROSECOND, from, to) / 1000000` |
 *
 * SQLite's `julianday` is a double counted from 4714 BC, so its difference
 * carries float noise below the millisecond. Rounded to the millisecond, the
 * resolution every driver stores a datetime at, the three dialects answer the
 * same number for the same instants. The column references arrive already
 * passed through the host's temporal repair (`coerceTemporalFilterColumn`), so
 * a legacy SQLite column still holding epoch integers reads as canonical text
 * here too.
 *
 * A NULL in either column makes the difference NULL, and every aggregate skips
 * a NULL, so a row missing either instant takes no part: `avg` is the mean over
 * the rows that carry both. A `to` earlier than its `from` is a negative
 * duration, aggregated as stored. The measure reports the data and never
 * clamps it.
 *
 * The seconds are divided by the unit's length (`DATASET_DURATION_UNIT_SECONDS`),
 * so `hours` answers a fractional hour count.
 *
 * `'unknown'` has no arm: no difference of two instants parses alike on every
 * SQL dialect. `NativeSQLStrategy.canHandle` declines a duration measure on a
 * datasource whose dialect the host cannot name, and the service refuses it.
 *
 * {@link durationMeasureIn} is here too: the one lookup of a duration measure by
 * name, for this face and for the service's gates.
 */

import { DATASET_DURATION_UNIT_SECONDS, type DatasetDurationUnit } from '@objectstack/spec/ui';
import type { DurationMeasureSpec } from './strategies/types.js';
import type { AnalyticsSqlDialect } from './text-match-sql.js';

/**
 * The duration measure `name` names in a compiled dataset's `durations` (the
 * dataset scope's `measureDurations`), or `undefined`. The one lookup every
 * reader uses, own keys only, so a measure named after an `Object.prototype`
 * member (`constructor`) is never read as a duration it is not.
 */
export function durationMeasureIn(
  durations: Readonly<Record<string, DurationMeasureSpec>> | undefined,
  name: string,
): DurationMeasureSpec | undefined {
  return durations && Object.prototype.hasOwnProperty.call(durations, name) ? durations[name] : undefined;
}

/** The dialects {@link durationOperandSql} has an arm for. */
export type DurationSqlDialect = Exclude<AnalyticsSqlDialect, 'unknown'>;

/** Whether {@link durationOperandSql} can spell a duration on `dialect`. */
export function hasDurationSql(dialect: AnalyticsSqlDialect): dialect is DurationSqlDialect {
  return dialect !== 'unknown';
}

/** Seconds from `fromSql` to `toSql`, both column references, on `dialect`. */
function durationSecondsSql(dialect: DurationSqlDialect, fromSql: string, toSql: string): string {
  switch (dialect) {
    case 'sqlite':
      return `(ROUND((julianday(${toSql}) - julianday(${fromSql})) * 86400000.0) / 1000.0)`;
    case 'postgres':
      return `CAST(EXTRACT(EPOCH FROM (${toSql} - ${fromSql})) AS DOUBLE PRECISION)`;
    case 'mysql':
      return `(TIMESTAMPDIFF(MICROSECOND, ${fromSql}, ${toSql}) / 1000000.0)`;
  }
}

/**
 * The per-row duration from `fromSql` to `toSql` in `unit`: the operand an
 * aggregate (`AVG(…)`, or its conditional form under a measure filter) wraps.
 */
export function durationOperandSql(
  dialect: DurationSqlDialect,
  fromSql: string,
  toSql: string,
  unit: DatasetDurationUnit,
): string {
  const seconds = durationSecondsSql(dialect, fromSql, toSql);
  const length = DATASET_DURATION_UNIT_SECONDS[unit];
  return length === 1 ? seconds : `(${seconds} / ${length}.0)`;
}
