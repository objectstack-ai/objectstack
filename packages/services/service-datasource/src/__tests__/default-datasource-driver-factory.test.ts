// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3826: `sqlite-wasm` joined the shared driver factory so the standalone
// stack's declared `default` datasource — whose CI-safe default is the wasm
// driver — builds through the same `create({driver,config})` as every other
// kind. These are the first direct tests of the factory's id → driver mapping.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

const factory = () => createDefaultDatasourceDriverFactory({ dev: false });

describe('createDefaultDatasourceDriverFactory — driver id surface', () => {
  it('supports the sqlite-wasm id and its alias', () => {
    expect(factory().supports('sqlite-wasm')).toBe(true);
    expect(factory().supports('wasm-sqlite')).toBe(true);
    expect(factory().supports('SQLITE-WASM')).toBe(true); // ids are case-insensitive
  });

  it('still rejects unknown ids', () => {
    expect(factory().supports('not-a-real-driver')).toBe(false);
  });
});

describe('createDefaultDatasourceDriverFactory — sqlite-wasm construction (#3826)', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'os-factory-wasm-')); });
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  const NOTE = { name: 'note', fields: { id: { type: 'text' }, title: { type: 'text' } } };

  async function roundTrip(config: Record<string, unknown>) {
    const handle: any = await factory().create({ driver: 'sqlite-wasm', config });
    const driver = handle.driver ?? handle;
    expect(driver?.constructor?.name).toMatch(/SqliteWasmDriver$/);
    await driver.connect();
    try {
      await driver.syncSchema('note', NOTE);
      await driver.create('note', { id: 'n1', title: 'wasm-hello' });
      const rows = (await driver.find('note', {})) as Array<{ title?: string }>;
      return rows.map((r) => r.title);
    } finally {
      try { await driver.disconnect(); } catch { /* noop */ }
    }
  }

  it('builds a file-backed SqliteWasmDriver that connects and round-trips', async () => {
    expect(await roundTrip({ filename: join(dir, 'w.db') })).toContain('wasm-hello');
  }, 30_000);

  it('defaults to :memory: when no filename is configured', async () => {
    expect(await roundTrip({})).toContain('wasm-hello');
  }, 30_000);
});

// #3826 (config-load convergence): mysql joined the factory so the CLI's
// serve fallback can DECLARE a mysql default instead of constructing one.
describe('createDefaultDatasourceDriverFactory — mysql construction', () => {
  it('supports the mysql id and its mysql2 alias', () => {
    expect(factory().supports('mysql')).toBe(true);
    expect(factory().supports('mysql2')).toBe(true);
  });

  it('builds a SqlDriver(mysql2) from a DSN without connecting', async () => {
    const handle: any = await factory().create({
      driver: 'mysql',
      config: { url: 'mysql://user:pw@localhost:3306/db' },
    });
    const driver = handle.driver ?? handle;
    expect(driver?.constructor?.name).toMatch(/SqlDriver$/);
    // Construction must not open a socket — no connect() was called.
    expect(typeof handle.connect).toBe('function');
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });
});

// [#4083] "memory" must mean memory. This branch used to construct a bare
// `new InMemoryDriver()`, dropping the declared `config` — and the driver's own
// `persistence: 'auto'` default writes a CWD-relative
// `.objectstack/data/memory-driver.json` under Node. A declared memory
// datasource was therefore file-backed and reloaded its rows on the next boot,
// with nothing disclosing it: the ADR-0062 acceptance test passed on a virgin
// checkout (and in CI, always a fresh one) then failed on every subsequent
// local run, its seeded rows accumulating two at a time.
describe('createDefaultDatasourceDriverFactory — memory construction (#4083)', () => {
  const memoryDriver = async (config?: Record<string, unknown>) => {
    const handle: any = await factory().create({ driver: 'memory', ...(config ? { config } : {}) } as any);
    return handle.driver ?? handle;
  };

  it('is ephemeral by default — no persistence adapter is installed', async () => {
    const driver = await memoryDriver();
    expect(driver?.constructor?.name).toMatch(/InMemoryDriver$/);
    // The adapter is built during connect(), not construction, so connect
    // first — asserting on a fresh instance would pass vacuously.
    await driver.connect?.();
    try {
      // The adapter is what writes to disk; no adapter ⇒ nothing to write.
      expect((driver as any).persistenceAdapter ?? null).toBeNull();
    } finally {
      await driver.disconnect?.();
    }
  });

  it('leaves nothing on disk after a write', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'os-mem-ds-'));
    const prev = process.cwd();
    process.chdir(cwd);
    try {
      const driver = await memoryDriver();
      await driver.connect?.();
      await driver.bulkCreate?.('note', [{ id: 'n1', title: 'first' }]);
      await driver.disconnect?.();
      // A CWD-relative `.objectstack` is exactly what the old default wrote.
      expect(existsSync(join(cwd, '.objectstack'))).toBe(false);
    } finally {
      process.chdir(prev);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('forwards an explicit persistence request from the declared config', async () => {
    // The declared `config` reaching the driver at all is the other half of
    // this fix — an author who wants a file can still say so.
    const dir = mkdtempSync(join(tmpdir(), 'os-mem-explicit-'));
    const persisted = await memoryDriver({
      persistence: { type: 'file', path: join(dir, 'store.json') },
    });
    await persisted.connect?.();
    try {
      expect((persisted as any).persistenceAdapter ?? null).not.toBeNull();
    } finally {
      await persisted.disconnect?.();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
