// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7150 — the watcher must see changes under a **dot-rooted** watch root.
 *
 * `MetadataPlugin` attaches the repository at `REPO_SUBDIR =
 * '.objectstack/metadata'` under the project root, so in the layout the
 * product actually ships the watched root path contains a dot segment.
 * chokidar applies its `ignored` matcher to the watched root itself, not only
 * to entries found underneath it, so the old bare dotfile regex
 * (`/(^|[\\/])\../`) matched that segment and the whole watch was inert:
 * `getWatched()` returned `{}` and no event ever fired. The consumer side is
 * live code — `MetadataManager.setRepository()` subscribes to `repo.watch({})`
 * and invalidates the registry and `list()` cache per event — so the source
 * could never fire for the layout that is in use.
 *
 * The two cases below are the two halves of the watcher's promise, which the
 * fix has to satisfy together: **see everything under the root** (case 1) and
 * **ignore the repository's own bookkeeping** (case 2). A fix that only
 * widened the matcher would pass case 1 and fail case 2.
 *
 * Sibling pin: `no-root-on-attach.test.ts` deliberately uses a root that is
 * NOT under a dot-directory, because it measures watcher *arming* (#7000).
 * Do not repurpose it — it has to keep measuring what it measures.
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
 * Deadline for a **positive** watcher assertion — the longest a case waits for
 * an event it expects to arrive. Each wait races this against the event
 * promise, so a healthy run still finishes in roughly the poll interval; the
 * number is only ever paid on the way to a failure.
 *
 * Sized for the merge queue, not for a quiet laptop. The queue runs the FULL
 * suite (PR-side CI runs only the affected subset), and this watcher rides
 * `usePolling: 1000ms` plus an `awaitWriteFinish` stability window — both are
 * wall-clock timers that stretch when the runner is saturated, while the
 * assertions themselves are unaffected. PR #7208 was ejected from the queue
 * twice on exactly that: first `fs-behavior.test.ts > chokidar: external file
 * change emits an update event` (3s deadline), then this file's positive case
 * (8s deadline) — both green on the identical SHA in PR CI and locally.
 */
const EVENT_WAIT_MS = 20_000;

/**
 * Quiet window for the **negative** assertion below. ⛔ Never shorten this: a
 * too-short quiet window cannot fail, it can only produce a FALSE PASS on an
 * empty-array assertion. Its liveness control uses `EVENT_WAIT_MS` like every
 * other positive wait — the control is a positive assertion and flakes under
 * load the same way.
 */
const QUIET_WINDOW_MS = 4_000;

/**
 * Per-case ceiling. Has to clear the quiet window plus a full `EVENT_WAIT_MS`
 * plus repository setup, or the case dies on the vitest timeout before its own
 * deadline is reached — which reports as a timeout rather than as the missing
 * event, and re-introduces the flake the deadlines above are widening away.
 */
const CASE_TIMEOUT_MS = 60_000;

describe('FileSystemRepository watcher — dot-rooted watch root (#7150)', () => {
  /** Stands in for the project directory. */
  let base: string;
  /** Stands in for `<project>/.objectstack/metadata` — the production layout. */
  let root: string;
  let repo: FileSystemRepository | undefined;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-fs7150-'));
    root = path.join(base, '.objectstack', 'metadata');
  });

  afterEach(async () => {
    if (repo) await repo.close().catch(() => undefined);
    repo = undefined;
    await fs.rm(base, { recursive: true, force: true });
  });

  /**
   * Drain `repo.watch()` into an array for the life of the case. `since: 999`
   * skips log replay, so everything collected here came from the watcher.
   */
  function collectEvents(r: FileSystemRepository): {
    events: MetadataEvent[];
    first: Promise<void>;
    stop: () => Promise<void>;
  } {
    const iter = r.watch({ org: 'system' }, 999)[Symbol.asyncIterator]();
    const events: MetadataEvent[] = [];
    let resolveFirst!: () => void;
    const first = new Promise<void>((res) => { resolveFirst = res; });
    let stopped = false;
    void (async () => {
      while (!stopped) {
        const next = await iter.next();
        if (next.done) return;
        events.push(next.value as MetadataEvent);
        resolveFirst();
      }
    })();
    return {
      events,
      first,
      stop: async () => { stopped = true; await iter.return?.(undefined); },
    };
  }

  it('sees an external edit when the root is under a dot-directory', async () => {
    repo = new FileSystemRepository({ root, org: 'system' }); // watcher ENABLED
    await repo.start();

    // The first write materializes the root and arms the watcher (#7000).
    await repo.put(ref('case_grid'), { label: 'original' }, {
      parentVersion: null,
      actor: 'tester',
    });

    const sink = collectEvents(repo);
    // Past the 200ms self-write suppression window of the put above.
    await sleep(400);

    // An out-of-process writer: a hand edit, or a `git checkout` bringing
    // metadata JSON in. Before the fix this produced nothing, ever.
    await fs.writeFile(
      path.join(root, 'view', 'case_grid.json'),
      JSON.stringify({ label: 'externally edited' }, null, 2),
    );

    await Promise.race([sink.first, sleep(EVENT_WAIT_MS)]);
    await sink.stop();

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]!.op).toBe('update');
    expect(sink.events[0]!.ref.name).toBe('case_grid');
    expect(sink.events[0]!.source).toBe('fs');
    expect(sink.events[0]!.actor).toBe('fs');
  }, CASE_TIMEOUT_MS);

  it('still ignores dot entries UNDER the root, including its own bookkeeping', async () => {
    repo = new FileSystemRepository({ root, org: 'system' }); // watcher ENABLED
    await repo.start();
    await repo.put(ref('seed'), { label: 'seed' }, { parentVersion: null, actor: 'tester' });

    const sink = collectEvents(repo);
    await sleep(400);

    // Noise that must stay invisible. `.cache/x.json` and `view/.scratch.json`
    // are the measured leaks of "drop the matcher and let `parseItemPath`
    // decide": that guard rejects the single name `.objectstack`, so these two
    // parse as type `.cache` and as an item named `.scratch` respectively —
    // while `scanHeads` skips every dot entry on boot. `.objectstack/.log/`
    // is the repository's own change log.
    await fs.mkdir(path.join(root, '.cache'), { recursive: true });
    await fs.writeFile(path.join(root, '.cache', 'x.json'), '{"junk":true}');
    await fs.writeFile(path.join(root, 'view', '.scratch.json'), '{"junk":true}');
    await fs.appendFile(
      path.join(root, '.objectstack', '.log', 'main.jsonl'),
      '{"not":"an event"}\n',
    );

    // Give the 1s poll several turns to deliver anything it was going to.
    await sleep(QUIET_WINDOW_MS);
    expect(sink.events).toEqual([]);

    // Control: the watcher is genuinely alive, so the emptiness above is the
    // interesting kind and not a watcher that never armed.
    await fs.writeFile(
      path.join(root, 'view', 'seed.json'),
      JSON.stringify({ label: 'really edited' }, null, 2),
    );
    await Promise.race([sink.first, sleep(EVENT_WAIT_MS)]);
    await sink.stop();

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]!.ref.name).toBe('seed');
    expect(sink.events[0]!.op).toBe('update');
  }, CASE_TIMEOUT_MS);
});
