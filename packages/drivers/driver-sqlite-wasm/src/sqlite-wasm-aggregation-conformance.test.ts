// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6409] Aggregate-vocabulary conformance for the wasm driver — the shared
 * `@objectstack/spec/data` cases, run through this driver's own pipeline.
 *
 * `SqliteWasmDriver extends SqlDriver`, so the `count(distinct x)` lowering is
 * inherited and nothing here re-implements it. What this pins is the other
 * half, the same half its filter-logic, temporal and pagination suites pin: the
 * compiled statement has to survive a different **engine**. This driver swaps
 * knex's transport for a custom sql.js dialect (`Client_WasmSqlite`) that
 * compiles the statement, binds its parameters and marshals the rows back
 * through its own path.
 *
 * That last step is why this cell is not a formality. The other five aggregates
 * come back as a plain scalar; `COUNT(DISTINCT …)` does too, but it is the one
 * whose column expression carries a KEYWORD the dialect has to pass through
 * untouched, and it is the one whose wrong answers are all valid numbers. A
 * dialect that mangled the expression, or that marshalled the count back
 * through a different type path, would fail here and in no other suite.
 *
 * "It inherits the compiler, therefore it is fine" is the assumption these
 * suites exist to disprove — the judgement #4405 recorded for this driver's
 * filter-logic cell, applied to the aggregate column.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AGGREGATION_CASES, AGGREGATION_ROWS } from '@objectstack/spec/data';
import type { AggregationCase, QueryAST } from '@objectstack/spec/data';
import { SqliteWasmDriver } from './index.js';

const OBJECT = 'conformance_agg';

const astFor = (c: AggregationCase): QueryAST => ({
  object: OBJECT,
  aggregations: [{ function: c.function, ...(c.field ? { field: c.field } : {}), alias: 'n' }],
  // [#6401] A case carrying `groupByAlias` is sent as the STRUCTURED node, so
  // what the face receives is the union member that declares `alias`. Without
  // this the alias cases would send a bare string and pin nothing.
  ...(c.groupBy
    ? { groupBy: [c.groupByAlias ? { field: c.groupBy, alias: c.groupByAlias } : c.groupBy] }
    : {}),
});

const actualFor = (c: AggregationCase, rows: Array<Record<string, unknown>>) => {
  // [#6401] The group value is read from the column the case SAYS it lands in —
  // `groupByAlias ?? groupBy`. Reading `c.groupBy` unconditionally is the bug
  // this axis exists to catch: it is green on a face that ignores the alias.
  const groupKey = c.groupByAlias ?? c.groupBy;
  return rows
    .map((r) => ({ group: groupKey ? String(r[groupKey]) : null, value: Number(r.n) }))
    .sort((x, y) => String(x.group).localeCompare(String(y.group)));
};

describe('[#6409] driver-sqlite-wasm — aggregate vocabulary conformance', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: OBJECT,
        fields: {
          region: { type: 'string' },
          // Nullable — the DDL this driver generates leaves a plain string
          // column nullable, which is what the null-bearing rows need.
          stage: { type: 'string' },
          score: { type: 'number' },
        },
      },
    ]);
    for (const row of AGGREGATION_ROWS) {
      await driver.create(OBJECT, { ...row }, { bypassTenantAudit: true } as any);
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it('the fixture is all six rows, with the nulls stored AS nulls', async () => {
    const rows = await driver.find(OBJECT, { orderBy: [{ field: 'id', order: 'asc' }] });
    expect(rows).toHaveLength(6);
    expect((rows as any[]).filter((r) => r.stage === null)).toHaveLength(2);
  });

  for (const c of AGGREGATION_CASES) {
    it(c.name, async () => {
      const rows = await driver.aggregate(OBJECT, astFor(c));
      expect(actualFor(c, rows as any[]), c.note).toEqual([...c.expected]);
    });
  }
});
