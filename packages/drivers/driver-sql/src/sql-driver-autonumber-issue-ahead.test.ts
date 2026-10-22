// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25073] `SqlDriver.issueAutonumbers` — the record number on request, ahead
 * of the write.
 *
 * `create()` / `bulkCreate()` fill an empty `autonumber` slot as the last step
 * before the INSERT, so a stored field whose `expression` reads the number was
 * computed by the engine before the number existed (null for a concatenation,
 * the `has()` fallback otherwise). The member issues the same number earlier,
 * on the caller's row, and `create()` then finds the slot filled and writes
 * the row as it stands: one statement, carrying the number the engine computed
 * from.
 *
 * What is pinned here is the member's own half, on a real SQLite database:
 *
 *  1. ISSUE fills what `create()` would have filled (same counter, same
 *     organization scope), leaves a typed value alone, and `create()` of the
 *     filled row draws no second number.
 *  2. AFTER A COLLISION it is `create()`'s #5495 re-seed split at the point
 *     only the caller can go on: it judges the error as `create()` does,
 *     re-seeds the stale counter once and EMPTIES the slot, so the caller's
 *     next issue lands on MAX + 1. It never answers for a duplicate on a
 *     value the caller typed, for a non-unique error, or inside a caller's
 *     transaction.
 *  3. A batch: every row that drew from the stale counter is emptied (#6943's
 *     per-counter reading), the counter re-seeded once.
 *
 * The engine's half (issue after validation, recompute, retry) is pinned in
 * `packages/runtime/src/autonumber-stored-expression.integration.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isUniqueViolationError } from '@objectstack/types';
import { SqlDriver } from './index.js';

const SEQUENCES_TABLE = '_objectstack_sequences';

const CRM_CASE = {
  name: 'crm_case',
  fields: {
    organization_id: { type: 'string' },
    case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
    title: { type: 'string' },
  },
} as any;

describe('[#25073] SqlDriver.issueAutonumbers', () => {
  let driver: SqlDriver;
  const knex = () => (driver as any).knex;

  const lastValue = async (tenant: string): Promise<number | undefined> => {
    const rows = await knex()(SEQUENCES_TABLE).select('*');
    const row = rows.find((r: any) => r.object === 'crm_case' && r.field === 'case_number' && r.tenant_id === tenant);
    return row ? Number(row.last_value) : undefined;
  };

  /** Land rows by a path that bypasses the counter, as a seed replay does. */
  const bypassInsert = async (org: string, from: number, to: number) => {
    const rows = [];
    for (let n = from; n <= to; n++) {
      rows.push({ id: `${org}-s${n}`, organization_id: org, case_number: `CASE-${String(n).padStart(5, '0')}`, title: `seed ${n}` });
    }
    await knex()('crm_case').insert(rows);
  };

  /** The error a write raises, or a failure when it lands. */
  const refusal = async (write: Promise<unknown>): Promise<unknown> => {
    try {
      await write;
    } catch (error) {
      return error;
    }
    throw new Error('expected the write to be refused');
  };

  beforeEach(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([CRM_CASE]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  describe('issue', () => {
    it('fills the empty slot in place, from the counter create() draws from, and create() draws no second number', async () => {
      await driver.create('crm_case', { organization_id: 'orgA', title: 'by create' });
      expect(await lastValue('orgA')).toBe(1);

      const row: Record<string, unknown> = { organization_id: 'orgA', title: 'ahead' };
      expect(await driver.issueAutonumbers('crm_case', [row])).toEqual([['case_number']]);
      expect(row.case_number).toBe('CASE-00002');
      expect(await lastValue('orgA')).toBe(2);

      const stored = await driver.create('crm_case', row);
      expect(stored.case_number).toBe('CASE-00002');
      expect(await lastValue('orgA')).toBe(2);
      // And the counter simply goes on from there.
      expect((await driver.create('crm_case', { organization_id: 'orgA', title: 'next' })).case_number).toBe('CASE-00003');
    });

    it('issues per organization from the call options, as create() stamps the organization first', async () => {
      await driver.create('crm_case', { organization_id: 'orgA', title: 'a1' });
      const row: Record<string, unknown> = { title: 'b, organization from options' };
      expect(await driver.issueAutonumbers('crm_case', [row], { tenantId: 'orgB' } as any)).toEqual([['case_number']]);
      expect(row.case_number).toBe('CASE-00001');
      expect(await lastValue('orgB')).toBe(1);
      expect(await lastValue('orgA')).toBe(1);
      // Only the number lands on the caller's row; `create()` stamps the organization.
      expect(row).not.toHaveProperty('organization_id');
      expect((await driver.create('crm_case', row, { tenantId: 'orgB' } as any)).organization_id).toBe('orgB');
    });

    it('leaves a typed value alone and does not report it', async () => {
      const row: Record<string, unknown> = { organization_id: 'orgA', case_number: 'CASE-07777', title: 'import' };
      expect(await driver.issueAutonumbers('crm_case', [row])).toEqual([[]]);
      expect(row.case_number).toBe('CASE-07777');
      expect(await lastValue('orgA')).toBeUndefined();
    });

    it('answers index-aligned with the rows of a batch', async () => {
      const rows: Record<string, unknown>[] = [
        { organization_id: 'orgA', title: 'one' },
        { organization_id: 'orgA', case_number: 'CASE-00500', title: 'typed' },
        { organization_id: 'orgA', title: 'two' },
      ];
      expect(await driver.issueAutonumbers('crm_case', rows)).toEqual([['case_number'], [], ['case_number']]);
      expect(rows.map((r) => r.case_number)).toEqual(['CASE-00001', 'CASE-00500', 'CASE-00002']);
      const stored = await driver.bulkCreate('crm_case', rows);
      expect(stored.map((r) => r.case_number)).toEqual(['CASE-00001', 'CASE-00500', 'CASE-00002']);
    });
  });

  describe('after a collision', () => {
    it('re-seeds the counter it proves stale and empties the slot, so the next issue lands on MAX + 1', async () => {
      await bypassInsert('orgA', 9, 9);
      await driver.create('crm_case', { organization_id: 'orgA', title: 'first' });
      expect(await lastValue('orgA')).toBe(10);
      await bypassInsert('orgA', 11, 39);

      const row: Record<string, unknown> = { organization_id: 'orgA', title: 'after the seeds' };
      await driver.issueAutonumbers('crm_case', [row]);
      expect(row.case_number).toBe('CASE-00011');
      const error = await refusal(driver.create('crm_case', row));
      expect(isUniqueViolationError(error)).toBe(true);

      expect(await driver.issueAutonumbers('crm_case', [row], undefined, error)).toEqual([['case_number']]);
      expect(row).not.toHaveProperty('case_number');
      expect(await lastValue('orgA')).toBe(39);

      expect(await driver.issueAutonumbers('crm_case', [row])).toEqual([['case_number']]);
      expect(row.case_number).toBe('CASE-00040');
      expect((await driver.create('crm_case', row)).case_number).toBe('CASE-00040');
    });

    it('answers nothing, and changes nothing, for a duplicate on a value the caller typed', async () => {
      await driver.create('crm_case', { organization_id: 'orgA', case_number: 'CASE-00001', title: 'typed' });
      const row: Record<string, unknown> = { organization_id: 'orgA', case_number: 'CASE-00001', title: 'typed again' };
      expect(await driver.issueAutonumbers('crm_case', [row])).toEqual([[]]);
      const error = await refusal(driver.create('crm_case', row));
      expect(isUniqueViolationError(error)).toBe(true);

      expect(await driver.issueAutonumbers('crm_case', [row], undefined, error)).toEqual([[]]);
      expect(row.case_number).toBe('CASE-00001');
    });

    it('answers nothing for an error that is not a unique violation', async () => {
      const row: Record<string, unknown> = { organization_id: 'orgA', title: 'x' };
      await driver.issueAutonumbers('crm_case', [row]);
      const issued = row.case_number;
      expect(await driver.issueAutonumbers('crm_case', [row], undefined, new Error('SQLITE_BUSY: database is locked'))).toEqual([[]]);
      expect(row.case_number).toBe(issued);
    });

    it('answers nothing inside a caller transaction, where create() retries nothing either', async () => {
      await driver.create('crm_case', { organization_id: 'orgA', title: 'seeds the counter at 1' });
      await bypassInsert('orgA', 2, 5);
      const row: Record<string, unknown> = { organization_id: 'orgA', title: 'in a transaction' };
      await driver.issueAutonumbers('crm_case', [row]);
      const error = await refusal(driver.create('crm_case', row));
      expect(isUniqueViolationError(error)).toBe(true);
      const trx = await knex().transaction();
      try {
        expect(await driver.issueAutonumbers('crm_case', [row], { transaction: trx } as any, error)).toEqual([[]]);
      } finally {
        await trx.rollback();
      }
      expect(row.case_number).toBe('CASE-00002');
      expect(await lastValue('orgA')).toBe(2);
    });

    it('empties every row of a batch that drew from the stale counter, and re-seeds it once', async () => {
      await bypassInsert('orgA', 1, 1);
      await driver.create('crm_case', { organization_id: 'orgA', title: 'seeds the counter at 2' });
      await bypassInsert('orgA', 3, 3);

      const rows: Record<string, unknown>[] = [
        { organization_id: 'orgA', title: 'collides on 3' },
        { organization_id: 'orgA', title: 'would be 4, did not collide' },
        { organization_id: 'orgB', title: 'another counter' },
      ];
      await driver.issueAutonumbers('crm_case', rows);
      expect(rows.map((r) => r.case_number)).toEqual(['CASE-00003', 'CASE-00004', 'CASE-00001']);
      const error = await refusal(driver.bulkCreate('crm_case', rows));

      expect(await driver.issueAutonumbers('crm_case', rows, undefined, error)).toEqual([['case_number'], ['case_number'], []]);
      expect(rows[0]).not.toHaveProperty('case_number');
      expect(rows[1]).not.toHaveProperty('case_number');
      expect(rows[2].case_number).toBe('CASE-00001');
      expect(await lastValue('orgA')).toBe(4);
      expect(await lastValue('orgB')).toBe(1);
    });
  });
});
