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
 *  - `sys_metadata` — two ACTIVE package-less overlays for one
 *    `(type, name, organization_id)`, which is exactly what blocks
 *    `ensureMetadataOverlayIndexes`' NULL-safe active-row tightening. Invisible
 *    to the drift differ by construction, and therefore to `os migrate plan`:
 *    `isRuntimeManagedIndex` excludes the index once the partial form exists,
 *    and before that the migration reuses the DECLARED index's name so the
 *    name-matched slot reads as filled either way.
 *
 * Until ADR-0131 D13 the runtime half was `sys_view_definition`'s active-row
 * index. That table retired with its migration, so the fixture now also
 * carries it, damaged, as the retirement's own control: a pre-flight that
 * still probed it would report rows nothing will ever refuse.
 *
 * The control is what makes the second assertion mean something. A pre-flight
 * that quietly reported only the declared class — or a fixture that failed to
 * carry damage at all — would still satisfy "the report names some duplicate".
 * Both classes are asserted, separately, over one run.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { isExitSignal } from '../../utils/format.js';
import MigrateDuplicates, { collectDuplicateIdentifierReport } from './duplicates.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** This package's root, where oclif reads its own manifest from. */
const CLI_ROOT = resolve(HERE, '..', '..', '..');

let dir: string;
let dbFile: string;
const savedEnv: Record<string, string | undefined> = {};

/**
 * The fixture's LOGICAL state — the schema plus every row of every table,
 * ordered — read with a connection of our own, never the booted stack's.
 *
 * ⚠️ Deliberately not a hash of the database FILE — not on THIS fixture. It is
 * written by a driver that never connected, so it is still on a rollback
 * journal, and the boot's first connect converts it to WAL: a persistent
 * header change (bytes 18–19, plus the change counter at 24–27 and the
 * version-valid-for number at 92–95) that any first connect makes, measured.
 * A plain open is byte-neutral, and a file a serving boot already configured
 * comes through a whole run byte-identical — the second describe below pins
 * that on its own fixture (#21734). What must not change HERE is the schema
 * and the rows.
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
      manifest: { id: 'com.example.dup-smoke', name: 'Duplicates Smoke', version: '0.0.0', type: 'app' },
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
  // Two ACTIVE package-less overlays for one key in one organization:
  // `package_id` NULL folds into its sentinel bucket, so these two rows collide
  // under `idx_sys_metadata_overlay_active`'s NULL-safe key while the declared,
  // NULL-distinct index admits them. This is what blocks the tightening on the
  // next serving boot — and what the drift differ cannot report. The
  // organization is NON-NULL on purpose: that key part stays bare in the index
  // (#6418), so two rows with a NULL organization would not block the CREATE.
  await k.schema.createTable('sys_metadata', (t: any) => {
    t.string('id').primary();
    t.string('type');
    t.string('name');
    t.string('organization_id');
    t.string('package_id');
    t.string('state');
  });
  await k('sys_metadata').insert([
    { id: 'm1', type: 'view', name: 'crm_case.board', organization_id: 'org_x', package_id: null, state: 'active' },
    { id: 'm2', type: 'view', name: 'crm_case.board', organization_id: 'org_x', package_id: null, state: 'active' },
    // Outside the partial index's row scope: the same collision among archived
    // rows is legal and must not be reported.
    { id: 'm3', type: 'view', name: 'crm_case.retired', organization_id: 'org_x', package_id: null, state: 'archived' },
    { id: 'm4', type: 'view', name: 'crm_case.retired', organization_id: 'org_x', package_id: null, state: 'archived' },
  ]);
  // ── The retired table, still physically present and still damaged ──────
  // ADR-0131 D13: schema sync never drops a table, so an upgraded database
  // keeps `sys_view_definition` and whatever its rows were. Nothing tightens
  // an index on it any more, so nothing about it may reach the report.
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
    const overlayIndex = produced.runtimeIndexPreflight.find(
      (entry) => entry.index === 'idx_sys_metadata_overlay_active',
    );
    expect(overlayIndex, 'the pre-flight must cover the sys_metadata overlay index').toBeDefined();
    expect(overlayIndex).toMatchObject({
      migration: 'ensureMetadataOverlayIndexes',
      table: 'sys_metadata',
      rowScope: "state = 'active'",
      status: 'blocked',
      groups: [
        {
          key: { type: 'view', name: 'crm_case.board', organization_id: 'org_x', package_id_key: '' },
          rowCount: 2,
        },
      ],
    });
    // The archived pair is outside both partial indexes and is NOT reported.
    expect(JSON.stringify(produced.runtimeIndexPreflight)).not.toContain('crm_case.retired');
    // The retired table is NOT probed, damaged as it is (ADR-0131 D13).
    expect(produced.runtimeIndexPreflight.map((entry) => entry.table)).not.toContain('sys_view_definition');
    expect(JSON.stringify(produced.runtimeIndexPreflight)).not.toContain('crm_case.all_open');
    // The summary counts it, so an operator scanning the head of the document
    // sees that something is blocked without reading every entry.
    expect(produced.summary.runtimeIndexesBlocked).toBe(1);
    expect(produced.summary.runtimeIndexBlockingRows).toBe(2);
    // `sys_setting` is absent on this fixture; whatever each status, the three
    // indexes are all accounted for.
    expect(produced.runtimeIndexPreflight).toHaveLength(3);
    expect(produced.reportVersion).toBe(2);

    // The whole run — boot included — wrote nothing. If a future change arms a
    // repair on this boot path, THIS is the assertion that says so, before an
    // operator finds out by losing their evidence.
    expect(await readState()).toEqual(before);
  }, 120_000);
});

/**
 * #21734 — the database FILE, not only its rows, comes out of a run unchanged.
 *
 * `SqlDriver.connect()` used to run `PRAGMA auto_vacuum = INCREMENTAL` on every
 * connect. On a file a serving boot had already configured the setter changes
 * no mode, but it stamps two header counters (bytes 24–27 and 92–95), so the
 * whole-file md5 moved under a command that only SELECTed. The driver now reads
 * the pragma first and sets it only when the file answers differently.
 *
 * Measured on a fixture shaped the way an install is: a driver CONNECTED to a
 * fresh file first — so it is `auto_vacuum=INCREMENTAL` and in WAL, as `os dev`
 * leaves it — and the rows written after. The command is the real one, run
 * in-process (oclif parse, the read-only boot, the probes, the JSON payload,
 * the shutdown) rather than spawned: one spawn of the source entry costs a tsx
 * compile of the whole CLI for an answer that lies entirely inside `run()`.
 */
describe('#21734 os migrate duplicates — an already-configured database file is byte-identical after a run', () => {
  const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;
  let booted: string;

  const md5 = (file: string): string => createHash('md5').update(readFileSync(file)).digest('hex');

  /** The command's one JSON document and its exit code, from an in-process run. */
  async function runDuplicates(argv: string[]): Promise<{ payload: any; exitCode: number }> {
    const savedExit = process.exitCode;
    const savedCwd = process.cwd();
    const saved: Record<string, string | undefined> = {};
    for (const key of OVERRIDING_ENV) saved[key] = process.env[key];
    const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
      const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
      if (cb) cb();
      return true;
    }) as typeof process.stdout.write;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
    vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
    let thrownExit: number | undefined;
    try {
      for (const key of OVERRIDING_ENV) delete process.env[key];
      // The command has no project-root flag: it boots from the current directory.
      process.chdir(dir);
      try {
        await MigrateDuplicates.run(argv, { root: CLI_ROOT });
      } catch (error) {
        if (!isExitSignal(error)) throw error;
        thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
      }
      const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
      return { payload: JSON.parse(out), exitCode: thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
    } finally {
      process.chdir(savedCwd);
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      process.exitCode = savedExit;
      vi.restoreAllMocks();
    }
  }

  beforeAll(async () => {
    booted = join(dir, 'data', 'booted.db');
    const d = new SqlDriver({ client: 'better-sqlite3', connection: { filename: booted }, useNullAsDefault: true });
    await d.connect();
    const k = (d as any).knex;
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
    await d.disconnect();
  }, 120_000);

  it('`os migrate duplicates` leaves the md5 of an auto_vacuum=INCREMENTAL WAL file unchanged', async () => {
    // The precondition, read on a connection of our own (a read is byte-neutral).
    const probe = new SqlDriver({ client: 'better-sqlite3', connection: { filename: booted }, useNullAsDefault: true });
    try {
      const k = (probe as any).knex;
      expect((await k.raw('PRAGMA auto_vacuum'))[0].auto_vacuum).toBe(2);
      expect(String((await k.raw('PRAGMA journal_mode'))[0].journal_mode).toLowerCase()).toBe('wal');
    } finally {
      await probe.disconnect();
    }
    const before = md5(booted);

    const { payload, exitCode } = await runDuplicates(['--database-url', `file:${booted}`]);

    expect(exitCode).toBe(0);
    // It really did look — a run that read nothing would leave the file alone trivially.
    expect(payload.duplicates.map((entry: { value: string }) => entry.value)).toEqual(['CASE-00001']);
    expect(md5(booted)).toBe(before);
  }, 120_000);
});
