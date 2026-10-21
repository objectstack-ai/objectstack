// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sqliteAbsentFile` — the driver's open-mode contract (#6743).
 *
 * The defect this closes lived one layer below every dry-run guard the CLI had
 * already built: `os migrate plan` deferred its DDL (#3917) and suppressed its
 * seed, and still created a 0-table database, because SQLite brings the file
 * into existence at OPEN — for this driver, at the `PRAGMA auto_vacuum` that
 * `connect()` issues first.
 *
 * The judgement lives here rather than in the CLI on purpose. A caller-side
 * `existsSync` would be a second opinion about the driver's own open
 * semantics, free to drift from it; the driver is the only place that knows
 * what it is about to open.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync, chmodSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver, resolveSqliteAbsentFileTarget } from './index.js';

describe('resolveSqliteAbsentFileTarget — the one absent-file judgement (#6743)', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'os-absent-')); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('redirects a missing file to :memory: only under empty-in-memory', () => {
    const missing = join(dir, 'nope.db');

    expect(resolveSqliteAbsentFileTarget(missing, 'empty-in-memory'))
      .toEqual({ filename: ':memory:', openedEmptyInMemory: true });
    // Default and explicit 'create' are the same answer: SQLite's own.
    expect(resolveSqliteAbsentFileTarget(missing, 'create'))
      .toEqual({ filename: missing, openedEmptyInMemory: false });
    expect(resolveSqliteAbsentFileTarget(missing, undefined))
      .toEqual({ filename: missing, openedEmptyInMemory: false });
  });

  it('leaves an existing file alone — the mode is about creation, not access', () => {
    const present = join(dir, 'there.db');
    writeFileSync(present, '');
    expect(resolveSqliteAbsentFileTarget(present, 'empty-in-memory'))
      .toEqual({ filename: present, openedEmptyInMemory: false });
  });

  it('passes pseudo-filenames through untouched — they are already fileless', () => {
    for (const pseudo of [':memory:', ':other:']) {
      expect(resolveSqliteAbsentFileTarget(pseudo, 'empty-in-memory'))
        .toEqual({ filename: pseudo, openedEmptyInMemory: false });
    }
  });
});

describe('SqlDriver({ sqliteAbsentFile }) — opening must not create (#6743)', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'os-absent-drv-')); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const build = (filename: string, mode?: 'create' | 'empty-in-memory') =>
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      ...(mode ? { sqliteAbsentFile: mode } : {}),
    } as any);

  it('creates nothing on disk — not the file, not -wal, not -shm, not the directory', async () => {
    const dataDir = join(dir, 'data');
    const dbFile = join(dataDir, 'objectstack.db');
    const driver = build(dbFile, 'empty-in-memory');
    try {
      // `connect()` is where it used to happen: `ensureDatabaseExists()`
      // mkdir'd the directory and the first PRAGMA created the file.
      await driver.connect();
      // A real, usable connection — the report a plan renders is computed
      // against exactly this.
      const rows: any = await (driver as any).knex.raw(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      );
      expect(rows.filter((r: { name: string }) => !r.name.startsWith('sqlite_'))).toEqual([]);
      expect(driver.sqliteOpenedEmptyInMemory).toBe(true);
    } finally {
      await driver.disconnect();
    }

    expect(existsSync(dbFile)).toBe(false);
    expect(existsSync(`${dbFile}-wal`)).toBe(false);
    expect(existsSync(`${dbFile}-shm`)).toBe(false);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('keeps config naming the DECLARED target so the CLI can still print it', async () => {
    const dbFile = join(dir, 'data', 'objectstack.db');
    const driver = build(dbFile, 'empty-in-memory');
    try {
      await driver.connect();
      // `describeDriverConnection` renders this. Rewriting it to `:memory:`
      // would change `os migrate plan`'s "Database:" line, which the ruling on
      // #6743 explicitly refuses to pay for the hygiene fix.
      expect(((driver as any).config as any).connection.filename).toBe(dbFile);
    } finally {
      await driver.disconnect();
    }
  });

  it('opens an EXISTING file normally — the mode changes creation, not access', async () => {
    const dbFile = join(dir, 'existing.db');
    const seed = build(dbFile);
    await seed.connect();
    await (seed as any).knex.schema.createTable('kept', (t: any) => { t.string('id'); });
    await seed.disconnect();
    expect(existsSync(dbFile)).toBe(true);

    const driver = build(dbFile, 'empty-in-memory');
    try {
      await driver.connect();
      expect(driver.sqliteOpenedEmptyInMemory).toBe(false);
      const rows: any = await (driver as any).knex.raw(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      );
      expect(rows.map((r: { name: string }) => r.name)).toContain('kept');
    } finally {
      await driver.disconnect();
    }
  });

  it('without the option, the file is created — the behaviour every existing caller keeps', async () => {
    const dataDir = join(dir, 'default-mode');
    const dbFile = join(dataDir, 'objectstack.db');
    const driver = build(dbFile);
    try {
      await driver.connect();
      expect(driver.sqliteOpenedEmptyInMemory).toBe(false);
    } finally {
      await driver.disconnect();
    }
    expect(existsSync(dbFile)).toBe(true);
  });

  it('is inert for :memory: and for non-sqlite dialects', async () => {
    const mem = build(':memory:', 'empty-in-memory');
    try {
      await mem.connect();
      expect(mem.sqliteOpenedEmptyInMemory).toBe(false);
    } finally {
      await mem.disconnect();
    }

    // A pg config is never opened here; the point is only that the option is
    // stripped from what Knex receives rather than handed on as an option pg
    // has never heard of.
    const pg = new SqlDriver({
      client: 'pg',
      connection: { host: 'localhost', database: 'nope' },
      sqliteAbsentFile: 'empty-in-memory',
    } as any);
    expect(((pg as any).config as any).sqliteAbsentFile).toBeUndefined();
    expect(pg.sqliteOpenedEmptyInMemory).toBe(false);

    // A server dialect's connection STRING is a URL, not a filename (#24961):
    // it is never handed to the absent-file judgement, so it is neither
    // rewritten to `:memory:` nor walked on disk.
    const url = 'postgres://app@db.example:5432/main';
    const pgUrl = new SqlDriver({ client: 'pg', connection: url, sqliteAbsentFile: 'empty-in-memory' } as any);
    expect((pgUrl as any).knex.client.config.connection).toMatchObject({ connectionString: url });
    expect(pgUrl.sqliteOpenedEmptyInMemory).toBe(false);
    await pgUrl.disconnect();
  });

  it('a directory that already exists is not disturbed', async () => {
    const dataDir = join(dir, 'preexisting');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'unrelated.txt'), 'keep me');
    const driver = build(join(dataDir, 'objectstack.db'), 'empty-in-memory');
    try {
      await driver.connect();
    } finally {
      await driver.disconnect();
    }
    expect(readdirSync(dataDir)).toEqual(['unrelated.txt']);
  });
});

/**
 * An unopenable path is not an absent one (#24961).
 *
 * `existsSync` answers `false` for every path it cannot stat, so the judgement
 * used to read a path under a regular file as an absent file and open an empty
 * `:memory:` database over it: `os migrate plan` reported the datasource
 * connected and planned tables into a file that cannot exist, while the boot
 * that writes refused the same path. The judgement now refuses it, naming the
 * file and the operating system's answer — and still writes nothing to find
 * out.
 */
describe('resolveSqliteAbsentFileTarget — a file that can be neither opened nor created is refused (#24961)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-24961-'));
    writeFileSync(join(dir, 'plain'), 'a regular file, not a directory');
  });
  afterEach(() => {
    try { chmodSync(join(dir, 'locked'), 0o755); } catch { /* not every case makes it */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /** What `fn` threw; a failure naming its answer when it threw nothing. */
  function thrownBy(fn: () => unknown): any {
    let answer: unknown;
    try {
      answer = fn();
    } catch (error) {
      return error;
    }
    throw new Error(`answered ${JSON.stringify(answer)} for a file that can be neither opened nor created`);
  }

  /** The driver's refusal of the file: its own error name, the system's code, and the file. */
  function expectFileRefusal(error: any, filename: string, code: string): void {
    expect(error?.name).toBe('SqliteDatabaseFileError');
    expect(error?.code).toBe(code);
    expect(error?.filename).toBe(filename);
  }

  it('refuses a path under a regular file with ENOTDIR, at either depth, and writes nothing', () => {
    const before = readdirSync(dir).sort();

    const at = join(dir, 'plain', 'archive.db');
    expectFileRefusal(thrownBy(() => resolveSqliteAbsentFileTarget(at, 'empty-in-memory')), at, 'ENOTDIR');
    const through = join(dir, 'plain', 'sub', 'archive.db');
    expectFileRefusal(thrownBy(() => resolveSqliteAbsentFileTarget(through, 'empty-in-memory')), through, 'ENOTDIR');

    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it('refuses a directory whose name a dangling symbolic link holds, and leaves the link dangling', () => {
    const link = join(dir, 'link');
    symlinkSync(join(dir, 'nowhere'), link);

    const filename = join(link, 'archive.db');
    expectFileRefusal(thrownBy(() => resolveSqliteAbsentFileTarget(filename, 'empty-in-memory')), filename, 'ENOENT');

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, 'nowhere'))).toBe(false);
  });

  // Permission is judged as the process holds it, so the case splits on who
  // runs it: a superuser may create in a 0555 directory, and the writing boot
  // does — so for it the absent answer is the consistent one.
  const superuser = typeof process.getuid === 'function' && process.getuid() === 0;

  it.skipIf(superuser)('refuses an absent file in a directory this process may not write, with EACCES', () => {
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o555);

    const filename = join(locked, 'archive.db');
    expectFileRefusal(thrownBy(() => resolveSqliteAbsentFileTarget(filename, 'empty-in-memory')), filename, 'EACCES');
    const deeper = join(locked, 'sub', 'archive.db');
    expectFileRefusal(thrownBy(() => resolveSqliteAbsentFileTarget(deeper, 'empty-in-memory')), deeper, 'EACCES');

    expect(readdirSync(locked)).toEqual([]);
  });

  it.runIf(superuser)('as the superuser, an absent file in a 0555 directory is absent: the writing boot can create it', () => {
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o555);

    expect(resolveSqliteAbsentFileTarget(join(locked, 'archive.db'), 'empty-in-memory'))
      .toEqual({ filename: ':memory:', openedEmptyInMemory: true });
    expect(readdirSync(locked)).toEqual([]);
  });

  it('CONTROL: an absent file in a directory that exists, or can be made, is still absent and writes nothing', () => {
    const before = readdirSync(dir).sort();
    expect(resolveSqliteAbsentFileTarget(join(dir, 'fresh.db'), 'empty-in-memory'))
      .toEqual({ filename: ':memory:', openedEmptyInMemory: true });
    expect(resolveSqliteAbsentFileTarget(join(dir, 'new', 'deeper', 'fresh.db'), 'empty-in-memory'))
      .toEqual({ filename: ':memory:', openedEmptyInMemory: true });
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it('only empty-in-memory asks: the default mode hands the path on for connect() to refuse', () => {
    const at = join(dir, 'plain', 'archive.db');
    expect(resolveSqliteAbsentFileTarget(at, 'create')).toEqual({ filename: at, openedEmptyInMemory: false });
    expect(resolveSqliteAbsentFileTarget(at, undefined)).toEqual({ filename: at, openedEmptyInMemory: false });
  });

  it('SqlDriver under empty-in-memory refuses at construction with the same error the writing boot\'s connect() names the file with', async () => {
    const before = readdirSync(dir).sort();
    const at = join(dir, 'plain', 'archive.db');
    const build = (mode?: 'empty-in-memory') =>
      new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: at },
        useNullAsDefault: true,
        ...(mode ? { sqliteAbsentFile: mode } : {}),
      } as any);

    // The read-only boot: no driver over a file that cannot exist.
    expectFileRefusal(thrownBy(() => build('empty-in-memory')), at, 'ENOTDIR');

    // The boot that may write, over the same path: its connect() refuses it,
    // as it did before (#23696) — so the two boots now agree.
    const writing = build();
    let refusal: unknown;
    try {
      await writing.connect().catch((e: unknown) => { refusal = e; });
    } finally {
      await writing.disconnect();
    }
    expect((refusal as any)?.name).toBe('SqliteDatabaseFileError');
    expect((refusal as any)?.filename).toBe(at);

    expect(readdirSync(dir).sort()).toEqual(before);
  });
});
