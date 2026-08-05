// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5322] Empty combinators reduce to their boolean identities in the
 * analytics filter normalizer — `{$and: []}` = TRUE, `{$or: []}` = FALSE —
 * matching the five `FILTER_LOGIC_CASES` backends row for row. Together with
 * the `{}` / `{$not: {}}` identities #5325 already gave this module, the
 * boolean algebra over the combinators is now complete.
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
 * Non-array `$and`/`$or` still throws (this file), as do non-object branches
 * and non-object `$not` operands (pinned in
 * `filter-normalizer-not-null-safe.test.ts`): reduction makes `null` ("no
 * constraint") a meaningful verdict, so silently mapping junk to it would let
 * a malformed disjunct ABSORB its `$or` and widen the query — the exact
 * failure mode the old error message feared, reachable only through the
 * lenient path.
 *
 * Row-level conformance for the four ruled shapes lives in the shared table
 * (`filter-logic-conformance.ts`), executed against a real SQLite engine by
 * `native-sql-filter-logic-conformance.test.ts` and
 * `read-scope-sql-conformance.test.ts`. This file pins the TREE the
 * normalizer produces and the seam where the ObjectQL engine path receives
 * the boolean constant.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';

import {
  normalizeAnalyticsFilterTree,
  collectFilterLeaves,
} from '../strategies/filter-normalizer.js';
import { AnalyticsService } from '../analytics-service.js';

const tree = (where: unknown) => normalizeAnalyticsFilterTree({ where });

const FALSE_NODE = { kind: 'const', value: false };
const TRUE_NODE = { kind: 'const', value: true };

describe('[#5322] buildNode reduces empty combinators to boolean identities', () => {
  it('`{$and: []}` is TRUE — no constraint', () => {
    expect(tree({ $and: [] })).toBeNull();
  });

  it('`{$or: []}` is FALSE — the zero-row constant', () => {
    expect(tree({ $or: [] })).toEqual(FALSE_NODE);
  });

  it('`$not` negates the REDUCED operand, in both directions', () => {
    expect(tree({ $not: { $and: [] } })).toEqual(FALSE_NODE); // NOT TRUE ≡ FALSE
    expect(tree({ $not: { $or: [] } })).toEqual(TRUE_NODE); //  NOT FALSE ≡ TRUE
  });

  it('an empty-combinator branch carries its identity into the enclosing combinator', () => {
    // A `{$and: []}` disjunct is TRUE and ABSORBS the whole `$or` — collapsing
    // to the surviving branches instead is the narrowing #5325 fixed for the
    // literal `{}` disjunct.
    expect(tree({ $or: [{ a: 'x' }, { $and: [] }] })).toBeNull();
    // A `{$or: []}` conjunct is FALSE; the compiled conjunction carries the
    // constant (row-set: zero rows — pinned via SQL in the conformance suite).
    expect(JSON.stringify(tree({ $and: [{ a: 'x' }, { $or: [] }] }))).toContain('"value":false');
    expect(JSON.stringify(tree({ a: 'x', $or: [] }))).toContain('"value":false');
  });

  it('the FALSE constant touches no member', () => {
    expect(collectFilterLeaves(tree({ $or: [] }))).toEqual([]);
    expect(collectFilterLeaves(tree({ $and: [{ $or: [] }] }))).toEqual([]);
  });

  it('non-array `$and`/`$or` still throws — #5322 loosened only the EMPTY array', () => {
    expect(() => tree({ $and: 'x' })).toThrow(/requires an array/);
    expect(() => tree({ $or: { a: 1 } })).toThrow(/requires an array/);
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
 * Stand-in for `engine.aggregate`, mirroring how a driver receives the
 * filter: `{$not: {}}` — the spelling `filterNodeToCondition` uses for the
 * FALSE constant, because `formula` and `driver-memory` already pin it as the
 * zero-row filter (#5134) — matches nothing, and an absent/empty filter
 * matches everything.
 */
function makeEngine(captured: Array<{ filter?: Record<string, unknown> }>) {
  const matches = (row: Record<string, unknown>, cond: Record<string, unknown>): boolean =>
    Object.entries(cond).every(([key, value]) => {
      if (key === '$and') return (value as Record<string, unknown>[]).every((c) => matches(row, c));
      if (key === '$or') return (value as Record<string, unknown>[]).some((c) => matches(row, c));
      if (key === '$not') return !matches(row, value as Record<string, unknown>);
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
  it('`{$or: []}` arrives as the zero-row `{$not: {}}` and counts zero rows', async () => {
    const captured: Array<{ filter?: Record<string, unknown> }> = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: makeEngine(captured),
    });

    const result = await svc.queryDataset!(dataset, {
      measures: ['incident_count'],
      runtimeFilter: { $or: [] },
    });

    // The constant reached the engine as a real zero-row condition — NOT as an
    // absent filter, which every driver reads as "every row".
    expect(captured).toHaveLength(1);
    expect(JSON.stringify(captured[0].filter)).toContain('"$not":{}');
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

  it('a `{$and: []}` disjunct absorbs its `$or` instead of narrowing to the other branch', async () => {
    const captured: Array<{ filter?: Record<string, unknown> }> = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: makeEngine(captured),
    });

    const result = await svc.queryDataset!(dataset, {
      measures: ['incident_count'],
      runtimeFilter: { $or: [{ severity: 'high' }, { $and: [] }] },
    });

    // Narrowing to `severity = high` would count 2 — the #5297/#5325 seam.
    expect(JSON.stringify(captured[0].filter ?? {})).not.toContain('severity');
    expect(result.rows).toEqual([{ incident_count: 3 }]);
  });
});
