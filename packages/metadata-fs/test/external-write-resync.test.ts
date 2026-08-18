// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9339 — an external write must reach subscribers even when the watcher's
 * one delivery attempt is lost.
 *
 * ## What this pins, and why it is not the same pin as #7282's
 *
 * `watch-write-registration.test.ts` pins the `put()` half of this family: a
 * path we wrote is registered with the watcher directly (`trackWrittenPath`),
 * so it never depends on a directory scan. PR #7336 closed that half by
 * *routing around* the fragile path. This file pins the half that route left
 * open — a write made by somebody else, which has no choice but to traverse it.
 *
 * The traversal gets **exactly one** attempt. Under `usePolling`, chokidar
 * re-reads a directory only when its stat strictly advances; an external write
 * advances the type directory's mtime once, so poll #2..#N compare an unchanged
 * stat and can never rediscover the file. Measured on #9339 with a
 * fault-injection harness: with that single read suppressed, fifteen further
 * poll ticks never find the file, and a 20s deadline and a 200s deadline buy
 * the same one attempt.
 *
 * At least six independent one-shot gates sit on that attempt, spanning three
 * layers — the kernel timestamp (`mtime-tie`), chokidar's readdir throttle and
 * readdir snapshot (`readdir-throttle`, `readdirp-miss`), and chokidar's emit
 * gates (`add-throttle`, `pending-write`, `awf-enoent`). Every one of them
 * produces a byte-identical observable: no event, ever, for that path.
 *
 * ## Why the cases blind the watcher rather than force a named gate
 *
 * ⚠️ The six are indistinguishable at the point of failure, so a case that
 * forced one of them would pin a fix for one member of a family — which is how
 * #7282 was closed and why it reopened. What the six have in common is not a
 * mechanism, it is a **boundary condition**: chokidar's `add`/`change`/`unlink`
 * callback never fires for the path. That is what the cases below reproduce,
 * deterministically and without reaching into chokidar's internals, by
 * detaching the repository's own listeners. A fix that survives it survives all
 * six by construction, and equally a seventh nobody has found.
 *
 * ⛔ These cases are NOT a claim about the CI mechanism, which was never
 * identified. They pin the repository's guarantee, not chokidar's behaviour.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { MetaRef, MetadataEvent } from '@objectstack/metadata-core';
import { FileSystemRepository } from '../src/index.js';

const ref = (name: string): MetaRef => ({ org: 'system', type: 'view', name });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Deadline for a recovery that the sweep should reach in ~2s. Wide enough that
 * a saturated runner cannot turn a working backstop red, and narrow enough that
 * a broken one cannot pass by exhausting the case timeout.
 */
const RECOVERY_WAIT_MS = 15_000;

/** Comfortably more than two sweeps, for the "did NOT republish" cases. */
const QUIET_WINDOW_MS = 5_000;

const CASE_TIMEOUT_MS = 60_000;

/**
 * The repository's private watcher handle. `removeAllListeners` is
 * `EventEmitter`'s own API; only the handle is internal, and the same reach is
 * already made by `watch-write-registration.test.ts`.
 */
interface WatcherHandle {
  watcher: {
    once(event: 'ready', listener: () => void): unknown;
    removeAllListeners(event: string): unknown;
  } | null;
  resyncTimer: unknown;
  resyncEnabled: boolean;
}

const handleOf = (repo: FileSystemRepository) => {
  const w = (repo as unknown as WatcherHandle).watcher;
  if (!w) throw new Error('watcher not armed — the case cannot measure anything');
  return w;
};

/**
 * Reproduce the boundary condition all six measured gates share: chokidar never
 * calls back for anything under the root. Everything downstream of that seam —
 * whether the file reached chokidar's watched set, whether an emit was
 * throttled, whether `awaitWriteFinish` leaked a pending entry — is exactly the
 * detail the failing assertion cannot see, so the case declines to depend on it.
 */
const blindWatcher = (repo: FileSystemRepository): void => {
  const w = handleOf(repo);
  w.removeAllListeners('add');
  w.removeAllListeners('change');
  w.removeAllListeners('unlink');
};

describe('FileSystemRepository — external writes survive a lost watcher event (#9339)', () => {
  let root: string;
  let viewDir: string;
  let repo: FileSystemRepository | undefined;
  let events: MetadataEvent[];
  let stopDrain: (() => Promise<void>) | undefined;

  const waitFor = async (pred: () => boolean, ms: number): Promise<void> => {
    const deadline = Date.now() + ms;
    while (!pred() && Date.now() < deadline) await sleep(25);
  };

  const subscribe = (): void => {
    const iter = repo!.watch({ org: 'system' }, 999)[Symbol.asyncIterator]();
    const drain = async () => {
      for (;;) {
        const next = await iter.next();
        if (next.done) return;
        events.push(next.value as MetadataEvent);
      }
    };
    void drain();
    stopDrain = async () => {
      await iter.return?.(undefined);
    };
  };

  const start = async (): Promise<void> => {
    repo = new FileSystemRepository({ root, org: 'system' }); // watcher ENABLED
    await repo.start();
    // The initial walk must finish first: a file that lands while it is still
    // running is treated as pre-existing and, under `ignoreInitial`, emits
    // nothing at all. What follows measures the steady state.
    const scanned = new Promise<void>((res) => { handleOf(repo!).once('ready', res); });
    subscribe();
    await Promise.race([scanned, sleep(RECOVERY_WAIT_MS)]);
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-fs9339-'));
    viewDir = path.join(root, 'view');
    await fs.mkdir(viewDir, { recursive: true });
    await fs.writeFile(path.join(viewDir, 'seed.json'), JSON.stringify({ label: 'seed' }, null, 2));
    events = [];
  });

  afterEach(async () => {
    await stopDrain?.().catch(() => undefined);
    stopDrain = undefined;
    if (repo) await repo.close().catch(() => undefined);
    repo = undefined;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('recovers an external create, update and delete the watcher never delivered', async () => {
    await start();
    // From here on chokidar can observe whatever it likes; none of it reaches
    // the repository. This is the state all six one-shot gates leave behind.
    blindWatcher(repo!);

    // ── create ───────────────────────────────────────────────────────────
    const file = path.join(viewDir, 'late.json');
    await fs.writeFile(file, JSON.stringify({ label: 'late' }, null, 2));
    await waitFor(() => events.some((e) => e.ref.name === 'late'), RECOVERY_WAIT_MS);

    const created = events.filter((e) => e.ref.name === 'late');
    expect(created).toHaveLength(1);
    expect(created[0]!.op).toBe('create');
    // The backstop must be indistinguishable from the fast path: a subscriber
    // cannot be made to care which one noticed.
    expect(created[0]!.source).toBe('fs');
    expect(created[0]!.actor).toBe('fs');
    expect(created[0]!.parentHash).toBeNull();

    // ── update ───────────────────────────────────────────────────────────
    await fs.writeFile(file, JSON.stringify({ label: 'late, edited' }, null, 2));
    await waitFor(() => events.some((e) => e.ref.name === 'late' && e.op === 'update'), RECOVERY_WAIT_MS);

    const updated = events.filter((e) => e.ref.name === 'late' && e.op === 'update');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.parentHash).toBe(created[0]!.hash);

    // ── delete ───────────────────────────────────────────────────────────
    await fs.rm(file);
    await waitFor(() => events.some((e) => e.ref.name === 'late' && e.op === 'delete'), RECOVERY_WAIT_MS);

    const deleted = events.filter((e) => e.ref.name === 'late' && e.op === 'delete');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.hash).toBeNull();
    expect(deleted[0]!.parentHash).toBe(updated[0]!.hash);

    // And the repository's own view agrees, so the index did not merely emit.
    expect(await repo!.get(ref('late'))).toBeNull();
  }, CASE_TIMEOUT_MS);

  it('publishes each external change exactly once, and never republishes our own put()', async () => {
    await start();

    // A live watcher: the fast path delivers, and the sweep must then find
    // nothing to say. Anything else would double every external edit.
    const external = path.join(viewDir, 'once.json');
    await fs.writeFile(external, JSON.stringify({ label: 'once' }, null, 2));
    await waitFor(() => events.some((e) => e.ref.name === 'once'), RECOVERY_WAIT_MS);

    // Our own write. `put()` publishes its own event; the sweep reads the same
    // bytes back and must recognise them as ours by content, not by a clock.
    await repo!.put(ref('mine'), { label: 'mine' }, { parentVersion: null, actor: 'tester' });

    // Several sweeps' worth of quiet.
    await sleep(QUIET_WINDOW_MS);

    expect(events.filter((e) => e.ref.name === 'once')).toHaveLength(1);

    const mine = events.filter((e) => e.ref.name === 'mine');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.actor).toBe('tester');
    expect(mine[0]!.op).toBe('create');
  }, CASE_TIMEOUT_MS);

  it('retires the sweep on close(), so a closed repository schedules no further work', async () => {
    await start();
    const priv = repo as unknown as WatcherHandle;
    expect(priv.resyncEnabled).toBe(true);

    await repo!.close();

    // A backstop that outlives its repository is a leaked timer holding a
    // closed watcher and a stale index — the failure shape would be a CI
    // worker that never exits, diagnosed nowhere near this file.
    expect(priv.resyncEnabled).toBe(false);
    expect(priv.resyncTimer).toBeNull();
    expect(priv.watcher).toBeNull();
  }, CASE_TIMEOUT_MS);
});
