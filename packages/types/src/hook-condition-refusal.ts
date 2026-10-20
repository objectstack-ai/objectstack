// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24662] Recognising, at an HTTP boundary, a write that an authored hook
 * `condition` refused because the condition could not be evaluated on the
 * record it was judging.
 *
 * `HookConditionError` (`@objectstack/objectql`, `hook-wrappers.ts`) is the
 * fail-closed answer ADR-0058's 2026-08 addendum gives an unevaluable write
 * gate (#4775): the operation is aborted and nothing is written. It carries no
 * `status` and no `code`, deliberately — its docblock rules that a fact on it
 * reaches the wire through the ADR-0112 vocabulary as a decision, never as a
 * property that happens to be named `code`. So, exactly as for the
 * record-validation shape (`validation-failure.ts`), deciding what status it
 * means is the job of whichever boundary serves it. No boundary decided, so
 * it fell to the unclassified terminal on every door: `500 INTERNAL_ERROR`,
 * read by a client as "the server fell over", and logged as
 * `[REST] Unhandled error`.
 *
 * ## The answer: `400`, and the catalog member `400` names
 *
 * The nearest landed precedent is the condition's own sibling in that
 * addendum's table: an object validation predicate that cannot be evaluated
 * (#4649). Measured on the `/data` write door, it answers `400` (code
 * `VALIDATION_FAILED`, a per-field envelope naming the rule with
 * `constraint.reason: 'unevaluable'`), and its message is built by the same
 * `cel-fault.ts` sentence this class's message is built by. So the status is
 * the sibling's: the refusal turned on THIS record's values, a different
 * record can pass the same condition, and retrying the same request cannot.
 *
 * The code is NOT the sibling's `VALIDATION_FAILED`, whose contract is the
 * per-field `fields[]` envelope a form maps onto its inputs; a hook's gate
 * addresses no field. It is `standardErrorCodeForHttpStatus(400)` —
 * `VALIDATION_ERROR`, the `StandardErrorCode` member ADR-0112's status map
 * names for a `400` whose producer declared no more specific code, and the
 * code a batch row and the nested-envelope doors already derive for an
 * un-coded `400` refusal. No code is minted and no ledger row is added.
 *
 * Why no new code: a consumer branches on it exactly as it branches on a
 * generic `400` — do not retry the same request, show the message. The
 * finer fact ("the author's expression faulted, not your input") already has
 * a discriminator on the sibling (`constraint.reason`) and no consumer was
 * found branching on it, so it gives no branch a new top-level code would
 * serve.
 *
 * ## Why `unevaluable` only
 *
 * The class has two `reason`s. `uncompilable` — the condition never compiled —
 * does not turn on the request at all: every write to the object fails until
 * an author fixes the metadata, the gate already logs it at `error` when it is
 * bound, and its message quotes the condition SOURCE, which no sibling
 * refusal puts on the wire. It keeps the sanitised `500` it has today. Only a
 * condition that compiled and then faulted on the record it was handed is a
 * refusal of THIS request.
 *
 * ## Recognised by declared name and field, never by prose
 *
 * `@objectstack/types` cannot import `@objectstack/objectql` (the arrow points
 * the other way), so the class is recognised the way its siblings are: by its
 * declared `name` and by its declared `reason` field, both read off the
 * producer. ⛔ Never by its message text.
 *
 * ## Read by two rules, so the doors answer one throw alike
 *
 *  - `resolveThrownHttpError` (`thrown-http-error.ts`) — the rule the runtime
 *    dispatcher's exits, both Hono doors and the batch rows read. The shape is
 *    a declaration there, as the validation shape is: status `400` and the
 *    code that status names.
 *  - `structuredCodeAnswer` (`data-error-classification.ts`) — the arms
 *    `@objectstack/rest`'s single-record and bulk doors ask first.
 *
 * Both take the status and the code from {@link unevaluableHookConditionRefusal},
 * so neither spells them.
 */

import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import type { StandardErrorCode } from '@objectstack/spec/api';

/** The HTTP status an unevaluable hook condition's refusal is served with. */
export const UNEVALUABLE_HOOK_CONDITION_STATUS = 400;

/** What a boundary answers for a write an unevaluable hook condition refused. */
export interface UnevaluableHookConditionRefusal {
  status: typeof UNEVALUABLE_HOOK_CONDITION_STATUS;
  /** The `StandardErrorCode` member the status names (`VALIDATION_ERROR`). */
  code: StandardErrorCode;
}

/**
 * The boundary's answer for `err` when it is a `HookConditionError` whose
 * condition compiled and then faulted on the record it judged, or `undefined`
 * for everything else, an `uncompilable` condition included. Callers use the
 * `undefined` result as the predicate and the object as the answer, so the
 * two cannot disagree.
 */
export function unevaluableHookConditionRefusal(err: unknown): UnevaluableHookConditionRefusal | undefined {
  const e = err as { name?: unknown; reason?: unknown } | null | undefined;
  if (e?.name !== 'HookConditionError' || e?.reason !== 'unevaluable') return undefined;
  return {
    status: UNEVALUABLE_HOOK_CONDITION_STATUS,
    code: standardErrorCodeForHttpStatus(UNEVALUABLE_HOOK_CONDITION_STATUS),
  };
}
