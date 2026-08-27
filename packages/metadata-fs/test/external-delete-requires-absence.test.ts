// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7369 — a watcher `unlink` is a CLAIM of absence. Only the disk settles it.
 *
 * ## The defect
 *
 * `handleFsChange`'s removal face used to publish on the observer's word:
 *
 *   if (kind === 'unlink') { await this.publishExternalDelete(ref, key); return; }
 *
 * and the only suppression inside `publishExternalDelete` is `!currentHead` —
 * a comparison against the **index**, which a spurious unlink leaves exactly
 * as valid as it was. So an event that merely *claimed* a file was gone became
 * a `delete`: appended to the change log, broadcast to every subscriber, and
 * acted on by `MetadataManager`, which drops the item from the registry and
 * the `list()` cache on receipt. The reconciliation sweep then found the file
 * still on disk and republished it as a `create`. A failed stat therefore
 * produced a durable delete/create pair for an item that was never removed,
 * with a window in between where live metadata had vanished.
 *
 * The repository already held the opposite discipline one method away: the
 * sweep's delete pass re-checks `existsSync` under the per-key lock before
 * retiring a key, and `external-write-resync.test.ts` pins that a false
 * absence handed to the sweep must produce **zero** `delete` events. The
 * watcher face was the one path that skipped the check.
 *
 * ## Why chokidar's unlink is not evidence of removal
 *
 * chokidar reaches its removal path from failed **stats** as well as from real
 * removals, and both sites are load-shaped (chokidar 5, `handler.js`):
 *
 *   - `_handleFile`'s poll listener runs when `fs.watchFile` reports a zeroed
 *     stat, re-stats the file, and calls `_remove` from the `catch` — under
 *     the comment "Fix issues where mtime is null but file is still present",
 *     with no discrimination on errno. EMFILE/ENFILE retires a file that is
 *     there.
 *   - `_handleRead`'s snapshot diff `_remove`s every previously tracked entry
 *     that its readdirp pass did not enumerate — which includes entries whose
 *     per-entry `lstat` failed, not only entries that are gone.
 *
 * That is why this surfaced in the merge queue and nowhere else: the queue is
 * the only context that runs the FULL suite, and `watch-dot-root.test.ts` case
 * 1 has been ejected from it twice by a delivery fault it did not cause. The
 * second ejection (2026-08-27, run 33057527457, `Test Core (2/6)`) failed with
 * `expected 'delete' to be 'update'` at `watch-dot-root.test.ts:268` — the
 * exact-count assertion on the line above it PASSED, so exactly one event
 * arrived, typed `delete`, for a file the case never removes.
 *
 * ## Why these cases assert at the handler seam
 *
 * The mechanism upstream is a failed stat under resource pressure, which
 * cannot be summoned on demand and would be a wall-clock race to wait for.
 * This package has now been ejected from the merge queue three times by
 * wall-clock watcher assertions, so the cases follow the discipline
 * `self-write-suppression.test.ts` set for the same reason: enter at the seam
 * immediately below chokidar, with exactly the arguments a spurious unlink
 * delivers, and assert the contract rather than the race.
 *
 * The contract, stated once:
 *
 *   **a removal is published only for an item that is actually absent from
 *   disk; an `unlink` for a path that is still there is a change.**
 *
 * Both directions are asserted, because each alone has a trivial wrong fix: a
 * repository that published nothing on `unlink` would pass the first two cases
 * and fail the third, and today's code passes the third and fails the first
 * two.
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
 * Enter the watcher handler exactly as chokidar's `unlink` listener does —
 * `w.on('unlink', (p) => void this.handleFsChange(p, 'unlink'))` in
 * `startWatcher`. The same reach is made by `self-write-suppression.test.ts`.
 */
type Kind = 'add' | 'change' | 'unlink';
const deliver = (repo: FileSystemRepository, file: string, kind: Kind): Promise<void> =>
  (repo as unknown as {
    handleFsChange(p: string, k: Kind): Promise<void>;
  }).handleFsChange(file, kind);

/**
 * Enough turns for anything the delivery above would publish to reach the
 * subscriber. It is not a race budget: `deliver` is awaited, so the publish has
 * already happened or is never going to — this only lets the broker's queue
 * drain into the array.
 */
const drain = () => sleep(50);

describe('#7369 an external delete is published only for an item that is really gone', () => {
  let root: string;
  let repo: FileSystemRepository | null = null;
  let events: MetadataEvent[] = [];
  let stop: (() => Promise<void>) | null = null;

  /**
   * The watcher is disabled throughout: these cases supply the event
   * themselves, and a live poller would race them. It also retires the
   * reconciliation sweep (armed inside `startWatcher`), so every event
   * observed here came from the delivery the case made — which is the whole
   * point, since the sweep is precisely what used to paper over the defect by
   * republishing the item as a `create` two seconds later.
   */
  async function start(): Promise<void> {
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();
    const iter = repo.watch({ org: 'system' }, 999)[Symbol.asyncIterator]();
    let stopped = false;
    void (async () => {
      while (!stopped) {
        const next = await iter.next();
        if (next.done) return;
        events.push(next.value as MetadataEvent);
      }
    })();
    stop = async () => {
      stopped = true;
      await iter.return?.(undefined);
    };
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'os-unlink-claim-'));
    events = [];
  });

  afterEach(async () => {
    if (stop) await stop();
    stop = null;
    if (repo) await repo.close();
    repo = null;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('an unlink for a path that still exists, edited externally, is the update it always was', async () => {
    await start();
    const r = ref('case_grid');
    const file = path.join(root, 'view', 'case_grid.json');
    const first = await repo!.put(r, { label: 'original' }, {
      parentVersion: null,
      actor: 'tester',
    });
    // Let `put()`'s own event land before clearing, so it cannot arrive
    // afterwards and be read as something the delivery below produced.
    await drain();
    events.length = 0;

    // The queue failure, reproduced at the seam: an external in-place edit
    // lands, and the delivery chokidar makes for it is `unlink`.
    await fs.writeFile(file, JSON.stringify({ label: 'externally edited' }, null, 2) + '\n');
    await deliver(repo!, file, 'unlink');
    await drain();

    expect(events).toHaveLength(1);
    // Pre-fix this was 'delete'. That is the assertion that ejected two
    // unrelated PRs from the merge queue.
    expect(events[0]!.op).toBe('update');
    expect(events[0]!.ref.name).toBe('case_grid');
    expect(events[0]!.source).toBe('fs');
    expect(events[0]!.actor).toBe('fs');
    expect(events[0]!.parentHash).toBe(first.version);
    expect(events[0]!.hash).not.toBeNull();

    // And the item is still there — the index was never retired behind the
    // subscriber's back.
    const item = await repo!.get(r);
    expect(item).not.toBeNull();
    expect(item!.body).toEqual({ label: 'externally edited' });
  });

  it('a purely spurious unlink — nothing on disk changed — publishes nothing at all', async () => {
    await start();
    const r = ref('untouched');
    const file = path.join(root, 'view', 'untouched.json');
    const first = await repo!.put(r, { label: 'stable' }, {
      parentVersion: null,
      actor: 'tester',
    });
    // Let `put()`'s own event land before clearing, so it cannot arrive
    // afterwards and be read as something the delivery below produced.
    await drain();
    events.length = 0;

    // The pure fault: chokidar's stat failed, the file never moved.
    await deliver(repo!, file, 'unlink');
    await drain();

    // Not "a delete then a create". Nothing happened, so nothing is published,
    // and no phantom pair is written to the change log for a consumer to
    // replay forever.
    expect(events).toEqual([]);
    const item = await repo!.get(r);
    expect(item).not.toBeNull();
    expect(item!.hash).toBe(first.version);

    // The change log must be equally clean: `delete` is durable, and the
    // history is what a consumer rebuilding from disk reads.
    const history: MetadataEvent[] = [];
    for await (const evt of repo!.history(r, {})) history.push(evt);
    expect(history.map((h) => h.op)).toEqual(['create']);
  });

  it('a genuine external removal is still published on the first delivery', async () => {
    await start();
    const r = ref('really_gone');
    const file = path.join(root, 'view', 'really_gone.json');
    const first = await repo!.put(r, { label: 'here' }, {
      parentVersion: null,
      actor: 'tester',
    });
    // Let `put()`'s own event land before clearing, so it cannot arrive
    // afterwards and be read as something the delivery below produced.
    await drain();
    events.length = 0;

    // Somebody ran `rm`. The file is absent, so the claim is true.
    await fs.rm(file);
    await deliver(repo!, file, 'unlink');
    await drain();

    // ⚠️ The complementary direction, and the reason the fix is a disk check
    // rather than "ignore unlink": without this case, dropping every unlink
    // would pass the two above. External removals are a real capability —
    // `external-write-resync.test.ts` pins the sweep's recovery of one.
    expect(events).toHaveLength(1);
    expect(events[0]!.op).toBe('delete');
    expect(events[0]!.ref.name).toBe('really_gone');
    expect(events[0]!.hash).toBeNull();
    expect(events[0]!.parentHash).toBe(first.version);
    expect(events[0]!.source).toBe('fs');
    expect(events[0]!.actor).toBe('fs');

    expect(await repo!.get(r)).toBeNull();
  });
});
