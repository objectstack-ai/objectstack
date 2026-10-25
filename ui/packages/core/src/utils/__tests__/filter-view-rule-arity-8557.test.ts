/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An ARRAY on a single-value operator in the STORED-VIEW arm — objectui#8557.
 *
 * ## The defect
 *
 * `viewFilterRuleToNode` never inspected `rule.value`, so a saved view rule
 * carrying an array on a scalar operator travelled through verbatim:
 *
 *   `toFilterNode([{ field: 'tags', operator: 'equals', value: ['a'] }])`
 *     → `[['tags', 'equals', ['a']]]`
 *     → `parseFilterAST` → `{ tags: ['a'] }`
 *
 * Section 1 pinned that the spec's doors accept that node unjudged (measured
 * against `@objectstack/spec` 17.3.0), which is why the refusal used to arrive
 * two layers away as a `400 INVALID_FILTER` from `driver-sql`, or as an empty
 * list from an in-memory matcher. Since 17.5.0 `parseFilterAST` refuses it
 * itself; section 1 now pins that sibling refusal (objectui#11073).
 *
 * It is the SAME array-in-a-scalar-slot shape objectui#8530 / PR #8551 refused
 * in `convertFiltersToAST`'s object arm. That fix deliberately did not reach
 * here — the two shapes enter the lowering by different doors — so a
 * hand-authored `{ tags: ['a'] }` failed fast with a message naming `$in` while
 * the same mistake SAVED INTO A VIEW stayed silent. This closes that asymmetry.
 *
 * ## The two things the card said must be got right
 *
 * 1. **Keyed on the operator's ARITY, never on `Array.isArray(value)`.** `in`,
 *    `not_in` and `between` legitimately carry arrays through this very
 *    function, and that path had no pin protecting it. Section 3 is that pin,
 *    and it is the axis that separates the fix from "refuse anything
 *    array-shaped". The arity comes from the spec's own exported sets, so this
 *    file also pins (section 4) that the four arity classes PARTITION
 *    `VIEW_FILTER_OPERATORS` exactly — an operator added to the spec falls into
 *    no class, that pin reddens, and someone classifies it.
 * 2. **Where the refusal belongs.** It throws from the lowering. Section 5
 *    records the measurement that made that safe: both sinks already catch a
 *    `FilterOperatorError` from this same file, so a malformed saved view lands
 *    in the list's "filter is malformed" panel — the blast radius the object arm
 *    has had since objectui#8530, not a new one.
 *
 * ## Legs, RUN rather than predicted
 *
 * Applied to the committed implementation, proved on disk both ways, restored
 * by state. Counts and MODES below are measured, not expected.
 *
 *   - **Ablation** (the arm removed): 7 of 16 red — all of section 2 AND
 *     section 5's envelope-parity pin, which this paragraph did not predict.
 *     MODE: no throw at all — `captureRefusal` fails on its own first line,
 *     printing the node that travelled through (`[['tags','equals',['a']]]`),
 *     so nothing downstream of it runs on a stale assumption.
 *   - **Caricature `Array.isArray(value)` alone** (the card's named one, no
 *     arity key): 6 of 16 red, ALL in section 3 — and section 2 stays entirely
 *     green. That is the shape of the warning: the caricature passes every
 *     "the array is now refused" assertion and eats `in` / `not_in` /
 *     `between` with it. MODE: a refusal where a lowering was expected.
 *   - **Caricature "refuse on every known operator"** (the valueless class not
 *     carved out): exactly 1 of 16 red — the `is_null` pin in section 3, the
 *     single assertion written for it, and nothing else.
 *
 * Refusal pins assert the envelope on a CAPTURED error AND the message's first
 * sentence. Envelope-only is not sufficient in this file: objectui#8530 saw
 * `code` + `httpStatus` go green for the wrong reason, on a refusal that was
 * really "Unknown filter operator 0".
 */

import { describe, it, expect } from 'vitest';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import {
  VIEW_FILTER_OPERATORS,
  VIEW_FILTER_LIST_VALUE_OPERATORS,
  VIEW_FILTER_PAIR_VALUE_OPERATORS,
} from '@objectstack/spec/ui';
import { toFilterNode, mergeFilterNodes, FilterOperatorError } from '../filter-converter';

/**
 * Run the lowering and hand back the refusal it raised. Fails on the FIRST
 * line, printing what was produced, when it did not refuse — so no later
 * assertion is silently skipped by a non-throwing lowering.
 */
function captureRefusal(run: () => unknown): FilterOperatorError {
  let caught: unknown;
  let produced: unknown;
  try {
    produced = run();
  } catch (e) {
    caught = e;
  }
  expect(
    caught,
    `expected the lowering to refuse, it produced ${JSON.stringify(produced)}`,
  ).toBeInstanceOf(FilterOperatorError);
  return caught as FilterOperatorError;
}

const rule = (operator: string, value?: unknown) =>
  value === undefined ? { field: 'tags', operator } : { field: 'tags', operator, value };

// ---------------------------------------------------------------------------
// 1. Why the producer refuses first: the spec door judged nothing through 17.4.0
// ---------------------------------------------------------------------------

describe('objectui#8557 — the pre-fix node is judged by the spec door since 17.5.0', () => {
  it('passes isFilterAST, and the lowering now REFUSES its array comparand', () => {
    // Through `@objectstack/spec` 17.4.0 the lowering produced `{ tags: ['a'] }`
    // unjudged. This pin was written to redden the day the spec refused it, and
    // it did at 17.5.0 (objectui#11073): the reader learns the refusal gained a
    // sibling — not that this arm can go.
    const preFixNode = ['tags', 'equals', ['a']];
    expect(isFilterAST(preFixNode)).toBe(true);
    let thrown: unknown;
    try {
      parseFilterAST(preFixNode);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('INVALID_FILTER');
    expect((thrown as Error).message).toMatch(
      /^The implicit-equality comparand on field "tags" requires a single comparable value, but received an array/,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. The refusal — envelope AND first sentence, on a captured error
// ---------------------------------------------------------------------------

describe('objectui#8557 — an array on a single-value operator is refused', () => {
  it('refuses the card`s measured case with the INVALID_FILTER / 400 envelope', () => {
    const err = captureRefusal(() => toFilterNode([rule('equals', ['a'])]));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.httpStatus).toBe(400);
    expect(err.name).toBe('FilterOperatorError');
  });

  it('names the field, the operator and the comparand in its first sentence', () => {
    // Its own block: objectui#8530 measured an envelope pin going green for the
    // wrong reason ("Unknown filter operator 0"), and only the first-sentence
    // assertion discriminated. Separate `it()` so nothing reddens ahead of it.
    const err = captureRefusal(() => toFilterNode([rule('equals', ['a', 'b'])]));
    expect(err.message).toMatch(
      /^\[ObjectUI\] The stored view rule on field 'tags' carries an ARRAY as the comparand of 'equals', which takes a single value: \["a","b"\]\./,
    );
  });

  it('prescribes the spellings that work and says it did not rewrite to `in`', () => {
    const err = captureRefusal(() => toFilterNode([rule('equals', ['a'])]));
    expect(err.message).toContain("{ field: 'tags', operator: 'in', value: [...] }");
    expect(err.message).toContain("'not_in'");
    expect(err.message).toContain("{ operator: 'between', value: [min, max] }");
    expect(err.message).toMatch(/NOT rewritten to 'in'/);
    expect(err.message).toContain('objectui#8557');
    // Not the sibling diagnostics — this is neither an unknown operator, nor a
    // combinator problem, nor the object arm's bare-array refusal.
    expect(err.message).not.toMatch(/Unknown filter operator/);
    expect(err.message).not.toMatch(/combinator/);
    expect(err.message).not.toMatch(/bare ARRAY/);
  });

  it('judges the operator by what it MEANS — an alias is normalized first', () => {
    // `eq` is an alias of `equals`; it must be refused the same way, and the
    // message must name the canonical spelling rather than what was stored.
    const err = captureRefusal(() => toFilterNode([rule('eq', ['a'])]));
    expect(err.message).toContain("comparand of 'equals'");
  });

  it('refuses on every single-value operator the spec declares, not just equals', () => {
    for (const op of ['not_equals', 'contains', 'starts_with', 'greater_than', 'before', 'icontains']) {
      const err = captureRefusal(() => toFilterNode([rule(op, ['a'])]));
      expect(err.code, `operator ${op}`).toBe('INVALID_FILTER');
      expect(err.message, `operator ${op}`).toContain(`comparand of '${op}'`);
    }
  });

  it('refuses the empty array too, and wherever the rule sits', () => {
    // `[]` is exactly as unanswerable as a populated one, and reading it as
    // "no constraint" would widen the result set.
    expect(captureRefusal(() => toFilterNode([rule('equals', [])])).message)
      .toContain("which takes a single value: [].");
    // Mixed source: rules concatenated with URL triples, as ObjectView builds them.
    expect(captureRefusal(
      () => toFilterNode([['stage', '=', 'won'], rule('equals', ['a'])]),
    ).code).toBe('INVALID_FILTER');
    // Through the sink every renderer actually calls.
    expect(captureRefusal(
      () => mergeFilterNodes({ status: 'x' }, [rule('equals', ['a'])]),
    ).message).toContain("field 'tags'");
  });
});

// ---------------------------------------------------------------------------
// 3. NON-regression — the arity axis. This is what separates the fix from
//    "refuse anything array-shaped", and the path the card said had no pin.
// ---------------------------------------------------------------------------

describe('objectui#8557 — array-valued operators keep their arrays', () => {
  it('`in` lowers with its member list intact, through the spec doors', () => {
    const node = toFilterNode([rule('in', ['a', 'b'])]);
    expect(node).toEqual([['tags', 'in', ['a', 'b']]]);
    expect(isFilterAST(node)).toBe(true);
    expect(parseFilterAST(['tags', 'in', ['a', 'b']])).toEqual({ tags: { $in: ['a', 'b'] } });
  });

  it('`not_in` lowers — and so does its `nin` alias, which normalizes into it', () => {
    expect(toFilterNode([rule('not_in', ['a'])])).toEqual([['tags', 'not_in', ['a']]]);
    // The alias is the case a hard-coded `["in", "notIn"]` list gets wrong; the
    // gate reads the NORMALIZED operator, so it cannot.
    expect(toFilterNode([rule('nin', ['a'])])).toEqual([['tags', 'not_in', ['a']]]);
  });

  it('`between` lowers with its [min, max] pair', () => {
    const node = toFilterNode([{ field: 'amount', operator: 'between', value: [1, 10] }]);
    expect(node).toEqual([['amount', 'between', [1, 10]]]);
    expect(isFilterAST(node)).toBe(true);
    expect(parseFilterAST(['amount', 'between', [1, 10]])).toEqual({ amount: { $between: [1, 10] } });
  });

  it('an operator the spec does NOT know is still passed through verbatim', () => {
    // A misspelling is already the loud failure: `normalizeFilterOperator` leaves
    // it alone so `isFilterAST` refuses it and the server names it. Refusing
    // HERE would report "use $in" for what is actually a typo.
    const node = toFilterNode([rule('bogus_op', ['a'])]);
    expect(node).toEqual([['tags', 'bogus_op', ['a']]]);
    expect(isFilterAST(['tags', 'bogus_op', ['a']])).toBe(false);
  });

  it('a valueless operator is not refused — the spec discards its value anyway', () => {
    // Measured: `parseFilterAST(['tags', 'is_null', ['a']])` is
    // `{ tags: { $null: true } }`. The stray array produces no wrong node, so
    // refusing would turn a harmless input into a render-time throw — and would
    // prescribe `in` for an operator that takes no value at all.
    expect(toFilterNode([rule('is_null', ['a'])])).toEqual([['tags', 'is_null', ['a']]]);
    expect(parseFilterAST(['tags', 'is_null', ['a']])).toEqual({ tags: { $null: true } });
  });

  it('an AST GROUP node is not a rule, so the arity gate never sees its array', () => {
    // objectui#8456 (`617707a48`) made `$and` / `$or` lower to real AST group
    // nodes, and a group node carries an ARRAY of children legitimately. It
    // cannot collide with this gate: `isViewFilterRule` requires a plain OBJECT
    // with a non-empty string `field`, and every AST node is an ARRAY — so a
    // group is passed through by `toFilterNode` without ever entering
    // `viewFilterRuleToNode`. Pinned because the two features are one function
    // apart and both are about arrays.
    const group = ['or', ['status', '=', 'open'], ['status', '=', 'blocked']];
    expect(toFilterNode([group])).toEqual([group]);
    // And mixed with a rule that IS lowered, which is how ObjectView builds them.
    expect(toFilterNode([group, { field: 'amount', operator: 'in', value: [1, 2] }]))
      .toEqual([group, ['amount', 'in', [1, 2]]]);
    // The object arm still produces the group, unaffected by this card.
    expect(mergeFilterNodes({ $or: [{ status: 'open' }, { status: 'blocked' }] }))
      .toEqual(group);
  });

  it('scalar values on scalar operators, and valueless rules, are untouched', () => {
    expect(toFilterNode([{ field: 'status', operator: 'equals', value: 'in_progress' }]))
      .toEqual([['status', 'equals', 'in_progress']]);
    // The shipped `showcase_task.in_progress` view — the case objectui#3431 was
    // verified against a real backend.
    expect(toFilterNode([rule('is_empty')])).toEqual([['tags', 'is_empty']]);
    // A blank `field` is still not a rule, so it is still left unlowered.
    expect(toFilterNode([{ field: '', operator: 'equals', value: ['a'] }]))
      .toEqual([{ field: '', operator: 'equals', value: ['a'] }]);
  });
});

// ---------------------------------------------------------------------------
// 4. The arity classes PARTITION the spec's vocabulary — the ratchet
// ---------------------------------------------------------------------------

describe('objectui#8557 — the arity classification cannot drift from the spec', () => {
  it('assigns every VIEW_FILTER_OPERATORS member to exactly one arity class', () => {
    // The list and pair classes are the spec's own exports. The valueless class
    // is the one written out in the source, because the spec exports no set for
    // it — so this pin is what keeps it honest. A new spec operator lands in the
    // scalar remainder by default, which is the REFUSING class, so this pin is
    // also the review trigger for that choice.
    const valueless = ['is_empty', 'is_not_empty', 'is_null', 'is_not_null'];
    const arrayValued: string[] = [
      ...VIEW_FILTER_LIST_VALUE_OPERATORS,
      ...VIEW_FILTER_PAIR_VALUE_OPERATORS,
    ];
    const all = [...VIEW_FILTER_OPERATORS] as string[];

    for (const op of [...valueless, ...arrayValued]) expect(all).toContain(op);
    expect(arrayValued).toEqual(['in', 'not_in', 'between']);

    const scalar = all.filter((op) => !valueless.includes(op) && !arrayValued.includes(op));
    // The refusing class, spelled out. If the spec adds an operator this list
    // changes and the reader has to say which class it belongs to.
    expect(scalar).toEqual([
      'equals', 'not_equals', 'contains', 'not_contains', 'icontains',
      'starts_with', 'ends_with', 'greater_than', 'less_than',
      'greater_than_or_equal', 'less_than_or_equal', 'before', 'after',
    ]);
    // Exact partition: no operator in two classes, none in none.
    expect(scalar.length + valueless.length + arrayValued.length).toBe(all.length);
  });
});

// ---------------------------------------------------------------------------
// 5. Where the refusal lands — the blast radius, as an envelope contract
// ---------------------------------------------------------------------------

describe('objectui#8557 — the throw is the blast radius the object arm already had', () => {
  it('raises the SAME error class and envelope as the object arm`s refusals', () => {
    // `plugin-list`'s `buildEffectiveFilter` and `plugin-view`'s `ObjectView`
    // both call this sink inside their load `try`, and have had to survive a
    // throw from it since objectui#8530. `classifyLoadError` reads this code and
    // status, which is what makes a malformed saved view render as "the filter
    // is malformed" rather than as a network fault (objectui#3066). A bare
    // `Error` here would classify as the latter.
    const fromViewArm = captureRefusal(() => toFilterNode([rule('equals', ['a'])]));
    const fromObjectArm = captureRefusal(() => toFilterNode({ tags: ['a'] }));
    expect(fromViewArm.constructor).toBe(fromObjectArm.constructor);
    expect(fromViewArm.code).toBe(fromObjectArm.code);
    expect(fromViewArm.httpStatus).toBe(fromObjectArm.httpStatus);
    // Same envelope, DIFFERENT diagnosis — the reader must be able to tell which
    // door refused, because the fix differs (a rule to edit vs. a literal).
    expect(fromViewArm.message).toContain('stored view rule');
    expect(fromObjectArm.message).not.toContain('stored view rule');
  });
});
