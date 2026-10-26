/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#10478: the filter-builder mirror's condition judges `value` against
 * `operator` exactly as the protocol's `ViewFilterRuleSchema` does, by
 * delegating to that rule rather than restating its checks.
 *
 * Before: `value: z.any().optional()`, with nothing coupling it to the
 * operator. So `safeValidateSchema`, `objectui check` and `objectui validate`
 * answered green on `{ field: 'amount', operator: 'between', value: 5 }`, an
 * `in` with a scalar, or a value of a type the rule does not take, all of
 * which the protocol's rule refuses.
 *
 * Every refusal below has a lit control accepted by the same schema in the
 * same run, and the differential asserts that it saw acceptances and both
 * kinds of refusal, so no pin can pass by the schema answering one way for
 * everything.
 */
import { describe, it, expect } from 'vitest';
import { VIEW_FILTER_OPERATORS, ViewFilterRuleSchema } from '@objectstack/spec/ui';
import { FilterBuilderConditionSchema, FilterBuilderSchema } from '../zod/complex.zod.js';
import { safeValidateSchema } from '../zod/index.zod.js';

interface Issue { code: string; path: PropertyKey[]; message: string }

const ABSENT = Symbol('absent');

/** The condition as the mirror sees it: with the row `id` it carries. */
function condition(operator: string, value: unknown): Record<string, unknown> {
  const c: Record<string, unknown> = { id: 'c1', field: 'amount', operator };
  if (value !== ABSENT) c.value = value;
  return c;
}

/** The same condition as the protocol's rule sees it: its three keys only. */
function rule(operator: string, value: unknown): Record<string, unknown> {
  const r: Record<string, unknown> = { field: 'amount', operator };
  if (value !== ABSENT) r.value = value;
  return r;
}

const brief = (issues: readonly Issue[]) =>
  issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));

const mirrorIssues = (operator: string, value: unknown) => {
  const r = FilterBuilderConditionSchema.safeParse(condition(operator, value));
  return r.success ? [] : brief(r.error.issues as Issue[]);
};
const specIssues = (operator: string, value: unknown) => {
  const r = ViewFilterRuleSchema.safeParse(rule(operator, value));
  return r.success ? [] : brief(r.error.issues as Issue[]);
};

/** Rows the protocol refuses for their value against their operator. */
const REFUSED_ROWS: ReadonlyArray<readonly [string, unknown]> = [
  ['between', 5],
  ['between', [1, 2, 3]],
  ['between', ['only-one']],
  // The builder's untouched range row: the write path drops it, and the rule
  // refuses it, so an AUTHORED one is refused here too.
  ['between', []],
  ['in', 'x'],
  ['not_in', 'x'],
  ['notIn', 'x'], // an alias: the rule judges the operator after its fold
  ['in', ABSENT],
];

/** Lit controls: the same operators with the value shape the rule takes. */
const ACCEPTED_ROWS: ReadonlyArray<readonly [string, unknown]> = [
  ['between', [1, 9]],
  // A half-filled range as the builder emits it: two bounds, one blank.
  ['between', [0, '']],
  ['in', ['x']],
  ['in', []],
  ['not_in', ['x', 'y']],
  ['equals', 'x'],
  ['is_null', ABSENT],
];

describe('objectui#10478 — the condition refuses what the protocol rule refuses for its value', () => {
  it.each(REFUSED_ROWS.map(([op, v]) => [op, v === ABSENT ? '(absent)' : JSON.stringify(v), v] as const))(
    '`%s` with %s is refused, with the rule\'s own issue on `value`',
    (op, _label, v) => {
      const theirs = specIssues(op, v);
      expect(theirs.length, 'the protocol accepts this row, so it pins nothing').toBeGreaterThan(0);
      const mine = mirrorIssues(op, v);
      expect(mine).toEqual(theirs);
      // Code, path and origin — not the wording, which is the spec's to change.
      expect(mine.map((i) => i.code)).toEqual(['custom']);
      expect(mine.map((i) => i.path)).toEqual(['value']);
    },
  );

  it.each(ACCEPTED_ROWS.map(([op, v]) => [op, v === ABSENT ? '(absent)' : JSON.stringify(v), v] as const))(
    '`%s` with %s is accepted, as the rule accepts it',
    (op, _label, v) => {
      expect(specIssues(op, v)).toEqual([]);
      expect(mirrorIssues(op, v)).toEqual([]);
    },
  );

  it('a value of a type the rule does not take is refused whatever the operator', () => {
    for (const [op, v] of [['equals', { a: 1 }], ['in', [true]], ['between', [[1, 2]]]] as const) {
      const mine = mirrorIssues(op, v);
      expect(mine).toEqual(specIssues(op, v));
      expect(mine.map((i) => `${i.code}@${i.path}`)).toEqual(['invalid_union@value']);
    }
    // Lit control: the same operators with a value of the rule's type.
    expect(mirrorIssues('equals', 'a')).toEqual([]);
  });
});

describe('objectui#10478 — the delegation, not a copy', () => {
  it('the projection is load-bearing: the rule refuses the row `id` the condition carries', () => {
    // The mirror requires `id` (objectui#8415) and the strict rule refuses it,
    // so a mirror that parsed the raw condition through the rule would refuse
    // every valid row. The same object, two verdicts.
    const row = condition('between', [1, 9]);
    expect(FilterBuilderConditionSchema.safeParse(row).success).toBe(true);
    expect(ViewFilterRuleSchema.safeParse(row).success).toBe(false);
    expect(ViewFilterRuleSchema.safeParse(rule('between', [1, 9])).success).toBe(true);
  });

  it('a condition refused for another key carries only that key\'s issue, never a forwarded one', () => {
    // zod runs the object refinement only once every member was accepted, so
    // the rule is never asked about a row the mirror already refused.
    const noField = FilterBuilderConditionSchema.safeParse({ id: 'c1', operator: 'between', value: 5 });
    const badOperator = FilterBuilderConditionSchema.safeParse({ id: 'c1', field: 'a', operator: 'exists', value: 5 });
    const noId = FilterBuilderConditionSchema.safeParse({ field: 'a', operator: 'between', value: 5 });
    expect(noField.success ? [] : noField.error.issues.map((i) => i.path.join('.'))).toEqual(['field']);
    expect(badOperator.success ? [] : badOperator.error.issues.map((i) => i.path.join('.'))).toEqual(['operator']);
    expect(noId.success ? [] : noId.error.issues.map((i) => i.path.join('.'))).toEqual(['id']);
  });

  it('answers exactly as the protocol rule answers, over every operator and value shape in play', () => {
    const operators = [...VIEW_FILTER_OPERATORS, 'notIn', 'nin', 'gt', 'isNull'];
    const values: unknown[] = [
      ABSENT, 'x', '', 5, true, null,
      ['a'], [1, 2], [1, 2, 3], [], [0, ''],
      { a: 1 }, [true], [[1, 2]],
    ];
    let accepted = 0;
    const refusedBy = new Map<string, number>();
    for (const op of operators) {
      for (const v of values) {
        const label = `${op} / ${v === ABSENT ? '(absent)' : JSON.stringify(v)}`;
        const mine = mirrorIssues(op, v);
        const theirs = specIssues(op, v);
        expect(mine, label).toEqual(theirs);
        for (const i of mine) expect(i.path.startsWith('value'), `${label}: an issue off \`value\``).toBe(true);
        if (mine.length === 0) accepted += 1;
        for (const i of mine) refusedBy.set(i.code, (refusedBy.get(i.code) ?? 0) + 1);
      }
    }
    // Not vacuous: it saw acceptances, coupling refusals and type refusals.
    expect(accepted).toBeGreaterThan(0);
    expect(refusedBy.get('custom') ?? 0).toBeGreaterThan(0);
    expect(refusedBy.get('invalid_union') ?? 0).toBeGreaterThan(0);
  });
});

describe('objectui#10478 — the authoring gate reaches a condition wherever it is nested', () => {
  const node = (conditions: unknown[]) => ({
    type: 'filter-builder',
    fields: [{ value: 'amount', label: 'Amount', type: 'number' }],
    value: { id: 'root', logic: 'and', conditions },
  });

  it('`safeValidateSchema` refuses a `between` with a scalar, at that condition\'s `value`', () => {
    const bad = node([{ id: 'c1', field: 'amount', operator: 'between', value: 5 }]);
    const r = safeValidateSchema(bad);
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => `${i.code}@${i.path.join('.')}`))
      .toEqual(['custom@value.conditions.0.value']);
    expect(FilterBuilderSchema.safeParse(bad).success).toBe(false);
    // Lit control: the same document with a real range.
    const good = node([{ id: 'c1', field: 'amount', operator: 'between', value: [5, 10] }]);
    expect(safeValidateSchema(good).success).toBe(true);
    expect(FilterBuilderSchema.safeParse(good).success).toBe(true);
  });

  it('there is no "inside a sub-group" any more: the sub-group itself is refused by name (objectui#9306)', () => {
    // This test used to pin that a condition NESTED in a sub-group was judged
    // like any other (`custom@value.conditions.0.conditions.0.value`). The
    // nesting is retired: a sub-group entry is refused BY NAME at its own path
    // before its rows are read, so the well-formed nested document is refused
    // too, and for the same one reason. The retirement is pinned in
    // `filter-builder-nested-group-retired-9306.test.ts`; what stays here is
    // that the rule this file is about still reaches every row there IS — the
    // same rows, written flat into the one group.
    const issuesOf = (doc: unknown) => {
      const r = FilterBuilderSchema.safeParse(doc);
      return r.success ? [] : r.error.issues.map((i) => `${i.code}@${i.path.join('.')}`);
    };
    for (const value of ['won', ['won']]) {
      const nested = node([{ id: 'g1', logic: 'or', conditions: [{ id: 'c1', field: 'stage', operator: 'in', value }] }]);
      expect(issuesOf(nested)).toEqual(['custom@value.conditions.0']);
    }
    expect(issuesOf(node([{ id: 'c1', field: 'stage', operator: 'in', value: 'won' }])))
      .toEqual(['custom@value.conditions.0.value']);
    expect(issuesOf(node([{ id: 'c1', field: 'stage', operator: 'in', value: ['won'] }]))).toEqual([]);
  });
});
