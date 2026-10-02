// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cube member's `sql` is a COLUMN REFERENCE — the expression half RETIRED
 * (#20943, maintainer ruling D: ADR-0021's "zero raw SQL / zero raw
 * expressions" carried to the cube layer; ADR-0049 enforce-or-remove).
 *
 * What is pinned here, door by door:
 *   1. The accept set the ruling's execution parameters name — a bare
 *      identifier, a dotted identifier path, and `'*'` — parses
 *      byte-identically to before, on a measure and a dimension alike, with
 *      one later narrowing (#21409): `'*'` only on a `count` measure. That
 *      half is pinned in `analytics-row-wildcard-count-only.test.ts`.
 *   2. The refusal: every other value — an expression, a quoted or
 *      `$`-prefixed spelling, an empty string, a broken path — is refused at
 *      `…sql` with the prescription, whose first sentence states the contract
 *      and whose body names the ADR-0021 dataset form.
 *   3. The rule is a `pattern` in the published JSON Schema too, so a
 *      document validated against `json-schema/**` is judged as the parse
 *      judges it — a measure's with the `'*'` arm, a dimension's without it.
 *   4. Every door that carries a cube refuses it: `CubeSchema`, the
 *      `analytics_cube` write-door binding, `defineCube()` and `defineStack()`
 *      (the last with its STACK_SCHEMA_INVALID / 422 envelope).
 *   5. The structural equivalent the prescription points at is real: the
 *      retired showcase `done_rate` expression is refused, and its dataset form
 *      (a filtered count over a count, as a `ratio`) parses.
 *   6. No other prescription in the cube family still sends an author to a
 *      metric's own `sql` expression.
 *   7. ADR-0087: the family's D3 entry is registered under step 18. No D2
 *      conversion and no `RETIRED_KEYS_BY_MAJOR` row — no key was removed, and
 *      an expression has no mechanical rewrite into a dataset.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues
 * carry `code` and `path` but no ADR-0112 `status` — that envelope belongs to
 * the authoring door, `defineStack`, pinned with its `code` and `status`.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { DatasetSchema } from '../ui/dataset.zod';
import {
  AnalyticsQuerySchema,
  AggregationMetricType,
  CubeSchema,
  DimensionSchema,
  MetricSchema,
  defineCube,
} from './analytics.zod';

const D3_ID = 'cube-member-sql-expression-retired';

/** The expression the showcase `done_rate` measure carried until this retirement. */
const DONE_RATE_EXPRESSION = "SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)";

const METRIC_FIRST_SENTENCE =
  "`measures.<metric>.sql` is a column reference: a field of the cube's object (`amount`), a "
  + "relationship path ending in one (`account.amount`), or `'*'` for a count.";
const DIMENSION_FIRST_SENTENCE =
  "`dimensions.<dimension>.sql` is a column reference: a field of the cube's object (`status`) "
  + 'or a relationship path ending in one (`account.industry`).';

/** The body of an expression refusal: why, and the ADR-0021 dataset form it points at. */
const EXPRESSION_PRESCRIPTION =
  /A SQL expression there was retired in @objectstack\/spec 17 \(ADR-0021 zero raw expressions; ADR-0049 enforce-or-remove\) — an expression names no single field/s;
const DATASET_FORM = /ADR-0021 dataset.*structured `filter`.*`derived: \{ op, of: \[\.\.\.\] \}`/s;

const COUNT = { label: 'Tasks', type: 'count', sql: '*' } as const;
const STATUS = { label: 'Status', type: 'string', sql: 'status' } as const;
const CUBE = {
  name: 'delivery',
  sql: 'task',
  measures: { count: COUNT },
  dimensions: { status: STATUS },
} as const;

/** Values that name no single column — every one of them used to parse. */
const EXPRESSIONS = [
  DONE_RATE_EXPRESSION,
  'SUM(amount)',
  'amount * 2',
  'SUM(account.amount) / 2',
  "CASE WHEN annual_revenue > 0 THEN 'yes' ELSE 'no' END",
  '"amount"',
  '$amount',
  '${CUBE}.amount',
  '',
  ' amount',
  'account.',
  'account..amount',
  '1',
];

const refusalOf = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } } }, value: unknown) => {
  const r = schema.safeParse(value);
  expect(r.success, JSON.stringify(value)).toBe(false);
  return r.error!.issues;
};

describe('cube member sql — the accept set is unchanged for every column reference', () => {
  it('a measure admits a bare column, a relationship path, and `*` — parsed byte-identically', () => {
    const admitted = [
      { label: 'Total', type: 'sum', sql: 'amount' },
      { label: 'Account total', type: 'sum', sql: 'account.amount' },
      { label: 'Region spread', type: 'count_distinct', sql: 'account.owner.region' },
      { label: 'Mixed case', type: 'max', sql: 'Amount_2' },
      { label: 'Filled', type: 'count', sql: 'closed_at' },
      COUNT,
    ];
    for (const metric of admitted) {
      const r = MetricSchema.safeParse(metric);
      expect(r.success, metric.sql).toBe(true);
      if (r.success) expect(r.data).toEqual(metric);
    }
  });

  it('a dimension admits a bare column and a relationship path — parsed byte-identically', () => {
    // `'*'` left a dimension's accept set with #21409: no aggregate consumes it
    // there (refused in `analytics-row-wildcard-count-only.test.ts`).
    for (const sql of ['status', 'account.industry', 'account.owner.region', '_private']) {
      const dim = { label: 'D', type: 'string', sql };
      const r = DimensionSchema.safeParse(dim);
      expect(r.success, sql).toBe(true);
      if (r.success) expect(r.data).toEqual(dim);
    }
  });
});

describe('cube member sql — an expression is refused at parse, with the prescription', () => {
  it('a measure refuses every non-column value at `sql`, naming the contract first and the dataset form after', () => {
    for (const sql of EXPRESSIONS) {
      const issues = refusalOf(MetricSchema, { label: 'M', type: 'number', sql });
      expect(issues, sql).toHaveLength(1);
      expect(issues[0]!.code).toBe('invalid_format');
      expect(issues[0]!.path).toEqual(['sql']);
      expect(issues[0]!.message.startsWith(METRIC_FIRST_SENTENCE), sql).toBe(true);
      expect(issues[0]!.message).toMatch(EXPRESSION_PRESCRIPTION);
      expect(issues[0]!.message).toMatch(DATASET_FORM);
    }
  });

  it('the refusal does not depend on the measure type — an aggregate type is refused the same way', () => {
    for (const type of AggregationMetricType.options) {
      const issues = refusalOf(MetricSchema, { label: 'M', type, sql: 'SUM(amount)' });
      expect(issues.map((i) => i.path), type).toEqual([['sql']]);
      expect(issues[0]!.message.startsWith(METRIC_FIRST_SENTENCE)).toBe(true);
    }
  });

  it('a dimension refuses every non-column value at `sql` — a CASE bucket included', () => {
    for (const sql of EXPRESSIONS) {
      const issues = refusalOf(DimensionSchema, { label: 'D', type: 'string', sql });
      expect(issues, sql).toHaveLength(1);
      expect(issues[0]!.code).toBe('invalid_format');
      expect(issues[0]!.path).toEqual(['sql']);
      expect(issues[0]!.message.startsWith(DIMENSION_FIRST_SENTENCE), sql).toBe(true);
      expect(issues[0]!.message).toMatch(EXPRESSION_PRESCRIPTION);
      // A bucket has no expression form anywhere: the prescription says where it goes.
      expect(issues[0]!.message).toMatch(/keep the bucket as a field of the object/);
    }
  });
});

describe('cube member sql — the rule reaches the published JSON Schema as a pattern', () => {
  it('both members carry a `pattern` on `sql` — the dimension\'s is the measure\'s without the `*` arm — and each judges values as the parse does', () => {
    const metricSql = (z.toJSONSchema(MetricSchema, { io: 'input', unrepresentable: 'any' }) as {
      properties: Record<string, { pattern?: string }>;
    }).properties.sql!;
    const dimensionSql = (z.toJSONSchema(DimensionSchema, { io: 'input', unrepresentable: 'any' }) as {
      properties: Record<string, { pattern?: string }>;
    }).properties.sql!;
    expect(metricSql.pattern).toBeDefined();
    // [#21409] One column path; the dimension states the one restriction, the
    // row-wildcard arm, and nothing else.
    expect(metricSql.pattern!.startsWith('^(?:\\*|') && metricSql.pattern!.endsWith(')$')).toBe(true);
    expect(dimensionSql.pattern).toBe(`^${metricSql.pattern!.slice('^(?:\\*|'.length, -')$'.length)}$`);
    const metric = new RegExp(metricSql.pattern!);
    const dimension = new RegExp(dimensionSql.pattern!);
    for (const sql of ['amount', 'account.amount']) {
      expect(metric.test(sql), sql).toBe(true);
      expect(dimension.test(sql), sql).toBe(true);
    }
    expect(metric.test('*')).toBe(true);
    expect(dimension.test('*')).toBe(false);
    for (const sql of EXPRESSIONS) {
      expect(metric.test(sql), sql).toBe(false);
      expect(dimension.test(sql), sql).toBe(false);
    }
  });
});

describe('cube member sql — every door that carries a cube refuses an expression member', () => {
  const withExpression = {
    ...CUBE,
    measures: { ...CUBE.measures, done_rate: { label: 'Done Rate (%)', type: 'number', sql: DONE_RATE_EXPRESSION } },
  };

  it('the cube schema refuses it at measures.<key>.sql and dimensions.<key>.sql — one issue per member', () => {
    const issues = refusalOf(CubeSchema, {
      ...withExpression,
      dimensions: { ...CUBE.dimensions, bucket: { label: 'Bucket', type: 'string', sql: "CASE WHEN a > 0 THEN 'x' END" } },
    });
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['invalid_format', ['measures', 'done_rate', 'sql']],
      ['invalid_format', ['dimensions', 'bucket', 'sql']],
    ]);
  });

  it('the `analytics_cube` write door (the registry binding) refuses it', () => {
    // `getMetadataTypeSchema('analytics_cube')` is what a `PUT /api/v1/meta/analytics_cube`
    // body is validated against; a rebinding to another shape would pass the
    // pins above and still accept the expression in production.
    const door = getMetadataTypeSchema('analytics_cube');
    expect(door).toBe(CubeSchema);
    const issues = refusalOf(door!, withExpression);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['measures', 'done_rate', 'sql']);
    expect(issues[0]!.message.startsWith(METRIC_FIRST_SENTENCE)).toBe(true);
  });

  it('`defineCube()` refuses it with the prescription', () => {
    expect(() => defineCube(withExpression as never)).toThrow(EXPRESSION_PRESCRIPTION);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope', () => {
    const stack = (cube: Record<string, unknown>) => ({
      manifest: { id: 'com.example.cube-member-sql', name: 'cube_member_sql', version: '1.0.0', type: 'app' },
      analyticsCubes: [cube],
    });
    let thrown: unknown;
    try {
      defineStack(stack(withExpression) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues).toHaveLength(1);
    expect(refusal.issues?.[0]?.path).toEqual(['analyticsCubes', 0, 'measures', 'done_rate', 'sql']);
    expect(refusal.issues?.[0]?.message.startsWith(METRIC_FIRST_SENTENCE)).toBe(true);
    // CONTROL: the same stack without the expression member is accepted by the same door.
    expect(() => defineStack(stack({ ...CUBE }) as never)).not.toThrow();
  });

  it('CONTROL: the cube without the expression member passes every door, every member intact', () => {
    const r = CubeSchema.safeParse(CUBE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.measures.count).toEqual(COUNT);
    expect(r.data.dimensions.status).toEqual(STATUS);
    expect(defineCube(CUBE).measures.count).toEqual(COUNT);
  });
});

describe('cube member sql — the dataset form the prescription names is the structural equivalent', () => {
  it('the retired done-rate expression is refused, and its dataset form — a filtered count over a count — parses', () => {
    expect(MetricSchema.safeParse({ label: 'Done Rate (%)', type: 'number', sql: DONE_RATE_EXPRESSION }).success).toBe(false);
    const dataset = {
      name: 'task_metrics',
      label: 'Task Metrics',
      object: 'task',
      dimensions: [{ name: 'priority', field: 'priority' }],
      measures: [
        { name: 'task_count', aggregate: 'count' },
        { name: 'done_count', aggregate: 'count', filter: { status: 'done' } },
        { name: 'done_rate', derived: { op: 'ratio', of: ['done_count', 'task_count'] }, format: '0.0%' },
      ],
    };
    const r = DatasetSchema.safeParse(dataset);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});

describe('cube member sql — no neighbouring prescription still sends an author to an expression', () => {
  it("the retired metric `filters` guidance names `where` and the dataset `filter`, never the metric's own `sql` expression", () => {
    const issues = refusalOf(MetricSchema, { ...COUNT, filters: [] });
    const message = issues.find((i) => /filters/.test(i.message))?.message ?? '';
    expect(message).toMatch(/`measures\.<metric>\.filters` was removed/);
    expect(message).toMatch(/structured `filter`/);
    expect(message).not.toMatch(/fold the condition/);
  });

  it("the analytics query's `filters` guidance does the same", () => {
    const issues = refusalOf(AnalyticsQuerySchema, { cube: 'delivery', measures: ['count'], filters: {} });
    const message = issues.find((i) => /filters/.test(i.message))?.message ?? '';
    expect(message).toMatch(/use `where`/);
    expect(message).toMatch(/structured `filter`/);
    expect(message).not.toMatch(/fold the condition/);
  });
});

describe('cube member sql — ADR-0087 registration', () => {
  it('carries the family D3 entry under step 18, with no D2 conversion and no retired-key row', () => {
    const step = MIGRATIONS_BY_MAJOR[18]!;
    const d3 = step.semantic.find((s) => s.id === D3_ID);
    expect(d3, 'the family D3 entry').toBeDefined();
    expect(d3!.reason.length).toBeGreaterThan(0);
    expect(d3!.acceptanceCriteria.length).toBeGreaterThan(0);
    // No key left the shape, so no `${defKey}:${name}` entry is owed.
    expect(RETIRED_KEYS_BY_MAJOR[18]).not.toContain('data/Metric:sql');
    expect(RETIRED_KEYS_BY_MAJOR[18]).not.toContain('data/Dimension:sql');
  });
});
