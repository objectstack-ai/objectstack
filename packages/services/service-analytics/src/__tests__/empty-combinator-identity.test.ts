// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5322] Empty combinators reduce to their boolean identities in the
 * analytics filter normalizer — `{$and: []}` = TRUE, `{$or: []}` = FALSE, a
 * `{}` branch is a TRUE disjunct that absorbs its `$or`, `{$not: {}}` = FALSE
 * — matching the five `FILTER_LOGIC_CASES` backends row for row.
 *
 * # The history this file flips
 *
 * Until the 2026-08-04 #5322 ruling, `buildNode` REFUSED the empty arrays.
 * Its error message argued the opposite position, verbatim:
 *
 * > `"$and" requires a non-empty array. An empty combinator has no defensible
 * > reading — dropping it widens the query, and treating it as "match
 * > nothing" silently empties a chart.`
 *
 * "Treating it as match nothing" is exactly what #5134 ruled for `$or: []`
 * and what `driver-sql` / `driver-memory` / `formula` / `driver-sqlite-wasm`
 * / `driver-mongodb` (#5239) implement. The ruling took the reduction because
 * only a reduction can evaluate a NESTED tree (a rejection must first reduce
 * to decide whether `$and: []` inside a `$or` branch is an error — which
 * concedes the point), and because `{$or: []}` = zero rows is fail-closed
 * where it matters: a scope whose disjunct list loops to zero items hides
 * every row rather than widening to the whole table. The loud authoring-time
 * rejection of the literal spellings lives on as #5330 (publish/lint), not as
 * runtime behavior.
 *
 * # What deliberately did NOT loosen
 *
 * Non-array `$and`/`$or`, non-object branches, and non-object `$not`
 * operands still throw. Reduction makes `null` ("no constraint") a
 * meaningful verdict, so silently mapping junk to it would let a malformed
 * disjunct ABSORB its `$or` and widen the query — the exact failure mode the
 * old error message feared, reachable only through the lenient path.
 *
 * Row-level conformance for the four shapes lives in the shared table
 * (`filter-logic-conformance.ts`), which `native-sql-filter-logic-
 * conformance.test.ts` and `read-scope-sql-conformance.test.ts` execute
 * against a real SQLite engine. This file pins the TREE the normalizer
 * produces and the seam where the ObjectQL engine path receives the FALSE
 * constant.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';

import {
  normalizeAnalyticsFilterTree,
  collectFilterLeaves,
} from '../strategies/filter-normalizer.js';
import { AnalyticsService } from '../analytics-service.js';

const tree = (where: unknown) => normalizeAnalyticsFilterTree({ where });

describe('[#5322] buildNode reduces empty combinators to boolean identities', () => {
  it('`{$and: []}` is TRUE — no constraint', () => {
    expect(tree({ $and: [] })).toBeNull();
  });

  it('`{$or: []}` is FALSE — the zero-row constant', () => {
    expect(tree({ $or: [] })).toEqual({ kind: 'false' });
  });

  it('a `{}` branch is a TRUE disjunct and absorbs its `$or`', () => {
    // Collapsing to the surviving branches instead would narrow the filter to
    // `a = x` — the #5297 seam, in the normalizer.
    expect(tree({ $or: [{ a: 'x' }, {}] })).toBeNull();
    expect(tree({ $or: [{}, { a: 'x' }] })).toBeNull();
  });

  it('`{$not: {}}` is FALSE — NOT TRUE', () => {
    expect(tree({ $not: {} })).toEqual({ kind: 'false' });
  });

  it('the whole tree reduces: constants never survive below the root', () => {
    // A FALSE conjunct falsifies its $and…
    expect(tree({ $and: [{ a: 'x' }, { $or: [] }] })).toEqual({ kind: 'false' });
    // …and with it the sibling keys of the node that carries it.
    expect(tree({ a: 'x', $or: [] })).toEqual({ kind: 'false' });
    // A FALSE disjunct drops out of its $or (the OR identity)…
    expect(tree({ $or: [{ $or: [] }, { a: 'x' }] })).toEqual({
      kind: 'leaf',
      member: 'a',
      operator: 'equals',
      values: ['x'],
    });
    // …and a $or with nothing left is FALSE.
    expect(tree({ $or: [{ $or: [] }] })).toEqual({ kind: 'false' });
    // $not negates the REDUCED operand, in both directions.
    expect(tree({ $not: { $or: [] } })).toBeNull(); //           NOT FALSE ≡ TRUE
    expect(tree({ $not: { $and: [] } })).toEqual({ kind: 'false' }); // NOT TRUE ≡ FALSE
    expect(tree({ $not: { $not: {} } })).toBeNull(); //          NOT (NOT TRUE) ≡ TRUE
    // Two levels down, the identity still folds away cleanly.
    expect(tree({ $or: [{ b: 'y' }, { $and: [{ a: 'x' }, { $or: [] }] }] })).toEqual({
      kind: 'leaf',
      member: 'b',
      operator: 'equals',
      values: ['y'],
    });
  });

  it('the FALSE constant touches no member', () => {
    expect(collectFilterLeaves(tree({ $or: [] }))).toEqual([]);
    expect(collectFilterLeaves(tree({ $not: {} }))).toEqual([]);
  });

  it('non-array `$and`/`$or` still throws — #5322 loosened only the EMPTY array', () => {
    expect(() => tree({ $and: 'x' })).toThrow(/requires an array/);
    expect(() => tree({ $or: { a: 1 } })).toThrow(/requires an array/);
  });

  it('a non-object branch throws instead of being dropped or read as TRUE', () => {
    // Dropped, it silently rewrites the combinator; read as TRUE, it absorbs
    // the $or and widens. Both are the loud-refusal class (#3948 / #5239).
    expect(() => tree({ $or: [{ a: 'x' }, 'junk'] })).toThrow(/branch must be a filter object/);
    expect(() => tree({ $or: [null] })).toThrow(/branch must be a filter object/);
    expect(() => tree({ $and: ['junk'] })).toThrow(/branch must be a filter object/);
    expect(() => tree({ $and: [['a', 'x']] })).toThrow(/branch must be a filter object/);
  });

  it('a non-object `$not` operand throws instead of vanishing', () => {
    expect(() => tree({ $not: null })).toThrow(/requires a filter object operand/);
    expect(() => tree({ $not: 'x' })).toThrow(/requires a filter object operand/);
    expect(() => tree({ $not: [] })).toThrow(/requires a filter object operand/);
  });
});

// ── The engine-path seam: FALSE reaches ObjectQL as a real zero-row filter ──

const dataset = DatasetSchema.parse({
  name: 'incidents',
  label: 'Incidents',
  object: 'incident',
  dimensions: [{ name: 'severity', field: 'severity', type: 'string' }],
  measures: [{ name: 'incident_count', aggregate: 'count' }],
});

const ROWS: Array<{ severity: string }> = [
  { severity: 'high' },
  { severity: 'high' },
  { severity: 'low' },
];

/**
 * Stand-in for `engine.aggregate`, mirroring how a driver receives the filter:
 * `{$or: []}` (at any conjunction depth) matches nothing — the #5134 identity
 * every driver implements — and an absent/empty filter matches everything.
 */
function makeEngine(captured: Array<{ filter?: Record<string, unknown> }>) {
  const matches = (row: Record<string, unknown>, cond: Record<string, unknown>): boolean =>
    Object.entries(cond).every(([key, value]) => {
      if (key === '$and') return (value as Record<string, unknown>[]).every((c) => matches(row, c));
      if (key === '$or') return (value as Record<string, unknown>[]).some((c) => matches(row, c));
      return row[key] === value;
    });
  return async (
    _object: string,
    options: { groupBy?: string[]; filter?: Record<string, unknown> },
  ): Promise<Array<Record<string, unknown>>> => {
    captured.push({ filter: options.filter });
    const filtered = ROWS.filter((row) => matches(row, options.filter ?? {}));
    return [{ incident_count: filtered.length }];
  };
}

describe('[#5322] the ObjectQL path hands the engine the constant, not silence', () => {
  it('`{$or: []}` arrives as a real zero-row conjunct and counts zero rows', async () => {
    const captured: Array<{ filter?: Record<string, unknown> }> = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: makeEngine(captured),
    });

    const result = await svc.queryDataset!(dataset, {
      measures: ['incident_count'],
      runtimeFilter: { $or: [] },
    });

    // The constant reached the engine as the canonical `{$or: []}` spelling —
    // NOT as an absent filter, which every driver reads as "every row".
    expect(captured).toHaveLength(1);
    expect(JSON.stringify(captured[0].filter)).toContain('"$or":[]');
    expect(result.rows).toEqual([{ incident_count: 0 }]);
  });

  it('`{$not: {}}` reduces to the same zero-row constant', async () => {
    const captured: Array<{ filter?: Record<string, unknown> }> = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: makeEngine(captured),
    });

    const result = await svc.queryDataset!(dataset, {
      measures: ['incident_count'],
      runtimeFilter: { $not: {} },
    });

    expect(JSON.stringify(captured[0].filter)).toContain('"$or":[]');
    expect(result.rows).toEqual([{ incident_count: 0 }]);
  });

  it('`{$and: []}` arrives as no constraint and counts every row', async () => {
    const captured: Array<{ filter?: Record<string, unknown> }> = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: makeEngine(captured),
    });

    const result = await svc.queryDataset!(dataset, {
      measures: ['incident_count'],
      runtimeFilter: { $and: [] },
    });

    expect(JSON.stringify(captured[0].filter ?? {})).not.toContain('$and');
    expect(result.rows).toEqual([{ incident_count: 3 }]);
  });

  it('a `{}` disjunct absorbs its `$or` instead of narrowing to the other branch', async () => {
    const captured: Array<{ filter?: Record<string, unknown> }> = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: makeEngine(captured),
    });

    const result = await svc.queryDataset!(dataset, {
      measures: ['incident_count'],
      runtimeFilter: { $or: [{ severity: 'high' }, {}] },
    });

    // Narrowing to `severity = high` would count 2 — the #5297 seam.
    expect(JSON.stringify(captured[0].filter ?? {})).not.toContain('severity');
    expect(result.rows).toEqual([{ incident_count: 3 }]);
  });
});
