// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6227] `ViewFilterRuleSchema.value` is shaped by the rule's OPERATOR.
 *
 * The defect these pins close was a TWO-STAGE failure, not a missing rule:
 * `{ field: 'stage', operator: 'not_in', value: 'won' }` published cleanly and
 * then answered a named 400 `INVALID_FILTER` at query time (#5869 / PR #6209
 * closed that runtime half). The author was gone by then. These pins assert the
 * publish-time half now refuses the same three shapes the runtime refuses —
 * `$in`/`$nin` must be arrays, `$between` must be a 2-array — and, just as
 * importantly, that it refuses NOTHING ELSE (#5685: a schema stricter than the
 * runtime is the wrong side).
 *
 * Every rejection pin asserts the issue PATH and the message's leading sentence,
 * not merely that a throw happened: a bare `.toThrow()` cannot tell "refused for
 * the right reason at the right key" from "refused because the value union
 * rejected the type", and those are different defects (#6142).
 */

import { describe, expect, it } from 'vitest';
import {
  VIEW_FILTER_LIST_VALUE_OPERATORS,
  VIEW_FILTER_OPERATORS,
  VIEW_FILTER_PAIR_VALUE_OPERATORS,
  ViewFilterRuleSchema,
} from './view.zod';

/** Parse helper — the authored object form, exactly as a view carries it. */
const parse = (rule: Record<string, unknown>) => ViewFilterRuleSchema.safeParse(rule);

/** The single `value`-path issue a shape refusal must produce. */
function valueIssue(result: ReturnType<typeof parse>) {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('unreachable');
  const issues = result.error.issues.filter((i) => i.path.join('.') === 'value');
  expect(issues).toHaveLength(1);
  return issues[0]!;
}

describe('#6227 — the reported shape is refused at authoring time', () => {
  it('refuses the card example: a set operator carrying a scalar', () => {
    const result = parse({ field: 'stage', operator: 'not_in', value: 'won' });
    const issue = valueIssue(result);

    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['value']);
    // Leading sentence kept verbatim from the runtime's `nonListComparandError`
    // so one condition keeps one wording across both moments (#5240).
    expect(issue.message).toContain(
      'Operator "not_in" on field "stage" requires an ARRAY of values.',
    );
    // The refusal must carry what the author has to DO, not just what is wrong.
    expect(issue.message).toContain('Received a string ("won")');
    expect(issue.message).toContain('write ["won"] for a single value');
    expect(issue.message).toContain('or use "not_equals" to compare against it');
    // And it must say the empty list is NOT what is being refused.
    expect(issue.message).toContain('An empty list [] is allowed');
  });

  it('names the runtime twin, so the two moments are traceable to one rule', () => {
    const issue = valueIssue(parse({ field: 'stage', operator: 'in', value: 'won' }));
    expect(issue.message).toContain('400 INVALID_FILTER, #5869');
  });

  it('refuses through an ALIAS spelling too — the fold runs before the check', () => {
    // `nin` / `notIn` are stored spellings; `normalizeFilterOperator` folds them
    // to `not_in` pre-check, so the refusal names the CANONICAL operator.
    for (const alias of ['nin', 'notIn', 'notin']) {
      const issue = valueIssue(parse({ field: 'tags', operator: alias, value: 'x' }));
      expect(issue.message).toContain('Operator "not_in"');
    }
  });

  it('refuses a malformed range with the range wording, not the list wording', () => {
    const issue = valueIssue(parse({ field: 'age', operator: 'between', value: 5 }));
    expect(issue.message).toContain(
      'Operator "between" on field "age" requires a [min, max] value array.',
    );
    expect(issue.message).toContain('A range needs exactly two bounds, in order.');
    expect(issue.message).not.toContain('tests membership of a list');
  });
});

describe('#6227 — the three constraints mirror the runtime gate exactly', () => {
  it.each([
    ['in', 'scalar string', 'won'],
    ['in', 'scalar number', 5],
    ['in', 'boolean', true],
    ['in', 'null', null],
    ['in', 'omitted', undefined],
    ['not_in', 'scalar string', 'won'],
    ['not_in', 'omitted', undefined],
  ])('refuses %s + %s', (operator, _label, value) => {
    const rule: Record<string, unknown> = { field: 'f', operator };
    if (value !== undefined) rule.value = value;
    const issue = valueIssue(parse(rule));
    expect(issue.message).toContain('requires an ARRAY of values');
  });

  it.each([
    ['scalar', 5],
    ['one-element array', [1]],
    ['three-element array', [1, 2, 3]],
    ['empty array', []],
    ['null', null],
  ])('refuses between + %s', (_label, value) => {
    const issue = valueIssue(parse({ field: 'f', operator: 'between', value }));
    expect(issue.message).toContain('requires a [min, max] value array');
  });

  it('refuses between with NO value', () => {
    const issue = valueIssue(parse({ field: 'f', operator: 'between' }));
    expect(issue.message).toContain('Received no value ((omitted))');
  });
});

describe('#6227 — what stays accepted (the #5685 side: never stricter than the runtime)', () => {
  it.each([
    ['in + array', { field: 'f', operator: 'in', value: ['a', 'b'] }],
    ['not_in + array', { field: 'f', operator: 'not_in', value: ['a'] }],
    ['in + mixed member types', { field: 'f', operator: 'in', value: ['a', 2] }],
    // An empty list is a DECLARED predicate — "matches nothing" / "matches
    // everything" — and the runtime gate accepts it in as many words.
    ['in + empty array', { field: 'f', operator: 'in', value: [] }],
    ['not_in + empty array', { field: 'f', operator: 'not_in', value: [] }],
    ['between + pair', { field: 'f', operator: 'between', value: [1, 2] }],
    ['between + ISO date pair', { field: 'd', operator: 'between', value: ['2024-01-01', '2024-12-31'] }],
    // A scalar operator carrying an array lowers to a deep-equality comparand.
    ['equals + array', { field: 'f', operator: 'equals', value: ['a', 'b'] }],
    ['not_equals + array', { field: 'f', operator: 'not_equals', value: ['a'] }],
    // A string operator carrying a number: no backend refuses it.
    ['contains + number', { field: 'f', operator: 'contains', value: 5 }],
    ['starts_with + number', { field: 'f', operator: 'starts_with', value: 5 }],
    // Ordering operators take a scalar of any declared type (#5685 widened these).
    ['greater_than + ISO string', { field: 'd', operator: 'greater_than', value: '2026-01-01' }],
    ['before + string', { field: 'd', operator: 'before', value: '2026-01-01' }],
    ['after + string', { field: 'd', operator: 'after', value: '2026-01-01' }],
    // Ordering operators carrying an array are not this check's business either.
    ['greater_than + array', { field: 'f', operator: 'greater_than', value: [1, 2] }],
    // Alias spellings with a CONFORMING value keep parsing.
    ['nin alias + array', { field: 'f', operator: 'nin', value: ['a'] }],
    ['notIn alias + array', { field: 'f', operator: 'notIn', value: ['a'] }],
  ])('accepts %s', (_label, rule) => {
    const result = parse(rule as Record<string, unknown>);
    expect(result.success).toBe(true);
  });

  it.each(['is_empty', 'is_not_empty', 'is_null', 'is_not_null'])(
    'accepts the unary operator %s with OR without a value',
    (operator) => {
      // `convertComparison` maps these to `{ $null: true|false }` and ignores the
      // value position; the ObjectUI client sends a truthy PLACEHOLDER for both
      // `isnull` and `isnotnull`. Refusing a value here would break a live
      // first-party producer to enforce nothing.
      expect(parse({ field: 'f', operator }).success).toBe(true);
      expect(parse({ field: 'f', operator, value: '' }).success).toBe(true);
      expect(parse({ field: 'f', operator, value: true }).success).toBe(true);
      expect(parse({ field: 'f', operator, value: ['x'] }).success).toBe(true);
    },
  );

  it('leaves every operator outside the two shaped vocabularies unjudged', () => {
    const shaped = new Set<string>([
      ...VIEW_FILTER_LIST_VALUE_OPERATORS,
      ...VIEW_FILTER_PAIR_VALUE_OPERATORS,
    ]);
    for (const operator of VIEW_FILTER_OPERATORS) {
      if (shaped.has(operator)) continue;
      // Both a scalar and an array parse for every unshaped operator.
      expect(parse({ field: 'f', operator, value: 'x' }).success).toBe(true);
      expect(parse({ field: 'f', operator, value: ['x'] }).success).toBe(true);
    }
  });
});

describe('#6227 — the exported vocabularies are the ones the check reads', () => {
  it('declares exactly the operators that lower to $in / $nin', () => {
    expect([...VIEW_FILTER_LIST_VALUE_OPERATORS]).toEqual(['in', 'not_in']);
  });

  it('declares exactly the operator that lowers to $between', () => {
    expect([...VIEW_FILTER_PAIR_VALUE_OPERATORS]).toEqual(['between']);
  });

  it('keeps both vocabularies inside the canonical operator enum', () => {
    for (const operator of [
      ...VIEW_FILTER_LIST_VALUE_OPERATORS,
      ...VIEW_FILTER_PAIR_VALUE_OPERATORS,
    ]) {
      expect(VIEW_FILTER_OPERATORS).toContain(operator);
    }
  });
});

describe('#6227 — the refinement does not disturb the schema around it', () => {
  it('still folds alias operators to canonical on a CONFORMING rule', () => {
    const parsed = ViewFilterRuleSchema.parse({ field: 'tags', operator: 'nin', value: ['a'] });
    expect(parsed.operator).toBe('not_in');
  });

  it('still rejects an unknown key by name (the .strict() posture survives)', () => {
    const result = parse({ field: 'f', operator: 'in', value: ['a'], nope: 1 });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues.some((i) => /nope/.test(i.message))).toBe(true);
  });

  it('still rejects an unknown OPERATOR at the operator path, not the value path', () => {
    const result = parse({ field: 'f', operator: 'sideways', value: 'x' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues.some((i) => i.path.join('.') === 'operator')).toBe(true);
  });

  it('reports the VALUE defect at the value path even when the type union also fails', () => {
    // A nested array fails the declared `value` union on TYPE grounds. The rule
    // is still refused, and the union's own issue is what names it — the
    // refinement must not swallow or duplicate that.
    const result = parse({ field: 'f', operator: 'in', value: [['a']] });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues.every((i) => i.path[0] === 'value')).toBe(true);
  });
});
