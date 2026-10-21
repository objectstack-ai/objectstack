// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A declared SQLite datasource whose file SQLite cannot read, or whose
 * directory is a dangling symbolic link, is refused at connect, naming the
 * file, in development as in production. On a development boot nothing steps
 * down to wasm SQLite or the in-memory driver, so the operator's file is
 * neither renamed nor replaced, and no "native better-sqlite3 unavailable"
 * line blames the addon (#25019).
 *
 * Before, measured through `os migrate apply --yes` on the card:
 *   - a database truncated inside its header: `SqlDriver.connect()` swallowed
 *     the first statement's `SQLITE_CORRUPT`, the probe's `SELECT 1` failed as
 *     a `DATABASE_ERROR`, and the development step-down answered with wasm
 *     SQLite, whose open moved the file to `<file>.corrupt-<timestamp>` and
 *     wrote an empty database in its place; the datasource read `connected`;
 *   - a dangling link as the directory: `connect()` resolved, the probe failed
 *     with a code-less `TypeError`, and the step-down answered with wasm SQLite
 *     under the false native-addon warning, while the read-only boot refused
 *     the same path.
 *
 * Real `better-sqlite3`, real wasm SQLite and real files in a scratch
 * directory, as in `./sqlite-driver-fallback-file-open-failure.test.ts`, whose
 * load-failure seam the controls reuse.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
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

const DANGLING_WORDS = (link: string) => `'${link}' is a symbolic link to a path that does not exist`;

let dir: string;
const opened: ResolvedSqliteDriver[] = [];

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'os-25019-')); });

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(opened.splice(0).map((r) => r.driver?.disconnect?.().catch(() => {})));
  rmSync(dir, { recursive: true, force: true });
});

/** A real SQLite database, written by the native driver, holding one row in `t`. */
async function seedDatabase(filename: string): Promise<void> {
  const seed = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true } as any);
  await seed.connect();
  await seed.execute('CREATE TABLE t (a INTEGER)');
  await seed.execute('INSERT INTO t (a) VALUES (7)');
  await seed.disconnect();
}

/** A database this driver wrote, truncated inside its 100-byte header. Its bytes. */
async function headerTruncatedDatabase(filename: string): Promise<Buffer> {
  await seedDatabase(filename);
  truncateSync(filename, 50);
  return readFileSync(filename);
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
  throw new Error(`resolved to engine '${resolved.engine}' for a file the datasource cannot use`);
}

/** The driver's refusal of the file: its own error name, the code, and the file. */
function expectFileRefusal(error: any, filename: string, code: string): void {
  expect(error?.name).toBe('SqliteDatabaseFileError');
  expect(error?.code).toBe(code);
  expect(error?.filename).toBe(filename);
  expect(String(error?.message)).toContain(filename);
}

/** The bytes it was found with, and no `.corrupt-*` sibling: nothing moved it aside. */
function expectNotMovedAside(filename: string, bytes: Buffer): void {
  expect(readFileSync(filename).equals(bytes)).toBe(true);
  expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toEqual([]);
}

function connectionService(mode: 'development' | 'production', opts: { sqliteAbsentFile?: 'empty-in-memory' } = {}) {
  const registered: string[] = [];
  const engine = {
    registerDriver: (driver: { name?: string }) => { registered.push(String(driver?.name)); },
    getDriverByName: (name: string) => (registered.includes(name) ? {} : undefined),
  };
  const service = new DatasourceConnectionService({
    factory: () => createDefaultDatasourceDriverFactory({ dev: mode === 'development', ...opts }),
    engine: () => engine as any,
  });
  return { service, registered };
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

/** Make the native addon fail to load with `error`, where `better-sqlite3` loads it (the #24950 seam). */
async function failNativeAddonLoad(error: Error): Promise<void> {
  const probe = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
  const clientProto = Object.getPrototypeOf((probe as any).knex.client);
  await probe.disconnect();
  expect(Object.prototype.hasOwnProperty.call(clientProto, 'acquireRawConnection')).toBe(true);
  vi.spyOn(clientProto, 'acquireRawConnection').mockRejectedValue(error);
}

describe('a declared SQLite database whose header SQLite cannot read (#25019)', () => {
  it('development: resolveSqliteDriver rejects with the driver\'s SQLITE_CORRUPT refusal, never wasm or memory, and leaves the file as it was', async () => {
    const filename = join(dir, 'archive.db');
    const bytes = await headerTruncatedDatabase(filename);
    const warn = vi.fn();

    expectFileRefusal(await rejectionOf(resolveSqliteDriver({ filename, dev: true, warn })), filename, 'SQLITE_CORRUPT');

    expect(warn).not.toHaveBeenCalled();
    // The probe's connection was closed, so SQLite's WAL siblings are gone too.
    expect(readFileSync(filename).equals(bytes)).toBe(true);
    expect(readdirSync(dir)).toEqual(['archive.db']);
  });

  it('production: returns native unprobed, and its connect() refuses the file', async () => {
    const filename = join(dir, 'archive.db');
    const bytes = await headerTruncatedDatabase(filename);
    const warn = vi.fn();
    const resolved = await resolveSqliteDriver({ filename, dev: false, warn });
    opened.push(resolved);
    expect(resolved.engine).toBe('better-sqlite3');

    let refusal: unknown;
    await resolved.driver.connect().catch((e: unknown) => { refusal = e; });
    expectFileRefusal(refusal, filename, 'SQLITE_CORRUPT');
    expect(warn).not.toHaveBeenCalled();
    expectNotMovedAside(filename, bytes);
  });

  for (const mode of ['development', 'production'] as const) {
    it(`DatasourceConnectionService, ${mode}: reports the datasource failed naming the file, registers no driver, and moves nothing aside`, async () => {
      vi.stubEnv('NODE_ENV', mode);
      const filename = join(dir, 'archive.db');
      const bytes = await headerTruncatedDatabase(filename);
      const { service, registered } = connectionService(mode);

      await service.connectDeclared({
        datasources: [{ name: 'archive', driver: 'sqlite', config: { filename }, autoConnect: true }],
      });

      const state = service.getConnectionState('archive');
      expect(state?.availability).toBe('failed');
      expect(state?.reason).toContain(filename);
      expect(registered).toEqual([]);
      expectNotMovedAside(filename, bytes);
    });
  }
});

describe('a declared SQLite datasource whose directory is a dangling symbolic link, on the boot that writes (#25019)', () => {
  let link: string;
  let filename: string;
  beforeEach(() => {
    link = join(dir, 'link');
    symlinkSync(join(dir, 'nowhere'), link);
    filename = join(link, 'archive.db');
  });

  /** The link still dangles, and nothing was created through it. */
  function expectNothingCreated(): void {
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, 'nowhere'))).toBe(false);
    expect(readdirSync(dir)).toEqual(['link']);
  }

  it('development: resolveSqliteDriver rejects with the read-only boot\'s refusal, with no step-down and no native-addon warning', async () => {
    const warn = vi.fn();
    const writing = await rejectionOf(resolveSqliteDriver({ filename, dev: true, warn }));
    expectFileRefusal(writing, filename, 'ENOENT');
    expect(String(writing.message)).toContain(DANGLING_WORDS(link));
    expect(warn).not.toHaveBeenCalled();

    // The read-only boot over the same path (#24961): the same class, code, file and words.
    const readOnly = await rejectionOf(resolveSqliteDriver({ filename, dev: true, warn, sqliteAbsentFile: 'empty-in-memory' }));
    expectFileRefusal(readOnly, filename, 'ENOENT');
    expect(String(readOnly.message)).toContain(DANGLING_WORDS(link));

    expectNothingCreated();
  });

  for (const mode of ['development', 'production'] as const) {
    it(`DatasourceConnectionService, ${mode}: reports the datasource failed naming the file and the link, as the read-only boot does`, async () => {
      vi.stubEnv('NODE_ENV', mode);
      for (const opts of [{}, { sqliteAbsentFile: 'empty-in-memory' as const }]) {
        const { service, registered } = connectionService(mode, opts);
        await service.connectDeclared({
          datasources: [{ name: 'archive', driver: 'sqlite', config: { filename }, autoConnect: true }],
        });

        const state = service.getConnectionState('archive');
        expect(state?.availability).toBe('failed');
        expect(state?.reason).toContain(filename);
        expect(state?.reason).toContain(DANGLING_WORDS(link));
        expect(registered).toEqual([]);
      }
      expectNothingCreated();
    });
  }
});

describe('CONTROLS: what keeps today\'s behaviour (#25019)', () => {
  it('a real database opens native in development, and answers', async () => {
    const filename = join(dir, 'archive.db');
    await seedDatabase(filename);
    const warn = vi.fn();
    const resolved = await resolveSqliteDriver({ filename, dev: true, warn });
    opened.push(resolved);
    expect(resolved.engine).toBe('better-sqlite3');
    expect(await resolved.driver.execute('SELECT a FROM t')).toEqual([{ a: 7 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an absent file in a directory that can be made opens native in development, and is created', async () => {
    const filename = join(dir, 'new', 'archive.db');
    const resolved = await resolveSqliteDriver({ filename, dev: true, warn: vi.fn() });
    opened.push(resolved);
    expect(resolved.engine).toBe('better-sqlite3');
    expect(existsSync(filename)).toBe(true);
  });

  it('a native addon that cannot load, over a real database, still steps down to wasm SQLite, which reads the same rows', async () => {
    const filename = join(dir, 'archive.db');
    await seedDatabase(filename);
    await failNativeAddonLoad(realDlopenFailure());

    const warn = vi.fn();
    const resolved = await resolveSqliteDriver({ filename, dev: true, warn });
    opened.push(resolved);
    expect(resolved.engine).toBe('sqlite-wasm');
    expect(warn).toHaveBeenCalledWith(NATIVE_SQLITE_WASM_FALLBACK_WARNING);
    expect(await resolved.driver.execute('SELECT a FROM t')).toEqual([{ a: 7 }]);
    expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toEqual([]);
  });
});
