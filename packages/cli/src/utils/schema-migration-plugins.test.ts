// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findHostConfig,
  composeForDeclarations,
  buildSchemaMigrationPlugins,
  measureComposedCoverage,
  describeUnloadableHostConfig,
  type SchemaMigrationComposition,
} from './schema-migration-plugins.js';

/**
 * Unit half of #12938 — the composition's own decisions, without a database.
 *
 * The integration half (`schema-migrate.host-composition.integration.test.ts`)
 * proves the composed set reaches the driver and that a `plan` over it writes
 * nothing. This file pins the three decisions that file cannot isolate: which
 * config spellings count, what a declaration-phase composition preserves and
 * suppresses, and what is composed for each of the three shapes a project can
 * be in (no host at all / a host that loads / a host that does not).
 */

const dirs: string[] = [];
function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-12938-unit-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe('findHostConfig', () => {
  it('returns null when the directory holds no config — the shape that must stay unchanged', () => {
    expect(findHostConfig(tempProject())).toBeNull();
  });

  it.each(['objectstack.config.ts', 'objectstack.config.js', 'objectstack.config.mjs'])(
    'finds %s',
    (name) => {
      const dir = tempProject();
      writeFileSync(join(dir, name), 'export default {};\n');
      expect(findHostConfig(dir)).toBe(join(dir, name));
    },
  );

  it('prefers .ts over .js, the same order resolveConfigPath auto-detects in', () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'objectstack.config.js'), 'export default {};\n');
    writeFileSync(join(dir, 'objectstack.config.ts'), 'export default {};\n');
    expect(findHostConfig(dir)).toBe(join(dir, 'objectstack.config.ts'));
  });
});

describe('composeForDeclarations', () => {
  class FakePlugin {
    name = 'com.example.fake';
    version = '2.1.0';
    type = 'standard';
    dependencies = ['com.objectstack.engine.objectql'];
    optionalDependencies = ['com.example.optional'];
    requiresServices = ['manifest'];
    providesServices = ['example.thing'];
    calls: string[] = [];
    async init(): Promise<void> { this.calls.push('init'); }
    async start(): Promise<void> { this.calls.push('start'); }
    async destroy(): Promise<void> { this.calls.push('destroy'); }
  }

  it('runs init, does NOT run start, and still forwards destroy', async () => {
    const inner = new FakePlugin();
    const wrapped = composeForDeclarations(inner);

    await wrapped.init();
    await wrapped.start();
    await wrapped.destroy();

    // `start` is the phase every measured seeder writes from; `init` is where
    // the kernel contract puts the object declarations this command needs.
    expect(inner.calls).toEqual(['init', 'destroy']);
  });

  it('preserves every member the kernel orders and de-dups on', () => {
    const inner = new FakePlugin();
    const wrapped = composeForDeclarations(inner);

    expect(wrapped.name).toBe('com.example.fake');
    expect(wrapped.version).toBe('2.1.0');
    expect(wrapped.type).toBe('standard');
    expect(wrapped.dependencies).toEqual(['com.objectstack.engine.objectql']);
    expect(wrapped.optionalDependencies).toEqual(['com.example.optional']);
    expect(wrapped.requiresServices).toEqual(['manifest']);
    expect(wrapped.providesServices).toEqual(['example.thing']);
  });

  it('leaves constructor.name readable — `serve`\'s presence tests read it', () => {
    // A bound function reports `'bound FakePlugin'`, which would defeat every
    // `p?.constructor?.name === 'X'` check in the CLI, this module's own
    // PlatformObjectsPlugin de-dup included.
    expect(composeForDeclarations(new FakePlugin()).constructor.name).toBe('FakePlugin');
  });

  it('keeps `this` pointed at the target, so private state still resolves', async () => {
    class Private {
      #secret = 'kept';
      name = 'com.example.private';
      async init(): Promise<void> { /* nothing */ }
      read(): string { return this.#secret; }
    }
    expect(composeForDeclarations(new Private()).read()).toBe('kept');
  });
});

describe('buildSchemaMigrationPlugins', () => {
  it('composes NOTHING with neither a host config nor an artifact app', async () => {
    // The five-table baseline is the honest answer where there is no deployment
    // to mirror, and this early return is what keeps that run byte-identical.
    const out = await buildSchemaMigrationPlugins({ basePlugins: [], cwd: tempProject() });
    expect(out.plugins).toEqual([]);
    expect(out.notes).toEqual([]);
    expect(out.hostConfigPath).toBeNull();
    expect(out.hostConfigLoaded).toBe(false);
  });

  it('composes the platform floor once an artifact app is present, and not twice', async () => {
    const artifactApp = { type: 'app', name: 'plugin.app.demo' };
    const out = await buildSchemaMigrationPlugins({
      basePlugins: [artifactApp],
      cwd: tempProject(),
    });
    expect(out.plugins).toHaveLength(1);
    expect((out.plugins[0] as any)?.name).toBe('com.objectstack.platform-objects');

    // A host that already brought one gets nothing added — `serve` 5c's rule.
    const already = await buildSchemaMigrationPlugins({
      basePlugins: [artifactApp, { name: 'com.objectstack.platform-objects' }],
      cwd: tempProject(),
    });
    expect(already.plugins).toEqual([]);
  });

  it('composes a host config\'s plugins for their declarations only', async () => {
    const dir = tempProject();
    writeFileSync(
      join(dir, 'objectstack.config.ts'),
      [
        'class DemoPlugin {',
        "  name = 'com.example.demo';",
        '  async init() {}',
        '  async start() { throw new Error(\'start must not run under os migrate\'); }',
        '}',
        'export default { plugins: [new DemoPlugin()] };',
        '',
      ].join('\n'),
    );

    const out = await buildSchemaMigrationPlugins({ basePlugins: [], cwd: dir });
    expect(out.hostConfigPath).toBe(join(dir, 'objectstack.config.ts'));
    expect(out.hostConfigLoaded).toBe(true);
    // The host plugin, plus the platform floor.
    expect(out.plugins).toHaveLength(2);

    const demo = out.plugins.find((p: any) => p?.name === 'com.example.demo') as any;
    expect(demo, 'the host plugin must be composed').toBeDefined();
    await expect(demo.init()).resolves.toBeUndefined();
    // The suppression is the whole point: the config's own `start` throws, and
    // reaching it would be the measured defect (a dry run that writes).
    await expect(demo.start()).resolves.toBeUndefined();

    expect(out.notes.join(' ')).toContain('declarations only');
  });

  it('reports a config it could not load rather than pretending it composed one', async () => {
    const dir = tempProject();
    writeFileSync(
      join(dir, 'objectstack.config.ts'),
      "throw new Error('fixture: OS_SOME_SECRET is required');\n",
    );

    const out = await buildSchemaMigrationPlugins({ basePlugins: [], cwd: dir });

    // The composition still COMPLETES — the reduced set is composed and
    // returned. What changed with #12953 is the verdict the COMMANDS draw from
    // it (a non-zero exit), not whether this function throws.
    expect(out.hostConfigPath).toBe(join(dir, 'objectstack.config.ts'));
    // …and it must be DISTINGUISHABLE. `managedTables` alone cannot say this:
    // the platform floor still lands, so the count rises either way.
    expect(out.hostConfigLoaded).toBe(false);
    const said = out.notes.join(' ');
    expect(said).toContain('could not be loaded');
    expect(said).toContain('UNMEASURED');
    // [#12953] The underlying failure, carried structurally so the refusal can
    // NAME it rather than re-parsing the prose above.
    expect(out.hostConfigError).toContain('OS_SOME_SECRET is required');
  });

  it('leaves hostConfigError null when there is no host config at all', async () => {
    const none = await buildSchemaMigrationPlugins({ basePlugins: [], cwd: tempProject() });
    expect(none.hostConfigError).toBeNull();
  });

  it('leaves hostConfigError null when the host config LOADS', async () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'objectstack.config.ts'), 'export default { objects: [] };\n');
    const loaded = await buildSchemaMigrationPlugins({ basePlugins: [], cwd: dir });
    expect(loaded.hostConfigLoaded).toBe(true);
    expect(loaded.hostConfigError).toBeNull();
    // Loading a real config runs `bundle-require`/esbuild — well past the 5 s
    // default on a cold, shared box.
  }, 60_000);
});

/**
 * #12953 — the predicate behind the non-zero exit, in all three directions.
 *
 * Maintainer ruling 2026-08-29 (verbatim 「同意」): a host config that EXISTS
 * and could not be loaded makes `os migrate plan` / `apply` exit non-zero,
 * because a green exit over an UNMEASURED partial metadata set is the
 * false-green a migration tool must never emit. The ruling pinned the OTHER
 * two directions just as hard — config absent, and config loadable, both keep
 * today's behaviour — so all three are pinned here.
 *
 * ⚠️ The trap this file exists to hold: `hostConfigLoaded` is `false` on the
 * config-ABSENT shape too (nothing loaded, because there was nothing to load).
 * A predicate written as `!hostConfigLoaded` therefore turns the untouched
 * population red, and every assertion about direction 1 still passes while it
 * does. The second case below is the one that fails if anyone writes it that
 * way.
 *
 * The exit STATUS itself is pinned over a real child process in
 * `packages/cli/test/migrate-unloadable-host-config-exit.e2e.test.ts` — a
 * `process.exitCode` set inside a vitest worker is not an exit status.
 */
describe('describeUnloadableHostConfig (#12953)', () => {
  function composition(over: Partial<SchemaMigrationComposition>): SchemaMigrationComposition {
    return {
      plugins: [], hostConfigPath: null, hostConfigLoaded: false, hostConfigError: null,
      notes: [], coverage: null, ...over,
    };
  }

  it('direction 1 — config PRESENT and unloadable: names the config, the cause and the remedy', () => {
    const said = describeUnloadableHostConfig(composition({
      hostConfigPath: '/srv/app/objectstack.config.ts',
      hostConfigLoaded: false,
      hostConfigError: 'Missing required environment variable AUTH_SECRET',
    }));

    expect(said).not.toBeNull();
    // The three things the ruling requires the error to name.
    expect(said).toContain('/srv/app/objectstack.config.ts');
    expect(said).toContain('Missing required environment variable AUTH_SECRET');
    expect(said).toMatch(/Remedy:/);
    // And that it is a FAILURE, not another warning — the whole point.
    expect(said).toContain('UNMEASURED');
  });

  it('direction 2 — config ABSENT: null, even though hostConfigLoaded is false', () => {
    // `hostConfigPath === null` with `hostConfigLoaded === false` is the
    // untouched population. If this ever answers non-null, every project with
    // no config starts failing `os migrate plan`.
    expect(describeUnloadableHostConfig(composition({
      hostConfigPath: null, hostConfigLoaded: false,
    }))).toBeNull();
  });

  it('direction 3 — config PRESENT and loadable: null', () => {
    expect(describeUnloadableHostConfig(composition({
      hostConfigPath: '/srv/app/objectstack.config.ts', hostConfigLoaded: true,
    }))).toBeNull();
  });

  it('still names something when the load threw without a message', () => {
    const said = describeUnloadableHostConfig(composition({
      hostConfigPath: '/srv/app/objectstack.config.mjs', hostConfigLoaded: false,
      hostConfigError: null,
    }));
    expect(said).toContain('/srv/app/objectstack.config.mjs');
    expect(said).toContain('the load threw without a message');
  });
});

/**
 * #13028 — the plan reports its own BOUNDARY.
 *
 * The card's measurement: 36 host plugins composed on ObjectStack Cloud's
 * staging control plane, ~80 `sys_*` tables declared, **8** examined, and every
 * consumer-visible signal green — the config loaded, the composition printed a
 * healthy note, the plan named real tables. A coverage gate reading
 * `managedTables` passed over a plan that had not looked at most of the
 * deployment.
 *
 * These cases pin the discriminator that gate needed. They use engine doubles
 * rather than a boot: the integration file owns "does a real composed boot now
 * reach the driver", and what is isolated here is the REPORT — which is the
 * half that has to stay honest even when the coverage does not.
 */
describe('measureComposedCoverage (#13028)', () => {
  /**
   * A driver double. `syncSchema` is the method `engine.syncObjectSchema()`
   * requires and `SqlDriver` implements — its presence is what separates a SQL
   * driver from one that cannot register a managed schema at all.
   */
  const driverDouble = (name: string) => ({ name, syncSchema: async () => undefined });

  /** An engine double: a registry, driver resolution, and the sync entry point. */
  const engineDouble = (opts: {
    objects: Array<{ name: string; external?: unknown }>;
    driverFor: (name: string) => unknown;
    sync?: (name: string) => Promise<void>;
  }) => ({
    registry: { getAllObjects: () => opts.objects },
    getDriverForObject: opts.driverFor,
    syncObjectSchema: opts.sync ?? (async () => undefined),
  });

  const kernelWith = (engine: unknown) => ({
    getService: (slot: string) => (slot === 'objectql' ? engine : undefined),
  });

  it('reports full coverage when every declared object lands on the diffed driver', async () => {
    const driver = driverDouble('control');
    const synced: string[] = [];
    const engine = engineDouble({
      objects: [{ name: 'sys_position' }, { name: 'sys_permission_set' }],
      driverFor: () => driver,
      sync: async (n) => { synced.push(n); },
    });

    const out = await measureComposedCoverage(kernelWith(engine), driver, true);

    expect(synced).toEqual(['sys_position', 'sys_permission_set']);
    expect(out.coverage).toMatchObject({
      registeredObjects: 2,
      examinedObjects: 2,
      unexaminedObjects: 0,
    });
    // Silence is the point: a plan that examined everything must render
    // byte-identically to one from before this existed.
    expect(out.notes).toEqual([]);
  });

  it('names the shortfall — and its reason — when objects sit on ANOTHER driver', async () => {
    // The measured cloud shape: a composed host brings its own engine/driver
    // pair, `findSqlDriver()` resolves one driver, and part of the declared set
    // is bound somewhere the plan will never diff.
    const planned = driverDouble('control');
    const elsewhere = driverDouble('tenant');
    const engine = engineDouble({
      objects: [{ name: 'sys_notification' }, { name: 'sys_position' }, { name: 'sys_user' }],
      driverFor: (n) => (n === 'sys_notification' ? planned : elsewhere),
    });

    const out = await measureComposedCoverage(kernelWith(engine), planned, true);

    expect(out.coverage).toMatchObject({
      registeredObjects: 3,
      examinedObjects: 1,
      unexaminedObjects: 2,
    });
    expect(out.coverage.reasons.otherDriver).toBe(2);
    const said = out.notes.join(' ');
    expect(said).toContain('1 of 3 declared object(s) are in the diffed set');
    expect(said).toContain('2 bound to a different datasource');
    // The sentence a consumer gate and an operator both need: an empty result
    // over the rest is not a pass.
    expect(said).toContain('PARTIAL');
    expect(said).toContain('UNMEASURED');
  });

  it('counts federated, unbound and unsupported objects apart from one another', async () => {
    const planned = driverDouble('control');
    const engine = engineDouble({
      objects: [
        { name: 'sys_position' },
        { name: 'remote_customer', external: { remoteName: 'customers' } },
        { name: 'orphan' },
      ],
      driverFor: (n) => (n === 'sys_position' ? planned : undefined),
    });

    const out = await measureComposedCoverage(kernelWith(engine), planned, true);

    expect(out.coverage.reasons).toMatchObject({ federated: 1, unbound: 1, otherDriver: 0 });
    const said = out.notes.join(' ');
    expect(said).toContain('1 federated (no managed table)');
    expect(said).toContain('1 bound to no driver');
  });

  it('reports a REFUSING driver as a shortfall, quoting it', async () => {
    const planned = driverDouble('control');
    const engine = engineDouble({
      objects: [{ name: 'sys_position' }],
      driverFor: () => planned,
      sync: async () => { throw new Error('pool is closed'); },
    });

    const out = await measureComposedCoverage(kernelWith(engine), planned, true);

    expect(out.coverage.examinedObjects).toBe(0);
    expect(out.coverage.reasons.failed).toBe(1);
    const said = out.notes.join(' ');
    expect(said).toContain('REFUSED schema registration for 1 object(s)');
    expect(said).toContain('pool is closed');
  });

  it('says the registry was UNREADABLE rather than answering "zero objects"', async () => {
    // #9285's contract, one layer out: "the registry holds nothing" and "the
    // registry could not be read" have opposite consequences, and only the
    // first is a truthful reason to report full coverage over an empty set.
    const out = await measureComposedCoverage(kernelWith({ registry: {} }), driverDouble('control'), true);

    expect(out.coverage.registeredObjects).toBe(0);
    const said = out.notes.join(' ');
    expect(said).toContain('no readable ObjectQL registry');
    expect(said).toContain('UNMEASURED coverage, not full coverage');
  });

  it('REFUSES to bind on a boot that did not defer DDL — that call would create tables', async () => {
    // The guard that keeps this pass from turning a dry run into a migration:
    // `syncObjectSchema` takes the DDL path when the driver is not deferring,
    // so a non-deferred boot reports UNMEASURED instead of syncing.
    const planned = driverDouble('control');
    let synced = 0;
    const engine = engineDouble({
      objects: [{ name: 'sys_position' }],
      driverFor: () => planned,
      sync: async () => { synced++; },
    });

    const out = await measureComposedCoverage(kernelWith(engine), planned, false);

    expect(synced).toBe(0);
    expect(out.notes.join(' ')).toContain('did not defer schema DDL');
    expect(out.notes.join(' ')).toContain('UNMEASURED');
  });
});
