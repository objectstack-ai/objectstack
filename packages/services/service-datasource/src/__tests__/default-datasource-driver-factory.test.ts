// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3826: `sqlite-wasm` joined the shared driver factory so the standalone
// stack's declared `default` datasource — whose CI-safe default is the wasm
// driver — builds through the same `create({driver,config})` as every other
// kind. These are the first direct tests of the factory's id → driver mapping.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

// #4083 — the `memory` id built a bare `new InMemoryDriver()`, inheriting the
// driver's THEN-default `persistence: 'auto'` (#4065 has since made that default
// `false`, so this suite now pins the factory's own guarantee rather than a
// correction to the driver's): in Node a file adapter at the
// RELATIVE, process-global path `.objectstack/data/memory-driver.json`. So a
// "memory" datasource flushed its store into the server's CWD at teardown and
// reloaded it on the next boot, and every memory pool in the process aliased the
// same file. That is what made the ADR-0062 D1 federated-read acceptance read 2
// rows on a clean checkout and 2×N on the Nth run.
describe('createDefaultDatasourceDriverFactory — memory construction (#4083)', () => {
  const STATE_DIR = join(process.cwd(), '.objectstack');

  // Nothing here may write to the CWD. Asserting that directory's absence is the
  // point, so clear it on both sides: a leftover from another test file would
  // make this pass for the wrong reason, and a failure that DID create it must
  // not leak into the next run (that leak is the very bug under test).
  const clearState = () => { try { rmSync(STATE_DIR, { recursive: true, force: true }); } catch { /* noop */ } };
  beforeAll(clearState);
  afterAll(clearState);

  async function pool(spec: { name?: string; config?: Record<string, unknown> } = {}) {
    const handle: any = await factory().create({
      driver: 'memory',
      config: spec.config ?? {},
      ...(spec.name ? { name: spec.name } : {}),
    });
    const driver = handle.driver ?? handle;
    expect(driver?.constructor?.name).toMatch(/InMemoryDriver$/);
    await handle.connect?.();
    return { handle, driver };
  }

  it('is ephemeral: a pool writes nothing to disk and a restart starts empty', async () => {
    const first = await pool({ name: 'ext' });
    await first.driver.bulkCreate('ext_note', [{ id: 'n1', title: 'first' }, { id: 'n2', title: 'second' }]);
    expect(await first.driver.find('ext_note', {})).toHaveLength(2);
    // Teardown is where the file adapter flushed. It must produce no file…
    await first.handle.disconnect?.();
    expect(existsSync(STATE_DIR)).toBe(false);

    // …and the next boot of the SAME datasource must not inherit those rows.
    const second = await pool({ name: 'ext' });
    try {
      expect(await second.driver.find('ext_note', {})).toEqual([]);
    } finally {
      await second.handle.disconnect?.();
    }
  });

  it('gives two memory datasources independent stores', async () => {
    const a = await pool({ name: 'ext_a' });
    const b = await pool({ name: 'ext_b' });
    try {
      await a.driver.create('ext_note', { id: 'a1', title: 'only-in-a' });
      expect(await a.driver.find('ext_note', {})).toHaveLength(1);
      expect(await b.driver.find('ext_note', {})).toEqual([]);
    } finally {
      await a.handle.disconnect?.();
      await b.handle.disconnect?.();
    }
  });

  it("honors the datasource's own memory config (previously dropped entirely)", async () => {
    const { handle, driver } = await pool({
      name: 'seeded',
      config: { initialData: { ext_note: [{ id: 'seed', title: 'from-config' }] }, strictMode: true },
    });
    try {
      const rows = (await driver.find('ext_note', {})) as Array<{ title?: string }>;
      expect(rows.map((r) => r.title)).toEqual(['from-config']);
    } finally {
      await handle.disconnect?.();
    }
  });

  it('scopes an OPT-IN persistence destination to the datasource, not the process', async () => {
    // The one white-box assertion here, and deliberately so: what needs pinning
    // is the destination handed to the driver, and the alternative (letting two
    // pools actually write) means writing into the repo checkout's CWD.
    const { handle, driver } = await pool({ name: 'warehouse', config: { persistence: 'file' } });
    const persistence = (driver as { config: { persistence: { type?: string; path?: string; key?: string } } }).config.persistence;
    expect(persistence.type).toBe('file');
    expect(persistence.path).toBe(join('.objectstack', 'data', 'memory-warehouse.json'));
    expect(persistence.key).toBe('objectstack:memory-db:warehouse');
    // Author-supplied destinations are theirs — never rewritten.
    const explicit = await pool({ name: 'warehouse', config: { persistence: { type: 'file', path: join(tmpdir(), 'os-4083-explicit.json') } } });
    expect((explicit.driver as { config: { persistence: { path?: string } } }).config.persistence.path)
      .toBe(join(tmpdir(), 'os-4083-explicit.json'));
    await handle.disconnect?.();
    await explicit.handle.disconnect?.();
  });
});
