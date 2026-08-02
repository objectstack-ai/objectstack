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

// #4410 — the keys that were DECLARED and dropped on the floor. Each of these
// was authorable, strict, documented and read by nothing, so a datasource that
// set it behaved exactly like one that did not. The gate over `datasource.config`
// is only honest if the contract it enforces is one the factory honours, which
// is what these pin.
describe('createDefaultDatasourceDriverFactory — declared keys reach the driver (#4410)', () => {
  /** The knex config a constructed SqlDriver was built from. */
  function knexConfigOf(driver: any): any {
    return driver?.config ?? driver?.knexConfig ?? driver?.options ?? {};
  }

  it('honours the datasource `pool` block instead of the hardcoded min0/max5', async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: { host: 'db.internal', database: 'analytics' },
      pool: { min: 2, max: 20, idleTimeoutMillis: 45_000 },
    });
    const cfg = knexConfigOf(handle.driver ?? handle);
    expect(cfg.pool).toMatchObject({ min: 2, max: 20, idleTimeoutMillis: 45_000 });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('keeps the previous defaults when no pool is declared', async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: { host: 'db.internal', database: 'analytics' },
    });
    expect(knexConfigOf(handle.driver ?? handle).pool).toMatchObject({ min: 0, max: 5 });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('carries postgres schema / applicationName / statementTimeout onto the connection', async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: {
        host: 'db.internal',
        database: 'analytics',
        schema: 'reporting',
        applicationName: 'objectstack',
        statementTimeout: 30_000,
      },
    });
    const cfg = knexConfigOf(handle.driver ?? handle);
    expect(cfg.searchPath).toBe('reporting');
    expect(cfg.connection).toMatchObject({
      application_name: 'objectstack',
      statement_timeout: 30_000,
    });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('carries the datasource `ssl` block onto the connection, certificates and all', async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: { host: 'db.internal', database: 'analytics' },
      ssl: { enabled: true, rejectUnauthorized: false, ca: 'CA-PEM' },
    });
    expect(knexConfigOf(handle.driver ?? handle).connection).toMatchObject({
      ssl: { rejectUnauthorized: false, ca: 'CA-PEM' },
    });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('reads `ssl: false` on the block as TLS off, not as absent', async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: { host: 'db.internal', database: 'analytics', ssl: true },
      ssl: { enabled: false },
    });
    expect(knexConfigOf(handle.driver ?? handle).connection).toMatchObject({ ssl: false });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('falls back to the per-driver boolean shorthand when no block is declared', async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: { host: 'db.internal', database: 'analytics', ssl: true },
    });
    expect(knexConfigOf(handle.driver ?? handle).connection).toMatchObject({ ssl: true });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it("applies the datasource's own schemaMode, which never reached the driver before", async () => {
    const handle: any = await factory().create({
      driver: 'postgres',
      config: { host: 'db.internal', database: 'analytics' },
      schemaMode: 'external',
    });
    const driver: any = handle.driver ?? handle;
    expect(knexConfigOf(driver).schemaMode ?? driver.schemaMode).toBe('external');
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });
});

// #4456 — the four undeclared read-side `??` fallbacks are DELETED. The factory
// reads exactly the canonical key of each driver's config contract; the legacy
// spellings a pre-#4410 stored record may carry are rewritten to canonical at
// every rehydration seam by the ADR-0087 conversion
// `datasource-config-driver-key-aliases`, so they must never reach this code —
// and when one does anyway, it is ignored rather than quietly honoured.
describe('createDefaultDatasourceDriverFactory — legacy config spellings are no longer read (#4456)', () => {
  function knexConfigOf(driver: any): any {
    return driver?.config ?? driver?.knexConfig ?? driver?.options ?? {};
  }

  async function pgConnection(config: Record<string, unknown>): Promise<any> {
    const handle: any = await factory().create({ driver: 'postgres', config });
    try { return knexConfigOf(handle.driver ?? handle).connection; }
    finally { try { await handle.disconnect?.(); } catch { /* pool never opened */ } }
  }

  it('pg: `connectionString` no longer selects the DSN path — discrete fields are used instead', async () => {
    const conn = await pgConnection({
      connectionString: 'postgresql://legacy@db.internal/analytics',
      host: 'db.internal',
      database: 'analytics',
    });
    expect(conn.connectionString).toBeUndefined();
    expect(conn).toMatchObject({ host: 'db.internal', database: 'analytics' });
  });

  it('pg: `user` no longer reaches the client — only the canonical `username` does', async () => {
    const legacyOnly = await pgConnection({ host: 'h', database: 'd', user: 'legacy' });
    expect(legacyOnly.user).toBeUndefined();
    const both = await pgConnection({ host: 'h', database: 'd', user: 'legacy', username: 'svc' });
    expect(both.user).toBe('svc');
  });

  it('mysql: `connectionString`/`user` are ignored the same way', async () => {
    const handle: any = await factory().create({
      driver: 'mysql',
      config: { connectionString: 'mysql://legacy@db/orders', host: 'db', database: 'orders', user: 'legacy' },
    });
    const conn = knexConfigOf(handle.driver ?? handle).connection;
    // Not the DSN string passthrough — the discrete-field object, with no user.
    expect(typeof conn).toBe('object');
    expect(conn).toMatchObject({ host: 'db', database: 'orders' });
    expect(conn.user).toBeUndefined();
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('sqlite-wasm: `file`/`database` no longer name the database — the driver builds `:memory:`', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-4456-'));
    try {
      const legacyFile = join(dir, 'legacy.db');
      const handle: any = await factory().create({
        driver: 'sqlite-wasm',
        config: { file: legacyFile, database: legacyFile },
      });
      const driver = handle.driver ?? handle;
      await driver.connect();
      try {
        await driver.syncSchema('note', { name: 'note', fields: { id: { type: 'text' } } });
        await driver.create('note', { id: 'n1' });
      } finally {
        try { await driver.disconnect(); } catch { /* noop */ }
      }
      // An ephemeral `:memory:` database writes nothing at the legacy path.
      expect(existsSync(legacyFile)).toBe(false);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  }, 30_000);

  it('mongo: `uri`/`user` are ignored — the URL is composed from canonical keys only', async () => {
    const handle: any = await factory().create({
      driver: 'mongo',
      config: { uri: 'mongodb://legacy.internal:27017/legacy', database: 'events', user: 'legacy' },
    });
    const driver: any = handle.driver ?? handle;
    // No canonical `url`/`host`/`username` → composed from defaults + `database`,
    // with no auth part; the legacy `uri` never passes through.
    expect(driver.config.url).toBe('mongodb://localhost:27017/events');
  });

  it('mongo: the canonical spellings still compose the URL (control)', async () => {
    const handle: any = await factory().create({
      driver: 'mongo',
      config: { host: 'mongo.internal', port: 27017, database: 'events', username: 'svc', password: 'pw' },
    });
    const driver: any = handle.driver ?? handle;
    expect(driver.config.url).toBe('mongodb://svc:pw@mongo.internal:27017/events');
  });
});
