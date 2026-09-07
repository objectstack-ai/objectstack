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
