// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { bootSchemaStack } from './schema-migrate.js';

/**
 * #12938 — the measurement, inverted into a regression pin.
 *
 * Before this card, `os migrate plan` / `apply` booted `createStandaloneStack`
 * and nothing else: five managed tables (`sys_metadata`, its three history /
 * audit / commit siblings, `sys_view_definition`), `0` drift, and the sentence
 * "Physical schema is in sync with metadata — nothing to migrate." On a control
 * plane carrying ~80 `sys_*` tables that reads as a pass while the driver's own
 * boot detector reports ten findings on the same database — and the command
 * those findings NAME ("run `os migrate apply`") is this one.
 *
 * The fixture is cloud#1695's shape, built by the platform rather than by hand:
 * a host `objectstack.config.ts` composing `SecurityPlugin`, the tables created
 * through the migrate path itself, and then `sys_position`'s per-organization
 * composite unique swapped back to the pre-#8323 global spelling
 * (`uniq_sys_position_name`) — the exact index a deployed control DB was still
 * carrying.
 *
 * Four things are pinned, and the fourth is an ABSENCE. Composing a host
 * config means composing arbitrary code, and `SecurityPlugin` seeds its
 * built-in permission sets from `start()`: measured, that produced 14 insert
 * attempts against `sys_permission_set` during a run documented as writing
 * nothing. `sys_permission_set` staying EMPTY across a plan is what proves the
 * declaration-phase composition actually holds.
 */

const require_ = createRequire(import.meta.url);

/**
 * The installed `@objectstack/plugin-security` package root.
 *
 * Resolved through this package's own dependency graph rather than written as a
 * path that climbs into a sibling package: the entry point is a `node_modules`
 * read, which is what a dependency IS, and it keeps this test's inputs equal to
 * its declared ones.
 */
function securityPackageRoot(): string {
  // `<root>/dist/index.js` → `<root>`.
  return resolve(dirname(require_.resolve('@objectstack/plugin-security')), '..');
}

/** The five tables the data stack alone registers — the pre-fix baseline. */
const ARTIFACTLESS_BASELINE_TABLES = [
  'sys_metadata',
  'sys_metadata_audit',
  'sys_metadata_commit',
  'sys_metadata_history',
  'sys_view_definition',
];

describe('os migrate plan/apply compose the deployment\'s own object set (#12938)', () => {
  let dir: string;
  let dbFile: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-12938-'));
    dbFile = join(dir, 'control.db');

    // A host config whose whole object set comes from a plugin — the shape
    // ObjectStack Cloud's control plane has (`createCloudStack()` returns the
    // plugins; the app has no compiled artifact at all).
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

    savedEnv.NODE_ENV = process.env.NODE_ENV;
    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    // No auto-reconcile at boot, so whatever `plan` reports is exactly what an
    // operator would see before any DDL touches their database.
    process.env.NODE_ENV = 'production';
    // The fixture is deliberately artifact-LESS: the config is the only host.
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  });

  afterAll(() => {
    if (savedEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.OS_ARTIFACT_PATH === undefined) delete process.env.OS_ARTIFACT_PATH;
    else process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /** Boot the way `os migrate plan` / `apply` do. */
  const bootLikeMigrate = () => bootSchemaStack({
    jsonOutput: false,
    databaseUrl: `file:${dbFile}`,
    deferSchemaDdl: true,
    composeHostStack: true,
    projectRoot: dir,
  });

  const indexNames = async (driver: any, table: string): Promise<string[]> => {
    const rows: any = await driver.knex.raw(
      "select name from sqlite_master where type = 'index' and tbl_name = ?",
      [table],
    );
    return (Array.isArray(rows) ? rows : (rows?.rows ?? [])).map((r: any) => r.name).sort();
  };

  const countRows = async (driver: any, table: string): Promise<number> => {
    const rows: any = await driver.knex(table).count({ c: '*' });
    return Number((Array.isArray(rows) ? rows[0] : rows)?.c ?? -1);
  };

  it('registers the host config\'s objects — well above the five-table baseline', async () => {
    const stack = await bootLikeMigrate();
    try {
      expect(stack.driver).toBeTruthy();
      expect(stack.composition.hostConfigLoaded).toBe(true);
      expect(stack.composition.hostConfigPath).toBe(join(dir, 'objectstack.config.ts'));

      // The number the consumer-side coverage gate reads. Strictly greater than
      // the baseline, and by more than one: the security plugin alone brings six
      // RBAC tables and the platform floor another four.
      expect(stack.managedTableCount).toBeGreaterThan(ARTIFACTLESS_BASELINE_TABLES.length);

      const pending = stack.pendingSchemaWork.map((p) => p.table);
      // The two tables the issue names by hand, neither of which was reachable
      // from a migrate boot at all.
      expect(pending).toContain('sys_position');
      expect(pending).toContain('sys_permission_set');
      // …and the platform floor `serve` composes unconditionally.
      expect(pending).toContain('sys_migration');
      for (const table of ARTIFACTLESS_BASELINE_TABLES) expect(pending).toContain(table);

      // Create them, the way `os migrate apply` does after confirmation.
      const created = await stack.flushSchemaDdl();
      expect(created.length).toBe(stack.pendingSchemaWork.length);
    } finally {
      await stack.shutdown();
    }
  });

  it('SEES the legacy platform-wide unique its own boot message prescribes this command for', async () => {
    // Degrade `sys_position` to the pre-respelling physical shape: the
    // per-organization composite retired, the global single-column unique back.
    // This is cloud#1695's index, verbatim.
    {
      const stack = await bootLikeMigrate();
      const k = (stack.driver as any).knex;
      await k.raw('DROP INDEX uniq_sys_position_organization_id_name');
      await k.raw('CREATE UNIQUE INDEX uniq_sys_position_name ON sys_position (name)');
      await k('sys_position').insert({
        id: 'pos_1',
        name: 'org_admin',
        label: 'Org Admin',
        organization_id: 'org_jia',
      });
      await stack.shutdown();
    }

    const stack = await bootLikeMigrate();
    try {
      const drift = await stack.driver!.detectManagedDrift();
      const entry = drift.find(
        (d) => d.table === 'sys_position' && d.op.type === 'replace_unique_index',
      );
      expect(entry, 'the legacy platform-wide unique must be planned, not invisible').toBeDefined();
      expect(entry!.category).toBe('safe');
      expect(entry!.op).toMatchObject({
        table: 'sys_position',
        dropIndexNames: ['uniq_sys_position_name'],
        createIndexName: 'uniq_sys_position_organization_id_name',
        createColumns: ['organization_id', 'name'],
      });
      // The prescription that made this a contract rather than an incomplete report.
      expect(entry!.message).toContain('os migrate apply');
    } finally {
      await stack.shutdown();
    }
  });

  it('writes NOTHING while planning — no host seeder runs', async () => {
    const stack = await bootLikeMigrate();
    try {
      await stack.driver!.detectManagedDrift();

      // The absence that matters. `SecurityPlugin.start()` bootstraps
      // `admin_full_access`, `organization_admin`, `member_default` and the rest;
      // fully started, it attempted 14 inserts into this table during a plan.
      expect(await countRows(stack.driver, 'sys_permission_set')).toBe(0);
      expect(await countRows(stack.driver, 'sys_position')).toBe(1);
      // The legacy index is still there — a plan proposes, it does not apply.
      expect(await indexNames(stack.driver, 'sys_position')).toContain('uniq_sys_position_name');
    } finally {
      await stack.shutdown();
    }
  });

  it('applies the replacement without --allow-destructive, keeps the row, and converges', async () => {
    {
      const stack = await bootLikeMigrate();
      try {
        const drift = await stack.driver!.detectManagedDrift();
        const { applied, skipped } = await stack.driver!.applyMigrationEntries(
          drift,
          { allowDestructive: false },
        );
        expect(applied.some((d) => d.op.type === 'replace_unique_index')).toBe(true);
        expect(skipped).toHaveLength(0);

        const after = await indexNames(stack.driver, 'sys_position');
        expect(after).toContain('uniq_sys_position_organization_id_name');
        expect(after).not.toContain('uniq_sys_position_name');
        expect(await countRows(stack.driver, 'sys_position')).toBe(1);
      } finally {
        await stack.shutdown();
      }
    }

    // A re-plan over the SAME composed set is clean — the plan converges rather
    // than proposing the same relaxation forever.
    const replan = await bootLikeMigrate();
    try {
      expect(await replan.driver!.detectManagedDrift()).toHaveLength(0);
      expect(replan.pendingSchemaWork).toHaveLength(0);
      expect(replan.managedTableCount).toBeGreaterThan(ARTIFACTLESS_BASELINE_TABLES.length);
    } finally {
      await replan.shutdown();
    }
  });
});

describe('an artifact-less, config-less project is unchanged (#12938 baseline pin)', () => {
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-12938-bare-'));
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    process.env.NODE_ENV = 'production';
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  });

  afterAll(() => {
    if (savedEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.OS_ARTIFACT_PATH === undefined) delete process.env.OS_ARTIFACT_PATH;
    else process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('still examines exactly the five data-stack tables and composes nothing', async () => {
    // The five-table baseline is LEGITIMATE here — there is no deployment to
    // mirror — and the fix must not move it. It is also the number the
    // consumer-side coverage gate is calibrated against, so it is pinned by
    // value and by membership rather than by "greater than".
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${join(dir, 'bare.db')}`,
      deferSchemaDdl: true,
      composeHostStack: true,
      projectRoot: dir,
    });
    try {
      expect(stack.managedTableCount).toBe(ARTIFACTLESS_BASELINE_TABLES.length);
      expect(stack.pendingSchemaWork.map((p) => p.table).sort())
        .toEqual([...ARTIFACTLESS_BASELINE_TABLES].sort());
      expect(await stack.driver!.detectManagedDrift()).toHaveLength(0);

      // Empty notes are what make `os migrate plan --json` emit the SAME
      // document it always did: the `composition` key is spread in only when
      // there is something to report.
      expect(stack.composition.notes).toEqual([]);
      expect(stack.composition.plugins).toEqual([]);
      expect(stack.composition.hostConfigPath).toBeNull();
      expect(stack.composition.hostConfigLoaded).toBe(false);
    } finally {
      await stack.shutdown();
    }
  });
});
