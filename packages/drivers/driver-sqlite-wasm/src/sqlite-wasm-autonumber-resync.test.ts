// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5495] The wasm face re-seeds a stale autonumber counter too.
 *
 * `SqliteWasmDriver extends SqlDriver` and overrides neither `create` nor the
 * autonumber helpers, so the re-seed is inherited. What this pins is that the
 * inheritance actually DELIVERS it: this driver swaps knex's transport for a
 * custom sql.js dialect, and the collision path depends on two things
 * surviving that swap — the refused INSERT still throwing an error
 * `isUniqueViolationError` recognises, and the probe read
 * (`autoNumberValueExists`) seeing the row that caused the refusal.
 *
 * "It inherits the base class, therefore it is fine" is the assumption #4405
 * and #5240 exist to disprove on this driver, and #6203 is the shape where one
 * fix landed on one face and left the other answering differently. So the
 * fourth backend is verified rather than assumed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteWasmDriver } from './index.js';

describe('[#5495] driver-sqlite-wasm inherits the autonumber re-seed', () => {
  let driver: SqliteWasmDriver;

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

  it('serves the create on the first attempt after a seed replay lands above the counter', async () => {
    const knex = (driver as any).knex;

    await driver.create('crm_case', { organization_id: 'orgA', title: 'first' });

    const rows = [];
    for (let n = 2; n <= 30; n++) {
      rows.push({ id: `s${n}`, organization_id: 'orgA', case_number: `CASE-${String(n).padStart(5, '0')}`, title: `seed ${n}` });
    }
    await knex('crm_case').insert(rows);

    const created = await driver.create('crm_case', { organization_id: 'orgA', title: 'after the seeds' });
    expect(created.case_number).toBe('CASE-00031');
  });
});
