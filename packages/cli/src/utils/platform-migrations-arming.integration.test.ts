// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9380 — the three `kernel:ready` platform-table migrations never armed on a
 * self-hosted boot, and arming them must not make a read-only command write.
 *
 * `assembleMetadataProtocol` arms #5839 (the `sys_view_definition` active-row
 * index), #8629 (`sys_setting`'s row-identity index) and #8686 (the seed/API
 * tenancy backfill) behind one gate whose own comment says standalone belongs
 * on the INSIDE of it: "platform / standalone kernels own their local
 * sys_metadata; per-project (cloud) kernels source metadata from the control
 * plane and must NOT provision these tables locally."
 *
 * The gate deduced that from `environmentId === undefined`, and
 * `runtime/src/standalone-stack.ts` stamps `'proj_local'` on every boot. So the
 * block never ran on `os dev` / `os serve` / `os start` at all, and #8686's own
 * header — "repairs an install that is ALREADY in that state, which covers
 * every existing deployment" — covered no self-hosted deployment.
 *
 * ## Why this file boots real kernels rather than testing the predicate
 *
 * The defect was entirely in the WIRING: every component worked. The card's
 * measurement carried two controls proving it — calling `backfillSeedTenancy`
 * by hand on the same booted engine returned `applied`, and a probe plugin
 * registering its own `kernel:ready` handler on the same boot fired and
 * repaired. Only the shipped registration was missing. A test on the predicate
 * would therefore have passed against the broken build: the predicate was never
 * the unobservable part, the ARMING was. So every case here boots a real kernel
 * over a real SQLite file carrying the real #8686 damage and asserts on the
 * DATABASE, read back through a connection of its own.
 *
 * ## Why it lives in the CLI package
 *
 * Because two of the three sides are the CLI's: cases 2a/2b drive the REAL
 * `bootSchemaStack` funnel rather than re-passing its flag by hand, which is
 * the only way to pin that the funnel actually declares what it claims to.
 * `duplicates.integration.test.ts` next door pins the same contract from the
 * report command's end; this file pins the boot policy itself, including the
 * NON-deferred one-shot boots that file never exercises.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  GLOBAL_TENANT,
  SEQUENCES_TABLE,
  ORGANIZATION_TABLE,
  SEED_TENANCY_MIGRATION_ID,
} from '@objectstack/metadata-protocol';
import { bootSchemaStack } from './schema-migrate.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body or a
// hook -- both of which vitest clocks, while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule) and #10115 / PR #10120,
// where the same shape cost 30 ejected merge-queue builds in one night.
import '@objectstack/objectql';
import '@objectstack/runtime';
import '@objectstack/platform-objects/plugin';

const ORG_ID = 'org_x';
/** The `__global__` counter the seed loader ran ahead to before the org existed. */
const SEEDED_LAST_VALUE = 38;

let dir: string;
let dbFile: string;
const savedEnv: Record<string, string | undefined> = {};

/**
 * Read the install with a connection of OUR OWN — never the booted stack's.
 *
 * The whole question is what the boot did to the file, so the observation has
 * to outlive the boot's teardown and must not share its pool.
 */
async function readState(): Promise<{ data: unknown; schema: unknown }> {
  const probe = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
  });
  try {
    const k = (probe as any).knex;
    return {
      // Everything the three migrations could move. Column-projected, not
      // `select('*')`: a boot that is ALLOWED to run schema-sync DDL adds
      // audit/ownership columns to `crm_case`, and that is not what any of
      // these cases is about (see the non-deferred case below).
      data: {
        cases: await k('crm_case')
          .select('id', 'organization_id', 'case_number', 'subject')
          .orderBy('id'),
        sequences: await k(SEQUENCES_TABLE)
          .select('object', 'tenant_id', 'field', 'last_value')
          .orderBy(['object', 'tenant_id']),
      },
      // The physical schema, so a case asserting "this boot changed nothing"
      // also covers the two INDEX migrations (#5839, #8629). Without this the
      // only migration a green run could speak for would be #8686's, and a
      // read-only boot that quietly created an index would pass.
      schema: await k('sqlite_master').select('type', 'name', 'tbl_name', 'sql').orderBy(['type', 'name']),
    };
  } finally {
    await probe.disconnect();
  }
}

/** The install as #8686 leaves it: two counters, and one number minted on both sides. */
async function writeDamagedInstall(): Promise<void> {
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
    { id: 's2', created_at: '2026-01-02T00:00:00.000Z', organization_id: null, subject: 'seeded two', case_number: 'CASE-00002' },
    { id: 'a1', created_at: '2026-02-01T00:00:00.000Z', organization_id: ORG_ID, subject: 'api', case_number: 'CASE-00001' },
  ]);
  await k.schema.createTable(ORGANIZATION_TABLE, (t: any) => {
    t.string('id').primary();
    t.string('name');
  });
  await k(ORGANIZATION_TABLE).insert([{ id: ORG_ID, name: 'Acme' }]);
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
    { key_hash: 'h1', object: 'crm_case', tenant_id: GLOBAL_TENANT, field: 'case_number', scope: '', last_value: SEEDED_LAST_VALUE },
    { key_hash: 'h2', object: 'crm_case', tenant_id: ORG_ID, field: 'case_number', scope: '', last_value: 1 },
  ]);
  await seed.disconnect();
}

/**
 * The self-hosted SERVING boot — `os dev` / `os serve` / `os start`.
 *
 * These do not go through `bootSchemaStack`; they build the standalone stack
 * and run it, which is exactly what this does. `plugins` + `Runtime` + `start`
 * is the same sequence `bootSchemaStack` performs, minus the one-shot policy —
 * so the ONLY difference between this and case 2b is the declaration under
 * test.
 */
async function bootServingStack(options: { platformObjects?: boolean } = {}): Promise<void> {
  const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
  const stack = await createStandaloneStack({
    projectRoot: dir,
    databaseUrl: `file:${dbFile}`,
  });
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const plugin of stack.plugins) await kernel.use(plugin as any);
  // [#9451] `createStandaloneStack` does not compose the platform objects —
  // `os serve` mounts `PlatformObjectsPlugin` itself ("platform infrastructure
  // every served kernel needs", #4243), and the `sys_migration` ledger arrives
  // with it. A case that wants to observe what a REAL served boot records has
  // to mount it the same way; one that only wants the repair does not.
  if (options.platformObjects) {
    const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');
    await kernel.use(new PlatformObjectsPlugin() as any);
  }
  await runtime.start();
  await kernel.shutdown();
}

/**
 * The `sys_migration` ledger, read through a connection of OUR OWN after the
 * boot has shut down — `'no-table'` when the ledger was never provisioned.
 *
 * Deliberately not folded into `readState()`: the byte-identical cases compare
 * that snapshot whole, and a table that exists on one boot and not another
 * belongs in its own observation rather than in theirs.
 */
async function readReceipts(): Promise<any[] | 'no-table'> {
  const probe = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
  });
  try {
    return await (probe as any).knex('sys_migration').select('*').orderBy('id');
  } catch {
    return 'no-table';
  } finally {
    await probe.disconnect();
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-9380-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  dbFile = join(dir, 'data', 'app.db');

  writeFileSync(
    join(dir, 'dist', 'objectstack.json'),
    JSON.stringify({
      manifest: { id: 'os_9380', name: 'Platform Migration Arming', version: '0.0.0', type: 'app' },
      objects: [
        {
          name: 'crm_case',
          fields: {
            subject: { type: 'text' },
            case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: 'organization' },
          },
        },
      ],
    }),
  );

  savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
  savedEnv.NODE_ENV = process.env.NODE_ENV;
  savedEnv.OS_ENVIRONMENT_ID = process.env.OS_ENVIRONMENT_ID;
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  process.env.NODE_ENV = 'production'; // no dev-time auto-reconcile
  delete process.env.OS_ENVIRONMENT_ID;

  await writeDamagedInstall();
}, 180_000);

afterEach(() => {
  process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
  process.env.NODE_ENV = savedEnv.NODE_ENV;
  if (savedEnv.OS_ENVIRONMENT_ID === undefined) delete process.env.OS_ENVIRONMENT_ID;
  else process.env.OS_ENVIRONMENT_ID = savedEnv.OS_ENVIRONMENT_ID;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#9380 the kernel:ready platform migrations, on the boots that reach them', () => {
  it('[the card] a self-hosted SERVING boot repairs the #8686 damage', async () => {
    const before: any = (await readState()).data;
    // Non-vacuity: the fixture really is damaged, or a green run below would
    // say nothing. Two counters for one object IS the split.
    expect(before.sequences).toHaveLength(2);
    expect(before.cases.filter((c: any) => c.organization_id === null)).toHaveLength(2);

    await bootServingStack();

    const after: any = (await readState()).data;

    // The `__global__` counter is gone and its high-water mark was merged into
    // the organization's — the seed's 38 wins over the org side's 1, which is
    // what stops the next API create from re-minting a number already used.
    expect(after.sequences).toEqual([
      expect.objectContaining({
        object: 'crm_case',
        tenant_id: ORG_ID,
        field: 'case_number',
        last_value: SEEDED_LAST_VALUE,
      }),
    ]);

    // The MOVABLE seed row was adopted into the one organization. `s1` collides
    // with the org-side `CASE-00001`, so it is reported and left where it is —
    // never renumbered (2026-08-15 ruling). That asymmetry is the proof the
    // real migration ran and not something that merely stamped every row.
    expect(after.cases.filter((c: any) => c.organization_id === null).map((c: any) => c.id)).toEqual(['s1']);
    expect(after.cases.find((c: any) => c.id === 's2').organization_id).toBe(ORG_ID);
  }, 180_000);

  it('[read-only contract] a DEFERRED one-shot CLI boot leaves the install byte-identical', async () => {
    const before = await readState();

    // `os migrate plan` / `os migrate duplicates` — declared dry runs. Nothing
    // moves and no index appears: `deferSchemaDdl` holds the DDL back, and the
    // #9380 declaration holds the three repairs back.
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      deferSchemaDdl: true,
      readOnlyProbe: true,
      projectRoot: dir,
    });
    await stack.shutdown();

    expect(await readState()).toEqual(before);
  }, 180_000);

  it('[read-only contract] a NON-deferred one-shot CLI boot also leaves it byte-identical', async () => {
    const before = await readState();

    // The half that a `deferSchemaDdl`-keyed policy would have missed, and the
    // more dangerous one: `os migrate summary-nulls`, `value-shapes`,
    // `recorded-by`, `resume`, `files-to-references` and `os migrate meta` all
    // boot WITHOUT `deferSchemaDdl` and are still dry-run-by-default ("a dry
    // run writes NOTHING"). If the arming were gated on deferral instead of on
    // being a one-shot boot, every one of them would silently repair rows
    // behind a report.
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      projectRoot: dir,
    });
    await stack.shutdown();

    // DATA only, deliberately. A non-deferred boot is allowed to run schema
    // sync, and it does — `crm_case` gains its audit/ownership columns
    // (`created_by`, `updated_by`, `owner_id`, `owning_business_unit_id`).
    // That is the boot doing its declared job and predates this card; what
    // those commands promise is that they do not MOVE ROWS, and that is what
    // is asserted. Comparing the physical schema here would pin a fact about
    // schema sync in a file about migration arming.
    expect((await readState()).data).toEqual(before.data);
  }, 180_000);

  it('[the other half of the invariant] a per-project (cloud) kernel repairs nothing', async () => {
    const before = await readState();

    // Cloud's own assembly shape, verbatim from
    // `cloud/packages/objectos-runtime/src/artifact-kernel-factory.ts`: an
    // environment-scoped engine with the protocol delegated, declaring NO
    // `runPlatformMigrations`. This case goes red the moment the default stops
    // excluding a per-project kernel — which is the easy thing to break while
    // fixing the standalone half.
    const { Runtime, DefaultDatasourcePlugin } = await import('@objectstack/runtime');
    const { ObjectQLPlugin } = await import('@objectstack/objectql');
    const { createMetadataProtocolPlugin } = await import('@objectstack/metadata-protocol');

    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    await kernel.use(new (DefaultDatasourcePlugin as any)(
      { driver: 'sqlite', config: { filename: dbFile } },
      { dev: false },
    ));
    await kernel.use(new ObjectQLPlugin({
      environmentId: 'env_proj_1',
      registerProtocol: false,
    }) as any);
    await kernel.use(createMetadataProtocolPlugin({ environmentId: 'env_proj_1' }) as any);
    await runtime.start();
    await kernel.shutdown();

    expect(await readState()).toEqual(before);
  }, 180_000);

  /**
   * #9451 — the repair now leaves a durable receipt, and this is the assertion
   * the card is actually about.
   *
   * Everything above proves the repair RUNS. None of it can answer the
   * operator's question, which is asked after the fact: "was my data rewritten,
   * and when?" Until now the only evidence was one `logger.info` line, so a
   * replaced container took the answer with it — and the healthy path is silent
   * by design, so absence of a message means nothing either way.
   *
   * The observation is therefore made the only way that can settle it: the
   * boot is shut down, and the row is read out of the FILE through a connection
   * of our own. A receipt that only exists in the booted process's memory (or
   * in its log) fails this test exactly the way the defect does.
   */
  it('[#9451] a served boot records the repair in sys_migration, and the row outlives the process', async () => {
    // Non-vacuity in the direction that matters: there is no ledger row before,
    // and the fixture really is damaged (asserted by the first case).
    expect(await readReceipts()).toBe('no-table');

    await bootServingStack({ platformObjects: true });

    const receipts = await readReceipts();
    expect(receipts).not.toBe('no-table');
    const rows = receipts as any[];
    const receipt = rows.find((r) => r.id === SEED_TENANCY_MIGRATION_ID);
    expect(receipt).toBeDefined();

    // The reading, pinned where a real ledger writes it: no self-check ran, so
    // no certificate is claimed; nothing gates on this id, so `blocking` is 0;
    // the already-minted duplicate is advisory because it needs an operator,
    // not a gate.
    expect(receipt.verified_at).toBeNull();
    expect(receipt.blocking).toBe(0);
    expect(receipt.advisory).toBe(1);
    expect(typeof receipt.last_run_at).toBe('string');
    expect(receipt.applied_at).toBe(receipt.last_run_at);

    // And the row answers the card's question — which objects, whose
    // organization, what could not be adopted.
    expect(JSON.parse(receipt.details)).toEqual({
      status: 'applied',
      objectsStamped: 1,
      organizationId: ORG_ID,
      splits: ['crm_case.case_number'],
      collisions: [`crm_case.case_number=CASE-00001`],
    });

    // The repair really did happen on this boot (the receipt describes THIS
    // run, not a row someone wrote by hand).
    const after: any = (await readState()).data;
    expect(after.cases.find((c: any) => c.id === 's2').organization_id).toBe(ORG_ID);
  }, 180_000);

  it('[#9451] the receipt survives a restart against the same database', async () => {
    // The scenario the whole card is about is a CONTAINER REPLACEMENT: the
    // process that repaired the data is gone, and a new one boots against the
    // same database. The second boot finds no split (the repair is idempotent),
    // so it writes nothing — and the receipt from the first boot is still the
    // answer.
    await bootServingStack({ platformObjects: true });
    const first = (await readReceipts() as any[]).find((r) => r.id === SEED_TENANCY_MIGRATION_ID);
    expect(first).toBeDefined();

    await bootServingStack({ platformObjects: true });

    const rows = (await readReceipts()) as any[];
    const second = rows.filter((r) => r.id === SEED_TENANCY_MIGRATION_ID);
    // Exactly one row, unchanged: the ledger's grain is one row per migration,
    // and a healthy boot must not restamp it — `last_run_at` moving on a boot
    // that repaired nothing would make the receipt lie about when the data was
    // rewritten.
    expect(second).toHaveLength(1);
    expect(second[0].last_run_at).toBe(first.last_run_at);
    expect(second[0].details).toBe(first.details);
  }, 180_000);
});
