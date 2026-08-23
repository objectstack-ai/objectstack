// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `MetadataRepository` interface — single point of pluggability for
 * the metadata storage backend. See ADR-0008 §2.6.
 *
 * Implementations:
 *
 * - `InMemoryRepository` (this package, for tests & edge)
 * - `FileSystemRepository` (`@objectstack/metadata`)
 * - `LayeredRepository` (`@objectstack/metadata`)
 * - `PostgresRepository` (`@objectstack/metadata-postgres`, M1)
 *
 * Implementation contract — what every backend MUST guarantee:
 *
 * 1. **Atomic put.** A successful `put()` either fully applies (item
 *    visible to subsequent `get` AND an event present in the log) or
 *    does not apply at all. No half-states.
 * 2. **Monotonic seq per org.** `seq` is strictly increasing within
 *    `org`. Different orgs have independent sequences. (Repositories
 *    scoped to a single org may treat the entire repo as one log.)
 * 3. **Optimistic locking.** `put` and `delete` throw `ConflictError`
 *    when `parentVersion` does not match the current HEAD.
 * 4. **Canonical hashing.** `item.hash === hashSpec(item.body)` — always.
 * 5. **Event ordering.** Subscribers to `watch()` receive events in
 *    monotonically-increasing `seq` order with no gaps.
 * 6. **Resumability, and where it stops.** `watch(_, since)` called with a
 *    NUMBER MUST replay all events with `seq > since` before delivering live
 *    events. Called with NO `since`, `watch()` owes **live events only** —
 *    the events that commit after the subscription is established; an
 *    implementation MAY additionally deliver events that had already
 *    committed, but a caller MUST NOT rely on it, and a caller that needs the
 *    already-committed prefix MUST pass a numeric `since` (or read
 *    `history()`). Neither form may deliver the same `seq` twice.
 *
 *    The second sentence is written down because it was load-bearing while
 *    unwritten. Invariant 6 spoke only of `seq > since`, and with no `since`
 *    there is no such set — so "no `since` replays everything" existed only
 *    as `InMemoryRepository`'s implementation, and the shared contract suite
 *    silently leaned on it. Two of the three implementations shipped today do
 *    replay the whole matching log on a bare `watch(filter)`
 *    (`InMemoryRepository`, `FileSystemRepository`); `SysMetadataRepository`
 *    delivers live events only. That spread is exactly why this is a MAY and
 *    not a MUST in either direction: forbidding the replay would break two
 *    implementations and the consumers that lean on them, requiring it would
 *    flood every `MetadataManager.setRepository()` / `MetadataCache.start()`
 *    — both of which subscribe with no `since` — with the org's entire
 *    history at attach time. What a consumer may *rely* on is the floor, and
 *    the floor is now stated instead of inherited from whichever
 *    implementation was read first.
 * 7. **Tombstones, not holes.** `delete` produces a `delete` event;
 *    `get` returns null but `history` still shows the lineage.
 * 8. **Shutdown terminates; it does not emit.** An implementation that offers
 *    a repository-level shutdown (`close()`) MUST end every live `watch()`
 *    iterator: a `next()` parked at that moment settles with `done: true` and
 *    no value, and every later `next()` does the same. That is the identical
 *    observation the consumer's own `iterator.return()` produces, deliberately
 *    — so no consumer has to tell "the repository shut down under me" apart
 *    from "I broke my own loop". Events still queued or unreplayed at that
 *    moment MAY be dropped, on both paths alike.
 *
 *    **Shutdown MUST NOT be delivered AS an event.** Written as a MUST NOT
 *    because it was tried, and both of its halves were measured (#11021). A
 *    synthetic "we are closing" event is subject to the very filters `watch()`
 *    applies to real ones, so the subscriptions that most need draining are
 *    exactly the ones that drop it: any non-empty `filter` rejects a ref
 *    invented to belong to no org, and any numeric `since` rejects a seq
 *    invented to precede every real one. Those consumers then wait forever,
 *    because the same shutdown unsubscribes them. Meanwhile a consumer whose
 *    filter happens to admit it is not rescued either — it reads a real
 *    metadata change for a ref that never existed (invalidating caches and
 *    re-emitting downstream), and its iterator hangs on the *next* pull
 *    regardless, because delivering an event has never ended one.
 *
 *    Stated conditionally because `close()` is not on the interface below;
 *    it is offered by some implementations and not others. Where it is
 *    offered, this is what it owes. Measured across today's three, and there
 *    are **no declared exceptions**: `SysMetadataRepository` conforms (#11021);
 *    `FileSystemRepository` conforms (#11127 — its `close()` used to retire
 *    the filesystem watcher and the resync sweep without ever reaching its
 *    event broker, leaving a parked iterator parked for every subscription
 *    shape, `watch({})` included; it now runs each subscription's terminator);
 *    `InMemoryRepository` offers no repository-level shutdown at all, so its
 *    iterators end only through `return()`.
 *
 *    A new implementation that offers `close()` joins that list or it does not
 *    conform — this row carries the measurement, so an implementation added
 *    without one is the omission, not an exception.
 */

import type {
  MetaRef,
  MetadataItem,
  MetadataItemHeader,
  MetadataEvent,
  PutOptions,
  PutResult,
  DeleteOptions,
  DeleteResult,
  ListFilter,
  WatchFilter,
  HistoryOptions,
} from './types.js';

export interface MetadataRepository {
  /** Read HEAD or a pinned version. Returns null if absent. */
  get(ref: MetaRef): Promise<MetadataItem | null>;

  /**
   * Resolve a historical version by content hash (ADR-0009).
   *
   * Returns the `MetadataItem` whose canonical sha256 equals `hash`
   * for the given ref, or `null` if no such version is recorded.
   *
   * Implementations MUST search history (not just HEAD) so that
   * `executionPinned` types remain resolvable through definition
   * upgrades. For non-`executionPinned` types, implementations MAY
   * return `null` if they have GC'd the corresponding history row.
   */
  getByHash(ref: MetaRef, hash: string): Promise<MetadataItem | null>;

  /**
   * Write a new version. Atomic.
   * @throws ConflictError if `parentVersion` does not match HEAD.
   * @throws SchemaValidationError if `spec` fails Zod normalisation.
   */
  put(ref: MetaRef, spec: unknown, opts: PutOptions): Promise<PutResult>;

  /**
   * Soft-delete (tombstone). `parentVersion` is required.
   * @throws ConflictError on parent mismatch.
   */
  delete(ref: MetaRef, opts: DeleteOptions): Promise<DeleteResult>;

  /** Enumerate items matching a filter. Implementations may stream. */
  list(filter: ListFilter): AsyncIterable<MetadataItemHeader>;

  /** Per-item history; events in monotonic `seq` order. */
  history(ref: MetaRef, opts?: HistoryOptions): AsyncIterable<MetadataEvent>;

  /**
   * Live event stream. The iterator MUST:
   *
   *   - When `since` is a number: replay all events with `seq > since`
   *     before yielding any new event.
   *   - When `since` is omitted: deliver live events only — the events that
   *     commit after this subscription is established. Events that had
   *     already committed MAY also be delivered, but callers MUST NOT rely
   *     on it; a caller that needs them passes a numeric `since` or reads
   *     `history()`. See invariant 6.
   *   - Stay open until the consumer breaks the loop — or until the
   *     repository shuts down under it, where an implementation offers a
   *     `close()`. Both end the stream the same way: `done: true`, no value,
   *     never a synthetic event standing in for shutdown. See invariant 8.
   *   - Survive transient backend disconnects (implementation's choice
   *     how to resume — Postgres LISTEN reconnect, JSONL tail, etc.).
   */
  watch(filter: WatchFilter, since?: number): AsyncIterable<MetadataEvent>;
}

/**
 * Sentinel symbol used by `LayeredRepository` (M0 PR-5) to label which
 * underlying layer emitted an event. Defined here so the contract is
 * shared.
 */
export const LAYER_SOURCE = Symbol.for('objectstack.metadata.layer-source');
