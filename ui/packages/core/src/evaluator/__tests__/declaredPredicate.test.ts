/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3850 — the ONE definition of "is a predicate gate declared here?",
 * now that it lives in core beside the normalizer it is derived from. The
 * consumer-side pins are
 * `packages/components/src/renderers/action/__tests__/action-empty-predicate-scope.test.tsx`
 * (the action face, through the `hasDeclaredVisibilityGate` re-export),
 * `packages/react/src/__tests__/SchemaRenderer.disabledDeclaredGate.test.tsx`
 * (objectui#3862, the generic rendering path) and
 * `packages/core/src/actions/__tests__/ActionRunner.disabledGate.test.ts` /
 * `.conditionGate.test.ts` (the execution entry, which asked this scope first).
 *
 * ## What this suite pins that the consumers cannot
 *
 * The consumers can only observe the ANSWER through a rendered control. This one
 * pins the scope itself, one shape per case, plus the two structural claims that
 * keep the scope from drifting again:
 *
 *   • DERIVATION: for every shape except BLANK predicate text,
 *     `hasDeclaredPredicate(x)` is exactly `toPredicateInput(x) !== undefined`.
 *     That equality is the reason this definition is trustworthy — "declared"
 *     means "normalization still leaves something to evaluate", not a hand-rolled
 *     list of empty spellings. A re-spelled predicate that happens to agree on
 *     today's shapes would pass the row cases and fail this one.
 *   • blank predicate TEXT is the single deliberate DIFFERENCE from the
 *     normalizer, in BOTH its spellings — the whitespace-only string (`'   '`,
 *     which the normalizer wraps into `'${   }'`) and the whitespace-only
 *     envelope `source` (`{ dialect: 'cel', source: '   ' }`, which it passes
 *     through because it only folds a `source` of `''`). The disagreement list is
 *     asserted by NAME, so the difference reads as chosen rather than overlooked
 *     and cannot grow silently.
 *
 * ## objectui#3960 — the fourth empty spelling, and how it got here
 *
 * The blank-`source` envelope was found BY this suite: its first draft assumed
 * the normalizer folds it, that assertion went red, and the shape turned out to
 * be a fourth empty spelling outside objectui#3850's three-way enumeration. It
 * was filed and pinned here as a documented residue — `hasDeclaredPredicate`
 * answered "declared" while core's own CEL entry called the same value "no
 * predicate", so `disabled` greyed out and `ActionRunner` refused to execute for
 * a predicate that says nothing. objectui#3960 ruled it in: blankness is now
 * decided for both spellings at once (`isBlankPredicateText`), and the residue
 * case below has become the converged pin, one directory over from the mechanism
 * it used to document.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Two mutations, two predicted directions:
 *
 *   1. narrowing the definition back to the renderer's historic scope
 *      (`value != null && value !== ''`) must turn RED exactly: the empty-envelope
 *      rows (both spellings), both blank-text rows, the blank-`source` envelope
 *      rows, the junk rows, and the derivation case. `''` / `null` / `undefined` /
 *      `true` / `false` / every non-empty expression row stays GREEN — they agreed
 *      under both scopes, which is why the envelope residue survived
 *      objectui#3842 in the first place.
 *   2. reverting objectui#3960 alone (dropping the envelope half of
 *      `isBlankPredicateText`, i.e. `typeof value === 'string' && value.trim() ===
 *      ''`) must turn RED exactly the three blank-`source` envelope rows, the
 *      four-spellings case, the converged case below, and the derivation case
 *      (whose named disagreement list shrinks by those three rows). Everything
 *      else stays GREEN — this half of the change only ever moves a shape from
 *      "declared" to "not declared".
 */

import { describe, it, expect, vi } from 'vitest';
import { hasDeclaredPredicate } from '../declaredPredicate';
import { toPredicateInput } from '../predicateInput';
import { ExpressionEvaluator } from '../ExpressionEvaluator';

/** Every shape the #3850 table measured, plus the boolean verdicts. */
const SHAPES: Array<{ label: string; value: unknown; declared: boolean }> = [
  // ── nothing to evaluate ────────────────────────────────────────────────
  { label: 'undefined (no key)', value: undefined, declared: false },
  { label: 'null', value: null, declared: false },
  { label: "'' (empty predicate)", value: '', declared: false },
  { label: "'   ' (whitespace only)", value: '   ', declared: false },
  { label: "'\\t\\n' (other blanks)", value: '\t\n', declared: false },
  { label: "{ dialect: 'cel', source: '' } (the envelope `objectstack build` emits)", value: { dialect: 'cel', source: '' }, declared: false },
  { label: "{ source: '' } (envelope, no dialect)", value: { source: '' }, declared: false },
  // objectui#3960 — blank predicate text in its ENVELOPE spelling. These three
  // rows were the documented residue of objectui#3850's three-way enumeration
  // (the normalizer folds a `source` of `''` and does not trim), and each takes a
  // different route: the `cel` envelope survives normalization intact, the
  // dialect-less one is unwrapped and wrapped into `'${   }'`, and `'\n'` proves
  // the rule is `trim()` and not a literal-space comparison.
  { label: "{ dialect: 'cel', source: '   ' } (blank source — objectui#3960)", value: { dialect: 'cel', source: '   ' }, declared: false },
  { label: "{ source: '   ' } (blank source, no dialect)", value: { source: '   ' }, declared: false },
  { label: "{ dialect: 'cel', source: '\\n' } (other blanks)", value: { dialect: 'cel', source: '\n' }, declared: false },
  // ── declared, but nothing in it can be evaluated (objectui#11358) ──────
  // These were "not a predicate at all → fail open" until triage's ruling on
  // objectui#11358 made them "declared and faulting". The normalizer keeps
  // them as a `cel` envelope with no `source`, so the derivation below still
  // holds with no new exception.
  { label: '0', value: 0, declared: true },
  { label: '{} (no source)', value: {}, declared: true },
  { label: '[] (array)', value: [], declared: true },
  { label: '{ dialect: "cel" } (envelope with no source key)', value: { dialect: 'cel' }, declared: true },
  { label: "{ dialect: 'cel', ast } (an `ast`-only envelope)", value: { dialect: 'cel', ast: { kind: 'call', fn: '==' } }, declared: true },
  // ── a declared verdict, including the explicit `false` ─────────────────
  { label: 'true', value: true, declared: true },
  { label: 'false (a verdict, not a missing gate — objectui#3812)', value: false, declared: true },
  { label: 'bare CEL expression', value: 'user.role == "admin"', declared: true },
  { label: '`${…}` template', value: '${user.role === "admin"}', declared: true },
  { label: "{ dialect: 'cel', source: 'true' }", value: { dialect: 'cel', source: 'true' }, declared: true },
  { label: "{ dialect: 'template', source: '${x}' }", value: { dialect: 'template', source: '${x}' }, declared: true },
];

describe('hasDeclaredPredicate — the scope objectui#3850 ruled on', () => {
  it.each(SHAPES)('$label → declared=$declared', ({ value, declared }) => {
    expect(hasDeclaredPredicate(value)).toBe(declared);
  });

  it('the four empty spellings are one answer, not four', () => {
    // `''` was objectui#3842's half, the empty envelope objectui#3850's, the
    // whitespace string objectui#3848's, the blank-`source` envelope
    // objectui#3960's. One definition, so they cannot diverge again.
    expect([
      hasDeclaredPredicate(''),
      hasDeclaredPredicate('   '),
      hasDeclaredPredicate({ dialect: 'cel', source: '' }),
      hasDeclaredPredicate({ dialect: 'cel', source: '   ' }),
    ]).toEqual([false, false, false, false]);
  });
});

describe('hasDeclaredPredicate is DERIVED from the normalizer, not re-spelled', () => {
  it('agrees with `toPredicateInput(x) !== undefined` on every shape but BLANK predicate text', () => {
    const disagreements = SHAPES.filter(
      s => hasDeclaredPredicate(s.value) !== (toPredicateInput(s.value) !== undefined),
    ).map(s => s.label);
    // Named, not counted: the deliberate delta from the normalizer is exactly the
    // two spellings of a blank predicate, and this list is what stops a third
    // exception from being added without a reader noticing.
    expect(disagreements).toEqual([
      "'   ' (whitespace only)",
      "'\\t\\n' (other blanks)",
      "{ dialect: 'cel', source: '   ' } (blank source — objectui#3960)",
      "{ source: '   ' } (blank source, no dialect)",
      "{ dialect: 'cel', source: '\\n' } (other blanks)",
    ]);
  });

  it('blank predicate text is what the normalizer wraps or passes through instead of folding', () => {
    // Which is why the definition names both spellings explicitly. The same blank
    // rule already applies on the VALUE side — `evaluateCondition`
    // (`if (!trimmed) return true`), `evaluateCelCondition` (`if (!source.trim())`)
    // and `evalRowPredicate` (`listConditional.ts`).
    expect(toPredicateInput('   ')).toBe('${   }');
    expect(toPredicateInput({ dialect: 'cel', source: '   ' })).toEqual({ dialect: 'cel', source: '   ' });
    expect(toPredicateInput({ source: '   ' })).toBe('${   }');
    expect(toPredicateInput('')).toBeUndefined();
    expect(toPredicateInput({ dialect: 'cel', source: '' })).toBeUndefined();
  });

  it('objectui#3960 CONVERGED: a BLANK envelope `source` is not a declared gate', () => {
    // The documented residue this suite left behind, turned around. The
    // NORMALIZER's contract is deliberately unchanged — it still passes a blank
    // `cel` source through, because "what shape does the evaluator accept" is not
    // the same question as "is there a condition":
    expect(toPredicateInput({ dialect: 'cel', source: '   ' })).toEqual({ dialect: 'cel', source: '   ' });
    // …and core's own CEL entry still calls exactly that value "no predicate":
    const ev = new ExpressionEvaluator({ record: { id: 1 } });
    expect(ev.evaluateCondition({ dialect: 'cel', source: '   ' })).toBe(true);
    // What changed is the half that was inconsistent — declaredness. A blank
    // predicate is blank in both spellings now, so "declared gate + no condition
    // → true" can no longer grey out a control (`disabled`), vanish a node
    // (`hidden`, objectui#3955) or refuse an execution (`ActionRunner`) for a
    // value the metadata never used to say anything.
    expect(hasDeclaredPredicate({ dialect: 'cel', source: '   ' })).toBe(false);
    expect(hasDeclaredPredicate({ source: '   ' })).toBe(false);
    expect(hasDeclaredPredicate({ dialect: 'cel', source: '\n' })).toBe(false);
    // Anti-mutation: "no envelope is ever declared" satisfies every line above.
    // A non-blank source still declares a gate, in either dialect…
    expect(hasDeclaredPredicate({ dialect: 'cel', source: 'false' })).toBe(true);
    expect(hasDeclaredPredicate({ source: 'record.done' })).toBe(true);
    // …and blankness is `trim()`, not "short": one significant character
    // surrounded by whitespace is a predicate.
    expect(hasDeclaredPredicate({ dialect: 'cel', source: ' x ' })).toBe(true);
  });
});

describe('why the question cannot be delegated to the verdict', () => {
  it('evaluateCondition answers `true` for "nothing to evaluate" — which on `disabled` means GREY', () => {
    const ev = new ExpressionEvaluator({ record: { id: 1 } });
    // The inverted default, in four lines. Correct on `visible`/`enabled`,
    // backwards on `disabled` — so every consumer has to ask "declared?" first.
    expect(ev.evaluateCondition(undefined)).toBe(true);
    expect(ev.evaluateCondition('')).toBe(true);
    expect(ev.evaluateCondition('   ')).toBe(true);
    expect(ev.evaluateCondition({ dialect: 'cel', source: '' })).toBe(true);
  });

  it('and truthiness cannot answer it either — `false` is a verdict (objectui#3812)', () => {
    expect(hasDeclaredPredicate(false)).toBe(true);
    const ev = new ExpressionEvaluator({});
    expect(ev.evaluateCondition(false)).toBe(false);
  });
});

/**
 * objectui#11358 — the THIRD state. A present value with no evaluable `source`
 * is neither absent (no gate) nor evaluable: it is declared and faulting.
 *
 * What this block pins, at the layer that tells the three states apart:
 *
 *   • the normalizer keeps the state — a frozen `cel` envelope with no
 *     `source`, never `undefined` — so `hasDeclaredPredicate` answers
 *     "declared" by the same derivation as every other shape;
 *   • the evaluation step treats it as a FAULT: a `throwOnError` caller gets a
 *     throw (its catch is its fail-closed answer and its report), any other
 *     caller gets the fail-soft `true` and ONE `[unevaluable]` report — never
 *     the silent `true` these shapes used to get (ADR-0137 D4);
 *   • `hasDeclaredPredicate` itself reports nothing for it: the declared gate
 *     always goes on to an evaluation, which reports.
 *
 * Reverse verification (predicted before running): restoring the fold
 * (dropping the `isUnevaluablePredicate` line from `toPredicateInput`) turns
 * RED every row of this block and the five rows marked objectui#11358 in the
 * table above; the absent and real-CEL controls stay GREEN.
 */
describe('declared but not evaluable is a fault, not "no gate" (objectui#11358)', () => {
  const UNEVALUABLE: Array<{ label: string; value: unknown }> = [
    { label: "an `ast`-only envelope ({ dialect: 'cel', ast })", value: { dialect: 'cel', ast: { kind: 'call', fn: '==' } } },
    { label: '0', value: 0 },
    { label: '{}', value: {} },
    { label: 'an array', value: ['record.id == 1'] },
  ];

  it.each(UNEVALUABLE)('$label → declared, normalized to a `cel` envelope with no `source`', ({ value }) => {
    expect(hasDeclaredPredicate(value)).toBe(true);
    const normalized = toPredicateInput(value);
    expect(normalized).toEqual({ dialect: 'cel' });
    expect(normalized).not.toHaveProperty('source');
    // One shared, frozen value: a reader's memo sees one input per state, and
    // no reader can learn what the `ast` said from it.
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(toPredicateInput(value)).toBe(normalized);
  });

  it.each(UNEVALUABLE)('$label → a `throwOnError` evaluation throws, on the raw and the normalized value', ({ value }) => {
    const ev = new ExpressionEvaluator({ record: { id: 1 } });
    expect(() => ev.evaluateCondition(value as never, { throwOnError: true })).toThrow(/\[unevaluable\]/);
    expect(() => ev.evaluateCondition(toPredicateInput(value) as never, { throwOnError: true })).toThrow(/\[unevaluable\]/);
  });

  it.each(UNEVALUABLE)('$label → a fail-soft evaluation answers `true` and reports once, as `[unevaluable]`', ({ value }) => {
    const ev = new ExpressionEvaluator({ record: { id: 1 } });
    const onFault = vi.fn();
    expect(ev.evaluateCondition(toPredicateInput(value) as never, { onFault })).toBe(true);
    expect(onFault).toHaveBeenCalledOnce();
    expect(String(onFault.mock.calls[0][0])).toMatch(/^\[unevaluable\] /);
  });

  it('hasDeclaredPredicate reports nothing for it — the evaluation step does', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const { value } of UNEVALUABLE) hasDeclaredPredicate(value);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('controls: absent is still no gate, a real CEL `source` still evaluates', () => {
    const ev = new ExpressionEvaluator({ record: { id: 1 } });
    expect(hasDeclaredPredicate(undefined)).toBe(false);
    expect(toPredicateInput(undefined)).toBeUndefined();
    expect(ev.evaluateCondition(undefined, { throwOnError: true })).toBe(true);
    expect(hasDeclaredPredicate({ dialect: 'cel', source: 'record.id == 1' })).toBe(true);
    expect(ev.evaluateCondition(toPredicateInput({ dialect: 'cel', source: 'record.id == 1' }), { throwOnError: true })).toBe(true);
    expect(ev.evaluateCondition(toPredicateInput({ dialect: 'cel', source: 'record.id == 2' }), { throwOnError: true })).toBe(false);
  });
});
