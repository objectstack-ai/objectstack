// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Manual `AsyncIterator` factory for `repo.watch()`. Mirrors the
 * pattern used in `@objectstack/metadata-core`'s `InMemoryRepository`:
 * async generators do NOT run `finally` when paused on an unresolved
 * `await`, so we cannot use them to implement `watch()`.
 */

import type { MetadataEvent, WatchFilter } from '@objectstack/metadata-core';
import { type EventBroker, type BrokerSubscriber } from './sync.js';

export interface CreateWatchIteratorArgs {
  filter: WatchFilter;
  since: number | undefined;
  replay: MetadataEvent[];
  broker: EventBroker;
  /** Returns true if `evt.ref` matches `filter`. */
  matches: (evt: MetadataEvent, filter: WatchFilter) => boolean;
  branchKeyOf: (evt: MetadataEvent) => string;
  /**
   * Checked ONCE, immediately after this subscription is registered. True
   * means the repository shut down while `watch()`'s deferred log replay was
   * still in flight, so this subscription arrived after `close()` had already
   * swept the broker. It is terminated on arrival rather than left parked on a
   * broker nobody will publish to or drain again (#11127).
   */
  arrivesClosed?: () => boolean;
}

export function createWatchIterable(
  args: CreateWatchIteratorArgs,
): AsyncIterable<MetadataEvent> {
  const queue: MetadataEvent[] = [];
  let waiter: ((evt: IteratorResult<MetadataEvent>) => void) | null = null;
  let closed = false;
  const delivered = new Set<string>();
  const evtKey = (e: MetadataEvent) => `${args.branchKeyOf(e)}#${e.seq}`;

  const subscriber: BrokerSubscriber = {
    filter: args.filter,
    closed: false,
    // Assigned below, once `close` exists. Termination and the consumer's own
    // `return()` are ONE routine, deliberately: invariant 8 requires shutdown
    // to be indistinguishable from `iterator.return()`.
    terminate: () => undefined,
    push: (evt) => {
      if (subscriber.closed) return;
      const k = evtKey(evt);
      if (delivered.has(k)) return;
      if (waiter) {
        delivered.add(k);
        const w = waiter;
        waiter = null;
        w({ value: clone(evt), done: false });
      } else {
        queue.push(evt);
      }
    },
  };
  args.broker.subscribe(subscriber);

  const replay = [...args.replay].sort((a, b) => a.seq - b.seq);
  let replayIdx = 0;

  const drain = (): IteratorResult<MetadataEvent> | null => {
    while (replayIdx < replay.length) {
      const evt = replay[replayIdx++]!;
      if (typeof args.since === 'number' && evt.seq <= args.since) continue;
      const k = evtKey(evt);
      if (delivered.has(k)) continue;
      delivered.add(k);
      return { value: clone(evt), done: false };
    }
    while (queue.length > 0) {
      const evt = queue.shift()!;
      const k = evtKey(evt);
      if (delivered.has(k)) continue;
      delivered.add(k);
      return { value: clone(evt), done: false };
    }
    return null;
  };

  const close = (): IteratorResult<MetadataEvent> => {
    if (!closed) {
      closed = true;
      subscriber.closed = true;
      args.broker.unsubscribe(subscriber);
      if (waiter) {
        const w = waiter;
        waiter = null;
        w({ value: undefined, done: true });
      }
    }
    return { value: undefined, done: true };
  };

  // The terminator `repo.close()` runs. Same routine as `return()` below.
  subscriber.terminate = close;

  // Shutdown that landed while the deferred log replay was in flight — this
  // subscription missed the sweep, so it terminates on arrival (#11127).
  if (args.arrivesClosed?.()) close();

  const iterator: AsyncIterator<MetadataEvent> = {
    next: () => {
      if (closed) return Promise.resolve({ value: undefined, done: true });
      const immediate = drain();
      if (immediate) return Promise.resolve(immediate);
      return new Promise<IteratorResult<MetadataEvent>>((resolve) => {
        waiter = resolve;
      });
    },
    return: () => Promise.resolve(close()),
    throw: (err) => {
      close();
      return Promise.reject(err);
    },
  };
  return { [Symbol.asyncIterator]: () => iterator };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
