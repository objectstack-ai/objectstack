// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two doors that reached wasm SQLite's open over a file it cannot read now
 * refuse that file at connect, naming it, and leave it as it was found (#25019):
 *
 *   (a) a declared `sqlite` datasource on a development boot whose native addon
 *       cannot LOAD. The native rung never reads the file, so a file that is not
 *       a database, or a damaged one, reached the wasm rung;
 *   (b) a datasource declared `driver: 'sqlite-wasm'`, in development AND
 *       production.
 *
 * Before, measured on the card: wasm SQLite's open moved the file to
 * `<file>.corrupt-<timestamp>`, wrote an empty database in its place, and the
 * datasource read `available`. Now the refusal is wasm SQLite's own, with the
 * native driver's class, code and words, and `resolveSqliteDriver` re-throws it
 * instead of trying the in-memory rung.
 *
 * Real `better-sqlite3`, real wasm SQLite and real files in a scratch
 * directory. The load failure is a real `ERR_DLOPEN_FAILED` at the seam
 * `./sqlite-driver-fallback-damaged-file-and-dangling-link.test.ts` uses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  NATIVE_SQLITE_MEMORY_FALLBACK_WARNING,
  NATIVE_SQLITE_WASM_FALLBACK_WARNING,
  resolveSqliteDriver,
  type ResolvedSqliteDriver,
} from '../sqlite-driver-fallback.js';
import { DatasourceConnectionService } from '../datasource-connection-service.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

let dir: string;
const opened: ResolvedSqliteDriver[] = [];

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'os-25019-wasm-')); });

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

/** The two files wasm SQLite cannot read, each with the code both engines answer. */
const UNREADABLE = [
  {
    label: 'a plain-text file',
    code: 'SQLITE_NOTADB',
    write: async (filename: string) => { writeFileSync(filename, 'id,name\n1,not a database\n'.repeat(20)); },
  },
  {
    label: 'a database truncated inside its header',
    code: 'SQLITE_CORRUPT',
    write: async (filename: string) => { await seedDatabase(filename); truncateSync(filename, 50); },
  },
] as const;

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

/** The refusal: the driver's class and code, the file named, and how to move it aside. */
function expectFileRefusal(error: any, filename: string, code: string): void {
  expect(error?.name).toBe('SqliteDatabaseFileError');
  expect(error?.code).toBe(code);
  expect(error?.filename).toBe(filename);
  expect(String(error?.message)).toContain(`SQLite database file '${filename}'`);
  expect(String(error?.message)).toContain(`move the file aside yourself (mv '${filename}' '${filename}.unreadable')`);
}

/** The bytes it was found with, and nothing beside it: no `.corrupt-*` sibling, no empty database. */
function expectLeftAsFound(filename: string, bytes: Buffer): void {
  expect(readFileSync(filename).equals(bytes)).toBe(true);
  expect(readdirSync(dir)).toEqual(['archive.db']);
}

function connectionService(mode: 'development' | 'production') {
  const registered: string[] = [];
  const engine = {
    registerDriver: (driver: { name?: string }) => { registered.push(String(driver?.name)); },
    getDriverByName: (name: string) => (registered.includes(name) ? {} : undefined),
  };
  const service = new DatasourceConnectionService({
    factory: () => createDefaultDatasourceDriverFactory({ dev: mode === 'development' }),
    engine: () => engine as any,
  });
  return { service, registered };
}

/** A real `ERR_DLOPEN_FAILED`: Node asked to load, as an addon, a file that is not one. */
function realDlopenFailure(): Error {
  const notAnAddon = join(dir, '..', `${dir.split('/').pop()}-not-an-addon.node`);
  writeFileSync(notAnAddon, 'x');
  try {
    process.dlopen({ exports: {} }, notAnAddon);
  } catch (error) {
    return error as Error;
  } finally {
    rmSync(notAnAddon, { force: true });
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

describe('(a) a declared sqlite datasource whose native addon cannot load, over a file wasm SQLite cannot read (#25019)', () => {
  for (const file of UNREADABLE) {
    it(`${file.label}: resolveSqliteDriver rejects with wasm SQLite's ${file.code} refusal, never the in-memory rung, and leaves the file as it was`, async () => {
      const filename = join(dir, 'archive.db');
      await file.write(filename);
      const bytes = readFileSync(filename);
      await failNativeAddonLoad(realDlopenFailure());
      const warn = vi.fn();

      expectFileRefusal(await rejectionOf(resolveSqliteDriver({ filename, dev: true, warn })), filename, file.code);

      expect(warn).not.toHaveBeenCalledWith(NATIVE_SQLITE_WASM_FALLBACK_WARNING);
      expect(warn).not.toHaveBeenCalledWith(NATIVE_SQLITE_MEMORY_FALLBACK_WARNING);
      expectLeftAsFound(filename, bytes);
    });
  }

  it('DatasourceConnectionService, development: reports the datasource failed naming the file, registers no driver, and moves nothing aside', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const filename = join(dir, 'archive.db');
    writeFileSync(filename, 'not a database');
    const bytes = readFileSync(filename);
    await failNativeAddonLoad(realDlopenFailure());
    const { service, registered } = connectionService('development');

    await service.connectDeclared({
      datasources: [{ name: 'archive', driver: 'sqlite', config: { filename }, autoConnect: true }],
    });

    const state = service.getConnectionState('archive');
    expect(state?.availability).toBe('failed');
    expect(state?.reason).toContain(filename);
    expect(registered).toEqual([]);
    expectLeftAsFound(filename, bytes);
  });
});

describe('(b) a datasource declared driver: sqlite-wasm, over a file wasm SQLite cannot read (#25019)', () => {
  for (const mode of ['development', 'production'] as const) {
    for (const file of UNREADABLE) {
      it(`${mode}, ${file.label}: reports the datasource failed with ${file.code} naming the file, not available, and moves nothing aside`, async () => {
        vi.stubEnv('NODE_ENV', mode);
        const filename = join(dir, 'archive.db');
        await file.write(filename);
        const bytes = readFileSync(filename);
        const { service, registered } = connectionService(mode);

        await service.connectDeclared({
          datasources: [{ name: 'archive', driver: 'sqlite-wasm', config: { filename }, autoConnect: true }],
        });

        const state = service.getConnectionState('archive');
        expect(state?.availability).toBe('failed');
        expect(state?.reason).toContain(`SQLite database file '${filename}'`);
        expect(state?.reason).toContain(file.code === 'SQLITE_NOTADB' ? 'is not a SQLite database' : 'is damaged');
        expect(registered).toEqual([]);
        expectLeftAsFound(filename, bytes);
      });
    }
  }
});

describe('CONTROLS: what keeps today\'s behaviour (#25019)', () => {
  it('a native addon that cannot load, over an absent file, still steps down to wasm SQLite, which creates it', async () => {
    const filename = join(dir, 'new', 'archive.db');
    await failNativeAddonLoad(realDlopenFailure());
    const warn = vi.fn();
    const resolved = await resolveSqliteDriver({ filename, dev: true, warn });
    opened.push(resolved);
    expect(resolved.engine).toBe('sqlite-wasm');
    expect(warn).toHaveBeenCalledWith(NATIVE_SQLITE_WASM_FALLBACK_WARNING);
    await resolved.driver.execute('CREATE TABLE t (a INTEGER)');
    await resolved.driver.flush();
    expect(existsSync(filename)).toBe(true);
  });

  for (const mode of ['development', 'production'] as const) {
    it(`${mode}: a datasource declared driver: sqlite-wasm over a real database is available and reads its rows`, async () => {
      vi.stubEnv('NODE_ENV', mode);
      const filename = join(dir, 'archive.db');
      await seedDatabase(filename);
      const { service, registered } = connectionService(mode);

      await service.connectDeclared({
        datasources: [{ name: 'archive', driver: 'sqlite-wasm', config: { filename }, autoConnect: true }],
      });

      expect(service.getConnectionState('archive')?.availability).toBe('available');
      expect(registered.length).toBe(1);
      expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toEqual([]);
    });
  }
});
