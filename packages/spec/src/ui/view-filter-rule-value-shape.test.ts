// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6227] `ViewFilterRuleSchema.value` is shaped by the rule's OPERATOR.
 *
 * The defect these pins close was a TWO-STAGE failure, not a missing rule:
 * `{ field: 'stage', operator: 'not_in', value: 'won' }` published cleanly and
 * then answered a named 400 `INVALID_FILTER` at query time (#5869 / PR #6209
 * closed that runtime half). The author was gone by then. These pins assert the
 * publish-time half now refuses the same shapes the runtime refuses —
 * `$in`/`$nin` must be arrays, `$between` must be a 2-array — and, just as
 * importantly, that it refuses NOTHING ELSE (#5685: a schema stricter than the
 * runtime is the wrong side).
 *
 * [#19514] The SCALAR arm joined them, and it moved three pins in this file from
 * the accepted side to the refused side. It is not an extension of #6227's
 * reasoning but a correction of one of its readings: an array on a scalar
 * operator was recorded here as accepted because it 「lowers to a bare
 * deep-equality comparand, which every backend answers」, and re-measurement
 * found the opposite. The four backends a lowered view rule reaches do not
 * agree at this change: the SQL family (`driver-sql`, the `driver-turso` /
 * `driver-sqlite-wasm` drivers built on it, and turso's remote transport) and
 * `driver-memory` REFUSE the comparand with `INVALID_FILTER`;
 * `@objectstack/formula`'s matcher EXCLUDES every row; and `driver-mongodb`
 * ANSWERS — it passes the array through to the server, where MongoDB's
 * equality rule for an array operand selects a row whose stored array equals
 * `['a']` or holds `['a']` as an element, and not a row storing the scalar
 * `'a'` (read at the driver's compile face, at the engine's shared comparand
 * doors and through mingo 7.2.4; a live `mongod` cell is NOT MEASURED). None
 * of the four reads the array as the scalar the operator declares, so a view
 * carrying it gets a 400 or no rows on three of them and, on MongoDB, rows
 * chosen by a predicate the rule never wrote. The pins below carry both
 * directions of that arm, and the carve-outs
 * (an absent value, the four valueless operators) keep their
 * own pins, because the #5685 side of this file is what stops a narrowing from
 * running on past the query path.
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

/**
 * The operators whose value position is discarded downstream — they take their
 * direction from the operator NAME. Transcribed here rather than imported
 * because the schema keeps its copy PRIVATE on purpose (publishing it would
 * enlarge the package's public face for a question only the refinement asks),
 * and the sweep below is what holds the two lists equal: an operator dropped
 * from the schema's set reddens the array half of the sweep, and one added to
 * it reddens the carve-out pin.
 */
const VALUELESS_OPERATORS = ['is_empty', 'is_not_empty', 'is_null', 'is_not_null'] as const;

/**
 * Every operator this check judges as taking a SCALAR — the canonical
 * vocabulary minus the list set, the range set and the four above. DERIVED, so
 * an operator added to the enum arrives in both directions of the sweep instead
 * of quietly skipping it.
 */
const UNSHAPED_VALUE_OPERATORS: readonly string[] = VIEW_FILTER_OPERATORS.filter(
  (operator) =>
    !(
      [
        ...VIEW_FILTER_LIST_VALUE_OPERATORS,
        ...VIEW_FILTER_PAIR_VALUE_OPERATORS,
        ...VALUELESS_OPERATORS,
      ] as readonly string[]
    ).includes(operator),
);

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
    // The traceable token is the runtime's ERROR CODE, not a tracker id — the
    // code is what an author sees on the query path and can match this refusal
    // against. The id that used to ride beside it resolved to nothing for the
    // customer this string is printed to.
    expect(issue.message).toContain('400 INVALID_FILTER');
  });

  it('carries no internal tracker id — the reader of this string cannot open one', () => {
    const issue = valueIssue(parse({ field: 'stage', operator: 'in', value: 'won' }));
    expect(issue.message).not.toMatch(/(?<![#&])#[0-9]{3,5}(?![0-9A-Za-z])/);
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
    // A string operator carrying a number: none of the four backends a lowered
    // view rule reaches refuses it (`driver-sql` on SQLite and `driver-memory`
    // answer it, `driver-mongodb` compiles it, the formula matcher excludes
    // every row). (`icontains` is the one exception and it is the TABLE's row,
    // not an analogy — see the comparand pins below.)
    ['contains + number', { field: 'f', operator: 'contains', value: 5 }],
    ['starts_with + number', { field: 'f', operator: 'starts_with', value: 5 }],
    // Ordering operators take a scalar of any declared type (#5685 widened these).
    ['greater_than + ISO string', { field: 'd', operator: 'greater_than', value: '2026-01-01' }],
    ['before + string', { field: 'd', operator: 'before', value: '2026-01-01' }],
    ['after + string', { field: 'd', operator: 'after', value: '2026-01-01' }],
    // A scalar operator with NO value: `value` is optional and absence is not a
    // shape. The scalar arm must not turn an omitted comparand into a refusal.
    ['equals + omitted', { field: 'f', operator: 'equals' }],
    ['greater_than + omitted', { field: 'd', operator: 'greater_than' }],
    // Every scalar type the declared union carries still parses on a scalar operator.
    ['equals + null', { field: 'f', operator: 'equals', value: null }],
    ['equals + boolean', { field: 'f', operator: 'equals', value: false }],
    ['equals + empty string', { field: 'f', operator: 'equals', value: '' }],
    ['equals + zero', { field: 'f', operator: 'equals', value: 0 }],
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

  it('takes a SCALAR on every operator outside the list, range and valueless sets', () => {
    // [#19514] The sweep that used to read "both a scalar and an array parse"
    // for these operators. The scalar half is unchanged and is the half this
    // assertion protects: a narrowing that made the common shape refuse would
    // fail here before it reached a consumer. The array half moved and has its
    // own two-directional sweep below.
    for (const operator of UNSHAPED_VALUE_OPERATORS) {
      expect(parse({ field: 'f', operator, value: 'x' }).success, operator).toBe(true);
    }
  });
});

describe('#19514 — the scalar arm, in both directions', () => {
  /** The three pins this arm MOVED, named as such so the reversal is legible. */
  it.each([
    ['equals + array', { field: 'f', operator: 'equals', value: ['a', 'b'] }, 'equals'],
    ['not_equals + array', { field: 'f', operator: 'not_equals', value: ['a'] }, 'not_equals'],
    ['greater_than + array', { field: 'f', operator: 'greater_than', value: [1, 2] }, 'greater_than'],
  ])('refuses %s — recorded as ACCEPTED at #6227, reversed on measurement', (_label, rule, operator) => {
    const issue = valueIssue(parse(rule as Record<string, unknown>));
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['value']);
    expect(issue.message).toContain(`Operator "${operator}" on field "f" requires a SCALAR value.`);
    // Not the list wording and not the range wording — three arms, three
    // diagnoses, and an author must be able to tell which one fired.
    expect(issue.message).not.toContain('requires an ARRAY of values');
    expect(issue.message).not.toContain('requires a [min, max] value array');
    // The refusal carries what to DO.
    expect(issue.message).toContain('to compare against one value');
    expect(issue.message).toContain('or use "in" to test membership of the list');
  });

  it('prescribes the author OWN first member, not a canned example', () => {
    const issue = valueIssue(parse({ field: 'stage', operator: 'equals', value: ['won', 'lost'] }));
    expect(issue.message).toContain('Received an array of 2 (["won","lost"])');
    expect(issue.message).toContain('write "won" to compare against one value');
  });

  it('has something to say about an EMPTY array too, where there is no first member', () => {
    const issue = valueIssue(parse({ field: 'stage', operator: 'equals', value: [] }));
    expect(issue.message).toContain('Received an array of 0 ([])');
    expect(issue.message).toContain('write the value to compare against');
  });

  it('names the two vocabularies from the exported sets, not from a transcription', () => {
    const issue = valueIssue(parse({ field: 'f', operator: 'equals', value: ['a'] }));
    for (const operator of VIEW_FILTER_LIST_VALUE_OPERATORS) expect(issue.message).toContain(`"${operator}"`);
    for (const operator of VIEW_FILTER_PAIR_VALUE_OPERATORS) expect(issue.message).toContain(`"${operator}"`);
  });

  it('carries no internal tracker id — the reader of this string cannot open one', () => {
    const issue = valueIssue(parse({ field: 'f', operator: 'equals', value: ['a'] }));
    expect(issue.message).not.toMatch(/(?<![#&])#[0-9]{3,5}(?![0-9A-Za-z])/);
  });

  it('sweeps every unshaped operator: an array REFUSES, a scalar ACCEPTS', () => {
    // The two-directional sweep. A one-directional one would stay green if the
    // arm refused everything, which is the failure an inert door looks like.
    expect(UNSHAPED_VALUE_OPERATORS.length).toBeGreaterThan(0);
    for (const operator of UNSHAPED_VALUE_OPERATORS) {
      expect(parse({ field: 'f', operator, value: ['x'] }).success, `${operator} + array`).toBe(false);
      expect(parse({ field: 'f', operator, value: 'x' }).success, `${operator} + scalar`).toBe(true);
    }
  });

  it('leaves the four VALUELESS operators alone, array included', () => {
    // The carve-out that keeps this narrowing from running past the query path:
    // `convertComparison` maps these to `{ $null: true|false }` and discards the
    // value position, and the ObjectUI client sends a truthy PLACEHOLDER there.
    for (const operator of VALUELESS_OPERATORS) {
      expect(parse({ field: 'f', operator, value: ['x'] }).success, operator).toBe(true);
      expect(parse({ field: 'f', operator, value: 'x' }).success, operator).toBe(true);
      expect(parse({ field: 'f', operator }).success, operator).toBe(true);
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
