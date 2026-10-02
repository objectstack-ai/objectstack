// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The row wildcard `'*'` is admitted only where a `count` consumes it (#21409;
 * ADR-0049 enforce-or-remove) — the shared rule in
 * `./analytics-column-reference.ts`.
 *
 * What is pinned here, position by position:
 *   1. A cube measure's `sql` refuses `'*'` under every `type` but `count`, at
 *      `sql` (code `custom`, the measure's refinement).
 *   2. A cube dimension's `sql` refuses `'*'` under every dimension `type`, at
 *      `sql` (code `invalid_format`, the column-path pattern without the
 *      wildcard arm — the dataset dimension's own pattern).
 *   3. A dataset measure's `field` refuses `'*'` under every aggregate but
 *      `count`, and on a measure with no aggregate (a `derived` one), at
 *      `field` (code `custom`).
 *   CONTROL: a dataset dimension's `field` already refused `'*'`.
 *   4. `count` over `'*'` is admitted byte-identically on both measure slots,
 *      and so is a dataset count with no `field`.
 *   5. ONE predicate: both measure refinements ask `rowWildcardOutsideCount`
 *      and word the refusal with the one shared builder — the issue each
 *      raises is exactly the builder's output for its slot.
 *   6. Every door that carries a cube or a dataset refuses it: the two
 *      container schemas, the `analytics_cube` and `dataset` write-door
 *      bindings, `defineCube()` and `defineStack()` (with its
 *      STACK_SCHEMA_INVALID / 422 envelope).
 *   7. The measure half is cross-field, so it does not reach the published
 *      JSON Schema: the dimension's published `pattern` refuses `'*'`, the
 *      measure slots' still admits it, and the two measure schemas' root
 *      refinements are declared in `dropped-refinements.baseline.json`.
 *   8. ADR-0087: the family's D3 entry is registered under step 18, with no D2
 *      conversion and no retired-key row.
 *
 * Runtime half — that `count` over `'*'` still RUNS on both strategies, and that
 * the measured `500` at the dataset door is now a `400` — is pinned over the
 * real route in `packages/rest/src/analytics-dataset-row-wildcard-door.test.ts`.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` — that envelope belongs to the
 * authoring door, `defineStack`, pinned with its `code` and `status`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { DatasetDimensionSchema, DatasetMeasureSchema, DatasetSchema } from '../ui/dataset.zod';
import { rowWildcardOutsideCount, rowWildcardOutsideCountRefusal } from './analytics-column-reference';
import {
  AggregationMetricType,
  CubeSchema,
  DimensionSchema,
  DimensionType,
  MetricSchema,
  defineCube,
} from './analytics.zod';
import { AggregationFunction } from './query.zod';

const D3_ID = 'analytics-row-wildcard-outside-count-refused';

/** Every cube measure `type` but `count` — derived from the enum, never restated. */
const NON_COUNT_METRIC_TYPES = AggregationMetricType.options.filter((t) => t !== 'count');
/** Every dataset measure `aggregate` but `count` — derived from the enum, never restated. */
const NON_COUNT_AGGREGATES = AggregationFunction.options.filter((a) => a !== 'count');

const COUNT_METRIC = { label: 'Orders', type: 'count', sql: '*' } as const;
const STATUS = { label: 'Status', type: 'string', sql: 'status' } as const;
const CUBE = { name: 'orders', sql: 'order', measures: { count: COUNT_METRIC }, dimensions: { status: STATUS } } as const;

const BASE = { name: 'sales', label: 'Sales', object: 'opportunity' } as const;
const STAGE = { name: 'stage', field: 'stage', type: 'string' } as const;
const COUNT = { name: 'opp_count', aggregate: 'count' } as const;

type Issue = { code: string; path: PropertyKey[]; message: string };
const refusalOf = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Issue[] } } }, value: unknown) => {
  const r = schema.safeParse(value);
  expect(r.success, JSON.stringify(value)).toBe(false);
  return r.error!.issues;
};

describe('the one predicate', () => {
  it("is true only for '*' outside a count — another aggregate, or none", () => {
    expect(rowWildcardOutsideCount('*', 'count')).toBe(false);
    for (const aggregate of [...NON_COUNT_AGGREGATES, ...NON_COUNT_METRIC_TYPES, undefined]) {
      expect(rowWildcardOutsideCount('*', aggregate), String(aggregate)).toBe(true);
    }
    // A column is never its business, under any aggregate.
    for (const aggregate of ['count', 'sum', undefined]) {
      expect(rowWildcardOutsideCount('amount', aggregate)).toBe(false);
      expect(rowWildcardOutsideCount(undefined, aggregate)).toBe(false);
    }
  });
});

describe("position 1 — a cube measure's `sql` admits '*' only under `type: 'count'`", () => {
  it.each(NON_COUNT_METRIC_TYPES)("refuses '*' under `type: '%s'` at `sql`, with the shared refusal", (type) => {
    const issues = refusalOf(MetricSchema, { label: 'M', type, sql: '*' });
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['sql']]]);
    // ONE spelling: the issue is the shared builder's output for this slot.
    expect(issues[0]!.message).toBe(rowWildcardOutsideCountRefusal('measures.<metric>.sql', 'type', type));
    // It names the slot and the aggregate written, and prescribes both ways out.
    expect(issues[0]!.message).toContain('`measures.<metric>.sql`');
    expect(issues[0]!.message).toContain(`\`type: '${type}'\``);
    expect(issues[0]!.message).toContain("`type: 'count'`");
    expect(issues[0]!.message).toContain('name the column');
  });

  it("CONTROL: `count` over '*' and every non-count type over a column parse byte-identically", () => {
    const r = MetricSchema.safeParse(COUNT_METRIC);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(COUNT_METRIC);
    for (const type of NON_COUNT_METRIC_TYPES) {
      const metric = { label: 'M', type, sql: 'account.amount' };
      const parsed = MetricSchema.safeParse(metric);
      expect(parsed.success, type).toBe(true);
      if (parsed.success) expect(parsed.data).toEqual(metric);
    }
  });
});

describe("position 2 — a cube dimension's `sql` never admits '*'", () => {
  it.each(DimensionType.options)("refuses '*' on a `%s` dimension at `sql`, prescribing a count measure", (type) => {
    const issues = refusalOf(DimensionSchema, { label: 'D', type, sql: '*' });
    expect(issues.map((i) => [i.code, i.path])).toEqual([['invalid_format', ['sql']]]);
    expect(issues[0]!.message).toContain("`'*'` is no dimension");
    expect(issues[0]!.message).toContain("`type: 'count'`");
  });

  it('CONTROL: a column and a relationship path still parse byte-identically', () => {
    for (const sql of ['status', 'account.owner.region']) {
      const dim = { label: 'D', type: 'string', sql };
      const r = DimensionSchema.safeParse(dim);
      expect(r.success, sql).toBe(true);
      if (r.success) expect(r.data).toEqual(dim);
    }
  });
});

describe("position 3 — a dataset measure's `field` admits '*' only under `aggregate: 'count'`", () => {
  it.each(NON_COUNT_AGGREGATES)("refuses '*' under `aggregate: '%s'` at `field`, with the shared refusal", (aggregate) => {
    const issues = refusalOf(DatasetMeasureSchema, { name: 'wildcard', aggregate, field: '*' });
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['field']]]);
    expect(issues[0]!.message).toBe(rowWildcardOutsideCountRefusal('measures[].field', 'aggregate', aggregate));
    expect(issues[0]!.message).toContain('`measures[].field`');
    expect(issues[0]!.message).toContain(`\`aggregate: '${aggregate}'\``);
    expect(issues[0]!.message).toContain("`aggregate: 'count'`");
  });

  it("refuses '*' on a measure with no aggregate — a `derived` one, which reads no `field`", () => {
    const issues = refusalOf(DatasetMeasureSchema, {
      name: 'done_rate',
      derived: { op: 'ratio', of: ['done_count', 'task_count'] },
      field: '*',
    });
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['field']]]);
    expect(issues[0]!.message).toBe(rowWildcardOutsideCountRefusal('measures[].field', 'aggregate', undefined));
  });

  it("CONTROL: a count over '*', a count with no `field`, and a non-count over a column parse byte-identically", () => {
    const measures = [
      COUNT,
      { name: 'star_count', aggregate: 'count', field: '*' },
      ...NON_COUNT_AGGREGATES.map((aggregate) => ({ name: `amount_${aggregate}`, aggregate, field: 'amount' })),
    ];
    const dataset = { ...BASE, dimensions: [STAGE], measures };
    const r = DatasetSchema.safeParse(dataset);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) expect(r.data).toEqual(dataset);
  });

  it("CONTROL: a dataset dimension's `field` already refused '*' — unchanged", () => {
    const issues = refusalOf(DatasetDimensionSchema, { name: 'everything', field: '*' });
    expect(issues.map((i) => [i.code, i.path])).toEqual([['invalid_format', ['field']]]);
  });
});

describe("every door that carries a cube or a dataset refuses '*' outside a count", () => {
  const cubeWithWildcards = {
    ...CUBE,
    measures: { ...CUBE.measures, total: { label: 'Total', type: 'sum', sql: '*' } },
    dimensions: { ...CUBE.dimensions, everything: { label: 'Everything', type: 'string', sql: '*' } },
  };
  const datasetWithWildcard = { ...BASE, dimensions: [STAGE], measures: [COUNT, { name: 'revenue', aggregate: 'sum', field: '*' }] };

  it('CubeSchema and the `analytics_cube` write door — one issue per member, at its `sql`', () => {
    const door = getMetadataTypeSchema('analytics_cube');
    expect(door).toBe(CubeSchema);
    for (const schema of [CubeSchema, door!]) {
      expect(refusalOf(schema, cubeWithWildcards).map((i) => [i.code, i.path])).toEqual([
        ['custom', ['measures', 'total', 'sql']],
        ['invalid_format', ['dimensions', 'everything', 'sql']],
      ]);
    }
  });

  it('`defineCube()` refuses it', () => {
    expect(() => defineCube(cubeWithWildcards as never)).toThrow(/is the row wildcard `'\*'` under `type: 'sum'`/);
  });

  it('DatasetSchema and the `dataset` write door — at `measures.N.field`', () => {
    const door = getMetadataTypeSchema('dataset');
    expect(door).toBe(DatasetSchema);
    for (const schema of [DatasetSchema, door!]) {
      expect(refusalOf(schema, datasetWithWildcard).map((i) => [i.code, i.path])).toEqual([
        ['custom', ['measures', 1, 'field']],
      ]);
    }
  });

  it('the authoring door, defineStack, refuses both with the STACK_SCHEMA_INVALID envelope', () => {
    const stack = (extra: Record<string, unknown>) => ({
      manifest: { id: 'com.example.row-wildcard', name: 'row_wildcard', version: '1.0.0', type: 'app' },
      ...extra,
    });
    let thrown: unknown;
    try {
      defineStack(stack({ analyticsCubes: [cubeWithWildcards], datasets: [datasetWithWildcard] }) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Issue[] };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues?.map((i) => i.path)).toEqual(expect.arrayContaining([
      ['analyticsCubes', 0, 'measures', 'total', 'sql'],
      ['analyticsCubes', 0, 'dimensions', 'everything', 'sql'],
      ['datasets', 0, 'measures', 1, 'field'],
    ]));
    expect(refusal.issues).toHaveLength(3);
    // CONTROL: the same stack with its members counting '*' is accepted by the same door.
    expect(() => defineStack(stack({ analyticsCubes: [CUBE], datasets: [{ ...BASE, dimensions: [STAGE], measures: [COUNT] }] }) as never)).not.toThrow();
  });
});

describe('the published JSON Schema: the dimension half is a pattern, the measure half a declared dropped refinement', () => {
  const propertiesOf = (schema: z.ZodType) =>
    (z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as {
      properties: Record<string, { pattern?: string }>;
    }).properties;

  it("a cube dimension's `sql` publishes the dataset dimension's own pattern, which refuses '*'", () => {
    const cubeDimension = propertiesOf(DimensionSchema).sql!.pattern!;
    expect(cubeDimension).toBe(propertiesOf(DatasetDimensionSchema).field!.pattern!);
    expect(new RegExp(cubeDimension).test('*')).toBe(false);
  });

  it("the measure slots' published pattern still admits '*' — the cross-field half is a refinement, and both roots are ledgered", () => {
    expect(new RegExp(propertiesOf(MetricSchema).sql!.pattern!).test('*')).toBe(true);
    expect(new RegExp(propertiesOf(DatasetMeasureSchema).field!.pattern!).test('*')).toBe(true);
    const ledger = JSON.parse(readFileSync(new URL('../../dropped-refinements.baseline.json', import.meta.url), 'utf8')) as {
      entries: Record<string, { sites: string[] }>;
    };
    expect(ledger.entries['data/Metric']?.sites).toContain('');
    expect(ledger.entries['ui/DatasetMeasure']?.sites).toContain('');
  });
});

describe('ADR-0087 registration', () => {
  it('carries the family D3 entry under step 18, with no D2 conversion and no retired-key row', () => {
    const d3 = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === D3_ID);
    expect(d3, 'the family D3 entry').toBeDefined();
    expect(d3!.reason.length).toBeGreaterThan(0);
    expect(d3!.acceptanceCriteria.length).toBeGreaterThan(0);
    // No lossless rewrite exists: `count` changes the figure, and a column is the author's to name.
    expect(d3!.conversionIds ?? []).toEqual([]);
    // No key left any shape, so no `${defKey}:${name}` entry is owed.
    expect(RETIRED_KEYS_BY_MAJOR[18]!.filter((k) => /(Metric|Dimension):sql$|DatasetMeasure:field$/.test(k))).toEqual([]);
  });
});
