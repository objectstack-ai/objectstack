// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Mutex / event-broker primitives used by FileSystemRepository.
 *
 * `KeyedMutex` serializes operations on the same key (refKey). The
 * broker re-uses the same manual-AsyncIterator pattern as
 * InMemoryRepository so that consumer `return()` reliably unblocks.
 */

import type { MetadataEvent, WatchFilter } from '@objectstack/metadata-core';

export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // Save the swallowed-error tail so successive runs don't reject on
    // an unrelated prior failure.
    const swallowed = next.catch(() => undefined);
    this.tails.set(key, swallowed);
    try {
      return await next;
    } finally {
      // Best-effort cleanup: drop the entry if nothing newer was queued.
      if (this.tails.get(key) === swallowed) {
        this.tails.delete(key);
      }
    }
  }
}

/**
 * One live `watch()` subscription, as a record rather than a bare event sink.
 *
 * Both halves live together because SHUTDOWN NEEDS THE SECOND ONE. A registry
 * of event sinks can only express shutdown as "send an event", and an event is
 * precisely what a filtered or numeric-`since` subscriber is entitled to drop
 * — and delivering one has never ended an iterator anyway. See invariant 8 in
 * `@objectstack/metadata-core`'s `repository.ts` (#11021, #11127).
 */
export interface BrokerSubscriber {
  filter: WatchFilter;
  closed: boolean;
  push(evt: MetadataEvent): void;
  /**
   * Ends this subscription's iterator: settles a parked `next()` with
   * `{ done: true }` and no value, and unregisters. The SAME routine
   * `iterator.return()` runs, so a consumer that breaks its loop and a
   * consumer whose repository shut down under it observe the same thing.
   */
  terminate(): void;
}

export interface EventBroker {
  subscribe(sub: BrokerSubscriber): void;
  unsubscribe(sub: BrokerSubscriber): void;
  publish(evt: MetadataEvent): void;
  /**
   * Terminate every live subscription. This is what `FileSystemRepository`'s
   * repository-level `close()` owes a pending iterator (#11127): before it
   * existed, `close()` retired the chokidar watcher and the resync sweep and
   * stopped there, so the source that could settle a parked `next()` was gone
   * while the subscriber stayed registered with nothing left to settle it.
   *
   * Idempotent, and a no-op when nothing is watching.
   */
  terminateAll(): void;
}

export function createBroker(matches: (evt: MetadataEvent, filter: WatchFilter) => boolean): EventBroker {
  const subs = new Set<BrokerSubscriber>();
  return {
    subscribe: (s) => { subs.add(s); },
    unsubscribe: (s) => { subs.delete(s); },
    publish: (evt) => {
      for (const s of subs) {
        if (s.closed) continue;
        if (!matches(evt, s.filter)) continue;
        s.push(evt);
      }
    },
    terminateAll: () => {
      // Snapshot and clear BEFORE terminating: `terminate()` unregisters
      // itself, and mutating a Set under its own iteration is how the second
      // subscriber gets skipped.
      const snapshot = Array.from(subs);
      subs.clear();
      for (const s of snapshot) {
        try {
          s.terminate();
        } catch {
          /* one wedged consumer must not strand the rest */
        }
      }
    },
  };
}
