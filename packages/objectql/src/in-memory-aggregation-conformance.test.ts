// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6401] Aggregate-vocabulary conformance for the IN-MEMORY fallback — the
 * same `@objectstack/spec/data` cases the three SQL faces run.
 *
 * ## Why this face is enrolled, when #6409 deliberately left it out
 *
 * #6409 built the table for the two faces of ONE driver (`driver-sql`'s local
 * compiler and `driver-turso`'s remote one, chosen from a connection string)
 * and recorded enrolling this one as open question ②: it is not a SQL face and
 * not a driver, so it looked like it needed the engine to reach.
 *
 * #6401 is what makes it necessary rather than optional. `GroupByNode.alias`
 * was declared by the spec, honoured HERE (`g.alias ?? g.field`, the projection
 * at the top of `in-memory-aggregation.ts`) and ignored by all three SQL faces,
 * so one aggregate came back keyed `region` under pushdown and `bucket` under
 * the fallback — and which one you got was decided by a driver capability bit
 * and a `timezone`, neither of which the caller can see
 * (`engine.ts`'s `allStructuredSupported && !tzRequiresInMemory` fork). The SQL
 * faces were converged ONTO this one, so pinning the new behaviour without this
 * face in the comparison would pin it against nothing.
 *
 * It also turned out to be cheap, which is the part of question ② that was
 * wrong: `applyInMemoryAggregation` is a pure function of rows and an AST. No
 * engine, no driver, no database — the fixture goes in as an array.
 *
 * ## What this suite is NOT
 *
 * It is not a check that the engine CHOOSES this path — that fork is
 * `engine.ts`'s and is pinned by its own suites. This asserts only that when
 * the fallback runs, it answers the shared table: same values, same keys, as
 * the faces it can be swapped for behind the caller's back.
 *
 * ## Reverse verification — directions predicted BEFORE they were run
 *
 * **(A) `g.alias ?? g.field` reverted to `g.field`** — i.e. this face made to
 * behave the way the SQL three did before #6401. Predicted: exactly the two
 * `groupByAlias` cases move, and only ONE of them fails —
 * 'groupBy alias renames the projected group column' goes red with
 * `group: 'undefined'` (the row is keyed `region`, the harness reads `bucket`,
 * `String(undefined)`), while 'groupBy alias equal to the field name is a
 * no-op' stays GREEN, because `alias === field` makes the revert invisible.
 * Every non-alias case unaffected.
 *
 * **(B) the harness reading `c.groupBy` instead of `c.groupByAlias ?? c.groupBy`**
 * — the copied-neighbour mistake, and the one that matters most here because it
 * is the mistake that makes the whole axis vacuous. Predicted: ALL cases pass,
 * including both alias cases, on an unmodified face — the failure mode being
 * demonstrated is a false GREEN, not a red.
 *
 * ## Measured, after writing the above
 *
 * **(A) 0 failed / 17 passed here** — this face is not the one reverted, so
 * this suite was correctly unmoved. The revert was applied to the three SQL
 * faces and measured there: `driver-sql` 1 failed / 17 passed, `driver-turso`
 * 3 / 31, `driver-sqlite-wasm` 1 / 14 — each on exactly the case named above,
 * with the degenerate `alias === field` case green throughout, as predicted.
 *
 * **(B) PREDICTION WRONG, and the correction is the useful part.** Measured
 * 1 FAILED / 16 passed here (and 1 / 17 on `driver-sql`), not the all-green
 * false GREEN predicted. Reading the FIELD name against a face that HONOURS the
 * alias fails loudly: the row is keyed `bucket`, `r['region']` is `undefined`,
 * and the case dies on `group: 'undefined'`. The false green needs BOTH
 * mistakes at once — the harness reading the field name AND a face that ignores
 * the alias — which was then measured directly and is 18/18 GREEN on
 * `driver-sql`. So the `groupByAlias ?? groupBy` read is load-bearing exactly
 * where the prediction said, but for the opposite reason: it is not a silent
 * no-op on a correct face, it is one half of a pair that only goes quiet
 * together.
 *
 * A second unpredicted result, recorded rather than tidied away:
 * `driver-sqlite-wasm`'s suite consumes `@objectstack/driver-sql`'s BUILT
 * `dist`, not its `src`, so direction (A) showed a spurious 15/15 green there
 * until `driver-sql` was rebuilt. That suite checks its inheritance of the
 * compiler at BUILD granularity, not working-tree granularity.
 */

import { describe, it, expect } from 'vitest';
import { AGGREGATION_CASES, AGGREGATION_ROWS } from '@objectstack/spec/data';
import type { AggregationCase, QueryAST } from '@objectstack/spec/data';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';

/**
 * The case as the `Pick<QueryAST, 'groupBy' | 'aggregations'>` this function
 * takes. Deliberately the same construction the three SQL suites use, down to
 * the harness's own `alias: 'n'` on the aggregation — the point of the shared
 * table is that the faces are fed the same thing.
 */
const astFor = (c: AggregationCase): Pick<QueryAST, 'groupBy' | 'aggregations'> => ({
  aggregations: [{ function: c.function, ...(c.field ? { field: c.field } : {}), alias: 'n' }],
  ...(c.groupBy
    ? { groupBy: [c.groupByAlias ? { field: c.groupBy, alias: c.groupByAlias } : c.groupBy] }
    : {}),
});

const actualFor = (c: AggregationCase, rows: Array<Record<string, unknown>>) => {
  const groupKey = c.groupByAlias ?? c.groupBy;
  return rows
    .map((r) => ({ group: groupKey ? String(r[groupKey]) : null, value: Number(r.n) }))
    .sort((x, y) => String(x.group).localeCompare(String(y.group)));
};

describe('[#6401] in-memory aggregation — aggregate vocabulary conformance', () => {
  /**
   * The fixture is passed through as-is, so the seeding failure the SQL
   * harnesses guard against (a null stored as `''`) cannot happen here. What
   * CAN happen is the table changing shape underneath this face, so the two
   * properties every case leans on are asserted directly rather than assumed.
   */
  it('the fixture is six rows with two real nulls in `stage`', () => {
    expect(AGGREGATION_ROWS).toHaveLength(6);
    expect(AGGREGATION_ROWS.filter((r) => r.stage === null)).toHaveLength(2);
  });

  for (const c of AGGREGATION_CASES) {
    it(c.name, () => {
      const rows = applyInMemoryAggregation([...AGGREGATION_ROWS], astFor(c));
      expect(actualFor(c, rows as any[]), c.note).toEqual([...c.expected]);
    });
  }

  /**
   * The alias cases above compare VALUES under a key. This asserts the key set
   * itself — that the group column arrives under the alias and NOT ALSO under
   * the field name. A face that emitted both would pass every case above (the
   * harness only reads one of them) while handing callers a row shape that
   * differs from the SQL faces', which is the same class of quiet divergence
   * this whole table exists to catch.
   */
  it('an aliased group projects under the alias ONLY — the field name is not also emitted', () => {
    const rows = applyInMemoryAggregation([...AGGREGATION_ROWS], {
      groupBy: [{ field: 'region', alias: 'bucket' }],
      aggregations: [{ function: 'count', alias: 'n' }],
    } as any);
    expect(rows).toHaveLength(2);
    for (const r of rows as any[]) {
      expect(Object.keys(r).sort()).toEqual(['bucket', 'n']);
    }
    expect((rows as any[]).map((r) => r.bucket).sort()).toEqual(['east', 'west']);
  });

  /**
   * The `having`口径 the issue predicted would follow: `applyHaving` judges the
   * AGGREGATED row's own columns — aggregation aliases plus groupBy
   * projections — so once the projection is named by the alias, a `having` that
   * references the group column must reference the ALIAS on every face. Pinned
   * here because this is the face where that was already true, and it is now
   * the shared answer rather than one half of a divergence.
   */
  it('the projected group column is the name `having` sees', () => {
    const rows = applyInMemoryAggregation([...AGGREGATION_ROWS], {
      groupBy: [{ field: 'region', alias: 'bucket' }],
      aggregations: [{ function: 'count', alias: 'n' }],
    } as any);
    // Every key a post-aggregation filter could legitimately name.
    const columns = new Set(Object.keys((rows as any[])[0]));
    expect(columns.has('bucket')).toBe(true);
    expect(columns.has('region')).toBe(false);
  });
});
