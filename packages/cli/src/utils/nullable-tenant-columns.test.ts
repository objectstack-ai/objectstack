// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The nullable-tenant-column advisory of `os migrate plan` over a REAL SQLite
 * driver (ADR-0131 D1; ruling record 6328195425, letter A, item 2):
 *
 *  - a tenant column the database holds nullable is listed, as one the
 *    ceremony tightens; one it holds NOT NULL (every table this release
 *    creates) is not;
 *  - a column named `organization_id` on an object that opts out of tenancy
 *    (`sys_sso_provider`) is not a tenant column, and is not listed;
 *  - the residue the ceremony leaves is listed apart, with why: a rotation
 *    shard created nullable (a shard created NOT NULL is not listed), a table
 *    whose rows are mirrors the ceremony deletes (`sys_email_template`), and a
 *    database whose apply door cannot tighten a column;
 *  - "could not look" is `unreadable`, never an empty list.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { normalizeRows } from '@objectstack/metadata-protocol';
import {
  NULLABLE_TENANT_COLUMNS_REMEDY,
  collectNullableTenantColumns,
  renderNullableTenantColumns,
  type NullableTenantColumnsReport,
} from './nullable-tenant-columns.js';

let dir: string;
let driver: SqlDriver;
let knex: any;

const ORG = { type: 'lookup', reference: 'sys_organization', required: false };

/** Return a table's tenant column to the 18.0.0 shape — nullable — through the driver's own apply door. */
async function relax(table: string): Promise<void> {
  const { applied } = await driver.applyMigrationEntries([
    {
      kind: 'nullability_mismatch', remoteName: table, table, column: 'organization_id', category: 'needs_confirm',
      op: { type: 'relax_not_null', table, column: 'organization_id' },
    } as never,
  ]);
  if (applied.length !== 1) throw new Error(`${table} was not returned to its 18.0.0 shape`);
}

const nullable = async (table: string): Promise<boolean> => (await knex(table).columnInfo()).organization_id.nullable;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-d1-nullable-tenant-'));
  driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'db.sqlite') }, useNullAsDefault: true });
  (driver as any).logger = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} };
  knex = (driver as any).knex;
  await driver.initObjects([
    { name: 'crm_deal', fields: { name: { type: 'text' }, organization_id: ORG } },
    { name: 'crm_note', fields: { body: { type: 'text' }, organization_id: ORG } },
    { name: 'sys_email_template', fields: { name: { type: 'text' }, organization_id: ORG } },
    { name: 'sys_sso_provider', tenancy: { enabled: false }, fields: { issuer: { type: 'text' }, organization_id: ORG } },
  ] as never);
});

afterEach(async () => {
  await driver.disconnect?.();
  rmSync(dir, { recursive: true, force: true });
});

const collect = (over: Partial<Parameters<typeof collectNullableTenantColumns>[0]> = {}): Promise<NullableTenantColumnsReport> =>
  collectNullableTenantColumns({ databases: [{ driver }], tenantDrivers: [driver], mirrored: true, normalize: normalizeRows, ...over });

describe('the nullable-tenant-column advisory', () => {
  it('a fresh store lists nothing: every tenant column is NOT NULL from create, and the opt-out is no tenant column', async () => {
    expect(await nullable('crm_deal')).toBe(false);
    expect(await nullable('sys_sso_provider')).toBe(true);
    const report = await collect();
    expect(report).toEqual({ status: 'read', adr: 'ADR-0131 D1', remedy: NULLABLE_TENANT_COLUMNS_REMEDY, columns: [] });
    expect(renderNullableTenantColumns(report)).toEqual([]);
  });

  it('⭐ an 18.0.0-shaped store lists each nullable tenant column, as one the ceremony tightens, and names the ceremony', async () => {
    await relax('crm_deal');
    await relax('crm_note');
    const report = await collect();
    expect(report).toEqual({
      status: 'read',
      adr: 'ADR-0131 D1',
      remedy: 'os migrate organization-ownership',
      columns: [
        { table: 'crm_deal', column: 'organization_id', ceremony: 'tightens' },
        { table: 'crm_note', column: 'organization_id', ceremony: 'tightens' },
      ],
    });
    const lines = renderNullableTenantColumns(report);
    expect(lines[0]).toMatch(/^2 tenant column\(s\) are still nullable \(ADR-0131 D1\)\. This is advisory: it is not drift/);
    expect(lines.slice(1, 3)).toEqual(['  • crm_deal.organization_id', '  • crm_note.organization_id']);
    expect(lines[3]).toContain('"os migrate organization-ownership --out PLAN"');
  });

  it('the advisory proposes nothing: the same store\'s drift holds no entry for a tenant column', async () => {
    await relax('crm_deal');
    expect((await collect()).status).toBe('read');
    const drift = (await driver.detectManagedDrift()).filter((d: any) => d.column === 'organization_id');
    expect(drift).toEqual([]);
  });

  it('the residue the ceremony leaves is listed apart, each with why, and the ceremony is not offered for it', async () => {
    await relax('sys_email_template');
    await knex.schema.createTable('crm_deal__r20261019', (t: any) => {
      t.string('id').primary();
      t.string('organization_id');
    });
    await knex.schema.createTable('crm_deal__r20261020', (t: any) => {
      t.string('id').primary();
      t.string('organization_id').notNullable();
    });
    const report = await collect();
    if (report.status !== 'read') throw new Error(report.detail);
    expect(report.columns).toEqual([
      {
        table: 'crm_deal__r20261019',
        column: 'organization_id',
        ceremony: 'leaves',
        reason: expect.stringMatching(/^a rotation shard of crm_deal, created before shards were created NOT NULL/),
      },
      {
        table: 'sys_email_template',
        column: 'organization_id',
        ceremony: 'leaves',
        reason: expect.stringMatching(/mirrors the ceremony deletes, and the table retires/),
      },
    ]);
    const lines = renderNullableTenantColumns(report);
    expect(lines.at(-1)).toBe('None of them is one the organization-ownership ceremony tightens; each line says why it stays nullable.');
    expect(lines.join('\n')).not.toContain('--apply');
  });

  it('a database whose apply door cannot tighten a column leaves every one, saying so', async () => {
    await relax('crm_deal');
    const limited = Object.assign(Object.create(driver), {
      driftApplyLimit: (op: string) => (op === 'tighten_not_null' ? 'the remote face runs no SQLite table rebuild' : null),
    });
    const report = await collect({ databases: [{ driver: limited, database: 'remote' }] });
    expect(report).toMatchObject({
      status: 'read',
      columns: [{
        table: 'crm_deal', database: 'remote', ceremony: 'leaves',
        reason: 'this database\'s apply door cannot tighten a column: the remote face runs no SQLite table rebuild',
      }],
    });
  });

  it('"could not look" is unreadable, never an empty list', async () => {
    await relax('crm_deal');
    expect(await collect({ mirrored: false })).toMatchObject({ status: 'unreadable', detail: expect.stringMatching(/did not compose/) });
    expect(await collect({ tenantDrivers: [{}] })).toMatchObject({ status: 'unreadable', detail: expect.stringMatching(/tenant-column map/) });
    expect(await collect({ databases: [{ driver: {} }] })).toMatchObject({ status: 'unreadable', detail: expect.stringMatching(/raw SQL seam/) });
    const report = await collect({ databases: [] });
    expect(renderNullableTenantColumns(report)).toEqual([
      'Nullable tenant-column advisory did not run: the plan holds no SQL driver, so no column was read.',
    ]);
  });
});
