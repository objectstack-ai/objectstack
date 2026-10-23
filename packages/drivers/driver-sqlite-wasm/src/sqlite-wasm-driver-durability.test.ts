// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteWasmDriver } from '../src/index.js';

/**
 * Durability + resilience regressions for the wasm SQLite driver — the dev
 * fallback used whenever native better-sqlite3 has an ABI mismatch.
 *
 *  1. Flushes must be ATOMIC. A non-atomic overwrite torn by a mid-write kill
 *     left "database disk image is malformed" on the next boot.
 *  2. An already-corrupt on-disk image is REFUSED at connect, naming the file,
 *     and left exactly as it was found (#25019). It used to self-heal: the open
 *     renamed it to `<file>.corrupt-<timestamp>` and booted on an empty
 *     database, which read as connected over an operator's file it replaced.
 *  3. `undefined` bindings must persist as SQL NULL rather than throwing sql.js's
 *     raw-string "Wrong API use : tried to bind a value of an unknown type".
 */
describe('SqliteWasmDriver durability & resilience', () => {
  const dirs: string[] = [];
  const drivers: SqliteWasmDriver[] = [];

  function newDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'wasm-dur-'));
    dirs.push(dir);
    return dir;
  }

  function track(d: SqliteWasmDriver): SqliteWasmDriver {
    drivers.push(d);
    return d;
  }

  afterEach(async () => {
    await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('writes the database file atomically (no leftover temp files)', async () => {
    const dir = newDir();
    const file = join(dir, 'atomic.db');
    const driver = track(new SqliteWasmDriver({ filename: file, persist: 'on-write' }));
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);

    await (driver as any).knex('acct').insert({ id: 'a1', name: 'A' });
    await (driver as any).flush();

    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(0);
    // The temp file used for the atomic rename must not survive a clean flush.
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);

    // The written file is a valid, re-readable SQLite image.
    const reopened = track(
      new SqliteWasmDriver({ filename: file, persist: 'on-disconnect' }),
    );
    const rows = await (reopened as any).knex('acct');
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('A');
  });

  it('refuses a corrupt database image at connect, naming the file, and leaves it as it was found', async () => {
    const dir = newDir();
    const file = join(dir, 'corrupt.db');
    // A file that starts with the SQLite magic header but is otherwise garbage:
    // sql.js opens it, then fails the first page read.
    const junk = Buffer.concat([
      Buffer.from('SQLite format 3\0', 'binary'),
      Buffer.alloc(4096, 0xab),
    ]);
    writeFileSync(file, junk);

    const warnings: string[] = [];
    const driver = track(
      new SqliteWasmDriver({
        filename: file,
        persist: 'on-write',
        logger: { warn: (m: string) => warnings.push(m) },
      }),
    );

    let refusal: any;
    await driver.connect().catch((e: unknown) => { refusal = e; });
    expect(refusal?.name).toBe('SqliteDatabaseFileError');
    expect(refusal?.code).toBe('SQLITE_NOTADB');
    expect(refusal?.filename).toBe(file);
    expect(String(refusal?.message)).toContain(`'${file}'`);
    // The prescription: the operator moves the file aside, since the open no longer does.
    expect(String(refusal?.message)).toContain(
      `move the file aside yourself (mv '${file}' '${file}.unreadable')`,
    );

    // Nothing renamed, nothing written beside it, the bytes untouched.
    expect(readdirSync(dir)).toEqual(['corrupt.db']);
    expect(readFileSync(file)).toEqual(junk);
    expect(warnings.some((w) => w.includes('Quarantined'))).toBe(false);
  });

  it('persists an undefined binding as SQL NULL instead of throwing', async () => {
    const driver = track(new SqliteWasmDriver({ filename: ':memory:' }));
    await driver.initObjects([
      { name: 'acct', fields: { name: { type: 'string' }, note: { type: 'string' } } },
    ]);
    const knex = (driver as any).knex;

    // A raw binding of `undefined` is exactly what tripped sql.js's binder.
    await expect(
      knex('acct').insert({ id: 'a1', name: 'A', note: undefined }),
    ).resolves.not.toThrow();

    const rows = await knex('acct').where('id', 'a1');
    expect(rows.length).toBe(1);
    expect(rows[0].note).toBeNull();
  });
});
