/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3871 — `toPredicateInput` must not re-wrap a string that is ALREADY
 * a `${…}` template. This is the producer-side pin for the defect; the
 * consumer-side ones live at the seven action surfaces that compose
 * `evaluateCondition(toPredicateInput(x))` (see the PR's call-site table).
 *
 * ## The defect, measured on `origin/main` @ 230ffd875 before the fix
 *
 * `'${x}'` was wrapped into `'${${x}}'`, which cannot match the evaluator's
 * single-template fast path (`/^\$\{([^}]+)\}$/`, whose `[^}]+` stops at the
 * inner `}`), so it fell to the global replace, where the inner expression
 * `'${x'` does not parse. The author's predicate was then never consulted, and
 * WHICH constant came back depended on the caller's error policy — both
 * directions measured with one probe, same context, same predicate:
 *
 *   template TRUE  | norm="${${user.role === \"admin\"}}" | raw=true  | fail-soft=true | throwOnError=THREW
 *   template FALSE | norm="${${user.role === \"guest\"}}" | raw=false | fail-soft=true | throwOnError=THREW
 *   bare FALSE     | norm="${user.role == \"guest\"}"     | raw=false | fail-soft=false| throwOnError=false
 *
 * So fail-soft callers (`disabled` / `enabled`, and the `visible` legs that do
 * not opt into `throwOnError`) got a constant `true`, and fail-CLOSED callers
 * (`visible` on `action:button` / `action:bar` / `action:menu` /
 * `DeclaredActionsBar`, plus `ActionEngine.getActionsForLocation`) got a throw
 * they turn into a constant "hidden". The issue card predicted constant-true
 * everywhere; the throw direction is the correction this suite pins, because it
 * is the one that hides an action whose predicate HOLDS.
 *
 * ## What each case detects (reverse verification, direction per case)
 *
 * Restore the unconditional wrap and:
 *   • every `toPredicateInput` shape case on a `${…}` input goes RED — they
 *     assert the normalizer's output directly, so neither error policy can
 *     mask them;
 *   • of the verdict cases, the ones whose predicate is TRUE go red under
 *     `throwOnError` and the ones whose predicate is FALSE go red fail-soft.
 *     Both polarities are therefore present on purpose: a suite carrying only
 *     `${false}` cases would have stayed green on the fail-closed sites for the
 *     wrong reason (hidden is hidden, whatever the reason).
 * The bare-expression cases stay GREEN in both directions — the wrap they rely
 * on is untouched, which is the other half of the claim.
 */

import { describe, it, expect } from 'vitest';
import { toPredicateInput } from '../predicateInput';
import { ExpressionEvaluator } from '../ExpressionEvaluator';

const CONTEXT = { user: { role: 'admin' }, record: { status: 'active' } };

const TEMPLATE_TRUE = '${user.role === "admin"}';
const TEMPLATE_FALSE = '${user.role === "guest"}';

describe('toPredicateInput — a bare expression is wrapped (unchanged)', () => {
  it('wraps a bare expression as a `${…}` template', () => {
    expect(toPredicateInput('data.age >= 18')).toBe('${data.age >= 18}');
  });

  it('wraps a bare `source` out of a non-cel envelope', () => {
    expect(toPredicateInput({ dialect: 'template', source: 'data.age >= 18' }))
      .toBe('${data.age >= 18}');
  });

  it('passes a cel envelope through intact (#2661 / #3314)', () => {
    expect(toPredicateInput({ dialect: 'cel', source: 'record.x == 1' }))
      .toEqual({ dialect: 'cel', source: 'record.x == 1' });
  });

  it('keeps the empty / boolean shapes exactly as they were', () => {
    expect(toPredicateInput(true)).toBe(true);
    expect(toPredicateInput(false)).toBe(false);
    expect(toPredicateInput('')).toBeUndefined();
    expect(toPredicateInput(null)).toBeUndefined();
    expect(toPredicateInput(undefined)).toBeUndefined();
    expect(toPredicateInput({ dialect: 'cel', source: '' })).toBeUndefined();
    expect(toPredicateInput('   ')).toBe('${   }');
    // objectui#11358: a present value with no evaluable `source` is no longer
    // folded into `undefined` (absent). It is kept as a `cel` envelope with no
    // `source` — declared, and a fault to the evaluator — and normalizing that
    // again returns the same value (idempotent, as the cases below require).
    expect(toPredicateInput(0)).toEqual({ dialect: 'cel' });
    expect(toPredicateInput({})).toEqual({ dialect: 'cel' });
    expect(toPredicateInput(toPredicateInput({}))).toBe(toPredicateInput({}));
  });
});

describe('toPredicateInput — an already-`${…}` string is already normalized (objectui#3871)', () => {
  it('returns a single-template string untouched instead of double-wrapping it', () => {
    expect(toPredicateInput(TEMPLATE_FALSE)).toBe(TEMPLATE_FALSE);
    expect(toPredicateInput(TEMPLATE_TRUE)).toBe(TEMPLATE_TRUE);
  });

  it('is idempotent — normalizing twice is normalizing once', () => {
    // The property that makes the normalizer safe to compose. Every action
    // surface calls it on a value it did not produce, and `${…}` is one of the
    // shapes it produces, so a non-idempotent normalizer corrupts its own
    // output the moment two call sites are chained.
    const once = toPredicateInput('data.age >= 18');
    expect(toPredicateInput(once)).toBe(once);
    expect(toPredicateInput(toPredicateInput(TEMPLATE_TRUE))).toBe(TEMPLATE_TRUE);
  });

  it('applies the same rule to a template-dialect envelope whose source is a template', () => {
    // The sibling spelling, one line away in the same function: the envelope
    // branch unwraps `source` and reaches the identical wrap.
    expect(toPredicateInput({ dialect: 'template', source: TEMPLATE_FALSE })).toBe(TEMPLATE_FALSE);
    expect(toPredicateInput({ source: TEMPLATE_TRUE })).toBe(TEMPLATE_TRUE);
  });

  it('leaves a multi-part template alone rather than nesting it', () => {
    // Not a predicate in any spelling (`Boolean('a 1 b')` was true before and is
    // true now — no verdict claim is made here). What IS pinned is that the
    // normalizer stops corrupting a string the evaluator can still read, which
    // is why the guard asks `includes('${')` and not an anchored full match.
    expect(toPredicateInput('a ${record.status} b')).toBe('a ${record.status} b');
  });
});

describe('the normalized verdict now equals the raw verdict (objectui#3871)', () => {
  const ev = new ExpressionEvaluator(CONTEXT);

  /** The fail-soft policy: every `disabled` / `enabled` leg, and 3 `visible` legs. */
  const softVerdict = (v: unknown) => ev.evaluateCondition(toPredicateInput(v) as never);

  /**
   * The fail-closed policy (`throwOnError: true`): `visible` on `action:button`
   * / `action:bar` / `action:menu` / `DeclaredActionsBar`, and
   * `ActionEngine.getActionsForLocation`. Their own `catch` turns a throw into
   * "hidden", so a throw here IS the constant those sites served.
   */
  const closedVerdict = (v: unknown) => {
    try {
      return ev.evaluateCondition(toPredicateInput(v) as never, { throwOnError: true });
    } catch {
      return 'THREW';
    }
  };

  const CASES: { what: string; value: unknown; expected: boolean }[] = [
    { what: 'template that holds', value: TEMPLATE_TRUE, expected: true },
    { what: 'template that fails', value: TEMPLATE_FALSE, expected: false },
    { what: 'bare expression that holds', value: 'user.role == "admin"', expected: true },
    { what: 'bare expression that fails', value: 'user.role == "guest"', expected: false },
    { what: 'template-dialect envelope over a template that fails', value: { dialect: 'template', source: TEMPLATE_FALSE }, expected: false },
    { what: 'cel envelope that fails', value: { dialect: 'cel', source: 'record.status == "closed"' }, expected: false },
    { what: 'cel envelope that holds', value: { dialect: 'cel', source: 'record.status == "active"' }, expected: true },
  ];

  it.each(CASES)('$what — same verdict raw, fail-soft and fail-closed', ({ value, expected }) => {
    // The raw value is what `SchemaRenderer`, `page:header` and
    // `ActionRunner`'s two execution gates evaluate; the normalized value is
    // what the seven action surfaces evaluate. objectui#3871 is the record of
    // those two answering differently for one spelling (#3314's shape), so the
    // pin is that all three columns agree.
    expect(ev.evaluateCondition(value as never)).toBe(expected);
    expect(softVerdict(value)).toBe(expected);
    expect(closedVerdict(value)).toBe(expected);
  });

  it('a `${…}` predicate no longer throws on the fail-closed path', () => {
    // Named separately because it is the correction to the issue card's
    // "always visible" prediction: on the five fail-closed sites the double
    // wrap did not read as `true`, it THREW, and each of those sites turns a
    // throw into "hidden" — an action the author gated with a template was
    // invisible even when the gate held.
    expect(() => ev.evaluateCondition(toPredicateInput(TEMPLATE_TRUE) as never, { throwOnError: true }))
      .not.toThrow();
    expect(closedVerdict(TEMPLATE_TRUE)).toBe(true);
  });
});
