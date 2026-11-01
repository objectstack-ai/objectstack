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

import {
  lintDataModel,
  lintSummaryRollups as lintSummaryRollupsUnrecorded,
  ROLLUP_NON_NUMERIC_AGGREGAND,
  ROLLUP_UNKNOWN_CHILD_OBJECT,
} from './data-model-rules.js';
import { explainRule } from './rule-explanations.js';

const RULE = 'rollup/non-numeric-aggregand';

// [#22161] Each finding is one verdict sentence; the reasoning it used to carry
// is the id's `os explain` entry. Every call below records what it fired, and
// the last cases in this file hold each recorded verdict of the id to one line
// of at most 200 characters — every child type this suite refuses, not a
// chosen few. Run the whole file: those cases read what the cases above fired.
const fired: Array<{ rule: string; message: string }> = [];
const lintSummaryRollups: typeof lintSummaryRollupsUnrecorded = (...args) => {
  const issues = lintSummaryRollupsUnrecorded(...args);
  fired.push(...issues);
  return issues;
};

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

const findings = (objects: unknown[]) => lintSummaryRollups(objects as any[]).filter((i) => i.rule === RULE);

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

describe('rollup/non-numeric-aggregand — sum / avg judged by the table the engine\'s aggregate door asks', () => {
  // A roll-up recompute is an `engine.aggregate` call, and the engine's
  // aggregate door refuses every pair the aggregate × field-type table refuses
  // — after the child write has committed, on every write of the child. So the
  // sum / avg arms ARE that table, never a second list: the authoring verdict
  // and the recompute verdict cannot disagree.
  it('refuses the card\'s own example: sum over a text child field, naming the field and the route', () => {
    const found = findings(model('text', 'sum'));
    expect(found).toHaveLength(1);
    const issue = found[0]!;
    expect(issue.severity).toBe('error');
    expect(issue.path).toBe('objects[0].fields.rolled_up.summaryOperations.field');
    expect(issue.message).toBe(
      'summary field "invoice.rolled_up" rolls up sum(invoice_line.shipped_at), a text field the engine ' +
        'does not sum: every recompute is refused',
    );
    expect(issue.fix).toBe(
      'Aggregate a child field of type number, currency, rating, slider, progress, summary, boolean or ' +
        "toggle, or use function: 'count'.",
    );
  });

  it('refuses avg over a text child field, with avg\'s own accepted set (percent included)', () => {
    const [issue] = findings(model('text', 'avg'));
    expect(issue?.message).toContain('avg(invoice_line.shipped_at), a text field the engine does not average');
    expect(issue?.fix).toBe(
      'Aggregate a child field of type number, currency, percent, rating, slider, progress, summary, ' +
        "boolean or toggle, or use function: 'count'.",
    );
  });

  it('accepts sum over a number child field (the control)', () => {
    expect(findings(model('number', 'sum'))).toEqual([]);
    expect(findings(model('number', 'avg'))).toEqual([]);
  });

  it('refuses exactly the pairs the table refuses, over every declared FieldType, for both functions', () => {
    for (const fn of ['sum', 'avg']) {
      const refused = FieldType.options.filter((t) => findings(model(t, fn)).length > 0);
      expect(refused.sort(), fn).toEqual(
        FieldType.options.filter((t) => !isAggregateCompatibleWithFieldType(fn, t)).sort(),
      );
      // A floor, so a rule that stops firing cannot make the equality vacuous.
      expect(refused.length, fn).toBeGreaterThan(10);
    }
  });

  it('refuses sum over percent and accepts avg over it — a rate averages but does not add', () => {
    expect(findings(model('percent', 'sum'))).toHaveLength(1);
    expect(findings(model('percent', 'avg'))).toEqual([]);
  });
});

describe('rollup/unknown-child-object — a roll-up from an object the deployment does not have', () => {
  const unknownChild = (objects: unknown[], deployed?: string[]) =>
    lintSummaryRollups(objects as any[], deployed ? { deployedObjectNames: new Set(deployed) } : {})
      .filter((i) => i.rule === ROLLUP_UNKNOWN_CHILD_OBJECT);
  const parentOnly = () => model('number', 'sum').slice(0, 1);

  it('refuses a child named nowhere in the deployment, at the object key', () => {
    const found = unknownChild(parentOnly(), ['invoice']);
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe('error');
    expect(found[0]!.path).toBe('objects[0].fields.rolled_up.summaryOperations.object');
    expect(found[0]!.message).toBe(
      'summary field "invoice.rolled_up" rolls up from "invoice_line", which names no object in this ' +
        'deployment: the roll-up reads nothing',
    );
  });

  it('admits a child the deployment has outside the walked objects (a package outside the closure)', () => {
    expect(unknownChild(parentOnly(), ['invoice', 'invoice_line'])).toEqual([]);
  });

  it('admits a child the walked objects carry, whatever the deployment set says', () => {
    expect(unknownChild(model('number', 'sum'), [])).toEqual([]);
  });

  it('is silent when the deployment\'s object names are not stated — the CLI, one app', () => {
    expect(unknownChild(parentOnly())).toEqual([]);
  });
});

describe('rollup/non-numeric-aggregand — stays silent where it cannot resolve, and outside its scope', () => {
  // "A consumer that cannot resolve a field's type must NOT call the predicate
  // with a guess" — `aggregate-field-type-compatibility.ts`. A refusal fired on
  // a partially-loaded model would redden an app over metadata never seen.
  it('is silent on the aggregand when the child object is not in the pass\'s object set', () => {
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

  it('never judges count — count reads no value off the field', () => {
    for (const childType of ['datetime', 'text', 'json']) {
      expect(findings(model(childType, 'count')), childType).toEqual([]);
    }
  });

  it('is silent for a field that is not a summary at all', () => {
    const objects = model('datetime') as any[];
    objects[0].fields.rolled_up.type = 'number';
    expect(findings(objects)).toEqual([]);
  });

  it('is no longer `lintDataModel`\'s — the gate entry reports it under `os lint`, once', () => {
    expect(lintDataModel(model('datetime') as any[]).filter((i) => i.rule.startsWith('rollup/'))
      .filter((i) => i.rule !== 'rollup/missing-summary')).toEqual([]);
  });
});

describe('[#22161] one-line verdicts — rollup/non-numeric-aggregand', () => {
  it('the published constant spells the id the findings carry', () => {
    expect(ROLLUP_NON_NUMERIC_AGGREGAND).toBe(RULE);
  });

  it('reads as one sentence: the roll-up, the child type, and why the answer does not fit', () => {
    const [issue] = findings(model('datetime'));
    expect(issue!.message).toBe(
      'summary field "invoice.rolled_up" rolls up max(invoice_line.shipped_at), a datetime field: max ' +
        "answers in the child field's own type, but a summary field stores a finite number",
    );
  });

  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === RULE);
    // The coverage control first: the id fired, over more than one child type.
    expect(new Set(converted.map((f) => f.message)).size).toBeGreaterThan(1);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(RULE);
    expect(entry, 'no `os explain rollup/non-numeric-aggregand` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of [
      '`NUMERIC_VALUE_TYPES`',
      'the CHILD field\'s own type',
      'the boolean ones',
      'analytics aggregate table',
      '`count` reads no value',
      'does not resolve in this stack',
      'after the child write has committed',
      '`sum` over a `percent`',
      '`valid: false`',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('`os explain rollup/unknown-child-object` says where it is judged and why the CLI does not', () => {
    expect(ROLLUP_UNKNOWN_CHILD_OBJECT).toBe('rollup/unknown-child-object');
    const entry = explainRule(ROLLUP_UNKNOWN_CHILD_OBJECT);
    expect(entry, 'no `os explain rollup/unknown-child-object` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of ['publish gate only', 'still exists', 'judge one app', 'publish it first']) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });
});
