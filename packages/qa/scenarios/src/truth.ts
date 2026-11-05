// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Truth evaluation — computes a question's answer from its declarative spec
 * over the card's seed rows.
 *
 * A question whose answer is not well-defined is REFUSED, not approximated:
 * an average over zero rows, a numeric aggregate over a text value, or a
 * ranking whose cut-off falls inside a tie. Each of those would hand a scorer
 * a "truth" that the seed does not actually determine, so a correct agent
 * could be graded wrong.
 */

import type { Filter, Measure, Scalar, SeedRow, TruthSpec } from './schema.js';

export type TruthKey = string | number | boolean | null;

export interface TruthEntry {
  key: TruthKey;
  value: number;
}

export type Truth =
  | { kind: 'scalar'; value: number }
  | { kind: 'groups'; groups: TruthEntry[] }
  | { kind: 'ranking'; rows: TruthEntry[] };

/** A refusal raised while evaluating; `path` is relative to the truth spec. */
export class TruthError extends Error {
  constructor(
    readonly path: ReadonlyArray<string | number>,
    message: string,
  ) {
    super(message);
    this.name = 'TruthError';
  }
}

function cell(row: SeedRow, field: string): Scalar {
  const v = row[field];
  return v === undefined ? null : v;
}

function matches(row: SeedRow, f: Filter, index: number): boolean {
  const v = cell(row, f.field);
  switch (f.op) {
    case 'eq':
      return v === f.value;
    case 'ne':
      return v !== f.value;
    case 'in':
      return (f.value as Scalar[]).includes(v);
    default: {
      if (v === null) return false;
      const target = f.value as number | string;
      if (typeof v !== typeof target) {
        throw new TruthError(
          ['filter', index, 'value'],
          `\`${f.op}\` compares a ${typeof target} with row \`${row.id}\`'s ${f.field} = ${JSON.stringify(v)} (${typeof v})`,
        );
      }
      const a = v as number | string;
      if (f.op === 'gt') return a > target;
      if (f.op === 'gte') return a >= target;
      if (f.op === 'lt') return a < target;
      return a <= target;
    }
  }
}

function numbersOf(rows: readonly SeedRow[], field: string, path: ReadonlyArray<string | number>): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = cell(row, field);
    if (v === null) continue;
    if (typeof v !== 'number') {
      throw new TruthError(path, `row \`${row.id}\`'s ${field} = ${JSON.stringify(v)} is not a number`);
    }
    out.push(v);
  }
  return out;
}

function measure(
  rows: readonly SeedRow[],
  m: Measure,
  path: ReadonlyArray<string | number>,
  what: string,
): number {
  if (m.kind === 'count') return rows.length;
  const values = numbersOf(rows, m.field, [...path, 'field']);
  if (m.kind === 'sum') return values.reduce((a, b) => a + b, 0);
  if (values.length === 0) {
    throw new TruthError(path, `${m.kind} of ${m.field} over ${what} has no numeric value, so it is undefined`);
  }
  if (m.kind === 'avg') return values.reduce((a, b) => a + b, 0) / values.length;
  if (m.kind === 'min') return Math.min(...values);
  return Math.max(...values);
}

function keyText(k: TruthKey): string {
  return k === null ? '' : `${typeof k}:${String(k)}`;
}

// Deterministic: null first, then by type name, numbers numerically, the rest
// by their text.
function byKey(a: TruthEntry, b: TruthEntry): number {
  if (typeof a.key === 'number' && typeof b.key === 'number') return a.key - b.key;
  const x = keyText(a.key);
  const y = keyText(b.key);
  return x < y ? -1 : x > y ? 1 : 0;
}

function byValue(order: 'asc' | 'desc') {
  return (a: TruthEntry, b: TruthEntry): number =>
    (order === 'asc' ? a.value - b.value : b.value - a.value) || byKey(a, b);
}

function group(rows: readonly SeedRow[], field: string): Map<TruthKey, SeedRow[]> {
  const groups = new Map<TruthKey, SeedRow[]>();
  for (const row of rows) {
    const k = cell(row, field);
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

function topN(entries: TruthEntry[], n: number, order: 'asc' | 'desc', what: string): TruthEntry[] {
  if (entries.length < n) {
    throw new TruthError(['n'], `asks for the top ${n} but only ${entries.length} ${what} exist`);
  }
  const sorted = [...entries].sort(byValue(order));
  if (sorted.length > n && sorted[n - 1].value === sorted[n].value) {
    throw new TruthError(
      ['n'],
      `the cut-off falls inside a tie (${JSON.stringify(sorted[n - 1].key)} and ${JSON.stringify(sorted[n].key)} both = ${sorted[n].value}), so the top ${n} is not determined by the seed`,
    );
  }
  return sorted.slice(0, n);
}

/**
 * Evaluate one truth spec over the rows of the question's object.
 * Groups come from the rows: a key no row carries does not appear.
 */
export function evaluateTruth(spec: TruthSpec, rows: readonly SeedRow[]): Truth {
  const filtered = rows.filter((row) => (spec.filter ?? []).every((f, i) => matches(row, f, i)));

  if (spec.kind === 'topN') {
    if (spec.groupBy !== undefined) {
      const m = spec.measure as Measure;
      const entries = [...group(filtered, spec.groupBy)].map(([key, members]) => ({
        key,
        value: measure(members, m, ['measure'], `group ${JSON.stringify(key)}`),
      }));
      return { kind: 'ranking', rows: topN(entries, spec.n, spec.order, 'groups') };
    }
    const field = spec.field as string;
    const entries: TruthEntry[] = [];
    for (const row of filtered) {
      const v = cell(row, field);
      if (v === null) continue;
      if (typeof v !== 'number') {
        throw new TruthError(['field'], `row \`${row.id}\`'s ${field} = ${JSON.stringify(v)} is not a number`);
      }
      entries.push({ key: row.id, value: v });
    }
    return { kind: 'ranking', rows: topN(entries, spec.n, spec.order, 'rows with a value') };
  }

  const m: Measure = spec.kind === 'count' ? { kind: 'count' } : { kind: spec.kind, field: spec.field };

  if (spec.groupBy === undefined) {
    if (spec.order !== undefined) {
      throw new TruthError(['order'], '`order` sorts groups and needs a `groupBy`');
    }
    return { kind: 'scalar', value: measure(filtered, m, [], 'the filtered rows') };
  }

  const groups = [...group(filtered, spec.groupBy)].map(([key, members]) => ({
    key,
    value: measure(members, m, [], `group ${JSON.stringify(key)}`),
  }));
  if (groups.length === 0) {
    throw new TruthError(['filter'], 'the filter matches no rows, so there is no group to report');
  }
  groups.sort(spec.order === undefined ? byKey : byValue(spec.order));
  return { kind: 'groups', groups };
}
