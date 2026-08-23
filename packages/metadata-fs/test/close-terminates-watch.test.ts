// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11127 — what `FileSystemRepository.close()` owes a pending iterator.
 *
 * Invariant 8 in `@objectstack/metadata-core`'s `repository.ts` ("shutdown
 * terminates; it does not emit"): an implementation that offers a
 * repository-level `close()` MUST end every live `watch()` iterator — a
 * `next()` parked at that moment settles with `done: true` and NO value, and
 * every later `next()` does the same. That is the identical observation the
 * consumer's own `iterator.return()` produces, deliberately.
 *
 * `close()` used to retire the chokidar watcher and the resync sweep and stop
 * there. It never reached `this.broker`, and the broker has no teardown of its
 * own — `subscribe`/`unsubscribe` add to and delete from a plain `Set`. Each
 * iterator parks its pending `next()` on a `waiter` callback that only two
 * things can settle: a broker `push`, or the iterator's own local `close()`,
 * which ran from `return()`/`throw()` and from nowhere else. After
 * `repo.close()` the chokidar source is gone so no `push` can arrive, and
 * nothing calls the terminator — so the parked pull never settled, for EVERY
 * subscription shape including `watch({})`.
 *
 * These cases assert TERMINATION, not delivery. Invariant 8 is explicit that
 * a synthetic "we are closing" event is the wrong shape (it is subject to the
 * very filters `watch()` applies to real events, and delivering an event has
 * never ended an iterator), so the assertion is `{ value: undefined, done:
 * true }` rather than "something arrived".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { MetaRef, WatchFilter } from '@objectstack/metadata-core';
import { FileSystemRepository } from '../src/index.js';

const ref: MetaRef = { org: 'system', type: 'view', name: 'sample_view' };

const PENDING = Symbol('still-pending');

/**
 * Settle-or-report-pending. Every case here has to tell "settled with
 * `done: true`" apart from "still unsettled", and a bare `await` on the
 * unsettled shape hangs the RUN rather than failing the case — which is
 * precisely the defect under test.
 */
function within<T>(p: Promise<T>, ms: number): Promise<T | typeof PENDING> {
  return Promise.race([
    p,
    new Promise<typeof PENDING>((resolve) => setTimeout(() => resolve(PENDING), ms)),
  ]);
}

/**
 * Let `watch()`'s deferred log replay settle, so the pull under test is
 * genuinely PARKED on the live broker rather than still inside the deferred
 * iterable's `await promise`. Without this the cases would prove less than
 * they claim.
 */
const parked = () => new Promise((resolve) => setTimeout(resolve, 150));

const SETTLE_MS = 2_000;

describe('FileSystemRepository — close() terminates every live watcher (#11127)', () => {
  let root: string;
  let repo: FileSystemRepository | undefined;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-fsclose-'));
  });

  afterEach(async () => {
    if (repo) await repo.close().catch(() => undefined);
    repo = undefined;
    await fs.rm(root, { recursive: true, force: true });
  });

  const makeRepo = (opts: { disableWatch?: boolean } = {}): FileSystemRepository =>
    new FileSystemRepository({
      root,
      org: 'system',
      disableWatch: opts.disableWatch ?? true,
    });

  /**
   * A bare `watch(filter)` on this implementation replays the whole matching
   * log before it parks (invariant 6's MAY half). Drain that prefix, so the
   * pull the case then parks is on the live broker.
   */
  const drainReplay = async (
    iter: AsyncIterator<unknown>,
    expected: number,
  ): Promise<void> => {
    for (let i = 0; i < expected; i++) {
      expect(await within(iter.next(), SETTLE_MS)).toMatchObject({ done: false });
    }
  };

  it.each([
    ['filtered + numeric `since`', { org: 'system' } as WatchFilter, true],
    // The row that proves the filter half bites on its own.
    ['filtered, no `since` at all', { org: 'system' } as WatchFilter, false],
    // Not filter-dependent here, unlike the sibling defect in #11021: there is
    // no drain attempt at all, so the empty filter hangs identically.
    ['empty filter, no `since`', {} as WatchFilter, false],
    ['ref-exact filter, no `since`', { org: 'system', type: 'view', name: 'sample_view' } as WatchFilter, false],
  ])('close() settles the pending next() with done:true — %s', async (_label, filter, withSince) => {
    repo = makeRepo();
    await repo.start();
    const a = await repo.put(ref, { label: '1' }, { parentVersion: null, actor: 't' });

    const iterable = withSince ? repo.watch(filter, a.seq) : repo.watch(filter);
    const iter = iterable[Symbol.asyncIterator]();
    if (!withSince) await drainReplay(iter, 1);

    const pending = iter.next();
    await parked();

    await repo.close();

    // Termination — not an event wearing `done: false`.
    expect(await within(pending, SETTLE_MS)).toEqual({ value: undefined, done: true });
    // …and the iterator is FINISHED, not merely unblocked once.
    expect(await within(iter.next(), SETTLE_MS)).toEqual({ value: undefined, done: true });
  });

  it('terminates a watcher established over the REAL chokidar watcher', async () => {
    // `close()` awaits `watcher.close()` before it gets anywhere near the
    // broker, so the armed-watcher path is its own row: a terminator that runs
    // only on the `disableWatch` path would leave every production repository
    // hanging.
    repo = makeRepo({ disableWatch: false });
    await repo.start();
    // The first write brings the root into existence, which is what arms the
    // watcher when `start()` could not (`ensureRoot`).
    await repo.put(ref, { label: '1' }, { parentVersion: null, actor: 't' });

    const iter = repo.watch({ org: 'system' }, 1)[Symbol.asyncIterator]();
    const pending = iter.next();
    await parked();

    await repo.close();

    expect(await within(pending, SETTLE_MS)).toEqual({ value: undefined, done: true });
  });

  it('finishes a watcher that has no pull outstanding at close() time', async () => {
    repo = makeRepo();
    await repo.start();
    const iter = repo.watch({ org: 'system' })[Symbol.asyncIterator]();
    await parked();

    await repo.close();

    expect(await within(iter.next(), SETTLE_MS)).toEqual({ value: undefined, done: true });
  });

  it('terminates EVERY live watcher, and is idempotent', async () => {
    repo = makeRepo();
    await repo.start();
    const iters = [
      repo.watch({ org: 'system' })[Symbol.asyncIterator](),
      repo.watch({ type: 'view' })[Symbol.asyncIterator](),
      repo.watch({ org: 'system', type: 'view', name: 'sample_view' })[Symbol.asyncIterator](),
      repo.watch({})[Symbol.asyncIterator](),
    ];
    const pendings = iters.map((it) => it.next());
    await parked();

    await repo.close();
    await repo.close();

    for (const p of pendings) {
      expect(await within(p, SETTLE_MS)).toEqual({ value: undefined, done: true });
    }
  });

  it('ends the stream exactly the way the consumer’s own `return()` does', async () => {
    // The contract sentence as a comparison rather than a claim: a consumer
    // that breaks its loop and a consumer whose repository shut down under it
    // observe the SAME thing, so neither has to special-case the other.
    const byReturn = makeRepo();
    await byReturn.start();
    const a = byReturn.watch({ org: 'system' })[Symbol.asyncIterator]();
    const aPending = a.next();
    await parked();
    void a.return?.(undefined);
    const viaReturn = await within(aPending, SETTLE_MS);
    await byReturn.close();

    repo = makeRepo();
    await repo.start();
    const b = repo.watch({ org: 'system' })[Symbol.asyncIterator]();
    const bPending = b.next();
    await parked();
    await repo.close();
    const viaClose = await within(bPending, SETTLE_MS);

    expect(viaClose).toEqual(viaReturn);
    expect(viaClose).toEqual({ value: undefined, done: true });
  });

  it('terminates a watcher whose deferred log replay was still in flight at close()', async () => {
    // `watch()` returns a DEFERRED iterable: the subscriber is registered only
    // once the eager log read resolves. A `close()` that lands inside that
    // window would otherwise hand the consumer a subscription registered on a
    // broker nobody will ever publish to or drain again — the same forever-parked
    // shape by a different route.
    repo = makeRepo();
    await repo.start();
    await repo.put(ref, { label: '1' }, { parentVersion: null, actor: 't' });

    const iter = repo.watch({ org: 'system' }, 999)[Symbol.asyncIterator]();
    const pending = iter.next();
    // No `parked()` here, deliberately: close() races the replay read.
    await repo.close();

    expect(await within(pending, SETTLE_MS)).toEqual({ value: undefined, done: true });
    expect(await within(iter.next(), SETTLE_MS)).toEqual({ value: undefined, done: true });
  });
});
