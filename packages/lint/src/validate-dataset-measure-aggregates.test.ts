// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `measure-aggregate-field-type-refused` — the authoring-time door for the
// aggregate × field-type contract (#16354, the lint leg of #16099).
//
// The load-bearing test in this file is `accepts avg over a number field`, and
// the sweep that generalises it (`agrees with the table on every aggregate ×
// every declared FieldType`). A rule that refuses an INCOHERENT pair is easy;
// a rule that refuses only those is the whole product. A false positive here
// fails a build over metadata every backend answers identically, which is
// strictly worse than the gap this rule closes — so the negative controls are
// pinned per class and then swept exhaustively, with a floor on both sides of
// the sweep so a rule that stopped firing (or started firing on everything)
// cannot make the agreement vacuously true.
import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  BOOLEAN_VALUE_TYPES,
  FieldType,
  MULTI_CAPABLE_TYPES,
  NUMERIC_VALUE_TYPES,
  STRUCTURED_JSON_TYPES,
  isAggregateCompatibleWithFieldType,
  isMultiValueField,
} from '@objectstack/spec/data';

import { runAuthoringRules } from './authoring-rules.js';
import {
  DIMENSION_JSON_STORED_FIELD_REFUSED,
  MEASURE_AGGREGATE_FIELD_TYPE_REFUSED,
  validateDatasetMeasureAggregates,
} from './validate-dataset-measure-aggregates.js';

const RULE = MEASURE_AGGREGATE_FIELD_TYPE_REFUSED;

/** Every aggregate the spec table declares a row for. */
const AGGREGATES = Object.keys(AGGREGATE_FIELD_TYPE_COMPATIBILITY);

/**
 * One dataset over one object: a measure applying `aggregate` to a field the
 * object declares as `fieldType`. `fieldType: undefined` declares the field
 * with no `type` at all; `field` overrides which name the measure binds.
 */
const stackWith = (
  aggregate: unknown,
  fieldType: string | undefined,
  overrides: {
    field?: unknown;
    objectName?: string;
    datasetObject?: string;
    fields?: Record<string, unknown>;
  } = {},
): Record<string, unknown> => ({
  name: 'analytics_probe',
  objects: [
    {
      name: overrides.objectName ?? 'crm_opportunity',
      label: 'Opportunity',
      sharingModel: 'private',
      fields: overrides.fields ?? {
        name: { type: 'text' },
        measured: fieldType ? { type: fieldType } : { label: 'Untyped' },
      },
    },
  ],
  datasets: [
    {
      name: 'opportunity_metrics',
      object: overrides.datasetObject ?? overrides.objectName ?? 'crm_opportunity',
      dimensions: [],
      measures: [
        {
          name: 'the_measure',
          aggregate,
          field: 'field' in overrides ? overrides.field : 'measured',
        },
      ],
    },
  ],
});

const findings = (stack: unknown) =>
  validateDatasetMeasureAggregates(stack).filter((f) => f.rule === RULE);

describe('measure-aggregate-field-type-refused — refuses a pair the spec table refuses', () => {
  // The card's own positive control.
  it('refuses the card\'s example: avg over a datetime field', () => {
    const found = findings(stackWith('avg', 'datetime'));
    expect(found).toHaveLength(1);
    const issue = found[0];
    expect(issue.severity).toBe('error');
    expect(issue.rule).toBe(RULE);
    expect(issue.path).toBe('datasets[0].measures[0].aggregate');
    // The author must be able to act without opening the spec: the AGGREGATE,
    // the FIELD, its declared TYPE, and the set that aggregate accepts.
    expect(issue.message).toContain('avg');
    expect(issue.message).toContain('measured');
    expect(issue.message).toContain('datetime');
    for (const accepted of AGGREGATE_FIELD_TYPE_COMPATIBILITY.avg) {
      expect(issue.message, `accepted type ${accepted} named`).toContain(accepted);
    }
    // And the way out, computed from the same table rather than prose: which
    // aggregates WOULD accept a `datetime`.
    expect(issue.hint).toContain('min');
    expect(issue.hint).toContain('max');
    expect(issue.hint).toContain('count_distinct');
    expect(issue.where).toBe('dataset "opportunity_metrics" › measure "the_measure"');
  });

  // The card's third control. `analytics-service.ts` already calls this pair
  // incoherent (`isIncoherentAggregate`), and the spec table refuses it on
  // that predicate's own authority — so it is refused HERE as a contract
  // verdict, beside the advisory one its neighbour raises.
  it('refuses sum over a percent field', () => {
    const found = findings(stackWith('sum', 'percent'));
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('percent');
    expect(found[0].message).toContain('sum');
  });

  it('refuses avg and sum over every member of the temporal class', () => {
    for (const fieldType of ['date', 'datetime', 'time']) {
      for (const aggregate of ['avg', 'sum']) {
        expect(findings(stackWith(aggregate, fieldType)), `${aggregate}(${fieldType})`).toHaveLength(1);
      }
    }
  });

  it('refuses min and max over the classes that have no backend-independent order', () => {
    for (const fieldType of ['text', 'select', 'lookup', 'json', 'autonumber', 'formula']) {
      for (const aggregate of ['min', 'max']) {
        expect(findings(stackWith(aggregate, fieldType)), `${aggregate}(${fieldType})`).toHaveLength(1);
      }
    }
  });
});

describe('measure-aggregate-field-type-refused — stays silent on every pair the table accepts', () => {
  // ⭐ The negative control the card names, and the leg that separates "the
  // rule works" from "the rule fires on everything".
  it('accepts avg over a number field', () => {
    expect(findings(stackWith('avg', 'number'))).toEqual([]);
  });

  it('accepts avg and sum over the numeric class (sum minus the rate)', () => {
    for (const fieldType of NUMERIC_VALUE_TYPES) {
      expect(findings(stackWith('avg', fieldType)), `avg(${fieldType})`).toEqual([]);
      if (fieldType === 'percent') continue; // a rate does not add — refused above
      expect(findings(stackWith('sum', fieldType)), `sum(${fieldType})`).toEqual([]);
    }
  });

  // #11152 (maintainer ruling, 2026-08-28), upheld by decision batch #80:
  // booleans aggregate as NUMBERS on every backend, with no per-aggregate
  // exception. A careless "numeric only" predicate breaks exactly this leg.
  it('accepts every arithmetic and order aggregate over the boolean class', () => {
    for (const fieldType of BOOLEAN_VALUE_TYPES) {
      for (const aggregate of ['sum', 'avg', 'min', 'max']) {
        expect(findings(stackWith(aggregate, fieldType)), `${aggregate}(${fieldType})`).toEqual([]);
      }
    }
  });

  it('accepts min and max over the temporal class — they return the field\'s own type (#15768)', () => {
    for (const fieldType of ['date', 'datetime', 'time']) {
      for (const aggregate of ['min', 'max']) {
        expect(findings(stackWith(aggregate, fieldType)), `${aggregate}(${fieldType})`).toEqual([]);
      }
    }
  });

  it('accepts count over every declared FieldType', () => {
    for (const fieldType of FieldType.options) {
      expect(findings(stackWith('count', fieldType)), `count(${fieldType})`).toEqual([]);
    }
  });

  // [#20808] `count_distinct` over a JSON-stored type left the table's row: no
  // two backends compare those values for equality alike (the in-memory driver
  // counted equal documents apart, SQLite compared serialized text, PostgreSQL
  // answered 500). Every other declared type stays accepted.
  it('accepts count_distinct over every declared FieldType except the JSON-stored ones, which it refuses', () => {
    const jsonStored = ['json', 'composite', 'repeater', 'record', 'location', 'address', 'vector', 'multiselect', 'checkboxes', 'tags'];
    for (const fieldType of FieldType.options) {
      const found = findings(stackWith('count_distinct', fieldType));
      expect(found.length, `count_distinct(${fieldType})`).toBe(jsonStored.includes(fieldType) ? 1 : 0);
    }
    const [issue] = findings(stackWith('count_distinct', 'json'));
    expect(issue.rule).toBe(RULE);
    // The way out names `count`, and no sentence says count_distinct accepts every type.
    expect(issue.hint).toContain('accepts: count.');
    expect(issue.hint).not.toMatch(/count_distinct` accept every type/);
  });
});

describe('measure-aggregate-field-type-refused — the rule IS the table, on every pair', () => {
  // The whole accept/refuse surface, asserted against the one authority rather
  // than against a list retyped here: if the table moves, this test moves with
  // it, and if the rule ever disagrees with the table it fails on the exact
  // pair that diverged.
  it('agrees with isAggregateCompatibleWithFieldType on every aggregate × every declared FieldType', () => {
    let refused = 0;
    let accepted = 0;
    for (const aggregate of AGGREGATES) {
      for (const fieldType of FieldType.options) {
        const fires = findings(stackWith(aggregate, fieldType)).length > 0;
        const tableAccepts = isAggregateCompatibleWithFieldType(aggregate, fieldType);
        expect(fires, `${aggregate}(${fieldType})`).toBe(!tableAccepts);
        if (fires) refused++;
        else accepted++;
      }
    }
    // Floors on BOTH sides, so neither "the rule never fires" nor "the rule
    // fires on everything" can satisfy the equality above vacuously.
    expect(refused).toBeGreaterThan(50);
    expect(accepted).toBeGreaterThan(50);
    expect(refused + accepted).toBe(AGGREGATES.length * FieldType.options.length);
  });
});

describe('measure-aggregate-field-type-refused — never hands the predicate a guess', () => {
  it('is silent when the dataset\'s base object is not in this stack', () => {
    // `validate-object-references.ts` owns an unresolvable base object; one
    // typo must not also yield a type verdict.
    expect(findings(stackWith('avg', 'datetime', { datasetObject: 'not_here' }))).toEqual([]);
  });

  it('is silent when the object declares no readable field map', () => {
    const stack = stackWith('avg', 'datetime') as Record<string, unknown>;
    (stack.objects as Record<string, unknown>[])[0].fields = {};
    expect(findings(stack)).toEqual([]);
  });

  it('is silent when the measure\'s field resolves to nothing — that is dataset-field-unknown\'s finding', () => {
    expect(findings(stackWith('avg', 'datetime', { field: 'nope' }))).toEqual([]);
  });

  it('is silent when the resolved field declares no type', () => {
    expect(findings(stackWith('avg', undefined))).toEqual([]);
  });

  it('is silent when the measure writes no field — a plain count, or a derived measure', () => {
    expect(findings(stackWith('avg', 'datetime', { field: undefined }))).toEqual([]);
    expect(findings(stackWith('count', 'datetime', { field: undefined }))).toEqual([]);
  });

  it('is silent when either position is not a string — the schema owns those', () => {
    expect(findings(stackWith(['avg'], 'datetime'))).toEqual([]);
    expect(findings(stackWith({ fn: 'avg' }, 'datetime'))).toEqual([]);
    expect(findings(stackWith('avg', 'datetime', { field: ['measured'] }))).toEqual([]);
    expect(findings(stackWith('', 'datetime'))).toEqual([]);
  });

  it('is silent for an aggregate outside the table\'s vocabulary — including a prototype key', () => {
    // `AggregationFunction` is a closed enum, so `median` is a schema error and
    // reporting it here would call a vocabulary problem a compatibility one.
    expect(findings(stackWith('median', 'datetime'))).toEqual([]);
    // And the shape that a bare property lookup on the frozen table would have
    // resolved to a function rather than to `undefined`.
    for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(findings(stackWith(key, 'datetime')), key).toEqual([]);
    }
  });

  it('is silent on a stack with no datasets at all, and on a non-record input', () => {
    expect(validateDatasetMeasureAggregates({ objects: [] })).toEqual([]);
    expect(validateDatasetMeasureAggregates(undefined)).toEqual([]);
    expect(validateDatasetMeasureAggregates('not a stack')).toEqual([]);
    expect(validateDatasetMeasureAggregates([])).toEqual([]);
  });
});

describe('measure-aggregate-field-type-refused — the positions only authoring-time resolution can reach', () => {
  /** A dataset whose measure binds a field across a declared relationship hop. */
  const joined = (aggregate: string) => ({
    name: 'analytics_probe',
    objects: [
      {
        name: 'crm_opportunity',
        sharingModel: 'private',
        fields: {
          name: { type: 'text' },
          account: { type: 'lookup', reference: 'crm_account' },
        },
      },
      {
        name: 'crm_account',
        sharingModel: 'private',
        fields: {
          name: { type: 'text' },
          signed_at: { type: 'datetime' },
          arr: { type: 'currency' },
        },
      },
    ],
    datasets: [
      {
        name: 'opportunity_metrics',
        object: 'crm_opportunity',
        include: ['account'],
        dimensions: [],
        measures: [{ name: 'the_measure', aggregate, field: 'account.signed_at' }],
      },
    ],
  });

  // The compile leg returns early on a dotted reference (its declared-type
  // source answers for the base object only). Authoring time has the whole
  // graph, so the LEAF's declared type is a read rather than a guess.
  it('refuses a refused pair on a joined field, which the compile leg cannot judge', () => {
    const found = findings(joined('avg'));
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('account.signed_at');
    expect(found[0].message).toContain('datetime');
    // The message must say which object the LEAF lives on, or the author reads
    // the type as a claim about the dataset's own object.
    expect(found[0].message).toContain('crm_account');
  });

  it('accepts an accepted pair on that same joined field', () => {
    expect(findings(joined('max'))).toEqual([]);
  });

  // [#16340] A registry-injected column is judged on the same axis as an
  // authored one: the graph carries the registry's own definition, so
  // `created_at` reads as the `datetime` it is — and the pair reaches the same
  // backend whether the author declared the column or the platform did.
  it('judges a registry-injected column', () => {
    const stack = stackWith('avg', 'text', { field: 'created_at' });
    const found = findings(stack);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('created_at');
    expect(found[0].message).toContain('datetime');
  });

  it('reports once per refused measure, and once per dataset that has one', () => {
    const stack = {
      name: 'analytics_probe',
      objects: [
        {
          name: 'crm_opportunity',
          sharingModel: 'private',
          fields: { closed_at: { type: 'datetime' }, units: { type: 'number' } },
        },
      ],
      datasets: [
        {
          name: 'a',
          object: 'crm_opportunity',
          dimensions: [],
          measures: [
            { name: 'bad_1', aggregate: 'avg', field: 'closed_at' },
            { name: 'fine', aggregate: 'avg', field: 'units' },
            { name: 'bad_2', aggregate: 'sum', field: 'closed_at' },
          ],
        },
        {
          name: 'b',
          object: 'crm_opportunity',
          dimensions: [],
          measures: [{ name: 'bad_3', aggregate: 'avg', field: 'closed_at' }],
        },
      ],
    };
    const found = findings(stack);
    expect(found.map((f) => f.path)).toEqual([
      'datasets[0].measures[0].aggregate',
      'datasets[0].measures[2].aggregate',
      'datasets[1].measures[0].aggregate',
    ]);
  });
});

describe('measure-aggregate-field-type-refused — reaches the author through the shared registry', () => {
  // The rule exists to reach an author, and it reaches one only if the table
  // every command runs carries it. This is the before/after artifact of #16354
  // made permanent: the same pair, through the same door the CLI uses.
  it('fires through runAuthoringRules on all three commands, and only on the refused pair', () => {
    const stack = stackWith('avg', 'datetime');
    for (const command of ['validate', 'build', 'lint'] as const) {
      const found = runAuthoringRules(command, { normalized: stack, parsed: stack }).filter(
        (f) => f.rule === RULE,
      );
      expect(found, command).toHaveLength(1);
      expect(found[0].severity, command).toBe('error');
    }
    const accepted = stackWith('avg', 'number');
    expect(
      runAuthoringRules('lint', { normalized: accepted, parsed: accepted }).filter(
        (f) => f.rule === RULE,
      ),
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#20890] The declaration half: `count_distinct` over a field declared
// `multiple: true`. The table is per TYPE and accepts `select`; the declaration
// makes it a list stored as JSON, which the compile leg (`400 DATASET_INVALID`)
// and the engine's `count_distinct` door already refuse.
// ───────────────────────────────────────────────────────────────────────────

/** {@link stackWith}, with the measured field declared `multiple: true`. */
const flaggedStackWith = (aggregate: string, fieldType: string): Record<string, unknown> =>
  stackWith(aggregate, fieldType, {
    fields: { name: { type: 'text' }, measured: { type: fieldType, multiple: true } },
  });

describe('measure-aggregate-field-type-refused — reads the declaration, not the type alone', () => {
  // ⭐ The addendum's pin and its control, one pair.
  it('refuses count_distinct over a select declared multiple: true, and accepts it over a single select', () => {
    const found = findings(flaggedStackWith('count_distinct', 'select'));
    expect(found).toHaveLength(1);
    const issue = found[0];
    expect(issue.severity).toBe('error');
    expect(issue.rule).toBe(RULE);
    expect(issue.path).toBe('datasets[0].measures[0].aggregate');
    // The DECLARATION is named, flag included, or the author reads the verdict
    // as a claim about `select` that the table plainly does not make.
    expect(issue.message).toContain('`select` with `multiple: true`');
    expect(issue.message).toContain('none of them with `multiple: true`');
    // The way out is computed from the same predicate: only `count` is left.
    expect(issue.hint).toContain('accepts: count.');

    expect(findings(stackWith('count_distinct', 'select'))).toEqual([]);
  });

  it('refuses count_distinct over every multi-capable type flagged multiple: true, and nothing else moves', () => {
    expect(MULTI_CAPABLE_TYPES.size).toBeGreaterThan(0);
    for (const fieldType of MULTI_CAPABLE_TYPES) {
      expect(findings(flaggedStackWith('count_distinct', fieldType)), `count_distinct(${fieldType}, multiple)`).toHaveLength(1);
      expect(findings(stackWith('count_distinct', fieldType)), `count_distinct(${fieldType})`).toEqual([]);
      // `count` reads no value, flagged or not.
      expect(findings(flaggedStackWith('count', fieldType)), `count(${fieldType}, multiple)`).toEqual([]);
    }
  });

  // The whole flagged surface against the spec's two predicates — the table's
  // row and `isMultiValueField` — never against a list retyped here.
  it('agrees with the table and isMultiValueField on every aggregate × every declared FieldType flagged multiple: true', () => {
    let refused = 0;
    let accepted = 0;
    for (const aggregate of AGGREGATES) {
      for (const fieldType of FieldType.options) {
        const fires = findings(flaggedStackWith(aggregate, fieldType)).length > 0;
        const expected =
          !isAggregateCompatibleWithFieldType(aggregate, fieldType) ||
          (aggregate === 'count_distinct' && isMultiValueField({ type: fieldType, multiple: true }));
        expect(fires, `${aggregate}(${fieldType}, multiple)`).toBe(expected);
        if (fires) refused++;
        else accepted++;
      }
    }
    expect(refused).toBeGreaterThan(50);
    expect(accepted).toBeGreaterThan(50);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#20890] `dimension-json-stored-field-refused` — the dimension leg. The
// analytics door refuses a query that groups by a JSON-stored column
// (`400 INVALID_FIELD`); this is that verdict where the author is standing.
// ───────────────────────────────────────────────────────────────────────────

const DIMENSION_RULE = DIMENSION_JSON_STORED_FIELD_REFUSED;

/**
 * One dataset over one object whose one dimension groups by `grouped`,
 * declared as `fieldDef`. `field` overrides the path the dimension names.
 */
const dimensionStack = (
  fieldDef: Record<string, unknown> | undefined,
  overrides: { field?: unknown; datasetObject?: string } = {},
): Record<string, unknown> => ({
  name: 'analytics_probe',
  objects: [
    {
      name: 'crm_opportunity',
      sharingModel: 'private',
      fields: {
        name: { type: 'text' },
        grouped: fieldDef ?? { label: 'Untyped' },
      },
    },
  ],
  datasets: [
    {
      name: 'opportunity_metrics',
      object: overrides.datasetObject ?? 'crm_opportunity',
      dimensions: [
        { name: 'the_dimension', field: 'field' in overrides ? overrides.field : 'grouped' },
      ],
      measures: [{ name: 'n', aggregate: 'count' }],
    },
  ],
});

const dimensionFindings = (stack: unknown) =>
  validateDatasetMeasureAggregates(stack).filter((f) => f.rule === DIMENSION_RULE);

describe('dimension-json-stored-field-refused — a dimension over a JSON-stored field is refused', () => {
  // ⭐ The card's pin and its control, one pair.
  it('refuses a dimension over a json field, and accepts one over a text field', () => {
    const found = dimensionFindings(dimensionStack({ type: 'json' }));
    expect(found).toHaveLength(1);
    const issue = found[0];
    expect(issue.severity).toBe('error');
    expect(issue.rule).toBe(DIMENSION_RULE);
    expect(issue.path).toBe('datasets[0].dimensions[0].field');
    expect(issue.where).toBe('dataset "opportunity_metrics" › dimension "the_dimension"');
    // The author can act without opening the analytics service: the DIMENSION,
    // the FIELD, its declared TYPE, the class, and what the door answers.
    expect(issue.message).toContain('"the_dimension"');
    expect(issue.message).toContain('"grouped"');
    expect(issue.message).toContain('`json`');
    expect(issue.message).toContain('structured-JSON');
    expect(issue.message).toContain('400 INVALID_FIELD');
    expect(issue.hint).toContain('scalar value');

    expect(dimensionFindings(dimensionStack({ type: 'text' }))).toEqual([]);
    // And a dimension never lands under the measure rule's id.
    expect(findings(dimensionStack({ type: 'json' }))).toEqual([]);
  });

  it('refuses a dimension over every member of STRUCTURED_JSON_TYPES', () => {
    expect(STRUCTURED_JSON_TYPES.size).toBeGreaterThan(0);
    for (const fieldType of STRUCTURED_JSON_TYPES) {
      expect(dimensionFindings(dimensionStack({ type: fieldType })), fieldType).toHaveLength(1);
    }
  });

  // The analytics door's SECOND predicate, which reads the declaration: the
  // same JSON column whether the type is inherently multi or flagged.
  it('refuses a dimension over a multi-value field — inherently multi, or flagged multiple: true — and serves the same type unflagged', () => {
    for (const fieldType of ['multiselect', 'checkboxes', 'tags']) {
      expect(dimensionFindings(dimensionStack({ type: fieldType })), fieldType).toHaveLength(1);
    }
    const [flagged] = dimensionFindings(dimensionStack({ type: 'select', multiple: true }));
    expect(flagged?.message).toContain('`select` with `multiple: true`');
    expect(flagged?.message).toContain('multi-value');
    // The route the door names: filter by one member, never group.
    expect(flagged?.hint).toContain('$contains');
    expect(dimensionFindings(dimensionStack({ type: 'select' }))).toEqual([]);
  });

  // The whole surface against the door's two predicates, read from the spec.
  it('agrees with STRUCTURED_JSON_TYPES and isMultiValueField on every declared FieldType, flagged and not', () => {
    let refused = 0;
    let accepted = 0;
    for (const fieldType of FieldType.options) {
      for (const multiple of [false, true]) {
        const def = multiple ? { type: fieldType, multiple: true } : { type: fieldType };
        const fires = dimensionFindings(dimensionStack(def)).length > 0;
        const expected = STRUCTURED_JSON_TYPES.has(fieldType) || isMultiValueField({ type: fieldType, multiple });
        expect(fires, `${fieldType}${multiple ? ', multiple' : ''}`).toBe(expected);
        if (fires) refused++;
        else accepted++;
      }
    }
    expect(refused).toBeGreaterThan(15);
    expect(accepted).toBeGreaterThan(50);
  });

  it('judges a dimension over a joined field on the object the leaf lives on', () => {
    const joined = (leafType: string) => ({
      name: 'analytics_probe',
      objects: [
        {
          name: 'crm_opportunity',
          sharingModel: 'private',
          fields: { name: { type: 'text' }, account: { type: 'lookup', reference: 'crm_account' } },
        },
        {
          name: 'crm_account',
          sharingModel: 'private',
          fields: { name: { type: 'text' }, hq: { type: leafType } },
        },
      ],
      datasets: [
        {
          name: 'opportunity_metrics',
          object: 'crm_opportunity',
          include: ['account'],
          dimensions: [{ name: 'acct_hq', field: 'account.hq' }],
          measures: [{ name: 'n', aggregate: 'count' }],
        },
      ],
    });
    const found = dimensionFindings(joined('json'));
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('account.hq');
    expect(found[0].message).toContain('crm_account');
    expect(dimensionFindings(joined('text'))).toEqual([]);
  });

  it('never hands the predicates a guess — the same skips as the measure leg', () => {
    // A base object this stack does not define: `validate-object-references.ts`'s.
    expect(dimensionFindings(dimensionStack({ type: 'json' }, { datasetObject: 'not_here' }))).toEqual([]);
    // A path that resolves to nothing: `dataset-field-unknown`'s.
    expect(dimensionFindings(dimensionStack({ type: 'json' }, { field: 'nope' }))).toEqual([]);
    // An untyped field, and a dimension that writes no field / a non-string one.
    expect(dimensionFindings(dimensionStack(undefined))).toEqual([]);
    expect(dimensionFindings(dimensionStack({ type: 'json' }, { field: undefined }))).toEqual([]);
    expect(dimensionFindings(dimensionStack({ type: 'json' }, { field: ['grouped'] }))).toEqual([]);
  });

  it('fires through runAuthoringRules on all three commands, and only on the refused dimension', () => {
    const stack = dimensionStack({ type: 'json' });
    for (const command of ['validate', 'build', 'lint'] as const) {
      const found = runAuthoringRules(command, { normalized: stack, parsed: stack }).filter(
        (f) => f.rule === DIMENSION_RULE,
      );
      expect(found, command).toHaveLength(1);
      expect(found[0].severity, command).toBe('error');
    }
    const control = dimensionStack({ type: 'text' });
    expect(
      runAuthoringRules('lint', { normalized: control, parsed: control }).filter((f) => f.rule === DIMENSION_RULE),
    ).toEqual([]);
  });
});
