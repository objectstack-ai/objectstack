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
//   * Aggregation functions: count, count_distinct, sum, avg, min, max,
//     array_agg, string_agg
//   * `distinct: true` on aggregations (collapse duplicates before applying
//     the function)
//   * `filter: FilterCondition` on aggregations is **not** evaluated here —
//     the engine routes filtered aggregations through the driver where
//     possible; the in-memory fallback ignores the per-aggregation filter and
//     logs a warning if one is present.
//
// Date bucketing uses ISO-8601 conventions (weeks start Monday). Null /
// invalid values bucket as the literal string `'(null)'` to remain
// consistent with the client `useReportData` hook.

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
      parts.push(`${fieldName}=${value}`);
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

function projectGroupValue(row: any, g: GroupByNode, timezone?: string): string {
  const field = typeof g === 'string' ? g : g.field;
  const v = row?.[field];
  if (typeof g !== 'string' && g.dateGranularity) {
    return bucketDateValue(v, g.dateGranularity, timezone);
  }
  return v == null ? '(null)' : String(v);
}

function aggregateBucket(rows: any[], aggregations: AggregationNode[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const agg of aggregations) {
    const alias = agg.alias;
    const fn = agg.function;
    if (fn === 'count') {
      if (!agg.field) {
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
    const values = collectValues(rows, field, !!agg.distinct);

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
      case 'array_agg':
        out[alias] = values.slice();
        break;
      case 'string_agg':
        out[alias] = values.filter((v) => v != null).map(String).join(',');
        break;
      default:
        out[alias] = null;
    }
  }
  return out;
}

function collectValues(rows: any[], field: string, distinct: boolean): any[] {
  if (!distinct) return rows.map((r) => r?.[field]);
  const seen = new Set<unknown>();
  const out: any[] = [];
  for (const r of rows) {
    const v = r?.[field];
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
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
 * `timezone` (ADR-0053 Phase 2) resolves the calendar day in a reference zone
 * so an instant near a tz day-boundary buckets where a user in that zone would
 * expect. An unset / `'UTC'` / invalid zone keeps the historical UTC bucketing.
 * The y/m/d are taken in the reference zone and the ISO-week math then runs on
 * a UTC date built from those parts — the parts already carry the zone shift,
 * so the week boundary lands correctly without re-applying any offset.
 */
export function bucketDateValue(
  value: unknown,
  granularity: DateGranularityValue,
  timezone?: string,
): string {
  if (value == null) return '(null)';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '(null)';
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
