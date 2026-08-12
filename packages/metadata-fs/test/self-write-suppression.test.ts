// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7335 — self-write suppression is a **content-identity** property, and it
 * holds identically on both faces that write to disk: `put()` and `delete()`.
 *
 * ## The defect
 *
 * `handleFsChange` used to open with a wall-clock pre-check: `put()`/`delete()`
 * added the path to a `selfWrites` Set and a `setTimeout(…, 200)` cleared it,
 * and any event arriving in between was discarded **without reading what the
 * watcher had observed**. Under `usePolling: true, interval: 1000` chokidar
 * compares state once per tick, so our own write and an external edit landing
 * between two ticks arrive as ONE event carrying the *external* content. Drop
 * that on a timer and the external edit is gone — it was the only event it was
 * ever going to produce.
 *
 * ## Why the window looked unreachable, and how it was reached
 *
 * The filing measured 0/360 and called the window derived rather than
 * observed. That was a sampling artefact, not luck: the delivery lag of a
 * self-write event is `(interval - (writeTime mod interval)) +
 * awaitWriteFinish`, so a **fixed** pre-edit sleep phase-locks the poll and
 * pins the lag. Measured on the pre-fix tree, fixed 1500ms sleep, 25 runs:
 * lag 519–585ms — never once inside a 200ms window, exactly as filed.
 *
 * Randomising the sleep so the lag samples `[0, interval)` uniformly, 40 runs
 * on `origin/main` @ `69fde55`:
 *
 *   | delivery lag | runs | external edit |
 *   |--------------|------|---------------|
 *   | < 200ms      |    7 | SWALLOWED     |
 *   | > 200ms      |   33 | delivered     |
 *
 * A perfect split on the wall-clock boundary — the mechanism, observed.
 *
 * ## Why these cases assert at the handler seam
 *
 * That end-to-end reproduction is ~17% per iteration and costs seconds a run,
 * because the thing being sampled IS a poll phase. Pinning it would buy a
 * probabilistic test for a property that can be stated exactly, and this
 * package has been ejected from the merge queue twice already by wall-clock
 * watcher assertions (#7208, #7255).
 *
 * So the cases drive `handleFsChange` directly — the seam immediately below
 * chokidar, entered with exactly the arguments a sub-200ms delivery produces —
 * and assert the contract rather than the race:
 *
 *   **an event whose observed content differs from the index must be
 *   published, no matter how recently we wrote that path.**
 *
 * Entering at lag ≈ 0 is the worst case for the old code and deterministic for
 * the new: on the pre-fix tree both cases below fail (the path is in
 * `selfWrites`, so nothing is published); after the fix both pass. The
 * complementary direction — a genuine self-write must NOT be republished — is
 * asserted alongside, so a fix that simply published everything would fail too.
 *
 * The two faces share one table because they implement one contract by two
 * different mechanisms (`currentHead === hash` for writes, `!currentHead` for
 * removals) and are the likeliest place for a future change to fix one and
 * silently regress the other.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { hashSpec } from '@objectstack/metadata-core';
import type { MetaRef, MetadataEvent } from '@objectstack/metadata-core';
import { FileSystemRepository } from '../src/index.js';

const ref = (name: string): MetaRef => ({ org: 'system', type: 'view', name });

/** Enter the watcher handler exactly as chokidar would. */
type Kind = 'add' | 'change' | 'unlink';
const deliver = (repo: FileSystemRepository, file: string, kind: Kind): Promise<void> =>
  (repo as unknown as {
    handleFsChange(p: string, k: Kind): Promise<void>;
  }).handleFsChange(file, kind);

interface Face {
  /** Which write face of the repository is under test. */
  readonly name: 'put' | 'delete';
  /**
   * Perform our own write, then have an external actor change the same path
   * underneath us, and report the event chokidar would coalesce the pair into.
   */
  run(repo: FileSystemRepository, file: string, r: MetaRef): Promise<{
    kind: Kind;
    /** What the external actor left on disk. */
    externalSpec: Record<string, unknown> | null;
    /** The op the resulting MetadataEvent must carry. */
    expectedOp: MetadataEvent['op'];
  }>;
  /**
   * Perform our own write with NO external interference, and report the event
   * chokidar would deliver for it. Nothing may be published for this one.
   */
  selfOnly(repo: FileSystemRepository, file: string, r: MetaRef): Promise<Kind>;
}

const FACES: readonly Face[] = [
  {
    name: 'put',
    async run(repo, file, r) {
      // Our write, then an external edit landing before the next poll tick.
      // chokidar coalesces both into a single `change` carrying the LATTER.
      await repo.put(r, { label: 'ours' }, { parentVersion: null, actor: 't' });
      const externalSpec = { label: 'theirs' };
      await fs.writeFile(file, JSON.stringify(externalSpec, null, 2) + '\n', 'utf8');
      return { kind: 'change', externalSpec, expectedOp: 'update' };
    },
    async selfOnly(repo, _file, r) {
      await repo.put(r, { label: 'ours' }, { parentVersion: null, actor: 't' });
      return 'change';
    },
  },
  {
    name: 'delete',
    async run(repo, file, r) {
      // Our removal, then an external actor recreating the path before the
      // next tick — coalesced into a single `add` carrying THEIR content.
      const a = await repo.put(r, { label: 'ours' }, { parentVersion: null, actor: 't' });
      await repo.delete(r, { parentVersion: a.version, actor: 't' });
      const externalSpec = { label: 'restored by hand' };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(externalSpec, null, 2) + '\n', 'utf8');
      return { kind: 'add', externalSpec, expectedOp: 'create' };
    },
    async selfOnly(repo, _file, r) {
      const a = await repo.put(r, { label: 'ours' }, { parentVersion: null, actor: 't' });
      await repo.delete(r, { parentVersion: a.version, actor: 't' });
      return 'unlink';
    },
  },
];

describe('#7335 self-write suppression is keyed on observed content, not on a clock', () => {
  let root: string;
  let repo: FileSystemRepository | null = null;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'os-selfwrite-'));
  });

  afterEach(async () => {
    if (repo) await repo.close();
    repo = null;
    await fs.rm(root, { recursive: true, force: true });
  });

  for (const face of FACES) {
    it(`${face.name}(): an external change coalesced into our own write is NOT swallowed`, async () => {
      // The watcher is disabled: these cases supply the event themselves, at
      // the lag that matters. Leaving a real poller running would race them.
      repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
      await repo.start();
      const r = ref('coalesced');
      const file = path.join(root, 'view', 'coalesced.json');

      const { kind, externalSpec, expectedOp } = await face.run(repo, file, r);
      const before = await readLog(root);

      // Deliver at lag ≈ 0 — the instant the old wall-clock window was widest.
      await deliver(repo, file, kind);

      // Assert on the durable change log: a swallow erases the record itself,
      // not merely a live subscriber's copy of it.
      const added = (await readLog(root)).slice(before.length);
      expect(added).toHaveLength(1);
      expect(added[0]!.op).toBe(expectedOp);
      expect(added[0]!.source).toBe('fs');
      expect(added[0]!.actor).toBe('fs');
      expect(added[0]!.hash).toBe(hashSpec(externalSpec));
    });

    it(`${face.name}(): our own write, undisturbed, is still not republished`, async () => {
      repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
      await repo.start();
      const r = ref('undisturbed');
      const file = path.join(root, 'view', 'undisturbed.json');

      const kind = await face.selfOnly(repo, file, r);
      const before = await readLog(root);

      // Same lag ≈ 0 delivery, but nothing external happened: the content the
      // watcher can observe is exactly what we published, so this must be a
      // no-op WITHOUT any help from a timer.
      await deliver(repo, file, kind);

      expect(await readLog(root)).toEqual(before);
    });
  }
});

/** The durable change log — the record a swallow erases. */
async function readLog(root: string): Promise<MetadataEvent[]> {
  const file = path.join(root, '.objectstack', '.log', 'main.jsonl');
  const text = (await fs.readFile(file, 'utf8').catch(() => '')).trim();
  return text === '' ? [] : text.split('\n').map((l) => JSON.parse(l) as MetadataEvent);
}
