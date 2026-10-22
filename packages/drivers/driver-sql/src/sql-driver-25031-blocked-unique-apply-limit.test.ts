// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * A unique index its rows already violate declares, on its own drift entry,
 * that the apply will not perform it (`ManagedDriftEntry.applyLimit`).
 *
 * ## The defect
 *
 * The ADR-0120 D4 duplicate pre-flight marks such a `create_index` BLOCKED in
 * its message only (`category: 'destructive'`, "The op is BLOCKED: …"). The
 * one seam `os migrate plan` / `apply` read for "an entry the apply cannot
 * perform" asked the driver by op type, and a data-dependent block cannot
 * pass through that. So both doors offered `--allow-destructive` for the
 * entry, and the re-run they offered refused it and ended PARTIAL.
 *
 * ## What is pinned
 *
 * 1. Plain and organization-scoped: the blocked entry carries `applyLimit`,
 *    and it names the conflicting group — the duplicate report is the reason.
 * 2. The apply door agrees with the declaration: under `allowDestructive` the
 *    entry is skipped and no index appears.
 * 3. CONTROL: a duplicate-free unique index reports no `applyLimit` and a
 *    plain apply creates it; the same table, once deduplicated, re-grades.
 *
 * The CLI's reading of the field runs for real in
 * `packages/cli/src/commands/migrate/apply.blocked-unique-index.integration.test.ts`.
 */
describe('a blocked unique index declares its apply limit on the entry', () => {
  let driver: SqlDriver;

  beforeEach(() => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    (driver as any).logger = { warn() {}, info() {}, error() {}, debug() {} };
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  const seed = async (withOrg: boolean, rows: Array<Record<string, unknown>>): Promise<any> => {
    const k = (driver as any).knex;
    await k.schema.createTable('crm_quote', (t: any) => {
      t.string('id').primary();
      t.timestamp('created_at');
      t.timestamp('updated_at');
      if (withOrg) t.string('organization_id');
      t.string('quote_number');
    });
    await k('crm_quote').insert(rows);
    return k;
  };

  const indexNames = async (): Promise<string[]> => {
    const list: any = await (driver as any).knex.raw('PRAGMA index_list(crm_quote)');
    return list.filter((i: any) => i.origin !== 'pk').map((i: any) => i.name);
  };

  const PLAIN = [
    { name: 'crm_quote', tenancy: { enabled: false }, fields: { quote_number: { type: 'text', unique: true } } },
  ] as any[];
  const SCOPED = [
    {
      name: 'crm_quote',
      fields: { organization_id: { type: 'string' }, quote_number: { type: 'text', unique: true } },
    },
  ] as any[];

  const createIndexEntry = async () => {
    const entries = (await driver.detectManagedDrift()).filter((d) => d.op.type === 'create_index');
    expect(entries, JSON.stringify(entries.map((d) => d.op))).toHaveLength(1);
    return entries[0]!;
  };

  it('plain unique: the blocked entry names the conflicting group as its limit, and the apply refuses it', async () => {
    await seed(false, [
      { id: 'r1', quote_number: 'QUO-00009' },
      { id: 'r2', quote_number: 'QUO-00009' },
    ]);
    await driver.initObjects(PLAIN);

    const entry = await createIndexEntry();
    expect(entry.category).toBe('destructive');
    expect(entry.applyLimit).toEqual(expect.any(String));
    expect(entry.applyLimit).toContain('quote_number="QUO-00009"');

    const forced = await driver.applyMigrationEntries([entry], { allowDestructive: true });
    expect(forced.applied).toEqual([]);
    expect(forced.skipped).toEqual([entry]);
    expect(await indexNames()).not.toContain('uniq_crm_quote_quote_number');
  });

  it('organization-scoped unique: the same declaration, keyed by the organization part', async () => {
    await seed(true, [
      { id: 'r1', organization_id: 'org_x', quote_number: 'QUO-00010' },
      { id: 'r2', organization_id: 'org_x', quote_number: 'QUO-00010' },
      { id: 'r3', organization_id: 'org_y', quote_number: 'QUO-00010' },
    ]);
    await driver.initObjects(SCOPED);

    const entry = await createIndexEntry();
    expect(entry.category).toBe('destructive');
    expect(entry.applyLimit).toContain('organization_id="org_x", quote_number="QUO-00010"');
    expect(entry.applyLimit).not.toContain('org_y');
  });

  it('CONTROL: a duplicate-free unique index declares no limit and a plain apply creates it', async () => {
    await seed(false, [
      { id: 'r1', quote_number: 'QUO-00009' },
      { id: 'r2', quote_number: 'QUO-00010' },
    ]);
    await driver.initObjects(PLAIN);
    // The boot built it over clean data; take it away so the plan has a create.
    await (driver as any).knex.raw('DROP INDEX uniq_crm_quote_quote_number');

    const entry = await createIndexEntry();
    expect(entry.category).toBe('safe');
    expect(entry).not.toHaveProperty('applyLimit');

    const res = await driver.applyMigrationEntries([entry], { allowDestructive: false });
    expect(res.applied).toEqual([entry]);
    expect(await indexNames()).toContain('uniq_crm_quote_quote_number');
  });

  it('CONTROL: deduplicating the rows withdraws the limit on the next report', async () => {
    const k = await seed(false, [
      { id: 'r1', quote_number: 'QUO-00009' },
      { id: 'r2', quote_number: 'QUO-00009' },
    ]);
    await driver.initObjects(PLAIN);
    expect((await createIndexEntry()).applyLimit).toEqual(expect.any(String));

    await k('crm_quote').where({ id: 'r2' }).delete();

    const entry = await createIndexEntry();
    expect(entry.category).toBe('safe');
    expect(entry).not.toHaveProperty('applyLimit');
  });
});
