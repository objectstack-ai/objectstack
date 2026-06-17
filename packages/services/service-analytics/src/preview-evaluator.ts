// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0037 Phase 3 — draft data preview: evaluate an AnalyticsQuery over an
// in-memory row set (the pending `seed` draft's records) instead of the real
// data engine. This is what lets a Live Canvas dashboard chart REAL numbers
// from the DRAFTED sample data before anything is published — and because
// publish materializes the *same* seed, the numbers are continuous across
// the publish boundary.
//
// Scope (deliberately the dataset-query subset, not a general engine):
//   • Mongo-style `where` filters ($eq implicit, $ne/$gt/$gte/$lt/$lte/
//     $in/$nin/$contains, $and/$or/$not)
//   • timeDimensions date-range filtering + granularity bucketing
//     (day/week/month/quarter/year)
//   • group-by dimensions; count / countDistinct / sum / avg / min / max
//   • order + limit/offset
// Anything beyond (joins via `include`, raw SQL) falls back to the caller's
// normal execution path — the preview simply doesn't claim it.

import { calendarPartsInTzOrUtc } from '@objectstack/core';
import type { AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';

type Row = Record<string, unknown>;

// ── Filters (the unified Query DSL subset) ──────────────────────────────────

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matchOp(value: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case '$eq': return value === expected || String(value) === String(expected);
    case '$ne': return !(value === expected || String(value) === String(expected));
    case '$gt': return value != null && compare(value, expected) > 0;
    case '$gte': return value != null && compare(value, expected) >= 0;
    case '$lt': return value != null && compare(value, expected) < 0;
    case '$lte': return value != null && compare(value, expected) <= 0;
    case '$in': return Array.isArray(expected) && expected.some((e) => value === e || String(value) === String(e));
    case '$nin': return Array.isArray(expected) && !expected.some((e) => value === e || String(value) === String(e));
    case '$contains': return String(value ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    default: return true; // unknown operator — permissive (preview, reads only)
  }
}

export function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === '$and') {
      if (!(cond as Row[]).every((c) => matchesWhere(row, c as Row))) return false;
    } else if (key === '$or') {
      if (!(cond as Row[]).some((c) => matchesWhere(row, c as Row))) return false;
    } else if (key === '$not') {
      if (matchesWhere(row, cond as Row)) return false;
    } else if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, expected] of Object.entries(cond as Row)) {
        if (!matchOp(row[key], op, expected)) return false;
      }
    } else if (!(row[key] === cond || String(row[key]) === String(cond))) {
      return false; // implicit equality
    }
  }
  return true;
}

// ── Time bucketing ──────────────────────────────────────────────────────────

export function bucketDate(value: unknown, granularity: string, timezone?: string): string | null {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  // ADR-0053 Phase 2: resolve the calendar day in the reference zone so an
  // instant near a tz day-boundary buckets where a user in that zone expects.
  // Unset / 'UTC' / invalid keeps the historical UTC bucketing.
  const { year: y, month, day: dayNum } = calendarPartsInTzOrUtc(d, timezone);
  const m = `${month}`.padStart(2, '0');
  const day = `${dayNum}`.padStart(2, '0');
  switch (granularity) {
    case 'year': return `${y}`;
    case 'quarter': return `${y}-Q${Math.floor((month - 1) / 3) + 1}`;
    case 'month': return `${y}-${m}`;
    case 'week': {
      // Build a UTC date from the zone-shifted parts, then step back to Monday.
      const monday = new Date(Date.UTC(y, month - 1, dayNum));
      const dow = (monday.getUTCDay() + 6) % 7; // Monday=0
      monday.setUTCDate(monday.getUTCDate() - dow);
      return monday.toISOString().slice(0, 10);
    }
    case 'day':
    default:
      return `${y}-${m}-${day}`;
  }
}

// ── Aggregation ─────────────────────────────────────────────────────────────

function aggregate(rows: Row[], metricType: string, field: string): number {
  if (metricType === 'count' || field === '*') {
    if (metricType === 'countDistinct') {
      return new Set(rows.map((r) => r[field]).filter((v) => v != null)).size;
    }
    return rows.length;
  }
  const nums = rows.map((r) => Number(r[field])).filter((n) => Number.isFinite(n));
  switch (metricType) {
    case 'countDistinct': return new Set(rows.map((r) => r[field]).filter((v) => v != null)).size;
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case 'min': return nums.length ? Math.min(...nums) : 0;
    case 'max': return nums.length ? Math.max(...nums) : 0;
    default: return nums.length ? nums.reduce((a, b) => a + b, 0) : rows.length;
  }
}

/**
 * Evaluate `query` over `rows` using the cube's measure/dimension specs.
 * Mirrors the engine strategies' output contract: rows keyed by bare
 * measure/dimension names, `fields` describing each output column.
 */
export function evaluateAnalyticsQueryOverRows(
  query: AnalyticsQuery,
  cube: Cube,
  rows: Row[],
): AnalyticsResult {
  // 1. Row-level filters: `where`, then timeDimension dateRanges.
  let filtered = rows.filter((r) => matchesWhere(r, query.where));
  const timeDims = query.timeDimensions ?? [];
  for (const td of timeDims) {
    const dim = cube.dimensions?.[td.dimension];
    const field = String(dim?.sql ?? td.dimension);
    if (!td.dateRange) continue;
    const [start, end] = Array.isArray(td.dateRange) ? td.dateRange : [td.dateRange, td.dateRange];
    filtered = filtered.filter((r) => {
      const v = String(r[field] ?? '');
      return v >= String(start) && v <= `${end}~`; // '~' > any date char: inclusive end-day
    });
  }

  // 2. Grouping keys: each selected dimension (time dims bucketed).
  const dimensions = query.dimensions ?? [];
  const timezone = query.timezone; // ADR-0053 Phase 2: reference tz for bucketing
  const granByDim = new Map(timeDims.filter((t) => t.granularity).map((t) => [t.dimension, t.granularity!]));
  const keyOf = (r: Row): { key: string; values: Row } => {
    const values: Row = {};
    for (const name of dimensions) {
      const dim = cube.dimensions?.[name];
      const field = String(dim?.sql ?? name);
      const raw = r[field];
      const gran = granByDim.get(name) ?? (dim?.type === 'time' && dim.granularities?.length === 1 ? String(dim.granularities[0]) : undefined);
      values[name] = gran ? bucketDate(raw, gran, timezone) : (raw ?? null);
    }
    return { key: JSON.stringify(values), values };
  };

  const groups = new Map<string, { values: Row; rows: Row[] }>();
  for (const r of filtered) {
    const { key, values } = keyOf(r);
    const g = groups.get(key) ?? { values, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  // No dimensions → a single overall group (even over zero rows: count = 0).
  if (dimensions.length === 0 && groups.size === 0) {
    groups.set('{}', { values: {}, rows: [] });
  }

  // 3. Aggregate each measure per group.
  const out: Row[] = [];
  for (const g of groups.values()) {
    const row: Row = { ...g.values };
    for (const m of query.measures) {
      const metric = cube.measures?.[m];
      row[m] = aggregate(g.rows, String(metric?.type ?? 'count'), String(metric?.sql ?? '*'));
    }
    out.push(row);
  }

  // 4. Order + paging.
  for (const [col, dir] of Object.entries(query.order ?? {}).reverse()) {
    out.sort((a, b) => (dir === 'desc' ? -1 : 1) * compare(a[col], b[col]));
  }
  const offset = query.offset ?? 0;
  const limited = out.slice(offset, query.limit != null ? offset + query.limit : undefined);

  return {
    rows: limited,
    fields: [
      ...dimensions.map((d) => ({ name: d, type: 'string' })),
      ...query.measures.map((m) => ({ name: m, type: 'number' })),
    ],
  };
}
