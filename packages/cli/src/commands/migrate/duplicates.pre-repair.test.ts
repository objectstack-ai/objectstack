// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8928 — the binding timing note, measured.
 *
 * The ruling's perishability clause is the reason this card exists:
 * `organization_id = NULL` is the marker that says "this row came from the
 * untenanted side", and it is exactly what the #8686 repair overwrites. So the
 * report must be runnable BEFORE the repair, and must not itself be a repair.
 *
 * Both halves are asserted here against the real migration, not a description of
 * it — `backfillSeedTenancy` from `@objectstack/metadata-protocol` is imported
 * and RUN in the second test, and what it destroys is measured rather than
 * assumed. (Reading that module is expected for this card; editing it is out of
 * surface, and nothing here does.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  backfillSeedTenancy,
  normalizeRows,
  GLOBAL_TENANT,
  ORGANIZATION_FIELD,
  ORGANIZATION_TABLE,
  SEQUENCES_TABLE,
  type SeedTenancyExec,
} from '@objectstack/metadata-protocol';
import { collectDuplicateIdentifierReport } from './duplicates.js';

const OBJECTS = [{ name: 'crm_case', fields: { case_number: { type: 'autonumber' } } }];

let dir: string;
let driver: SqlDriver;
let exec: SeedTenancyExec;

/** Everything this fixture holds, in one comparable document. */
async function snapshot(): Promise<unknown> {
  const k = (driver as any).knex;
  return {
    cases: await k('crm_case').select('*').orderBy('id'),
    sequences: await k(SEQUENCES_TABLE).select('*').orderBy(['object', 'tenant_id']),
    organizations: await k(ORGANIZATION_TABLE).select('*').orderBy('id'),
  };
}

const report = () =>
  collectDuplicateIdentifierReport({
    exec,
    normalize: normalizeRows,
    objects: OBJECTS,
    database: 'fixture',
    globalTenant: GLOBAL_TENANT,
    organizationField: ORGANIZATION_FIELD,
    sequencesTable: SEQUENCES_TABLE,
    client: 'better-sqlite3',
  });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-8928-prerepair-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data', 'app.db') },
    useNullAsDefault: true,
  });
  exec = (sql: string, params?: unknown[]) => driver.execute(sql, (params ?? []) as any[]);
  const k = (driver as any).knex;

  await k.schema.createTable('crm_case', (t: any) => {
    t.string('id').primary();
    t.timestamp('created_at');
    t.string('organization_id');
    t.string('case_number');
  });
  await k('crm_case').insert([
    { id: 's1', created_at: '2026-01-01T00:00:00.000Z', organization_id: null, case_number: 'CASE-00001' },
    { id: 's2', created_at: '2026-01-01T00:00:01.000Z', organization_id: null, case_number: 'CASE-00038' },
    { id: 'a1', created_at: '2026-02-01T00:00:00.000Z', organization_id: 'org_x', case_number: 'CASE-00001' },
  ]);
  await k.schema.createTable(ORGANIZATION_TABLE, (t: any) => {
    t.string('id').primary();
    t.string('name');
  });
  await k(ORGANIZATION_TABLE).insert([{ id: 'org_x', name: 'Acme' }]);
  await k.schema.createTable(SEQUENCES_TABLE, (t: any) => {
    t.string('key_hash', 64).notNullable().primary();
    t.string('object').notNullable();
    t.string('tenant_id').notNullable();
    t.string('field').notNullable();
    t.string('scope', 1024).notNullable().defaultTo('');
    t.bigInteger('last_value').notNullable().defaultTo(0);
    t.timestamp('updated_at');
  });
  await k(SEQUENCES_TABLE).insert([
    { key_hash: 'h1', object: 'crm_case', tenant_id: GLOBAL_TENANT, field: 'case_number', scope: '', last_value: 38 },
    { key_hash: 'h2', object: 'crm_case', tenant_id: 'org_x', field: 'case_number', scope: '', last_value: 4 },
  ]);
});

afterEach(async () => {
  try { await driver.disconnect(); } catch { /* already down */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#8928 — the report is an inventory, not a repair', () => {
  it('leaves every row and every counter exactly as it found them', async () => {
    const before = await snapshot();
    const produced = await report();
    // It really did look — a run that found nothing would pass a
    // "changed nothing" assertion trivially.
    expect(produced.summary.duplicateValues).toBe(1);
    expect(produced.summary.liveConditions).toBe(1);
    expect(await snapshot()).toEqual(before);
  });
});

describe('#8928 — why it must run BEFORE the #8686 backfill', () => {
  it('the live condition is destroyed by the repair; the inventory is what survives', async () => {
    const beforeRepair = await report();
    expect(beforeRepair.liveConditions).toEqual([
      {
        object: 'crm_case',
        field: 'case_number',
        globalLastValue: 38,
        organizationCounters: [{ organization: 'org_x', lastValue: 4 }],
      },
    ]);

    // The real repair, run exactly as a boot would run it.
    const repair = await backfillSeedTenancy(exec);
    expect(repair.status).toBe('applied');

    const afterRepair = await report();

    // 1. The forward-looking half is GONE: the `__global__` counter was merged
    //    into the organization-scoped one and deleted, so nothing is left to
    //    report as a condition. An install that repaired before reporting can
    //    never produce this line again.
    expect(afterRepair.liveConditions).toEqual([]);
    expect(afterRepair.counters.status).toBe('read');

    // 2. The already-minted duplicate itself survives — and NOT by luck: the
    //    backfill deliberately refuses to move a row whose identifier is already
    //    taken in the destination partition, which is the same ruling ("report,
    //    do not rewrite") seen from the repair's side. What the operator loses by
    //    repairing first is the condition above, not the inventory.
    expect(afterRepair.duplicates.map((d) => d.value)).toEqual(['CASE-00001']);
    expect(afterRepair.duplicates[0].partitions).toEqual(['__global__', 'org_x']);

    // 3. And the rows that had no conflict DID move — the `organization_id =
    //    NULL` marker is overwritten for them, which is the perishability the
    //    ruling names. Before the repair the report saw an untenanted CASE-00038;
    //    after it, that row is indistinguishable from an API-created one.
    const k = (driver as any).knex;
    const moved = await k('crm_case').where({ id: 's2' }).first();
    expect(moved.organization_id).toBe('org_x');
  });
});
