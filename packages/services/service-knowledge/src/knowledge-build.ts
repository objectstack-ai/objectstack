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
 * - `not-built-here` — the service does not build this source: a `file` or
 *   `http` source (its adapter ingests it), or no data engine is bound.
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

/** Who started a build: the boot's first-build pass, or an administrator. */
export type KnowledgeBuildTrigger = 'boot' | 'operator';

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
 *
 * Kept in memory, one per source, replaced by the next build: a node answers
 * for the builds it ran, and a restarted node remembers none.
 */
export interface KnowledgeBuildRecord {
  sourceId: string;
  trigger: KnowledgeBuildTrigger;
  status: 'running' | 'done' | 'failed' | 'not-run';
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

/** The least time between two progress lines of one running build. */
export const BUILD_PROGRESS_LOG_INTERVAL_MS = 10_000;

/** The cluster lock key one source's build is held under. */
export function buildLockKey(sourceId: string): string {
  return `knowledge:build:${sourceId}`;
}

/**
 * Renew `handle`'s lease every `leaseMs / 3` until the returned stop function
 * is called. A failed renewal never stops the build: `onRenewFailure` is told
 * once per failure, and renewal stops for good once the handle reports the
 * lease lost. Each renewal is armed after the previous one settles, and the
 * timer never holds the process open.
 */
export function keepBuildLeaseAlive(
  handle: KnowledgeBuildLockHandle,
  leaseMs: number,
  onRenewFailure: (err: unknown, stillHeld: boolean) => void,
): () => void {
  if (typeof handle.renew !== 'function') return () => {};
  const periodMs = Math.max(1, Math.floor(leaseMs / 3));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const beat = async (): Promise<void> => {
    try {
      await handle.renew!(leaseMs);
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
