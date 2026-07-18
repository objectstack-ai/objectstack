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
  readonly code = 'ERR_SUMMARY_RECOMPUTE' as const;
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
