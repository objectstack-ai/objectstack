// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14104] `{ $field, addDays }` — the whole-day offset on a field reference,
 * on the analytics face: the routing it needs, and the dataset shape the
 * ruling was made for.
 *
 * ## The routing question (read and measured, per the dispatch)
 *
 * `NativeSQLStrategy.canHandle` declines a cross-field comparison so a dataset
 * filter routes to the engine path, where `driver-sql` compiles it (maintainer
 * ruling 2026-08-12 Q1 = B, #7598). That decline is decided by
 * `isFieldReference` in `comparand-shape.ts`. Had it been key-count-strict, a
 * reference carrying `addDays` would have stopped being detected and been
 * bound as JSON on the native path — a silent wrong answer. It is not strict
 * (`typeof value.$field === 'string'`, extra keys ignored, mirroring
 * `driver-sql`'s `fieldReferenceOf`), so no pass-through fix was needed; the
 * first block pins that reading so it cannot narrow later.
 *
 * ## The dataset question — the ruling's driving shape
 *
 * `duly` needs "was this completed by its deadline, where the deadline is
 * `due_date` plus the grace held in another column" as a dataset MEASURE, so a
 * dashboard can bind the on-time rate by name. The second block drives exactly
 * that through `queryDataset`: a count measure whose `filter` carries the
 * offset reference, a `late` count, and a derived on-time ratio, over the
 * shared offset fixture seeded into a real SQL engine (`SqliteWasmDriver`, the
 * inherited compiler). The expectations are the corpus's own declared id sets,
 * counted.
 *
 * ## Why this file, and not `packages/rest/src/analytics-dataset-*.test.ts`
 *
 * The REST family pins the CALLER's view of a refusal envelope through the
 * route's catch, with a driver double that fails the way SQLite does. This
 * card's claim is about ROWS — the measure answers the same count on the SQL
 * path as the memory path — which needs a real engine at the end of the road,
 * and that harness lives here (`cross-field-engine-fallback.test.ts`). A REST
 * copy would re-prove the route's envelope plumbing, which no part of this
 * change touches.
 *
 * ## The dotted spelling, stated honestly
 *
 * The ruling's literal shape names `duty.grace_days` — a RELATION path. The
 * memory evaluator walks it; SQL push-down refuses a dotted reference under the
 * maintainer's 2026-08-06 same-table ruling (#5222: no JOIN planning, no alias
 * contract), and the offset inherits that rule rather than reopening it. So on
 * a SQL deployment the dotted offset is a loud `INVALID_FILTER`, never a wrong
 * number, and the same-table spelling (`grace_days` propagated onto the task,
 * or the dataset's base object carrying the column) is the one that answers on
 * both paths. The last block pins that boundary.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CROSS_FIELD_OFFSET_CASES,
  CROSS_FIELD_OFFSET_OBJECT_FIELDS,
  CROSS_FIELD_OFFSET_OPERAND_NAMES,
  CROSS_FIELD_OFFSET_REFUSALS,
  CROSS_FIELD_OFFSET_ROWS,
} from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AggregationNode, Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, DriverQuery } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { AnalyticsService } from '../analytics-service.js';
import {
  findCrossFieldComparand,
  findUninterpretableTemporalMember,
  isFieldReference,
} from '../comparand-shape.js';

const OBJECT = 'cross_field_task';
const CTX = { tenantId: 'org_A' } as ExecutionContext;

const GRACE = { $field: 'grace_days' };
const ON_TIME: FilterCondition = { completed_on: { $lte: { $field: 'due_on', addDays: GRACE } } };
const LATE: FilterCondition = { completed_on: { $gt: { $field: 'due_on', addDays: GRACE } } };

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

// ── The detector: a reference carrying addDays is STILL a reference ─────────

describe('[#14104] the analytics comparand detector keeps detecting an offset reference', () => {
  it('isFieldReference — extra keys do not disqualify it (mirrors driver-sql\'s fieldReferenceOf)', () => {
    expect(isFieldReference({ $field: 'due_on', addDays: 5 })).toBe(true);
    expect(isFieldReference({ $field: 'due_on', addDays: GRACE })).toBe(true);
    expect(isFieldReference({ $field: 'due_on' })).toBe(true);
    // The negative control the mirror keeps: a non-string `$field` is not one.
    expect(isFieldReference({ $field: 5, addDays: 5 })).toBe(false);
    expect(isFieldReference({ addDays: 5 })).toBe(false);
  });

  it('findCrossFieldComparand routes it — at the leaf and under every combinator', () => {
    expect(findCrossFieldComparand(ON_TIME)).toEqual({ op: '$lte', field: 'completed_on', ref: 'due_on' });
    expect(findCrossFieldComparand({ $not: ON_TIME })).toEqual({ op: '$lte', field: 'completed_on', ref: 'due_on' });
    expect(findCrossFieldComparand({ $and: [{ title: 'a' }, { $or: [{ title: 'b' }, LATE] }] }))
      .toEqual({ op: '$gt', field: 'completed_on', ref: 'due_on' });
    expect(findCrossFieldComparand({ completed_on: { $lte: { $field: 'due_on', addDays: -3 } } }))
      .toEqual({ op: '$lte', field: 'completed_on', ref: 'due_on' });
    // Positive control for the walk: a literal comparand routes nothing.
    expect(findCrossFieldComparand({ completed_on: { $lte: '2026-03-01' } })).toBeNull();
  });

  it('the temporal-comparand door never judges it — a reference is not a literal', () => {
    const kindOf = (member: string) => (member === 'completed_at' || member === 'due_at' ? 'datetime' : null);
    expect(findUninterpretableTemporalMember({ completed_at: { $lte: { $field: 'due_at', addDays: GRACE } } }, kindOf)).toBeNull();
    expect(findUninterpretableTemporalMember({ completed_at: { $lte: { $field: 'due_at', addDays: 5 } } }, kindOf)).toBeNull();
    // Positive control: the door still refuses a string it cannot read.
    expect(findUninterpretableTemporalMember({ completed_at: { $lte: 'soon' } }, kindOf))
      .toEqual({ field: 'completed_at', kind: 'datetime', value: 'soon' });
  });
});

// ── The road: real engine at the end of it ──────────────────────────────────

/** Every column of the offset fixture, as a plain cube dimension. */
const CUBE: Cube = {
  name: 'tasks',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    Object.keys(CROSS_FIELD_OFFSET_OBJECT_FIELDS).map((n) => [n, { name: n, label: n, type: 'string', sql: n }]),
  ),
  public: false,
} as unknown as Cube;

/** The ruling's dataset: the on-time count, the late count, and the rate. */
const TASK_HEALTH = DatasetSchema.parse({
  name: 'task_health',
  label: 'Task health',
  object: OBJECT,
  include: [],
  dimensions: [{ name: 'title', field: 'title', type: 'string' }],
  measures: [
    { name: 'total', aggregate: 'count' },
    { name: 'done_on_time', aggregate: 'count', filter: ON_TIME },
    { name: 'late', aggregate: 'count', filter: LATE },
    { name: 'done_on_time_at', aggregate: 'count', filter: { completed_at: { $lte: { $field: 'due_at', addDays: GRACE } } } },
    { name: 'on_time_rate', derived: { op: 'ratio', of: ['done_on_time', 'total'] } },
  ],
});

function bridge(driver: SqliteWasmDriver) {
  return async (objectName: string, options: { filter?: unknown; groupBy?: unknown; aggregations?: Array<{ field: string; method: string; alias: string }> }) => {
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
  };
}

describe('[#14104] an offset reference on the analytics face — served via the engine fallback', () => {
  let driver: SqliteWasmDriver;
  let service: AnalyticsService;
  let rawSqlCalls: string[];
  let readScope: FilterCondition | null;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: OBJECT, fields: CROSS_FIELD_OFFSET_OBJECT_FIELDS } as any]);
    for (const row of CROSS_FIELD_OFFSET_ROWS) await driver.create(OBJECT, { ...row });

    rawSqlCalls = [];
    readScope = null;
    service = new AnalyticsService({
      cubes: [CUBE],
      debugSql: true,
      // BOTH paths available: native SQL wins `resolveStrategy` unless it
      // declines, so `executeRawSql` never being called MEASURES the decline.
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async (_object, sql) => {
        rawSqlCalls.push(sql);
        return [];
      },
      executeAggregate: bridge(driver),
      getReadScope: () => readScope ?? undefined,
    });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  const idsFor = async (query: Partial<AnalyticsQuery>): Promise<string[]> => {
    const result = await service.query({
      cube: 'tasks',
      dimensions: ['id'],
      measures: ['n'],
      ...query,
    } as AnalyticsQuery);
    return result.rows.map((r) => String(r.id)).sort();
  };

  const errorFrom = async (run: () => Promise<unknown>): Promise<WireBearingError> => {
    let returned: unknown;
    try {
      returned = await run();
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error(`expected a refusal, but the analytics face returned ${JSON.stringify(returned)}`);
  };

  describe('through the caller\'s `where` — the corpus\'s own row set, native SQL declined', () => {
    for (const testCase of CROSS_FIELD_OFFSET_CASES) {
      it(testCase.name, async () => {
        rawSqlCalls = [];
        readScope = null;
        const note = testCase.note ? `\n${testCase.note}` : '';
        expect(await idsFor({ where: testCase.filter as FilterCondition }), `wrong rows${note}`)
          .toEqual([...testCase.expected].sort());
        expect(rawSqlCalls, 'NativeSQLStrategy did not decline').toEqual([]);
      });
    }
  });

  describe('through an RLS read scope — the other door to the same engine', () => {
    for (const testCase of CROSS_FIELD_OFFSET_CASES.filter((c) => /COLUMN offset|LITERAL offset of 5|NOT of \$ne/.test(c.name))) {
      it(testCase.name, async () => {
        rawSqlCalls = [];
        readScope = testCase.filter as FilterCondition;
        expect(await idsFor({})).toEqual([...testCase.expected].sort());
        expect(rawSqlCalls, 'NativeSQLStrategy did not decline').toEqual([]);
        readScope = null;
      });
    }
  });

  describe('the offset refusal arm still bites after the routing', () => {
    for (const refusal of CROSS_FIELD_OFFSET_REFUSALS) {
      it(`${refusal.name} → INVALID_FILTER / 400`, async () => {
        rawSqlCalls = [];
        readScope = null;
        const err = await errorFrom(() => idsFor({ where: refusal.filter as FilterCondition }));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err).not.toBeInstanceOf(TypeError);
        expect(err.message).not.toContain('can only bind');
        expect(rawSqlCalls).toEqual([]);
      });
    }

    it('a refused read scope stays REDACTED and never degrades to an unscoped read', async () => {
      rawSqlCalls = [];
      readScope = { completed_on: { $lte: { $field: 'due_on', addDays: { $field: 'organization_id' } } } } as FilterCondition;
      const err = await errorFrom(() => idsFor({}));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      for (const column of CROSS_FIELD_OFFSET_OPERAND_NAMES) {
        expect(err.message, `policy refusal names "${column}"`).not.toContain(column);
      }
      expect(rawSqlCalls).toEqual([]);
      readScope = null;
    });
  });

  // ── The dataset: the ruling's driving shape, as a measure filter ──────────

  describe('as a DATASET measure filter — the `duly` shape, counted', () => {
    it('routes only the offset-filtered passes to the engine; the plain count stays native', async () => {
      rawSqlCalls = [];
      const result = await service.queryDataset(
        TASK_HEALTH,
        { measures: ['total', 'done_on_time', 'late'] },
        CTX,
      );
      // The unfiltered `total` pass carries no reference and is native SQL's
      // (the spy answers it with nothing — that pass is a routing measurement
      // here, not a value); each offset-filtered pass DECLINED native SQL and
      // came back from the engine with the corpus's counts: rows {2, 3} on
      // time, rows {1, 4, 8, 9} late.
      expect(rawSqlCalls).toHaveLength(1);
      expect(rawSqlCalls[0]).toMatch(/count/i);
      expect(result.rows).toHaveLength(1);
      expect(Number(result.rows[0].done_on_time)).toBe(2);
      expect(Number(result.rows[0].late)).toBe(4);
    });
  });
});

describe('[#14104] the dataset, valued end to end on the engine path', () => {
  let driver: SqliteWasmDriver;
  let service: AnalyticsService;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: OBJECT, fields: CROSS_FIELD_OFFSET_OBJECT_FIELDS } as any]);
    for (const row of CROSS_FIELD_OFFSET_ROWS) await driver.create(OBJECT, { ...row });
    service = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: bridge(driver),
    });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('answers the on-time count, the late count and the derived on-time rate', async () => {
    const result = await service.queryDataset(
      TASK_HEALTH,
      { measures: ['total', 'done_on_time', 'late', 'done_on_time_at', 'on_time_rate'] },
      CTX,
    );
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(Number(row.total)).toBe(CROSS_FIELD_OFFSET_ROWS.length);
    // Rows 2 and 3 — row 2 on the last day of grace, row 4 late because a NULL
    // grace is zero grace, rows 6 and 7 have no deadline and are neither.
    expect(Number(row.done_on_time)).toBe(2);
    expect(Number(row.late)).toBe(4);
    // The datetime pair answers the same count — class-independent.
    expect(Number(row.done_on_time_at)).toBe(2);
    expect(Number(row.on_time_rate)).toBeCloseTo(2 / CROSS_FIELD_OFFSET_ROWS.length, 10);
  });

  it('groups the same measures by a dimension without losing the filter', async () => {
    const result = await service.queryDataset(
      TASK_HEALTH,
      { dimensions: ['title'], measures: ['done_on_time', 'late'] },
      CTX,
    );
    const byTitle = new Map(result.rows.map((r) => [r.title, r]));
    expect(Number(byTitle.get('b')?.done_on_time ?? 0)).toBe(1);  // row 2
    expect(Number(byTitle.get('c')?.done_on_time ?? 0)).toBe(1);  // row 3
    expect(Number(byTitle.get('a')?.late ?? 0)).toBe(1);          // row 1
    expect(Number(byTitle.get('f')?.done_on_time ?? 0)).toBe(0);  // row 6: no deadline
    expect(Number(byTitle.get('f')?.late ?? 0)).toBe(0);
  });

  it('the dotted offset spelling of the ruling validates, routes, and is refused by SQL push-down by name', async () => {
    // Validates at the schema door (the memory evaluator walks the path).
    const dotted = { completed_on: { $lte: { $field: 'due_on', addDays: { $field: 'duty.grace_days' } } } };
    expect(DatasetSchema.safeParse({
      ...TASK_HEALTH,
      measures: [{ name: 'done_on_time', aggregate: 'count', filter: dotted }],
    }).success).toBe(true);
    // …and on a SQL deployment it is a loud INVALID_FILTER, never a wrong count:
    // the 2026-08-06 same-table ruling on #5222, inherited by the offset.
    let err: WireBearingError | null = null;
    try {
      await service.queryDataset(
        { ...TASK_HEALTH, measures: [{ name: 'done_on_time', aggregate: 'count', filter: dotted }] },
        { measures: ['done_on_time'] },
        CTX,
      );
    } catch (e) {
      err = e as WireBearingError;
    }
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.status).toBe(400);
  });
});
