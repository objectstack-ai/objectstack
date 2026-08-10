// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { MetaRef, MetadataEvent } from '@objectstack/metadata-core';
import { FileSystemRepository } from '../src/index.js';

const baseRef = (name: string): MetaRef => ({
  org: 'system',
  type: 'view',
  name,
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Deadline for a **positive** watcher assertion — the longest a case waits for
 * an event it expects to arrive. Raced against the event promise, so a healthy
 * run still finishes in roughly the poll interval; the number is only ever
 * paid on the way to a failure.
 *
 * Sized for the merge queue, not for a quiet laptop. The queue runs the FULL
 * suite (PR-side CI runs only the affected subset), and this repository's
 * watcher rides `usePolling: 1000ms` plus an `awaitWriteFinish` stability
 * window — wall-clock timers that stretch under a saturated runner while the
 * assertions themselves are unaffected. The `chokidar: external file change`
 * case below ejected PR #7208 from the queue on its old 3s deadline while
 * being green on the identical SHA in PR CI; `watch-dot-root.test.ts` ejected
 * it a second time on an 8s one. Both are widened to this value.
 */
const EVENT_WAIT_MS = 20_000;

/**
 * Per-case ceiling for the watcher cases. Must clear a full `EVENT_WAIT_MS`
 * plus setup, or the case dies on the vitest timeout before reaching its own
 * deadline — which reports as a timeout instead of as the missing event.
 */
const WATCHER_CASE_TIMEOUT_MS = 45_000;

describe('FileSystemRepository — on-disk semantics', () => {
  let root: string;
  let repo: FileSystemRepository;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-fsbeh-'));
  });

  afterEach(async () => {
    if (repo) await repo.close().catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('persists writes to <root>/<type>/<name>.json', async () => {
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();
    const ref = baseRef('case_grid');
    await repo.put(ref, { label: 'Cases', columns: ['id', 'subject'] }, { parentVersion: null, actor: 't' });
    const file = path.join(root, 'view', 'case_grid.json');
    const text = await fs.readFile(file, 'utf8');
    expect(JSON.parse(text)).toEqual({ label: 'Cases', columns: ['id', 'subject'] });
  });

  it('appends to .objectstack/.log/<branch>.jsonl on every write', async () => {
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();
    const ref = baseRef('a');
    const a = await repo.put(ref, { v: 1 }, { parentVersion: null, actor: 't' });
    await repo.put(ref, { v: 2 }, { parentVersion: a.version, actor: 't' });
    const log = path.join(root, '.objectstack', '.log', 'main.jsonl');
    const lines = (await fs.readFile(log, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const events = lines.map((l) => JSON.parse(l));
    expect(events[0].op).toBe('create');
    expect(events[1].op).toBe('update');
    expect(events[1].parentHash).toBe(events[0].hash);
  });

  it('survives restart — heads and seq recovered from disk', async () => {
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo.start();
    const ref = baseRef('persistent');
    const a = await repo.put(ref, { x: 1 }, { parentVersion: null, actor: 't' });
    await repo.close();

    const repo2 = new FileSystemRepository({ root, org: 'system', disableWatch: true });
    await repo2.start();
    try {
      const got = await repo2.get(ref);
      expect(got?.hash).toBe(a.version);
      // Writing again with the recovered head must succeed.
      const b = await repo2.put(ref, { x: 2 }, { parentVersion: a.version, actor: 't' });
      expect(b.seq).toBeGreaterThan(a.seq);
    } finally {
      await repo2.close();
    }
  });

  it('chokidar: external file change emits an update event', async () => {
    repo = new FileSystemRepository({ root, org: 'system' });
    await repo.start();

    const ref = baseRef('externally_edited');
    await repo.put(ref, { label: 'original' }, { parentVersion: null, actor: 't' });

    // Subscribe BEFORE the external edit.
    const iter = repo.watch({ org: 'system' }, 999)[Symbol.asyncIterator]();
    // Drain anything immediately available (nothing since `since` is huge).
    const collected: MetadataEvent[] = [];
    const collectorDone = (async () => {
      for (let i = 0; i < 1; i++) {
        const r = await iter.next();
        if (r.done) return;
        collected.push(r.value as MetadataEvent);
      }
    })();

    // Edit the file directly on disk; chokidar must detect it.
    // Wait past the self-write suppression window (200ms) from the put above.
    await sleep(300);
    const file = path.join(root, 'view', 'externally_edited.json');
    await fs.writeFile(file, JSON.stringify({ label: 'externally edited' }, null, 2));

    await Promise.race([collectorDone, sleep(EVENT_WAIT_MS)]);
    await iter.return?.(undefined);

    expect(collected).toHaveLength(1);
    expect(collected[0]!.op).toBe('update');
    expect(collected[0]!.source).toBe('fs');
    expect(collected[0]!.actor).toBe('fs');
  }, WATCHER_CASE_TIMEOUT_MS);

  it('chokidar: own writes do not re-trigger events (self-write suppression)', async () => {
    repo = new FileSystemRepository({ root, org: 'system' });
    await repo.start();
    const ref = baseRef('self_only');
    const a = await repo.put(ref, { v: 1 }, { parentVersion: null, actor: 't' });
    const b = await repo.put(ref, { v: 2 }, { parentVersion: a.version, actor: 't' });

    // Give chokidar plenty of time to fire spurious events.
    await sleep(400);

    // Read the log directly: must show exactly two events, not four.
    const log = path.join(root, '.objectstack', '.log', 'main.jsonl');
    const lines = (await fs.readFile(log, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).hash).toBe(b.version);
  }, 10000);
});
