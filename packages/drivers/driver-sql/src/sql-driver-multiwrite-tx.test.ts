// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression guard for the multi-write transaction deadlock (ADR-0034 / #1604):
// two successful writes inside one transaction must commit, not hang.

import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { SqlDriver } from '../src/index.js';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT: ${label} (deadlock)`)), ms)),
  ]);
}

describe('SqlDriver multi-write transaction (deadlock regression)', () => {
  let driver: SqlDriver | undefined;
  let file: string | undefined;

  afterEach(async () => {
    if (driver) await (driver as any).knex.destroy();
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
    driver = undefined;
    file = undefined;
  });

  async function setup() {
    file = path.join(os.tmpdir(), `os-txtest-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true } as any);
    const k = (driver as any).knex;
    await k.schema.createTable('t', (t: any) => {
      t.string('id').primary();
      t.string('name');
    });
    return k;
  }

  it('commits TWO writes in one transaction without hanging', async () => {
    const k = await setup();
    const trx = await driver!.beginTransaction();
    await withTimeout(driver!.create('t', { id: '1', name: 'A' }, { transaction: trx }), 6000, 'create #1');
    await withTimeout(driver!.create('t', { id: '2', name: 'B' }, { transaction: trx }), 6000, 'create #2');
    await withTimeout(driver!.commit(trx), 6000, 'commit');
    const rows = await k('t').select();
    expect(rows.map((r: any) => r.id).sort()).toEqual(['1', '2']);
  });

  it('rolls back all writes when the transaction is aborted', async () => {
    const k = await setup();
    const trx = await driver!.beginTransaction();
    await driver!.create('t', { id: '1', name: 'A' }, { transaction: trx });
    await driver!.create('t', { id: '2', name: 'B' }, { transaction: trx });
    await driver!.rollback(trx);
    const rows = await k('t').select();
    expect(rows.length).toBe(0);
  });
});
