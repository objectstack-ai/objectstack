// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7000 — attaching a `FileSystemRepository` must leave nothing on disk.
 *
 * This is the filesystem half of the property #6743 ruled on: a dry run
 * leaves nothing behind. #6743 / PR #6997 covered `.objectstack/data/` (the
 * sqlite file the driver brought into existence at open); the half left over
 * is the metadata repository, whose `start()` used to `mkdir` both the root
 * and `<root>/.objectstack/.log` unconditionally. `os migrate plan` on a
 * project that has never been started therefore left a
 * `.objectstack/metadata/.objectstack/.log` skeleton behind, and the presence
 * of `.objectstack/` stopped being a usable "this project has been started"
 * signal.
 *
 * The pin is written the same way #6743's is: assert the ABSENCE of the side
 * effect on a fresh fixture, and carry a control that proves the fixture is
 * genuine — here, that the very same repository is attachable, readable and
 * writable, so the absence is not the uninteresting kind produced by a boot
 * that failed early.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { MetaRef, MetadataEvent, MetadataItemHeader } from '@objectstack/metadata-core';
import { FileSystemRepository } from '../src/index.js';

const ref = (name: string): MetaRef => ({ org: 'system', type: 'view', name });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Deadline for the **positive** watcher-arming assertion at the bottom of this
 * file, raced against the event promise — a healthy run still finishes in
 * roughly the poll interval, so the number is only paid on the way to a
 * failure.
 *
 * Same value, and same reason, as `fs-behavior.test.ts` and
 * `watch-dot-root.test.ts`: the merge queue runs the FULL suite while this
 * watcher rides `usePolling: 1000ms` plus an `awaitWriteFinish` stability
 * window, and those are wall-clock timers that stretch under a saturated
 * runner. PR #7208 was ejected twice on exactly that mechanism, once from each
 * of those two files. This case is the third instance of the identical
 * event-wait shape in the same package and shard, so it is widened with them
 * rather than left as the next one to eject.
 */
const EVENT_WAIT_MS = 20_000;

/**
 * Per-case ceiling. Must clear a full `EVENT_WAIT_MS` plus setup, or the case
 * dies on the vitest timeout before reaching its own deadline — reporting as a
 * timeout instead of as the missing event.
 */
const WATCHER_CASE_TIMEOUT_MS = 45_000;

describe('FileSystemRepository — attaching creates nothing on disk (#7000)', () => {
  /** Stands in for the project directory: nothing below it exists yet. */
  let base: string;
  /** Stands in for `<project>/.objectstack/metadata` — deliberately absent. */
  let root: string;
  let repo: FileSystemRepository | undefined;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-fs7000-'));
    root = path.join(base, '.objectstack', 'metadata');
  });

  afterEach(async () => {
    if (repo) await repo.close().catch(() => undefined);
    repo = undefined;
    await fs.rm(base, { recursive: true, force: true });
  });

  /**
   * Every path anywhere below the project directory. Naming only the two
   * paths the old `mkdir`s created would miss a third one added later, so the
   * pin sweeps the whole fixture instead.
   */
  function residueOnDisk(): string[] {
    const found: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > 5) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        found.push(path.relative(base, full));
        if (entry.isDirectory()) walk(full, depth + 1);
      }
    };
    walk(base, 0);
    return found.sort();
  }

  it('start() on a never-started project creates neither the root nor .objectstack/.log', async () => {
    expect(existsSync(root)).toBe(false);

    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();

    expect(existsSync(root)).toBe(false);
    expect(existsSync(path.join(root, '.objectstack', '.log'))).toBe(false);
    expect(residueOnDisk()).toEqual([]);

    // Detach is not a write either.
    await repo.close();
    expect(residueOnDisk()).toEqual([]);
  });

  it('an absent root is attachable and reads as an empty repository', async () => {
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();

    expect(await repo.get(ref('case_grid'))).toBeNull();
    expect(await repo.getByHash(ref('case_grid'), 'not-a-real-hash')).toBeNull();

    const listed: MetadataItemHeader[] = [];
    for await (const header of repo.list({ org: 'system' })) listed.push(header);
    expect(listed).toEqual([]);

    const past: MetadataEvent[] = [];
    for await (const evt of repo.history(ref('case_grid'))) past.push(evt);
    expect(past).toEqual([]);

    // No read may be paid for with a directory.
    expect(residueOnDisk()).toEqual([]);
  });

  it('the FIRST write materializes the root, the body file and the change log', async () => {
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();
    expect(existsSync(root)).toBe(false);

    await repo.put(ref('case_grid'), { label: 'Cases' }, { parentVersion: null, actor: 'tester' });

    expect(existsSync(root)).toBe(true);
    expect(existsSync(path.join(root, 'view', 'case_grid.json'))).toBe(true);
    expect(existsSync(path.join(root, '.objectstack', '.log', 'main.jsonl'))).toBe(true);

    // The deferred root is a real repository, not a half-built one: a fresh
    // attach over the same path reads the item and its log back.
    await repo.close();
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();
    const item = await repo.get(ref('case_grid'));
    expect(item?.body).toEqual({ label: 'Cases' });
    expect(item?.seq).toBe(1);

    // And seq numbering continues from the log the deferred root wrote.
    const second = await repo.put(
      ref('case_grid'),
      { label: 'Cases (renamed)' },
      { parentVersion: item!.hash, actor: 'tester' },
    );
    expect(second.seq).toBe(2);
  });

  it('arms the watcher on the first write, so external edits are still detected', async () => {
    // The one property that dropping the `mkdir` could have silently killed:
    // chokidar cannot watch a path that does not exist yet, so a watcher armed
    // by `start()` against an absent root would never fire again. `ensureRoot`
    // arms it at the moment the root appears — this is that guard.
    //
    // The root here is deliberately NOT under a dot-directory. The watcher's
    // own `ignored: [/(^|[\\/])\../]` matches ANY dot segment of the path,
    // including segments of the watched root itself, so a root such as the
    // plugin's `<project>/.objectstack/metadata` is ignored wholesale and
    // chokidar watches nothing at all. That is pre-existing on `origin/main`
    // and out of scope here (filed separately); this case pins the arming, so
    // it uses a root the watcher can actually see.
    const plainRoot = path.join(base, 'project', 'metadata');
    repo = new FileSystemRepository({ root: plainRoot, org: 'system' }); // watcher ENABLED
    await repo.start();
    expect(existsSync(plainRoot)).toBe(false);

    await repo.put(ref('externally_edited'), { label: 'original' }, { parentVersion: null, actor: 'tester' });
    expect(existsSync(plainRoot)).toBe(true);

    const iter = repo.watch({ org: 'system' }, 999)[Symbol.asyncIterator]();
    const collected: MetadataEvent[] = [];
    const collector = (async () => {
      const r = await iter.next();
      if (!r.done) collected.push(r.value as MetadataEvent);
    })();

    // Past the 200ms self-write suppression window of the put above.
    await sleep(400);
    await fs.writeFile(
      path.join(plainRoot, 'view', 'externally_edited.json'),
      JSON.stringify({ label: 'externally edited' }, null, 2),
    );

    await Promise.race([collector, sleep(EVENT_WAIT_MS)]);
    await iter.return?.(undefined);

    expect(collected).toHaveLength(1);
    expect(collected[0]!.op).toBe('update');
    expect(collected[0]!.source).toBe('fs');
    expect(collected[0]!.actor).toBe('fs');
  }, WATCHER_CASE_TIMEOUT_MS);
});
