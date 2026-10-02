// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cube measure's custom-SQL-expression types — `number`, `string`,
 * `boolean` — are RETIRED from `AggregationMetricType` (#21000, ADR-0049
 * enforce-or-remove).
 *
 * They declared "a custom SQL expression returning …": the measure's `sql`
 * was the whole computation. Since `cube-member-sql-expression-retired` a
 * member's `sql` is a column reference, so the three had nothing left to
 * compute. What is pinned here, door by door:
 *
 *   1. Each of the three is refused at parse, by name, with the prescription —
 *      at the enum, at `MetricSchema.type`, and at a cube's
 *      `measures.<key>.type`. `sum` and `count` parse (the control), and a
 *      value the enum never declared keeps zod's own message.
 *   2. Every door that carries a STORED or AUTHORED cube refuses it with the
 *      same prescription, never stands it down: the `analytics_cube` write
 *      door, the artifact boot door (`ObjectStackDefinitionSchema`, which
 *      `MetadataPlugin` parses a built artifact through), `defineCube()` and
 *      `defineStack()` (with its STACK_SCHEMA_INVALID / 422 envelope).
 *      The rehydration seam replays no conversion over it — a stored row
 *      reaches the parse exactly as stored, and the parse refuses it.
 *   3. `tsc` refuses the three at a typed measure.
 *   4. ADR-0087: the family's D3 entry is registered under step 18, with no
 *      D2 conversion naming the surface and no `RETIRED_KEYS_BY_MAJOR` row —
 *      no key left the shape.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues
 * carry `code` and `path` but no ADR-0112 `status` — that envelope belongs to
 * the authoring door, `defineStack`, pinned with its `code` and `status`.
 */

import { describe, expect, it } from 'vitest';

import { CONVERSIONS_BY_MAJOR } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { AggregationMetricType, CubeSchema, MetricSchema, defineCube, type Metric } from './analytics.zod';

const D3_ID = 'cube-metric-expression-types-retired';
const RETIRED = ['number', 'string', 'boolean'] as const;
const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'] as const;

/** The prescription's first sentence, per retired member. */
const firstSentence = (member: string) =>
  `\`${member}\` was removed from \`AggregationMetricType\` (a cube measure's \`measures.<metric>.type\`) `
  + 'in @objectstack/spec 17.7.0 (ADR-0049 enforce-or-remove)';

/** The fix every prescription carries: the six aggregates, and where a computed value goes instead. */
const FIX = /Name the aggregate the measure means — `sum`, `avg`, `min` or `max` over the column, `count`[^]*`count_distinct`[^]*keep it as a field of the object[^]*ADR-0021 dataset/;

const measureOf = (type: string) => ({ label: 'M', type, sql: 'amount' });

const CUBE = {
  name: 'orders',
  sql: 'shop_order',
  measures: {
    count: { label: 'Orders', type: 'count', sql: '*' },
    revenue: { label: 'Revenue', type: 'sum', sql: 'amount' },
  },
  dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } },
} as const;

/** The control cube plus one measure of `type` — the shape a stored pre-retirement cube carries. */
const cubeWith = (type: string) => ({ ...CUBE, measures: { ...CUBE.measures, m: measureOf(type) } });

function issuesOf(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } } }, value: unknown) {
  const r = schema.safeParse(value);
  expect(r.success, 'expected a refusal').toBe(false);
  return r.error!.issues;
}

describe('the custom-SQL-expression metric types are refused at parse, by name', () => {
  it.each(RETIRED)('`%s` is refused at the enum with its prescription', (member) => {
    const issues = issuesOf(AggregationMetricType, member);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('invalid_value');
    expect(issues[0]!.message.startsWith(firstSentence(member))).toBe(true);
    expect(issues[0]!.message).toContain(`returning a ${member}`);
    expect(issues[0]!.message).toMatch(FIX);
  });

  it.each(RETIRED)('`%s` is refused at a metric\'s `type`, and only there', (member) => {
    const issues = issuesOf(MetricSchema, measureOf(member));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['invalid_value', ['type']]]);
    expect(issues[0]!.message.startsWith(firstSentence(member))).toBe(true);
  });

  it.each(RETIRED)('`%s` is refused at a cube\'s `measures.<key>.type`', (member) => {
    const issues = issuesOf(CubeSchema, cubeWith(member));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['invalid_value', ['measures', 'm', 'type']]]);
    expect(issues[0]!.message.startsWith(firstSentence(member))).toBe(true);
  });

  it('CONTROL: `sum` and `count` parse, and the six aggregates are the whole vocabulary', () => {
    expect(MetricSchema.safeParse(measureOf('sum')).success).toBe(true);
    expect(MetricSchema.safeParse({ label: 'Rows', type: 'count', sql: '*' }).success).toBe(true);
    expect(CubeSchema.safeParse(cubeWith('sum')).success).toBe(true);
    expect([...AggregationMetricType.options]).toEqual([...AGGREGATES]);
  });

  it('a value the enum never declared keeps zod\'s own message — the prescription is the retired members\' alone', () => {
    const issues = issuesOf(AggregationMetricType, 'median');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).not.toMatch(/was removed/);
    for (const aggregate of AGGREGATES) expect(issues[0]!.message).toContain(aggregate);
  });

  it('`DimensionType` is a separate enum and keeps `string` / `number` / `boolean`', () => {
    // The census reading this pins: the showcase cube's `type: 'string'` lines
    // are DIMENSIONS, which this retirement does not touch.
    expect(CubeSchema.safeParse({
      ...CUBE,
      dimensions: {
        status: { label: 'Status', type: 'string', sql: 'status' },
        amount: { label: 'Amount', type: 'number', sql: 'amount' },
        paid: { label: 'Paid', type: 'boolean', sql: 'paid' },
      },
    }).success).toBe(true);
  });
});

describe('every door that carries a stored or authored cube refuses it — never stands it down', () => {
  it.each(RETIRED)('the `analytics_cube` write door refuses `%s`', (member) => {
    // `getMetadataTypeSchema('analytics_cube')` is what a `PUT /api/v1/meta/analytics_cube`
    // body is validated against; a rebinding to another shape would pass the
    // pins above and still accept the retired type in production.
    const door = getMetadataTypeSchema('analytics_cube');
    expect(door).toBe(CubeSchema);
    const issues = issuesOf(door!, cubeWith(member));
    expect(issues.map((i) => i.path)).toEqual([['measures', 'm', 'type']]);
    expect(issues[0]!.message.startsWith(firstSentence(member))).toBe(true);
  });

  it.each(RETIRED)('the artifact boot door refuses a built stack carrying `%s`', (member) => {
    // `MetadataPlugin._parseAndRegisterArtifact` parses a built artifact
    // through this schema; the refusal fails the boot with the prescription.
    const issues = issuesOf(ObjectStackDefinitionSchema, { analyticsCubes: [cubeWith(member)] });
    expect(issues.map((i) => i.path)).toEqual([['analyticsCubes', 0, 'measures', 'm', 'type']]);
    expect(issues[0]!.message.startsWith(firstSentence(member))).toBe(true);
  });

  it.each(RETIRED)('the rehydration seam replays nothing over a stored row carrying `%s` — it reaches the parse as stored', (member) => {
    // CONTROL: the seam is live for this type — a retired VALUE a D2 conversion
    // does rewrite (`cube-sub-day-granularities-removed` drops a sub-day
    // interval from a dimension's `granularities`) is rewritten here, on the
    // same stored row, while the retired measure type beside it is not touched.
    const withRetiredInterval = applyConversionsToStoredItem('analytics_cube', {
      ...cubeWith(member),
      dimensions: {
        ...CUBE.dimensions,
        placed_at: { label: 'Placed', type: 'time', sql: 'placed_at', granularities: ['hour', 'day'] },
      },
    }) as { dimensions: Record<string, { granularities?: string[] }>; measures: Record<string, unknown> };
    expect(withRetiredInterval.dimensions.placed_at!.granularities).toEqual(['day']);
    expect(withRetiredInterval.measures.m).toEqual(measureOf(member));
    const stored = cubeWith(member);
    const rehydrated = applyConversionsToStoredItem('analytics_cube', stored) as typeof stored;
    // Nothing rewrote or dropped the retired measure on the way…
    expect(rehydrated.measures.m).toEqual(measureOf(member));
    // …so the parse that follows refuses it, with the prescription.
    const issues = issuesOf(CubeSchema, rehydrated);
    expect(issues[0]!.message.startsWith(firstSentence(member))).toBe(true);
  });

  it('`defineCube()` refuses it with the prescription', () => {
    for (const member of RETIRED) {
      expect(() => defineCube(cubeWith(member) as never)).toThrow(firstSentence(member));
    }
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope', () => {
    const stack = (cube: Record<string, unknown>) => ({
      manifest: { id: 'com.example.cube-metric-type', name: 'cube_metric_type', version: '1.0.0', type: 'app' },
      analyticsCubes: [cube],
    });
    for (const member of RETIRED) {
      let thrown: unknown;
      try {
        defineStack(stack(cubeWith(member)) as never);
      } catch (e) {
        thrown = e;
      }
      const refusal = thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
      expect(refusal?.code, member).toBe('STACK_SCHEMA_INVALID');
      expect(refusal?.status, member).toBe(422);
      expect(refusal.issues?.map((i) => i.path), member).toEqual([['analyticsCubes', 0, 'measures', 'm', 'type']]);
      expect(refusal.issues?.[0]?.message.startsWith(firstSentence(member)), member).toBe(true);
    }
    // CONTROL: the same stack with an aggregate measure is accepted by the same door.
    expect(() => defineStack(stack(cubeWith('sum')) as never)).not.toThrow();
  });
});

describe('tsc refuses the retired members at a typed measure', () => {
  it('a typed `Metric` cannot name one', () => {
    // @ts-expect-error — `number` left `AggregationMetricType` (#21000).
    const retired: Metric = { label: 'M', type: 'number', sql: 'amount' };
    const live: Metric = { label: 'M', type: 'sum', sql: 'amount' };
    expect(MetricSchema.safeParse(retired).success).toBe(false);
    expect(MetricSchema.safeParse(live).success).toBe(true);
  });
});

describe('ADR-0087 registration', () => {
  it('carries the family D3 entry under step 18, with no D2 conversion and no retired-key row', () => {
    const step = MIGRATIONS_BY_MAJOR[18]!;
    const d3 = step.semantic.find((s) => s.id === D3_ID);
    expect(d3, 'the family D3 entry').toBeDefined();
    expect(d3!.reason.length).toBeGreaterThan(0);
    expect(d3!.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(step.rationale).toContain('`cube-metric-expression-types-retired`');
    // No conversion rewrites the type: a stored cube is refused, never stood down.
    const surfaces = Object.values(CONVERSIONS_BY_MAJOR).flat().map((c) => c.surface);
    expect(surfaces.filter((s) => /measures\.<metric>\.type/.test(s))).toEqual([]);
    // No key left the shape, so no `${defKey}:${name}` entry is owed.
    expect(RETIRED_KEYS_BY_MAJOR[18]).not.toContain('data/Metric:type');
  });
});
