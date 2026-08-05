// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteWasmDriver } from '../src/index.js';

/**
 * Regression for #1494: under `persist: 'on-write'`, a write issued inside a
 * Knex transaction triggers a fire-and-forget flush. sql.js's `export()`
 * closes and reopens the database (it has no in-place serialize), which rolls
 * back the open transaction — so the eventual `COMMIT` failed with
 * "cannot commit - no transaction is active".
 *
 * The driver must defer the flush until the transaction fully closes, so the
 * transaction commits cleanly and the data still lands on disk afterwards.
 */
describe('SqliteWasmDriver on-write persistence + transactions (#1494)', () => {
  const dirs: string[] = [];
  const drivers: SqliteWasmDriver[] = [];

  function newDriver(persist: 'on-write' | 'on-disconnect' = 'on-write') {
    const dir = mkdtempSync(join(tmpdir(), 'wasm-tx-'));
    const file = join(dir, 'test.db');
    const driver = new SqliteWasmDriver({ filename: file, persist });
    dirs.push(dir);
    drivers.push(driver);
    return { driver, dir, file };
  }

  afterEach(async () => {
    await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('commits a multi-statement transaction without aborting it via flush', async () => {
    const { driver } = newDriver('on-write');
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);
    const knex = (driver as any).knex;

    await knex.transaction(async (trx: any) => {
      // Plain insert (no RETURNING) takes the write path → markDirty → flush.
      await trx('acct').insert({ id: 'a1', name: 'A' });
      // An await inside the transaction gives the deferred flush a chance to
      // run its export() — which previously rolled the transaction back.
      await trx('acct').where('id', 'a1').first();
      await trx('acct').insert({ id: 'a2', name: 'B' });
    });

    expect((await knex('acct')).length).toBe(2);
  });

  it('persists committed rows to disk after the transaction closes', async () => {
    const { driver, file } = newDriver('on-write');
    await driver.initObjects([{ name: 'acct', fields: { name: { type: 'string' } } }]);
    const knex = (driver as any).knex;

    await knex.transaction(async (trx: any) => {
      await trx('acct').insert({ id: 'p1', name: 'persisted' });
    });
    // flush() awaits the post-commit write to disk (the per-write persist is
    // deferred until the transaction closes, then performed exactly once).
    await (driver as any).flush();

    expect(statSync(file).size).toBeGreaterThan(0);

    // Reopen from disk in a second driver to prove the row survived.
    const reopened = new SqliteWasmDriver({ filename: file, persist: 'on-disconnect' });
    drivers.push(reopened);
    const rows = await (reopened as any).knex('acct').where('id', 'p1');
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('persisted');
  });

  it('autonumber inserts (internal transaction) succeed under on-write', async () => {
    const { driver } = newDriver('on-write');
    await driver.initObjects([
      {
        name: 'acct',
        fields: {
          name: { type: 'string' },
          num: { type: 'autonumber', format: 'A-{0000}' },
        },
      },
    ]);

    // Each create runs getNextSequenceValue() in its own BEGIN…COMMIT, with a
    // non-RETURNING sequence write inside it — the exact shape that tripped.
    const out: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await driver.create('acct', { name: `R${i}` });
      out.push(r.num);
    }
    expect(out[0]).toBe('A-0001');
    expect(out[9]).toBe('A-0010');
    expect(new Set(out).size).toBe(10);
  });

  it('handles nested transactions (savepoints) without flushing mid-transaction', async () => {
    const { driver } = newDriver('on-write');
    await driver.initObjects([
      { name: 'acct', fields: { name: { type: 'string' } } },
      { name: 'log', fields: { msg: { type: 'string' } } },
    ]);
    const knex = (driver as any).knex;

    await knex.transaction(async (trx: any) => {
      await trx('acct').insert({ id: 'a1', name: 'A' });
      await trx.transaction(async (inner: any) => {
        await inner('log').insert({ id: 'l1', msg: 'nested' });
        await inner('log').where('id', 'l1').first();
      });
      await trx('acct').insert({ id: 'a2', name: 'B' });
    });

    expect((await knex('acct')).length).toBe(2);
    expect((await knex('log')).length).toBe(1);
  });
});
