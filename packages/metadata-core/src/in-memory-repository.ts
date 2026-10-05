// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `InMemoryRepository` — reference implementation of `MetadataRepository`
 * backed by plain JS Maps. Used by:
 *
 *   - tests (parameterized contract-test suite)
 *   - edge / serverless runtimes (no FS, no DB)
 *   - `LayeredRepository` fallbacks
 *
 * State model
 * ───────────
 *   items   : refKey → MetadataItem (current head)
 *   logs    : org → MetadataEvent[]  (append-only, monotonic per org)
 *   seqs    : org → number
 *
 * `watch()` is implemented over a simple subscriber list. Each subscriber
 * receives a deep-copy of the event so they cannot mutate the log.
 */

import {
  type MetaRef,
  type MetadataItem,
  type MetadataItemHeader,
  type MetadataEvent,
  type PutOptions,
  type PutResult,
  type DeleteOptions,
  type DeleteResult,
  type ListFilter,
  type WatchFilter,
  type HistoryOptions,
  type MetadataType,
  refKey,
} from './types.js';
import { hashSpec } from './canonicalize.js';
import { ConflictError } from './errors.js';
import type { MetadataRepository } from './repository.js';

const orgKey = (ref: Pick<MetaRef, 'org'>): string => ref.org;

const matchesFilter = (
  ref: MetaRef,
  filter: { org?: string; type?: MetadataType; name?: string },
): boolean => {
  if (filter.org && filter.org !== ref.org) return false;
  if (filter.type && filter.type !== ref.type) return false;
  if (filter.name && filter.name !== ref.name) return false;
  return true;
};

interface Subscriber {
  filter: WatchFilter;
  push: (evt: MetadataEvent) => void;
  closed: boolean;
}

export interface InMemoryRepositoryOptions {
  /** Optional clock injection for deterministic tests. Default: Date.now. */
  now?: () => Date;
}

export class InMemoryRepository implements MetadataRepository {
  private readonly items = new Map<string, MetadataItem>();
  /** Per-org event log. */
  private readonly logs = new Map<string, MetadataEvent[]>();
  /** Next seq per org. */
  private readonly seqs = new Map<string, number>();
  private readonly subscribers = new Set<Subscriber>();
  private readonly now: () => Date;

  constructor(opts: InMemoryRepositoryOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  async get(ref: MetaRef): Promise<MetadataItem | null> {
    const item = this.items.get(refKey(ref));
    if (!item) return null;
    if (ref.version && item.hash !== ref.version) {
      // History lookup is not supported in this minimal impl — only HEAD.
      // A future revision may walk the log to reconstruct an old version.
      return null;
    }
    return clone(item);
  }

  async getByHash(ref: MetaRef, hash: string): Promise<MetadataItem | null> {
    // InMemoryRepository keeps only HEAD bodies; historical bodies are
    // not retained. Resolve only if the requested hash IS HEAD.
    const item = this.items.get(refKey(ref));
    if (!item || item.hash !== hash) return null;
    return clone(item);
  }

  async put(ref: MetaRef, spec: unknown, opts: PutOptions): Promise<PutResult> {
    const key = refKey(ref);
    const current = this.items.get(key);
    const currentHead = current?.hash ?? null;

    if ((opts.parentVersion ?? null) !== currentHead) {
      throw new ConflictError(ref, opts.parentVersion ?? null, currentHead);
    }

    // [#21790] Hashed as its type — a declared ordered map keeps its order.
    const hash = hashSpec(spec, ref.type);

    // No-op write — same content. Still consumes nothing; no event emitted.
    if (current && current.hash === hash) {
      return { version: hash, seq: current.seq, item: clone(current) };
    }

    const seq = this.bumpSeq(ref);
    const ts = this.now().toISOString();

    const item: MetadataItem = {
      ref: { ...ref, version: undefined },
      body: clonePlain(spec) as Record<string, unknown>,
      hash,
      parentHash: currentHead,
      authoredBy: opts.actor,
      authoredAt: ts,
      message: opts.message,
      seq,
    };

    this.items.set(key, item);

    const evt: MetadataEvent = {
      seq,
      op: current ? 'update' : 'create',
      ref: { ...ref, version: undefined },
      hash,
      parentHash: currentHead,
      actor: opts.actor,
      message: opts.message,
      ts,
      source: opts.source ?? 'in-memory',
    };
    this.appendEvent(ref, evt);

    return { version: hash, seq, item: clone(item) };
  }

  async delete(ref: MetaRef, opts: DeleteOptions): Promise<DeleteResult> {
    const key = refKey(ref);
    const current = this.items.get(key);
    const currentHead = current?.hash ?? null;
    if (currentHead !== opts.parentVersion) {
      throw new ConflictError(ref, opts.parentVersion, currentHead);
    }

    this.items.delete(key);
    const seq = this.bumpSeq(ref);
    const ts = this.now().toISOString();
    const evt: MetadataEvent = {
      seq,
      op: 'delete',
      ref: { ...ref, version: undefined },
      hash: null,
      parentHash: currentHead,
      actor: opts.actor,
      message: opts.message,
      ts,
      source: opts.source ?? 'in-memory',
    };
    this.appendEvent(ref, evt);
    return { seq };
  }

  async *list(filter: ListFilter): AsyncIterable<MetadataItemHeader> {
    const limit = filter.limit ?? Infinity;
    let yielded = 0;
    for (const item of this.items.values()) {
      if (!matchesFilter(item.ref, filter)) continue;
      if (filter.nameContains && !item.ref.name.includes(filter.nameContains)) continue;
      const { body, ...header } = item;
      void body;
      yield clone(header) as MetadataItemHeader;
      if (++yielded >= limit) return;
    }
  }

  async *history(ref: MetaRef, opts: HistoryOptions = {}): AsyncIterable<MetadataEvent> {
    const log = this.logs.get(orgKey(ref)) ?? [];
    const since = opts.sinceSeq ?? -1;
    const limit = opts.limit ?? Infinity;
    let yielded = 0;
    for (const evt of log) {
      if (evt.seq <= since) continue;
      if (evt.ref.type !== ref.type || evt.ref.name !== ref.name) continue;
      yield clone(evt);
      if (++yielded >= limit) return;
    }
  }

  watch(filter: WatchFilter, since?: number): AsyncIterable<MetadataEvent> {
    // Implemented as a manual async iterator (not a generator) so we can
    // implement `return()` to unblock a pending wait. Async generators
    // do NOT run their `finally` block when paused on an unresolved
    // `await` — see https://github.com/tc39/proposal-async-iteration.
    const queue: MetadataEvent[] = [];
    let waiter: ((evt: IteratorResult<MetadataEvent>) => void) | null = null;
    let closed = false;
    const delivered = new Set<string>();
    const evtKey = (e: MetadataEvent) => `${orgKey(e.ref)}#${e.seq}`;

    const subscriber: Subscriber = {
      filter,
      closed: false,
      push: (evt) => {
        if (subscriber.closed) return;
        if (waiter) {
          const k = evtKey(evt);
          if (delivered.has(k)) return;
          delivered.add(k);
          const w = waiter;
          waiter = null;
          w({ value: clone(evt), done: false });
        } else {
          queue.push(evt);
        }
      },
    };

    // Build the replay buffer BEFORE registering the subscriber to avoid
    // a race window? No — we register first then build replay, dedup'ing
    // by seq when we hand off to live so any event that arrives during
    // replay isn't double-delivered.
    this.subscribers.add(subscriber);

    const replay: MetadataEvent[] = [];
    for (const ok of this.orgKeysMatching(filter)) {
      const log = this.logs.get(ok) ?? [];
      for (const evt of log) {
        if (typeof since === 'number' && evt.seq <= since) continue;
        if (!matchesFilter(evt.ref, filter)) continue;
        replay.push(evt);
      }
    }
    replay.sort((a, b) => a.seq - b.seq);
    let replayIdx = 0;

    const drainQueueOrReplay = (): IteratorResult<MetadataEvent> | null => {
      while (replayIdx < replay.length) {
        const evt = replay[replayIdx++]!;
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
        this.subscribers.delete(subscriber);
        if (waiter) {
          const w = waiter;
          waiter = null;
          w({ value: undefined, done: true });
        }
      }
      return { value: undefined, done: true };
    };

    const iterator: AsyncIterator<MetadataEvent> = {
      next: () => {
        if (closed) return Promise.resolve({ value: undefined, done: true });
        const immediate = drainQueueOrReplay();
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

    return {
      [Symbol.asyncIterator]: () => iterator,
    };
  }

  // ── Internals ───────────────────────────────────────────────────────

  private bumpSeq(ref: Pick<MetaRef, 'org'>): number {
    const ok = orgKey(ref);
    const next = (this.seqs.get(ok) ?? 0) + 1;
    this.seqs.set(ok, next);
    return next;
  }

  private appendEvent(ref: Pick<MetaRef, 'org'>, evt: MetadataEvent): void {
    const ok = orgKey(ref);
    const log = this.logs.get(ok) ?? [];
    log.push(evt);
    this.logs.set(ok, log);
    // Broadcast
    for (const sub of this.subscribers) {
      if (sub.closed) continue;
      if (!matchesFilter(evt.ref, sub.filter)) continue;
      sub.push(evt);
    }
  }

  private orgKeysMatching(filter: WatchFilter): string[] {
    const keys: string[] = [];
    for (const ok of this.logs.keys()) {
      if (filter.org && filter.org !== ok) continue;
      keys.push(ok);
    }
    return keys;
  }
}

/** Deep clone via JSON; safe for `MetadataItem` / `MetadataEvent`. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Clone a value that the caller passed in; rejects functions/symbols. */
function clonePlain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
