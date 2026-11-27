// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The first build of a source and the operator's rebuild (ADR-0161 K7, "What
 * starts a rebuild"; K8, item 8 b).
 *
 * The knowledge service reads what a source's adapter holds at boot and
 * builds the sources that need it, and an administrator can start a rebuild
 * of one source. This file holds the shapes both answer in and the lease the
 * build runs under; the reading and the build are
 * `KnowledgeService.readIndexState` and `KnowledgeService.rebuildSource`.
 *
 * ## One node builds a source
 *
 * A build runs under the platform's cluster lock (the `cluster` service's
 * `lock`, the same lease `service-job`'s scheduler elects its leader with),
 * on the key {@link buildLockKey}: only the node that acquires it builds, and
 * a boot build re-reads the adapter after acquiring it, so a node that boots
 * while another has just finished builds nothing. The lease is renewed while
 * the build runs, so a long build keeps it; a node that dies stops renewing
 * and the key frees itself. A composition with no cluster service is one
 * node. A lock that does not answer is no answer at all: no node can prove it
 * alone builds, so none starts (the boot logs it; the next boot or an
 * operator rebuild asks again). Beneath the lease, a store that keeps
 * generations takes its own builder lock in `beginBuild` (K7, rule 2).
 *
 * ## A build that loses its lease stops; a build that stalls is cancelled
 *
 * Before each page the walk asks the build's fence ({@link startBuildFence})
 * whether it may go on. A lease the lock reports lost, or one not renewed
 * within its {@link BUILD_LEASE_MS} (the lock store unreachable, or a renewal
 * that hangs), stops the build there: no further page is read or embedded,
 * nothing is purged or completed, and the record says `lease-lost`. Another
 * node may build the source from then on; what this one wrote stays, and the
 * next build skips it as unchanged.
 *
 * A build that finishes no page for {@link BUILD_STALL_LIMIT_MS} (an
 * embedding call or a store call that never answers) is cancelled: the walk
 * stops waiting on that call, the lease is released, and the record says
 * `timed-out`. The bound is a fixed ceiling on the time between two pages (or
 * two purge deletions), not on a whole build, so a large source that keeps
 * making progress is never cut short. A call the build stopped waiting on
 * cannot be withdrawn: if it answers later its write lands in the store as
 * any page's would, and the walk never continues after it. A purge removal
 * that never answers also keeps that document's own sync queue held, and the
 * store still lists the document, so every later complete build reaches it in
 * its purge, waits there and is cancelled in turn, until the removal answers
 * or the process restarts.
 *
 * The completion (the adapter's `completeBuild`: pgvector's switch to the new
 * generation and its sweep of the replaced one) is not a page. It begins only
 * if the fence still lets the build go on, and once it has begun the bound no
 * longer applies: a switch that began before the bound passed still commits,
 * and the build waits for it however long it takes, so its record reads
 * `done` or `failed`, never `timed-out`. Until it settles the source's walk
 * queue stays held, so no rebuild on this node begins a build (or takes the
 * store's builder lock) beside it. A completion that never answers keeps the
 * build `running` until it answers or the process restarts.
 *
 * ## What a build costs
 *
 * A complete build reads every row its source's `where` matches and sends the
 * listed content fields of each one the adapter does not already hold
 * unchanged to the embedding provider. Every line that starts a build says so.
 */

import type { AdapterIndexStatus, KnowledgeReindexResult } from '@objectstack/spec/contracts';

/**
 * What a source's adapter holds, against what the service expects of it
 * (ADR-0161 K7, "What starts a rebuild"):
 *
 * - `nothing` — the adapter holds nothing for the source, or only a first
 *   generation `beginBuild` opened and no build completed (no fingerprint is
 *   active yet). Built.
 * - `new-fingerprint` — the active generation's fingerprint is not the one
 *   the service computes now (another model, dimensions or split). Built as a
 *   new generation.
 * - `recipe-changed` — same fingerprint, another recipe hash (the source's
 *   `where`, `metadataFields`, the title rule or the withheld fields moved).
 *   Rebuilt inside the generation.
 * - `no-recipe-hash` — same fingerprint, no recipe hash recorded (an index
 *   built before the adapter recorded one). Rebuilt when the adapter has
 *   `completeBuild`, which records it; left alone, with a warning, when not.
 * - `current` — same fingerprint, same recipe hash. Nothing to do.
 * - `listed-empty` — the adapter has no `indexStatus`, and its
 *   `listDocuments` answers no document. Built.
 * - `listed-documents` — the adapter has no `indexStatus`, and lists a
 *   document. Left alone.
 * - `unknown` — the adapter has neither method. Nothing is built
 *   automatically; the operator's rebuild is the way.
 * - `unreadable` — reading the adapter failed. Nothing is built; `detail`
 *   says why.
 * - `not-built-here` — the service cannot build this source here: no data
 *   engine is bound.
 */
export type KnowledgeIndexState =
  | 'nothing'
  | 'new-fingerprint'
  | 'recipe-changed'
  | 'no-recipe-hash'
  | 'current'
  | 'listed-empty'
  | 'listed-documents'
  | 'unknown'
  | 'unreadable'
  | 'not-built-here';

/** One reading of a source's index (`KnowledgeService.readIndexState`). */
export interface KnowledgeIndexReading {
  sourceId: string;
  state: KnowledgeIndexState;
  /** Whether a complete build is due for this state. */
  due: boolean;
  /** One sentence for the log and the operator. */
  detail: string;
  /** What the adapter's `indexStatus` answered, when it has one and answered. */
  held?: AdapterIndexStatus;
}

/**
 * Who started a build: the boot's first-build pass, a `knowledge_source` item
 * that was added or changed while the process runs (`reload`), or an
 * administrator.
 */
export type KnowledgeBuildTrigger = 'boot' | 'reload' | 'operator';

/** How far a running build has walked; the totals of a finished one. */
export interface KnowledgeBuildProgress {
  /** Pages of rows read so far. */
  pages: number;
  /** Rows read so far. */
  discovered: number;
  /** Documents written to the adapter so far. */
  indexed: number;
  /** Documents the adapter already held unchanged, so not written. */
  skipped: number;
  /** Documents that cannot be indexed under the source's split, removed. */
  failed: number;
}

/**
 * The last build of a source on this node (`KnowledgeService.buildRecord`).
 *
 * - `running` — the walk is under way; `progress` moves.
 * - `done` — the walk and its purge finished and the adapter recorded the
 *   build; `result` is the reindex result.
 * - `failed` — the walk ran and did not finish (`result.ok` is `false`), or
 *   threw; the adapter keeps what it held and the next build starts again.
 * - `not-run` — no walk ran: another node holds the build, the cluster lock
 *   did not answer, or (at boot) the adapter turned out to be current when
 *   the lock was held. `message` says which.
 * - `lease-lost` — the walk stopped before a page because the build's
 *   cluster lease was lost; nothing was purged or completed, and another node
 *   may build the source. `message` says how it was lost.
 * - `timed-out` — no page finished for {@link BUILD_STALL_LIMIT_MS}: the
 *   build was cancelled and its lease released; nothing was purged or
 *   completed.
 *
 * Like `failed`, the last two leave the adapter with what it held, and the
 * next build starts again.
 *
 * Kept in memory, one per source, replaced by the next build: a node answers
 * for the builds it ran, and a restarted node remembers none.
 */
export interface KnowledgeBuildRecord {
  sourceId: string;
  trigger: KnowledgeBuildTrigger;
  status: 'running' | 'done' | 'failed' | 'not-run' | 'lease-lost' | 'timed-out';
  /** ISO-8601 time the build was asked for. */
  startedAt: string;
  /** ISO-8601 time it ended; absent while it runs. */
  finishedAt?: string;
  progress: KnowledgeBuildProgress;
  /** The reindex result, once the walk returned one. */
  result?: KnowledgeReindexResult;
  /** One sentence: why it did not run, or the result's own message. */
  message?: string;
}

/** A lease on the cluster lock, as the build uses it (`LockHandle`, `@objectstack/spec/contracts`). */
export interface KnowledgeBuildLockHandle {
  release(): Promise<void>;
  /** Extend the lease by `ttlMs`. Throws when the lease was lost. */
  renew?(ttlMs?: number): Promise<void>;
  /** True while this handle still owns the lock. */
  isHeld?(): boolean;
}

/** The part of the cluster service's `lock` (`ILock`) a build asks. */
export interface KnowledgeBuildLock {
  acquire(key: string, opts?: { ttlMs?: number; waitMs?: number }): Promise<KnowledgeBuildLockHandle | null>;
}

/** The lease a build takes on {@link buildLockKey}; renewed every third of it while the build runs. */
export const BUILD_LEASE_MS = 60_000;

/**
 * The longest a build may go without finishing a page (its read, its
 * embedding and its write), or between its start and its first page, or
 * between its last page and its end: past it the build is cancelled, its
 * lease released and its record `timed-out`. A fixed ceiling: a page is at
 * most `REINDEX_PAGE_SIZE` rows, so one that has not finished in this long
 * is waiting on a call that does not answer.
 */
export const BUILD_STALL_LIMIT_MS = 15 * 60_000;

/** The least time between two progress lines of one running build. */
export const BUILD_PROGRESS_LOG_INTERVAL_MS = 10_000;

/** The cluster lock key one source's build is held under. */
export function buildLockKey(sourceId: string): string {
  return `knowledge:build:${sourceId}`;
}

/**
 * Renew `handle`'s lease every `leaseMs / 3` until the returned stop function
 * is called. `onRenewed` is told when each renewal that started at
 * `startedAt` succeeded; `onRenewFailure` once per failed one, and renewal
 * stops for good once the handle reports the lease lost. Each renewal is
 * armed after the previous one settles, so a renewal that hangs arms no
 * other, and the timer never holds the process open. Whether the build goes
 * on is the fence's question ({@link startBuildFence}), not this one's.
 */
export function keepBuildLeaseAlive(
  handle: KnowledgeBuildLockHandle,
  leaseMs: number,
  onRenewFailure: (err: unknown, stillHeld: boolean) => void,
  onRenewed?: (startedAt: number) => void,
): () => void {
  if (typeof handle.renew !== 'function') return () => {};
  const periodMs = Math.max(1, Math.floor(leaseMs / 3));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const beat = async (): Promise<void> => {
    const startedAt = Date.now();
    try {
      await handle.renew!(leaseMs);
      if (!stopped) onRenewed?.(startedAt);
    } catch (err) {
      if (stopped) return;
      const held = handle.isHeld?.() === true;
      onRenewFailure(err, held);
      if (!held) return;
    }
    arm();
  };
  const arm = (): void => {
    if (stopped) return;
    timer = setTimeout(() => { void beat(); }, periodMs);
    (timer as { unref?: () => void } | undefined)?.unref?.();
  };
  arm();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** A fresh, zeroed progress. */
export function emptyBuildProgress(): KnowledgeBuildProgress {
  return { pages: 0, discovered: 0, indexed: 0, skipped: 0, failed: 0 };
}

/** Why a build was stopped before it ended: its record's status. */
export type KnowledgeBuildStopReason = 'lease-lost' | 'timed-out';

/** A build's stop: why, and one sentence saying so. */
export interface KnowledgeBuildStop {
  reason: KnowledgeBuildStopReason;
  message: string;
}

/**
 * What a running build asks before each page, and races what it waits on
 * against (`KnowledgeService.rebuildSource` starts one per build).
 */
export interface KnowledgeBuildFence {
  /** Why the build must stop now, or `undefined` while it may go on. */
  stop(): KnowledgeBuildStop | undefined;
  /** Settles with the stop once the build passed {@link BUILD_STALL_LIMIT_MS} without a page; never rejects. */
  readonly cancelled: Promise<KnowledgeBuildStop>;
  /** A page (or a purge deletion) finished: the stall bound starts again. */
  progressed(): void;
  /**
   * The build's completion began: it is not a page, so the stall bound is
   * disarmed for the rest of the build and {@link cancelled} never settles
   * after this. The lease is still renewed until {@link close}.
   */
  completing(): void;
  /** The build ended: renewal stops and the bound is disarmed. */
  close(): void;
}

/**
 * Start the fence of one build: renew `handle`'s lease
 * ({@link keepBuildLeaseAlive}) and arm the stall bound.
 *
 * The lease reads as lost once the handle says it is not held, once a
 * renewal failed and the handle no longer holds it, or once `leaseMs` passed
 * since the last renewal that succeeded (since the fence started, before the
 * first) — the case of a lock store that does not answer, where neither a
 * renewal nor its failure ever arrives. A handle with no `renew` is judged by
 * `isHeld` alone. With no handle (a composition with no cluster service) only
 * the bound applies. The first stop seen is the one kept.
 */
export function startBuildFence(opts: {
  handle?: KnowledgeBuildLockHandle | null;
  leaseMs: number;
  stallMs: number;
  onRenewFailure?: (err: unknown, stillHeld: boolean) => void;
}): KnowledgeBuildFence {
  const { handle, leaseMs, stallMs } = opts;
  let stopped: KnowledgeBuildStop | undefined;
  let closed = false;
  let unbounded = false;
  let renewalLost = false;
  const renews = typeof handle?.renew === 'function';
  let heldUntil = Date.now() + leaseMs;
  const stopRenewal = handle
    ? keepBuildLeaseAlive(
      handle,
      leaseMs,
      (err, stillHeld) => {
        if (!stillHeld) renewalLost = true;
        opts.onRenewFailure?.(err, stillHeld);
      },
      (startedAt) => {
        heldUntil = Math.max(heldUntil, startedAt + leaseMs);
      },
    )
    : () => {};

  let settle: (stop: KnowledgeBuildStop) => void = () => {};
  const cancelled = new Promise<KnowledgeBuildStop>((resolve) => {
    settle = resolve;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    if (closed || stopped || unbounded) return;
    timer = setTimeout(() => {
      if (closed || stopped || unbounded) return;
      const minutes = Math.round(stallMs / 60_000);
      stopped = {
        reason: 'timed-out',
        message:
          `no page finished for ${minutes >= 1 ? `${minutes} minute(s)` : `${stallMs} ms`} (a call to the embedding ` +
          'provider or to the store that does not answer), so the build was cancelled and its lease released.',
      };
      settle(stopped);
    }, stallMs);
    (timer as { unref?: () => void } | undefined)?.unref?.();
  };
  arm();

  const leaseLost = (): string | undefined => {
    if (!handle) return undefined;
    if (renewalLost || handle.isHeld?.() === false) return 'the cluster lock reports the lease is no longer held';
    if (renews && Date.now() >= heldUntil) {
      return `the lease was not renewed within its ${Math.round(leaseMs / 1000)} s (the lock store did not answer, or a renewal hangs)`;
    }
    return undefined;
  };

  return {
    stop() {
      if (stopped) return stopped;
      if (closed) return undefined;
      const lost = leaseLost();
      if (lost !== undefined) {
        stopped = {
          reason: 'lease-lost',
          message:
            `the build's cluster lease was lost (${lost}), so it stopped before its next page; another node may ` +
            'build the source now.',
        };
      }
      return stopped;
    },
    cancelled,
    progressed() {
      arm();
    },
    completing() {
      unbounded = true;
      if (timer) clearTimeout(timer);
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      stopRenewal();
    },
  };
}

/**
 * `work`, raced against `fence`'s bound: answers `work`'s outcome, or throws
 * the stop once the build is cancelled. A `work` that settles after that is
 * dropped (its rejection is handled here, never left unhandled). No fence:
 * `work` itself.
 */
export function fencedCall<T>(fence: KnowledgeBuildFence | undefined, work: Promise<T>): Promise<T> {
  if (!fence) return work;
  work.catch(() => undefined);
  return Promise.race([
    work,
    fence.cancelled.then((stop): never => {
      throw new Error(stop.message);
    }),
  ]);
}
