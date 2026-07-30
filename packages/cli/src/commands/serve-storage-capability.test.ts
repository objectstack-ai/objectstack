// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#4096 — what `StorageServicePlugin` is actually constructed with.
 *
 * The fallback used to be `{ driver: 'local', root }`, and
 * `StorageServicePluginOptions` declares neither key. Both were dropped
 * silently, so the plugin applied its own `./storage` default,
 * `OS_STORAGE_ROOT` changed nothing, and uploads landed somewhere the operator
 * never named. The `storage` settings namespace then corrected the root on its
 * first read — its manifest default is `./.objectstack/data/uploads` — which
 * swapped the adapter and warned "existing files were NOT migrated" on every
 * boot of a healthy server.
 *
 * The warning was telling the truth; the configuration was wrong. These pin the
 * option SHAPE, because a shape mismatch is exactly the failure a passing type
 * check does not catch when the receiving interface has no index signature and
 * the value is built as a plain object literal.
 *
 * framework#4167 then removed the `config.storage` branch this helper also had.
 * `storage` was never a declared stack key, so `defineStack` — which every
 * documented authoring path and every compiled artifact goes through — stripped
 * it long before `serve` ran. Reading it here made one authoring key work on the
 * single path that skips `defineStack` and vanish on all the others. Authors who
 * write it are now told, by `lintUnknownAuthoringKeys`.
 */

import { describe, it, expect } from 'vitest';
import { resolveStorageCapabilityArg } from './serve.js';

describe('resolveStorageCapabilityArg', () => {
  it('builds options StorageServicePlugin actually reads', () => {
    // `adapter` + `local.rootDir` — NOT `driver` + `root`.
    expect(resolveStorageCapabilityArg().options).toEqual({
      adapter: 'local',
      local: { rootDir: '.objectstack/data/uploads' },
    });
  });

  it('never emits the keys the plugin ignores', () => {
    // The regression guard proper: `{driver, root}` type-checks fine as an
    // argument and does nothing at runtime.
    const { options } = resolveStorageCapabilityArg();
    expect(options).not.toHaveProperty('driver');
    expect(options).not.toHaveProperty('root');
  });

  it('honours OS_STORAGE_ROOT, which the old shape discarded', () => {
    const { options, localRoot } = resolveStorageCapabilityArg('/srv/uploads');
    expect(options).toEqual({ adapter: 'local', local: { rootDir: '/srv/uploads' } });
    expect(localRoot).toBe('/srv/uploads');
  });

  it('ignores a blank or whitespace-only env root', () => {
    for (const blank of ['', '   ']) {
      expect(resolveStorageCapabilityArg(blank).options).toEqual({
        adapter: 'local',
        local: { rootDir: '.objectstack/data/uploads' },
      });
    }
  });

  it('reports the local root the production warning names', () => {
    // The warning quotes this, so it has to be the directory actually in use —
    // it previously named a root the adapter was not using.
    expect(resolveStorageCapabilityArg().localRoot).toBe('.objectstack/data/uploads');
    expect(resolveStorageCapabilityArg('/srv/x').localRoot).toBe('/srv/x');
  });

  it('does not read config.storage at all — it was never a stack key (#4167)', () => {
    // `ObjectStackDefinitionSchema` does not declare `storage`, and is not
    // `.strict()`, so `defineStack` strips it before serve could see it. Reading
    // it here made the same authoring key work on the one path that skips
    // `defineStack` and vanish on every documented one. The signature no longer
    // accepts it; `lintUnknownAuthoringKeys` now tells the author instead.
    expect(resolveStorageCapabilityArg.length).toBe(1);
  });

});
