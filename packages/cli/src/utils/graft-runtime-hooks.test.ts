// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#4095 — a config-booted app lost its `onEnable`, so every `script`
 * action was declared and none was executable.
 *
 * `os serve <config>` calls `createStandaloneStack()`, which reads
 * `dist/objectstack.json` and returns a ready-made `AppPlugin`. That tripped
 * serve's "does the host already wrap itself?" guard, so the
 * `new AppPlugin(config)` built from the loaded MODULE — the only one carrying
 * the module's `onEnable` — never ran. A JSON artifact cannot hold a function,
 * so `examples/app-todo` booted with eight action declarations and zero
 * handlers and every button answered `404 Action 'complete_task' on object
 * 'todo_task' not found`.
 *
 * These pin the graft that repairs it, and — just as important — the cases where
 * it must REFUSE, since attaching one app's handlers to another app's bundle
 * would be worse than the bug.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppPlugin, collectBundleFunctions, loadArtifactBundle } from '@objectstack/runtime';
// `os compile` (run in-process below) dynamic-imports these; loaded here so the
// transform is paid during collection, not inside the beforeAll's clocked window.
import '@objectstack/objectql/core';
import '@objectstack/plugin-security';
import Compile from '../commands/compile.js';
import { bundleConfigModule } from './config.js';
import {
  GRAFTABLE_RUNTIME_MEMBERS,
  graftAuthoredRuntimeMembers,
  isAppPluginLike,
} from './graft-runtime-hooks.js';

/** An AppPlugin as `createStandaloneStack()` builds it: artifact metadata, no code. */
const artifactApp = (id: string, extra: Record<string, unknown> = {}) => ({
  name: `plugin.app.${id}`,
  type: 'app',
  bundle: {
    manifest: { id },
    objects: [{ name: 'x_task' }],
    actions: [{ name: 'do_thing', type: 'script', target: 'doThing' }],
    ...extra,
  },
});

/** The authored module as serve assembles it — metadata PLUS the code half. */
const authoredConfig = (id: string, extra: Record<string, unknown> = {}) => ({
  manifest: { id },
  objects: [{ name: 'x_task' }],
  onEnable: async () => {},
  ...extra,
});

describe('isAppPluginLike', () => {
  it('recognises every shape serve\'s own guard recognised', () => {
    // Must stay in lockstep with the guard that decides to SKIP the wrap, or the
    // skip and the graft that compensates for it disagree.
    expect(isAppPluginLike({ type: 'app' })).toBe(true);
    expect(isAppPluginLike({ name: 'plugin.app.com.example.todo' })).toBe(true);
    class AppPlugin { }
    expect(isAppPluginLike(new AppPlugin())).toBe(true);
  });

  it('is not fooled by ordinary plugins or non-objects', () => {
    expect(isAppPluginLike({ name: 'com.objectstack.metadata' })).toBe(false);
    expect(isAppPluginLike({ name: 'com.objectstack.engine.objectql' })).toBe(false);
    expect(isAppPluginLike({ type: 'service' })).toBe(false);
    expect(isAppPluginLike(null)).toBe(false);
    expect(isAppPluginLike(undefined)).toBe(false);
    expect(isAppPluginLike('plugin.app.x')).toBe(false);
  });
});

describe('graftAuthoredRuntimeMembers', () => {
  it('moves onEnable onto the artifact-derived bundle — the #4095 repair', async () => {
    const app = artifactApp('com.example.todo');
    const config = authoredConfig('com.example.todo');
    const result = await graftAuthoredRuntimeMembers([{ name: 'com.objectstack.metadata' }, app], config);

    expect(result.grafted).toEqual(['onEnable']);
    expect(result.orphaned).toEqual([]);
    expect(result.appId).toBe('com.example.todo');
    // The load-bearing assertion: AppPlugin reads this at start().
    expect(typeof (app.bundle as any).onEnable).toBe('function');
    expect((app.bundle as any).onEnable).toBe(config.onEnable);
  });

  it('moves the `functions` map too — string-named hook/job handlers are code as well', async () => {
    const app = artifactApp('com.example.todo');
    const config = authoredConfig('com.example.todo', { functions: { doThing: () => 1 } });
    const result = await graftAuthoredRuntimeMembers([app], config);

    expect(result.grafted).toEqual(['onEnable', 'functions']);
    expect(typeof (app.bundle as any).functions.doThing).toBe('function');
  });

  it('grafts nothing the artifact never lost', async () => {
    // Only executable members travel. Metadata is the artifact's job, and the
    // artifact is the richer source (it carries compile-time docs the config
    // never has), so nothing else may be copied over it.
    const app = artifactApp('com.example.todo', { docs: [{ name: 'readme' }] });
    const config = authoredConfig('com.example.todo', { objects: [{ name: 'DIFFERENT' }] });
    await graftAuthoredRuntimeMembers([app], config);

    expect((app.bundle as any).objects).toEqual([{ name: 'x_task' }]);
    expect((app.bundle as any).docs).toEqual([{ name: 'readme' }]);
  });

  it('never overwrites a hook the bundle already has', async () => {
    // A host that wrapped itself on purpose already decided what runs.
    const own = async () => {};
    const app = artifactApp('com.example.todo', { onEnable: own });
    const result = await graftAuthoredRuntimeMembers([app], authoredConfig('com.example.todo'));

    expect(result.grafted).toEqual([]);
    expect(result.reason).toBe('already-present');
    expect((app.bundle as any).onEnable).toBe(own);
  });

  it('matches by manifest.id, so one app never gets another app\'s handlers', async () => {
    const todo = artifactApp('com.example.todo');
    const crm = artifactApp('com.example.crm');
    const result = await graftAuthoredRuntimeMembers([todo, crm], authoredConfig('com.example.crm'));

    expect(result.grafted).toEqual(['onEnable']);
    expect(result.appId).toBe('com.example.crm');
    expect((crm.bundle as any).onEnable).toBeTypeOf('function');
    expect((todo.bundle as any).onEnable).toBeUndefined();
  });

  it('refuses rather than guess when the authored id matches nothing', async () => {
    // Grafting onto "the only candidate" here would wire the wrong app.
    const other = artifactApp('com.example.other');
    const result = await graftAuthoredRuntimeMembers([other], authoredConfig('com.example.todo'));

    expect(result.grafted).toEqual([]);
    expect(result.orphaned).toEqual(['onEnable']);
    expect(result.reason).toBe('no-app-plugin');
    expect((other.bundle as any).onEnable).toBeUndefined();
  });

  it('falls back to the single app bundle when the config declares no manifest id', async () => {
    const app = artifactApp('com.example.todo');
    const result = await graftAuthoredRuntimeMembers([app], { objects: [], onEnable: async () => {} });
    expect(result.grafted).toEqual(['onEnable']);
  });

  it('refuses when there is no id AND several candidates', async () => {
    const result = await graftAuthoredRuntimeMembers(
      [artifactApp('com.example.todo'), artifactApp('com.example.crm')],
      { objects: [], onEnable: async () => {} },
    );
    expect(result.grafted).toEqual([]);
    expect(result.orphaned).toEqual(['onEnable']);
    expect(result.reason).toBe('ambiguous-app-plugin');
  });

  it('reports orphaned code when no app bundle is registered at all', async () => {
    // The silent-drop case that hid #4095 — the caller has to be able to shout.
    const result = await graftAuthoredRuntimeMembers(
      [{ name: 'com.objectstack.metadata' }],
      authoredConfig('com.example.todo'),
    );
    expect(result.orphaned).toEqual(['onEnable']);
    expect(result.reason).toBe('no-app-plugin');
  });

  it('stays quiet for a config that carries no code', async () => {
    const app = artifactApp('com.example.todo');
    const result = await graftAuthoredRuntimeMembers([app], { manifest: { id: 'com.example.todo' } });
    expect(result).toEqual({ grafted: [], orphaned: [], reason: 'no-authored-members' });
  });

  it('tolerates the degenerate inputs a boot can hand it', async () => {
    for (const plugins of [undefined, [], [null], [undefined]]) {
      await expect(graftAuthoredRuntimeMembers(plugins as any, authoredConfig('x'))).resolves.toBeDefined();
    }
    for (const authored of [undefined, null, 'nope', 42, {}]) {
      expect((await graftAuthoredRuntimeMembers([artifactApp('x')], authored)).grafted).toEqual([]);
    }
    // An app plugin with no bundle at all must not throw.
    expect(
      (await graftAuthoredRuntimeMembers([{ type: 'app' }], authoredConfig('x'))).reason,
    ).toBe('no-app-plugin');
  });

  it('grafts only members AppPlugin actually executes', async () => {
    // `onDisable` is declared in packages/spec but called by no kernel, runtime
    // or service — grafting it would wire a hook nothing runs.
    expect([...GRAFTABLE_RUNTIME_MEMBERS]).toEqual(['onEnable', 'functions']);

    const app = artifactApp('com.example.todo');
    await graftAuthoredRuntimeMembers([app], authoredConfig('com.example.todo', {
      onDisable: async () => {},
    }));
    expect((app.bundle as any).onDisable).toBeUndefined();
  });
});

/**
 * One module evaluation per boot. An artifact's callables arrive from its
 * compiled runtime module (`objectstack-runtime.*.mjs`, an esbuild bundle of the
 * same config source), while the graft supplies the LOADED module's `onEnable`.
 * Left at that, the two are two evaluations of one source: state `onEnable`
 * binds at module scope is written into a copy no handler reads — on `os dev`
 * over a host config, a job reading it failed every run with "no data engine"
 * while `os start` (one evaluation) served it.
 *
 * Composed as serve composes it, from the real producer to the real reader: a
 * project compiled in-process by `os compile`, the artifact loaded by the
 * runtime's own `loadArtifactBundle` (which imports the runtime module), the
 * config module loaded by serve's own loader, the wrap a real `AppPlugin`, and
 * each handler read through `collectBundleFunctions` — the map a job's and a
 * string-named hook's `handler` resolve against.
 */
describe('graftAuthoredRuntimeMembers — onEnable and every handler run from one module evaluation', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const PKG = resolve(HERE, '../..');
  const ENGINE = { tag: 'the-engine' };
  let dir = '';
  let config: Record<string, any>;
  let artifact: Record<string, any>;
  /** The wrap's bundle — the object `AppPlugin` executes (`onEnable` at start, `functions` for handlers). */
  let served: Record<string, any>;
  let artifactFns: Record<string, (ctx: any) => any>;
  let graft: Awaited<ReturnType<typeof graftAuthoredRuntimeMembers>>;

  beforeAll(async () => {
    // Under the package's git-ignored `tmp/`, so the fixture's
    // `@objectstack/spec` import resolves through this package's dependencies.
    await mkdir(join(PKG, 'tmp'), { recursive: true });
    dir = await mkdtemp(join(PKG, 'tmp', 'one-evaluation-'));
    const configPath = join(dir, 'objectstack.config.ts');
    // `engine` is module state `onEnable` binds; the job handler and the hook
    // read it. Both name a module-scope binding, so the extractor refuses them
    // a metadata body and they run only from the runtime module — the shape of
    // a job that binds its data engine once at enable.
    await writeFile(configPath, `import { defineStack } from '@objectstack/spec';

let engine: { tag: string } | undefined;

export default defineStack({
  manifest: { id: 'com.example.one', namespace: 'one', version: '1.0.0', type: 'app', name: 'One' },
  objects: [{
    name: 'one_item',
    label: 'Item',
    sharingModel: 'public_read_write',
    fields: { note: { type: 'text', label: 'Note' } },
  }],
  hooks: [{
    name: 'one_mark',
    object: 'one_item',
    events: ['beforeInsert'],
    handler: async (ctx: any) => { ctx.input.note = engine ? engine.tag : 'unset'; },
  }],
  functions: {
    one_dispatch: async () => {
      if (!engine) throw new Error("Job 'one_dispatch' has no data engine");
      return engine.tag;
    },
  },
  onEnable: async (ctx: any) => { engine = ctx.ql; },
} as any);
`, 'utf8');
    const artifactPath = join(dir, 'dist', 'objectstack.json');
    const cwd = process.cwd();
    for (const stream of ['log', 'warn', 'error'] as const) vi.spyOn(console, stream).mockImplementation(() => {});
    process.chdir(dir);
    try {
      await Compile.run([configPath, '--output', artifactPath]);
    } finally {
      process.chdir(cwd);
      vi.restoreAllMocks();
    }

    const { mod } = await bundleConfigModule(configPath);
    config = mod.default;
    artifact = await loadArtifactBundle(artifactPath, { tag: '[serve]', unwrapEnvelope: true });
    artifactFns = collectBundleFunctions(artifact);
    const wrap = new AppPlugin(artifact, undefined, { securityMetadataRegistrar: 'artifact-door' });
    graft = await graftAuthoredRuntimeMembers([wrap], config);
    served = (wrap as unknown as { bundle: Record<string, any> }).bundle;
  }, 120_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('the fixture reaches the split: the artifact\'s handlers came from its runtime module, not the config module', () => {
    expect(artifact.runtimeModule).toMatch(/^\.\/objectstack-runtime\.[a-f0-9]+\.mjs$/);
    expect(typeof artifactFns.one_dispatch).toBe('function');
    expect(typeof artifactFns.one_mark).toBe('function');
    expect(artifactFns.one_dispatch).not.toBe(config.functions.one_dispatch);
  });

  it('grafts the module\'s onEnable and re-points every runtime-module handler at the module\'s own', () => {
    expect(graft.grafted).toEqual(['onEnable']);
    expect(graft.rebound?.slice().sort()).toEqual(['one_dispatch', 'one_mark']);
    expect(graft.unbound).toEqual([]);
    expect(served.onEnable).toBe(config.onEnable);
  });

  it('a job handler and a hook see the state onEnable bound', async () => {
    await served.onEnable({ ql: ENGINE });
    const fns = collectBundleFunctions(served);
    await expect(fns.one_dispatch({})).resolves.toBe(ENGINE.tag);
    const ctx = { input: {} as Record<string, unknown> };
    await fns.one_mark(ctx);
    expect(ctx.input.note).toBe(ENGINE.tag);
  });
});

describe('graftAuthoredRuntimeMembers — where no split exists, and where the module cannot answer', () => {
  const authored = (extra: Record<string, unknown> = {}) => ({
    manifest: { id: 'com.example.todo' },
    onEnable: async () => {},
    ...extra,
  });

  it('re-points the refs the module serves and reports the ones it does not (an artifact older than its source)', async () => {
    const fromModule = () => 'module';
    const stale = () => 'runtime-module';
    const app = artifactApp('com.example.todo', {
      runtimeModule: './objectstack-runtime.0123456789abcdef.mjs',
      functions: { kept: { handler: () => 'runtime-module', effect: 'writes' }, gone: stale },
    });
    const result = await graftAuthoredRuntimeMembers([app], authored({ functions: { kept: fromModule } }));

    expect(result.rebound).toEqual(['kept']);
    expect(result.unbound).toEqual(['gone']);
    expect(result.runtimeModule).toBe('./objectstack-runtime.0123456789abcdef.mjs');
    // The declaration beside the callable survives the re-point.
    expect((app.bundle as any).functions.kept).toEqual({ handler: fromModule, effect: 'writes' });
    expect((app.bundle as any).functions.gone).toBe(stale);
  });

  it('re-points the array form too, and never gives an entry without a callable one', async () => {
    const fromModule = () => 'module';
    const app = artifactApp('com.example.todo', {
      runtimeModule: './objectstack-runtime.0123456789abcdef.mjs',
      functions: [{ name: 'kept', handler: () => 'runtime-module' }, { name: 'declared_only', effect: 'pure' }],
    });
    const result = await graftAuthoredRuntimeMembers([app], authored({
      functions: { kept: fromModule, declared_only: () => 'module' },
    }));

    expect(result.rebound).toEqual(['kept']);
    expect((app.bundle as any).functions).toEqual([
      { name: 'kept', handler: fromModule },
      { name: 'declared_only', effect: 'pure' },
    ]);
  });

  it('leaves a bundle with no runtime module exactly as the graft left it', async () => {
    const own = () => 'own';
    const app = artifactApp('com.example.todo', { functions: { kept: own } });
    const result = await graftAuthoredRuntimeMembers([app], authored({ functions: { kept: () => 'module' } }));

    expect(result).toEqual(await graftAuthoredRuntimeMembers([artifactApp('com.example.todo', { functions: { kept: own } })],
      authored({ functions: { kept: () => 'module' } })));
    expect((app.bundle as any).functions.kept).toBe(own);
  });

  it('leaves a bundle whose own onEnable won: none of the module\'s code runs there', async () => {
    const own = () => 'own';
    const app = artifactApp('com.example.todo', {
      runtimeModule: './objectstack-runtime.0123456789abcdef.mjs',
      onEnable: async () => {},
      functions: { kept: own },
    });
    const result = await graftAuthoredRuntimeMembers([app], authored({ functions: { kept: () => 'module' } }));

    expect(result.reason).toBe('already-present');
    expect(result.rebound).toBeUndefined();
    expect((app.bundle as any).functions.kept).toBe(own);
  });
});
