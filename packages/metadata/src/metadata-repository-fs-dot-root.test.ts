// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7150, consumer half — an external edit under the **production** metadata
 * layout must reach `MetadataManager` and drop its caches.
 *
 * `MetadataPlugin` attaches a `FileSystemRepository` rooted at
 * `<project>/.objectstack/metadata` (`REPO_SUBDIR`), and `setRepository()`
 * subscribes to `repo.watch({})`, re-emits each event through
 * `notifyWatchers`, and invalidates the registry entry plus the `list()`
 * cache for the affected type. That whole chain was dead in this layout: the
 * repository's chokidar `ignored` matcher was a bare dotfile regex, chokidar
 * applies it to the watched root path itself, and the root has a
 * `.objectstack` segment — so the source end never fired.
 *
 * `metadata-fs`'s own `watch-dot-root.test.ts` pins the repository end. This
 * case is the end-to-end one: a real `FileSystemRepository` on a real
 * dot-rooted temp dir, a real out-of-process write, and the assertion made at
 * the consumer — the seam that a reader of `metadata-fs` alone cannot see is
 * load-bearing.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { MetaRef } from '@objectstack/metadata-core';
import type { MetadataWatchEvent } from '@objectstack/spec/system';
import { FileSystemRepository } from '@objectstack/metadata-fs';
import { MetadataManager } from './metadata-manager.js';

const ref = (name: string): MetaRef => ({ org: 'system', type: 'view' as never, name });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('MetadataManager ← FileSystemRepository under `.objectstack/metadata` (#7150)', () => {
  it('an out-of-process write reaches subscribe() in the dot-rooted layout', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-md7150-'));
    // Exactly what `MetadataPlugin` builds: `path.join(rootDir, REPO_SUBDIR)`.
    const root = path.join(base, '.objectstack', 'metadata');

    const repo = new FileSystemRepository({ root, org: 'system' }); // watcher ENABLED
    const mgr = new MetadataManager({ formats: ['json'] });
    try {
      await repo.start();
      // The first write materializes the root and arms the watcher (#7000).
      await repo.put(ref('case_grid'), { name: 'case_grid', label: 'Cases' }, {
        parentVersion: null,
        actor: 'tester',
      });

      const seen: MetadataWatchEvent[] = [];
      mgr.setRepository(repo);
      mgr.subscribe('view', (evt) => { seen.push(evt); });

      // Past the repository's 200ms self-write suppression window.
      await sleep(400);
      const before = seen.length;

      // The out-of-process writer: a hand edit, or a `git checkout` bringing
      // metadata JSON in. This is what was invisible until the next start().
      await fs.writeFile(
        path.join(root, 'view', 'case_grid.json'),
        JSON.stringify({ name: 'case_grid', label: 'Cases (edited on disk)' }, null, 2),
      );

      const deadline = Date.now() + 15_000;
      while (seen.length === before && Date.now() < deadline) await sleep(100);

      const fresh = seen.slice(before);
      expect(fresh).toHaveLength(1);
      expect(fresh[0]!.type).toBe('changed');
      expect(fresh[0]!.metadataType).toBe('view');
      expect(fresh[0]!.name).toBe('case_grid');
    } finally {
      await mgr.dispose().catch(() => undefined);
      await repo.close().catch(() => undefined);
      await fs.rm(base, { recursive: true, force: true });
    }
  }, 40_000);
});
