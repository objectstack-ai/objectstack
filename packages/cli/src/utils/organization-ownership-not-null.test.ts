// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ceremony's `notNull` port over a REAL SQLite driver (18.x step 5d;
 * ruling record 6269955919 on the v18 epic, ② A):
 *
 *  - a declared table's `organization_id` goes NOT NULL through the driver's
 *    own drift apply door (the SQLite table rebuild), its rows kept;
 *  - ⭐ the next drift scan reports NOTHING for it — the ceremony owns that
 *    nullability, so no `relax_not_null` is ever proposed to undo it — while
 *    the same constraint on any other undeclared-NOT-NULL column still is;
 *  - a table the composition does not declare is `not-declared`, untouched;
 *  - a transport whose apply door declares it cannot perform the op is
 *    `unsupported`, never attempted;
 *  - a rotation shard is never rebuilt: one the driver created NOT NULL is
 *    `already-not-null`, read from the database, and one created nullable
 *    before the driver did so is `unsupported`, saying it leaves with the
 *    base's retention.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { applyNotNullThroughDrift } from './organization-ownership-not-null.js';

let dir: string;
let driver: SqlDriver;
let knex: any;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-d10-not-null-'));
  driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'db.sqlite') }, useNullAsDefault: true });
  (driver as any).logger = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} };
  knex = (driver as any).knex;
  await driver.initObjects([
    { name: 'crm_deal', fields: { name: { type: 'text' }, organization_id: { type: 'lookup', reference: 'sys_organization', required: false } } },
  ] as never);
  // The ceremony tightens a table an earlier release built: its tenant column
  // is nullable, which a table this release creates never is (ADR-0131 D1).
  // Relaxed through the driver's own drift apply door, the shape of that store.
  const { applied } = await driver.applyMigrationEntries([
    {
      kind: 'nullability_mismatch', remoteName: 'crm_deal', table: 'crm_deal', column: 'organization_id', category: 'needs_confirm',
      op: { type: 'relax_not_null', table: 'crm_deal', column: 'organization_id' },
    } as never,
  ]);
  if (applied.length !== 1) throw new Error('crm_deal was not returned to its pre-18 shape');
  await knex('crm_deal').insert([
    { id: 'deal_1', name: 'Acme', organization_id: 'org_default' },
    { id: 'deal_2', name: 'Globex', organization_id: 'org_default' },
  ]);
  await knex.schema.createTable('legacy_table', (t: any) => {
    t.string('id').primary();
    t.string('organization_id');
  });
});

afterEach(async () => {
  await driver.disconnect?.();
  rmSync(dir, { recursive: true, force: true });
});

const nullable = async (table: string, column: string): Promise<boolean> => (await knex(table).columnInfo())[column].nullable;

describe('organization_id NOT NULL through the drift apply door', () => {
  it('⭐ applies it on a declared table, keeps its rows, and the next drift scan reports nothing for it', async () => {
    expect(await nullable('crm_deal', 'organization_id')).toBe(true);
    const outcomes = await applyNotNullThroughDrift(
      { isDeclared: (t) => t === 'crm_deal', driverFor: () => driver as never },
      [{ table: 'crm_deal', column: 'organization_id' }],
    );
    expect(outcomes).toEqual([{ table: 'crm_deal', column: 'organization_id', outcome: 'applied' }]);
    expect(await nullable('crm_deal', 'organization_id')).toBe(false);
    expect(await knex('crm_deal').select('id', 'organization_id').orderBy('id')).toEqual([
      { id: 'deal_1', organization_id: 'org_default' },
      { id: 'deal_2', organization_id: 'org_default' },
    ]);
    const drift = (await driver.detectManagedDrift()).filter((d) => d.table === 'crm_deal' && d.kind === 'nullability_mismatch');
    expect(drift).toEqual([]);
    // A NULL can no longer land.
    await expect(knex('crm_deal').insert({ id: 'deal_3', name: 'Initech', organization_id: null })).rejects.toThrow(/NOT NULL/);
  });

  it('a table the booted composition does not declare is not-declared, and nothing touches it', async () => {
    const outcomes = await applyNotNullThroughDrift(
      { isDeclared: (t) => t === 'crm_deal', driverFor: () => driver as never },
      [{ table: 'legacy_table', column: 'organization_id' }],
    );
    expect(outcomes).toEqual([{ table: 'legacy_table', column: 'organization_id', outcome: 'not-declared' }]);
    expect(await nullable('legacy_table', 'organization_id')).toBe(true);
  });

  it('a transport whose apply door cannot perform it is unsupported, never attempted', async () => {
    let attempted = 0;
    const remote = {
      driftApplyLimit: (op: string) => (op === 'tighten_not_null' ? 'the remote face runs no SQLite table rebuild' : null),
      applyMigrationEntries: async () => {
        attempted++;
        return { applied: [], skipped: [] };
      },
    };
    const outcomes = await applyNotNullThroughDrift(
      { isDeclared: () => true, driverFor: () => remote as never },
      [{ table: 'crm_deal', column: 'organization_id', database: 'telemetry' }],
    );
    expect(outcomes).toEqual([
      { table: 'crm_deal', column: 'organization_id', outcome: 'unsupported', detail: 'the remote face runs no SQLite table rebuild' },
    ]);
    expect(attempted).toBe(0);
  });

  it('a rotation shard created nullable is unsupported, never rebuilt: it has no declaration of its own', async () => {
    let attempted = 0;
    const outcomes = await applyNotNullThroughDrift(
      {
        isDeclared: () => true,
        shardBaseOf: (t) => (t.startsWith('sys_activity__') ? 'sys_activity' : null),
        isNotNull: async () => false,
        driverFor: () => ({ applyMigrationEntries: async () => { attempted++; return { applied: [], skipped: [] }; } }) as never,
      },
      [{ table: 'sys_activity__r20261019', column: 'organization_id' }],
    );
    expect(outcomes).toEqual([
      {
        table: 'sys_activity__r20261019',
        column: 'organization_id',
        outcome: 'unsupported',
        detail: expect.stringMatching(/rotation shard of sys_activity, rotated in before shards were created with organization_id NOT NULL/),
      },
    ]);
    expect(outcomes[0]!.detail).not.toMatch(/nullable column/);
    expect(attempted).toBe(0);
  });

  it('⭐ a rotation shard the driver created NOT NULL is already-not-null, never reported unsupported or rebuilt', async () => {
    await knex.schema.createTable('crm_deal__r20261021', (t: any) => {
      t.string('id').primary();
      t.string('organization_id').notNullable();
    });
    let attempted = 0;
    const asked: unknown[][] = [];
    const outcomes = await applyNotNullThroughDrift(
      {
        isDeclared: () => true,
        shardBaseOf: (t) => (t.startsWith('crm_deal__') ? 'crm_deal' : null),
        isNotNull: async (table, column, database) => {
          asked.push([table, column, database]);
          return !(await nullable(table, column));
        },
        driverFor: () => ({ applyMigrationEntries: async () => { attempted++; return { applied: [], skipped: [] }; } }) as never,
      },
      [{ table: 'crm_deal__r20261021', column: 'organization_id' }],
    );
    expect(outcomes).toEqual([{ table: 'crm_deal__r20261021', column: 'organization_id', outcome: 'already-not-null' }]);
    expect(asked).toEqual([['crm_deal__r20261021', 'organization_id', undefined]]);
    expect(attempted).toBe(0);
  });

  it('no driver for the table\'s database fails, naming the database', async () => {
    const [outcome] = await applyNotNullThroughDrift(
      { isDeclared: () => true, driverFor: () => undefined },
      [{ table: 'crm_deal', column: 'organization_id', database: 'telemetry' }],
    );
    expect(outcome).toMatchObject({ outcome: 'failed', detail: expect.stringMatching(/database telemetry/) });
  });
});
