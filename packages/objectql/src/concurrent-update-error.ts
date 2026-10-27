// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D4] The refusal a by-id write under the engine-internal
 * precondition raises when the precondition matched no row: another writer
 * moved the row first.
 *
 * `CONCURRENT_UPDATE`, 409 — the data path's existing code for "another writer
 * got there first" (the optimistic-lock refusal of the data door), so one
 * condition carries one 409 (ADR-0112 D1). `@objectstack/types`' error
 * classification answers it by `code` / `name`, as it answers the data door's.
 * Two users today: the claim of an unowned record (`{ owner_id: null }`, set by
 * the ownership gate) — whose loser reads "the record was taken" — and the
 * assignment cursor's advance (`{ version }`), which re-reads and retries.
 *
 * ⛔ Not exported from the package entry: an in-process caller branches on
 * `code`, which survives the dual build where `instanceof` does not.
 */
export const CONCURRENT_UPDATE_CODE = 'CONCURRENT_UPDATE' as const;

export class ConcurrentUpdateError extends Error {
  readonly code = CONCURRENT_UPDATE_CODE;
  readonly status = 409;
  /** The same number under ADR-0112 D5's spelling. */
  readonly httpStatus = 409;

  constructor(
    /** The object the refused write targeted. */
    public readonly object: string,
    /** The record the write addressed. */
    public readonly recordId: string,
  ) {
    super('The record was taken: another user changed it first. Reload it to see who has it now.');
    this.name = 'ConcurrentUpdateError';
  }
}
