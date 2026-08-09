// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { existsSync } from 'node:fs';
import {
  resolveSqliteDriver,
  NATIVE_SQLITE_WASM_FALLBACK_WARNING,
  NATIVE_SQLITE_MEMORY_FALLBACK_WARNING,
} from './sqlite-driver-fallback.js';

// Shared, mutable test state read by the mocked driver constructors. `vi.hoisted`
// makes it available inside the hoisted `vi.mock` factories below.
const state = vi.hoisted(() => ({
  /** Make the native better-sqlite3 driver throw a NODE_MODULE_VERSION-style error. */
  nativeFails: false,
  /** Make the wasm SQLite driver fail to connect (forces the in-memory last resort). */
  wasmFails: false,
  nativeConfigs: [] as any[],
  wasmConfigs: [] as any[],
  memoryCount: 0,
}));

const ABI_ERROR_MESSAGE =
  "The module '/x/better_sqlite3.node' was compiled against a different Node.js version " +
  'using NODE_MODULE_VERSION 141. This version of Node.js requires NODE_MODULE_VERSION 127. ' +
  'Please try re-compiling or re-installing the module.';

vi.mock('@objectstack/driver-sql', () => {
  class SqlDriver {
    public readonly name = 'com.objectstack.driver.sql';
    constructor(public readonly config: any) {
      state.nativeConfigs.push(config);
    }
    async connect(): Promise<void> {
      // Mirrors the real driver: connect() runs mkdir + a PRAGMA whose error it
      // swallows — so it is NOT where the ABI failure surfaces.
    }
    async execute(_sql: string): Promise<unknown> {
      // better-sqlite3 loads its native addon lazily at the first query, so the
      // ABI mismatch surfaces here (the SELECT 1 probe), not at construction.
      if (state.nativeFails) throw new Error(ABI_ERROR_MESSAGE);
      return [{ ok: 1 }];
    }
    async disconnect(): Promise<void> {}
  }
  /**
   * The real `resolveSqliteAbsentFileTarget` (#6743), restated here because
   * this suite mocks the whole driver package away and the step-down under
   * test now consults it for the wasm rung. Kept deliberately literal — it is
   * six lines of pure logic with no driver state — and the assertions below
   * pin the OUTCOME (which filename each rung receives), so a drift between
   * this restatement and the real one shows up as a failure there rather than
   * as silently absent coverage.
   */
  const resolveSqliteAbsentFileTarget = (filename: string, mode: string | undefined) => {
    if (mode !== 'empty-in-memory') return { filename, openedEmptyInMemory: false };
    if (typeof filename !== 'string' || filename === '' || filename.startsWith(':')) {
      return { filename, openedEmptyInMemory: false };
    }
    if (existsSync(filename)) return { filename, openedEmptyInMemory: false };
    return { filename: ':memory:', openedEmptyInMemory: true };
  };
  return { SqlDriver, resolveSqliteAbsentFileTarget };
});

vi.mock('@objectstack/driver-sqlite-wasm', () => {
  class SqliteWasmDriver {
    public readonly name = 'com.objectstack.driver.sqlite-wasm';
    constructor(public readonly config: any) {
      state.wasmConfigs.push(config);
    }
    async connect(): Promise<void> {
      if (state.wasmFails) throw new Error('wasm sqlite failed to initialise');
    }
    async execute(): Promise<unknown> {
      return [];
    }
    async disconnect(): Promise<void> {}
  }
  return { SqliteWasmDriver };
});

vi.mock('@objectstack/driver-memory', () => {
  class InMemoryDriver {
    public readonly name = 'com.objectstack.driver.memory';
    constructor() {
      state.memoryCount += 1;
    }
  }
  return { InMemoryDriver };
});

describe('resolveSqliteDriver — native better-sqlite3 → wasm → in-memory step-down (#2229)', () => {
  beforeEach(() => {
    state.nativeFails = false;
    state.wasmFails = false;
    state.nativeConfigs = [];
    state.wasmConfigs = [];
    state.memoryCount = 0;
  });

  it('uses native better-sqlite3 on the happy path (no fallback, no warning)', async () => {
    const warn = vi.fn();
    const resolved = await resolveSqliteDriver({ filename: ':memory:', dev: true, warn });

    expect(resolved.engine).toBe('better-sqlite3');
    expect(resolved.label).toBe('SqlDriver(sqlite)');
    expect(resolved.driver.name).toBe('com.objectstack.driver.sql');
    expect(warn).not.toHaveBeenCalled();
    expect(state.wasmConfigs).toHaveLength(0);
    expect(state.memoryCount).toBe(0);
  });

  it('falls back to wasm SQLite when the native addon fails to load, emitting the warning', async () => {
    state.nativeFails = true;
    const warn = vi.fn();

    const resolved = await resolveSqliteDriver({
      filename: '/tmp/proj/.objectstack/data/dev.db',
      dev: true,
      warn,
    });

    expect(resolved.engine).toBe('sqlite-wasm');
    expect(resolved.label).toBe('SqliteWasmDriver');
    expect(resolved.driver.name).toBe('com.objectstack.driver.sqlite-wasm');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(NATIVE_SQLITE_WASM_FALLBACK_WARNING);
    // The persistent file path is preserved (real on-disk persistence via wasm).
    expect(state.wasmConfigs[0].filename).toBe('/tmp/proj/.objectstack/data/dev.db');
    expect(state.wasmConfigs[0].persist).toBe('on-write');
    expect(state.memoryCount).toBe(0);
  });

  it('uses on-disconnect persistence for an ephemeral :memory: wasm fallback', async () => {
    state.nativeFails = true;
    const resolved = await resolveSqliteDriver({ filename: ':memory:', dev: true, warn: vi.fn() });

    expect(resolved.engine).toBe('sqlite-wasm');
    expect(state.wasmConfigs[0].filename).toBe(':memory:');
    expect(state.wasmConfigs[0].persist).toBe('on-disconnect');
  });

  it('drops to InMemoryDriver as a dev-only last resort when neither native nor wasm load', async () => {
    state.nativeFails = true;
    state.wasmFails = true;
    const warn = vi.fn();

    const resolved = await resolveSqliteDriver({ filename: ':memory:', dev: true, warn });

    expect(resolved.engine).toBe('memory');
    expect(resolved.label).toBe('InMemoryDriver');
    expect(state.memoryCount).toBe(1);
    expect(warn).toHaveBeenCalledWith(NATIVE_SQLITE_MEMORY_FALLBACK_WARNING);
  });

  it('forwards autoMigrate / schemaMode to the native driver', async () => {
    await resolveSqliteDriver({ filename: ':memory:', dev: true, autoMigrate: 'safe', schemaMode: 'managed' });
    expect(state.nativeConfigs[0]).toMatchObject({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      autoMigrate: 'safe',
      schemaMode: 'managed',
    });
  });

  it('forwards sqliteAbsentFile to the native driver — the step-down does not decide it (#6743)', async () => {
    await resolveSqliteDriver({ filename: '/tmp/os-absent-never.db', dev: true, sqliteAbsentFile: 'empty-in-memory' });
    expect(state.nativeConfigs[0]).toMatchObject({ sqliteAbsentFile: 'empty-in-memory' });
  });

  it('omits sqliteAbsentFile entirely when not asked for — no caller changes behaviour (#6743)', async () => {
    await resolveSqliteDriver({ filename: ':memory:', dev: true });
    expect(state.nativeConfigs[0]).not.toHaveProperty('sqliteAbsentFile');
  });

  it('the wasm rung opens :memory: too, so a step-down cannot create the file either (#6743)', async () => {
    // The native rung is what normally applies the redirect, and here it is
    // exactly the rung that fails. `SqliteWasmDriver` takes a bare filename and
    // has no absent-file mode of its own, so without this the dev step-down
    // would quietly create the very file `os migrate plan` declined to create.
    state.nativeFails = true;
    const missing = '/tmp/os-absent-wasm-never.db';
    expect(existsSync(missing)).toBe(false);

    const resolved = await resolveSqliteDriver({
      filename: missing,
      dev: true,
      sqliteAbsentFile: 'empty-in-memory',
      warn: vi.fn(),
    });

    expect(resolved.engine).toBe('sqlite-wasm');
    expect(state.wasmConfigs[0]).toMatchObject({ filename: ':memory:', persist: 'on-disconnect' });
    expect(existsSync(missing)).toBe(false);
  });

  it('production (dev=false) is fail-closed — returns native unprobed, never degrades', async () => {
    state.nativeFails = true;
    const warn = vi.fn();

    const resolved = await resolveSqliteDriver({ filename: '/tmp/prod.db', dev: false, warn });

    // The native driver is handed back as-is so the ABI failure surfaces loudly
    // at first use — we must NOT swap in wasm/mingo behind the operator's back.
    expect(resolved.engine).toBe('better-sqlite3');
    expect(resolved.label).toBe('SqlDriver(sqlite)');
    expect(warn).not.toHaveBeenCalled();
    expect(state.wasmConfigs).toHaveLength(0);
    expect(state.memoryCount).toBe(0);
  });

  describe('dev gate defaults to NODE_ENV when not passed explicitly', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    afterAll(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('falls back to wasm when dev is omitted and NODE_ENV=development', async () => {
      state.nativeFails = true;
      process.env.NODE_ENV = 'development';
      const resolved = await resolveSqliteDriver({ filename: ':memory:', warn: vi.fn() });
      expect(resolved.engine).toBe('sqlite-wasm');
    });

    it('is fail-closed when dev is omitted and NODE_ENV=production', async () => {
      state.nativeFails = true;
      process.env.NODE_ENV = 'production';
      const resolved = await resolveSqliteDriver({ filename: ':memory:', warn: vi.fn() });
      expect(resolved.engine).toBe('better-sqlite3');
    });
  });
});
