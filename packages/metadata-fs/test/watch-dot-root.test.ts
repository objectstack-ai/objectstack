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
 * Reserve held back from the case ceiling so that a missing event is reported
 * by this file's own assertion ("expected length 1, received 0") rather than
 * by a bare vitest timeout. Covers `sink.stop()`, `repo.close()` and the
 * tmpdir teardown in `afterEach`.
 */
const TEARDOWN_RESERVE_MS = 5_000;

/**
 * Poll interval for `waitForEvent`. A healthy run leaves the wait on the first
 * turn after delivery, so this is what a passing case pays, not the ceiling.
 */
const EVENT_POLL_MS = 50;

/**
 * Quiet window for the **negative** assertion below. ⛔ Never shorten this: a
 * too-short quiet window cannot fail, it can only produce a FALSE PASS on an
 * empty-array assertion.
 *
 * This one budget stays wall-clock, because you cannot wait for an absence —
 * and that is a real limit, not a solved problem. Measured for #7369: under
 * event-loop starvation heavy enough to push delivery to 32-36s, a 4s window
 * is no longer a window at all and the emptiness below becomes a false pass.
 * The case's *positive* control underneath is what still has teeth there, and
 * it is now deadline-driven (`waitForEvent`) rather than fixed-budget.
 */
const QUIET_WINDOW_MS = 4_000;

/**
 * Per-case ceiling — and, since #7369, the **source** of every positive wait's
 * budget: `waitForEvent` waits until `caseDeadline()`, which is this value
 * measured from the case's own start minus `TEARDOWN_RESERVE_MS`. There is no
 * second, smaller wall-clock budget left in the file to expire first.
 *
 * Sized from measurement, not taste. Under in-process event-loop starvation
 * (the loop blocked ~99.75% of the time) delivery of a single external edit
 * was measured at 24-36s while still arriving every time; the quiet window and
 * repository setup ahead of it stretch too. 120s clears that with margin, and
 * a healthy run pays none of it — every wait exits on delivery.
 */
const CASE_TIMEOUT_MS = 120_000;

/**
 * The budget every positive wait in this file spends, measured from the start
 * of the case that calls it. Call it as the case's first statement.
 */
const caseDeadline = (): number => Date.now() + CASE_TIMEOUT_MS - TEARDOWN_RESERVE_MS;

/**
 * Wait until the sink has delivered at least one event, or until `deadline`.
 *
 * ⛔ Never put a *fixed* wall-clock budget back here. The shape this replaced
 * was `Promise.race([sink.first, sleep(EVENT_WAIT_MS)])` with a hard-coded
 * `EVENT_WAIT_MS = 20_000`, and #7369 is what that costs: the budget is a
 * constant while the thing it is timing is not. This watcher rides
 * `usePolling: 1000ms` plus an `awaitWriteFinish` stability window, both of
 * which stretch with runner load — and the merge queue, which runs the FULL
 * suite while PR-side CI runs only the affected subset, is the most loaded
 * context this file ever executes in. When the fixed budget expires first the
 * case reports `received 0`, which reads as "the watcher is broken" and is
 * really "the test stopped listening too early". PR #7333 was ejected from the
 * queue by exactly that, having touched nothing in this package.
 *
 * Measured for #7369 on `18ff1dab1`, one external edit per iteration, under
 * in-process event-loop starvation (the case blocks its own loop for BLOCK ms
 * out of every BLOCK+GAP ms), external CPU oversubscription alongside:
 *
 *   BLOCK/GAP   n    delivery        old fixed-budget shape   this shape
 *   (none)      60   650-707ms       green                    green
 *   300/10      40   3.6-4.9s        green                    green
 *   900/5       12   9.9-12.7s       green                    green
 *   2000/5       8   24-36s          RED 5/8                  green 8/8
 *
 * The event arrived in 120 of 120 iterations — delivery goes *late*, never
 * missing. (The failure mode where it never arrives at all was a different
 * defect, #7282, fixed at the source in `ab07b5382`; it is not what this
 * shape defends against.) So the only thing that decided pass or fail at the
 * bottom row was whether the test was still listening, which is why the budget
 * now comes from `CASE_TIMEOUT_MS` instead of a number chosen in advance.
 */
async function waitForEvent(
  sink: { events: MetadataEvent[] },
  deadline: number,
): Promise<void> {
  while (sink.events.length === 0 && Date.now() < deadline) await sleep(EVENT_POLL_MS);
}

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
    stop: () => Promise<void>;
  } {
    const iter = r.watch({ org: 'system' }, 999)[Symbol.asyncIterator]();
    const events: MetadataEvent[] = [];
    let stopped = false;
    void (async () => {
      while (!stopped) {
        const next = await iter.next();
        if (next.done) return;
        events.push(next.value as MetadataEvent);
      }
    })();
    return {
      events,
      stop: async () => { stopped = true; await iter.return?.(undefined); },
    };
  }

  it('sees an external edit when the root is under a dot-directory', async () => {
    const deadline = caseDeadline();
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

    await waitForEvent(sink, deadline);
    await sink.stop();

    // ⚠️ The exact count is a GUARD, not evidence of de-duplication: a second
    // chokidar delivery of this same write cannot produce a second
    // `MetadataEvent`, because `handleFsChange` returns early on
    // `currentHead === hash`. Measured for #7369 — 0 duplicates in 120
    // iterations across four starvation levels, and 0 is the only number that
    // branch can produce. What the count still has teeth for is a *different*
    // event sneaking in: the repository's own `put` above escaping self-write
    // suppression, or a dot entry leaking past `isIgnoredWatchPath`. That is
    // why it stays exact — and why it is asserted only once the awaited event
    // has actually arrived, so a slow runner cannot turn it into `received 0`.
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]!.op).toBe('update');
    expect(sink.events[0]!.ref.name).toBe('case_grid');
    expect(sink.events[0]!.source).toBe('fs');
    expect(sink.events[0]!.actor).toBe('fs');
  }, CASE_TIMEOUT_MS);

  it('still ignores dot entries UNDER the root, including its own bookkeeping', async () => {
    const deadline = caseDeadline();
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
    await waitForEvent(sink, deadline);
    await sink.stop();

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]!.ref.name).toBe('seed');
    expect(sink.events[0]!.op).toBe('update');
  }, CASE_TIMEOUT_MS);
});
