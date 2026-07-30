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
 */

import { describe, it, expect } from 'vitest';
import { resolveStorageCapabilityArg } from './serve.js';

describe('resolveStorageCapabilityArg', () => {
  it('builds options StorageServicePlugin actually reads', () => {
    // `adapter` + `local.rootDir` — NOT `driver` + `root`.
    expect(resolveStorageCapabilityArg(undefined).options).toEqual({
      adapter: 'local',
      local: { rootDir: '.objectstack/data/uploads' },
    });
  });

  it('never emits the keys the plugin ignores', () => {
    // The regression guard proper: `{driver, root}` type-checks fine as an
    // argument and does nothing at runtime.
    const { options } = resolveStorageCapabilityArg(undefined);
    expect(options).not.toHaveProperty('driver');
    expect(options).not.toHaveProperty('root');
  });

  it('honours OS_STORAGE_ROOT, which the old shape discarded', () => {
    const { options, localRoot } = resolveStorageCapabilityArg(undefined, '/srv/uploads');
    expect(options).toEqual({ adapter: 'local', local: { rootDir: '/srv/uploads' } });
    expect(localRoot).toBe('/srv/uploads');
  });

  it('ignores a blank or whitespace-only env root', () => {
    for (const blank of ['', '   ']) {
      expect(resolveStorageCapabilityArg(undefined, blank).options).toEqual({
        adapter: 'local',
        local: { rootDir: '.objectstack/data/uploads' },
      });
    }
  });

  it('reports the local root so only the fallback triggers the production warning', () => {
    // A host that configured its own backend must not be told it is on local disk.
    expect(resolveStorageCapabilityArg(undefined).localRoot).toBe('.objectstack/data/uploads');
    expect(resolveStorageCapabilityArg({ adapter: 's3', s3: { bucket: 'b', region: 'r' } }).localRoot)
      .toBeUndefined();
  });

  it('forwards a host-configured storage block verbatim', () => {
    const cfg = { adapter: 's3', s3: { bucket: 'b', region: 'r' } };
    expect(resolveStorageCapabilityArg(cfg).options).toBe(cfg);
    // The `driver` dialect is still forwarded untouched — the plugin does not
    // read it either, but rewriting it here would fossilize the wrong contract
    // rather than fix it. Tracked separately.
    const legacy = { driver: 's3', bucket: 'b' };
    expect(resolveStorageCapabilityArg(legacy).options).toBe(legacy);
  });

  it('falls back when the block names no backend at all', () => {
    // `config.storage = { presignedTtl: 60 }` configures no backend, so the
    // local default still applies rather than being replaced by a partial block.
    expect(resolveStorageCapabilityArg({ presignedTtl: 60 }).options).toEqual({
      adapter: 'local',
      local: { rootDir: '.objectstack/data/uploads' },
    });
  });
});
