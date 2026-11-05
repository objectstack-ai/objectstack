// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/** The truth evaluator's semantics, on rows built here. */

import { describe, expect, it } from 'vitest';

import { evaluateTruth, TruthError, windowRange, type SeedRow, type TruthSpec } from '../src/index.js';

const rows: SeedRow[] = [
  { id: 'r1', team: 'a', size: 10, day: '2026-01-05', rank: 3 },
  { id: 'r2', team: 'b', size: 4, day: '2026-02-10', rank: 10 },
  { id: 'r3', team: 'a', size: 6, day: '2026-03-01', rank: 2 },
  { id: 'r4', team: null, size: null, day: '2026-03-20', rank: 1 },
];

const run = (spec: TruthSpec) => evaluateTruth(spec, rows);

function refusal(spec: TruthSpec): TruthError {
  try {
    run(spec);
  } catch (e) {
    if (e instanceof TruthError) return e;
    throw e;
  }
  throw new Error('expected a TruthError');
}

describe('evaluateTruth', () => {
  it('skips null values in a numeric aggregate and counts every row', () => {
    expect(run({ kind: 'sum', field: 'size' })).toEqual({ kind: 'scalar', value: 20 });
    expect(run({ kind: 'avg', field: 'size' })).toEqual({ kind: 'scalar', value: 20 / 3 });
    expect(run({ kind: 'count' })).toEqual({ kind: 'scalar', value: 4 });
  });

  it('a sum over zero rows is 0, a min over zero rows is refused', () => {
    const none = [{ field: 'team', op: 'eq' as const, value: 'zzz' }];
    expect(run({ kind: 'sum', field: 'size', filter: none })).toEqual({ kind: 'scalar', value: 0 });
    expect(refusal({ kind: 'min', field: 'size', filter: none }).path).toEqual([]);
  });

  it('compares strings lexically (ISO dates) and refuses a mixed comparison', () => {
    expect(run({ kind: 'count', filter: [{ field: 'day', op: 'gte', value: '2026-02-01' }] })).toEqual({
      kind: 'scalar',
      value: 3,
    });
    expect(refusal({ kind: 'count', filter: [{ field: 'day', op: 'gt', value: 5 }] }).path).toEqual([
      'filter',
      0,
      'value',
    ]);
  });

  it('matches `in` and `eq null`', () => {
    expect(run({ kind: 'count', filter: [{ field: 'team', op: 'in', value: ['b', null] }] })).toEqual({
      kind: 'scalar',
      value: 2,
    });
    expect(run({ kind: 'count', filter: [{ field: 'team', op: 'eq', value: null }] })).toEqual({
      kind: 'scalar',
      value: 1,
    });
  });

  it('sorts groups by key (null first) unless `order` sorts by value', () => {
    expect(run({ kind: 'count', groupBy: 'team' })).toEqual({
      kind: 'groups',
      groups: [
        { key: null, value: 1 },
        { key: 'a', value: 2 },
        { key: 'b', value: 1 },
      ],
    });
    expect(run({ kind: 'count', groupBy: 'rank', order: 'asc' })).toEqual({
      kind: 'groups',
      // equal values fall back to the key, and numeric keys sort numerically
      groups: [
        { key: 1, value: 1 },
        { key: 2, value: 1 },
        { key: 3, value: 1 },
        { key: 10, value: 1 },
      ],
    });
  });

  it('refuses `order` without a `groupBy`', () => {
    expect(refusal({ kind: 'count', order: 'desc' }).path).toEqual(['order']);
  });

  it('ranks rows by a field, ascending or descending', () => {
    expect(run({ kind: 'topN', n: 2, order: 'asc', field: 'size' })).toEqual({
      kind: 'ranking',
      rows: [
        { key: 'r2', value: 4 },
        { key: 'r3', value: 6 },
      ],
    });
  });

  it('refuses a topN asking for more entries than exist', () => {
    expect(refusal({ kind: 'topN', n: 4, order: 'desc', field: 'size' }).message).toMatch(/only 3/);
  });
  it('answers unanswerable without reading a row', () => {
    expect(evaluateTruth({ kind: 'unanswerable', reason: 'not seeded' }, [])).toEqual({ kind: 'unanswerable' });
  });

  it('filters and groups through the context resolver (relation paths)', () => {
    const resolve = (row: SeedRow, path: string) => (path === 'team.lead' ? (row.team === 'a' ? 'ana' : null) : (row[path] ?? null));
    expect(evaluateTruth({ kind: 'count', groupBy: 'team.lead' }, rows, { resolve })).toEqual({
      kind: 'groups',
      groups: [
        { key: null, value: 2 },
        { key: 'ana', value: 2 },
      ],
    });
  });

  it('computes windows against asOf, inclusive, across month and year edges', () => {
    expect(windowRange({ kind: 'last_days', days: 7 }, '2026-03-02')).toEqual(['2026-02-24', '2026-03-02']);
    expect(windowRange({ kind: 'calendar', period: 'this_month' }, '2024-02-10')).toEqual(['2024-02-01', '2024-02-29']);
    expect(windowRange({ kind: 'calendar', period: 'previous_month' }, '2026-01-15')).toEqual(['2025-12-01', '2025-12-31']);
    expect(windowRange({ kind: 'calendar', period: 'previous_year' }, '2026-01-15')).toEqual(['2025-01-01', '2025-12-31']);
    const inMarch = { kind: 'count' as const, filter: [{ field: 'day', op: 'in_window' as const, value: { kind: 'calendar' as const, period: 'this_month' as const } }] };
    expect(evaluateTruth(inMarch, rows, { asOf: '2026-03-31' })).toEqual({ kind: 'scalar', value: 2 });
  });
});
