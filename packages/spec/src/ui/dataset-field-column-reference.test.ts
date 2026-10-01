// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dataset dimension's and measure's `field` is a COLUMN REFERENCE (#21220;
 * ADR-0021 "zero raw SQL / zero raw expressions", ADR-0049 enforce-or-remove) —
 * the accept set the cube members it compiles to hold since #20943, from the
 * one shared declaration in `../data/analytics-column-reference.ts`.
 *
 * What is pinned here, door by door:
 *   1. A column, a relationship path, and `'*'` on a measure (and an omitted
 *      `field` on a count) parse byte-identically to before.
 *   2. The refusal: an expression, a quoted or `$`-prefixed spelling, a padded
 *      or empty string, a broken path — and `'*'` on a dimension — is refused
 *      at `dimensions.N.field` / `measures.N.field` with code `invalid_format`;
 *      the prescription opens with the contract and names the ADR-0021 form.
 *   3. ONE pattern: the measure's `field` carries the cube member's own
 *      `pattern` in the published JSON Schema, and the dimension's is that same
 *      column path with only the row-wildcard arm removed.
 *   4. Every door that carries a dataset refuses it: `DatasetSchema`, the
 *      `dataset` write-door binding, and `defineStack()` (with its
 *      STACK_SCHEMA_INVALID / 422 envelope).
 *   5. ADR-0087: the family's D3 entry is registered under step 18 and linked
 *      to the one D2 repair (a `count` measure's empty `field`); no key left
 *      the shape, so no `RETIRED_KEYS_BY_MAJOR` row.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` — that envelope belongs to the
 * authoring door, `defineStack`, pinned with its `code` and `status`.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MetricSchema } from '../data/analytics.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { DatasetDimensionSchema, DatasetMeasureSchema, DatasetSchema } from './dataset.zod';

const D3_ID = 'dataset-member-field-expression-refused';

const DIMENSION_FIRST_SENTENCE =
  "`dimensions[].field` is a column reference: a field of the dataset's object (`stage`), or a relationship "
  + 'path ending in one (`account.region`) whose relationships are declared in `include`.';
const MEASURE_FIRST_SENTENCE =
  "`measures[].field` is a column reference: a field of the dataset's object (`amount`), a relationship path "
  + "ending in one (`account.amount`) whose relationships are declared in `include`, or `'*'` for a count; "
  + 'a count may also omit `field`.';

/** The ADR-0021 form a measure's refusal points at: a measure `filter`, and `derived` over named measures. */
const DATASET_FORM = /ADR-0021 form.*structured `filter`.*`derived: \{ op, of: \[\.\.\.\] \}`/s;

/** Values that name no single column — every one of them used to parse, on both keys. */
const NON_COLUMNS = [
  'amount * 2',
  'SUM(amount)',
  'SUM(account.amount) / 2',
  "CASE WHEN status = 'done' THEN 1 ELSE 0 END",
  '(SELECT secret FROM other_object)',
  "translate(name, 'ABC', 'abc')",
  '"amount"',
  '$amount',
  '',
  ' amount',
  'amount ',
  'account.',
  'account..amount',
  '1',
];

const BASE = { name: 'sales', label: 'Sales', object: 'opportunity', include: ['account'] } as const;
const STAGE = { name: 'stage', field: 'stage', type: 'string' } as const;
const COUNT = { name: 'opp_count', aggregate: 'count' } as const;

type Issue = { code: string; path: PropertyKey[]; message: string };
const refusalOf = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Issue[] } } }, value: unknown) => {
  const r = schema.safeParse(value);
  expect(r.success, JSON.stringify(value)).toBe(false);
  return r.error!.issues;
};

describe('dataset field — every column reference parses byte-identically to before', () => {
  it('a dimension admits a bare column and relationship paths', () => {
    for (const field of ['stage', 'account.region', 'account.owner.region', '_private', 'Region_2']) {
      const dataset = { ...BASE, dimensions: [{ name: 'axis', field, type: 'string' }], measures: [COUNT] };
      const r = DatasetSchema.safeParse(dataset);
      expect(r.success, `${field}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
      if (r.success) expect(r.data).toEqual(dataset);
    }
  });

  it('a measure admits a bare column, relationship paths and `*` — and a count may still omit `field`', () => {
    const measures = [
      COUNT,
      { name: 'star_count', aggregate: 'count', field: '*' },
      { name: 'revenue', aggregate: 'sum', field: 'amount' },
      { name: 'account_revenue', aggregate: 'sum', field: 'account.annual_revenue' },
      { name: 'regions', aggregate: 'count_distinct', field: 'account.owner.region' },
    ];
    const dataset = { ...BASE, dimensions: [STAGE], measures };
    const r = DatasetSchema.safeParse(dataset);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) expect(r.data).toEqual(dataset);
  });
});

describe('dataset field — a non-column value is refused at parse, at its path, with the prescription', () => {
  it('a dimension refuses every non-column value — and `*` — at `dimensions.N.field`', () => {
    for (const field of [...NON_COLUMNS, '*']) {
      const issues = refusalOf(DatasetSchema, {
        ...BASE,
        dimensions: [STAGE, { name: 'bucket', field, type: 'string' }],
        measures: [COUNT],
      });
      expect(issues.map((i) => [i.code, i.path]), field).toEqual([['invalid_format', ['dimensions', 1, 'field']]]);
      expect(issues[0]!.message.startsWith(DIMENSION_FIRST_SENTENCE), field).toBe(true);
      expect(issues[0]!.message).toMatch(/ADR-0021/);
    }
  });

  it('a measure refuses every non-column value at `measures.N.field`, naming the ADR-0021 form', () => {
    for (const field of NON_COLUMNS) {
      const issues = refusalOf(DatasetSchema, {
        ...BASE,
        dimensions: [STAGE],
        measures: [COUNT, { name: 'computed', aggregate: 'sum', field }],
      });
      // An empty `field` on a `sum` also fails the "requires `field`" rule —
      // the column-reference issue is the one at the path.
      const atField = issues.filter((i) => i.path.join('.') === 'measures.1.field');
      expect(atField.map((i) => i.code), field).toEqual(['invalid_format']);
      expect(atField[0]!.message.startsWith(MEASURE_FIRST_SENTENCE), field).toBe(true);
      expect(atField[0]!.message).toMatch(DATASET_FORM);
    }
  });

  it('the refusal does not depend on the aggregate — a count with an empty or expression `field` is refused too', () => {
    for (const field of ['', 'COUNT(*)', 'DISTINCT owner']) {
      const issues = refusalOf(DatasetSchema, {
        ...BASE,
        dimensions: [STAGE],
        measures: [{ name: 'row_count', aggregate: 'count', field }],
      });
      expect(issues.map((i) => [i.code, i.path]), field).toEqual([['invalid_format', ['measures', 0, 'field']]]);
    }
  });

  it('the member schemas refuse it on their own, at `field`', () => {
    expect(refusalOf(DatasetDimensionSchema, { name: 'bucket', field: 'amount * 2' }).map((i) => [i.code, i.path]))
      .toEqual([['invalid_format', ['field']]]);
    expect(refusalOf(DatasetMeasureSchema, { name: 'computed', aggregate: 'sum', field: 'amount * 2' }).map((i) => [i.code, i.path]))
      .toEqual([['invalid_format', ['field']]]);
  });
});

describe('dataset field — ONE pattern, published as the JSON Schema `pattern`', () => {
  const patternOf = (schema: z.ZodType) =>
    (z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as {
      properties: Record<string, { pattern?: string }>;
    }).properties;

  it("a measure's `field` carries the cube member's own `sql` pattern; a dimension's is that path without the `*` arm", () => {
    const cubeSql = patternOf(MetricSchema).sql!.pattern!;
    const measureField = patternOf(DatasetMeasureSchema).field!.pattern!;
    const dimensionField = patternOf(DatasetDimensionSchema).field!.pattern!;
    expect(measureField).toBe(cubeSql);
    // The one stated restriction: the row-wildcard arm, and nothing else.
    expect(cubeSql.startsWith('^(?:\\*|') && cubeSql.endsWith(')$')).toBe(true);
    expect(dimensionField).toBe(`^${cubeSql.slice('^(?:\\*|'.length, -')$'.length)}$`);
  });

  it('each pattern judges values as the parse does', () => {
    const measure = new RegExp(patternOf(DatasetMeasureSchema).field!.pattern!);
    const dimension = new RegExp(patternOf(DatasetDimensionSchema).field!.pattern!);
    for (const v of ['amount', 'account.amount', 'account.owner.region']) {
      expect(measure.test(v), v).toBe(true);
      expect(dimension.test(v), v).toBe(true);
    }
    expect(measure.test('*')).toBe(true);
    expect(dimension.test('*')).toBe(false);
    for (const v of NON_COLUMNS) {
      expect(measure.test(v), v).toBe(false);
      expect(dimension.test(v), v).toBe(false);
    }
  });
});

describe('dataset field — every door that carries a dataset refuses a non-column field', () => {
  const withExpression = {
    ...BASE,
    dimensions: [STAGE],
    measures: [COUNT, { name: 'double_amount', aggregate: 'sum', field: 'amount * 2' }],
  };

  it('the `dataset` write door (the registry binding) refuses it', () => {
    // What a `PUT /api/v1/meta/dataset` body is validated against; a rebinding
    // to another shape would pass the pins above and still accept the
    // expression in production.
    const door = getMetadataTypeSchema('dataset');
    expect(door).toBe(DatasetSchema);
    const issues = refusalOf(door!, withExpression);
    expect(issues.map((i) => [i.code, i.path])).toEqual([['invalid_format', ['measures', 1, 'field']]]);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope', () => {
    const stack = (dataset: Record<string, unknown>) => ({
      manifest: { id: 'com.example.dataset-field', name: 'dataset_field', version: '1.0.0', type: 'app' },
      datasets: [dataset],
    });
    let thrown: unknown;
    try {
      defineStack(stack(withExpression) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Issue[] };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues?.map((i) => i.path)).toEqual([['datasets', 0, 'measures', 1, 'field']]);
    expect(refusal.issues?.[0]?.message.startsWith(MEASURE_FIRST_SENTENCE)).toBe(true);
    // CONTROL: the same stack with a column `field` is accepted by the same door.
    expect(() => defineStack(stack({ ...BASE, dimensions: [STAGE], measures: [COUNT] }) as never)).not.toThrow();
  });
});

describe('dataset field — ADR-0087 registration', () => {
  it('carries the family D3 entry under step 18, linked to its one D2 repair, with no retired-key row', () => {
    const d3 = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === D3_ID);
    expect(d3, 'the family D3 entry').toBeDefined();
    expect(d3!.reason.length).toBeGreaterThan(0);
    expect(d3!.acceptanceCriteria.length).toBeGreaterThan(0);
    // The D2 half — a `count` measure's empty `field` — is pinned on a stored
    // row in `conversions/dataset-count-measure-empty-field-removed.test.ts`.
    expect(d3!.conversionIds).toEqual(['dataset-count-measure-empty-field-removed']);
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain('dataset-count-measure-empty-field-removed');
    // No key left the shape, so no `${defKey}:${name}` entry is owed.
    expect(RETIRED_KEYS_BY_MAJOR[18]!.filter((k) => /Dataset(Dimension|Measure):field$/.test(k))).toEqual([]);
  });
});
