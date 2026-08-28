// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findHostConfig,
  composeForDeclarations,
  buildSchemaMigrationPlugins,
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

    // Not fatal — this command worked before without ever reading the config,
    // and a plan that stops working is a worse regression than a reduced one.
    expect(out.hostConfigPath).toBe(join(dir, 'objectstack.config.ts'));
    // …but it must be DISTINGUISHABLE. `managedTables` alone cannot say this:
    // the platform floor still lands, so the count rises either way.
    expect(out.hostConfigLoaded).toBe(false);
    const said = out.notes.join(' ');
    expect(said).toContain('could not be loaded');
    expect(said).toContain('UNMEASURED');
  });
});
