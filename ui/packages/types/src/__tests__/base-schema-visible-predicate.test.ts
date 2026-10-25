// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `BaseSchema.visible` admits the predicate string the renderer evaluates
 * (objectui#4581).
 *
 * `BaseSchema` declared `visible?: boolean`. The renderer does not treat it as
 * a boolean — `packages/react/src/SchemaRenderer.tsx:382` reads:
 *
 *   ```ts
 *   if (newSchema.visible !== undefined) {
 *     return !evaluator.evaluateCondition(newSchema.visible);
 *   }
 *   ```
 *
 * and `evaluateCondition` is declared
 * `(condition: string | boolean | undefined, context?) => boolean`
 * (`packages/core/dist/evaluator/ExpressionEvaluator.d.ts:143`). So a predicate
 * STRING is a supported, evaluated input — the sibling keys `visibleWhen` and
 * the deprecated `visibleOn` are both `string` for the same reason — and the
 * declared type simply under-reported it. Two fixtures in
 * `packages/react/src/__tests__/SchemaRenderer.expressions.test.tsx` exercised
 * exactly that capability through `as unknown as BaseSchema`; PR #4578 is what
 * made the gap visible, by typing `schema` honestly for the first time.
 *
 * The widening is `boolean | string` — what `evaluateCondition` accepts, no
 * wider. It is authored-input dominant: authors write `visible`, and code that
 * READS `schema.visible` already had to cope with `any` through
 * `BaseSchema`'s index signature.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * Against `origin/main` (`92250d648`), `tsc -p packages/types/tsconfig.test.json`
 * must report:
 *
 *   1. `predicateStringIsAuthorable` — TS2322, `Type 'string' is not
 *      assignable to type 'boolean | undefined'`.
 *   2. `assertionVisible` — `Equal< BaseSchema['visible'], boolean | string |
 *      undefined >` resolves `false`, failing `Expect`'s constraint (TS2344).
 *
 * After the fix both compile clean.
 *
 * `assertionVisible` is INVARIANT on purpose. A `satisfies`-style check, or a
 * one-way `extends`, would be vacuous here in both directions: the narrow
 * `boolean` is assignable to the wide `boolean | string`, so a widening that
 * never happened and a widening that overshot to `any` would both stay green.
 * Pinning the exact union is the only assertion that can go red for the right
 * reason — and `BaseSchema`'s `[key: string]: any` index signature made the
 * overshoot a live risk rather than a hypothetical one (until objectui#8347),
 * since deleting the declared property altogether would have left `visible`
 * typed `any` and every fixture below still compiling.
 *
 * Widened again by objectui#7530 (ruled 2026-09-04, option A): the expression
 * half is now `ExpressionWire` — the string-or-CEL-envelope union — on all three
 * of `visible` / `hidden` / `disabled`, so `assertionVisible` below reads that
 * union. The envelope's own pins live in
 * `base-schema-predicate-envelope-7530.test.ts`; this file keeps the
 * string-form ones.
 */

import { describe, it, expect } from 'vitest';
import type { BaseSchema } from '../base';
import type { ExpressionWire } from '../expression';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── The declared type is exactly what the evaluator accepts ─────────────── */

export type assertionVisible = Expect<
  Equal< BaseSchema['visible'], boolean | ExpressionWire | undefined >
>;

/* ── Authorable fixtures ─────────────────────────────────────────────────── */

/** The capability the renderer implements, now declared. */
export const predicateStringIsAuthorable: BaseSchema = {
  type: 'test-component',
  visible: 'record.status == "open"',
};

/** The template-expression spelling the shipped fixtures use. */
export const templateExpressionIsAuthorable: BaseSchema = {
  type: 'test-component',
  visible: '${data.role === "admin"}',
};

/** The boolean form is untouched — this is a widening, not a replacement. */
export const booleanIsStillAuthorable: BaseSchema = {
  type: 'test-component',
  visible: false,
};

/* ── Runtime companion ───────────────────────────────────────────────────── */

describe('BaseSchema.visible (objectui#4581)', () => {
  it('type-level: visible is boolean | string, pinned invariantly', () => {
    // Erased at runtime; `tsc -p tsconfig.test.json` is the checker, chained
    // from this package's `type-check` script. The runtime case exists so a
    // green vitest run is not mistaken for the proof.
    expect(predicateStringIsAuthorable.visible).toBe('record.status == "open"');
    expect(booleanIsStillAuthorable.visible).toBe(false);
  });
});
