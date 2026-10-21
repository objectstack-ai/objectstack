// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The last members of the SQLite file-failure family: a declared SQLite file
 * the datasource cannot use is classified by its own driver at connect, naming
 * the file, and nothing is written (#25019).
 *
 *   - A SQLite database whose header or schema SQLite cannot read (a file
 *     truncated inside its 100-byte header, or short of the pages its schema
 *     names). The connection's first statement, `PRAGMA auto_vacuum`, answers
 *     `SQLITE_CORRUPT`, which `connect()` logged and swallowed: it resolved
 *     over a file no statement could read, and on a development boot the
 *     step-down then moved the file aside. `SQLITE_CANTOPEN` (#23696) and
 *     `SQLITE_NOTADB` (#24960) were already refused this way.
 *   - A dangling symbolic link as the file's directory, on the boot that
 *     writes. `makeDatabaseDirectory` took `mkdir`'s `EEXIST` on the link for
 *     a concurrent creator, `connect()` resolved, and the first statement
 *     failed with a code-less "directory does not exist". The read-only boot
 *     already refused the same path (#24961), so the two boots disagreed.
 *   - A dangling symbolic link as the file itself, on the read-only boot: it
 *     read the file absent although the directory the link points into does
 *     not exist, where the boot that writes refuses it with `SQLITE_CANTOPEN`.
 *
 * Every refusal is the driver's own, so the first one is pinned under both
 * `NODE_ENV` values.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync,
  truncateSync, writeSync, closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver, resolveSqliteAbsentFileTarget } from './index.js';
import { SqliteDatabaseFileError } from './sqlite-database-file.js';

const DANGLING_WORDS = (link: string) => `'${link}' is a symbolic link to a path that does not exist`;

const drivers: SqlDriver[] = [];
function make(filename: string): SqlDriver {
  const d = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true } as any);
  drivers.push(d);
  return d;
}

/** `connect()`'s rejection, or a failure saying it resolved. */
async function refusalOf(driver: SqlDriver): Promise<any> {
  try {
    await driver.connect();
  } catch (error) {
    return error;
  }
  throw new Error('connect() resolved for a file the datasource cannot use');
}

/** What `fn` threw; a failure naming its answer when it threw nothing. */
function thrownBy(fn: () => unknown): any {
  let answer: unknown;
  try {
    answer = fn();
  } catch (error) {
    return error;
  }
  throw new Error(`answered ${JSON.stringify(answer)} for a file that cannot be created`);
}

function expectFileRefusal(error: any, filename: string, code: string): void {
  expect(error).toBeInstanceOf(SqliteDatabaseFileError);
  expect(error.code).toBe(code);
  expect(error.filename).toBe(filename);
  expect(error.message).toContain(filename);
}

/** Every path under `root`, each with its kind, so a link, a file or a directory that appears is seen. */
function tree(root: string): string[] {
  return readdirSync(root, { recursive: true }).map(String).sort()
    .map((name) => `${name}:${lstatSync(join(root, name)).isSymbolicLink() ? 'link' : lstatSync(join(root, name)).isDirectory() ? 'dir' : 'file'}`);
}

/** A real SQLite database, written by this driver, holding one row in `t`. */
async function seedDatabase(filename: string): Promise<void> {
  const seed = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true } as any);
  await seed.connect();
  await seed.execute('CREATE TABLE t (a INTEGER)');
  await seed.execute('INSERT INTO t (a) VALUES (7)');
  await seed.disconnect();
}

/**
 * The refused file holds the bytes it was found with, and nothing is left
 * beside it: no `.corrupt-*` sibling, and nothing at all after `disconnect()`.
 * The header still says WAL (this driver's journal mode); the `-shm` and empty
 * `-wal` SQLite keeps while a connection is open are gone already when
 * `connect()` rejects, because the refusal closes its connection (#25084,
 * pinned in `sql-driver-25084-sqlite-refused-connect-release.test.ts`).
 */
async function expectLeftAsItWas(driver: SqlDriver, filename: string, before: Buffer): Promise<void> {
  expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toEqual([]);
  await driver.disconnect();
  expect(readFileSync(filename).equals(before)).toBe(true);
  expect(readdirSync(dir)).toEqual(['archive.db']);
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'os-25019-')); });
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
  rmSync(dir, { recursive: true, force: true });
});

describe('SqlDriver.connect — a declared SQLite file whose header or schema SQLite cannot read (#25019)', () => {
  for (const nodeEnv of ['development', 'production'] as const) {
    it(`refuses a database truncated inside its header with SQLITE_CORRUPT, naming it, and leaves its bytes untouched (NODE_ENV=${nodeEnv})`, async () => {
      const filename = join(dir, 'archive.db');
      await seedDatabase(filename);
      truncateSync(filename, 50);
      const before = readFileSync(filename);
      vi.stubEnv('NODE_ENV', nodeEnv);

      const driver = make(filename);
      const error = await refusalOf(driver);

      expectFileRefusal(error, filename, 'SQLITE_CORRUPT');
      expect(error.message).toContain((error.cause as Error).message);
      await expectLeftAsItWas(driver, filename, before);
    });
  }

  it('refuses a database cut short of the pages its schema names, the same way', async () => {
    const filename = join(dir, 'archive.db');
    await seedDatabase(filename);
    truncateSync(filename, 4096);
    const before = readFileSync(filename);

    const driver = make(filename);
    expectFileRefusal(await refusalOf(driver), filename, 'SQLITE_CORRUPT');
    await expectLeftAsItWas(driver, filename, before);
  });

  it('CONTROL: a database damaged deeper inside still connects, and the read that reaches the damage fails', async () => {
    // The refusal is the FIRST statement's verdict, never an integrity check:
    // here the header and schema read, and one table's page does not.
    const filename = join(dir, 'archive.db');
    await seedDatabase(filename);
    const probe = make(filename);
    await probe.connect();
    const [{ rootpage }] = (await probe.execute("SELECT rootpage FROM sqlite_master WHERE name = 't'")) as Array<{ rootpage: number }>;
    const [{ page_size: pageSize }] = (await probe.execute('PRAGMA page_size')) as Array<{ page_size: number }>;
    await probe.disconnect();
    const fd = openSync(filename, 'r+');
    writeSync(fd, Buffer.alloc(pageSize, 0xab), 0, pageSize, (rootpage - 1) * pageSize);
    closeSync(fd);

    const driver = make(filename);
    await driver.connect();
    const failure = await driver.execute('SELECT a FROM t').then(
      () => { throw new Error('a read of the damaged page answered'); },
      (error: any) => error,
    );
    expect(failure?.cause?.code).toBe('SQLITE_CORRUPT');
  });
});

describe('SqlDriver.connect — a dangling symbolic link as the directory, on the boot that writes (#25019)', () => {
  it('refuses it with the read-only boot\'s code, naming the file and the link, and creates nothing through it', async () => {
    const link = join(dir, 'link');
    symlinkSync(join(dir, 'nowhere'), link);
    const filename = join(link, 'archive.db');
    const before = tree(dir);

    const writing = await refusalOf(make(filename));
    expectFileRefusal(writing, filename, 'ENOENT');
    expect(writing.message).toContain(DANGLING_WORDS(link));

    // The read-only boot over the same path answers with the same error class,
    // code, file and words (#24961).
    const readOnly = thrownBy(() => resolveSqliteAbsentFileTarget(filename, 'empty-in-memory'));
    expectFileRefusal(readOnly, filename, 'ENOENT');
    expect(readOnly.message).toContain(DANGLING_WORDS(link));

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, 'nowhere'))).toBe(false);
    expect(tree(dir)).toEqual(before);
  });

  it('refuses a deeper path under the link the same way, naming the link', async () => {
    const link = join(dir, 'link');
    symlinkSync(join(dir, 'nowhere'), link);
    const filename = join(link, 'sub', 'archive.db');
    const before = tree(dir);

    const writing = await refusalOf(make(filename));
    expectFileRefusal(writing, filename, 'ENOENT');
    expect(writing.message).toContain(DANGLING_WORDS(link));
    expect(tree(dir)).toEqual(before);
  });

  it('CONTROL: a directory that is a link to an existing directory connects, and the file is created in it', async () => {
    mkdirSync(join(dir, 'real'));
    symlinkSync(join(dir, 'real'), join(dir, 'link'));
    const driver = make(join(dir, 'link', 'archive.db'));
    await driver.connect();
    expect(await driver.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    expect(readdirSync(join(dir, 'real'))).toContain('archive.db');
  });

  it('CONTROL: an absent file under directories that can be made connects, and both are created', async () => {
    const filename = join(dir, 'new', 'deeper', 'archive.db');
    const driver = make(filename);
    await driver.connect();
    expect(await driver.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    expect(existsSync(filename)).toBe(true);
  });
});

describe('a dangling symbolic link as the database file itself (#25019)', () => {
  it('the read-only boot refuses it when the directory the chain of links ends in does not exist, as the writing boot does', async () => {
    const target = join(dir, 'missing', 'target.db');
    const direct = join(dir, 'archive.db');
    symlinkSync(target, direct);
    // The same end, reached through a second link.
    symlinkSync(target, join(dir, 'hop.db'));
    const chained = join(dir, 'chained.db');
    symlinkSync(join(dir, 'hop.db'), chained);
    const before = tree(dir);

    for (const filename of [direct, chained]) {
      const readOnly = thrownBy(() => resolveSqliteAbsentFileTarget(filename, 'empty-in-memory'));
      expectFileRefusal(readOnly, filename, 'ENOENT');
      expect(readOnly.message).toContain(target);

      // The writing boot refuses the same path with SQLite's own answer.
      expectFileRefusal(await refusalOf(make(filename)), filename, 'SQLITE_CANTOPEN');
    }
    expect(tree(dir)).toEqual(before);
  });

  it('CONTROL: when that directory exists, the read-only boot reads it absent and writes nothing, and the writing boot creates the file through the link', async () => {
    symlinkSync(join(dir, 'target.db'), join(dir, 'archive.db'));
    // A relative target is read from the link's own directory.
    symlinkSync('relative-target.db', join(dir, 'relative.db'));
    const before = tree(dir);

    for (const name of ['archive.db', 'relative.db']) {
      expect(resolveSqliteAbsentFileTarget(join(dir, name), 'empty-in-memory'))
        .toEqual({ filename: ':memory:', openedEmptyInMemory: true });
    }
    expect(tree(dir)).toEqual(before);

    for (const name of ['archive.db', 'relative.db']) {
      const driver = make(join(dir, name));
      await driver.connect();
      expect(await driver.execute('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    }
    expect(existsSync(join(dir, 'target.db'))).toBe(true);
    expect(existsSync(join(dir, 'relative-target.db'))).toBe(true);
  });
});
