// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6943] The wasm face re-seeds on the batch and upsert paths too.
 *
 * `SqliteWasmDriver extends SqlDriver` and overrides neither `bulkCreate` nor
 * `upsert`, so the re-seed is inherited. What this pins is that the inheritance
 * actually DELIVERS it: this driver swaps knex's transport for a custom sql.js
 * dialect, and the collision path depends on three things surviving that swap —
 * the refused INSERT still throwing an error `isUniqueViolationError`
 * recognises, the probe read (`autoNumberValueExists`) seeing the row that
 * caused the refusal, and — new on the batch path — a multi-row
 * `insert(rows[])` still failing as ONE statement, which is what makes
 * re-issuing the whole batch safe rather than duplicating rows.
 *
 * "It inherits the base class, therefore it is fine" is the assumption #4405
 * and #5240 exist to disprove on this driver, and #6203 is the shape where one
 * fix landed on one face and left the other answering differently. So the
 * fourth backend is verified rather than assumed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteWasmDriver } from './index.js';

describe('[#6943] driver-sqlite-wasm inherits the batch/upsert autonumber re-seed', () => {
  let driver: SqliteWasmDriver;

  const knex = () => (driver as any).knex;

  const bypassInsert = async (from: number, to: number) => {
    const rows = [];
    for (let n = from; n <= to; n++) {
      rows.push({ id: `s${n}`, organization_id: 'orgA', case_number: `CASE-${String(n).padStart(5, '0')}`, title: `seed ${n}` });
    }
    await knex()('crm_case').insert(rows);
  };

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: 'crm_case',
        fields: {
          organization_id: { type: 'string' },
          case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
          title: { type: 'string' },
        },
      } as any,
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('bulkCreate serves a batch that a stale counter used to fail outright', async () => {
    await driver.create('crm_case', { organization_id: 'orgA', title: 'warm' });
    await bypassInsert(2, 30);

    const created = await driver.bulkCreate('crm_case', [
      { organization_id: 'orgA', title: 'b1' },
      { organization_id: 'orgA', title: 'b2' },
    ]);

    expect(created.map((r: any) => r.case_number)).toEqual(['CASE-00031', 'CASE-00032']);
    // Nothing was left behind by the failed first pass — the batch is one
    // statement on this transport too.
    const all = (await knex()('crm_case').select('case_number')).map((r: any) => r.case_number);
    expect(new Set(all).size).toBe(all.length);
  });

  it('upsert serves the insert a stale counter used to refuse', async () => {
    await driver.create('crm_case', { organization_id: 'orgA', title: 'warm' });
    await bypassInsert(2, 30);

    const upserted = await driver.upsert('crm_case', { organization_id: 'orgA', title: 'u1' });
    expect(upserted.case_number).toBe('CASE-00031');
  });
});
