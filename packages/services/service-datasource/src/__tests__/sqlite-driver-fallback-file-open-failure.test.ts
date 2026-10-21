// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * In development, a SQLite database FILE that cannot be opened or created fails
 * the probe, as it does in production. Only a native addon that cannot LOAD
 * steps down to wasm SQLite (#24950).
 *
 * Before: `resolveSqliteDriver` stepped down on ANY probe failure in
 * development. A file under a regular file failed native, failed wasm on the
 * same path, and was answered by the in-memory rung. So a declared datasource
 * that could not answer one query read `connected`, and
 * `os migrate audit-mail-bodies` reported a store it never opened as examined
 * and clean.
 *
 * Real `better-sqlite3`, real wasm SQLite and real files in a scratch
 * directory, as opposed to `../sqlite-driver-fallback.test.ts`, which mocks
 * all three driver packages. The one thing faked is an addon that cannot load.
 * It is faked at the seam where `better-sqlite3` loads its addon: the knex
 * better-sqlite3 client's `acquireRawConnection` (`new Database(file)`).
 * The fake throws a REAL load error: Node's own `ERR_DLOPEN_FAILED`, or the
 * `MODULE_NOT_FOUND` better-sqlite3's own loader meets when its addon was
 * never built.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  NATIVE_SQLITE_WASM_FALLBACK_WARNING,
  resolveSqliteDriver,
  type ResolvedSqliteDriver,
} from '../sqlite-driver-fallback.js';
import { DatasourceConnectionService } from '../datasource-connection-service.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

let dir: string;
const opened: ResolvedSqliteDriver[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-24950-'));
  writeFileSync(join(dir, 'plain'), '');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((r) => r.driver?.disconnect?.().catch(() => {})));
  rmSync(dir, { recursive: true, force: true });
});

async function resolveDev(filename: string, warn = vi.fn()): Promise<ResolvedSqliteDriver> {
  const resolved = await resolveSqliteDriver({ filename, dev: true, warn });
  opened.push(resolved);
  return resolved;
}

/** `promise`'s rejection; a failure naming the engine when it resolves instead. */
async function rejectionOf(promise: Promise<ResolvedSqliteDriver>): Promise<any> {
  let resolved: ResolvedSqliteDriver;
  try {
    resolved = await promise;
  } catch (error) {
    return error;
  }
  opened.push(resolved);
  throw new Error(`resolved to engine '${resolved.engine}' for a file that cannot be opened or created`);
}

/** The driver's refusal of the file: its own error name, the system's code, and the file. */
function expectFileRefusal(error: any, filename: string, code: string): void {
  expect(error?.name).toBe('SqliteDatabaseFileError');
  expect(error?.code).toBe(code);
  expect(error?.filename).toBe(filename);
}

/** A real `ERR_DLOPEN_FAILED`: Node asked to load, as an addon, a file that is not one. */
function realDlopenFailure(): Error {
  const notAnAddon = join(dir, 'not-an-addon.node');
  writeFileSync(notAnAddon, 'x');
  try {
    process.dlopen({ exports: {} }, notAnAddon);
  } catch (error) {
    return error as Error;
  }
  throw new Error('process.dlopen loaded a file that is not an addon');
}

/**
 * The real error `better-sqlite3` throws when its addon was never built. Its
 * 13.x loader (`lib/binding.js`) takes no helper package: with no prebuilt
 * binary for the platform it `require()`s `build/Release/better_sqlite3.node`
 * under its own module root, and Node answers `MODULE_NOT_FOUND`. Produced
 * here by that same require, made from the installed package, against a
 * module root that was never built.
 */
function realNotBuiltFailure(): Error {
  const fromHere = createRequire(import.meta.url);
  const fromDriver = createRequire(fromHere.resolve('@objectstack/driver-sql'));
  const betterSqlite3 = fromDriver.resolve('better-sqlite3/package.json');
  const neverBuilt = join(dir, 'never-built', 'build', 'Release', 'better_sqlite3.node');
  try {
    createRequire(betterSqlite3)(neverBuilt);
  } catch (error) {
    return error as Error;
  }
  throw new Error('required an addon that was never built');
}

/**
 * Make the native addon fail to load with `error`, where `better-sqlite3`
 * loads it: the knex better-sqlite3 client's `acquireRawConnection`, which runs
 * `new Database(file)`. The method is the client class's own, and wasm SQLite's
 * client is another class, so the wasm rung is untouched.
 */
async function failNativeAddonLoad(error: Error): Promise<void> {
  const probe = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
  const clientProto = Object.getPrototypeOf((probe as any).knex.client);
  await probe.disconnect();
  expect(Object.prototype.hasOwnProperty.call(clientProto, 'acquireRawConnection')).toBe(true);
  vi.spyOn(clientProto, 'acquireRawConnection').mockRejectedValue(error);
}

describe('resolveSqliteDriver in development: a file that cannot be opened or created is not stepped down (#24950)', () => {
  it('a path under a regular file rejects with the driver\'s refusal, never wasm or memory', async () => {
    const warn = vi.fn();
    const at = join(dir, 'plain', 'archive.db');
    expectFileRefusal(await rejectionOf(resolveDev(at, warn)), at, 'EEXIST');

    const through = join(dir, 'plain', 'sub', 'archive.db');
    expectFileRefusal(await rejectionOf(resolveDev(through, warn)), through, 'ENOTDIR');

    expect(warn).not.toHaveBeenCalled();
  });

  it('a directory where the file should be rejects with SQLITE_CANTOPEN', async () => {
    const filename = join(dir, 'is-a-directory.db');
    mkdirSync(filename);
    const warn = vi.fn();
    expectFileRefusal(await rejectionOf(resolveDev(filename, warn)), filename, 'SQLITE_CANTOPEN');
    expect(warn).not.toHaveBeenCalled();
  });

  it('an absent file in a directory that exists still opens native, and is created', async () => {
    const filename = join(dir, 'fresh.db');
    const warn = vi.fn();
    const resolved = await resolveDev(filename, warn);
    expect(resolved.engine).toBe('better-sqlite3');
    expect(await resolved.driver.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    expect(existsSync(filename)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an absent file whose parent directories are missing still opens native: connect() makes them', async () => {
    const filename = join(dir, 'new', 'deeper', 'fresh.db');
    const resolved = await resolveDev(filename);
    expect(resolved.engine).toBe('better-sqlite3');
    expect(existsSync(filename)).toBe(true);
  });
});

describe('resolveSqliteDriver in development: a native addon that cannot load still steps down to wasm (#2229)', () => {
  it('an ABI mismatch (ERR_DLOPEN_FAILED) steps down to wasm SQLite, with the warning', async () => {
    const loadError = realDlopenFailure();
    expect((loadError as any).code).toBe('ERR_DLOPEN_FAILED');
    await failNativeAddonLoad(loadError);

    const warn = vi.fn();
    const filename = join(dir, 'dev.db');
    const resolved = await resolveDev(filename, warn);
    expect(resolved.engine).toBe('sqlite-wasm');
    expect(warn).toHaveBeenCalledWith(NATIVE_SQLITE_WASM_FALLBACK_WARNING);
    expect(await resolved.driver.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });

  it('an addon that was never built (MODULE_NOT_FOUND) steps down to wasm SQLite', async () => {
    const loadError = realNotBuiltFailure();
    expect((loadError as any).code).toBe('MODULE_NOT_FOUND');
    await failNativeAddonLoad(loadError);

    const resolved = await resolveDev(join(dir, 'dev.db'));
    expect(resolved.engine).toBe('sqlite-wasm');
  });

  it('an addon that cannot load AND a path under a regular file still rejects, never memory', async () => {
    // connect() makes the file's directory before the first statement loads
    // the addon, so the native rung refuses the path before the load fails.
    await failNativeAddonLoad(realDlopenFailure());

    const warn = vi.fn();
    const at = join(dir, 'plain', 'archive.db');
    expectFileRefusal(await rejectionOf(resolveDev(at, warn)), at, 'EEXIST');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('resolveSqliteDriver in production: unchanged', () => {
  it('a path under a regular file returns native unprobed; its connect() refuses the file', async () => {
    const warn = vi.fn();
    const at = join(dir, 'plain', 'archive.db');
    const resolved = await resolveSqliteDriver({ filename: at, dev: false, warn });
    opened.push(resolved);
    expect(resolved.engine).toBe('better-sqlite3');
    expect(warn).not.toHaveBeenCalled();
    let refusal: unknown;
    await resolved.driver.connect().catch((e: unknown) => { refusal = e; });
    expectFileRefusal(refusal, at, 'EEXIST');
  });
});

describe('DatasourceConnectionService in development: a declared SQLite datasource on an unopenable path (#24950)', () => {
  it('reports a failed connection state, and registers no driver', async () => {
    const registered: string[] = [];
    const engine = {
      registerDriver: (driver: { name?: string }) => { registered.push(String(driver?.name)); },
      getDriverByName: (name: string) => (registered.includes(name) ? {} : undefined),
    };
    const service = new DatasourceConnectionService({
      factory: () => createDefaultDatasourceDriverFactory({ dev: true }),
      engine: () => engine as any,
    });
    const filename = join(dir, 'plain', 'archive.db');

    await service.connectDeclared({
      datasources: [{ name: 'archive', driver: 'sqlite', config: { filename }, autoConnect: true }],
    });

    const state = service.getConnectionState('archive');
    expect(state?.availability).toBe('failed');
    expect(state?.reason).toContain(filename);
    expect(registered).toEqual([]);
  });
});
