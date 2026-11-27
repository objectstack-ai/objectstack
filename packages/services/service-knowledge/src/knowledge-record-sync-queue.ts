// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IQueueService, QueuePublishOptions } from '@objectstack/spec/contracts';

/**
 * The queue the record sync runs through (ADR-0161 K1): the save of an
 * indexed record publishes one message here per source over its object, and
 * the plugin's worker, subscribed in `kernel:ready`, syncs the document.
 */
export const KNOWLEDGE_RECORD_SYNC_QUEUE = 'knowledge-record-sync';

/**
 * Why a record sync was asked for: a record change (`event`, from either
 * trigger — the realtime subscription or the after-write hooks), or a search
 * that found the record's document stale (`freshness`).
 */
export type KnowledgeRecordSyncReason = 'event' | 'freshness';

/**
 * One record-sync message: identifiers only. ⛔ Never a field value:
 * `sys_job_queue` is an object an administrator can list, and a record body
 * there would be a copy of the row outside its permissions. The worker
 * re-reads the row, so it needs nothing else.
 */
export interface KnowledgeRecordSyncMessage {
  /** The source's index key (the registry's key, never its face). */
  source: string;
  /** The object the record belongs to. */
  object: string;
  /** The record's id. */
  recordId: string;
  reason: KnowledgeRecordSyncReason;
}

/**
 * The retry budget of a queued record sync: a failed attempt is thrown to the
 * queue, which runs it again after an exponential backoff (`backoffMs`,
 * doubled each attempt, capped at `maxBackoffMs`); after `maxAttempts` the
 * message is a dead letter (`IQueueService.listFailed`).
 */
export interface KnowledgeRecordSyncRetry {
  maxAttempts: number;
  backoffMs: number;
  maxBackoffMs: number;
}

/**
 * The default budget: eight attempts, 5 s doubling to a 2 min cap. The seven
 * waits between them sum to 395 s, so a provider outage of six and a half
 * minutes is ridden out before a message becomes a dead letter; the reconcile
 * repairs what a dead letter names.
 */
export const RECORD_SYNC_RETRY_DEFAULTS: Readonly<KnowledgeRecordSyncRetry> = Object.freeze({
  maxAttempts: 8,
  backoffMs: 5_000,
  maxBackoffMs: 120_000,
});

/** `retry` with every member it leaves out taken from {@link RECORD_SYNC_RETRY_DEFAULTS}. */
export function resolveRecordSyncRetry(retry: Partial<KnowledgeRecordSyncRetry> | undefined): KnowledgeRecordSyncRetry {
  const positive = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
  return {
    maxAttempts: positive(retry?.maxAttempts, RECORD_SYNC_RETRY_DEFAULTS.maxAttempts),
    backoffMs: positive(retry?.backoffMs, RECORD_SYNC_RETRY_DEFAULTS.backoffMs),
    maxBackoffMs: positive(retry?.maxBackoffMs, RECORD_SYNC_RETRY_DEFAULTS.maxBackoffMs),
  };
}

/**
 * The publish options of one message: the retry budget, and the source and
 * record in the message metadata, so a dead letter names them. No
 * `idempotencyKey`, deliberately: the database queue suppresses a publish
 * while a message with the same key is `pending` or `running`, and for its
 * idempotency window after it completed. Keyed by document, a save made while
 * a sync of the same record runs — the sync has already read the row — would
 * be lost, and a completed sync would block every later save of that record
 * for the window. So every save publishes its own message, and each worker
 * run re-reads the row as it is then.
 */
export function recordSyncPublishOptions(
  message: KnowledgeRecordSyncMessage,
  retry: KnowledgeRecordSyncRetry,
): QueuePublishOptions {
  return {
    maxAttempts: retry.maxAttempts,
    backoff: { type: 'exponential', delayMs: retry.backoffMs, maxDelayMs: retry.maxBackoffMs },
    metadata: { source: message.source, object: message.object, recordId: message.recordId, reason: message.reason },
  };
}

/** `data` as a {@link KnowledgeRecordSyncMessage}, or `undefined` when it is not one. */
export function readRecordSyncMessage(data: unknown): KnowledgeRecordSyncMessage | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const { source, object, recordId, reason } = data as Record<string, unknown>;
  const text = (value: unknown): value is string => typeof value === 'string' && value !== '';
  if (!text(source) || !text(object) || !text(recordId)) return undefined;
  if (reason !== 'event' && reason !== 'freshness') return undefined;
  return { source, object, recordId, reason };
}

/**
 * The `queue` service the record sync can run through, else `undefined`:
 * none registered, one that cannot publish and subscribe, the kernel's
 * built-in fallback (it labels itself `degraded`: synchronous in-process
 * delivery, no durability, no retry — the reading of `resolveDurableQueue`
 * in `@objectstack/plugin-email`), or one with no dead-letter surface
 * (`listFailed`). The last is this sync's own condition: a sync that fails
 * every attempt must stay somewhere an operator can list, and an in-memory
 * queue (`MemoryQueueAdapter`) retries nothing and keeps nothing, so a failed
 * sync there would be lost without a line in any log. The platform's
 * database queue (`DbQueueAdapter`) has one.
 */
export function resolveRecordSyncQueue(getService: (name: string) => unknown): IQueueService | undefined {
  let queue: unknown;
  try {
    queue = getService('queue');
  } catch {
    return undefined;
  }
  const candidate = queue as (Partial<IQueueService> & { __serviceInfo?: { status?: unknown } }) | undefined;
  if (!candidate || typeof candidate.publish !== 'function' || typeof candidate.subscribe !== 'function') return undefined;
  if (candidate.__serviceInfo?.status === 'degraded') return undefined;
  if (typeof candidate.listFailed !== 'function') return undefined;
  return candidate as IQueueService;
}

/**
 * What one worker run of a message did. Every outcome but a throw completes
 * the message: the ones below are not retried, because a retry cannot change
 * them.
 *
 * - `synced` — the document was written from the row, or deleted because no
 *   row matches the source's `where` (a `whole` document over the embedder's
 *   budget is removed and reported at `error`, as on every path);
 * - `source-gone` — no source has the message's index key any more;
 * - `not-synced` — the source no longer indexes the message's object on
 *   record change (`refresh.onRecordChange: false`, or another object), or
 *   no data engine is bound to re-read the row;
 * - `adapter-unmounted` — the source's adapter is not registered (adapters
 *   register in their own `start()`, so no retry within minutes changes it;
 *   the boot reports the source once);
 * - `malformed` — the message is not a record-sync message.
 */
export type KnowledgeRecordSyncOutcome = 'synced' | 'source-gone' | 'not-synced' | 'adapter-unmounted' | 'malformed';
