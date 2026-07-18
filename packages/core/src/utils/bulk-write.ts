// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `bulkWrite` — the shared batched-write helper used by BOTH the seed loader
 * (`@objectstack/metadata-protocol`) and the data-import runner
 * (`@objectstack/rest`), so neither reimplements batching, transient-error
 * retry, or per-row degradation. See framework#2678.
 *
 * ObjectQL's engine already does the efficient thing when handed an ARRAY —
 * one `driver.bulkCreate` round-trip plus parent-deduplicated summary
 * recompute (`engine.insert(object, rows[])`) — but seed/import fed it one
 * record at a time, so neither got the benefit. This module re-chunks rows
 * into batches and drives them through a caller-supplied batch-write
 * function, adding:
 *
 *  - transient-error retry (network blip / timeout) with exponential
 *    backoff, so a dropped connection doesn't silently drop the row (the
 *    2026-07-06 HotCRM incident: a turso `fetch failed` mid-seed dropped rows
 *    silently because nothing retried);
 *  - per-row degradation when a batch fails for a non-transient (logical /
 *    validation) reason, so one bad row can't fail the other N-1 — needed
 *    because `driver.bulkCreate` is a single multi-row statement/`Promise.all`
 *    on every driver in this repo (sql, memory, mongodb): one bad row fails
 *    the whole call;
 *  - a stable per-row result keyed by the row's original index, so callers
 *    can reassemble output in input order even though rows are processed in
 *    batches (and a batch's flush may be interleaved with other, immediate,
 *    per-row work such as updates).
 *
 * Delivery semantics: **at-least-once**. Transient retry and per-row
 * degradation both RE-RUN a write whose outcome was unknown — e.g. a turso
 * `fetch failed` that arrived *after* the row was already committed
 * (framework#3149), or a result-count mismatch that voids the batch
 * (framework#3151). A caller that needs exactly-once must make its
 * `writeBatch`/`writeOne` idempotent; both receive an `attempt` counter for
 * exactly this — see the natural-key recheck the seed loader and import
 * runner perform on `attempt > 1`. `writeBatch` MUST also resolve exactly one
 * record per input row, in input order: a short / long / non-array return is
 * rejected as a failed batch (framework#3151), never silently backfilled.
 */

export interface BulkWriteRowResult<TRecord = any> {
  /** Index into the original `rows` array passed to {@link bulkWrite}. */
  index: number;
  ok: boolean;
  record?: TRecord;
  error?: unknown;
}

export interface RetryOptions {
  /** Max attempts for one write (batch or single-row), including the first. Default 3. */
  maxRetries?: number;
  /** Base backoff in ms; doubled each retry, plus jitter. Default 200. */
  backoffBaseMs?: number;
  /** Classifies an error as transient (worth retrying) vs logical (the row/batch is just bad). */
  isTransientError?: (err: unknown) => boolean;
  /** Injectable sleep, for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface BulkWriteOptions<TRow, TRecord = any> extends RetryOptions {
  /** Rows per batch. Default 200 (framework#2678 suggests 100-500). */
  batchSize?: number;
  /**
   * Write one batch. MUST resolve to one record per input row, in the SAME
   * order as `batch` — {@link bulkWrite} correlates `records[i]` back to
   * `batch[i]` positionally (this is how every `bulkCreate` implementation in
   * this repo already behaves: sql's single `INSERT ... VALUES (...), (...)
   * RETURNING *`, memory's `Promise.all`, mongodb's ordered `insertMany`).
   */
  writeBatch: (batch: TRow[]) => Promise<TRecord[]>;
  /** Write a single row — used only to degrade a failed batch. */
  writeOne: (row: TRow) => Promise<TRecord>;
}

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_BASE_MS = 200;

/**
 * Transient-error signatures shared by common HTTP/TCP-backed drivers
 * (turso/libsql's fetch-based transport included). Deliberately excludes
 * anything that looks like a validation/constraint error — those must NOT be
 * retried, only degraded to per-row.
 */
const TRANSIENT_PATTERNS: RegExp[] = [
  /fetch failed/i,
  /network/i,
  /timed?\s*out/i,
  /timeout/i,
  /socket hang ?up/i,
  /connection.*(closed|reset|refused|terminated|aborted)/i,
  /\b(502|503|504)\b/,
  /server.*unavailable/i,
  /too many connections/i,
];

const TRANSIENT_CODES = /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND)$/i;

/**
 * Validation / constraint / schema signatures that are DEFINITIVELY logical,
 * never worth retrying. Checked before {@link TRANSIENT_PATTERNS} so a message
 * that happens to mention both (e.g. `CHECK constraint failed: network_zone`,
 * `column network_id is not allowed`) is classified as logical rather than
 * burning retries on a row that will fail identically every time (framework
 * #3150).
 */
const NON_TRANSIENT_PATTERNS: RegExp[] = [
  /validation/i,
  /constraint/i,
  /\brequired\b/i,
  /\bunique\b/i,
  /duplicate/i,
  /not[\s_-]*null/i,
  /invalid/i,
  /not allowed/i,
  /out of range/i,
];

export function defaultIsTransientError(err: unknown): boolean {
  const message = (err as { message?: unknown } | null)?.message;
  const text = typeof message === 'string' ? message : String(err ?? '');
  // A definitive logical signature wins even if a transient word also appears.
  if (NON_TRANSIENT_PATTERNS.some((re) => re.test(text))) return false;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && TRANSIENT_CODES.test(code)) return true;
  return TRANSIENT_PATTERNS.some((re) => re.test(text));
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface ResolvedRetryOptions {
  maxRetries: number;
  backoffBaseMs: number;
  isTransientError: (err: unknown) => boolean;
  sleep: (ms: number) => Promise<void>;
}

async function withRetry<T>(fn: () => Promise<T>, opts: ResolvedRetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= opts.maxRetries || !opts.isTransientError(err)) throw err;
      const jitter = Math.floor(Math.random() * 50);
      await opts.sleep(opts.backoffBaseMs * 2 ** (attempt - 1) + jitter);
    }
  }
  // Unreachable — the loop above always returns or throws — but keeps TS's
  // control-flow analysis happy about a guaranteed return type.
  throw lastError;
}

/**
 * Retry a single write (e.g. an `engine.update()` call the seed loader or
 * import runner makes outside the batched-insert path) with the same
 * transient-error backoff {@link bulkWrite} applies to batches — so a
 * network blip doesn't drop an update the way it used to drop an insert.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  return withRetry(fn, {
    maxRetries: Math.max(1, opts.maxRetries ?? DEFAULT_MAX_RETRIES),
    backoffBaseMs: opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
    isTransientError: opts.isTransientError ?? defaultIsTransientError,
    sleep: opts.sleep ?? defaultSleep,
  });
}

/**
 * Write `rows` through `opts.writeBatch` in chunks of `opts.batchSize`,
 * retrying a whole-batch transient failure with backoff, and degrading to
 * per-row `opts.writeOne` calls (each itself retried) when a batch fails for
 * a non-transient reason — so one bad row can't drop the rest of the batch.
 *
 * Returns one {@link BulkWriteRowResult} per input row, indexed to match
 * `rows`' original order.
 */
export async function bulkWrite<TRow, TRecord = any>(
  rows: TRow[],
  opts: BulkWriteOptions<TRow, TRecord>,
): Promise<BulkWriteRowResult<TRecord>[]> {
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
  const retryOpts: ResolvedRetryOptions = {
    maxRetries: Math.max(1, opts.maxRetries ?? DEFAULT_MAX_RETRIES),
    backoffBaseMs: opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
    isTransientError: opts.isTransientError ?? defaultIsTransientError,
    sleep: opts.sleep ?? defaultSleep,
  };

  const results: BulkWriteRowResult<TRecord>[] = new Array(rows.length);

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    try {
      const records = await withRetry(() => opts.writeBatch(batch), retryOpts);
      // Contract guard (framework#3151): `writeBatch` must resolve one record
      // per input row. A short / long / non-array return breaks the positional
      // correlation below, so backfilling it would report phantom successes
      // (`record: undefined`) or drop records. Treat the whole batch as failed
      // and fall through to per-row degradation (each row re-attempted via
      // `writeOne`, which under an idempotent caller rechecks before writing).
      // The message deliberately avoids any transient signature so this never
      // reads as a retryable blip — and it is thrown *outside* `withRetry`, so
      // the batch is not retried on it.
      if (!Array.isArray(records) || records.length !== batch.length) {
        throw Object.assign(
          new Error(
            `bulkWrite: writeBatch returned ${
              Array.isArray(records) ? `${records.length} record(s)` : String(typeof records)
            } for a ${batch.length}-row batch — treating batch as failed`,
          ),
          { code: 'ERR_BULK_RESULT_MISMATCH' },
        );
      }
      for (let i = 0; i < batch.length; i++) {
        results[start + i] = { index: start + i, ok: true, record: records[i] };
      }
    } catch (batchErr) {
      // A single-row "batch" already IS the per-row attempt — its failure
      // (after transient retry) is the row's final outcome; calling
      // `writeOne` again would just repeat the identical work.
      if (batch.length === 1) {
        results[start] = { index: start, ok: false, error: batchErr };
        continue;
      }
      // The batch failed even after transient retry, or failed for a logical
      // reason retry wouldn't fix. Degrade to per-row so one bad row can't
      // fail the other rows in this batch. Each row still gets its own
      // transient retry — the batch-level failure doesn't tell us which row
      // (if any) was actually the transient one.
      for (let i = 0; i < batch.length; i++) {
        const idx = start + i;
        try {
          const record = await withRetry(() => opts.writeOne(batch[i]), retryOpts);
          results[idx] = { index: idx, ok: true, record };
        } catch (err) {
          results[idx] = { index: idx, ok: false, error: err };
        }
      }
    }
  }

  return results;
}
