// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The read-only boot reports a declared SQLite datasource whose file can be
 * neither opened nor created as FAILED, as the boot that writes does (#24961).
 *
 * `os migrate plan` composes its declared datasources through
 * `createDefaultDatasourceDriverFactory({ sqliteAbsentFile: 'empty-in-memory' })`
 * (`DeclaredDatasourceConnectionPlugin`). Before, driver-sql's absent-file
 * judgement asked `existsSync`, which answers `false` for a path under a
 * regular file, so the boot opened an empty in-memory database over it:
 * `datasource 'archive': connected`, and the plan proposed `create_table` into
 * a file that cannot exist. The judgement now refuses the file, and the
 * refusal reaches the connection service as the boot's connect failure.
 *
 * Both rungs of `resolveSqliteDriver` take the judgement from the driver: the
 * native driver's constructor applies it, and the wasm rung resolves its
 * filename through the same exported `resolveSqliteAbsentFileTarget`. So the
 * cases below are asked of the native rung, of the wasm rung (an addon that
 * cannot load, faked where `better-sqlite3` loads it, as
 * `sqlite-driver-fallback-file-open-failure.test.ts` does), and of production.
 *
 * Real `better-sqlite3`, real wasm SQLite, real files in a scratch directory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveSqliteDriver, type ResolvedSqliteDriver } from '../sqlite-driver-fallback.js';
import { DatasourceConnectionService } from '../datasource-connection-service.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

let dir: string;
const opened: ResolvedSqliteDriver[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-24961-'));
  writeFileSync(join(dir, 'plain'), 'a regular file, not a directory');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((r) => r.driver?.disconnect?.().catch(() => {})));
  rmSync(dir, { recursive: true, force: true });
});

/** Every name in the scratch directory: what "nothing was written" is judged against. */
function listing(): string[] {
  return readdirSync(dir).sort();
}

async function resolveReadOnly(filename: string, dev: boolean, warn = vi.fn()): Promise<ResolvedSqliteDriver> {
  const resolved = await resolveSqliteDriver({ filename, dev, warn, sqliteAbsentFile: 'empty-in-memory' });
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
  throw new Error(`resolved to engine '${resolved.engine}' for a file that can be neither opened nor created`);
}

/** The driver's refusal of the file: its own error name, the system's code, and the file. */
function expectFileRefusal(error: any, filename: string, code: string): void {
  expect(error?.name).toBe('SqliteDatabaseFileError');
  expect(error?.code).toBe(code);
  expect(error?.filename).toBe(filename);
}

/** A real `ERR_DLOPEN_FAILED`: Node asked to load, as an addon, a file that is not one. */
function realDlopenFailure(): Error {
  const scratch = mkdtempSync(join(tmpdir(), 'os-24961-addon-'));
  const notAnAddon = join(scratch, 'not-an-addon.node');
  writeFileSync(notAnAddon, 'x');
  try {
    process.dlopen({ exports: {} }, notAnAddon);
  } catch (error) {
    return error as Error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  throw new Error('process.dlopen loaded a file that is not an addon');
}

/**
 * Make the native addon fail to load where `better-sqlite3` loads it: the knex
 * better-sqlite3 client's `acquireRawConnection`. Wasm SQLite's client is
 * another class, so the wasm rung is untouched.
 */
async function failNativeAddonLoad(): Promise<void> {
  const error = realDlopenFailure();
  expect((error as any).code).toBe('ERR_DLOPEN_FAILED');
  const probe = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
  const clientProto = Object.getPrototypeOf((probe as any).knex.client);
  await probe.disconnect();
  expect(Object.prototype.hasOwnProperty.call(clientProto, 'acquireRawConnection')).toBe(true);
  vi.spyOn(clientProto, 'acquireRawConnection').mockRejectedValue(error);
}

describe('resolveSqliteDriver under empty-in-memory: a path under a regular file is refused, on every rung (#24961)', () => {
  it('development, native rung: rejects with the driver\'s refusal, never an engine, and writes nothing', async () => {
    const before = listing();
    const warn = vi.fn();
    const at = join(dir, 'plain', 'archive.db');
    expectFileRefusal(await rejectionOf(resolveReadOnly(at, true, warn)), at, 'ENOTDIR');
    const through = join(dir, 'plain', 'sub', 'archive.db');
    expectFileRefusal(await rejectionOf(resolveReadOnly(through, true, warn)), through, 'ENOTDIR');
    expect(warn).not.toHaveBeenCalled();
    expect(listing()).toEqual(before);
  });

  it('development, wasm rung (the addon cannot load): the same refusal, never wasm or memory', async () => {
    await failNativeAddonLoad();
    const before = listing();
    const warn = vi.fn();
    const at = join(dir, 'plain', 'archive.db');
    expectFileRefusal(await rejectionOf(resolveReadOnly(at, true, warn)), at, 'ENOTDIR');
    expect(warn).not.toHaveBeenCalled();
    expect(listing()).toEqual(before);
  });

  it('production: the same refusal — the unprobed native driver is never built over the file', async () => {
    const before = listing();
    const at = join(dir, 'plain', 'archive.db');
    expectFileRefusal(await rejectionOf(resolveReadOnly(at, false)), at, 'ENOTDIR');
    expect(listing()).toEqual(before);
  });
});

describe('resolveSqliteDriver under empty-in-memory: an absent file that can be created still opens empty in memory (#6743)', () => {
  it('development, native rung: an empty in-memory database, and nothing on disk', async () => {
    const before = listing();
    for (const filename of [join(dir, 'fresh.db'), join(dir, 'new', 'deeper', 'fresh.db')]) {
      const resolved = await resolveReadOnly(filename, true);
      expect(resolved.engine).toBe('better-sqlite3');
      expect(resolved.driver.sqliteOpenedEmptyInMemory).toBe(true);
      expect(await resolved.driver.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    }
    expect(listing()).toEqual(before);
  });

  it('development, wasm rung (the addon cannot load): wasm opens :memory:, and nothing on disk', async () => {
    await failNativeAddonLoad();
    const before = listing();
    const resolved = await resolveReadOnly(join(dir, 'new', 'deeper', 'fresh.db'), true);
    expect(resolved.engine).toBe('sqlite-wasm');
    expect(await resolved.driver.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    await resolved.driver.disconnect();
    expect(listing()).toEqual(before);
  });
});

describe('the read-only boot os migrate plan composes: a declared SQLite datasource under a regular file (#24961)', () => {
  it('its factory rejects with the driver\'s refusal — the value the connection service receives', async () => {
    const factory = createDefaultDatasourceDriverFactory({ dev: true, sqliteAbsentFile: 'empty-in-memory' });
    const filename = join(dir, 'plain', 'archive.db');
    let refusal: unknown;
    try {
      const handle = await factory.create({ name: 'archive', driver: 'sqlite', config: { filename } } as any);
      opened.push({ driver: handle.driver ?? handle } as any);
    } catch (e) {
      refusal = e;
    }
    expectFileRefusal(refusal, filename, 'ENOTDIR');
  });

  it.each([
    ['development', true],
    ['production', false],
  ] as const)('%s: the datasource reads failed, naming the file; no driver is registered; nothing is written', async (_label, dev) => {
    const registered: string[] = [];
    const engine = {
      registerDriver: (driver: { name?: string }) => { registered.push(String(driver?.name)); },
      getDriverByName: (name: string) => (registered.includes(name) ? {} : undefined),
    };
    const service = new DatasourceConnectionService({
      factory: () => createDefaultDatasourceDriverFactory({ dev, sqliteAbsentFile: 'empty-in-memory' }),
      engine: () => engine as any,
    });
    const filename = join(dir, 'plain', 'archive.db');
    const before = listing();

    await service.connectDeclared({
      datasources: [{ name: 'archive', driver: 'sqlite', config: { filename }, autoConnect: true }],
    });

    const state = service.getConnectionState('archive');
    expect(state?.availability).toBe('failed');
    expect(state?.reason).toContain(filename);
    // Nothing a plan could be computed against: no driver under the name.
    expect(registered).toEqual([]);
    expect(listing()).toEqual(before);
  });
});
