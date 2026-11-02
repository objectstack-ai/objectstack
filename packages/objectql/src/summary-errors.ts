// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/** One parent whose roll-up summary could not be recomputed after retries. */
export interface SummaryRecomputeFailure {
  childObject: string;
  parentObject: string;
  parentId: string;
  field: string;
  error: unknown;
}

/**
 * [#16159] The ADR-0112 `code` {@link SummaryRecomputeError} carries, as a
 * constant a consumer can import instead of re-spelling.
 *
 * The docblock below already says this refusal is "Identified by `code` rather
 * than `instanceof` so it survives crossing package boundaries" — and offered
 * nothing to import, so following that instruction meant re-authoring the wire
 * string in the consumer's own package. This row is the sweep's clearest case
 * that the cost is not hypothetical: TWO first-party consumers already do
 * exactly that, and both do it to implement the same recovery this class was
 * designed for — `packages/rest/src/import-runner.ts` and
 * `packages/metadata-protocol/src/seed-loader.ts` each match this refusal by
 * `code` so they can treat a stale summary as a warning and keep the records
 * that WERE written. Three spellings of one code, in three packages, with
 * nothing but a grep keeping them equal.
 *
 * ⛔ The string is byte-identical to the literal it replaces. This moves where a
 * spelling lives, never what it says; renaming the code is a separate breaking
 * decision and never a rider on this conversion. ⛔ Nor does this row rewire
 * those two consumers: that is a consumer-side change to two other packages,
 * outside a producer-side sweep, and no gate asks for it.
 *
 * ⚠️ `ERR_SUMMARY_RECOMPUTE` is registered in `ERROR_CODE_LEDGER` under
 * `@objectstack/objectql`, so this declaration is a `constdef` stamp site
 * `check:error-code-provenance` DOES see and accepts under this package's own
 * owner key, while `check:dispatcher-error-vocabulary` — which records only
 * UNREGISTERED sites — stays blind to it by construction.
 *
 * The `_CODE` NAME and the bare `readonly code = SUMMARY_RECOMPUTE_CODE;`
 * spelling are load-bearing: the first is the shape the provenance gate's
 * `constdef` pattern can see, the second is the shape the vocabulary gate
 * classifies as `classconst` (an `as const` suffix on the FIELD would take it
 * out of that pattern). Dropping the `ERR_` prefix from the CONSTANT's name
 * follows this package's precedents (`READONLY_FIELD_REJECTED_CODE`,
 * `HOOK_TARGET_REBIND_ERROR_CODE`); re-exported from `index.ts` beside the
 * class, which is where this one is already published.
 */
export const SUMMARY_RECOMPUTE_CODE = 'ERR_SUMMARY_RECOMPUTE' as const;

/**
 * Thrown by engine.insert/update/delete when one or more parent roll-up
 * summaries fail to recompute after transient retries (framework#3147).
 *
 * The triggering records WERE written — this signals a stale/incorrect
 * summary, not a failed write. `written` carries the write's result (the array
 * for a batch, the single record otherwise) so a caller that can tolerate a
 * stale summary (e.g. a bulk seed/import, which treats it as a warning) can
 * recover the records instead of re-running the write. Identified by `code`
 * rather than `instanceof` so it survives crossing package boundaries.
 */
export class SummaryRecomputeError extends Error {
  readonly code = SUMMARY_RECOMPUTE_CODE;
  constructor(
    public readonly failures: SummaryRecomputeFailure[],
    public readonly written: unknown,
  ) {
    super(
      `Roll-up summary recompute failed after retries for ${failures.length} parent record(s); ` +
      `the triggering records WERE written (summary values may be stale).`,
    );
    this.name = 'SummaryRecomputeError';
  }
}

/**
 * The refusal a unit answers when a write NESTED in it raised
 * {@link SummaryRecomputeError} and the unit itself then did not land.
 *
 * That refusal says "this write is stored, only a roll-up recompute failed",
 * and every answering surface turns it into the write's own success. It is
 * true for the write that raised it, and only while that write stands. Three
 * engine seams carry a nested write's refusal past the point where it stops
 * being true:
 *
 *  - a delete's cascade walk deletes (or clears) each dependent through the
 *    public write path, before the parent's own row is removed. A dependent's
 *    refusal stops the walk, so the parent's row is never removed — and under
 *    the `'atomic'` plan the transaction then rolls the dependent back too;
 *  - a `transaction()` whose callback lets the refusal escape rolls back every
 *    write in it, the refusing one included;
 *  - a hook that writes through `ctx.api` and lets that write's refusal escape
 *    stops the write it is hooked to, whose caller would otherwise read the
 *    hook's write as its own.
 *
 * Either way the caller's own write did not land, so it is told so: an
 * internal failure, which is what an unrecomputable roll-up is
 * ({@link UnlandedWriteRefusal}), the original refusal kept as `cause` for the
 * operator. Every other error
 * passes through unchanged, and so does the refusal anywhere it is still true:
 * the dependent's own delete, a write outside any unit, a transaction that
 * catches it and commits, a joined transaction whose owner decides.
 *
 * Matched by `code`, as every reader of the refusal matches it.
 *
 * [#29421] A conversion that meets an EARLIER conversion re-leads it when
 * `relead` is set: a nested cascade (a grandchild refuses, the child's walk
 * converts naming the child, then the parent's walk receives that) or a hook
 * whose own write was such a delete. The caller of the outer write is told
 * about the outer write, and `cause` stays the original refusal, so the
 * summaries named are the same at every level. A transaction does not re-lead:
 * a conversion that escapes it already names the write that did not complete.
 */
function unlandedWriteRefusal(e: unknown, lead: string, relead = false): unknown {
  const original = relead && e instanceof UnlandedWriteRefusal ? e.cause : e;
  if (!(original instanceof Error) || (original as { code?: unknown }).code !== SUMMARY_RECOMPUTE_CODE) return e;
  const failures = (original as { failures?: unknown }).failures;
  const named = Array.isArray(failures)
    ? [...new Set((failures as SummaryRecomputeFailure[]).map((f) => `${f?.parentObject}.${f?.field}`))]
    : [];
  const summaries = named.length > 0 ? `the roll-up summary ${named.join(', ')}` : 'a parent roll-up summary';
  return new UnlandedWriteRefusal(
    `${lead} A write inside it was stored, then ${summaries} could not be recomputed after it, and that ` +
    "refusal stopped it. Fix the summary field's `summaryOperations` (the engine's warning names why the " +
    'recompute was refused), then retry.',
    original,
  );
}

/**
 * [#29421] What {@link unlandedWriteRefusal} answers: an internal failure, the
 * original refusal as `cause`.
 *
 * It DECLARES that it is one, `status: 500` and the generic ADR-0112
 * `INTERNAL_ERROR`, so every door reads it structurally. Before, it declared
 * nothing. The data door then reached its 500 only because the sentence
 * missed every message heuristic in `classifyDataError` (the double quotes in
 * the leads dodge the unknown-object one), and the action door answered it as
 * a 400 refusal. Measured: the data door's body is byte-identical (`500
 * { error, code: 'INTERNAL_ERROR' }`), and the action door now answers `500
 * INTERNAL_ERROR` with the same sentence. `status` alone would not do: a
 * declared 5xx with no code drops `code` from the data door's body.
 *
 * A class so a later conversion can tell an earlier one apart (the re-lead
 * above). Module-private and never exported: no reader outside this file
 * matches it, so the published surface does not move. `name` stays `'Error'`.
 */
class UnlandedWriteRefusal extends Error {
  readonly status = 500;
  readonly code = 'INTERNAL_ERROR';
  declare readonly cause: Error;
  constructor(message: string, original: Error) {
    super(message);
    (this as { cause?: unknown }).cause = original;
  }
}

/** {@link unlandedWriteRefusal} for a delete whose cascade walk the refusal stopped. */
export function cascadeStoppedRefusal(e: unknown, object: string): unknown {
  return unlandedWriteRefusal(
    e,
    // Double quotes: a quoted `'object'` beside a "not" reads as an unknown
    // object to the data door's message heuristic, which answers it 404.
    `The delete of "${object}" did not complete: its cascade stopped before the record was removed. ` +
      'Under a transaction that rolls back nothing was written; otherwise the dependents written before ' +
      'that point stay written.',
    true,
  );
}

/**
 * {@link unlandedWriteRefusal} for a write whose hook a nested write's refusal
 * stopped.
 *
 * A hook that writes through `ctx.api` makes a write of its own. When that
 * write raises {@link SummaryRecomputeError}, the refusal leaves the handler
 * carrying the HOOK's write as `written`. Let through, it reached the outer
 * write's caller as that caller's own refusal, so a door answered the hook's
 * record as the result of the write it was asked for. The outer write did not
 * complete either: the rest of its chain, its own roll-ups and its events never
 * ran. An `after*` hook's unit (`inAfterAbortUnit`) now rolls back both rows,
 * as `HookSchema.onError` `abort` says.
 *
 * Only the refusal is converted; every other error a hook throws passes
 * through unchanged. And only one a handler let escape: a hook whose `onError`
 * is `log` swallows it before it gets here.
 */
export function hookStoppedRefusal(e: unknown, event: string, object: string | undefined, hook: string | undefined): unknown {
  const verb = event.replace(/^(before|after)/, '').toLowerCase() || event;
  return unlandedWriteRefusal(
    e,
    // Double quotes, as in `cascadeStoppedRefusal`.
    `The ${verb} of "${object ?? '?'}" did not complete: its ${event} hook${hook ? ` "${hook}"` : ''} stopped. ` +
      'Under a transaction that rolls back nothing was written; otherwise what was written before that point ' +
      'stays written.',
    true,
  );
}

/** {@link unlandedWriteRefusal} for a transaction the refusal rolled back. */
export function rolledBackRefusal(e: unknown): unknown {
  return unlandedWriteRefusal(e, 'The transaction rolled back, so nothing written inside it was stored.');
}

/**
 * [#29421] {@link unlandedWriteRefusal} for a transaction whose rollback itself
 * failed. Nothing is known about what is stored then, so the lead does not say
 * "rolled back", and the refusal is still not answered as a success.
 */
export function rollbackFailedRefusal(e: unknown): unknown {
  return unlandedWriteRefusal(
    e,
    'The transaction did not complete, and its rollback failed too, so what was written inside it may or may ' +
      'not be stored.',
  );
}
