// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `rollup/non-numeric-aggregand` — the roll-up door.
//
// `FieldSchema.summaryOperations` admits `min`/`max` over ANY child field, and
// `aggregateSummaryValue` (objectql) returns the driver's answer verbatim with
// only an empty-set fallback. A `summary` field is a member of the spec's
// `NUMERIC_VALUE_TYPES`, so `valueSchemaFor` answers `z.number().finite()` for
// it and `driver-sql`'s `createColumn` emits `table.float(name)`. An ordinary
// "latest shipment" roll-up — `max` over a `datetime` child field — therefore
// computes an INSTANT into a column the value contract says holds a finite
// number, and nothing between author and driver correlated the two.
//
// The load-bearing test in this file is `discriminates from the analytics
// table`. The refusal CANNOT be `isAggregateCompatibleWithFieldType`: that
// table deliberately accepts `min`/`max` over the temporal class, because
// there the answer is RETURNED to a caller rather than stored, and it "return[s]
// a value of the field's OWN type (#15768)". Reusing it here would accept the
// very declaration this rule exists to refuse, and the rule would be green
// because it never fires. The two questions look alike and are not:
// "can every backend give one answer" vs "does that answer fit the column this
// roll-up is stored into".
import { describe, expect, it } from 'vitest';
import {
  BOOLEAN_VALUE_TYPES,
  FieldType,
  NUMERIC_VALUE_TYPES,
  isAggregateCompatibleWithFieldType,
} from '@objectstack/spec/data';

import { lintDataModel } from './data-model-rules.js';

const RULE = 'rollup/non-numeric-aggregand';

/** A parent rolling up `fn(child.<field>)`, and a child declaring that field as `childType`. */
const model = (childType: string | undefined, fn = 'max', overrides: Record<string, unknown> = {}) => [
  {
    name: 'invoice',
    fields: {
      name: { type: 'text' },
      rolled_up: {
        type: 'summary',
        summaryOperations: { object: 'invoice_line', field: 'shipped_at', function: fn, ...overrides },
      },
    },
  },
  {
    name: 'invoice_line',
    fields: {
      name: { type: 'text' },
      invoice: { type: 'master_detail', reference: 'invoice', required: true, deleteBehavior: 'cascade' },
      ...(childType ? { shipped_at: { type: childType } } : {}),
    },
  },
];

const findings = (objects: unknown[]) => lintDataModel(objects as any[]).filter((i) => i.rule === RULE);

describe('rollup/non-numeric-aggregand — refuses a min/max roll-up whose answer cannot fit the column', () => {
  it('refuses the card\'s own example: max over a datetime child field', () => {
    const found = findings(model('datetime'));
    expect(found).toHaveLength(1);
    const issue = found[0];
    expect(issue.severity).toBe('error');
    expect(issue.rule).toBe(RULE);
    // The message must let an author act without opening the source: WHICH
    // child object, WHICH field, its DECLARED type, and why the answer cannot
    // be stored.
    expect(issue.message).toContain('invoice_line');
    expect(issue.message).toContain('shipped_at');
    expect(issue.message).toContain('datetime');
    expect(issue.message).toContain('finite number');
    expect(issue.path).toBe('objects[0].fields.rolled_up.summaryOperations.field');
    expect(issue.fix).toBeTruthy();
  });

  it('refuses every member of the temporal class, under both min and max', () => {
    for (const childType of ['date', 'datetime', 'time']) {
      for (const fn of ['min', 'max']) {
        expect(findings(model(childType, fn)), `${fn}(${childType})`).toHaveLength(1);
      }
    }
  });

  it('refuses a text / option / reference child field too', () => {
    for (const childType of ['text', 'select', 'lookup', 'json', 'autonumber']) {
      expect(findings(model(childType)), childType).toHaveLength(1);
    }
  });
});

describe('rollup/non-numeric-aggregand — accepts the classes whose answer IS a number', () => {
  it('accepts the numeric class', () => {
    for (const childType of NUMERIC_VALUE_TYPES) {
      expect(findings(model(childType)), childType).toEqual([]);
    }
  });

  // #11152 (maintainer ruling, 2026-08-28), pinned by the spec's own
  // `AGGREGATION_CASES`: `min(flag)=0` / `max(flag)=1` on six backends. A
  // careless predicate — "numeric only" — breaks exactly this leg.
  it('accepts the boolean class', () => {
    for (const childType of BOOLEAN_VALUE_TYPES) {
      expect(findings(model(childType)), childType).toEqual([]);
    }
  });

  it('accepts exactly the numeric ∪ boolean classes over every declared FieldType', () => {
    const accepted = new Set([...NUMERIC_VALUE_TYPES, ...BOOLEAN_VALUE_TYPES]);
    const refused = FieldType.options.filter((t) => findings(model(t)).length > 0);
    expect(refused.sort()).toEqual(FieldType.options.filter((t) => !accepted.has(t)).sort());
    // A floor, so a future edit that stops the rule firing at all cannot make
    // the equality above vacuously true.
    expect(refused.length).toBeGreaterThan(10);
  });
});

describe('rollup/non-numeric-aggregand — discriminates from the analytics table', () => {
  // ⭐ The assertion that stops someone "simplifying" this rule back into
  // `isAggregateCompatibleWithFieldType`. If this ever fails because the table
  // started refusing the temporal class, that is a spec change to read, not a
  // test to update: the two predicates would then answer the same question.
  it('the analytics table ACCEPTS the temporal pair this rule refuses', () => {
    for (const childType of ['date', 'datetime', 'time']) {
      for (const fn of ['min', 'max']) {
        expect(isAggregateCompatibleWithFieldType(fn, childType), `${fn}(${childType})`).toBe(true);
        expect(findings(model(childType, fn)), `${fn}(${childType})`).toHaveLength(1);
      }
    }
  });

  it('the two agree everywhere else on min/max — the difference is exactly the temporal class', () => {
    const TEMPORAL = new Set(['date', 'datetime', 'time']);
    for (const childType of FieldType.options) {
      const tableAccepts = isAggregateCompatibleWithFieldType('max', childType);
      const doorAccepts = findings(model(childType)).length === 0;
      if (TEMPORAL.has(childType)) continue;
      expect(doorAccepts, `max(${childType})`).toBe(tableAccepts);
    }
  });
});

describe('rollup/non-numeric-aggregand — stays silent where it cannot resolve, and outside its scope', () => {
  // "A consumer that cannot resolve a field's type must NOT call the predicate
  // with a guess" — `aggregate-field-type-compatibility.ts`. A refusal fired on
  // a partially-loaded model would redden an app over metadata never seen.
  it('is silent when the child object is not in the pass\'s object set', () => {
    const objects = model('datetime').slice(0, 1); // parent only — no `invoice_line`
    expect(findings(objects)).toEqual([]);
  });

  it('is silent when the named field is not declared on the child', () => {
    expect(findings(model(undefined))).toEqual([]);
  });

  it('is silent when the child field declares no type', () => {
    const objects = model('datetime') as any[];
    objects[1].fields.shipped_at = { label: 'Shipped At' };
    expect(findings(objects)).toEqual([]);
  });

  it('is silent when summaryOperations names no object or no field', () => {
    expect(findings(model('datetime', 'max', { object: undefined }))).toEqual([]);
    expect(findings(model('datetime', 'max', { field: undefined }))).toEqual([]);
    expect(findings(model('datetime', 'max', { object: '' }))).toEqual([]);
  });

  it('is scoped to min/max — count reads no value off the field', () => {
    expect(findings(model('datetime', 'count'))).toEqual([]);
  });

  // `sum` / `avg` over a non-numeric child is a different shape, whose accept
  // set the analytics table's own rows already exclude, and is deliberately not
  // this rule's. (Nothing in this tree consults that table — an open gap
  // reported with this change, not one this rule silently absorbs.)
  it('does not fire for sum or avg', () => {
    expect(findings(model('datetime', 'sum'))).toEqual([]);
    expect(findings(model('datetime', 'avg'))).toEqual([]);
  });

  it('is silent for a field that is not a summary at all', () => {
    const objects = model('datetime') as any[];
    objects[0].fields.rolled_up.type = 'number';
    expect(findings(objects)).toEqual([]);
  });
});
