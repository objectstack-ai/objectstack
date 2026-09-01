// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
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

    // Materialize the deployment's tables the way `os migrate apply` does —
    // boot deferred, then flush — so the drift cases below start from a
    // database that exists and each one can arrange its own state.
    const boot = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      deferSchemaDdl: true,
      composeHostStack: true,
      projectRoot: dir,
    });
    try {
      await boot.flushSchemaDdl();
    } finally {
      await boot.shutdown();
    }
  }, 60_000);

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

  /**
   * Put `sys_position` back into the pre-respelling physical shape — the
   * per-organization composite retired, the global single-column unique
   * present. This is cloud#1695's index, verbatim.
   *
   * Idempotent, and called by every test that needs it, so the cases below do
   * not depend on each other's order. An integration file whose third test only
   * passes because the second ran is a suite that reports the wrong thing the
   * first time one of them is skipped.
   */
  const degradeToLegacyUnique = async (): Promise<void> => {
    const stack = await bootLikeMigrate();
    try {
      const k = (stack.driver as any).knex;
      const present = await indexNames(stack.driver, 'sys_position');
      if (present.includes('uniq_sys_position_organization_id_name')) {
        await k.raw('DROP INDEX uniq_sys_position_organization_id_name');
      }
      if (!present.includes('uniq_sys_position_name')) {
        await k.raw('CREATE UNIQUE INDEX uniq_sys_position_name ON sys_position (name)');
      }
      if (await countRows(stack.driver, 'sys_position') === 0) {
        await k('sys_position').insert({
          id: 'pos_1',
          name: 'org_admin',
          label: 'Org Admin',
          organization_id: 'org_jia',
        });
      }
    } finally {
      await stack.shutdown();
    }
  };

  it('registers the host config\'s objects — well above the five-table baseline', async () => {
    // A database of its own: this case is about what a FRESH target reports as
    // pending, which is only observable before anything created the tables.
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${join(dir, 'fresh.db')}`,
      deferSchemaDdl: true,
      composeHostStack: true,
      projectRoot: dir,
    });
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

      // And they really are creatable — the work `os migrate apply` flushes
      // after confirmation.
      const created = await stack.flushSchemaDdl();
      expect(created.length).toBe(stack.pendingSchemaWork.length);
    } finally {
      await stack.shutdown();
    }
  }, 60_000);

  it('SEES the legacy platform-wide unique its own boot message prescribes this command for', async () => {
    await degradeToLegacyUnique();

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
  }, 60_000);

  it('writes NOTHING while planning — no host seeder runs', async () => {
    await degradeToLegacyUnique();

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
  }, 60_000);

  it('applies the replacement without --allow-destructive, keeps the row, and converges', async () => {
    await degradeToLegacyUnique();
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
  }, 60_000);
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
  }, 60_000);
});

/**
 * #13028 — the shape that measured 8 tables out of ~80, reproduced.
 *
 * ## What the earlier fixture could not see
 *
 * The `SecurityPlugin`-only fixture above composes a host plugin next to the
 * standalone stack's OWN `ObjectQLPlugin`, and that plugin's `start()` runs
 * normally — so the pass that hands registered objects to their driver
 * (`installRegisteredSchemas` → `registerObjectMetadata`, the one thing that
 * fills the `managedObjectFields` map `detectManagedDrift()` diffs) happens by
 * itself, and the composition looks complete.
 *
 * A real control plane does not have that shape. ObjectStack Cloud's config
 * brings its own `ObjectQLPlugin`, behind a lazy wrapper, under the FRAMEWORK'S
 * OWN plugin name — deliberately, so the CLI's capability injector de-dups
 * against it. Duplicate registration OVERWRITES by name
 * (`packages/core/src/plugin-registration.ts`), so the host's wrapper DISPLACES
 * the standalone plugin, and `composeForDeclarations` then suppresses the
 * wrapper's `start()`. The result is a boot in which NO `ObjectQLPlugin.start()`
 * runs at all: every host plugin's `init()` declared its objects, and not one
 * of them was ever handed to a driver.
 *
 * Measured consequence, staging control plane, framework `15d55fb2430f`:
 * 36 plugins composed, ~80 `sys_*` tables declared, **8** examined — and all
 * eight belonged to `service-messaging`, the one service that provisions its
 * own tables from a `kernel:ready` hook instead of relying on that pass.
 *
 * ⚠️ The plugin NAMES in the fixture below are load-bearing, not decoration.
 * Rename `com.objectstack.engine.objectql` to anything else and the two
 * plugins coexist, both `init()`s run, and the boot dies on
 * `Service 'objectql' already registered` — a different defect, and the
 * fixture would stop reproducing this one.
 */
describe('a host that brings its OWN ObjectQL engine (#13028 — cloud\'s measured shape)', () => {
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-13028-'));
    mkdirSync(join(dir, 'node_modules', '@objectstack'), { recursive: true });
    symlinkSync(
      securityPackageRoot(),
      join(dir, 'node_modules', '@objectstack', 'plugin-security'),
      'dir',
    );
    symlinkSync(
      resolve(dirname(require_.resolve('@objectstack/objectql')), '..'),
      join(dir, 'node_modules', '@objectstack', 'objectql'),
      'dir',
    );

    writeFileSync(
      join(dir, 'objectstack.config.ts'),
      [
        "import { ObjectQLPlugin } from '@objectstack/objectql';",
        "import { SecurityPlugin } from '@objectstack/plugin-security';",
        '',
        '// `lazyPlugin` from ObjectStack Cloud\'s control-plane preset, in shape:',
        '// construction deferred to init(), start()/stop() forwarded, and NO',
        '// `destroy` — which is the other half of this seam (#13027).',
        'function lazyPlugin(name: string, factory: () => Promise<any>): any {',
        '  let impl: any = null;',
        '  return {',
        '    name,',
        '    async init(ctx: any) { impl = await factory(); if (impl?.init) await impl.init(ctx); },',
        '    async start(ctx: any) { if (impl?.start) await impl.start(ctx); },',
        '    async stop(ctx: any) { if (impl?.stop) await impl.stop(ctx); },',
        '  };',
        '}',
        '',
        'export default {',
        '  plugins: [',
        "    lazyPlugin('com.objectstack.engine.objectql', async () => new ObjectQLPlugin({ registerProtocol: false })),",
        "    lazyPlugin('com.objectstack.security', async () => new SecurityPlugin()),",
        '  ],',
        '};',
        '',
      ].join('\n'),
    );

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

  it('examines the objects its host DECLARED, and says so in the coverage payload', async () => {
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${join(dir, 'own-engine.db')}`,
      deferSchemaDdl: true,
      composeHostStack: true,
      projectRoot: dir,
    });
    try {
      expect(stack.composition.hostConfigLoaded).toBe(true);

      const coverage = stack.composition.coverage;
      expect(coverage, 'a composed boot must report its own boundary').not.toBeNull();
      // The declared set is real — the security family plus the platform floor
      // plus the data stack — and every one of them is in the diffed set.
      expect(coverage!.registeredObjects).toBeGreaterThan(ARTIFACTLESS_BASELINE_TABLES.length);
      expect(coverage!.examinedObjects).toBe(coverage!.registeredObjects);
      expect(coverage!.unexaminedObjects).toBe(0);

      // …and the count the consumer gate reads agrees with it, rather than
      // being a second, differently-derived number.
      expect(stack.managedTableCount).toBe(coverage!.examinedObjects);

      // The two tables #12938 named by hand as the proof the five-table set was
      // wrong. Pre-#13028 this shape reached NEITHER.
      const pending = stack.pendingSchemaWork.map((p) => p.table);
      expect(pending).toContain('sys_position');
      expect(pending).toContain('sys_permission_set');

      // Full coverage means SILENCE about coverage: the honesty note exists to
      // mark a shortfall, and one that printed anyway would train readers to
      // skip the line that matters.
      expect(stack.composition.notes.join(' ')).not.toContain('PARTIAL');
    } finally {
      await stack.shutdown();
    }
  }, 60_000);

  it('still writes NOTHING — the declaration-phase suppression is intact', async () => {
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${join(dir, 'own-engine-writes.db')}`,
      deferSchemaDdl: true,
      composeHostStack: true,
      projectRoot: dir,
    });
    try {
      await stack.driver!.detectManagedDrift();
      // The binding this card adds is `registerObjectMetadata` — in-memory
      // assignment on the driver. If it had reached `initObjects` instead, the
      // table would exist here.
      const k = (stack.driver as any).knex;
      const exists = await k.schema.hasTable('sys_permission_set');
      expect(exists, 'a plan must not create a table on its way to a coverage number').toBe(false);
    } finally {
      await stack.shutdown();
    }
  }, 60_000);
});

/**
 * #13332 — the same guarantee, end to end, against a real SQL driver.
 *
 * The unit half
 * (`schema-migration-plugins.declaration-boot-write-guard.test.ts`) pins the
 * mechanism on a recording driver. This half proves the property the operator
 * actually depends on: `os migrate plan`'s boot, with a host plugin that
 * registers a writing hook from `init()`, leaves the DATABASE unchanged — on a
 * database whose tables already exist, which is the condition under which the
 * measured inserts SUCCEED instead of failing.
 *
 * The positive control comes first and is load-bearing. The identical plugin,
 * on a boot that composes no host stack (so no declaration composition and no
 * write guard), lands its rows. Without that leg the assertion below would be
 * green over a fixture that could not have written.
 */
describe('a plan writes nothing even when the host writes from init() (#13332)', () => {
  let dir: string;
  let dbFile: string;
  let hookLog: string;
  const savedEnv: Record<string, string | undefined> = {};

  const PHASES = ['kernel:ready', 'kernel:bootstrapped', 'kernel:listening'] as const;

  /**
   * cloud's measured shape, as a plugin this file can hand to either boot: the
   * writing hooks are registered from `init()`, so `composeForDeclarations`'s
   * `start()` suppression never sees them, and they fire on each of the three
   * phases `kernel.ts` triggers unconditionally after the suppressed pass.
   *
   * The driver is found by scanning `driver.*` — the same surface
   * `ObjectQLPlugin`'s discovery loop reads — rather than by naming one, so the
   * fixture does not depend on what the standalone stack calls its default.
   */
  const initWritingPlugin = (tag: string): any => ({
    name: `com.example.writes-from-init.${tag}`,
    version: '1.0.0',
    init: async (ctx: any) => {
      for (const phase of PHASES) {
        ctx.hook(phase, async () => {
          appendFileSync(hookLog, `${tag}|log-only|${phase}\n`);
        });
        ctx.hook(phase, async () => {
          const services: Map<string, any> = ctx.getServices();
          const entry = [...services.entries()].find(([n]) => n.startsWith('driver.'));
          if (!entry) return;
          await entry[1].create('sys_metadata', {
            id: `os13332-${tag}-${phase}`,
            name: `os13332-${tag}-${phase}`,
            type: 'os13332_probe',
          });
          appendFileSync(hookLog, `${tag}|write|${phase}\n`);
        });
      }
    },
  });

  const probeRows = async (driver: any): Promise<number> => {
    const rows: any = await driver.knex('sys_metadata')
      .where({ type: 'os13332_probe' })
      .count({ c: '*' });
    return Number((Array.isArray(rows) ? rows[0] : rows)?.c ?? -1);
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-13332-'));
    dbFile = join(dir, 'control.db');
    hookLog = join(dir, 'hooks.log');
    writeFileSync(hookLog, '');

    savedEnv.NODE_ENV = process.env.NODE_ENV;
    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    process.env.NODE_ENV = 'production';
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');

    // Materialize `sys_metadata` FIRST, with no host config on disk yet. The
    // measured defect is precisely that on a database whose tables EXIST the
    // inserts succeed rather than fail, so neither case below may run against
    // an empty schema — and the fixture must not depend on the fix to build
    // itself: with the guard ablated, a writing hook against a table that does
    // not exist yet THROWS, and boot hooks dispatch propagating, so the whole
    // bootstrap dies. Setting the schema up before the writer exists keeps an
    // ablation landing on the assertions below instead of on this hook.
    const boot = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      deferSchemaDdl: true,
      composeHostStack: false,
      projectRoot: dir,
    });
    try {
      await boot.flushSchemaDdl();
    } finally {
      await boot.shutdown();
    }

    // A host config carrying the SAME plugin shape, so the composed path is
    // exercised as an operator would hit it — the plugin comes out of
    // `objectstack.config.ts`, through `composeForDeclarations`.
    writeFileSync(
      join(dir, 'objectstack.config.ts'),
      [
        "import { appendFileSync } from 'node:fs';",
        '',
        `const LOG = ${JSON.stringify(hookLog)};`,
        "const PHASES = ['kernel:ready', 'kernel:bootstrapped', 'kernel:listening'];",
        '',
        'export default {',
        '  plugins: [{',
        "    name: 'com.example.host-writes-from-init',",
        "    version: '1.0.0',",
        '    init: async (ctx: any) => {',
        '      for (const phase of PHASES) {',
        "        ctx.hook(phase, async () => { appendFileSync(LOG, `host|log-only|${phase}\\n`); });",
        '        ctx.hook(phase, async () => {',
        '          const entry = [...ctx.getServices().entries()]',
        "            .find(([n]: [string, unknown]) => n.startsWith('driver.'));",
        '          if (!entry) return;',
        "          await entry[1].create('sys_metadata', {",
        '            id: `os13332-host-${phase}`,',
        '            name: `os13332-host-${phase}`,',
        "            type: 'os13332_probe',",
        '          });',
        "          appendFileSync(LOG, `host|write|${phase}\\n`);",
        '        });',
        '      }',
        '    },',
        '  }],',
        '};',
        '',
      ].join('\n'),
    );

    writeFileSync(hookLog, '');
  }, 60_000);

  afterAll(() => {
    if (savedEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.OS_ARTIFACT_PATH === undefined) delete process.env.OS_ARTIFACT_PATH;
    else process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('POSITIVE CONTROL: the same plugin lands three rows on a boot with no declaration composition', async () => {
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      deferSchemaDdl: true,
      // No host composition ⇒ no declaration wrapper and no write guard. This
      // is the leg that proves the fixture can write at all.
      composeHostStack: false,
      extraPlugins: [initWritingPlugin('control')],
      projectRoot: dir,
    });
    try {
      expect(await probeRows(stack.driver)).toBe(3);
      const log = readFileSync(hookLog, 'utf8');
      for (const phase of PHASES) expect(log).toContain(`control|write|${phase}`);
    } finally {
      await stack.shutdown();
    }
  }, 60_000);

  it('THE FIX: the declaration boot lands none of them — from the host config or from anywhere else', async () => {
    const before = await (async () => {
      const s = await bootSchemaStack({
        jsonOutput: false,
        databaseUrl: `file:${dbFile}`,
        deferSchemaDdl: true,
        composeHostStack: false,
        projectRoot: dir,
      });
      try { return await probeRows(s.driver); } finally { await s.shutdown(); }
    })();
    // The control's three rows are still there — this case measures a DELTA,
    // not an empty table, so a fixture that silently stopped writing cannot
    // pass it.
    expect(before).toBe(3);

    writeFileSync(hookLog, '');
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      deferSchemaDdl: true,
      composeHostStack: true,
      // Both routes at once: the host config's own plugin (composed through
      // `composeForDeclarations`) and one handed straight to the kernel. The
      // guard sits at the driver, so neither reaches the database.
      extraPlugins: [initWritingPlugin('extra')],
      projectRoot: dir,
    });
    try {
      expect(await probeRows(stack.driver)).toBe(before);

      const log = readFileSync(hookLog, 'utf8');

      // The property (b) was chosen for: the hooks RAN — the log-only ones
      // included — on the path an operator reads before a production apply.
      for (const phase of PHASES) {
        expect(log).toContain(`host|log-only|${phase}`);
        expect(log).toContain(`extra|log-only|${phase}`);
        // …and the writing hooks got all the way to their `create()` call,
        // which returned instead of throwing: the line after it was reached.
        expect(log).toContain(`host|write|${phase}`);
        expect(log).toContain(`extra|write|${phase}`);
      }

      // The refusals are REPORTED, not swallowed — this is the line the plan
      // prints and `--json` carries. No raw execute() went through on this
      // boot, so the outcome claim HELD and is printed with the report.
      const notes = stack.composition.notes.join(' ');
      expect(notes).toContain('Refused 6 write(s) during the declaration boot — a plan writes nothing');
      expect(notes).toContain('create() on sys_metadata');
    } finally {
      await stack.shutdown();
    }
  }, 60_000);

  it('R1 (#14053): a raw execute() is FORWARDED — the row lands — and the run reports it instead of claiming it wrote nothing', async () => {
    // The at-tier review's own control shape, pinned: in one guarded boot, a
    // hook issues a contract write (refused — the in-run control) and a raw
    // `execute("INSERT …")`. `execute()` is a REQUIRED member of `IDataDriver`
    // (`packages/spec/src/contracts/data-driver.ts`, "Raw Execution (Escape
    // Hatch)"), and the guard cannot classify a raw command as read-vs-write,
    // so the row LANDS — that is the documented behaviour, not the defect.
    // The defect was the SILENT half: before this case's fix, the same run
    // printed "a plan writes nothing" and a refusal list that looked
    // complete. Now the notes name the forwarded call and drop the claim.
    const rawWritingPlugin: any = {
      name: 'com.example.raw-execute-from-init',
      version: '1.0.0',
      init: async (ctx: any) => {
        ctx.hook('kernel:ready', async () => {
          const entry = [...ctx.getServices().entries()]
            .find(([n]: [string, unknown]) => n.startsWith('driver.'));
          if (!entry) return;
          const driver = entry[1];
          // In-run control: the guarded surface refuses this one.
          await driver.create('sys_metadata', {
            id: 'os14053-create-probe',
            name: 'os14053-create-probe',
            type: 'os14053_create_probe',
          });
          // The escape hatch: forwarded, so this one LANDS.
          await driver.execute(
            "INSERT INTO sys_metadata (id, name, type) VALUES "
            + "('os14053-exec-probe', 'os14053-exec-probe', 'os14053_exec_probe')",
          );
        });
      },
    };

    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      deferSchemaDdl: true,
      composeHostStack: true,
      extraPlugins: [rawWritingPlugin],
      projectRoot: dir,
    });
    try {
      const countByType = async (type: string) => {
        const rows: any = await (stack.driver as any).knex('sys_metadata')
          .where({ type }).count({ c: '*' });
        return Number((Array.isArray(rows) ? rows[0] : rows)?.c ?? -1);
      };
      // The control half: the contract write was refused.
      expect(await countByType('os14053_create_probe')).toBe(0);
      // The escape hatch half: the raw INSERT landed — forwarded on purpose.
      expect(await countByType('os14053_exec_probe')).toBe(1);

      // …and the run SAYS so. The refusal line drops the flat claim (the
      // colon directly after "boot" is the dropped phrase), the forwarded
      // call is named with its count, and no note in the run claims the
      // plan wrote nothing. 4 refusals: the host config's plugin on three
      // phases, plus this fixture's in-run control.
      const notes = stack.composition.notes.join(' ');
      expect(notes).toContain('Refused 4 write(s) during the declaration boot:');
      expect(notes).toContain('Raw execute() was called 1 time(s) during the declaration boot');
      expect(notes).not.toContain('a plan writes nothing');

      // The guard's structural surface carries it too, for `--json` consumers.
      expect(stack.composition.writeGuard?.rawExecutions).toEqual([
        expect.objectContaining({ count: 1 }),
      ]);
    } finally {
      await stack.shutdown();
    }
  }, 60_000);
});
