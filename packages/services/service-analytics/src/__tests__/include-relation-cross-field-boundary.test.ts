// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15103] A cross-field comparand naming a column of an `include`d relation —
 * the boundary, measured on one dataset over a real engine.
 *
 * ## Why this is a pin and not a feature
 *
 * The #14104 ruling spelled its driving shape as
 * `completed_at <= due_date + duty.grace_days` — a RELATION path. #15103 was
 * ruled **A, gated on one measurement** (maintainer ruling 5548479553,
 * 2026-09-05): if the ADR-0071 join chain a dataset already compiles for its
 * `include`d relations can serve the `where` compilation of a `{ $field }`
 * comparand, SQL push-down accepts that spelling for `include`d relations; if
 * it cannot without inventing JOIN planning, fallback **B** — capability
 * unchanged, the ruling's example corrected to the same-table spelling, and
 * the boundary named. The measurement answered B; this file is its executable
 * form, so the sentence `query-syntax.mdx` states is re-read the day the
 * boundary moves.
 *
 * ## What was measured
 *
 * - The join chain lives in `NativeSQLStrategy` (`qualifyAndRegisterJoin`),
 *   where it already serves dimensions, measures AND filter MEMBERS. The first
 *   block drives a dimension and a `runtimeFilter` member on `duty.grace_days`
 *   through one `LEFT JOIN` over a real SQLite engine and reads real rows back.
 * - A `{ $field }` comparand never reaches that chain. `canHandle` DECLINES
 *   it (maintainer ruling 2026-08-12 Q1 = B, #7598) so that `driver-sql`
 *   enforces the four #5222 rulings with metadata only it holds; the driver
 *   compiles single-table statements — no join exists there, and nothing about
 *   the dataset's `include` reaches it (`executeAggregate` carries `groupBy`,
 *   `aggregations`, `filter`, `timezone`, `context` and nothing else). So the
 *   dotted comparand is refused `INVALID_FILTER` / 400 EVEN WHEN the relation
 *   is in `include` — the second block, bare arm and offset arm, with the
 *   native-SQL spy proving the chain was never consulted.
 * - The same-table spelling answers on the SQL path over the same fixture —
 *   the third block, the positive control. The memory half of the asymmetry
 *   (the evaluator WALKS `duty.grace_days` when the row carries the relation)
 *   is pinned where the evaluator lives:
 *   `packages/formula/src/matches-filter-field-reference-offset.test.ts`;
 *   this package does not depend on `@objectstack/formula`, deliberately.
 *
 * ## What landing A would need — none of it authorised by #15103
 *
 * A join synthesised inside the driver (JOIN planning, the ruling's fallback
 * trigger); a join descriptor threaded through `executeAggregate` → engine →
 * `DriverQuery` (the alias contract the 2026-08-06 and 2026-09-05 rulings both
 * exclude); or the `$field` compilation moved into `NativeSQLStrategy` behind
 * new `StrategyContext` hooks and a second implementation of the #5222
 * rulings (option A of the 2026-08-12 ruling, rejected there). A red here is
 * the signal that one of those landed and the docs owe a new sentence.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CROSS_FIELD_OFFSET_OBJECT_FIELDS,
  CROSS_FIELD_OFFSET_ROWS,
} from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AggregationNode, FilterCondition } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { AnalyticsService } from '../analytics-service.js';

const TASK = 'cross_field_task';
const DUTY = 'cross_field_duty';
const CTX = { tenantId: 'org_A' } as ExecutionContext;

/** The offset fixture's task, plus the `duty` lookup the ruling's shape walks. */
const TASK_FIELDS: Record<string, Record<string, unknown>> = {
  ...CROSS_FIELD_OFFSET_OBJECT_FIELDS,
  duty: { type: 'lookup', name: 'duty', reference: DUTY },
};
const DUTY_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  name: { type: 'text', name: 'name' },
  grace_days: { type: 'number', name: 'grace_days' },
  organization_id: { type: 'text', name: 'organization_id' },
};

/**
 * One duty per distinct grace value, so `duty.grace_days` and the task's own
 * `grace_days` name the SAME number for every row: the relation spelling and
 * the same-table spelling are one predicate over this fixture, and any
 * difference in their answers is the paths, never the data.
 */
const DUTIES: ReadonlyArray<{ id: string; name: string; grace_days: number | null; organization_id: string }> = [
  { id: 'duty_2', name: 'two days of grace', grace_days: 2, organization_id: 'o1' },
  { id: 'duty_0', name: 'no grace', grace_days: 0, organization_id: 'o1' },
  { id: 'duty_none', name: 'grace unset', grace_days: null, organization_id: 'o1' },
  { id: 'duty_m3', name: 'three days early', grace_days: -3, organization_id: 'o1' },
];
const dutyFor = (grace: number | null): string =>
  grace === null ? 'duty_none' : grace === 2 ? 'duty_2' : grace === 0 ? 'duty_0' : 'duty_m3';
const TASKS = CROSS_FIELD_OFFSET_ROWS.map((row) => ({ ...row, duty: dutyFor(row.grace_days) }));

const SAME_TABLE_ON_TIME: FilterCondition = {
  completed_on: { $lte: { $field: 'due_on', addDays: { $field: 'grace_days' } } },
};
const RELATION_OFFSET_ON_TIME: FilterCondition = {
  completed_on: { $lte: { $field: 'due_on', addDays: { $field: 'duty.grace_days' } } },
};
const RELATION_BARE: FilterCondition = {
  completed_on: { $lte: { $field: 'duty.grace_days' } },
};

/** The dataset: `duty` IS in `include`, and a dimension already reads through it. */
const DATASET = DatasetSchema.parse({
  name: 'task_health_by_duty',
  label: 'Task health by duty',
  object: TASK,
  include: ['duty'],
  dimensions: [
    { name: 'title', field: 'title', type: 'string' },
    { name: 'duty_grace', field: 'duty.grace_days', type: 'number' },
  ],
  measures: [
    { name: 'total', aggregate: 'count' },
    { name: 'done_on_time', aggregate: 'count', filter: SAME_TABLE_ON_TIME },
    { name: 'done_on_time_by_duty', aggregate: 'count', filter: RELATION_OFFSET_ON_TIME },
    { name: 'done_by_duty_bare', aggregate: 'count', filter: RELATION_BARE },
  ],
});

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const errorFrom = async (run: () => Promise<unknown>): Promise<WireBearingError> => {
  let returned: unknown;
  try {
    returned = await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error(`expected a refusal, but the analytics face returned ${JSON.stringify(returned)}`);
};

describe('[#15103] a cross-field comparand on an `include`d relation — the boundary, measured', () => {
  let driver: SqliteWasmDriver;
  let service: AnalyticsService;
  const rawSqlCalls: string[] = [];

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      { name: DUTY, fields: DUTY_FIELDS } as any,
      { name: TASK, fields: TASK_FIELDS } as any,
    ]);
    for (const duty of DUTIES) await driver.create(DUTY, { ...duty });
    for (const task of TASKS) await driver.create(TASK, { ...task });

    service = new AnalyticsService({
      debugSql: true,
      // BOTH paths available: native SQL wins `resolveStrategy` unless it
      // declines, so the spy on `executeRawSql` MEASURES the decline.
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      relationshipResolver: (object, rel) => (object === TASK && rel === 'duty' ? DUTY : undefined),
      executeRawSql: async (_object, sql, params) => {
        rawSqlCalls.push(sql);
        // NativeSQLStrategy emits `$n`; knex speaks `?` — the plugin's own
        // bridge does this translation (plugin.ts).
        const result = await driver.execute(sql.replace(/\$(\d+)/g, '?'), params as unknown[]);
        if (Array.isArray(result)) return result as Record<string, unknown>[];
        return ((result as { rows?: Record<string, unknown>[] } | null)?.rows ?? []);
      },
      executeAggregate: async (objectName, options) => {
        const query: DriverQuery = {
          where: options.filter as FilterCondition,
          groupBy: options.groupBy as DriverQuery['groupBy'],
          aggregations: options.aggregations?.map(({ field, method, alias }) => ({
            field,
            function: method as AggregationNode['function'],
            alias,
          })),
        };
        return (await driver.aggregate(objectName, query)) as Record<string, unknown>[];
      },
    });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  describe('the ADR-0071 chain serves a projection AND a filter member — on the native path', () => {
    it('a dimension and a runtimeFilter member on duty.grace_days compile to one LEFT JOIN over the real engine', async () => {
      rawSqlCalls.length = 0;
      const result = await service.queryDataset(
        DATASET,
        { dimensions: ['duty_grace'], measures: ['total'], runtimeFilter: { duty_grace: { $gte: 0 } } },
        CTX,
      );
      expect(rawSqlCalls, 'native SQL served it').toHaveLength(1);
      const sql = rawSqlCalls[0];
      expect(sql).toContain(`LEFT JOIN "${DUTY}" "duty" ON "${TASK}"."duty" = "duty"."id"`);
      // The WHERE reads the joined column — the chain participates in the
      // predicate for a MEMBER. This is the half the ruling called
      // "conceivable"; it is real, for members.
      expect(sql).toMatch(/WHERE .*"duty"\."grace_days" >= \$1/);
      // Grace 0 → row 3; grace 2 → rows 1, 2, 5, 6. NULL (4, 7) and -3 (8, 9)
      // fail `>= 0` — LEFT JOIN semantics keep the NULL-grace rows in the
      // table and the predicate then drops them, like any NULL comparison.
      const byGrace = new Map(result.rows.map((r) => [r.duty_grace === null ? null : Number(r.duty_grace), Number(r.total)]));
      expect(byGrace.get(0)).toBe(1);
      expect(byGrace.get(2)).toBe(4);
      expect(byGrace.has(-3)).toBe(false);
      expect(byGrace.has(null)).toBe(false);
    });
  });

  describe('the `$field` COMPARAND never reaches that chain — refused even with `duty` in `include`', () => {
    for (const [arm, measure, ref] of [
      ['offset', 'done_on_time_by_duty', 'duty.grace_days'],
      ['bare', 'done_by_duty_bare', 'duty.grace_days'],
    ] as const) {
      it(`${arm} arm → INVALID_FILTER / 400 naming the dotted path; native SQL declined, so no join was ever built`, async () => {
        rawSqlCalls.length = 0;
        const err = await errorFrom(() => service.queryDataset(DATASET, { measures: [measure] }, CTX));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(`"${ref}" is a dotted path`);
        expect(err.message).toContain('same-table column references only');
        // The chain was never consulted: the pass declined native SQL
        // (2026-08-12 ruling) and the driver, which has no chain, refused.
        expect(rawSqlCalls, 'NativeSQLStrategy did not decline').toEqual([]);
      });
    }
  });

  describe('positive control — the fixture and the road are live', () => {
    it('the same-table spelling answers on the SQL path: rows 2 and 3 are on time', async () => {
      rawSqlCalls.length = 0;
      const result = await service.queryDataset(DATASET, { measures: ['done_on_time'] }, CTX);
      expect(result.rows).toHaveLength(1);
      expect(Number(result.rows[0].done_on_time)).toBe(2);
      expect(rawSqlCalls, 'a cross-field pass is the engine path\'s').toEqual([]);
    });
  });
});
