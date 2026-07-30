// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#4096 — "storage adapter swapped (LocalStorageAdapter →
 * LocalStorageAdapter) … files may be unreachable" on every clean boot.
 *
 * `StorageServicePlugin` re-reads the `storage` settings namespace at boot and
 * rebuilt + swapped the adapter whenever ANY value was persisted. Once the
 * settings service has persisted its own defaults that is every boot, so a
 * healthy server warned about stranded files on a swap from an adapter to an
 * identically-configured one — and since #4012 that lands in the
 * boot-diagnostics block where the real warnings are.
 *
 * The two questions the plugin now asks are pinned here: is a swap needed at
 * all, and did the BACKING STORE move (the only case where existing bytes stop
 * being reachable). A credential rotation is the interesting split — swap yes,
 * warn no.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BASE_PATH,
  DEFAULT_LOCAL_ROOT,
  movesStorageLocation,
  needsStorageSwap,
  resolveStorageTarget,
} from './storage-target.js';

describe('resolveStorageTarget', () => {
  it('normalises an implicit local root to the same target as an explicit one', () => {
    // The #4096 shape: the constructor left `rootDir` implicit and the settings
    // namespace persists the schema default. Same store, so this must not read
    // as a change.
    const implicit = resolveStorageTarget({ kind: 'local' });
    const explicit = resolveStorageTarget({ kind: 'local', rootDir: DEFAULT_LOCAL_ROOT });
    expect(implicit).toEqual(explicit);
    expect(needsStorageSwap(implicit, explicit)).toBe(false);
  });

  it('treats `./x` and `x` as one directory — the real #4096 mismatch', () => {
    // The platform spells the same default both ways: the settings manifest
    // stores `./.objectstack/data/uploads`, the CLI computes
    // `.objectstack/data/uploads`. Raw string comparison reported a migration
    // between a directory and itself.
    const withDot = resolveStorageTarget({ kind: 'local', rootDir: './.objectstack/data/uploads' });
    const without = resolveStorageTarget({ kind: 'local', rootDir: '.objectstack/data/uploads' });
    expect(needsStorageSwap(withDot, without)).toBe(false);
    expect(movesStorageLocation(withDot, without)).toBe(false);
  });

  it('still separates genuinely different directories after normalising', () => {
    expect(needsStorageSwap(
      resolveStorageTarget({ kind: 'local', rootDir: './a/b' }),
      resolveStorageTarget({ kind: 'local', rootDir: './a/c' }),
    )).toBe(true);
    // …including a relative vs absolute spelling, which are not the same path
    // without knowing the cwd — this deliberately does not guess.
    expect(needsStorageSwap(
      resolveStorageTarget({ kind: 'local', rootDir: 'uploads' }),
      resolveStorageTarget({ kind: 'local', rootDir: '/var/uploads' }),
    )).toBe(true);
  });

  it('normalises an implicit basePath the same way', () => {
    expect(resolveStorageTarget({ kind: 'local' }).fingerprint).toBe(
      resolveStorageTarget({ kind: 'local', basePath: DEFAULT_BASE_PATH }).fingerprint,
    );
  });

  it('defaults an absent or unknown kind to local', () => {
    expect(resolveStorageTarget({}).kind).toBe('local');
    expect(resolveStorageTarget({ kind: 'wat' }).kind).toBe('local');
  });

  it('keeps credentials out of `location`, which is the loggable half', () => {
    // `location` goes into the warning text; the fingerprint never does.
    const t = resolveStorageTarget({
      kind: 's3',
      bucket: 'b',
      region: 'r',
      accessKeyId: 'AKIA_PUBLIC',
      secretAccessKey: 'super-secret',
    });
    expect(t.location).not.toContain('super-secret');
    expect(t.location).not.toContain('AKIA_PUBLIC');
    expect(t.fingerprint).toContain('super-secret'); // compared, never printed
  });
});

describe('needsStorageSwap', () => {
  const local = (rootDir?: string) => resolveStorageTarget({ kind: 'local', rootDir });

  it('is false for an identical configuration — the boot that used to warn', () => {
    expect(needsStorageSwap(local('/srv/files'), local('/srv/files'))).toBe(false);
  });

  it('is true when the local root changes', () => {
    expect(needsStorageSwap(local('/srv/a'), local('/srv/b'))).toBe(true);
  });

  it('is true when only a credential changes — the new key must take effect', () => {
    const before = resolveStorageTarget({ kind: 's3', bucket: 'b', region: 'r', secretAccessKey: 'old' });
    const after = resolveStorageTarget({ kind: 's3', bucket: 'b', region: 'r', secretAccessKey: 'new' });
    expect(needsStorageSwap(before, after)).toBe(true);
  });

  it('is true when basePath changes — the adapter signs different URLs', () => {
    expect(needsStorageSwap(
      resolveStorageTarget({ kind: 'local', rootDir: '/srv', basePath: '/api/v1/storage' }),
      resolveStorageTarget({ kind: 'local', rootDir: '/srv', basePath: '/files' }),
    )).toBe(true);
  });

  it('is true with no known starting point', () => {
    expect(needsStorageSwap(undefined, local('/srv'))).toBe(true);
  });
});

describe('movesStorageLocation', () => {
  it('is false for a credential rotation — same bucket, nothing stranded', () => {
    // The split that makes this worth doing: swap, but do not claim files became
    // unreachable when every object stayed where it was.
    const before = resolveStorageTarget({ kind: 's3', bucket: 'b', region: 'r', secretAccessKey: 'old' });
    const after = resolveStorageTarget({ kind: 's3', bucket: 'b', region: 'r', secretAccessKey: 'new' });
    expect(needsStorageSwap(before, after)).toBe(true);
    expect(movesStorageLocation(before, after)).toBe(false);
  });

  it('is false when only basePath changes — URLs move, bytes do not', () => {
    expect(movesStorageLocation(
      resolveStorageTarget({ kind: 'local', rootDir: '/srv', basePath: '/api/v1/storage' }),
      resolveStorageTarget({ kind: 'local', rootDir: '/srv', basePath: '/files' }),
    )).toBe(false);
  });

  it('is true when the local root moves', () => {
    expect(movesStorageLocation(
      resolveStorageTarget({ kind: 'local', rootDir: '/srv/a' }),
      resolveStorageTarget({ kind: 'local', rootDir: '/srv/b' }),
    )).toBe(true);
  });

  it('is true when the kind changes — local → s3 strands every file', () => {
    expect(movesStorageLocation(
      resolveStorageTarget({ kind: 'local', rootDir: '/srv' }),
      resolveStorageTarget({ kind: 's3', bucket: 'b', region: 'r' }),
    )).toBe(true);
  });

  it('is true for a different bucket, and for the same bucket on another endpoint', () => {
    const aws = resolveStorageTarget({ kind: 's3', bucket: 'b', region: 'r' });
    expect(movesStorageLocation(aws, resolveStorageTarget({ kind: 's3', bucket: 'other', region: 'r' }))).toBe(true);
    // Same bucket NAME on MinIO/R2 is a different store entirely.
    expect(movesStorageLocation(
      aws,
      resolveStorageTarget({ kind: 's3', bucket: 'b', region: 'r', endpoint: 'https://minio.local' }),
    )).toBe(true);
    expect(movesStorageLocation(aws, resolveStorageTarget({ kind: 's3', bucket: 'b', region: 'other' }))).toBe(true);
  });

  it('warns when the starting point is unknown — ignorance must not silence it', () => {
    // A `swap()` from a caller that resolved no target still gets the warning.
    expect(movesStorageLocation(undefined, resolveStorageTarget({ kind: 'local' }))).toBe(true);
  });
});
