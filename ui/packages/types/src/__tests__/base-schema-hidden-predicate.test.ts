// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `BaseSchema.hidden` admits the predicate string the renderer evaluates
 * (objectui#7455, maintainer ruling 2026-09-03: option A, widen).
 *
 * The twin of `base-schema-visible-predicate.test.ts` (#4581) and of
 * `disabled-twin-symmetry-7087.test.ts` (#4580 Q3-A). `hidden` was the third
 * key on the same evaluated path and the only one still declared boolean-only
 * on both faces.
 *
 * ## The evidence
 *
 * `SchemaRenderer`'s `shouldHide` chain does not read this key as a boolean:
 *
 *   ```ts
 *   if (hasDeclaredPredicate(newSchema.hidden)) {
 *     return evaluateVisibilityPredicate(newSchema.hidden, 'hidden');
 *   }
 *   ```
 *
 * `hasDeclaredPredicate` (`packages/core/src/evaluator/declaredPredicate.ts`)
 * is the repo's single shared definition of "declared", asked by all three
 * keys, all three `*On` siblings, `ActionRunner` and `ActionEngine`; the
 * evaluator underneath is declared
 * `(condition: string | boolean | undefined, ...) => boolean`. Predicate
 * strings on `hidden` were already SHIPPED and PINNED — see
 * `packages/react/src/__tests__/SchemaRenderer.hiddenDeclaredGate.test.tsx`,
 * which drove them through a `Record<string, unknown>` helper because the
 * declaration refused them.
 *
 * ## Measured before the change (red-first, on `origin/main` d04e79a80)
 *
 *   • TS  — `base.ts:328` was `hidden?: boolean`.
 *   • zod — `base.zod.ts:175` was `z.boolean()`, and
 *     `BaseSchema.safeParse({ type: 'probe', hidden: '${data.status === "draft"}' })`
 *     returned `success: false`,
 *     `{ code: 'invalid_type', expected: 'boolean', path: ['hidden'] }`,
 *     while the identical string on `visible` parsed. So the zod mirror was NOT
 *     already ahead of TS — both faces refused it.
 *
 * ## What this file pins, and why in this shape
 *
 *   1. Type level — `BaseSchema['hidden']` is EXACTLY
 *      `boolean | ExpressionWire | undefined` (`boolean | string | undefined`
 *      until objectui#7530 declared the envelope), invariantly. `Equal`, not `extends`:
 *      the narrow `boolean` is assignable to the wide union, so a one-way check
 *      stays green on a widening that never happened, and `BaseSchema`'s
 *      `[key: string]: any` index signature meant a DELETED member read `any`
 *      (until objectui#8347), which a one-way check also accepts. The overshoot
 *      was the live risk here, not a hypothetical.
 *   2. The three keys are asserted to carry the SAME declared type. The ruling's
 *      words are "matching `visible` and `disabled` on both faces"; asserting
 *      `hidden` alone would stay green if a later change narrowed one of the
 *      other two, which is the asymmetry this card exists to remove.
 *   3. Runtime (zod face) — the string form and the boolean form both
 *      `safeParse` GREEN in full, and a NUMBER is still refused at path
 *      `hidden`. The refusal is the anti-overshoot guard: `z.any()` would
 *      satisfy every positive case on its own.
 *
 * ## The CEL envelope object — declared since objectui#7530
 *
 * This file used to assert nothing about `{ dialect, source }` in either
 * direction: `hasDeclaredPredicate` accepted it on this key while NO key
 * declared it, and pinning the refusal on `hidden` alone would have pre-empted
 * the ruling on all three. objectui#7530 (ruled 2026-09-04, option A) declared
 * it on all three keys at once through one shared `ExpressionWire`, so the
 * type-level assertion above widened with it; the envelope's own pins —
 * validate-accepts on every key, reuse by reference, twin parity — live in
 * `base-schema-predicate-envelope-7530.test.ts`, and the string-form pins here
 * are unchanged.
 *
 * ADR-0089's carve-out ("the boolean `visible` ... is explicitly out of scope")
 * governs `packages/spec`'s keys, not this surface — `BaseSchema` is objectui's
 * own declaration. It is evidence of intent about the same concept, which is
 * why this was ruled rather than applied mechanically.
 */

import { describe, it, expect } from 'vitest';
import type { BaseSchema } from '../base';
import { BaseSchema as Mirror } from '../zod/base.zod';
import type { ExpressionWire } from '../expression';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── The declared type is exactly what the evaluator accepts ─────────────── */

export type assertionHidden = Expect<
  Equal< BaseSchema['hidden'], boolean | ExpressionWire | undefined >
>;

/** The two siblings, asserted beside it: all three keys carry one type. */
export type assertionHiddenMatchesVisible = Expect<
  Equal< BaseSchema['hidden'], BaseSchema['visible'] >
>;
export type assertionHiddenMatchesDisabled = Expect<
  Equal< BaseSchema['hidden'], BaseSchema['disabled'] >
>;

/* ── Authorable fixtures ─────────────────────────────────────────────────── */

/** The capability the renderer implements, now declared. */
export const hiddenPredicateStringIsAuthorable: BaseSchema = {
  type: 'test-component',
  hidden: 'record.status == "draft"',
};

/** The template-expression spelling the shipped react pins use. */
export const hiddenTemplateExpressionIsAuthorable: BaseSchema = {
  type: 'test-component',
  hidden: '${data.status === "draft"}',
};

/** The boolean form is untouched — this is a widening, not a replacement. */
export const hiddenBooleanIsStillAuthorable: BaseSchema = {
  type: 'test-component',
  hidden: true,
};

/* ── Runtime companion (the zod mirror) ──────────────────────────────────── */

const PREDICATE = '${data.status === "draft"}';

describe('BaseSchema.hidden (objectui#7455)', () => {
  it('type-level: hidden is boolean | string, pinned invariantly against both siblings', () => {
    // Erased at runtime; `tsc -p tsconfig.test.json` is the checker, chained
    // from this package's `type-check` script. The runtime case exists so a
    // green vitest run is not mistaken for the proof.
    expect(hiddenPredicateStringIsAuthorable.hidden).toBe('record.status == "draft"');
    expect(hiddenBooleanIsStillAuthorable.hidden).toBe(true);
  });

  it('zod mirror: a predicate string on `hidden` parses in full', () => {
    const result = Mirror.safeParse({ type: 'test-component', hidden: PREDICATE });
    // Full parse, not just "no unrecognized_keys": this is a judgement about
    // the VALUE, so nothing short of a green `safeParse` measures it.
    expect(result.success).toBe(true);
  });

  it('zod mirror: `visible` and `disabled` take the same string — the control', () => {
    // If these ever go red, the failure is NOT about `hidden`, and the
    // assertion above would have been passing for the wrong reason.
    expect(Mirror.safeParse({ type: 'test-component', visible: PREDICATE }).success).toBe(true);
    expect(Mirror.safeParse({ type: 'test-component', disabled: PREDICATE }).success).toBe(true);
  });

  it('zod mirror: the boolean form still parses — a widening, not a replacement', () => {
    expect(Mirror.safeParse({ type: 'test-component', hidden: true }).success).toBe(true);
    expect(Mirror.safeParse({ type: 'test-component', hidden: false }).success).toBe(true);
  });

  it('zod mirror: a number is still refused at path `hidden` — the anti-overshoot guard', () => {
    // `BaseSchema` is `.passthrough()`, but `hidden` is a DECLARED key, so a
    // wrong-typed value is an `invalid_type` error rather than a passthrough.
    // Without this case, widening the key to `z.any()` would satisfy every
    // positive assertion above.
    const result = Mirror.safeParse({ type: 'test-component', hidden: 123 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'hidden')).toBe(true);
    }
  });
});
