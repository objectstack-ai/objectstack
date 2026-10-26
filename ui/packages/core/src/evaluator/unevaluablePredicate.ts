/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Is this value a gate the author DECLARED but the client cannot EVALUATE?
 * (objectui#11358)
 *
 * A predicate gate (`visible` / `hidden` / `enabled` / `disabled` /
 * `condition`) is in one of three states, and this is the one place the third
 * is told apart from the other two:
 *
 *   - **absent** — `null` / `undefined` / `''` / blank predicate text. Nothing
 *     was declared; {@link hasDeclaredPredicate} answers "not declared" (and
 *     reports a blank one, objectui#8069).
 *   - **evaluable** — a boolean, a predicate string, or an envelope whose
 *     `source` is a non-blank string.
 *   - **declared but not evaluable** — anything else that is present: an
 *     envelope with no string `source` (the `ast`-only `{ dialect: 'cel', ast }`
 *     an authoring door can admit), a number (`0`, `42`), an object with no
 *     `source` (`{}`), an array. This function answers `true` for exactly
 *     these.
 *
 * Triage's ruling on objectui#11358 makes the third state "declared and
 * faulting": it is a gate, so it is never "no gate", and it cannot be
 * evaluated, so it takes the path every other faulting predicate takes —
 * reported, and answered with the fail direction its key already has. Before
 * that ruling the normalizer folded it to `undefined`, the same answer as
 * "absent", so every reader showed / enabled / ran it in silence: ADR-0137 D4's
 * "a gate predicate that is blank or faulting is diagnosed, never a silent
 * `true`", broken by a fold.
 *
 * Read by the normalizer ({@link toPredicateInput}, which now keeps the state
 * instead of folding it), the evaluation step
 * (`ExpressionEvaluator.evaluateCondition`, which reports it and answers it as a
 * fault), the canonical predicate helper (`evalFieldPredicate`, which tags its
 * reason) and the dev-mode schema validator (which still refuses it). ⛔ Not
 * re-exported from the package entry: it is the internal definition those four
 * share, not public API.
 *
 * ⚠️ No client-side reading of what an `ast` MEANT: the client evaluates
 * `source` text only, so an `ast` with no `source` is not evaluable here,
 * whatever it says.
 */
export function isUnevaluablePredicate(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean' || typeof value === 'string') return false;
  if (typeof value === 'object') {
    return typeof (value as { source?: unknown }).source !== 'string';
  }
  // A number (`0` included — it is present, not absent), a function, a symbol
  // or a bigint: nothing a predicate is spelled as.
  return true;
}

/**
 * The `reason` reported for a gate that is declared but cannot be evaluated,
 * tagged like an engine reason (`[parse]`, `[type]`, `[blank]`) because it
 * travels the same two channels — `evalFieldPredicate`'s one-time warning and
 * its `onFault` passback — and a caller that routes on the tag must tell it
 * apart from a predicate that faulted with text in it: the fix is to give the
 * gate a `source` (or delete it), never to debug CEL syntax.
 */
export const UNEVALUABLE_PREDICATE_REASON =
  '[unevaluable] the gate is declared but has no `source` to evaluate (an ' +
  '`ast`-only envelope, a number, an object or an array) — it fails in the ' +
  'direction its key fails on any fault';
