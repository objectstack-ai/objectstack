/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6505 — `BASE_SCHEMA_RULES` used to declare `visible` / `disabled`
 * "must be a boolean", so every EXPRESSION-valued gate — the authoring form
 * `AGENTS.md` §4 documents and `SchemaRenderer` evaluates — was reported as an
 * invalid schema by the dev-mode validator.
 *
 * The two directions this file exists to hold apart, because a fix that only
 * proves the first is indistinguishable from having DELETED the rule:
 *
 *   1. the false positive is gone — a declared predicate validates;
 *   2. the rule STILL BITES — a value that is neither a boolean nor a declared
 *      predicate is still reported, at its own path, with `INVALID_TYPE`.
 */

import { describe, it, expect } from 'vitest';
import { validateSchema } from '../schema-validator';
import { hasDeclaredPredicate } from '../../evaluator/declaredPredicate';
import { isUnevaluablePredicate } from '../../evaluator/unevaluablePredicate';

/** The two keys this card is about, asserted identically — they are one rule. */
const GATE_KEYS = ['visible', 'disabled'] as const;

/** Every error message the validator produced for `schema.<key>`. */
function gateMessages(key: string, value: unknown): string[] {
  const result = validateSchema({ type: 'button', [key]: value });
  return result.errors.filter((e) => e.path === `schema.${key}`).map((e) => e.message);
}

/**
 * Predicate spellings the runtime ALREADY accepts — `toPredicateInput` folds
 * none of them to `undefined`, so `evaluateCondition` reaches a verdict on each.
 * Named individually rather than as "any string" so a narrowing of the accept
 * set cannot pass by keeping one spelling alive.
 */
const DECLARED_PREDICATES: ReadonlyArray<readonly [string, unknown]> = [
  ['a bare CEL expression (the docs shorthand)', "record.stage == 'closed'"],
  ['a `${…}` template string (AGENTS.md section 4 spelling)', "${record.stage == 'closed'}"],
  ['a `cel` envelope (what `@objectstack/spec` normalizes to)', { dialect: 'cel', source: "record.stage == 'closed'" }],
  ['a non-`cel` envelope (flattened onto the legacy path)', { dialect: 'template', source: '${record.locked}' }],
];

/**
 * The OLD accept set. Kept as its own list, asserted separately, so this file
 * pins that the fix WIDENS rather than moves: every value that validated before
 * still validates.
 */
const BOOLEANS: ReadonlyArray<readonly [string, unknown]> = [
  ['`true`', true],
  ['`false` — a verdict, not an absent gate (objectui#3812)', false],
];

/**
 * Values that are neither a boolean nor a predicate the runtime can evaluate.
 * `hasDeclaredPredicate` answers `false` for the absent and blank ones; the
 * numbers, `{}` and the array it answers `true` for since objectui#11358 —
 * declared gates that cannot be evaluated — and the rule refuses those through
 * `isUnevaluablePredicate`. Either way the rule must keep reporting them. Every
 * entry here was reported BEFORE this fix too: the accept set widens, and
 * nothing that was refused becomes accepted.
 */
const NOT_A_GATE: ReadonlyArray<readonly [string, unknown]> = [
  ['a number', 0],
  ['a truthy number', 1],
  ['`null` — no predicate at all (objectui#3862)', null],
  ['an empty object', {}],
  ['an array', []],
  ['an empty string (objectui#3492 / objectui#3842)', ''],
  ['whitespace-only predicate text (objectui#3960)', '   '],
  ['an empty `cel` envelope (objectui#3850)', { dialect: 'cel', source: '' }],
  ['a blank-`source` envelope (objectui#3960)', { dialect: 'cel', source: '   ' }],
];

describe.each(GATE_KEYS)('#6505 — `%s` accepts every DECLARED predicate spelling', (key) => {
  it.each(DECLARED_PREDICATES)('accepts %s', (_label, value) => {
    expect(gateMessages(key, value)).toEqual([]);
  });

  it.each(BOOLEANS)('still accepts %s — the old accept set is a SUBSET of the new one', (_label, value) => {
    expect(gateMessages(key, value)).toEqual([]);
  });

  it('validates the node this card is named after, end to end', () => {
    const result = validateSchema({ type: 'button', [key]: "${record.stage == 'closed'}" });
    expect(result.valid).toBe(true);
    // The message this card is named after, asserted by NAME rather than by
    // count: `valid: true` alone would also go green on a deleted rule.
    expect(result.errors.map((e) => e.message)).not.toContain(`${key} must be a boolean`);
  });
});

describe.each(GATE_KEYS)('#6505 — the `%s` rule STILL BITES', (key) => {
  it.each(NOT_A_GATE)('reports %s', (_label, value) => {
    const result = validateSchema({ type: 'button', [key]: value });
    expect(result.valid).toBe(false);
    const errors = result.errors.filter((e) => e.path === `schema.${key}`);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('INVALID_TYPE');
    // The message must name BOTH halves of the accept set, or an author reading
    // it learns only the half that did not change.
    expect(errors[0].message).toContain(key);
    expect(errors[0].message).toContain('boolean');
    expect(errors[0].message).toContain('expression');
  });

  it('the rule is still IN the table — a deleted rule reports nothing at all', () => {
    // The forbidden option, pinned as a behaviour: dropping `visible` /
    // `disabled` from `BASE_SCHEMA_RULES` makes this whole describe block go
    // green by reporting NOTHING, so one cell asserts the rule fires at all.
    expect(validateSchema({ type: 'button', [key]: 0 }).errors).not.toHaveLength(0);
  });
});

/**
 * The drift pin. The repo owns ONE definition of "is this a declared
 * predicate?" (objectui#3850) and this validator must not grow a second
 * answer — a hand-rolled twin agreeing today and drifting tomorrow is the
 * defect class this card belongs to.
 */
describe('#6505 — the validator delegates to `hasDeclaredPredicate`, it does not re-answer', () => {
  const ALL = [...DECLARED_PREDICATES, ...BOOLEANS, ...NOT_A_GATE];

  // objectui#11358 split the delegation in two. A present value with no
  // evaluable `source` is now DECLARED (so the runtime fails it instead of
  // reading it as no gate), and this rule asks "can the runtime evaluate it?",
  // so it also asks the runtime's own definition of the unevaluable state —
  // still no answer written in the validator.
  it.each(GATE_KEYS)('the `%s` verdict equals `boolean || (declared && !unevaluable)` for every probe', (key) => {
    for (const [label, value] of ALL) {
      const accepted = gateMessages(key, value).length === 0;
      const expected = typeof value === 'boolean' || (hasDeclaredPredicate(value) && !isUnevaluablePredicate(value));
      expect({ label, accepted }).toEqual({ label, accepted: expected });
    }
  });

  it.each(GATE_KEYS)('`%s`: an `ast`-only envelope is declared, and still refused (objectui#11358)', (key) => {
    // The shape objectui#11358 was filed on. Reading `hasDeclaredPredicate`
    // alone would accept it now; the rule must not.
    const astOnly = { dialect: 'cel', ast: { kind: 'call', fn: '==' } };
    expect(hasDeclaredPredicate(astOnly)).toBe(true);
    expect(gateMessages(key, astOnly)).toHaveLength(1);
  });
});
