// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8928 end-to-end: the wiring `os migrate duplicates` actually runs on.
 *
 * The unit files pin the probes and the document; this one pins the three seams
 * between them and the real platform, none of which a double can vouch for:
 *
 *  1. the read-only boot (`deferSchemaDdl` + `readOnlyProbe`) hands back the
 *     registry the scan population is derived from — `stack.allObjects()`;
 *  2. `resolveSeedTenancyExec` finds a raw-SQL seam on the booted engine, which
 *     is where the report's every probe is issued;
 *  3. **the boot itself changes nothing.** The command's whole reason to exist
 *     is that the evidence is destroyed by repair, so "this command applies
 *     nothing" has to hold for the BOOT too, not merely for the probes. Booting
 *     is the part of the run with the most write paths behind it (schema sync,
 *     the artifact seed, the `kernel:ready` migrations), so it is the part worth
 *     measuring rather than reasoning about.
 *
 * ## The matched control (#8725)
 *
 * Since #8725 the fixture carries the SAME duplicate damage twice, in one
 * database, under two different vocabularies:
 *
 *  - `crm_case.case_number` — a DECLARED identifier, one value held on both
 *    sides of the organization partition. Reported by the `duplicates` scan,
 *    and reported before this card existed.
 *  - `sys_view_definition` — two ACTIVE shared views under one name, which is
 *    exactly what blocks `ensureViewDefinitionActiveIndex`'s NULL-safe
 *    tightening. Invisible to the drift differ by construction, and therefore
 *    to `os migrate plan`: `isRuntimeManagedIndex` excludes the index once the
 *    partial form exists, and before that the migration reuses the DECLARED
 *    index's name so the name-matched slot reads as filled either way.
 *
 * The control is what makes the second assertion mean something. A pre-flight
 * that quietly reported only the declared class — or a fixture that failed to
 * carry damage at all — would still satisfy "the report names some duplicate".
 * Both classes are asserted, separately, over one run.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  resolveSeedTenancyExec,
  normalizeRows,
  collectRuntimeIndexPreflight,
  GLOBAL_TENANT,
  ORGANIZATION_FIELD,
  ORGANIZATION_TABLE,
  SEQUENCES_TABLE,
} from '@objectstack/metadata-protocol';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { collectDuplicateIdentifierReport } from './duplicates.js';

let dir: string;
let dbFile: string;
const savedEnv: Record<string, string | undefined> = {};

/**
 * The fixture's LOGICAL state — the schema plus every row of every table,
 * ordered — read with a connection of our own, never the booted stack's.
 *
 * ⚠️ Deliberately not a hash of the database FILE. SQLite rewrites header
 * bytes (the change counter, the version-valid-for cookie) on any read-write
 * open, so a file hash reports a difference after a run that only SELECTed and
 * would accuse this command of mutating the install it exists to describe —
 * measured, and very nearly filed as a defect. What must not change is the
 * schema and the rows.
 */
async function readState(): Promise<unknown> {
  const probe = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
  });
  try {
    const k = (probe as any).knex;
    const schema = await k
      .raw("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
      .then((r: any) => r);
    const rows: Record<string, unknown> = {};
    for (const entry of schema as Array<{ type: string; name: string }>) {
      if (entry.type !== 'table' || entry.name.startsWith('sqlite_')) continue;
      rows[entry.name] = await k.raw(`SELECT * FROM "${entry.name}" ORDER BY rowid`);
    }
    return { schema, rows };
  } finally {
    await probe.disconnect();
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-8928-e2e-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  dbFile = join(dir, 'data', 'app.db');

  writeFileSync(
    join(dir, 'dist', 'objectstack.json'),
    JSON.stringify({
      manifest: { id: 'dup_smoke', name: 'Duplicates Smoke', version: '0.0.0', type: 'app' },
      objects: [
        {
          name: 'crm_case',
          fields: {
            subject: { type: 'text' },
            case_number: { type: 'autonumber' },
          },
        },
      ],
    }),
  );

  // An install carrying the damage: two counters, and one number minted on both
  // sides of the organization partition.
  const seed = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
  });
  const k = (seed as any).knex;
  await k.schema.createTable('crm_case', (t: any) => {
    t.string('id').primary();
    t.timestamp('created_at');
    t.timestamp('updated_at');
    t.string('organization_id');
    t.string('subject');
    t.string('case_number');
  });
  await k('crm_case').insert([
    { id: 's1', created_at: '2026-01-01T00:00:00.000Z', organization_id: null, subject: 'seeded', case_number: 'CASE-00001' },
    { id: 'a1', created_at: '2026-02-01T00:00:00.000Z', organization_id: 'org_x', subject: 'api', case_number: 'CASE-00001' },
  ]);
  // ── The runtime-migration half of the matched control (#8725) ──────────
  // Two ACTIVE shared views under one name: `owner` NULL and `organization_id`
  // NULL both fold into their sentinel buckets, so these two rows collide under
  // `idx_sys_view_def_active`'s NULL-safe key while the declared, NULL-distinct
  // index admits them. This is what blocks the tightening on the next serving
  // boot — and what the drift differ cannot report.
  await k.schema.createTable('sys_view_definition', (t: any) => {
    t.string('id').primary();
    t.string('name');
    t.string('organization_id');
    t.string('owner');
    t.string('state');
  });
  await k('sys_view_definition').insert([
    { id: 'v1', name: 'crm_case.all_open', organization_id: null, owner: null, state: 'active' },
    { id: 'v2', name: 'crm_case.all_open', organization_id: null, owner: null, state: 'active' },
    // Outside the partial index's row scope: the same collision among archived
    // rows is legal and must not be reported.
    { id: 'v3', name: 'crm_case.retired', organization_id: null, owner: null, state: 'archived' },
    { id: 'v4', name: 'crm_case.retired', organization_id: null, owner: null, state: 'archived' },
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
    { key_hash: 'h2', object: 'crm_case', tenant_id: 'org_x', field: 'case_number', scope: '', last_value: 1 },
  ]);
  await seed.disconnect();

  savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
  savedEnv.NODE_ENV = process.env.NODE_ENV;
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  process.env.NODE_ENV = 'production'; // no dev-time auto-reconcile
}, 120_000);

afterAll(() => {
  process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
  process.env.NODE_ENV = savedEnv.NODE_ENV;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#8928 os migrate duplicates — against a really booted stack', () => {
  it('reports the duplicate and the live condition, and leaves the install untouched', async () => {
    const before = await readState();

    const stack = await bootSchemaStack({
      jsonOutput: false, // this test owns stdout
      databaseUrl: `file:${dbFile}`,
      deferSchemaDdl: true,
      readOnlyProbe: true,
      projectRoot: dir,
    });
    let produced;
    try {
      const ql = (stack.kernel as { getService?: (n: string) => unknown }).getService?.('objectql');
      const exec = resolveSeedTenancyExec(ql);
      expect(exec, 'the booted SQL stack must expose a raw-SQL seam').toBeTypeOf('function');

      // The population comes from the booted registry, so an object installed by
      // a package is scanned exactly like one from this project's config.
      expect((stack.allObjects() as Array<{ name?: string }>).map((o) => o?.name)).toContain('crm_case');

      const client = String((stack.driver?.config as { client?: unknown })?.client ?? '');
      produced = await collectDuplicateIdentifierReport({
        exec: exec!,
        normalize: normalizeRows,
        objects: stack.allObjects(),
        database: stack.dbLabel,
        globalTenant: GLOBAL_TENANT,
        organizationField: ORGANIZATION_FIELD,
        sequencesTable: SEQUENCES_TABLE,
        client,
        // The real pre-flight over the real booted seam — the same call
        // `MigrateDuplicates.run()` makes.
        runtimeIndexPreflight: await collectRuntimeIndexPreflight(exec!, { client }),
      });
    } finally {
      await stack.shutdown();
    }

    expect(produced.duplicates).toEqual([
      expect.objectContaining({
        object: 'crm_case',
        field: 'case_number',
        value: 'CASE-00001',
        holderCount: 2,
        partitions: ['__global__', 'org_x'],
      }),
    ]);
    expect(produced.duplicates[0].holders.map((h) => h.id).sort()).toEqual(['a1', 's1']);
    expect(produced.liveConditions).toEqual([
      {
        object: 'crm_case',
        field: 'case_number',
        globalLastValue: 38,
        organizationCounters: [{ organization: 'org_x', lastValue: 1 }],
      },
    ]);

    // ── The other half of the control: the RUNTIME-migration class ────────
    // ⭐ This is the assertion the card exists for. The declared-vocabulary
    // duplicate above was already reported before #8725; a probe that surfaced
    // only that class would satisfy "the report names some duplicate" and still
    // leave the operator with nothing at the moment they are blocked.
    const viewIndex = produced.runtimeIndexPreflight.find(
      (entry) => entry.index === 'idx_sys_view_def_active',
    );
    expect(viewIndex, 'the pre-flight must cover sys_view_definition').toBeDefined();
    expect(viewIndex).toMatchObject({
      migration: 'ensureViewDefinitionActiveIndex',
      table: 'sys_view_definition',
      rowScope: "state = 'active'",
      status: 'blocked',
      groups: [
        {
          key: { name: 'crm_case.all_open', organization_id_key: '__global__', owner_key: '' },
          rowCount: 2,
        },
      ],
    });
    // The archived pair is outside the partial index and is NOT reported.
    expect(JSON.stringify(viewIndex!.groups)).not.toContain('crm_case.retired');
    // The summary counts it, so an operator scanning the head of the document
    // sees that something is blocked without reading every entry.
    expect(produced.summary.runtimeIndexesBlocked).toBe(1);
    expect(produced.summary.runtimeIndexBlockingRows).toBe(2);
    // `sys_metadata` exists on this fixture only if the boot made it; whatever
    // its status, the four indexes are all accounted for.
    expect(produced.runtimeIndexPreflight).toHaveLength(4);
    expect(produced.reportVersion).toBe(2);

    // The whole run — boot included — wrote nothing. If a future change arms a
    // repair on this boot path, THIS is the assertion that says so, before an
    // operator finds out by losing their evidence.
    expect(await readState()).toEqual(before);
  }, 120_000);
});
