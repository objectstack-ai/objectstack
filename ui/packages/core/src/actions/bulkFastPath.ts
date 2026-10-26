/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { BulkWriteResult } from '@object-ui/types';

/**
 * Outcome of a single batch execution. Mirrors the fields callers care
 * about so they can fold these into their own aggregate result.
 */
export interface BulkBatchOutcome {
  succeeded: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Pluggable callbacks for the executor. Either of these is wired by the
 * caller — typically `bulkCall` issues 1 HTTP request and `perRow` is
 * the per-id fallback used when the bulk endpoint is unavailable or
 * throws. We never call both for the same batch in the same pass.
 */
export interface BulkBatchOps {
  /**
   * One server call that mutates every id in the batch with the same
   * shape. Resolves to the count of rows the server reports as succeeded,
   * or to a {@link BulkWriteResult} that also names each failed id and the
   * server's reason (objectui#13442) — what `DataSource.bulkUpdate` /
   * `bulkDelete` resolve to. Throws when the entire request fails (network,
   * 500, auth) — that signals "fall back to per-row" upstream.
   */
  bulkCall?: (ids: string[]) => Promise<number | BulkWriteResult>;
  /**
   * Per-row mutation. Called once per id in the batch when bulk is
   * unavailable, when bulk throws, or when the batch is too small for
   * bulk to be worth it. Resolve = success; reject = failure with the
   * reason captured into `errors`.
   */
  perRow: (id: string) => Promise<unknown>;
}

export interface BulkBatchInput {
  /**
   * Stable ids for this batch. Empty strings and nulls must already be
   * filtered out by the caller — this helper trusts the contract.
   */
  ids: string[];
  /**
   * Original batch size before id-stripping. Used to attribute "missing
   * id" failures in the caller's error report.
   */
  originalSize: number;
  /**
   * Index of the first row of this batch within the run. Used to build
   * stable aggregate-error ids like `batch_0`, `batch_200` etc.
   */
  offset: number;
  /**
   * When true, the helper is allowed to issue `bulkCall`. When false
   * (e.g. single-row batches where bulk is no win) it goes straight to
   * the per-row path.
   */
  allowBulk: boolean;
  /**
   * Human-readable operation label folded into aggregate error
   * messages ("bulk update", "bulk delete"). Defaults to "bulk".
   */
  label?: string;
}

/**
 * Execute one batch with bulk-first / per-row-fallback semantics.
 *
 * Decision tree:
 * 1. `allowBulk` AND `ops.bulkCall` provided → call it.
 *    - succeeded `=== ids.length`  → all good, no per-row pass.
 *    - succeeded `< ids.length`    → the shortfall is reported, with no
 *      per-row pass (the server already accepted the request; calling
 *      per-row would re-mutate the rows that already succeeded). Each
 *      failed row the call named in its `errors` gets its own entry, under
 *      its own id and the server's reason (objectui#13442), so Retry and the
 *      error CSV work per record. Only failures it did NOT name — a plain
 *      count names none — fold into one `batch_${offset}` aggregate entry.
 *    - threw                       → fall through to per-row to recover
 *      actionable per-id error detail for the user.
 * 2. Otherwise → per-row via Promise.allSettled.
 *
 * Symmetric for update + delete + any future same-shape bulk op.
 */
export async function executeBulkBatch(
  input: BulkBatchInput,
  ops: BulkBatchOps,
): Promise<BulkBatchOutcome> {
  const { ids, allowBulk, offset, label = 'bulk' } = input;
  const outcome: BulkBatchOutcome = { succeeded: 0, failed: 0, errors: [] };

  if (allowBulk && typeof ops.bulkCall === 'function') {
    let res: number | BulkWriteResult;
    try {
      res = await ops.bulkCall(ids);
    } catch {
      // Fall through to per-row — gives the user actionable detail.
      return runPerRow(ids, ops.perRow, outcome);
    }
    const reported = typeof res === 'number' ? res : res.succeeded;
    const bulkSucceeded = Math.max(0, Math.min(reported, ids.length));
    outcome.succeeded += bulkSucceeded;
    const bulkFailed = ids.length - bulkSucceeded;
    if (bulkFailed > 0) {
      outcome.failed += bulkFailed;
      // Per-record entries for the failures the call named — one per id,
      // only ids of THIS batch, and never more than the shortfall, so the
      // entries always add up to `failed`.
      const inBatch = new Set(ids);
      const attributed = new Set<string>();
      for (const rowError of typeof res === 'number' ? [] : res.errors) {
        if (attributed.size >= bulkFailed) break;
        if (!inBatch.has(rowError.id) || attributed.has(rowError.id)) continue;
        attributed.add(rowError.id);
        outcome.errors.push({ id: rowError.id, error: rowError.error });
      }
      const unattributed = bulkFailed - attributed.size;
      if (unattributed > 0) {
        outcome.errors.push({
          id: `batch_${offset}`,
          error: `${unattributed} record${unattributed === 1 ? '' : 's'} failed in ${label}`,
        });
      }
    }
    return outcome;
  }

  return runPerRow(ids, ops.perRow, outcome);
}

/** The per-row pass: every id through `perRow`, each failure under its own id. */
async function runPerRow(
  ids: string[],
  perRow: BulkBatchOps['perRow'],
  outcome: BulkBatchOutcome,
): Promise<BulkBatchOutcome> {
  const settled = await Promise.allSettled(ids.map((id) => perRow(id)));
  settled.forEach((res, idx) => {
    if (res.status === 'fulfilled') {
      outcome.succeeded += 1;
    } else {
      outcome.failed += 1;
      outcome.errors.push({
        id: ids[idx],
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  });
  return outcome;
}
