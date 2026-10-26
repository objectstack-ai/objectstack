// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13204 — the unmanaged-table sweep against a REAL booted stack and a REAL
 * database file, in both directions.
 *
 * `unmanaged-tables.test.ts` pins the predicate over hand-built sets. What it
 * cannot pin is the three joins to the rest of the system, and each is a place
 * a section like this goes wrong:
 *
 *  1. **The managed set is the plan's own.** The sweep reads
 *     `managedObjectFields` off the driver `os migrate plan` diffed. That
 *     member is `protected` and reached structurally, so only a real boot can
 *     say whether it is populated at the moment the sweep runs — and a
 *     mistimed read (before `measureComposedCoverage` binds the composed
 *     host's objects) would report every platform table as unmanaged.
 *  2. **The declared set is the deployment's own.** The fixture is #12938's
 *     shape — a host `objectstack.config.ts` whose whole object set comes from
 *     a plugin, which is what ObjectOS Cloud's control plane has — so the
 *     composition this sweep requires is the one it actually gets in the field.
 *  3. **The catalog query runs.** The three statements are written for three
 *     dialects; this exercises the sqlite one through the driver's own raw
 *     seam, against tables that really exist.
 *
 * ⛔ The NEGATIVE control is the point. `sys_user_permission_set` (from the composed
 * plugin), `sys_secret` (from the platform floor) and [#24059] `sys_packages`
 * (the package registry's, declared outside the object set) are put in the
 * database BEFORE the boot and must NOT be reported, alongside
 * `_objectstack_sequences` and an application table. A sweep observed only in
 * the presence of an orphan would be indistinguishable from one that reports
 * everything.
 *
 * The positive control is the card's own measured case: a `sys_`-prefixed table
 * left behind by a retired object, which no plan can mention today.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
// Module-top side-effect load, paid during COLLECTION rather than inside a
// clocked test body: `sweep()` below reaches `normalizeRows` through a dynamic
// `import()`, and this package resolves that specifier through `dist/`, so the
// first call would transform that dependency's whole module graph while a
// `testTimeout` is running (`check:test-source-alias`; measured 3.1-3.6s idle,
// 20.26s on a starved core). This decides only WHERE the load is paid.
import '@objectstack/metadata-protocol';
import { bootSchemaStack, type SchemaStack } from './schema-migrate.js';
import { collectUnmanagedTables, type UnmanagedTablesReport } from './unmanaged-tables.js';

const require_ = createRequire(import.meta.url);

/**
 * The installed `@objectstack/plugin-security` package root — resolved through
 * this package's own dependency graph rather than written as a path climbing
 * into a sibling package, so this test's inputs stay equal to its declared ones
 * (the `check:cross-package-test-inputs` reasoning; a `node_modules` read is
 * what a dependency IS).
 */
function securityPackageRoot(): string {
  return resolve(dirname(require_.resolve('@objectstack/plugin-security')), '..');
}

/**
 * The env vars that outrank the unified project default (#6469). Every one of
 * them must be absent or the boot resolves somewhere else entirely and this
 * test silently stops testing anything.
 */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL',
  'DATABASE_URL',
  'TURSO_DATABASE_URL',
  'OS_DATABASE_DRIVER',
  'OS_HOME',
] as const;

/** Legitimate, and every one of them must stay OUT of the report. */
const NEGATIVE_CONTROLS = [
  // [ADR-0131 D3] A table the composed plugin still declares. `sys_permission_set`
  // was this control until C3 stage 8 retired its object: its table is now
  // declared by nothing, so the sweep is RIGHT to report it.
  'sys_user_permission_set', // declared by the composed host plugin
  'sys_secret',              // declared by the platform floor
  // [#24059] Not an object: the composed package registry declares it through
  // `package.storage`, and `os migrate apply` creates it from that declaration.
  'sys_packages',
  '_objectstack_sequences',  // the driver's own autonumber ledger
  'app_leftovers',           // no reserved prefix at all
];

/** The card's measured shape: a retired object's table, declared by nothing. */
const STRANDED = 'sys_scim_provider';

describe('os migrate plan — unmanaged tables, against a real database (#13204)', () => {
  let dir: string;
  let dbFile: string;
  let stack: SchemaStack | null = null;
  const savedEnv: Record<string, string | undefined> = {};

  /** Assemble physical tables OUTSIDE the booted stack, so each is a fact about the file. */
  async function createTables(names: readonly string[]): Promise<void> {
    const seed = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: dbFile },
      useNullAsDefault: true,
    });
    const k = (seed as unknown as { knex: any }).knex;
    try {
      for (const name of names) {
        await k.schema.createTable(name, (t: any) => { t.string('id').primary(); });
      }
    } finally {
      await k.destroy();
    }
  }

  async function dropTable(name: string): Promise<void> {
    const surgeon = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: dbFile },
      useNullAsDefault: true,
    });
    const k = (surgeon as unknown as { knex: any }).knex;
    try {
      await k.schema.dropTable(name);
    } finally {
      await k.destroy();
    }
  }

  /** The same boot `os migrate plan` performs. */
  const bootLikeMigrate = (): Promise<SchemaStack> => bootSchemaStack({
    jsonOutput: false,
    projectRoot: dir,
    databaseUrl: `file:${dbFile}`,
    deferSchemaDdl: true,
    readOnlyProbe: true,
    composeHostStack: true,
    // [#22506] `plan` composes what `os serve` mounts around the stack too —
    // and [#22580] the sweep runs only over a set that mirrors the served boot.
    composeServedPlatform: true,
  });

  async function sweep(): Promise<UnmanagedTablesReport> {
    const { normalizeRows } = await import('@objectstack/metadata-protocol');
    return collectUnmanagedTables({
      drivers: stack!.drivers,
      declaredObjects: stack!.allObjects(),
      nonObjectTables: stack!.nonObjectTables,
      composition: stack!.composition,
      normalize: normalizeRows,
    });
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-orphan-'));
    dbFile = join(dir, 'control.db');

    // #12938's fixture shape: a host config whose whole object set comes from a
    // plugin, and no compiled artifact at all.
    mkdirSync(join(dir, 'node_modules', '@objectstack'), { recursive: true });
    symlinkSync(
      securityPackageRoot(),
      join(dir, 'node_modules', '@objectstack', 'plugin-security'),
      'dir',
    );
    writeFileSync(
      join(dir, 'objectstack.config.ts'),
      [
        "import { SecurityPlugin } from '@objectstack/plugin-security';",
        '',
        'export default { plugins: [new SecurityPlugin()] };',
        '',
      ].join('\n'),
    );

    await createTables([...NEGATIVE_CONTROLS, STRANDED]);

    for (const key of OVERRIDING_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json'); // deliberately absent
    process.env.NODE_ENV = 'production'; // no dev auto-reconcile

    stack = await bootLikeMigrate();
  }, 180_000);

  afterEach(async () => {
    try { await stack?.shutdown(); } catch { /* torn down either way */ }
    stack = null;
    for (const key of OVERRIDING_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (savedEnv.OS_ARTIFACT_PATH === undefined) delete process.env.OS_ARTIFACT_PATH;
    else process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    if (savedEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv.NODE_ENV;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('the boot this sweep reads from really did compose the deployment', () => {
    // The premises the whole section rests on. A zero managed set, or a
    // composition that did not load the host config, would make every
    // assertion below pass for the wrong reason.
    expect(stack!.driver).not.toBeNull();
    expect(stack!.composition.hostConfigLoaded).toBe(true);
    expect(stack!.composition.servedBoot).toEqual({ mirrored: true });
    expect(stack!.managedTableCount).toBeGreaterThan(0);
    const declared = (stack!.allObjects() as Array<{ name?: string }>).map((o) => o?.name);
    expect(declared).toContain('sys_user_permission_set');
    expect(declared).toContain('sys_secret');
    // [#24059] The table outside the object set is named by the declaration the
    // plan creates it from — the composed registry's own `package.storage` —
    // although the table exists here, so the plan has nothing pending for it.
    const storage = stack!.kernel.getService('package.storage') as { table: string };
    expect(stack!.nonObjectTables).toEqual([storage.table]);
    expect(stack!.pendingSchemaWork.filter((w) => w.table === storage.table)).toEqual([]);
  });

  it('REPORTS the stranded table, and reports ONLY it', async () => {
    const report = await sweep();
    // ⛔ `unreadable` is not a pass. It is the third state, and it means the
    // measurement below never happened.
    expect(report.status).toBe('read');
    const read = report as Extract<UnmanagedTablesReport, { status: 'read' }>;
    expect(read.tables.map((f) => f.table)).toEqual([STRANDED]);
    // The negative controls, named individually so a failure says which moved.
    for (const legitimate of NEGATIVE_CONTROLS) {
      expect(read.tables.map((f) => f.table)).not.toContain(legitimate);
    }
    expect(read.physicalTables).toBeGreaterThanOrEqual(NEGATIVE_CONTROLS.length + 1);
  }, 180_000);

  it('goes SILENT once the stranded table is the only thing that changes', async () => {
    // The other direction of the same measurement: remove the orphan, leave
    // every negative control in place, and the section must disappear. Without
    // this, "reports only sys_scim_provider" is also satisfied by a section
    // that reports a fixed string.
    const before = await sweep();
    expect((before as { tables: unknown[] }).tables).toHaveLength(1);

    await stack!.shutdown();
    stack = null;
    await dropTable(STRANDED);
    stack = await bootLikeMigrate();

    const after = await sweep();
    expect(after.status).toBe('read');
    expect((after as { tables: unknown[] }).tables).toEqual([]);
    // Still a real sweep, not an early return: the negative controls are all
    // still in the database.
    expect((after as { physicalTables: number }).physicalTables)
      .toBeGreaterThanOrEqual(NEGATIVE_CONTROLS.length);
  }, 240_000);
});
