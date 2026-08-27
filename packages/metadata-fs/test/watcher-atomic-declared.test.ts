// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12696 — `startWatcher()` must pass `atomic` to chokidar EXPLICITLY.
 *
 * chokidar 5's defaults literal assigns `atomic: true` BEFORE the caller's
 * options are spread in (`node_modules/chokidar/index.js`):
 *
 *   const opts = {
 *     // Defaults
 *     ...
 *     atomic: true, // NOTE: overwritten later (depends on usePolling)
 *     ..._opts,
 *     ...
 *   };
 *   ...
 *   // Editor atomic write normalization enabled by default with fs.watch
 *   if (opts.atomic === undefined)
 *       opts.atomic = !opts.usePolling;
 *
 * so the "overwritten later" comment is aspirational: the correction can
 * only run when the caller omits `atomic` AND that omission left
 * `opts.atomic === undefined`, but it never does — the defaults literal
 * already assigned `true`, and the caller's spread has no `atomic` key to
 * override it with. The branch is dead.
 *
 * The consequence for THIS pin: the RESOLVED value chokidar hands back
 * (`watcher.options.atomic`) is `true` whether `startWatcher()` declares it
 * or not — a merged-value read cannot tell "declared here" apart from
 * "inherited a dead branch that happens to agree today". A pin written
 * against that merged read would stay green across the exact regression it
 * exists to catch: a future chokidar release that fixes the ordering (making
 * the correction real) would then silently flip this repository's watcher to
 * `atomic: false` under `usePolling` — losing the 100ms unlink-coalescing
 * deferral and the `DOT_RE` editor-temp matcher from a live delivery path —
 * and nothing here would notice.
 *
 * So this pin does not read the merged option. It reads the ACTUAL call
 * `startWatcher()` makes to `chokidar.watch()`, via a spy that lets the real
 * call through unchanged (this pins DECLARATION, not delivery — every other
 * watcher behaviour in this package must keep working identically). That is
 * a runtime observation of what this repository hands off, not a grep of the
 * call-site literal, and it is the one thing whose presence a future
 * chokidar default cannot silently override.
 *
 * ⛔ No wall-clock wait anywhere in this file, deliberately (see
 * `watch-dot-root.test.ts` for the standing prohibition and its history of
 * merge-queue ejections). None is needed: the root is created by `mkdtemp()`
 * before `start()` runs, so `start()` arms the watcher SYNCHRONOUSLY inside
 * its own call (see its comment on #7000/#9339) — `chokidar.watch()` is
 * invoked, and the spy has recorded the call, by the time `start()`'s
 * promise resolves. This case never touches the 100ms unlink window itself
 * (out of scope for #12696 — see the card's "carry forward" section).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import chokidar from 'chokidar';
import { FileSystemRepository } from '../src/index.js';

describe('FileSystemRepository — startWatcher() declares `atomic` explicitly (#12696)', () => {
  let root: string;
  let repo: FileSystemRepository | undefined;
  let watchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'objectstack-fsatomic-'));
    // Let the real call through — nothing here is faked, so every other
    // watcher behaviour this case exercises stays exactly as it runs in
    // production.
    watchSpy = vi.spyOn(chokidar, 'watch');
  });

  afterEach(async () => {
    if (repo) await repo.close().catch(() => undefined);
    repo = undefined;
    watchSpy.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('passes `atomic: true` as an OWN key of the options object handed to chokidar.watch()', async () => {
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: false });
    await repo.start();

    expect(watchSpy).toHaveBeenCalledTimes(1);
    const [, options] = watchSpy.mock.calls[0] as [string, Record<string, unknown>];

    // The behaviour this pin exists to protect: `atomic` must be an OWN key
    // of the call-site options object, not merely absent-and-coincidentally
    // `true` after chokidar's internal merge (see file header).
    expect(Object.prototype.hasOwnProperty.call(options, 'atomic')).toBe(true);
    expect(options.atomic).toBe(true);
  });

  // Positive control (#12696 ablation) — a SEPARATE case so it runs to
  // completion, and so its verdict, on its own assertions, is independent of
  // whatever the case above does. `usePolling` is unconditionally declared
  // today and untouched by this card's fix; it must stay green under the
  // ablation that removes the explicit `atomic`. If it ever went red too,
  // the spy/harness would be the suspect, not the `atomic` declaration.
  it('[control] passes `usePolling: true` as an OWN key of the same options object', async () => {
    repo = new FileSystemRepository({ root, org: 'system', disableWatch: false });
    await repo.start();

    expect(watchSpy).toHaveBeenCalledTimes(1);
    const [, options] = watchSpy.mock.calls[0] as [string, Record<string, unknown>];

    expect(Object.prototype.hasOwnProperty.call(options, 'usePolling')).toBe(true);
    expect(options.usePolling).toBe(true);
  });
});
