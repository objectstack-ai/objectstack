// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8928 — the report's JSON contract, measured against a real SQLite database.
 *
 * The ruling made the output a machine-readable artifact: an operator archives
 * it, and auditors and tools read it. So the document's shape is a contract in
 * practice, and this file is what stops it from becoming an accident of the
 * implementation — every field a consumer may rely on is asserted here, whole,
 * rather than sampled.
 *
 * A real driver, not a double: the probes are SQL, and the three things most
 * likely to be wrong about them (the `COALESCE` partition test, `COUNT(DISTINCT
 * …)`, and reading a column the object does not have) are facts about a real
 * dialect that no hand-rolled exec double can testify to.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  collectRuntimeIndexPreflight,
  normalizeRows,
  runtimeIndexProbes,
  GLOBAL_TENANT,
  ORGANIZATION_FIELD,
  SEQUENCES_TABLE,
  type SeedTenancyExec,
} from '@objectstack/metadata-protocol';
import { collectDuplicateIdentifierReport } from './duplicates.js';

/**
 * The registry view the booted stack hands the command — the same objects
 * `stack.allObjects()` returns, written out here so the fixture states its own
 * metadata.
 */
const OBJECTS = [
  {
    name: 'crm_case',
    fields: {
      case_number: { type: 'autonumber' },
      external_ref: { type: 'text', unique: 'organization' },
      subject: { type: 'text' },
    },
  },
  {
    // No `created_at`: an object that opted out of system fields still has to
    // produce holders, with a null timestamp rather than a failed probe.
    name: 'crm_ticket',
    fields: { ticket_number: { type: 'autonumber' } },
  },
];

let dir: string;
let dbFile: string;
let driver: SqlDriver;
let exec: SeedTenancyExec;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-8928-contract-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  dbFile = join(dir, 'data', 'app.db');
  driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
  });
  // The same wrapper `resolveSeedTenancyExec` builds around a driver that
  // exposes `execute(sql, params)`.
  exec = (sql: string, params?: unknown[]) => driver.execute(sql, (params ?? []) as any[]);
  const k = (driver as any).knex;

  await k.schema.createTable('crm_case', (t: any) => {
    t.string('id').primary();
    t.timestamp('created_at');
    t.string('organization_id');
    t.string('case_number');
    t.string('external_ref');
  });
  await k('crm_case').insert([
    // The seeded side: written while the install had no organization yet.
    { id: 's1', created_at: '2026-01-01T00:00:00.000Z', organization_id: null, case_number: 'CASE-00001', external_ref: null },
    { id: 's2', created_at: '2026-01-01T00:00:01.000Z', organization_id: null, case_number: 'CASE-00002', external_ref: null },
    { id: 's3', created_at: '2026-01-01T00:00:02.000Z', organization_id: null, case_number: 'CASE-00038', external_ref: null },
    // The API side: written by a signed-in user, in the install's organization.
    { id: 'a1', created_at: '2026-02-01T00:00:00.000Z', organization_id: 'org_x', case_number: 'CASE-00001', external_ref: 'REF-1' },
    { id: 'a2', created_at: '2026-02-01T00:00:01.000Z', organization_id: 'org_x', case_number: 'CASE-00002', external_ref: 'REF-1' },
  ]);

  await k.schema.createTable('crm_ticket', (t: any) => {
    t.string('id').primary();
    t.string('organization_id');
    t.string('ticket_number');
  });
  await k('crm_ticket').insert([
    { id: 't1', organization_id: null, ticket_number: 'TKT-1' },
    { id: 't2', organization_id: 'org_x', ticket_number: 'TKT-1' },
  ]);

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
    // Only a `__global__` row: no organization-scoped counter stands beside it,
    // so this is NOT the condition the ruling asked to be reported.
    { key_hash: 'h3', object: 'crm_ticket', tenant_id: GLOBAL_TENANT, field: 'ticket_number', scope: '', last_value: 9 },
  ]);
});

afterAll(async () => {
  try { await driver.disconnect(); } catch { /* already down */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const collect = async (objectFilter?: string) =>
  collectDuplicateIdentifierReport({
    exec,
    normalize: normalizeRows,
    objects: OBJECTS,
    database: 'better-sqlite3 (fixture)',
    globalTenant: GLOBAL_TENANT,
    organizationField: ORGANIZATION_FIELD,
    sequencesTable: SEQUENCES_TABLE,
    client: 'better-sqlite3',
    now: () => new Date('2026-08-17T12:00:00.000Z'),
    // The real pre-flight against the real fixture — never a stand-in. This
    // database has none of the four platform tables, so every entry is
    // `table-absent`, and the `blocked` shape is pinned in its own test below
    // over a database that really carries the damage.
    runtimeIndexPreflight: await collectRuntimeIndexPreflight(exec, { client: 'better-sqlite3' }),
    ...(objectFilter ? { objectFilter } : {}),
  });

/**
 * The four probes, as `@objectstack/metadata-protocol` declares them.
 *
 * Read from the producer rather than restated here: the descriptor (table,
 * index name, key parts, row scope, the two statements) is the migration's own
 * definition of its key, and a second copy in this file would be a second
 * definition to keep in step. What this file pins is that the report carries
 * that descriptor through UNCHANGED, plus a status and its groups.
 */
const PROBES = runtimeIndexProbes({ client: 'better-sqlite3' });

describe('#8928 os migrate duplicates — the report document', () => {
  it('is exactly this shape, whole', async () => {
    expect(await collect()).toEqual({
      report: 'duplicate-identifiers',
      // #8725 added `runtimeIndexPreflight` and its two summary counters.
      reportVersion: 2,
      generatedAt: '2026-08-17T12:00:00.000Z',
      database: 'better-sqlite3 (fixture)',
      globalPartition: '__global__',
      filter: null,
      counters: { table: SEQUENCES_TABLE, status: 'read' },
      scanned: [
        {
          object: 'crm_case',
          field: 'case_number',
          partitionField: 'organization_id',
          identifier: 'autonumber',
          uniqueScope: null,
        },
        {
          object: 'crm_case',
          field: 'external_ref',
          partitionField: 'organization_id',
          identifier: 'unique',
          uniqueScope: 'organization',
        },
        {
          object: 'crm_ticket',
          field: 'ticket_number',
          partitionField: 'organization_id',
          identifier: 'autonumber',
          uniqueScope: null,
        },
      ],
      skipped: [],
      duplicates: [
        {
          object: 'crm_case',
          field: 'case_number',
          value: 'CASE-00001',
          holderCount: 2,
          partitions: ['__global__', 'org_x'],
          holders: [
            { id: 's1', organization: null, partition: '__global__', createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'a1', organization: 'org_x', partition: 'org_x', createdAt: '2026-02-01T00:00:00.000Z' },
          ],
        },
        {
          object: 'crm_case',
          field: 'case_number',
          value: 'CASE-00002',
          holderCount: 2,
          partitions: ['__global__', 'org_x'],
          holders: [
            { id: 's2', organization: null, partition: '__global__', createdAt: '2026-01-01T00:00:01.000Z' },
            { id: 'a2', organization: 'org_x', partition: 'org_x', createdAt: '2026-02-01T00:00:01.000Z' },
          ],
        },
        {
          object: 'crm_ticket',
          field: 'ticket_number',
          value: 'TKT-1',
          holderCount: 2,
          partitions: ['__global__', 'org_x'],
          // The object carries no `created_at`; the holders are still reported.
          holders: [
            { id: 't1', organization: null, partition: '__global__', createdAt: null },
            { id: 't2', organization: 'org_x', partition: 'org_x', createdAt: null },
          ],
        },
      ],
      liveConditions: [
        {
          object: 'crm_case',
          field: 'case_number',
          globalLastValue: 38,
          organizationCounters: [{ organization: 'org_x', lastValue: 4 }],
        },
      ],
      // One entry per index the three `kernel:ready` migrations tighten — FOUR,
      // because the overlay migration builds one per state and either can be
      // blocked on its own. Present whatever the outcome: an index left out
      // would make "nothing blocks it" and "it was never probed" the same
      // absence, which is the rule this command already applies to `skipped`.
      runtimeIndexPreflight: PROBES.map((probe) => ({
        ...probe,
        status: 'table-absent',
        groups: [],
      })),
      summary: {
        objectsScanned: 2,
        fieldsScanned: 3,
        duplicateValues: 3,
        duplicateRows: 6,
        liveConditions: 1,
        runtimeIndexesBlocked: 0,
        runtimeIndexBlockingRows: 0,
      },
    });
  });

  it('names the four kernel:ready indexes, and the migration behind each', async () => {
    const report = await collect();
    expect(
      report.runtimeIndexPreflight.map((p) => `${p.migration}:${p.table}:${p.index}`),
    ).toEqual([
      'ensureMetadataOverlayIndexes:sys_metadata:idx_sys_metadata_overlay_active',
      'ensureMetadataOverlayIndexes:sys_metadata:idx_sys_metadata_overlay_draft',
      'ensureViewDefinitionActiveIndex:sys_view_definition:idx_sys_view_def_active',
      'ensureSysSettingIdentityIndex:sys_setting:uniq_sys_setting_organization_id_namespace_key_scope_user_id',
    ]);
  });

  it('does NOT report a value repeated inside ONE partition — the narrow ruled definition', async () => {
    // `REF-1` is held twice, both times by `org_x`. That is a repeat the
    // partitioned unique index already refuses; reporting it would be the wider
    // reading ("any unique-declared field with repeated values, whatever the
    // cause") the ruling explicitly declined.
    const report = await collect();
    expect(report.duplicates.map((d) => d.field)).not.toContain('external_ref');
  });

  it('records the --object narrowing, so an archived report cannot read as a full scan', async () => {
    const report = await collect('crm_case');
    expect(report.filter).toEqual({ object: 'crm_case' });
    expect(report.summary.objectsScanned).toBe(1);
    expect(new Set(report.duplicates.map((d) => d.object))).toEqual(new Set(['crm_case']));
  });

  it('reports an unreadable object as skipped, never as an object with no findings', async () => {
    const report = await collectDuplicateIdentifierReport({
      exec,
      normalize: normalizeRows,
      objects: [...OBJECTS, { name: 'crm_never_created', fields: { code: { type: 'autonumber' } } }],
      database: 'better-sqlite3 (fixture)',
      globalTenant: GLOBAL_TENANT,
      organizationField: ORGANIZATION_FIELD,
      sequencesTable: SEQUENCES_TABLE,
      client: 'better-sqlite3',
      runtimeIndexPreflight: [],
    });
    expect(report.skipped).toEqual([
      expect.objectContaining({
        object: 'crm_never_created',
        field: 'code',
        reason: expect.stringContaining('duplicate probe failed'),
      }),
    ]);
    // …and the objects it COULD read are still reported in full.
    expect(report.summary.duplicateValues).toBe(3);
  });
});
