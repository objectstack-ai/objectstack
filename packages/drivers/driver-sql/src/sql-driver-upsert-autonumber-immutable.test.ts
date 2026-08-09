// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7011] A merge-path upsert must never rewrite an existing row's autonumber.
 *
 * # The defect, measured on a HEALTHY counter (no staleness involved)
 *
 * ```
 * create                      → CASE-00001    last_value 1
 * upsert same id (1st time)   → CASE-00002    last_value 2
 * upsert same id (2nd time)   → CASE-00003    last_value 3
 * ```
 *
 * One row throughout — and its `case_number` was rewritten twice. The cause:
 * `fillAutoNumberFields` reserves a number before the statement knows whether
 * it will insert or merge, and the autonumber column sat in `mergeColumns`, so
 * the `ON CONFLICT … DO UPDATE` branch wrote the freshly reserved number over
 * the row's existing one.
 *
 * # The ruling this file pins (triage, 2026-08-09, on the card)
 *
 * An autonumber is an **immutable business identifier once assigned** — it is
 * usually an externally visible document number (`CASE-00001`), and a caller
 * asking to update a row did not ask for a new one. The fix excludes
 * `auto_number` columns from `mergeColumns`, exactly like `created_at` (both
 * are insert-only facts about the row's birth). The exclusion is unconditional:
 * even an EXPLICIT autonumber value in the upsert payload does not rewrite an
 * existing row's number on the merge branch — `update()` writes whatever it is
 * given and remains the deliberate renumbering path.
 *
 * # Out of scope here, deliberately
 *
 * The reservation itself still happens before insert-vs-merge is known, so a
 * merge-only upsert still consumes a sequence value (leaves a gap). That
 * pre-burn half belongs to #6943's reseed family and is NOT pinned by this
 * file — no test here asserts `last_value` on the merge path, so deferring the
 * reservation later cannot turn this file red.
 *
 * # Reverse verification (direction predicted before running)
 *
 * Restoring the deleted limb — removing the autonumber exclusion from
 * `mergeColumns` — turns exactly the merge-path pins below red, with the
 * filing's own values (received `CASE-00002` / `CASE-00003` where `CASE-00001`
 * was asserted). The insert-path and non-autonumber-merge cases stay green
 * either way; they are here to pin that the exclusion does not over-reach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from './index.js';

const CRM_CASE = {
  name: 'crm_case',
  fields: {
    organization_id: { type: 'string' },
    case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
    title: { type: 'string' },
    status: { type: 'string' },
  },
} as any;

describe('[#7011] merge-path upsert keeps the assigned autonumber', () => {
  let driver: SqlDriver;

  const knex = () => (driver as any).knex;

  const rowCount = async () => Number((await knex()('crm_case').count({ c: '*' }).first()).c);

  beforeEach(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([CRM_CASE]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('keeps the existing number across repeated merges to the same row (the filing repro)', async () => {
    const created = await driver.create('crm_case', { organization_id: 'orgA', title: 'original' });
    expect(created.case_number).toBe('CASE-00001');

    const first = await driver.upsert('crm_case', { id: created.id, organization_id: 'orgA', title: 'edit 1' });
    expect(first.case_number).toBe('CASE-00001'); // was CASE-00002 before the fix
    expect(first.title).toBe('edit 1');

    const second = await driver.upsert('crm_case', { id: created.id, organization_id: 'orgA', title: 'edit 2' });
    expect(second.case_number).toBe('CASE-00001'); // was CASE-00003 before the fix
    expect(second.title).toBe('edit 2');

    // One row throughout, and the stored value agrees with the returned one.
    expect(await rowCount()).toBe(1);
    const stored = await knex()('crm_case').where({ id: created.id }).first();
    expect(stored.case_number).toBe('CASE-00001');
  });

  it('does not rewrite the number even when the payload carries an explicit one', async () => {
    const created = await driver.create('crm_case', { organization_id: 'orgA', title: 'original' });
    expect(created.case_number).toBe('CASE-00001');

    // An explicit value is skipped by fillAutoNumberFields (caller-supplied),
    // but it still sits in the INSERT's column list — the exclusion is what
    // keeps it off the merge branch. `update()` remains the deliberate
    // renumbering path for the caller who really means it.
    const merged = await driver.upsert('crm_case', {
      id: created.id,
      organization_id: 'orgA',
      case_number: 'CASE-99999',
      title: 'tried to renumber',
    });
    expect(merged.case_number).toBe('CASE-00001');
    expect(merged.title).toBe('tried to renumber');
  });

  it('insert-path upsert still assigns a fresh number', async () => {
    const first = await driver.upsert('crm_case', { organization_id: 'orgA', title: 'new row' });
    expect(first.case_number).toBe('CASE-00001');

    const second = await driver.upsert('crm_case', { organization_id: 'orgA', title: 'another new row' });
    expect(second.case_number).toBe('CASE-00002');

    expect(await rowCount()).toBe(2);
  });

  it('still merges every non-autonumber column normally', async () => {
    const created = await driver.create('crm_case', { organization_id: 'orgA', title: 'original', status: 'open' });

    const merged = await driver.upsert('crm_case', {
      id: created.id,
      organization_id: 'orgA',
      title: 'renamed',
      status: 'closed',
    });

    expect(merged.title).toBe('renamed');
    expect(merged.status).toBe('closed');
    expect(merged.case_number).toBe('CASE-00001');
    expect(await rowCount()).toBe(1);
  });

  it('a merge on a non-id conflict key keeps the number too', async () => {
    // The exclusion is per-column, not per-conflict-target: merging on a
    // business key instead of `id` must protect the number the same way.
    await driver.initObjects([
      {
        name: 'crm_ticket',
        fields: {
          organization_id: { type: 'string' },
          ticket_number: { type: 'autonumber', format: 'TKT-{0000}', unique: true },
          external_ref: { type: 'string', unique: 'global' },
          title: { type: 'string' },
        },
      } as any,
    ]);

    const created = await driver.create('crm_ticket', { organization_id: 'orgA', external_ref: 'ext-1', title: 'first' });
    expect(created.ticket_number).toBe('TKT-0001');

    const merged = await driver.upsert(
      'crm_ticket',
      { id: created.id, organization_id: 'orgA', external_ref: 'ext-1', title: 'merged by ref' },
      ['external_ref'],
    );
    expect(merged.title).toBe('merged by ref');

    const stored = await knex()('crm_ticket').where({ external_ref: 'ext-1' }).first();
    expect(stored.ticket_number).toBe('TKT-0001');
  });
});
