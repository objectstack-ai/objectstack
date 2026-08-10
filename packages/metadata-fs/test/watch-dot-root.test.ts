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
 * widened the matcher would pass case 1 and fail case 2 — measured, and still
 * true of the current shape: with `isIgnoredWatchPath` reduced to `return
 * false` at the source, case 1 stays green and only case 2 goes red.
 *
 * Case 2 proves a NEGATIVE, and #7408 is what that costs if you try to prove
 * it by waiting. It does not wait: it **brackets** the noise between an opener
 * (an edit that must be delivered, proving the watcher is awake BEFORE the
 * noise exists) and two closers (new entries placed so that the same directory
 * read which discovers each one must also enumerate one of the leaks). Both
 * ends of the bracket are events the case actually observes, so nothing about
 * it is a function of how fast the runner happens to be.
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
 * Poll interval for the waits below. A healthy run leaves the wait on the first
 * turn after delivery, so this is what a passing case pays, not the ceiling.
 */
const EVENT_POLL_MS = 50;

/*
 * ⛔ There is deliberately no `QUIET_WINDOW_MS` here any more, and nothing of
 * that shape may come back (#7408).
 *
 * The negative half of case 2 used to be `sleep(4_000)` followed by
 * `expect(sink.events).toEqual([])`. Measured for #7369: under event-loop
 * starvation heavy enough to push delivery of a single external edit to
 * 24-36s, that window is shorter than the watcher's own latency, so the array
 * is empty because nothing has arrived yet — not because the noise was
 * ignored. The assertion passes *more* reliably the more loaded the runner is,
 * which is the one correlation a guard must never have.
 *
 * ⛔ A bigger number is not the fix. Any shape that waits a fixed span of wall
 * clock and then asserts emptiness has the same defect at some load level, and
 * #7369 already measured what moving one fixed budget buys: with the case
 * budget fixed, vitest's 10s `hookTimeout` immediately became the next binding
 * one and both cases failed while their assertions were satisfied.
 *
 * You cannot wait for an absence. What case 2 does instead is **bracket** the
 * noise between two deliveries it can actually observe — see the case below.
 */

/**
 * Per-case ceiling — and, since #7369, the **source** of every wait's budget:
 * `waitForEvents` / `waitForNames` wait until `caseDeadline()`, which is this
 * value measured from the case's own start minus `TEARDOWN_RESERVE_MS`. There
 * is no second, smaller wall-clock budget left in the file to expire first.
 *
 * Sized from measurement, not taste. #7369 measured delivery of a single
 * external edit at 24-36s under in-process event-loop starvation (the loop
 * blocked ~99.75% of the time) and set 120s against it.
 *
 * Raised to 180s for #7408, because case 2 no longer makes ONE delivery: the
 * bracket costs an opener plus two closers, three sequential deliveries where
 * the ceiling had been sized for one. Re-measured at BLOCK=4000/GAP=5 (~99.9%
 * starvation, heavier than any row #7369 ran), n=5: case 1 took 28-32s and
 * case 2 40-44s, all green. The old 120s would have held — 44s against a 115s
 * effective deadline — but at 2.6x margin instead of the ~3.3x #7369 chose,
 * and the same runs took up to 72s when the matcher was broken at the source
 * and two extra events had to be carried. 180s restores the margin on both.
 *
 * A healthy run pays none of it: every wait exits on delivery, and case 2
 * measures 2.1s unloaded (it was 5.5s with the 4s quiet window). What the
 * ceiling costs is the reporting latency of a genuinely dead watcher — the
 * never-arrives mode, which is #7282's defect and was fixed at the source.
 */
const CASE_TIMEOUT_MS = 180_000;

/**
 * Budget for `beforeEach` / `afterEach`, which vitest times SEPARATELY from the
 * case: `hookTimeout` defaults to 10s and the per-case ceiling does not cover
 * it. Measured for #7369 — with the case budget fixed and nothing else changed,
 * this became the next fixed wall-clock budget to expire first, and both cases
 * failed with "Hook timed out in 10000ms" while their assertions were still
 * satisfied. `repo.close()` stops a polling chokidar watcher and `fs.rm` walks
 * a temp tree; both stretch with runner load exactly like the waits above do.
 */
const HOOK_TIMEOUT_MS = 30_000;

/**
 * The budget every positive wait in this file spends, measured from the start
 * of the case that calls it. Call it as the case's first statement.
 */
const caseDeadline = (): number => Date.now() + CASE_TIMEOUT_MS - TEARDOWN_RESERVE_MS;

/**
 * Wait until the sink has delivered at least `count` events, or until
 * `deadline`.
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
async function waitForEvents(
  sink: { events: MetadataEvent[] },
  deadline: number,
  count = 1,
): Promise<void> {
  while (sink.events.length < count && Date.now() < deadline) await sleep(EVENT_POLL_MS);
}

/**
 * Wait until every `type/name` in `names` has been delivered, or until
 * `deadline`.
 *
 * ⚠️ Case 2's bracket closes on the closers' *identity*, never on an event
 * count. Measured for #7408: with a count, a leaked event satisfies the count
 * itself and the bracket closes EARLY — the run that should have been the
 * loudest failure is the one that stops listening soonest, and any second leak
 * still in flight escapes. Waiting by name makes the bracket span exactly what
 * it claims to span, whatever else shows up inside it.
 */
async function waitForNames(
  sink: { events: MetadataEvent[] },
  deadline: number,
  names: readonly string[],
): Promise<void> {
  while (Date.now() < deadline) {
    const have = new Set(sink.events.map((e) => `${e.ref.type}/${e.ref.name}`));
    if (names.every((n) => have.has(n))) return;
    await sleep(EVENT_POLL_MS);
  }
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
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    if (repo) await repo.close().catch(() => undefined);
    repo = undefined;
    await fs.rm(base, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

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

    await waitForEvents(sink, deadline);
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
    // Past the 200ms self-write suppression window of the put above.
    await sleep(400);

    // ── Open the bracket ──────────────────────────────────────────────
    // An external edit that MUST be delivered. Waiting for *its* arrival is
    // the positive, event-driven evidence that the watcher is armed and
    // delivering BEFORE any noise exists on disk. Without it the case cannot
    // tell "the noise was ignored" from "the watcher armed late and swallowed
    // the noise into its own baseline" — chokidar's initial scan reports
    // nothing (`ignoreInitial`), so a late-armed watcher produces exactly the
    // empty array a correct one does.
    await fs.writeFile(
      path.join(root, 'view', 'seed.json'),
      JSON.stringify({ label: 'armed' }, null, 2),
    );
    await waitForEvents(sink, deadline, 1);
    expect(sink.events.map((e) => `${e.ref.type}/${e.ref.name}`)).toEqual(['view/seed']);

    // ── The noise that must stay invisible ────────────────────────────
    // `.cache/x.json` and `view/.scratch.json` are the measured leaks of
    // "drop the matcher and let `parseItemPath` decide": that guard rejects
    // the single name `.objectstack`, so these two parse as type `.cache` and
    // as an item named `.scratch` respectively — while `scanHeads` skips every
    // dot entry on boot. Those two are what the assertion at the bottom has
    // teeth against.
    //
    // ⚠️ The `.objectstack/.log/` append is a GUARD, not evidence: it is the
    // repository's own change log, and `parseItemPath` rejects the
    // `.objectstack` prefix outright, so it cannot become a `MetadataEvent`
    // even with the watcher matcher removed entirely (measured — see the
    // reverse verification on #7408). It stays because it is the traffic the
    // matcher exists to keep out of the poll set at all, and because a future
    // change to `parseItemPath` is exactly what would make it matter.
    await fs.mkdir(path.join(root, '.cache'), { recursive: true });
    await fs.writeFile(path.join(root, '.cache', 'x.json'), '{"junk":true}');
    await fs.writeFile(path.join(root, 'view', '.scratch.json'), '{"junk":true}');
    await fs.appendFile(
      path.join(root, '.objectstack', '.log', 'main.jsonl'),
      '{"not":"an event"}\n',
    );

    // ── Close the bracket ─────────────────────────────────────────────
    // Two closers, each a NEW entry placed so that the very same directory
    // read which discovers it must also enumerate one of the leaks above.
    // That is what converts "we waited long enough" (unprovable) into "the
    // watcher demonstrably looked": chokidar polls, so it learns about a new
    // entry only by re-reading its parent directory, and a leak written
    // BEFORE the closer is already sitting in that directory when the read
    // happens.
    //
    //   view/closer.json      — same `view/` read that finds it enumerates
    //                           `view/.scratch.json`.
    //   dashboard/closer.json — a new type directory, so the same ROOT read
    //                           that finds it enumerates `.cache/`, and both
    //                           are descended into in the same pass.
    //
    // The bracket closes when both closers have ARRIVED — by name, not by
    // count (see `waitForNames`). Sized against the case ceiling like every
    // other wait in this file — never against a fixed budget.
    await fs.mkdir(path.join(root, 'dashboard'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'dashboard', 'closer.json'),
      JSON.stringify({ label: 'closer' }, null, 2),
    );
    await fs.writeFile(
      path.join(root, 'view', 'closer.json'),
      JSON.stringify({ label: 'closer' }, null, 2),
    );
    await waitForNames(sink, deadline, ['dashboard/closer', 'view/closer']);
    await sink.stop();

    // A leak lands inside the bracket and shows up here as a fourth event.
    //
    // How tight that is differs by scope, and #7408 measured both under
    // in-process event-loop starvation with the matcher removed at the source:
    //
    //   view/.scratch.json  — EXACT. The one `view/` read that discovers
    //                         `view/closer.json` enumerates `.scratch.json` in
    //                         the same call, so the leak cannot be delivered
    //                         after the closer. Caught 11/11.
    //   .cache/x.json       — TIGHT, not exact. The root read that discovers
    //                         `dashboard/` enumerates `.cache/` in the same
    //                         call, but each is then descended into by its own
    //                         async read, and those two can finish in either
    //                         order. Caught 28/29 across both starvation
    //                         levels (9/9 at 2000/5, 19/20 at 4000/5 — heavier
    //                         than any row #7369 measured). The single escape
    //                         was a late delivery, not a lost one: draining 30s
    //                         past the bracket found the event 6/6.
    //
    // For comparison, on the same defect and the same load, the shape this
    // replaced — `sleep(4_000)` then `expect(sink.events).toEqual([])` — passed
    // with the defect live in 9 of 13 loaded runs, and in 5 of 5 when the
    // `.cache` leak was the only noise present.
    //
    // ⛔ Do not "fix" the residual with a sleep. The gap it leaves is one
    // chokidar fan-out ordering at a starvation level past anything this repo
    // has measured; a wall-clock pad would reintroduce exactly the defect this
    // case was rewritten to remove, and buy less than the bracket already has.
    // The direction that would close it is another event-driven round (a second
    // root-scope closer, whose discovery read is strictly later than the first
    // one's), traded against one more delivery inside the case ceiling.
    const seen = sink.events.map((e) => `${e.ref.type}/${e.ref.name}`);
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe('view/seed');
    // The two closers race each other — different directories, independent
    // polls — so only the set is asserted, not their order.
    expect(seen.slice(1).sort()).toEqual(['dashboard/closer', 'view/closer']);
    expect(sink.events[0]!.op).toBe('update');
  }, CASE_TIMEOUT_MS);
});
