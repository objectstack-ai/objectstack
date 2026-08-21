// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sweepStrandedOutbox — the missing consumer for `sys_email` rows left at
 * `status:'queued'` (#5161).
 *
 * ## What was stranded
 * A `queued` row had exactly ONE consumption moment: the `afterInsert` drain
 * hook that fires during the insert itself (and, since #5160, the
 * `email.send.async` job `send()` publishes). Nothing ever looked at such a row
 * again. A process that died between the insert and the delivery — or a drain
 * hook whose delivery threw — left the row at `queued` forever: a state named
 * after a queue that had no consumer, which is `declared ≠ delivered` one layer
 * up from the transports #5087 fixed.
 *
 * This is that consumer, run once per boot at `kernel:ready`.
 *
 * ## Which rows it touches, and why the age gate is not optional
 * Only rows that are **older than {@link OUTBOX_SWEEP_MIN_AGE_MS}**. A row
 * inserted seconds ago is not stranded — it is somebody's in-flight work: this
 * process's `send()` (between `insert` and `transport.send`), this process's
 * drain hook (deferred by `setTimeout(0)`), or, in a multi-instance
 * deployment, the same on a sibling instance that this process knows nothing
 * about. The age gate is what keeps a boot from stealing live work and sending
 * a message twice.
 *
 * Note what the gate deliberately is NOT: "created before this process
 * booted". This instance's boot time says nothing about a sibling that
 * inserted a row one second ago — that row is younger than our boot and very
 * much not ours. Age is the only property that means the same thing on every
 * instance.
 *
 * Two further guards sit under it, and they are backstops, not permission:
 *   - rows currently owned by this process's `send()` are skipped
 *     ({@link EmailService.isServiceManaged});
 *   - a row that already carries a `message_id`, or is no longer `queued`, is
 *     left alone — the same idempotency the `email.send.async` subscriber
 *     applies before it delivers.
 *
 * ## How it delivers — the mode decides, not this function
 * Queue mode (#5160): the row is published as an `{ rowId }` job to
 * {@link EMAIL_SEND_QUEUE} through {@link EmailService.enqueuePersistedRow},
 * i.e. the SAME payload, options and `sys_email:<id>` idempotency key `send()`
 * publishes — so a swept row that still has a pending job collapses onto it
 * instead of racing a second worker onto the same row, and the retry/DLQ
 * budget is the queue's, exactly as for a fresh send.
 *
 * Inline mode: {@link EmailService.deliverPersistedRow} finalizes the row in
 * place, which is what the drain hook would have done had the process lived.
 * Inline mode has no cross-process coordination — it never had any — so the
 * age gate is the whole of the protection there. Durable multi-instance
 * delivery is what queue mode exists for.
 */

import type { SendEmailResult } from '@objectstack/spec/contracts';

/** System read context — a boot sweep is not an end-user query. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Backing object; a constant so the query and the log line agree. */
export const OUTBOX_OBJECT = 'sys_email';

/**
 * How old a `queued` row must be before the sweep treats it as stranded
 * rather than in flight. Five minutes: long enough that any live `send()` /
 * drain-hook delivery has either finalized the row or thrown (the inline retry
 * loop caps its own backoff at 2s), short enough that a restart after a crash
 * still gets the mail out in the same maintenance window.
 */
export const OUTBOX_SWEEP_MIN_AGE_MS = 5 * 60_000;

/**
 * Rows handled per boot. A bound, not a policy: the sweep must not turn a
 * pathological backlog into an unbounded burst of transport calls during
 * startup. When it truncates it says so, and the next boot continues.
 */
export const OUTBOX_SWEEP_LIMIT = 500;

/** Human form of the age gate, for the log lines. */
function humanMs(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

/**
 * Structural logger — `meta` is `any` so the kernel's own `Logger`
 * (`meta?: Record<string, any>`) satisfies it without a cast at the call site.
 * Every line this module writes is self-contained text; nothing is passed as
 * meta, because a consequence buried in a metadata bag is a consequence nobody
 * greps.
 */
interface SweepLogger {
  info?: (msg: string, meta?: any) => void;
  warn?: (msg: string, meta?: any) => void;
  error?: (msg: string, meta?: any) => void;
}

/** The two `EmailService` entry points the sweep needs, and nothing else. */
export interface OutboxSweepService {
  isServiceManaged(id: string): boolean;
  /** Publish the row as a durable job; false ⇒ queue delivery is not in force. */
  enqueuePersistedRow(rowId: string): Promise<boolean>;
  deliverPersistedRow(row: Record<string, unknown>): Promise<SendEmailResult>;
}

export interface SweepStrandedOutboxOptions {
  /** ObjectQL-shaped engine (`find(object, { where, orderBy, limit })`). */
  engine: { find(object: string, opts: Record<string, unknown>): Promise<unknown> };
  service: OutboxSweepService;
  logger?: SweepLogger;
  /** Clock seam for tests. */
  now?: () => number;
  /** Override {@link OUTBOX_SWEEP_MIN_AGE_MS} (tests). */
  minAgeMs?: number;
  /** Override {@link OUTBOX_SWEEP_LIMIT} (tests). */
  limit?: number;
}

export interface OutboxSweepResult {
  /** Rows the query returned — already past the age gate. */
  scanned: number;
  /** Rows handed to the durable queue as `{ rowId }` jobs. */
  requeued: number;
  /** Rows delivered inline in this sweep and finalized `sent`. */
  sent: number;
  /** Rows delivered inline in this sweep and finalized `failed`. */
  failed: number;
  /** Rows deliberately left alone (service-managed, or already delivered). */
  skipped: number;
  /** True when the batch limit was reached — more remain for the next boot. */
  truncated: boolean;
}

/** Normalize the two find() return shapes ObjectQL hands back. */
function toRows(raw: unknown): Array<Record<string, any>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, any>>;
  const data = (raw as any)?.data;
  return Array.isArray(data) ? data : [];
}

/**
 * Advance every stranded `sys_email` row once. Never throws for a single
 * row — one undeliverable message must not stop the rest of the backlog —
 * but DOES propagate a failure of the query itself, so the caller can report
 * that the sweep as a whole did not happen.
 */
export async function sweepStrandedOutbox(
  opts: SweepStrandedOutboxOptions,
): Promise<OutboxSweepResult> {
  const { engine, service, logger } = opts;
  const now = opts.now?.() ?? Date.now();
  const minAgeMs = opts.minAgeMs ?? OUTBOX_SWEEP_MIN_AGE_MS;
  const limit = Math.max(1, opts.limit ?? OUTBOX_SWEEP_LIMIT);
  const cutoff = new Date(now - minAgeMs).toISOString();

  // One row past the batch so "there are more" is a fact, not an inference
  // from a full page (a page that is exactly full is the common false positive).
  const page = toRows(await engine.find(OUTBOX_OBJECT, {
    where: { status: 'queued', created_at: { $lt: cutoff } },
    orderBy: [{ field: 'created_at', order: 'asc' }],
    limit: limit + 1,
    context: SYSTEM_CTX,
  }));
  const rows = page.slice(0, limit);

  const result: OutboxSweepResult = {
    scanned: rows.length,
    requeued: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    truncated: page.length > limit,
  };
  if (rows.length === 0) return result;

  /** Say a per-row breakage once — the rest is in the summary counts. */
  let rowErrorReported = false;

  for (const row of rows) {
    const rowId = row?.id != null ? String(row.id) : '';
    // Backstops under the age gate: never touch a row `send()` owns right
    // now, and never re-send one the transport already accepted.
    if (!rowId || row.status !== 'queued' || row.message_id) { result.skipped++; continue; }
    if (service.isServiceManaged(rowId)) { result.skipped++; continue; }

    try {
      if (await service.enqueuePersistedRow(rowId)) {
        result.requeued++;
        continue;
      }
      // Inline mode — or a publish that failed, in which case delivering
      // inline is what `send()` itself falls back to: the row is already
      // committed, and leaving it for nobody is the bug being fixed.
      const delivered = await service.deliverPersistedRow(row);
      if (delivered.status === 'failed') result.failed++;
      else result.sent++;
    } catch (err: any) {
      result.failed++;
      if (!rowErrorReported) {
        rowErrorReported = true;
        const message =
          `EmailServicePlugin: outbox sweep could not advance sys_email row '${rowId}' — that message stays `
          + 'at `queued`, undelivered, and nothing will look at it again until the next restart, while the '
          + 'server keeps reporting healthy. Fix: the cause below comes from the datasource or the queue, '
          + 'not from the message itself (a message that cannot be sent is recorded as `failed` on its own '
          + `row); restore that dependency and restart to re-sweep. Cause: ${err?.message ?? err}`;
        // `SweepLogger.error` is OPTIONAL, so `logger?.error?.(…)` printed
        // NOTHING against a sink that has only `warn` — the stranded row would
        // then be reported by nobody (#9657). Fall back to `warn`, not silence.
        if (logger?.error) logger.error(message);
        else logger?.warn?.(message);
      }
    }
  }

  logger?.info?.(
    `EmailServicePlugin: outbox sweep — ${result.scanned} sys_email row(s) stranded at 'queued' for over `
    + `${humanMs(minAgeMs)} (accepted, never delivered): ${result.requeued} re-queued for durable delivery, `
    + `${result.sent} sent inline, ${result.failed} failed, ${result.skipped} skipped`
    + (result.truncated
      ? `. Batch limit ${limit} reached — more rows remain and will be swept on the next boot.`
      : '.'),
  );

  if (result.failed > 0) {
    const summary =
      `EmailServicePlugin: ${result.failed} stranded sys_email row(s) could NOT be delivered by the boot `
      + 'sweep. Those messages were accepted by the platform and have still never reached a recipient; '
      + 'nothing retries them in this process. Fix: read the failures with '
      + "`SELECT id, error FROM sys_email WHERE status = 'failed'`, fix the transport (Settings → Mail), and "
      + 'turn on Settings → Mail → "Durable queue delivery" so future failures are retried and dead-lettered '
      + 'instead of depending on the next restart.';
    // Same defect as the per-row report above, one scope out (#9748). No
    // `catch` guards this line, so `check:durability-log-level` could not see
    // it and #9657 left it spelled `logger?.error?.(…)` — which printed
    // NOTHING against a sink that has only `warn`. Because the per-row line WAS
    // repaired, such a sink then heard every individual failure and never the
    // COUNT of accepted mail that reached nobody: the detail and the total
    // reported through different channels. Fall back to `warn`, not silence.
    if (logger?.error) logger.error(summary);
    else logger?.warn?.(summary);
  }

  return result;
}
