// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7282 — a path this repository writes must be registered with the watcher
 * **without waiting for a poll interval**.
 *
 * The defect this pins is a permanently-blinding interleaving between
 * chokidar's asynchronous initial scan and our own first write, measured on
 * chokidar 5 with this repository's options (`usePolling`, `interval: 1000`):
 *
 *   1. chokidar reads `<root>/<type>/` and finds it EMPTY — `writeJsonAtomic`'s
 *      `rename` has not landed yet.
 *   2. the rename lands; the directory's mtime changes.
 *   3. chokidar calls `watchFile()` on the directory and libuv takes its
 *      polling baseline stat, which already reflects step 2.
 *
 * The directory's stat then never changes again, so the directory is never
 * re-read, the item file is never registered, no per-file watcher is created,
 * and neither `add` nor `change` is emitted for it **for the life of the
 * process**. Measured directly: `getWatched()` reported the type directory as
 * `[]` for the full 7.5s of a probe run while the file sat in it, and
 * `handleFsChange` was never entered once.
 *
 * That is why both time-based mitigations tried on this family failed: the
 * event is never delivered, so a 20s deadline (#7208) and a 25541ms one (#7255)
 * both ran out with an empty array, and a wider pre-edit sleep cannot help
 * either — the damage is done before the sleep starts. Lowering `interval`
 * cannot help for the same reason: a shorter poll re-compares against the same
 * unchanged directory stat.
 *
 * ## Why this file asserts registration rather than the race
 *
 * The interleaving above lives inside chokidar, between a `readdirp` stream end
 * and a `watchFile()` call, so it cannot be forced from the outside without a
 * test seam. What CAN be pinned deterministically is the property the fix
 * establishes, which is what actually closes the window: after `put()` returns,
 * the watcher knows the path **from us**, not from a directory scan that may
 * never happen.
 *
 * The two outcomes are separated structurally, not by a lucky margin:
 *
 *   - with the fix, registration costs one `stat` (single-digit ms);
 *   - without it, the earliest the watcher can learn the path is its next
 *     directory poll — a full `interval` (1000ms) plus the `awaitWriteFinish`
 *     stability window.
 *
 * The case anchors the poll phase before measuring so that "one poll away" is
 * genuinely a full interval away: it lets an out-of-process file land first and
 * waits for the repository to report it, which happens only when a poll tick
 * for the type directory has just fired. `REGISTRATION_BUDGET_MS` then sits an
 * order of magnitude below the remaining interval.
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
 * How long registration may take after `put()` resolves. Comfortably above one
 * `stat` under a saturated runner and comfortably below the watcher's 1000ms
 * poll interval, which is the only other way the path could get registered.
 */
const REGISTRATION_BUDGET_MS = 400;

/** Deadline for the positive waits that anchor the poll phase and control the case. */
const EVENT_WAIT_MS = 20_000;

const CASE_TIMEOUT_MS = 60_000;

/**
 * chokidar's watched-path registry, reached through the repository's private
 * watcher handle. `getWatched()` is chokidar's own public API; only the handle
 * is internal, and no public surface reports it.
 */
interface WatcherHandle {
  watcher: {
    getWatched(): Record<string, string[]>;
    once(event: 'ready', listener: () => void): unknown;
  } | null;
}

const handleOf = (repo: FileSystemRepository) => {
  const w = (repo as unknown as WatcherHandle).watcher;
  if (!w) throw new Error('watcher not armed — the case cannot measure anything');
  return w;
};

const watchedIn = (repo: FileSystemRepository, dir: string): string[] =>
  handleOf(repo).getWatched()[dir] ?? [];

describe('FileSystemRepository watcher — writes register their own path (#7282)', () => {
  let root: string;
  let repo: FileSystemRepository | undefined;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-fs7282-'));
  });

  afterEach(async () => {
    if (repo) await repo.close().catch(() => undefined);
    repo = undefined;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('registers a put() path with the watcher without waiting for a poll', async () => {
    const viewDir = path.join(root, 'view');
    // The type directory exists and is non-empty before the watcher arms, so
    // chokidar's scan cannot be blamed for anything measured below.
    await fs.mkdir(viewDir, { recursive: true });
    await fs.writeFile(path.join(viewDir, 'seed.json'), JSON.stringify({ label: 'seed' }, null, 2));

    repo = new FileSystemRepository({ root, org: 'system' }); // watcher ENABLED
    await repo.start();
    // Attach before yielding. `start()` arms the watcher as its last statement
    // and chokidar cannot finish its walk without at least one async stat, so
    // `ready` provably has not fired yet. Waiting for it matters: a file that
    // lands while the initial walk is still running is treated as pre-existing
    // and, under `ignoreInitial`, emits nothing at all — measured 3/3. The
    // anchor below must not be subject to that.
    const scanned = new Promise<void>((res) => { handleOf(repo!).once('ready', res); });

    const iter = repo.watch({ org: 'system' }, 999)[Symbol.asyncIterator]();
    const events: MetadataEvent[] = [];
    let resolveNext: (() => void) | null = null;
    void (async () => {
      for (;;) {
        const next = await iter.next();
        if (next.done) return;
        events.push(next.value as MetadataEvent);
        resolveNext?.();
      }
    })();
    const nextEvent = () => new Promise<void>((res) => { resolveNext = res; });

    await Promise.race([scanned, sleep(EVENT_WAIT_MS)]);
    // The walk reached the type directory, so what follows is measuring the
    // steady state and not the initial scan.
    expect(watchedIn(repo, viewDir)).toContain('seed.json');

    // ── Anchor the poll phase ────────────────────────────────────────────
    // An out-of-process file lands in the type directory; the repository can
    // only report it once a poll tick for that directory has fired. Returning
    // from this wait therefore means we are at the START of a fresh interval,
    // so "one poll away" below really is ~1000ms away and not ~5ms away.
    const anchored = nextEvent();
    await fs.writeFile(path.join(viewDir, 'anchor.json'), JSON.stringify({ label: 'anchor' }, null, 2));
    await Promise.race([anchored, sleep(EVENT_WAIT_MS)]);
    expect(events.map((e) => e.ref.name)).toContain('anchor');

    // ── The measurement ──────────────────────────────────────────────────
    await repo.put(ref('fresh'), { label: 'fresh' }, { parentVersion: null, actor: 'tester' });

    const deadline = Date.now() + REGISTRATION_BUDGET_MS;
    while (!watchedIn(repo, viewDir).includes('fresh.json') && Date.now() < deadline) {
      await sleep(10);
    }
    expect(watchedIn(repo, viewDir)).toContain('fresh.json');

    // ── Liveness control ─────────────────────────────────────────────────
    // ⚠️ Green in BOTH directions on a quiet machine — the registration race is
    // load-dependent, so this cannot be the case's evidence. It is here to
    // prove the registration above is the real thing and not bookkeeping: an
    // external edit to the freshly written path must still reach subscribers.
    const edited = nextEvent();
    await fs.writeFile(
      path.join(viewDir, 'fresh.json'),
      JSON.stringify({ label: 'fresh, edited on disk' }, null, 2),
    );
    await Promise.race([edited, sleep(EVENT_WAIT_MS)]);
    await iter.return?.(undefined);

    const updates = events.filter((e) => e.ref.name === 'fresh' && e.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.source).toBe('fs');
    expect(updates[0]!.actor).toBe('fs');
  }, CASE_TIMEOUT_MS);
});
