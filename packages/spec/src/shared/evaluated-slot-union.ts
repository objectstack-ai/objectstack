// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The evaluated-slot refusal, for a slot declared as a WIDER union (#15811).
 *
 * ## What lives here, and why
 *
 * `EvaluatedExpressionInputSchema` carries its own `error` map, so a slot
 * declared with it answers the published `EVALUATED_EXPRESSION_SOURCE_REQUIRED`
 * sentence for both refused spellings. Five of the 36 evaluated positions are
 * not declared with it alone — they wrap it in a union with something else:
 *
 * - `z.boolean()` beside it on `ui/action.zod.ts` `ActionConditionInputSchema`
 *   (which mounts `Action.visible` and `Action.disabled`) and on
 *   `ui/component.zod.ts` `RecordAlertProps.visible`;
 * - a structured object beside it on `system/metrics.zod.ts`
 *   `ServiceLevelIndicator.successCriteria`;
 * - a structured filter beside it on `system/tracing.zod.ts`
 *   `TraceSamplingConfig.composite[].condition`.
 *
 * On those five the OUTER union folds every branch into one top-level
 * `invalid_union` whose own message is the literal `"Invalid input"`, and the
 * inner union's sentence never reaches the author — measured on #15811, where
 * the four positions refused correctly and said nothing useful about why. The
 * rule is "one rule, one message", so the outer union answers the sentence the
 * slot's own schema would have.
 *
 * ## ⚠️ Deliberately stricter than the inner map it complements
 *
 * `evaluatedExpressionInputRefusal` (private to `expression.zod.ts`) is scoped
 * to a union whose every arm IS an expression, so ANY object input there is an
 * expression the author got wrong. Here the sibling arm is something else
 * entirely, and blaming `source` for a malformed threshold object or a mistyped
 * filter would send the author to the wrong key. So this one answers only for
 * an input that is recognisably an expression attempt: a blank string (a
 * non-blank one is simply accepted by the expression arm), or an object
 * carrying a `dialect` key with no string `source`.
 *
 * ## ⛔ Package-internal — NOT a public export
 *
 * Reachable only from inside `@objectstack/spec`, and deliberately absent from
 * `shared/index.ts` and from the root barrel: it is machinery five declaring
 * sites need, not a contract anyone should author against (the #4001 pitfall —
 * do not export internals only these modules need). `api-surface/` and
 * `export-origins/` must not move for it, which is also what keeps #15811 a
 * pure narrowing: a published export added by a narrowing PR is a widening on
 * a second axis, and the card's ruling declares `Clause-②: no`.
 */

import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from './expression.zod';

export function evaluatedExpressionUnionRefusal(input: unknown): string | undefined {
  if (typeof input === 'string') {
    return input.trim().length > 0 ? undefined : EVALUATED_EXPRESSION_SOURCE_REQUIRED;
  }
  if (input && typeof input === 'object' && !Array.isArray(input) && 'dialect' in input
    && typeof (input as { source?: unknown }).source !== 'string') {
    return EVALUATED_EXPRESSION_SOURCE_REQUIRED;
  }
  return undefined;
}
