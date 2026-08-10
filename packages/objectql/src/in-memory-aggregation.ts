// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// In-memory implementation of the QueryAST aggregation contract.
//
// This module is the engine's last-resort path: when the underlying driver
// returned raw rows but the caller asked for `groupBy` / `aggregations`, the
// engine pipes the rows through here so the abstract contract is always
// honoured even on drivers without native aggregation (driver-rest, partial
// SQL drivers, mock drivers in tests).
//
// Capabilities:
//   * Flat groupBy strings: `['region']`
//   * Structured groupBy with date bucketing: `[{ field: 'closed_at',
//     dateGranularity: 'quarter' }]`
//   * Aggregation functions: count, count_distinct, sum, avg, min, max —
//     the whole of `AggregationFunction`. This fallback used to implement two
//     more, `array_agg` and `string_agg`, which #6188 retired from the spec
//     vocabulary (ADR-0049: no SQL backend ever compiled them, so which
//     backend could compute what was unpredictable to the author). Their arms
//     are deleted rather than left unreachable — a `switch` case on a value
//     the enum no longer has does not type-check, and dead arms are how a
//     retired vocabulary comes back by accident.
//   * `distinct: true` on aggregations is GONE (#6815, ADR-0049). This module
//     was its only reader in the whole repo: it collapsed duplicates before
//     applying the function while `driver-sql`, `driver-turso`,
//     `driver-mongodb`, `driver-memory` and the service-analytics SQL builder
//     all ignored the key, so a `sum` with `distinct: true` answered a
//     deduplicated total here and an ordinary total on every SQL datasource —
//     the same divergence class as `array_agg`/`string_agg` above, except the
//     wrong answer was a plausible NUMBER rather than a refusal, so nothing
//     surfaced it. The key is tombstoned on `AggregationNodeSchema` and the
//     dedupe limb is deleted rather than left unreachable, for the same reason
//     the retired function arms were. `count_distinct` is unaffected: it
//     deduplicates inside its own arm, and every SQL face compiles it (#6409).
//   * `filter: FilterCondition` on aggregations is **not** evaluated here —
//     the engine routes filtered aggregations through the driver where
//     possible; the in-memory fallback ignores the per-aggregation filter and
//     logs a warning if one is present.
//
// Date bucketing uses ISO-8601 conventions (weeks start Monday).
//
// THE EMPTY BUCKET'S KEY IS REAL `null` — not a sentinel string (#3839). A
// grouped row whose value is null/absent (or, for a date bucket, unparseable)
// carries `null` for that dimension, which is what the pushed-down SQL path
// emits for the same row: the group column is SQL NULL, or `strftime(...)` /
// `date_trunc(...)` returns NULL for a NULL input. Both paths therefore
// describe "empty" the same way, and `engine.aggregate` picking one per query
// — by driver, granularity, or reference timezone — can no longer change the
// TYPE of a bucket key under a dashboard that drills across the seam.
//
// This previously emitted the literal `'(null)'` "to remain consistent with
// the client `useReportData` hook". That hook was deleted with ADR-0021 (its
// epitaph is objectui `packages/plugin-report/src/index.tsx`), and the string
// never appeared in it anyway. What the string DID do was defeat every
// downstream `== null` check: consumers render their own empty label ('—',
// '(empty)', a localized "Uncategorized") and build drill filters as
// `field = null`, so a sentinel leaked a raw English debug string into the UI
// and turned the empty bucket's drill-through into a zero-row query.
//
// A NON-EMPTY KEY IS THE VALUE AS `find()` PRESENTS IT — no `String()` (#3849).
// The rows this function groups come straight from `driver.find()`, so passing
// the value through is what makes a bucket key equal the column's own read
// shape: a `number` stays a number, a `boolean` stays a boolean. This used to
// `String()` every key, which the pushed-down path never did, so `1` became
// `'1'` and `true` became `'true'` depending only on which path ran.
//
// That was not cosmetic. Several consumers probe a raw `Map` keyed by the
// value's own type — the select-option label table, the lookup FK → record-name
// table, the cross-object FK → attribute table — and `Map` lookup is
// SameValueZero, so `'1'` never finds `1`. A stringified key silently missed
// every entry: labels fell back to raw ids, and cross-object rebucketing filed
// every row under `'(restricted)'` while the grand total still reconciled.

import { calendarPartsInTzOrUtc } from '@objectstack/core';
import type { QueryAST, GroupByNode, AggregationNode, DateGranularityValue } from '@objectstack/spec/data';

/**
 * Group + aggregate raw rows according to the AST's `groupBy` /
 * `aggregations`. When neither is present, returns the rows unchanged.
 *
 * `timezone` (ADR-0053 Phase 2) shifts date bucketing to a reference timezone
 * so a row near a tz day-boundary lands in the right day/week/month/quarter.
 * It is only consulted by `groupBy` items carrying a `dateGranularity`; an
 * unset or `'UTC'` value keeps the historical UTC bucketing.
 */
export function applyInMemoryAggregation(
  rows: any[],
  ast: Pick<QueryAST, 'groupBy' | 'aggregations'>,
  timezone?: string,
): any[] {
  const groupBy = (ast.groupBy ?? []) as GroupByNode[];
  const aggregations = (ast.aggregations ?? []) as AggregationNode[];
  if (groupBy.length === 0 && aggregations.length === 0) return rows;

  if (groupBy.length === 0) {
    // Pure aggregation — single result row.
    return [aggregateBucket(rows, aggregations)];
  }

  const buckets = new Map<string, { key: Record<string, any>; rows: any[] }>();
  for (const row of rows) {
    const key: Record<string, any> = {};
    const parts: string[] = [];
    for (const g of groupBy) {
      const fieldName = typeof g === 'string' ? g : (g.alias ?? g.field);
      const value = projectGroupValue(row, g, timezone);
      key[fieldName] = value;
      // Type-preserving, because the key no longer is: `1` and `'1'`, `true` and
      // `'true'`, `null` and `'null'` are all distinct groups and must not merge
      // just because they interpolate the same. This id is internal to the
      // bucketing loop; only `key` is emitted.
      parts.push(`${fieldName}=${bucketIdPart(value)}`);
    }
    const id = parts.join('\u0001');
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { key, rows: [] };
      buckets.set(id, bucket);
    }
    bucket.rows.push(row);
  }

  const out: any[] = [];
  for (const { key, rows: bucketRows } of buckets.values()) {
    const aggValues = aggregateBucket(bucketRows, aggregations);
    out.push({ ...key, ...aggValues });
  }
  return out;
}

/**
 * Stable, TYPE-PRESERVING encoding of one group value, for the internal bucket
 * id only. `JSON.stringify` gives that for every shape a column can hold —
 * `1` → `1`, `'1'` → `"1"`, `true` → `true`, `null` → `null` — except the two
 * it refuses, which are handled explicitly so a value that used to bucket fine
 * under `String()` cannot start throwing mid-aggregate.
 */
function bucketIdPart(v: unknown): string {
  if (typeof v === 'bigint') return `bigint:${v}`; // JSON.stringify throws on these
  return JSON.stringify(v) ?? `${typeof v}:${String(v)}`; // undefined / symbol / function
}

function projectGroupValue(row: any, g: GroupByNode, timezone?: string): unknown {
  const field = typeof g === 'string' ? g : g.field;
  const v = row?.[field];
  if (typeof g !== 'string' && g.dateGranularity) {
    return bucketDateValue(v, g.dateGranularity, timezone);
  }
  // The value as `driver.find()` presented it — these rows ARE find() output, so
  // passing it through is what makes the bucket key equal the column's own read
  // shape (#3849). `undefined` (absent field) folds into the empty bucket's
  // `null` (#3839). See both notes at the top of this file.
  return v ?? null;
}

function aggregateBucket(rows: any[], aggregations: AggregationNode[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const agg of aggregations) {
    const alias = agg.alias;
    const fn = agg.function;
    if (fn === 'count') {
      // `*` is the count-all sentinel: the Cube `count` measure and a dataset
      // `count` with no field both compile to `sql: '*'` (→ SQL `COUNT(*)`).
      // A row never has a literal `'*'` property, so the non-null branch below
      // counted zero for every bucket — the driver's `COUNT(*)` masked it, but
      // the in-memory path (tz≠UTC date buckets per #1982, driver-rest/-memory)
      // returned 0. Treat `'*'` like a fieldless count over the bucket's rows.
      if (!agg.field || agg.field === '*') {
        out[alias] = rows.length;
      } else {
        out[alias] = rows.reduce(
          (acc, r) => (r[agg.field as string] != null ? acc + 1 : acc),
          0,
        );
      }
      continue;
    }
    const field = agg.field;
    if (!field) {
      out[alias] = null;
      continue;
    }
    const values = collectValues(rows, field);

    switch (fn) {
      case 'count_distinct':
        out[alias] = new Set(values.filter((v) => v != null)).size;
        break;
      case 'sum':
        out[alias] = values.reduce((a, b) => a + toNumber(b), 0);
        break;
      case 'avg': {
        const nums = values.filter((v) => v != null).map(toNumber);
        out[alias] = nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
        break;
      }
      case 'min': {
        const defined = values.filter((v) => v != null);
        out[alias] = defined.length === 0 ? null : defined.reduce((a, b) => (a < b ? a : b));
        break;
      }
      case 'max': {
        const defined = values.filter((v) => v != null);
        out[alias] = defined.length === 0 ? null : defined.reduce((a, b) => (a > b ? a : b));
        break;
      }
      default:
        out[alias] = null;
    }
  }
  return out;
}

/**
 * Every row's value for `field`, in row order, duplicates included.
 *
 * The `distinct` parameter is gone with `AggregationNode.distinct` (#6815):
 * this was the repo's only reader of that flag, and honouring it here while
 * five other faces ignored it is what made one query answer two numbers. Each
 * function arm decides for itself what to do with duplicates — `count_distinct`
 * folds them into a `Set`, every other arm counts them, which is what
 * `SUM(x)` / `AVG(x)` mean on every SQL face.
 */
function collectValues(rows: any[], field: string): any[] {
  return rows.map((r) => r?.[field]);
}

function toNumber(v: any): number {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Bucket a date-like value into an ISO-formatted period label. Weeks start
 * Monday and use ISO week numbering.
 *
 * ⚠️ **This is one of two implementations of the same contract.** A driver that
 * advertises `supports.queryDateGranularity[g]` buckets that granularity in SQL
 * instead, and `engine.aggregate` picks between them per query — so a label
 * produced here must equal the label that driver's SQL produces for the same
 * instant, or a drill-down breaks when it crosses the seam. Editing the labels
 * below means editing every driver's bucket expression too.
 *
 * The seam is enforced by `checkDateBucketParity` (@objectstack/verify), run
 * against the real drivers in
 * `packages/qa/dogfood/test/date-bucket-parity-conformance.test.ts`. Three
 * driver test files also hand-copy this function for self-containment; those
 * copies cannot detect their own drift, which is why the executable check
 * exists.
 *
 * `timezone` (ADR-0053 Phase 2) resolves the calendar day in a reference zone
 * so an instant near a tz day-boundary buckets where a user in that zone would
 * expect. An unset / `'UTC'` / invalid zone keeps the historical UTC bucketing.
 * The y/m/d are taken in the reference zone and the ISO-week math then runs on
 * a UTC date built from those parts — the parts already carry the zone shift,
 * so the week boundary lands correctly without re-applying any offset.
 *
 * A finite NUMBER is read as epoch milliseconds — the form SQLite stores a
 * `Field.datetime` in, and what any driver that hands back raw storage values
 * yields. `new Date(String(1767225600000))` is an Invalid Date, so without this
 * branch such a row landed in the empty bucket while the pushed-down SQL
 * bucketed it correctly (#3773) — the two paths must label the same instant
 * identically or a drill-down built on one breaks against the other.
 *
 * Returns `null` for a null/absent or unparseable instant — the same key the
 * pushed-down SQL yields, where the bucket expression propagates NULL (#3839).
 * Null and unparseable deliberately share one bucket: SQL cannot tell them
 * apart either (`strftime('%Y-%m', 'not-a-date')` is NULL), and splitting them
 * here would re-open the seam this function exists to close.
 */
export function bucketDateValue(
  value: unknown,
  granularity: DateGranularityValue,
  timezone?: string,
): string | null {
  if (value == null) return null;
  const d =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value)
        : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const { year: y, month: m, day } = calendarPartsInTzOrUtc(d, timezone);
  switch (granularity) {
    case 'year':
      return String(y);
    case 'quarter':
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case 'month':
      return `${y}-${String(m).padStart(2, '0')}`;
    case 'day':
      return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    case 'week': {
      // ISO-8601 week date: week 1 contains the first Thursday of the year.
      const target = new Date(Date.UTC(y, m - 1, day));
      const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      target.setUTCDate(target.getUTCDate() - dayNum + 3);
      const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
      const weekNo = 1 + Math.round(
        ((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
      );
      return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }
    default:
      return String(value);
  }
}
