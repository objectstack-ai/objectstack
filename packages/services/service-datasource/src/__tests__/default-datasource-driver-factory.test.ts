// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3826: `sqlite-wasm` joined the shared driver factory so the standalone
// stack's declared `default` datasource — whose CI-safe default is the wasm
// driver — builds through the same `create({driver,config})` as every other
// kind. These are the first direct tests of the factory's id → driver mapping.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDefaultDatasourceDriverFactory,
  missingTursoDriverMessage,
  TURSO_DRIVER_INSTALL_COMMAND,
  TURSO_DRIVER_PACKAGE,
  missingSqliteWasmDriverMessage,
  SQLITE_WASM_DRIVER_INSTALL_COMMAND,
  SQLITE_WASM_DRIVER_PACKAGE,
  missingMongodbDriverMessage,
  MONGODB_DRIVER_INSTALL_COMMAND,
  MONGODB_DRIVER_PACKAGE,
} from '../default-datasource-driver-factory.js';
import { isUnbuiltWorkspaceFailure } from '../connect-failure-remedy.js';
import { MissingDriverPackageError } from '../missing-driver-package-error.js';

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

// #7314 — the OPTIONAL libSQL driver is missing, and until now this arm said so
// and stopped: `turso driver requested but @objectstack/driver-turso is not
// installed (…)`. The HOST loader (`@objectstack/runtime`'s
// `loadTursoDriverFactory`, single owner since #6268) has answered the same
// missing package with the install command, the consequence and the reason for
// refusing since #5602 — so the SAME fault got two qualities of answer depending
// on whether the datasource happened to be the host's `default` (told how to fix
// it) or one added in Setup / probed by `testConnection` / declared as a
// non-default (told only that it was broken).
//
// Pinned by CONTENT rather than by `toThrow()`: the defect is what the message
// omits, and a throw-only assertion was green throughout the years this arm
// omitted it.
describe('createDefaultDatasourceDriverFactory — the missing libSQL package is answered with a remedy (#7314)', () => {
  const message = (cause: unknown, datasource?: string) =>
    missingTursoDriverMessage({ cause, ...(datasource ? { datasource } : {}) });

  const notInstalled = Object.assign(
    new Error(`Cannot find package '${TURSO_DRIVER_PACKAGE}' imported from /app/node_modules/x.mjs`),
    { code: 'ERR_MODULE_NOT_FOUND' },
  );

  it('states the exact install command, on its own copy-pasteable line', () => {
    expect(TURSO_DRIVER_INSTALL_COMMAND).toBe('npm install @objectstack/driver-turso');
    expect(message(notInstalled)).toContain(`\n\n    ${TURSO_DRIVER_INSTALL_COMMAND}\n\n`);
  });

  it('names the package that is missing', () => {
    expect(TURSO_DRIVER_PACKAGE).toBe('@objectstack/driver-turso');
    expect(message(notInstalled)).toContain(TURSO_DRIVER_PACKAGE);
  });

  it('states the consequence and that the refusal is deliberate', () => {
    const text = message(notInstalled);
    // Not decoration: without it the reader's next move is to look for the
    // fallback, and a libSQL selection quietly served by another engine is the
    // #3276 class — writes accepted into the wrong database.
    expect(text).toContain('refuses rather than falling back');
    expect(text).toContain('wrong database');
  });

  it('names the datasource that failed, and falls back to `default`', () => {
    expect(message(notInstalled, 'warehouse')).toContain("datasource 'warehouse'");
    expect(message(notInstalled)).toContain("datasource 'default'");
  });

  it('keeps the import error verbatim, so the unbuilt-workspace classifier still fires', () => {
    // Load-bearing: this arm re-throws a NEW Error and therefore drops the
    // original `code`, so `isUnbuiltWorkspaceFailure` can only recognise an
    // unbuilt/uninstalled workspace from the `Cannot find package` TEXT the
    // message carries. Drop the interpolation and a half-built worktree silently
    // goes back to being told "Fix the datasource configuration" (#5794).
    const text = message(notInstalled);
    expect(text).toContain(notInstalled.message);
    expect(isUnbuiltWorkspaceFailure(new Error(text))).toBe(true);
  });

  it('names no escape hatch and no host-boot knob — one fix, stated once', () => {
    const text = message(notInstalled);
    // `OS_ALLOW_DRIVER_CONNECT_FAILURE` would only hide a package that does not
    // exist (#5794), and `OS_DATABASE_URL` / `--database` select the HOST's
    // `default` datasource — neither can affect the datasource that failed here.
    expect(text).not.toContain('OS_ALLOW_DRIVER_CONNECT_FAILURE');
    expect(text).not.toContain('OS_DATABASE_URL');
    expect(text).not.toContain('--database');
    expect(text.match(new RegExp(TURSO_DRIVER_INSTALL_COMMAND.replace(/\//g, '\\/'), 'g'))).toHaveLength(1);
  });

  it('is what the turso arm actually raises when the optional package is absent', async () => {
    // `@objectstack/driver-turso` is deliberately not a dependency of this
    // package — that is what "optional" means — so the missing-package path is
    // reachable here for a real reason and needs no stub.
    let raised: unknown;
    try {
      await factory().create({
        driver: 'turso',
        name: 'warehouse',
        config: { url: 'libsql://my-db.turso.io', authToken: 'tok' },
      });
    } catch (err) {
      raised = err;
    }
    if (raised === undefined) {
      throw new Error(
        `${TURSO_DRIVER_PACKAGE} resolved from @objectstack/service-datasource, so this case no `
        + 'longer exercises the missing-package arm. If the package was made a dependency, this '
        + 'assertion is the notice that the pin above needs a stubbed import instead.',
      );
    }
    expect((raised as Error).message).toContain(TURSO_DRIVER_INSTALL_COMMAND);
    expect((raised as Error).message).toContain(TURSO_DRIVER_PACKAGE);
    expect((raised as Error).message).toContain("datasource 'warehouse'");

    // …and it is the TYPED failure since #7314's second half, not a plain
    // `Error` that happens to carry the same words. The class moved DOWN into
    // this package precisely so this arm could raise it: `serve.ts` decides boot
    // fatality with `e instanceof MissingDriverPackageError`, a predicate no
    // amount of correct wording can satisfy. The install command rides as DATA
    // here, so a host can render the remedy without parsing the sentence.
    expect(raised).toBeInstanceOf(MissingDriverPackageError);
    expect((raised as MissingDriverPackageError).driverType).toBe('turso');
    expect((raised as MissingDriverPackageError).packageName).toBe(TURSO_DRIVER_PACKAGE);
    expect((raised as MissingDriverPackageError).installCommand).toBe(TURSO_DRIVER_INSTALL_COMMAND);
  });
});

// #7385 — the same generalisation over the two SIBLING optional arms.
//
// `sqlite-wasm` and `mongodb` ride in optional packages exactly like `turso`,
// and after #7314 they were the two arms still answering an absent one with
//
//     sqlite-wasm driver requested but @objectstack/driver-sqlite-wasm is not installed (…).
//     mongodb driver requested but @objectstack/driver-mongodb is not installed (…).
//
// — the fault, no install command, no consequence, and not even the name of the
// datasource that failed. One class of problem, two qualities of answer,
// decided by which driver the admin picked.
//
// Pinned by CONTENT for the reason #7384 gave: the defect is what the message
// OMITS, so `toThrow()` was green throughout.
//
// Unlike the libSQL package, BOTH of these resolve inside this workspace (they
// are `devDependencies` of `@objectstack/service-datasource`, which is how the
// construction suites above build real drivers). So the arm-level cases cannot
// simply ask for a driver and watch it fail the way the turso one does — they
// make the optional import fail on purpose instead.
const notInstalled = (pkg: string) =>
  Object.assign(new Error(`Cannot find package '${pkg}' imported from /app/node_modules/x.mjs`), {
    code: 'ERR_MODULE_NOT_FOUND',
  });

/**
 * Build a datasource whose OPTIONAL driver package is absent, and return what
 * the arm raised. The package is a real dependency here, so absence is staged:
 * the module registry is reset, the specifier is mocked with a factory that
 * throws the resolver's own error, and the factory module is re-imported so its
 * lazy `await import(...)` hits the mock. Both are undone in `finally`, so the
 * construction suites in this file keep seeing the real drivers.
 */
async function raiseWithPackageAbsent(
  pkg: string,
  spec: { driver: string; name?: string; config?: Record<string, unknown> },
): Promise<unknown> {
  vi.resetModules();
  vi.doMock(pkg, () => {
    throw notInstalled(pkg);
  });
  try {
    const mod = await import('../default-datasource-driver-factory.js');
    await mod.createDefaultDatasourceDriverFactory({ dev: false }).create(spec as never);
    return undefined;
  } catch (err) {
    return err;
  } finally {
    vi.doUnmock(pkg);
    vi.resetModules();
  }
}

describe('createDefaultDatasourceDriverFactory — the missing WASM SQLite package is answered with a remedy (#7385)', () => {
  const message = (cause: unknown, datasource?: string) =>
    missingSqliteWasmDriverMessage({ cause, ...(datasource ? { datasource } : {}) });
  const cause = notInstalled(SQLITE_WASM_DRIVER_PACKAGE);

  it('states the exact install command, on its own copy-pasteable line', () => {
    expect(SQLITE_WASM_DRIVER_INSTALL_COMMAND).toBe('npm install @objectstack/driver-sqlite-wasm');
    expect(message(cause)).toContain(`\n\n    ${SQLITE_WASM_DRIVER_INSTALL_COMMAND}\n\n`);
  });

  it('names the package that is missing', () => {
    expect(SQLITE_WASM_DRIVER_PACKAGE).toBe('@objectstack/driver-sqlite-wasm');
    expect(message(cause)).toContain(SQLITE_WASM_DRIVER_PACKAGE);
  });

  it('states a consequence that is TRUE for this engine, not the libSQL one', () => {
    const text = message(cause);
    expect(text).toContain('refuses rather than falling back');
    // What a fallback would actually cost here: durability (the memory driver
    // accepts writes and drops them at shutdown, #4083), or the native addon
    // this driver id exists to avoid.
    expect(text).toContain('drop it at shutdown');
    expect(text).toContain('better-sqlite3');
    // And what it must NOT claim: `sqlite-wasm` opens a local file, so there is
    // no remote database for a fallback to shadow. #7384's "your libSQL data
    // stays untouched … the wrong database" reads well here and would be a lie.
    expect(text).not.toContain('wrong database');
    expect(text).not.toContain('stays untouched');
  });

  it('names the datasource that failed, and falls back to `default`', () => {
    expect(message(cause, 'wasm-store')).toContain("datasource 'wasm-store'");
    expect(message(cause)).toContain("datasource 'default'");
  });

  it('keeps the import error verbatim, so the unbuilt-workspace classifier still fires', () => {
    // Load-bearing exactly as in the turso arm: this re-throw drops the original
    // `code`, so `isUnbuiltWorkspaceFailure` can only recognise a half-built
    // checkout from the `Cannot find package` TEXT carried here. That case is
    // the COMMON one for this package — `@objectstack/runtime` and the CLI both
    // depend on it outright, so a reader who hits this is usually unbuilt rather
    // than uninstalled, and must not be told to install what they already have.
    const text = message(cause);
    expect(text).toContain(cause.message);
    expect(isUnbuiltWorkspaceFailure(new Error(text))).toBe(true);
  });

  it('names no escape hatch and no host-boot knob — one fix, stated once', () => {
    const text = message(cause);
    expect(text).not.toContain('OS_ALLOW_DRIVER_CONNECT_FAILURE');
    expect(text).not.toContain('OS_DATABASE_URL');
    expect(text).not.toContain('--database');
    expect(text.match(new RegExp(SQLITE_WASM_DRIVER_INSTALL_COMMAND.replace(/\//g, '\\/'), 'g')))
      .toHaveLength(1);
  });

  it('is what the sqlite-wasm arm actually raises when the optional package is absent', async () => {
    const raised = await raiseWithPackageAbsent(SQLITE_WASM_DRIVER_PACKAGE, {
      driver: 'sqlite-wasm',
      name: 'wasm-store',
      config: { filename: 'data/app.db' },
    });
    expect(raised).toBeInstanceOf(Error);
    expect((raised as Error).message).toContain(SQLITE_WASM_DRIVER_INSTALL_COMMAND);
    expect((raised as Error).message).toContain(SQLITE_WASM_DRIVER_PACKAGE);
    expect((raised as Error).message).toContain("datasource 'wasm-store'");
    expect((raised as Error).message).toContain('refuses rather than falling back');
  });
});

describe('createDefaultDatasourceDriverFactory — the missing MongoDB package is answered with a remedy (#7385)', () => {
  const message = (cause: unknown, datasource?: string) =>
    missingMongodbDriverMessage({ cause, ...(datasource ? { datasource } : {}) });
  const cause = notInstalled(MONGODB_DRIVER_PACKAGE);

  it('states the exact install command, on its own copy-pasteable line', () => {
    expect(MONGODB_DRIVER_INSTALL_COMMAND).toBe('npm install @objectstack/driver-mongodb');
    expect(message(cause)).toContain(`\n\n    ${MONGODB_DRIVER_INSTALL_COMMAND}\n\n`);
  });

  it('names the package that is missing', () => {
    expect(MONGODB_DRIVER_PACKAGE).toBe('@objectstack/driver-mongodb');
    expect(message(cause)).toContain(MONGODB_DRIVER_PACKAGE);
  });

  it('states the consequence and that the refusal is deliberate', () => {
    const text = message(cause);
    expect(text).toContain('refuses rather than falling back');
    // Mongo is a server this process CONNECTS to, so #7384's consequence is
    // true here in substance: a local store shadowing a remote database is the
    // #3276 class — writes accepted into the wrong place.
    expect(text).toContain('stays untouched');
    expect(text).toContain('wrong database');
  });

  it('names the datasource that failed, and falls back to `default`', () => {
    expect(message(cause, 'events')).toContain("datasource 'events'");
    expect(message(cause)).toContain("datasource 'default'");
  });

  it('keeps the import error verbatim, so the unbuilt-workspace classifier still fires', () => {
    const text = message(cause);
    expect(text).toContain(cause.message);
    expect(isUnbuiltWorkspaceFailure(new Error(text))).toBe(true);
  });

  it('names no escape hatch and no host-boot knob — one fix, stated once', () => {
    const text = message(cause);
    expect(text).not.toContain('OS_ALLOW_DRIVER_CONNECT_FAILURE');
    expect(text).not.toContain('OS_DATABASE_URL');
    expect(text).not.toContain('--database');
    expect(text.match(new RegExp(MONGODB_DRIVER_INSTALL_COMMAND.replace(/\//g, '\\/'), 'g')))
      .toHaveLength(1);
  });

  it('is what the mongodb arm actually raises when the optional package is absent', async () => {
    const raised = await raiseWithPackageAbsent(MONGODB_DRIVER_PACKAGE, {
      driver: 'mongodb',
      name: 'events',
      config: { host: 'mongo.internal', database: 'events' },
    });
    expect(raised).toBeInstanceOf(Error);
    expect((raised as Error).message).toContain(MONGODB_DRIVER_INSTALL_COMMAND);
    expect((raised as Error).message).toContain(MONGODB_DRIVER_PACKAGE);
    expect((raised as Error).message).toContain("datasource 'events'");
    expect((raised as Error).message).toContain('refuses rather than falling back');
  });
});

// The point of the card, stated as one assertion: the three optional arms now
// give ONE quality of answer. Skeleton parity rather than byte equality —
// `missingTursoDriverMessage` is deliberately left as its own function (it
// merged hours earlier and #7384's tests pin its wording), and this is what
// makes converging it onto the shared builder a provably inert change later.
describe('createDefaultDatasourceDriverFactory — all three optional-driver arms answer in the same shape (#7385)', () => {
  const messages = [
    missingTursoDriverMessage({ datasource: 'd', cause: notInstalled(TURSO_DRIVER_PACKAGE) }),
    missingSqliteWasmDriverMessage({ datasource: 'd', cause: notInstalled(SQLITE_WASM_DRIVER_PACKAGE) }),
    missingMongodbDriverMessage({ datasource: 'd', cause: notInstalled(MONGODB_DRIVER_PACKAGE) }),
  ];

  it.each([
    ["datasource 'd'", 'names the datasource'],
    ['is not installed. Install it next to the server that opens this datasource:', 'states the fault + where to install'],
    ['It is an OPTIONAL package,', 'says the package is optional'],
    ['This refuses rather than falling back to another engine:', 'says the refusal is deliberate'],
    ['Import error: ', 'ends on the verbatim import error'],
  ])('every arm carries %j (%s)', (fragment) => {
    for (const text of messages) expect(text).toContain(fragment);
  });

  it('every arm is classified as an unbuilt workspace when that is the real cause', () => {
    for (const text of messages) expect(isUnbuiltWorkspaceFailure(new Error(text))).toBe(true);
  });
});
