// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3826: `sqlite-wasm` joined the shared driver factory so the standalone
// stack's declared `default` datasource — whose CI-safe default is the wasm
// driver — builds through the same `create({driver,config})` as every other
// kind. These are the first direct tests of the factory's id → driver mapping.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
