// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7314 — the single read of a libSQL datasource's config.
//
// Two loaders build the libSQL driver and which one runs is decided by whether
// the datasource happens to be a host's `default`: `@objectstack/runtime`'s
// `loadTursoDriverFactory` for that one, this package's open-core arm for every
// other door. Each used to hand-list the keys it read, and the lists had drifted
// — nine here, `url` and `authToken` there — so the same declared config was
// honoured or silently dropped depending on the datasource's NAME.
//
// These cases pin the builder both loaders now share. The cross-loader identity
// of the result is pinned from the runtime side
// (`turso-driver-factory.convergence.test.ts`), and the correspondence with the
// driver's own `TursoDriverConfig` from `packages/cli` — the only one of the
// three packages that carries `@objectstack/driver-turso`.

import { describe, it, expect } from 'vitest';
import {
  buildTursoDriverConfig,
  resolveTursoUrl,
  TURSO_DRIVER_CONFIG_KEYS,
} from '../turso-driver-config.js';
import { resolveDatasourceSchemaMode } from '../datasource-schema-mode.js';
import type { DatasourceConnectionSpec } from '../contracts/index.js';

describe('buildTursoDriverConfig (#7314)', () => {
  it('carries every declared key onto the driver config', () => {
    const spec: DatasourceConnectionSpec = {
      name: 'warehouse',
      driver: 'turso',
      schemaMode: 'validate-only',
      config: {
        url: 'libsql://my-db.turso.io',
        authToken: 'jwt-token',
        encryptionKey: 'aes-256-key',
        concurrency: 7,
        syncUrl: 'libsql://replica.turso.io',
        sync: { intervalSeconds: 30, onConnect: false },
        timeout: 9000,
        mode: 'replica',
      },
    };
    expect(buildTursoDriverConfig(spec, resolveTursoUrl(spec))).toEqual({
      url: 'libsql://my-db.turso.io',
      authToken: 'jwt-token',
      encryptionKey: 'aes-256-key',
      concurrency: 7,
      syncUrl: 'libsql://replica.turso.io',
      sync: { intervalSeconds: 30, onConnect: false },
      timeout: 9000,
      mode: 'replica',
      schemaMode: 'validate-only',
    });
  });

  // The key list is DERIVED from the reader table rather than written a second
  // time, which is what makes "a new key is read by both loaders" structural: a
  // key added to `TursoDriverConfigInput` without a reader does not compile.
  it('exposes exactly the keys it can emit', () => {
    const spec: DatasourceConnectionSpec = {
      driver: 'turso',
      schemaMode: 'managed',
      config: {
        url: 'libsql://x',
        authToken: 'a',
        encryptionKey: 'k',
        concurrency: 1,
        syncUrl: 'libsql://y',
        sync: {},
        timeout: 1,
        mode: 'remote',
      },
    };
    expect(Object.keys(buildTursoDriverConfig(spec, resolveTursoUrl(spec))).sort())
      .toEqual([...TURSO_DRIVER_CONFIG_KEYS].sort());
  });

  it('omits undeclared keys rather than emitting undefined', () => {
    const spec: DatasourceConnectionSpec = { driver: 'turso', config: { url: 'file:./a.db' } };
    const config = buildTursoDriverConfig(spec, resolveTursoUrl(spec));
    expect(config).toEqual({ url: 'file:./a.db' });
    expect(Object.keys(config)).toEqual(['url']);
  });

  // Empty strings are unset, not credentials of length zero — the open-core
  // arm's own type-tests, carried over unchanged. The number keys deliberately
  // have no truthiness check: `concurrency: 0` / `timeout: 0` are values the
  // driver reads.
  it('treats empty string credentials as unset and keeps zero-valued numbers', () => {
    const spec: DatasourceConnectionSpec = {
      driver: 'turso',
      config: { url: 'libsql://x', authToken: '', encryptionKey: '', syncUrl: '', concurrency: 0, timeout: 0 },
    };
    expect(buildTursoDriverConfig(spec, resolveTursoUrl(spec)))
      .toEqual({ url: 'libsql://x', concurrency: 0, timeout: 0 });
  });

  // ADR-0015 ownership reaches the driver from the datasource's OWN key, not
  // only from inside `config` — the #4410 fix. A loader reading `config` alone
  // constructs an `external` database as `managed`, with DDL ungated.
  it('reads schemaMode from the spec, the external block and config, in that order', () => {
    const base = { driver: 'turso', config: { url: 'libsql://x' } } as const;
    expect(resolveDatasourceSchemaMode({ ...base, schemaMode: 'external' })).toBe('external');
    expect(resolveDatasourceSchemaMode({ ...base, external: { schemaMode: 'validate-only' } }))
      .toBe('validate-only');
    expect(resolveDatasourceSchemaMode({ driver: 'turso', config: { url: 'libsql://x', schemaMode: 'external' } }))
      .toBe('external');
    expect(resolveDatasourceSchemaMode(base)).toBeUndefined();

    const spec: DatasourceConnectionSpec = { ...base, schemaMode: 'external' };
    expect(buildTursoDriverConfig(spec, resolveTursoUrl(spec)).schemaMode).toBe('external');
  });
});

describe('resolveTursoUrl (#7314)', () => {
  it('trims, and reports a whitespace-only or absent url as none', () => {
    expect(resolveTursoUrl({ driver: 'turso', config: { url: '  libsql://x  ' } })).toBe('libsql://x');
    expect(resolveTursoUrl({ driver: 'turso', config: { url: '   ' } })).toBe('');
    expect(resolveTursoUrl({ driver: 'turso', config: {} })).toBe('');
    expect(resolveTursoUrl({ driver: 'turso', config: { url: 42 } as Record<string, unknown> })).toBe('');
  });
});
