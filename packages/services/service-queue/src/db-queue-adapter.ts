// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IQueueService,
  QueuePublishOptions,
  QueueMessage,
  QueueMessageRecord,
  QueueHandler,
} from '@objectstack/spec/contracts';
import {
  SYSTEM_CTX,
  uid,
  nowIso,
  parseJson,
  type JobEngine,
  type JobClock,
  type JobLogger,
} from './common.js';

const QUEUE_TABLE = 'sys_job_queue';

export interface DbQueueAdapterOptions {
  /** Polling interval for the worker loop (ms, default 1000) */
  pollIntervalMs?: number;
  /** Max messages claimed per poll tick (default 10) */
  batchSize?: number;
  /** Lease duration before another worker may reclaim (ms, default 30000) */
  leaseMs?: number;
  /** Idempotency window — how long the same key blocks re-publish (ms, default 24h) */
  idempotencyWindowMs?: number;
  /** Default maxAttempts when publish doesn't specify (default 3) */
  defaultMaxAttempts?: number;
  /** Unique identifier for this worker (default: random) */
  workerId?: string;
  /** Whether to auto-start the polling worker (default true) */
  autoStart?: boolean;
}

interface RegisteredHandler {
  queue: string;
  fn: QueueHandler;
}

/**
 * DbQueueAdapter — durable, polling, DB-backed IQueueService.
 *
 * Persists every message to `sys_job_queue`. A polling worker leases
 * pending messages (CAS update status pending→running with a lease),
 * invokes registered subscribers, and retries with backoff on failure.
 * Messages that exceed `max_attempts` land in `status='dlq'`.
 *
 * Idempotency: publish suppresses duplicates within a configurable
 * window when `(queue, idempotencyKey)` is non-null.
 *
 * Designed for SQLite and Postgres alike — uses CAS via WHERE-clauses,
 * not row-level locking.
 */
export class DbQueueAdapter implements IQueueService {
  private readonly engine: JobEngine;
  private readonly logger?: JobLogger;
  private readonly clock?: JobClock;
  private readonly opts: Required<Omit<DbQueueAdapterOptions, 'workerId'>> & { workerId: string };

  private readonly handlers = new Map<string, RegisteredHandler[]>();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(args: {
    engine: JobEngine;
    logger?: JobLogger;
    clock?: JobClock;
    options?: DbQueueAdapterOptions;
  }) {
    this.engine = args.engine;
    this.logger = args.logger;
    this.clock = args.clock;
    const o = args.options ?? {};
    this.opts = {
      pollIntervalMs: o.pollIntervalMs ?? 1000,
      batchSize: o.batchSize ?? 10,
      leaseMs: o.leaseMs ?? 30_000,
      idempotencyWindowMs: o.idempotencyWindowMs ?? 24 * 60 * 60 * 1000,
      defaultMaxAttempts: o.defaultMaxAttempts ?? 3,
      autoStart: o.autoStart ?? true,
      workerId: o.workerId ?? uid('worker'),
    };
  }

  // ── IQueueService ────────────────────────────────────────────────

  async publish<T = unknown>(
    queue: string,
    data: T,
    options?: QueuePublishOptions,
  ): Promise<string> {
    const opts = options ?? {};
    const now = this.now();

    // Idempotency check
    if (opts.idempotencyKey) {
      const windowStart = new Date(now.getTime() - this.opts.idempotencyWindowMs).toISOString();
      const existing = await this.engine.find(QUEUE_TABLE, {
        where: {
          queue,
          idempotency_key: opts.idempotencyKey,
          // Only block if not yet terminal — completed/dlq dedup is by window via created_at
        },
        limit: 5,
        context: SYSTEM_CTX,
      });
      const blocking = (existing ?? []).find((row: any) => {
        if (row.status === 'pending' || row.status === 'running') return true;
        return String(row.created_at ?? '') >= windowStart;
      });
      if (blocking) return String(blocking.id);
    }

    const id = uid('msg');
    const scheduledFor = opts.scheduledFor
      ? new Date(opts.scheduledFor).toISOString()
      : opts.delay
        ? new Date(now.getTime() + opts.delay).toISOString()
        : now.toISOString();

    const maxAttempts = opts.maxAttempts
      ?? (opts.retries != null ? opts.retries + 1 : this.opts.defaultMaxAttempts);
    const backoff = opts.backoff ?? { type: 'exponential' as const, delayMs: 1000 };

    await this.engine.insert(QUEUE_TABLE, {
      id,
      queue,
      idempotency_key: opts.idempotencyKey ?? null,
      payload_json: JSON.stringify(data ?? null),
      metadata_json: opts.metadata ? JSON.stringify(opts.metadata) : null,
      status: 'pending',
      priority: opts.priority ?? 100,
      attempts: 0,
      max_attempts: maxAttempts,
      backoff_type: backoff.type,
      backoff_delay_ms: backoff.delayMs,
      backoff_max_delay_ms: backoff.maxDelayMs ?? null,
      scheduled_for: scheduledFor,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    }, { context: SYSTEM_CTX });

    return id;
  }

  async subscribe<T = unknown>(queue: string, handler: QueueHandler<T>): Promise<void> {
    const existing = this.handlers.get(queue) ?? [];
    existing.push({ queue, fn: handler as QueueHandler });
    this.handlers.set(queue, existing);
    if (this.opts.autoStart) this.start();
  }

  async unsubscribe(queue: string): Promise<void> {
    this.handlers.delete(queue);
  }

  async getQueueSize(queue: string): Promise<number> {
    const rows = await this.engine.find(QUEUE_TABLE, {
      where: { queue, status: 'pending' },
      limit: 10_000,
      context: SYSTEM_CTX,
    });
    return rows?.length ?? 0;
  }

  async purge(queue: string): Promise<void> {
    const rows = await this.engine.find(QUEUE_TABLE, {
      where: { queue, status: 'pending' },
      limit: 10_000,
      context: SYSTEM_CTX,
    });
    for (const row of rows ?? []) {
      // `where: { id }` — the engine's delete has no top-level `id` option.
      // The old `{ id: row.id }` bag carried no predicate at all, so every
      // purge delete threw "Delete requires an ID or options.multi=true"
      // straight into this catch: purge logged a warn per row and deleted
      // NOTHING (#4371 option-2 survey).
      try { await this.engine.delete(QUEUE_TABLE, { where: { id: row.id }, context: SYSTEM_CTX }); }
      catch (err) { this.logger?.warn?.('DbQueueAdapter: purge delete failed', err as any); }
    }
  }

  async listFailed(
    queue?: string,
    options?: { limit?: number; offset?: number },
  ): Promise<QueueMessageRecord[]> {
    const where: any = { status: 'dlq' };
    if (queue) where.queue = queue;
    const rows = await this.engine.find(QUEUE_TABLE, {
      where,
      limit: options?.limit ?? 100,
      offset: options?.offset,
      orderBy: [{ field: 'created_at', order: 'desc' }],
      context: SYSTEM_CTX,
    });
    return (rows ?? []).map((r: any) => this.rowToRecord(r));
  }

  async replay(messageId: string): Promise<void> {
    const row = await this.loadById(messageId);
    if (!row) throw new Error(`MESSAGE_NOT_FOUND: ${messageId}`);
    if (row.status !== 'dlq' && row.status !== 'failed') {
      throw new Error(`INVALID_STATE: cannot replay message in status=${row.status}`);
    }
    const now = this.now();
    await this.engine.update(QUEUE_TABLE, {
      id: messageId,
      status: 'pending',
      attempts: 0,
      last_error: null,
      locked_by: null,
      locked_until: null,
      scheduled_for: now.toISOString(),
      updated_at: now.toISOString(),
    }, { context: SYSTEM_CTX });
  }

  async purgeFailed(messageId: string): Promise<void> {
    const row = await this.loadById(messageId);
    if (!row) return;
    if (row.status !== 'dlq' && row.status !== 'failed') {
      throw new Error(`INVALID_STATE: cannot purge message in status=${row.status}`);
    }
    await this.engine.delete(QUEUE_TABLE, { where: { id: messageId }, context: SYSTEM_CTX });
  }

  // ── Worker lifecycle ─────────────────────────────────────────────

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.pollOnce()
        .catch((err) => { this.logger?.warn?.('DbQueueAdapter: poll tick failed', err); })
        .finally(() => { this.running = false; });
    }, this.opts.pollIntervalMs);
    (this.timer as any)?.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  /** Test-friendly synchronous poll. */
  async pollOnce(): Promise<number> {
    const queues = [...this.handlers.keys()];
    if (queues.length === 0) return 0;

    let processed = 0;
    for (const queue of queues) {
      const claimed = await this.claimBatch(queue, this.opts.batchSize);
      for (const row of claimed) {
        await this.dispatch(row);
        processed++;
      }
    }
    return processed;
  }

  // ── Internals ────────────────────────────────────────────────────

  private async claimBatch(queue: string, max: number): Promise<any[]> {
    const now = this.now();
    const candidates = await this.engine.find(QUEUE_TABLE, {
      where: { queue, status: 'pending' },
      limit: max * 3, // over-fetch in case of CAS contention
      orderBy: [
        { field: 'priority', order: 'asc' },
        { field: 'scheduled_for', order: 'asc' },
      ],
      context: SYSTEM_CTX,
    });

    const out: any[] = [];
    for (const row of candidates ?? []) {
      if (out.length >= max) break;
      const sched = row.scheduled_for ? new Date(row.scheduled_for).getTime() : 0;
      if (sched > now.getTime()) continue;
      // Honor existing lease
      const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
      if (row.locked_by && lockedUntil > now.getTime()) continue;

      // CAS — only update if still pending (best-effort with engine.update which
      // typically does row-level update by id; concurrent workers will overwrite
      // each other but the dispatcher tolerates duplicate delivery via attempts).
      try {
        await this.engine.update(QUEUE_TABLE, {
          id: row.id,
          status: 'running',
          locked_by: this.opts.workerId,
          locked_until: new Date(now.getTime() + this.opts.leaseMs).toISOString(),
          updated_at: now.toISOString(),
        }, { context: SYSTEM_CTX });
        out.push({ ...row, status: 'running' });
      } catch (err) {
        this.logger?.warn?.('DbQueueAdapter: claim CAS failed', err as any);
      }
    }
    return out;
  }

  private async dispatch(row: any): Promise<void> {
    const handlers = this.handlers.get(row.queue) ?? [];
    if (handlers.length === 0) {
      // No handler — release lease so another process can pick it up
      await this.releasePending(row.id);
      return;
    }

    const msg: QueueMessage = {
      id: String(row.id),
      data: parseJson(row.payload_json),
      attempts: (row.attempts ?? 0) + 1,
      timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    };

    let success = true;
    let lastError: string | undefined;
    for (const h of handlers) {
      try { await h.fn(msg); }
      catch (err) {
        success = false;
        lastError = err instanceof Error ? err.message : String(err);
        this.logger?.warn?.(`DbQueueAdapter: handler failed on ${row.queue}`, err as any);
        break;
      }
    }

    const now = this.now();
    if (success) {
      await this.engine.update(QUEUE_TABLE, {
        id: row.id,
        status: 'completed',
        attempts: msg.attempts,
        completed_at: now.toISOString(),
        locked_by: null,
        locked_until: null,
        updated_at: now.toISOString(),
      }, { context: SYSTEM_CTX });
      return;
    }

    const attempts = msg.attempts;
    const max = row.max_attempts ?? this.opts.defaultMaxAttempts;
    if (attempts >= max) {
      await this.engine.update(QUEUE_TABLE, {
        id: row.id,
        status: 'dlq',
        attempts,
        last_error: lastError ?? 'unknown error',
        completed_at: now.toISOString(),
        locked_by: null,
        locked_until: null,
        updated_at: now.toISOString(),
      }, { context: SYSTEM_CTX });
      return;
    }

    const backoffMs = this.computeBackoff(row, attempts);
    await this.engine.update(QUEUE_TABLE, {
      id: row.id,
      status: 'pending',
      attempts,
      last_error: lastError ?? 'unknown error',
      scheduled_for: new Date(now.getTime() + backoffMs).toISOString(),
      locked_by: null,
      locked_until: null,
      updated_at: now.toISOString(),
    }, { context: SYSTEM_CTX });
  }

  private computeBackoff(row: any, attempt: number): number {
    const base = row.backoff_delay_ms ?? 1000;
    const cap = row.backoff_max_delay_ms ?? undefined;
    if ((row.backoff_type ?? 'exponential') === 'fixed') return base;
    const exp = base * Math.pow(2, Math.max(0, attempt - 1));
    return cap ? Math.min(exp, cap) : exp;
  }

  private async releasePending(id: string): Promise<void> {
    const now = this.now();
    try {
      await this.engine.update(QUEUE_TABLE, {
        id,
        status: 'pending',
        locked_by: null,
        locked_until: null,
        scheduled_for: new Date(now.getTime() + this.opts.pollIntervalMs * 5).toISOString(),
        updated_at: now.toISOString(),
      }, { context: SYSTEM_CTX });
    } catch (err) {
      this.logger?.warn?.('DbQueueAdapter: release failed', err as any);
    }
  }

  private async loadById(id: string): Promise<any | null> {
    const rows = await this.engine.find(QUEUE_TABLE, {
      where: { id },
      limit: 1,
      context: SYSTEM_CTX,
    });
    return rows?.[0] ?? null;
  }

  private rowToRecord(r: any): QueueMessageRecord {
    return {
      id: String(r.id),
      queue: String(r.queue),
      data: parseJson(r.payload_json),
      status: r.status,
      attempts: r.attempts ?? 0,
      maxAttempts: r.max_attempts ?? this.opts.defaultMaxAttempts,
      scheduledFor: r.scheduled_for ?? undefined,
      lockedBy: r.locked_by ?? undefined,
      lockedUntil: r.locked_until ?? undefined,
      lastError: r.last_error ?? undefined,
      idempotencyKey: r.idempotency_key ?? undefined,
      metadata: parseJson(r.metadata_json),
      createdAt: r.created_at ?? nowIso(this.clock),
      updatedAt: r.updated_at ?? undefined,
      completedAt: r.completed_at ?? undefined,
    };
  }

  private now(): Date {
    return this.clock?.now() ?? new Date();
  }
}
