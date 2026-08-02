// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteWasmDriver } from '../src/index.js';
import { statementMutatesDatabase } from './knex-wasm-dialect.js';

/**
 * #4518 — a mutation must mark the database dirty on EVERY execution branch.
 *
 * The dialect picks its execution branch from "does this statement return
 * rows", and `INSERT … RETURNING *` returns rows — so it ran down the branch
 * that never called `markDirty`. Since the final `on-disconnect` flush keys off
 * the same flag, nothing rescued it either: a file-backed database flushed its
 * schema at boot and then recorded nothing for the rest of its life. Every
 * table present, every row missing.
 *
 * That is not a corner case for this stack. ObjectQL writes through
 * `RETURNING *` because it hands the stored row back to the caller, so the
 * defect covered essentially all business data — which is why it surfaced as
 * "`bootStack({ databaseFile })` cannot cold-boot" rather than as a driver bug.
 *
 * These tests read the database back through a SECOND driver over the same
 * file, so they assert what is on disk rather than what the live WASM heap
 * still remembers.
 */
describe('SqliteWasmDriver persists mutations from every execution branch (#4518)', () => {
  const dirs: string[] = [];
  const drivers: SqliteWasmDriver[] = [];

  function newFile(): string {
    const dir = mkdtempSync(join(tmpdir(), 'wasm-returning-'));
    dirs.push(dir);
    return join(dir, 'db.sqlite');
  }

  function track(d: SqliteWasmDriver): SqliteWasmDriver {
    drivers.push(d);
    return d;
  }

  /** Reopen the on-disk image in a fresh driver — a cold read, in miniature. */
  async function readBack(file: string): Promise<Record<string, any>[]> {
    const reopened = track(new SqliteWasmDriver({ filename: file, persist: 'on-disconnect' }));
    return (reopened as any).knex('acct').orderBy('id');
  }

  afterEach(async () => {
    await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('classifies a statement by what it DOES, not by which branch executes it', () => {
    // The row-returning branch and the mutating set overlap; that overlap is
    // the whole defect, so it is pinned directly.
    expect(statementMutatesDatabase('insert into "acct" ("id") values (?) returning *', 'insert')).toBe(true);
    expect(statementMutatesDatabase('update "acct" set "name" = ? returning *', 'update')).toBe(true);
    expect(statementMutatesDatabase("INSERT INTO acct (id) VALUES ('x')")).toBe(true);
    expect(statementMutatesDatabase('DELETE FROM acct WHERE id = ?')).toBe(true);
    expect(statementMutatesDatabase('CREATE TABLE acct (id text)')).toBe(true);
    expect(statementMutatesDatabase('PRAGMA auto_vacuum = INCREMENTAL')).toBe(true);

    expect(statementMutatesDatabase('select * from "acct"', 'select')).toBe(false);
    expect(statementMutatesDatabase('PRAGMA table_info(acct)')).toBe(false);
    // Transaction control is owned by the transaction lifecycle, which must NOT
    // flush mid-transaction: sql.js `export()` closes and reopens the database,
    // aborting the open transaction (#1494).
    expect(statementMutatesDatabase('BEGIN')).toBe(false);
    expect(statementMutatesDatabase('COMMIT')).toBe(false);
    expect(statementMutatesDatabase('SAVEPOINT sp1')).toBe(false);
  });

  it('flushes an `INSERT … RETURNING` under on-write — the shape ObjectQL writes with', async () => {
    const file = newFile();
    const driver = track(new SqliteWasmDriver({ filename: file, persist: 'on-write' }));
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);

    const returned = await (driver as any)
      .knex('acct')
      .insert({ id: 'a1', name: 'returning-insert' })
      .returning('*');
    expect(returned.length).toBe(1);

    // `flush()` awaits the queued write; `on-write` schedules it fire-and-forget.
    await (driver as any).flush();

    const onDisk = await readBack(file);
    expect(onDisk.map((r) => r.id)).toEqual(['a1']);
    expect(onDisk[0].name).toBe('returning-insert');
  });

  it('flushes an `UPDATE … RETURNING` under on-write', async () => {
    const file = newFile();
    const driver = track(new SqliteWasmDriver({ filename: file, persist: 'on-write' }));
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);
    await (driver as any).knex('acct').insert({ id: 'a1', name: 'before' });
    await (driver as any).flush();

    await (driver as any).knex('acct').where('id', 'a1').update({ name: 'after' }).returning('*');
    await (driver as any).flush();

    expect((await readBack(file))[0].name).toBe('after');
  });

  it('flushes a raw mutation that carries no Knex `method`', async () => {
    const file = newFile();
    const driver = track(new SqliteWasmDriver({ filename: file, persist: 'on-write' }));
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);

    await (driver as any).knex.raw("INSERT INTO acct (id, name) VALUES ('r1', 'raw')");
    await (driver as any).flush();

    expect((await readBack(file)).map((r) => r.id)).toEqual(['r1']);
  });

  it('`on-disconnect` still saves RETURNING writes — disconnect() is the durability contract', async () => {
    // The second half of the same defect: the final flush is gated on the same
    // dirty flag, so an unmarked write was lost by BOTH persist strategies.
    // This is the invariant `bootStack({ databaseFile }).stop()` rests on.
    //
    // The explicit `flush()` after schema creation is what makes this test
    // DISCRIMINATING rather than incidentally green. Schema DDL did mark the
    // database dirty even before the fix, and under `on-disconnect` that flag
    // simply sat there until close — so the final export happened to carry the
    // unmarked row along with it. Clearing the flag first reproduces what
    // `on-write` did in production: every earlier flush reset it, and from then
    // on nothing set it again.
    const file = newFile();
    const driver = new SqliteWasmDriver({ filename: file, persist: 'on-disconnect' });
    drivers.push(driver);
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);
    await (driver as any).flush();

    await (driver as any).knex('acct').insert({ id: 'd1', name: 'durable' }).returning('*');

    await driver.disconnect();

    const onDisk = await readBack(file);
    expect(onDisk.map((r) => r.id)).toEqual(['d1']);
    expect(onDisk[0].name).toBe('durable');
  });

  it('persists RETURNING writes committed inside a transaction (no mid-transaction export)', async () => {
    const file = newFile();
    const driver = track(new SqliteWasmDriver({ filename: file, persist: 'on-write' }));
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);
    const knex = (driver as any).knex;

    await knex.transaction(async (trx: any) => {
      await trx('acct').insert({ id: 't1', name: 'in-tx' }).returning('*');
      await trx('acct').where('id', 't1').first();
      await trx('acct').insert({ id: 't2', name: 'in-tx-2' }).returning('*');
    });
    await (driver as any).flush();

    expect((await readBack(file)).map((r) => r.id)).toEqual(['t1', 't2']);
  });
});
