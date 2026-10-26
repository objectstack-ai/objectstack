// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25808] `{ $now: true, addDays }` — the now-anchored comparand on the
 * analytics face, maintainer ruling 2026-10-26 (letter A): a dataset filter or
 * measure filter that compares a datetime column against "now minus an SLA
 * held on the record".
 *
 * ## The routing question
 *
 * `NativeSQLStrategy.canHandle` declines a cross-field comparison so the
 * filter routes to the engine path, where `driver-sql` compiles it (ruling
 * 2026-08-12 Q1 = B, #7598). The anchor takes the same road for the same
 * reason — the native compiler would bind the anchor object as the
 * comparison's value, and only the driver holds the target column's class and
 * the offset column's declaration — so `findCrossFieldComparand` detects it
 * too. The first block pins the detector; the second measures the decline.
 *
 * ## The dataset question — the ruling's driving shape
 *
 * "Tickets open longer than their SLA" as a dataset MEASURE, so a dashboard
 * binds the overdue count by name, and as a dataset FILTER, so every measure
 * of the dataset reads the overdue slice. Both authored as `$now: true`: the
 * service's token seam pins the instant before the strategy is chosen
 * (`resolvedDatasetScopeGetter`), and `Date` is faked here so the pinned
 * instant is the corpus's.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CROSS_FIELD_NOW,
  CROSS_FIELD_NOW_CASES,
  CROSS_FIELD_NOW_REFUSALS,
  CROSS_FIELD_OFFSET_OBJECT_FIELDS,
  CROSS_FIELD_OFFSET_OPERAND_NAMES,
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
  isNowAnchor,
} from '../comparand-shape.js';

const OBJECT = 'cross_field_task';
const CTX = { tenantId: 'org_A' } as ExecutionContext;

const GRACE = { $field: 'grace_days' };
/** The authored shape: the service pins `$now` itself. */
const WITHIN_GRACE: FilterCondition = { completed_on: { $lte: { $now: true, addDays: GRACE } } };
const PAST_GRACE: FilterCondition = { completed_on: { $gt: { $now: true, addDays: GRACE } } };

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

// ── The detector ────────────────────────────────────────────────────────────

describe('[#25808] the analytics comparand detector routes a now-anchored comparand', () => {
  it('isNowAnchor — authored and pinned spellings, extra keys ignored; the negative controls', () => {
    expect(isNowAnchor({ $now: true, addDays: 5 })).toBe(true);
    expect(isNowAnchor({ $now: CROSS_FIELD_NOW, addDays: GRACE })).toBe(true);
    expect(isNowAnchor({ $now: true })).toBe(true);
    expect(isNowAnchor({ $now: false, addDays: 1 })).toBe(false);
    expect(isNowAnchor({ addDays: 5 })).toBe(false);
    expect(isNowAnchor({ $field: 'due_on' })).toBe(false);
  });

  it('findCrossFieldComparand routes it — at the leaf and under every combinator', () => {
    expect(findCrossFieldComparand(WITHIN_GRACE)).toEqual({ op: '$lte', field: 'completed_on', ref: '$now' });
    expect(findCrossFieldComparand({ $not: PAST_GRACE })).toEqual({ op: '$gt', field: 'completed_on', ref: '$now' });
    expect(findCrossFieldComparand({ $and: [{ title: 'a' }, { $or: [{ title: 'b' }, { completed_at: { $lt: { $now: CROSS_FIELD_NOW, addDays: -3 } } }] }] }))
      .toEqual({ op: '$lt', field: 'completed_at', ref: '$now' });
    // Positive control for the walk: a literal comparand routes nothing.
    expect(findCrossFieldComparand({ completed_on: { $lte: '2026-03-01' } })).toBeNull();
  });

  it('the temporal-comparand door never judges it — an anchor is not a literal', () => {
    const kindOf = (member: string) => (member === 'completed_at' ? 'datetime' : member === 'completed_on' ? 'date' : null);
    expect(findUninterpretableTemporalMember({ completed_at: { $lte: { $now: true, addDays: GRACE } } }, kindOf)).toBeNull();
    expect(findUninterpretableTemporalMember({ completed_on: { $lte: { $now: CROSS_FIELD_NOW, addDays: 5 } } }, kindOf)).toBeNull();
    expect(findUninterpretableTemporalMember({ completed_at: { $lte: 'soon' } }, kindOf))
      .toEqual({ field: 'completed_at', kind: 'datetime', value: 'soon' });
  });
});

// ── The road: real engine at the end of it ──────────────────────────────────

const CUBE: Cube = {
  name: 'tasks',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    Object.keys(CROSS_FIELD_OFFSET_OBJECT_FIELDS).map((n) => [n, { label: n, type: 'string', sql: n }]),
  ),
  public: true,
} as unknown as Cube;

/** The ruling's dataset: within-grace and past-grace counts against NOW, and the rate. */
const TASK_HEALTH = DatasetSchema.parse({
  name: 'task_health',
  label: 'Task health',
  object: OBJECT,
  include: [],
  dimensions: [{ name: 'title', field: 'title', type: 'string' }],
  measures: [
    { name: 'total', aggregate: 'count' },
    { name: 'within_grace', aggregate: 'count', filter: WITHIN_GRACE },
    { name: 'past_grace', aggregate: 'count', filter: PAST_GRACE },
    { name: 'within_grace_at', aggregate: 'count', filter: { completed_at: { $lte: { $now: true, addDays: GRACE } } } },
    { name: 'within_rate', derived: { op: 'ratio', of: ['within_grace', 'total'] } },
  ],
});

/** The same dataset, SCOPED to the past-grace slice by its own filter. */
const OVERDUE_ONLY = DatasetSchema.parse({
  ...TASK_HEALTH,
  name: 'overdue_tasks',
  filter: PAST_GRACE,
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

describe('[#25808] a now-anchored comparand on the analytics face — served via the engine fallback', () => {
  let driver: SqliteWasmDriver;
  let service: AnalyticsService;
  let rawSqlCalls: string[];
  let readScope: FilterCondition | null;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(CROSS_FIELD_NOW) });
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
    vi.useRealTimers();
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
    for (const testCase of CROSS_FIELD_NOW_CASES) {
      it(testCase.name, async () => {
        rawSqlCalls = [];
        const ids = await idsFor({ where: testCase.filter as FilterCondition });
        expect(ids, testCase.note).toEqual([...testCase.expected].sort());
        expect(rawSqlCalls, 'NativeSQLStrategy did not decline').toEqual([]);
      });
    }
  });

  describe('through an RLS read scope — the other door to the same engine', () => {
    for (const testCase of CROSS_FIELD_NOW_CASES.filter((c) => /COLUMN offset|NEGATIVE literal offset \(-3\)|NOT of \$lte|\$now: true/.test(c.name))) {
      it(testCase.name, async () => {
        rawSqlCalls = [];
        readScope = testCase.filter as FilterCondition;
        try {
          expect(await idsFor({}), testCase.note).toEqual([...testCase.expected].sort());
          expect(rawSqlCalls, 'NativeSQLStrategy did not decline').toEqual([]);
        } finally {
          readScope = null;
        }
      });
    }
  });

  describe('the anchor refusal arm still bites after the routing', () => {
    for (const refusal of CROSS_FIELD_NOW_REFUSALS) {
      it(`${refusal.name} → INVALID_FILTER / 400`, async () => {
        rawSqlCalls = [];
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
      readScope = { completed_on: { $lte: { $now: true, addDays: { $field: 'organization_id' } } } } as FilterCondition;
      try {
        const err = await errorFrom(() => idsFor({}));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        for (const column of CROSS_FIELD_OFFSET_OPERAND_NAMES) {
          expect(err.message, `policy refusal names "${column}"`).not.toContain(column);
        }
        expect(rawSqlCalls).toEqual([]);
      } finally {
        readScope = null;
      }
    });
  });

  describe('as a DATASET measure filter and a DATASET filter — authored `$now: true`, pinned by the service', () => {
    it('routes the anchored passes to the engine and counts them; the plain count stays native', async () => {
      rawSqlCalls = [];
      const result = await service.queryDataset(
        TASK_HEALTH,
        { measures: ['total', 'within_grace', 'past_grace'] },
        CTX,
      );
      expect(rawSqlCalls).toHaveLength(1);
      expect(rawSqlCalls[0]).toMatch(/count/i);
      expect(result.rows).toHaveLength(1);
      // NOW is 03-03: rows 1, 2, 3, 6, 9 within now + grace; rows 4, 8 past it.
      expect(Number(result.rows[0].within_grace)).toBe(5);
      expect(Number(result.rows[0].past_grace)).toBe(2);
    });

    it('a dataset filter carrying the anchor scopes every measure — the whole query leaves native SQL', async () => {
      rawSqlCalls = [];
      const result = await service.queryDataset(
        OVERDUE_ONLY,
        { measures: ['total', 'within_grace'] },
        CTX,
      );
      expect(rawSqlCalls, 'NativeSQLStrategy did not decline the scoped query').toEqual([]);
      expect(result.rows).toHaveLength(1);
      expect(Number(result.rows[0].total)).toBe(2);
      expect(Number(result.rows[0].within_grace)).toBe(0);
    });
  });
});

describe('[#25808] the dataset, valued end to end on the engine path', () => {
  let driver: SqliteWasmDriver;
  let service: AnalyticsService;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(CROSS_FIELD_NOW) });
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: OBJECT, fields: CROSS_FIELD_OFFSET_OBJECT_FIELDS } as any]);
    for (const row of CROSS_FIELD_OFFSET_ROWS) await driver.create(OBJECT, { ...row });
    service = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: bridge(driver),
    });
  });

  afterAll(async () => {
    vi.useRealTimers();
    await driver?.disconnect?.();
  });

  it('answers the within-grace count, the past-grace count, the datetime twin and the derived rate', async () => {
    const result = await service.queryDataset(
      TASK_HEALTH,
      { measures: ['total', 'within_grace', 'past_grace', 'within_grace_at', 'within_rate'] },
      CTX,
    );
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(Number(row.total)).toBe(CROSS_FIELD_OFFSET_ROWS.length);
    expect(Number(row.within_grace)).toBe(5);
    expect(Number(row.past_grace)).toBe(2);
    // The datetime pair answers the same count — class-independent at the fixture's time of day.
    expect(Number(row.within_grace_at)).toBe(5);
    expect(Number(row.within_rate)).toBeCloseTo(5 / CROSS_FIELD_OFFSET_ROWS.length, 10);
  });

  it('groups the same measures by a dimension without losing the anchor', async () => {
    const result = await service.queryDataset(
      TASK_HEALTH,
      { dimensions: ['title'], measures: ['within_grace', 'past_grace'] },
      CTX,
    );
    const byTitle = new Map(result.rows.map((r) => [r.title, r]));
    expect(Number(byTitle.get('a')?.within_grace ?? 0)).toBe(1);  // row 1: on the last day of grace
    expect(Number(byTitle.get('d')?.past_grace ?? 0)).toBe(1);    // row 4: NULL grace is zero days
    expect(Number(byTitle.get('h')?.past_grace ?? 0)).toBe(1);    // row 8
    expect(Number(byTitle.get('e')?.within_grace ?? 0)).toBe(0);  // row 5: never completed
    expect(Number(byTitle.get('e')?.past_grace ?? 0)).toBe(0);
  });

  it('the dotted offset spelling validates at the schema door and is refused by SQL push-down by name', async () => {
    const dotted = { completed_on: { $lte: { $now: true, addDays: { $field: 'duty.sla_days' } } } };
    expect(DatasetSchema.safeParse({
      ...TASK_HEALTH,
      measures: [{ name: 'within_grace', aggregate: 'count', filter: dotted }],
    }).success).toBe(true);
    const err = await (async () => {
      try {
        await service.queryDataset(
          { ...TASK_HEALTH, measures: [{ name: 'within_grace', aggregate: 'count', filter: dotted }] },
          { measures: ['within_grace'] },
          CTX,
        );
      } catch (e) {
        return e as WireBearingError;
      }
      return null;
    })();
    expect(err).not.toBeNull();
    expect(err!.code).toBe('INVALID_FILTER');
    expect(err!.status).toBe(400);
    // The dataset's own filter is the author's (#8220 provenance), so the
    // refusal may name the boundary it hit.
    expect(err!.message).toContain('dotted path');
  });
});
